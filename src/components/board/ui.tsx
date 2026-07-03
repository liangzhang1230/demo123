/** 看板通用 UI 原子（纯展示，零口径） */
import type { ReactNode } from 'react';
import type { Grade } from '../../domain/metrics';
import { DASH } from '../../domain/metrics';

/** 七级颜色 → 样式（紫/蓝/绿/白/黄/橙/红，§6.8） */
const GRADE_STYLE: Record<Grade['color'], string> = {
  purple: 'bg-purple-100 text-purple-700 border-purple-300',
  blue: 'bg-blue-100 text-blue-700 border-blue-300',
  green: 'bg-green-100 text-green-700 border-green-300',
  white: 'bg-white text-gray-700 border-gray-300',
  yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  orange: 'bg-orange-100 text-orange-800 border-orange-300',
  red: 'bg-red-100 text-red-700 border-red-300',
};

export function GradeChip({ grade }: { grade: Grade | null }) {
  if (!grade) return null;
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${GRADE_STYLE[grade.color]}`}>
      {grade.label}
    </span>
  );
}

export function Section({
  id, no, title, note, children,
}: { id?: string; no: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-800">
          <span className="mr-1.5 text-[11px] font-semibold text-gray-400">{no}</span>
          {title}
        </h2>
        {note && <span className="text-[11px] text-gray-400">{note}</span>}
      </header>
      {children}
    </section>
  );
}

/** 锁标：未购显 — ＋ 钥匙（货架诚实法则） */
export function LockDash({ line }: { line: string }) {
  return (
    <div>
      <div className="text-xl font-bold text-gray-300">
        {DASH} <span className="text-sm">🔑</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{line}</p>
    </div>
  );
}

export function StallDots({ red, orange, yellow }: { red: number; orange: number; yellow: number }) {
  const Dot = ({ n, cls }: { n: number; cls: string }) =>
    n > 0 ? (
      <span className={`inline-flex min-w-[1.35rem] items-center justify-center rounded-full px-1 text-[11px] font-bold ${cls}`}>
        {n}
      </span>
    ) : (
      <span className="inline-flex min-w-[1.35rem] items-center justify-center text-[11px] text-gray-300">·</span>
    );
  return (
    <span className="inline-flex items-center gap-0.5" title={`停滞：红 ${red} / 橙 ${orange} / 黄 ${yellow}`}>
      <Dot n={red} cls="bg-red-100 text-red-700" />
      <Dot n={orange} cls="bg-orange-100 text-orange-700" />
      <Dot n={yellow} cls="bg-yellow-100 text-yellow-800" />
    </span>
  );
}
