#!/usr/bin/env node
/* C9 罪证层验收（v5.1 §12 C9 行：M33–M36、M23）：
   ① 🔴 S-06：S06_TEXT 与 3号 v3.3 话术库原文逐字比对（期望串在本测试写死）；
      grep m33.mjs——常量恰一处赋值（顶层 const）、无任何 export 函数参数可注入结语、
      evidencePack 只读注入（s06: S06_TEXT）→ 无编辑入口（S-D7）
   ② M33 四证据：构造 e3 触发（折扣率 16% ∧ 期末占比 65%）+ e2 品类退款集中 5×；
      数据缺（无 lost 单 / 无离职者）→ 输入 null 不硬造；e1 于 tA 验证（won1/lost9→10%）
   ③ M34：构造末段折扣率 8% vs 平时 2.4% → diff 5.6pp 🔴；年化泄漏 = 0.056×末段回款
      600 万分位 = 33.6 万分位（手算对照）；threshold null → 聚集指数 "—"
   ④ 🔴 M35：requireM21 前置（未归一 → A11_LOCKED）；原始榜尾 J 归一跳升 jump=9≥3 →
      误杀警报 S-17（倒数第1/30条/第1）；basis=relative_rank → S-18；三选项返回；
      insistEliminate → override_events +1（B 形 insist_eliminate）+ 事件 +1 +
      salespersons 前后快照零变化（逐列断言，S-D10）
   ⑤ M36：无基线/imported 桩未补录 → "待补录你设的底线数"；setBaseline(50) →
      带 [50,57]、40 人天 17 落带 = 42.5% > 40% 🔴 + 兑付标识；<30 人天 → rate null
   ⑥ M23：requireM21 前置；八维恒 8 项——可算维（归一排名/月度方差/带教/折扣/退款/UER）
      有值 + 缺数维（客户集中度/成就vs自恋）null；bossOnly 标记
   ⑦ 事件双写抽查；⑧ 回归 spawnSync c2–c8
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13，服务层零 new Date() */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { put, upsert } from '../server/writes.mjs';
import { evidencePack, S06_TEXT } from '../server/m33.mjs';
import { arbitrage } from '../server/m34.mjs';
import { precheck, insistEliminate } from '../server/m35.mjs';
import { bunchRate, setBaseline } from '../server/m36.mjs';
import { promotionPredict } from '../server/m23.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const near = (a, b, eps = 1e-6) => a != null && b != null && Math.abs(a - b) < eps;

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11：与五板块对拍同一基准日
const CUR = '2026-07';

/* ================= ① 🔴 S-06 逐字比对 + 无编辑入口（S-D7） ================= */
console.log('— ① S-06 结语：逐字比对（期望串写死于本测试）+ 无编辑入口机检 —');
{
  /* 🔴 期望串 = 3号算账器 v3.3 话术库 S-06 原文（『』内全文，一个字不能改） */
  const EXPECTED = '以上是数据。判断归你。但请记住系统的边界：这个系统不会让一个卖不动的产品卖动。销售只是产品的传声筒。产品是地基。地基不稳，一定翻车。而产品不好的公司，销冠会最先流失——因为销冠最不能忍受"卖不动"。如果你看完这四组数据，仍然认为产品没有问题——我们尊重你的判断。系统会继续为你优化其他环节。但我们必须诚实地告诉你：如果问题在地基，那么我们能帮你的，最多是让翻车晚一点发生。';
  ok(S06_TEXT === EXPECTED, '🔴 S06_TEXT 与 3号规格原文逐字一致（字符串全等）');

  const src = readFileSync(join(root, 'server', 'm33.mjs'), 'utf8');
  ok((src.match(/export const S06_TEXT = '/g) || []).length === 1,
    '🔴 S06_TEXT 为模块顶层 export const，恰 1 处声明');
  ok((src.match(/S06_TEXT\s*=/g) || []).length === 1,
    '🔴 S06_TEXT 全模块恰 1 处赋值（除顶层 const 外无任何写路径）');
  const sigOffenders = [];
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g))
    if (/s06|text|conclusion|结语/i.test(m[2])) sigOffenders.push(m[1]);
  ok(sigOffenders.length === 0, '🔴 m33 无任何 export 函数签名接受结语参数（无编辑入口）', sigOffenders.join(','));
  ok(/s06:\s*S06_TEXT/.test(src), 'evidencePack 只读注入常量（s06: S06_TEXT）');
}

/* ================= ⓪ 静态断言：零 new Date() + M35 零 salespersons 写路径 ================= */
console.log('— ⓪ 静态断言：C9 五模块零 new Date() + m35 对 salespersons 零写语句 —');
{
  const C9_FILES = ['m33.mjs', 'm34.mjs', 'm35.mjs', 'm36.mjs', 'm23.mjs'];
  const clockHits = C9_FILES.filter(f => /new Date\(/.test(readFileSync(join(root, 'server', f), 'utf8')));
  ok(clockHits.length === 0, 'C9 五个服务模块零 new Date()（业务日期一律 ctx.today）', clockHits.join(','));
  const m35src = readFileSync(join(root, 'server', 'm35.mjs'), 'utf8');
  ok(!/put\([^)]*salespersons/.test(m35src) && !/patch\([^)]*salespersons/.test(m35src)
    && !/update\s+salespersons/i.test(m35src) && !/insert\s+into\s+salespersons/i.test(m35src),
    '🔴 S-D10 写侧：m35.mjs 对 salespersons 零写语句（[仍坚持淘汰] 仅留痕）');
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

const tE = await mkTenant('C9·产品证据包');
const tA = await mkTenant('C9·时点套利');
const tM = await mkTenant('C9·淘汰误杀');
const tB = await mkTenant('C9·卡线率');
const tP = await mkTenant('C9·提拔八维');
const ctx = t => ({ tenantId: t, actorId: U.boss, today: TEST_TODAY });
const ctxE = ctx(tE), ctxA = ctx(tA), ctxM = ctx(tM), ctxB = ctx(tB), ctxP = ctx(tP);

/* ---------- 种子工具 ---------- */
const mkSp = (c, id, opts = {}) => put(db, c, 'salespersons', {
  id, name: opts.name ?? id, level: 'sales', hire_date: opts.hireDate ?? '2026-01-01',
  base_salary_amt: opts.baseAmt ?? 3000000, is_active: opts.isActive ?? true,
  leave_date: opts.leaveDate ?? null,
}, 'salesperson_created');
const mkCat = (c, id, rate) => put(db, c, 'categories', { id, name: id, gross_margin_rate: rate }, 'category_created');
const mkDeal = (c, id, employeeId, date, payAmt, opts = {}) => put(db, c, 'deals',
  { id, employee_id: employeeId, deal_date: date, payment_amt: payAmt,
    category_id: opts.categoryId ?? 'cat0', margin_rate_snapshot: opts.margin ?? 0.5,
    status: opts.status ?? 'won', paid_date: opts.status === 'lost' ? null : (opts.paidDate ?? date) },
  'deal_created');
const mkDisc = (c, id, employeeId, date, listAmt, discAmt, reason) => put(db, c, 'discount_entries',
  { id, discount_date: date, employee_id: employeeId, category_id: 'cat0',
    list_price_amt: listAmt, actual_price_amt: listAmt - discAmt, discount_amt: discAmt, reason },
  'discount_entry_created');
const mkRefund = (c, id, employeeId, date, catId, amt) => put(db, c, 'refund_entries',
  { id, employee_id: employeeId, refund_date: date, category_id: catId, amount_amt: amt },
  'refund_entry_created');
const mkNorm = (c, spId, month, opts) => upsert(db, c, 'm21_norms',
  { cols: ['tenant_id', 'sp_id', 'month'] },
  { sp_id: spId, month, leads: opts.leads ?? 100, lead_index: opts.leadIndex ?? null,
    unit_lead_margin: opts.unit ?? null, norm_margin: opts.normMargin ?? 1e6,
    orig_rank: opts.orig ?? null, norm_rank: opts.norm ?? null },
  'm21_norm_written', { touch: ['computed_at'] });
const mkReport = (c, id, employeeId, date, leads, contracts = 0) => put(db, c, 'daily_reports',
  { id, employee_id: employeeId, report_date: date, leads, intents: 0, samples: 0, contracts },
  'daily_report_submitted');

/* ================= ② M33 四证据（tE：e3 触发 + e2 集中 + 数据缺→null） ================= */
console.log('— ② M33 四证据：e3 折扣率 16% ∧ 期末 65% 触发；e2 集中 5×；缺数 → null 不硬造 —');
{
  await mkCat(ctxE, 'catA', 0.5); await mkCat(ctxE, 'catB', 0.5); await mkCat(ctxE, 'cat0', 0.5);
  await mkSp(ctxE, 'E1');
  await mkDeal(ctxE, 'eA', 'E1', '2026-07-05', 8000000, { categoryId: 'catA' });   // 当月回款 80%:20%
  await mkDeal(ctxE, 'eB', 'E1', '2026-07-05', 2000000, { categoryId: 'catB' });
  await mkRefund(ctxE, 'rf1', 'E1', '2026-07-10', 'catB', 300000);                 // 退款全在 catB
  await mkDisc(ctxE, 'dc1', 'E1', '2026-07-08', 650000, 104000, 'period_end_push');
  await mkDisc(ctxE, 'dc2', 'E1', '2026-07-09', 350000, 56000, 'competitive_pressure');

  const p = await evidencePack(db, ctxE);
  ok(near(p.inputs.discountRate, 0.16) && near(p.inputs.pushShare, 0.65),
    `e3 输入：折扣率 16% / 期末占比 65%（实际 ${p.inputs.discountRate}/${p.inputs.pushShare}）`);
  ok(p.evidence.e3 === true, '🔴 e3 被迫折扣触发（>15% ∧ >60%，domain 判定）');
  ok(near(p.inputs.refundByCategoryX, 5) && p.evidence.e2 === true,
    `e2 品类退款集中：catB 退款占比1.0 ÷ 回款占比0.2 = 5× > 3 → 触发（实际 ${p.inputs.refundByCategoryX}）`);
  ok(p.inputs.winRate === null && p.evidence.e1 === false,
    '🔴 无 lost 单 → winRate=null，e1 不硬造（"需录入 lost 单点亮"）');
  ok(p.inputs.leaverLowMarginRatioMedian === null && p.evidence.e4 === false,
    '🔴 无离职者 → 证据④输入 null，e4 不硬造');
  ok(p.evidence.any === true && p.s06 === S06_TEXT,
    '任一触发 → 出示证据包 + S-06 固定结语（闸⑫）');
}

/* ================= ③ M34 时点套利（tA：8% vs 2.4% → 5.6pp 红 + 年化泄漏） ================= */
console.log('— ③ M34：末段 8% vs 平时 2.4% → diff 5.6pp 🔴；年化泄漏 = 0.056 × 600万分位 —');
{
  await mkCat(ctxA, 'cat0', 0.5);
  await mkSp(ctxA, 'A1');
  /* 2026-07 共 31 天，末段 = 日 > 31×(2/3)=20.67 → 21 日起 */
  await mkDisc(ctxA, 'da_t', 'A1', '2026-07-25', 1000000, 80000, 'period_end_push');   // 末段 8%
  await mkDisc(ctxA, 'da_h', 'A1', '2026-07-10', 1000000, 24000, 'other');             // 平时 2.4%
  await mkDeal(ctxA, 'dw_t', 'A1', '2026-07-25', 6000000);                             // 末段回款 600万分位
  for (let i = 1; i <= 9; i++) await mkDeal(ctxA, `dl${i}`, 'A1', '2026-06-15', 1000000, { status: 'lost' });

  const r = await arbitrage(db, ctxA);
  ok(r.ok === true && near(r.tailRate, 0.08) && near(r.headRate, 0.024),
    `末段折扣率 8% / 平时 2.4%（实际 ${r.tailRate}/${r.headRate}）`);
  ok(near(r.diff, 0.056, 1e-9) && r.red === true,
    `时段差 = 5.6pp > 2pp 红线 → 🔴 罪证卡 S-14（实际 ${(r.diff * 100).toFixed(2)}pp）`);
  ok(near(r.annualLeakAmt, 0.056 * 6000000, 0.01),
    `年化泄漏 = 0.056 × 6,000,000 = 336,000 分（手算对照；实际 ${r.annualLeakAmt}）`);
  ok(r.threshold === null && r.bunchIndex === null,
    'PlanPeriodConfig 无阈值 → 聚集指数 null（"—"，不硬造）');

  /* e1 顺检（tA：won 1 / lost 9 → 赢单率 10% < 20%） */
  const p = await evidencePack(db, ctxA);
  ok(near(p.inputs.winRate, 0.1) && p.evidence.e1 === true,
    `M33 e1 赢单天花板：won 1 / lost 9 → 10% < 20% 触发（实际 ${p.inputs.winRate}）`);
}

/* ================= ④ 🔴 M35 淘汰误杀（tM：预检 + 仅留痕） ================= */
console.log('— ④ M35：requireM21 前置；jump=9≥3 → S-17 警报；[仍坚持淘汰] 仅留痕（S-D10） —');
{
  for (let i = 1; i <= 9; i++) await mkSp(ctxM, `M${i}`);
  await mkSp(ctxM, 'J', { name: 'J' });
  await put(db, ctxM, 'elimination_configs', { id: 'ec1', basis: 'relative_rank', survival_months: 3 },
    'elimination_config_set');

  /* 🔴 前置：M21 未运行 → A11_LOCKED（闸①，不放水） */
  let lockErr = null;
  try { await precheck(db, ctxM, { spId: 'J' }); } catch (e) { lockErr = e; }
  ok(lockErr != null && lockErr.code === 'A11_LOCKED', '🔴 M21 未运行 → precheck 锁定（A11_LOCKED，S-01）');

  /* 归一榜（接 3号 核弹表口径）：J 原始 10、归一 1；线索 30 条全队最少、单位产出全队第 1 */
  for (let i = 1; i <= 9; i++)
    await mkNorm(ctxM, `M${i}`, CUR, { leads: 100 + i, unit: 1000 - i, normMargin: (10 - i) * 1e5, orig: i, norm: i + 1 });
  await mkNorm(ctxM, 'J', CUR, { leads: 30, unit: 4000, normMargin: 12e5, orig: 10, norm: 1 });

  const pc = await precheck(db, ctxM, { spId: 'J' });
  ok(pc.found === true && pc.teamN === 10 && pc.jump === 9 && pc.threshold === 3 && pc.misfire === true,
    `双数校验：jump = 10−1 = 9 ≥ ceil(10×0.30)=3 → 🔴 误杀警报（实际 jump=${pc.jump}/阈 ${pc.threshold}）`);
  ok(pc.s17 != null && pc.s17.origRankFromBottom === 1 && pc.s17.normRank === 1
    && pc.s17.leadsBottomRank === 1 && pc.s17.leadsCount === 30 && pc.s17.unitRank === 1,
    `S-17 变量注入：原始倒数第 1 / 归一第 1 / 线索量倒数第 1（30 条）/ 单位产出第 1`);
  ok(pc.s18 != null && pc.s18.basis === 'relative_rank' && pc.s18.adviceBasis === 'absolute_line'
    && pc.s18.survivalMonths === 3,
    'S-18 绝对线警告：basis=relative_rank → 建议切绝对生存线（连续 3 月）');
  ok(pc.options.length === 3 && pc.options.map(o => o.label).join('|') === '换地盘观察一季|切换绝对生存线|仍坚持淘汰（留痕）',
    '三选项返回（永不自动执行）');
  const pc2 = await precheck(db, ctxM, { spId: 'M5' });
  ok(pc2.misfire === false && pc2.s17 === null, 'M5 jump=−1 < 3 → 无误杀警报（s17=null）');
  ok((await q(`select count(*)::int as n from override_events where tenant_id = $1`, [tM]))[0].n === 0,
    '预检纯读：override_events 零行（precheck 不落任何痕）');

  /* 🔴 [仍坚持淘汰]：仅留痕 + salespersons 前后快照零变化（逐列断言） */
  const before = await q(`select * from salespersons where tenant_id = $1 order by id`, [tM]);
  const ie = await insistEliminate(db, ctxM, { spId: 'J', note: '仍坚持淘汰' });
  ok(ie.ok === true && ie.logged === true && ie.changed === false, 'insistEliminate → 仅留痕（changed 恒 false）');
  const after = await q(`select * from salespersons where tenant_id = $1 order by id`, [tM]);
  ok(JSON.stringify(before) === JSON.stringify(after),
    '🔴 S-D10：salespersons 10 行全部列前后快照零变化（is_active/leave_date/… 原样）');
  const ov = await q(`select action, sp_id, m28_id, event_date::text as d, note, visible_to_all
    from override_events where tenant_id = $1`, [tM]);
  ok(ov.length === 1 && ov[0].action === 'insist_eliminate' && ov[0].sp_id === 'J'
    && ov[0].m28_id === null && ov[0].d === TEST_TODAY && ov[0].visible_to_all === true,
    'override_events +1（B 形 insist_eliminate，sp_id=J，全员可见）');
  ok(await esType(tM, 'elimination_insisted') === 1, '事件 elimination_insisted +1（双写）');
  const [ev] = await q(`select payload from event_stream where tenant_id = $1 and type = 'elimination_insisted'`, [tM]);
  const pj = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;
  ok(pj.action === 'insist_eliminate' && pj.spId === 'J' && pj.visibleToAll === true,
    '事件 payload = 行小驼峰投影（action/spId/visibleToAll）');

  /* insistEliminate 同受闸①锁（tE 无归一榜） */
  let lock2 = null;
  try { await insistEliminate(db, ctxE, { spId: 'E1' }); } catch (e) { lock2 = e; }
  ok(lock2 != null && lock2.code === 'A11_LOCKED'
    && (await q(`select count(*)::int as n from override_events where tenant_id = $1`, [tE]))[0].n === 0,
    '🔴 insistEliminate 同受 A11 锁：未归一化租户零留痕');
}

/* ================= ⑤ M36 卡线率（tB：待补录 → 补录 → 红 / <30 人天 → null） ================= */
console.log('— ⑤ M36：待补录你设的底线数 → setBaseline(50) → 42.5% 🔴 + 兑付标识；<30 人天 → null —');
{
  for (const s of ['B1', 'B2', 'B3', 'B4']) await mkSp(ctxB, s);

  const r0 = await bunchRate(db, ctxB, { metricName: 'leads' });
  ok(r0.pending === true && r0.reason === 'no_baseline' && r0.message === '待补录你设的底线数',
    '无任何基线 → "待补录你设的底线数"（不出卡线率）');

  /* 定价器信封 PendingEvidence 桩（云端同库直读：booked_date 带入、metric/baseline 留空） */
  await put(db, ctxB, 'process_baselines', { id: 'pb_imp', source: 'imported', booked_date: '2026-05-01' },
    'process_baseline_stub_imported');
  const r1 = await bunchRate(db, ctxB, { metricName: 'leads' });
  ok(r1.pending === true && r1.reason === 'imported_stub' && r1.message === '待补录你设的底线数',
    'imported 桩未补录 → 同显"待补录你设的底线数"（S-C04）');

  await setBaseline(db, ctxB, { pbId: 'pb_imp', metricName: 'leads', baselineValue: 50 });

  /* 10 人天（<30）→ rate null */
  const v1 = [50, 52, 55, 57, 20, 30, 40, 45, 60, 70];               // 4 落带
  for (let i = 0; i < 10; i++)
    await mkReport(ctxB, `dr_a${i}`, 'B1', `2026-06-${String(i + 1).padStart(2, '0')}`, v1[i]);
  const r2 = await bunchRate(db, ctxB, { metricName: 'leads' });
  ok(r2.pending === false && r2.rate === null && r2.reason === 'insufficient' && r2.manDays === 10,
    '🔴 10 人天 < minSample 30 → rate null（"—"，不硬造）');
  ok(JSON.stringify(r2.band) === JSON.stringify([50, 57]), '带 = [50, floor(50×1.15)=57]');

  /* +30 人天 → 40 人天 17 落带 = 42.5% > 40% 🔴 */
  const v2 = [50, 51, 52, 53, 54, 55, 56, 57, 50, 51];               // B2：10 落带
  const v3 = [52, 53, 54, 10, 20, 30, 40, 45, 48, 49];               // B3：3 落带
  const v4 = [58, 60, 65, 70, 75, 80, 85, 90, 95, 100];              // B4：0 落带
  for (let i = 0; i < 10; i++) {
    const d = `2026-06-${String(i + 1).padStart(2, '0')}`;
    await mkReport(ctxB, `dr_b${i}`, 'B2', d, v2[i]);
    await mkReport(ctxB, `dr_c${i}`, 'B3', d, v3[i]);
    await mkReport(ctxB, `dr_d${i}`, 'B4', d, v4[i]);
  }
  const r3 = await bunchRate(db, ctxB, { metricName: 'leads' });
  ok(r3.manDays === 40 && r3.inBand === 17 && near(r3.rate, 0.425) && r3.red === true,
    `卡线率 = 17/40 = 42.5% > 40% → 🔴 S-19（实际 ${r3.inBand}/${r3.total}=${r3.rate}）`);
  ok(r3.source === 'imported' && r3.redeemNote === '📌 预约于 2026-05-01 的证据，今日兑付。',
    '兑付标识：imported 已补录 → 卡顶"预约于 {bookedDate} 的证据，今日兑付"');

  /* 本地新建基线 + 中文别名解析（签约数 → contracts；计数全 0 → 0% 不红） */
  const sb = await setBaseline(db, ctxB, { metricName: '签约数', baselineValue: 10 });
  ok(sb.ok === true && sb.source === 'local' && sb.backfilled === false, 'setBaseline 本地新建（source=local）');
  const r4 = await bunchRate(db, ctxB, { metricName: '签约数' });
  ok(r4.field === 'contracts' && r4.manDays === 40 && r4.rate === 0 && r4.red === false,
    '中文别名 签约数 → contracts；40 人天 0 落带 → 0% 不红');
}

/* ================= ⑥ M23 提拔预测八维（tP：可算维有值 + 缺数维 null） ================= */
console.log('— ⑥ M23：requireM21 前置；八维恒 8 项，可算维有值、缺数维 null，boss 专属 —');
{
  await mkCat(ctxP, 'cat0', 0.5);
  for (const s of ['P1', 'P2', 'P3', 'P4']) await mkSp(ctxP, s);

  let lockErr = null;
  try { await promotionPredict(db, ctxP, { spId: 'P1' }); } catch (e) { lockErr = e; }
  ok(lockErr != null && lockErr.code === 'A11_LOCKED', '🔴 M21 未运行 → 提拔预测锁定（A11 锁清单）');

  await mkNorm(ctxP, 'P1', '2026-05', { normMargin: 1.0e6, norm: 1 });
  await mkNorm(ctxP, 'P1', '2026-06', { normMargin: 1.2e6, norm: 1 });
  await mkNorm(ctxP, 'P1', CUR, { normMargin: 0.8e6, norm: 2 });
  await mkNorm(ctxP, 'P2', CUR, { normMargin: 1.1e6, norm: 1 });
  await mkNorm(ctxP, 'P3', CUR, { normMargin: 0.5e6, norm: 3 });
  await mkNorm(ctxP, 'P4', CUR, { normMargin: 0.4e6, norm: 4 });
  const mkAck = (id, mgr, emp, status, at) => put(db, ctxP, 'coaching_acks',
    { id, manager_id: mgr, employee_id: emp, employee_ack_status: status, manager_reported_at: at },
    'coaching_ack_recorded');
  await mkAck('ak1', 'P1', 'P2', 'confirmed', '2026-07-01');
  await mkAck('ak2', 'P1', 'P3', 'confirmed', '2026-06-20');
  await mkAck('ak3', 'P1', 'P4', 'disputed', '2026-07-02');          // 未确认不计
  await mkAck('ak4', 'P2', 'P3', 'confirmed', '2026-07-01');         // 他人带教不计
  await mkDisc(ctxP, 'pd1', 'P1', '2026-06-15', 10000000, 1000000, 'competitive_pressure'); // P1 10%
  await mkDisc(ctxP, 'pd2', 'P2', '2026-06-16', 10000000, 200000, 'other');                 // 团队 6%
  await mkDeal(ctxP, 'pw1', 'P1', '2026-05-10', 10000000);
  await mkDeal(ctxP, 'pw2', 'P2', '2026-06-01', 10000000);
  await mkRefund(ctxP, 'pr1', 'P1', '2026-06-20', 'cat0', 500000);   // P1 退款率 5%，团队 2.5%
  await upsert(db, ctxP, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'person', target_id: 'P1', key: 'uer', period: CUR, value_num: 90000,
      value_json: { band: 'green' } }, 'derived_scalar_written', { touch: ['computed_at'] });

  const r = await promotionPredict(db, ctxP, { spId: 'P1' });
  const d = Object.fromEntries(r.dims.map(x => [x.key, x]));
  ok(r.dims.length === 8 && r.dims.map(x => x.no).join(',') === '1,2,3,4,5,6,7,8',
    '八维恒 8 项（顺序 = 3号 闸⑥ 原文）');
  ok(d.norm_rank.value === 2 && d.norm_rank.month === CUR,
    `① 归一排名 = 2（${CUR}，排名唯一合法输入）`);
  ok(d.customer_concentration.value === null && d.customer_concentration.computable === false,
    '② 客户集中度：云端无客户字段 → null（"—"，不硬造）');
  ok(near(d.monthly_variance.value, 0.16329931618554522, 1e-9) && d.monthly_variance.monthsObserved === 3,
    `③ 月度方差（CV）= σ/μ = 0.1633（3 个月归一化毛利 [100,120,80]万分位；实际 ${d.monthly_variance.value}）`);
  ok(d.coaching.value === 2, `④ 陪访带教 = 2（confirmed 且本人为带教方；disputed/他人不计；实际 ${d.coaching.value}）`);
  ok(d.achievement_vs_narcissism.value === null, '⑤ 成就vs自恋：无数据源 → null（"—"）');
  ok(near(d.discount_leak.value, 0.10) && near(d.discount_leak.teamRate, 0.06),
    `⑥ 折扣泄漏 = 10%（团队对照 6%，带均值让老板可验算）`);
  ok(near(d.complaint_refund.value, 0.05) && near(d.complaint_refund.teamRate, 0.025),
    `⑦ 客诉退款 = 5%（团队对照 2.5%）`);
  ok(d.uer.value === 90000 && d.uer.period === CUR, `⑧ UER = 90000 分（M32 落表读侧）`);
  ok(r.computableCount === 6, `可算维恰 6 项 + 缺数维 2 项 null（实际 ${r.computableCount}）`);
  ok(r.bossOnly === true && /−6%～−7\.5%/.test(r.qjeNote),
    '🔴 boss 专属标记 + S-08 有源量级（QJE −6%～−7.5%，非写死 −12%）');

  /* 缺数第二例：P3 无 UER / 无折扣记录 → 对应维 null（不硬造） */
  const r3 = await promotionPredict(db, ctxP, { spId: 'P3' });
  const d3 = Object.fromEntries(r3.dims.map(x => [x.key, x]));
  ok(d3.uer.value === null && d3.discount_leak.value === null && d3.monthly_variance.value === null,
    'P3：UER 未算 / 无折扣分母 / 仅 1 月归一史 → 三维 null（"—"）');
}

/* ================= ⑦ 事件双写抽查 ================= */
console.log('— ⑦ 事件双写抽查 —');
{
  ok(await esType(tM, 'elimination_insisted') === 1 && await esType(tM, 'm21_norm_written') === 10,
    'tM：elimination_insisted=1 / m21_norm_written=10');
  ok(await esType(tB, 'process_baseline_backfilled') === 1 && await esType(tB, 'process_baseline_set') === 1,
    'tB：process_baseline_backfilled=1 / process_baseline_set=1');
  ok(await esType(tB, 'daily_report_submitted') === 40, 'tB：daily_report_submitted=40（40 人天）');
  ok(await esType(tE, 'discount_entry_created') === 2 && await esType(tE, 'refund_entry_created') === 1,
    'tE：discount_entry_created=2 / refund_entry_created=1');
  ok(await esType(tP, 'coaching_ack_recorded') === 4, 'tP：coaching_ack_recorded=4');
}

await db.close();

/* ================= ⑧ 回归：C2–C8 不受影响 ================= */
console.log('— ⑧ 回归：spawnSync 跑 c2-model / c3 / c4 / c5 / c6 / c7 / c8 —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs', 'c4.test.mjs', 'c5.test.mjs', 'c6.test.mjs', 'c7.test.mjs', 'c8.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: 600000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C9 罪证层验收全部通过');
process.exit(failures ? 1 : 0);
