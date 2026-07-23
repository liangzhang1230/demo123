#!/usr/bin/env node
/* C7 育人层验收（v5.1 §12 C7 行：M12/M14/M15/M40–M44）：
   ① 🔴 PLV 拦截保存：『你态度不端正，要拿出狼性』→ savePrescription 拒（prescriptions
      行数不变）+ 改写稿非空；合法句 → 落库；insist → 放行 + prescription_insisted 留痕事件
   ② 🔴 调用链断言（Y-D2 / A-07 云端机检）：m2.mjs（提成）与 m21.mjs（排名）源码
      grep 无 prescriptions/bounties 引用——处方悬赏永不进提成排名七级
   ③ 悬赏三态（D-1 / Y-D16 / T19）：record_break ∧ 未启 → 拒 + Y-13 + showEnable；
      silentTrackEnable 后 → 放行；first_deal 恒放行（豁免）；第 4 个活动悬赏 → 拒（≤3）
   ④ 配方源资格（闸④ / T1–T3）：归一第 8 名设源 → 拒（fails 含 rank）；第 1 名 ∧ uer≥0 → 过；
      未 runM21 → A11_LOCKED；闸③ 产权前提 no_m28/ahc_missing/ahc_low/放行 四态
   ⑤ 汰前三拦截（T11 / Y-D6）：三种缺失各一例 → 全拦截 + Y-11；三条件都满足 → 只生成
      action_card(kind='eliminate')、salespersons 状态零变化断言
   ⑥ M40（T13）：教练未签 M28 → 席位冻结；同对 >3 周强制轮换（4 周推演）
   ⑦ 抽检卡（Y-D7）：落库无结果字段（information_schema 列集断言）+ 同周重跑确定性一致
   ⑧ 事件双写抽查；⑨ 回归 spawnSync c2–c6
   附：M41 动量触发+动量期加压词拦截 / M42 轨迹匹配（真配 + "—"）/ M43 四区+子目标 /
   M44a 资历忽视 / 三张牌 / 带教任务 7 天不重复 + no_response 惰性自动确认 / 新人 7 天窗
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13，服务层零 new Date() */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { m21Normalize } from '../domain/suanzhang.mjs';
import { put, upsert } from '../server/writes.mjs';
import { runM21 } from '../server/m21.mjs';
import {
  setRecipeSource, propertyGateCheck, savePrescription, threeCards,
  createCoachTask, reportCoachTask, ackCoaching,
} from '../server/m12.mjs';
import { silentTrackEnable, silentTrackOn, saveBounty } from '../server/m13.mjs';
import { backlogBoard, genSpotChecks, effectiveScores } from '../server/m14.mjs';
import { newbieBoard, cullCheck } from '../server/m15.mjs';
import {
  runM40Pairing, momentumBoard, roleModelFor, paceBoard, m44aBoard,
} from '../server/m40plus.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const near = (a, b, eps = 1e-6) => a != null && b != null && Math.abs(a - b) < eps;
const isA11 = e => e != null && e.code === 'A11_LOCKED';

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11：与五板块对拍同一基准日
const CUR = '2026-07';

/* 3号 §3.2 核弹表（与 c6 同源）：10 人 / 月1000条 / 人均100（margin 单位：分） */
const NUKE = [['A', 180, 12.0e6], ['B', 120, 10.0e6], ['C', 120, 9.5e6], ['D', 100, 8.0e6], ['E', 100, 7.5e6],
  ['F', 100, 7.0e6], ['G', 85, 6.0e6], ['H', 85, 5.0e6], ['I', 80, 4.0e6], ['J', 30, 3.0e6]];
const NUKE_DOMAIN = m21Normalize(NUKE.map(p => ({ id: p[0], name: p[0], leads: p[1], grossMarginAmt: p[2], selfDevLeads: 0 })));
const rankOf = id => NUKE_DOMAIN.rows.find(r => r.id === id).normRank;

/* ================= ⓪ 静态断言 ================= */
console.log('— ⓪ 静态断言：C7 服务层零 new Date() + ② 调用链断言（Y-D2/A-07 云端机检） —');
{
  const clockHits = ['server/m12.mjs', 'server/m13.mjs', 'server/m14.mjs', 'server/m15.mjs', 'server/m40plus.mjs']
    .filter(f => /new Date\(/.test(readFileSync(join(root, f), 'utf8')));
  ok(clockHits.length === 0, 'C7 五个服务模块零 new Date()（业务日期一律 ctx.today）', clockHits.join(','));

  /* ② 🔴 调用链断言：提成(m2)与排名(m21)源码零 prescriptions/bounties 引用 */
  const m2src = readFileSync(join(root, 'server', 'm2.mjs'), 'utf8');
  const m21src = readFileSync(join(root, 'server', 'm21.mjs'), 'utf8');
  ok(!/prescription|bount/i.test(m2src), '🔴 m2.mjs（提成）grep 无 prescriptions/bounties（处方悬赏永不进提成）');
  ok(!/prescription|bount/i.test(m21src), '🔴 m21.mjs（排名唯一合法输入）grep 无 prescriptions/bounties（永不进排名七级）');

  /* Y-D6/A-C04：m15 零员工状态写路径（建议只出 eliminate 卡） */
  const m15src = readFileSync(join(root, 'server', 'm15.mjs'), 'utf8');
  ok(!/(update|insert into)\s+salespersons/i.test(m15src), 'm15.mjs 零 salespersons 写路径（A-C04：永不写员工状态）');
  ok(/kind='eliminate'|'eliminate'/.test(m15src), 'm15 建议载体 = action_card(kind=eliminate)');

  /* Y-D16 反向断言：无"结果类一律拦截"旧逻辑（三态动态判定在 domain.bountyGate） */
  const m13src = readFileSync(join(root, 'server', 'm13.mjs'), 'utf8');
  ok(/bountyGate/.test(m13src) && !/结果类一律拦截/.test(m13src), 'm13 走 domain.bountyGate 三态（无 D-1 已废除的旧逻辑）');
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

const tA = await mkTenant('C7·A11锁');
const tY = await mkTenant('C7·育人主租户');
const tB = await mkTenant('C7·悬赏三态');
const tM = await mkTenant('C7·榜样轨迹');
const ctx = t => ({ tenantId: t, actorId: U.boss, today: TEST_TODAY });
const ctxA = ctx(tA), ctxY = ctx(tY), ctxB = ctx(tB), ctxM = ctx(tM);

/* ---------- 种子工具（c6 同法） ---------- */
const mkSp = (c, id, opts = {}) => put(db, c, 'salespersons', {
  id, name: opts.name ?? id, level: opts.level ?? 'sales',
  hire_date: opts.hireDate ?? '2026-01-01', manager_id: opts.managerId ?? null,
  base_salary_amt: opts.baseAmt ?? 3000000, is_active: opts.isActive ?? true,
}, 'salesperson_created');
const mkLeads = (c, id, employeeId, month, assigned) => put(db, c, 'lead_assignments',
  { id, employee_id: employeeId, month, assigned_leads: assigned, self_dev_leads: 0 }, 'lead_assignment_created');
const mkCat = (c, id, rate) => put(db, c, 'categories', { id, name: id, gross_margin_rate: rate }, 'category_created');
const mkDeal = (c, id, employeeId, date, payAmt, opts = {}) => put(db, c, 'deals',
  { id, employee_id: employeeId, deal_date: date, payment_amt: payAmt, category_id: opts.catId ?? 'cat0',
    margin_rate_snapshot: opts.rate ?? 0.5, status: opts.status ?? 'won',
    paid_date: (opts.status ?? 'won') === 'won' ? (opts.paidDate ?? date) : null }, 'deal_created');
const mkRep = (c, employeeId, date, counts) => put(db, c, 'daily_reports',
  { id: `dr_${employeeId}_${date}`, employee_id: employeeId, report_date: date,
    leads: counts.leads ?? 0, intents: counts.intents ?? 0, samples: counts.samples ?? 0,
    contracts: counts.contracts ?? 0, submitted_at: date }, 'daily_report_submitted');
const mkDisc = (c, id, employeeId) => put(db, c, 'discount_entries',
  { id, discount_date: '2026-06-20', employee_id: employeeId, category_id: 'cat0',
    list_price_amt: 100e6, actual_price_amt: 95e6, discount_amt: 5e6, reason: 'volume_deal' }, 'discount_entry_created');
const mkUer = (c, spId, v) => upsert(db, c, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
  { scope: 'person', target_id: spId, key: 'uer', period: CUR, value_num: v, value_json: { band: v >= 0 ? 'green' : 'red' } },
  'derived_scalar_written', { touch: ['computed_at'] });
const mkAck = (c, id, employeeId, opts = {}) => put(db, c, 'coaching_acks',
  { id, manager_id: opts.managerId ?? 'B', employee_id: employeeId,
    employee_ack_status: opts.status ?? 'confirmed', duration_min: opts.durationMin ?? 120,
    manager_reported_at: opts.reportedAt ?? '2026-07-01' }, 'coaching_ack_created');
const mkPractice = async (c, employeeId, n) => {
  for (let i = 0; i < n; i++)
    await put(db, c, 'practice_logs', { id: `pl_${employeeId}_${i}`, employee_id: employeeId,
      practice_date: `2026-01-${String((i % 14) + 1).padStart(2, '0')}`,
      scenario: 'opening', reviewer: 'self' }, 'practice_log_created');
};

/* ---------- tY 种子：核弹表 10 人 → runM21（🔴 先归一后加人，排名基线与 c6 同源） ---------- */
await mkCat(ctxY, 'cat0', 0.5);
for (const [id, leads, margin] of NUKE) {
  await mkSp(ctxY, id);
  await mkLeads(ctxY, `la_${id}`, id, CUR, leads);
  await mkDeal(ctxY, `d_${id}`, id, '2026-07-05', margin * 2);      // margin = pay × 0.5
  await mkDisc(ctxY, `disc_${id}`, id);                             // 折扣泄漏全员同率（≤均值）
}
await runM21(db, ctxY, { month: CUR });
await mkUer(ctxY, 'J', 9000); await mkUer(ctxY, 'B', 5000); await mkUer(ctxY, 'D', 4000);
await mkUer(ctxY, 'A', -15000);

/* ================= ④ 配方源资格闸（闸④）+ 闸③ 产权前提 ================= */
console.log('— ④ 配方源资格：第8名拒（fails 含 rank）/ 第1名过 / 未 runM21 → A11_LOCKED / 闸③四态 —');
{
  let errA = null;
  try { await setRecipeSource(db, ctxA, { sourceIds: ['x'] }); } catch (e) { errA = e; }
  ok(isA11(errA), '未 runM21 租户 setRecipeSource → 抛 A11_LOCKED（闸①：配方在锁清单里）', errA?.message);

  ok(rankOf('A') === 8 && rankOf('J') === 1, `核弹表基线：rank(A)=8、rank(J)=1（与 C1 引擎同源）`);
  const rA = await setRecipeSource(db, ctxY, { sourceIds: ['A'] });
  ok(rA.ok === false && rA.spId === 'A' && rA.check.fails.includes('rank') && rA.check.fails.includes('uer'),
    `归一第 8 名 A 设源 → 拒（fails=${rA.check?.fails?.join(',')} 含 rank）——拒 A 荐 J`);
  ok((await q(`select count(*)::int as n from recipe_sources where tenant_id = $1`, [tY]))[0].n === 0,
    '拒绝 = 零写入（recipe_sources 行数 0）');
  ok(rA.notes.includes('complaint_skipped_no_datasource(P-1)'), '客诉数据源缺失 → 该分项跳过并注明（P-1 现行口径）');

  const rJ = await setRecipeSource(db, ctxY, { sourceIds: ['J'] });
  ok(rJ.ok === true && rJ.perSp[0].rankNorm === 1 && rJ.perSp[0].uer >= 0,
    `归一第 1 名 J ∧ uer≥0 → 设源成功（rank=1, uer=${rJ.perSp?.[0]?.uer}）`);
  ok((await q(`select count(*)::int as n from recipe_sources where tenant_id = $1`, [tY]))[0].n === 1,
    'recipe_sources 落库 1 行');

  /* 闸③ 四态：no_m28 → ahc_missing → ahc_low → 放行 */
  const g1 = await propertyGateCheck(db, ctxY);
  ok(g1.locked && g1.reason === 'no_m28', `闸③：配方源 J 无 M28 → 锁定（${g1.reason}）`);
  await put(db, ctxY, 'm28_agreements', { id: 'm28_J', master_id: 'J', kind: 'mentoring',
    rate: 0.05, duration_months: 12, start_trigger: 'recipe_live' }, 'm28_signed');
  await put(db, ctxY, 'm28_agreements', { id: 'm28_D', master_id: 'D', kind: 'mentoring',
    rate: 0.05, duration_months: 12, start_trigger: 'apprentice_ramp_done' }, 'm28_signed');
  const g2 = await propertyGateCheck(db, ctxY);
  ok(g2.locked && g2.reason === 'ahc_missing' && g2.ahc === null,
    'M28 已签但 AHC 缺（derived_scalars 无行）→ null 锁定说明（null ≠ 0）');
  const setAhc = v => upsert(db, ctxY, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'tenant', target_id: null, key: 'ahc', period: CUR, value_num: v, value_json: {} },
    'derived_scalar_written', { touch: ['computed_at'] });
  await setAhc(55);
  const g3 = await propertyGateCheck(db, ctxY);
  ok(g3.locked && g3.reason === 'ahc_low', 'AHC=55 < 信任线 60 → 锁定（ahc_low）');
  await setAhc(78);
  const g4 = await propertyGateCheck(db, ctxY);
  ok(g4.locked === false && g4.ahc === 78, 'M28 ∧ AHC=78 → 闸③放行');
}

/* ---------- tY 追加人口（🔴 在 runM21 之后加，不动排名基线） ---------- */
await mkSp(ctxY, 'M41P'); await mkSp(ctxY, 'VET', { hireDate: '2024-01-01' });
await mkSp(ctxY, 'n1', { hireDate: '2026-07-06' }); await mkSp(ctxY, 'n2', { hireDate: '2026-07-06' });
/* 配方源 J：首 7 天日报（首N天基准）+ 近期日报（三张牌/带宽） */
for (let d = 1; d <= 7; d++) await mkRep(ctxY, 'J', `2026-01-0${d}`, { leads: 10, intents: 3, samples: 1 });
for (let d = 1; d <= 10; d++) await mkRep(ctxY, 'J', `2026-07-${String(d).padStart(2, '0')}`,
  { leads: 8, intents: 4, samples: 2, contracts: 1 });
/* 新人：n1 达标 / n2 连红 */
for (let d = 6; d <= 12; d++) {
  await mkRep(ctxY, 'n1', `2026-07-${String(d).padStart(2, '0')}`, { leads: 9, intents: 3 });
  await mkRep(ctxY, 'n2', `2026-07-${String(d).padStart(2, '0')}`, { leads: 2 });
}

/* ================= ① 🔴 PLV 拦截保存 ================= */
console.log('— ① PLV 三层：坏句拦截（行数不变）+ 改写稿 / 合法句落库 / insist 放行留痕 —');
{
  const cnt = async () => (await q(`select count(*)::int as n from prescriptions where tenant_id = $1`, [tY]))[0].n;
  const BAD = '你态度不端正，要拿出狼性';
  const GOOD = '你昨天 12 通电话，9 通没做需求确认。今天试试在第 3 分钟问"您现在最头疼的是什么？"配方源基准 87%';

  const r1 = await savePrescription(db, ctxY, { employeeId: 'C', text: BAD });
  ok(r1.ok === false && !r1.plv.l1.pass && !r1.plv.l2.pass && !r1.plv.l3.pass,
    `🔴 坏句三层全❌ → 拒绝保存（l1 hits=${r1.plv?.l1?.hits?.join('、')}）`);
  ok(Array.isArray(r1.hints) && r1.hints.length > 0, `改写稿（plvRewriteHint）非空：${r1.hints?.length} 条`);
  ok(await cnt() === 0, '🔴 拦截 = 保存路径不存在（prescriptions 行数不变 = 0）');

  const r2 = await savePrescription(db, ctxY, { employeeId: 'C', text: GOOD,
    psiParts: { targeting: 1.0, benchmark: 1.0, dataRef: 1.0, ackRate: 0.84 } });
  ok(r2.ok === true && r2.plv.passed && await cnt() === 1, '合法句三层全✅ → 落库（1 行）');
  ok(r2.psi === 96 && r2.band === 'green', `PSI = 25+25+25+21 = 96 🟢（实际 ${r2.psi}/${r2.band}）`);
  const [row2] = await q(`select psi_parts, plv_passed from prescriptions where tenant_id = $1 and id = $2`, [tY, r2.id]);
  const pj = typeof row2.psi_parts === 'string' ? JSON.parse(row2.psi_parts) : row2.psi_parts;
  ok(row2.plv_passed === true && pj.score === 96, 'psi_parts 落库含 score=96 且 plv_passed=true');

  const r3 = await savePrescription(db, ctxY, { employeeId: 'C', text: BAD, insist: true });
  ok(r3.ok === true && r3.insisted === true && await cnt() === 2, 'insist=true → 放行（2 行）');
  ok(await esType(tY, 'prescription_insisted') === 1, 'prescription_insisted 留痕事件 = 1（坚持原文计入认知鸿沟风险）');
  const [row3] = await q(`select plv_passed from prescriptions where tenant_id = $1 and id = $2`, [tY, r3.id]);
  ok(row3.plv_passed === false, 'insist 行 plv_passed=false（留痕可查）');
}

/* ================= ③ 悬赏三态（D-1 / Y-D16 / T19） ================= */
console.log('— ③ 悬赏三态：结果类∧未启→拒+Y-13+showEnable / 启用后放行 / first_deal 恒放行 / ≤3 —');
{
  const cnt = async () => (await q(`select count(*)::int as n from bounties where tenant_id = $1`, [tB]))[0].n;
  ok(await silentTrackOn(db, ctxB) === false, '初始：静默认可通道未启用');
  const b1 = await saveBounty(db, ctxB, { trigger: 'record_break', amountAmt: 500000 });
  ok(b1.ok === false && b1.state === 'blocked' && b1.talk === 'Y-13' && b1.showEnable === true,
    '🔴 record_break ∧ 通道未启 → 拦截保存 + 话术码 Y-13 + [一键启用] 按钮');
  ok(typeof b1.y13 === 'string' && b1.y13.includes('破纪录赏') && b1.y13.includes('不许只有钱'),
    'Y-13 话术注入模板名（破纪录赏）与关键句');
  ok(await cnt() === 0, '拦截 = 零写入（bounties 行数 0）');

  const b2 = await saveBounty(db, ctxB, { trigger: 'first_deal', amountAmt: 300000 });
  ok(b2.ok === true && b2.state === 'exempt' && await cnt() === 1,
    'first_deal ∧ 通道未启 → 🟢 恒放行（豁免：无内在动机可挤出）');

  await silentTrackEnable(db, ctxB);
  ok(await silentTrackOn(db, ctxB) === true, 'silentTrackEnable → 通道已启用（derived_scalars tenant/silentTrackOn）');
  const b3 = await saveBounty(db, ctxB, { trigger: 'record_break', amountAmt: 500000 });
  ok(b3.ok === true && b3.state === 'pass' && await cnt() === 2, '通道已启 → 同模板放行（对冲后可用，不是禁用）');

  const b4 = await saveBounty(db, ctxB, { trigger: 'sprint', amountAmt: 200000 });
  ok(b4.ok === true && await cnt() === 3, '第 3 个活动悬赏放行');
  const b5 = await saveBounty(db, ctxB, { trigger: 'hire', amountAmt: 100000 });
  ok(b5.ok === false && /≤ 3/.test(b5.err) && await cnt() === 3,
    '🔴 第 4 个活动悬赏 → 拒（同时活动 ≤ 3；豁免模板也不例外）');
}

/* ================= ⑤ 汰前三拦截（T11/Y-11/Y-D6） ================= */
console.log('— ⑤ 汰前三拦截：三种缺失各一例全拦截 + Y-11；全过 → 只出 eliminate 卡 —');
{
  /* J：线索指数 0.3 <0.7；I：练习 10 <50；H：确认辅导 0；G：三条件全过 */
  await mkPractice(ctxY, 'J', 50); await mkPractice(ctxY, 'I', 10);
  await mkPractice(ctxY, 'H', 50); await mkPractice(ctxY, 'G', 50);
  await mkAck(ctxY, 'ack_J1', 'J'); await mkAck(ctxY, 'ack_I1', 'I'); await mkAck(ctxY, 'ack_G1', 'G');

  let errA = null;
  try { await cullCheck(db, ctxA, { spId: 'x' }); } catch (e) { errA = e; }
  ok(isA11(errA), '未 runM21 租户 cullCheck → A11_LOCKED（淘汰在锁清单里）');

  const cJ = await cullCheck(db, ctxY, { spId: 'J' });
  ok(cJ.blocked === true && cJ.blocks.includes('no_leads') && near(cJ.evidence.leadsIndex, 0.3),
    `J 线索指数 ${cJ.evidence?.leadsIndex} < 0.7 → 拦截 no_leads（"你没给他饭吃"）`);
  const cI = await cullCheck(db, ctxY, { spId: 'I' });
  ok(cI.blocked === true && cI.blocks.includes('no_practice') && !cI.blocks.includes('no_leads'),
    `I 前14天练习 ${cI.evidence?.practice14} < 50 → 拦截 no_practice（"你还没给他机会"）`);
  const cH = await cullCheck(db, ctxY, { spId: 'H' });
  ok(cH.blocked === true && cH.blocks.includes('no_coaching') && cH.evidence.ackConfirmedCount === 0,
    'H CoachingAck confirmed=0 → 拦截 no_coaching（"你在淘汰一个没人教过的人"）');
  for (const c of [cJ, cI, cH])
    ok(c.talk === 'Y-11' && c.talks.length > 0 && c.verdict === 'keep',
      `拦截带 Y-11 话术码 + 兜底 verdict=keep（${c.blocks.join(',')}）`);

  const before = await q(`select is_active, leave_date, leave_reason from salespersons where tenant_id = $1 and id = 'G'`, [tY]);
  const cG = await cullCheck(db, ctxY, { spId: 'G' });
  ok(cG.blocked === false && cG.verdict === 'keep' && cG.cardId != null,
    'G 三条件全过 → 建议可出（verdict 仍兜底 keep，只出卡待老板点击）');
  const cards = await q(`select kind, state, target_id from action_cards where tenant_id = $1`, [tY]);
  ok(cards.length === 1 && cards[0].kind === 'eliminate' && cards[0].state === 'pending' && cards[0].target_id === 'G',
    'action_card(kind=eliminate, state=pending) 恰 1 张');
  const after = await q(`select is_active, leave_date, leave_reason from salespersons where tenant_id = $1 and id = 'G'`, [tY]);
  ok(JSON.stringify(before) === JSON.stringify(after) && after[0].is_active === true,
    '🔴 salespersons 状态零变化（is_active/leave_date/leave_reason 原样——A-C04）');
}

/* ================= ⑥ M40：席位冻结 + 4 周强制轮换 ================= */
console.log('— ⑥ M40 配对：教练未签 M28 → 席位冻结；同对 >3 周 → 第 4 周强制轮换 —');
{
  /* 教练候选 = 归一前3 = J(1)/B(2)/D(3)，闸④全过（uer≥0、折扣同率）；仅 J/D 签 M28 → B 冻结 */
  const w = ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03'];
  const r1 = await runM40Pairing(db, ctxY, { weekOf: w[0] });
  ok(r1.frozenCoachIds.length === 1 && r1.frozenCoachIds[0] === 'B',
    `🔴 教练 B（归一第2）未签 M28 → 席位冻结（frozen=${r1.frozenCoachIds}）`);
  ok(r1.pairs.length === 2 && new Set(r1.pairs.map(p => p.coachId)).size === 2
    && r1.pairs.every(p => ['J', 'D'].includes(p.coachId)),
    `本周仅 2 对（教练 = J/D 已签者；实际 ${r1.pairs.map(p => p.coachId + '↔' + p.learnerId).join(' ')}）`);
  const learnerBandIds = ['C', 'E', 'G', 'F', 'A'];                  // 排名 (2,8] 去教练
  ok(r1.pairs.every(p => learnerBandIds.includes(p.learnerId)) && r1.queued.length === 3,
    `学员∈排名(20%,80%] 带；余 ${r1.queued.length} 人候补`);
  ok(r1.pairs.every(p => p.consecutiveWeeks === 1), '首周 consecutive_weeks = 1');

  const key = p => `${p.coachId}|${p.learnerId}`;
  const week1 = r1.pairs.map(key).sort();
  const r2 = await runM40Pairing(db, ctxY, { weekOf: w[1] });
  const r3 = await runM40Pairing(db, ctxY, { weekOf: w[2] });
  ok(JSON.stringify(r2.pairs.map(key).sort()) === JSON.stringify(week1)
    && JSON.stringify(r3.pairs.map(key).sort()) === JSON.stringify(week1),
    '第 2/3 周：同对延续（输入未变 → 配对确定性）');
  ok(r3.pairs.every(p => p.consecutiveWeeks === 3), '第 3 周 consecutive_weeks = 3');
  const r4 = await runM40Pairing(db, ctxY, { weekOf: w[3] });
  ok(r4.pairs.length === 2 && r4.pairs.map(key).every(k => !week1.includes(k)),
    `🔴 第 4 周强制轮换：week1 组合零延续（实际 ${r4.pairs.map(key).join(' ')}）`);
  ok(r4.pairs.every(p => p.consecutiveWeeks === 1), '轮换后新对 consecutive_weeks 复位 1');
  const act = await q(`select count(*)::int as n from pair_assignments where tenant_id = $1 and status = 'active'`, [tY]);
  const rot = await q(`select count(*)::int as n from pair_assignments where tenant_id = $1 and status = 'rotated'`, [tY]);
  ok(act[0].n === 2 && rot[0].n === 6, `pair_assignments：active=2（本周）/ rotated=6（历史周全部轮换）`);
}

/* ================= ⑦ 抽检卡：无结果字段 + 同周重跑确定性 ================= */
console.log('— ⑦ 抽检卡：列集断言（Y-D7 表结构级）+ 确定性（mulberry32 种子=weekOf+tenantId） —');
{
  const cols = (await q(`select column_name from information_schema.columns
                          where table_schema = 'public' and table_name = 'spot_check_cards' order by column_name`))
    .map(r => r.column_name);
  const expect = ['check_date', 'created_at', 'created_by', 'deleted_at', 'employee_id', 'id',
    'reported_count', 'stage', 'tenant_id', 'updated_at', 'updated_by', 'week_of'].sort();
  ok(JSON.stringify(cols) === JSON.stringify(expect),
    `🔴 spot_check_cards 列集恰为 12 列业务+审计字段（实际 ${cols.length} 列）`);
  ok(!cols.some(c => /result|answer|pass|fail|fake|fraud|flag|verdict/.test(c)),
    '🔴 无结果/造假/负面标记字段（只出题不记结果——表结构级保证）');

  const g1 = await genSpotChecks(db, ctxY, { weekOf: '2026-07-13' });
  ok(g1.cards.length === 2 && g1.k === 2, `每周 k=2 张（spotCheck.weeklyK）`);
  ok(g1.footer === '抽检为随机生成，全员同规。', '页脚固定句');
  const snap = async () => JSON.stringify(await q(
    `select id, week_of::text, employee_id, stage, reported_count from spot_check_cards
      where tenant_id = $1 order by id`, [tY]));
  const s1 = await snap();
  const g2 = await genSpotChecks(db, ctxY, { weekOf: '2026-07-13' });
  ok(await snap() === s1 && g2.cards.length === 2,
    '🔴 同周重跑：确定性一致（同一批人/环节/计数，UPSERT 覆盖行数不变）');
  ok(JSON.stringify(g1.cards) === JSON.stringify(g2.cards), '返回值逐字节一致（种子确定性）');
}

/* ================= 附1：M12 三张牌 / 带教任务 / 回执惰性自动确认 ================= */
console.log('— 附1：三张牌 / 带教任务 7 天不重复 / no_response 惰性自动 confirmed —');
{
  const tc = await threeCards(db, ctxY);
  ok(tc != null && tc.nSources === 1 && near(tc.dose.leads, 8),
    `三张牌：配方源 J 剂量 leads=8/日（近180天有报工作日均；实际 ${tc?.dose?.leads}）`);
  ok(near(tc.mix.l2i, 0.5) && tc.pace.topCat === 'cat0', `配比 l2i=0.5、节奏 topCat=cat0`);

  const t1 = await createCoachTask(db, ctxY, { employeeId: 'C', managerId: 'B', stage: 'discovery' });
  ok(t1.ok === true && t1.reboundDue === '2026-07-27', `带教任务落库（rebound_due = +14d = ${t1.reboundDue}）`);
  const t1dup = await createCoachTask(db, ctxY, { employeeId: 'C', managerId: 'B', stage: 'discovery' });
  ok(t1dup.ok === false && /7 天不重复/.test(t1dup.err), '同人同环节 7 天不重复 → 拒');
  const t2 = await createCoachTask(db, ctxY, { employeeId: 'C', managerId: 'B', stage: 'closing' });
  ok(t2.ok === true, '同人不同环节 → 放行');

  await reportCoachTask(db, ctxY, { coachTaskId: t1.id, durationMin: 60 });
  const [a0] = await q(`select employee_ack_status from coaching_acks where tenant_id = $1 and id = $2`, [tY, t1.ackId]);
  ok(a0.employee_ack_status === 'no_response', '主管上报后回执仍 no_response（等销售确认）');
  /* 8 天后任意回执入口触发惰性 sweep → 超 7 天自动 confirmed（employee_ack_at 留空以示"超时视同"） */
  const swept = await ackCoaching(db, { ...ctxY, today: '2026-07-21' }, {});
  const [a1] = await q(`select employee_ack_status, employee_ack_at from coaching_acks where tenant_id = $1 and id = $2`, [tY, t1.ackId]);
  ok(swept.swept >= 1 && a1.employee_ack_status === 'confirmed' && a1.employee_ack_at === null,
    `no_response 超 7 天 → 惰性 sweep 自动 confirmed（swept=${swept.swept}，ack_at 留空）`);
  ok(await esType(tY, 'coaching_ack_autoconfirmed') >= 1, 'coaching_ack_autoconfirmed 事件留痕');
}

/* ================= 附2：M15 新人 7 天窗 / M14 有效分与挂账 ================= */
console.log('— 附2：新人 7 天窗红绿灯 / 有效动作分 / 挂账爆破 —');
{
  const nb = await newbieBoard(db, ctxY);
  const byId = Object.fromEntries(nb.map(r => [r.sp.spId, r]));
  ok(nb.length === 2 && byId.n1 && byId.n2, `新人看板 = 司龄≤30天者 2 人（n1/n2）`);
  ok(byId.n1.suggestCull === false && byId.n1.maxStreak === 0,
    `n1 日均 9 ≥ 阈值(10×0.8)×红线0.6 → 全绿不建议（maxStreak=${byId.n1.maxStreak}）`);
  ok(byId.n2.suggestCull === true && byId.n2.maxStreak >= 3,
    `n2 日均 2 → 连红 ${byId.n2.maxStreak} 工作日 ≥3 → 建议（休息日不计，Y-D8）`);
  ok(byId.n2.verdict === 'keep' && byId.n1.verdict === 'keep', '🔴 兜底默认「留」（Y-D6）');

  const eff = await effectiveScores(db, ctxY);
  const effJ = eff.find(r => r.spId === 'J');
  ok(effJ && effJ.raw.leads === 80 && effJ.effective.leads === 80,
    `有效动作分：J 周桶<3 → 带宽 null → 有效分=原始计数（${effJ?.effective?.leads}）；原始计数原样保留（Y-D5）`);

  await mkDeal(ctxY, 'd_backlog', 'E', '2026-05-20', 5e6, { status: 'won', paidDate: null });
  await q(`update deals set paid_date = null where tenant_id = $1 and id = 'd_backlog'`, [tY]);
  const bb = await backlogBoard(db, ctxY);
  ok(bb.manager.length === 1 && bb.manager[0].dealId === 'd_backlog' && bb.boss.length === 0,
    `挂账 54 天：>30 → 主管黄条（<60 不进老板插卡）`);
}

/* ================= 附3：M41 动量 / M42 榜样 / M43 节奏 / M44a ================= */
console.log('— 附3：M41 触发+动量期加压词拦截 / M42 真配与"—" / M43 四区+子目标 / M44a —');
{
  /* M41P：前窗 3 胜（赢率 1.0）→ 近窗 3 胜 4 连败（0.429）→ 分 0.71 触发 */
  for (const [i, d] of [['w1', '2026-05-20'], ['w2', '2026-05-25'], ['w3', '2026-05-30'],
    ['w4', '2026-06-15'], ['w5', '2026-06-16'], ['w6', '2026-06-17']].entries())
    await mkDeal(ctxY, `dM41${d[0]}`, 'M41P', d[1], 10e6);
  for (const d of ['2026-07-01', '2026-07-03', '2026-07-05', '2026-07-07'])
    await mkDeal(ctxY, `dM41l${d}`, 'M41P', d, 6e6, { status: 'lost' });
  await mkDeal(ctxY, 'dM41o1', 'M41P', '2026-07-10', 4e6, { status: 'open' });
  await mkDeal(ctxY, 'dM41o2', 'M41P', '2026-07-11', 8e6, { status: 'open' });
  const mb = await momentumBoard(db, ctxY);
  const m41 = mb.find(r => r.spId === 'M41P');
  ok(m41.lossStreak === 4 && m41.triggered === true && near(m41.score, 0.71, 0.02),
    `M41P 连败 4 ∧ 赢率 ${m41.prevWinRate?.toFixed(2)}→${m41.curWinRate?.toFixed(2)} → 分 ${m41.score} 触发`);
  ok(m41.cards.includes('plv_momentum_mode') && m41.smallDeals.length === 1 && m41.smallDeals[0] === 'dM41o1',
    `干预=action_card 描述；高把握小单 ≤ aov×0.5 → 恰 dM41o1（4e6 ≤ 10e6×0.5）`);
  const MTXT = '昨天 12 通电话 9 通没做需求确认，今天必须拿下 3 个签约，配方源基准 87%';
  const pm = await savePrescription(db, ctxY, { employeeId: 'M41P', text: MTXT, momentumMode: true });
  ok(pm.ok === false && pm.plv.l1.hits.includes('必须拿下'),
    '🔴 动量期处方加压词（必须拿下）→ PLV 第一层拦截（Y-D10）');
  const pn = await savePrescription(db, ctxY, { employeeId: 'M41P', text: MTXT });
  ok(pn.ok === true, '同句非动量期 → 放行（动量词库只在 momentum 模式并入）');

  /* M42："—" 绝不硬凑（tY 仅 1 个月归一 → 轨迹缺月）+ 真配（tM 6 个月轨迹） */
  const rmH = await roleModelFor(db, ctxY, { spId: 'H' });
  ok(rmH.laggard === true && rmH.match === null && rmH.display === '—',
    'tY 仅当月归一 → 轨迹缺月 → 匹配空 = "—"（绝不硬凑，Y-D11）');
  await mkCat(ctxM, 'cat0', 0.5);
  for (const id of ['P', 'W', 'V']) await mkSp(ctxM, id);
  const TRAJ = { P: [2, 2, 3, 3, 4, 4], W: [2.5, 3, 3.5, 4, 4.5, 5], V: [8, 8, 9, 9, 10, 10] };
  for (let k = 0; k < 6; k++) {
    const mm = `2026-0${k + 2}`;
    for (const id of ['P', 'W', 'V']) {
      await mkLeads(ctxM, `laM_${id}_${k}`, id, mm, 100);
      await mkDeal(ctxM, `dM_${id}_${k}`, id, `${mm}-10`, TRAJ[id][k] * 1e6 * 2);
    }
    await runM21(db, ctxM, { month: mm });
  }
  const rmP = await roleModelFor(db, ctxM, { spId: 'P' });
  ok(rmP.laggard === true && rmP.match != null && rmP.match.spId === 'W' && near(rmP.match.dist, 4.5e6),
    `tM：dist(W)=4.5e6 < dist(V)=36e6 → 榜样=W（轨迹距离最近；实际 ${rmP.match?.spId}/${rmP.match?.dist}）`);

  /* M43：手工配额优先（derived_scalars person/quotaManual）→ 四区 + 弃赛区子目标 */
  const setQuota = (sp, v) => upsert(db, ctxY, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'person', target_id: sp, key: 'quotaManual', period: CUR, value_num: v, value_json: {} },
    'derived_scalar_written', { touch: ['computed_at'] });
  await setQuota('A', 24e6); await setQuota('B', 28.5e6); await setQuota('C', 60e6);
  const pb = await paceBoard(db, ctxY);
  const pz = Object.fromEntries(pb.rows.map(r => [r.spId, r]));
  ok(pz.A.zone === 'protect' && near(pz.A.completion, 1.0), `A 完成度 1.00 → 保护区`);
  ok(pz.B.zone === 'accel' && near(pz.B.completion, 20e6 / 28.5e6), `B 完成度 ${pz.B.completion?.toFixed(2)} → 加速区`);
  ok(pz.C.zone === 'quit_risk' && pz.C.completion < 0.40, `C 完成度 ${pz.C.completion?.toFixed(2)} → 弃赛区`);
  ok(pz.C.subGoalAmt != null && pz.C.subGoalAmt > 0 && pz.C.subGoalAmt % 10000 === 0 && pz.C.talk === 'Y-08',
    `弃赛区子目标 = 剩余工作日×日均×1.1 取整百元（${pz.C.subGoalAmt} 分）+ Y-08`);
  ok(pz.E.zone == null && pz.E.completion == null && pz.E.quota == null,
    '无手工配额 ∧ 无定价器版本 → 配额 null → 整模块 "—"（不造 0）');
  ok(pz.A.quotaSrc === 'manual', '配额来源：手工优先（quotaManual）');

  /* M44a：老手 VET（司龄>2年）零确认剂量 vs 全队 → 比值 0 < 0.5 → Y-09 */
  const m44 = await m44aBoard(db, ctxY);
  ok(m44.veteranCount === 1 && m44.ratio === 0 && m44.flagged === true && m44.talk === 'Y-09',
    `老手辅导比 = ${m44.ratio} < 0.5 → 🟡 Y-09（老手技能衰减无人监测）`);
}

/* ================= ⑧ 事件双写抽查 ================= */
console.log('— ⑧ 事件双写抽查 —');
{
  ok(await esType(tY, 'recipe_source_set') === 1, 'recipe_source_set = 1（拒绝的设定零事件）');
  ok(await esType(tY, 'prescription_saved') === 3, `prescription_saved = 3（合法+insist+动量对照）`);
  ok(await esType(tY, 'prescription_insisted') === 1, 'prescription_insisted = 1');
  ok(await esType(tY, 'coach_task_created') === 2 && await esType(tY, 'coaching_ack_created') >= 2,
    'coach_task_created = 2（7 天重复的那次零事件）');
  ok(await esType(tY, 'cull_intercepted') === 3 && await esType(tY, 'eliminate_card_created') === 1,
    'cull_intercepted = 3 / eliminate_card_created = 1');
  ok(await esType(tY, 'pair_assigned') === 8 && await esType(tY, 'pair_rotated') === 6,
    'pair_assigned = 8（2对×4周）/ pair_rotated = 6');
  ok(await esType(tY, 'spot_check_generated') === 4, 'spot_check_generated = 4（2 卡 × 2 次重跑，UPSERT 双写）');
  ok(await esType(tB, 'bounty_created') === 3 && await esType(tB, 'silent_track_toggled') === 1,
    'tB：bounty_created = 3（两次拦截零事件）/ silent_track_toggled = 1');
  const [ev] = await q(`select payload from event_stream where tenant_id = $1 and type = 'bounty_created'
                         order by event_id limit 1`, [tB]);
  const pj = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;
  ok(pj.trigger === 'first_deal' && pj.active === true, `bounty_created payload 完整（trigger=${pj.trigger}）`);
}

await db.close();

/* ================= ⑨ 回归：C2–C6 不受影响 ================= */
console.log('— ⑨ 回归：spawnSync 跑 c2-model / c3 / c4 / c5 / c6 —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs', 'c4.test.mjs', 'c5.test.mjs', 'c6.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: 300000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C7 育人层验收全部通过');
process.exit(failures ? 1 : 0);
