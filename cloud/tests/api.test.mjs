#!/usr/bin/env node
/* Step 1 · API 层 HTTP 级验收：
   真 HTTP（fetch）打到真服务（node:http）打到真 Postgres（PGlite + RLS）。
   覆盖：健康 / 身份闸 / 建租户 / whoami / 状态信封(乐观版本) / 邀请-加入-席位配额 /
   订阅 / 填报(覆盖语义) / 插卡读取+状态机+角色 / 事件流(mgmt) / 跨租户隔离 /
   C12 停机写锁(423，读不锁) / 输入校验(400/404/413) / 并发身份不串（互斥闸）。 */
import { isDeepStrictEqual } from 'node:util';
import { openDb, makeActorGate } from '../api/db.mjs';
import { buildServer } from '../api/server.mjs';
import { insertCard } from '../server/cardbus.mjs';

let failures = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
};
const TODAY = '2026-07-13';
const U = {
  bossA: 'a0000000-0000-4000-8000-00000000000a',
  sales1: 'b0000000-0000-4000-8000-00000000000b',
  bossB: 'c0000000-0000-4000-8000-00000000000c',
};

const db = await openDb();                       // 内存 PGlite（全新库）
const server = buildServer(db, { devAuth: true, log: false });
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { actor, body, today = TODAY, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(actor ? { 'x-actor-id': actor } : {}),
      ...(today ? { 'x-today': today } : {}),
      'content-type': 'application/json',
    },
    body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应按 null */ }
  return { status: res.status, body: json };
}
const sql = async (s, p = []) => (await db.query(s, p)).rows;

/* ── ① 健康 & 身份闸 ── */
console.log('— ① 健康检查与身份闸 —');
{
  const r = await call('GET', '/healthz');
  ok(r.status === 200 && r.body.ok === true, 'GET /healthz → 200 ok:true');
  const r2 = await call('GET', '/v1/me');
  /* Step 2 起无身份统一报 NO_SESSION（会话优先的认证模型），状态码仍 401 */
  ok(r2.status === 401 && r2.body.error.code === 'NO_SESSION', '无身份 → 401 NO_SESSION');
  const r3 = await call('GET', '/v1/me', { actor: 'not-a-uuid' });
  ok(r3.status === 400 && r3.body.error.code === 'BAD_ACTOR', '坏 UUID → 400 BAD_ACTOR');
  const r4 = await call('GET', '/v1/state', { actor: U.bossA });
  ok(r4.status === 403 && r4.body.error.code === 'NOT_MEMBER', '未入租户读状态 → 403 NOT_MEMBER');
  const r5 = await call('GET', '/nope', { actor: U.bossA });
  ok(r5.status === 404 && r5.body.error.code === 'NO_ROUTE', '未知路由 → 404 NO_ROUTE');
  const r6 = await call('GET', '/v1/me', { actor: U.bossA, today: '2026/07/13' });
  ok(r6.status === 400 && r6.body.error.code === 'BAD_TODAY', '坏 X-Today → 400 BAD_TODAY');
}

/* ── ② 建租户 + whoami ── */
console.log('— ② 建租户 / whoami —');
let tenantA;
{
  const r = await call('POST', '/v1/tenants', { actor: U.bossA, body: { name: '测试公司A' } });
  tenantA = r.body.tenantId;
  ok(r.status === 201 && /^[0-9a-f-]{36}$/.test(tenantA || ''), 'POST /v1/tenants → 201 + uuid');
  const me = await call('GET', '/v1/me', { actor: U.bossA });
  ok(me.status === 200 && me.body.memberships[0]?.role === 'boss'
    && me.body.memberships[0]?.tenant_id === tenantA, 'whoami → boss@租户A');
  const dup = await call('POST', '/v1/tenants', { actor: U.bossA, body: { name: '再建' } });
  ok(dup.status === 409 && dup.body.error.code === 'ALREADY_IN_TENANT', '重复建租户 → 409');
  const noName = await call('POST', '/v1/tenants', { actor: U.sales1, body: {} });
  ok(noName.status === 400 && noName.body.error.code === 'BAD_NAME', '缺 name → 400');
}

/* ── ③ 状态信封：pull / push 乐观版本 ── */
console.log('— ③ 状态信封（pull/push_state 乐观锁） —');
{
  const s0 = await call('GET', '/v1/state', { actor: U.bossA });
  ok(s0.status === 200 && s0.body.version === 1 && JSON.stringify(s0.body.doc) === '{}',
    '初始 doc={} version=1');
  const conflict = await call('PUT', '/v1/state', { actor: U.bossA, body: { doc: { x: 1 }, version: 99 } });
  ok(conflict.status === 409 && conflict.body.error.code === 'VERSION_CONFLICT', '错版本 push → 409');
  const DOC = { company: { name: '测试公司A', cityTier: 'tier1' }, meta: { v: 1 } };
  const push = await call('PUT', '/v1/state', { actor: U.bossA, body: { doc: DOC, version: 1 } });
  ok(push.status === 200 && push.body.version === 2, '正确版本 push → version=2');
  const s1 = await call('GET', '/v1/state', { actor: U.bossA });
  /* jsonb 是无序映射（键序会被规范化）——必须深度相等比较，不能比字符串 */
  ok(isDeepStrictEqual(s1.body.doc, DOC) && s1.body.version === 2, 'doc 往返一致（深度相等）');
  const badDoc = await call('PUT', '/v1/state', { actor: U.bossA, body: { doc: [1], version: 2 } });
  ok(badDoc.status === 400 && badDoc.body.error.code === 'BAD_DOC', 'doc 非对象 → 400');
}

/* ── ④ 邀请 / 加入 / 席位配额 ── */
console.log('— ④ 邀请-加入-席位配额 —');
{
  const inv = await call('POST', '/v1/invites', { actor: U.bossA, body: { role: 'sales' } });
  ok(inv.status === 201 && typeof inv.body.code === 'string' && inv.body.code.length === 12,
    'boss 发邀请码 → 201');
  const join = await call('POST', '/v1/join', { actor: U.sales1, body: { code: inv.body.code } });
  ok(join.status === 200 && join.body.tenantId === tenantA, 'sales1 凭码加入租户A');
  const me = await call('GET', '/v1/me', { actor: U.sales1 });
  ok(me.body.memberships[0]?.role === 'sales', 'sales1 角色=sales');
  const forbid = await call('POST', '/v1/invites', { actor: U.sales1, body: { role: 'sales' } });
  ok(forbid.status === 403 && forbid.body.error.code === 'BOSS_ONLY', 'sales 发码 → 403 BOSS_ONLY');
  const badRole = await call('POST', '/v1/invites', { actor: U.bossA, body: { role: 'root' } });
  ok(badRole.status === 400 && badRole.body.error.code === 'BAD_ROLE', '非法角色 → 400');
  await sql(`update subscriptions set seat_quota = 2 where tenant_id = $1`, [tenantA]);
  const quota = await call('POST', '/v1/invites', { actor: U.bossA, body: { role: 'sales' } });
  ok(quota.status === 409 && quota.body.error.code === 'SEAT_QUOTA_EXCEEDED',
    '席位满（2/2）再发码 → 409');
  await sql(`update subscriptions set seat_quota = 999 where tenant_id = $1`, [tenantA]);
  const sub = await call('GET', '/v1/subscription', { actor: U.bossA });
  ok(sub.status === 200 && sub.body.seats.used === 2 && sub.body.allBoards.length === 5,
    '订阅接口：seats.used=2 · 全板块 5');
}

/* ── ⑤ 填报（M1 覆盖语义过 API） ── */
console.log('— ⑤ 填报 M1（提交/覆盖） —');
{
  await sql(`insert into salespersons(tenant_id, id, name, created_by) values ($1,'sp01','测试销售',$2)`,
    [tenantA, U.bossA]);
  const r1 = await call('POST', '/v1/reports/daily',
    { actor: U.bossA, body: { employeeId: 'sp01', counts: { leads: 3, intents: 1 } } });
  ok(r1.status === 200 && r1.body.mode === 'submitted', '首次提交 → submitted');
  const r2 = await call('POST', '/v1/reports/daily',
    { actor: U.bossA, body: { employeeId: 'sp01', counts: { leads: 5 } } });
  ok(r2.status === 200 && r2.body.mode === 'overwritten', '同日重交 → overwritten');
  const rows = await sql(
    `select count(*)::int n, max(leads) leads from daily_reports where tenant_id=$1 and employee_id='sp01'`, [tenantA]);
  ok(rows[0].n === 1 && rows[0].leads === 5, '库中 1 行且 leads=5（覆盖不增行）');
  const bad = await call('POST', '/v1/reports/daily', { actor: U.bossA, body: { employeeId: '', counts: {} } });
  ok(bad.status === 400, '空 employeeId → 400');
}

/* ── ⑥ 插卡：读取 / 角色裁剪 / 状态机 ── */
console.log('— ⑥ 插卡 todayCards + transition —');
let cardId;
{
  const ctxA = { tenantId: tenantA, actorId: U.bossA, today: TODAY };
  ({ cardId } = await insertCard(db, ctxA, { kind: 'stopbleed', level: 'todo', payload: { title: '止血演示' } }));
  ok(Number.isInteger(cardId), `直插卡成功（cardId=${cardId}）`);
  const boss = await call('GET', '/v1/cards/today', { actor: U.bossA });
  ok(boss.status === 200 && boss.body.todos.length === 1 && boss.body.todos[0].kind === 'stopbleed',
    'boss 今日卡 → 1 张 stopbleed');
  const sales = await call('GET', '/v1/cards/today', { actor: U.sales1 });
  ok(sales.status === 200 && sales.body.todos.length === 0, 'sales 未被指派 → 0 张（角色裁剪）');
  const salesTr = await call('POST', `/v1/cards/${cardId}/transition`,
    { actor: U.sales1, body: { toState: 'assigned' } });
  ok(salesTr.status === 403, 'sales 流转 → 403（仅管理层）');
  const skip = await call('POST', `/v1/cards/${cardId}/transition`,
    { actor: U.bossA, body: { toState: 'doing' } });
  ok(skip.status === 409 && skip.body.error.code === 'BAD_TRANSITION', '跳态 pending→doing → 409');
  const good = await call('POST', `/v1/cards/${cardId}/transition`,
    { actor: U.bossA, body: { toState: 'assigned' } });
  ok(good.status === 200 && good.body.to === 'assigned', '顺序流转 pending→assigned → 200');
  const badState = await call('POST', `/v1/cards/${cardId}/transition`,
    { actor: U.bossA, body: { toState: 'hacked' } });
  ok(badState.status === 400, '非法目标态 → 400');
}

/* ── ⑦ 跨租户隔离 ── */
console.log('— ⑦ 跨租户隔离 —');
{
  const r = await call('POST', '/v1/tenants', { actor: U.bossB, body: { name: '测试公司B' } });
  ok(r.status === 201, 'bossB 建租户B');
  const sB = await call('GET', '/v1/state', { actor: U.bossB });
  ok(sB.body.version === 1 && JSON.stringify(sB.body.doc) === '{}', 'B 初始 doc 独立（非 A 的 doc）');
  const cross = await call('POST', `/v1/cards/${cardId}/transition`,
    { actor: U.bossB, body: { toState: 'doing' } });
  ok(cross.status === 404 && cross.body.error.code === 'NOT_FOUND', 'bossB 流转 A 的卡 → 404（不可见）');
  const sA = await call('GET', '/v1/state', { actor: U.bossA });
  ok(sA.body.version === 2, 'A 的状态未被 B 影响（version 仍 2）');
  const evB = await call('GET', '/v1/events', { actor: U.bossB });
  ok(evB.status === 200 && evB.body.events.every(e => e.type !== 'daily_report_submitted'),
    'B 的事件流不含 A 的填报事件');
  const evS = await call('GET', '/v1/events', { actor: U.sales1 });
  ok(evS.status === 403 && evS.body.error.code === 'MGMT_ONLY', 'sales 读事件流 → 403');
}

/* ── ⑧ C12 停机写锁（423；读不锁） ── */
console.log('— ⑧ C12 停机写锁 —');
{
  await sql(`update subscriptions set status = 'suspended' where tenant_id = $1`, [tenantA]);
  const w = await call('PUT', '/v1/state', { actor: U.bossA, body: { doc: { x: 1 }, version: 2 } });
  ok(w.status === 423 && w.body.error.code === 'TENANT_SUSPENDED', '停机 push_state → 423');
  const rep = await call('POST', '/v1/reports/daily',
    { actor: U.bossA, body: { employeeId: 'sp01', counts: { leads: 9 } } });
  ok(rep.status === 423, '停机填报 → 423');
  const read = await call('GET', '/v1/state', { actor: U.bossA });
  ok(read.status === 200 && read.body.version === 2, '停机仍可读（A-C05 导出不锁）');
  await sql(`update subscriptions set status = 'active' where tenant_id = $1`, [tenantA]);
  const w2 = await call('PUT', '/v1/state', { actor: U.bossA, body: { doc: { company: { name: 'A' } }, version: 2 } });
  ok(w2.status === 200 && w2.body.version === 3, '复通后 push → version=3');
}

/* ── ⑨ 载荷防线 ── */
console.log('— ⑨ 载荷防线 —');
{
  const badJson = await call('POST', '/v1/tenants', { actor: U.bossB, raw: '{broken' });
  ok(badJson.status === 400 && badJson.body.error.code === 'BAD_JSON', '坏 JSON → 400');
  const big = await call('POST', '/v1/tenants', { actor: U.bossB, raw: JSON.stringify({ name: 'x'.repeat(70000) }) });
  ok(big.status === 413, '>64KB 普通请求体 → 413');
  const bigDoc = { blob: 'y'.repeat(200000) };
  const stateBig = await call('PUT', '/v1/state', { actor: U.bossA, body: { doc: bigDoc, version: 3 } });
  ok(stateBig.status === 200, '状态信封 200KB doc（5MB 限内）→ 200');
}

/* ── ⑩′ CORS（suite 单文件跨源直连的前提） ── */
console.log('— ⑩′ CORS —');
{
  const pre = await fetch(base + '/v1/state', { method: 'OPTIONS' });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*'
    && /authorization/i.test(pre.headers.get('access-control-allow-headers') ?? ''),
    'OPTIONS 预检 → 204 + ACAO:* + 允许 authorization 头');
  const normal = await call('GET', '/healthz');
  const h2 = await fetch(base + '/healthz');
  ok(h2.headers.get('access-control-allow-origin') === '*' && normal.status === 200,
    '普通响应亦带 ACAO 头');
}

/* ── ⑩ 并发身份不串（互斥闸） ── */
console.log('— ⑩ 并发身份不串 —');
{
  const N = 30;
  const results = await Promise.all(Array.from({ length: N }, (_, i) => {
    const actor = i % 2 === 0 ? U.bossA : U.bossB;
    return call('GET', '/v1/me', { actor }).then(r => ({ actor, got: r.body.memberships[0]?.tenant_id }));
  }));
  const bleed = results.filter(r =>
    (r.actor === U.bossA && r.got !== tenantA) || (r.actor === U.bossB && r.got === tenantA));
  ok(bleed.length === 0, `${N} 并发 whoami 零身份串扰`);
}

server.close();
console.log(failures ? `\n❌ ${failures} 条未过` : '\n✅ API 层 Step 1 验收全绿');
process.exit(failures ? 1 : 0);
