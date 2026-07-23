#!/usr/bin/env node
/* ============================================================
   对抗性安全 · A —— 隔离穿透 + 越权攻防（尽力攻破）
   运行：node tests/sec-penetration.test.mjs
   目标：以 B 租户各级角色 / 平台方 / 游民 / 匿名 为攻击者，逐表逐 RPC 穷举
        跨租户读写 / 越权 / 伪造身份 / 注入 / 不可变绕过。
        🔴 铁律：穿透数（成功越权/串库）必须为 0，否则逐条列出并 exit 1。
   记账：每类攻击统计「尝试 / 被拒 / 穿透」。穿透 = 攻击本应被拒却成功。
   ============================================================ */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../db/seed.mjs';
import { put, patch, logEvent } from '../server/writes.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

/* 攻击记账：category → {attempts, denied, penetrated:[detail...]} */
const ledger = {};
const bump = (cat, penetratedDetail = null) => {
  const L = ledger[cat] || (ledger[cat] = { attempts: 0, denied: 0, penetrated: [] });
  L.attempts++;
  if (penetratedDetail) L.penetrated.push(penetratedDetail); else L.denied++;
};

const TEST_TODAY = '2026-07-13';

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
/* RLS 语境执行：降级到 app_user + 注入 auth.uid（不存在/空 uid 亦合法输入） */
async function as(uid, sql, params = []) {
  await db.exec(`set role app_user; select set_config('app.uid', '${uid || ''}', false);`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; }
  catch (e) { return { rows: null, err: e.message }; }
  finally { await db.exec(`reset role;`); }
}

/* ---------- 主体：3 租户 × 五级角色 + 平台方 + 游民 + 匿名 ---------- */
const ROLES = ['boss', 'exec', 'manager', 'recruiter', 'sales'];
const roleIdx = r => ROLES.indexOf(r) + 1;                 // 1..5（hex 合法）
const TEN = { A: 'a', B: 'b', C: 'c' };                    // 租户前缀（hex 合法）
/* 生成合法 UUID：段全 hex；(租户,角色) 唯一 */
const uid = (th, r) => `${th}${roleIdx(r)}000000-0000-4000-8000-00000000000${roleIdx(r)}`;
const U = {
  plat: 'f0000000-0000-4000-8000-0000000000f0',
  roamer: 'e0000000-0000-4000-8000-0000000000e0',   // 已认证但未入任何租户
  anon: '',                                          // 匿名
};
const members = {};   // tenantKey → { role → uid }
const tenants = {};   // tenantKey → tenantId

await db.exec(`insert into platform_admins(user_id) values ('${U.plat}')`);
for (const [tk, tp] of Object.entries(TEN)) {
  const [{ id }] = await q(`insert into tenants(name, created_by) values ($1,$2) returning id`,
    [`租户${tk}`, uid(tp, 'boss')]);
  tenants[tk] = id;
  await q(`insert into subscriptions(tenant_id) values ($1)`, [id]);
  members[tk] = {};
  for (const r of ROLES) {
    const u = uid(tp, r);
    members[tk][r] = u;
    await q(`insert into members(user_id, tenant_id, role) values ($1,$2,$3)`, [u, id, r]);
    await q(`insert into seats(tenant_id, user_id) values ($1,$2)`, [id, u]);
  }
}
/* 种子：A、B 各注入业务流水，制造可攻击/可对账的真实行 */
await seedTenant(db, tenants.A, members.A.boss, TEST_TODAY);
await seedTenant(db, tenants.B, members.B.boss, TEST_TODAY);

const tenantA = tenants.A, tenantB = tenants.B, tenantC = tenants.C;
const bossB = members.B.boss, salesB = members.B.sales, recruiterB = members.B.recruiter, execB = members.B.exec;

console.log('\n══════ A. 隔离穿透 + 越权攻防（攻击者：B 租户 / 平台方 / 游民 / 匿名） ══════');

/* ============================================================
   ① 跨租户攻击面逐表穷举：B 攻击 A 的行
   ============================================================ */
console.log('\n— ① 跨租户逐表穷举（B → A：select/update/delete/insert 全拒或 0 行） —');
/* 动态取所有含 tenant_id 的业务基表（自动全覆盖，不漏表） */
const bizTables = (await q(`
  select c.table_name from information_schema.columns c
  join information_schema.tables t on t.table_name=c.table_name and t.table_schema='public'
  where c.table_schema='public' and c.column_name='tenant_id' and t.table_type='BASE TABLE'
    and c.table_name <> 'tenants'
  order by c.table_name`)).map(r => r.table_name);
console.log(`    覆盖 ${bizTables.length} 张含 tenant_id 的表：${bizTables.join(', ')}`);

/* 每张表：B 尝试 SELECT A 的行 → 必 0 行 */
let selLeaks = 0;
for (const tbl of bizTables) {
  const r = await as(bossB, `select * from ${tbl} where tenant_id = $1`, [tenantA]);
  const leaked = !r.err && r.rows.length > 0;
  bump('crossTenant.select', leaked ? `${tbl}: B 读到 A ${r.rows.length} 行` : null);
  if (leaked) selLeaks++;
}
ok(selLeaks === 0, `逐表 B→A SELECT 零穿透（${bizTables.length} 表全测）`,
  selLeaks ? `${selLeaks} 表泄漏` : '');

/* 「读到的每一行 tenant_id 恒等于自己」——B 无 where 全表扫，断言只见自己 */
let mixRows = 0;
for (const tbl of bizTables) {
  const r = await as(bossB, `select tenant_id from ${tbl}`);
  bump('crossTenant.ownScope');
  if (!r.err) { const bad = r.rows.filter(x => x.tenant_id !== tenantB); if (bad.length) { mixRows += bad.length; ledger['crossTenant.ownScope'].penetrated.push(`${tbl}: ${bad.length} 行非本租户`); ledger['crossTenant.ownScope'].denied--; } }
}
ok(mixRows === 0, `B 全表扫描每一行 tenant_id 恒等于自己（无跨租户串入）`, mixRows ? `${mixRows} 行异租户` : '');

/* 每张表：B 尝试 UPDATE A 的行 → 0 行生效或被拒 */
let updLeaks = 0;
for (const tbl of bizTables) {
  const r = await as(bossB, `update ${tbl} set updated_at = now() where tenant_id = $1 returning tenant_id`, [tenantA]);
  const changed = !r.err && r.rows && r.rows.length > 0;
  bump('crossTenant.update', changed ? `${tbl}: B 改到 A ${r.rows.length} 行` : null);
  if (changed) updLeaks++;
}
ok(updLeaks === 0, `逐表 B→A UPDATE 零穿透（0 行生效或触发器/RLS 拒）`, updLeaks ? `${updLeaks} 表被改` : '');

/* 每张表：B 尝试 DELETE A 的行 → 0 行或被拒 */
let delLeaks = 0;
for (const tbl of bizTables) {
  const r = await as(bossB, `delete from ${tbl} where tenant_id = $1 returning tenant_id`, [tenantA]);
  const deleted = !r.err && r.rows && r.rows.length > 0;
  bump('crossTenant.delete', deleted ? `${tbl}: B 删掉 A ${r.rows.length} 行` : null);
  if (deleted) delLeaks++;
}
ok(delLeaks === 0, `逐表 B→A DELETE 零穿透`, delLeaks ? `${delLeaks} 表被删` : '');

/* 关键表：B 尝试 INSERT 一行指向 A（伪造 tenant_id=A）→ with check 拒 */
const insCases = [
  ['deals', `insert into deals(tenant_id,id,employee_id,deal_date,category_id) values ($1,'hack_deal','x','2026-07-01','x')`],
  ['salespersons', `insert into salespersons(tenant_id,id,name) values ($1,'hack_sp','x')`],
  ['event_stream', `insert into event_stream(tenant_id,type,actor_id) values ($1,'hack','${bossB}')`],
  ['action_cards', `insert into action_cards(tenant_id,kind) values ($1,'talk')`],
  ['ledger_entries', `insert into ledger_entries(tenant_id,id,employee_id,category,achieved_at) values ($1,'hack_lg','x','bounty','2026-07-01')`],
  ['comp_plan_versions', `insert into comp_plan_versions(tenant_id,version,inputs,r_rate,effective_from) values ($1,99,'{}',0.1,'2026-07-01')`],
];
let insLeaks = 0;
for (const [tbl, sql] of insCases) {
  const before = Number((await q(`select count(*)::int n from ${tbl} where tenant_id=$1`, [tenantA]))[0].n);
  const r = await as(bossB, sql, [tenantA]);
  const after = Number((await q(`select count(*)::int n from ${tbl} where tenant_id=$1`, [tenantA]))[0].n);
  const injected = after > before;   // 真落进 A 才算穿透（被拒或落进 B 都不算）
  bump('crossTenant.insert', injected ? `${tbl}: B 向 A 注入 1 行` : null);
  if (injected) insLeaks++;
}
ok(insLeaks === 0, `逐表 B→A INSERT（伪造 tenant_id=A）零穿透（with check 拦）`, insLeaks ? `${insLeaks} 表被注入` : '');

/* ============================================================
   ② RPC 攻击：伪造 tenantId / 越权调用 / 邀请码滥用
   ============================================================ */
console.log('\n— ② RPC 攻击面 —');
/* create_tenant：已入租者再开租 → already in a tenant */
{
  const r = await as(bossB, `select create_tenant('偷开的租户') as id`);
  const denied = r.err && /already in a tenant/.test(r.err);
  bump('rpc.create_tenant', denied ? null : `bossB 竟能再开租户: ${r.err || 'ok'}`);
  ok(denied, 'create_tenant：已入租成员再开租被拒', r.err || '竟成功');
}
/* push_state：B 只能推自己的 doc；无法指定 A（RPC 内部 my_tenant 绑定，无 tenantId 入参可伪造） */
{
  const r = await as(bossB, `select push_state('{"x":1}'::jsonb, (select version from suite_state where tenant_id=$1)) as v`, [tenantB]);
  bump('rpc.push_state');   // 自推合法
  const leak = await as(bossB, `update suite_state set doc='{"pwn":1}' where tenant_id=$1 returning tenant_id`, [tenantA]);
  const penetrated = !leak.err && leak.rows && leak.rows.length > 0;
  bump('rpc.push_state', penetrated ? 'B 改到 A 的 suite_state' : null);
  ok(!penetrated, 'push_state/suite_state：B 无法写 A 的状态');
}
/* append_event：B 调 append_event → 只落到 B（my_tenant 绑定），无法串到 A */
{
  const before = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1`, [tenantA]))[0].n);
  const r = await as(bossB, `select append_event('pwn','t','{}'::jsonb) as id`);
  const after = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1`, [tenantA]))[0].n);
  const penetrated = after > before;
  bump('rpc.append_event', penetrated ? 'append_event 串入 A' : null);
  ok(!penetrated && !r.err, 'append_event：B 追加只落 B，A 事件数不变');
  const bEvt = await as(bossB, `select tenant_id from event_stream where type='pwn'`);
  ok(!bEvt.err && bEvt.rows.every(x => x.tenant_id === tenantB), 'append_event 落点恒为攻击者本租户');
}
/* whoami 伪造：游民 / 匿名 调 whoami → 空（无成员身份可冒充） */
{
  const r = await as(U.roamer, `select * from whoami()`);
  bump('rpc.whoami', (!r.err && r.rows.length === 0) ? null : 'roamer whoami 有身份');
  ok(!r.err && r.rows.length === 0, 'whoami：游民无租户身份（空）');
  const a = await as(U.anon, `select * from whoami()`);
  ok(!a.err && a.rows.length === 0, 'whoami：匿名无身份（空）');
}
/* join_tenant：已用码 / 过期码 / 别租户码 */
{
  // 席位铺垫：抬高租户 A 配额，使下面的 join_tenant 功能校验验证 bearer/一次性码语义，而非撞席位配额（配额兜底另有 B 套件专测）
  await q(`update subscriptions set seat_quota = 999 where tenant_id = $1`, [tenantA]);
  const [{ code: freshCode }] = await q(`insert into invites(code,tenant_id,role,created_by) values ('FRESH01',$1,'sales',$2) returning code`, [tenantA, members.A.boss]);
  // 游民用 A 的码入 A（bearer 语义：合法）
  const j1 = await as(U.roamer, `select join_tenant($1) as id`, [freshCode]);
  bump('rpc.join_tenant');
  ok(!j1.err && j1.rows[0].id === tenantA, 'join_tenant：游民凭 A 有效码入 A（bearer 语义）');
  // 同码再用（已 used）→ 拒
  const j2 = await as(U.roamer, `select join_tenant($1) as id`, [freshCode]);
  const denied2 = j2.err != null;   // roamer 已入 A → already in a tenant；且码已 used
  bump('rpc.join_tenant', denied2 ? null : '已用码可复用');
  ok(denied2, 'join_tenant：已用过的码复用被拒', j2.err || '');
  // 全新游民用同一已用码 → invalid（一次性）
  const j2b = await as('e1000000-0000-4000-8000-0000000000e1', `select join_tenant($1) as id`, [freshCode]);
  const denied2b = j2b.err && /invalid or expired/.test(j2b.err);
  bump('rpc.join_tenant', denied2b ? null : '已用码对新人仍有效');
  ok(denied2b, 'join_tenant：已用码对新游民无效（一次性）', j2b.err || '');
  // 过期码
  await q(`insert into invites(code,tenant_id,role,created_by,expires_at) values ('EXPIRED1',$1,'sales',$2, now()-interval '1 day')`, [tenantA, members.A.boss]);
  const j3 = await as('e2000000-0000-4000-8000-0000000000e2', `select join_tenant('EXPIRED1') as id`);
  const denied3 = j3.err && /invalid or expired/.test(j3.err);
  bump('rpc.join_tenant', denied3 ? null : '过期码可用');
  ok(denied3, 'join_tenant：过期码被拒', j3.err || '');
  // 已在 B 的成员想拿 A 的码换租 → already in a tenant（不可跨租）
  await q(`insert into invites(code,tenant_id,role,created_by) values ('FORB01',$1,'sales',$2)`, [tenantA, members.A.boss]);
  const j4 = await as(salesB, `select join_tenant('FORB01') as id`);
  const denied4 = j4.err && /already in a tenant/.test(j4.err);
  bump('rpc.join_tenant', denied4 ? null : 'B 成员用 A 码跨租成功');
  ok(denied4, 'join_tenant：B 成员用 A 码跨租被拒（already in a tenant）', j4.err || '');
}

/* ============================================================
   ③ 伪造身份
   ============================================================ */
console.log('\n— ③ 伪造身份（不存在 uid / 平台方调业务 RPC / 空 uid 调一切） —');
{
  const ghost = '99999999-0000-4000-8000-000000000999';
  const r = await as(ghost, `select append_event('x','y','{}'::jsonb) as id`);
  bump('identity.ghost', (r.err && /not a member/.test(r.err)) ? null : '不存在 uid 可 append');
  ok(r.err && /not a member/.test(r.err), '不存在 uid 调 append_event → not a member', r.err || '');
  const r2 = await as(ghost, `select * from deals`);
  ok(!r2.err && r2.rows.length === 0, '不存在 uid 读 deals → 0 行');
}
{
  const r = await as(U.plat, `select append_event('x','y','{}'::jsonb) as id`);
  bump('identity.platform', (r.err) ? null : '平台方能 append 业务事件');
  ok(r.err != null, '平台方调 append_event → 拒（平台方非任何租户成员）', r.err || '竟成功');
  const r2 = await as(U.plat, `select push_state('{}'::jsonb,1) as v`);
  bump('identity.platform', (r2.err) ? null : '平台方能 push_state');
  ok(r2.err != null, '平台方调 push_state → 拒', r2.err || '竟成功');
}
{
  for (const [name, sql] of [
    ['append_event', `select append_event('x','y','{}'::jsonb)`],
    ['push_state', `select push_state('{}'::jsonb,1)`],
    ['make_invite', `select make_invite('sales')`],
    ['create_tenant', `select create_tenant('n')`],
    ['select deals', `select * from deals`],
  ]) {
    const r = await as(U.anon, sql);
    const safe = (name === 'select deals') ? (!r.err && r.rows.length === 0) : (r.err != null);
    bump('identity.anon', safe ? null : `匿名 ${name} 未被拦`);
    ok(safe, `匿名 uid 调 ${name} → ${name === 'select deals' ? '0 行' : '拒'}`, r.err || '');
  }
}

/* ============================================================
   ④ 权限越权（角色矩阵）
   ============================================================ */
console.log('\n— ④ 角色越权（sales/recruiter/exec 触碰管理层专属） —');
{
  const r = await as(salesB, `select make_invite('sales') as c`);
  bump('rbac.invite', (r.err && /boss only/.test(r.err)) ? null : 'sales 能发码');
  ok(r.err && /boss only/.test(r.err), 'sales 调 make_invite → boss only', r.err || '');
  const r2 = await as(members.B.exec, `select make_invite('sales') as c`);
  bump('rbac.invite', (r2.err && /boss only/.test(r2.err)) ? null : 'exec 能发码');
  ok(r2.err && /boss only/.test(r2.err), 'exec 调 make_invite → boss only（仅 boss）', r2.err || '');
}
{
  // sales 建卡（合法建议）后尝试自行流转 → RLS ac_upd 限 is_mgmt → 0 行/拒
  const c = await as(salesB, `insert into action_cards(tenant_id,kind,payload) values ($1,'coaching','{}') returning card_id`, [tenantB]);
  bump('rbac.cardTransition');
  const cardId = c.rows && c.rows[0] && c.rows[0].card_id;
  const t = await as(salesB, `update action_cards set state='assigned' where card_id=$1 and tenant_id=$2 returning state`, [cardId, tenantB]);
  const blocked = t.err != null || (t.rows && t.rows.length === 0);
  bump('rbac.cardTransition', blocked ? null : 'sales 能流转卡状态');
  ok(blocked, 'sales 流转 action_card 状态 → 拒/0 行（仅 is_mgmt）', t.err || '');
  // manager（is_mgmt）可流转（正向对照，证明不是焊死）
  const tm = await as(members.B.manager, `update action_cards set state='assigned' where card_id=$1 and tenant_id=$2 returning state`, [cardId, tenantB]);
  ok(!tm.err && tm.rows.length === 1, '正向对照：manager 可流转（is_mgmt 放行，非焊死）', tm.err || '');
}
{
  // recruiter 越界读经营数据：RLS 只按 is_member（同租户可读），角色细分在服务层 bundle。
  // 这里断言 recruiter 至少不能跨租读 A 的经营数据（表级隔离对所有角色一致生效）
  const r = await as(recruiterB, `select * from deals where tenant_id=$1`, [tenantA]);
  bump('rbac.recruiterCrossTenant', (!r.err && r.rows.length === 0) ? null : 'recruiter 跨租读经营数据');
  ok(!r.err && r.rows.length === 0, 'recruiter 跨租读 A 的 deals → 0 行', r.err || '');
}

/* ============================================================
   ⑤ 平台方越权（A-C02：平台方零业务读路径）
   ============================================================ */
console.log('\n— ⑤ 平台方越权（A-C02 逐表零业务读路径） —');
{
  /* A-C02 口径：平台方对「业务面」零读路径；「计费面」(subscriptions/seats) 是平台方职责
     （schema subs_platform / seats_platform 明授），tenants 亦经 tenants_sel 授平台方。
     故 A-C02 断言 = 业务面 = bizTables − 计费面。 */
  const billingPlane = new Set(['subscriptions', 'seats']);
  const businessTables = bizTables.filter(t => !billingPlane.has(t));
  let platLeaks = 0;
  for (const tbl of businessTables) {
    const r = await as(U.plat, `select * from ${tbl}`);
    const leaked = !r.err && r.rows.length > 0;
    bump('platform.read', leaked ? `${tbl}: 平台方读到 ${r.rows.length} 行` : null);
    if (leaked) platLeaks++;
  }
  ok(platLeaks === 0, `平台方逐表 SELECT 全 0 行（${businessTables.length} 业务表，A-C02 零业务读路径）`, platLeaks ? `${platLeaks} 表泄漏` : '');
  // 正向对照：平台方对计费面可读（职责边界正好落在业务/计费之间，非全盲）
  const subs = await as(U.plat, `select * from subscriptions`);
  const seatsR = await as(U.plat, `select * from seats`);
  ok(!subs.err && subs.rows.length === 3, `正向对照：平台方可读计费面 subscriptions（${subs.rows && subs.rows.length}/3 租户）`, subs.err || '');
  ok(!seatsR.err && seatsR.rows.length > 0, `正向对照：平台方可读席位健康度 seats（${seatsR.rows && seatsR.rows.length} 行）`, seatsR.err || '');
  const pov = await as(U.plat, `select * from platform_overview()`);
  ok(!pov.err && pov.rows.length === 3, `正向对照：平台方 platform_overview 见 3 租户健康度（非全盲）`, pov.err || '');
}

/* ============================================================
   ⑥ 事件流不可变（A-C03：各角色各租户 UPDATE/DELETE 全拒）
   ============================================================ */
console.log('\n— ⑥ 事件流不可变（A-C03） —');
{
  let esViol = 0;
  for (const tk of ['A', 'B']) {
    for (const r of ROLES) {
      const u = members[tk][r], tid = tenants[tk];
      const upd = await as(u, `update event_stream set type='tampered' where tenant_id=$1 returning event_id`, [tid]);
      bump('event.update', upd.err ? null : `${tk}/${r} 改到事件`);
      if (!upd.err && upd.rows && upd.rows.length) esViol++;
      const del = await as(u, `delete from event_stream where tenant_id=$1 returning event_id`, [tid]);
      bump('event.delete', del.err ? null : `${tk}/${r} 删到事件`);
      if (!del.err && del.rows && del.rows.length) esViol++;
    }
  }
  ok(esViol === 0, `event_stream UPDATE/DELETE 各租户各角色全拒（10 主体 ×2）`, esViol ? `${esViol} 次得手` : '');
}

/* ============================================================
   ⑦ 不可变实体绕过（尝试各种夹带/迂回）
   ============================================================ */
console.log('\n— ⑦ 不可变实体绕过（menu_choices/covenant_docs/m28/ledger/seats/handover） —');
{
  const bossA = members.A.boss;
  const grab = async (tbl, where = '') => (await q(`select id from ${tbl} where tenant_id=$1 ${where} limit 1`, [tenantA]))[0];
  let bypass = 0;
  const tryBlocked = async (cat, label, fn) => {
    const r = await fn(); const blocked = r.err != null || (r.rows && r.rows.length === 0);
    bump(cat, blocked ? null : label + ' 得手'); if (!blocked) bypass++;
    ok(blocked, label, r.err ? '' : '未被拦');
  };
  const mc = await grab('menu_choices');
  await tryBlocked('immutable.menu', 'menu_choices 直接 UPDATE 被拒', () => as(bossA, `update menu_choices set chosen_tier='low' where tenant_id=$1 and id=$2 returning id`, [tenantA, mc.id]));
  await tryBlocked('immutable.menu', 'menu_choices 改无关列（chosen_date 夹带）被拒', () => as(bossA, `update menu_choices set chosen_date='2000-01-01' where tenant_id=$1 and id=$2 returning id`, [tenantA, mc.id]));
  await tryBlocked('immutable.menu', 'menu_choices DELETE 被拒', () => as(bossA, `delete from menu_choices where tenant_id=$1 and id=$2 returning id`, [tenantA, mc.id]));
  const cd = await grab('covenant_docs');
  await tryBlocked('immutable.covdoc', 'covenant_docs UPDATE 被拒', () => as(bossA, `update covenant_docs set candidate_name='x' where tenant_id=$1 and id=$2 returning id`, [tenantA, cd.id]));
  await tryBlocked('immutable.covdoc', 'covenant_docs DELETE 被拒', () => as(bossA, `delete from covenant_docs where tenant_id=$1 and id=$2 returning id`, [tenantA, cd.id]));
  const m28 = await grab('m28_agreements', `and kind='mentoring'`);
  await tryBlocked('immutable.m28', 'm28 rate 下调被拒', () => as(bossA, `update m28_agreements set rate=0.01 where tenant_id=$1 and id=$2 returning id`, [tenantA, m28.id]));
  await tryBlocked('immutable.m28', 'm28 duration 下调被拒', () => as(bossA, `update m28_agreements set duration_months=1 where tenant_id=$1 and id=$2 returning id`, [tenantA, m28.id]));
  await tryBlocked('immutable.m28', 'm28 撤销 irrevocable 被拒', () => as(bossA, `update m28_agreements set irrevocable=false where tenant_id=$1 and id=$2 returning id`, [tenantA, m28.id]));
  await tryBlocked('immutable.m28', 'm28 篡改 baseline 快照被拒', () => as(bossA, `update m28_agreements set baseline_snapshot_amt=1 where tenant_id=$1 and id=$2 returning id`, [tenantA, m28.id]));
  await tryBlocked('immutable.m28', 'm28 DELETE 被拒', () => as(bossA, `delete from m28_agreements where tenant_id=$1 and id=$2 returning id`, [tenantA, m28.id]));
  // ledger：改正文被拒；DELETE 被拒；先 delete 再 insert 同 id（delete 本身被拒）
  const lg = await grab('ledger_entries', `and honored_at is not null`);
  await tryBlocked('immutable.ledger', 'ledger 改正文（promise_text）被拒', () => as(bossA, `update ledger_entries set promise_text='pwn' where tenant_id=$1 and id=$2 returning id`, [tenantA, lg.id]));
  await tryBlocked('immutable.ledger', 'ledger 已 honored 夹带改正文被拒', () => as(bossA, `update ledger_entries set honored_at='2026-01-01', promise_text='pwn' where tenant_id=$1 and id=$2 returning id`, [tenantA, lg.id]));
  await tryBlocked('immutable.ledger', 'ledger DELETE 被拒', () => as(bossA, `delete from ledger_entries where tenant_id=$1 and id=$2 returning id`, [tenantA, lg.id]));
  // seats：改字段被拒
  const seat = (await q(`select seat_id from seats where tenant_id=$1 limit 1`, [tenantA]))[0];
  await tryBlocked('immutable.seats', 'seats 改 user_id 被拒（触发器）', () => as(bossA, `update seats set user_id=gen_random_uuid() where tenant_id=$1 and seat_id=$2 returning seat_id`, [tenantA, seat.seat_id]));
  // handover_cards：DELETE 被拒（先建一张）
  await put(db, { tenantId: tenantA, actorId: bossA, today: TEST_TODAY }, 'handover_cards',
    { id: 'hc_sec_1', leaver_id: 'x', client_name: 'c', stage: 'hot', amount_amt: 100 }, 'handover_created');
  await tryBlocked('immutable.handover', 'handover_cards DELETE 被拒（触发器）', () => as(bossA, `delete from handover_cards where tenant_id=$1 and id='hc_sec_1' returning id`, [tenantA]));
  // comp_plan_versions append-only
  await q(`insert into comp_plan_versions(tenant_id,version,inputs,r_rate,effective_from,created_by) values ($1,1,'{}',0.1,'2026-07-01',$2)`, [tenantA, bossA]);
  await tryBlocked('immutable.cpv', 'comp_plan_versions UPDATE 被拒（append-only）', () => as(bossA, `update comp_plan_versions set r_rate=0.9 where tenant_id=$1 and version=1 returning version`, [tenantA]));
  await tryBlocked('immutable.cpv', 'comp_plan_versions DELETE 被拒', () => as(bossA, `delete from comp_plan_versions where tenant_id=$1 and version=1 returning version`, [tenantA]));
  ok(bypass === 0, `不可变实体全部绕过尝试失败（${ledger['immutable.menu'].attempts + 0} 类合计）`, bypass ? `${bypass} 次绕过得手` : '');
}

/* ============================================================
   ⑧ SQL 注入面
   ============================================================ */
console.log('\n— ⑧ SQL 注入（恶意串作参数入服务层/RPC，断言参数化未被注入） —');
{
  const bossA = members.A.boss;
  const ctxA = { tenantId: tenantA, actorId: bossA, today: TEST_TODAY };
  const payloads = [
    `'; drop table deals;--`,
    `1 OR 1=1`,
    `x'||(select string_agg(id,',') from deals)||'`,
    'A'.repeat(5000),
    `null byte`,
    `😈유니코드'"\\`,
  ];
  const dealsBefore = Number((await q(`select count(*)::int n from deals where tenant_id=$1`, [tenantA]))[0].n);
  let injViol = 0;
  for (const p of payloads) {
    // 经服务层 put（参数化）写 salespersons
    try {
      await put(db, ctxA, 'salespersons', { id: 'inj_' + Math.random().toString(36).slice(2, 8), name: p, phone: p }, 'salesperson_created');
    } catch (e) { /* 值层校验拒也可，不是注入成功 */ }
    // 经 RPC append_event
    await as(bossA, `select append_event($1,$2,$3::jsonb) as id`, [p, p, '{}']);
    // 经 push_state
    await as(bossA, `select push_state($1::jsonb, (select version from suite_state where tenant_id=$2)) as v`, [JSON.stringify({ note: p }), tenantA]);
    bump('injection', null);
  }
  // 断言：deals 表仍在、行数不变、无越权返回
  const tblExists = Number((await q(`select count(*)::int n from information_schema.tables where table_name='deals'`))[0].n) === 1;
  const dealsAfter = Number((await q(`select count(*)::int n from deals where tenant_id=$1`, [tenantA]))[0].n);
  if (!tblExists) { injViol++; ledger['injection'].penetrated.push('deals 表被 DROP'); }
  if (dealsAfter !== dealsBefore) { injViol++; ledger['injection'].penetrated.push(`deals 行数 ${dealsBefore}→${dealsAfter}`); }
  ok(tblExists, '注入后 deals 表仍存在（DROP 未生效）');
  ok(dealsAfter === dealsBefore, `注入后 deals 行数不变（${dealsBefore}）`);
  // 恶意串确实被当作字面量存了（证明是参数化而非拼接执行）
  const stored = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1 and type like '%drop table%'`, [tenantA]))[0].n);
  ok(stored >= 1, `恶意串作为字面量落库（${stored} 条），证明参数化生效未拼接执行`);
  ok(injViol === 0, 'SQL 注入零穿透（表在/行数正常/无越权）', injViol ? `${injViol} 处异常` : '');
}

/* ============================================================
   ⑨ RLS 强制性：全业务表 force row level security
   ============================================================ */
console.log('\n— ⑨ RLS 强制性（pg_class.relforcerowsecurity 逐表核） —');
{
  const rows = await q(`
    select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and c.relname in (select distinct table_name from information_schema.columns
                        where table_schema='public' and column_name='tenant_id')`);
  const notForced = rows.filter(r => !r.forced);
  const notEnabled = rows.filter(r => !r.enabled);
  ok(notEnabled.length === 0, `所有含 tenant_id 的表 enable RLS（${rows.length} 表）`, notEnabled.map(r => r.relname).join(','));
  ok(notForced.length === 0, `所有含 tenant_id 的表 FORCE RLS（无 owner 豁免后门）`, notForced.map(r => r.relname).join(','));
}

/* ============================================================
   统计汇总
   ============================================================ */
console.log('\n══════ A 攻击记账（尝试 / 被拒 / 穿透） ══════');
let totalAttempts = 0, totalDenied = 0, totalPen = 0;
const penDetails = [];
for (const [cat, L] of Object.entries(ledger)) {
  totalAttempts += L.attempts; totalDenied += L.denied; totalPen += L.penetrated.length;
  const mark = L.penetrated.length ? '🔴' : '  ';
  console.log(`${mark} ${cat.padEnd(26)} 尝试 ${String(L.attempts).padStart(4)} ｜ 被拒 ${String(L.denied).padStart(4)} ｜ 穿透 ${L.penetrated.length}`);
  L.penetrated.forEach(d => penDetails.push(`[${cat}] ${d}`));
}
console.log('  ' + '-'.repeat(60));
console.log(`  合计 尝试 ${totalAttempts} ｜ 被拒 ${totalDenied} ｜ 🔴 穿透 ${totalPen}`);
if (penDetails.length) {
  console.log('\n🔴 穿透详情（逐条）：');
  penDetails.forEach(d => console.log('   - ' + d));
}
ok(totalPen === 0, `全攻击面零穿透（${totalAttempts} 次尝试）`, totalPen ? `${totalPen} 次穿透` : '');

await db.close();
console.log(`\n[A. 隔离穿透+越权攻防] 断言 ${failures ? '✗ ' + failures + ' 失败' : '✅ 全通过'}｜攻击 ${totalAttempts} 次｜穿透 ${totalPen}`);
process.exit(failures ? 1 : 0);
