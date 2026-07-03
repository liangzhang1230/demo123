/**
 * 环比指标 · 口径来源＝v1.0 §6.5（统一口径，仅自然月）
 *  - 环比增长率＝(本期值−上期值)÷上期值×100%；
 *  - 固定仅自然月：已结束完整自然月 vs 完整自然月，残缺周期（开通/入职当月、进行中当月）不计算环比；
 *  - 基数异常：上期值＝0 或 ≤0（净利润类）统一返回 null（显示 —，悬浮提示「上期无基数」）；
 *  - 适用指标（白名单）：回款额、毛利额、净利润、成交总客户数、首购回款额、首购客户数、复购回款额、复购客户数。
 */
import { isCompleteMonth, lastCompleteMonth, prevYm } from './period';

/** §6.5 适用指标白名单（指标字典代码名） */
export const MOM_METRICS = [
  'revenue',
  'gross_profit',
  'net_profit',
  'total_deal_cnt',
  'first_revenue',
  'first_deal_cnt',
  'repeat_revenue',
  'repeat_cust_cnt',
] as const;
export type MomMetric = (typeof MOM_METRICS)[number];

/** 环比增长率＝(本期−上期)÷上期；上期 ≤0 → null（上期无基数） */
export function momRate(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous <= 0) return null;
  return (current - previous) / previous;
}

/**
 * 可比环比月对：最近完整月 vs 其上一完整月。任一侧残缺（不完整落于 [openDate, asOf]）→ null。
 * 演示锚点 2026-06-29（6 月未完整）→ 返回 { cur: '2026-05', prev: '2026-04' }。
 */
export function momMonthPair(openDate: string, asOf: string): { cur: string; prev: string } | null {
  const cur = lastCompleteMonth(openDate, asOf);
  if (!cur) return null;
  const prev = prevYm(cur);
  if (!isCompleteMonth(prev, openDate, asOf)) return null;
  return { cur, prev };
}
