-- ============================================================
-- 白名单与登录安全（v5.1 §10.2 落地）+ 成员停用/复职（账号继承闭环）
-- - member_whitelist：老板预登记 邮箱/手机号 + 预设角色（+可选预绑档案 spId）；
--   注册/登录命中即自动入租户（免邀请码）。手机号行在短信资质接入前即可预登记。
-- - 一条白名单 = 一个入口：used_by 记账号，用后不复用（继承=删旧行加新行）。
-- - deactivate/reactivate_member：security definer（与 join_tenant 同模式），
--   停用=档案留租户+席位释放（seats 触发器只放行 released_at 一次性置位）；
--   复职=配额硬校验+新席位流水。
-- ============================================================

create table if not exists member_whitelist (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  contact    text not null,               -- 归一化：邮箱小写 / 大陆手机号 11 位数字
  kind       text not null check (kind in ('email','phone')),
  role       text not null check (role in ('boss','exec','manager','recruiter','sales')),
  sp_id      text,                        -- 可选：预绑员工档案（入职即绑）
  note       text,
  used_by    uuid,                        -- 已被哪个账号使用（null=待注册）
  used_at    timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, contact)
);

alter table member_whitelist enable row level security;
alter table member_whitelist force row level security;
drop policy if exists wl_sel on member_whitelist;
create policy wl_sel on member_whitelist for select using (is_mgmt(tenant_id));
drop policy if exists wl_ins on member_whitelist;
create policy wl_ins on member_whitelist for insert with check (is_boss(tenant_id) and created_by = auth.uid());
drop policy if exists wl_del on member_whitelist;
create policy wl_del on member_whitelist for delete using (is_boss(tenant_id));
grant select, insert, delete on member_whitelist to app_user;   -- 无 update 策略：改=删+加（留痕清晰）

-- 停用成员（老板；档案留租户、席位释放、事件留痕；不可停用自己）
create or replace function deactivate_member(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant();
begin
  if t is null or not is_boss(t) then raise exception 'boss only'; end if;
  if target = auth.uid() then raise exception 'cannot deactivate self'; end if;
  if not exists(select 1 from members where user_id = target and tenant_id = t and is_active) then
    raise exception 'member not found or already inactive';
  end if;
  update members set is_active = false where user_id = target and tenant_id = t;
  update seats set released_at = now()
    where tenant_id = t and user_id = target and released_at is null;
  insert into event_stream(tenant_id, type, actor_id, target_id)
    values (t, 'member_deactivated', auth.uid(), target::text);
end $$;

-- 复职（老板；席位配额硬校验后新开席位流水——seats 不可变，绝不复用旧行）
create or replace function reactivate_member(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant(); used int; quota int;
begin
  if t is null or not is_boss(t) then raise exception 'boss only'; end if;
  if not exists(select 1 from members where user_id = target and tenant_id = t and not is_active) then
    raise exception 'member not found or already active';
  end if;
  select seat_quota into quota from subscriptions where tenant_id = t for update;
  select count(*) into used from seats where tenant_id = t and released_at is null;
  if used >= quota then raise exception 'seat quota exceeded'; end if;
  update members set is_active = true where user_id = target and tenant_id = t;
  insert into seats(tenant_id, user_id) values (t, target);
  insert into event_stream(tenant_id, type, actor_id, target_id)
    values (t, 'member_reactivated', auth.uid(), target::text);
end $$;
