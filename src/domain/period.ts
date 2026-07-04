/**
 * P10 · 周期折算层（日/周/月/年，纯读侧事件扫描，零新增落库）。
 * 口径对齐：周期物理隔离（§6.3）；周＝ISO 周一制【盲审定案】；账务日＝自然日；
 * 环比：月＝完整自然月对（§6.5 规格口径）；日/周＝较上一同长窗口（演示口径，页面标注）；
 * 年＝上一年无数据 → null 显 —。目标分解（§6.7）：日＝月目标÷当月自然天数；
 * 周不设独立目标（规格：周只汇总，不拆周指标）→ pace 显 —；年＝月目标×12。
 */
import type { Person, SeedData, Stage } from './types';
import { addDays, daysInMonth } from './engine';
import { laborCostOf } from '../seed/fold';

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export const PERIOD_LABEL: Record<PeriodKind, string> = { day: '日', week: '周', month: '月', year: '年' };

export interface PeriodRange {
  kind: PeriodKind;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** 展示：本期/上期名称 */
  label: string;
  prevLabel: string;
  /** 目标换算系数：月目标 × factor ＝ 本期目标；null ＝ 本期不设目标（周） */
  targetFactor: number | null;
  /** pace 用：已过天数 / 周期总天数 */
  elapsed: number;
  totalDays: number;
}

function isoWeekMonday(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  return addDays(date, -dow);
}

export function periodRange(asOf: string, kind: PeriodKind): PeriodRange {
  const ym = asOf.slice(0, 7);
  const dim = daysInMonth(ym);
  if (kind === 'day') {
    return {
      kind, from: asOf, to: asOf, prevFrom: addDays(asOf, -1), prevTo: addDays(asOf, -1),
      label: '今日', prevLabel: '较昨日', targetFactor: 1 / dim, elapsed: 1, totalDays: 1,
    };
  }
  if (kind === 'week') {
    const mon = isoWeekMonday(asOf);
    return {
      kind, from: mon, to: asOf, prevFrom: addDays(mon, -7), prevTo: addDays(mon, -1),
      label: '本周', prevLabel: '较上周',
      targetFactor: null, // 周不设独立目标（规格）
      elapsed: Math.round((Date.parse(asOf) - Date.parse(mon)) / 86400000) + 1, totalDays: 7,
    };
  }
  if (kind === 'year') {
    const y = asOf.slice(0, 4);
    const dayOfYear = Math.round((Date.parse(asOf) - Date.parse(`${y}-01-01`)) / 86400000) + 1;
    return {
      kind, from: `${y}-01-01`, to: asOf, prevFrom: `${Number(y) - 1}-01-01`, prevTo: `${Number(y) - 1}-12-31`,
      label: '本年', prevLabel: '较去年', targetFactor: 12, elapsed: dayOfYear, totalDays: 365,
    };
  }
  // month
  const first = `${ym}-01`;
  const prevYmDate = addDays(first, -1);
  const prevYm = prevYmDate.slice(0, 7);
  return {
    kind, from: first, to: asOf, prevFrom: `${prevYm}-01`, prevTo: prevYmDate,
    label: '本月', prevLabel: `完整月环比 ${Number(ym.slice(5, 7))}月 vs ${Number(prevYm.slice(5, 7))}月`,
    targetFactor: 1, elapsed: Number(asOf.slice(8, 10)), totalDays: dim,
  };
}

export interface PoolPeriodFlow { entered: number; exited: number; lost: number }

export interface PeriodOwner {
  revenue: number;
  gross: number;
  firstDeals: number;
  repeatOrders: number;
  repeatCusts: number;
  lastOrderSeq: number;
  process: { lead: number; intent: number; sample: number; signed: number };
}

export interface PeriodMetrics {
  range: PeriodRange;
  perOwner: Record<string, PeriodOwner>;
  /** 上一同长窗口的 per-owner 回款（升降箭头/环比用） */
  prevPerOwnerRevenue: Record<string, number>;
  revenue: number;
  gross: number;
  laborCost: number;
  net: number;
  firstDeals: number;
  repeatOrders: number;
  repeatCusts: number;
  lossTotal: number;
  lossReasons: Record<string, number>;
  flows: Record<'lead' | 'intent' | 'sample' | 'signed', PoolPeriodFlow>;
  prev: { revenue: number; gross: number; laborCost: number; net: number; firstDeals: number; repeatOrders: number; lossTotal: number };
  /** 较上期比率（上期 ≤0 → null 显 —） */
  revenueDelta: number | null;
  netDelta: number | null;
  dealsDelta: number | null;
}

const POOLS = ['lead', 'intent', 'sample', 'signed'] as const;

function ratio(prev: number, cur: number): number | null {
  return prev > 0 ? (cur - prev) / prev : null;
}

/** 周期指标折算（ownerIds 为空＝全员；账务日窗口 [from, to]） */
export function computePeriod(
  data: SeedData, asOf: string, kind: PeriodKind, people: Person[], ownerIds?: Set<string>,
): PeriodMetrics {
  const range = periodRange(asOf, kind);
  const inScope = (id: string) => !ownerIds || ownerIds.has(id);
  const marginOf = new Map(data.categories.map((c) => [c.code, c.marginRate]));

  const perOwner: Record<string, PeriodOwner> = {};
  const prevPerOwnerRevenue: Record<string, number> = {};
  const own = (id: string): PeriodOwner => {
    if (!perOwner[id]) {
      perOwner[id] = {
        revenue: 0, gross: 0, firstDeals: 0, repeatOrders: 0, repeatCusts: 0, lastOrderSeq: 0,
        process: { lead: 0, intent: 0, sample: 0, signed: 0 },
      };
    }
    return perOwner[id];
  };
  for (const p of people) if (p.role !== 'boss' && inScope(p.id)) own(p.id);

  const flows: PeriodMetrics['flows'] = {
    lead: { entered: 0, exited: 0, lost: 0 }, intent: { entered: 0, exited: 0, lost: 0 },
    sample: { entered: 0, exited: 0, lost: 0 }, signed: { entered: 0, exited: 0, lost: 0 },
  };
  const lossReasons: Record<string, number> = {};
  const repeatCustSets = new Map<string, Set<string>>();
  const companyRepeat = new Set<string>();
  let lossTotal = 0;
  const prev = { revenue: 0, gross: 0, laborCost: 0, net: 0, firstDeals: 0, repeatOrders: 0, lossTotal: 0 };

  for (const e of data.events) {
    if (!inScope(e.ownerId)) continue;
    const inCur = e.date >= range.from && e.date <= range.to;
    const inPrev = e.date >= range.prevFrom && e.date <= range.prevTo;
    if (!inCur && !inPrev) continue;

    if (e.type === 'customer_created') {
      if (inCur) { own(e.ownerId).process.lead++; flows.lead.entered++; }
    } else if (e.type === 'stage_changed') {
      const from = e.from as Stage;
      const to = e.to as Stage;
      if (inCur) {
        if ((POOLS as readonly string[]).includes(from)) {
          if (to === 'lost') {
            flows[from as (typeof POOLS)[number]].lost++;
            lossTotal++;
            lossReasons[e.lossReason ?? '未填'] = (lossReasons[e.lossReason ?? '未填'] ?? 0) + 1;
          } else {
            flows[from as (typeof POOLS)[number]].exited++;
          }
        }
        if (to === 'intent') { own(e.ownerId).process.intent++; flows.intent.entered++; }
        if (to === 'sample') { own(e.ownerId).process.sample++; flows.sample.entered++; }
        if (to === 'signed') { own(e.ownerId).process.signed++; flows.signed.entered++; }
        if (to === 'deal') own(e.ownerId).firstDeals++;
      } else if (inPrev) {
        if (to === 'deal') prev.firstDeals++;
        if (to === 'lost') prev.lossTotal++;
      }
    } else if (e.type === 'order_created') {
      const amt = e.amount ?? 0;
      const gp = amt * (marginOf.get(e.categoryCode ?? '') ?? 0);
      if (inCur) {
        const o = own(e.ownerId);
        o.revenue += amt;
        o.gross += gp;
        o.lastOrderSeq = e.seq;
        if (e.isRepeat) {
          o.repeatOrders++;
          if (!repeatCustSets.has(e.ownerId)) repeatCustSets.set(e.ownerId, new Set());
          repeatCustSets.get(e.ownerId)!.add(e.customerId);
          companyRepeat.add(e.customerId);
        }
      } else if (inPrev) {
        prev.revenue += amt;
        prev.gross += gp;
        if (e.isRepeat) prev.repeatOrders++;
        prevPerOwnerRevenue[e.ownerId] = (prevPerOwnerRevenue[e.ownerId] ?? 0) + amt;
      }
    }
  }

  for (const [id, set] of repeatCustSets) perOwner[id].repeatCusts = set.size;

  // 人力成本区间＝累计函数差分（口径 §8.1 逐日累计，含入职一次性）
  const scopedPeople = people.filter((p) => inScope(p.id));
  const costTo = (d: string) => scopedPeople.reduce((a, p) => a + laborCostOf(p, data.openDate, d), 0);
  const laborCost = Math.max(0, costTo(range.to) - costTo(addDays(range.from, -1)));
  const prevLabor = Math.max(0, costTo(range.prevTo) - costTo(addDays(range.prevFrom, -1)));
  prev.laborCost = prevLabor;
  prev.net = prev.gross - prevLabor;

  const revenue = Object.values(perOwner).reduce((a, o) => a + o.revenue, 0);
  const gross = Object.values(perOwner).reduce((a, o) => a + o.gross, 0);
  const firstDeals = Object.values(perOwner).reduce((a, o) => a + o.firstDeals, 0);
  const repeatOrders = Object.values(perOwner).reduce((a, o) => a + o.repeatOrders, 0);
  const net = gross - laborCost;

  return {
    range, perOwner, prevPerOwnerRevenue,
    revenue, gross, laborCost, net, firstDeals, repeatOrders,
    repeatCusts: companyRepeat.size,
    lossTotal, lossReasons, flows, prev,
    revenueDelta: ratio(prev.revenue, revenue),
    netDelta: prev.net > 0 ? (net - prev.net) / prev.net : null,
    dealsDelta: ratio(prev.firstDeals, firstDeals),
  };
}
