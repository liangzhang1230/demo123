import { useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { STAGE_LABEL, FUNNEL_STAGES } from './domain/types';
import { foldEvents } from './domain/engine';
import { isRestDay } from './domain/calendar';
import { deriveMorningReport } from './domain/morningReport';
import { DemoProvider, useDemo } from './state';
import BossPage from './pages/boss';
import ManagerPage from './pages/manager';
import SalesPage from './pages/sales';
import NewCustomerPage from './pages/sales/NewCustomer';
import CustomersPage from './pages/sales/Customers';
import CustomerCardPage from './pages/sales/CustomerCard';
import ConfirmPage from './pages/sales/Confirm';

/** 演示控制台（P1 种子状态 ＋ P5 日切）：所有数字现场折算自事件流（无任何硬编码汇总） */
function HomePage() {
  const { data, overlay, actions } = useDemo();
  const [confirmDay, setConfirmDay] = useState(false);
  const folded = useMemo(
    () => foldEvents(data.events, data.people, data.categories, data.anchorDate, data.openDate),
    [data],
  );
  const ym = data.anchorDate.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const cur = folded.monthlyPoolFlow[ym];
  const prev = folded.monthlyPoolFlow[prevYm];
  const aov = folded.totalDealCnt > 0 ? folded.cumRevenue / folded.totalDealCnt : null;
  const pct = (f?: { entered: number; exited: number }) =>
    f && f.entered > 0 ? `${((f.exited / f.entered) * 100).toFixed(1)}%` : '—';

  const morning = useMemo(
    () => (overlay.lastClosedDate ? deriveMorningReport(data, overlay.lastClosedDate, overlay.confirms, isRestDay) : null),
    [data, overlay],
  );

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:max-w-2xl">
      <header className="mb-4">
        <h1 className="text-lg font-bold">{data.tenant.name} · 演示控制台</h1>
        <p className="text-sm text-gray-500">
          模拟今天 {data.anchorDate}
          {overlay.dayOffset > 0 && <span className="text-blue-600">（已模拟过 {overlay.dayOffset} 天）</span>}
          ｜事件 {folded.eventCount} 条｜客户 {data.customers.length} 家
        </p>
      </header>

      <section className="mb-4 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">三端入口（免密三身份）</h2>
        <div className="flex gap-2">
          <Link className="flex-1 rounded-lg bg-gray-900 py-2 text-center text-sm text-white" to="/boss">老板 陈总</Link>
          <Link className="flex-1 rounded-lg bg-gray-700 py-2 text-center text-sm text-white" to="/manager">主管 刘敏</Link>
          <Link className="flex-1 rounded-lg bg-gray-500 py-2 text-center text-sm text-white" to="/sales">销售 王丽</Link>
        </div>
      </section>

      {/* P5 · 模拟过一天（R1-17 日终定版演示化） */}
      <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">日终定版（R1-17）</h2>
        <p className="mb-2 text-xs text-gray-500">
          定版快照归档为「昨日快照」→ 模拟时钟 +1 天：停滞天数 +1、早报样卡刷新、环比与排名升降重算——全部由事件流重新折算
        </p>
        {confirmDay ? (
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDay(false)}
              className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm text-gray-600"
            >
              取消
            </button>
            <button
              onClick={() => {
                actions.simulateDay();
                setConfirmDay(false);
              }}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white"
            >
              确认定版 {data.anchorDate}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDay(true)}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white active:bg-blue-700"
          >
            ⏭ 模拟过一天
          </button>
        )}
      </section>

      {/* 早报样卡（日切后刷新；数字实时折算，文本骨架回填） */}
      {morning && (
        <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-700">📮 早报样卡 · {data.anchorDate} 晨</h2>
          <p className="text-sm leading-relaxed text-gray-800">{morning.text}</p>
          <p className="mt-2 text-xs text-gray-400">上线后由 AI 销售操盘手按你的真实数据每日生成（数字均由昨日定版事件流折算）</p>
        </section>
      )}

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
        <h2 className="mb-2 text-sm font-semibold text-gray-700">本月关键数（实时折算 · {ym}）</h2>
        <dl className="space-y-1 text-sm">
          <Row k="样品池本月进入 / 转出" v={cur ? `${cur.sample.entered} / ${cur.sample.exited}（${pct(cur.sample)}，上月 ${pct(prev?.sample)}）` : '—'} />
          <Row k="月回款" v={`¥${(folded.revenueByMonth[ym] ?? 0).toLocaleString('zh-CN')}`} />
          <Row k="平均客单 aov" v={aov == null ? '—' : `¥${aov.toFixed(2)}（累计回款 ÷ ${folded.totalDealCnt}）`} />
          <Row k="团队 labor_roi" v={folded.teamLaborRoi == null ? '—' : folded.teamLaborRoi.toFixed(2)} />
          <Row k="复购客户数" v={String(folded.repeatCustCnt)} />
          <Row k="本月流失" v={`${folded.monthlyLossTotal[ym] ?? 0} 家`} />
        </dl>
      </section>

      <button
        onClick={actions.resetAll}
        className="w-full rounded-xl border border-red-300 py-3 text-sm font-semibold text-red-600 active:bg-red-50"
      >
        一键重置演示数据（清现场操作＋重生成种子）
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

function RoutedPages() {
  const { data, overlay } = useDemo();
  const confirmedToday = overlay.confirms.some((c) => c.date === data.anchorDate && c.ownerId === 'wangli');
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/boss" element={<BossPage data={data} />} />
      <Route path="/manager" element={<ManagerPage data={data} />} />
      <Route path="/sales" element={<SalesPage data={data} confirmedToday={confirmedToday} />} />
      <Route path="/sales/new" element={<NewCustomerPage />} />
      <Route path="/sales/customers" element={<CustomersPage />} />
      <Route path="/sales/customer/:id" element={<CustomerCardPage />} />
      <Route path="/sales/confirm" element={<ConfirmPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <DemoProvider>
      <RoutedPages />
    </DemoProvider>
  );
}
