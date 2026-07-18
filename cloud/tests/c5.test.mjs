#!/usr/bin/env node
/* C5 定价器接入验收（v5.1 §12 C5 行：M7/§7）：
   ① computePlan 对拍：1号件七 T-B4 咬合输入（1800万/100万/10人/短期/30%/45天，
      TEST_TODAY=2026-07-13 / targetYear=2026）→ S6=20 / S1=8 / 高估率60.0% / 最晚开招2025-11-17
      （与 C1 dingjia.test 同值 = 服务层组装不改口径）；salesCount/managerCount 派生覆盖断言
   ② p90 联动：external_refs 无算账器包 → p90Eff=1.8；写入 derived.realP90Factor=1.44 → 富国闸用 1.44
   ③ 信用书：签发 → 编号 SK-YYMMDD-XXXX（字符集断言）→ covenant_docs UPDATE/DELETE 被拒
      → 改场景重算后 snapshot 不变（快照锁定 D-06）
   ④ 季度校准三态：传感器全非红 → proposeAnchor 不出卡；构造市价偏离/四灯红/守护线红
      → 出 salary_review 草案卡（pending）且 comp_plan_versions 行数不变（🔴 不直接生效）；
      confirmAnchor → 新版本+1、旧期提成不追溯（m2.commissionFor 历史月对照）、action_card→done
   ⑤ menu_choices 落库 + 禁改（irrevocable）
   ⑥ 事件双写抽查（逐类型对账）
   ⑦ 回归：spawnSync c2-model / c3 / c4
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13，服务层零 new Date() */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMenu } from '../domain/dingjia.mjs';
import { put, patch } from '../server/writes.mjs';
import { planVersionAt, commissionFor } from '../server/m2.mjs';
import {
  computePlan, saveScenario, adoptPlan, issueCovenantDoc, registerMenuChoice,
  COVENANT_CODE_CHARSET,
} from '../server/m7.mjs';
import { sensors, proposeAnchor, confirmAnchor, MARKET_DEV_RED } from '../server/calibrate.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) < eps;
const pct1 = v => (v * 100).toFixed(1);
const pct2 = v => (v * 100).toFixed(2);
const W = n => n * 1e6;                          // 万元 → 分

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11：与五板块对拍同一基准日

/* 1号件七 T-B4 咬合输入：1800万/100万/10人/短期/30%/45天（targetYear=2026 → mode 'this'） */
const INPUTS_B4 = {
  cityTier: 'tier1', cycleTier: 'short', tierGrade: 'effective',
  targetPersonalMonthlyGrossAmt: W(9), nextYearTargetGrossAmt: W(1800), lastYearPerCapitaGrossAmt: W(100),
  salesCount: 10, managerCount: 1, attritionRate: 0.30, hiringCycleDays: 45, blendedMarginRate: 0.30,
  complementLevel: 'partial', attributableLevel: 'partial',
};
const R_B4 = 1950000 / 9000000;                  // tier1/short/effective：(2700000−750000)/9000000

/* ================= ⓪ 静态断言：C5 服务层零 new Date() ================= */
console.log('— ⓪ 静态断言：C5 服务层零 new Date()（公约 C-14 时钟注入） —');
{
  const clockHits = ['server/m7.mjs', 'server/calibrate.mjs', 'server/writes.mjs']
    .filter(f => /new Date\(/.test(readFileSync(join(root, f), 'utf8')));
  ok(clockHits.length === 0, 'm7/calibrate/writes 零 new Date()（业务日期一律 ctx.today）', clockHits.join(','));
}

/* ================= 环境：PGlite + schema 四段执行 ================= */
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
await db.exec(readFileSync(join(root, 'db', 'schema-c4.sql'), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;
  revoke update, delete on comp_plan_versions from app_user;`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const U = { boss: 'a0000000-0000-4000-8000-00000000000a' };
const mkTenant = async name => (await q(`insert into tenants(name, created_by) values ($1, $2) returning id`, [name, U.boss]))[0].id;
const tP = await mkTenant('C5·定价器');     // ①②③⑤
const tQ = await mkTenant('C5·季度校准');   // ④
const ctxP = { tenantId: tP, actorId: U.boss, today: TEST_TODAY };
const ctxQ = { tenantId: tQ, actorId: U.boss, today: TEST_TODAY };
const es = async t => (await q(`select count(*)::int as n from event_stream where tenant_id = $1`, [t]))[0].n;
const esType = async (t, type) => (await q(`select count(*)::int as n from event_stream where tenant_id = $1 and type = $2`, [t, type]))[0].n;
const versionCount = async t => (await q(`select count(*)::int as n from comp_plan_versions where tenant_id = $1`, [t]))[0].n;
const cardCount = async t => (await q(`select count(*)::int as n from action_cards where tenant_id = $1`, [t]))[0].n;

/* ================= ① computePlan 对拍（T-B4 咬合）+ 人数派生 ================= */
console.log('— ① computePlan：T-B4 咬合对拍 + salesCount/managerCount 派生覆盖 —');
{
  // 库里 12 行：10 在职销售 + 1 在职主管 + 1 离职销售 → 派生 salesCount=10 / managerCount=1
  const mkSp = (id, level, active, ld = null) => put(db, ctxP, 'salespersons',
    { id, name: id, level, hire_date: '2025-01-01', leave_date: ld,
      leave_reason: ld ? 'resign_other' : null, is_active: active }, 'salesperson_created');
  for (let i = 1; i <= 10; i++) await mkSp(`sp${String(i).padStart(2, '0')}`, 'sales', true);
  await mkSp('spM1', 'manager', true);
  await mkSp('spL1', 'sales', false, '2026-03-01');
  ok((await q(`select count(*)::int as n from salespersons where tenant_id=$1`, [tP]))[0].n === 12, '种子 12 行人事档案');

  // inputs 里故意填错人数（3/99）→ 派生只读覆盖为 10/1
  const cp = await computePlan(db, ctxP,
    { inputs: { ...INPUTS_B4, salesCount: 3, managerCount: 99 }, targetYearMode: 'this' });
  ok(cp.inputs.salesCount === 10 && cp.inputs.managerCount === 1,
    `salesCount/managerCount 从 salespersons 派生覆盖 = 10/1（实际 ${cp.inputs.salesCount}/${cp.inputs.managerCount}）`);
  const B = cp.result.B;
  ok(B && B.ok === true, '账单B 可算');
  ok(pct1(B.k1) === '65.8', `k(1)=65.8%（咬合基准①；实际 ${pct1(B.k1)}）`);
  ok(pct2(B.kEff1) === '55.96', `kEff(1)=55.96%（实际 ${pct2(B.kEff1)}）`);
  ok(B.S1 === 8, `S1=8（实际 ${B.S1}）`);
  ok(B.S6 === 20, `S6=20（实际 ${B.S6}）`);
  ok(pct1(B.overRate) === '60.0', `高估率 60.0%（实际 ${pct1(B.overRate)}）`);
  ok(B.latestHireDate === '2025-11-17', `最晚开招 2025-11-17（实际 ${B.latestHireDate}）`);
  ok(B.isLate === true && B.lateDays === 238, `已晚 238 天（实际 ${B.isLate}/${B.lateDays}）`);
  ok(cp.result.targetYear === 2026, `targetYearMode='this' → targetYear=2026（实际 ${cp.result.targetYear}）`);
  ok(!!(cp.result.A && cp.result.B && cp.result.C && cp.result.D && cp.result.E && cp.result.total && cp.result.fraud),
    '五账单（A/B/C/D/E+合计）+ 闸（fraud）全部返回');
  ok(cp.result.A.sales.B === 750000 && cp.result.A.sales.T === 3000000 && near(cp.result.A.sales.r, R_B4),
    `销售层 B/T/r = 750000/3000000/${R_B4.toFixed(6)}（实际 ${cp.result.A.sales.B}/${cp.result.A.sales.T}/${cp.result.A.sales.r}）`);
  ok(await versionCount(tP) === 0, 'computePlan 纯沙盒：不落库（comp_plan_versions=0）');
}

/* ================= ② p90 联动：信封缺 → 1.8；realP90Factor=1.44 → 富国闸用 1.44 ================= */
console.log('— ② p90 联动：external_refs(suanzhang).derived.realP90Factor —');
{
  const cp0 = await computePlan(db, ctxP, { inputs: INPUTS_B4, targetYearMode: 'this' });
  ok(cp0.p90Real === null && cp0.result.fraud.p90Eff === 1.8,
    `无算账器包 → p90Eff 回退 1.8（实际 ${cp0.result.fraud.p90Eff}）`);
  await put(db, ctxP, 'external_refs',
    { board: 'suanzhang', exported_at: TEST_TODAY, derived: { realP90Factor: 1.44 }, entities: {} },
    'external_ref_imported');
  const cp1 = await computePlan(db, ctxP, { inputs: INPUTS_B4, targetYearMode: 'this' });
  ok(cp1.p90Real === 1.44 && cp1.result.fraud.p90Eff === 1.44,
    `写入 realP90Factor=1.44 → 富国闸 p90Eff=1.44（实际 ${cp1.result.fraud.p90Eff}）`);
}

/* ================= ③ 信用书：编号 / 快照锁定 / 禁改 ================= */
console.log('— ③ 信用书：SK 编号 + 快照签发固化 + covenant_docs 禁改 —');
{
  const e0 = await es(tP);
  await saveScenario(db, ctxP, { id: 'scn1', name: '方案一', inputs: INPUTS_B4, targetYearMode: 'this' });
  ok(await es(tP) === e0 + 1, '⑥ 场景保存事件 +1（comp_plan_scenario_saved）');

  const cov = await issueCovenantDoc(db, ctxP, { id: 'cov1', candidateName: '李候选', scenarioId: 'scn1' });
  ok(/^SK-260713-.{4}$/.test(cov.code), `编号格式 SK-YYMMDD-XXXX 且 YYMMDD=ctx.today（实际 ${cov.code}）`);
  ok([...cov.code.slice(-4)].every(c => COVENANT_CODE_CHARSET.includes(c)),
    `后 4 位 ∈ 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'（实际 ${cov.code.slice(-4)}）`);
  ok(cov.snapshot.levelType === 'sales' && cov.snapshot.tierGrade === 'effective'
    && cov.snapshot.baseSalaryAmt === 750000 && cov.snapshot.thresholdTAmt === 3000000
    && near(cov.snapshot.commissionRate, R_B4),
    `snapshot 从场景实算固化 B/T/r（实际 ${JSON.stringify(cov.snapshot)}）`);
  ok(await esType(tP, 'covenant_doc_issued') === 1, '⑥ 签发事件双写 =1');

  let err = null;
  try { await db.query(`update covenant_docs set candidate_name='改名' where tenant_id=$1 and id='cov1'`, [tP]); }
  catch (e) { err = e.message; }
  ok(err != null, `covenant_docs UPDATE 被拒（触发器禁改）：${err}`);
  err = null;
  try { await db.query(`delete from covenant_docs where tenant_id=$1 and id='cov1'`, [tP]); }
  catch (e) { err = e.message; }
  ok(err != null, `covenant_docs DELETE 被拒（触发器禁删）：${err}`);

  // 改场景（I4: 9万→10万 → r 变 0.195）重算后，已签发 snapshot 不变（D-06 快照锁定）
  await patch(db, ctxP, 'comp_plan_scenarios', 'id', 'scn1',
    { inputs: { ...INPUTS_B4, targetPersonalMonthlyGrossAmt: W(10), targetYearMode: 'this' } },
    'comp_plan_scenario_updated');
  const cp2 = await computePlan(db, ctxP,
    { inputs: { ...INPUTS_B4, targetPersonalMonthlyGrossAmt: W(10) }, targetYearMode: 'this' });
  ok(near(cp2.result.A.sales.r, 0.195), `改场景后重算 r=0.195（实际 ${cp2.result.A.sales.r}）`);
  const [row] = await q(`select snapshot from covenant_docs where tenant_id=$1 and id='cov1'`, [tP]);
  const snap = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot;
  ok(near(snap.commissionRate, R_B4) && snap.baseSalaryAmt === 750000,
    `改场景重算后库内 snapshot 不变（r 仍 ${R_B4.toFixed(6)}，实际 ${snap.commissionRate}）`);

  let nameErr = null;
  try { await issueCovenantDoc(db, ctxP, { candidateName: '这个名字明显超过了十个字上限', scenarioId: 'scn1' }); }
  catch (e) { nameErr = e.message; }
  ok(nameErr != null, `candidateName >10 字被拒：${nameErr}`);
}

/* ================= ⑤ menu_choices：落库 + irrevocable 禁改 ================= */
console.log('— ⑤ menu_choices：快照落库（domain.generateMenu 产物）+ 禁改 —');
{
  const menu = generateMenu(W(100), 3000000);        // 件七 T-F16-1 同一菜单
  const mc = await registerMenuChoice(db, ctxP,
    { id: 'mch1', salespersonName: '张三', menu, chosenTier: 'high' });
  ok(mc.irrevocable === true && mc.chosenDate === TEST_TODAY, 'irrevocable=true、登记日=ctx.today');
  const [row] = await q(`select salesperson_name, menu_snapshot, chosen_tier, chosen_date::text as cd, irrevocable
                           from menu_choices where tenant_id=$1 and id='mch1'`, [tP]);
  const ms = typeof row.menu_snapshot === 'string' ? JSON.parse(row.menu_snapshot) : row.menu_snapshot;
  ok(row.chosen_tier === 'high' && row.irrevocable === true && row.cd.slice(0, 10) === TEST_TODAY
    && ms.length === 3 && ms[2].quotaAmt === 120000000 && ms[2].bonusAmt === 4410000,
    `落库快照三档且冲刺档=120万/¥44,100（实际 ${JSON.stringify(ms[2])}）`);
  ok(await esType(tP, 'menu_choice_locked') === 1, '⑥ 登记事件双写 =1');

  let err = null;
  try { await db.query(`update menu_choices set chosen_tier='low' where tenant_id=$1 and id='mch1'`, [tP]); }
  catch (e) { err = e.message; }
  ok(err != null, `menu_choices UPDATE 被拒：${err}`);
  err = null;
  try { await db.query(`delete from menu_choices where tenant_id=$1 and id='mch1'`, [tP]); }
  catch (e) { err = e.message; }
  ok(err != null, `menu_choices DELETE 被拒：${err}`);
  err = null;
  try { await registerMenuChoice(db, ctxP, { salespersonName: '李四', menu, chosenTier: 'sprint' }); }
  catch (e) { err = e.message; }
  ok(err != null, `非法档位 'sprint' 被拒（E-11）：${err}`);
}

/* ================= ④ 季度校准三态 ================= */
console.log('— ④ 季度校准：三传感器 / 草案卡 / 老板二次确认不追溯 —');
{
  const ctxQ0 = { ...ctxQ, today: '2026-01-01' };    // v1 采纳日（时钟注入：过去日期直接换 ctx.today）
  const mkSp = (id, base, active = true, ld = null, lr = null) => put(db, ctxQ, 'salespersons',
    { id, name: id, level: 'sales', hire_date: ld ? '2025-01-01' : '2026-01-01',
      leave_date: ld, leave_reason: lr, base_salary_amt: base, is_active: active }, 'salesperson_created');
  await mkSp('gq1', 3200000); await mkSp('gq2', 3200000); await mkSp('gq3', 3200000);

  // v1：经 adoptPlan（🔴 生效唯一路径）——r≈0.2167、矩阵T=3000000，eff 2026-01-01
  await saveScenario(db, ctxQ0, { id: 'scq1', name: '基线方案', inputs: INPUTS_B4, targetYearMode: 'this' });
  const v1 = await adoptPlan(db, ctxQ0, { scenarioId: 'scq1', effectiveFrom: '2026-01-01' });
  ok(v1.version === 1 && near(v1.rRate, R_B4) && v1.matrixTAmt === 3000000,
    `v1 采纳：version=1 r=${R_B4.toFixed(6)} matrixT=3000000（实际 ${v1.version}/${v1.rRate}/${v1.matrixTAmt}）`);

  // 不追溯守卫：effectiveFrom < today 被拒且不落版本
  let err = null;
  try { await adoptPlan(db, ctxQ, { scenarioId: 'scq1', effectiveFrom: '2026-06-01' }); }
  catch (e) { err = e.message; }
  ok(err != null && err.includes('不追溯'), `adoptPlan 回溯生效被拒：${err}`);
  ok(await versionCount(tQ) === 1, '回溯被拒后版本数仍 =1');

  // 历史月成交：gq1 2026-06 回款 10万元×毛利50%×r(v1) → 提成 1083333 分
  await put(db, ctxQ, 'deals', { id: 'dq1', employee_id: 'gq1', deal_date: '2026-06-15', payment_amt: 10000000,
    category_id: 'catQ', margin_rate_snapshot: 0.5, status: 'won', paid_date: '2026-06-15' }, 'deal_created');

  // —— 三态一：全非红 →不出卡 ——（市价绿：5 样本 median=750000=矩阵B；四灯灰；守护线绿）
  const mkCand = (id, phone, amt, created) => put(db, ctxQ, 'candidates',
    { id, name: id, phone, position_name: '销售', expected_salary_amt: amt, source_channel: 'boss_zhipin',
      pool: 'resume', pool_entered_date: created, created_at: created }, 'candidate_created');
  for (let i = 1; i <= 5; i++) await mkCand(`cq${i}`, `1530000000${i}`, 750000, '2026-05-01');
  const s1 = await sensors(db, ctxQ, { positionName: '销售' });
  ok(s1.market.light === 'green' && near(s1.market.evidence.deviation, 0),
    `市价传感器：median=矩阵B(750000) → 绿（实际 ${s1.market.light}/dev=${s1.market.evidence.deviation}）`);
  ok(s1.fourLights.light === 'grey', `四灯：无样本 → 灰（实际 ${s1.fourLights.light}）`);
  ok(s1.guard.light === 'green' && s1.guard.evidence.count === 0
    && s1.guard.evidence.months.join(',') === '2026-05,2026-06',
    `守护线：3人月入3.2万≥T=3万 连续近2月（2026-05/06）→ 绿（实际 ${s1.guard.light}/${s1.guard.evidence.count}）`);
  const p1 = await proposeAnchor(db, ctxQ, { positionName: '销售' });
  ok(p1.created === false && await cardCount(tQ) === 0, '全非红 → proposeAnchor 不出卡');

  // —— 三态二：构造三红 → 出草案卡且不直接生效 ——
  for (let i = 6; i <= 10; i++) await mkCand(`cq${i}`, `1530000000${i}`, 1500000, '2026-06-01');   // 市价 median→1125000
  await mkSp('lq1', 800000, false, '2026-06-01', 'resign_salary');    // 挖角 1/3 ≥30% → 四灯红
  await mkSp('lq2', 800000, false, '2026-06-05', 'resign_other');
  await mkSp('lq3', 800000, false, '2026-06-10', 'probation_fail');
  await mkSp('gq4', 500000);                                          // 月入5000元 < T 连续2月 → 守护线红
  const s2 = await sensors(db, ctxQ, { positionName: '销售' });
  ok(s2.market.light === 'red' && near(s2.market.evidence.deviation, 0.5) && s2.market.evidence.deviation >= MARKET_DEV_RED,
    `市价偏离 +50% ≥20% → 红（实际 ${s2.market.light}/dev=${s2.market.evidence.deviation}）`);
  ok(s2.fourLights.light === 'red' && s2.fourLights.evidence.reds.includes('poachShare'),
    `四灯：挖角占比 1/3 → 红（实际 ${s2.fourLights.light}/${s2.fourLights.evidence.reds}）`);
  ok(s2.guard.light === 'red' && s2.guard.evidence.count === 1 && s2.guard.evidence.people[0].employeeId === 'gq4',
    `守护线：gq4 连续2月 totalIncome<T → 红（实际 ${s2.guard.light}/${s2.guard.evidence.count}）`);

  const e0 = await es(tQ), vc0 = await versionCount(tQ);
  const p2 = await proposeAnchor(db, ctxQ, { positionName: '销售' });
  ok(p2.created === true && p2.redSensors.length === 3, `三红 → 出草案卡 #${p2.cardId}（redSensors=${p2.redSensors}）`);
  const [card] = await q(`select kind, state, payload from action_cards where tenant_id=$1 and card_id=$2`, [tQ, p2.cardId]);
  const pl = typeof card.payload === 'string' ? JSON.parse(card.payload) : card.payload;
  ok(card.kind === 'salary_review' && card.state === 'pending', `卡 kind=salary_review / state=pending（实际 ${card.kind}/${card.state}）`);
  ok(pl.sensors && pl.sensors.market.light === 'red' && pl.suggestion && pl.suggestion.direction === 'raise_anchor',
    `payload 含传感器证据 + 建议方向 raise_anchor（实际 ${pl.suggestion && pl.suggestion.direction}）`);
  ok(await versionCount(tQ) === vc0, '🔴 proposeAnchor 只出草案：comp_plan_versions 行数不变');
  ok(await es(tQ) === e0 + 1, '⑥ 草案卡事件双写 +1（salary_review_card_created）');
  const p3 = await proposeAnchor(db, ctxQ, { positionName: '销售' });
  ok(p3.created === false && p3.existingCardId === p2.cardId && await cardCount(tQ) === 1,
    '已有 pending 草案卡 → 不重复插卡');

  // —— 三态三：老板二次确认 → 新版本+1、不追溯、卡 done ——
  const commBefore = await commissionFor(db, ctxQ, { employeeId: 'gq1', month: '2026-06' });
  ok(commBefore.planVersion === 1 && commBefore.commissionAmt === 1083333,
    `确认前 2026-06 提成 = round(10000000×0.5×${R_B4.toFixed(6)}) = 1083333（v1；实际 ${commBefore.commissionAmt}/v${commBefore.planVersion}）`);

  const e1 = await es(tQ);
  const newInputs = { ...INPUTS_B4, targetPersonalMonthlyGrossAmt: W(10) };   // 新锚：G 抬到 10万 → r=0.195
  const cf = await confirmAnchor(db, ctxQ,
    { cardId: p2.cardId, inputs: newInputs, effectiveFrom: '2026-08-01', targetYearMode: 'this' });
  ok(cf.version === 2 && near(cf.rRate, 0.195), `confirmAnchor → v2（r=0.195；实际 v${cf.version}/${cf.rRate}）`);
  ok(await versionCount(tQ) === vc0 + 1, 'comp_plan_versions +1（唯一生效路径 = adoptPlan）');
  const vAt = await planVersionAt(db, ctxQ, '2026-08-01');
  ok(vAt.version === 2 && near(Number(vAt.r_rate), 0.195), `planVersionAt(2026-08-01) → v2/r=0.195（实际 v${vAt.version}/${vAt.r_rate}）`);
  const commAfter = await commissionFor(db, ctxQ, { employeeId: 'gq1', month: '2026-06' });
  ok(commAfter.planVersion === 1 && commAfter.commissionAmt === commBefore.commissionAmt,
    `🔴 旧期提成不追溯：2026-06 仍 v1/${commBefore.commissionAmt}（实际 v${commAfter.planVersion}/${commAfter.commissionAmt}）`);
  const [card2] = await q(`select state, trail from action_cards where tenant_id=$1 and card_id=$2`, [tQ, p2.cardId]);
  const trail = typeof card2.trail === 'string' ? JSON.parse(card2.trail) : card2.trail;
  ok(card2.state === 'done' && trail.some(t => t.action === 'boss_confirmed' && t.version === 2),
    `action_card → done + trail 留痕 boss_confirmed/v2（实际 ${card2.state}/${JSON.stringify(trail)}）`);
  ok(await es(tQ) === e1 + 4, '⑥ 确认链事件 +4（scenario_saved + version_created + plan_adopted + card_done）');

  let err2 = null;
  try { await confirmAnchor(db, ctxQ, { cardId: p2.cardId, inputs: newInputs, effectiveFrom: '2026-09-01' }); }
  catch (e) { err2 = e.message; }
  ok(err2 != null && err2.includes('已确认'), `done 卡二次确认被拒：${err2}`);
}

/* ================= ⑥ 事件双写抽查（逐类型对账） ================= */
console.log('— ⑥ 事件双写抽查 —');
{
  for (const [t, type, want] of [
    [tP, 'comp_plan_scenario_saved', 1], [tP, 'covenant_doc_issued', 1], [tP, 'menu_choice_locked', 1],
    [tP, 'external_ref_imported', 1],
    [tQ, 'comp_plan_version_created', 2], [tQ, 'plan_adopted', 2],
    [tQ, 'salary_review_card_created', 1], [tQ, 'salary_review_card_done', 1],
  ]) {
    const n = await esType(t, type);
    ok(n === want, `event_stream[${type}] = ${want}（实际 ${n}）`);
  }
}

await db.close();

/* ================= ⑦ 回归：C2 / C3 / C4 不受影响 ================= */
console.log('— ⑦ 回归：spawnSync 跑 c2-model / c3 / c4 —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs', 'c4.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: 300000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C5 定价器接入验收全部通过');
process.exit(failures ? 1 : 0);
