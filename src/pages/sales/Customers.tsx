/**
 * 本人客户列表（P5 推进入口）· 仅见本人归属客户（权限矩阵：普通销售仅本账号）
 *  - ABCD 置顶排序 A→B→C→D（§4.4），同级按停留天数倒序（先推最久的）
 *  - 搜索＝名称/手机号本地过滤
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { STAGE_LABEL, type Stage } from '../../domain/types';
import { currentStagesOf, stallLevelOf, STALL_THRESHOLDS_GENERAL, type StallPool } from '../../domain/stallSales';
import { dayDiff } from '../../domain/calendar';
import { DEMO_SALES_ID, useDemo } from '../../state';

const STAGE_CHIP: Record<Stage, string> = {
  lead: 'bg-gray-100 text-gray-600',
  intent: 'bg-blue-50 text-blue-600',
  sample: 'bg-purple-50 text-purple-600',
  signed: 'bg-amber-50 text-amber-700',
  deal: 'bg-green-50 text-green-700',
  lost: 'bg-gray-100 text-gray-400',
};

const LEVEL_DOT: Record<'red' | 'orange' | 'yellow', string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-400',
  yellow: 'bg-yellow-400',
};

export default function CustomersPage() {
  const { data } = useDemo();
  const [q, setQ] = useState('');
  const anchor = data.anchorDate;

  const rows = useMemo(() => {
    const stages = currentStagesOf(data.events, anchor);
    const list = data.customers
      .filter((c) => c.ownerId === DEMO_SALES_ID)
      .map((c) => {
        const info = stages.get(c.id);
        const stage = (info?.stage ?? 'lead') as Stage;
        const stayDays = info ? dayDiff(anchor, info.enteredDate) : 0;
        const pool = stage as StallPool;
        const stall = pool in STALL_THRESHOLDS_GENERAL ? stallLevelOf(stayDays, STALL_THRESHOLDS_GENERAL[pool]) : null;
        return { c, stage, stayDays, stall };
      });
    list.sort((a, b) => (a.c.level !== b.c.level ? (a.c.level < b.c.level ? -1 : 1) : b.stayDays - a.stayDays));
    return list;
  }, [data, anchor]);

  const filtered = q.trim()
    ? rows.filter((r) => r.c.name.includes(q.trim()) || r.c.phone.includes(q.trim()))
    : rows;

  return (
    <div className="mx-auto max-w-md px-4 py-5 sm:max-w-2xl">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <Link to="/sales" className="text-xs text-gray-400">← 返回销售看板</Link>
          <h1 className="text-lg font-bold">我的客户 <span className="text-sm font-normal text-gray-500">· {rows.length} 家</span></h1>
        </div>
        <Link to="/sales/new" className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white">
          ＋ 建档
        </Link>
      </header>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索：客户名 / 手机号"
        className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
      />

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
        {filtered.map(({ c, stage, stayDays, stall }) => (
          <li key={c.id}>
            <Link to={`/sales/customer/${c.id}`} className="flex items-center gap-2 px-3 py-2.5 active:bg-gray-50">
              <span className="w-5 shrink-0 text-center text-xs font-bold text-gray-400">{c.level}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-800">{c.name}</span>
                <span className="block text-xs text-gray-400">{c.contact}</span>
              </span>
              {stall && <span className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[stall]}`} />}
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${STAGE_CHIP[stage]}`}>{STAGE_LABEL[stage]}</span>
              {stage !== 'deal' && stage !== 'lost' && (
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-gray-400">停留 {stayDays} 天</span>
              )}
            </Link>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-gray-400">无匹配客户</li>
        )}
      </ul>
    </div>
  );
}
