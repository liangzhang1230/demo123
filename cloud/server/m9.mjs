/* ============================================================
   C6 · M9 剪刀差 · 内部错价榜（v5.1 §5.1 M9 行 🔴取代）
   🔒 口径出处：
     - 3号算账器 闸⑦：剪刀差 = 贡献增长率 − 收入增长率；≥+30% ∧ 市价差>0 → 该谈候选
       （话术 S-09；30天防疲劳/在职≥6月为插卡侧节流，推送层 C10 承接）
     - 3号 §3.1：摊薄口径 amortizeForScissors（年终奖÷12/分红按周期/即时照实）
     - 4号留人器：错价榜与该谈名单（消费侧）
   前置：requireM21（闸①：剪刀差在 A-11 锁清单里）。
   口径组装（服务层零公式重写）：
     - 贡献增长率 = (近3月毛利 − 前3月毛利)/前3月毛利（月窗含当月，已回款口径）
     - 收入增长率 = incomeFor 同窗（🔒 m2/公约 §4.1 totalIncome，含 payout 摊薄前口径
       ——摊薄适用于剪刀差收入侧的 payout 逐笔入月，见下）
     - 市价差 = m4.marketPrice(岗位市价 median) − 本人近3月月均收入；>0 = 市场比你出得高
   云端增量：加薪模拟滑杆 raiseSimulate = 🔴 纯函数只读沙盒（S-D9：零 db、零写库）。
   - 时钟注入（公约 C-14）：零真实时钟调用
   ============================================================ */
import { scissors, amortizeForScissors } from '../domain/suanzhang.mjs';
import { safeDiv, getCoef, monthOf } from '../domain/shared.mjs';
import { incomeFor } from './m2.mjs';
import { marketPrice } from './m4.mjs';
import { requireM21, prevMonth } from './m21.mjs';

const lastNMonths = (month, n) => {                 // [month-n+1 .. month]
  const out = [month];
  for (let i = 1; i < n; i++) out.unshift(prevMonth(out[0]));
  return out;
};

/* 逐人某月毛利（已回款口径；与 m21/m32 同一 SQL 口径） */
async function marginByMonths(db, ctx, months) {
  const ph = months.map((_, i) => '$' + (i + 2)).join(',');
  const { rows } = await db.query(
    `select d.employee_id, to_char(d.paid_date, 'YYYY-MM') as month,
            coalesce(sum(round(d.payment_amt * coalesce(d.margin_rate_snapshot, c.gross_margin_rate))),0)::float8 as margin
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.status = 'won' and d.paid_date is not null
        and to_char(d.paid_date, 'YYYY-MM') in (${ph}) and d.deleted_at is null
      group by d.employee_id, to_char(d.paid_date, 'YYYY-MM')`, [ctx.tenantId, ...months]);
  const m = new Map();
  for (const r of rows) m.set(`${r.employee_id}|${r.month}`, Number(r.margin));
  return m;
}

/**
 * scissorsBoard：逐人剪刀差 + 错价榜。
 * ≥ scissorsAlert(0.30) ∧ 市价差 > 0 → talkCandidate（该谈候选）。
 */
export async function scissorsBoard(db, ctx, { positionName = '销售', gc = getCoef } = {}) {
  await requireM21(db, ctx);                        // 🔴 闸①（A-11）
  const cur = monthOf(ctx.today);
  const recentMonths = lastNMonths(cur, 3);
  const priorMonths = lastNMonths(prevMonth(recentMonths[0]), 3);
  const mm = await marginByMonths(db, ctx, [...recentMonths, ...priorMonths]);
  const { rows: sps } = await db.query(
    `select id, name from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales') order by id`, [ctx.tenantId]);
  const market = await marketPrice(db, ctx, { positionName });
  const alert = gc('suanzhang.scissorsAlert');
  const rows = [];
  for (const sp of sps) {
    const sum = ms => ms.reduce((a, m) => a + (mm.get(`${sp.id}|${m}`) ?? 0), 0);
    const contribRecent = sum(recentMonths), contribPrior = sum(priorMonths);
    let incomeRecent = 0, incomePrior = 0;
    for (const m of recentMonths) incomeRecent += (await incomeFor(db, ctx, { employeeId: sp.id, month: m })).incomeAmt;
    for (const m of priorMonths) incomePrior += (await incomeFor(db, ctx, { employeeId: sp.id, month: m })).incomeAmt;
    const contribGrowth = safeDiv(contribRecent - contribPrior, contribPrior);
    const incomeGrowth = safeDiv(incomeRecent - incomePrior, incomePrior);
    const sc = scissors(contribGrowth, incomeGrowth);
    const monthlyIncomeAvg = incomeRecent / 3;
    const marketGapAmt = market.medianAmt == null ? null : market.medianAmt - monthlyIncomeAvg;
    rows.push({
      spId: sp.id, name: sp.name,
      contribGrowth, incomeGrowth, scissors: sc,
      monthlyIncomeAvgAmt: monthlyIncomeAvg, marketGapAmt,
      talkCandidate: sc != null && sc >= alert && marketGapAmt != null && marketGapAmt > 0,
    });
  }
  rows.sort((a, b) => ((b.scissors ?? -Infinity) - (a.scissors ?? -Infinity)));
  return { recentMonths, priorMonths, marketMedianAmt: market.medianAmt, marketSample: market.n, rows };
}

/**
 * raiseSimulate —— 加薪模拟滑杆（v5.1 M9 云端增量）。
 * 🔴 纯函数只读沙盒：零 db 参数、零写库路径（S-D9 机检对象），不落库断言由 c6 测试盯源码。
 * 模拟：月收入 +raiseMonthlyAmt → 收入增长率抬升 → 剪刀差收敛量。
 * payouts 摊薄走 amortizeForScissors（年终奖÷12/分红按周期/即时照实）。
 */
export function raiseSimulate({ scissorsNow, monthlyIncomeAmt, raiseMonthlyAmt = 0, payouts = [] }) {
  const amortized = payouts.reduce(
    (s, p) => s + (amortizeForScissors(p.type, p.amount, p.periodMonths) ?? 0), 0);
  const baseMonthly = (monthlyIncomeAmt ?? 0) + amortized;
  const incomeGrowthDelta = safeDiv(raiseMonthlyAmt, baseMonthly);
  const scissorsAfter = (scissorsNow == null || incomeGrowthDelta == null)
    ? null : scissorsNow - incomeGrowthDelta;
  return {
    monthlyIncomeBeforeAmt: baseMonthly,
    monthlyIncomeAfterAmt: baseMonthly + (raiseMonthlyAmt ?? 0),
    incomeGrowthDelta, scissorsBefore: scissorsNow ?? null, scissorsAfter,
    sandbox: true,                                   // 只读沙盒标记：不落库、不产生 action_card
  };
}
