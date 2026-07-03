/**
 * 事实折算器（口径引擎数据底座）：把种子事件流折算为「个人 × 周期」的过程量/结果量事实表。
 * 铁律 2：一切展示数字由事件流实时计算——本文件只累计事件，不含任何预写汇总。
 *
 * 口径来源＝v1.0：
 *  - §6.1 过程量：新增按事件当期计，各池流失按流失前状态归池，存量＝当前处于该池客户数；
 *  - §6.2 结果量：首购＝任意池→成交事件；复购不产状态事件；total_deal_cnt＝当期成交客户去重（含复购）；
 *  - §4.3/R1-04：跳级只产生目标阶段事件、中间不补计；线索直接→成交单列「直成交」；
 *  - §4.5/R1-11：事件按操作日归属各自周期独立核算（跨期天然隔离）；
 *  - 毛利＝Σ(成交单回款×该单品类快照毛利率)（§6.4）。
 */
import type { Category, SeedEvent, Stage } from './types';
import { ymOf } from './period';

export type Pool = 'lead' | 'intent' | 'sample' | 'signed';
export const POOLS: Pool[] = ['lead', 'intent', 'sample', 'signed'];

/** 单周期（或累计）事实：分子分母只取本周期事件（§6.3 周期物理隔离） */
export interface Tally {
  /** 各池进入量（lead＝线索新增/建档） */
  entered: Record<Pool, number>;
  /** 各池前向转出量（不含流失）——转化率分子 */
  exited: Record<Pool, number>;
  /** 各池流失量（按流失前状态归池） */
  lost: Record<Pool, number>;
  /** 首购客户数（任意池→成交事件） */
  firstDealCnt: number;
  /** 直成交（线索直接→成交，单列） */
  directDealCnt: number;
  /** 回款（全部成交单） */
  revenue: number;
  /** 首购回款 / 复购回款 */
  firstRevenue: number;
  repeatRevenue: number;
  /** 毛利额＝Σ(回款×品类毛利率) */
  grossProfit: number;
  repeatOrderCnt: number;
  /** 当期成交客户去重（含复购）→ total_deal_cnt */
  dealCustomers: Set<string>;
  /** 当期有复购成交单的去重客户 → repeat_cust_cnt */
  repeatCustomers: Set<string>;
}

export interface CustomerState {
  stage: Stage;
  /** 最近一次进入当前状态的事件日（§8.1 停滞底座；线索＝create_time） */
  enteredOn: string;
  ownerId: string;
}

export interface Facts {
  asOf: string;
  /** 客户当前状态（截至 asOf） */
  customerState: Map<string, CustomerState>;
  /** 个人事实：累计（入职日起，演示＝其全部事件）＋ 按自然月 */
  byOwner: Record<string, { cum: Tally; byMonth: Record<string, Tally> }>;
  /** 个人末次业务事件日（停滞/止血钩子用） */
  lastEventDate: Record<string, string | null>;
}

export function emptyTally(): Tally {
  return {
    entered: { lead: 0, intent: 0, sample: 0, signed: 0 },
    exited: { lead: 0, intent: 0, sample: 0, signed: 0 },
    lost: { lead: 0, intent: 0, sample: 0, signed: 0 },
    firstDealCnt: 0,
    directDealCnt: 0,
    revenue: 0,
    firstRevenue: 0,
    repeatRevenue: 0,
    grossProfit: 0,
    repeatOrderCnt: 0,
    dealCustomers: new Set(),
    repeatCustomers: new Set(),
  };
}

/** 部门/公司汇总＝对成员事实求和（Set 取并集去重，§6.2 客户口径） */
export function sumTallies(ts: Tally[]): Tally {
  const s = emptyTally();
  for (const t of ts) {
    for (const p of POOLS) {
      s.entered[p] += t.entered[p];
      s.exited[p] += t.exited[p];
      s.lost[p] += t.lost[p];
    }
    s.firstDealCnt += t.firstDealCnt;
    s.directDealCnt += t.directDealCnt;
    s.revenue += t.revenue;
    s.firstRevenue += t.firstRevenue;
    s.repeatRevenue += t.repeatRevenue;
    s.grossProfit += t.grossProfit;
    s.repeatOrderCnt += t.repeatOrderCnt;
    for (const c of t.dealCustomers) s.dealCustomers.add(c);
    for (const c of t.repeatCustomers) s.repeatCustomers.add(c);
  }
  return s;
}

/**
 * 折算事件流（截至 asOf，含当日）。事件按 (date,time,seq) 排序后重放；
 * 状态机不一致即抛错（引擎不容忍脏事件流，对齐 R1-12 事件唯一）。
 */
export function buildFacts(
  events: SeedEvent[],
  categories: Category[],
  asOf: string,
): Facts {
  const marginOf = new Map(categories.map((c) => [c.code, c.marginRate]));
  const customerState = new Map<string, CustomerState>();
  const byOwner: Facts['byOwner'] = {};
  const lastEventDate: Record<string, string | null> = {};

  const ownerOf = (id: string) => {
    if (!byOwner[id]) byOwner[id] = { cum: emptyTally(), byMonth: {} };
    return byOwner[id];
  };
  const talliesOf = (ownerId: string, ym: string): Tally[] => {
    const o = ownerOf(ownerId);
    if (!o.byMonth[ym]) o.byMonth[ym] = emptyTally();
    return [o.cum, o.byMonth[ym]];
  };

  const sorted = [...events].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.time !== b.time ? (a.time < b.time ? -1 : 1) : a.seq - b.seq,
  );

  for (const e of sorted) {
    if (e.date > asOf) continue;
    const ym = ymOf(e.date);
    const targets = talliesOf(e.ownerId, ym);
    const prev = lastEventDate[e.ownerId];
    lastEventDate[e.ownerId] = prev && prev > e.date ? prev : e.date;

    if (e.type === 'customer_created') {
      if (customerState.has(e.customerId)) throw new Error(`重复建档：${e.customerId}`);
      customerState.set(e.customerId, { stage: 'lead', enteredOn: e.date, ownerId: e.ownerId });
      for (const t of targets) t.entered.lead++;
    } else if (e.type === 'stage_changed') {
      const st = customerState.get(e.customerId);
      const from = e.from as Stage;
      const to = e.to as Stage;
      if (!st || st.stage !== from) {
        throw new Error(`事件流不一致：${e.customerId} 当前 ${st?.stage ?? '未建档'}，事件却从 ${from} 流转`);
      }
      st.stage = to;
      st.enteredOn = e.date; // 任一状态流转即重新起算停留天数（§8.2）
      if (POOLS.includes(from as Pool)) {
        for (const t of targets) {
          if (to === 'lost') t.lost[from as Pool]++;
          else t.exited[from as Pool]++;
        }
      }
      if (POOLS.includes(to as Pool)) {
        for (const t of targets) t.entered[to as Pool]++;
      }
      if (to === 'deal') {
        for (const t of targets) {
          t.firstDealCnt++;
          if (from === 'lead') t.directDealCnt++; // R1-04 直成交单列
          t.dealCustomers.add(e.customerId);
        }
      }
    } else if (e.type === 'order_created') {
      const amt = e.amount ?? 0;
      const gp = amt * (marginOf.get(e.categoryCode ?? '') ?? 0);
      for (const t of targets) {
        t.revenue += amt;
        t.grossProfit += gp;
        t.dealCustomers.add(e.customerId);
        if (e.isRepeat) {
          t.repeatRevenue += amt;
          t.repeatOrderCnt++;
          t.repeatCustomers.add(e.customerId);
        } else {
          t.firstRevenue += amt;
        }
      }
    }
  }

  return { asOf, customerState, byOwner, lastEventDate };
}

/** 各池期末存量＝count(当前处于该池客户)（§6.1）；可按归属集合过滤（个人/部门） */
export function stocksOf(facts: Facts, ownerIds?: ReadonlySet<string>): Record<Stage, number> {
  const s: Record<Stage, number> = { lead: 0, intent: 0, sample: 0, signed: 0, deal: 0, lost: 0 };
  for (const st of facts.customerState.values()) {
    if (ownerIds && !ownerIds.has(st.ownerId)) continue;
    s[st.stage]++;
  }
  return s;
}

/** 取某 owner 集合在某周期（ym 或 'cum'）的合并事实 */
export function tallyOf(facts: Facts, ownerIds: readonly string[], period: string | 'cum'): Tally {
  return sumTallies(
    ownerIds.map((id) => {
      const o = facts.byOwner[id];
      if (!o) return emptyTally();
      return period === 'cum' ? o.cum : (o.byMonth[period] ?? emptyTally());
    }),
  );
}
