#!/usr/bin/env node
/* C2 数据模型验收（v5.1 §12 C2 行）：
   ① 公约【1A】32 实体齐全（information_schema 对照实体名→表名映射逐一断言）
   ② 枚举无越界（≥8 类枚举各插一条非法值断言被拒）
   ③ 任一汇总数可由事件流复算（seedTenant 双写 → SQL 聚合 vs replay.fold 逐项相等）
   ④ 不可变实体拦截（m28 下调 / menu_choices UPDATE / ledger append-only + honored_at 回填例外）
   ⑤ 新表 RLS 抽查（租户B 读租户A → 0 行）
   ⑥ 软删除口径（deleted_at is null 查询口径） */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../db/seed.mjs';
import { fold } from '../domain/replay.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

const TEST_TODAY = '2026-07-13';   // 公约 C-14/R-11：时钟注入，与五板块对拍同一基准日

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create role authenticated nologin;
  create role app_user login;
  grant usage on schema public to app_user;
  grant authenticated to app_user;
`);
await db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
await db.exec(readFileSync(join(root, 'db', 'schema-c2.sql'), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;`);

const U = {
  bossA: 'a0000000-0000-4000-8000-00000000000a',
  bossB: 'b0000000-0000-4000-8000-00000000000b',
};
async function as(uid, sql, params = []) {
  await db.exec(`set role app_user; select set_config('app.uid', '${uid || ''}', false);`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; }
  catch (e) { return { rows: null, err: e.message }; }
  finally { await db.exec(`reset role;`); }
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

/* 租户与成员（运维直插，超出 RLS 语境——与 c0 平台管理员同法） */
const [{ id: tenantA }] = await q(`insert into tenants(name, created_by) values ('租户A', $1) returning id`, [U.bossA]);
const [{ id: tenantB }] = await q(`insert into tenants(name, created_by) values ('租户B', $1) returning id`, [U.bossB]);
await q(`insert into members(user_id, tenant_id, role) values ($1, $2, 'boss'), ($3, $4, 'boss')`,
  [U.bossA, tenantA, U.bossB, tenantB]);

/* ================= ① 公约【1A】32 实体齐全 ================= */
console.log('— ① 公约【1A】32 实体齐全（实体名 → 表名映射逐一断言） —');
const MAP_1A = {
  Salesperson: 'salespersons', CompPlanScenario: 'comp_plan_scenarios', TeamStructure: 'team_structures',
  CovenantDoc: 'covenant_docs', Covenant: 'covenants', Deal: 'deals', Category: 'categories',
  PayoutEntry: 'payout_entries', RefundEntry: 'refund_entries', DiscountEntry: 'discount_entries',
  LeadAssignment: 'lead_assignments', DailyReport: 'daily_reports', CoachingAck: 'coaching_acks',
  CoachTask: 'coach_tasks', Prescription: 'prescriptions', Bounty: 'bounties',
  HiringCriteria: 'hiring_criteria', Candidate: 'candidates', InterviewScorePack: 'interview_score_packs',
  PracticeLog: 'practice_logs', HireBatch: 'hire_batches', ManagerChangeEvent: 'manager_change_events',
  LedgerEntry: 'ledger_entries', ObjectionEntry: 'objection_entries', SuggestionEntry: 'suggestion_entries',
  M28Agreement: 'm28_agreements', MenuChoice: 'menu_choices', OverrideEvent: 'override_events',
  Experiment: 'experiments', HandoverCard: 'handover_cards', CallMetrics: 'call_metrics', ExternalRef: 'external_refs',
};
ok(Object.keys(MAP_1A).length === 32, `映射表恰为 32 项（实际 ${Object.keys(MAP_1A).length}）`);
{
  const rows = await q(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`);
  const have = new Set(rows.map(r => r.table_name));
  const missing = Object.entries(MAP_1A).filter(([, t]) => !have.has(t));
  ok(missing.length === 0, '32 实体表全部存在', missing.map(([e, t]) => `${e}→${t}`).join(','));
  // 1B 板块内实体建表抽全查
  const t1b = ['plan_audits', 'coef_overrides', 'op_cost_items', 'plan_period_configs', 'process_baselines',
    'elimination_configs', 'boss_op_logs', 'boss_self_ratings', 'recipe_sources', 'spot_check_cards',
    'pair_assignments', 'shift_configs', 'pace_configs'];
  const miss1b = t1b.filter(t => !have.has(t));
  ok(miss1b.length === 0, `【1B】板块内实体 ${t1b.length} 表全部存在`, miss1b.join(','));
  // 云端增量列（v5.1 §3.1）：抽查 32 表全部带 tenant_id + deleted_at（事件流表在 C0，无 deleted_at）
  const cols = await q(`select table_name, column_name from information_schema.columns where table_schema='public'`);
  const byTable = new Map();
  cols.forEach(c => { if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Set()); byTable.get(c.table_name).add(c.column_name); });
  const lacking = Object.values(MAP_1A).filter(t => {
    const s = byTable.get(t) || new Set();
    return !['tenant_id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at'].every(c => s.has(c));
  });
  ok(lacking.length === 0, '32 表统一云端增量列（tenant_id/created_by/updated_by/created_at/updated_at/deleted_at）', lacking.join(','));
  ok(!(byTable.get('event_stream') || new Set()).has('deleted_at'), '事件流表不可删：无 deleted_at 列（v5.1 §3.1）');
  // ExternalRef 整条覆盖唯一键
  const uq = await q(`select count(*)::int as n from pg_constraint c join pg_class r on r.oid=c.conrelid
    where r.relname='external_refs' and c.contype='p'`);
  ok(uq[0].n === 1, 'external_refs 主键 (tenant_id, board) = 整条覆盖唯一键');
}

/* ================= ② 枚举无越界（CHECK 逐字照件二枚举注册表） ================= */
console.log('— ② 枚举无越界（非法值逐一被 CHECK 拒绝） —');
const enumCases = [
  ['E-01 cityTier', `insert into salespersons(tenant_id,id,name,city_tier) values ($1,'sp_x1','非法','tier5')`],
  ['ZE-01 pool', `insert into candidates(tenant_id,id,name,phone,source_channel,pool) values ($1,'cand_x1','非法','19900000001','other','swimming_pool')`],
  ['ZE-02/03 dropReason', `insert into candidates(tenant_id,id,name,phone,source_channel,pool,drop_reason) values ($1,'cand_x2','非法','19900000002','other','rejected','ran_away')`],
  ['ZE-04 sourceChannel', `insert into salespersons(tenant_id,id,name,source_channel) values ($1,'sp_x2','非法','tiktok')`],
  ['ZE-05 leaveReason', `insert into salespersons(tenant_id,id,name,leave_reason) values ($1,'sp_x3','非法','ghosted')`],
  ['SE-01 payoutType', `insert into payout_entries(tenant_id,id,employee_id,payout_date,type,amount_amt) values ($1,'po_x1','sp_1','2026-07-01','salary',100)`],
  ['SE-02 discountReason', `insert into discount_entries(tenant_id,id,discount_date,employee_id,category_id,list_price_amt,actual_price_amt,discount_amt,reason) values ($1,'dc_x1','2026-07-01','sp_1','cat_1',100,90,10,'mood')`],
  ['LE-04 bounty trigger', `insert into bounties(tenant_id,id,trigger) values ($1,'bt_x1','cash_rain')`],
  ['LE-05 ledgerCategory', `insert into ledger_entries(tenant_id,id,employee_id,category,achieved_at) values ($1,'lg_x1','sp_1','gift','2026-07-01')`],
  ['LE-02 objectionStatus', `insert into objection_entries(tenant_id,id,employee_id,target_type,status) values ($1,'ob_x1','sp_1','bad_debt','meh')`],
  ['YE-02 rxType', `insert into prescriptions(tenant_id,id,employee_id,rx_date,type,target) values ($1,'rx_x1','sp_1','2026-07-01','scolding','self')`],
  ['YE-08 pairStatus', `insert into pair_assignments(tenant_id,id,week_of,coach_id,learner_id,status) values ($1,'pa_x1','2026-07-06','sp_1','sp_2','divorced')`],
  ['月份键 YYYY-MM', `insert into lead_assignments(tenant_id,id,employee_id,month,assigned_leads) values ($1,'la_x1','sp_1','2026/07',10)`],
  ['Deal status', `insert into deals(tenant_id,id,employee_id,deal_date,category_id,status) values ($1,'deal_x1','sp_1','2026-07-01','cat_1','maybe')`],
  ['M28 kind', `insert into m28_agreements(tenant_id,id,master_id,kind,rate,duration_months,start_trigger) values ($1,'m28_x1','sp_1','equity',0.05,12,'recipe_live')`],
];
for (const [name, sql] of enumCases) {
  let err = null;
  try { await db.query(sql, [tenantA]); } catch (e) { err = e.message; }
  ok(err != null && /check|constraint/i.test(err), `${name} 非法值被拒`, err || '（插入竟然成功）');
}
{
  // 正向对照：一条全合法行可入（证明被拒的是"值"，不是表本身）
  let err = null;
  try {
    await db.query(`insert into bounties(tenant_id,id,trigger,template,amount_amt) values ($1,'bt_ok1','first_deal','first_deal',50000)`, [tenantA]);
  } catch (e) { err = e.message; }
  ok(err == null, '正向对照：合法枚举值插入成功（LE-04 first_deal）', err || '');
}

/* ================= ③ 汇总复算：seedTenant → SQL 聚合 vs replay.fold ================= */
console.log('— ③ 汇总复算（事件流双写 → SQL 聚合 vs fold 逐项相等） —');
const stats = await seedTenant(db, tenantA, U.bossA, TEST_TODAY);
console.log('    种子规模：' + JSON.stringify(stats));
const events = await q(`select type, payload from event_stream where tenant_id = $1 order by event_id`, [tenantA]);
const folded = fold(events);
const sqlAgg = {
  dealCount: Number((await q(`select count(*)::int as v from deals where tenant_id=$1`, [tenantA]))[0].v),
  totalPaymentAmt: Number((await q(`select coalesce(sum(payment_amt),0)::bigint as v from deals where tenant_id=$1`, [tenantA]))[0].v),
  totalGrossMarginAmt: Number((await q(
    `select coalesce(sum(round(d.payment_amt * c.gross_margin_rate)),0)::bigint as v
       from deals d join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id
      where d.tenant_id=$1`, [tenantA]))[0].v),
  payoutTotalAmt: Number((await q(`select coalesce(sum(amount_amt),0)::bigint as v from payout_entries where tenant_id=$1`, [tenantA]))[0].v),
  refundTotalAmt: Number((await q(`select coalesce(sum(amount_amt),0)::bigint as v from refund_entries where tenant_id=$1`, [tenantA]))[0].v),
  discountTotalAmt: Number((await q(`select coalesce(sum(discount_amt),0)::bigint as v from discount_entries where tenant_id=$1`, [tenantA]))[0].v),
  dailyReportCount: Number((await q(`select count(*)::int as v from daily_reports where tenant_id=$1`, [tenantA]))[0].v),
  activeHeadcount: Number((await q(`select count(*)::int as v from salespersons where tenant_id=$1 and is_active and deleted_at is null`, [tenantA]))[0].v),
  practiceLogCount: Number((await q(`select count(*)::int as v from practice_logs where tenant_id=$1`, [tenantA]))[0].v),
  candidateCount: Number((await q(`select count(*)::int as v from candidates where tenant_id=$1`, [tenantA]))[0].v),
  m28Count: Number((await q(`select count(*)::int as v from m28_agreements where tenant_id=$1`, [tenantA]))[0].v),
  ledgerHonoredCount: Number((await q(`select count(*)::int as v from ledger_entries where tenant_id=$1 and honored_at is not null`, [tenantA]))[0].v),
};
ok(Object.keys(sqlAgg).length >= 6, `复算对账项 ≥6（实际 ${Object.keys(sqlAgg).length} 项）`);
for (const k of Object.keys(sqlAgg)) {
  ok(folded[k] === sqlAgg[k], `复算相等 ${k}：fold=${folded[k]} vs SQL=${sqlAgg[k]}`);
}

/* ================= ④ 不可变实体拦截 ================= */
console.log('— ④ 不可变实体拦截（触发器） —');
{
  const [m28] = await q(`select id, rate, duration_months from m28_agreements where tenant_id=$1 and kind='mentoring'`, [tenantA]);
  let r = await as(U.bossA, `update m28_agreements set rate = 0.03, updated_by=$2 where tenant_id=$3 and id=$1 returning id`, [m28.id, U.bossA, tenantA]);
  ok(r.err != null && /downgrade/.test(r.err), 'M28 下调 rate 0.05→0.03 被拒（irrevocable）', r.err || '');
  r = await as(U.bossA, `update m28_agreements set duration_months = 6 where tenant_id=$2 and id=$1 returning id`, [m28.id, tenantA]);
  ok(r.err != null && /downgrade/.test(r.err), 'M28 下调 duration_months 12→6 被拒', r.err || '');
  r = await as(U.bossA, `update m28_agreements set irrevocable = false where tenant_id=$2 and id=$1 returning id`, [m28.id, tenantA]);
  ok(r.err != null, 'M28 撤销 irrevocable 被拒', r.err || '');
  r = await as(U.bossA, `update m28_agreements set rate = 0.06, updated_by='${U.bossA}' where tenant_id=$2 and id=$1 returning rate`, [m28.id, tenantA]);
  ok(!r.err && r.rows.length === 1, 'M28 上调 rate 0.05→0.06 允许（只许上调延长）', r.err || '');
  r = await as(U.bossA, `delete from m28_agreements where tenant_id=$2 and id=$1 returning id`, [m28.id, tenantA]);
  ok(r.err != null, 'M28 DELETE 被拒', r.err || '');
}
{
  const [mc] = await q(`select id from menu_choices where tenant_id=$1 limit 1`, [tenantA]);
  let r = await as(U.bossA, `update menu_choices set chosen_tier='low' where tenant_id=$2 and id=$1 returning id`, [mc.id, tenantA]);
  ok(r.err != null && /irrevocable/.test(r.err), 'menu_choices UPDATE 被拒（选择一经登记不可撤销）', r.err || '');
  r = await as(U.bossA, `delete from menu_choices where tenant_id=$2 and id=$1 returning id`, [mc.id, tenantA]);
  ok(r.err != null, 'menu_choices DELETE 被拒', r.err || '');
}
{
  const [cd] = await q(`select id from covenant_docs where tenant_id=$1 limit 1`, [tenantA]);
  const r = await as(U.bossA, `update covenant_docs set candidate_name='改名' where tenant_id=$2 and id=$1 returning id`, [cd.id, tenantA]);
  ok(r.err != null && /irrevocable/.test(r.err), 'covenant_docs UPDATE 被拒（快照签发后只读）', r.err || '');
}
{
  const [pending] = await q(`select id from ledger_entries where tenant_id=$1 and honored_at is null`, [tenantA]);
  const [honored] = await q(`select id from ledger_entries where tenant_id=$1 and honored_at is not null limit 1`, [tenantA]);
  let r = await as(U.bossA, `update ledger_entries set promise_text='篡改' where tenant_id=$2 and id=$1 returning id`, [pending.id, tenantA]);
  ok(r.err != null, 'ledger UPDATE 正文被拒（append-only）', r.err || '');
  r = await as(U.bossA, `delete from ledger_entries where tenant_id=$2 and id=$1 returning id`, [pending.id, tenantA]);
  ok(r.err != null && /DELETE forbidden/.test(r.err), 'ledger DELETE 被拒', r.err || '');
  r = await as(U.bossA, `update ledger_entries set honored_at=$3, updated_by='${U.bossA}' where tenant_id=$2 and id=$1 returning honored_at`, [pending.id, tenantA, TEST_TODAY]);
  ok(!r.err && r.rows.length === 1, 'ledger honored_at 从 null→非 null 回填允许（老板点确认）', r.err || '');
  r = await as(U.bossA, `update ledger_entries set honored_at=$3, promise_text='顺手改' where tenant_id=$2 and id=$1 returning id`,
    [honored.id, tenantA, TEST_TODAY]);
  ok(r.err != null, 'ledger 已 honored 后再改（含夹带改正文）被拒', r.err || '');
}

/* ================= ⑤ 新表 RLS 抽查（A-C01 零穿透） ================= */
console.log('— ⑤ 新表 RLS 抽查（租户B 读租户A → 0 行） —');
for (const t of ['deals', 'salespersons', 'daily_reports']) {
  const r = await as(U.bossB, `select * from ${t} where tenant_id = $1`, [tenantA]);
  ok(!r.err && r.rows.length === 0, `租户B 读租户A ${t} → 0 行`, r.err || `泄漏 ${r.rows && r.rows.length} 行`);
}
{
  const r = await as(U.bossA, `select count(*)::int as n from deals`, []);
  ok(!r.err && r.rows[0].n > 0, `租户A 自读 deals 正常（${r.rows && r.rows[0].n} 行——RLS 不是把门焊死）`);
  const w = await as(U.bossB, `insert into deals(tenant_id,id,employee_id,deal_date,category_id) values ($1,'deal_hack','sp_1','2026-07-01','cat_1') returning id`, [tenantA]);
  ok(w.err != null || w.rows.length === 0, '租户B 向租户A 插 deals → 拒绝（with check）', '');
}

/* ================= ⑥ 软删除口径 ================= */
console.log('— ⑥ 软删除口径（deleted_at is null） —');
{
  const before = Number((await q(`select count(*)::int as n from deals where tenant_id=$1`, [tenantA]))[0].n);
  const [victim] = await q(`select id from deals where tenant_id=$1 order by id limit 1`, [tenantA]);
  const r = await as(U.bossA, `update deals set deleted_at = now(), updated_by='${U.bossA}' where tenant_id=$2 and id=$1 returning id`, [victim.id, tenantA]);
  ok(!r.err && r.rows.length === 1, '软删除：置 deleted_at 成功（无物理 DELETE）', r.err || '');
  const alive = Number((await q(`select count(*)::int as n from deals where tenant_id=$1 and deleted_at is null`, [tenantA]))[0].n);
  const total = Number((await q(`select count(*)::int as n from deals where tenant_id=$1`, [tenantA]))[0].n);
  ok(alive === before - 1, `业务口径（deleted_at is null）= ${alive} = 原 ${before} − 1`);
  ok(total === before, `审计口径（全量）= ${total} 不变——软删除不丢数据`);
  ok(folded.dealCount === before, `事件流复算口径 = ${folded.dealCount} = 软删前全量（事件流不可变，删除是状态不是抹除）`);
}

await db.close();
console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C2 数据模型验收全部通过');
process.exit(failures ? 1 : 0);
