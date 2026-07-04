/**
 * P9 · 暗色驾驶舱基元（老板/主管/销售三看板共用）。
 * 死线②「十秒答案、三击到底」：每格数据可点，下钻 DrillSheet 到源明细。
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmtSignedPct1, type LevelKey, type SevenLevel } from '../domain/engine';

export const TL = {
  indigo: 'linear-gradient(90deg,#6366f1,#818cf8)',
  cyan: 'linear-gradient(90deg,#06b6d4,#22d3ee)',
  green: 'linear-gradient(90deg,#10b981,#34d399)',
  amber: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
  red: 'linear-gradient(90deg,#ef4444,#f87171)',
  purple: 'linear-gradient(90deg,#8b5cf6,#a78bfa)',
  pink: 'linear-gradient(90deg,#ec4899,#f472b6)',
  slate: 'linear-gradient(90deg,#475569,#64748b)',
};

export function BoardShell({ title, subtitle, badges, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-board min-h-dvh pb-28 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0f1e]/85 px-3 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2 lg:max-w-[1600px]">
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold tracking-wide lg:text-lg">{title}</h1>
            {subtitle && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">{subtitle}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {badges}
            <Link to="/" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/15">
              切换身份
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md space-y-3 px-3 pt-3 lg:max-w-[1600px]">{children}</main>
    </div>
  );
}

export function BCard({ title, icon, right, children, tl, className = '', id }: {
  title?: ReactNode;
  icon?: string;
  right?: ReactNode;
  children: ReactNode;
  tl?: string;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`glass topline rounded-2xl p-4 ${className}`}
      style={tl ? ({ ['--tl' as never]: tl } as CSSProperties) : undefined}
    >
      {title != null && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/70 to-cyan-500/50 text-sm">
                {icon}
              </span>
            )}
            {title}
          </h2>
          <div className="shrink-0">{right}</div>
        </div>
      )}
      {children}
    </section>
  );
}

/** 环比/趋势角标 */
export function TrendPill({ value, note }: { value: number | null; note?: string }) {
  if (value == null) return <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-500">环比 —</span>;
  const up = value >= 0;
  return (
    <span
      title={note}
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
    >
      {up ? '↑' : '↓'} {fmtSignedPct1(value).replace('+', '').replace('-', '')}
    </span>
  );
}

/** KPI 大卡（数值＋白话双行＋趋势角标＋迷你图＋下钻） */
export function Kpi({ icon, label, value, valueClass = 'text-white', trend, plain, spark, tl, locked, onClick, badge }: {
  icon: string;
  label: string;
  value: ReactNode;
  valueClass?: string;
  trend?: ReactNode;
  plain?: ReactNode;
  spark?: ReactNode;
  tl: string;
  locked?: boolean;
  onClick?: () => void;
  badge?: ReactNode;
}) {
  return (
    <div
      className={`glass glass-hover topline relative rounded-2xl p-3.5 ${onClick ? 'cursor-pointer' : ''}`}
      style={{ ['--tl' as never]: tl } as CSSProperties}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span>{icon}</span>
          {label}
          {locked && <span title="未购，上锁显 —">🔒</span>}
        </div>
        {trend ?? badge}
      </div>
      <div className={`mt-1.5 text-[22px] font-extrabold leading-7 tabular-nums ${locked ? 'text-slate-600' : valueClass}`}>
        {value}
      </div>
      {plain && <div className="mt-1 text-[10px] leading-4 text-slate-400">{plain}</div>}
      {spark && <div className="mt-1.5">{spark}</div>}
      {onClick && (
        <span className="absolute bottom-2.5 right-3 text-[10px] text-slate-500">明细 ›</span>
      )}
    </div>
  );
}

/** 七级色（暗底适配） */
export const DARK_LEVEL_CHIP: Record<LevelKey, string> = {
  lead: 'bg-purple-500/20 text-purple-300 ring-purple-400/40',
  excellent: 'bg-blue-500/20 text-blue-300 ring-blue-400/40',
  good: 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/40',
  pass: 'bg-white/10 text-slate-200 ring-white/25',
  yellow: 'bg-yellow-500/20 text-yellow-300 ring-yellow-400/40',
  orange: 'bg-orange-500/20 text-orange-300 ring-orange-400/40',
  red: 'bg-red-500/20 text-red-300 ring-red-400/40',
};

export const LEVEL_BAR_GRAD: Record<LevelKey, string> = {
  lead: 'linear-gradient(90deg,#8b5cf6,#a78bfa)',
  excellent: 'linear-gradient(90deg,#3b82f6,#60a5fa)',
  good: 'linear-gradient(90deg,#10b981,#34d399)',
  pass: 'linear-gradient(90deg,#94a3b8,#cbd5e1)',
  yellow: 'linear-gradient(90deg,#eab308,#facc15)',
  orange: 'linear-gradient(90deg,#f97316,#fb923c)',
  red: 'linear-gradient(90deg,#ef4444,#f87171)',
};

export function DarkLevelChip({ level }: { level: SevenLevel | null }) {
  if (!level) return <span className="text-xs text-slate-500">—</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${DARK_LEVEL_CHIP[level.key]}`}>
      {level.name}
    </span>
  );
}

export function DarkPaceBar({ rate, level }: { rate: number | null; level: SevenLevel | null }) {
  if (rate == null || !level) return <div className="h-2 w-full rounded-full bg-white/8" />;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
      <div
        className="bar-anim h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(3, rate * 100))}%`, background: LEVEL_BAR_GRAD[level.key] }}
      />
    </div>
  );
}

/** 排名奖牌 */
export function Medal({ n }: { n: number }) {
  const cls =
    n === 1 ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950'
    : n === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-slate-900'
    : n === 3 ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-orange-950'
    : 'bg-white/10 text-slate-300';
  return <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-extrabold ${cls}`}>{n}</span>;
}

/** 下钻底部面板（每个数据的小导航终点） */
export function DrillSheet({ open, title, onClose, children }: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="sheet-in glass max-h-[82dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-white/15 p-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">{title}</h3>
          <button className="rounded-lg bg-white/10 px-2.5 py-1 text-xs text-slate-300" onClick={onClose}>关闭 ✕</button>
        </div>
        {children}
        <div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-slate-500">
          下钻明细同源同刷新——与看板数字逐位一致（死线①：看板不产口径）
        </div>
      </div>
    </div>
  );
}

/** 下钻表格行 */
export function DrillRow({ l, r, sub }: { l: ReactNode; r: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate text-slate-200">{l}</div>
        {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
      </div>
      <div className="shrink-0 font-semibold tabular-nums text-slate-100">{r}</div>
    </div>
  );
}
