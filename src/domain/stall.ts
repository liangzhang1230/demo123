/**
 * 客户停滞预警 · 口径来源＝v1.0 第二部分 §8
 *  - 停留天数＝当日−客户最近一次进入当前状态的事件日（自然日；进入当日记 0；左闭——达到阈值当天即触发）；
 *    「进入当前状态事件日」：线索＝create_time，意向/样品/签约未回款＝对应流转事件日；
 *  - 受监控状态＝线索/意向/样品/签约未回款；进成交/流失即退出监控；任一流转即清零重算；
 *  - 阈值＝行业模板「通用」列（演示预置，§8.3.1）：线索 15／意向 30／样品 20／签约未回款 7 天；
 *  - 三级等级（§8.4，倍数 1.5/2.5 为系统常量，左闭右开、自上而下首次命中即停）：
 *      关注（黄）＝停留 ≥1.0 倍阈值 且 <1.5 倍；预警（橙）＝≥1.5 且 <2.5；濒死（红）＝≥2.5；
 *    【盲审改正示例·通用列】线索阈值 15 → 关注 15–22、预警 23–37、濒死 38+；签约未回款 7 → 濒死 18 天起；
 *  - 列表排序＝等级（红→橙→黄）→ ABCD（A→B→C→D）→ 停留天数倒序（§8.5.1）；
 *  - 停留天数/等级为纯派生值，运行时算出、不落库；不入指标字典、不参与全局排名。
 */
import type { Facts, Pool } from './facts';
import { POOLS } from './facts';
import { diffDays } from './period';

/** 行业模板「通用」列阈值（唯一推荐源 §8.3.1；演示版预置，无配置界面） */
export const GENERAL_STALL_THRESHOLDS: Record<Pool, number> = {
  lead: 15,
  intent: 30,
  sample: 20,
  signed: 7,
};

/** 分级倍数＝系统常量，不开放配置（§8.4） */
export const STALL_MULTIPLIERS = { watch: 1.0, warn: 1.5, dying: 2.5 } as const;

export type StallLevel = 'watch' | 'warn' | 'dying';

export const STALL_LEVEL_META: Record<StallLevel, { label: string; color: string; order: number }> = {
  dying: { label: '濒死', color: 'red', order: 0 },
  warn: { label: '预警', color: 'orange', order: 1 },
  watch: { label: '关注', color: 'yellow', order: 2 },
};

/** 停留天数（自然日，进入当日记 0） */
export function stallDays(enteredOn: string, asOf: string): number {
  return Math.max(0, diffDays(enteredOn, asOf));
}

/** 三级判定（左闭右开、自上而下首次命中即停）；未达 1.0 倍阈值 → null（未停滞） */
export function stallLevel(days: number, threshold: number): StallLevel | null {
  if (threshold <= 0) return null;
  if (days >= threshold * STALL_MULTIPLIERS.dying) return 'dying';
  if (days >= threshold * STALL_MULTIPLIERS.warn) return 'warn';
  if (days >= threshold * STALL_MULTIPLIERS.watch) return 'watch';
  return null;
}

export interface StallItem {
  customerId: string;
  ownerId: string;
  stage: Pool;
  days: number;
  level: StallLevel;
}

/**
 * 全量在管客户停滞清单（在管＝当前处于受监控四态的客户，§8.5.2）。
 * 只产出已触发（≥1.0 倍阈值）的客户；未触发者不在清单。
 */
export function stallList(
  facts: Facts,
  thresholds: Record<Pool, number> = GENERAL_STALL_THRESHOLDS,
): StallItem[] {
  const items: StallItem[] = [];
  for (const [customerId, st] of facts.customerState) {
    if (!POOLS.includes(st.stage as Pool)) continue; // 成交/流失退出监控
    const stage = st.stage as Pool;
    const days = stallDays(st.enteredOn, facts.asOf);
    const level = stallLevel(days, thresholds[stage]);
    if (level) items.push({ customerId, ownerId: st.ownerId, stage, days, level });
  }
  return items;
}

/** §8.5.1 列表排序：等级（红→橙→黄）→ ABCD（A→B→C→D）→ 停留天数倒序 */
export function sortStallItems(
  items: StallItem[],
  abcdOf: (customerId: string) => 'A' | 'B' | 'C' | 'D' = () => 'C',
): StallItem[] {
  return [...items].sort((a, b) => {
    const lv = STALL_LEVEL_META[a.level].order - STALL_LEVEL_META[b.level].order;
    if (lv !== 0) return lv;
    const ab = abcdOf(a.customerId).localeCompare(abcdOf(b.customerId));
    if (ab !== 0) return ab;
    return b.days - a.days;
  });
}

/** 管理端概览：每人红/橙/黄停滞数 ＋ 停滞占比（停滞客户数÷在管客户数，分母 0 → null 显 —） */
export function stallOverview(
  facts: Facts,
  thresholds: Record<Pool, number> = GENERAL_STALL_THRESHOLDS,
): {
  perOwner: Record<string, Record<StallLevel, number>>;
  stalledTotal: number;
  managedTotal: number;
  stalledShare: number | null;
} {
  const perOwner: Record<string, Record<StallLevel, number>> = {};
  let managedTotal = 0;
  for (const st of facts.customerState.values()) {
    if (POOLS.includes(st.stage as Pool)) managedTotal++;
  }
  const items = stallList(facts, thresholds);
  for (const it of items) {
    if (!perOwner[it.ownerId]) perOwner[it.ownerId] = { watch: 0, warn: 0, dying: 0 };
    perOwner[it.ownerId][it.level]++;
  }
  return {
    perOwner,
    stalledTotal: items.length,
    managedTotal,
    stalledShare: managedTotal > 0 ? items.length / managedTotal : null,
  };
}
