/**
 * 七级考核等级 · 唯一事实源＝v1.0 §6.8（参数化，演示取默认参数）
 * 判定区间左闭右开、自上而下首次命中即停：
 *   领先 ≥200% 紫｜优秀 [150%,200%) 蓝｜良好 [120%,150%) 绿｜合格 [100%,120%) 白
 *   黄色预警 [80%,100%) 黄｜橙色预警 [60%,80%) 橙｜红色预警 [0,60%) 红
 * 达标率为 null（目标为 0/未设、比率类不拆日）→ 不参与等级判定，返回 null 显 —。
 */

export type GradeColor = '紫' | '蓝' | '绿' | '白' | '黄' | '橙' | '红';

export interface Grade {
  name: string;
  color: GradeColor;
  /** 区间下界（左闭） */
  min: number;
}

/** 自上而下（区间上界＝上一行下界，左闭右开） */
export const GRADE_BANDS: Grade[] = [
  { name: '领先', color: '紫', min: 2.0 },
  { name: '优秀', color: '蓝', min: 1.5 },
  { name: '良好', color: '绿', min: 1.2 },
  { name: '合格', color: '白', min: 1.0 },
  { name: '黄色预警', color: '黄', min: 0.8 },
  { name: '橙色预警', color: '橙', min: 0.6 },
  { name: '红色预警', color: '红', min: 0 },
];

export function gradeOf(rate: number | null | undefined): Grade | null {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
  for (const band of GRADE_BANDS) {
    if (rate >= band.min) return band; // 首次命中即停
  }
  return null;
}
