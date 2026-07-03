/**
 * 口径纯函数（P2）。公式逐条照抄 v1.0：
 *  - §6.7 绝对达标率 abs_rate＝周期实际值÷周期目标值；
 *    进度达成率 pace_rate＝周期实际值÷应完成量，应完成量＝周期目标×（已过天数÷周期总天数）；
 *    目标为 0 或未设显示 —、不参与等级判定；
 *    比率类（转化率/成交率/labor_roi）目标仅支持月/年 abs_rate，不拆日、不计算 pace_rate（【盲审定案】）→ 返回 null 显 —
 *  - §6.8 七级考核等级：左闭右开、自上而下首次命中即停
 *  - §6.5 环比＝(本期−上期)÷上期×100%，固定仅完整自然月；上期 ≤0 → null 显 —
 *  - §6.10 排名并列：全精度比较，仍相等则并列跳号（1、1、3），次序按事件发生时间早者前
 *  - §6.10 精度：金额 2 位小数、比率 1 位小数百分比、labor_roi 2 位小数（显示才舍入）
 */

export const DASH = '—';

// ---------- 达标率 ----------

/** abs_rate＝实际÷目标；目标 ≤0 或未设 → null（显 —，不参与等级判定） */
export function absRate(actual: number, target: number | null | undefined): number | null {
  if (target == null || target <= 0) return null;
  return actual / target;
}

/** pace_rate＝实际÷应完成量；应完成量＝目标×(已过天数÷周期总天数)。仅非比率类指标可用。 */
export function paceRate(
  actual: number,
  target: number | null | undefined,
  elapsedDays: number,
  totalDays: number,
): number | null {
  if (target == null || target <= 0 || totalDays <= 0 || elapsedDays <= 0) return null;
  const due = target * (elapsedDays / totalDays);
  if (due <= 0) return null;
  return actual / due;
}

/** 比率类目标（转化率/成交率/labor_roi）：不拆日、不计算 pace_rate，恒 —（【盲审定案】） */
export function paceRateForRatio(): null {
  return null;
}

// ---------- 七级考核等级（§6.8） ----------

export interface Grade {
  key: 'lead' | 'excellent' | 'good' | 'pass' | 'yellow' | 'orange' | 'red';
  label: string;
  color: string; // 紫/蓝/绿/白/黄/橙/红
}

const GRADES: { min: number; g: Grade }[] = [
  { min: 2.0, g: { key: 'lead', label: '领先', color: 'purple' } },
  { min: 1.5, g: { key: 'excellent', label: '优秀', color: 'blue' } },
  { min: 1.2, g: { key: 'good', label: '良好', color: 'green' } },
  { min: 1.0, g: { key: 'pass', label: '合格', color: 'white' } },
  { min: 0.8, g: { key: 'yellow', label: '黄色预警', color: 'yellow' } },
  { min: 0.6, g: { key: 'orange', label: '橙色预警', color: 'orange' } },
  { min: 0, g: { key: 'red', label: '红色预警', color: 'red' } },
];

/** 左闭右开、自上而下首次命中即停；rate 为 null（无目标）→ null 不参与判定 */
export function gradeOf(rate: number | null): Grade | null {
  if (rate == null) return null;
  for (const { min, g } of GRADES) if (rate >= min) return g;
  return GRADES[GRADES.length - 1].g; // rate < 0 归红档（[0,60%) 下界兜底，不出怪值）
}

// ---------- 环比（§6.5） ----------

/** 环比增长率＝(本期−上期)÷上期；上期 ≤0 → null 显 —（「上期无基数」）。仅完整自然月，由调用方保证。 */
export function momRate(prev: number, cur: number): number | null {
  if (prev <= 0) return null;
  return (cur - prev) / prev;
}

/** ym 自然月在 asOf 时点是否已完整结束（残缺周期不计算环比） */
export function isCompleteMonth(ym: string, asOf: string): boolean {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${ym}-${String(lastDay).padStart(2, '0')}` <= asOf;
}

// ---------- 排名（§6.10/§6.11） ----------

export interface RankEntry<T = string> {
  id: T;
  /** 全精度比较值（降序＝第 1 名最大） */
  value: number;
  /** 并列时次序＝事件发生时间早者前（ISO 串比较） */
  tieAt?: string;
}

export interface Ranked<T = string> {
  id: T;
  value: number;
  rank: number; // 并列跳号：1、1、3
}

export function rankWithTies<T = string>(entries: RankEntry<T>[]): Ranked<T>[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value; // 全精度比较
    return (a.tieAt ?? '') < (b.tieAt ?? '') ? -1 : (a.tieAt ?? '') > (b.tieAt ?? '') ? 1 : 0;
  });
  const out: Ranked<T>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const rank = i > 0 && sorted[i].value === sorted[i - 1].value ? out[i - 1].rank : i + 1;
    out.push({ id: sorted[i].id, value: sorted[i].value, rank });
  }
  return out;
}

// ---------- 显示口径（§6.10 兜底与精度；显示才舍入） ----------

/** 金额：2 位小数（整数金额不display小数尾巴时用 fmtYuan） */
export function fmtMoney2(x: number): string {
  return `¥${x.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtYuan(x: number): string {
  return `¥${Math.round(x).toLocaleString('zh-CN')}`;
}

/** 大额展示位：¥61.2 万（投屏可读性；底层全精度） */
export function fmtWan(x: number): string {
  if (Math.abs(x) >= 10000) return `¥${(x / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万`;
  return fmtYuan(x);
}

/** 比率：1 位小数百分比；null → — */
export function fmtPct1(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  return `${(x * 100).toFixed(1)}%`;
}

/** labor_roi：2 位小数；null → —（未设成本） */
export function fmtRoi2(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return `${DASH}（未设成本）`;
  return x.toFixed(2);
}
