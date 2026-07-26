-- ============================================================
-- V3 迁移参考（只加不改，绝不删数据）
--
-- 🔴 重要：你的数据库是 PGlite（内嵌式），没有 psql 客户端。
--    迁移不需要手动执行——新代码 api/db.mjs 在【启动时自动检测并补齐】：
--    缺 accounts → 补 schema-auth.sql；缺 member_whitelist → 补 schema-whitelist.sql；
--    缺 platform_signup_allow → 补 schema-ops.sql。全部幂等，现有数据一字不动。
--    （已用"旧库有数据→新代码打开→自动补表且数据完好"验证过。）
--
-- 本文件仅作【说明】：列出 V3 相对旧版新增了什么。若你将来迁到标准 Postgres，
-- 可把下面 SQL 依次执行（全部 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / OR REPLACE，可重复跑）。
-- ============================================================

-- ① accounts 加 1 列（强制首登改密标记）—— ADD COLUMN IF NOT EXISTS，不动现有行
alter table accounts add column if not exists must_change_password boolean not null default false;

-- ② 新表：成员白名单（老板预登记邮箱/手机号 + 预设角色）
create table if not exists member_whitelist (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  contact    text not null, kind text not null check (kind in ('email','phone')),
  role       text not null check (role in ('boss','exec','manager','recruiter','sales')),
  sp_id text, note text, used_by uuid, used_at timestamptz,
  created_by uuid not null, created_at timestamptz not null default now(),
  primary key (tenant_id, contact)
);

-- ③ 新表：平台开户白名单（AUTH_WHITELIST_ONLY 下新老板注册入口）
create table if not exists platform_signup_allow (
  email text primary key, note text,
  created_at timestamptz not null default now(), used_by uuid, used_at timestamptz
);

-- ④ 新表：邮箱验证码（AUTH_EMAIL_VERIFY 启用时用；存哈希不存明文）
create table if not exists email_codes (
  email text primary key, code_hash text not null,
  expires_at timestamptz not null, attempts int not null default 0,
  sent_at timestamptz not null default now()
);

-- ⑤ 新函数（成员停用/复职、老板重置成员密码）——完整定义见对应 schema 文件，均 create or replace。
--    deactivate_member / reactivate_member（schema-whitelist.sql）
--    boss_reset_member_password（schema-ops.sql）

-- 结论：0 处 DROP、0 处 ALTER TYPE/RENAME、0 处删列删表。纯增量，旧数据 100% 保留。
