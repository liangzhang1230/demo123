/**
 * 每日确认页折算（P5）· 唯一事实源＝v1.0 §4.7（租户休息日除外）
 *  - 无手工填数：全部区块由事件流自动汇总、只读（客户驱动模式）
 *  - 四池分区同构：上期存量、今日新增、转出各目标态、流失、期末存量
 *  - 成交区：首购客户数、复购客户数、成交客户列表（客户/类型/回款）
 *  - 当日总回款＝自动汇总，只读
 *  - 本人口径（销售端确认页仅见本人数据，R1-16）
 */
import type { Customer, SeedData, SeedEvent, Stage } from './types';

export type PoolKey = 'lead' | 'intent' | 'sample' | 'signed';
export const POOL_KEYS: PoolKey[] = ['lead', 'intent', 'sample', 'signed'];

export interface PoolSection {
  pool: PoolKey;
  prevStock: number; // 上期存量（昨日日终）
  newIn: number; // 今日新增（转入本池；线索池＝建档）
  out: Partial<Record<Stage, number>>; // 今日转出（按目标态；不含流失）
  lost: number; // 今日流失（按流失前状态归池）
  endStock: number; // 期末存量（当日实时）
}

export interface DealOrderRow {
  customerId: string;
  customerName: string;
  isRepeat: boolean;
  amount: number;
  time: string;
}

export interface ConfirmSheet {
  date: string;
  restDay: boolean;
  pools: PoolSection[];
  firstDealCnt: number;
  repeatOrderCnt: number;
  orders: DealOrderRow[];
  totalRevenue: number; // 当日总回款（自动汇总，只读）
  /** 当日有无单据/活动（应确认判定：当日有事件的账号计入应确认） */
  hasActivity: boolean;
}

function addDaysLocal(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 某 owner 在某日终点的四池存量（逐客户回放当前态，零汇总直读） */
function stocksAt(events: SeedEvent[], customers: Customer[], ownerId: string, asOf: string): Record<PoolKey, number> {
  const stage = new Map<string, Stage>();
  for (const e of events) {
    if (e.date > asOf) continue;
    if (e.type === 'customer_created') stage.set(e.customerId, 'lead');
    else if (e.type === 'stage_changed') stage.set(e.customerId, e.to as Stage);
  }
  const out: Record<PoolKey, number> = { lead: 0, intent: 0, sample: 0, signed: 0 };
  for (const c of customers) {
    if (c.ownerId !== ownerId) continue;
    const s = stage.get(c.id);
    if (s && s in out) out[s as PoolKey]++;
  }
  return out;
}

export function buildConfirmSheet(
  data: SeedData,
  ownerId: string,
  date: string,
  isRestDay: (d: string) => boolean,
): ConfirmSheet {
  const prev = stocksAt(data.events, data.customers, ownerId, addDaysLocal(date, -1));
  const end = stocksAt(data.events, data.customers, ownerId, date);
  const nameOf = new Map(data.customers.map((c) => [c.id, c.name]));

  const pools: Record<PoolKey, PoolSection> = Object.fromEntries(
    POOL_KEYS.map((p) => [p, { pool: p, prevStock: prev[p], newIn: 0, out: {}, lost: 0, endStock: end[p] }]),
  ) as Record<PoolKey, PoolSection>;

  let firstDealCnt = 0;
  let repeatOrderCnt = 0;
  const orders: DealOrderRow[] = [];
  let totalRevenue = 0;
  let hasActivity = false;

  for (const e of data.events) {
    if (e.date !== date || e.ownerId !== ownerId) continue;
    hasActivity = true;
    if (e.type === 'customer_created') {
      pools.lead.newIn++;
    } else if (e.type === 'stage_changed') {
      const from = e.from as Stage;
      const to = e.to as Stage;
      if (from in pools) {
        const sec = pools[from as PoolKey];
        if (to === 'lost') sec.lost++;
        else sec.out[to] = (sec.out[to] ?? 0) + 1;
      }
      if (to in pools) pools[to as PoolKey].newIn++;
      if (to === 'deal') firstDealCnt++;
    } else if (e.type === 'order_created') {
      const amt = e.amount ?? 0;
      totalRevenue += amt;
      if (e.isRepeat) repeatOrderCnt++;
      orders.push({
        customerId: e.customerId,
        customerName: nameOf.get(e.customerId) ?? e.customerId,
        isRepeat: !!e.isRepeat,
        amount: amt,
        time: e.time,
      });
    }
  }

  return {
    date,
    restDay: isRestDay(date),
    pools: POOL_KEYS.map((p) => pools[p]),
    firstDealCnt,
    repeatOrderCnt,
    orders,
    totalRevenue,
    hasActivity,
  };
}
