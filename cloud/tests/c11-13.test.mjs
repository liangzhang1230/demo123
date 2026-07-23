#!/usr/bin/env node
/* C11–C13 收官验收（v5.1 §12 末三行）：
   C11 白话原语（§10.10）：① 断开 AI 服务 → 全系统白话位静态回退零缺字（aiClient=null /
      complete 抛错 / 超时 → source='static'，无 'undefined' 无 '{var}' 残留，缺 var → '—'）
      ② 🔴 A-C07 出参审计：sanitizeForAI 白名单只放行数值/百分比/枚举码/日期；
      name/phone/clientName 剥离为 '员工A' 类占位；prompt 机检无原值
   C12 商业化（§10.4/§11）：③ boardsEnabled 板块级授权：关 dingjia → m7.computePlan 抛
      BOARD_DISABLED（yuren→m12.setRecipeSource / liuren→m29.computeIndices 同法）；开回放行
      ④ 到期降级（A-C05/授-2）：expireTenant(suspended) → writes.put/patch 拒
      （TENANT_SUSPENDED）→ 🔴 exportAll 仍成功出 5 信封；overdue 只提醒不锁写；
      seats 触发器不可变回归（改 user_id 拒）；seatUsage 占用 vs 配额
   C13 双向迁移（§2.2 / 公约【7】）：⑤ 环回：exportAll → 新租户 importEnvelopes(5) →
      关键汇总逐项对账（salespersons 数/deals 数/回款总额/ahc 值/M28 条数/日报/回执）；
      未知实体静默跳过；同 board 二次导入整条覆盖（行数不翻倍，含部分包收缩语义）
      ⑥ 导出信封 schema 合规：validateEnvelope 全过 + entities 键 ⊆ 公约实体白名单
   ⑦ 事件双写抽查；⑧ 回归 spawnSync c2–c10（c10 内嵌全量回归 ≈16min，timeout 单独放大）
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { put, patch } from '../server/writes.mjs';
import {
  TALK_TEMPLATES, renderTalk, sanitizeForAI, aiPolish, talkFor,
} from '../server/vernacular.mjs';
import {
  ALL_BOARDS, boardEnabled, requireBoard, setBoards, expireTenant, resumeTenant, seatUsage,
} from '../server/billing.mjs';
import { importEnvelopes, exportAll, ENTITY_TABLE, coefficientsHash } from '../server/migrate.mjs';
import { computePlan } from '../server/m7.mjs';
import { setRecipeSource } from '../server/m12.mjs';
import { computeIndices } from '../server/m29.mjs';
import { validateEnvelope } from '../domain/shared.mjs';
import { ENTITY_WHITELIST } from '../domain/yuren.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11

/* ================= ⓪ 静态断言 ================= */
console.log('— ⓪ 静态：零 new Date() / 模板量 / 写锁三口 / 🔴 exportAll 停机豁免机检 —');
{
  const NEW_FILES = ['vernacular.mjs', 'billing.mjs', 'migrate.mjs'];
  const clockHits = NEW_FILES.filter(f => /new Date\(/.test(readFileSync(join(root, 'server', f), 'utf8')));
  ok(clockHits.length === 0, 'C11–C13 三个服务模块零 new Date()（公约 C-14）', clockHits.join(','));

  ok(Object.keys(TALK_TEMPLATES).length === 5
    && ALL_BOARDS.every(b => TALK_TEMPLATES[b] && Object.keys(TALK_TEMPLATES[b]).length >= 3),
    '模板表：五板块齐全且每板块 ≥3 条内置话术码');

  const wsrc = readFileSync(join(root, 'server', 'writes.mjs'), 'utf8');
  ok((wsrc.match(/await assertTenantWritable\(db, ctx\)/g) || []).length === 3,
    'C12 业务写锁前置于 put/upsert/patch 三个写入口（恰 3 处）');

  /* 🔴 A-C05 豁免机检：migrate.mjs（含 exportAll）零 put(/patch(/requireBoard( 调用——
     停机与板块开关都拦不到导出 */
  const msrc = readFileSync(join(root, 'server', 'migrate.mjs'), 'utf8');
  ok(!/\bput\(|\bpatch\(|\brequireBoard\(/.test(msrc),
    '🔴 migrate.mjs 零 put(/patch(/requireBoard( 调用（导出永不被写锁/板块开关拦截）');
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
const cnt = async (t, table) => (await q(`select count(*)::int as n from ${table} where tenant_id = $1 and deleted_at is null`, [t]))[0].n;
const cntAll = async (t, table) => (await q(`select count(*)::int as n from ${table} where tenant_id = $1`, [t]))[0].n;

const tV = await mkTenant('C11·白话');
const tB = await mkTenant('C12·商业化');
const tM = await mkTenant('C13·迁移源');
const tN = await mkTenant('C13·迁移目标');
const ctx = (t, today = TEST_TODAY) => ({ tenantId: t, actorId: U.boss, today });
const ctxV = ctx(tV), ctxB = ctx(tB), ctxM = ctx(tM), ctxN = ctx(tN);

/* ================= ① C11 · 静态回退零缺字 ================= */
console.log('— ① 全部内置话术码静态渲染零缺字；AI 断开/抛错/超时 → static；正常 AI → ai —');
{
  let codes = 0;
  let bad = [];
  for (const [board, m] of Object.entries(TALK_TEMPLATES)) {
    for (const code of Object.keys(m)) {
      codes++;
      const r = renderTalk(code, {});                       // 模拟断开 AI + 零变量：最贫瘠输入
      if (!(r.board === board && r.text.length > 0
        && !r.text.includes('undefined') && !/\{[A-Za-z][A-Za-z0-9]*\}/.test(r.text)))
        bad.push(code);
      if (/\{[A-Za-z]/.test(TALK_TEMPLATES[board][code]) && !(r.missingVars.length > 0 && r.text.includes('—')))
        bad.push(code + ':dash');
    }
  }
  ok(bad.length === 0, `🔴 全部 ${codes} 条内置话术码零变量渲染：非空、无 undefined、无 {var} 残留、缺 var → '—'`, bad.join(','));

  const inj = renderTalk('W-07', { S1: 8, S6: 20, diff: 12, deadline: '2025-11-17' });
  ok(inj.text.includes('你以为招 8 个') && inj.text.includes('要招 20 个')
    && inj.text.includes('2025-11-17') && inj.missingVars.length === 0,
    `W-07 变量注入逐字生效（实际 ${inj.text.slice(0, 40)}…）`);
  const s02 = renderTalk('S-02', { A: '员工A', J: '员工J', imb: '70%' });
  ok(s02.text.includes('员工A') && s02.text.includes('70%') && s02.text.includes('—'),
    'S-02 三句杀手：部分变量注入 + 缺项 → — 不缺字');

  let e1 = null;
  try { renderTalk('W-99', {}); } catch (e) { e1 = e; }
  ok(e1 != null && e1.code === 'UNKNOWN_TALK_CODE', '未知话术码 → UNKNOWN_TALK_CODE');

  /* AI 三种失败路径 → 静态回退（源=static，文与 renderTalk 逐字一致） */
  const vars = { total: '568.2万', annual: '450万', expose: '461.2万' };
  const statics = renderTalk('W-14', vars).text;
  const r0 = await aiPolish(null, 'W-14', vars);
  ok(r0.source === 'static' && r0.text === statics && r0.fallbackReason === 'no_ai_client',
    '🔴 aiClient=null（断开 AI 服务）→ 静态回退，逐字等于 renderTalk');
  const r1 = await aiPolish({ name: 'boom', complete: async () => { throw new Error('AI down'); } }, 'W-14', vars);
  ok(r1.source === 'static' && r1.text === statics && r1.fallbackReason === 'ai_error',
    '🔴 complete 抛错 → 静态回退');
  const r2 = await aiPolish({ name: 'slow', complete: () => new Promise(() => {}) }, 'W-14', vars, { timeoutMs: 60 });
  ok(r2.source === 'static' && r2.text === statics && r2.fallbackReason === 'ai_timeout',
    '🔴 超时（60ms 竞速）→ 静态回退');
  const r3 = await aiPolish({ name: 'empty', complete: async () => '' }, 'W-14', vars);
  ok(r3.source === 'static' && r3.fallbackReason === 'empty_ai_reply', 'AI 返回空 → 静态回退');
  const r4 = await aiPolish({ name: 'mock', complete: async () => '润色后的白话版本' }, 'W-14', vars);
  ok(r4.source === 'ai' && r4.text === '润色后的白话版本', '正常 aiClient → source=ai + 润色文本');

  /* talkFor 统一出口 + 事件留痕（payload 零客户明细） */
  const t1 = await talkFor(db, ctxV, { module: 'dingjia', code: 'W-14', vars, aiClient: null });
  ok(t1.source === 'static' && await esType(tV, 'talk_rendered') === 1, 'talkFor：静态渲染 + talk_rendered 事件');
  const t2 = await talkFor(db, ctxV, { module: 'liuren', code: 'L-10b',
    vars: { amt: '30,000', hist: '30,000', trend: '38,000', g: '26.7%' },
    aiClient: { name: 'mock', complete: async () => '白话：这笔钱涨了但没涨到心里价。' } });
  ok(t2.source === 'ai' && await esType(tV, 'talk_rendered') === 2, 'talkFor：AI 渲染 + 事件累计 2');
  let e2 = null;
  try { await talkFor(db, ctxV, { module: 'yuren', code: 'W-14', vars: {} }); } catch (e) { e2 = e; }
  ok(e2 != null && e2.code === 'TALK_CODE_BOARD_MISMATCH', 'module 与话术码归属不符 → 拒');
  const evs = await q(`select payload from event_stream where tenant_id = $1 and type = 'talk_rendered'`, [tV]);
  ok(evs.every(r => {
    const raw = typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload);
    return !/30,000|38,000|568\.2/.test(raw);
  }), '🔴 talk_rendered 事件 payload 零 vars（不落任何业务数值/明细）');
}

/* ================= ② 🔴 A-C07 出参审计 ================= */
console.log('— ② A-C07：sanitizeForAI 白名单 + 标识剥离 + prompt 机检 —');
{
  const vars = { name: '王丽', phone: '13800138000', clientName: '客户王丽公司',
    S1: 8, S6: 20, diff: 12, deadline: '2025-11-17', cycle: 'short', ovr: '60.0%' };
  const s = sanitizeForAI(vars);
  const sj = JSON.stringify(s.vars);
  ok(!sj.includes('王丽') && !sj.includes('13800138000'),
    `🔴 sanitize 后零 '王丽' 零手机号（实际 ${sj.slice(0, 90)}…）`);
  ok(String(s.vars.name).startsWith('员工') && String(s.vars.clientName).startsWith('员工'),
    `标识字段脱敏为 '员工A' 类占位（实际 name=${s.vars.name} clientName=${s.vars.clientName}）`);
  ok(s.vars.S1 === 8 && s.vars.S6 === 20 && s.vars.deadline === '2025-11-17'
    && s.vars.cycle === 'short' && s.vars.ovr === '60.0%',
    '数值/日期/枚举码/百分比白名单放行原值');
  ok(s.stripped.length === 3 && s.stripped.map(x => x.key).sort().join(',') === 'clientName,name,phone',
    `剥离清单恰 3 项（实际 ${s.stripped.map(x => x.key)}）`);

  let seenPrompt = null;
  const client = { name: 'capture', complete: async p => { seenPrompt = p; return '润色OK'; } };
  const r = await aiPolish(client, 'W-07', vars);
  ok(r.source === 'ai' && seenPrompt != null, '正常 AI 路径走通（prompt 已捕获）');
  ok(!seenPrompt.includes('王丽') && !seenPrompt.includes('13800138000'),
    `🔴 A-C07 机检：prompt grep 无 '王丽' 无手机号`);
  ok(seenPrompt.includes('2025-11-17') && seenPrompt.includes('20') && seenPrompt.includes('short'),
    '脱敏数值与模板变量照发（AI 仍有素材可润色）');
  ok(r.prompt === seenPrompt, 'aiPolish 返回 prompt 可审计（出参审计留痕）');

  /* 手机号形值兜底：键名遮不住（如 contactInfo→c）也按值形剥离 */
  const s2 = sanitizeForAI({ x: '13912345678', y: 42 });
  ok(!JSON.stringify(s2.vars).includes('13912345678') && s2.vars.y === 42,
    '值形手机号（键名无标识特征）仍被剥离；数值照留');
}

/* ================= ③ C12 · boardsEnabled 板块级授权 ================= */
console.log('— ③ boardsEnabled：关 dingjia → computePlan 拒；开回 → 放行；yuren/liuren 同法 —');
const INPUTS_B4 = {
  cityTier: 'tier1', cycleTier: 'short', tierGrade: 'effective',
  targetPersonalMonthlyGrossAmt: 90000 * 100, nextYearTargetGrossAmt: 18000000 * 100,
  lastYearPerCapitaGrossAmt: 1000000 * 100,
  salesCount: 10, managerCount: 1, attritionRate: 0.30, hiringCycleDays: 45, blendedMarginRate: 0.30,
  complementLevel: 'partial', attributableLevel: 'partial',
};
{
  await q(`insert into subscriptions(tenant_id) values ($1)`, [tB]);          // 默认：五板块全开/配额5/active
  for (let i = 1; i <= 10; i++) await put(db, ctxB, 'salespersons',
    { id: `B${i}`, name: `B${i}`, level: 'sales', hire_date: '2025-01-01', is_active: true }, 'salesperson_created');
  await put(db, ctxB, 'salespersons',
    { id: 'BM1', name: 'BM1', level: 'manager', hire_date: '2025-01-01', is_active: true }, 'salesperson_created');

  ok(await boardEnabled(db, ctxB, 'dingjia') === true
    && await boardEnabled(db, ctx(tV), 'dingjia') === true,
    '默认全开：有订阅行（默认数组）与无订阅行（迁移期）均放行');
  const cp0 = await computePlan(db, ctxB, { inputs: INPUTS_B4, targetYearMode: 'this' });
  ok(cp0.result.B.S6 === 20, `开通时 computePlan 放行且口径不变（S6=20，实际 ${cp0.result.B.S6}）`);

  await setBoards(db, ctxB, { boards: ['zhaoren', 'suanzhang', 'liuren', 'yuren'] });   // 关 dingjia
  ok(await boardEnabled(db, ctxB, 'dingjia') === false, 'boards_enabled 已去 dingjia');
  let e1 = null;
  try { await computePlan(db, ctxB, { inputs: INPUTS_B4, targetYearMode: 'this' }); } catch (e) { e1 = e; }
  ok(e1 != null && e1.code === 'BOARD_DISABLED' && e1.board === 'dingjia',
    `🔴 关 dingjia → m7.computePlan 抛 BOARD_DISABLED（实际 ${e1 && e1.code}）`);

  await setBoards(db, ctxB, { boards: ['dingjia', 'suanzhang'] });             // 关 yuren + liuren
  let e2 = null;
  try { await setRecipeSource(db, ctxB, { sourceIds: ['B1'] }); } catch (e) { e2 = e; }
  ok(e2 != null && e2.code === 'BOARD_DISABLED' && e2.board === 'yuren',
    '关 yuren → m12.setRecipeSource 抛 BOARD_DISABLED（先于 M21 业务闸）');
  let e3 = null;
  try { await computeIndices(db, ctxB); } catch (e) { e3 = e; }
  ok(e3 != null && e3.code === 'BOARD_DISABLED' && e3.board === 'liuren',
    '关 liuren → m29.computeIndices 抛 BOARD_DISABLED');

  await setBoards(db, ctxB, { boards: ALL_BOARDS });                           // 全开回
  const cp1 = await computePlan(db, ctxB, { inputs: INPUTS_B4, targetYearMode: 'this' });
  ok(cp1.result.B.S6 === 20, '开回 → computePlan 重新放行');
  let e4 = null;
  try { await setBoards(db, ctxB, { boards: ['dingjia', 'nosuch'] }); } catch (e) { e4 = e; }
  ok(e4 != null && /未知板块/.test(e4.message), '未知板块名 → 拒');
  ok(await esType(tB, 'boards_updated') === 3, 'boards_updated 事件 3 条（改 3 次）');
}

/* ================= ④ C12 · 到期降级 + 席位 ================= */
console.log('— ④ 到期降级：overdue 不锁写 → suspended 锁写 → 🔴 exportAll 仍可用；seats 不可变 —');
{
  await q(`insert into seats(tenant_id, user_id) values ($1, $2), ($1, $3)`,
    [tB, U.boss, 'b1111111-0000-4000-8000-000000000001']);
  const su0 = await seatUsage(db, ctxB);
  ok(su0.used === 2 && su0.quota === 5 && su0.remaining === 3,
    `seatUsage：占用 2 / 配额 5 / 余 3（实际 ${su0.used}/${su0.quota}/${su0.remaining}）`);

  /* seats 触发器不可变回归 */
  let se1 = null;
  try { await q(`update seats set user_id = $2 where tenant_id = $1`, [tB, U.boss]); } catch (e) { se1 = e; }
  ok(se1 != null && /seat fields immutable/.test(se1.message), '🔴 seats 改 user_id → 触发器拒（席位流水不可变）');
  await q(`update seats set released_at = now() where tenant_id = $1 and user_id = $2`,
    [tB, 'b1111111-0000-4000-8000-000000000001']);
  let se2 = null;
  try { await q(`update seats set released_at = now() where tenant_id = $1 and user_id = $2`,
    [tB, 'b1111111-0000-4000-8000-000000000001']); } catch (e) { se2 = e; }
  ok(se2 != null && /immutable after release/.test(se2.message), '已释放席位行再改 → 拒（释放是终点）');
  const su1 = await seatUsage(db, ctxB);
  ok(su1.used === 1 && su1.totalRows === 2, '释放后占用 1、流水仍 2 行（append 语义）');

  /* overdue = 提醒期：写仍放行 */
  await expireTenant(db, ctxB, { status: 'overdue' });
  await put(db, ctxB, 'salespersons',
    { id: 'B11', name: 'B11', level: 'sales', hire_date: '2026-07-01', is_active: true }, 'salesperson_created');
  ok((await q(`select status from subscriptions where tenant_id = $1`, [tB]))[0].status === 'overdue'
    && await cnt(tB, 'salespersons') === 12,
    'overdue（到期提醒）→ 业务写仍放行（只降级不断粮）');

  /* suspended = 停机：业务写锁 */
  await expireTenant(db, ctxB);                          // 默认 suspended
  let w1 = null;
  try { await put(db, ctxB, 'salespersons',
    { id: 'B12', name: 'B12', level: 'sales', is_active: true }, 'salesperson_created'); } catch (e) { w1 = e; }
  ok(w1 != null && w1.code === 'TENANT_SUSPENDED', `🔴 suspended → writes.put 拒（实际 ${w1 && w1.code}）`);
  let w2 = null;
  try { await patch(db, ctxB, 'salespersons', 'id', 'B1', { name: 'X' }, 'salesperson_renamed'); } catch (e) { w2 = e; }
  ok(w2 != null && w2.code === 'TENANT_SUSPENDED', 'suspended → writes.patch 拒');
  ok(await cnt(tB, 'salespersons') === 12, '拒 = 零落库（行数不变）');

  /* 🔴 A-C05/授-2：停机状态下导出仍成功出 5 信封 */
  const exB = await exportAll(db, ctxB);
  ok(exB.envelopes.length === 5 && exB.envelopes.every(e => validateEnvelope(e).ok)
    && exB.envelopes.map(e => e.board).join(',') === ALL_BOARDS.join(','),
    '🔴 suspended 下 exportAll 仍出 5 个合法信封（数据可带走，机检 A-C05）');
  ok(exB.envelopes[1].entities.Salesperson.length === 12, '停机导出含全量人事档案（12 行）');
  await setBoards(db, ctxB, { boards: [] });             // 极端：五板块全关
  const exB2 = await exportAll(db, ctxB);
  ok(exB2.envelopes.length === 5, '五板块全关 → 导出照常（导出不在板块授权辖区）');
  await setBoards(db, ctxB, { boards: ALL_BOARDS });

  await resumeTenant(db, ctxB);                          // 续费恢复
  await put(db, ctxB, 'salespersons',
    { id: 'B12', name: 'B12', level: 'sales', hire_date: '2026-07-01', is_active: true }, 'salesperson_created');
  ok(await cnt(tB, 'salespersons') === 13, '续费（active）→ 业务写恢复，数据一字未动（授-4）');
}

/* ================= ⑤ C13 · 迁移源种子 + 环回 ================= */
console.log('— ⑤ 环回：tM 种子 → computeIndices(ahc=51) → exportAll → tN importEnvelopes → 对账 —');
let EXPORTED = null;
{
  /* —— tM 种子（AHC 口径与 c8 tG 同构 → 51；另加迁移面数据） —— */
  const mkSp = id => put(db, ctxM, 'salespersons',
    { id, name: `员${id}`, level: 'sales', hire_date: '2026-01-01', base_salary_amt: 3000000, is_active: true },
    'salesperson_created');
  for (let i = 1; i <= 10; i++) await mkSp(`G${i}`);
  await put(db, ctxM, 'categories', { id: 'cat0', name: '主品类', gross_margin_rate: 0.5 }, 'category_created');
  const dealAmts = [8000000, 12000000, 5000000, 20000000, 9000000, 6000000];   // 合计 60,000,000 分
  for (let i = 0; i < dealAmts.length; i++) await put(db, ctxM, 'deals',
    { id: `d${i + 1}`, employee_id: `G${(i % 3) + 1}`, deal_date: '2026-07-01', payment_amt: dealAmts[i],
      category_id: 'cat0', margin_rate_snapshot: 0.5, status: 'won', paid_date: '2026-07-01' }, 'deal_created');
  for (const [id, opts] of [['c1', { c: true, i: true }], ['c2', { c: true, i: true }], ['c3', { c: true }], ['c4', {}], ['c5', {}]])
    await put(db, ctxM, 'covenants', { id, employee_id: 'G1', lines: [], both_confirmed: !!opts.c, irrevocable: !!opts.i }, 'covenant_signed');
  for (let i = 1; i <= 10; i++) await put(db, ctxM, 'ledger_entries',
    { id: `lg${i}`, employee_id: 'G1', category: 'contract', promise_text: '承诺', achieved_at: '2026-06-20',
      honored_at: i <= 6 ? '2026-07-01' : null }, 'ledger_entry_appended');
  for (let i = 1; i <= 4; i++) await put(db, ctxM, 'boss_op_logs',
    { id: `td${i}`, ts: '2026-06-01', action: 'try_downgrade', target_id: 'm28_1' }, 'boss_op_logged');
  for (let i = 1; i <= 2; i++) await put(db, ctxM, 'boss_op_logs',
    { id: `rh${i}`, ts: '2026-06-01', action: 'ratchet_hit' }, 'boss_op_logged');
  await put(db, ctxM, 'm28_agreements', { id: 'm28_1', master_id: 'G1', kind: 'mentoring', rate: 0.05,
    duration_months: 12, start_trigger: 'apprentice_ramp_done', irrevocable: true }, 'm28_signed');
  await put(db, ctxM, 'm28_agreements', { id: 'm28_2', master_id: 'G2', kind: 'royalty', rate: 0.02,
    duration_months: 24, start_trigger: 'recipe_live', baseline_snapshot_amt: 5000000, irrevocable: true }, 'm28_signed');
  await put(db, ctxM, 'daily_reports', { id: 'dr1', employee_id: 'G1', report_date: TEST_TODAY,
    leads: 3, intents: 1, samples: 1, contracts: 1 }, 'daily_report_submitted');
  await put(db, ctxM, 'daily_reports', { id: 'dr2', employee_id: 'G2', report_date: TEST_TODAY,
    leads: 2, intents: 0, samples: 0, contracts: 0 }, 'daily_report_submitted');
  for (const [id, sp] of [['ack1', 'G1'], ['ack2', 'G2']]) await put(db, ctxM, 'coaching_acks',
    { id, coach_task_id: null, manager_id: 'GM', employee_id: sp, employee_ack_status: 'confirmed',
      duration_min: 60, manager_reported_at: '2026-07-10' }, 'coaching_ack_created');
  await put(db, ctxM, 'candidates', { id: 'cd1', name: '候选甲', phone: '13800000001',
    source_channel: 'referral', pool: 'interview', pool_entered_date: '2026-07-01' }, 'candidate_created');
  await put(db, ctxM, 'candidates', { id: 'cd2', name: '候选乙', phone: '13800000002',
    source_channel: 'boss_zhipin', pool: 'resume', pool_entered_date: '2026-07-05' }, 'candidate_created');
  await put(db, ctxM, 'interview_score_packs', { id: 'pk1', cand_id: 'cd1',
    scores: { achievement: 70, charisma: 55 }, scored_date: '2026-07-06' }, 'score_pack_created');
  await put(db, ctxM, 'practice_logs', { id: 'pl1', employee_id: 'G1', practice_date: '2026-01-05',
    scenario: 'opening', reviewer: 'manager', score: 80 }, 'practice_logged');
  await put(db, ctxM, 'hire_batches', { id: 'hb1', label: '2026-Q1', member_ids: ['G1', 'G2'] }, 'hire_batch_created');

  const ind = await computeIndices(db, ctxM);
  ok(ind.ahc.value === 51, `tM AHC = 51（domain.indices 唯一口径；实际 ${ind.ahc.value}）`);

  /* —— 导出 —— */
  EXPORTED = await exportAll(db, ctxM);
  const env = Object.fromEntries(EXPORTED.envelopes.map(e => [e.board, e]));
  ok(EXPORTED.envelopes.length === 5
    && EXPORTED.envelopes.map(e => e.board).join(',') === ALL_BOARDS.join(','),
    '导出 5 个信封，board 恰为五板块各一');
  ok(env.liuren.derived.ahc === 51 && env.liuren.entities.M28Agreement.length === 2,
    `🔴 liuren 双载荷：derived.ahc=51 + M28Agreement×2（🔧L-C11；实际 ${env.liuren.derived.ahc}/${env.liuren.entities.M28Agreement.length}）`);
  ok(env.suanzhang.entities.Deal.length === 6 && env.suanzhang.entities.Category.length === 1
    && ['realP90Factor', 'dvi', 'imbalanceRate', 'uerTeamMean'].every(k => k in env.suanzhang.derived),
    'suanzhang：Deal×6 + Category×1 + derived 四项键齐（无源 → null 不硬造）');
  ok(env.yuren.derived.coachingDoseActual === 0.2,
    `yuren：辅导剂量 derived = 0.2h/人月（2h÷10人×30/30；实际 ${env.yuren.derived.coachingDoseActual}）`);
  ok(env.zhaoren.entities.Salesperson.length === 10 && env.zhaoren.entities.Candidate.length === 2,
    'zhaoren：Salesperson×10 + Candidate×2');
  ok(EXPORTED.coefficientsHash === coefficientsHash() && env.dingjia.coefficientsHash === EXPORTED.coefficientsHash,
    '系数表指纹随包（导入侧校验一致性，不阻断）');

  /* —— ⑥ 信封 schema 合规（回落单机版验证） —— */
  const badEnt = [];
  for (const e of EXPORTED.envelopes) {
    if (!validateEnvelope(e).ok) badEnt.push(e.board + ':schema');
    for (const k of Object.keys(e.entities)) if (!ENTITY_WHITELIST.includes(k)) badEnt.push(`${e.board}:${k}`);
    if (e.exportedAt !== TEST_TODAY || e.dataVersion !== 1) badEnt.push(e.board + ':meta');
    if ('externalRef' in e.entities || 'ExternalRef' in e.entities) badEnt.push(e.board + ':xref');
  }
  ok(badEnt.length === 0,
    '🔴 ⑥ 五信封 validateEnvelope 全过 + entities 键全在公约实体白名单内 + ExternalRef 永不进信封', badEnt.join(','));

  /* —— 导入 tN（模拟单机 5 信封上传）+ 汇总逐项对账 —— */
  const imp = await importEnvelopes(db, ctxN, { envelopes: EXPORTED.envelopes });
  ok(imp.ok && imp.results.length === 5 && imp.results.every(r => r.ok && r.rowErrors.length === 0),
    `五信封导入全 ok 零行错（实际 ${JSON.stringify(imp.results.map(r => ({ b: r.board, e: r.rowErrors.length })))}）`);
  ok(await cnt(tN, 'salespersons') === 10, `对账①：salespersons 数 = 10（实际 ${await cnt(tN, 'salespersons')}）`);
  ok(await cnt(tN, 'deals') === 6, `对账②：deals 数 = 6（实际 ${await cnt(tN, 'deals')}）`);
  const sumM = (await q(`select coalesce(sum(payment_amt),0)::bigint as s from deals where tenant_id = $1 and deleted_at is null`, [tM]))[0].s;
  const sumN = (await q(`select coalesce(sum(payment_amt),0)::bigint as s from deals where tenant_id = $1 and deleted_at is null`, [tN]))[0].s;
  ok(String(sumM) === String(sumN) && Number(sumN) === 60000000,
    `对账③：回款总额一致 = 60,000,000 分（实际 ${sumM}/${sumN}）`);
  const refL = await q(`select derived from external_refs where tenant_id = $1 and board = 'liuren'`, [tN]);
  const dL = typeof refL[0].derived === 'string' ? JSON.parse(refL[0].derived) : refL[0].derived;
  ok(dL.ahc === 51, `对账④：ahc 经 external_refs 整条覆盖落地 = 51（实际 ${dL.ahc}）`);
  ok(await cnt(tN, 'm28_agreements') === 2, `对账⑤：M28 条数 = 2（实际 ${await cnt(tN, 'm28_agreements')}）`);
  ok(await cnt(tN, 'daily_reports') === 2 && await cnt(tN, 'coaching_acks') === 2,
    '对账⑥：日报×2 / 辅导回执×2（域形→表形适配落地）');
  ok(await cnt(tN, 'ledger_entries') === 10 && await cnt(tN, 'covenants') === 5
    && await cnt(tN, 'candidates') === 2 && await cnt(tN, 'practice_logs') === 1,
    '对账⑦：履约总账×10 / 合约×5 / 候选×2 / 练习×1');
  ok((await q(`select count(*)::int as n from external_refs where tenant_id = $1`, [tN]))[0].n === 5,
    'external_refs：五 board 各一行（(tenant,board) 唯一）');
  const [dr] = await q(`select leads, intents, contracts from daily_reports where tenant_id = $1 and id = 'dr1'`, [tN]);
  ok(dr.leads === 3 && dr.intents === 1 && dr.contracts === 1, '日报四计数逐值一致（counts 域形展开）');

  /* —— 未知实体静默跳过 —— */
  const alien = await importEnvelopes(db, ctxN, { envelopes: [{
    schema: 'skab_v1', board: 'dingjia', exportedAt: TEST_TODAY, dataVersion: 1, coefficientsHash: '',
    derived: { alienScalar: 1 }, entities: { AlienEntity: [{ id: 'x1' }], M21Norm: [{ spId: 'G1' }], Category: [] },
  }] });
  ok(alien.ok && alien.results[0].skippedEntities.includes('AlienEntity')
    && alien.results[0].skippedEntities.includes('M21Norm'),
    '未知实体 AlienEntity + 派生视图 M21Norm → 静默跳过（向前兼容）');
  ok(await cnt(tN, 'deals') === 6 && await cnt(tN, 'salespersons') === 10, '跳过 = 其余数据零扰动');

  /* —— 同 board 二次导入 = 整条覆盖（行数不翻倍；部分包收缩语义） —— */
  const sz = env.suanzhang;
  const partial = { ...sz, entities: { Deal: sz.entities.Deal.slice(0, 3), Category: sz.entities.Category } };
  await importEnvelopes(db, ctxN, { envelopes: [partial] });
  ok(await cnt(tN, 'deals') === 3 && await cntAll(tN, 'deals') === 6,
    `🔴 部分包二次导入 → 整条覆盖：活跃 3（其余软删），总行 6（实际 ${await cnt(tN, 'deals')}/${await cntAll(tN, 'deals')}）`);
  await importEnvelopes(db, ctxN, { envelopes: [sz] });
  ok(await cnt(tN, 'deals') === 6 && await cntAll(tN, 'deals') === 6,
    `🔴 全量包三次导入 → 行数不翻倍：活跃 6 / 总行仍 6（实际 ${await cnt(tN, 'deals')}/${await cntAll(tN, 'deals')}）`);
  const sumN2 = (await q(`select coalesce(sum(payment_amt),0)::bigint as s from deals where tenant_id = $1 and deleted_at is null`, [tN]))[0].s;
  ok(Number(sumN2) === 60000000, '覆盖后回款总额复位一致');

  /* 同一批内 board 重复 → 拒 */
  let dup = null;
  try { await importEnvelopes(db, ctxN, { envelopes: [sz, sz] }); } catch (e) { dup = e; }
  ok(dup != null && /board 重复/.test(dup.message), '同一批内 board 重复 → 拒（board 须各异）');
  /* 非信封 → 该包拒收不落库，其余照常 */
  const badEnv = await importEnvelopes(db, ctxN, { envelopes: [{ schema: 'nope', board: 'dingjia' }] });
  ok(badEnv.ok === false && badEnv.results[0].ok === false && badEnv.results[0].reason === 'schema',
    '非 skab_v1 → 拒收该包（reason=schema）');
}

/* ================= ⑦ 事件双写抽查 ================= */
console.log('— ⑦ 事件双写抽查 —');
{
  ok(await esType(tM, 'envelopes_exported') === 1 && await esType(tB, 'envelopes_exported') === 2,
    'envelopes_exported：tM=1 / tB=2（停机导出照记事件）');
  ok(await esType(tN, 'envelope_imported') === 8,
    `envelope_imported：tN=8（首批5 + 未知实体1 + 覆盖2；实际 ${await esType(tN, 'envelope_imported')}）`);
  ok(await esType(tB, 'tenant_expired') === 2 && await esType(tB, 'tenant_resumed') === 1,
    'tenant_expired=2（overdue+suspended）/ tenant_resumed=1');
  ok(await esType(tV, 'talk_rendered') === 2, 'talk_rendered=2（白话位留痕）');
  const [ev] = await q(`select payload from event_stream
    where tenant_id = $1 and type = 'envelope_imported' and target_id = 'suanzhang'
    order by event_id desc limit 1`, [tN]);
  const pj = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;
  ok(Array.isArray(pj.inserted.deals) && pj.inserted.deals.length === 6 && pj.coefficientsHashMatch === true,
    '导入事件 payload 含落表 id 清单（覆盖依据可复算）+ 系数指纹核对');
}

await db.close();

/* ================= ⑧ 回归：spawnSync c2–c10 ================= */
console.log('— ⑧ 回归：c2–c9（timeout 900s）+ c10（内嵌全量回归 ≈16min，timeout 1800s） —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs', 'c4.test.mjs', 'c5.test.mjs',
  'c6.test.mjs', 'c7.test.mjs', 'c8.test.mjs', 'c9.test.mjs', 'c10.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)],
    { encoding: 'utf8', timeout: f === 'c10.test.mjs' ? 1800000 : 900000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C11–C13 收官验收全部通过');
process.exit(failures ? 1 : 0);
