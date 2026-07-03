/**
 * 四环节转化率（累计制）· 口径来源＝v1.0 §6.3
 *  - 线索转化率 lead_conv ＝ 累计(线索→意向＋线索→样品＋线索→签约未回款＋线索→成交) ÷ 累计线索新增
 *  - 意向转化率 intent_conv ＝ 累计(意向→样品＋意向→签约未回款＋意向→成交) ÷ 累计意向新增
 *  - 样品转化率 sample_conv ＝ 累计(样品→签约未回款＋样品→成交) ÷ 累计样品新增
 *  - 签约未回款转化率 signed_conv ＝ 累计(签约未回款→成交) ÷ 累计签约未回款新增
 *  - 成交率 close_rate ＝ 累计首购客户数 ÷ 累计线索新增
 *  - 分母为 0 显示 —（返回 null）；分子＝该池前向转出（流失不计入分子）；
 *    跳级只产生目标阶段事件——逐阶段转化率仅统计真正经过该阶段的客户，不被直成交污染（R1-04）。
 *  - 「累计」＝个人自入职日、部门/公司自各自起算日至计算时点；周期内口径则传入该周期 Tally
 *    （周期物理隔离，分子分母只取本周期事件）。
 */
import type { Pool, Tally } from './facts';

/** 分母为 0/负 → null（§6.10 兜底，显示 —） */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export interface ConversionRates {
  lead_conv: number | null;
  intent_conv: number | null;
  sample_conv: number | null;
  signed_conv: number | null;
  close_rate: number | null;
}

/** 对给定周期（或累计）事实计算四环节转化率＋成交率 */
export function conversionRates(t: Tally): ConversionRates {
  return {
    lead_conv: poolConv(t, 'lead'),
    intent_conv: poolConv(t, 'intent'),
    sample_conv: poolConv(t, 'sample'),
    signed_conv: poolConv(t, 'signed'),
    close_rate: ratio(t.firstDealCnt, t.entered.lead),
  };
}

/** 单池转化率＝该池前向转出 ÷ 该池进入 */
export function poolConv(t: Tally, pool: Pool): number | null {
  return ratio(t.exited[pool], t.entered[pool]);
}
