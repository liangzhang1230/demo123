-- ============================================================
-- AI 销售操盘手 · 云端版 · C2 数据模型（v5.1 §3 / §12 C2 行）
-- 🔴 依赖 schema.sql（C0 底座）先执行：tenants / members / event_stream /
--    action_cards / is_member() / force RLS 模板均来自 C0。
--
-- 内容：
--   A. 公约【1A】32 共享实体全部建表（表名 snake_case 复数，映射见各表头注释）
--   B. 公约【1B】板块内实体建表（plan_audits / coef_overrides / op_cost_items /
--      plan_period_configs / process_baselines / elimination_configs /
--      boss_op_logs / boss_self_ratings / recipe_sources / spot_check_cards /
--      pair_assignments / shift_configs / pace_configs）
--   C. 每表统一云端增量列（v5.1 §3.1）：tenant_id / created_by / updated_by /
--      created_at / updated_at / deleted_at（事件流表在 C0，不可删、无 deleted_at）
--   D. 枚举一律 CHECK 约束，值逐字照各板块件二枚举注册表（E/ZE/SE/LE/YE 系）
--   E. 数据类型规范（公约【2】）：金额 *_amt bigint（分）；比率 numeric 0–1；
--      日期 date；月份键 text 'YYYY-MM'；ID text（{缩写}_{毫秒}_{4位随机}，应用层生成）
--   F. RLS：每表 enable + force + is_member(tenant_id)（照 C0 模板）
--   G. 不可变实体拦截（触发器）：
--      menu_choices / covenant_docs 禁 UPDATE/DELETE（irrevocable）
--      m28_agreements 禁 rate / duration_months 下调、禁撤销 irrevocable
--      ledger_entries append-only（唯一例外：honored_at 从 null→非 null 回填）
-- ============================================================

-- ============================================================
-- A · 公约【1A】共享实体（32 项）
-- ============================================================

-- #1 Salesperson → salespersons（公约最小字段集，各板块只许扩展不许另建）
create table if not exists salespersons (
  tenant_id        uuid not null references tenants(id) on delete cascade,
  id               text not null,                                   -- spId
  name             text not null,
  phone            text,                                            -- 查重三规则键
  city_tier        text check (city_tier in ('tier1','tier2','tier34')),                 -- E-01
  level            text check (level in ('sales','manager','executive')),                -- E-06 levelType
  position_type    text check (position_type in ('pure_sales','advisory','aftersales')), -- E-07
  hire_date        date,
  leave_date       date,
  leave_reason     text check (leave_reason in ('resign_salary','resign_other','probation_fail','behavioral_fail','layoff')), -- ZE-05
  manager_id       text,
  hire_batch_id    text,
  source_channel   text check (source_channel in ('boss_zhipin','liepin','zhilian','referral','reserve_pool','other')),       -- ZE-04
  base_salary_amt  bigint,
  hiring_cost_amt  bigint,
  is_active        boolean not null default true,
  social_cost_rate numeric check (social_cost_rate is null or (social_cost_rate >= 0 and social_cost_rate <= 1)), -- 3号板块补充：可选覆盖
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #2 CompPlanScenario → comp_plan_scenarios（13 项输入快照；输出不存储、载入即重算）
create table if not exists comp_plan_scenarios (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  id           text not null,                                       -- scenarioId
  name         text not null,
  created_date date,
  inputs       jsonb not null,                                      -- PlanInputs 13 项全量（内联，非独立实体）
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #3 TeamStructure → team_structures（人数/主管数/层级）
create table if not exists team_structures (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  id            text not null,
  sales_count   int not null check (sales_count >= 0),
  manager_count int not null check (manager_count >= 0),
  level_count   int check (level_count between 1 and 4),            -- maxLevels=4（公约 §5.1）
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #4 CovenantDoc → covenant_docs（招聘信用书；snapshot 签发时刻快照，🔴 永不随场景重算——触发器禁改禁删）
create table if not exists covenant_docs (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  id             text not null,                                     -- covenantId
  code           text not null,                                     -- SK-{YYMMDD}-{4位}
  candidate_name text not null,
  scenario_id    text,
  issued_date    date,
  snapshot       jsonb not null,                                    -- {levelType,tierGrade,baseSalaryAmt,thresholdTAmt,commissionRate}
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #5 Covenant → covenants（前程合约，留人器 M16.4；无自由文本条件栏）
create table if not exists covenants (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  id             text not null,                                     -- covId
  employee_id    text not null,
  lines          jsonb not null default '[]',                       -- [{metricId,cmp,value,durationMonths}]（多行=且）
  promise_text   text,                                              -- 白名单模板
  both_confirmed boolean not null default false,
  irrevocable    boolean not null default false,                    -- 模板⑥强制 true（应用层）
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #6 Deal → deals（算账器写；paymentAmt=回款·分；margin_rate_snapshot=成交时品类毛利率快照）
create table if not exists deals (
  tenant_id            uuid not null references tenants(id) on delete cascade,
  id                   text not null,                               -- dealId
  employee_id          text not null,
  deal_date            date not null,
  entry_date           date,                                        -- 录入日（DVI 用）
  payment_amt          bigint not null default 0 check (payment_amt >= 0),
  category_id          text not null,
  lead_source_type     text check (lead_source_type in ('ad','organic','referral','self_dev')),  -- SE-03
  status               text not null default 'won' check (status in ('open','won','lost')),
  paid_date            date,
  margin_rate_snapshot numeric check (margin_rate_snapshot is null or (margin_rate_snapshot >= 0 and margin_rate_snapshot <= 1)),
  note                 text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);
create index if not exists deals_tenant_date_idx on deals(tenant_id, deal_date);

-- #7 Category → categories（毛利率快照源）
create table if not exists categories (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  id                text not null,                                  -- categoryId
  name              text not null,
  gross_margin_rate numeric not null check (gross_margin_rate >= 0 and gross_margin_rate <= 1),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #8 PayoutEntry → payout_entries（系统外发放·一笔六吃；reimburse 🔴 只进成本）
create table if not exists payout_entries (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  id            text not null,                                      -- payoutId
  employee_id   text not null,
  payout_date   date not null,
  type          text not null check (type in ('instant_bonus','year_end_bonus','dividend','reimburse','mentoring_share','recipe_royalty','sprint_vested','discretionary','other')), -- SE-01
  amount_amt    bigint not null check (amount_amt >= 0),
  timing        text check (timing in ('immediate','weekend_delayed','scheduled')),      -- SE-04（仅 discretionary 必填）
  has_condition boolean,                                            -- 仅 discretionary
  period_months int,                                                -- dividend 摊薄用
  note          text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #9 RefundEntry → refund_entries（🔴 不红冲、不对照原单、不倒扣提成）
create table if not exists refund_entries (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  id          text not null,
  employee_id text not null,
  refund_date date not null,
  category_id text not null,
  amount_amt  bigint not null check (amount_amt >= 0),
  note        text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #10 DiscountEntry → discount_entries（🔴 降价必须有名字）
create table if not exists discount_entries (
  tenant_id        uuid not null references tenants(id) on delete cascade,
  id               text not null,
  discount_date    date not null,
  employee_id      text not null,
  deal_id          text,
  category_id      text not null,
  list_price_amt   bigint not null check (list_price_amt >= 0),
  actual_price_amt bigint not null check (actual_price_amt >= 0),
  discount_amt     bigint not null check (discount_amt >= 0),       -- 自动 = 差
  reason           text not null check (reason in ('competitive_pressure','volume_deal','period_end_push','customer_relationship','strategic_entry','authorized_promo','other')), -- SE-02
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #11 LeadAssignment → lead_assignments（M21 输入；month 键 'YYYY-MM'）
create table if not exists lead_assignments (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  id             text not null,
  employee_id    text not null,
  month          text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  assigned_leads int not null check (assigned_leads >= 0),
  self_dev_leads int not null default 0 check (self_dev_leads >= 0),
  source_type    text check (source_type in ('ad','organic','referral','self_dev')),  -- SE-03（🔴 自开发与分配分开统计）
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #12 DailyReport → daily_reports（育人器 M1 四计数 YE-01：leads/intents/samples/contracts）
create table if not exists daily_reports (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  id           text not null,                                       -- drId
  employee_id  text not null,
  report_date  date not null,
  leads        int not null default 0 check (leads >= 0),
  intents      int not null default 0 check (intents >= 0),
  samples      int not null default 0 check (samples >= 0),
  contracts    int not null default 0 check (contracts >= 0),
  submitted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id),
  unique (tenant_id, employee_id, report_date)
);

-- #13 CoachingAck → coaching_acks（辅导/带教回执；剂量分子只取 confirmed）
create table if not exists coaching_acks (
  tenant_id           uuid not null references tenants(id) on delete cascade,
  id                  text not null,                                -- ackId
  coach_task_id       text,
  manager_id          text not null,
  employee_id         text not null,
  manager_reported_at timestamptz,
  duration_min        int check (duration_min is null or duration_min >= 0),
  employee_ack_at     timestamptz,
  employee_ack_status text not null default 'no_response' check (employee_ack_status in ('confirmed','disputed','no_response')), -- ZE-08
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #14 CoachTask → coach_tasks（14 天回弹单次定稿 YE-05）
create table if not exists coach_tasks (
  tenant_id           uuid not null references tenants(id) on delete cascade,
  id                  text not null,                                -- ctId
  employee_id         text not null,
  manager_id          text not null,
  stage               text,                                         -- 环节
  manager_reported_at timestamptz,
  rebound_due         date,                                         -- created + 14d
  rebound_result      text check (rebound_result in ('rebound','flat','worse')),  -- YE-05
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #15 Prescription → prescriptions（每日处方三槽位；🔴 处方永不挂钱）
create table if not exists prescriptions (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  id           text not null,                                       -- rxId
  employee_id  text not null,
  rx_date      date not null,
  type         text not null check (type in ('volume','quality','speed','jolt','momentum','pairing')),  -- YE-02
  target       text not null check (target in ('self','manager','boss')),                               -- YE-03
  slot_data    jsonb,                                               -- {behaviorData,action,benchmark}
  text         text,
  psi_parts    jsonb,                                               -- {targeting,benchmark,dataRef,ackRate}
  plv_passed   boolean,
  coach_ack_id text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #16 Bounty → bounties（trigger = LE-04 全 12 值：行为类 7 + 结果类 5；结果类可否保存由闸③/闸⑧三态动态判定，
--     🔴 严禁在表约束层写"结果类一律拦截"——那是 D-1 已废除的旧逻辑）
create table if not exists bounties (
  tenant_id       uuid not null references tenants(id) on delete cascade,
  id              text not null,                                    -- bountyId
  trigger         text not null check (trigger in
                    ('ride_along','coaching','pool_activate','spot_check_pass','self_sourced_lead','jolt_deescalate','prescription_ack',
                     'first_deal','record_break','sprint','backlog_clear','hire')),   -- LE-04 全 12 值
  template        text check (template in ('first_deal','record_break','sprint','backlog_clear','hire')),  -- YE-04（五模板锁死）
  params          jsonb,
  amount_amt      bigint check (amount_amt is null or amount_amt >= 0),               -- 建议制
  active          boolean not null default true,
  achieved_events jsonb not null default '[]',                      -- [{employeeId,achievedAt,cashedAt|null}]
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #17 HiringCriteria → hiring_criteria（配置单例；weights Σ=100 硬校验在应用层）
create table if not exists hiring_criteria (
  tenant_id            uuid not null references tenants(id) on delete cascade,
  id                   text not null,
  weights              jsonb not null,                              -- {achievement..adaptive}
  min_experience_years int not null default 0 check (min_experience_years >= 0),
  age_range            jsonb,                                       -- null | 区间
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #18 Candidate → candidates（phone 查重硬钥匙）
create table if not exists candidates (
  tenant_id           uuid not null references tenants(id) on delete cascade,
  id                  text not null,                                -- candId
  name                text not null,
  phone               text not null,
  position_name       text,
  expected_salary_amt bigint check (expected_salary_amt is null or expected_salary_amt >= 0),
  source_channel      text not null check (source_channel in ('boss_zhipin','liepin','zhilian','referral','reserve_pool','other')),  -- ZE-04
  pool                text not null check (pool in ('resume','interview_invite','interview','offer','hired','reserve','rejected')),  -- ZE-01
  pool_entered_date   date,
  interview_rounds    int not null default 0 check (interview_rounds >= 0),
  drop_reason         text check (drop_reason in
                        ('resume_mismatch','interview_failed','background_mismatch','quit_job_hunting',            -- ZE-02 硬淘汰
                         'offer_rejected_salary','offer_rejected_other','interview_noshow','timing_mismatch','salary_gap')), -- ZE-03 可回头
  last_touch_date     date,
  recruiter_name      text,
  score_pack_id       text,
  employee_id         text,                                         -- 入职回链
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);
create unique index if not exists candidates_phone_uq on candidates(tenant_id, phone) where deleted_at is null;

-- #19 InterviewScorePack → interview_score_packs（八维 + darkTriadScore 数值 + JOLT；转 hired 时明细销毁规则在应用层，见 2号 Z-D1）
create table if not exists interview_score_packs (
  tenant_id        uuid not null references tenants(id) on delete cascade,
  id               text not null,                                   -- packId
  cand_id          text not null,
  scores           jsonb not null,                                  -- {achievement..adaptive: 0–100}（ZE-09 八维）
  dark_triad_score numeric check (dark_triad_score is null or (dark_triad_score >= 0 and dark_triad_score <= 100)),
  jolt_type        text check (jolt_type in ('pressure','jolt')),
  scored_date      date,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #20 PracticeLog → practice_logs（入职练习记录 ZE-06/ZE-07）
create table if not exists practice_logs (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  id            text not null,                                      -- logId
  employee_id   text not null,
  practice_date date not null,
  scenario      text not null check (scenario in ('opening','discovery','objection','closing','jolt')),  -- ZE-06
  score         numeric check (score is null or (score >= 0 and score <= 100)),
  duration_sec  int check (duration_sec is null or duration_sec >= 0),
  reviewer      text not null check (reviewer in ('self','ai','manager')),                               -- ZE-07
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #21 HireBatch → hire_batches（vintage）
create table if not exists hire_batches (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  id         text not null,                                         -- batchId
  label      text not null,                                         -- 如 2026-Q1
  member_ids jsonb not null default '[]',
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #22 ManagerChangeEvent → manager_change_events（换帅事件，算账器 M11）
create table if not exists manager_change_events (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  id             text not null,                                     -- mcId
  team_id        text not null,
  new_manager_id text not null,
  change_date    date not null,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #23 LedgerEntry → ledger_entries（履约总账·双时间戳；🔴 append-only，唯一例外 honored_at null→非null 回填——触发器）
create table if not exists ledger_entries (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  id           text not null,                                       -- ledgerId
  employee_id  text not null,
  category     text not null check (category in ('bounty','challenge','contract','dividend','mentoring_share','recipe_royalty')),  -- LE-05 履约准入
  promise_text text,
  achieved_at  date not null,                                       -- 系统判达成
  honored_at   date,                                                -- 老板点确认（回填例外）
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #24 ObjectionEntry → objection_entries（通道A；pending>7天 → mark_active=false 负面标记失效
--     ——L-D6 默认保护员工，惰性 sweep 在应用层 m30.sweepObjections）
create table if not exists objection_entries (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  id          text not null,                                        -- objId
  employee_id text not null,                                        -- 🔴 异议不可匿名
  target_type text not null check (target_type in ('bad_debt','stop_bleed','cull_suggest','rank_bottom','other')),  -- LE-01
  target_id   text,
  reason      text,
  note        text,
  status      text not null default 'pending' check (status in ('pending','accepted','upheld','recheck')),          -- LE-02
  mark_active boolean not null default true,                        -- 关联负面标记是否仍有效（sweep 置 false）
  resolved_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #25 SuggestionEntry → suggestion_entries（通道B；🔴 可匿名：employee_id 可空且匿名不落 actorId，仍计 EI 分母）
create table if not exists suggestion_entries (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  id          text not null,                                        -- sugId
  employee_id text,                                                 -- null = 匿名
  category    text not null check (category in ('lead_allocation','comp_plan','product','process','training','other')),  -- LE-03
  content     text not null,
  status      text not null default 'pending' check (status in ('pending','adopted','ignored','later')),
  resolved_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #26 M28Agreement → m28_agreements（产权机器；🔴 irrevocable：rate/duration_months 下调无代码成功路径——触发器）
create table if not exists m28_agreements (
  tenant_id             uuid not null references tenants(id) on delete cascade,
  id                    text not null,                              -- m28Id
  master_id             text not null,
  kind                  text not null check (kind in ('mentoring','royalty')),
  rate                  numeric not null check (rate > 0 and rate <= 1),      -- 带教默认 0.05；使用费默认 0.02
  duration_months       int not null check (duration_months > 0),
  start_trigger         text not null check (start_trigger in ('apprentice_ramp_done','recipe_live')),
  baseline_snapshot_amt bigint,                                     -- 使用费：上线前3月净贡献均值快照 🔴 不可改
  irrevocable           boolean not null default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #27 MenuChoice → menu_choices（自选激励菜单；🔴 irrevocable：无 UPDATE/DELETE 路径——触发器）
create table if not exists menu_choices (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  id                text not null,                                  -- choiceId
  salesperson_name  text not null,
  menu_snapshot     jsonb not null,                                 -- 三档 {quotaAmt,bonusAmt} 快照
  chosen_tier       text not null check (chosen_tier in ('low','mid','high')),  -- E-11
  chosen_date       date,
  irrevocable       boolean not null default true check (irrevocable),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #28 OverrideEvent → override_events（双形实体，形状互斥 CHECK）：
--   A 形＝面试推翻（2号 ZE-10；🔴 仅由推荐≠终决自动生成，零手工）
--   B 形＝治理留痕（4号 G3：try_downgrade M28 拦截 / force_dividend_risk_ack 分红强启——
--     🔴 L-D1：尝试下调即留痕 + AHC 扣分 + 全员可见（visible_to_all 恒 true））
create table if not exists override_events (
  tenant_id        uuid not null references tenants(id) on delete cascade,
  id               text not null,                                   -- ovId
  interviewer_name text,                                            -- A 形必填
  cand_id          text,                                            -- A 形必填
  direction        text check (direction in ('hire_against','reject_against')),  -- ZE-10
  system_recommend text check (system_recommend in ('hire','reject')),
  event_date       date,
  action           text check (action in ('try_downgrade','force_dividend_risk_ack')),  -- B 形必填
  m28_id           text,                                            -- B 形：被拦截的 M28 协议
  note             text,
  visible_to_all   boolean not null default true,                   -- 🔴 B 形留痕全员可见
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id),
  constraint override_events_shape_ck check (
    (interviewer_name is not null and cand_id is not null and direction is not null
      and system_recommend is not null and action is null)
    or (action is not null and interviewer_name is null and cand_id is null
      and direction is null and system_recommend is null))
);

-- #29 Experiment → experiments（M31 系数实验；🔴 分组=按 M21 归一化历史分层随机，老板不能手选——应用层）
create table if not exists experiments (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  id            text not null,                                      -- expId
  name          text not null,
  hypothesis    text,
  group_a       jsonb not null default '[]',
  group_b       jsonb not null default '[]',
  metric_id     text,
  duration_days int,
  started_at    date,
  ended_at      date,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #30 HandoverCard → handover_cards（在途单交接卡 LE-09；🔴 无删除路径（只可标记完成）在应用层）
create table if not exists handover_cards (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  id          text not null,                                        -- hcId
  leaver_id   text not null,
  client_name text not null,
  stage       text not null check (stage in ('hot','warm','cold','stuck')),  -- LE-09
  amount_amt  bigint not null default 0 check (amount_amt >= 0),
  last_action text,
  receiver_id text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #31 CallMetrics 🟤 → call_metrics（公约埋设：建表不建界面；点亮条件=接入录音数据源，M44b）
create table if not exists call_metrics (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  id                text not null,                                  -- cmId
  employee_id       text not null,
  call_date         date not null,
  talk_listen_ratio numeric check (talk_listen_ratio is null or (talk_listen_ratio >= 0 and talk_listen_ratio <= 1)),
  question_count    int check (question_count is null or question_count >= 0),
  duration_sec      int check (duration_sec is null or duration_sec >= 0),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- #32 ExternalRef → external_refs（外部信封只读缓存；🔴 (tenant_id,board) 唯一，同 board 再次导入=整条覆盖不合并；
--     云端同库直读后降级为非必需，仍保留以承接单机信封迁移（v5.1 §2.3））
create table if not exists external_refs (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  board             text not null check (board in ('dingjia','zhaoren','suanzhang','liuren','yuren')),
  exported_at       date,
  data_version      int not null default 1,
  coefficients_hash text,
  derived           jsonb not null default '{}',
  entities          jsonb not null default '{}',
  imported_at       timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, board)                                    -- 🔴 唯一键 = 整条覆盖的物理落点
);

-- ============================================================
-- B · 公约【1B】板块内实体
-- （MarketPriceCache / MomentumState = 派生视图非实体，不建表；
--   PlanInputs / CapacityInputs = 内联输入模型，不建表）
-- ============================================================

-- 1号 PlanAudit → plan_audits（风洞体检，租户内单例由应用层保证）
create table if not exists plan_audits (
  tenant_id               uuid not null references tenants(id) on delete cascade,
  id                      text not null,
  position_type           text check (position_type in ('pure_sales','advisory','aftersales')),               -- E-07
  current_commission_base text check (current_commission_base in ('contract_amount','margin_based','neutral_kpi')), -- E-08
  current_base_salary_amt bigint check (current_base_salary_amt is null or current_base_salary_amt >= 0),
  process_redline_count   int not null default 0 check (process_redline_count between 0 and 10),
  guardrail_metric        text check (guardrail_metric in ('complaint_rate','refund_rate','discount_rate')),  -- E-10
  exploration_mode        boolean not null default false,
  control_measures        jsonb not null default '[]',              -- E-09[]
  claimed_outlets         jsonb not null default '[]',              -- ⊆ control_measures（应用层）
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 1号 MatrixOverride → coef_overrides（系数覆盖：getCoef(path)=Override??COEFFICIENTS；数值权归老板）
create table if not exists coef_overrides (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  path          text not null,                                      -- 系数路径，如 'minWageTable.tier1'
  value         jsonb not null,
  modified_date date,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, path)
);

-- 3号 OpCostItem → op_cost_items（按天摊；🔴 闸④成交类产品成本禁止在此重录——应用层）
create table if not exists op_cost_items (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  id          text not null,                                        -- ocId
  name        text not null,
  kind        text not null check (kind in ('rent','marketing','admin','other')),  -- SE-07
  monthly_amt bigint not null check (monthly_amt >= 0),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 3号 PlanPeriodConfig → plan_period_configs（单例；M34 用）
create table if not exists plan_period_configs (
  tenant_id                uuid not null references tenants(id) on delete cascade,
  id                       text not null,
  period_type              text not null check (period_type in ('month','quarter')),  -- SE-06
  commission_threshold_amt bigint,                                  -- null → 聚集指数 "—"
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 3号 ProcessBaseline → process_baselines（M36；imported 桩：booked_date 带入、metric/baseline 待补录）
create table if not exists process_baselines (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  id             text not null,                                     -- pbId
  metric_name    text,                                              -- imported 桩允许留空，补录后方可出卡线率
  baseline_value int check (baseline_value is null or baseline_value >= 0),
  source         text not null default 'local' check (source in ('local','imported')),
  booked_date    date,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 3号 EliminationConfig → elimination_configs（单例）
create table if not exists elimination_configs (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  id                text not null,
  basis             text not null check (basis in ('relative_rank','absolute_line')),  -- SE-05
  survival_months   int not null default 3 check (survival_months > 0),
  survival_line_amt bigint,                                         -- null → 默认取该员工月 laborCost
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 4号 BossOpLog → boss_op_logs（SII/EI/AHC 数据源；🔴 采集的是老板自己的操作，设置页明示且可关）
create table if not exists boss_op_logs (
  tenant_id uuid not null references tenants(id) on delete cascade,
  id        text not null,
  ts        timestamptz not null default now(),
  action    text not null check (action in ('view_detail','card_ignore','card_adopt','try_downgrade','ratchet_hit','honor_confirm')),
  target_id text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 4号 BossSelfRating → boss_self_ratings（M29.5 四滑杆 0–100）
create table if not exists boss_self_ratings (
  tenant_id uuid not null references tenants(id) on delete cascade,
  id        text not null,
  rated_at  date not null,
  sii       int not null check (sii between 0 and 100),
  ei        int not null check (ei between 0 and 100),
  dvi       int not null check (dvi between 0 and 100),
  ahc       int not null check (ahc between 0 and 100),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 5号 RecipeSource → recipe_sources（每次设定必过闸④——应用层）
create table if not exists recipe_sources (
  tenant_id       uuid not null references tenants(id) on delete cascade,
  id              text not null,
  source_ids      jsonb not null default '[]',                      -- 1–3 人合成均值
  set_at          date,
  set_by          text,
  qualified_flags jsonb,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 5号 SpotCheckCard → spot_check_cards（🔴 只出题、不记录问答结果、无造假标记字段——表结构级保证）
create table if not exists spot_check_cards (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  id             text not null,                                     -- sccId
  week_of        date not null,
  employee_id    text not null,
  check_date     date,
  stage          text,
  reported_count int check (reported_count is null or reported_count >= 0),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 5号 PairAssignment → pair_assignments（M40 配对 YE-08；>3 周强制轮换在应用层）
create table if not exists pair_assignments (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  id                text not null,                                  -- pairId
  week_of           date not null,
  coach_id          text not null,
  learner_id        text not null,
  topic_stage       text,
  status            text not null default 'active' check (status in ('active','queued','rotated')),  -- YE-08
  consecutive_weeks int not null default 1 check (consecutive_weeks >= 1),
  coach_ack_id      text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- 5号 ShiftConfig → shift_configs（点名排班：员工 × 星期几；休息日不催不计分母）
create table if not exists shift_configs (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  id          text not null,
  employee_id text not null,
  weekday     int not null check (weekday between 0 and 6),         -- 0=周日
  is_workday  boolean not null default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id),
  unique (tenant_id, employee_id, weekday)
);

-- 5号 PaceConfig → pace_configs（单例：completion=周期内回款÷个人配额）
create table if not exists pace_configs (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  id           text not null,
  period_type  text not null check (period_type in ('month','quarter')),  -- SE-06 同口径
  quota_source text,                                                -- 'dingjia_envelope' | 'manual'
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key (tenant_id, id)
);

-- ============================================================
-- F · RLS：每表 enable + force + is_member 模板（照 C0 写法）
-- 🔴 A-C02：以下任何业务表策略均不含 is_platform()——平台方连一行都查不到
-- ============================================================
do $$ declare t text;
begin
  foreach t in array array[
    'salespersons','comp_plan_scenarios','team_structures','covenant_docs','covenants',
    'deals','categories','payout_entries','refund_entries','discount_entries',
    'lead_assignments','daily_reports','coaching_acks','coach_tasks','prescriptions',
    'bounties','hiring_criteria','candidates','interview_score_packs','practice_logs',
    'hire_batches','manager_change_events','ledger_entries','objection_entries','suggestion_entries',
    'm28_agreements','menu_choices','override_events','experiments','handover_cards',
    'call_metrics','external_refs',
    'plan_audits','coef_overrides','op_cost_items','plan_period_configs','process_baselines',
    'elimination_configs','boss_op_logs','boss_self_ratings','recipe_sources','spot_check_cards',
    'pair_assignments','shift_configs','pace_configs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_rw', t);
    execute format('create policy %I on %I for all using (is_member(tenant_id)) with check (is_member(tenant_id))', t || '_rw', t);
  end loop;
end $$;

-- ============================================================
-- G · 不可变实体拦截（触发器；对表所有者与 RLS 内外一律生效）
-- ============================================================

-- G1 · menu_choices / covenant_docs：irrevocable —— UPDATE/DELETE 无成功路径
create or replace function c2_immutable() returns trigger language plpgsql as $$
begin
  raise exception '% is irrevocable: % has no success path', tg_table_name, tg_op;
end $$;
drop trigger if exists trg_menu_choices_immutable on menu_choices;
create trigger trg_menu_choices_immutable
  before update or delete on menu_choices for each row execute function c2_immutable();
drop trigger if exists trg_covenant_docs_immutable on covenant_docs;
create trigger trg_covenant_docs_immutable
  before update or delete on covenant_docs for each row execute function c2_immutable();

-- G2 · m28_agreements：🔴 rate / duration_months 下调无成功路径；irrevocable 不可撤销；快照不可改；禁 DELETE
--     （尝试下调 → 上层记录 try_downgrade 留痕 + AHC 扣分 + 全员可见，由服务层承接）
create or replace function m28_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'm28_agreements irrevocable: DELETE has no success path';
  end if;
  if new.rate < old.rate then
    raise exception 'm28 irrevocable: rate downgrade has no success path (% -> %)', old.rate, new.rate;
  end if;
  if new.duration_months < old.duration_months then
    raise exception 'm28 irrevocable: duration_months downgrade has no success path (% -> %)', old.duration_months, new.duration_months;
  end if;
  if old.irrevocable and not new.irrevocable then
    raise exception 'm28 irrevocable flag cannot be revoked';
  end if;
  if new.baseline_snapshot_amt is distinct from old.baseline_snapshot_amt then
    raise exception 'm28 baseline_snapshot_amt is a signing-time snapshot: immutable';
  end if;
  return new;
end $$;
drop trigger if exists trg_m28_guard on m28_agreements;
create trigger trg_m28_guard
  before update or delete on m28_agreements for each row execute function m28_guard();

-- G3 · ledger_entries：append-only（双时间戳纯闭环）
--     唯一例外：honored_at 从 null → 非 null（老板确认履约），且其余业务字段一律不变
create or replace function ledger_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ledger_entries append-only: DELETE forbidden';
  end if;
  if old.honored_at is not null then
    raise exception 'ledger_entries immutable after honored';
  end if;
  if new.honored_at is null then
    raise exception 'ledger_entries append-only: UPDATE forbidden (only honored_at null -> value backfill allowed)';
  end if;
  if new.id           is distinct from old.id
  or new.tenant_id    is distinct from old.tenant_id
  or new.employee_id  is distinct from old.employee_id
  or new.category     is distinct from old.category
  or new.promise_text is distinct from old.promise_text
  or new.achieved_at  is distinct from old.achieved_at
  or new.created_by   is distinct from old.created_by
  or new.created_at   is distinct from old.created_at
  or new.deleted_at   is distinct from old.deleted_at then
    raise exception 'ledger_entries: only honored_at may be backfilled, all other fields immutable';
  end if;
  return new;
end $$;
drop trigger if exists trg_ledger_guard on ledger_entries;
create trigger trg_ledger_guard
  before update or delete on ledger_entries for each row execute function ledger_guard();

-- G4 · handover_cards：🔴 无删除路径（L-D12：交接卡只可标记完成/指派 receiver，不可删）
create or replace function handover_guard() returns trigger language plpgsql as $$
begin
  raise exception 'handover_cards: DELETE has no success path (L-D12 只可标记完成)';
end $$;
drop trigger if exists trg_handover_guard on handover_cards;
create trigger trg_handover_guard
  before delete on handover_cards for each row execute function handover_guard();
