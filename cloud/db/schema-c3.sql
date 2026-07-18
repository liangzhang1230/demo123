-- ============================================================
-- AI 销售操盘手 · 云端版 · C3 填报+提成（v5.1 §12 C3 行：M1 填报 + M2 提成）
-- 🔴 依赖 schema.sql + schema-c2.sql 先执行：
--    tenants / members / event_stream / is_member() 来自 C0；
--    daily_reports / shift_configs / deals / categories / payout_entries 来自 C2。
--
-- 本段只新增一张表：comp_plan_versions（提成方案版本表，按 tenant）
--   - v5.1 §5.1 M2 行：方案版本表按 tenant；改版留痕可查全表
--   - 🔴 append-only：UPDATE/DELETE 无成功路径（触发器 + 权限层双保险）——
--     改版 = 新增一行更高 version，历史版本永远在表里（planVersionAt 按
--     effective_from ≤ date 取版本 ⇒ 历史期用历史版本 ⇒ 改版不追溯）
--   - 🔴 全 schema 无"营收口径"提成模式字样（公约 §4.5：margin_based 永不可换，
--     v4.0 双模式已作废——v5.1 V-03，机检见 c3.test.mjs ①）；commission_base CHECK 只允许
--     'margin_based' / 'neutral_kpi'（E-08 排除 contract_amount 的写入径），
--     列默认 'margin_based'
--   - 金额 *_amt bigint（分）；比率 numeric 0–1；日期 date（公约【2】）
-- ============================================================

create table if not exists comp_plan_versions (
  tenant_id       uuid not null references tenants(id) on delete cascade,
  version         int  not null check (version >= 1),          -- per-tenant 自增（服务层 max+1；PK 防并发重号）
  inputs          jsonb not null,                              -- PlanInputs 13 项快照（定价器件二，快照不回算）
  r_rate          numeric not null check (r_rate >= 0 and r_rate <= 1),   -- 提成率 r（margin_based 口径，公约 §4.5）
  matrix_t_amt    bigint check (matrix_t_amt is null or matrix_t_amt >= 0),  -- 矩阵 T（分）
  commission_base text not null default 'margin_based'
                  check (commission_base in ('margin_based','neutral_kpi')), -- 🔴 E-08 去 contract_amount 写入径
  effective_from  date not null,                               -- 生效日：planVersionAt = effective_from ≤ date 的最大版本
  created_by      uuid,
  created_at      timestamptz not null default now(),          -- 服务器时间戳（非客户端）
  primary key (tenant_id, version)
);
create index if not exists cpv_effective_idx on comp_plan_versions(tenant_id, effective_from);

-- ---------- RLS（照 C0/C2 模板；🔴 A-C02：策略不含 is_platform()） ----------
alter table comp_plan_versions enable row level security;
alter table comp_plan_versions force row level security;
drop policy if exists cpv_sel on comp_plan_versions;
create policy cpv_sel on comp_plan_versions for select using (is_member(tenant_id));
drop policy if exists cpv_ins on comp_plan_versions;
create policy cpv_ins on comp_plan_versions for insert with check (is_member(tenant_id));
-- 🔴 无 UPDATE/DELETE 策略（默认拒绝）+ 权限层双保险
revoke update, delete on comp_plan_versions from public;

-- ---------- 🔴 append-only 触发器（对表所有者与 RLS 内外一律生效） ----------
create or replace function c3_plan_version_guard() returns trigger language plpgsql as $$
begin
  raise exception 'comp_plan_versions append-only: % has no success path (改版=新增版本行；历史版本留痕可查全表)', tg_op;
end $$;
drop trigger if exists trg_comp_plan_versions_append_only on comp_plan_versions;
create trigger trg_comp_plan_versions_append_only
  before update or delete on comp_plan_versions for each row execute function c3_plan_version_guard();
