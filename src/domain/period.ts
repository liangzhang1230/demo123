/**
 * 周期与自然日工具 · 口径来源＝v1.0
 *  - §6.7 目标分解引擎：目标仅拆年、月、日；单日目标恒＝当月月度目标÷当月自然天数；
 *    目标拆解和考核均用自然日（不扣休息日）。
 *  - §6.5 环比：固定仅自然月，完整自然月 vs 完整自然月，残缺周期不计算环比。
 *  - R2-01 在职天数：自然日口径，入职当日计第 1 天，在职天数＝计算日−入职日＋1。
 * 全部日期为 YYYY-MM-DD 字符串（账务日＝租户时区自然日，演示版单时区）。
 */

export function ymOf(date: string): string {
  return date.slice(0, 7);
}

/** 当月自然天数 */
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

export function monthStart(ym: string): string {
  return `${ym}-01`;
}

export function monthEnd(ym: string): string {
  return `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
}

/** b − a 的自然日差（同日＝0） */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

export function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** R2-01：在职天数＝计算日−入职日＋1（自然日，含首尾） */
export function tenureDays(hireDate: string, asOf: string): number {
  return diffDays(hireDate, asOf) + 1;
}

/**
 * §6.5 完整自然月判定：整月落在 [openDate, asOf] 闭区间内（开通/入职残月与进行中当月均为残缺周期）。
 */
export function isCompleteMonth(ym: string, openDate: string, asOf: string): boolean {
  return monthStart(ym) >= openDate ? monthEnd(ym) <= asOf && monthStart(ym) >= openDate : false;
}

/** 截至 asOf 的最近一个完整自然月（无则 null） */
export function lastCompleteMonth(openDate: string, asOf: string): string | null {
  let ym = ymOf(asOf);
  if (monthEnd(ym) > asOf) ym = prevYm(ym); // 进行中当月为残缺周期
  return isCompleteMonth(ym, openDate, asOf) ? ym : null;
}

/** [from,to] 与自然月 ym 的交集天数（无交集＝0） */
export function daysInMonthOverlap(ym: string, from: string, to: string): number {
  const a = from > monthStart(ym) ? from : monthStart(ym);
  const b = to < monthEnd(ym) ? to : monthEnd(ym);
  return a > b ? 0 : diffDays(a, b) + 1;
}
