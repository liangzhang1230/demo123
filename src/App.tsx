import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { STAGE_LABEL, FUNNEL_STAGES } from './domain/types';
import { fmtRoi2, fmtYuan, fmtPct1 } from './domain/engine';
import { AppStoreProvider, useApp } from './store/AppStore';
import BossPage from './pages/boss';
import ManagerPage from './pages/manager';
import SalesPage from './pages/sales';
import CustomersPage from './pages/sales/Customers';
import NewCustomerPage from './pages/sales/NewCustomer';
import CustomerCardPage from './pages/sales/CustomerCard';
import ConfirmPage from './pages/sales/Confirm';
import SamplePage from './pages/boss/SamplePages';
import ScriptPage from './pages/script';
import { FloatingControls } from './components/FloatingControls';

/** 身份切换首页：所有数字现场折算自事件流（无任何硬编码汇总） */
function HomePage() {
  const { data, computed, reset } = useApp();
  const { folded } = computed;
  // 空态兜底：模拟日切进入无事件月份时，分母 0/缺失一律显 —
  const empty = { entered: 0, exited: 0, lost: 0 };
  const jun = folded.monthlyPoolFlow[computed.ym] ?? { lead: empty, intent: empty, sample: empty, signed: empty };
  const may = folded.monthlyPoolFlow[computed.company.momPair[1]] ?? { lead: empty, intent: empty, sample: empty, signed: empty };
  const aov = folded.totalDealCnt > 0 ? folded.cumRevenue / folded.totalDealCnt : null;

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:max-w-2xl">
      <header className="mb-4">
        <h1 className="text-lg font-bold">{data.tenant.name} · 演示环境</h1>
        <p className="text-sm text-gray-500">
          模拟今天 {computed.asOf}（开通第 90 天）｜事件 {folded.eventCount} 条｜客户 {data.customers.length} 家
        </p>
      </header>

      <section className="mb-4 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">三个免密演示身份</h2>
        <div className="flex flex-col gap-2">
          <Link className="rounded-xl bg-gray-900 px-4 py-3 text-white" to="/boss">
            <span className="text-sm font-bold">陈总 · 老板</span>
            <span className="ml-2 text-xs text-gray-300">管理端决策看板（五区＋货架）</span>
          </Link>
          <Link className="rounded-xl bg-gray-700 px-4 py-3 text-white" to="/manager">
            <span className="text-sm font-bold">刘敏 · 主管</span>
            <span className="ml-2 text-xs text-gray-300">同板裁剪 · 华东一部</span>
          </Link>
          <Link className="rounded-xl bg-gray-500 px-4 py-3 text-white" to="/sales">
            <span className="text-sm font-bold">王丽 · 销售</span>
            <span className="ml-2 text-xs text-gray-200">行动板（待办·目标·排名·漏斗）</span>
          </Link>
        </div>
      </section>

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

      <section className="mb-4 rounded-xl border border-gray-200 p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">本月关键数（实时折算）</h2>
        <dl className="space-y-1">
          <Row k="样品池本月进入 / 转出" v={`${jun.sample.entered} / ${jun.sample.exited}（${fmtPct1(jun.sample.exited / jun.sample.entered)}，上月 ${fmtPct1(may.sample.exited / may.sample.entered)}）`} />
          <Row k="月回款" v={fmtYuan(computed.company.monthRevenue)} />
          <Row k="平均客单 aov" v={aov == null ? '—' : `¥${aov.toFixed(2)}（累计回款 ÷ ${folded.totalDealCnt}）`} />
          <Row k="团队 labor_roi" v={fmtRoi2(folded.teamLaborRoi)} />
          <Row k="本月流失" v={`${folded.monthlyLossTotal[computed.ym] ?? 0} 家`} />
        </dl>
      </section>

      <Link
        to="/script"
        className="mb-3 block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
      >
        📖 演示脚本（商务 10 分钟动线与话术提词） →
      </Link>

      <button
        onClick={reset}
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
  return (
    <AppStoreProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/boss" element={<BossPage />} />
        <Route path="/manager" element={<ManagerPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/sales/customers" element={<CustomersPage />} />
        <Route path="/sales/customers/new" element={<NewCustomerPage />} />
        <Route path="/sales/customer/:id" element={<CustomerCardPage />} />
        <Route path="/sales/confirm" element={<ConfirmPage />} />
        <Route path="/sample/:key" element={<SamplePage />} />
        <Route path="/script" element={<ScriptPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <FloatingControls />
    </AppStoreProvider>
  );
}
