#!/usr/bin/env node
/* C10 推送层验收（v5.1 §12 C10 行：插卡总线 / 早报 / 播报 / action_card 状态机）：
   ⓪ 静态：cardbus/briefing 零 new Date()；🔴 唯一插卡入口机检——
      `insert into action_cards` 全 server 目录仅 cardbus.mjs 一处
   ① 🔴 插卡两级限流（§1.2/§5.3）：8 源同日（4 alert 不同 kind + 4 todo）→
      todayCards：alert 展示恰 3（按 KIND_PRIORITY）+折叠 1、todo 全展示；
      再插 4 张 alert → 折叠累计 5；折叠卡仍落库可查；sales 角色只见本人 todo
   ② 防疲劳：同 tenant+dedupKey 30 天内二次插入 → skipped:'cooldown'（含已完成卡
      时间冷却）；31 天后放行；跨租户不串（隔离）
   ③ 状态机（§10.8/§4）：pending→doing 跳态拒；pending→assigned→doing→done
      顺序过 + trail 4 条（created+3 次流转）；回退拒；done→filled 过；
      sales 角色 transition → 拒（FORBIDDEN）；非成员 → 拒
   ④ 🔴 休息日零推送（§10.9）：周日（shift '*' weekday0 休）morningBrief→null
      且 push_log 零行；工作日 → 出早报 + push_log 1 行；同日重发 → 跳过（行数不变）
   ⑤ 早报内容（五板块内容源，有数则出无数则省略）：未填报者 → 点名名单出现
      （m1.missingToday 唯一口径）；全填 → 点名段省略；昨日成交/回款计数；
      角色裁剪（boss 见 alert 摘要 / sales 只见本人 todo）；四灯/守护线无数 → 段省略
   ⑥ 🔴 播报剥金额（A-13）：payload 含 amountAmt/quota（含嵌套）→ 落库后
      grep /amt|amount|quota/i 零命中；dedupKey 防重复播报
   ⑦ 改线回归：spawnSync c5（calibrate）、c8（offboard）语义保持
   ⑧ 事件双写抽查；⑨ 回归 spawnSync c2/c3/c4/c6/c7/c9（c5、c8 已在 ⑦）
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13（周一）；周日=2026-07-12 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { put } from '../server/writes.mjs';
import { submitDailyReport } from '../server/m1.mjs';
import {
  insertCard, todayCards, transition, KIND_PRIORITY, ALERT_DAILY_LIMIT, STATE_ORDER,
} from '../server/cardbus.mjs';
import { morningBrief, sendBrief, broadcast, stripMoney } from '../server/briefing.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11：周一
const SUNDAY = '2026-07-12';                     // 周日（weekdayOf=0）

/* ================= ⓪ 静态断言 ================= */
console.log('— ⓪ 静态：零 new Date() + 🔴 唯一插卡入口（insert into action_cards 仅 cardbus） —');
{
  const C10_FILES = ['cardbus.mjs', 'briefing.mjs'];
  const clockHits = C10_FILES.filter(f => /new Date\(/.test(readFileSync(join(root, 'server', f), 'utf8')));
  ok(clockHits.length === 0, 'C10 两个服务模块零 new Date()（业务日期一律 ctx.today）', clockHits.join(','));

  const offenders = [];
  for (const f of readdirSync(join(root, 'server')).filter(f => f.endsWith('.mjs'))) {
    const src = readFileSync(join(root, 'server', f), 'utf8');
    if (f !== 'cardbus.mjs' && /insert\s+into\s+action_cards/i.test(src)) offenders.push(f);
  }
  ok(offenders.length === 0,
    '🔴 唯一插卡入口：`insert into action_cards` 全 server 目录仅 cardbus.mjs（calibrate/m37_38/m15 已收口）',
    offenders.join(','));
  ok(KIND_PRIORITY.length === 10 && new Set(KIND_PRIORITY).size === 10 && ALERT_DAILY_LIMIT === 3
    && STATE_ORDER.join('→') === 'pending→assigned→doing→done→filled',
    '常量：优先级恰 10 kind（§4 枚举全覆盖）/ alert 日限 3 / 状态序 5 态');
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
const U = {
  boss: 'a0000000-0000-4000-8000-00000000000a',
  mgrS: 'b0000000-0000-4000-8000-000000000001',
  saleS: 'b0000000-0000-4000-8000-000000000002',
  bossB: 'c0000000-0000-4000-8000-000000000001',
  saleB: 'c0000000-0000-4000-8000-000000000002',
  saleC: 'd0000000-0000-4000-8000-000000000001',
};
const mkTenant = async name => (await q(`insert into tenants(name, created_by) values ($1, $2) returning id`, [name, U.boss]))[0].id;
const mkMember = (t, uid, role, spId = null) => q(
  `insert into members(user_id, tenant_id, role, sp_id) values ($1,$2,$3,$4)`, [uid, t, role, spId]);
const esType = async (t, type) => (await q(`select count(*)::int as n from event_stream where tenant_id = $1 and type = $2`, [t, type]))[0].n;
const pushRows = async t => (await q(`select count(*)::int as n from push_log where tenant_id = $1`, [t]))[0].n;

const tC = await mkTenant('C10·插卡限流');
const tD = await mkTenant('C10·防疲劳');
const tD2 = await mkTenant('C10·防疲劳隔离');
const tS = await mkTenant('C10·状态机');
const tB = await mkTenant('C10·早报');
const tX = await mkTenant('C10·播报');
const ctx = (t, actor = U.boss, today = TEST_TODAY) => ({ tenantId: t, actorId: actor, today });
const ctxC = ctx(tC), ctxD = ctx(tD), ctxD2 = ctx(tD2), ctxS = ctx(tS), ctxB = ctx(tB), ctxX = ctx(tX);

/* ================= ① 🔴 插卡两级限流（8 源同日） ================= */
console.log('— ① 8 源同日：alert 恰 3 展示（按优先级）+ 折叠累计 5；todo 不限量；sales 裁剪 —');
{
  /* 第一波 4 张 alert（不同 kind，插入序故意与优先级不同序） */
  const a1 = await insertCard(db, ctxC, { kind: 'coaching', level: 'alert', payload: { src: 's1' } });
  const a2 = await insertCard(db, ctxC, { kind: 'spotcheck', level: 'alert', payload: { src: 's2' } });
  const a3 = await insertCard(db, ctxC, { kind: 'stopbleed', level: 'alert', payload: { src: 's3' } });
  const a4 = await insertCard(db, ctxC, { kind: 'retain', level: 'alert', payload: { src: 's4' } });
  ok(!a1.folded && !a2.folded && !a3.folded && a4.folded === true,
    '第 4 张 alert 起 folded=true（当日已展示满 3 张）');

  /* 4 张 todo（2 张指派 saleC）：不限量 */
  await insertCard(db, ctxC, { kind: 'talk', level: 'todo', targetId: 'T1', assignedTo: U.saleC, payload: { src: 's5' } });
  await insertCard(db, ctxC, { kind: 'honor', level: 'todo', assignedTo: U.saleC, payload: { src: 's6' } });
  await insertCard(db, ctxC, { kind: 'expand', level: 'todo', payload: { src: 's7' } });
  await insertCard(db, ctxC, { kind: 'newhire_judge', level: 'todo', payload: { src: 's8' } });

  const v1 = await todayCards(db, ctxC, { role: 'boss' });
  ok(v1.alerts.shown.length === 3
    && v1.alerts.shown.map(c => c.kind).join(',') === 'stopbleed,coaching,spotcheck',
    `🔴 alert 展示恰 3 张且按固定优先级（实际 ${v1.alerts.shown.map(c => c.kind)}）`);
  ok(v1.alerts.folded.length === 1 && v1.alerts.folded[0].kind === 'retain',
    '第 4 张（retain）进折叠区');
  ok(v1.todos.length === 4 && v1.todos.map(c => c.kind).join(',') === 'talk,honor,expand,newhire_judge',
    `🔴 todo 级不受限：4 张全展示（按优先级；实际 ${v1.todos.map(c => c.kind)}）`);

  /* 第二波再插 4 张 alert → 全折叠，累计 5 */
  for (const k of ['salary_review', 'talk', 'eliminate', 'newhire_judge']) {
    const r = await insertCard(db, ctxC, { kind: k, level: 'alert', payload: { src: 'wave2' } });
    ok(r.folded === true, `第二波 alert(${k}) folded=true`);
  }
  const v2 = await todayCards(db, ctxC, { role: 'boss' });
  ok(v2.alerts.shown.length === 3 && v2.alerts.folded.length === 5,
    `🔴 8 张 alert 同日 → 展示恰 3 + 折叠 5（实际 ${v2.alerts.shown.length}/${v2.alerts.folded.length}）`);
  ok(v2.alerts.folded.map(c => c.kind).join(',') === 'retain,talk,salary_review,eliminate,newhire_judge',
    `折叠区亦按优先级排（实际 ${v2.alerts.folded.map(c => c.kind)}）`);
  ok((await q(`select count(*)::int as n from action_cards where tenant_id = $1`, [tC]))[0].n === 12,
    '折叠卡仍落库可查：12 张全在 action_cards（8 alert + 4 todo）');

  /* 角色裁剪：sales 只见 assignedTo 本人的 todo 卡；alert 是管理层的 */
  const vs = await todayCards(db, ctxC, { role: 'sales', userId: U.saleC });
  ok(vs.todos.length === 2 && vs.todos.every(c => c.assignedTo === U.saleC)
    && vs.alerts.shown.length === 0 && vs.alerts.folded.length === 0,
    '🔴 sales 只见本人 todo 卡（2 张）；alert 零可见');
}

/* ================= ② 防疲劳（dedupKey + cooldownDays） ================= */
console.log('— ② 防疲劳：同 dedupKey 30 天内二次插入 skipped；31 天后放行；跨租户不串 —');
{
  const b1 = await insertCard(db, ctxD, { kind: 'retain', level: 'alert', targetId: 'R1',
    dedupKey: 'R1', cooldownDays: 30, payload: { note: 'first' } });
  ok(b1.cardId != null && !b1.skipped, '首插成功');
  const b2 = await insertCard(db, ctxD, { kind: 'retain', level: 'alert', targetId: 'R1',
    dedupKey: 'R1', cooldownDays: 30, payload: { note: 'again' } });
  ok(b2.skipped === 'cooldown' && b2.existingCardId === b1.cardId,
    `🔴 同 dedupKey 30 天内二次插入 → {skipped:'cooldown', existingCardId}（实际 ${JSON.stringify(b2)}）`);
  ok((await q(`select count(*)::int as n from action_cards where tenant_id = $1`, [tD]))[0].n === 1
    && await esType(tD, 'action_card_created') === 1,
    '跳过 = 零落库零事件（卡 1 张、事件 1 条）');

  /* 已完成卡仍受时间冷却（防疲劳 ≠ 只看 pending） */
  await q(`update action_cards set state = 'done' where tenant_id = $1 and card_id = $2`, [tD, b1.cardId]);
  const b3 = await insertCard(db, ctxD, { kind: 'retain', level: 'alert', targetId: 'R1',
    dedupKey: 'R1', cooldownDays: 30, payload: {} });
  ok(b3.skipped === 'cooldown', '卡已 done 但同日仍在 30 天冷却内 → skipped');
  const b5 = await insertCard(db, { ...ctxD, today: '2026-08-13' }, { kind: 'retain', level: 'alert',
    targetId: 'R1', dedupKey: 'R1', cooldownDays: 30, payload: {} });
  ok(!b5.skipped && b5.cardId != null, '31 天后（2026-08-13）同 dedupKey 放行');

  const b4 = await insertCard(db, ctxD2, { kind: 'retain', level: 'alert', targetId: 'R1',
    dedupKey: 'R1', cooldownDays: 30, payload: {} });
  ok(!b4.skipped && b4.cardId != null, '跨租户同 dedupKey 不串（A-C01 隔离）');
}

/* ================= ③ 状态机（顺序校验 + trail + 角色） ================= */
console.log('— ③ 状态机：跳态拒 / 顺序过 + trail / 回退拒 / sales 拒 / 非成员拒 —');
{
  await mkMember(tS, U.mgrS, 'manager');
  await mkMember(tS, U.saleS, 'sales');
  const cA = await insertCard(db, ctxS, { kind: 'coaching', level: 'todo', payload: {} });
  const cB = await insertCard(db, ctxS, { kind: 'talk', level: 'todo', payload: {} });
  const ctxMgr = ctx(tS, U.mgrS), ctxSale = ctx(tS, U.saleS);

  let e1 = null;
  try { await transition(db, ctxMgr, { cardId: cA.cardId, toState: 'doing' }); } catch (e) { e1 = e; }
  ok(e1 != null && e1.code === 'BAD_TRANSITION', `🔴 pending→doing 跳态拒（${e1 && e1.message}）`);

  const t1 = await transition(db, ctxMgr, { cardId: cA.cardId, toState: 'assigned' });
  const t2 = await transition(db, ctxMgr, { cardId: cA.cardId, toState: 'doing' });
  const t3 = await transition(db, ctxMgr, { cardId: cA.cardId, toState: 'done' });
  ok(t1.from === 'pending' && t2.from === 'assigned' && t3.from === 'doing' && t3.to === 'done',
    'pending→assigned→doing→done 顺序流转全过');
  const [rowA] = await q(`select state, trail from action_cards where tenant_id = $1 and card_id = $2`, [tS, cA.cardId]);
  const trail = typeof rowA.trail === 'string' ? JSON.parse(rowA.trail) : rowA.trail;
  ok(rowA.state === 'done' && trail.length === 4
    && trail[0].action === 'created'
    && trail.slice(1).map(t => `${t.from}>${t.to}`).join(',') === 'pending>assigned,assigned>doing,doing>done'
    && trail.every(t => t.at === TEST_TODAY && t.by != null),
    `🔴 trail 留痕 4 条（created + 3 次流转，含 at/by；实际 ${trail.length}）`);

  let e2 = null;
  try { await transition(db, ctxMgr, { cardId: cA.cardId, toState: 'doing' }); } catch (e) { e2 = e; }
  ok(e2 != null && e2.code === 'BAD_TRANSITION', 'done→doing 回退拒');
  const t4 = await transition(db, ctxMgr, { cardId: cA.cardId, toState: 'filled' });
  ok(t4.to === 'filled', 'done→filled 过（终态；5 态走满）');

  let e3 = null;
  try { await transition(db, ctxSale, { cardId: cB.cardId, toState: 'assigned' }); } catch (e) { e3 = e; }
  const [rowB] = await q(`select state from action_cards where tenant_id = $1 and card_id = $2`, [tS, cB.cardId]);
  ok(e3 != null && e3.code === 'FORBIDDEN' && rowB.state === 'pending',
    '🔴 sales 角色 transition → 拒（FORBIDDEN，状态不动——A-C04 服务层复核）');
  let e4 = null;
  try { await transition(db, ctxS, { cardId: cB.cardId, toState: 'assigned' }); } catch (e) { e4 = e; }
  ok(e4 != null && e4.code === 'FORBIDDEN', '非租户成员 transition → 拒');
}

/* ================= ④/⑤ 早报：休息日零推送 + 内容组装 ================= */
console.log('— ④ 休息日零推送 + 同日重发跳过；⑤ 点名名单出现/省略 + 角色裁剪 —');
{
  await mkMember(tB, U.bossB, 'boss');
  await mkMember(tB, U.saleB, 'sales', 'S1');
  const mkSp = id => put(db, ctxB, 'salespersons',
    { id, name: id, level: 'sales', hire_date: '2026-01-01', is_active: true }, 'salesperson_created');
  await mkSp('S1'); await mkSp('S2');
  await put(db, ctxB, 'shift_configs', { id: 'sw0', employee_id: '*', weekday: 0, is_workday: false },
    'shift_config_set');                                              // '*' 兜底：周日休（显式）
  await put(db, ctxB, 'categories', { id: 'cat0', name: 'cat0', gross_margin_rate: 0.5 }, 'category_created');
  await put(db, ctxB, 'deals', { id: 'dB1', employee_id: 'S1', deal_date: SUNDAY, payment_amt: 8000000,
    category_id: 'cat0', margin_rate_snapshot: 0.5, status: 'won', paid_date: SUNDAY }, 'deal_created');

  /* —— ④ 周日：零推送 —— */
  const ctxSun = ctx(tB, U.boss, SUNDAY);
  ok(await morningBrief(db, ctxSun, { userId: U.saleB }) === null
    && await morningBrief(db, ctxSun, { userId: U.bossB }) === null,
    '🔴 周日（shift * weekday0 休）→ morningBrief 恒 null（sales 与 boss 皆零推送）');
  const sSun = await sendBrief(db, ctxSun, { userId: U.saleB });
  ok(sSun.sent === false && sSun.skipped === 'restday' && await pushRows(tB) === 0,
    '🔴 休息日 sendBrief → 跳过且 push_log 零行');

  /* —— ⑤ 周一：内容组装（S1 已填、S2 未填 + 1 alert + 1 todo 卡） —— */
  await submitDailyReport(db, ctxB, { employeeId: 'S1', date: TEST_TODAY, counts: { leads: 3, contracts: 1 } });
  await insertCard(db, ctxB, { kind: 'stopbleed', level: 'alert', targetId: 'S2', payload: { src: 'm18' } });
  await insertCard(db, ctxB, { kind: 'coaching', level: 'todo', assignedTo: U.saleB, targetId: 'S1', payload: { src: 'm12' } });

  const bb = await morningBrief(db, ctxB, { userId: U.bossB });
  ok(bb != null && bb.role === 'boss' && bb.date === TEST_TODAY, '工作日（周一）→ 老板早报生成');
  ok(bb.sections.yesterday && bb.sections.yesterday.dealCount === 1 && bb.sections.yesterday.paidCount === 1
    && !('amountSum' in (bb.sections.yesterday || {})),
    `① 昨日成交/回款计数 = 1/1（仅计数无金额；实际 ${JSON.stringify(bb.sections.yesterday)}）`);
  ok(Array.isArray(bb.sections.missing) && bb.sections.missing.length === 1
    && bb.sections.missing[0].employeeId === 'S2',
    `🔴 ② 点名名单 = 日报未填报者 S2（m1.missingToday 唯一口径；实际 ${JSON.stringify(bb.sections.missing)}）`);
  ok(bb.sections.cards && bb.sections.cards.top.length === 2
    && bb.sections.cards.top[0].kind === 'stopbleed' && bb.sections.cards.top[1].kind === 'coaching'
    && bb.sections.cards.foldedCount === 0,
    '③ 插卡摘要：boss 见 alert 优先 + todo（前 3）');
  ok(bb.sections.fourLights === undefined && bb.sections.guard === undefined,
    '④⑤ 四灯无红 / 无方案版本（守护线 null）→ 两段省略（无数则省略）');

  const bs = await morningBrief(db, ctxB, { userId: U.saleB });
  ok(bs != null && bs.sections.cards && bs.sections.cards.top.length === 1
    && bs.sections.cards.top[0].kind === 'coaching',
    '🔴 sales 早报角色裁剪：只见本人 todo 卡（alert 不可见）');
  ok(bs.sections.yesterday === undefined, 'sales 早报无经营计数段（管理段裁剪）');

  /* —— ④ 发送 + 防重复 —— */
  const s1 = await sendBrief(db, ctxB, { userId: U.bossB });
  ok(s1.sent === true && await pushRows(tB) === 1, '工作日 sendBrief → push_log 1 行');
  const [pr] = await q(`select channel, kind, target_user, dedup_key from push_log where tenant_id = $1`, [tB]);
  ok(pr.channel === 'inapp' && pr.kind === 'morning_brief' && pr.target_user === U.bossB
    && pr.dedup_key === `brief_${U.bossB}_${TEST_TODAY}`,
    `push_log 行：inapp / morning_brief / dedup_key=brief_{userId}_{today}（实际 ${pr.dedup_key}）`);
  const s2 = await sendBrief(db, ctxB, { userId: U.bossB });
  ok(s2.sent === false && s2.skipped === 'duplicate' && await pushRows(tB) === 1,
    '🔴 同日重发 → 跳过（push_log 行数不变）');

  /* —— ⑤ 全员已填 → 点名段省略 —— */
  await submitDailyReport(db, ctxB, { employeeId: 'S2', date: TEST_TODAY, counts: { leads: 2 } });
  const bb2 = await morningBrief(db, ctxB, { userId: U.bossB });
  ok(bb2.sections.missing === undefined, '🔴 日报全填 → 点名段省略（键不存在）');
}

/* ================= ⑥ 播报剥金额（A-13） ================= */
console.log('— ⑥ 播报：amountAmt/quota（含嵌套）落库前剥离；dedupKey 防重复 —');
{
  ok(JSON.stringify(stripMoney({ a: 1, amountAmt: 2, quota: 3, d: { bonusAmt: 4, keep: 5 }, arr: [{ 配额: 6, x: 7 }] }))
    === JSON.stringify({ a: 1, d: { keep: 5 }, arr: [{ x: 7 }] }),
    'stripMoney：顶层/嵌套/数组内的金额与配额键全剥离');

  const r = await broadcast(db, ctxX, { kind: 'record_break',
    payload: { holderName: '张三', month: '2026-07', amountAmt: 5000000, quotaShare: 0.3,
      detail: { bonusAmt: 100, note: '灯塔新纪录' } } });
  ok(r.sent === true && r.payload.holderName === '张三' && !('amountAmt' in r.payload)
    && !('quotaShare' in r.payload) && !('bonusAmt' in r.payload.detail),
    '播报返回值已剥金额/配额');
  const [ev] = await q(`select payload from event_stream where tenant_id = $1 and type = 'broadcast_sent'`, [tX]);
  const raw = typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload);
  ok(!/amt|amount|quota|金额|配额/i.test(raw),
    `🔴 A-13 机检：落库 payload grep /amt|amount|quota/i 零命中（实际 ${raw.slice(0, 80)}…）`);
  ok(await pushRows(tX) === 1, '播报落 push_log 1 行');
  const [px] = await q(`select channel, kind, target_user from push_log where tenant_id = $1`, [tX]);
  ok(px.channel === 'inapp' && px.kind === 'record_break' && px.target_user === null,
    '播报行：inapp / kind=record_break / 全员（target_user null）');

  const d1 = await broadcast(db, ctxX, { kind: 'lighthouse', payload: { holderName: '李四' },
    dedupKey: `light_${TEST_TODAY}` });
  const d2 = await broadcast(db, ctxX, { kind: 'lighthouse', payload: { holderName: '李四' },
    dedupKey: `light_${TEST_TODAY}` });
  ok(d1.sent === true && d2.sent === false && d2.skipped === 'duplicate' && await pushRows(tX) === 2,
    '播报 dedupKey 防重复（二次跳过，行数不变）');
}

/* ================= ⑧ 事件双写抽查 ================= */
console.log('— ⑧ 事件双写抽查 —');
{
  ok(await esType(tC, 'action_card_created') === 12, 'tC：action_card_created = 12（8 alert + 4 todo）');
  ok(await esType(tS, 'action_card_created') === 2 && await esType(tS, 'action_card_transitioned') === 4,
    'tS：created=2 / transitioned=4（3 次顺序 + filled）');
  ok(await esType(tD, 'action_card_created') === 2, 'tD：created=2（首插 + 31 天后；skipped 零事件）');
  ok(await esType(tB, 'morning_brief_sent') === 1 && await esType(tB, 'daily_report_submitted') === 2,
    'tB：morning_brief_sent=1 / daily_report_submitted=2');
  ok(await esType(tX, 'broadcast_sent') === 2, 'tX：broadcast_sent=2（重复播报零事件）');
  const [tr] = await q(`select payload from event_stream where tenant_id = $1 and type = 'action_card_transitioned' order by event_id limit 1`, [tS]);
  const pj = typeof tr.payload === 'string' ? JSON.parse(tr.payload) : tr.payload;
  ok(pj.from === 'pending' && pj.to === 'assigned' && pj.cardId != null,
    '流转事件 payload 含 from/to/cardId（留痕可复算）');
}

await db.close();

/* ================= ⑦ 改线回归 + ⑨ 全量回归 ================= */
console.log('— ⑦ 改线回归：spawnSync c5（calibrate 插卡改线）/ c8（offboard 插卡改线） —');
for (const f of ['c5.test.mjs', 'c8.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: 600000 });
  ok(r.status === 0, `${f} 改线后语义保持`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log('— ⑨ 回归：spawnSync c2-model / c3 / c4 / c6 / c7 / c9（c5、c8 已在 ⑦；c9 慢～9min，timeout 900s） —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs', 'c4.test.mjs', 'c6.test.mjs', 'c7.test.mjs', 'c9.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: f === 'c9.test.mjs' ? 900000 : 600000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C10 推送层验收全部通过');
process.exit(failures ? 1 : 0);
