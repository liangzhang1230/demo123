/**
 * 口径引擎 · 纯函数层（P2）
 * 唯一事实源＝《规格说明 v1.0》，逐条对应：
 *  - §6.8 七级考核等级（左闭右开，自上而下首次命中即停）
 *  - §6.7 达标率 abs_rate / pace_rate ＋ 目标分解引擎（单日目标＝月度目标÷当月自然天数；
 *    比率类目标不拆日、不算 pace_rate，对应格显 —【盲审定案】）
 *  - §6.10 兜底：分母 0/负显 —；金额 2 位、比率 1 位百分比、labor_roi 2 位；比较全精度、显示才舍入
 *  - §6.10 排名并列：全精度仍相等则并列跳号（1、1、3），次序按事件发生时间早者前
 *  - §6.5 环比：仅完整自然月，(本期−上期)÷上期；上期 ≤0 显 —
 *  - §8 停滞预警：停留天数＝当日−进入日（进入当日记 0，左闭）；三级 ≥1.0×黄 / ≥1.5×橙 / ≥2.5×红；
 *    阈值取行业模板「通用」列：线索 15 / 意向 30 / 样品 20 / 签约未回款 7
 */

export const DASH = '—';

// ---------------- §6.8 七级考核等级 ----------------

export type LevelKey = 'lead' | 'excellent' | 'good' | 'pass' | 'yellow' | 'orange' | 'red';

export interface SevenLevel {
  key: LevelKey;
  name: string;
  color: '紫' | '蓝' | '绿' | '白' | '黄' | '橙' | '红';
}

/** 左闭右开，自上而下首次命中即停（rate＝达标率，1.0＝100%）；null（目标未设/分母 0）→ null 显 — */
export function sevenLevel(rate: number | null): SevenLevel | null {
  if (rate == null || !isFinite(rate) || rate < 0) return null;
  if (rate >= 2.0) return { key: 'lead', name: '领先', color: '紫' };
  if (rate >= 1.5) return { key: 'excellent', name: '优秀', color: '蓝' };
  if (rate >= 1.2) return { key: 'good', name: '良好', color: '绿' };
  if (rate >= 1.0) return { key: 'pass', name: '合格', color: '白' };
  if (rate >= 0.8) return { key: 'yellow', name: '黄色预警', color: '黄' };
  if (rate >= 0.6) return { key: 'orange', name: '橙色预警', color: '橙' };
  return { key: 'red', name: '红色预警', color: '红' };
}

// ---------------- §6.7 达标率与目标分解 ----------------

/** 绝对达标率＝周期实际值÷周期目标值；目标为 0 或未设 → null（显 —，不参与等级判定） */
export function absRate(actual: number, target: number | null | undefined): number | null {
  if (target == null || target <= 0) return null;
  return actual / target;
}

/**
 * 进度达成率＝周期实际值÷应完成量；应完成量＝周期目标×(已过天数÷周期总天数)。
 * 比率类指标（转化率/成交率/labor_roi）不拆日、不算 pace —— 调用方须传 isRatio=true，恒返回 null。
 */
export function paceRate(
  actual: number,
  target: number | null | undefined,
  elapsedDays: number,
  totalDays: number,
  isRatio = false,
): number | null {
  if (isRatio) return null; // 【盲审定案】比率类不拆日，页面对应格显 —
  if (target == null || target <= 0 || totalDays <= 0 || elapsedDays <= 0) return null;
  const due = target * (elapsedDays / totalDays);
  if (due <= 0) return null;
  return actual / due;
}

/** 单日目标恒＝当月月度目标÷当月自然天数（唯一单日口径） */
export function dailyTarget(monthlyTarget: number | null | undefined, ym: string): number | null {
  if (monthlyTarget == null || monthlyTarget <= 0) return null;
  return monthlyTarget / daysInMonth(ym);
}

// ---------------- §6.10 排名（并列跳号） ----------------

export interface RankInput {
  id: string;
  /** 全精度比较值 */
  value: number;
  /** 并列时次序：事件发生时间早者前（传该值达成时点的序号/时间，越小越早） */
  tieTime?: number;
}

export interface RankRow extends RankInput {
  rank: number;
}

/** 值降序；全精度仍相等 → 并列同名次、后续跳号（1、1、3）；并列内部按 tieTime 升序 */
export function rankJump(items: RankInput[]): RankRow[] {
  const sorted = [...items].sort(
    (a, b) => b.value - a.value || (a.tieTime ?? Infinity) - (b.tieTime ?? Infinity),
  );
  const rows: RankRow[] = [];
  sorted.forEach((it, i) => {
    const rank = i > 0 && it.value === sorted[i - 1].value ? rows[i - 1].rank : i + 1;
    rows.push({ ...it, rank });
  });
  return rows;
}

// ---------------- §6.5 环比（仅完整自然月） ----------------

/** 环比增长率＝(本期−上期)÷上期；上期 ≤0 → null（显 —「上期无基数」） */
export function momRate(prev: number, cur: number): number | null {
  if (!(prev > 0)) return null;
  return (cur - prev) / prev;
}

/**
 * 返回锚点日所在语境下最近一对「已结束的完整自然月」[上期, 本期]；
 * 残缺周期（锚点当月未结束）不计算环比（§6.5）。
 */
export function completedMonthPair(asOf: string): [string, string] {
  const [y, m] = asOf.slice(0, 7).split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1 - 1, 1)); // 上一个月＝最近完整月
  const prev = new Date(Date.UTC(y, m - 1 - 2, 1));
  const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return [ym(prev), ym(cur)];
}

// ---------------- §8 停滞预警（三级 · 通用列阈值） ----------------

export type MonitoredStage = 'lead' | 'intent' | 'sample' | 'signed';

/** 行业模板「通用」列（§8.3.1）：线索 15 / 意向 30 / 样品 20 / 签约未回款 7 */
export const STALL_THRESHOLDS: Record<MonitoredStage, number> = {
  lead: 15,
  intent: 30,
  sample: 20,
  signed: 7,
};

/** 停留天数＝当日−进入当前状态事件日（自然日，进入当日记 0） */
export function stayDays(entryDate: string, asOf: string): number {
  return Math.max(0, Math.round((Date.parse(asOf) - Date.parse(entryDate)) / 86400000));
}

export type StallLevel = 'dying' | 'warning' | 'watch';

export const STALL_LEVEL_LABEL: Record<StallLevel, { name: string; color: '红' | '橙' | '黄' }> = {
  dying: { name: '濒死', color: '红' },
  warning: { name: '预警', color: '橙' },
  watch: { name: '关注', color: '黄' },
};

/** 三级判定（左闭，自上而下首次命中即停）：≥2.5× 濒死红、≥1.5× 预警橙、≥1.0× 关注黄；倍数为系统常量 */
export function stallLevel(stage: MonitoredStage, days: number): StallLevel | null {
  const t = STALL_THRESHOLDS[stage];
  if (days >= 2.5 * t) return 'dying';
  if (days >= 1.5 * t) return 'warning';
  if (days >= 1.0 * t) return 'watch';
  return null;
}

// ---------------- 日期与精度工具 ----------------

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** R2-01 在职天数：入职当日计第 1 天，含周末节假日＝计算日−入职日＋1 */
export function tenureDays(hireDate: string, asOf: string): number {
  return Math.round((Date.parse(asOf) - Date.parse(hireDate)) / 86400000) + 1;
}

// —— 显示格式（§6.10 精度：金额 2 位、比率 1 位百分比、labor_roi 2 位；显示才舍入）——

export function fmtYuan(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return DASH;
  return `¥${n.toLocaleString('zh-CN')}`;
}

/** 大额白话：¥61.2万 */
export function fmtWan(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return DASH;
  if (Math.abs(n) < 10000) return `¥${Math.round(n).toLocaleString('zh-CN')}`;
  return `¥${(n / 10000).toFixed(1)}万`;
}

export function fmtPct1(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return DASH;
  return `${(x * 100).toFixed(1)}%`;
}

/** 达标率整数百分比白话（进度 108%） */
export function fmtPct0(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return DASH;
  return `${Math.round(x * 100)}%`;
}

export function fmtRoi2(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return DASH;
  return x.toFixed(2);
}

export function fmtSignedPct1(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return DASH;
  const v = (x * 100).toFixed(1);
  return x >= 0 ? `+${v}%` : `${v}%`;
}

/** 榜单脱敏（拍板⑤）：金额类他人只显名次——姓名脱敏用于查重拦截归属展示 */
export function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

/** 手机号脱敏：138****8000 */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}
