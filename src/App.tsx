import { useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import type { SeedData } from './domain/types';
import { STAGE_LABEL, FUNNEL_STAGES } from './domain/types';
import { loadSeed, resetSeed } from './seed/store';
import { foldEvents } from './seed/fold';
import BossPage from './pages/boss';
import ManagerPage from './pages/manager';
import SalesPage from './pages/sales';

/** P1 种子状态页：所有数字现场折算自事件流（无任何硬编码汇总） */
function SeedStatusPage({ data, onReset }: { data: SeedData; onReset: () => void }) {
  const folded = useMemo(
    () => foldEvents(data.events, data.people, data.categories, data.anchorDate, data.openDate),
    [data],
  );
  const jun = folded.monthlyPoolFlow['2026-06'];
  const may = folded.monthlyPoolFlow['2026-05'];
  const aov = folded.cumRevenue / folded.totalDealCnt;

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:max-w-2xl">
      <header className="mb-4">
        <h1 className="text-lg font-bold">{data.tenant.name} · 演示种子状态（P1）</h1>
        <p className="text-sm text-gray-500">
          模拟今天 {data.anchorDate}（开通第 90 天）｜事件 {folded.eventCount} 条｜客户 {data.customers.length} 家
        </p>
      </header>

      <section className="mb-4 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">六态存量（实时折算）</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          {FUNNEL_STAGES.map((s) => (
            <div key={s} className="rounded-lg bg-gray-50 py-2">
              <div className="text-xs text-gray-500">{STAGE_LABEL[s]}</div>
              <div className="text-xl font-bold tabular-nums">{folded.stocks[s]}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">本月关键数（实时折算）</h2>
        <dl className="space-y-1 text-sm">
          <Row k="样品池本月进入 / 转出" v={`${jun.sample.entered} / ${jun.sample.exited}（${((jun.sample.exited / jun.sample.entered) * 100).toFixed(1)}%，上月 ${((may.sample.exited / may.sample.entered) * 100).toFixed(1)}%）`} />
          <Row k="月回款" v={`¥${(folded.revenueByMonth['2026-06'] ?? 0).toLocaleString('zh-CN')}`} />
          <Row k="平均客单 aov" v={`¥${aov.toFixed(2)}（累计回款 ÷ ${folded.totalDealCnt}）`} />
          <Row k="团队 labor_roi" v={(folded.teamLaborRoi ?? 0).toFixed(2)} />
          <Row k="复购客户数" v={String(folded.repeatCustCnt)} />
          <Row k="本月流失" v={`${folded.monthlyLossTotal['2026-06'] ?? 0} 家`} />
        </dl>
      </section>

      <section className="mb-4 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">三端入口（P3/P4 施工位）</h2>
        <div className="flex gap-2">
          <Link className="flex-1 rounded-lg bg-gray-900 py-2 text-center text-sm text-white" to="/boss">老板 陈总</Link>
          <Link className="flex-1 rounded-lg bg-gray-700 py-2 text-center text-sm text-white" to="/manager">主管 刘敏</Link>
          <Link className="flex-1 rounded-lg bg-gray-500 py-2 text-center text-sm text-white" to="/sales">销售 王丽</Link>
        </div>
      </section>

      <button
        onClick={onReset}
        className="w-full rounded-xl border border-red-300 py-3 text-sm font-semibold text-red-600 active:bg-red-50"
      >
        一键重置演示数据
      </button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}

export default function App() {
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SeedData | null>(() => {
    try {
      return loadSeed();
    } catch (e) {
      setError(String(e));
      return null;
    }
  });

  if (error || !data) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-bold">种子守恒断言失败，拒绝启动</p>
          <p className="mt-2 break-all">{error}</p>
        </div>
      </div>
    );
  }

  const handleReset = () => {
    try {
      setData(resetSeed());
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Routes>
      <Route path="/" element={<SeedStatusPage data={data} onReset={handleReset} />} />
      <Route path="/boss" element={<BossPage data={data} />} />
      <Route path="/manager" element={<ManagerPage data={data} />} />
      <Route path="/sales" element={<SalesPage data={data} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
