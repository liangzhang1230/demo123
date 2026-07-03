/**
 * 事件流综合折算（P2）：在 fold.ts 全局折算之上，补齐看板所需的
 * 客户级实时状态、owner 级月/日过程量、累计制转化率（§6.3）、停滞三级（§8）、
 * 排名（全员/部门/部门间，并列跳号 §6.10）、部门与公司汇总（§6.6 先汇总再算）、
 * 完整月净利/回款环比（§6.5）。全部运行时派生、零落库（铁律 2）。
 */
import type { Customer, LossReason, Person, SeedData, SeedEvent, Stage } from './types';
import { foldEvents, laborCostOf, type Folded } from '../seed/fold';
import {
  completedMonthPair, daysInMonth, momRate, rankJump, stallLevel, stayDays,
  type MonitoredStage, type RankRow, type StallLevel,
} from './engine';

export interface CustomerLive {
  customer: Customer;
  stage: Stage;
  /** 最近一次进入当前状态的事件日（停滞停留天数起点，§8.1） */
  stageEntryDate: string;
  createdDate: string;
  lossReason?: LossReason;
  revenue: number;
  orders: { date: string; amount: number; categoryCode: string; isRepeat: boolean }[];
  lastEventDate: string;
}

export interface ProcessCounts {
  lead: number;
  intent: number;
  sample: number;
  signed: number;
}

export interface OwnerComputed {
  id: string;
  /** 当月过程量（lead_new/intent_new/sample_new/signed_new，操作日归属 §4.5） */
  monthProcess: ProcessCounts;
  /** 锚点当日过程量（确认页/单日目标用） */
  dayProcess: ProcessCounts;
  monthRevenue: number;
  monthFirstDeals: number;
  monthRepeatOrders: number;
  monthRepeatCusts: number;
  /** 累计制转化率 §6.3：分母 0 → null 显 — */
  conv: { lead: number | null; intent: number | null; sample: number | null; signed: number | null };
  convBase: {
    leadNew: number; intentNew: number; sampleNew: number; signedNew: number;
    fwdLead: number; fwdIntent: number; fwdSample: number; fwdSigned: number; toDeal: number;
  };
  /** 并列排序钥匙：该 owner 月回款最后变动的事件序号（事件发生时间早者前） */
  lastOrderSeq: number;
  stall: { dying: number; warning: number; watch: number };
  /** 在管客户数（处于四受监控池） */
  inManaged: number;
}

export interface StallEntry {
  customerId: string;
  name: string;
  ownerId: string;
  stage: MonitoredStage;
  days: number;
  level: StallLevel;
  abcd: 'A' | 'B' | 'C' | 'D';
}

export interface DeptComputed {
  id: string;
  monthRevenue: number;
  cumRevenue: number;
  grossProfit: number;
  laborCost: number;
  roi: number | null; // 先汇总再算（§6.6）
  stocks: Record<Stage, number>;
  stall: { dying: number; warning: number; watch: number };
  memberIds: string[];
}

export interface Computed {
  asOf: string;
  ym: string;
  folded: Folded;
  customers: Map<string, CustomerLive>;
  byOwner: Map<string, CustomerLive[]>;
  owners: Record<string, OwnerComputed>;
  depts: Record<string, DeptComputed>;
  company: {
    monthRevenue: number;
    monthNet: number;
    monthGross: number;
    monthLaborCost: number;
    monthFirstDeals: number;
    monthRepeatCusts: number;
    monthRepeatOrders: number;
    /** 完整月环比（§6.5）：[上期ym, 本期ym] ＋ 回款/净利环比（上期≤0 → null） */
    momPair: [string, string];
    revenueMom: number | null;
    netMom: number | null;
    netByMonth: Record<string, number>;
    grossByMonth: Record<string, number>;
    laborByMonth: Record<string, number>;
    conv: { lead: number | null; intent: number | null; sample: number | null; signed: number | null };
    stallTotal: { dying: number; warning: number; watch: number };
    inManaged: number;
    lossReasonTop: { reason: string; count: number; share: number } | null;
  };
  rankings: {
    /** 全员总排名（月回款，非老板全员） */
    total: RankRow[];
    totalByOwner: Record<string, number>;
    /** 部门内排名 */
    deptByOwner: Record<string, number>;
    /** 部门之间排名（月回款） */
    deptRank: RankRow[];
  };
  stallList: StallEntry[];
}

const POOLS: MonitoredStage[] = ['lead', 'intent', 'sample', 'signed'];
const ABCD_ORDER = { A: 0, B: 1, C: 2, D: 3 } as const;
const LEVEL_ORDER: Record<StallLevel, number> = { dying: 0, warning: 1, watch: 2 };

function emptyProcess(): ProcessCounts {
  return { lead: 0, intent: 0, sample: 0, signed: 0 };
}

/** 某人某自然月内的人力成本（月固定项日摊×在职交集天数＋当月入职的一次性招培） */
function laborCostInMonth(p: Person, ym: string, openDate: string, asOf: string): number {
  if (p.monthlyCost <= 0 && p.onboardingCost <= 0) return 0;
  const dim = daysInMonth(ym);
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(dim).padStart(2, '0')}`;
  const start0 = p.hireDate && p.hireDate > openDate ? p.hireDate : openDate;
  const from = start0 > monthStart ? start0 : monthStart;
  const to = asOf < monthEnd ? asOf : monthEnd;
  if (from > to) return 0;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  let cost = (p.monthlyCost / dim) * days;
  if (p.hireDate && p.hireDate >= openDate && p.hireDate.slice(0, 7) === ym && p.hireDate <= asOf) {
    cost += p.onboardingCost;
  }
  return cost;
}

export function computeAll(data: SeedData, asOf?: string): Computed {
  const asOfDate = asOf ?? data.anchorDate;
  const ym = asOfDate.slice(0, 7);
  const events = data.events;
  const folded = foldEvents(
    events.filter((e) => e.date <= asOfDate), data.people, data.categories, asOfDate, data.openDate,
  );

  const custIndex = new Map(data.customers.map((c) => [c.id, c]));
  const customers = new Map<string, CustomerLive>();
  const owners: Record<string, OwnerComputed> = {};
  const marginOf = new Map(data.categories.map((c) => [c.code, c.marginRate]));
  const grossByMonth: Record<string, number> = {};
  const repeatCustsByOwnerMonth = new Map<string, Set<string>>();
  const companyRepeatCusts = new Set<string>();

  const own = (id: string): OwnerComputed => {
    if (!owners[id]) {
      owners[id] = {
        id,
        monthProcess: emptyProcess(),
        dayProcess: emptyProcess(),
        monthRevenue: 0, monthFirstDeals: 0, monthRepeatOrders: 0, monthRepeatCusts: 0,
        conv: { lead: null, intent: null, sample: null, signed: null },
        convBase: { leadNew: 0, intentNew: 0, sampleNew: 0, signedNew: 0, fwdLead: 0, fwdIntent: 0, fwdSample: 0, fwdSigned: 0, toDeal: 0 },
        lastOrderSeq: 0,
        stall: { dying: 0, warning: 0, watch: 0 },
        inManaged: 0,
      };
    }
    return owners[id];
  };
  for (const p of data.people) if (p.role !== 'boss') own(p.id);

  for (const e of events) {
    if (e.date > asOfDate) continue;
    const eym = e.date.slice(0, 7);
    const isMonth = eym === ym;
    const isDay = e.date === asOfDate;
    const o = own(e.ownerId);

    if (e.type === 'customer_created') {
      const c = custIndex.get(e.customerId);
      if (!c) throw new Error(`事件引用不存在的客户 ${e.customerId}`);
      customers.set(e.customerId, {
        customer: c, stage: 'lead', stageEntryDate: e.date, createdDate: e.date,
        revenue: 0, orders: [], lastEventDate: e.date,
      });
      o.convBase.leadNew++;
      if (isMonth) o.monthProcess.lead++;
      if (isDay) o.dayProcess.lead++;
    } else if (e.type === 'stage_changed') {
      const lc = customers.get(e.customerId)!;
      const from = e.from as Stage;
      const to = e.to as Stage;
      lc.stage = to;
      lc.stageEntryDate = e.date; // 任一状态流转即清零并按新状态重算（§8.2）
      lc.lastEventDate = e.date;
      if (to === 'lost') lc.lossReason = e.lossReason;
      // 累计制转化率分子：各池前向转出（不含流失）§6.3
      if (to !== 'lost') {
        if (from === 'lead') o.convBase.fwdLead++;
        else if (from === 'intent') o.convBase.fwdIntent++;
        else if (from === 'sample') o.convBase.fwdSample++;
        else if (from === 'signed') o.convBase.fwdSigned++;
      }
      // 过程量新增（操作日归属 §4.5）：意向/样品/签约新增
      if (to === 'intent') { o.convBase.intentNew++; if (isMonth) o.monthProcess.intent++; if (isDay) o.dayProcess.intent++; }
      if (to === 'sample') { o.convBase.sampleNew++; if (isMonth) o.monthProcess.sample++; if (isDay) o.dayProcess.sample++; }
      if (to === 'signed') { o.convBase.signedNew++; if (isMonth) o.monthProcess.signed++; if (isDay) o.dayProcess.signed++; }
      if (to === 'deal') { o.convBase.toDeal++; if (isMonth) o.monthFirstDeals++; }
    } else if (e.type === 'order_created') {
      const lc = customers.get(e.customerId)!;
      const amt = e.amount ?? 0;
      lc.revenue += amt;
      lc.lastEventDate = e.date;
      lc.orders.push({ date: e.date, amount: amt, categoryCode: e.categoryCode ?? '', isRepeat: !!e.isRepeat });
      grossByMonth[eym] = (grossByMonth[eym] ?? 0) + amt * (marginOf.get(e.categoryCode ?? '') ?? 0);
      if (isMonth) {
        o.monthRevenue += amt;
        o.lastOrderSeq = e.seq;
        if (e.isRepeat) {
          o.monthRepeatOrders++;
          const key = e.ownerId;
          if (!repeatCustsByOwnerMonth.has(key)) repeatCustsByOwnerMonth.set(key, new Set());
          repeatCustsByOwnerMonth.get(key)!.add(e.customerId);
          companyRepeatCusts.add(e.customerId);
        }
      }
    }
  }

  // 转化率（累计制，分母 0 → null）
  const convOf = (b: OwnerComputed['convBase']) => ({
    lead: b.leadNew > 0 ? b.fwdLead / b.leadNew : null,
    intent: b.intentNew > 0 ? b.fwdIntent / b.intentNew : null,
    sample: b.sampleNew > 0 ? b.fwdSample / b.sampleNew : null,
    signed: b.signedNew > 0 ? b.fwdSigned / b.signedNew : null,
  });
  for (const o of Object.values(owners)) {
    o.conv = convOf(o.convBase);
    o.monthRepeatCusts = repeatCustsByOwnerMonth.get(o.id)?.size ?? 0;
  }

  // 停滞（§8）：受监控四池实时派生
  const byOwner = new Map<string, CustomerLive[]>();
  const stallList: StallEntry[] = [];
  const stallTotal = { dying: 0, warning: 0, watch: 0 };
  let inManagedTotal = 0;
  for (const lc of customers.values()) {
    const ownerId = lc.customer.ownerId;
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId)!.push(lc);
    if ((POOLS as Stage[]).includes(lc.stage)) {
      inManagedTotal++;
      own(ownerId).inManaged++;
      const days = stayDays(lc.stageEntryDate, asOfDate);
      const level = stallLevel(lc.stage as MonitoredStage, days);
      if (level) {
        own(ownerId).stall[level]++;
        stallTotal[level]++;
        stallList.push({
          customerId: lc.customer.id, name: lc.customer.name, ownerId,
          stage: lc.stage as MonitoredStage, days, level, abcd: lc.customer.level,
        });
      }
    }
  }
  // 列表排序＝等级（红→橙→黄）→ ABCD（A→B→C→D）→ 停留天数倒序（§8.5.1）
  stallList.sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      ABCD_ORDER[a.abcd] - ABCD_ORDER[b.abcd] ||
      b.days - a.days,
  );

  // 部门汇总（§6.6：分子分母各自先汇总再相除）
  const depts: Record<string, DeptComputed> = {};
  for (const d of data.departments) {
    const members = data.people.filter((p) => p.deptId === d.id);
    let monthRevenue = 0, cumRevenue = 0, gross = 0, cost = 0;
    const stocks: Record<Stage, number> = { lead: 0, intent: 0, sample: 0, signed: 0, deal: 0, lost: 0 };
    const stall = { dying: 0, warning: 0, watch: 0 };
    for (const m of members) {
      const oc = owners[m.id];
      const fo = folded.perOwner[m.id];
      monthRevenue += oc?.monthRevenue ?? 0;
      cumRevenue += fo?.revenue ?? 0;
      gross += fo?.grossProfit ?? 0;
      cost += folded.perOwnerLaborCost[m.id] ?? 0;
      if (fo) for (const s of Object.keys(stocks) as Stage[]) stocks[s] += fo.stocks[s];
      if (oc) { stall.dying += oc.stall.dying; stall.warning += oc.stall.warning; stall.watch += oc.stall.watch; }
    }
    depts[d.id] = {
      id: d.id, monthRevenue, cumRevenue, grossProfit: gross, laborCost: cost,
      roi: cost > 0 ? (gross - cost) / cost : null, stocks, stall,
      memberIds: members.map((m) => m.id),
    };
  }

  // 公司月度净利与环比（完整月 §6.5）
  const laborByMonth: Record<string, number> = {};
  const netByMonth: Record<string, number> = {};
  const months = new Set<string>([...Object.keys(folded.revenueByMonth), ym]);
  for (const m of months) {
    laborByMonth[m] = data.people.reduce((a, p) => a + laborCostInMonth(p, m, data.openDate, asOfDate), 0);
    netByMonth[m] = (grossByMonth[m] ?? 0) - laborByMonth[m];
  }
  const momPair = completedMonthPair(asOfDate);
  const [prevYm, curYm] = momPair;
  const revenueMom = momRate(folded.revenueByMonth[prevYm] ?? 0, folded.revenueByMonth[curYm] ?? 0);
  const netMom = momRate(netByMonth[prevYm] ?? 0, netByMonth[curYm] ?? 0);

  // 公司累计制转化率（分子分母先汇总）
  const companyBase = Object.values(owners).reduce(
    (acc, o) => {
      for (const k of Object.keys(acc) as (keyof OwnerComputed['convBase'])[]) acc[k] += o.convBase[k];
      return acc;
    },
    { leadNew: 0, intentNew: 0, sampleNew: 0, signedNew: 0, fwdLead: 0, fwdIntent: 0, fwdSample: 0, fwdSigned: 0, toDeal: 0 },
  );

  // 本月首要流失因
  const lossMap = folded.lossReasonByMonth[ym] ?? {};
  const lossTotal = folded.monthlyLossTotal[ym] ?? 0;
  const lossTop = Object.entries(lossMap).sort((a, b) => b[1] - a[1])[0];

  // 排名（月回款；并列跳号；tie＝事件发生时间早者前）
  const ranked = data.people.filter((p) => p.role !== 'boss');
  const total = rankJump(
    ranked.map((p) => ({ id: p.id, value: owners[p.id]?.monthRevenue ?? 0, tieTime: owners[p.id]?.lastOrderSeq ?? 0 })),
  );
  const totalByOwner = Object.fromEntries(total.map((r) => [r.id, r.rank]));
  const deptByOwner: Record<string, number> = {};
  for (const d of data.departments) {
    const rows = rankJump(
      ranked.filter((p) => p.deptId === d.id)
        .map((p) => ({ id: p.id, value: owners[p.id]?.monthRevenue ?? 0, tieTime: owners[p.id]?.lastOrderSeq ?? 0 })),
    );
    for (const r of rows) deptByOwner[r.id] = r.rank;
  }
  const deptRank = rankJump(
    data.departments.map((d) => ({ id: d.id, value: depts[d.id].monthRevenue, tieTime: 0 })),
  );

  return {
    asOf: asOfDate,
    ym,
    folded,
    customers,
    byOwner,
    owners,
    depts,
    company: {
      monthRevenue: folded.revenueByMonth[ym] ?? 0,
      monthGross: grossByMonth[ym] ?? 0,
      monthLaborCost: laborByMonth[ym] ?? 0,
      monthNet: netByMonth[ym] ?? 0,
      monthFirstDeals: Object.values(owners).reduce((a, o) => a + o.monthFirstDeals, 0),
      monthRepeatCusts: companyRepeatCusts.size,
      monthRepeatOrders: Object.values(owners).reduce((a, o) => a + o.monthRepeatOrders, 0),
      momPair,
      revenueMom,
      netMom,
      netByMonth,
      grossByMonth,
      laborByMonth,
      conv: {
        lead: companyBase.leadNew > 0 ? companyBase.fwdLead / companyBase.leadNew : null,
        intent: companyBase.intentNew > 0 ? companyBase.fwdIntent / companyBase.intentNew : null,
        sample: companyBase.sampleNew > 0 ? companyBase.fwdSample / companyBase.sampleNew : null,
        signed: companyBase.signedNew > 0 ? companyBase.fwdSigned / companyBase.signedNew : null,
      },
      stallTotal,
      inManaged: inManagedTotal,
      lossReasonTop: lossTop ? { reason: lossTop[0], count: lossTop[1], share: lossTotal > 0 ? lossTop[1] / lossTotal : 0 } : null,
    },
    rankings: { total, totalByOwner, deptByOwner, deptRank },
    stallList,
  };
}

/** 人力成本（累计，开通日起）——转发种子层实现，供页面单点引用 */
export { laborCostOf };
