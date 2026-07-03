/**
 * 达标率与七级判定 · 口径来源＝v1.0 §6.7 达标率 ＋ §6.8 七级考核等级 ＋ 目标分解引擎【盲审定案】
 *
 *  - 绝对达标率 abs_rate ＝ 周期实际值 ÷ 周期目标值；
 *  - 进度达成率 pace_rate ＝ 周期实际值 ÷ 应完成量；应完成量 ＝ 周期目标 ×（已过天数 ÷ 周期总天数）；
 *  - 目标为 0 或未设 → null（显示 —，不参与等级判定）；
 *  - 【全局裁决·盲审定案】比率类（转化率、成交率、labor_roi）目标仅支持月/年 abs_rate，
 *    不拆单日目标、不计算 pace_rate（比率不随天数线性累积），对应格返回 null 显 —；
 *  - 单日目标恒＝当月月度目标÷当月自然天数（原「年度目标÷年度自然天数」公式废止，唯一单日口径仅此一条）；
 *  - 七级判定区间左闭右开、自上而下首次命中即停（R2-04 六条边界，基数 1.0 固定）。
 */
import { daysInMonth, daysInMonthOverlap, monthEnd, monthStart } from './period';

/** 比率类考核项（不拆日、无 pace_rate） */
export const RATIO_METRICS: ReadonlySet<string> = new Set([
  'lead_conv',
  'intent_conv',
  'sample_conv',
  'signed_conv',
  'close_rate',
  'labor_roi',
]);

export function isRatioMetric(code: string): boolean {
  return RATIO_METRICS.has(code);
}

/** abs_rate＝实际÷目标；目标 0/未设 → null 显 —（不参与等级判定） */
export function absRate(actual: number, target: number | null | undefined): number | null {
  return target != null && target > 0 ? actual / target : null;
}

/**
 * pace_rate＝实际÷应完成量；应完成量＝周期目标×(已过天数÷周期总天数)。
 * 比率类返回 null（显 —）；目标 0/未设或已过天数 ≤0 亦返回 null。
 */
export function paceRate(
  actual: number,
  target: number | null | undefined,
  elapsedDays: number,
  totalDays: number,
  metricCode?: string,
): number | null {
  if (metricCode && isRatioMetric(metricCode)) return null;
  if (target == null || target <= 0 || totalDays <= 0 || elapsedDays <= 0) return null;
  const expected = target * (elapsedDays / totalDays);
  return expected > 0 ? actual / expected : null;
}

/** 单日目标恒＝当月月度目标÷当月自然天数（自然日口径，不扣休息日；比率类不拆日→ null） */
export function dailyTarget(monthlyTarget: number | null | undefined, ym: string, metricCode?: string): number | null {
  if (metricCode && isRatioMetric(metricCode)) return null;
  if (monthlyTarget == null || monthlyTarget <= 0) return null;
  return monthlyTarget / daysInMonth(ym);
}

/**
 * §6.7.1 人员折算（单公式统一全场景）：个人周期目标＝个人日应完成目标值×周期内有效在职天数。
 * 月周期：折算月目标＝(月度目标÷当月自然天数)×当月在职交集天数（入职当天计入考核）。
 */
export function proratedMonthlyTarget(
  monthlyTarget: number | null | undefined,
  ym: string,
  hireDate: string | null,
  leaveDate: string | null = null,
): number | null {
  if (monthlyTarget == null || monthlyTarget <= 0) return null;
  const from = hireDate && hireDate > monthStart(ym) ? hireDate : monthStart(ym);
  const to = leaveDate && leaveDate < monthEnd(ym) ? leaveDate : monthEnd(ym);
  const days = daysInMonthOverlap(ym, from, to);
  if (days <= 0) return null; // 周期内无在职天数：不生成目标
  return (monthlyTarget / daysInMonth(ym)) * days;
}

/** 七级考核等级（§6.8，默认参数；左闭右开、自上而下首次命中即停） */
export interface Grade {
  code: 'leading' | 'excellent' | 'good' | 'pass' | 'yellow' | 'orange' | 'red';
  label: string;
  color: string;
  /** 判定下界（含）；上界＝上一级下界（不含）；红警区间＝[0,橙警阈值) */
  min: number;
}

export const GRADES: readonly Grade[] = [
  { code: 'leading', label: '领先', color: 'purple', min: 2.0 },
  { code: 'excellent', label: '优秀', color: 'blue', min: 1.5 },
  { code: 'good', label: '良好', color: 'green', min: 1.2 },
  { code: 'pass', label: '合格', color: 'white', min: 1.0 },
  { code: 'yellow', label: '黄色预警', color: 'yellow', min: 0.8 },
  { code: 'orange', label: '橙色预警', color: 'orange', min: 0.6 },
  { code: 'red', label: '红色预警', color: 'red', min: 0 },
] as const;

/**
 * 七级判定：rate＝达标率（abs_rate 或 pace_rate，全精度）。
 * null（目标未设/分母 0/比率类 pace）→ null 不参与等级判定；
 * 负值（净利类实际为负）落入红色预警（区间 [0,60%) 的下溢一并归红，永不显示怪值）。
 */
export function gradeOf(rate: number | null | undefined): Grade | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  for (const g of GRADES) {
    if (rate >= g.min) return g;
  }
  return GRADES[GRADES.length - 1]; // rate < 0 → 红色预警
}
