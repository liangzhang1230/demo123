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
import RookiePage from './pages/boss/RookiePage';
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

  const roles = [
    { to: '/boss', name: '陈总', role: '老板', desc: '决策看板 · 五区＋货架＋一键点亮', grad: 'from-indigo-500 to-purple-600', hint: '30 秒答三问：今天干什么 / 生意好不好 / 钱在哪' },
    { to: '/manager', name: '刘敏', role: '主管', desc: '同板裁剪 · 华东一部带教视图', grad: 'from-cyan-500 to-blue-600', hint: '今天带谁、催谁、教哪一跳' },
    { to: '/sales', name: '王丽', role: '销售', desc: '战绩中心 · 待办·目标·排名·漏斗', grad: 'from-emerald-500 to-teal-600', hint: '顶上有没有彩头、今天先推谁、我排第几' },
  ];

  return (
    <div className="bg-board min-h-dvh pb-24 text-slate-100">
      <div className="mx-auto max-w-md px-4 py-8 sm:max-w-3xl">
        <header className="mb-6 text-center">
          <div className="grad-text text-2xl font-black tracking-wide">AI 销售操盘手</div>
          <div className="mt-1 text-sm font-semibold text-slate-300">{data.tenant.name} · 演示环境</div>
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><i className="live-dot" />模拟今天 {computed.asOf}（开通第 90 天）</span>
            <span>事件 {folded.eventCount} 条</span>
            <span>客户 {data.customers.length} 家</span>
          </p>
        </header>

        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold text-slate-400">三个免密演示身份 · 一键切换</h2>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {roles.map((r) => (
              <Link key={r.to} to={r.to} className="glass glass-hover rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${r.grad} text-lg font-extrabold`}>
                    {r.name[0]}
                  </span>
                  <div>
                    <div className="text-sm font-bold">{r.name} · {r.role}</div>
                    <div className="text-[10px] text-slate-400">{r.desc}</div>
                  </div>
                </div>
                <p className="mt-2.5 border-t border-white/5 pt-2 text-[10px] leading-4 text-slate-500">{r.hint}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="glass mb-3 rounded-2xl p-4">
          <h2 className="mb-2 text-xs font-bold text-slate-400">六态存量（实时折算）</h2>
          <div className="grid grid-cols-6 gap-1.5 text-center">
            {FUNNEL_STAGES.map((s) => (
              <div key={s} className="rounded-lg bg-white/5 py-2">
                <div className="text-lg font-extrabold tabular-nums">{folded.stocks[s]}</div>
                <div className="text-[9px] text-slate-500">{STAGE_LABEL[s]}</div>
              </div>
            ))}
          </div>
          <dl className="mt-3 space-y-1 border-t border-white/5 pt-2.5 text-xs">
            <Row k="样品池本月进入 / 转出" v={`${jun.sample.entered} / ${jun.sample.exited}（${fmtPct1(jun.sample.exited / jun.sample.entered)}，上月 ${fmtPct1(may.sample.exited / may.sample.entered)}）`} />
            <Row k="月回款" v={fmtYuan(computed.company.monthRevenue)} />
            <Row k="平均客单 aov" v={aov == null ? '—' : `¥${aov.toFixed(2)}（累计回款 ÷ ${folded.totalDealCnt}）`} />
            <Row k="团队 labor_roi" v={fmtRoi2(folded.teamLaborRoi)} />
            <Row k="本月流失" v={`${folded.monthlyLossTotal[computed.ym] ?? 0} 家`} />
          </dl>
        </section>

        <Link
          to="/script"
          className="glass glass-hover mb-3 block rounded-2xl border-amber-400/30 px-4 py-3 text-sm font-bold text-amber-300"
        >
          📖 演示脚本（商务 10 分钟动线与话术提词） →
        </Link>

        <button
          onClick={reset}
          className="w-full rounded-2xl border border-red-400/30 bg-red-500/10 py-3 text-sm font-bold text-red-300 active:bg-red-500/20"
        >
          一键重置演示数据
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-semibold tabular-nums text-slate-200">{v}</dd>
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
        <Route path="/rookie" element={<RookiePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <FloatingControls />
    </AppStoreProvider>
  );
}
