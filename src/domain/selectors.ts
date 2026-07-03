/**
 * 销售端读侧选择器（纯函数，全部由事件流实时折算 · 铁律 2）
 * 口径来源：
 *  - §6.1 过程量：lead_new＝count(当期建档)；intent_new＝count(线索→意向)；
 *    sample_new＝count(线索＋意向→样品)
 *  - §6.2 回款＝Σ(当期成交单金额)（销售端仅见本人回款，死线②）
 */
import type { SeedEvent } from './types';

export interface DayProcess {
  lead: number;
  intent: number;
  sample: number;
}

/** 某 owner 某自然日的三过程量（单日目标场景，§6.8 R2-05 适用周期「日」） */
export function ownerDayProcess(events: SeedEvent[], ownerId: string, date: string): DayProcess {
  const p: DayProcess = { lead: 0, intent: 0, sample: 0 };
  for (const e of events) {
    if (e.date !== date || e.ownerId !== ownerId) continue;
    if (e.type === 'customer_created') p.lead++;
    else if (e.type === 'stage_changed') {
      if (e.to === 'intent' && e.from === 'lead') p.intent++;
      else if (e.to === 'sample' && (e.from === 'lead' || e.from === 'intent')) p.sample++;
    }
  }
  return p;
}

export interface OwnerMonthRevenue {
  value: number;
  /** 达到当前值的最近成交单事件时间（排名并列时早者前） */
  lastTime: string;
}

/** 各 owner 当月回款（截至 asOfDate，含复购单；金额逐笔累加，不读任何汇总） */
export function monthRevenueByOwner(
  events: SeedEvent[],
  ym: string,
  asOfDate: string,
): Record<string, OwnerMonthRevenue> {
  const out: Record<string, OwnerMonthRevenue> = {};
  for (const e of events) {
    if (e.type !== 'order_created' || e.date.slice(0, 7) !== ym || e.date > asOfDate) continue;
    const cur = (out[e.ownerId] ??= { value: 0, lastTime: '' });
    cur.value += e.amount ?? 0;
    const t = `${e.date} ${e.time}`;
    if (t > cur.lastTime) cur.lastTime = t;
  }
  return out;
}
