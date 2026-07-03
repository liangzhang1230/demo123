/**
 * 口径引擎 · 事件流折算器（P2，由 P1 的 seed/fold.ts 迁入并扩展）。
 * 口径逐条取自 v1.0：
 *  - 存量＝当前处于该池客户数；守恒：新增 − 转出 − 流失 ＝ 存量（R1-12）
 *  - §6.1 过程量（lead_new/intent_new/sample_new/signed_new，事件自动生成、只读）
 *  - §6.3 四环节转化率（累计制，分子分母均非豁免口径，分母为 0 显示 —）
 *  - §6.4 人力成本逐日累计模型：仅计开通日及以后；月固定项日摊＝月额÷当月自然天数；招培入职一次性
 *  - §6.4/§6.6 累计净利润＝累计毛利额−累计成本；labor_roi＝累计净利润÷累计成本；
 *    部门/公司＝分子分母各自先汇总再相除（严禁对个人比值求平均）
 *  - aov＝累计回款÷成交总客户数 total_deal_cnt（含复购、客户去重）
 *  - §8.1 停滞底座：停留天数＝当日−最近一次进入当前状态的事件日（进入当日记 0），
 *    引擎为此维护「当前受监控池客户 × 进入日」切面（poolStates），判定在 stall.ts
 *  - 精度：金额 2 位、比率 1 位百分比、labor_roi 2 位（显示才舍入，比较用全精度）
 */
import type { Category, Person, SeedEvent, Stage } from './types';

export interface PoolFlow {
  entered: number;
  exited: number; // 前向转出（不含流失）
  lost: number;
}

/** owner × 月 过程量与结果量（§6.1/§6.2 当期口径，周期物理隔离） */
export interface OwnerMonth {
  revenue: number;
  grossProfit: number;
  firstDeals: number;
  repeatOrders: number;
  leadNew: number;
  intentNew: number;
  sampleNew: number;
  signedNew: number;
}

export interface OwnerAgg {
  leads: number;
  revenue: number;
  grossProfit: number;
  firstDeals: number;
  sampleIn: number;
  sampleOut: number;
  lastEventDate: string | null;
  stocks: Record<Stage, number>;
}

/** 当前处于受监控状态（线索/意向/样品/签约未回款）的客户切面（停滞判定唯一输入，§8.1） */
export interface PoolState {
  customerId: string;
  ownerId: string;
  stage: 'lead' | 'intent' | 'sample' | 'signed';
  enteredDate: string;
}

export interface Folded {
  stocks: Record<Stage, number>;
  poolFlow: Record<'lead' | 'intent' | 'sample' | 'signed' | 'deal', PoolFlow> & { lostTotal: number };
  /** 池 × 月（ym → flow） */
  monthlyPoolFlow: Record<string, Record<'lead' | 'intent' | 'sample' | 'signed', PoolFlow>>;
  cumRevenue: number;
  monthRevenue: number; // 锚点当月
  revenueByMonth: Record<string, number>;
  grossByMonth: Record<string, number>;
  firstDealsByMonth: Record<string, number>;
  repeatOrdersByMonth: Record<string, number>;
  totalDealCnt: number; // 成交总客户数（去重）
  repeatOrderCnt: number;
  repeatCustCnt: number;
  cumGrossProfit: number;
  totalLaborCost: number;
  teamLaborRoi: number | null;
  perOwner: Record<string, OwnerAgg>;
  perOwnerMonthly: Record<string, Record<string, OwnerMonth>>;
  perOwnerLaborCost: Record<string, number>;
  perOwnerRoi: Record<string, number | null>;
  poolStates: PoolState[];
  lossReasonByMonth: Record<string, Record<string, number>>;
  monthlyLossTotal: Record<string, number>;
  eventCount: number;
}

const POOLS: ('lead' | 'intent' | 'sample' | 'signed')[] = ['lead', 'intent', 'sample', 'signed'];

function emptyStocks(): Record<Stage, number> {
  return { lead: 0, intent: 0, sample: 0, signed: 0, deal: 0, lost: 0 };
}

function emptyOwnerMonth(): OwnerMonth {
  return { revenue: 0, grossProfit: 0, firstDeals: 0, repeatOrders: 0, leadNew: 0, intentNew: 0, sampleNew: 0, signedNew: 0 };
}

export function daysInCalendarMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function* eachDay(from: string, to: string): Generator<string> {
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/** 自然日差（b − a），同日为 0 */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** 人力成本逐日累计（开通日/入职日孰晚起算，至 asOf 当日止；§8.1） */
export function laborCostOf(p: Person, openDate: string, asOf: string): number {
  if (p.monthlyCost <= 0 && p.onboardingCost <= 0) return 0;
  const start = p.hireDate && p.hireDate > openDate ? p.hireDate : openDate;
  if (start > asOf) return 0;
  let cost = 0;
  for (const day of eachDay(start, asOf)) {
    cost += p.monthlyCost / daysInCalendarMonth(day.slice(0, 7));
  }
  if (p.hireDate && p.hireDate >= openDate && p.hireDate <= asOf) cost += p.onboardingCost;
  return cost;
}

/** 某自然月内人力成本（月固定项日摊按当月计提天数，招培仅入职当月一次；用于月净利＝月毛利−月人力成本） */
export function laborCostInMonth(p: Person, ym: string, openDate: string, asOf: string): number {
  if (p.monthlyCost <= 0 && p.onboardingCost <= 0) return 0;
  const start0 = p.hireDate && p.hireDate > openDate ? p.hireDate : openDate;
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(daysInCalendarMonth(ym)).padStart(2, '0')}`;
  const from = start0 > monthStart ? start0 : monthStart;
  const to = asOf < monthEnd ? asOf : monthEnd;
  if (from > to) return 0;
  let cost = (dayDiff(from, to) + 1) * (p.monthlyCost / daysInCalendarMonth(ym));
  if (p.hireDate && p.hireDate >= openDate && p.hireDate.slice(0, 7) === ym && p.hireDate <= asOf) {
    cost += p.onboardingCost;
  }
  return cost;
}

export function foldEvents(
  events: SeedEvent[],
  people: Person[],
  categories: Category[],
  asOfDate: string,
  openDate: string,
): Folded {
  const marginOf = new Map(categories.map((c) => [c.code, c.marginRate]));
  /** 客户当前状态＋最近一次进入该状态的事件日（停滞底座 §8.1） */
  const stage = new Map<string, { stage: Stage; entered: string; ownerId: string }>();
  const stocks = emptyStocks();
  const poolFlow = {
    lead: { entered: 0, exited: 0, lost: 0 },
    intent: { entered: 0, exited: 0, lost: 0 },
    sample: { entered: 0, exited: 0, lost: 0 },
    signed: { entered: 0, exited: 0, lost: 0 },
    deal: { entered: 0, exited: 0, lost: 0 },
    lostTotal: 0,
  };
  const monthlyPoolFlow: Folded['monthlyPoolFlow'] = {};
  const revenueByMonth: Record<string, number> = {};
  const grossByMonth: Record<string, number> = {};
  const firstDealsByMonth: Record<string, number> = {};
  const repeatOrdersByMonth: Record<string, number> = {};
  const lossReasonByMonth: Record<string, Record<string, number>> = {};
  const monthlyLossTotal: Record<string, number> = {};
  const perOwner: Record<string, OwnerAgg> = {};
  const perOwnerMonthly: Record<string, Record<string, OwnerMonth>> = {};
  const dealCustomers = new Set<string>();
  const repeatCustomers = new Set<string>();
  let cumRevenue = 0;
  let cumGrossProfit = 0;
  let repeatOrderCnt = 0;
  let eventCount = 0;

  const anchorYm = asOfDate.slice(0, 7);

  const ownerAgg = (id: string): OwnerAgg => {
    if (!perOwner[id]) {
      perOwner[id] = {
        leads: 0, revenue: 0, grossProfit: 0, firstDeals: 0, sampleIn: 0, sampleOut: 0,
        lastEventDate: null, stocks: emptyStocks(),
      };
    }
    return perOwner[id];
  };
  const ownerMonth = (id: string, ym: string): OwnerMonth => {
    if (!perOwnerMonthly[id]) perOwnerMonthly[id] = {};
    if (!perOwnerMonthly[id][ym]) perOwnerMonthly[id][ym] = emptyOwnerMonth();
    return perOwnerMonthly[id][ym];
  };
  const mpf = (ym: string) => {
    if (!monthlyPoolFlow[ym]) {
      monthlyPoolFlow[ym] = {
        lead: { entered: 0, exited: 0, lost: 0 },
        intent: { entered: 0, exited: 0, lost: 0 },
        sample: { entered: 0, exited: 0, lost: 0 },
        signed: { entered: 0, exited: 0, lost: 0 },
      };
    }
    return monthlyPoolFlow[ym];
  };

  for (const e of events) {
    if (e.date > asOfDate) continue;
    eventCount++;
    const ym = e.date.slice(0, 7);
    const oa = ownerAgg(e.ownerId);
    const om = ownerMonth(e.ownerId, ym);
    oa.lastEventDate = oa.lastEventDate && oa.lastEventDate > e.date ? oa.lastEventDate : e.date;

    if (e.type === 'customer_created') {
      stage.set(e.customerId, { stage: 'lead', entered: e.date, ownerId: e.ownerId });
      stocks.lead++;
      poolFlow.lead.entered++;
      mpf(ym).lead.entered++;
      oa.leads++;
      oa.stocks.lead++;
      om.leadNew++;
    } else if (e.type === 'stage_changed') {
      const from = e.from as Stage;
      const to = e.to as Stage;
      const cur = stage.get(e.customerId);
      if (cur?.stage !== from) {
        throw new Error(`事件流不一致：${e.customerId} 当前 ${cur?.stage}，事件却从 ${from} 流转`);
      }
      stage.set(e.customerId, { stage: to, entered: e.date, ownerId: e.ownerId });
      stocks[from]--;
      stocks[to]++;
      oa.stocks[from]--;
      oa.stocks[to]++;
      if (POOLS.includes(from as any)) {
        const pf = poolFlow[from as 'lead'];
        const mf = mpf(ym)[from as 'lead'];
        if (to === 'lost') {
          pf.lost++;
          mf.lost++;
          poolFlow.lostTotal++;
          monthlyLossTotal[ym] = (monthlyLossTotal[ym] ?? 0) + 1;
          const r = e.lossReason ?? '未填';
          lossReasonByMonth[ym] = lossReasonByMonth[ym] ?? {};
          lossReasonByMonth[ym][r] = (lossReasonByMonth[ym][r] ?? 0) + 1;
        } else {
          pf.exited++;
          mf.exited++;
        }
        if (from === 'sample') oa.sampleOut += to === 'lost' ? 0 : 1;
      }
      if (POOLS.includes(to as any) && to !== 'lead') {
        poolFlow[to as 'intent'].entered++;
        mpf(ym)[to as 'intent'].entered++;
        if (to === 'intent') om.intentNew++;
        if (to === 'sample') { om.sampleNew++; oa.sampleIn++; }
        if (to === 'signed') om.signedNew++;
      }
      if (to === 'deal') {
        poolFlow.deal.entered++;
        firstDealsByMonth[ym] = (firstDealsByMonth[ym] ?? 0) + 1;
        dealCustomers.add(e.customerId);
        oa.firstDeals++;
        om.firstDeals++;
      }
    } else if (e.type === 'order_created') {
      const amt = e.amount ?? 0;
      cumRevenue += amt;
      revenueByMonth[ym] = (revenueByMonth[ym] ?? 0) + amt;
      const gp = amt * (marginOf.get(e.categoryCode ?? '') ?? 0);
      cumGrossProfit += gp;
      grossByMonth[ym] = (grossByMonth[ym] ?? 0) + gp;
      oa.revenue += amt;
      oa.grossProfit += gp;
      om.revenue += amt;
      om.grossProfit += gp;
      dealCustomers.add(e.customerId);
      if (e.isRepeat) {
        repeatOrderCnt++;
        repeatOrdersByMonth[ym] = (repeatOrdersByMonth[ym] ?? 0) + 1;
        om.repeatOrders++;
        repeatCustomers.add(e.customerId);
      }
    }
  }

  // 受监控池切面（停滞判定输入）
  const poolStates: PoolState[] = [];
  for (const [customerId, s] of stage) {
    if (POOLS.includes(s.stage as any)) {
      poolStates.push({ customerId, ownerId: s.ownerId, stage: s.stage as PoolState['stage'], enteredDate: s.entered });
    }
  }

  // 人力成本与 labor_roi（部门/团队＝分子分母各自先汇总再相除）
  const perOwnerLaborCost: Record<string, number> = {};
  const perOwnerRoi: Record<string, number | null> = {};
  let totalLaborCost = 0;
  let totalGross = 0;
  for (const p of people) {
    const c = laborCostOf(p, openDate, asOfDate);
    perOwnerLaborCost[p.id] = c;
    totalLaborCost += c;
    const gp = perOwner[p.id]?.grossProfit ?? 0;
    totalGross += gp;
    perOwnerRoi[p.id] = c > 0 ? (gp - c) / c : null; // 成本为 0 显「—（未设成本）」
  }
  const teamLaborRoi = totalLaborCost > 0 ? (totalGross - totalLaborCost) / totalLaborCost : null;

  return {
    stocks,
    poolFlow,
    monthlyPoolFlow,
    cumRevenue,
    monthRevenue: revenueByMonth[anchorYm] ?? 0,
    revenueByMonth,
    grossByMonth,
    firstDealsByMonth,
    repeatOrdersByMonth,
    totalDealCnt: dealCustomers.size,
    repeatOrderCnt,
    repeatCustCnt: repeatCustomers.size,
    cumGrossProfit,
    totalLaborCost,
    teamLaborRoi,
    perOwner,
    perOwnerMonthly,
    perOwnerLaborCost,
    perOwnerRoi,
    poolStates,
    lossReasonByMonth,
    monthlyLossTotal,
    eventCount,
  };
}

/** §6.3 四环节转化率＋成交率（累计制；分母为 0 → null 显 —） */
export function convRates(poolFlow: Folded['poolFlow']): {
  lead: number | null; intent: number | null; sample: number | null; signed: number | null; close: number | null;
} {
  const r = (f: PoolFlow) => (f.entered > 0 ? f.exited / f.entered : null);
  return {
    lead: r(poolFlow.lead),
    intent: r(poolFlow.intent),
    sample: r(poolFlow.sample),
    signed: r(poolFlow.signed),
    // close_rate＝累计首购客户数÷累计线索新增
    close: poolFlow.lead.entered > 0 ? poolFlow.deal.entered / poolFlow.lead.entered : null,
  };
}

/** §6.6 部门/公司汇总：分子分母各自先汇总再相除（严禁对个人比值求平均） */
export function groupLaborRoi(
  folded: Folded,
  memberIds: string[],
): { gross: number; cost: number; roi: number | null } {
  let gross = 0;
  let cost = 0;
  for (const id of memberIds) {
    gross += folded.perOwner[id]?.grossProfit ?? 0;
    cost += folded.perOwnerLaborCost[id] ?? 0;
  }
  return { gross, cost, roi: cost > 0 ? (gross - cost) / cost : null };
}
