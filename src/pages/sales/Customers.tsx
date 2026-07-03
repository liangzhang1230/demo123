/** /sales/customers · 本人客户列表（仅见本人归属客户；ABCD 置顶排序＋六态筛选） */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { FUNNEL_STAGES, STAGE_LABEL, type Stage } from '../../domain/types';
import { stallLevel, stayDays, type MonitoredStage } from '../../domain/engine';
import { Card, Shell, STALL_DOT } from '../../components/ui';

const ME = 'wangli';
const ABCD_ORDER = { A: 0, B: 1, C: 2, D: 3 } as const;

export default function CustomersPage() {
  const { computed } = useApp();
  const [params, setParams] = useSearchParams();
  const stageFilter = (params.get('stage') as Stage | null) ?? null;
  const [q, setQ] = useState('');

  const mine = useMemo(() => {
    let list = computed.byOwner.get(ME) ?? [];
    if (stageFilter) list = list.filter((c) => c.stage === stageFilter);
    if (q.trim()) list = list.filter((c) => c.customer.name.includes(q.trim()) || c.customer.phone.includes(q.trim()));
    return [...list].sort(
      (a, b) =>
        ABCD_ORDER[a.customer.level] - ABCD_ORDER[b.customer.level] ||
        (b.lastEventDate < a.lastEventDate ? -1 : 1),
    );
  }, [computed, stageFilter, q]);

  return (
    <Shell title="我的客户" subtitle={<Link to="/sales" className="underline-offset-2 hover:underline">← 返回我的看板</Link>}>
      <Card>
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            className={`shrink-0 rounded-full px-2.5 py-1 ${!stageFilter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setParams({})}
          >
            全部
          </button>
          {FUNNEL_STAGES.map((s) => (
            <button
              key={s}
              className={`shrink-0 rounded-full px-2.5 py-1 ${stageFilter === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
              onClick={() => setParams({ stage: s })}
            >
              {STAGE_LABEL[s]}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索客户名 / 手机号"
          className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
        {mine.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">没有符合条件的客户</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {mine.map((c) => {
              const monitored = (['lead', 'intent', 'sample', 'signed'] as Stage[]).includes(c.stage);
              const days = monitored ? stayDays(c.stageEntryDate, computed.asOf) : null;
              const lv = monitored && days != null ? stallLevel(c.stage as MonitoredStage, days) : null;
              return (
                <li key={c.customer.id}>
                  <Link to={`/sales/customer/${c.customer.id}`} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                        <span className="truncate">{c.customer.name}</span>
                        <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] text-gray-500">{c.customer.level}</span>
                        {lv && <i className={`h-2 w-2 shrink-0 rounded-full ${STALL_DOT[lv]}`} />}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {c.customer.contact} · 最后动态 {c.lastEventDate}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-medium text-gray-700">{STAGE_LABEL[c.stage]}</div>
                      {days != null && <div className="text-[10px] tabular-nums text-gray-400">停留 {days} 天</div>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
