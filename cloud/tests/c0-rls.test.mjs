#!/usr/bin/env node
/* C0 底座验收（v5.1 §12 C0 行）：
   A-C01 租户隔离零穿透 ｜ A-C02 主超管无业务数据读路径 ｜ A-C03 事件流不可变
   + 五级角色 / 席位配额 / 席位流水不可变 / 邀请一次性 / 乐观锁 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

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
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;`);

const U = { bossA: 'a0000000-0000-4000-8000-00000000000a', salesA: 'a1000000-0000-4000-8000-0000000000a1', bossB: 'b0000000-0000-4000-8000-00000000000b', plat: 'f0000000-0000-4000-8000-0000000000f0' };
async function as(uid, sql, params = []) {
  await db.exec(`set role app_user; select set_config('app.uid', '${uid || ''}', false);`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; }
  catch (e) { return { rows: null, err: e.message }; }
  finally { await db.exec(`reset role;`); }
}
// 平台管理员由运维直插（超出 RLS 语境）
await db.exec(`insert into platform_admins(user_id) values ('${U.plat}')`);

console.log('— 建租户 / 五级角色 —');
let r = await as(U.bossA, `select create_tenant('租户A') as id`);
ok(!r.err, '老板A 创建租户A（自动开订阅+占席位+事件流）', r.err);
const tenantA = r.rows && r.rows[0].id;
r = await as(U.bossB, `select create_tenant('租户B') as id`);
const tenantB = r.rows && r.rows[0].id;
ok(!r.err, '老板B 创建租户B', r.err);
r = await as(U.bossA, `select make_invite('sales') as code`);
const codeA = r.rows && r.rows[0].code;
ok(!r.err, '老板A 生成 sales 邀请码', r.err);
r = await as(U.salesA, `select join_tenant($1) as id`, [codeA]);
ok(!r.err && r.rows[0].id === tenantA, '销售A 凭码入租（占第二席位）', r.err);
r = await as(U.salesA, `select role from whoami()`);
ok(!r.err && r.rows[0].role === 'sales', '五级角色：whoami=sales');
r = await as(U.salesA, `select make_invite('sales') as c`);
ok(r.err && /boss only/.test(r.err), '销售不能发邀请码');
r = await as(U.bossA, `insert into members(user_id, tenant_id, role) values (gen_random_uuid(), $1, 'superman') returning role`, [tenantA]);
ok(r.err != null, '未知角色被 check 约束拒绝');

console.log('— A-C01 租户隔离零穿透 —');
r = await as(U.bossB, `select * from members where tenant_id = $1`, [tenantA]);
ok(!r.err && r.rows.length === 0, '跨租户查成员 → 0 行');
r = await as(U.bossB, `select * from event_stream where tenant_id = $1`, [tenantA]);
ok(!r.err && r.rows.length === 0, '跨租户查事件流 → 0 行');
r = await as(U.bossB, `update suite_state set doc='{"hack":1}' where tenant_id=$1 returning tenant_id`, [tenantA]);
ok(!r.err && r.rows.length === 0, '跨租户改状态 → 0 行生效');
r = await as(U.bossB, `insert into action_cards(tenant_id, kind) values ($1,'talk') returning card_id`, [tenantA]);
ok((r.err != null) || r.rows.length === 0, '跨租户插 action_card → 拒绝');

console.log('— A-C02 主超管无业务数据读路径 —');
r = await as(U.plat, `select * from platform_overview()`);
ok(!r.err && r.rows.length === 2 && r.rows[0].seats_used != null, `平台驾驶舱：${r.rows && r.rows.length} 个租户的计费/席位/健康度可见`);
for (const [tbl, name] of [['suite_state', '业务状态'], ['event_stream', '事件流'], ['action_cards', 'action_card'], ['members', '成员表'], ['audit_log', '审计']]) {
  r = await as(U.plat, `select * from ${tbl}`);
  ok(!r.err && r.rows.length === 0, `平台方读 ${name} → 0 行（零业务读路径）`);
}
r = await as(U.plat, `select create_tenant('平台自营') as id`);
ok(r.err && /platform admin cannot own tenant/.test(r.err), '平台方不能自己开租户（角色隔离）');

console.log('— A-C03 事件流不可变 —');
r = await as(U.bossA, `select append_event('deal_won', 'deal_1', '{"amt":100}') as id`);
ok(!r.err && r.rows[0].id != null, '事件追加成功');
r = await as(U.bossA, `update event_stream set type='tampered' where tenant_id=$1 returning event_id`, [tenantA]);
ok(r.err != null, '事件 UPDATE → 权限层拒绝', (r.err || '').slice(0, 60));
r = await as(U.bossA, `delete from event_stream where tenant_id=$1 returning event_id`, [tenantA]);
ok(r.err != null, '事件 DELETE → 权限层拒绝');
r = await as(U.bossA, `select count(*)::int as n from event_stream`);
ok(!r.err && r.rows[0].n >= 3, `事件流本租户可见（${r.rows && r.rows[0].n} 条：开租/入租/成交）`);

console.log('— 席位：配额与流水不可变 —');
r = await as(U.bossA, `select seats_used, seat_quota from platform_overview()`);
// 老板不是平台方 → platform_overview 空；改由老板读订阅
r = await as(U.bossA, `select seat_quota from subscriptions where tenant_id=$1`, [tenantA]);
ok(!r.err && r.rows[0].seat_quota === 5, '老板可读自家订阅（席位配额 5）');
await db.exec(`update subscriptions set seat_quota = 2 where tenant_id = '${tenantA}'`);
r = await as(U.bossA, `select make_invite('sales') as c`);
ok(r.err && /seat quota exceeded/.test(r.err), '席位满员（2/2）→ 邀请被拒');
await db.exec(`update subscriptions set seat_quota = 5 where tenant_id = '${tenantA}'`);
r = await as(U.bossA, `update seats set user_id = gen_random_uuid() where tenant_id=$1 returning seat_id`, [tenantA]);
ok(r.err && /immutable/.test(r.err), '席位流水字段不可改（触发器拦截）');

console.log('— action_card 状态机权限 —');
r = await as(U.salesA, `insert into action_cards(tenant_id, kind, payload) values ($1,'coaching','{}') returning card_id`, [tenantA]);
ok(!r.err, '成员可创建 action_card（建议）', r.err);
const cardId = r.rows && r.rows[0].card_id;
r = await as(U.salesA, `update action_cards set state='done' where card_id=$1 returning state`, [cardId]);
ok((r.err != null) || r.rows.length === 0, '销售不能流转状态（仅管理层）');
r = await as(U.bossA, `update action_cards set state='assigned', assigned_to='${U.salesA}' where card_id=$1 returning state`, [cardId]);
ok(!r.err && r.rows.length === 1 && r.rows[0].state === 'assigned', '老板流转状态 pending→assigned');

console.log('— 乐观锁回归 —');
r = await as(U.bossA, `select push_state('{"company":{"name":"A"}}'::jsonb, 1) as v`);
ok(!r.err && Number(r.rows[0].v) === 2, '推送状态 → 版本 2');
r = await as(U.bossA, `select push_state('{"x":1}'::jsonb, 1) as v`);
ok(r.err && /version conflict/.test(r.err), '过期版本 → 冲突拒绝');

await db.close();
console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C0 底座验收全部通过');
process.exit(failures ? 1 : 0);
