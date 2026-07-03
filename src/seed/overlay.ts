/**
 * 演示操作层（P5）：现场操作（建档/流转/成交单/确认/日切）以 overlay 形式与种子分离持久。
 *  - 种子本体永不改写：加载时重新生成并跑全部守恒断言（store.ts 既有机制）；
 *    overlay 只追加客户与事件、推进模拟时钟、归档定版快照——合并后一切展示数字仍由事件流实时折算（铁律 2）
 *  - 「模拟过一天」＝ R1-17 日终定版演示化：当日快照归档为「昨日快照」→ 锚点日 +1
 *    （停滞天数随锚点自然 +1；环比/排名/早报由新锚点重新折算——不落任何汇总数）
 *  - 一键重置＝清 overlay ＋ 重生成种子
 */
import type { SeedData, YesterdaySnapshot } from '../domain/types';
import { foldEvents } from '../domain/engine';
import { SEED_VERSION } from './plan';

const LS_KEY = 'sales-demo/overlay';

export interface ConfirmRecord {
  date: string;
  ownerId: string;
  time: string;
}

export interface NoteRecord {
  date: string;
  ownerId: string;
  text: string;
}

export interface Overlay {
  version: string;
  /** 锚点日偏移（「模拟过一天」每次 +1） */
  dayOffset: number;
  /** 最近一次日切定版的账务日（早报样卡所述「昨日」） */
  lastClosedDate: string | null;
  /** 日切归档的定版快照（替换种子预置的昨日快照） */
  snapshot: YesterdaySnapshot | null;
  customers: SeedData['customers'];
  events: SeedData['events'];
  confirms: ConfirmRecord[];
  notes: NoteRecord[];
}

export function emptyOverlay(): Overlay {
  return {
    version: SEED_VERSION,
    dayOffset: 0,
    lastClosedDate: null,
    snapshot: null,
    customers: [],
    events: [],
    confirms: [],
    notes: [],
  };
}

export function loadOverlay(): Overlay {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        const o = JSON.parse(raw) as Overlay;
        if (o.version === SEED_VERSION) return o;
      } catch {
        // 损坏或版本过期 → 丢弃操作层（种子本体不受影响）
      }
    }
  }
  return emptyOverlay();
}

export function saveOverlay(o: Overlay): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(o));
}

export function clearOverlay(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 合并＝种子 ⊕ 操作层（追加保持时间序：现场事件日 ≥ 种子末日） */
export function mergeData(base: SeedData, o: Overlay): SeedData {
  return {
    ...base,
    anchorDate: addDays(base.anchorDate, o.dayOffset),
    customers: [...base.customers, ...o.customers],
    events: [...base.events, ...o.events],
    yesterdaySnapshot: o.snapshot ?? base.yesterdaySnapshot,
  };
}

/** 漏斗守恒逐池验算（R1-12）：每次现场操作后复跑，跑不平即拒绝落库 */
export function assertConservation(data: SeedData): void {
  const folded = foldEvents(data.events, data.people, data.categories, data.anchorDate, data.openDate);
  for (const pool of ['lead', 'intent', 'sample', 'signed'] as const) {
    const f = folded.poolFlow[pool];
    if (f.entered - f.exited - f.lost !== folded.stocks[pool]) {
      throw new Error(`漏斗守恒断言失败 [${pool}]：新增 − 转出 − 流失 ≠ 存量`);
    }
  }
  if (folded.poolFlow.deal.entered !== folded.stocks.deal) throw new Error('成交池守恒失败');
  if (folded.poolFlow.lostTotal !== folded.stocks.lost) throw new Error('流失池守恒失败');
}

/** 日终定版快照（与种子生成器同构：由事件流折算归档，非手写汇总） */
export function computeSnapshot(data: SeedData, date: string): YesterdaySnapshot {
  const folded = foldEvents(data.events, data.people, data.categories, date, data.openDate);
  return {
    date,
    stocks: folded.stocks,
    monthRevenue: folded.monthRevenue,
    cumRevenue: folded.cumRevenue,
    perOwnerRevenue: Object.fromEntries(Object.entries(folded.perOwner).map(([k, v]) => [k, v.revenue])),
    perOwnerStocks: Object.fromEntries(Object.entries(folded.perOwner).map(([k, v]) => [k, v.stocks])),
  };
}

/** 「模拟过一天」：定版归档当日快照 → 锚点 +1（返回新 overlay，不改入参） */
export function closeDay(base: SeedData, o: Overlay): Overlay {
  const merged = mergeData(base, o);
  const closing = merged.anchorDate;
  return {
    ...o,
    dayOffset: o.dayOffset + 1,
    lastClosedDate: closing,
    snapshot: computeSnapshot(merged, closing),
  };
}
