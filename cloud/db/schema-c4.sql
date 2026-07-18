-- ============================================================
-- AI 销售操盘手 · 云端版 · C4 招聘链（v5.1 §12 C4 行：M3–M6、M8）
-- 🔴 依赖前三段先执行：
--    schema.sql    （C0）tenants / members / event_stream / is_member() / force RLS 模板
--    schema-c2.sql （C2）candidates / salespersons / interview_score_packs /
--                        hire_batches / deals / categories（M3/M5/M6/M8 取数面）
--    schema-c3.sql （C3）comp_plan_versions（M6 闸⑩ 底薪档 B 的当期版本取数源）
--
-- 本段只新增一张表：candidate_touches（v5.1 §5.1 M4 云端增量：
--   "CandidateTouch 触达记录落库"——2号板块无此实体，为云端原创增量列，
--   字段最小集 cand_id / touch_date / channel / note + 统一云端增量列）
--   channel 不设 CHECK：板块未定义触达渠道枚举，铁律 L-3 禁止在云端发明业务枚举
-- 另：M3–M6/M8 查询所需辅助索引（漏斗池扫描 / 市价 180 天窗 / 坏账·vintage 入离职扫描 / 事件复算）
-- 金额 *_amt bigint（分）；日期 date；RLS 照 C0/C2 模板（🔴 A-C02：策略不含 is_platform()）
-- ============================================================

create table if not exists candidate_touches (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  id         text not null,                       -- touchId（应用层生成）
  cand_id    text not null,                       -- → candidates.id（同租户）
  touch_date date not null,                       -- 业务日=ctx.today 显式注入（公约 C-14）
  channel    text,                                -- 触达渠道（自由文本，见头注）
  note       text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (tenant_id, id)
);
create index if not exists candidate_touches_cand_idx
  on candidate_touches(tenant_id, cand_id, touch_date desc);

-- ---------- 辅助索引 ----------
-- M3 五池看板 / M4 蓄水池：按池扫描
create index if not exists candidates_pool_idx
  on candidates(tenant_id, pool) where deleted_at is null;
-- M4 市价传感器：同岗 + 近180天（created_at 即实体 createdDate 的 C2 落列）
create index if not exists candidates_position_idx
  on candidates(tenant_id, position_name) where deleted_at is null;
-- M5 坏账 90 天窗 / M6 vintage：入职、离职日扫描
create index if not exists salespersons_hire_idx
  on salespersons(tenant_id, hire_date) where deleted_at is null;
create index if not exists salespersons_leave_idx
  on salespersons(tenant_id, leave_date) where deleted_at is null;
-- M8 四灯：事件流按类型复算（汇总可由事件流复算，v5.1 §1.2）
create index if not exists es_tenant_type_idx on event_stream(tenant_id, type);

-- ---------- RLS（照 C0/C2 模板；🔴 A-C02：策略不含 is_platform()） ----------
alter table candidate_touches enable row level security;
alter table candidate_touches force row level security;
drop policy if exists candidate_touches_rw on candidate_touches;
create policy candidate_touches_rw on candidate_touches
  for all using (is_member(tenant_id)) with check (is_member(tenant_id));
