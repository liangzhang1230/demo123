/**
 * 七级等级角标：达标率 → 等级名＋色（§6.8 默认参数直读 domain/levels）。
 * rate 为 null（目标未设/比率类不拆日）→ 显 —（§6.7 兜底）。
 * 精度：比率 1 位小数百分比（§6.10，显示才舍入）。
 */
import type { GradeColor } from '../domain/levels';
import { gradeOf } from '../domain/levels';

export const GRADE_COLOR_CLS: Record<GradeColor, string> = {
  紫: 'bg-purple-100 text-purple-700 border-purple-300',
  蓝: 'bg-blue-100 text-blue-700 border-blue-300',
  绿: 'bg-green-100 text-green-700 border-green-300',
  白: 'bg-white text-gray-600 border-gray-300',
  黄: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  橙: 'bg-orange-100 text-orange-700 border-orange-300',
  红: 'bg-red-100 text-red-700 border-red-300',
};

export const GRADE_BAR_CLS: Record<GradeColor, string> = {
  紫: 'bg-purple-500',
  蓝: 'bg-blue-500',
  绿: 'bg-green-500',
  白: 'bg-gray-400',
  黄: 'bg-yellow-400',
  橙: 'bg-orange-500',
  红: 'bg-red-500',
};

export default function GradeBadge({ rate }: { rate: number | null }) {
  const grade = gradeOf(rate);
  if (rate == null || !grade) {
    return <span className="inline-block rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-400">—</span>;
  }
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${GRADE_COLOR_CLS[grade.color]}`}>
      {grade.name} {(rate * 100).toFixed(1)}%
    </span>
  );
}
