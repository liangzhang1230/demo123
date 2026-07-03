/**
 * 展示精度与兜底 · 口径来源＝v1.0 §6.10 全字典兜底规则
 *  - 分母为 0/负一律显示 —，永不显示 ∞、NaN、负百分比怪值；
 *  - 精度：金额 2 位小数、比率 1 位小数百分比、labor_roi 2 位小数；
 *  - 排名比较用全精度，显示才舍入（本文件只管显示，一切比较在 rank.ts 用原值）。
 */

export const DASH = '—';

/** 金额 2 位小数（千分位） */
export function fmtAmount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 金额整数展示（看板大数用，仍由全精度值舍入而来） */
export function fmtAmount0(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `¥${Math.round(v).toLocaleString('zh-CN')}`;
}

/** 比率 1 位小数百分比；null（分母 0/负、目标未设、比率类 pace）显示 — */
export function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `${(v * 100).toFixed(1)}%`;
}

/** labor_roi 2 位小数；成本为 0 显示「—（未设成本）」由调用方携带原因，本函数只显 — */
export function fmtRoi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return v.toFixed(2);
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return String(Math.round(v));
}
