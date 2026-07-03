/**
 * 客户停滞预警 · 唯一事实源＝v1.0 §8
 *  - 停留天数＝当日 − 客户最近一次进入当前状态的事件日（自然日；进入当日记 0；左闭）
 *  - 判定：停留天数 ≥ 阈值即触发（左闭）；状态流转即清零；进成交/流失即退出监控
 *  - 三级（左闭右开，自上而下首次命中即停，倍数 1.5/2.5 为系统常量）：
 *      濒死 ≥2.5 倍 红｜预警 [1.5,2.5) 橙｜关注 [1.0,1.5) 黄
 *  - 阈值＝行业模板「通用」列（§8.3.1，演示租户预置）：线索 15／意向 30／样品 20／签约未回款 7
 *  - 销售端列表排序＝等级（红→橙→黄）→ ABCD（A→B→C→D）→ 停留天数倒序（§8.5.1）
 *  - 停留天数/等级为纯派生值，运行时算出、不落库
 */
import type { Customer, SeedEvent, Stage } from './types';
import { dayDiff } from './calendar';

export type StallPool = 'lead' | 'intent' | 'sample' | 'signed';

/** 行业模板初始推荐值 · 通用列（§8.3.1） */
export const STALL_THRESHOLDS_GENERAL: Record<StallPool, number> = {
  lead: 15,
  intent: 30,
  sample: 20,
  signed: 7,
};

export type StallLevelKey = 'red' | 'orange' | 'yellow';

export const STALL_LEVEL_ORDER: StallLevelKey[] = ['red', 'orange', 'yellow'];

export const STALL_LEVEL_LABEL: Record<StallLevelKey, string> = {
  red: '濒死',
  orange: '预警',
  yellow: '关注',
};

/** 三级判定（左闭右开，自上而下首次命中即停）；未达 1.0 倍 → null（未停滞） */
export function stallLevelOf(stayDays: number, threshold: number): StallLevelKey | null {
  if (threshold <= 0) return null;
  const ratio = stayDays / threshold;
  if (ratio >= 2.5) return 'red';
  if (ratio >= 1.5) return 'orange';
  if (ratio >= 1.0) return 'yellow';
  return null;
}

export interface CurrentStageInfo {
  stage: Stage;
  /** 最近一次进入当前状态的事件日 */
  enteredDate: string;
  ownerId: string;
}

/** 由事件流派生每个客户的当前状态与进入日（≤ asOfDate） */
export function currentStagesOf(events: SeedEvent[], asOfDate: string): Map<string, CurrentStageInfo> {
  const map = new Map<string, CurrentStageInfo>();
  for (const e of events) {
    if (e.date > asOfDate) continue;
    if (e.type === 'customer_created') {
      map.set(e.customerId, { stage: 'lead', enteredDate: e.date, ownerId: e.ownerId });
    } else if (e.type === 'stage_changed') {
      map.set(e.customerId, { stage: e.to as Stage, enteredDate: e.date, ownerId: e.ownerId });
    }
  }
  return map;
}

export interface StallItem {
  customerId: string;
  name: string;
  stage: StallPool;
  level: StallLevelKey;
  stayDays: number;
  abcd: Customer['level'];
}

const LEVEL_RANK: Record<StallLevelKey, number> = { red: 0, orange: 1, yellow: 2 };

/** 本人归属客户的停滞列表（§8.5.1：仅见本人，排序 等级→ABCD→停留天数倒序） */
export function stallListForOwner(
  events: SeedEvent[],
  customers: Customer[],
  ownerId: string,
  asOfDate: string,
  thresholds: Record<StallPool, number> = STALL_THRESHOLDS_GENERAL,
): StallItem[] {
  const stages = currentStagesOf(events, asOfDate);
  const items: StallItem[] = [];
  for (const c of customers) {
    if (c.ownerId !== ownerId) continue;
    const info = stages.get(c.id);
    if (!info) continue;
    const pool = info.stage as StallPool;
    if (!(pool in thresholds)) continue; // 进成交/流失即退出监控
    const stayDays = dayDiff(asOfDate, info.enteredDate); // 进入当日记 0
    const level = stallLevelOf(stayDays, thresholds[pool]);
    if (!level) continue;
    items.push({ customerId: c.id, name: c.name, stage: pool, level, stayDays, abcd: c.level });
  }
  items.sort((a, b) => {
    if (LEVEL_RANK[a.level] !== LEVEL_RANK[b.level]) return LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (a.abcd !== b.abcd) return a.abcd < b.abcd ? -1 : 1; // A→B→C→D
    return b.stayDays - a.stayDays; // 停留天数倒序
  });
  return items;
}
