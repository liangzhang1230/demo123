/**
 * P9 · 零依赖 SVG 图表基元（不引 CDN/图表库，保离线单文件可演）。
 * 图表只做渲染——一切数据由调用方从事件流折算传入（死线①：看板不产口径）。
 */
import type { ReactNode } from 'react';

/** 面积迷你趋势线 */
export function Spark({ data, w = 120, h = 34, stroke = '#818cf8', fillFrom = 'rgba(129,140,248,0.35)' }: {
  data: number[];
  w?: number;
  h?: number;
  stroke?: string;
  fillFrom?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i) => [
    pad + (i * (w - pad * 2)) / (data.length - 1),
    h - pad - ((v - min) / span) * (h - pad * 2),
  ]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  const gid = `sg${Math.abs(data.reduce((a, b, i) => a + b * (i + 7), 0)).toFixed(0)}${w}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillFrom} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={stroke} />
    </svg>
  );
}

/** 横向漏斗条 */
export function FunnelBar({ label, count, pct, gradient, right, onClick }: {
  label: string;
  count: ReactNode;
  pct: number; // 0-1 条宽
  gradient: string;
  right?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 ${onClick ? 'cursor-pointer group' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="w-14 shrink-0 text-[11px] text-slate-400">{label}</div>
      <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-white/5">
        <div
          className="bar-anim flex h-full items-center rounded-lg px-2 text-[11px] font-bold text-white"
          style={{ width: `${Math.max(6, Math.min(100, pct * 100))}%`, background: gradient }}
        >
          {count}
        </div>
      </div>
      <div className="w-16 shrink-0 text-right text-[10px] tabular-nums text-slate-400 group-hover:text-indigo-300">{right}</div>
    </div>
  );
}

/** 环形进度（比率/达成率） */
export function Ring({ pct, size = 88, color = '#34d399', center, sub }: {
  pct: number | null; // 0-1，可 >1（封顶显示）
  size?: number;
  color?: string;
  center: ReactNode;
  sub?: ReactNode;
}) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const filled = pct == null ? 0 : Math.max(0.02, Math.min(1, pct));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={pct == null ? 'rgba(255,255,255,0.12)' : color}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - filled)}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
        <div className="text-base font-extrabold text-white">{center}</div>
        {sub && <div className="text-[9px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

/** 热力格（0..4 档） */
const HEAT = [
  'bg-white/[0.04] text-slate-500',
  'bg-emerald-500/20 text-emerald-300',
  'bg-emerald-500/40 text-emerald-200',
  'bg-emerald-500/65 text-white',
  'bg-emerald-400/90 text-emerald-950 font-bold',
];

export function HeatGrid({ cols, rows }: {
  cols: string[];
  rows: { label: ReactNode; cells: { v: number; hint?: string }[]; alert?: boolean }[];
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.cells.map((x) => x.v)));
  return (
    <div className="space-y-1.5">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)` }}>
        <div />
        {cols.map((c, i) => (
          <div key={i} className="text-center text-[10px] text-slate-500">{c}</div>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="grid gap-1.5" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)` }}>
          <div className={`flex items-center truncate text-[11px] ${row.alert ? 'font-semibold text-red-400' : 'text-slate-400'}`}>
            {row.label}
          </div>
          {row.cells.map((cell, ci) => {
            const lv = cell.v <= 0 ? 0 : Math.min(4, 1 + Math.floor((cell.v / max) * 3.999));
            return (
              <div
                key={ci}
                title={cell.hint}
                className={`flex aspect-square max-h-9 items-center justify-center rounded-md text-[11px] tabular-nums transition-transform hover:scale-110 ${HEAT[lv]}`}
              >
                {cell.v > 0 ? cell.v : '·'}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 月度双序列组合：柱（序列A）＋数值行 */
export function MonthBars({ months, a, aLabel, aColor = '#38bdf8', bRows }: {
  months: string[];
  a: number[];
  aLabel: string;
  aColor?: string;
  bRows?: { label: string; values: string[]; color?: string }[];
}) {
  const max = Math.max(...a, 1);
  return (
    <div>
      <div className="flex items-end justify-between gap-3 px-1" style={{ height: 110 }}>
        {a.map((v, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1 self-stretch">
            <div className="text-[10px] font-semibold tabular-nums text-slate-300">{(v / 10000).toFixed(1)}万</div>
            <div
              className="bar-anim w-full max-w-14 rounded-t-lg"
              style={{ height: `${Math.max(6, (v / max) * 76)}%`, background: `linear-gradient(180deg, ${aColor}, ${aColor}33)` }}
            />
            <div className="text-[10px] text-slate-500">{months[i]}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-center text-[10px] text-slate-500">{aLabel}</div>
      {bRows && (
        <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
          {bRows.map((r, i) => (
            <div key={i} className="grid grid-cols-4 items-center text-[11px]">
              <span className="text-slate-400">{r.label}</span>
              {r.values.map((v, j) => (
                <span key={j} className="text-center font-medium tabular-nums" style={{ color: r.color ?? '#cbd5e1' }}>{v}</span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
