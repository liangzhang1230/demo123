/* ============================================================
   C9 · M34 时点套利检测器服务（v5.1 §5.2 M34 行 · 罪证打印机①，导入历史即出）
   🔒 口径出处：3号算账器 §3.9（唯一权威）：
     - 窗口 = 近 12 月；每周期切分：末段 = 后 m34TailShare(1/3)（月周期＝当月最后 1/3 天）
     - 时段折扣差 = mean(末段折扣率) − mean(前段折扣率)，折扣率 = Σdiscount/Σlist（各时段）
     - 年化泄漏 = max(0, 时段折扣差) × Σ(末段 paymentAmt, 近12月)
     - 聚集指数 = 阈值±10% 区间内成交笔数密度 ÷ 全周期平均密度；threshold null → "—"
     - 判定：差 > 2pp 或 聚集 > 1.5 → 🔴 罪证卡 S-14
     判定唯一出口 = domain.m34Arbitrage（服务层只组装 tail/head 折扣率与末段回款）。
   - 成交时点用 deal_date（原版单机引擎 m34Calc 同口径：套利看的是"签单冲刺"时点）
   - 只读模块（零写库、零事件）；时钟注入（公约 C-14）：今天 = ctx.today，零真实时钟调用
   ============================================================ */
import { m34Arbitrage } from '../domain/suanzhang.mjs';
import { getCoef, safeDiv, monthOf, ymd, diffDays } from '../domain/shared.mjs';

/* 'YYYY-MM' 平移 k 月 */
export const mShift = (m, k) => {
  const [y, mm] = m.split('-').map(Number);
  const t = y * 12 + (mm - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12 + 12) % 12 + 1).padStart(2, '0')}`;
};
/* 该月天数（零 Date 构造：两个月首差） */
const daysInMonth = m => {
  const [y, mm] = m.split('-').map(Number);
  return diffDays(ymd(y, mm, 1), mm === 12 ? ymd(y + 1, 1, 1) : ymd(y, mm + 1, 1));
};
const dayOf = date => Number(date.slice(8, 10));
/* 末段判定：日 > 该月天数 × (1 − tailShare)（原版 m34Calc 逐字同法） */
const inTail = (date, tailShare) => dayOf(date) > daysInMonth(monthOf(date)) * (1 - tailShare);

/**
 * arbitrage —— 近 12 月（含 month 当月）时点套利：
 *   tail/head 折扣率 + 末段回款 → domain.m34Arbitrage → 时段差 / 年化泄漏 / 红灯。
 * 聚集指数：plan_period_configs.commission_threshold_amt 为 null → null（"—"）；
 *   有阈值 → (±10% 带内笔数 ÷ 带宽) ÷ (全部笔数 ÷ 全金额跨度)（密度对密度）。
 * 折扣任一时段无样本 → { ok:false }（"—"，不硬造）。
 */
export async function arbitrage(db, ctx, { month, gc = getCoef } = {}) {
  if (!month) month = monthOf(ctx.today);
  const tailShare = gc('suanzhang.m34TailShare');
  const from = mShift(month, -11) + '-01';
  const to = ymd(Number(month.slice(0, 4)), Number(month.slice(5, 7)), daysInMonth(month));

  /* 折扣分时段：末段 vs 前段（逐条按其所在月切分） */
  const { rows: ds } = await db.query(
    `select discount_date::text as d, list_price_amt::float8 as list, discount_amt::float8 as disc
       from discount_entries
      where tenant_id = $1 and discount_date >= $2 and discount_date <= $3 and deleted_at is null`,
    [ctx.tenantId, from, to]);
  let tailList = 0, tailDisc = 0, headList = 0, headDisc = 0;
  for (const r of ds) {
    if (inTail(r.d, tailShare)) { tailList += Number(r.list); tailDisc += Number(r.disc); }
    else { headList += Number(r.list); headDisc += Number(r.disc); }
  }
  const tailRate = safeDiv(tailDisc, tailList), headRate = safeDiv(headDisc, headList);

  /* 末段回款（年化泄漏乘数）+ 聚集指数底数（won，deal_date 口径） */
  const { rows: deals } = await db.query(
    `select deal_date::text as d, payment_amt::float8 as pay
       from deals
      where tenant_id = $1 and status = 'won' and deal_date >= $2 and deal_date <= $3 and deleted_at is null`,
    [ctx.tenantId, from, to]);
  let tailPayAmt = 0;
  for (const r of deals) if (inTail(r.d, tailShare)) tailPayAmt += Number(r.pay);

  /* 阈值（PlanPeriodConfig 单例；null → 聚集指数 "—"） */
  const { rows: cfg } = await db.query(
    `select commission_threshold_amt::bigint as t from plan_period_configs
      where tenant_id = $1 and deleted_at is null order by id limit 1`, [ctx.tenantId]);
  const threshold = cfg.length && cfg[0].t != null ? Number(cfg[0].t) : null;
  let bunchIndex = null;
  if (threshold != null && deals.length) {
    const band = gc('suanzhang.m34BunchBand');
    const lo = threshold * (1 - band), hi = threshold * (1 + band);
    const inBand = deals.filter(r => Number(r.pay) >= lo && Number(r.pay) <= hi).length;
    const amts = deals.map(r => Number(r.pay));
    const span = Math.max(...amts) - Math.min(...amts);
    bunchIndex = span > 0 ? safeDiv(safeDiv(inBand, hi - lo), safeDiv(deals.length, span)) : null;
  }

  if (tailRate == null || headRate == null)
    return { ok: false, reason: 'insufficient', month, from, to, tailRate, headRate };
  /* 🔒 判定唯一出口：diff / annualLeak / red 全由 domain 计算 */
  const res = m34Arbitrage(tailRate, headRate, tailPayAmt, threshold, bunchIndex, gc);
  return { ok: true, month, from, to, threshold, tailPayAmt, ...res };
}
