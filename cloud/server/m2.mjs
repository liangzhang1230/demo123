/* ============================================================
   C3 · M2 提成服务（v5.1 §5.1 M2 行 🔴取代）
   🔒 口径出处：
     - 3号算账器 §3.1：commission = round(paymentAmt × 品类毛利率 × r)，已回款计提，
       退款不倒扣提成（追讨为老板线下动作）
     - 公约 §4.5：margin_based 永不可换（🔴 v4.0"营收口径"双模式已作废，v5.1 V-03——
       本文件与全 schema 均无该模式字样，机检见 c3.test.mjs ①）
     - 公约 §4.1 totalIncome / §4.2 laborCost：一律 import shared.mjs 宪法函数，禁止重算
   云端增量：方案版本表按 tenant（comp_plan_versions，append-only）；改版留痕可查全表；
     🔴 改版不追溯的机制 = planVersionAt(date) 取 effective_from ≤ date 的最大版本——
     历史月份永远命中历史版本，新版本只影响 effective_from 之后的期间
   - 时钟注入（公约 C-14）：本模块零真实时钟调用；日期一律显式传入
   - 金额一律「分」（bigint）；比率 numeric 0–1
   ============================================================ */
import { commission, totalIncome, laborCost } from '../domain/shared.mjs';
import { put } from './writes.mjs';

/**
 * 新建方案版本：版本号 = 该租户 max(version)+1（PK (tenant_id,version) 防并发重号）。
 * append-only：没有 update/delete 入口——改版永远是加一行（触发器兜底）。
 * inputs = PlanInputs 13 项快照（jsonb）；commission_base 默认 'margin_based'（列默认，CHECK 拒绝其余写入径）。
 */
export async function createPlanVersion(db, ctx, { inputs, rRate, matrixTAmt = null, effectiveFrom }) {
  const { rows } = await db.query(
    `select coalesce(max(version), 0)::int + 1 as v from comp_plan_versions where tenant_id = $1`,
    [ctx.tenantId]);
  const version = rows[0].v;
  await put(db, ctx, 'comp_plan_versions',
    { version, inputs, r_rate: rRate, matrix_t_amt: matrixTAmt, effective_from: effectiveFrom },
    'comp_plan_version_created');
  return { version, rRate, effectiveFrom };
}

/**
 * date 当日生效的方案版本 = effective_from ≤ date 的最大版本；无 → null。
 * 🔴 这就是"改版不追溯"：算历史期传历史日期，命中的永远是当期版本。
 */
export async function planVersionAt(db, ctx, date) {
  const { rows } = await db.query(
    `select version, inputs, r_rate::float8 as r_rate, matrix_t_amt::bigint as matrix_t_amt,
            commission_base, effective_from::text as effective_from
       from comp_plan_versions
      where tenant_id = $1 and effective_from <= $2
      order by version desc limit 1`, [ctx.tenantId, date]);
  return rows[0] ?? null;
}

/**
 * 某员工某月提成 = Σ 该月已回款 won 成交的 commission(paymentAmt, 品类毛利率快照, r)
 *   - 已回款归属：status='won' 且 paid_date 落在该月（跨月成交按回款月计提——"已回款"口径）
 *   - 毛利率：deals.margin_rate_snapshot（成交时快照，C2 已有列）；快照缺失的存量行
 *     回退 join categories.gross_margin_rate（仅护 legacy 数据，新写入一律带快照）
 *   - r：该月生效版本（planVersionAt(月首日)）
 *   - null 守卫：无生效版本 → commissionAmt=null；某行毛利率不可得 → 该行跳过不计（不造 NaN）
 *   - 逐单 round（宪法函数 commission），后求和——与算账器 §3.1 单据级口径一致
 */
export async function commissionFor(db, ctx, { employeeId, month }) {
  const plan = await planVersionAt(db, ctx, `${month}-01`);
  if (!plan) return { employeeId, month, planVersion: null, r: null, commissionAmt: null, dealCount: 0 };
  const r = Number(plan.r_rate);
  const { rows } = await db.query(
    `select d.payment_amt::bigint as payment_amt,
            coalesce(d.margin_rate_snapshot, c.gross_margin_rate)::float8 as rate
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.employee_id = $2
        and d.status = 'won' and d.paid_date is not null
        and to_char(d.paid_date, 'YYYY-MM') = $3
        and d.deleted_at is null`, [ctx.tenantId, employeeId, month]);
  let commissionAmt = 0, dealCount = 0;
  for (const row of rows) {
    if (row.rate == null) continue;                    // null 守卫：快照与品类均缺 → 不计不炸
    commissionAmt += commission(Number(row.payment_amt), Number(row.rate), r);
    dealCount++;
  }
  return { employeeId, month, planVersion: plan.version, r, commissionAmt, dealCount };
}

/* ---------- 月度取数（incomeFor / laborCostFor 共用底座） ---------- */
async function monthlyParts(db, ctx, employeeId, month) {
  const { rows: sp } = await db.query(
    `select base_salary_amt::bigint as base from salespersons
      where tenant_id = $1 and id = $2 and deleted_at is null`, [ctx.tenantId, employeeId]);
  const baseAmt = sp.length && sp[0].base != null ? Number(sp[0].base) : 0;
  const com = await commissionFor(db, ctx, { employeeId, month });
  const { rows: po } = await db.query(
    `select type, amount_amt::bigint as amount_amt from payout_entries
      where tenant_id = $1 and employee_id = $2
        and to_char(payout_date, 'YYYY-MM') = $3 and deleted_at is null`,
    [ctx.tenantId, employeeId, month]);
  const payouts = po.map(p => ({ type: p.type, amount: Number(p.amount_amt) }));
  return { baseAmt, commissionAmt: com.commissionAmt ?? 0, planVersion: com.planVersion, payouts };
}

/**
 * 员工视角「我拿到多少」——🔒 走 shared.totalIncome（公约 §4.1），本模块零重算：
 * 底薪 + 提成 + 奖金类 payout（INCOME_BONUS 白名单）；reimburse 永不计入收入。
 */
export async function incomeFor(db, ctx, { employeeId, month }) {
  const p = await monthlyParts(db, ctx, employeeId, month);
  return {
    employeeId, month, planVersion: p.planVersion,
    baseAmt: p.baseAmt, commissionAmt: p.commissionAmt,
    incomeAmt: totalIncome({ baseAmt: p.baseAmt, commissionAmt: p.commissionAmt, payouts: p.payouts }),
  };
}

/**
 * 老板视角「我花了多少」——🔒 走 shared.laborCost（公约 §4.2）：
 * 底薪 + 社保(底薪×socialCostRate) + 提成 + 全部 payout（含 reimburse——报销只进成本）。
 */
export async function laborCostFor(db, ctx, { employeeId, month }) {
  const p = await monthlyParts(db, ctx, employeeId, month);
  return {
    employeeId, month, planVersion: p.planVersion,
    baseAmt: p.baseAmt, commissionAmt: p.commissionAmt,
    laborCostAmt: laborCost({ baseAmt: p.baseAmt, commissionAmt: p.commissionAmt, payouts: p.payouts }),
  };
}
