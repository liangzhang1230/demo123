/**
 * 事件流折算器（P1 最小集）：从事件流实时计算池存量、月度流量、回款、人力成本与 labor_roi。
 * 口径逐条取自 v1.0：
 *  - 存量＝当前处于该池客户数；守恒：新增 − 转出 − 流失 ＝ 存量（R1-12）
 *  - 人力成本逐日累计模型：仅计开通日及以后；月固定项日摊＝月额÷当月自然天数；招培入职一次性
 *  - 累计净利润＝累计毛利额−累计成本；labor_roi＝累计净利润÷累计成本（团队＝先汇总再算）
 *  - aov＝累计回款÷成交总客户数 total_deal_cnt（含复购、客户去重）
 *  - 精度：金额 2 位、比率 1 位百分比、labor_roi 2 位（显示才舍入，比较用全精度）
 * P2 将扩展为完整口径引擎；本文件足以支撑种子验收与状态页。
 */
import type { Category, Person, SeedEvent, Stage } from '../domain/types';

export interface PoolFlow {
  entered: number;
  exited: number; // 前向转出（不含流失）
  lost: number;
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

export interface Folded {
  stocks: Record<Stage, number>;
  poolFlow: Record<'lead' | 'intent' | 'sample' | 'signed' | 'deal', PoolFlow> & { lostTotal: number };
  /** 池 × 月（ym → flow） */
  monthlyPoolFlow: Record<string, Record<'lead' | 'intent' | 'sample' | 'signed', PoolFlow>>;
  cumRevenue: number;
  monthRevenue: number; // 锚点当月
  revenueByMonth: Record<string, number>;
  totalDealCnt: number; // 成交总客户数（去重）
  repeatOrderCnt: number;
  repeatCustCnt: number;
  cumGrossProfit: number;
  totalLaborCost: number;
  teamLaborRoi: number | null;
  perOwner: Record<string, OwnerAgg>;
  perOwnerLaborCost: Record<string, number>;
  perOwnerRoi: Record<string, number | null>;
  lossReasonByMonth: Record<string, Record<string, number>>;
  monthlyLossTotal: Record<string, number>;
  eventCount: number;
}

const POOLS: ('lead' | 'intent' | 'sample' | 'signed')[] = ['lead', 'intent', 'sample', 'signed'];

function emptyStocks(): Record<Stage, number> {
  return { lead: 0, intent: 0, sample: 0, signed: 0, deal: 0, lost: 0 };
}

function daysInCalendarMonth(ym: string): number {
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

/** 人力成本逐日累计（开通日/入职日孰晚起算，至 asOf 当日止） */
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

export function foldEvents(
  events: SeedEvent[],
  people: Person[],
  categories: Category[],
  asOfDate: string,
  openDate: string,
): Folded {
  const marginOf = new Map(categories.map((c) => [c.code, c.marginRate]));
  const stage = new Map<string, Stage>();
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
  const lossReasonByMonth: Record<string, Record<string, number>> = {};
  const monthlyLossTotal: Record<string, number> = {};
  const perOwner: Record<string, OwnerAgg> = {};
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
    oa.lastEventDate = oa.lastEventDate && oa.lastEventDate > e.date ? oa.lastEventDate : e.date;

    if (e.type === 'customer_created') {
      stage.set(e.customerId, 'lead');
      stocks.lead++;
      poolFlow.lead.entered++;
      mpf(ym).lead.entered++;
      oa.leads++;
      oa.stocks.lead++;
    } else if (e.type === 'stage_changed') {
      const from = e.from as Stage;
      const to = e.to as Stage;
      if (stage.get(e.customerId) !== from) {
        throw new Error(`事件流不一致：${e.customerId} 当前 ${stage.get(e.customerId)}，事件却从 ${from} 流转`);
      }
      stage.set(e.customerId, to);
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
        if (to === 'sample') oa.sampleIn++;
      }
      if (to === 'deal') {
        poolFlow.deal.entered++;
        dealCustomers.add(e.customerId);
        oa.firstDeals++;
      }
    } else if (e.type === 'order_created') {
      const amt = e.amount ?? 0;
      cumRevenue += amt;
      revenueByMonth[ym] = (revenueByMonth[ym] ?? 0) + amt;
      const gp = amt * (marginOf.get(e.categoryCode ?? '') ?? 0);
      cumGrossProfit += gp;
      oa.revenue += amt;
      oa.grossProfit += gp;
      dealCustomers.add(e.customerId);
      if (e.isRepeat) {
        repeatOrderCnt++;
        repeatCustomers.add(e.customerId);
      }
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
    totalDealCnt: dealCustomers.size,
    repeatOrderCnt,
    repeatCustCnt: repeatCustomers.size,
    cumGrossProfit,
    totalLaborCost,
    teamLaborRoi,
    perOwner,
    perOwnerLaborCost,
    perOwnerRoi,
    lossReasonByMonth,
    monthlyLossTotal,
    eventCount,
  };
}
