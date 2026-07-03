/**
 * 人力成本逐日累计模型 · 口径来源＝v1.0 第三部分 §8.1 ＋ §6.4
 *  - 仅计算租户开通日及以后的人力成本；
 *  - 每日成本＝当日月固定项日摊（底薪＋社保）＋当日招培（入职当日一次性）＋当日提成/奖金/报销（演示版无变动项）；
 *  - 月固定项日摊＝月额÷当月自然天数；
 *  - 累计成本＝Σ(入职日至今每日成本)；离职即停止计提（演示版全员在职）。
 */
import type { Person } from './types';
import { daysInMonth, daysInMonthOverlap, ymOf } from './period';

/** 成本起算日＝入职日与开通日孰晚（历史基线不入逐日模型） */
export function costStartDate(p: Person, openDate: string): string {
  return p.hireDate && p.hireDate > openDate ? p.hireDate : openDate;
}

/** 某日成本（月固定项日摊＋入职当日招培一次性） */
export function dayCost(p: Person, openDate: string, date: string): number {
  if (date < costStartDate(p, openDate)) return 0;
  let c = p.monthlyCost / daysInMonth(ymOf(date));
  if (p.hireDate && p.hireDate >= openDate && date === p.hireDate) c += p.onboardingCost;
  return c;
}

/** [from,to] 闭区间人力成本（逐月按日摊求和，避免逐日循环误差） */
export function laborCostRange(p: Person, openDate: string, from: string, to: string): number {
  const start = costStartDate(p, openDate);
  const a = from > start ? from : start;
  if (a > to) return 0;
  let cost = 0;
  for (let ym = ymOf(a); ym <= ymOf(to); ym = nextYm(ym)) {
    cost += (p.monthlyCost / daysInMonth(ym)) * daysInMonthOverlap(ym, a, to);
  }
  if (p.hireDate && p.hireDate >= openDate && p.hireDate >= a && p.hireDate <= to) cost += p.onboardingCost;
  return cost;
}

/** 累计成本＝起算日至 asOf */
export function cumLaborCost(p: Person, openDate: string, asOf: string): number {
  return laborCostRange(p, openDate, openDate, asOf);
}

/** 某自然月成本（月内截至 asOf；用于月净利/月环比） */
export function monthLaborCost(p: Person, openDate: string, ym: string, asOf: string): number {
  const end = asOf < `${ym}-31` ? asOf : `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
  if (ymOf(end) < ym) return 0;
  return laborCostRange(p, openDate, `${ym}-01`, end);
}

/**
 * labor_roi ＝ 累计净利润 ÷ 累计成本（§6.4）；成本为 0 → null，显示「—（未设成本）」、不参与排名。
 * 累计净利润＝累计毛利额−累计成本。
 */
export function laborRoi(grossProfit: number, cost: number): number | null {
  return cost > 0 ? (grossProfit - cost) / cost : null;
}

/**
 * 部门/公司 labor_roi ＝ 分子分母各自先汇总再相除（§6.6，严禁对个人比值求平均——辛普森悖论防线）。
 * 部门人均 labor_roi ＝ 部门 labor_roi 本身（Σ净利÷Σ成本）。
 */
export function groupLaborRoi(parts: { grossProfit: number; cost: number }[]): number | null {
  let gp = 0;
  let cost = 0;
  for (const x of parts) {
    gp += x.grossProfit;
    cost += x.cost;
  }
  return laborRoi(gp, cost);
}

function nextYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
