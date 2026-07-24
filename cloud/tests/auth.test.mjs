#!/usr/bin/env node
/* Step 2 · 认证与会话 HTTP 级验收：
   注册/登录/登出/会话查询 · 密码策略 · 重复邮箱 · 错误话术不泄露账号存在性 ·
   连错锁定与解锁（AUTH_LOCK_MS 缩短注入）· Bearer 与 Cookie 双通道 ·
   令牌篡改/过期/撤销 · 库中只存哈希 · IP 限速 ·
   🔴 无 dev 头的全业务链路（注册→建租户→push/pull→席位→whoami 全走真实会话）·
   devAuth=false 时 X-Actor-Id 必须失效 */
process.env.AUTH_LOCK_MS = '400';                        // 锁窗缩到 400ms 以便测解锁
import { isDeepStrictEqual } from 'node:util';
import { openDb } from '../api/db.mjs';
import { buildServer } from '../api/server.mjs';

let failures = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = await openDb();
/* 🔴 devAuth=false：本套件验证生产形态——只认会话，不认 X-Actor-Id */
const server = buildServer(db, { devAuth: false, log: false, authRate: { limit: 25, windowMs: 1500 } });
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, cookie, actorHeader, body, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(actorHeader ? { 'x-actor-id': actorHeader } : {}),
      'content-type': 'application/json',
    },
    body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json = null; try { json = await res.json(); } catch { }
  return { status: res.status, body: json, headers: res.headers };
}
const sql = async (s, p = []) => (await db.query(s, p)).rows;

/* ── ① 注册与密码策略 ── */
console.log('— ① 注册与密码策略 —');
let boss = {};                                            // { token, userId }
{
  const weak = await call('POST', '/v1/auth/register', { body: { email: 'boss@t.cn', password: 'short1' } });
  ok(weak.status === 400 && weak.body.error.code === 'WEAK_PASSWORD', '弱密码 → 400 WEAK_PASSWORD');
  const noLetter = await call('POST', '/v1/auth/register', { body: { email: 'boss@t.cn', password: '12345678' } });
  ok(noLetter.status === 400, '纯数字密码 → 400');
  const badEmail = await call('POST', '/v1/auth/register', { body: { email: 'not-an-email', password: 'goodPass8' } });
  ok(badEmail.status === 400 && badEmail.body.error.code === 'BAD_EMAIL', '坏邮箱 → 400');
  const r = await call('POST', '/v1/auth/register', { body: { email: 'Boss@T.cn', password: 'goodPass8' } });
  boss = r.body;
  ok(r.status === 201 && r.body.email === 'boss@t.cn' && typeof r.body.token === 'string',
    '注册成功（邮箱归一化小写）+ 返回令牌');
  const setCookie = r.headers.get('set-cookie') ?? '';
  ok(/sid=.+HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie), 'Set-Cookie: HttpOnly + SameSite=Lax');
  const dup = await call('POST', '/v1/auth/register', { body: { email: 'boss@t.cn', password: 'another8x' } });
  ok(dup.status === 409 && dup.body.error.code === 'EMAIL_TAKEN', '重复邮箱 → 409');
  const [acc] = await sql(`select password_hash from accounts where email='boss@t.cn'`);
  ok(acc.password_hash.startsWith('scrypt:16384:8:1:') && !acc.password_hash.includes('goodPass8'),
    '库中密码为 scrypt 哈希（无明文）');
  const [ses] = await sql(`select token_hash from sessions limit 1`);
  ok(/^[0-9a-f]{64}$/.test(ses.token_hash) && ses.token_hash !== boss.token,
    '库中会话为 sha256 哈希（≠ 原始令牌）');
}

/* ── ② 会话双通道 + 登出 ── */
console.log('— ② 会话双通道与登出 —');
{
  const viaBearer = await call('GET', '/v1/auth/session', { token: boss.token });
  ok(viaBearer.status === 200 && viaBearer.body.email === 'boss@t.cn', 'Bearer 通道 → 200');
  const viaCookie = await call('GET', '/v1/auth/session', { cookie: `sid=${boss.token}` });
  ok(viaCookie.status === 200 && viaCookie.body.userId === boss.userId, 'Cookie 通道 → 200');
  const tampered = await call('GET', '/v1/auth/session', { token: boss.token.slice(0, -2) + 'zz' });
  ok(tampered.status === 401, '篡改令牌 → 401');
  const none = await call('GET', '/v1/auth/session', {});
  ok(none.status === 401, '无令牌 → 401');
  const lg = await call('POST', '/v1/auth/logout', { token: boss.token });
  ok(lg.status === 200 && /Max-Age=0/.test(lg.headers.get('set-cookie') ?? ''), '登出 → 清 Cookie');
  const after = await call('GET', '/v1/auth/session', { token: boss.token });
  ok(after.status === 401, '登出后旧令牌 → 401（已撤销）');
  const re = await call('POST', '/v1/auth/login', { body: { email: 'boss@t.cn', password: 'goodPass8' } });
  boss.token = re.body.token;
  ok(re.status === 200 && typeof boss.token === 'string', '重新登录 → 新令牌');
}

/* ── ③ 登录防爆破：话术一致 + 连错锁定 + 解锁 ── */
console.log('— ③ 防爆破 —');
{
  const ghost = await call('POST', '/v1/auth/login', { body: { email: 'nobody@t.cn', password: 'whatever8' } });
  const wrong = await call('POST', '/v1/auth/login', { body: { email: 'boss@t.cn', password: 'wrongpw99' } });
  ok(ghost.status === 401 && wrong.status === 401
    && ghost.body.error.message === wrong.body.error.message,
    '不存在的账号与错密码 → 同状态同话术（不泄露存在性）');
  await call('POST', '/v1/auth/register', { body: { email: 'lockme@t.cn', password: 'lockPass8' } });
  let last;
  for (let i = 0; i < 5; i++)
    last = await call('POST', '/v1/auth/login', { body: { email: 'lockme@t.cn', password: 'badbad99' } });
  ok(last.status === 429 && last.body.error.code === 'ACCOUNT_LOCKED', '连错 5 次 → 429 锁定');
  const during = await call('POST', '/v1/auth/login', { body: { email: 'lockme@t.cn', password: 'lockPass8' } });
  ok(during.status === 429, '锁定期内正确密码也 429（锁优先）');
  await sleep(600);                                       // AUTH_LOCK_MS=400 已过
  const unlocked = await call('POST', '/v1/auth/login', { body: { email: 'lockme@t.cn', password: 'lockPass8' } });
  ok(unlocked.status === 200, '锁窗过后正确密码 → 200（计数已复位）');
}

/* ── ④ 🔴 全业务链路：纯会话身份（零 dev 头） ── */
console.log('— ④ 全业务链路走真实会话 —');
let tenantId;
{
  const t = await call('POST', '/v1/tenants', { token: boss.token, body: { name: '会话公司' } });
  tenantId = t.body.tenantId;
  ok(t.status === 201, '会话身份建租户 → 201');
  const me = await call('GET', '/v1/me', { token: boss.token });
  ok(me.body.memberships[0]?.tenant_id === tenantId && me.body.memberships[0]?.role === 'boss',
    'whoami=boss（RLS 身份来自会话 uid）');
  const DOC = { company: { name: '会话公司' } };
  const push = await call('PUT', '/v1/state', { token: boss.token, body: { doc: DOC, version: 1 } });
  ok(push.status === 200 && push.body.version === 2, '会话身份 push_state → v2');
  const pull = await call('GET', '/v1/state', { cookie: `sid=${boss.token}` });
  ok(pull.status === 200 && isDeepStrictEqual(pull.body.doc, DOC), 'Cookie 身份 pull_state 一致');
  const inv = await call('POST', '/v1/invites', { token: boss.token, body: { role: 'sales' } });
  const s = await call('POST', '/v1/auth/register', { body: { email: 'sales@t.cn', password: 'salesPw88' } });
  const join = await call('POST', '/v1/join', { token: s.body.token, body: { code: inv.body.code } });
  ok(join.status === 200 && join.body.tenantId === tenantId, '销售注册+凭码入租户（全程会话）');
  const sub = await call('GET', '/v1/subscription', { token: boss.token });
  ok(sub.body.seats.used === 2, '席位 used=2');
}

/* ── ⑤ devAuth=false 时 dev 头必须失效 ── */
console.log('— ⑤ 生产形态关死 dev 头 —');
{
  const r = await call('GET', '/v1/me', { actorHeader: boss.userId });
  ok(r.status === 401 && r.body.error.code === 'NO_SESSION', 'X-Actor-Id 被无视 → 401');
  const mix = await call('GET', '/v1/me', { token: boss.token, actorHeader: 'a0000000-0000-4000-8000-00000000000a' });
  ok(mix.status === 200 && mix.body.memberships[0]?.tenant_id === tenantId,
    '会话与 dev 头同发 → 以会话为准（不可越权指定身份）');
}

/* ── ⑥ 过期会话 ── */
console.log('— ⑥ 过期会话 —');
{
  await sql(`update sessions set expires_at = now() - interval '1 second'
    where user_id = $1 and revoked_at is null`, [boss.userId]);
  const r = await call('GET', '/v1/me', { token: boss.token });
  ok(r.status === 401 && r.body.error.code === 'BAD_SESSION', '过期令牌 → 401 BAD_SESSION');
  const re = await call('POST', '/v1/auth/login', { body: { email: 'boss@t.cn', password: 'goodPass8' } });
  ok(re.status === 200, '重新登录恢复');
  boss.token = re.body.token;
}

/* ── ⑦ IP 限速（authRate.limit=25/1.5s；本用例放最后以免污染前序） ── */
console.log('— ⑦ auth 接口 IP 限速 —');
{
  /* 🔴 两个确定性前提：① 先睡满一个限速窗，清掉前面章节的计数残留（隔离）；
     ② 并发齐发（毫秒级同窗到达）——串行会被 scrypt 时延拖出窗口，用例变时钟敏感 */
  await sleep(1700);
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    call('POST', '/v1/auth/login', { body: { email: `spray${i}@t.cn`, password: 'xxxxxxx1' } })));
  const hit429 = rs.filter(r => r.status === 429 && r.body.error.code === 'RATE_LIMITED').length;
  ok(hit429 === 5, `30 并发精确触发 IP 限速（超出 limit=25 的恰好 5 发被拒，实得 ${hit429}）`);
  await sleep(1600);
  const after = await call('GET', '/v1/auth/session', { token: boss.token });
  ok(after.status === 200, '限速窗过后恢复正常（且 session 接口不受 auth 限速影响）');
}

server.close();
console.log(failures ? `\n❌ ${failures} 条未过` : '\n✅ 认证与会话 Step 2 验收全绿');
process.exit(failures ? 1 : 0);
