#!/usr/bin/env node
/* C3 填报+提成验收（v5.1 §12 C3 行：M1、M2）：
   ① grep 断言：cloud/ 全部 .mjs/.sql 源文件 /revenue_based/ 零命中（排除本测试文件自身）
   ② 提成对拍 10 例分毫不差（期望值手算写死·分）：整数/非整回款 × 不同毛利率 × 不同 r、
      round ×0.5 分边界、0 回款、null 守卫、多品类汇总、跨月归属、reimburse 不进收入、年终奖进收入
   ③ 改版不追溯：v1(r=0.20, eff 2026-01-01) 算 3 月 → 建 v2(r=0.25, eff 2026-07-01) →
      3 月重算值不变、7 月起用 0.25；comp_plan_versions UPDATE/DELETE 被拒；版本全表可查（≥2 行留痕）
   ④ M1：同人同日重复提交=覆盖（行数不变 counts 更新+事件+1）；填报率分母排除周日（跨周窗口手算对照）；
      休息日 missingToday=空
   ⑤ 回归：spawnSync 跑 c2-model 确认 run-all 不受影响 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../db/seed.mjs';
import { submitDailyReport, fillRate, missingToday } from '../server/m1.mjs';
import { createPlanVersion, planVersionAt, commissionFor, incomeFor, laborCostFor } from '../server/m2.mjs';
import { put } from '../server/writes.mjs';

const selfPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(selfPath));               // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

const TEST_TODAY = '2026-07-13';                       // 公约 C-14/R-11：时钟注入，与五板块对拍同一基准日

/* ================= ① grep 断言：全码无 revenue_based ================= */
console.log('— ① grep 断言：cloud/ 全码无 revenue_based（v5.1 V-03 / 公约 §4.5） —');
{
  function* walk(dir) {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) yield* walk(p); else yield p;
    }
  }
  const files = [...walk(root)].filter(p => /\.(mjs|sql)$/.test(p) && p !== selfPath);
  ok(files.length >= 15, `扫描源文件 ≥15（实际 ${files.length}）`);
  const hits = files.filter(p => /revenue_based/.test(readFileSync(p, 'utf8')));
  ok(hits.length === 0, 'revenue_based 全码零命中（排除本测试文件自身）', hits.join(','));
  // 附带：C3 服务层零 new Date()（公约 C-14 时钟注入——writes/m1/m2 承诺项）
  const clockHits = ['server/writes.mjs', 'server/m1.mjs', 'server/m2.mjs']
    .filter(f => /new Date\(/.test(readFileSync(join(root, f), 'utf8')));
  ok(clockHits.length === 0, 'C3 服务层零 new Date()（时间戳走 DB now()，业务日期走 ctx.today）', clockHits.join(','));
  // 附带：comp_plan_versions 的 commission_base CHECK 只含 margin_based / neutral_kpi（E-08 去 contract_amount 写入径）
  const c3sql = readFileSync(join(root, 'db', 'schema-c3.sql'), 'utf8');
  ok(/commission_base in \('margin_based','neutral_kpi'\)/.test(c3sql),
    "schema-c3 commission_base CHECK 仅 ('margin_based','neutral_kpi')");
}

/* ================= 环境：PGlite + schema 三段执行 + seedTenant ================= */
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create role authenticated nologin;
  create role app_user login;
  grant usage on schema public to app_user;
  grant authenticated to app_user;
`);
await db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
await db.exec(readFileSync(join(root, 'db', 'schema-c2.sql'), 'utf8'));
await db.exec(readFileSync(join(root, 'db', 'schema-c3.sql'), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;
  revoke update, delete on comp_plan_versions from app_user;`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const U = { bossA: 'a0000000-0000-4000-8000-00000000000a', boss2: 'c0000000-0000-4000-8000-00000000000c' };

const [{ id: tenantA }] = await q(`insert into tenants(name, created_by) values ('租户A·种子', $1) returning id`, [U.bossA]);
const [{ id: tenant2 }] = await q(`insert into tenants(name, created_by) values ('租户2·提成对拍', $1) returning id`, [U.boss2]);
const [{ id: tenant3 }] = await q(`insert into tenants(name, created_by) values ('租户3·填报', $1) returning id`, [U.boss2]);
const stats = await seedTenant(db, tenantA, U.bossA, TEST_TODAY);
console.log('  种子租户A规模：' + JSON.stringify({ deals: stats.deals, daily_reports: stats.daily_reports, events: stats.eventTotal }));

const ctxA = { tenantId: tenantA, actorId: U.bossA, today: TEST_TODAY };
const ctx2 = { tenantId: tenant2, actorId: U.boss2, today: TEST_TODAY };
const ctx3 = { tenantId: tenant3, actorId: U.boss2, today: TEST_TODAY };

/* ================= ②+③ 提成：方案版本 + 对拍 10 例 + 改版不追溯 ================= */
console.log('— ②③ M2 提成对拍 10 例 + 改版不追溯 —');

/* PlanInputs 13 项快照（定价器件二口径的输入快照——此处为不透明 jsonb，载入不回算） */
const PLAN_INPUTS_13 = {
  cityTier: 'tier1', levelType: 'sales', positionType: 'pure_sales', cycleType: 'short',
  tierGrade: 'effective', baseSalaryAmt: 750000, thresholdTAmt: 3000000, grossMarginBaseAmt: 6000000,
  longTermRate: 0.10, teamSize: 10, quotaAmt: 10000000, attainDesignBase: 0.70, exploreMode: false,
};
ok(Object.keys(PLAN_INPUTS_13).length === 13, 'PlanInputs 快照恰 13 项');

/* 品类（tenant2）：不同毛利率 */
const CATS = [['catHi', 0.60], ['catMid', 0.45], ['catHalf', 0.50], ['catLo', 0.18]];
for (const [id, rate] of CATS) {
  await put(db, ctx2, 'categories', { id, name: id, gross_margin_rate: rate }, 'category_created');
}
/* e10 需要人事档案（底薪 → incomeFor/laborCostFor） */
await put(db, ctx2, 'salespersons',
  { id: 'e10', name: '钱拾', level: 'sales', position_type: 'pure_sales', base_salary_amt: 750000, is_active: true },
  'salesperson_created');

let dseq = 0;
async function mkDeal(emp, { amt, catId, snap, dealDate, paidDate, status = 'won' }) {
  await put(db, ctx2, 'deals', {
    id: `d3_${++dseq}`, employee_id: emp, deal_date: dealDate, payment_amt: amt, category_id: catId,
    status, paid_date: paidDate ?? null, margin_rate_snapshot: snap ?? null,
  }, 'deal_created');
}

/* v1：r=0.20，2026-01-01 起生效 */
const v1 = await createPlanVersion(db, ctx2, { inputs: PLAN_INPUTS_13, rRate: 0.20, matrixTAmt: 3000000, effectiveFrom: '2026-01-01' });
ok(v1.version === 1, `v1 版本号 = 1（实际 ${v1.version}）`);

/* —— 成交数据（金额一律「分」） —— */
await mkDeal('e1', { amt: 1000000, catId: 'catHi', snap: 0.60, dealDate: '2026-03-10', paidDate: '2026-03-10' });
await mkDeal('e2', { amt: 123457, catId: 'catMid', snap: 0.45, dealDate: '2026-03-11', paidDate: '2026-03-11' });
await mkDeal('e3', { amt: 25, catId: 'catHalf', snap: 0.50, dealDate: '2026-03-12', paidDate: '2026-03-12' });
await mkDeal('e4', { amt: 0, catId: 'catHi', snap: 0.60, dealDate: '2026-03-13', paidDate: '2026-03-13' });
await mkDeal('e5', { amt: 999999, catId: 'cat_ghost', snap: null, dealDate: '2026-03-14', paidDate: '2026-03-14' }); // 快照+品类双缺 → 守卫跳过
await mkDeal('e5', { amt: 200000, catId: 'catHi', snap: null, dealDate: '2026-03-15', paidDate: '2026-03-15' });     // 快照缺 → 回退 join categories 0.60
await mkDeal('e6', { amt: 100000, catId: 'catHi', snap: 0.60, dealDate: '2026-03-16', paidDate: '2026-03-16' });
await mkDeal('e6', { amt: 200000, catId: 'catMid', snap: 0.45, dealDate: '2026-03-17', paidDate: '2026-03-17' });
await mkDeal('e6', { amt: 50000, catId: 'catLo', snap: 0.18, dealDate: '2026-03-18', paidDate: '2026-03-18' });
await mkDeal('e7', { amt: 100000, catId: 'catHi', snap: 0.60, dealDate: '2026-03-30', paidDate: '2026-04-02' });     // 跨月：3月成交4月回款
await mkDeal('e7', { amt: 555555, catId: 'catHi', snap: 0.60, dealDate: '2026-03-31', paidDate: null });             // won 未回款不计
await mkDeal('e8', { amt: 999999, catId: 'catHi', snap: 0.60, dealDate: '2026-03-19', paidDate: null, status: 'open' });
await mkDeal('e8', { amt: 777777, catId: 'catHi', snap: 0.60, dealDate: '2026-03-19', paidDate: null, status: 'lost' });
await mkDeal('e8', { amt: 300000, catId: 'catMid', snap: 0.45, dealDate: '2026-03-20', paidDate: '2026-03-20' });

const results = [];   // 对拍表行：[#, 输入, 期望, 实际, pass]
async function pai(no, label, expect, fn) {
  const actual = await fn();
  results.push([no, label, expect, actual, actual === expect]);
  ok(actual === expect, `对拍${no} ${label}：期望 ${expect} 实际 ${actual}`);
}
const comm = async (emp, month) => (await commissionFor(db, ctx2, { employeeId: emp, month })).commissionAmt;

/* —— 3 月（v1 r=0.20）：手算期望值（分） —— */
await pai(1, 'e1 整数回款 1000000×0.60×0.20', 120000, () => comm('e1', '2026-03'));
await pai(2, 'e2 非整回款 123457×0.45×0.20=11111.13', 11111, () => comm('e2', '2026-03'));
await pai(3, 'e3 round 边界 25×0.50×0.20=2.5分→四舍五入', 3, () => comm('e3', '2026-03'));
await pai(4, 'e4 0 回款', 0, () => comm('e4', '2026-03'));
await pai(5, 'e5 null 守卫：双缺跳过 + 快照缺回退品类 200000×0.60×0.20', 24000, () => comm('e5', '2026-03'));
await pai(6, 'e6 多品类汇总 12000+18000+1800', 31800, () => comm('e6', '2026-03'));
await pai(7, 'e7 跨月归属：3月成交4月回款 → 3月不计', 0, () => comm('e7', '2026-03'));
{
  const apr = await comm('e7', '2026-04');
  results.push(['7b', 'e7 跨月归属：4月计提 100000×0.60×0.20', 12000, apr, apr === 12000]);
  ok(apr === 12000, `对拍7b e7 4月计提：期望 12000 实际 ${apr}`);
}
await pai(8, 'e8 open/lost/未回款不计，仅 won 已回款 300000×0.45×0.20', 27000, () => comm('e8', '2026-03'));

/* ================= ③ 改版不追溯 ================= */
console.log('— ③ 改版不追溯（comp_plan_versions append-only） —');
const e1MarchBefore = await comm('e1', '2026-03');
const v2 = await createPlanVersion(db, ctx2, { inputs: { ...PLAN_INPUTS_13, quotaAmt: 12000000 }, rRate: 0.25, matrixTAmt: 3600000, effectiveFrom: '2026-07-01' });
ok(v2.version === 2, `v2 版本号 = 该租户 max+1 = 2（实际 ${v2.version}）`);
const e1MarchAfter = await comm('e1', '2026-03');
ok(e1MarchBefore === 120000 && e1MarchAfter === 120000,
  `建 v2 后 3 月提成重算值不变：${e1MarchBefore} → ${e1MarchAfter}（历史期用历史版本）`);
{
  const pv3 = await planVersionAt(db, ctx2, '2026-03-01');
  const pv7 = await planVersionAt(db, ctx2, '2026-07-01');
  const pv0 = await planVersionAt(db, ctx2, '2025-12-31');
  ok(pv3.version === 1 && Number(pv3.r_rate) === 0.20, `planVersionAt(2026-03-01) → v1 r=0.20（实际 v${pv3.version} r=${pv3.r_rate}）`);
  ok(pv7.version === 2 && Number(pv7.r_rate) === 0.25, `planVersionAt(2026-07-01) → v2 r=0.25（实际 v${pv7.version} r=${pv7.r_rate}）`);
  ok(pv0 === null, 'planVersionAt(生效前日期) → null（无版本不硬造）');
}
/* 7 月起用 0.25（对拍 9/10 同时是 10 例表的最后两行） */
await mkDeal('e9', { amt: 100000, catId: 'catHi', snap: 0.60, dealDate: '2026-07-06', paidDate: '2026-07-06' });
await pai(9, 'e9 换版后 7 月 100000×0.60×0.25（r=v2）', 15000, () => comm('e9', '2026-07'));
await mkDeal('e10', { amt: 200000, catId: 'catHi', snap: 0.60, dealDate: '2026-07-08', paidDate: '2026-07-08' });
await put(db, ctx2, 'payout_entries', { id: 'po_c3_1', employee_id: 'e10', payout_date: '2026-07-10', type: 'reimburse', amount_amt: 50000 }, 'payout_created');
await put(db, ctx2, 'payout_entries', { id: 'po_c3_2', employee_id: 'e10', payout_date: '2026-07-15', type: 'year_end_bonus', amount_amt: 120000 }, 'payout_created');
{
  const inc = await incomeFor(db, ctx2, { employeeId: 'e10', month: '2026-07' });
  const lc = await laborCostFor(db, ctx2, { employeeId: 'e10', month: '2026-07' });
  // 手算：提成 = 200000×0.60×0.25 = 30000
  // totalIncome = 底薪750000 + 提成30000 + 年终奖120000（reimburse 50000 永不计入）= 900000
  // laborCost  = 750000 + round(750000×0.30)=225000 + 30000 + (50000+120000)=170000 → 1175000
  results.push([10, 'e10 incomeFor：底薪+提成+年终奖，reimburse 不进收入', 900000, inc.incomeAmt, inc.incomeAmt === 900000]);
  ok(inc.commissionAmt === 30000, `对拍10 e10 7月提成 200000×0.60×0.25：期望 30000 实际 ${inc.commissionAmt}`);
  ok(inc.incomeAmt === 900000, `对拍10 e10 totalIncome（reimburse 不进收入、年终奖进收入）：期望 900000 实际 ${inc.incomeAmt}`);
  ok(lc.laborCostAmt === 1175000, `对拍10b e10 laborCost（报销只进成本+社保 30%）：期望 1175000 实际 ${lc.laborCostAmt}`);
}
/* append-only：UPDATE / DELETE 无成功路径 */
{
  let err = null;
  try { await db.query(`update comp_plan_versions set r_rate = 0.99 where tenant_id = $1 and version = 1`, [tenant2]); }
  catch (e) { err = e.message; }
  ok(err != null && /append-only/.test(err), 'comp_plan_versions UPDATE 被拒（append-only）', err || '（竟然成功）');
  err = null;
  try { await db.query(`delete from comp_plan_versions where tenant_id = $1 and version = 1`, [tenant2]); }
  catch (e) { err = e.message; }
  ok(err != null && /append-only/.test(err), 'comp_plan_versions DELETE 被拒（append-only）', err || '（竟然成功）');
}
/* 版本全表可查：≥2 行留痕；版本号连续；事件双写留痕 */
{
  const rows = await q(`select version, r_rate::float8 as r, effective_from::text as ef, commission_base
                          from comp_plan_versions where tenant_id = $1 order by version`, [tenant2]);
  ok(rows.length >= 2, `改版留痕可查全表：${rows.length} 行（v${rows.map(r => r.version).join(',v')}）`);
  ok(rows.every(r => r.commission_base === 'margin_based'), 'commission_base 全部 = margin_based（列默认，永不可换）');
  const ev = await q(`select count(*)::int as n from event_stream where tenant_id = $1 and type = 'comp_plan_version_created'`, [tenant2]);
  ok(ev[0].n === 2, `方案版本事件双写留痕 = 2 条（实际 ${ev[0].n}）`);
  let err = null;   // CHECK 拒绝 E-08 的 contract_amount 写入径
  try { await db.query(`insert into comp_plan_versions(tenant_id, version, inputs, r_rate, effective_from, commission_base)
    values ($1, 99, '{}', 0.2, '2026-01-01', 'contract_amount')`, [tenant2]); } catch (e) { err = e.message; }
  ok(err != null && /check|constraint/i.test(err), "commission_base='contract_amount' 被 CHECK 拒绝（E-08 无写入径）", err || '');
}
/* 版本号按 tenant 独立自增：租户A 首版 = 1（不受租户2 已有 2 版影响） */
{
  const vA = await createPlanVersion(db, ctxA, { inputs: PLAN_INPUTS_13, rRate: 0.195, matrixTAmt: 3000000, effectiveFrom: '2026-01-01' });
  ok(vA.version === 1, `方案版本表按 tenant：租户A 首版 = 1（实际 ${vA.version}），与租户2 的 v1/v2 互不串号`);
}

/* —— 10 例对拍表 —— */
console.log('  ┌ 提成对拍 10 例（输入 → 期望 → 实际，单位·分）');
for (const [no, label, expect, actual, pass] of results) {
  console.log(`  │ ${pass ? '✓' : '✗'} #${no} ${label} → 期望 ${expect} → 实际 ${actual}`);
}
console.log('  └');

/* ================= ④ M1 填报 ================= */
console.log('— ④ M1 填报：覆盖 / 填报率分母 / 休息日 —');
/* 租户3：3 名销售。排班：'*' 周三全员休（兜底）；spB 周六休（专属）；spC 周三上班（专属 > '*'）；周日默认休 */
for (const [id, name] of [['spA', '安甲'], ['spB', '柏乙'], ['spC', '崔丙']]) {
  await put(db, ctx3, 'salespersons', { id, name, level: 'sales', position_type: 'pure_sales', base_salary_amt: 750000, is_active: true }, 'salesperson_created');
}
await put(db, ctx3, 'shift_configs', { id: 'sc_all_wed', employee_id: '*', weekday: 3, is_workday: false }, 'shift_config_set');
await put(db, ctx3, 'shift_configs', { id: 'sc_B_sat', employee_id: 'spB', weekday: 6, is_workday: false }, 'shift_config_set');
await put(db, ctx3, 'shift_configs', { id: 'sc_C_wed', employee_id: 'spC', weekday: 3, is_workday: true }, 'shift_config_set');

/* 同人同日重复提交 = 覆盖（spB @ 2026-07-06，周一） */
{
  const first = await submitDailyReport(db, ctx3, { employeeId: 'spB', date: '2026-07-06', counts: { leads: 5, intents: '3', samples: null, contracts: 2.9 } });
  ok(first.mode === 'submitted', `首次提交 mode=submitted（实际 ${first.mode}）`);
  const [row1] = await q(`select leads, intents, samples, contracts from daily_reports where tenant_id=$1 and employee_id='spB' and report_date='2026-07-06'`, [tenant3]);
  ok(row1.leads === 5 && row1.intents === 3 && row1.samples === 0 && row1.contracts === 2,
    `四计数 |0 清洗：{5,'3',null,2.9} → {5,3,0,2}（实际 {${row1.leads},${row1.intents},${row1.samples},${row1.contracts}}）`);
  const evBefore = (await q(`select count(*)::int as n from event_stream where tenant_id=$1 and type like 'daily_report%'`, [tenant3]))[0].n;
  const second = await submitDailyReport(db, ctx3, { employeeId: 'spB', date: '2026-07-06', counts: { leads: 8, intents: 4, samples: 1, contracts: 1 } });
  ok(second.mode === 'overwritten', `重复提交 mode=overwritten（实际 ${second.mode}）`);
  const nRows = (await q(`select count(*)::int as n from daily_reports where tenant_id=$1 and employee_id='spB' and report_date='2026-07-06'`, [tenant3]))[0].n;
  const [row2] = await q(`select leads, intents, samples, contracts from daily_reports where tenant_id=$1 and employee_id='spB' and report_date='2026-07-06'`, [tenant3]);
  const evAfter = (await q(`select count(*)::int as n from event_stream where tenant_id=$1 and type like 'daily_report%'`, [tenant3]))[0].n;
  ok(nRows === 1, `覆盖后行数不变 = 1（实际 ${nRows}）`);
  ok(row2.leads === 8 && row2.intents === 4 && row2.samples === 1 && row2.contracts === 1, `counts 已更新为 {8,4,1,1}（实际 {${row2.leads},${row2.intents},${row2.samples},${row2.contracts}}）`);
  ok(evAfter === evBefore + 1, `事件 +1（${evBefore} → ${evAfter}：daily_report_overwritten 留痕，原 submitted 事件不灭）`);
}
/* 其余日报（窗口 2026-07-06 周一 ～ 2026-07-19 周日，跨两周）
   spA：8 个工作日 + 1 个周日（12日，休息日提交不进分子）
   spB：已提交 06，再补 07/09/10；spC：06–11 共 6 天 */
for (const d of ['2026-07-07', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-13', '2026-07-14', '2026-07-16', '2026-07-12']) {
  await submitDailyReport(db, ctx3, { employeeId: 'spA', date: d, counts: { leads: 6, intents: 2, samples: 1, contracts: 0 } });
}
await submitDailyReport(db, ctx3, { employeeId: 'spA', date: '2026-07-06', counts: { leads: 6, intents: 2, samples: 1, contracts: 0 } });
for (const d of ['2026-07-07', '2026-07-09', '2026-07-10']) {
  await submitDailyReport(db, ctx3, { employeeId: 'spB', date: d, counts: { leads: 4, intents: 1, samples: 0, contracts: 0 } });
}
for (const d of ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']) {
  await submitDailyReport(db, ctx3, { employeeId: 'spC', date: d, counts: { leads: 7, intents: 3, samples: 1, contracts: 1 } });
}
/* 填报率手算对照（窗口 14 天：周日 12/19；周三 8/15；周六 11/18）
   spA：默认+ '*'周三休 → 分母 = 14−2周日−2周三 = 10；分子 = 8（12日周日提交不计）→ 0.8
   spB：+周六休（专属）→ 分母 = 14−2−2−2 = 8；分子 = 4 → 0.5
   spC：周三上班（专属覆盖 '*'）→ 分母 = 14−2周日 = 12；分子 = 6 → 0.5
   tenant：分母 30、分子 18 → 0.6 */
{
  const fr = await fillRate(db, ctx3, { from: '2026-07-06', to: '2026-07-19' });
  const by = Object.fromEntries(fr.byEmployee.map(e => [e.employeeId, e]));
  ok(by.spA.workdays === 10 && by.spA.filed === 8 && by.spA.rate === 8 / 10,
    `spA 分母10（排除2周日+2周三'*'）分子8（周日提交不计）rate=0.8（实际 ${by.spA.filed}/${by.spA.workdays}=${by.spA.rate}）`);
  ok(by.spB.workdays === 8 && by.spB.filed === 4 && by.spB.rate === 4 / 8,
    `spB 分母8（再排2周六·员工专属排班）分子4 rate=0.5（实际 ${by.spB.filed}/${by.spB.workdays}=${by.spB.rate}）`);
  ok(by.spC.workdays === 12 && by.spC.filed === 6 && by.spC.rate === 6 / 12,
    `spC 分母12（专属周三上班 > '*'兜底）分子6 rate=0.5（实际 ${by.spC.filed}/${by.spC.workdays}=${by.spC.rate}）`);
  ok(fr.tenant.workdays === 30 && fr.tenant.filed === 18 && fr.tenant.rate === 18 / 30,
    `tenant 聚合 18/30=0.6（实际 ${fr.tenant.filed}/${fr.tenant.workdays}=${fr.tenant.rate}）`);
}
/* missingToday：周三（'*'休）只有 spC 上班且未填 → 恰 [spC]；周日全员默认休 → 空 */
{
  const wed = await missingToday(db, { ...ctx3, today: '2026-07-15' });
  ok(wed.length === 1 && wed[0].employeeId === 'spC',
    `周三 21:00 黄条名单 = [spC]（spA/spB 休息不催；spC 上班未填）（实际 ${JSON.stringify(wed.map(x => x.employeeId))}）`);
  const sun = await missingToday(db, { ...ctx3, today: '2026-07-12' });
  ok(sun.length === 0, `周日（全员默认休）missingToday = 空（实际 ${sun.length} 人）`);
  const mon = await missingToday(db, { ...ctx3, today: '2026-07-06' });
  ok(mon.length === 0, `周一全员已填 → missingToday = 空（对照组）（实际 ${mon.length} 人）`);
}

await db.close();

/* ================= ⑤ 回归：C2 不受影响 ================= */
console.log('— ⑤ 回归：spawnSync 跑 c2-model（run-all 所辖 C0/C1 套件不动 C3 无涉，C2 为最近邻回归面） —');
{
  const r = spawnSync('node', [join(root, 'tests', 'c2-model.test.mjs')], { encoding: 'utf8', timeout: 300000 });
  ok(r.status === 0, 'c2-model.test.mjs 回归通过',
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C3 填报+提成验收全部通过');
process.exit(failures ? 1 : 0);
