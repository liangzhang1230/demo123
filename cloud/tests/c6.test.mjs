#!/usr/bin/env node
/* C6 真相层验收（v5.1 §12 C6 行：M21/M32/M9/M11/M18/M19 + dayRoll）：
   ① 🔴 A-11 全锁：未 runM21 → m32.runUER / m9.scissorsBoard / m11.managerLift /
      m18.stopBleed 全抛 A11_LOCKED；runM21 后放行（当月或上月任一已跑均放行）
   ② M21 落表对拍：核弹表种子（3号 §3.2 出厂对拍）跑 runM21 → 失衡率 70% /
      rank(J)=1 / rank(A)=8（原始#1）/ 逐人 norm_margin 与 C1 引擎 m21Normalize 逐格一致
   ③ M11 机检：managerLift 函数体切片 grep 无 payment_amt/paymentAmt（S-D14 / S-C03）；
      任期<3月→null；归一化增益手算对照；rawCompareForHandover 独立函数 + 注释限定用途
   ④ UER：观测<48→gate:false 且 uerTeamMean 落 null（不硬造）；≥48→残差落表
      （value_num=actual−pred、band 三档）、attribution 三分支齐全（leak/territory/undetermined，
      explanations 恒含 hoarding/leak/territory 三种解释——S-03 绝不下定论）
   ⑤ 止血双校验三分支：starved 拦截（S-13）/ invisible_work（UER>0，从 derived_scalars 读）/ proceed
   ⑥ 品类熔断：<22% ∧ >20% 才熔断（domain.categoryFuse）；leverageDrill 五因子手算对照
   ⑦ derived_scalars：dayRoll 后带 computed_at 落表；同日重跑幂等（行数不变、computed_at 刷新、
      数据变更后重跑 = 覆盖值）
   ⑧ 事件双写抽查（m21_ran / uer_ran / day_rolled / derived_scalar_written / m21_norm_written）
   ⑨ 回归：spawnSync c2-model / c3 / c4 / c5
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13，服务层零 new Date() */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { m21Normalize, realP90Factor } from '../domain/suanzhang.mjs';
import { mean } from '../domain/shared.mjs';
import { put, upsert } from '../server/writes.mjs';
import { runM21, m21Done } from '../server/m21.mjs';
import { runUER, personUER, attribution } from '../server/m32.mjs';
import { scissorsBoard, raiseSimulate } from '../server/m9.mjs';
import { managerLift, rawCompareForHandover } from '../server/m11.mjs';
import { paybackBoard, stopBleed, expandSandbox } from '../server/m18.mjs';
import { categoryRadar, leverageDrill } from '../server/m19.mjs';
import { dayRoll } from '../server/dayroll.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const near = (a, b, eps = 1e-6) => a != null && b != null && Math.abs(a - b) < eps;
const isA11 = e => e != null && e.code === 'A11_LOCKED';

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11：与五板块对拍同一基准日
const CUR = '2026-07', PREV = '2026-06';

/* 3号 §3.2 出厂对拍（核弹表）：10 人 / 月1000条 / 人均100（margin 单位：分） */
const NUKE = [['A', 180, 12.0e6], ['B', 120, 10.0e6], ['C', 120, 9.5e6], ['D', 100, 8.0e6], ['E', 100, 7.5e6],
  ['F', 100, 7.0e6], ['G', 85, 6.0e6], ['H', 85, 5.0e6], ['I', 80, 4.0e6], ['J', 30, 3.0e6]];
const NUKE_DOMAIN = m21Normalize(NUKE.map(p => ({ id: p[0], name: p[0], leads: p[1], grossMarginAmt: p[2], selfDevLeads: 0 })));
const dRow = id => NUKE_DOMAIN.rows.find(r => r.id === id);

/* ================= ⓪ 静态断言 ================= */
console.log('— ⓪ 静态断言：C6 服务层零 new Date()（公约 C-14）+ M11 机检（S-D14）+ 沙盒零写库（S-D9） —');
const M11_SRC = readFileSync(join(root, 'server', 'm11.mjs'), 'utf8');
{
  const clockHits = ['server/m21.mjs', 'server/m32.mjs', 'server/m9.mjs', 'server/m11.mjs',
    'server/m18.mjs', 'server/m19.mjs', 'server/dayroll.mjs']
    .filter(f => /new Date\(/.test(readFileSync(join(root, f), 'utf8')));
  ok(clockHits.length === 0, 'C6 七个服务模块零 new Date()（业务日期一律 ctx.today）', clockHits.join(','));

  /* ③ M11 机检：managerLift 函数体切片无原始回款字段；换帅原始口径独立函数 + 注释限定用途 */
  const liftStart = M11_SRC.indexOf('export async function managerLift');
  const rawStart = M11_SRC.indexOf('export async function rawCompareForHandover');
  ok(liftStart >= 0 && rawStart > liftStart, 'managerLift 与 rawCompareForHandover 均存在且分离');
  const liftBody = M11_SRC.slice(liftStart, rawStart);
  ok(!/payment_amt|paymentAmt/i.test(liftBody),
    '🔴 managerLift 函数体（含分子分母组装）grep 无 payment_amt/paymentAmt（S-D14/S-C03）');
  ok(/norm_margin/.test(liftBody), 'managerLift 分子分母取 m21_norms.norm_margin（归一化人均）');
  ok(/仅限换帅对比/.test(M11_SRC) && /禁止将本函数输出用于跨队排名/.test(M11_SRC),
    'rawCompareForHandover 带注释限定用途（仅限换帅对比，禁用于跨队排名/考核）');
  ok(/payment_amt/.test(M11_SRC.slice(rawStart)), '原始口径只存在于 rawCompareForHandover（换帅同队前后天然控制地盘）');

  /* S-D9：两个只读沙盒零写库路径 */
  const m9src = readFileSync(join(root, 'server', 'm9.mjs'), 'utf8');
  const simBody = m9src.slice(m9src.indexOf('export function raiseSimulate'));
  ok(!/\b(put|patch|upsert|logEvent)\s*\(/.test(simBody) && !/db\./.test(simBody),
    'raiseSimulate 加薪模拟：纯函数零 db 零写库（S-D9）');
  const m18src = readFileSync(join(root, 'server', 'm18.mjs'), 'utf8');
  const sandBody = m18src.slice(m18src.indexOf('export async function expandSandbox'));
  ok(!/\b(put|patch|upsert|logEvent)\s*\(/.test(sandBody), 'expandSandbox 扩编沙盒：零写库路径（S-D9）');
}

/* ================= 环境：PGlite + schema 五段执行 ================= */
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
for (const f of ['schema.sql', 'schema-c2.sql', 'schema-c3.sql', 'schema-c4.sql', 'schema-c6.sql']) {
  await db.exec(readFileSync(join(root, 'db', f), 'utf8'));
}
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const U = { boss: 'a0000000-0000-4000-8000-00000000000a' };
const mkTenant = async name => (await q(`insert into tenants(name, created_by) values ($1, $2) returning id`, [name, U.boss]))[0].id;
const esType = async (t, type) => (await q(`select count(*)::int as n from event_stream where tenant_id = $1 and type = $2`, [t, type]))[0].n;

const tL = await mkTenant('C6·A11锁');
const tL2 = await mkTenant('C6·A11上月放行');
const tN = await mkTenant('C6·核弹表');
const tU = await mkTenant('C6·UER');
const tS = await mkTenant('C6·止血');
const tC = await mkTenant('C6·品类');
const ctx = t => ({ tenantId: t, actorId: U.boss, today: TEST_TODAY });
const ctxL = ctx(tL), ctxL2 = ctx(tL2), ctxN = ctx(tN), ctxU = ctx(tU), ctxS = ctx(tS), ctxC = ctx(tC);

/* ---------- 种子工具 ---------- */
const mkSp = (c, id, opts = {}) => put(db, c, 'salespersons', {
  id, name: opts.name ?? id, level: opts.level ?? 'sales',
  hire_date: opts.hireDate ?? '2026-01-01', manager_id: opts.managerId ?? null,
  base_salary_amt: opts.baseAmt ?? 3000000, hiring_cost_amt: opts.hiringCostAmt ?? null,
  is_active: opts.isActive ?? true,
}, 'salesperson_created');
const mkLeads = (c, id, employeeId, month, assigned, selfDev = 0) => put(db, c, 'lead_assignments',
  { id, employee_id: employeeId, month, assigned_leads: assigned, self_dev_leads: selfDev }, 'lead_assignment_created');
const mkCat = (c, id, rate) => put(db, c, 'categories', { id, name: id, gross_margin_rate: rate }, 'category_created');
const mkDeal = (c, id, employeeId, date, payAmt, rate, catId = 'cat0') => put(db, c, 'deals',
  { id, employee_id: employeeId, deal_date: date, payment_amt: payAmt, category_id: catId,
    margin_rate_snapshot: rate, status: 'won', paid_date: date }, 'deal_created');

/* ================= ① 🔴 A-11 全锁（v5.1 §12 C6 行 / 公约 A-11） ================= */
console.log('— ① A-11 硬闸门：未 runM21 全锁 → runM21 后放行 —');
{
  await mkSp(ctxL, 'l1'); await mkSp(ctxL, 'l2');
  await mkCat(ctxL, 'cat0', 0.5);
  await mkLeads(ctxL, 'laL1', 'l1', CUR, 50); await mkLeads(ctxL, 'laL2', 'l2', CUR, 50);
  await mkDeal(ctxL, 'dL1', 'l1', '2026-07-05', 8000000, 0.5);
  await mkDeal(ctxL, 'dL2', 'l2', '2026-07-06', 6000000, 0.5);

  for (const [name, fn] of [
    ['m32.runUER', () => runUER(db, ctxL)],
    ['m9.scissorsBoard', () => scissorsBoard(db, ctxL)],
    ['m11.managerLift', () => managerLift(db, ctxL, { managerId: 'l1' })],
    ['m18.stopBleed', () => stopBleed(db, ctxL)],
  ]) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    ok(isA11(err), `未 runM21 → ${name} 抛 A11_LOCKED`, err ? err.message : '（未抛错）');
  }

  const r = await runM21(db, ctxL, { month: CUR });
  ok(r.done === true && r.n === 2 && await m21Done(db, ctxL, { month: CUR }),
    `runM21 后 m21Done=true（n=${r.n}）`);
  const u = await runUER(db, ctxL);                     // 放行（gate:false 是 minObs，不是 A11）
  ok(u.gate === false && u.reason === 'minObs', `runM21 后 runUER 放行（观测 ${u.n} < 48 → gate:false minObs）`);
  const sb = await scissorsBoard(db, ctxL);
  ok(Array.isArray(sb.rows) && sb.rows.length === 2, 'runM21 后 scissorsBoard 放行（2 行）');
  const ml = await managerLift(db, ctxL, { managerId: 'l1' });
  ok(ml != null && 'lift' in ml, 'runM21 后 managerLift 放行');
  const stb = await stopBleed(db, ctxL);
  ok(Array.isArray(stb.candidates), 'runM21 后 stopBleed 放行');

  /* 上月已跑同样放行（requireM21：本月或上月任一） */
  await mkSp(ctxL2, 'p1'); await mkSp(ctxL2, 'p2');
  await mkLeads(ctxL2, 'laP1', 'p1', PREV, 40); await mkLeads(ctxL2, 'laP2', 'p2', PREV, 60);
  await runM21(db, ctxL2, { month: PREV });
  let err2 = null;
  try { await scissorsBoard(db, ctxL2); } catch (e) { err2 = e; }
  ok(err2 == null, '仅上月已跑 M21 → 同样放行（dayRoll 上月+当月的兜底判据）');
}

/* ================= ② M21 落表对拍（与 C1 引擎逐格一致） ================= */
console.log('— ② M21 落表对拍：核弹表 → m21_norms/derived_scalars 与 domain.m21Normalize 一致 —');
{
  await mkCat(ctxN, 'cat0', 0.5);
  await mkSp(ctxN, 'mgrX', { level: 'manager', hireDate: '2025-01-01' });
  await mkSp(ctxN, 'mgrY', { level: 'manager', hireDate: '2025-06-01' });
  await mkSp(ctxN, 'mgrZ', { level: 'manager', hireDate: '2026-06-20' });   // 任期 < 3 月
  const mgrOf = id => 'ABCDE'.includes(id) ? 'mgrX' : 'mgrY';
  for (const [id, leads, margin] of NUKE) {
    await mkSp(ctxN, id, { managerId: mgrOf(id) });
    await mkLeads(ctxN, `laN_${id}`, id, CUR, leads);
    await mkDeal(ctxN, `dN_${id}`, id, '2026-07-05', margin * 2, 0.5);       // margin = pay × 0.5
  }
  const r = await runM21(db, ctxN, { month: CUR });
  ok(r.done && r.n === 10, `runM21 n=10（主管不入归一人口）`);
  ok(near(r.imbalanceRate, 0.7), `失衡率 70%（T4 同源；实际 ${r.imbalanceRate}）`);

  const dbRows = await q(`select sp_id, leads, lead_index::float8 as li, norm_margin::float8 as nm,
                                 orig_rank, norm_rank, computed_at
                            from m21_norms where tenant_id = $1 and month = $2 order by sp_id`, [tN, CUR]);
  ok(dbRows.length === 10 && dbRows.every(x => x.computed_at != null), 'm21_norms 落表 10 行且带 computed_at');
  const allMatch = dbRows.every(x => {
    const d = dRow(x.sp_id);
    return x.leads === d.leads && near(Number(x.li), d.index) && near(Number(x.nm), d.normMargin, 1e-3)
      && x.orig_rank === d.origRank && x.norm_rank === d.normRank;
  });
  ok(allMatch, '🔴 逐人 lead_index/norm_margin/orig_rank/norm_rank 与 C1 引擎 m21Normalize 逐格一致');
  const J = dbRows.find(x => x.sp_id === 'J'), A = dbRows.find(x => x.sp_id === 'A');
  ok(J.norm_rank === 1 && J.orig_rank === 10, `rank(J)：原始 10 → 归一 1（T5 同源）`);
  ok(A.norm_rank === 8 && A.orig_rank === 1, `rank(A)：原始 1 → 归一 8（T6 同源）`);

  const [imb] = await q(`select value_num::float8 as v, computed_at from derived_scalars
                          where tenant_id = $1 and key = 'imbalanceRate' and period = $2`, [tN, CUR]);
  ok(imb && near(Number(imb.v), 0.7) && imb.computed_at != null,
    `derived_scalars.imbalanceRate=0.7 带 computed_at（公约 A-21）`);
  const [rb] = await q(`select value_json from derived_scalars
                         where tenant_id = $1 and key = 'redrawBand' and period = $2`, [tN, CUR]);
  const rbj = typeof rb.value_json === 'string' ? JSON.parse(rb.value_json) : rb.value_json;
  ok(near(rbj.band[0], NUKE_DOMAIN.redrawBand[0], 1e-3) && near(rbj.band[1], NUKE_DOMAIN.redrawBand[1], 1e-3),
    `redrawBand=[总毛利×2%, ×7%] 与引擎一致（实际 ${JSON.stringify(rbj.band)}）`);
}

/* ================= ③ M11：归一化增益手算对照 + 任期闸 + 换帅原始口径 ================= */
console.log('— ③ M11 主管增益：归一化手算对照 / 任期<3月→null / 换帅对比独立函数 —');
{
  const teamX = 'ABCDE'.split('').map(id => dRow(id).normMargin);
  const all10 = NUKE_DOMAIN.rows.map(r => r.normMargin);
  const expect = mean(teamX) / mean(all10);
  const mx = await managerLift(db, ctxN, { managerId: 'mgrX' });
  ok(near(mx.lift, expect, 1e-9) && mx.teamN === 5 && mx.companyN === 10,
    `mgrX 增益 = mean(A..E 归一)/mean(全司归一) = ${expect.toFixed(4)}（实际 ${mx.lift?.toFixed(4)}）`);
  ok(mx.tenureMonths >= 3, `mgrX 任期 ${mx.tenureMonths} 月 ≥ 3`);
  const mz = await managerLift(db, ctxN, { managerId: 'mgrZ' });
  ok(mz.lift === null && mz.reason === 'tenure_lt_3m' && mz.tenureMonths < 3,
    `mgrZ 任期 ${mz.tenureMonths} 月 < 3 → lift=null（不硬造）`);

  /* 换帅对比（唯一允许原始口径处）：T1 换帅 2026-05-01 → 后窗 73 天 ≥60 出数；T2 23 天 → 积累中 */
  await put(db, ctxN, 'manager_change_events',
    { id: 'mc1', team_id: 'T1', new_manager_id: 'mgrX', change_date: '2026-05-01' }, 'manager_changed');
  await put(db, ctxN, 'manager_change_events',
    { id: 'mc2', team_id: 'T2', new_manager_id: 'mgrY', change_date: '2026-06-20' }, 'manager_changed');
  const h1 = await rawCompareForHandover(db, ctxN, { teamId: 'T1' });
  const expAfter = (24e6 + 20e6 + 19e6 + 16e6 + 15e6) / 5;    // A..E 七月回款（原始）÷5
  ok(h1.status === 'ok' && near(h1.beforePerCapitaAmt, 0) && near(h1.afterPerCapitaAmt, expAfter),
    `T1 换帅对比：前 0 / 后人均 ${expAfter}（实际 ${h1.beforePerCapitaAmt}/${h1.afterPerCapitaAmt}）`);
  const h2 = await rawCompareForHandover(db, ctxN, { teamId: 'T2' });
  ok(h2.status === 'accumulating' && h2.afterDays < 60, `T2 后窗 ${h2.afterDays} 天 < 60 → 积累中（不出对比数）`);
}

/* ================= ④ UER：<48→null 不硬造；≥48→残差落表 + 归因三分支 ================= */
console.log('— ④ UER：minObs 门槛 / 残差落表 / attribution 三分支 —');
{
  /* tL 已验 <48 → gate:false；对应 uerTeamMean 落 null（不硬造） */
  const [tm] = await q(`select value_num, value_json from derived_scalars
                         where tenant_id = $1 and key = 'uerTeamMean' and period = $2`, [tL, CUR]);
  const tmj = typeof tm.value_json === 'string' ? JSON.parse(tm.value_json) : tm.value_json;
  ok(tm.value_num === null && tmj.gate === false && tmj.reason === 'minObs',
    '<48 观测：uerTeamMean 落 value_num=null + {gate:false, reason:minObs}（🔴 不硬造 0）');

  /* tU：8 人 × 7 月 = 56 观测 ≥ 48 */
  await mkCat(ctxU, 'cat0', 0.4);
  for (let i = 1; i <= 8; i++) await mkSp(ctxU, `u${i}`, { baseAmt: 2500000 + i * 120000 });
  for (let i = 1; i <= 8; i++) {
    for (let m = 1; m <= 7; m++) {
      const mm = `2026-0${m}`;
      const leads = (i === 8 && m === 7) ? 5 : 40 + 3 * i + 2 * m + ((i * m) % 5);
      await mkLeads(ctxU, `laU_${i}_${m}`, `u${i}`, mm, leads);
      const dc = ((i + m) % 3 === 0) ? 2 : 1;
      const totalPay = (900 + 40 * i + 25 * m + 7 * ((i * m) % 11)) * 1e4;
      const rate = 0.30 + 0.02 * ((i + m) % 4);
      if (dc === 1) await mkDeal(ctxU, `dU_${i}_${m}a`, `u${i}`, `${mm}-10`, totalPay, rate);
      else {
        await mkDeal(ctxU, `dU_${i}_${m}a`, `u${i}`, `${mm}-08`, Math.round(totalPay * 0.6), rate);
        await mkDeal(ctxU, `dU_${i}_${m}b`, `u${i}`, `${mm}-20`, totalPay - Math.round(totalPay * 0.6), rate);
      }
    }
  }
  await runM21(db, ctxU, { month: CUR });
  const u = await runUER(db, ctxU);
  ok(u.gate === true && u.n === 56, `56 观测 ≥ 48 → gate:true（实际 n=${u.n}）`);
  const uerRows = await q(`select target_id, period, value_num::float8 as v, value_json, computed_at
                             from derived_scalars where tenant_id = $1 and scope = 'person' and key = 'uer'`, [tU]);
  ok(uerRows.length === 56 && uerRows.every(x => x.computed_at != null), `残差落表 56 行（scope=person, key=uer）带 computed_at`);
  const sample = uerRows.find(x => x.target_id === 'u3' && x.period === '2026-04');
  const sj = typeof sample.value_json === 'string' ? JSON.parse(sample.value_json) : sample.value_json;
  ok(near(Number(sample.v), sj.actual - sj.pred, 1e-6) && ['green', 'red', 'gray'].includes(sj.band),
    `残差 = actual − pred 且 band ∈ {green,red,gray}（实际 ${sj.band}）`);
  const residSum = uerRows.reduce((a, x) => a + Number(x.v), 0);
  ok(Math.abs(residSum) < 1, `OLS 带截距 → Σ残差 ≈ 0（实际 ${residSum.toExponential(2)}）`);
  const [tmU] = await q(`select value_num::float8 as v, value_json from derived_scalars
                          where tenant_id = $1 and key = 'uerTeamMean' and period = $2`, [tU, CUR]);
  const tmUj = typeof tmU.value_json === 'string' ? JSON.parse(tmU.value_json) : tmU.value_json;
  ok(tmU != null && tmUj.gate === true && tmUj.n === 56, `uerTeamMean 落表（gate:true, n=56）`);
  const pu = await personUER(db, ctxU, 'u1');
  ok(pu.uer != null && pu.period != null, `personUER 读侧可得（u1 最新期 ${pu.period}）`);

  /* 归因三分支（3.3b 动态判定，S-D16 结论不硬编码；证据窗口近 12 月） */
  await put(db, ctxU, 'discount_entries', { id: 'deU1', discount_date: '2026-06-15', employee_id: 'u1',
    category_id: 'cat0', list_price_amt: 100e6, actual_price_amt: 89e6, discount_amt: 11e6,
    reason: 'period_end_push' }, 'discount_entry_created');
  await put(db, ctxU, 'discount_entries', { id: 'deU2', discount_date: '2026-06-16', employee_id: 'u2',
    category_id: 'cat0', list_price_amt: 100e6, actual_price_amt: 99e6, discount_amt: 1e6,
    reason: 'volume_deal' }, 'discount_entry_created');
  const a1 = await attribution(db, ctxU, { spId: 'u1' });
  ok(a1.verdict === 'leak', `u1 折扣 11% > 团队 6%×1.5 → verdict='leak'（实际 ${a1.verdict}）`);
  const a8 = await attribution(db, ctxU, { spId: 'u8' });
  ok(a8.verdict === 'territory' && a8.explanations.territory.leadIndex < 0.9,
    `u8 线索指数 ${a8.explanations.territory.leadIndex?.toFixed(2)} < 0.90 → verdict='territory'`);
  const a2 = await attribution(db, ctxU, { spId: 'u2' });
  ok(a2.verdict === 'undetermined', `u2 三查无异常 → verdict='undetermined'（不下结论，推 M31；实际 ${a2.verdict}）`);
  for (const a of [a1, a8, a2]) {
    ok(!!(a.explanations && a.explanations.hoarding && a.explanations.leak && a.explanations.territory),
      `🔴 三种解释强制全展示（S-03/S-05）：hoarding/leak/territory 恒齐全（${a.spId}）`);
  }
}

/* ================= ⑤ 止血双校验三分支（v5.1 V-06） ================= */
console.log('— ⑤ 止血分诊：starved 拦截 / invisible_work / proceed —');
{
  for (const [id, leads] of [['s1', 10], ['s2', 100], ['s3', 100]]) {
    await mkSp(ctxS, id);
    await mkLeads(ctxS, `laS_${id}`, id, CUR, leads);
  }
  await mkSp(ctxS, 's4');                              // 近期有成交 → 非候选
  await mkLeads(ctxS, 'laS_s4', 's4', CUR, 100);
  await mkCat(ctxS, 'cat0', 0.5);
  await mkDeal(ctxS, 'dS4', 's4', '2026-07-08', 1000000, 0.5);
  await runM21(db, ctxS, { month: CUR });
  /* UER 证据（从 derived_scalars 读，🔴 不现算）：s2 > 0 → invisible_work；s3 < 0 */
  for (const [sp, v] of [['s2', 500000], ['s3', -500000]]) {
    await upsert(db, ctxS, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
      { scope: 'person', target_id: sp, key: 'uer', period: PREV, value_num: v, value_json: { band: v > 0 ? 'green' : 'red' } },
      'derived_scalar_written', { touch: ['computed_at'] });
  }
  const sbd = await stopBleed(db, ctxS);
  const by = Object.fromEntries(sbd.candidates.map(c => [c.spId, c]));
  ok(sbd.candidates.length === 3 && !by.s4, `候选=3（s4 近 5 天有成交 → 不进候选；实际 ${sbd.candidates.length}）`);
  ok(by.s1 && by.s1.verdict === 'starved' && by.s1.block === true && by.s1.leadIndex < 0.7,
    `s1 线索指数 ${by.s1?.leadIndex?.toFixed(2)} < 0.7 → 校验① starved 🔴拦截（S-13）`);
  ok(by.s2 && by.s2.verdict === 'invisible_work' && by.s2.block === false && by.s2.uer > 0,
    `s2 UER=+${by.s2?.uer} > 0（derived_scalars 读侧）→ 校验② invisible_work 提示`);
  ok(by.s3 && by.s3.verdict === 'proceed' && by.s3.block === false,
    `s3 双校验都不中 → proceed（实际 ${by.s3?.verdict}）`);
  ok(by.s1.zeroEventDays >= 30 && by.s2.zeroEventDays >= 30, `零事件天数 ≥ 30（stopBleedDays）`);

  /* 回本 + 扩编沙盒（M18 其余两件） */
  const pb = await paybackBoard(db, ctxS);
  ok(pb.rows.length === 4 && pb.team.progress != null && near(pb.team.progress, pb.team.cumMarginAmt / pb.team.cumLaborAmt),
    `paybackBoard：团队回本 = Σ毛利/Σ人力（m2 口径；实际 ${pb.team.progress?.toFixed(4)}）`);
  const s4row = pb.rows.find(r => r.spId === 's4');
  ok(near(s4row.cumMarginAmt, 500000), `s4 累计毛利 = round(1000000×0.5)（实际 ${s4row.cumMarginAmt}）`);
  const es0 = (await q(`select count(*)::int as n from event_stream where tenant_id = $1`, [tS]))[0].n;
  const ex = await expandSandbox(db, ctxS, {
    inputs: { targetYearGrossAmt: 1800e6, perCapitaActualAmt: 100e6, cycleTier: 'short',
      attritionRate: 0.30, hiringCycleDays: 45, fullLoadCostAmt: 60e6 },
    targetYear: 2026,
  });
  ok(ex.sandbox === true && ex.salesCount === 4 && ex.result.trueHires != null && ex.result.threeYearHeads != null,
    `expandSandbox：只读沙盒调 domain.capacityChain（salesCount 派生=4，trueHires=${ex.result.trueHires}）`);
  const es1 = (await q(`select count(*)::int as n from event_stream where tenant_id = $1`, [tS]))[0].n;
  ok(es1 === es0, '🔴 expandSandbox 不落库：event_stream 零增量（S-D9）');
}

/* ================= ⑥ 品类熔断 + 杠杆链五因子 ================= */
console.log('— ⑥ M19：品类熔断 <22%∧>20% / leverageDrill 五因子手算对照 —');
{
  await mkCat(ctxC, 'c1', 0.21); await mkCat(ctxC, 'c2', 0.21); await mkCat(ctxC, 'c3', 0.30);
  await mkSp(ctxC, 'r1', { baseAmt: 3000000 }); await mkSp(ctxC, 'r2', { baseAmt: 3000000 });
  await mkDeal(ctxC, 'dC1', 'r1', '2026-07-03', 25e6, 0.21, 'c1');   // 占比 25% ∧ 毛利率 21% → 熔断
  await mkDeal(ctxC, 'dC2', 'r1', '2026-07-04', 15e6, 0.21, 'c2');   // 占比 15% ≤ 20% → 不熔断
  await mkDeal(ctxC, 'dC3', 'r2', '2026-07-05', 60e6, 0.30, 'c3');   // 毛利率 30% ≥ 22% → 不熔断
  const radar = await categoryRadar(db, ctxC);
  const byCat = Object.fromEntries(radar.items.map(i => [i.categoryId, i]));
  ok(radar.items.length === 3 && near(radar.totalPayAmt, 100e6), `雷达 3 品类，总回款 1 亿分`);
  ok(byCat.c1.fused === true && near(byCat.c1.payShare, 0.25) && near(byCat.c1.marginRate, 0.21),
    `c1：21% < 22% ∧ 25% > 20% → 🔴 熔断（闸⑨）`);
  ok(byCat.c2.fused === false, `c2：占比 15% 未过 20% → 不熔断（∧ 关系，非任一）`);
  ok(byCat.c3.fused === false, `c3：毛利率 30% → 不熔断`);
  ok(radar.anyFused === true, 'anyFused=true');

  await mkLeads(ctxC, 'laC1', 'r1', CUR, 120); await mkLeads(ctxC, 'laC2', 'r2', CUR, 80);
  const ld = await leverageDrill(db, ctxC, { month: CUR });
  const margin = Math.round(25e6 * 0.21) + Math.round(15e6 * 0.21) + Math.round(60e6 * 0.30);
  const labor = 2 * (3000000 + Math.round(3000000 * 0.3));           // 底薪+社保（无提成无 payout）
  ok(ld.factors.leads === 200 && near(ld.factors.convRate, 3 / 200) && near(ld.factors.aov, 100e6 / 3)
    && near(ld.factors.marginRate, margin / 100e6) && ld.factors.laborCostAmt === labor,
    `五因子：200 / ${(3 / 200).toFixed(4)} / ${(100e6 / 3).toFixed(0)} / ${(margin / 100e6).toFixed(4)} / ${labor}`);
  ok(near(ld.estimatedNetContributionAmt, margin - labor, 1),
    `杠杆链估算净贡献 = 毛利−laborCost = ${margin - labor}（公约 4.4 咬合；实际 ${ld.estimatedNetContributionAmt?.toFixed(0)}）`);
  /* safeDiv 兜底：无线索月 → 转化率 null（"—"），不炸 */
  const ld0 = await leverageDrill(db, ctxC, { month: '2026-05' });
  ok(ld0.factors.convRate === null && ld0.factors.aov === null && ld0.factors.marginRate === null,
    `空月五因子：safeDiv 兜底全 null（不造 0/NaN）`);
}

/* ================= ⑦ dayRoll：派生落表带 computed_at + 同日重跑幂等 ================= */
console.log('— ⑦ dayRoll：M21(上月+当月)→UER→派生标量→day_rolled；UPSERT 幂等 —');
{
  const r1 = await dayRoll(db, ctxN);
  ok(r1.months[0] === PREV && r1.months[1] === CUR && r1.m21.prev.n === 10 && r1.m21.cur.n === 10,
    `dayRoll 顺序：runM21(${PREV}) + runM21(${CUR})`);
  ok(r1.uer.gate === false && r1.uer.reason === 'minObs', `UER 观测不足 → gate:false（日切不炸）`);
  const expP90 = realP90Factor(NUKE_DOMAIN.rows.map(r => r.normMargin));
  ok(near(r1.realP90Factor, expP90, 1e-9),
    `realP90Factor = P90(归一化人均)/mean = ${expP90.toFixed(4)}（与 C1 引擎一致；实际 ${r1.realP90Factor?.toFixed(4)}）`);
  const scal = await q(`select key, period, value_num::float8 as v, computed_at from derived_scalars
                         where tenant_id = $1 and scope = 'tenant' order by key, period`, [tN]);
  ok(scal.every(x => x.computed_at != null), `全部租户级派生标量带 computed_at（公约 A-21 / v5.1 §2.3）`);
  const keys = new Set(scal.map(x => `${x.key}|${x.period}`));
  ok(['imbalanceRate|' + PREV, 'imbalanceRate|' + CUR, 'redrawBand|' + CUR,
    'realP90Factor|' + CUR, 'dvi|' + CUR, 'uerTeamMean|' + CUR].every(k => keys.has(k)),
    `imbalanceRate(两月)/redrawBand/realP90Factor/dvi/uerTeamMean 全部落表`);
  const [dviRow] = await q(`select value_num::float8 as v from derived_scalars
                             where tenant_id = $1 and key = 'dvi' and period = $2`, [tN, CUR]);
  ok(dviRow.v != null, `dvi 落表非 null（当月成交 10 笔 ≥ dviMinDeals）`);

  /* 同日重跑：行数不变、computed_at 刷新、值不变（幂等） */
  const cnt = async t => ({
    ds: (await q(`select count(*)::int as n from derived_scalars where tenant_id = $1`, [t]))[0].n,
    m21: (await q(`select count(*)::int as n from m21_norms where tenant_id = $1`, [t]))[0].n,
  });
  const before = await cnt(tN);
  const [p90a] = await q(`select value_num::float8 as v, computed_at from derived_scalars
                           where tenant_id = $1 and key = 'realP90Factor' and period = $2`, [tN, CUR]);
  const r2 = await dayRoll(db, ctxN);
  const after = await cnt(tN);
  ok(after.ds === before.ds && after.m21 === before.m21,
    `🔴 同日重跑幂等：derived_scalars ${before.ds}→${after.ds}、m21_norms ${before.m21}→${after.m21} 行数不变`);
  const [p90b] = await q(`select value_num::float8 as v, computed_at from derived_scalars
                           where tenant_id = $1 and key = 'realP90Factor' and period = $2`, [tN, CUR]);
  ok(near(Number(p90b.v), Number(p90a.v), 1e-12) && new Date(p90b.computed_at) >= new Date(p90a.computed_at),
    `重跑 = 覆盖值 + computed_at 刷新（asOf=计算日）`);
  ok(near(r2.realP90Factor, r1.realP90Factor, 1e-12), '重跑返回值一致');

  /* 数据变更后重跑 = 覆盖新值（UPSERT 覆盖式，非追加） */
  await mkDeal(ctxN, 'dN_A2', 'A', '2026-07-09', 6e6, 0.5);          // A 毛利 12e6 → 15e6
  const r3 = await dayRoll(db, ctxN);
  const after3 = await cnt(tN);
  const [aRow] = await q(`select norm_margin::float8 as nm from m21_norms
                           where tenant_id = $1 and sp_id = 'A' and month = $2`, [tN, CUR]);
  const NUKE2 = NUKE.map(([id, l, m]) => ({ id, name: id, leads: l, grossMarginAmt: id === 'A' ? m + 3e6 : m, selfDevLeads: 0 }));
  const D2 = m21Normalize(NUKE2);
  ok(after3.ds === before.ds && after3.m21 === before.m21, `加一笔成交重跑：行数仍不变（覆盖非追加）`);
  ok(near(Number(aRow.nm), D2.rows.find(r => r.id === 'A').normMargin, 1e-3) && !near(r3.realP90Factor, r1.realP90Factor, 1e-9),
    `A 的 norm_margin 覆盖为新值且与引擎重算一致（${Number(aRow.nm).toFixed(0)}）`);
}

/* ================= ⑧ 事件双写抽查 ================= */
console.log('— ⑧ 事件双写抽查 —');
{
  ok(await esType(tN, 'day_rolled') === 3, `event_stream[day_rolled] = 3（tN 三次日切）`);
  ok(await esType(tN, 'm21_ran') === 7, `event_stream[m21_ran] = 7（显式 1 + 3×日切×2月）`);
  ok(await esType(tN, 'uer_ran') === 3, `event_stream[uer_ran] = 3`);
  ok(await esType(tU, 'uer_ran') === 1 && await esType(tU, 'm21_ran') === 1, `tU：m21_ran/uer_ran 各 1`);
  const nNorm = await esType(tN, 'm21_norm_written');
  ok(nNorm === 70, `event_stream[m21_norm_written] = 70（10 行 × 7 次 runM21；实际 ${nNorm}）`);
  const nDs = await esType(tN, 'derived_scalar_written');
  const dsRows = (await q(`select count(*)::int as n from derived_scalars where tenant_id = $1`, [tN]))[0].n;
  ok(nDs >= dsRows, `derived_scalar_written(${nDs}) ≥ 落表行数(${dsRows})——每次 UPSERT 均双写`);
  const [ev] = await q(`select payload from event_stream where tenant_id = $1 and type = 'day_rolled'
                         order by event_id desc limit 1`, [tN]);
  const pj = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;
  ok(pj.today === TEST_TODAY && Array.isArray(pj.months) && pj.months.length === 2,
    `day_rolled payload 含 today/months（${pj.today}/${pj.months}）`);
}

await db.close();

/* ================= ⑨ 回归：C2–C5 不受影响 ================= */
console.log('— ⑨ 回归：spawnSync 跑 c2-model / c3 / c4 / c5 —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs', 'c4.test.mjs', 'c5.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: 300000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C6 真相层验收全部通过');
process.exit(failures ? 1 : 0);
