import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppState } from '../App';
import { claim } from '../api';
import { LOST, daysSince, recyclable } from '../types';
import type { Customer } from '../types';

const TABS = [
  { key: 'mine', label: '私海' },
  { key: 'sea', label: '公海' },
  { key: 'lost', label: '流失' },
] as const;

function matches(c: Customer, q: string): boolean {
  if (!q) return true;
  const hay = [c.name, c.source, ...c.members.flatMap((m) => [m.name, m.phone ?? '', m.wechat ?? ''])]
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function Customers() {
  const { state, refresh } = useAppState();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const tab = params.get('tab') ?? 'mine';
  const stageFilter = params.get('stage');

  const list = useMemo(() => {
    if (!state) return [];
    let items = state.customers;
    if (tab === 'lost') items = items.filter((c) => c.stage === LOST);
    else if (tab === 'sea') items = items.filter((c) => c.stage !== LOST && c.owner === null);
    else items = items.filter((c) => c.stage !== LOST && c.owner === 'me');
    if (stageFilter) items = items.filter((c) => c.stage === stageFilter);
    items = items.filter((c) => matches(c, q));
    // 私海按最久未跟进优先（该催的排上面）；其他按最近动静
    return [...items].sort((a, b) =>
      tab === 'mine'
        ? a.lastFollowUpAt.localeCompare(b.lastFollowUpAt)
        : b.lastFollowUpAt.localeCompare(a.lastFollowUpAt),
    );
  }, [state, tab, stageFilter, q]);

  if (!state) return <p className="p-6 text-center text-sm text-slate-400">加载中…</p>;

  async function onClaim(id: string) {
    await claim(id);
    await refresh();
  }

  return (
    <div className="px-4 py-5">
      <div className="flex rounded-xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams(t.key === 'mine' ? {} : { tab: t.key })}
            className={`flex-1 rounded-lg py-1.5 text-sm ${
              tab === t.key ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜姓名 / 成员 / 电话 / 来源"
        className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
      />

      {stageFilter && (
        <button
          onClick={() => { params.delete('stage'); setParams(params); }}
          className="mt-2 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700"
        >
          阶段：{stageFilter} ✕
        </button>
      )}

      <div className="mt-3 space-y-2">
        {list.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">没有客户</p>
        )}
        {list.map((c) => {
          const days = daysSince(c.lastFollowUpAt);
          const warn = tab === 'mine' && recyclable(c, state.settings)
            && days >= state.settings.recycleDays - 3;
          const family = c.members
            .filter((m) => m.relation !== '本人')
            .map((m) => `${m.relation}·${m.name}`)
            .join('｜');
          return (
            <Link
              key={c.id}
              to={`/customers/${c.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold">{c.name}</div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  c.stage === LOST ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-700'
                }`}>
                  {c.stage === LOST && c.lostReason ? `流失·${c.lostReason}` : c.stage}
                </span>
              </div>
              {family && <div className="mt-1 text-xs text-slate-500">{family}</div>}
              <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                <span>{c.source || '来源未填'}</span>
                <span className={warn ? 'font-semibold text-red-600' : ''}>
                  {days === 0 ? '今天有跟进' : `${days} 天未跟进${warn ? '（快回收）' : ''}`}
                </span>
              </div>
              {tab === 'sea' && (
                <button
                  onClick={(e) => { e.preventDefault(); void onClaim(c.id); }}
                  className="mt-2 w-full rounded-lg bg-cyan-600 py-1.5 text-sm font-semibold text-white"
                >
                  认领到私海
                </button>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
