-- ============================================================
-- Step 2 · 认证与会话（系统表：全局账号，不属任何租户）
-- - accounts：邮箱+密码（scrypt 哈希）；手机号列预留（短信在部署阶段接服务商）
-- - sessions：只存令牌的 SHA-256（拖库不泄令牌）；固定 TTL，撤销即失效
-- - 🔴 与租户数据强隔离：app_user（业务角色）对这两张表零权限——
--   业务代码在 RLS 身份下物理摸不到账号/会话（见文件尾 revoke）
-- ============================================================

create table if not exists accounts (
  user_id         uuid primary key default gen_random_uuid(),
  email           text unique,
  phone           text unique,
  password_hash   text not null,          -- scrypt:N:r:p:salt_b64:hash_b64
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz,
  check (email is not null or phone is not null)
);

create table if not exists sessions (
  token_hash  text primary key,           -- sha256(token) hex；原始令牌只出现在响应里一次
  user_id     uuid not null references accounts(user_id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  ip          text,
  ua          text
);
create index if not exists sessions_user_idx on sessions(user_id);

-- 业务角色零权限（auth 只走系统通道 withSystem）
revoke all on accounts, sessions from app_user;
