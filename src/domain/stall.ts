/**
 * 客户停滞预警（P2，口径照抄 v1.0 §8）：
 *  - 停留天数＝当日 − 客户最近一次进入当前状态的事件日（自然日；进入当日记 0；左闭）
 *  - 唯一判定标准＝各状态停滞阈值；停留天数 ≥ 阈值即触发（左闭）
 *  - 阈值＝行业模板「通用」列（§8.3.1，演示租户默认业务类型＝通用）：
 *    线索 15 / 意向 30 / 样品 20 / 签约未回款 7
 *  - 三级（§8.4，左闭右开、自上而下首次命中即停，倍数 1.5/2.5 为系统常量）：
 *    濒死（红）≥2.5 倍；预警（橙）[1.5, 2.5)；关注（黄）[1.0, 1.5)
 *  - 进成交/流失即退出监控（引擎只对受监控四池产出 poolStates）
 *  - 停留天数/等级为纯派生值，运行时算出、不落库
 */
import { dayDiff, type PoolState } from './engine';

export const STALL_THRESHOLDS: Record<PoolState['stage'], number> = {
  lead: 15,
  intent: 30,
  sample: 20,
  signed: 7,
};

export type StallLevel = 'red' | 'orange' | 'yellow';

export const STALL_LEVEL_LABEL: Record<StallLevel, string> = {
  red: '濒死',
  orange: '预警',
  yellow: '关注',
};

/** 自上而下首次命中即停：≥2.5×红 → ≥1.5×橙 → ≥1.0×黄 → 未停滞 null */
export function stallLevelOf(stayDays: number, threshold: number): StallLevel | null {
  if (threshold <= 0) return null;
  const ratio = stayDays / threshold;
  if (ratio >= 2.5) return 'red';
  if (ratio >= 1.5) return 'orange';
  if (ratio >= 1.0) return 'yellow';
  return null;
}

export interface StallItem extends PoolState {
  stayDays: number;
  level: StallLevel;
}

export interface StallCounts {
  red: number;
  orange: number;
  yellow: number;
}

export interface StallResult {
  items: StallItem[];
  total: StallCounts;
  perOwner: Record<string, StallCounts>;
  /** 在管客户＝当前处于受监控四池的客户数；停滞占比＝停滞数÷在管数（§8.5.2） */
  managedCnt: number;
}

export function computeStall(
  poolStates: PoolState[],
  asOf: string,
  thresholds: Record<PoolState['stage'], number> = STALL_THRESHOLDS,
): StallResult {
  const items: StallItem[] = [];
  const total: StallCounts = { red: 0, orange: 0, yellow: 0 };
  const perOwner: Record<string, StallCounts> = {};
  for (const s of poolStates) {
    const stayDays = dayDiff(s.enteredDate, asOf); // 进入当日记 0
    const level = stallLevelOf(stayDays, thresholds[s.stage]);
    if (!level) continue;
    items.push({ ...s, stayDays, level });
    total[level]++;
    if (!perOwner[s.ownerId]) perOwner[s.ownerId] = { red: 0, orange: 0, yellow: 0 };
    perOwner[s.ownerId][level]++;
  }
  return { items, total, perOwner, managedCnt: poolStates.length };
}
