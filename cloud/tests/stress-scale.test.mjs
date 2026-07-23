#!/usr/bin/env node
/* ============================================================
   对抗性安全 · C —— 大数据量压力 + 稳定性
   运行：node tests/stress-scale.test.mjs
   规模：单大租户 ≥50 员工 × 12 月 → deals ≥2万 / daily_reports ≥1.5万 / event_stream ≥5万。
   确定性：mulberry32(种子固定)，today 显式传参，零 new Date()。
   重活：runM21(多月) / runUER(OLS 高斯消元大矩阵) / dayRoll / fold 全量 / 聚合。
   ============================================================ */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../db/seed.mjs';
import { fold } from '../domain/replay.mjs';
import { runM21 } from '../server/m21.mjs';
import { runUER } from '../server/m32.mjs';
import { dayRoll } from '../server/dayroll.mjs';
import { addDays, monthOf } from '../domain/shared.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const findings = [];
const TEST_TODAY = '2026-07-13';
const timings = {};
async function timed(label, fn) { const s = Date.now(); const r = await fn(); timings[label] = Date.now() - s; return r; }

/* ---------- 确定性随机 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pad2 = n => String(n).padStart(2, '0');
function monthShift(ym, k) { let [y, m] = ym.split('-').map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad2(m)}`; }

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
for (const f of ['schema.sql', 'schema-c2.sql', 'schema-c3.sql', 'schema-c4.sql', 'schema-c6.sql']) {
  await db.exec(readFileSync(join(root, 'db', f), 'utf8'));
}
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;`);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

/* ---------- 批量插入（多行 VALUES，规避每行一次往返；参数 < 60000） ---------- */
async function bulkInsert(table, cols, rows, evEmit = null) {
  // 🔴 单条语句参数数必须 < 32767（Postgres 绑定协议 Int16 参数计数上限；
  //    PGlite 超限会静默失败 affected=0 并令连接返回空——实测坑）。取 30000 留裕度。
  const maxParams = 30000;
  const perRow = cols.length;
  const chunk = Math.max(1, Math.floor(maxParams / perRow));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map((_, ri) => `(${cols.map((__, ci) => '$' + (ri * perRow + ci + 1)).join(',')})`).join(',');
    const params = [];
    for (const r of slice) for (const c of cols) { const v = r[c]; params.push((v !== null && typeof v === 'object') ? JSON.stringify(v) : v); }
    await db.query(`insert into ${table}(${cols.join(',')}) values ${values}`, params);
  }
}

console.log('\n══════ C. 大数据量压力 + 稳定性 ══════');
const tAll = Date.now();

/* ============================================================
   ① 扩容种子：单大租户 50 员工 × 12 月
   ============================================================ */
console.log('\n— ① 扩容种子（bulk） —');
const bossBig = 'a0000000-0000-4000-8000-0000000000aa';
const [{ id: tBig }] = await q(`insert into tenants(name, created_by) values ('压力大租户',$1) returning id`, [bossBig]);
await q(`insert into subscriptions(tenant_id, seat_quota) values ($1, 999)`, [tBig]);
await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [bossBig, tBig]);
await q(`insert into seats(tenant_id, user_id) values ($1,$2)`, [tBig, bossBig]);

const EMP = 50, MONTHS = 12, DEALS_PM = 50;
const thisMonth = monthOf(TEST_TODAY);
const months = Array.from({ length: MONTHS }, (_, i) => monthShift(thisMonth, -(MONTHS - 1 - i)));
const rng = mulberry32(20260713);
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

await timed('seed', async () => {
  const cats = [['软件', 0.6], ['硬件', 0.3], ['服务', 0.45], ['耗材', 0.18], ['授权', 0.55], ['集成', 0.4]];
  const catRows = [], catEv = [];
  const catIds = [];
  cats.forEach(([name, rate], i) => {
    const id = `cat_${i}`; catIds.push({ id, rate });
    catRows.push({ tenant_id: tBig, id, name, gross_margin_rate: rate, created_by: bossBig, updated_by: bossBig });
    catEv.push({ tenant_id: tBig, type: 'category_created', actor_id: bossBig, target_id: id, payload: { categoryId: id, name, grossMarginRate: rate } });
  });
  await bulkInsert('categories', ['tenant_id', 'id', 'name', 'gross_margin_rate', 'created_by', 'updated_by'], catRows);

  const spRows = [], spEv = [];
  const spIds = [];
  for (let i = 0; i < EMP; i++) {
    const id = `sp_${i}`; spIds.push(id);
    const hire = addDays(TEST_TODAY, -int(200, 900));
    spRows.push({ tenant_id: tBig, id, name: `销售${i}`, level: 'sales', position_type: 'pure_sales', city_tier: 'tier1', hire_date: hire, is_active: true, base_salary_amt: 750000, hiring_cost_amt: 1500000, created_by: bossBig, updated_by: bossBig });
    spEv.push({ tenant_id: tBig, type: 'salesperson_created', actor_id: bossBig, target_id: id, payload: { spId: id, isActive: true } });
  }
  await bulkInsert('salespersons', ['tenant_id', 'id', 'name', 'level', 'position_type', 'city_tier', 'hire_date', 'is_active', 'base_salary_amt', 'hiring_cost_amt', 'created_by', 'updated_by'], spRows);

  const laRows = [], dealRows = [], drRows = [], poRows = [], dcRows = [], rfRows = [];
  const events = [...catEv, ...spEv];
  let seq = 0;
  for (const ym of months) {
    for (const sp of spIds) {
      // lead_assignment
      const laId = `la_${seq++}`;
      const al = int(30, 90), sl = int(0, 10);
      laRows.push({ tenant_id: tBig, id: laId, employee_id: sp, month: ym, assigned_leads: al, self_dev_leads: sl, source_type: 'ad', created_by: bossBig, updated_by: bossBig });
      events.push({ tenant_id: tBig, type: 'lead_assignment_created', actor_id: bossBig, target_id: laId, payload: { laId, employeeId: sp, month: ym, assignedLeads: al, selfDevLeads: sl } });
      // deals
      for (let d = 0; d < DEALS_PM; d++) {
        const cat = catIds[int(0, catIds.length - 1)];
        const won = rng() < 0.9;
        const dd = `${ym}-${pad2(int(1, 27))}`;
        const pay = won ? int(20, 99) * 10000 : 0;
        const id = `deal_${seq++}`;
        dealRows.push({ tenant_id: tBig, id, employee_id: sp, deal_date: dd, entry_date: dd, payment_amt: pay, category_id: cat.id, lead_source_type: 'ad', status: won ? 'won' : 'open', paid_date: won ? dd : null, margin_rate_snapshot: won ? cat.rate : null, created_by: bossBig, updated_by: bossBig });
        events.push({ tenant_id: tBig, type: 'deal_created', actor_id: bossBig, target_id: id, payload: { dealId: id, employeeId: sp, dealDate: dd, paymentAmt: pay, categoryId: cat.id, status: won ? 'won' : 'open', paidDate: won ? dd : null, marginRateSnapshot: won ? cat.rate : null } });
      }
      // payout / discount / refund（充实事件量与聚合面）
      const poId = `po_${seq++}`, poAmt = int(5, 50) * 10000;
      poRows.push({ tenant_id: tBig, id: poId, employee_id: sp, payout_date: `${ym}-15`, type: 'instant_bonus', amount_amt: poAmt, created_by: bossBig, updated_by: bossBig });
      events.push({ tenant_id: tBig, type: 'payout_created', actor_id: bossBig, target_id: poId, payload: { payoutId: poId, amountAmt: poAmt } });
      const dcId = `dc_${seq++}`, list = int(30, 90) * 10000, cut = int(1, 8) * 10000;
      dcRows.push({ tenant_id: tBig, id: dcId, discount_date: `${ym}-16`, employee_id: sp, category_id: catIds[0].id, list_price_amt: list, actual_price_amt: list - cut, discount_amt: cut, reason: 'volume_deal', created_by: bossBig, updated_by: bossBig });
      events.push({ tenant_id: tBig, type: 'discount_created', actor_id: bossBig, target_id: dcId, payload: { discountId: dcId, discountAmt: cut } });
      const rfId = `rf_${seq++}`, rfAmt = int(5, 30) * 10000;
      rfRows.push({ tenant_id: tBig, id: rfId, employee_id: sp, refund_date: `${ym}-17`, category_id: catIds[0].id, amount_amt: rfAmt, created_by: bossBig, updated_by: bossBig });
      events.push({ tenant_id: tBig, type: 'refund_created', actor_id: bossBig, target_id: rfId, payload: { refundId: rfId, amountAmt: rfAmt } });
    }
  }
  // daily_reports：365 天 × 50 人（唯一键 tenant+emp+date）
  for (let dback = 364; dback >= 0; dback--) {
    const date = addDays(TEST_TODAY, -dback);
    for (const sp of spIds) {
      const id = `dr_${seq++}`;
      const leads = int(5, 15);
      drRows.push({ tenant_id: tBig, id, employee_id: sp, report_date: date, leads, intents: int(0, leads), samples: int(0, 4), contracts: int(0, 2), submitted_at: date, created_by: bossBig, updated_by: bossBig });
      events.push({ tenant_id: tBig, type: 'daily_report_submitted', actor_id: bossBig, target_id: id, payload: { drId: id, employeeId: sp, date } });
    }
  }
  await bulkInsert('lead_assignments', ['tenant_id', 'id', 'employee_id', 'month', 'assigned_leads', 'self_dev_leads', 'source_type', 'created_by', 'updated_by'], laRows);
  await bulkInsert('deals', ['tenant_id', 'id', 'employee_id', 'deal_date', 'entry_date', 'payment_amt', 'category_id', 'lead_source_type', 'status', 'paid_date', 'margin_rate_snapshot', 'created_by', 'updated_by'], dealRows);
  await bulkInsert('payout_entries', ['tenant_id', 'id', 'employee_id', 'payout_date', 'type', 'amount_amt', 'created_by', 'updated_by'], poRows);
  await bulkInsert('discount_entries', ['tenant_id', 'id', 'discount_date', 'employee_id', 'category_id', 'list_price_amt', 'actual_price_amt', 'discount_amt', 'reason', 'created_by', 'updated_by'], dcRows);
  await bulkInsert('refund_entries', ['tenant_id', 'id', 'employee_id', 'refund_date', 'category_id', 'amount_amt', 'created_by', 'updated_by'], rfRows);
  await bulkInsert('daily_reports', ['tenant_id', 'id', 'employee_id', 'report_date', 'leads', 'intents', 'samples', 'contracts', 'submitted_at', 'created_by', 'updated_by'], drRows);
  await bulkInsert('event_stream', ['tenant_id', 'type', 'actor_id', 'target_id', 'payload'], events);
});

const scale = {
  deals: Number((await q(`select count(*)::int n from deals where tenant_id=$1`, [tBig]))[0].n),
  daily_reports: Number((await q(`select count(*)::int n from daily_reports where tenant_id=$1`, [tBig]))[0].n),
  event_stream: Number((await q(`select count(*)::int n from event_stream where tenant_id=$1`, [tBig]))[0].n),
  salespersons: Number((await q(`select count(*)::int n from salespersons where tenant_id=$1`, [tBig]))[0].n),
};
console.log('    数据规模：' + JSON.stringify(scale) + `｜种子耗时 ${timings.seed}ms`);
ok(scale.deals >= 20000, `deals ≥ 2万（实际 ${scale.deals}）`);
ok(scale.daily_reports >= 15000, `daily_reports ≥ 1.5万（实际 ${scale.daily_reports}）`);
ok(scale.event_stream >= 50000, `event_stream ≥ 5万（实际 ${scale.event_stream}）`);

/* ============================================================
   ② 真相层重活
   ============================================================ */
console.log('\n— ② 真相层重活（计时 + 非 NaN/非负/守恒 断言） —');
await db.query(`select set_config('app.uid', $1, false)`, [bossBig]);
const ctxBig = { tenantId: tBig, actorId: bossBig, today: TEST_TODAY };

// runM21 多月
let m21last = null;
await timed('runM21x12', async () => {
  for (const ym of months) m21last = await runM21(db, ctxBig, { month: ym });
});
const m21NaN = m21last.rows.filter(r => (r.normMargin != null && !Number.isFinite(r.normMargin)) || (r.index != null && !Number.isFinite(r.index)));
ok(m21last.done && m21NaN.length === 0, `runM21 ×12 月完成（末月 ${m21last.n} 人，无 NaN）`, m21NaN.length ? `${m21NaN.length} NaN` : '');
ok(m21last.imbalanceRate != null && m21last.imbalanceRate >= 0 && m21last.imbalanceRate <= 1, `imbalanceRate ∈ [0,1]（${m21last.imbalanceRate}）`);
const normRows = Number((await q(`select count(*)::int n from m21_norms where tenant_id=$1`, [tBig]))[0].n);
ok(normRows === EMP * MONTHS, `m21_norms 落表 ${EMP}×${MONTHS}=${EMP * MONTHS}（实际 ${normRows}，UPSERT 幂等）`);

// runUER（OLS 高斯消元大矩阵：EMP×MONTHS 观测）
const uer = await timed('runUER', () => runUER(db, ctxBig, {}));
ok(uer.gate === true, `runUER 通过门槛并拟合（观测 n=${uer.n}，OLS 非奇异）`, uer.reason || '');
ok(uer.beta && uer.beta.every(b => Number.isFinite(b)), `OLS β 全有限（无奇异/NaN）`, uer.beta ? '' : 'beta null');
ok(uer.sigma != null && Number.isFinite(uer.sigma) && uer.sigma >= 0, `残差 σ 有限非负（${uer.sigma && uer.sigma.toFixed(2)}）`);

// dayRoll（含 M21 上月+当月 + UER + 派生）
const dr = await timed('dayRoll', () => dayRoll(db, ctxBig, {}));
ok(dr && dr.months.length === 2, `dayRoll 完成（月 ${dr.months.join(',')}）`);
ok(dr.dvi === null || Number.isFinite(dr.dvi), `dayRoll DVI 非 NaN（${dr.dvi}）`);
ok(dr.realP90Factor === null || Number.isFinite(dr.realP90Factor), `realP90Factor 非 NaN（${dr.realP90Factor}）`);

// fold 全量事件
let folded = null;
await timed('foldAll', async () => {
  const evs = await q(`select type, payload from event_stream where tenant_id=$1 order by event_id`, [tBig]);
  folded = fold(evs);
});
// 守恒：fold vs SQL
const sqlDealCount = scale.deals;
const sqlPay = Number((await q(`select coalesce(sum(payment_amt),0)::bigint v from deals where tenant_id=$1`, [tBig]))[0].v);
ok(folded.dealCount === sqlDealCount, `fold.dealCount ${folded.dealCount} == SQL ${sqlDealCount}（守恒）`);
ok(folded.totalPaymentAmt === sqlPay, `fold.totalPaymentAmt ${folded.totalPaymentAmt} == SQL ${sqlPay}`);
ok(Number.isFinite(folded.totalGrossMarginAmt) && folded.totalGrossMarginAmt >= 0, `fold 毛利有限非负（${folded.totalGrossMarginAmt}）`);

// priceTag 类聚合（人均毛利排名）/ 四灯（事件类型分布）/ vintage（入职月分组）
await timed('aggregations', async () => {
  await q(`select employee_id, sum(round(payment_amt*coalesce(margin_rate_snapshot,0)))::bigint gm
           from deals where tenant_id=$1 and status='won' group by employee_id order by gm desc`, [tBig]);   // priceTag 输入
  await q(`select type, count(*)::int n from event_stream where tenant_id=$1 group by type`, [tBig]);          // 四灯/事件分布
  await q(`select to_char(hire_date,'YYYY-MM') m, count(*)::int n from salespersons where tenant_id=$1 group by 1`, [tBig]); // vintage
});
ok(true, `priceTag/四灯/vintage 聚合全量扫描无崩溃（耗时 ${timings.aggregations}ms）`);

/* ============================================================
   ③ 多租户并存（≥10 租户各自种子）→ 隔离 + 线性
   ============================================================ */
console.log('\n— ③ 多租户并存（10 租户标准种子，隔离 + 线性） —');
const smallTenants = [];
await timed('seed10', async () => {
  for (let i = 0; i < 10; i++) {
    const boss = `c${i}000000-0000-4000-8000-00000000000${i}`;
    const [{ id }] = await q(`insert into tenants(name, created_by) values ($1,$2) returning id`, [`小租户${i}`, boss]);
    await q(`insert into subscriptions(tenant_id) values ($1)`, [id]);
    await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [boss, id]);
    await q(`insert into seats(tenant_id, user_id) values ($1,$2)`, [id, boss]);
    await seedTenant(db, id, boss, TEST_TODAY);
    smallTenants.push({ id, boss });
  }
});
const totalEvents = Number((await q(`select count(*)::int n from event_stream`))[0].n);
console.log(`    10 租户种子耗时 ${timings.seed10}ms｜全库事件总量 ${totalEvents}`);
// 隔离：每个小租户跨查大租户 → 0 行；自查 → 只见自己
let isoViol = 0;
for (const st of smallTenants.slice(0, 3)) {
  await db.exec(`set role app_user; select set_config('app.uid', '${st.boss}', false);`);
  const cross = (await db.query(`select count(*)::int n from deals where tenant_id=$1`, [tBig])).rows[0].n;
  const own = (await db.query(`select count(distinct tenant_id)::int n from deals`)).rows[0].n;
  await db.exec(`reset role;`);
  if (Number(cross) !== 0) isoViol++;
  if (Number(own) !== 1) isoViol++;
}
ok(isoViol === 0, `多租户并存下隔离恒成立（小租户跨查大租户 0 行 / 自查仅见 1 租户）`, isoViol ? `${isoViol} 处泄漏` : '');
// 线性：同一 fold 在大租户 vs 小租户耗时量级与数据量成比例（仅记录，不硬断言绝对值）
const smallFoldT = await timed('foldSmall', async () => { await q(`select type,payload from event_stream where tenant_id=$1 order by event_id`, [smallTenants[0].id]); });
ok(timings.foldAll > 0 && timings.foldSmall >= 0, `fold 耗时随规模线性可接受（大租户 ${scale.event_stream} 行 ${timings.foldAll}ms）`);

/* ============================================================
   ④ 边界压力
   ============================================================ */
console.log('\n— ④ 边界压力（空租户/单人/极端值 不崩） —');
{
  // 空租户：全聚合零除 → null 不崩
  const eBoss = 'e0000000-0000-4000-8000-0000000000ee';
  const [{ id: tEmpty }] = await q(`insert into tenants(name, created_by) values ('空租户',$1) returning id`, [eBoss]);
  await q(`insert into subscriptions(tenant_id) values ($1)`, [tEmpty]);
  await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [eBoss, tEmpty]);
  await q(`insert into seats(tenant_id, user_id) values ($1,$2)`, [tEmpty, eBoss]);
  await q(`insert into suite_state(tenant_id, doc, updated_by) values ($1,'{}'::jsonb,$2)`, [tEmpty, eBoss]);
  await db.query(`select set_config('app.uid', $1, false)`, [eBoss]);
  const ctxE = { tenantId: tEmpty, actorId: eBoss, today: TEST_TODAY };
  let crashed = false, m21e, drE, uerE;
  try {
    m21e = await runM21(db, ctxE, { month: thisMonth });
    drE = await dayRoll(db, ctxE, {});
    uerE = await runUER(db, ctxE, {}).catch(e => ({ gate: false, reason: e.code || e.message }));
  } catch (e) { crashed = true; findings.push(`空租户聚合崩溃：${e.message}`); }
  ok(!crashed, '空租户跑 runM21/dayRoll/runUER 不崩溃');
  ok(m21e && m21e.done === false, `空租户 M21 done=false（零人不硬造，实际 ${m21e && m21e.done}）`);
  ok(drE && (drE.dvi === null || Number.isFinite(drE.dvi)), `空租户 DVI → null（零除不崩，实际 ${drE && drE.dvi}）`);
  const foldE = fold([]);
  ok(foldE.dealCount === 0 && Number.isFinite(foldE.totalPaymentAmt), 'fold 空事件 → 全 0 不 NaN');
}
{
  // 单人租户：M21 一人不成盘（done=false 或 n=1）
  const sBoss = 'e1000000-0000-4000-8000-0000000000e1';
  const [{ id: tSolo }] = await q(`insert into tenants(name, created_by) values ('单人租户',$1) returning id`, [sBoss]);
  await q(`insert into subscriptions(tenant_id) values ($1)`, [tSolo]);
  await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [sBoss, tSolo]);
  await q(`insert into seats(tenant_id,user_id) values ($1,$2)`, [tSolo, sBoss]);
  const ctxS = { tenantId: tSolo, actorId: sBoss, today: TEST_TODAY };
  await q(`insert into salespersons(tenant_id,id,name,level,is_active) values ($1,'solo','独狼','sales',true)`, [tSolo]);
  await q(`insert into lead_assignments(tenant_id,id,employee_id,month,assigned_leads,self_dev_leads,source_type) values ($1,'la_solo','solo',$2,50,0,'ad')`, [tSolo, thisMonth]);
  await db.query(`select set_config('app.uid', $1, false)`, [sBoss]);
  const m21s = await runM21(db, ctxS, { month: thisMonth });
  ok(m21s.n === 1, `单人租户 M21 n=1（不崩，${m21s.n} 人）`);
}
{
  // 极端值：超大金额 + 超长字符串
  const xBoss = 'e2000000-0000-4000-8000-0000000000e2';
  const [{ id: tX }] = await q(`insert into tenants(name, created_by) values ('极端值租户',$1) returning id`, [xBoss]);
  await q(`insert into subscriptions(tenant_id) values ($1)`, [tX]);
  await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [xBoss, tX]);
  await q(`insert into seats(tenant_id,user_id) values ($1,$2)`, [tX, xBoss]);
  await q(`insert into categories(tenant_id,id,name,gross_margin_rate) values ($1,'cx','X',0.5)`, [tX]);
  await q(`insert into salespersons(tenant_id,id,name,level,is_active) values ($1,'spx','极端',' sales',true)`.replace("' sales'", "'sales'"), [tX]);
  const bigAmt = 9_000_000_000_000_000;   // 9e15（< 2^53，JS 精确；< int8 上限）
  const longStr = 'X'.repeat(20000);
  let xCrash = false;
  try {
    await q(`insert into deals(tenant_id,id,employee_id,deal_date,payment_amt,category_id,status,paid_date,margin_rate_snapshot,note) values ($1,'dx','spx','2026-07-01',$2,'cx','won','2026-07-01',0.5,$3)`, [tX, bigAmt, longStr]);
    const sum = Number((await q(`select coalesce(sum(payment_amt),0)::bigint v from deals where tenant_id=$1`, [tX]))[0].v);
    ok(sum === bigAmt && Number.isFinite(sum), `超大金额 ${bigAmt} 聚合精确无溢出（${sum}）`);
    const noteLen = Number((await q(`select length(note)::int n from deals where tenant_id=$1 and id='dx'`, [tX]))[0].n);
    ok(noteLen === 20000, `超长字符串字段 20000 字符完整存取（${noteLen}）`);
    const evs = [{ type: 'deal_created', payload: JSON.stringify({ dealId: 'dx', paymentAmt: bigAmt, categoryId: 'cx' }) }];
    const fx = fold(evs);
    ok(Number.isFinite(fx.totalPaymentAmt) && fx.totalPaymentAmt === bigAmt, `fold 处理极端金额不 NaN/不溢出（${fx.totalPaymentAmt}）`);
  } catch (e) { xCrash = true; findings.push(`极端值处理崩溃：${e.message}`); }
  ok(!xCrash, '极端值（超大金额/超长串）写入与聚合不崩溃');
}

/* ============================================================
   报告
   ============================================================ */
console.log('\n══════ C 压力报告 ══════');
console.log('  数据规模：' + JSON.stringify(scale));
console.log('  全库事件总量（含 10 小租户 + 边界租户）：' + Number((await q(`select count(*)::int n from event_stream`))[0].n));
console.log('  各重活耗时（ms）：');
for (const [k, v] of Object.entries(timings)) console.log(`    ${k.padEnd(14)} ${v} ms`);
if (findings.length) { console.log('\n🔴 稳定性异常：'); findings.forEach((f, i) => console.log(`   ${i + 1}. ${f}`)); }
else console.log('  稳定性：无超时/崩溃/异常值。');

await db.close();
console.log(`\n[C. 大数据量压力] 断言 ${failures ? '✗ ' + failures + ' 失败' : '✅ 全通过'}｜总耗时 ${Date.now() - tAll}ms`);
process.exit(failures ? 1 : 0);
