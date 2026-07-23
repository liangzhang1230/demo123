-- ============================================================
-- AI 销售操盘手 · 云端版 · C0 底座 schema（Postgres 15+ / Supabase 兼容）
-- 对应 v5.1 §3.2 云端专属实体 + §9 云端红线 A-C01/02/03/04
-- 隔离铁律：全表 force RLS；无策略=默认拒绝；业务读写只经 is_member(tenant)
-- 平台方（主超管）永不可读任何业务数据（A-C02）——只有 tenants/subscriptions/seats 健康度
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- 租户 ----------
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city_tier   text check (city_tier in ('tier1','tier2','tier34')),
  industry    text,
  status      text not null default 'trial' check (status in ('trial','active','overdue','suspended','closed')),
  created_at  timestamptz not null default now(),
  created_by  uuid not null
);

-- ---------- 成员（五级角色，v5.1 §1.2/§8） ----------
create table if not exists members (
  user_id     uuid primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  role        text not null check (role in ('boss','exec','manager','recruiter','sales')),
  sp_id       text,                    -- 关联 Salesperson（User ≠ Salesperson：有档案未必有账号）
  email       text,
  is_active   boolean not null default true,
  joined_at   timestamptz not null default now()
);
create index if not exists members_tenant_idx on members(tenant_id);

-- ---------- 平台方（主超管；跨租户，只做开通/计费/熔断） ----------
create table if not exists platform_admins (
  user_id     uuid primary key,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------- 邀请码 ----------
create table if not exists invites (
  code        text primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  role        text not null default 'sales' check (role in ('boss','exec','manager','recruiter','sales')),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid
);

-- ---------- 订阅与席位（§10.4/§11；boardsEnabled 板块级授权） ----------
create table if not exists subscriptions (
  tenant_id      uuid primary key references tenants(id) on delete cascade,
  plan           text not null default 'trial',
  boards_enabled text[] not null default array['dingjia','zhaoren','suanzhang','liuren','yuren'],
  seat_quota     int not null default 5,
  start_date     date, end_date date,
  status         text not null default 'active' check (status in ('active','overdue','suspended','closed')),
  updated_at     timestamptz not null default now()
);
create table if not exists seats (                 -- 席位流水 🔴 不可变
  seat_id     bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null,
  occupied_at timestamptz not null default now(),
  released_at timestamptz
);

-- ---------- 事件流（🔴 A-C03 不可变追加日志；一切汇总数可由事件流复算） ----------
create table if not exists event_stream (
  event_id    bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  type        text not null,
  actor_id    uuid not null,
  target_id   text,
  payload     jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists es_tenant_idx on event_stream(tenant_id, occurred_at desc);

-- ---------- action_card（一切建议动作的唯一载体；永不自动执行 A-C04） ----------
create table if not exists action_cards (
  card_id     bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  kind        text not null check (kind in ('coaching','talk','retain','stopbleed','expand','eliminate','honor','spotcheck','salary_review','newhire_judge')),
  state       text not null default 'pending' check (state in ('pending','assigned','doing','done','filled')),
  target_id   text,
  payload     jsonb,
  assigned_to uuid,
  trail       jsonb not null default '[]'::jsonb,   -- 状态机留痕
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ac_tenant_idx on action_cards(tenant_id, state);
-- 🔴 防疲劳去重的原子兜底（修复 cardBus TOCTOU）：同租户同 dedupKey 至多一张「活跃」卡。
--    活跃 = state 未终结（done/filled 除外）。卡完结或冷却期后可合法重插，故用部分唯一索引而非全量唯一。
create unique index if not exists ac_dedup_active on action_cards (tenant_id, (payload->>'dedupKey'))
  where payload->>'dedupKey' is not null and state not in ('done','filled');

-- ---------- 推送与审计 ----------
create table if not exists push_log (
  id bigserial primary key, tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('inapp','serviceAccount')),
  kind text not null, target_user uuid, dedup_key text, sent_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigserial primary key, tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null, at timestamptz not null default now(), action text not null, detail jsonb
);

-- ---------- 整库文档（迁移期与单机版互通；C2 起逐步拆真表） ----------
create table if not exists suite_state (
  tenant_id  uuid primary key references tenants(id) on delete cascade,
  doc        jsonb not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------- 隔离核心 ----------
create or replace function my_tenant() returns uuid
language sql stable security definer set search_path = public as
$$ select tenant_id from members where user_id = auth.uid() and is_active $$;
create or replace function is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from members where user_id = auth.uid() and tenant_id = t and is_active) $$;
create or replace function my_role(t uuid) returns text
language sql stable security definer set search_path = public as
$$ select role from members where user_id = auth.uid() and tenant_id = t and is_active $$;
create or replace function is_boss(t uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select my_role(t) = 'boss' $$;
create or replace function is_mgmt(t uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select my_role(t) in ('boss','exec','manager') $$;
create or replace function is_platform() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from platform_admins where user_id = auth.uid()) $$;

do $$ declare t text;
begin
  foreach t in array array['tenants','members','platform_admins','invites','subscriptions','seats',
                           'event_stream','action_cards','push_log','audit_log','suite_state'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- 租户侧策略
drop policy if exists tenants_sel on tenants;
create policy tenants_sel on tenants for select using (is_member(id) or is_platform());
drop policy if exists members_sel on members;
create policy members_sel on members for select using (is_member(tenant_id));
drop policy if exists invites_all on invites;
create policy invites_all on invites for all using (is_boss(tenant_id)) with check (is_boss(tenant_id));
-- 订阅/席位：平台方全权；租户老板只读自家
drop policy if exists subs_platform on subscriptions;
create policy subs_platform on subscriptions for all using (is_platform()) with check (is_platform());
drop policy if exists subs_boss_sel on subscriptions;
create policy subs_boss_sel on subscriptions for select using (is_boss(tenant_id));
drop policy if exists seats_platform on seats;
create policy seats_platform on seats for select using (is_platform() or is_boss(tenant_id));
drop policy if exists seats_ins on seats;
create policy seats_ins on seats for insert with check (is_platform() or is_boss(tenant_id));
-- 🔴 seats 不可变：无 update/delete 策略（released_at 由补一条流水表达？不——释放走 update released_at 例外：
--   仅允许把 released_at 从 null 置为非 null，其余字段不可变（触发器保证））
drop policy if exists seats_release on seats;
create policy seats_release on seats for update using (is_platform() or is_boss(tenant_id))
  with check (is_platform() or is_boss(tenant_id));
create or replace function seats_immutable() returns trigger language plpgsql as $$
begin
  if old.released_at is not null then raise exception 'seat row immutable after release'; end if;
  if new.seat_id <> old.seat_id or new.tenant_id <> old.tenant_id or new.user_id <> old.user_id
     or new.occupied_at <> old.occupied_at then raise exception 'seat fields immutable'; end if;
  return new;
end $$;
drop trigger if exists trg_seats_immutable on seats;
create trigger trg_seats_immutable before update on seats for each row execute function seats_immutable();

-- 🔴 事件流：insert-only（A-C03）；select 本租户；无 update/delete 策略 + 权限层双保险
drop policy if exists es_ins on event_stream;
create policy es_ins on event_stream for insert with check (is_member(tenant_id) and actor_id = auth.uid());
drop policy if exists es_sel on event_stream;
create policy es_sel on event_stream for select using (is_member(tenant_id));
revoke update, delete on event_stream from public;

-- action_card：本租户可见；状态流转仅管理层（A-C04 的库侧下半段：写路径唯一，服务层保证"仅老板点击触发"）
drop policy if exists ac_sel on action_cards;
create policy ac_sel on action_cards for select using (is_member(tenant_id));
drop policy if exists ac_ins on action_cards;
create policy ac_ins on action_cards for insert with check (is_member(tenant_id));
drop policy if exists ac_upd on action_cards;
create policy ac_upd on action_cards for update using (is_mgmt(tenant_id)) with check (is_mgmt(tenant_id));

drop policy if exists push_sel on push_log;
create policy push_sel on push_log for select using (is_member(tenant_id));
drop policy if exists push_ins on push_log;
create policy push_ins on push_log for insert with check (is_member(tenant_id));
drop policy if exists audit_ins on audit_log;
create policy audit_ins on audit_log for insert with check (is_member(tenant_id) and user_id = auth.uid());
drop policy if exists audit_sel on audit_log;
create policy audit_sel on audit_log for select using (is_member(tenant_id));
drop policy if exists state_sel on suite_state;
create policy state_sel on suite_state for select using (is_member(tenant_id));
drop policy if exists state_upd on suite_state;
create policy state_upd on suite_state for update using (is_member(tenant_id)) with check (is_member(tenant_id));
-- 🔴 A-C02 física：以上任何业务表策略均不含 is_platform()——平台方连一行都查不到

-- ---------- 受控 RPC ----------
create or replace function create_tenant(tenant_name text, boss_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if is_platform() then raise exception 'platform admin cannot own tenant'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then raise exception 'already in a tenant'; end if;
  insert into tenants(name, created_by) values (tenant_name, auth.uid()) returning id into tid;
  insert into members(user_id, tenant_id, role, email) values (auth.uid(), tid, 'boss', boss_email);
  insert into subscriptions(tenant_id) values (tid);
  insert into seats(tenant_id, user_id) values (tid, auth.uid());
  insert into suite_state(tenant_id, doc, updated_by) values (tid, '{}'::jsonb, auth.uid());
  insert into event_stream(tenant_id, type, actor_id) values (tid, 'tenant_created', auth.uid());
  return tid;
end $$;

create or replace function make_invite(invite_role text default 'sales')
returns text language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant(); c text; used int; quota int;
begin
  if t is null or not is_boss(t) then raise exception 'boss only'; end if;
  select count(*) into used from seats where tenant_id = t and released_at is null;
  select seat_quota into quota from subscriptions where tenant_id = t;
  if used >= quota then raise exception 'seat quota exceeded'; end if;
  c := upper(encode(gen_random_bytes(6), 'hex'));
  insert into invites(code, tenant_id, role, created_by) values (c, t, invite_role, auth.uid());
  return c;
end $$;

create or replace function join_tenant(invite_code text, member_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype; used int; quota int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then raise exception 'already in a tenant'; end if;
  select * into inv from invites where code = upper(invite_code) and used_by is null and expires_at > now() for update;
  if not found then raise exception 'invalid or expired invite'; end if;
  -- 🔴 席位配额兑现侧硬校验（修复缺陷：发码不占席位，唯一可靠的关卡在兑现侧）。
  --    锁订阅行 → 串行化同租户并发 join，杜绝 TOCTOU 超卖。
  select seat_quota into quota from subscriptions where tenant_id = inv.tenant_id for update;
  select count(*) into used from seats where tenant_id = inv.tenant_id and released_at is null;
  if used >= quota then raise exception 'seat quota exceeded'; end if;
  insert into members(user_id, tenant_id, role, email) values (auth.uid(), inv.tenant_id, inv.role, member_email);
  insert into seats(tenant_id, user_id) values (inv.tenant_id, auth.uid());
  update invites set used_by = auth.uid() where code = inv.code;
  insert into event_stream(tenant_id, type, actor_id) values (inv.tenant_id, 'member_joined', auth.uid());
  return inv.tenant_id;
end $$;

create or replace function append_event(ev_type text, ev_target text, ev_payload jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant(); eid bigint;
begin
  if t is null then raise exception 'not a member'; end if;
  insert into event_stream(tenant_id, type, actor_id, target_id, payload)
    values (t, ev_type, auth.uid(), ev_target, ev_payload) returning event_id into eid;
  return eid;
end $$;

create or replace function pull_state()
returns table(doc jsonb, version bigint, updated_at timestamptz)
language sql stable security definer set search_path = public as
$$ select s.doc, s.version, s.updated_at from suite_state s where s.tenant_id = my_tenant() $$;

create or replace function push_state(new_doc jsonb, expected_version bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant(); v bigint;
begin
  if t is null then raise exception 'not a member'; end if;
  update suite_state set doc = new_doc, version = version + 1, updated_at = now(), updated_by = auth.uid()
   where tenant_id = t and version = expected_version returning version into v;
  if v is null then raise exception 'version conflict'; end if;
  return v;
end $$;

create or replace function whoami()
returns table(user_id uuid, tenant_id uuid, tenant_name text, role text, boards_enabled text[])
language sql stable security definer set search_path = public as
$$ select m.user_id, m.tenant_id, t.name, m.role, s.boards_enabled
     from members m join tenants t on t.id = m.tenant_id
     left join subscriptions s on s.tenant_id = m.tenant_id
    where m.user_id = auth.uid() and m.is_active $$;

-- 平台驾驶舱：只见计费/席位/健康度（A-C02 白名单接口）
create or replace function platform_overview()
returns table(tenant_id uuid, name text, status text, plan text, seats_used bigint, seat_quota int, last_active timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.status, s.plan,
         (select count(*) from seats x where x.tenant_id = t.id and x.released_at is null),
         s.seat_quota,
         (select max(occurred_at) from event_stream e where e.tenant_id = t.id)
    from tenants t left join subscriptions s on s.tenant_id = t.id
   where is_platform()
$$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function create_tenant(text,text), make_invite(text), join_tenant(text,text),
      append_event(text,text,jsonb), pull_state(), push_state(jsonb,bigint), whoami(), platform_overview()
      to authenticated;
  end if;
end $$;
