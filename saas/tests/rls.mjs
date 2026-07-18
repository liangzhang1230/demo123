#!/usr/bin/env node
/* 多租户隔离自动化测试（PGlite = 真 Postgres 语义，含 RLS）
   模拟两个租户（老板A/销售A2、老板B）+ 未入租户用户 + 匿名，穷举越权路径。 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

const db = new PGlite({ extensions: { pgcrypto } });
// Supabase auth.uid() 桩：经会话 GUC 注入当前用户
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create role authenticated nologin;
  create role app_user login;
  grant usage on schema public to app_user;
  grant authenticated to app_user;
`);
await db.exec(readFileSync(join(root, 'schema.sql'), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;`);

const U = { bossA: 'a0000000-0000-4000-8000-00000000000a', salesA2: 'a2000000-0000-4000-8000-0000000000a2', bossB: 'b0000000-0000-4000-8000-00000000000b', stray: 'c0000000-0000-4000-8000-00000000000c' };
async function as(uid, sql, params = []) {
  // 以受限角色 + 注入身份执行；每次独立事务
  await db.exec(`set role app_user; select set_config('app.uid', '${uid || ''}', false);`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; }
  catch (e) { return { rows: null, err: e.message }; }
  finally { await db.exec(`reset role;`); }
}

console.log('— 建租户与成员 —');
let r = await as(U.bossA, `select create_tenant('租户A', 'bossA@x.com') as id`);
ok(!r.err, '老板A 创建租户A', r.err);
const tenantA = r.rows && r.rows[0].id;
r = await as(U.bossB, `select create_tenant('租户B', 'bossB@x.com') as id`);
ok(!r.err, '老板B 创建租户B', r.err);
const tenantB = r.rows && r.rows[0].id;
r = await as(U.bossA, `select create_tenant('重复租户') as id`);
ok(r.err && /already in a tenant/.test(r.err), '同一用户不能重复开租户');
r = await as(U.bossA, `select make_invite('sales') as code`);
ok(!r.err, '老板A 生成邀请码', r.err);
const codeA = r.rows && r.rows[0].code;
r = await as(U.salesA2, `select join_tenant($1, 'salesA2@x.com') as id`, [codeA]);
ok(!r.err && r.rows[0].id === tenantA, '销售A2 凭码加入租户A', r.err);
r = await as(U.stray, `select join_tenant($1) as id`, [codeA]);
ok(r.err && /invalid or expired/.test(r.err), '邀请码一次性——第二人使用被拒');

console.log('— 状态读写与乐观锁 —');
r = await as(U.bossA, `select push_state('{"company":{"name":"A公司"}}'::jsonb, 1) as v`);
ok(!r.err && Number(r.rows[0].v) === 2, '老板A 推送状态 → 版本 2', r.err);
r = await as(U.salesA2, `select doc->'company'->>'name' as name from pull_state()`);
ok(!r.err && r.rows[0] && r.rows[0].name === 'A公司', '同租户销售A2 拉取到 A 公司数据', r.err);
r = await as(U.bossA, `select push_state('{"x":1}'::jsonb, 1) as v`);
ok(r.err && /version conflict/.test(r.err), '过期版本推送 → 冲突拒绝（乐观锁）');

console.log('— 跨租户隔离（核心）—');
r = await as(U.bossB, `select doc from pull_state()`);
ok(!r.err && r.rows.length === 1 && JSON.stringify(r.rows[0].doc) === '{}', '老板B 只拉到自己的空文档，看不到 A');
r = await as(U.bossB, `select * from suite_state`);
ok(!r.err && r.rows.length === 1, `直查 suite_state 只见本租户 1 行（实际 ${r.rows && r.rows.length}）`);
r = await as(U.bossB, `select * from suite_state where tenant_id = $1`, [tenantA]);
ok(!r.err && r.rows.length === 0, '老板B 指名查询租户A 状态 → 0 行');
r = await as(U.bossB, `update suite_state set doc = '{"hacked":true}'::jsonb where tenant_id = $1 returning tenant_id`, [tenantA]);
ok(!r.err && r.rows.length === 0, '老板B 改租户A 状态 → 0 行生效');
r = await as(U.bossA, `select doc->>'hacked' as h from pull_state()`);
ok(!r.err && r.rows[0].h == null, '租户A 数据未被污染');
r = await as(U.bossB, `select * from members where tenant_id = $1`, [tenantA]);
ok(!r.err && r.rows.length === 0, '老板B 看不到租户A 成员表');
r = await as(U.bossB, `select * from audit_log where tenant_id = $1`, [tenantA]);
ok(!r.err && r.rows.length === 0, '老板B 看不到租户A 审计日志');
r = await as(U.bossB, `insert into members(user_id, tenant_id, role) values ($1, $2, 'boss') returning user_id`, [U.bossB, tenantA]);
ok((r.err != null) || r.rows.length === 0, '老板B 无法把自己插进租户A 成员表（无 insert 策略默认拒绝）');
r = await as(U.salesA2, `select make_invite('boss') as code`);
ok(r.err && /boss only/.test(r.err), '销售角色不能发邀请码（boss only）');

console.log('— 未授权访问 —');
r = await as(U.stray, `select * from pull_state()`);
ok(!r.err && r.rows.length === 0, '未入租户用户 pull_state → 空');
r = await as(U.stray, `select push_state('{"x":1}'::jsonb, 1) as v`);
ok(r.err && /not a member/.test(r.err), '未入租户用户 push_state → 拒绝');
r = await as('', `select * from suite_state`);
ok((r.err != null) || r.rows.length === 0, '匿名（auth.uid()=null）读 suite_state → 空/拒绝');
r = await as('', `select create_tenant('匿名租户') as id`);
ok(r.err && /not authenticated/.test(r.err), '匿名不能开租户');

console.log('— 审计不可篡改 —');
r = await as(U.bossA, `update audit_log set action = 'tampered' where tenant_id = $1 returning id`, [tenantA]);
ok((r.err != null) || r.rows.length === 0, '审计日志禁改（无 update 策略）');
r = await as(U.bossA, `delete from audit_log where tenant_id = $1 returning id`, [tenantA]);
ok((r.err != null) || r.rows.length === 0, '审计日志禁删（无 delete 策略）');
r = await as(U.bossA, `select count(*)::int as n from audit_log`);
ok(!r.err && r.rows[0].n >= 3, `审计日志本租户可见（${r.rows && r.rows[0].n} 条）`);

await db.close();
console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 多租户隔离测试全部通过');
process.exit(failures ? 1 : 0);
