import { Link } from 'react-router-dom';
import { useAppState } from '../App';
import { LOST, daysSince, recyclable } from '../types';
import type { Customer } from '../types';

/** 客户曾到达的最高阶段下标（流失前的进度也算），-1 表示无法定位 */
function maxReachedIndex(c: Customer, stages: string[]): number {
  let max = stages.indexOf(c.stage);
  for (const f of c.followUps) {
    if (f.type === 'stage' && f.to && f.to !== LOST) {
      max = Math.max(max, stages.indexOf(f.to));
    }
  }
  return max;
}

export default function Board() {
  const { state } = useAppState();
  if (!state) return <p className="p-6 text-center text-sm text-slate-400">加载中…</p>;
  const { settings, customers } = state;
  const { stages } = settings;

  const active = customers.filter((c) => c.stage !== LOST);
  const lost = customers.filter((c) => c.stage === LOST);
  const sea = active.filter((c) => c.owner === null);
  const overdueSoon = active.filter(
    (c) => recyclable(c, settings) && daysSince(c.lastFollowUpAt) >= settings.recycleDays - 3,
  );

  const stock = stages.map((s) => active.filter((c) => c.stage === s).length);
  const reached = stages.map(
    (_, i) => customers.filter((c) => maxReachedIndex(c, stages) >= i).length,
  );
  const maxStock = Math.max(1, ...stock);

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-bold">销售漏斗</h1>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Link to="/customers?tab=sea" className="rounded-xl bg-cyan-50 py-3">
          <div className="text-xl font-bold text-cyan-700">{sea.length}</div>
          <div className="text-xs text-slate-500">公海</div>
        </Link>
        <Link to="/customers" className="rounded-xl bg-amber-50 py-3">
          <div className="text-xl font-bold text-amber-700">{overdueSoon.length}</div>
          <div className="text-xs text-slate-500">临近回收</div>
        </Link>
        <Link to="/customers?tab=lost" className="rounded-xl bg-slate-100 py-3">
          <div className="text-xl font-bold text-slate-600">{lost.length}</div>
          <div className="text-xs text-slate-500">流失</div>
        </Link>
      </div>

      <div className="mt-5 space-y-1.5">
        {stages.map((s, i) => {
          const conv = i > 0 && reached[i - 1] > 0
            ? Math.round((reached[i] / reached[i - 1]) * 100)
            : null;
          return (
            <div key={s}>
              {conv !== null && (
                <div className="py-0.5 pl-2 text-[11px] text-slate-400">↓ 转化 {conv}%（曾到达 {reached[i]}/{reached[i - 1]}）</div>
              )}
              <Link
                to={`/customers?stage=${encodeURIComponent(s)}`}
                className="flex items-center gap-2"
              >
                <div className="w-20 shrink-0 text-right text-sm text-slate-600">{s}</div>
                <div className="h-9 flex-1 overflow-hidden rounded-lg bg-slate-100">
                  <div
                    className="flex h-full items-center rounded-lg bg-blue-500 px-2 text-sm font-semibold text-white"
                    style={{ width: `${Math.max(12, (stock[i] / maxStock) * 100)}%` }}
                  >
                    {stock[i]}
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        条形为各阶段当前存量（含公海），转化率按「曾到达」人数计算；点击任意行进入对应列表。
      </p>
    </div>
  );
}
