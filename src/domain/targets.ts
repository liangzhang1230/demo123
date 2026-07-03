/**
 * 达标率与目标分解 · 唯一事实源＝v1.0 §6.7
 *  - 绝对达标率 abs_rate ＝ 周期实际值 ÷ 周期目标值
 *  - 进度达成率 pace_rate ＝ 周期实际值 ÷ 应完成量；应完成量＝周期目标×（已过天数÷周期总天数）
 *  - 单日目标恒＝当月月度目标÷当月自然天数（【盲审定案】唯一单日口径）
 *  - 目标为 0 或未设 → 返回 null 显 —，不参与等级判定
 *  - 比率类（转化率、成交率等）目标仅支持 abs_rate，不拆单日、不计算 pace_rate（【盲审定案】），
 *    对应函数一律返回 null 显 —
 */
import { dayOfMonth, daysInMonth } from './calendar';

export function absRate(actual: number, target: number | null | undefined): number | null {
  if (target == null || target <= 0) return null;
  return actual / target;
}

/** 单日目标＝当月月度目标÷当月自然天数；月目标未设 → null */
export function dailyTarget(monthlyTarget: number | null | undefined, ym: string): number | null {
  if (monthlyTarget == null || monthlyTarget <= 0) return null;
  return monthlyTarget / daysInMonth(ym);
}

/**
 * 月度 pace_rate。isRatioMetric＝true（比率类）恒返回 null（不拆日，页面显 —）。
 * 已过天数＝asOfDate 在当月的日序（当日生成完整单日目标，故计入当天）。
 */
export function paceRate(
  actual: number,
  monthlyTarget: number | null | undefined,
  asOfDate: string,
  isRatioMetric = false,
): number | null {
  if (isRatioMetric) return null;
  if (monthlyTarget == null || monthlyTarget <= 0) return null;
  const ym = asOfDate.slice(0, 7);
  const due = monthlyTarget * (dayOfMonth(asOfDate) / daysInMonth(ym));
  if (due <= 0) return null;
  return actual / due;
}
