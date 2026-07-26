-- ============================================================
-- 运营层（试点必需）：平台开户白名单 / 邮箱验证码 / 强制改密标记
-- - platform_signup_allow：AUTH_WHITELIST_ONLY=1 时，新老板注册的唯一入口
--   （你签完合同后把老板邮箱加进来；员工走各租户 member_whitelist）
-- - email_codes：注册邮箱验证码（AUTH_EMAIL_VERIFY=1 时启用；库存哈希不存明文码）
-- - accounts.must_change_password：重置密码后强制首登改密
-- - 🔴 三者均为系统表：app_user 零权限，只走系统通道
-- ============================================================

alter table accounts add column if not exists must_change_password boolean not null default false;

create table if not exists platform_signup_allow (
  email      text primary key,            -- 归一化小写
  note       text,
  created_at timestamptz not null default now(),
  used_by    uuid,                        -- 已用此通道注册的账号
  used_at    timestamptz
);

create table if not exists email_codes (
  email      text primary key,            -- 归一化小写；一邮箱同时只留一个有效码
  code_hash  text not null,               -- sha256(code)
  expires_at timestamptz not null,
  attempts   int not null default 0,      -- 校验失败计数（≥5 作废）
  sent_at    timestamptz not null default now()
);

revoke all on platform_signup_allow, email_codes from app_user;

-- 老板重置本租户成员密码（security definer：guard 在库内，app_user 经此函数改 accounts；
-- 哈希在 JS 算好后传入——scrypt 不在 SQL 做）。撤销该成员全部会话、置强制改密标记。
create or replace function boss_reset_member_password(target uuid, new_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid := my_tenant();
begin
  if t is null or not is_boss(t) then raise exception 'boss only'; end if;
  if target = auth.uid() then raise exception 'use change password for self'; end if;
  if not exists(select 1 from members where user_id = target and tenant_id = t) then
    raise exception 'member not found';
  end if;
  update accounts set password_hash = new_hash, must_change_password = true,
    failed_attempts = 0, locked_until = null where user_id = target;
  update sessions set revoked_at = now() where user_id = target and revoked_at is null;
end $$;
