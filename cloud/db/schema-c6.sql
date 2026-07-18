-- ============================================================
-- AI 销售操盘手 · 云端版 · C6 真相层（v5.1 §12 C6 行：M21/M32/M9/M11/M18/M19）
-- 🔴 依赖 schema.sql + schema-c2.sql（+c3/c4）先执行：
--    tenants / is_member() 来自 C0；deals / lead_assignments / salespersons /
--    categories / manager_change_events / external_refs 来自 C2。
--
-- 本段新增两张【派生落表】（公约 A-21 / v5.1 §2.3）：
--   1) derived_scalars —— 派生标量统一落表（不可每次现算），带 computed_at，
--      dayRoll 后重算（UPSERT 覆盖式：同键再算 = 覆盖值 + 刷新 computed_at，行数不变）。
--      scope='tenant' → target_id 恒 NULL；scope='person' → target_id = spId。
--      key 例：imbalanceRate / redrawBand / uerTeamMean / realP90Factor / dvi / uer(person)
--   2) m21_norms —— M21 地盘归一化逐人逐月结果（🔴 全系统最重的锁 · 3号 §3.2）。
--      归一化排名 = 全系统排名唯一合法输入；m21Done(month) = 该月 ≥2 行 ⇒ 闸①放行。
--
-- 数据类型（公约【2】）：金额分；比率/派生值 double precision（派生非录入，允许浮点）；
-- 月份键 text 'YYYY-MM'。派生表可整月重算覆盖 → 无 deleted_at（软删无意义）。
-- RLS：enable + force + is_member（照 C0/C2 模板；🔴 A-C02 策略不含 is_platform()）。
-- ============================================================

-- ---------- 1 · derived_scalars ----------
create table if not exists derived_scalars (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  scope       text not null check (scope in ('tenant','person')),
  target_id   text,                                     -- person → spId；tenant → null
  key         text not null,
  period      text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- 'YYYY-MM'
  value_num   double precision,                         -- 🔴 null ≠ 0：证据不足存 null（显"—"），不硬造
  value_json  jsonb,
  computed_at timestamptz not null default now(),       -- 公约 A-21：asOf = 计算日（v5.1 §2.3）
  created_by  uuid, updated_by uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint derived_scalars_scope_ck check (
    (scope = 'tenant' and target_id is null) or (scope = 'person' and target_id is not null)),
  -- 🔴 UPSERT 覆盖式唯一键（nulls not distinct：tenant 级 target_id=NULL 也参与唯一）
  constraint derived_scalars_uniq unique nulls not distinct (tenant_id, scope, target_id, key, period)
);
create index if not exists ds_tenant_key_idx on derived_scalars(tenant_id, key, period);

-- ---------- 2 · m21_norms ----------
create table if not exists m21_norms (
  tenant_id        uuid not null references tenants(id) on delete cascade,
  sp_id            text not null,
  month            text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  leads            int check (leads is null or leads >= 0),      -- 该月线索量（分配+自开发）
  lead_index       double precision,                             -- 线索指数 = 个人/人均（null=无线索基数）
  unit_lead_margin double precision,                             -- 单位线索毛利（分/条）
  norm_margin      double precision,                             -- 归一化毛利（含自开发加成，分）
  orig_rank        int check (orig_rank is null or orig_rank >= 1),
  norm_rank        int check (norm_rank is null or norm_rank >= 1),   -- 🔴 排名唯一合法输入
  computed_at      timestamptz not null default now(),
  created_by       uuid, updated_by uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, sp_id, month)                          -- 🔴 UPSERT 覆盖的物理落点
);
create index if not exists m21_month_idx on m21_norms(tenant_id, month);

-- ---------- RLS（照 C0/C2 模板） ----------
do $$ declare t text;
begin
  foreach t in array array['derived_scalars','m21_norms'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_rw', t);
    execute format('create policy %I on %I for all using (is_member(tenant_id)) with check (is_member(tenant_id))', t || '_rw', t);
  end loop;
end $$;
