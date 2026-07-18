-- ============================================================
-- 销冠操盘系统 · SaaS 底座（Supabase / 任意 Postgres 15+）
-- 多租户模型：共享库 + tenant_id 行级隔离（RLS）
-- 部署：Supabase 官方云 / 自托管 Supabase / 国内云 Postgres 均为同一份文件
-- 隔离铁律：所有业务表必须开 RLS；策略只认 is_member(tenant_id)；
--          任何新表照抄本文件模板，并给 saas/tests/rls.mjs 加隔离用例。
-- ============================================================

-- Supabase 环境自带 auth.uid()；裸 Postgres 测试环境由测试脚本注入同名桩函数。

create extension if not exists pgcrypto;

-- ---------- 租户与成员 ----------
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid not null
);

create table if not exists members (
  user_id     uuid primary key,                 -- = auth.users.id（不强 FK，保证可移植与可测）
  tenant_id   uuid not null references tenants(id) on delete cascade,
  role        text not null check (role in ('boss','sales')),
  email       text,
  joined_at   timestamptz not null default now()
);
create index if not exists members_tenant_idx on members(tenant_id);

-- 邀请码：老板生成，员工凭码入租户
create table if not exists invites (
  code        text primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  role        text not null default 'sales' check (role in ('boss','sales')),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid
);

-- ---------- 业务状态：整库 JSON 文档 + 乐观锁版本 ----------
-- v1 与前端单文件版同构（一个租户一份 doc），并发用 version 乐观锁。
-- v2 拆热点表（daily_reports 等）时照本文件 RLS 模板加表即可。
create table if not exists suite_state (
  tenant_id   uuid primary key references tenants(id) on delete cascade,
  doc         jsonb not null,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- 审计留痕（append-only：只许插入与本租户查询，禁改禁删）
create table if not exists audit_log (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null,
  at          timestamptz not null default now(),
  action      text not null,
  detail      jsonb
);
create index if not exists audit_tenant_idx on audit_log(tenant_id, at desc);

-- ---------- 隔离核心 ----------
create or replace function my_tenant() returns uuid
language sql stable security definer set search_path = public as
$$ select tenant_id from members where user_id = auth.uid() $$;

create or replace function is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from members where user_id = auth.uid() and tenant_id = t) $$;

create or replace function is_boss(t uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from members where user_id = auth.uid() and tenant_id = t and role = 'boss') $$;

alter table tenants     enable row level security;
alter table members     enable row level security;
alter table invites     enable row level security;
alter table suite_state enable row level security;
alter table audit_log   enable row level security;
-- 强制表拥有者也走 RLS（防经 owner 连接绕过）
alter table tenants     force row level security;
alter table members     force row level security;
alter table invites     force row level security;
alter table suite_state force row level security;
alter table audit_log   force row level security;

drop policy if exists tenants_sel  on tenants;
drop policy if exists members_sel  on members;
drop policy if exists invites_all  on invites;
drop policy if exists state_sel    on suite_state;
drop policy if exists state_upd    on suite_state;
drop policy if exists audit_ins    on audit_log;
drop policy if exists audit_sel    on audit_log;

create policy tenants_sel on tenants  for select using (is_member(id));
create policy members_sel on members  for select using (is_member(tenant_id));
create policy invites_all on invites  for all
  using (is_boss(tenant_id)) with check (is_boss(tenant_id));
create policy state_sel   on suite_state for select using (is_member(tenant_id));
create policy state_upd   on suite_state for update
  using (is_member(tenant_id)) with check (is_member(tenant_id));
create policy audit_ins   on audit_log for insert with check (is_member(tenant_id) and user_id = auth.uid());
create policy audit_sel   on audit_log for select using (is_member(tenant_id));
-- 注意：tenants/members/suite_state 没有 insert/delete 策略 → 默认拒绝，
-- 只能经下面的 security definer RPC 走受控路径。

-- ---------- 受控 RPC ----------
-- 开租户：任何已登录用户一次性创建租户并成为 boss
create or replace function create_tenant(tenant_name text, boss_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a tenant';
  end if;
  insert into tenants(name, created_by) values (tenant_name, auth.uid()) returning id into tid;
  insert into members(user_id, tenant_id, role, email) values (auth.uid(), tid, 'boss', boss_email);
  insert into suite_state(tenant_id, doc, updated_by) values (tid, '{}'::jsonb, auth.uid());
  insert into audit_log(tenant_id, user_id, action) values (tid, auth.uid(), 'tenant_created');
  return tid;
end $$;

-- 生成邀请码（仅 boss）
create or replace function make_invite(invite_role text default 'sales')
returns text language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant(); c text;
begin
  if t is null or not is_boss(t) then raise exception 'boss only'; end if;
  c := upper(encode(gen_random_bytes(6), 'hex'));
  insert into invites(code, tenant_id, role, created_by) values (c, t, invite_role, auth.uid());
  return c;
end $$;

-- 凭邀请码入租户
create or replace function join_tenant(invite_code text, member_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a tenant';
  end if;
  select * into inv from invites where code = upper(invite_code)
    and used_by is null and expires_at > now() for update;
  if not found then raise exception 'invalid or expired invite'; end if;
  insert into members(user_id, tenant_id, role, email) values (auth.uid(), inv.tenant_id, inv.role, member_email);
  update invites set used_by = auth.uid() where code = inv.code;
  insert into audit_log(tenant_id, user_id, action) values (inv.tenant_id, auth.uid(), 'member_joined');
  return inv.tenant_id;
end $$;

-- 拉取状态
create or replace function pull_state()
returns table(doc jsonb, version bigint, updated_at timestamptz)
language sql stable security definer set search_path = public as
$$ select s.doc, s.version, s.updated_at from suite_state s where s.tenant_id = my_tenant() $$;

-- 推送状态（乐观锁：expected_version 不匹配则报冲突，前端拉取合并后重试）
create or replace function push_state(new_doc jsonb, expected_version bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant(); v bigint;
begin
  if t is null then raise exception 'not a member'; end if;
  update suite_state set doc = new_doc, version = version + 1,
         updated_at = now(), updated_by = auth.uid()
   where tenant_id = t and version = expected_version
  returning version into v;
  if v is null then raise exception 'version conflict'; end if;
  insert into audit_log(tenant_id, user_id, action, detail)
    values (t, auth.uid(), 'state_pushed', jsonb_build_object('version', v));
  return v;
end $$;

-- 我的身份（前端启动时一把取全）
create or replace function whoami()
returns table(user_id uuid, tenant_id uuid, tenant_name text, role text)
language sql stable security definer set search_path = public as
$$ select m.user_id, m.tenant_id, t.name, m.role
     from members m join tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid() $$;

-- RPC 权限：仅已登录角色可调
revoke all on function create_tenant(text, text)  from public;
revoke all on function make_invite(text)          from public;
revoke all on function join_tenant(text, text)    from public;
revoke all on function pull_state()               from public;
revoke all on function push_state(jsonb, bigint)  from public;
revoke all on function whoami()                   from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function create_tenant(text, text), make_invite(text),
      join_tenant(text, text), pull_state(), push_state(jsonb, bigint), whoami()
      to authenticated;
  end if;
end $$;
