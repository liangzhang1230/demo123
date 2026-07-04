/**
 * 管理端决策看板（看板章【定稿】五区＋底部固定条）· P9 暗色驾驶舱升级。
 * 死线①：看板不产口径——所有数字直读 computeAll/engine 既有派生位；图表仅渲染。
 * 死线②：十秒答案、三击到底——每格数据可点，DrillSheet 下钻源明细。
 * 三级裁剪与货架诚实法则不变：未购包上锁显 —＋价值语，绝不预演付费结论。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import {
  absRate, DASH, daysInMonth, fmtPct0, fmtPct1, fmtRoi2, fmtWan, fmtYuan,
  paceRate, sevenLevel, stayDays, tenureDays,
} from '../domain/engine';
import { activityMatrix, dailyRevenueSeries, monthOrders } from '../domain/compute';
import { FUNNEL_STAGES, STAGE_LABEL } from '../domain/types';
import { ExampleBadge } from './ui';
import {
  BCard, BoardShell, DarkLevelChip, DarkPaceBar, DrillRow, DrillSheet, Kpi, Medal, TL, TrendPill,
} from './board';
import { FunnelBar, HeatGrid, MonthBars, Spark } from './charts';

type Drill =
  | { kind: 'revenue' } | { kind: 'net' } | { kind: 'roi' } | { kind: 'deals' }
  | { kind: 'pace' } | { kind: 'stall' } | { kind: 'member'; id: string } | null;

const STAGE_GRAD: Record<string, string> = {
  lead: 'linear-gradient(90deg,#06b6d4,#22d3ee)',
  intent: 'linear-gradient(90deg,#6366f1,#818cf8)',
  sample: 'linear-gradient(90deg,#8b5cf6,#a78bfa)',
  signed: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
  deal: 'linear-gradient(90deg,#10b981,#34d399)',
  lost: 'linear-gradient(90deg,#475569,#64748b)',
};

export function ManagementBoard({ role }: { role: 'boss' | 'manager' }) {
  const { data, computed, unlocked, setUnlocked } = useApp();
  const [toast, setToast] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  const [drill, setDrill] = useState<Drill>(null);

  const managerId = 'liumin';
  const deptId = role === 'manager' ? (data.people.find((p) => p.id === managerId)?.deptId ?? 'd1') : null;
  const dept = deptId ? computed.depts[deptId] : null;
  const deptName = deptId ? data.departments.find((d) => d.id === deptId)?.name : null;

  const members = useMemo(
    () => data.people.filter((p) => p.role !== 'boss' && (deptId ? p.deptId === deptId : true)),
    [data.people, deptId],
  );
  const memberIdSet = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // —— 范围取数（三级裁剪）——
  const scopeMonthRevenue = dept ? dept.monthRevenue : computed.company.monthRevenue;
  const scopeMonthNet = dept ? dept.monthNet : computed.company.monthNet;
  const scopeRoi = dept ? dept.roi : computed.folded.teamLaborRoi;
  const scopeFirstDeals = dept ? dept.monthFirstDeals : computed.company.monthFirstDeals;
  const scopeRepeatOrders = dept ? dept.monthRepeatOrders : computed.company.monthRepeatOrders;
  const scopeRepeatCusts = dept ? dept.monthRepeatCusts : computed.company.monthRepeatCusts;
  const scopeRevenueMom = dept ? dept.revenueMom : computed.company.revenueMom;
  const scopeNetMom = dept ? dept.netMom : computed.company.netMom;
  const scopeStall = dept ? dept.stall : computed.company.stallTotal;
  const scopeTarget = dept ? data.targets.deptMonthlyRevenue[dept.id] : data.targets.companyMonthlyRevenue;
  const scopeStocks = dept ? dept.stocks : computed.folded.stocks;

  const elapsed = Number(computed.asOf.slice(8, 10));
  const totalDays = daysInMonth(computed.ym);
  const pace = paceRate(scopeMonthRevenue, scopeTarget, elapsed, totalDays);
  const paceLevel = sevenLevel(pace);
  const [momPrev, momCur] = computed.company.momPair;
  const momLabel = `完整月环比 ${Number(momCur.slice(5, 7))}月 vs ${Number(momPrev.slice(5, 7))}月`;

  const idleDaysOf = (id: string) => {
    const last = computed.folded.perOwner[id]?.lastEventDate;
    if (!last) return null;
    return Math.round((Date.parse(computed.asOf) - Date.parse(last)) / 86400000);
  };

  // 月度序列（范围内）：回款/净利 3 个月
  const monthsKeys = [momPrev, momCur, computed.ym];
  const revSeries = monthsKeys.map((m) =>
    dept
      ? dept.memberIds.reduce((a, id) => a + (computed.owners[id]?.revenueByMonth[m] ?? 0), 0)
      : computed.folded.revenueByMonth[m] ?? 0,
  );
  const netSeries = monthsKeys.map((m) => computed.company.netByMonth[m] ?? 0); // 净利序列仅公司口径（主管版隐藏净利卡趋势）
  const daily14 = useMemo(
    () => dailyRevenueSeries(data, computed.asOf, 14, deptId ? memberIdSet : undefined),
    [data, computed.asOf, deptId, memberIdSet],
  );

  // 今日未确认（应确认口径 §6.9）
  const unconfirmedToday = useMemo(() => {
    const confirmedSet = new Set(data.confirmations?.[computed.asOf] ?? []);
    return members.filter(
      (p) => data.events.some((e) => e.ownerId === p.id && e.date === computed.asOf) && !confirmedSet.has(p.id),
    );
  }, [data, computed.asOf, members]);
  const activeTodayCount = members.filter((p) => data.events.some((e) => e.ownerId === p.id && e.date === computed.asOf)).length;

  // —— 区一 · 今日一件事（待办 ＞ 诊断，首位即停）——
  const arbitration = useMemo(() => {
    const items: { kind: '待办' | '诊断'; text: string; tone: 'red' | 'orange' | 'gray' }[] = [];
    if (unconfirmedToday.length > 0) {
      items.push({
        kind: '待办',
        text: `今日 ${unconfirmedToday.length} 人有单据待确认（23:00 前）：${unconfirmedToday.slice(0, 3).map((p) => p.name).join('·')}${unconfirmedToday.length > 3 ? ' 等' : ''}`,
        tone: 'orange',
      });
    }
    if (scopeStall.dying > 0) {
      items.push({
        kind: '诊断',
        text: `停滞红色积压：${scopeStall.dying} 家客户濒死（占在管 ${fmtPct0(scopeStall.dying / Math.max(1, dept ? dept.inManaged : computed.company.inManaged))}）——抢救或放掉，今天该拍板`,
        tone: 'red',
      });
    }
    if (scopeStall.warning > 0) {
      items.push({ kind: '诊断', text: `橙色停滞 ${scopeStall.warning} 家明显卡住，建议主管今日带教跟进`, tone: 'orange' });
    }
    const lossTop = computed.company.lossReasonTop;
    if (!deptId && lossTop) {
      items.push({
        kind: '诊断',
        text: `本月流失 ${computed.folded.monthlyLossTotal[computed.ym] ?? 0} 家，首要流失因「${lossTop.reason}」占 ${fmtPct0(lossTop.share)}`,
        tone: 'gray',
      });
    }
    return items;
  }, [scopeStall, computed, deptId, dept, unconfirmedToday]);

  // —— 区四 · 团队一屏（紧急度分诊）——
  const teamRows = useMemo(() => {
    return members
      .map((p) => {
        const oc = computed.owners[p.id];
        const roi = computed.folded.perOwnerRoi[p.id] ?? null;
        const target = data.targets.personMonthlyRevenue[p.id];
        const pPace = paceRate(oc?.monthRevenue ?? 0, target, elapsed, totalDays);
        return {
          p, roi,
          rankTotal: computed.rankings.totalByOwner[p.id],
          rankDept: computed.rankings.deptByOwner[p.id],
          monthRevenue: oc?.monthRevenue ?? 0,
          stall: oc?.stall ?? { dying: 0, warning: 0, watch: 0 },
          idle: idleDaysOf(p.id),
          tenure: p.hireDate ? tenureDays(p.hireDate, computed.asOf) : null,
          pace: pPace,
          paceLevel: sevenLevel(pPace),
        };
      })
      .sort(
        (a, b) =>
          b.stall.dying - a.stall.dying ||
          b.stall.warning - a.stall.warning ||
          (a.roi ?? Infinity) - (b.roi ?? Infinity),
      );
  }, [members, computed, data.targets, elapsed, totalDays]);

  // 热力图（近 7 天业务事件）
  const heat = useMemo(() => activityMatrix(data, computed.asOf, 7, members.map((m) => m.id)), [data, computed.asOf, members]);
  const heatCols = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(computed.asOf) - (6 - i) * 86400000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  });

  const openDays = Math.round((Date.parse(computed.asOf) - Date.parse(data.openDate)) / 86400000) + 1;
  const monthLabels = monthsKeys.map((m) => `${Number(m.slice(5, 7))}月`);

  const packs = [
    { key: 'pack1', name: '操盘包① · 人效操盘包', value: '这些人值不值、该招该汰该扩——招·用·汰·扩一条链', to: '/sample/pack1', job: '今日作业：王五每月净烧 ¥8,900——止血建议已就绪', tl: TL.red },
    { key: 'pack2', name: '操盘包② · 增长操盘包', value: '下一笔钱在哪、现金什么时候回——找钱四步闭环', to: '/sample/pack2', job: '今日作业：样品→签约卡点，估算卡着 ¥49.6万', tl: TL.cyan },
    { key: 'pack3', name: '操盘包③ · 销冠 DNA 克隆引擎', value: '她凭什么是销冠？她走了怎么办？——把销冠战法变成公司资产', to: '/sample/pack3', job: '今日作业：赵敏首要带教点＝样品→签约（对标王丽）', tl: TL.purple },
    { key: 'pack4', name: '操盘包④ · 经营黑匣子', value: '我是怎么走到今天的、我的拍板值不值——决策→结果因果回放', to: '/sample/pack4', job: '本月作业：6 月航迹已生成——B 品类提价回放', tl: TL.amber },
    { key: 'library', name: '经营智库', value: '定薪建议：底薪该给多少、提成该怎么设——用同行数据答', to: '/sample/library', job: '定薪建议：底薪带 ¥4,800–6,500 已就绪', tl: TL.green },
  ];

  const jun = computed.folded.monthlyPoolFlow[computed.ym];
  const peopleName = (id: string) => data.people.find((p) => p.id === id)?.name ?? id;

  return (
    <BoardShell
      title={role === 'boss' ? `${data.tenant.bossName}（老板）· 决策看板` : `刘敏（主管）· ${deptName}`}
      subtitle={
        <>
          <span>{data.tenant.name}</span>
          <span>模拟今天 {computed.asOf} · 开通第 {openDays} 天</span>
          <span className="flex items-center gap-1"><i className="live-dot" />事件流实时折算</span>
        </>
      }
    >
      {/* AI 操盘手晨话（静态位：白话原语回退层） */}
      {role === 'boss' && (
        <div className="glass topline rounded-2xl p-4" style={{ ['--tl' as never]: TL.purple } as CSSProperties}>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-lg">🎙</span>
            <div>
              <p className="text-sm leading-6 text-slate-100">
                陈总早。今天的火我已替你排好序：先看停滞红色积压，再看样品池的转出率——它掉得不正常。
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">上线后由 AI 销售操盘手按你的真实数据每日生成</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        {/* 区一 · 今日一件事 */}
        <BCard title={`区一 · 今日一件事${deptId ? '（本部门）' : ''}`} icon="🎯" tl={TL.red} className={role === 'boss' ? 'lg:col-span-7' : 'lg:col-span-12'}>
          {arbitration.length === 0 ? (
            <p className="text-sm text-slate-400">今天没有火，去看看钱——先看区二心跳。</p>
          ) : (
            <div>
              <div
                className={`rounded-xl border p-3 text-sm leading-6 ${
                  arbitration[0].tone === 'red'
                    ? 'border-red-500/30 bg-red-500/10 text-red-200'
                    : arbitration[0].tone === 'orange'
                      ? 'border-orange-500/30 bg-orange-500/10 text-orange-200'
                      : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                <span className="mr-1.5 rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-bold">{arbitration[0].kind}</span>
                {arbitration[0].text}
              </div>
              <div className="mt-2 flex items-center justify-between">
                {arbitration.length > 1 ? (
                  <button className="text-xs text-slate-400 underline-offset-2 hover:text-indigo-300 hover:underline" onClick={() => setShowRest((v) => !v)}>
                    今日其余 {arbitration.length - 1} 件 {showRest ? '▲' : '▼'}
                  </button>
                ) : <span />}
                <button className="text-xs text-indigo-300 hover:underline" onClick={() => setDrill({ kind: 'stall' })}>
                  停滞明细 ›
                </button>
              </div>
              {showRest &&
                arbitration.slice(1).map((it, i) => (
                  <div key={i} className="mt-1.5 rounded-lg bg-white/5 p-2 text-xs text-slate-300">
                    <span className="mr-1 font-semibold text-slate-200">{it.kind}</span>
                    {it.text}
                  </div>
                ))}
            </div>
          )}
        </BCard>

        {/* 销售早报样卡（必发核心 §10.4.1，实时重算） */}
        {role === 'boss' && (
          <BCard
            title={<>📨 销售早报 · {Number(computed.asOf.slice(5, 7))}月{Number(computed.asOf.slice(8, 10))}日</>}
            tl={TL.cyan}
            right={<span className="text-[10px] text-slate-500">工作日 8:00 推送 · 演示为实时刷新</span>}
            className="lg:col-span-5"
          >
            <div className="space-y-1.5 text-xs leading-5 text-slate-300">
              <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
                确认：已确认 {activeTodayCount - unconfirmedToday.length} ／ 未确认 {unconfirmedToday.length}
                {unconfirmedToday.length > 0 && `（${unconfirmedToday.slice(0, 3).map((p) => p.name).join('·')}${unconfirmedToday.length > 3 ? ' 等' : ''}）`}
              </div>
              <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
                本月人效比 <b className="text-slate-100">{fmtRoi2(scopeRoi)}</b> ｜ 回款达标 <b className="text-slate-100">{fmtPct0(absRate(scopeMonthRevenue, scopeTarget))}</b> ｜ 剩 {totalDays - elapsed} 天
              </div>
              <div className="rounded-lg bg-white/5 px-2.5 py-1.5">停滞：{scopeStall.dying} 个濒死客户待处理</div>
              <div className="text-sky-400">打开系统 →</div>
            </div>
          </BCard>
        )}
      </div>

      {/* 区二 · 经营心跳（固定 6 数 · 数值＋白话＋趋势＋下钻） */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-200">区二 · 经营心跳{deptId ? '（本部门汇总）' : ''}</h2>
          <span className="text-[10px] text-slate-500">固定 6 数 · 每格可点下钻</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
          <Kpi
            icon="📈" label="本月净利" tl={TL.green} valueClass="text-emerald-300"
            value={fmtWan(scopeMonthNet)}
            trend={<TrendPill value={scopeNetMom} note={momLabel} />}
            plain={`毛利 − 人力成本 · ${momLabel}`}
            spark={!deptId ? <Spark data={netSeries} stroke="#34d399" fillFrom="rgba(52,211,153,0.3)" /> : undefined}
            onClick={() => setDrill({ kind: 'net' })}
          />
          <Kpi
            icon="💰" label="本月回款" tl={TL.cyan} valueClass="text-cyan-300"
            value={fmtWan(scopeMonthRevenue)}
            trend={<TrendPill value={scopeRevenueMom} note={momLabel} />}
            plain={`现金进账 ${fmtWan(scopeMonthRevenue)} · ${momLabel}`}
            spark={<Spark data={revSeries} stroke="#22d3ee" fillFrom="rgba(34,211,238,0.3)" />}
            onClick={() => setDrill({ kind: 'revenue' })}
          />
          <Kpi
            icon="⚙️" label={deptId ? '部门 labor_roi' : '团队 labor_roi'} tl={TL.indigo} valueClass="grad-text"
            value={fmtRoi2(scopeRoi)}
            plain={scopeRoi != null ? `每付 1 元工资赚回 ${fmtRoi2(scopeRoi)} 元（Σ净利÷Σ成本）` : '—（未设成本）'}
            onClick={() => setDrill({ kind: 'roi' })}
          />
          <Kpi
            icon="🤝" label="本月成交" tl={TL.purple} valueClass="text-purple-300"
            value={`${scopeFirstDeals + scopeRepeatOrders} 单`}
            plain={`新客 ${scopeFirstDeals} ＋ 复购 ${scopeRepeatOrders} 单（${scopeRepeatCusts} 家）`}
            onClick={() => setDrill({ kind: 'deals' })}
          />
          <Kpi
            icon="🎯" label="目标进度 pace" tl={TL.amber}
            value={
              <span className="flex items-center gap-1.5">
                {fmtPct0(pace)}
                <DarkLevelChip level={paceLevel} />
              </span>
            }
            plain={
              <span className="block">
                <DarkPaceBar rate={pace} level={paceLevel} />
                <span className="mt-1 block">
                  {pace == null ? '目标未设' : pace >= 1 ? `进度 ${fmtPct0(pace)}，跑在日历前面` : `进度 ${fmtPct0(pace)}，落后于日历`}
                  （月目标 {fmtWan(scopeTarget)}）
                </span>
              </span>
            }
            onClick={() => setDrill({ kind: 'pace' })}
          />
          {unlocked ? (
            <Kpi
              icon="🔮" label="30 天现金前瞻" tl={TL.pink} valueClass="text-pink-300"
              value={<span className="flex items-center gap-1.5">¥17.0万 <ExampleBadge inline /></span>}
              plain="未来 30 天预计回款（估算 · 示例数据）"
            />
          ) : (
            <Kpi
              icon="🔮" label="30 天现金前瞻" tl={TL.slate} locked
              value={DASH}
              plain="开通增长操盘包，这里每天预告未来 30 天回款（估算）🔑"
            />
          )}
        </div>
      </div>

      {/* 区三 · 钱事分诊条 */}
      <BCard
        title="区三 · 钱事分诊条"
        icon="🩺"
        tl={TL.amber}
        right={unlocked ? <ExampleBadge inline /> : <span className="text-[10px] text-slate-500">三段读包结论 · 未购显 —</span>}
      >
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3">
            <div className="text-[11px] font-bold text-red-400">在漏 {unlocked ? '' : '🔒'}</div>
            {unlocked ? (
              <div className="mt-1 text-sm font-extrabold leading-5 text-slate-100">
                ¥8,900/月<div className="text-[10px] font-normal text-slate-400">止血分诊 · 分列</div>
                ¥49.6万<div className="text-[10px] font-normal text-slate-400">卡点卡住营收（估算）</div>
              </div>
            ) : (
              <>
                <div className="mt-1 text-xl font-extrabold text-slate-600">{DASH}</div>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">开通人效操盘包，这里每天告诉你在漏多少钱</p>
              </>
            )}
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3">
            <div className="text-[11px] font-bold text-amber-400">待拿 {unlocked ? '' : '🔒'}</div>
            {unlocked ? (
              <div className="mt-1 text-sm font-extrabold leading-5 text-slate-100">
                ¥23.8万<div className="text-[10px] font-normal text-slate-400">38 家休眠唤醒估值（估算）</div>
              </div>
            ) : (
              <>
                <div className="mt-1 text-xl font-extrabold text-slate-600">{DASH}</div>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">开通增长操盘包，这里估算沉睡金矿与超期管道</p>
              </>
            )}
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3">
            <div className="text-[11px] font-bold text-emerald-400">在赚 {unlocked ? '' : '🔒'}</div>
            {unlocked ? (
              <div className="mt-1 text-sm font-extrabold leading-5 text-slate-100">
                7 / 10 人已回本<div className="text-[10px] font-normal text-slate-400">＋本月里程碑：回款新高</div>
              </div>
            ) : (
              <>
                <div className="mt-1 text-xl font-extrabold text-slate-600">{DASH}</div>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">开通人效操盘包，这里显示已回本人数与里程碑</p>
              </>
            )}
          </div>
        </div>
      </BCard>

      {/* 经营全景行：漏斗 / 月度趋势 / 流失归因（全部实算） */}
      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        <BCard title="六态漏斗全景" icon="🔻" tl={TL.cyan} className="lg:col-span-5"
          right={<button className="text-[10px] text-indigo-300 hover:underline" onClick={() => setDrill({ kind: 'stall' })}>停滞明细 ›</button>}
        >
          <div className="space-y-1.5">
            {FUNNEL_STAGES.map((s) => (
              <FunnelBar
                key={s}
                label={STAGE_LABEL[s]}
                count={scopeStocks[s]}
                pct={scopeStocks[s] / Math.max(1, Math.max(...FUNNEL_STAGES.map((x) => scopeStocks[x])))}
                gradient={STAGE_GRAD[s]}
                right={
                  s === 'lead' ? fmtPct1(computed.company.conv.lead)
                  : s === 'intent' ? fmtPct1(computed.company.conv.intent)
                  : s === 'sample' ? fmtPct1(computed.company.conv.sample)
                  : s === 'signed' ? fmtPct1(computed.company.conv.signed)
                  : ''
                }
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-slate-400">右列＝各池累计转化率（§6.3 累计制）</span>
            {jun && jun.sample.entered > 0 && (
              <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 font-semibold text-red-300">
                样品池本月 {jun.sample.entered} 进 / {jun.sample.exited} 出（{fmtPct1(jun.sample.exited / jun.sample.entered)}）
              </span>
            )}
          </div>
        </BCard>

        <BCard title="月度经营趋势" icon="📊" tl={TL.indigo} className="lg:col-span-4"
          right={<div className="flex gap-1"><TrendPill value={scopeRevenueMom} note="回款环比" /><TrendPill value={scopeNetMom} note="净利环比" /></div>}
        >
          <MonthBars
            months={monthLabels}
            a={revSeries}
            aLabel={`${deptId ? '本部门' : '公司'}月回款（当月进行中）`}
            aColor="#38bdf8"
            bRows={
              deptId
                ? undefined
                : [
                    { label: '净利', values: netSeries.map((v) => fmtWan(v)), color: '#34d399' },
                    { label: '人力成本', values: monthsKeys.map((m) => fmtWan(computed.company.laborByMonth[m] ?? 0)), color: '#f87171' },
                  ]
            }
          />
        </BCard>

        <BCard title="本月流失归因" icon="🕳️" tl={TL.red} className="lg:col-span-3">
          {(() => {
            const lossMap = computed.folded.lossReasonByMonth[computed.ym] ?? {};
            const total = computed.folded.monthlyLossTotal[computed.ym] ?? 0;
            const rows = Object.entries(lossMap).sort((a, b) => b[1] - a[1]).slice(0, 4);
            if (total === 0) return <p className="py-6 text-center text-xs text-slate-500">本月暂无流失</p>;
            return (
              <>
                <div className="mb-2 text-2xl font-extrabold text-red-300">{total} 家</div>
                <div className="space-y-1.5">
                  {rows.map(([reason, n], i) => (
                    <div key={reason} className="flex items-center gap-2 text-[11px]">
                      <span className="w-14 shrink-0 text-slate-400">{reason}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="bar-anim h-full rounded-full"
                          style={{ width: `${(n / total) * 100}%`, background: i === 0 ? TL.red : TL.slate }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right tabular-nums text-slate-300">{n} · {fmtPct0(n / total)}</span>
                    </div>
                  ))}
                </div>
                <Link to="/sample/pack2" className="mt-2.5 block text-[10px] text-slate-500 hover:text-indigo-300">
                  🔒 深度归因（与卡点交叉、建议动作）随增长操盘包开通 ›
                </Link>
              </>
            );
          })()}
        </BCard>
      </div>

      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        {/* 区四 · 团队一屏 */}
        <BCard
          title={`区四 · 团队一屏${deptId ? `（${deptName}）` : ''}`}
          icon="👥"
          tl={TL.indigo}
          className="lg:col-span-7"
          right={<span className="text-[10px] text-slate-500">紧急度分诊 · 红告警前置 · 点行看单人卡</span>}
        >
          <div className="divide-y divide-white/5">
            {teamRows.map((r) => (
              <div
                key={r.p.id}
                className="cursor-pointer rounded-lg px-1 py-2 transition-colors hover:bg-white/5"
                onClick={() => setDrill({ kind: 'member', id: r.p.id })}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                    r.stall.dying > 0 || (r.idle != null && r.idle >= 30)
                      ? 'bg-gradient-to-br from-red-500/80 to-red-700/80'
                      : (r.rankTotal === 1 ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-amber-950' : 'bg-gradient-to-br from-indigo-500/70 to-cyan-500/60')
                  }`}>
                    {r.p.name[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-100">
                      {r.p.name}
                      {r.p.role === 'manager' && <span className="text-[10px] font-normal text-slate-500">主管</span>}
                      {!deptId && (
                        <span className="text-[10px] font-normal text-slate-500">
                          {data.departments.find((d) => d.id === r.p.deptId)?.name.replace('华东', '')}
                        </span>
                      )}
                      {r.tenure != null && r.tenure <= 90 && (
                        <span className="rounded bg-blue-500/20 px-1 text-[10px] font-medium text-blue-300">新人 · 第 {r.tenure} 天</span>
                      )}
                      {r.idle != null && r.idle >= 30 && (
                        <span className="rounded bg-red-500/20 px-1 text-[10px] font-bold text-red-400">{r.idle} 天零业务事件</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8 sm:w-32">
                        {r.pace != null && r.paceLevel && (
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.pace * 100)}%`, background: 'linear-gradient(90deg,#6366f1,#22d3ee)' }} />
                        )}
                      </div>
                      <span className="text-[9px] tabular-nums text-slate-500">目标 pace {fmtPct0(r.pace)}</span>
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-4 items-center gap-2 text-right">
                    <div>
                      <div className={`text-sm font-bold tabular-nums ${r.roi != null && r.roi < 0 ? 'text-red-400' : 'text-slate-100'}`}>{fmtRoi2(r.roi)}</div>
                      <div className="text-[9px] text-slate-500">labor_roi</div>
                    </div>
                    <div className="flex justify-end"><Medal n={deptId ? r.rankDept : r.rankTotal} /></div>
                    <div className="w-20">
                      <div className="text-[13px] font-bold tabular-nums text-cyan-200">{fmtYuan(r.monthRevenue)}</div>
                      <div className="text-[9px] text-slate-500">本月回款</div>
                    </div>
                    <div className="flex justify-end gap-1 text-[10px] tabular-nums">
                      {r.stall.dying > 0 && <span className="rounded bg-red-500/20 px-1 font-bold text-red-300">{r.stall.dying}</span>}
                      {r.stall.warning > 0 && <span className="rounded bg-orange-500/20 px-1 text-orange-300">{r.stall.warning}</span>}
                      {r.stall.watch > 0 && <span className="rounded bg-yellow-500/20 px-1 text-yellow-300">{r.stall.watch}</span>}
                      {r.stall.dying + r.stall.warning + r.stall.watch === 0 && <span className="text-slate-600">0</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500">回本状态列与量质象限列随人效/销冠 DNA 包开通后点亮（未购隐藏）。</p>
        </BCard>

        {/* 团队活跃热力图（近 7 天业务事件，实算） */}
        <BCard title="团队 7 日活跃热力图" icon="🔥" tl={TL.green} className="lg:col-span-5"
          right={<span className="text-[10px] text-slate-500">颜色越深＝业务事件越多</span>}
        >
          <HeatGrid
            cols={heatCols}
            rows={heat.map((h) => ({
              label: peopleName(h.ownerId),
              alert: (idleDaysOf(h.ownerId) ?? 0) >= 30,
              cells: h.cells.map((v, i) => ({ v, hint: `${heatCols[i]} · ${v} 条业务事件` })),
            }))}
          />
          <p className="mt-2 text-[10px] text-slate-500">王五整行熄灭——这就是「工资照付、业务归零」的样子。</p>
        </BCard>
      </div>

      {/* 区五 · 武器坞 */}
      <BCard
        title="区五 · 武器坞"
        icon="🛡️"
        tl={TL.purple}
        right={
          role === 'boss' ? (
            <button
              data-testid="unlock-toggle"
              onClick={() => setUnlocked(!unlocked)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition-all ${
                unlocked
                  ? 'bg-amber-500/20 text-amber-300 ring-amber-400/50'
                  : 'bg-gradient-to-r from-indigo-500/30 to-cyan-500/30 text-indigo-200 ring-indigo-400/40 hover:ring-indigo-300'
              }`}
            >
              {unlocked ? '⏻ 一键回锁（演示专属）' : '✨ 一键点亮全家桶（演示专属）'}
            </button>
          ) : (
            <span className="text-[10px] text-slate-500">货架 · 锁卡安静陈列</span>
          )
        }
      >
        {role === 'boss' ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {packs.map((pk) => (
              <Link
                key={pk.key}
                to={pk.to}
                className={`glass-hover topline relative block rounded-xl border p-3 ${
                  unlocked ? 'border-amber-400/40 bg-amber-500/[0.08]' : 'border-dashed border-white/20 bg-white/[0.03]'
                }`}
                style={{ ['--tl' as never]: unlocked ? TL.amber : pk.tl } as CSSProperties}
              >
                {unlocked ? (
                  <>
                    <div className="pr-14 text-[13px] font-bold text-slate-100">✨ {pk.name}</div>
                    <ExampleBadge />
                    <p className="mt-1 text-[11px] leading-4 text-slate-300">{pk.job}</p>
                    <div className="mt-2 text-[10px] font-semibold text-amber-300">点开查看样例长页 →</div>
                  </>
                ) : (
                  <>
                    <div className="text-[13px] font-bold text-slate-200">🔒 {pk.name}</div>
                    <p className="mt-1 text-[11px] leading-4 text-slate-400">{pk.value}</p>
                    <div className="mt-2 inline-flex rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium leading-3 text-emerald-300 ring-1 ring-emerald-400/30">
                      数据就绪：该演示租户已沉淀 {computed.folded.totalDealCnt} 笔成交 / {openDays} 天数据
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-900"
                        onClick={(e) => {
                          e.preventDefault();
                          setToast('试看申请已记录——上线后由商务开通');
                        }}
                      >
                        试看申请
                      </button>
                      <span className="text-[10px] text-slate-500">点卡片看样例 →</span>
                    </div>
                  </>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">（主管版摘除购买位——已购包的本部门作业行将在此显示）</p>
        )}
        {/* 功能位活卡 */}
        <div className="mt-2.5 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
            <span className="font-medium text-slate-200">✅ 停滞预警</span>
            <span className="flex gap-1 tabular-nums text-[10px]">
              <span className="rounded bg-red-500/20 px-1 font-bold text-red-300">{scopeStall.dying}</span>
              <span className="rounded bg-orange-500/20 px-1 text-orange-300">{scopeStall.warning}</span>
              <span className="rounded bg-yellow-500/20 px-1 text-yellow-300">{scopeStall.watch}</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
            <span className="shrink-0 font-medium text-slate-200">✅ 悬赏令</span>
            <span className="truncate text-slate-400">{data.bounty}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
            <span className="font-medium text-slate-200">✅ 销售早报</span>
            <span className="text-slate-400">工作日 8:00 推送</span>
          </div>
        </div>
      </BCard>

      {/* 底部固定条 */}
      <BCard tl={TL.slate} className="!py-3">
        <div className="flex flex-col gap-1.5 text-xs text-slate-400">
          <div>
            <span className="font-semibold text-slate-300">筛人漏斗：</span>
            {(() => {
              const rookies = members.filter((p) => p.hireDate);
              if (rookies.length === 0) return '当前无筛选期新人';
              return rookies
                .map((p) => {
                  const t = tenureDays(p.hireDate!, computed.asOf);
                  const deals = computed.owners[p.id]?.monthFirstDeals ?? 0;
                  return `${p.name} · 筛选中第 ${t} 天（窗口 90 天）· 本月新客 ${deals} 单`;
                })
                .join('；');
            })()}
          </div>
          {role === 'boss' && (
            <p className="text-[10px] text-slate-500">
              系统投入产出参照 🔒：未购人效操盘包——开通后此处按月显示「系统费 vs 同期净利」诚实参照。
            </p>
          )}
        </div>
      </BCard>

      {/* ===== 下钻面板（死线②：任何数字 ≤3 击到明细） ===== */}
      <DrillSheet open={drill?.kind === 'revenue'} title={`本月回款下钻 · ${fmtWan(scopeMonthRevenue)}`} onClose={() => setDrill(null)}>
        <div className="mb-3 rounded-xl bg-white/5 p-2.5">
          <div className="mb-1 text-[10px] text-slate-500">近 14 天逐日回款（账务日口径）</div>
          <Spark data={daily14.map((d) => d.value)} w={440} h={64} stroke="#22d3ee" fillFrom="rgba(34,211,238,0.3)" />
          <div className="mt-1 flex justify-between text-[9px] text-slate-500">
            <span>{daily14[0]?.date.slice(5)}</span><span>{daily14[daily14.length - 1]?.date.slice(5)}</span>
          </div>
        </div>
        <div className="space-y-1">
          {[...members]
            .sort((a, b) => (computed.owners[b.id]?.monthRevenue ?? 0) - (computed.owners[a.id]?.monthRevenue ?? 0))
            .map((p) => (
              <DrillRow key={p.id} l={p.name} sub={`累计 ${fmtYuan(computed.folded.perOwner[p.id]?.revenue ?? 0)}`} r={fmtYuan(computed.owners[p.id]?.monthRevenue ?? 0)} />
            ))}
        </div>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'net'} title="本月净利下钻（毛利 − 人力成本）" onClose={() => setDrill(null)}>
        <div className="space-y-1">
          {monthsKeys.map((m, i) => (
            <DrillRow
              key={m}
              l={`${monthLabels[i]}${i === 2 ? '（进行中）' : ''}`}
              sub={`毛利 ${fmtWan(computed.company.grossByMonth[m] ?? 0)} − 人力 ${fmtWan(computed.company.laborByMonth[m] ?? 0)}`}
              r={<span className={((computed.company.netByMonth[m] ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300')}>{fmtWan(computed.company.netByMonth[m] ?? 0)}</span>}
            />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">毛利＝Σ成交单回款 × 品类快照毛利率（31%）；人力成本＝月固定项日摊逐日累计（§8.1）。</p>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'roi'} title="labor_roi 下钻（累计净利 ÷ 累计成本）" onClose={() => setDrill(null)}>
        <div className="space-y-1">
          {[...members]
            .sort((a, b) => (computed.folded.perOwnerRoi[b.id] ?? -99) - (computed.folded.perOwnerRoi[a.id] ?? -99))
            .map((p) => {
              const roi = computed.folded.perOwnerRoi[p.id];
              return (
                <DrillRow
                  key={p.id}
                  l={p.name}
                  sub={`累计成本 ${fmtYuan(Math.round(computed.folded.perOwnerLaborCost[p.id] ?? 0))}`}
                  r={<span className={roi != null && roi < 0 ? 'text-red-300' : 'text-emerald-300'}>{fmtRoi2(roi)}</span>}
                />
              );
            })}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">团队值＝先汇总再相除（严禁对个人比值求平均——辛普森悖论防线 §6.6）。</p>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'deals'} title={`本月成交单下钻 · ${scopeFirstDeals + scopeRepeatOrders} 单`} onClose={() => setDrill(null)}>
        <div className="max-h-[46dvh] space-y-1 overflow-y-auto">
          {monthOrders(data, computed.asOf, deptId ? memberIdSet : undefined).slice(0, 40).map((o, i) => (
            <DrillRow
              key={i}
              l={<span>{o.customer} <span className={`ml-1 rounded px-1 text-[9px] ${o.isRepeat ? 'bg-purple-500/20 text-purple-300' : 'bg-emerald-500/20 text-emerald-300'}`}>{o.isRepeat ? '复购' : '首购'}</span></span>}
              sub={`${o.date} · ${peopleName(o.ownerId)}`}
              r={fmtYuan(o.amount)}
            />
          ))}
        </div>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'pace'} title="目标进度下钻（pace＝实际 ÷ 应完成量）" onClose={() => setDrill(null)}>
        <div className="space-y-1">
          {(deptId ? [dept!] : data.departments.map((d) => computed.depts[d.id])).map((d) => {
            const t = data.targets.deptMonthlyRevenue[d.id];
            const p = paceRate(d.monthRevenue, t, elapsed, totalDays);
            return (
              <DrillRow
                key={d.id}
                l={data.departments.find((x) => x.id === d.id)?.name}
                sub={`实际 ${fmtWan(d.monthRevenue)} / 目标 ${fmtWan(t)}`}
                r={<span className="flex items-center gap-1.5">{fmtPct0(p)} <DarkLevelChip level={sevenLevel(p)} /></span>}
              />
            );
          })}
          {[...members]
            .sort((a, b) => (computed.owners[b.id]?.monthRevenue ?? 0) - (computed.owners[a.id]?.monthRevenue ?? 0))
            .map((p) => {
              const t = data.targets.personMonthlyRevenue[p.id];
              const pp = paceRate(computed.owners[p.id]?.monthRevenue ?? 0, t, elapsed, totalDays);
              return (
                <DrillRow key={p.id} l={p.name} sub={`实际 ${fmtYuan(computed.owners[p.id]?.monthRevenue ?? 0)} / 目标 ${fmtYuan(t)}`}
                  r={<span className="flex items-center gap-1.5">{fmtPct0(pp)} <DarkLevelChip level={sevenLevel(pp)} /></span>} />
              );
            })}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">已过 {elapsed}/{totalDays} 天；七级判定左闭右开、自上而下首次命中即停（§6.8）。</p>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'stall'} title={`停滞明细 · 红 ${scopeStall.dying} 橙 ${scopeStall.warning} 黄 ${scopeStall.watch}`} onClose={() => setDrill(null)}>
        <div className="max-h-[46dvh] space-y-1 overflow-y-auto">
          {computed.stallList
            .filter((s) => memberIdSet.has(s.ownerId))
            .slice(0, 40)
            .map((s) => (
              <DrillRow
                key={s.customerId}
                l={
                  <span className="flex items-center gap-1.5">
                    <i className={`h-2 w-2 rounded-full ${s.level === 'dying' ? 'bg-red-500' : s.level === 'warning' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
                    {s.name}
                    <span className="rounded bg-white/10 px-1 text-[9px] text-slate-400">{s.abcd}</span>
                  </span>
                }
                sub={`${peopleName(s.ownerId)} · ${STAGE_LABEL[s.stage]}`}
                r={`停留 ${s.days} 天`}
              />
            ))}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">排序＝等级（红→橙→黄）→ ABCD → 停留天数倒序（§8.5.1）；阈值＝通用列 15/30/20/7 天。</p>
      </DrillSheet>

      {drill?.kind === 'member' && (() => {
        const p = data.people.find((x) => x.id === drill.id)!;
        const oc = computed.owners[p.id];
        const fo = computed.folded.perOwner[p.id];
        const conv = oc?.conv;
        const myStalls = computed.stallList.filter((s) => s.ownerId === p.id).slice(0, 3);
        return (
          <DrillSheet open title={`${p.name} · 单人卡`} onClose={() => setDrill(null)}>
            <div className="mb-2 grid grid-cols-3 gap-1.5 text-center">
              {[
                { k: 'labor_roi', v: fmtRoi2(computed.folded.perOwnerRoi[p.id]) },
                { k: '本月回款', v: fmtYuan(oc?.monthRevenue ?? 0) },
                { k: '全员排名', v: `第 ${computed.rankings.totalByOwner[p.id]} 名` },
              ].map((x) => (
                <div key={x.k} className="rounded-xl bg-white/5 py-2.5">
                  <div className="text-sm font-extrabold tabular-nums text-slate-100">{x.v}</div>
                  <div className="text-[9px] text-slate-500">{x.k}</div>
                </div>
              ))}
            </div>
            <div className="mb-2 grid grid-cols-6 gap-1 text-center text-[10px]">
              {FUNNEL_STAGES.map((s) => (
                <div key={s} className="rounded-lg bg-white/5 py-1.5">
                  <div className="text-xs font-bold tabular-nums text-slate-200">{fo?.stocks[s] ?? 0}</div>
                  <div className="text-slate-500">{STAGE_LABEL[s].slice(0, 2)}</div>
                </div>
              ))}
            </div>
            <div className="mb-2 space-y-1">
              <DrillRow l="线索转化率（累计制）" r={fmtPct1(conv?.lead)} />
              <DrillRow l="样品转化率（累计制）" r={fmtPct1(conv?.sample)} />
              <DrillRow l="累计回款" r={fmtYuan(fo?.revenue ?? 0)} />
              {p.hireDate && <DrillRow l="入职天数（R2-01）" r={`${tenureDays(p.hireDate, computed.asOf)} 天`} />}
            </div>
            {myStalls.length > 0 && (
              <>
                <div className="mb-1 text-[10px] font-semibold text-slate-400">最急的停滞客户</div>
                <div className="space-y-1">
                  {myStalls.map((s) => (
                    <DrillRow key={s.customerId} l={s.name} sub={STAGE_LABEL[s.stage]} r={`停留 ${s.days} 天`} />
                  ))}
                </div>
              </>
            )}
          </DrillSheet>
        );
      })()}

      {toast && (
        <div
          className="fixed inset-x-0 bottom-20 z-50 mx-auto w-fit cursor-pointer rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 shadow-xl"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </BoardShell>
  );
}
