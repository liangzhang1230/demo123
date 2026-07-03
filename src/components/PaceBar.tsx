/**
 * pace_rate 进度条（§6.7）＋ 白话副标题（销售端章区二「进度即语言」）。
 * rate 为 null（目标未设/比率类）→ 显 —。条色随七级判定（等级直读，本组件零判定口径）。
 */
import { gradeOf } from '../domain/levels';
import { GRADE_BAR_CLS } from './GradeBadge';

export default function PaceBar({ rate }: { rate: number | null }) {
  if (rate == null) {
    return <p className="text-sm text-gray-400">—（目标未设）</p>;
  }
  const grade = gradeOf(rate);
  const pct = (rate * 100).toFixed(1);
  const fill = Math.min(100, rate * 100);
  const plain = rate >= 1 ? `进度 ${pct}%，跑在日历前面` : `进度 ${pct}%，比日历慢一步，今天补一脚`;
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${grade ? GRADE_BAR_CLS[grade.color] : 'bg-gray-300'}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <p className="mt-1.5 text-sm text-gray-600">{plain}</p>
    </div>
  );
}
