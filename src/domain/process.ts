/**
 * 过程量/结果量指标视图 · 口径来源＝v1.0 §6.1/§6.2
 * 从周期事实（Tally）读出指标字典代码名对应的数值——纯改名视图，零新计算。
 */
import type { Tally } from './facts';

export interface ProcessQuantities {
  /** §6.1 过程量 */
  lead_new: number;
  intent_new: number;
  sample_new: number;
  signed_new: number;
  lead_lost: number;
  intent_lost: number;
  sample_lost: number;
  signed_lost: number;
  lost_total: number;
  /** §6.2 结果量 */
  first_deal_cnt: number;
  direct_deal_cnt: number;
  repeat_order_cnt: number;
  repeat_cust_cnt: number;
  /** 成交总客户数（当期成交客户去重，含复购，恒为客户口径） */
  total_deal_cnt: number;
  /** 回款（全部成交单）／首购回款／复购回款 */
  revenue: number;
  first_revenue: number;
  repeat_revenue: number;
  gross_profit: number;
}

export function processQuantities(t: Tally): ProcessQuantities {
  return {
    lead_new: t.entered.lead,
    intent_new: t.entered.intent,
    sample_new: t.entered.sample,
    signed_new: t.entered.signed,
    lead_lost: t.lost.lead,
    intent_lost: t.lost.intent,
    sample_lost: t.lost.sample,
    signed_lost: t.lost.signed,
    lost_total: t.lost.lead + t.lost.intent + t.lost.sample + t.lost.signed,
    first_deal_cnt: t.firstDealCnt,
    direct_deal_cnt: t.directDealCnt,
    repeat_order_cnt: t.repeatOrderCnt,
    repeat_cust_cnt: t.repeatCustomers.size,
    total_deal_cnt: t.dealCustomers.size,
    revenue: t.revenue,
    first_revenue: t.firstRevenue,
    repeat_revenue: t.repeatRevenue,
    gross_profit: t.grossProfit,
  };
}

/** 平均客单＝累计回款÷成交总客户数（分母 0 → null 显 —） */
export function avgOrderValue(t: Tally): number | null {
  return t.dealCustomers.size > 0 ? t.revenue / t.dealCustomers.size : null;
}
