#!/usr/bin/env node
/* 白名单机制验收（v5.1 §10.2 落地）：
   老板维护(增/删/权限/校验/去重) · 注册即自动入位(角色/席位/事件) ·
   老账号后补白名单登录入位 · 席位满静默跳过+扩容后入位 · 手机号预登记 ·
   跨租户隔离 · 一账号一租户 · 成员停用(档案留/席位释/自停保护) · 复职(配额校验+新席位流水) ·
   继承链路(停旧→白名单新→新人入位) */
import { openDb } from '../api/db.mjs';
import { buildServer } from '../api/server.mjs';

let failures = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
};
const PASS = 'testPw88';

const db = await openDb();
const server = buildServer(db, { devAuth: false, log: false, authRate: { limit: 500, windowMs: 60_000 } });
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { }
  return { status: res.status, body: json };
}
const sql = async (s, p = []) => (await db.query(s, p)).rows;
const reg = async email => (await call('POST', '/v1/auth/register', { body: { email, password: PASS } })).body;
const login = async email => (await call('POST', '/v1/auth/login', { body: { email, password: PASS } })).body;

/* ── ① 老板建租户 + 白名单维护 ── */
console.log('— ① 白名单维护（老板专属 + 校验） —');
const boss = await reg('boss@wl.cn');
await call('POST', '/v1/tenants', { token: boss.token, body: { name: '白名单公司' } });
const tenantA = (await call('GET', '/v1/me', { token: boss.token })).body.memberships[0].tenant_id;
{
  const add = await call('POST', '/v1/whitelist', { token: boss.token,
    body: { contact: ' Sales2@WL.cn ', role: 'sales', note: '一号销售' } });
  ok(add.status === 201 && add.body.contact === 'sales2@wl.cn' && add.body.kind === 'email',
    '添加邮箱白名单（归一化小写+去空格）');
  const phone = await call('POST', '/v1/whitelist', { token: boss.token,
    body: { contact: '138-0013-8000', role: 'manager' } });
  ok(phone.status === 201 && phone.body.contact === '13800138000' && phone.body.kind === 'phone',
    '手机号预登记（短信资质前即可维护，去分隔符）');
  const dup = await call('POST', '/v1/whitelist', { token: boss.token, body: { contact: 'sales2@wl.cn', role: 'sales' } });
  ok(dup.status === 409 && dup.body.error.code === 'WL_EXISTS', '重复联系方式 → 409');
  const badC = await call('POST', '/v1/whitelist', { token: boss.token, body: { contact: '12345', role: 'sales' } });
  ok(badC.status === 400 && badC.body.error.code === 'BAD_CONTACT', '非法联系方式 → 400');
  const badR = await call('POST', '/v1/whitelist', { token: boss.token, body: { contact: 'x@y.cn', role: 'root' } });
  ok(badR.status === 400 && badR.body.error.code === 'BAD_ROLE', '非法角色 → 400');
  const list = await call('GET', '/v1/whitelist', { token: boss.token });
  ok(list.status === 200 && list.body.whitelist.length === 2
    && list.body.whitelist.every(w => w.used_by === null), '列表 2 条·均待注册');
}

/* ── ② 注册即自动入位 ── */
console.log('— ② 注册即自动入位 —');
let sales2;
{
  sales2 = await reg('sales2@wl.cn');
  ok(sales2.joinedTenant && sales2.joinedTenant.tenantId === tenantA && sales2.joinedTenant.role === 'sales',
    '注册响应带 joinedTenant（免邀请码）');
  const me = await call('GET', '/v1/me', { token: sales2.token });
  ok(me.body.memberships[0]?.tenant_id === tenantA && me.body.memberships[0]?.role === 'sales',
    'whoami=sales@白名单公司（预设角色生效）');
  const wl = await call('GET', '/v1/whitelist', { token: boss.token });
  const row = wl.body.whitelist.find(w => w.contact === 'sales2@wl.cn');
  ok(row.used_by === sales2.userId && row.used_at != null, '白名单标记已使用（一条=一个入口）');
  const seats = (await call('GET', '/v1/subscription', { token: boss.token })).body.seats;
  ok(seats.used === 2, '席位 used=2（老板+销售）');
  const ev = await sql(`select 1 from event_stream where tenant_id=$1 and type='member_joined_via_whitelist'`, [tenantA]);
  ok(ev.length === 1, '入位事件留痕 member_joined_via_whitelist');
  const salesAdd = await call('POST', '/v1/whitelist', { token: sales2.token, body: { contact: 'z@z.cn', role: 'sales' } });
  ok(salesAdd.status === 403 && salesAdd.body.error.code === 'BOSS_ONLY', '销售维护白名单 → 403');
}

/* ── ③ 老账号后补白名单：登录时入位 ── */
console.log('— ③ 老账号后补白名单 —');
{
  const free = await reg('free@wl.cn');
  ok(free.joinedTenant === null, '未白名单注册 → 无租户（游离账号）');
  await call('POST', '/v1/whitelist', { token: boss.token, body: { contact: 'free@wl.cn', role: 'exec' } });
  const relog = await login('free@wl.cn');
  ok(relog.joinedTenant && relog.joinedTenant.role === 'exec', '后补白名单 → 登录即自动入位（角色 exec）');
}

/* ── ④ 席位满：静默跳过 → 扩容后登录入位 ── */
console.log('— ④ 席位满防线 —');
{
  await sql(`update subscriptions set seat_quota = 3 where tenant_id = $1`, [tenantA]);   // 已占 3
  await call('POST', '/v1/whitelist', { token: boss.token, body: { contact: 'late@wl.cn', role: 'sales' } });
  const late = await reg('late@wl.cn');
  ok(late.joinedTenant === null && late.userId, '席位满 → 注册成功但暂不入位（不报错）');
  const wl = await call('GET', '/v1/whitelist', { token: boss.token });
  ok(wl.body.whitelist.find(w => w.contact === 'late@wl.cn').used_by === null, '白名单未消耗（等扩容）');
  await sql(`update subscriptions set seat_quota = 9 where tenant_id = $1`, [tenantA]);
  const relog = await login('late@wl.cn');
  ok(relog.joinedTenant && relog.joinedTenant.tenantId === tenantA, '扩容后再登录 → 自动入位');
}

/* ── ⑤ 跨租户隔离 + 一账号一租户 ── */
console.log('— ⑤ 隔离 —');
{
  const bossB = await reg('bossb@wl.cn');
  await call('POST', '/v1/tenants', { token: bossB.token, body: { name: 'B公司' } });
  const wlB = await call('GET', '/v1/whitelist', { token: bossB.token });
  ok(wlB.body.whitelist.length === 0, 'B 老板看不见 A 的白名单（RLS）');
  await call('POST', '/v1/whitelist', { token: bossB.token, body: { contact: 'sales2@wl.cn', role: 'sales' } });
  const relog = await login('sales2@wl.cn');
  ok(relog.joinedTenant === null, '已入 A 租户的账号不会被 B 白名单拉走（一账号一租户）');
  const meStill = await call('GET', '/v1/me', { token: relog.token });
  ok(meStill.body.memberships[0].tenant_id === tenantA, 'sales2 仍属 A 租户');
}

/* ── ⑥ 停用成员（继承第一步） ── */
console.log('— ⑥ 成员停用 —');
{
  const off = await call('POST', `/v1/members/${sales2.userId}/deactivate`, { token: boss.token, body: {} });
  ok(off.status === 200 && off.body.isActive === false, '老板停用销售 → 200');
  const mem = await sql(`select is_active from members where user_id = $1`, [sales2.userId]);
  ok(mem[0].is_active === false, '成员行保留（审计）· is_active=false');
  const seat = await sql(`select released_at from seats where user_id = $1 order by occupied_at desc limit 1`, [sales2.userId]);
  ok(seat[0].released_at != null, '席位已释放（released_at 置位）');
  const gone = await call('GET', '/v1/state', { token: sales2.token });
  ok(gone.status === 403 && gone.body.error.code === 'NOT_MEMBER', '被停用账号读业务 → 403');
  const self = await call('POST', `/v1/members/${(await call('GET', '/v1/me', { token: boss.token })).body.memberships[0].user_id}/deactivate`, { token: boss.token, body: {} });
  ok(self.status === 400 && self.body.error.code === 'SELF_DEACTIVATE', '老板停用自己 → 400（防锁死）');
  const again = await call('POST', `/v1/members/${sales2.userId}/deactivate`, { token: boss.token, body: {} });
  ok(again.status === 404 && again.body.error.code === 'MEMBER_STATE', '重复停用 → 404');
  const bySales = await call('POST', `/v1/members/${sales2.userId}/reactivate`, { token: (await login('free@wl.cn')).token, body: {} });
  ok(bySales.status === 403, '非老板(exec)复职操作 → 403（boss only）');
}

/* ── ⑦ 继承链路：停旧 → 白名单新 → 新人入位；复职 ── */
console.log('— ⑦ 继承与复职 —');
{
  const before = (await call('GET', '/v1/subscription', { token: boss.token })).body.seats.used;
  await call('POST', '/v1/whitelist', { token: boss.token, body: { contact: 'heir@wl.cn', role: 'sales', note: '接任 sales2' } });
  const heir = await reg('heir@wl.cn');
  ok(heir.joinedTenant && heir.joinedTenant.role === 'sales', '接任者注册即入位（继承=旧停用+新白名单）');
  const after = (await call('GET', '/v1/subscription', { token: boss.token })).body.seats.used;
  ok(after === before + 1, `席位账目正确（${before}→${after}，旧席位已释放不计）`);
  const re = await call('POST', `/v1/members/${sales2.userId}/reactivate`, { token: boss.token, body: {} });
  ok(re.status === 200, '复职 → 200（配额内新开席位流水）');
  const meBack = await call('GET', '/v1/me', { token: sales2.token });
  ok(meBack.body.memberships[0]?.tenant_id === tenantA, '复职后原账号恢复访问（档案未动）');
  const seatRows = await sql(`select count(*)::int n from seats where user_id = $1`, [sales2.userId]);
  ok(seatRows[0].n === 2, '席位流水 2 行（旧行已释放不可变 + 新行）——审计完整');
  /* 先停用腾位，再把配额压到当前占用数——复职必须撞配额墙（顺序反了位置刚好够，测不出防线） */
  await call('POST', `/v1/members/${sales2.userId}/deactivate`, { token: boss.token, body: {} });
  await sql(`update subscriptions set seat_quota = (select count(*) from seats where tenant_id=$1 and released_at is null) where tenant_id = $1`, [tenantA]);
  const reFull = await call('POST', `/v1/members/${sales2.userId}/reactivate`, { token: boss.token, body: {} });
  ok(reFull.status === 409 && reFull.body.error.code === 'SEAT_QUOTA_EXCEEDED', '配额满时复职 → 409（不超卖）');
}

/* ── ⑧ 白名单删除 ── */
console.log('— ⑧ 白名单删除 —');
{
  const del = await call('DELETE', '/v1/whitelist/' + encodeURIComponent('13800138000'), { token: boss.token });
  ok(del.status === 200 && del.body.removed === '13800138000', '删除手机号白名单 → 200');
  const ghost = await call('DELETE', '/v1/whitelist/' + encodeURIComponent('nobody@x.cn'), { token: boss.token });
  ok(ghost.status === 404, '删除不存在的条目 → 404');
}

server.close();
console.log(failures ? `\n❌ ${failures} 条未过` : '\n✅ 白名单机制验收全绿');
process.exit(failures ? 1 : 0);
