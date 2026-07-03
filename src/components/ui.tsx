/**
 * 共享 UI 基元（移动优先 375px，lg 起投屏栅格）。
 * 展示精度全部走 engine.ts 格式函数（§6.10：显示才舍入、分母 0 显 —）。
 */
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { LevelKey, SevenLevel, StallLevel } from '../domain/engine';

// ---- 七级色（§6.8 紫蓝绿白黄橙红） ----
export const LEVEL_CHIP: Record<LevelKey, string> = {
  lead: 'bg-purple-100 text-purple-800 ring-purple-300',
  excellent: 'bg-blue-100 text-blue-800 ring-blue-300',
  good: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  pass: 'bg-white text-gray-700 ring-gray-300',
  yellow: 'bg-yellow-100 text-yellow-800 ring-yellow-400',
  orange: 'bg-orange-100 text-orange-800 ring-orange-400',
  red: 'bg-red-100 text-red-800 ring-red-400',
};

export const LEVEL_BAR: Record<LevelKey, string> = {
  lead: 'bg-purple-500',
  excellent: 'bg-blue-500',
  good: 'bg-emerald-500',
  pass: 'bg-gray-400',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
};

export function LevelChip({ level, extra }: { level: SevenLevel | null; extra?: string }) {
  if (!level) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${LEVEL_CHIP[level.key]}`}>
      {level.name}
      {extra ? <span className="opacity-80">{extra}</span> : null}
    </span>
  );
}

/** pace 进度条：填充色随七级 */
export function PaceBar({ rate, level }: { rate: number | null; level: SevenLevel | null }) {
  if (rate == null || !level) {
    return <div className="h-2 w-full rounded-full bg-gray-100" />;
  }
  const w = Math.min(100, Math.max(3, rate * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full rounded-full ${LEVEL_BAR[level.key]}`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ---- 停滞三级点（§8.4 红橙黄） ----
export const STALL_DOT: Record<StallLevel, string> = {
  dying: 'bg-red-500',
  warning: 'bg-orange-400',
  watch: 'bg-yellow-400',
};

export function StallDots({ dying, warning, watch }: { dying: number; warning: number; watch: number }) {
  if (dying + warning + watch === 0) return <span className="text-xs text-gray-300">0</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 text-xs tabular-nums">
      {dying > 0 && <span className="inline-flex items-center gap-0.5 font-semibold text-red-600"><i className="h-2 w-2 rounded-full bg-red-500" />{dying}</span>}
      {warning > 0 && <span className="inline-flex items-center gap-0.5 text-orange-600"><i className="h-2 w-2 rounded-full bg-orange-400" />{warning}</span>}
      {watch > 0 && <span className="inline-flex items-center gap-0.5 text-yellow-600"><i className="h-2 w-2 rounded-full bg-yellow-400" />{watch}</span>}
    </span>
  );
}

// ---- 布局基元 ----

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-bold text-gray-800">{children}</h2>
      {right}
    </div>
  );
}

/** 数值＋白话双行（看板章展示定式） */
export function Stat({ label, value, plain, locked }: { label: string; value: ReactNode; plain?: ReactNode; locked?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${locked ? 'bg-gray-50' : 'bg-gray-50/60'}`}>
      <div className="flex items-center gap-1 text-[11px] text-gray-500">
        {label}
        {locked && <span title="未购，上锁显 —">🔒</span>}
      </div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${locked ? 'text-gray-300' : 'text-gray-900'}`}>{value}</div>
      {plain ? <div className="mt-0.5 text-[11px] leading-4 text-gray-500">{plain}</div> : null}
    </div>
  );
}

/** 「示例数据」常驻角标（铁律 2：锁卡与样例页零计算） */
export function ExampleBadge({ inline = false }: { inline?: boolean }) {
  return (
    <span className={`${inline ? '' : 'absolute right-3 top-3'} z-10 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-300`}>
      示例数据
    </span>
  );
}

export function GrayNote({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-4 text-gray-400">{children}</p>;
}

/** 页面壳：租户头＋日期＋身份切换 */
export function Shell({ title, subtitle, children, tone = 'light' }: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  tone?: 'light' | 'boss';
}) {
  return (
    <div className="min-h-dvh bg-gray-100 pb-24">
      <header className={`${tone === 'boss' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 border-b border-gray-200'} px-4 pb-3 pt-4`}>
        <div className="mx-auto flex max-w-md items-center justify-between lg:max-w-6xl">
          <div>
            <h1 className="text-base font-bold">{title}</h1>
            {subtitle ? <div className={`text-[11px] ${tone === 'boss' ? 'text-gray-300' : 'text-gray-500'}`}>{subtitle}</div> : null}
          </div>
          <Link
            to="/"
            className={`rounded-lg px-2.5 py-1.5 text-xs ${tone === 'boss' ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            切换身份
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-md space-y-3 px-3 pt-3 lg:max-w-6xl">{children}</main>
    </div>
  );
}

/** lg 投屏栅格：手机单列，投屏两列 */
export function BoardGrid({ children }: { children: ReactNode }) {
  return <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">{children}</div>;
}
