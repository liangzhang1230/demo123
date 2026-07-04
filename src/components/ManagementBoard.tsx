/**
 * 管理端决策看板（看板章【定稿】五区＋底部固定条）· P10 整改版。
 * 死线①：看板不产口径——数字直读 computeAll/computePeriod 既有派生位；图表仅渲染。
 * 死线②：十秒答案、三击到底——所有 KPI/漏斗层/团队行/流失条均绑定下钻。
 * P10 新增：日/周/月/年周期切换全板联动；老板端部门筛选＋部门对比；
 * 逐层转化率＋总成交转化率＋客户流失率；AI 操盘手提示层（静态话术位，全板常驻）。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import {
  absRate, DASH, fmtPct0, fmtPct1, fmtRoi2, fmtWan, fmtYuan,
  paceRate, rankJump, sevenLevel, tenureDays,
} from '../domain/engine';
import { dailyRevenueSeries, periodOrdersList } from '../domain/compute';
import { computePeriod, type PeriodKind } from '../domain/period';
import { FUNNEL_STAGES, STAGE_LABEL, type Stage } from '../domain/types';
import { ExampleBadge } from './ui';
import {
  AiHint, BCard, BoardShell, DarkLevelChip, DarkPaceBar, DrillRow, DrillSheet,
  Kpi, Medal, PeriodTabs, TL, TrendPill,
} from './board';
import { FunnelBar, MonthBars, Ring, Spark } from './charts';

type Drill =
  | { kind: 'revenue' } | { kind: 'net' } | { kind: 'roi' } | { kind: 'deals' }
  | { kind: 'pace' } | { kind: 'stall' } | { kind: 'loss' }
  | { kind: 'stage'; stage: Stage } | { kind: 'member'; id: string } | null;

const STAGE_GRAD: Record<string, string> = {
  lead: 'linear-gradient(90deg,#06b6d4,#22d3ee)',
  intent: 'linear-gradient(90deg,#6366f1,#818cf8)',
  sample: 'linear-gradient(90deg,#8b5cf6,#a78bfa)',
  signed: 'linear-gradient(90deg,#f59e0b,#fbbf24)',
  deal: 'linear-gradient(90deg,#10b981,#34d399)',
  lost: 'linear-gradient(90deg,#475569,#64748b)',
};

const RING_COLORS = ['#22d3ee', '#818cf8', '#a78bfa', '#fbbf24'];

export function ManagementBoard({ role }: { role: 'boss' | 'manager' }) {
  const { data, computed, unlocked, setUnlocked } = useApp();
  const [toast, setToast] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  const [drill, setDrill] = useState<Drill>(null);
  const [period, setPeriod] = useState<PeriodKind>('month');
  const [deptFilter, setDeptFilter] = useState<string | null>(null); // 老板端部门筛选

  const managerId = 'liumin';
  const deptId = role === 'manager'
    ? (data.people.find((p) => p.id === managerId)?.deptId ?? 'd1')
    : deptFilter;
  const dept = deptId ? computed.depts[deptId] : null;
  const deptName = deptId ? data.departments.find((d) => d.id === deptId)?.name : null;

  const members = useMemo(
    () => data.people.filter((p) => p.role !== 'boss' && (deptId ? p.deptId === deptId : true)),
    [data.people, deptId],
  );
  const memberIdSet = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // ===== 周期折算（日/周/月/年 全板联动） =====
  const pm = useMemo(
    () => computePeriod(data, computed.asOf, period, data.people, deptId ? memberIdSet : undefined),
    [data, computed.asOf, period, deptId, memberIdSet],
  );
  const R = pm.range;
  const isMonth = period === 'month';

  // 累计/点时口径（不随周期切换的旗舰值）
  const scopeRoi = dept ? dept.roi : computed.folded.teamLaborRoi;
  const scopeStall = dept ? dept.stall : computed.company.stallTotal;
  const scopeStocks = dept ? dept.stocks : computed.folded.stocks;
  const inManaged = dept ? dept.inManaged : computed.company.inManaged;

  // 环比：月＝完整月规格口径；其余＝较上一同长窗口（演示口径，标注）
  const monthNetMom = dept ? dept.netMom : computed.company.netMom;
  const monthRevenueMom = dept ? dept.revenueMom : computed.company.revenueMom;
  const [momPrev, momCur] = computed.company.momPair;
  const trendNote = isMonth ? `完整月环比 ${Number(momCur.slice(5, 7))}月 vs ${Number(momPrev.slice(5, 7))}月` : R.prevLabel;
  const revTrend = isMonth ? monthRevenueMom : pm.revenueDelta;
  const netTrend = isMonth ? monthNetMom : pm.netDelta;

  // 目标与 pace（§6.7：日＝月÷自然天；周不设目标；年＝月×12）
  const monthTarget = dept ? data.targets.deptMonthlyRevenue[dept.id] : data.targets.companyMonthlyRevenue;
  const periodTarget = R.targetFactor == null ? null : monthTarget * R.targetFactor;
  const pace = paceRate(pm.revenue, periodTarget, R.elapsed, R.totalDays);
  const paceLevel = sevenLevel(pace);

  // 累计制转化率（§6.3）＋ 总成交转化率 close_rate ＋ 累计客户流失率（范围内先汇总再算）
  const convAgg = useMemo(() => {
    const base = { leadNew: 0, intentNew: 0, sampleNew: 0, signedNew: 0, fwdLead: 0, fwdIntent: 0, fwdSample: 0, fwdSigned: 0, toDeal: 0 };
    for (const m of members) {
      const b = computed.owners[m.id]?.convBase;
      if (!b) continue;
      base.leadNew += b.leadNew; base.intentNew += b.intentNew; base.sampleNew += b.sampleNew; base.signedNew += b.signedNew;
      base.fwdLead += b.fwdLead; base.fwdIntent += b.fwdIntent; base.fwdSample += b.fwdSample; base.fwdSigned += b.fwdSigned;
      base.toDeal += b.toDeal;
    }
    return {
      lead: base.leadNew > 0 ? base.fwdLead / base.leadNew : null,
      intent: base.intentNew > 0 ? base.fwdIntent / base.intentNew : null,
      sample: base.sampleNew > 0 ? base.fwdSample / base.sampleNew : null,
      signed: base.signedNew > 0 ? base.fwdSigned / base.signedNew : null,
      close: base.leadNew > 0 ? base.toDeal / base.leadNew : null, // 成交率＝累计首购÷累计线索（§6.3）
      churn: base.leadNew > 0 ? scopeStocks.lost / base.leadNew : null, // 累计流失率＝流失存量÷累计建档
      leadNew: base.leadNew,
    };
  }, [members, computed, scopeStocks.lost]);

  const idleDaysOf = (id: string) => {
    const last = computed.folded.perOwner[id]?.lastEventDate;
    if (!last) return null;
    return Math.round((Date.parse(computed.asOf) - Date.parse(last)) / 86400000);
  };

  // 月度序列（趋势卡；口径固定自然月，不随周期切换——环比仅自然月 §6.5）
  const monthsKeys = [momPrev, momCur, computed.ym];
  const revSeries = monthsKeys.map((m) =>
    dept
      ? dept.memberIds.reduce((a, id) => a + (computed.owners[id]?.revenueByMonth[m] ?? 0), 0)
      : computed.folded.revenueByMonth[m] ?? 0,
  );
  const netSeries = monthsKeys.map((m) => computed.company.netByMonth[m] ?? 0);
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

  // 区一 · 今日一件事（待办 ＞ 诊断）
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
        text: `停滞红色积压：${scopeStall.dying} 家客户濒死（占在管 ${fmtPct0(scopeStall.dying / Math.max(1, inManaged))}）——抢救或放掉，今天该拍板`,
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
  }, [scopeStall, computed, deptId, inManaged, unconfirmedToday]);

  // 区四 · 团队一屏（本期回款＋本期排名；紧急度分诊排序）
  const periodRank = useMemo(() => {
    const rows = rankJump(
      members.map((p) => ({ id: p.id, value: pm.perOwner[p.id]?.revenue ?? 0, tieTime: pm.perOwner[p.id]?.lastOrderSeq ?? 0 })),
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.rank]));
  }, [members, pm]);

  const teamRows = useMemo(() => {
    return members
      .map((p) => {
        const roi = computed.folded.perOwnerRoi[p.id] ?? null;
        const target = data.targets.personMonthlyRevenue[p.id];
        const pTarget = R.targetFactor == null ? null : target * R.targetFactor;
        const pPace = paceRate(pm.perOwner[p.id]?.revenue ?? 0, pTarget, R.elapsed, R.totalDays);
        return {
          p, roi,
          rank: isMonth ? computed.rankings.totalByOwner[p.id] : periodRank[p.id],
          rankDept: computed.rankings.deptByOwner[p.id],
          revenue: pm.perOwner[p.id]?.revenue ?? 0,
          stall: computed.owners[p.id]?.stall ?? { dying: 0, warning: 0, watch: 0 },
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
  }, [members, computed, data.targets, pm, R, isMonth, periodRank]);

  const openDays = Math.round((Date.parse(computed.asOf) - Date.parse(data.openDate)) / 86400000) + 1;
  const monthLabels = monthsKeys.map((m) => `${Number(m.slice(5, 7))}月`);
  const peopleName = (id: string) => data.people.find((p) => p.id === id)?.name ?? id;

  // 区五文案三段式：功能是什么 / 解决什么问题 / 拿到什么结果（只讲省钱、赚钱、控风险）
  const packs = [
    {
      key: 'pack1', name: '操盘包① · 人效操盘包', ai: 'AI 人效诊断', to: '/sample/pack1', tl: TL.red,
      func: '每人每天一笔账：工资花多少、赚回多少，谁回本、谁亏损、谁零产出',
      pain: '王五 47 天零业务事件、月薪照付——今天就现形，不再拖到年底',
      effect: '止住 ¥8,900/月 白花的工资；新人第几天回本、续不续用，按数据拍板',
      job: '今日作业：王五每月净烧 ¥8,900——止血建议已就绪',
    },
    {
      key: 'pack2', name: '操盘包② · 增长操盘包', ai: 'AI 增长归因', to: '/sample/pack2', tl: TL.cyan,
      func: '找出漏斗最漏钱的一跳并算成钱；按签约节奏预告未来 30 天回款',
      pain: '样品送出去签不回来：本月 82 进 9 出，钱卡在哪一步一眼看到',
      effect: '修一个卡点＝找回 ¥49.6万营收；唤醒 38 家休眠客户＝再拿 ¥23.8万（估算）',
      job: '今日作业：样品→签约卡点，估算卡着 ¥49.6万',
    },
    {
      key: 'pack3', name: '操盘包③ · 销冠 DNA 克隆引擎', ai: 'AI 战法克隆', to: '/sample/pack3', tl: TL.purple,
      func: '拆解销冠每步动作数据，生成可复制打法模板，指派带教并跟踪结果',
      pain: '王丽样品→签约 38%、赵敏 9%——差的那一推，教得会',
      effect: '销冠打法复制给其余 9 人；销冠离职，打法留在公司',
      job: '今日作业：赵敏首要带教点＝样品→签约（对标王丽）',
    },
    {
      key: 'pack4', name: '操盘包④ · 经营黑匣子', ai: 'AI 决策回放', to: '/sample/pack4', tl: TL.amber,
      func: '记录每次拍板，自动对照拍板前后的回款、流失变化',
      pain: 'B 品类提价后回款 −12%、流失 +6 家——拍板对错，有据可查',
      effect: '同一个判断错误不犯第二次；每月一页经营航迹',
      job: '本月作业：6 月航迹已生成——B 品类提价回放',
    },
    {
      key: 'library', name: '经营智库', ai: 'AI 定薪分析', to: '/sample/library', tl: TL.green,
      func: '按同行数据给出底薪带与提成阶梯',
      pain: '底薪给高了亏钱、给低了招不到人',
      effect: '底薪定在 ¥4,800–6,500 带内、提成 3–5% 阶梯，一次定准',
      job: '定薪建议：底薪带 ¥4,800–6,500 已就绪',
    },
  ];

  const stageDrillData = (stage: Stage) => {
    const stock = scopeStocks[stage];
    const flow = stage === 'deal'
      ? { entered: pm.firstDeals, exited: 0, lost: 0 }
      : stage === 'lost'
        ? { entered: pm.lossTotal, exited: 0, lost: 0 }
        : pm.flows[stage as 'lead'];
    const stalled = computed.stallList.filter((s) => s.stage === stage && memberIdSet.has(s.ownerId)).slice(0, 6);
    return { stock, flow, stalled };
  };

  return (
    <BoardShell
      title={role === 'boss' ? `${data.tenant.bossName}（老板）· AI 决策看板` : `刘敏（主管）· ${deptName}`}
      subtitle={
        <>
          <span>{data.tenant.name}</span>
          <span>模拟今天 {computed.asOf} · 开通第 {openDays} 天</span>
          <span className="flex items-center gap-1"><i className="live-dot" />🤖 AI 销售操盘手在线 · 事件流实时折算</span>
        </>
      }
      badges={<PeriodTabs value={period} onChange={setPeriod} />}
    >
      {/* AI 操盘手晨话（全看板常驻静态位：白话原语回退层） */}
      <div className="glass topline rounded-2xl p-4" style={{ ['--tl' as never]: TL.purple } as CSSProperties}>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-lg">🎙</span>
          <div>
            <p className="text-sm leading-6 text-slate-100">
              {role === 'boss'
                ? '陈总早。今天的火我已替你排好序：先看停滞红色积压，再看样品池的转出率——它掉得不正常。'
                : `刘敏早。本部门今天的带教名单我排好了：橙色停滞 ${scopeStall.warning} 家先跟，李强的爬坡节奏帮他盯住。`}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">上线后由 AI 销售操盘手按你的真实数据每日生成</p>
          </div>
        </div>
      </div>

      {/* 老板端 · 部门筛选（分部门查看经营数据） */}
      {role === 'boss' && (
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[11px] text-slate-500">部门筛选：</span>
          {[{ id: null as string | null, name: '全公司' }, ...data.departments].map((d) => (
            <button
              key={d.id ?? 'all'}
              data-testid={`dept-chip-${d.id ?? 'all'}`}
              onClick={() => setDeptFilter(d.id)}
              className={`rounded-full px-3 py-1 text-xs font-bold ring-1 transition-all ${
                deptFilter === d.id
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-500 text-white ring-transparent'
                  : 'bg-white/5 text-slate-400 ring-white/10 hover:text-slate-200'
              }`}
            >
              {d.name}
            </button>
          ))}
          {deptFilter && <span className="text-[10px] text-slate-500">已按 {deptName} 裁剪全板数据</span>}
        </div>
      )}

      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        {/* 区一 · 今日一件事 */}
        <BCard title={`区一 · 今日一件事${deptId ? `（${deptName}）` : ''}`} icon="🎯" tl={TL.red} className="lg:col-span-7">
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
              <AiHint tone="block">
                两层仲裁（待办＞诊断）由 AI 操盘手按固定序自动排好——你只拍第一件，其余我折叠。
              </AiHint>
            </div>
          )}
        </BCard>

        {/* 销售早报样卡（管理端必发核心 §10.4.1，实时重算） */}
        <BCard
          title={<>📨 销售早报 · {Number(computed.asOf.slice(5, 7))}月{Number(computed.asOf.slice(8, 10))}日{deptId ? `（${deptName}）` : ''}</>}
          tl={TL.cyan}
          right={<span className="text-[10px] text-slate-500">🤖 AI 生成 · 工作日 8:00 推送 · 演示为实时刷新</span>}
          className="lg:col-span-5"
        >
          <div className="space-y-1.5 text-xs leading-5 text-slate-300">
            <Link to="/sales/confirm" className="block rounded-lg bg-white/5 px-2.5 py-1.5 hover:bg-white/10">
              确认：已确认 {activeTodayCount - unconfirmedToday.length} ／ 未确认 {unconfirmedToday.length}
              {unconfirmedToday.length > 0 && `（${unconfirmedToday.slice(0, 3).map((p) => p.name).join('·')}${unconfirmedToday.length > 3 ? ' 等' : ''}）`}
              <span className="ml-1 text-sky-400">›</span>
            </Link>
            <div className="cursor-pointer rounded-lg bg-white/5 px-2.5 py-1.5 hover:bg-white/10" onClick={() => setDrill({ kind: 'pace' })}>
              本月人效比 <b className="text-slate-100">{fmtRoi2(scopeRoi)}</b> ｜ 回款达标 <b className="text-slate-100">{fmtPct0(absRate(dept ? dept.monthRevenue : computed.company.monthRevenue, monthTarget))}</b> ｜ 剩 {Math.max(0, (isMonth ? R.totalDays - R.elapsed : 30 - Number(computed.asOf.slice(8, 10))))} 天 <span className="text-sky-400">›</span>
            </div>
            <div className="cursor-pointer rounded-lg bg-white/5 px-2.5 py-1.5 hover:bg-white/10" onClick={() => setDrill({ kind: 'stall' })}>
              停滞：{scopeStall.dying} 个濒死客户待处理 <span className="text-sky-400">›</span>
            </div>
            <div className="text-sky-400">打开系统 →</div>
          </div>
        </BCard>
      </div>

      {/* 区二 · 经营心跳（固定 6 数 · 随周期联动 · 每格下钻） */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-200">区二 · 经营心跳{deptId ? `（${deptName}）` : ''}</h2>
          <span className="text-[10px] text-slate-500">固定 6 数 · {R.label}口径 · 每格可点下钻</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
          <Kpi
            icon="📈" label={`${R.label}净利`} tl={TL.green} valueClass="text-emerald-300"
            value={fmtWan(pm.net)}
            trend={<TrendPill value={netTrend} note={trendNote} />}
            plain={`毛利 − 人力成本 · ${trendNote}`}
            spark={!deptId && isMonth ? <Spark data={netSeries} stroke="#34d399" fillFrom="rgba(52,211,153,0.3)" /> : undefined}
            onClick={() => setDrill({ kind: 'net' })}
          />
          <Kpi
            icon="💰" label={`${R.label}回款`} tl={TL.cyan} valueClass="text-cyan-300"
            value={fmtWan(pm.revenue)}
            trend={<TrendPill value={revTrend} note={trendNote} />}
            plain={`现金进账 ${fmtWan(pm.revenue)} · ${trendNote}`}
            spark={isMonth ? <Spark data={revSeries} stroke="#22d3ee" fillFrom="rgba(34,211,238,0.3)" /> : <Spark data={daily14.map((d) => d.value)} stroke="#22d3ee" fillFrom="rgba(34,211,238,0.3)" />}
            onClick={() => setDrill({ kind: 'revenue' })}
          />
          <Kpi
            icon="⚙️" label={deptId ? '部门 labor_roi' : '团队 labor_roi'} tl={TL.indigo} valueClass="grad-text"
            value={fmtRoi2(scopeRoi)}
            badge={<span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-500">累计口径</span>}
            plain={scopeRoi != null ? `每付 1 元工资赚回 ${fmtRoi2(scopeRoi)} 元（Σ净利÷Σ成本 · 不随周期切换）` : '—（未设成本）'}
            onClick={() => setDrill({ kind: 'roi' })}
          />
          <Kpi
            icon="🤝" label={`${R.label}成交`} tl={TL.purple} valueClass="text-purple-300"
            value={`${pm.firstDeals + pm.repeatOrders} 单`}
            trend={<TrendPill value={isMonth ? null : pm.dealsDelta} note={trendNote} />}
            plain={`新客 ${pm.firstDeals} ＋ 复购 ${pm.repeatOrders} 单（${pm.repeatCusts} 家）`}
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
                  {periodTarget == null
                    ? '周不设独立目标（规格：周只汇总，不拆周指标）'
                    : pace == null
                      ? '目标未设'
                      : `${pace >= 1 ? `进度 ${fmtPct0(pace)}，跑在日历前面` : `进度 ${fmtPct0(pace)}，落后于日历`}（${R.label}目标 ${fmtWan(periodTarget)}）`}
                </span>
              </span>
            }
            onClick={() => setDrill({ kind: 'pace' })}
          />
          {unlocked ? (
            <Kpi
              icon="🔮" label="30 天现金前瞻" tl={TL.pink} valueClass="text-pink-300"
              value={<span className="flex items-center gap-1.5">¥17.0万 <ExampleBadge inline /></span>}
              plain="AI 按签约池节奏外推未来 30 天回款（估算 · 示例数据）"
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

      {/* 区三 · 钱事分诊条（三段三包，业务边界一一对应、点击不重复） */}
      <BCard
        title="区三 · 钱事分诊条"
        icon="🩺"
        tl={TL.amber}
        right={unlocked ? <ExampleBadge inline /> : <span className="text-[10px] text-slate-500">三段各对应一个 AI 包 · 未购显 —</span>}
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {/* 在漏 ＝ 人效操盘包（止血）——只管「工资白花」 */}
          <Link to="/sample/pack1" className="flex flex-col rounded-xl border-2 border-red-500/40 bg-red-500/[0.07] p-3 transition-colors hover:border-red-400/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-red-400">在漏 {unlocked ? '' : '🔒'}</span>
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-300">人效操盘包</span>
            </div>
            {unlocked ? (
              <>
                <div className="mt-1.5 text-2xl font-extrabold leading-7 text-slate-100">¥8,900<span className="text-sm font-bold text-slate-400">/月</span></div>
                <div className="mt-0.5 text-[10px] leading-4 text-slate-400">王五 47 天零业务事件、工资照付；累计净亏 ¥9,200</div>
              </>
            ) : (
              <>
                <div className="mt-1.5 text-2xl font-extrabold text-slate-600">{DASH}</div>
                <div className="mt-0.5 text-[10px] leading-4 text-slate-500">白花的工资，逐人逐月标出来</div>
              </>
            )}
            <div className="mt-auto pt-1.5 text-[10px] font-semibold text-red-300">止血明细 ›</div>
          </Link>
          {/* 待拿 ＝ 增长操盘包（卡点＋休眠）——只管「没拿回来的营收」 */}
          <Link to="/sample/pack2" className="flex flex-col rounded-xl border-2 border-amber-500/40 bg-amber-500/[0.07] p-3 transition-colors hover:border-amber-400/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-400">待拿 {unlocked ? '' : '🔒'}</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">增长操盘包</span>
            </div>
            {unlocked ? (
              <>
                <div className="mt-1.5 text-2xl font-extrabold leading-7 text-slate-100">¥49.6万</div>
                <div className="mt-0.5 text-[10px] leading-4 text-slate-400">样品→签约卡点卡住的营收；另休眠客户 ¥23.8万（估算 · 分列不相加）</div>
              </>
            ) : (
              <>
                <div className="mt-1.5 text-2xl font-extrabold text-slate-600">{DASH}</div>
                <div className="mt-0.5 text-[10px] leading-4 text-slate-500">卡点卡住的营收＋休眠客户估值</div>
              </>
            )}
            <div className="mt-auto pt-1.5 text-[10px] font-semibold text-amber-300">找钱明细 ›</div>
          </Link>
          {/* 在赚 ＝ 销冠 DNA 引擎——只管「谁在替你赚、打法能不能复制」 */}
          <Link to="/sample/pack3" className="flex flex-col rounded-xl border-2 border-emerald-500/40 bg-emerald-500/[0.07] p-3 transition-colors hover:border-emerald-400/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-400">在赚 {unlocked ? '' : '🔒'}</span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">销冠 DNA 引擎</span>
            </div>
            {unlocked ? (
              <>
                <div className="mt-1.5 text-2xl font-extrabold leading-7 text-slate-100">2.10<span className="text-sm font-bold text-slate-400"> 王丽</span></div>
                <div className="mt-0.5 text-[10px] leading-4 text-slate-400">销冠打法已拆解成模板，可复制给其余 9 人；她走了，打法留在公司</div>
              </>
            ) : (
              <>
                <div className="mt-1.5 text-2xl font-extrabold text-slate-600">{DASH}</div>
                <div className="mt-0.5 text-[10px] leading-4 text-slate-500">谁在替你赚、打法能不能复制</div>
              </>
            )}
            <div className="mt-auto pt-1.5 text-[10px] font-semibold text-emerald-300">克隆明细 ›</div>
          </Link>
        </div>
      </BCard>

      {/* 经营全景行：漏斗（逐层＋总转化率）/ 月度趋势 / 本期流失归因 */}
      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        <BCard title="六态漏斗全景" icon="🔻" tl={TL.cyan} className="lg:col-span-5"
          right={
            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              总成交转化率 {fmtPct1(convAgg.close)}
            </span>
          }
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
                  s === 'lead' ? `转化 ${fmtPct1(convAgg.lead)}`
                  : s === 'intent' ? `转化 ${fmtPct1(convAgg.intent)}`
                  : s === 'sample' ? `转化 ${fmtPct1(convAgg.sample)}`
                  : s === 'signed' ? `转化 ${fmtPct1(convAgg.signed)}`
                  : '明细 ›'
                }
                onClick={() => setDrill({ kind: 'stage', stage: s })}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-slate-400">逐层＝各池累计转化率（§6.3 累计制）· 点任意层下钻</span>
            {pm.flows.sample.entered > 0 && (
              <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 font-semibold text-red-300">
                样品池{R.label} {pm.flows.sample.entered} 进 / {pm.flows.sample.exited} 出（{fmtPct1(pm.flows.sample.exited / pm.flows.sample.entered)}）
              </span>
            )}
          </div>
          <AiHint tone="block">
            样品池的转出率是当前漏斗最弱一跳——修这一跳比多招人便宜。深度卡点归因随增长包开通。
          </AiHint>
        </BCard>

        <BCard title="月度经营趋势" icon="📊" tl={TL.indigo} className="lg:col-span-4"
          right={<div className="flex gap-1"><TrendPill value={monthRevenueMom} note="回款完整月环比" /><TrendPill value={monthNetMom} note="净利完整月环比" /></div>}
        >
          <MonthBars
            months={monthLabels}
            a={revSeries}
            aLabel={`${deptId ? deptName : '公司'}月回款（当月进行中 · 环比仅自然月 §6.5）`}
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

        <BCard title={`${R.label}流失归因`} icon="🕳️" tl={TL.red} className="lg:col-span-3"
          right={<button className="text-[10px] text-indigo-300 hover:underline" onClick={() => setDrill({ kind: 'loss' })}>明细 ›</button>}
        >
          {(() => {
            const rows = Object.entries(pm.lossReasons).sort((a, b) => b[1] - a[1]).slice(0, 4);
            return (
              <>
                <div className="mb-1 flex cursor-pointer items-end justify-between" onClick={() => setDrill({ kind: 'loss' })}>
                  <div className="text-2xl font-extrabold text-red-300">{pm.lossTotal} 家</div>
                  <div className="text-right text-[10px] leading-4 text-slate-400">
                    累计客户流失率<br />
                    <b className="text-sm text-red-200">{fmtPct1(convAgg.churn)}</b>
                  </div>
                </div>
                {pm.lossTotal === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-500">{R.label}暂无流失（累计 {scopeStocks.lost} 家）</p>
                ) : (
                  <div className="space-y-1.5">
                    {rows.map(([reason, n], i) => (
                      <div key={reason} className="flex cursor-pointer items-center gap-2 text-[11px]" onClick={() => setDrill({ kind: 'loss' })}>
                        <span className="w-14 shrink-0 text-slate-400">{reason}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                          <div className="bar-anim h-full rounded-full" style={{ width: `${(n / pm.lossTotal) * 100}%`, background: i === 0 ? TL.red : TL.slate }} />
                        </div>
                        <span className="w-14 shrink-0 text-right tabular-nums text-slate-300">{n} · {fmtPct0(n / pm.lossTotal)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <AiHint tone="block">
                  首因「价格偏高」集中在样品之后——不是产品不行，是报价动作在漏。深度归因（与卡点交叉）随增长包开通。
                </AiHint>
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
                      : (r.rank === 1 ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-amber-950' : 'bg-gradient-to-br from-indigo-500/70 to-cyan-500/60')
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
                      <span className="text-[9px] tabular-nums text-slate-500">
                        {R.targetFactor == null ? '周不设目标' : `目标 pace ${fmtPct0(r.pace)}`}
                      </span>
                    </div>
                  </div>
                  <div className="grid shrink-0 grid-cols-4 items-center gap-2 text-right">
                    <div>
                      <div className={`text-sm font-bold tabular-nums ${r.roi != null && r.roi < 0 ? 'text-red-400' : 'text-slate-100'}`}>{fmtRoi2(r.roi)}</div>
                      <div className="text-[9px] text-slate-500">labor_roi</div>
                    </div>
                    <div className="flex justify-end"><Medal n={deptId ? r.rankDept : r.rank} /></div>
                    <div className="w-20">
                      <div className="text-[13px] font-bold tabular-nums text-cyan-200">{fmtYuan(r.revenue)}</div>
                      <div className="text-[9px] text-slate-500">{R.label}回款</div>
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
          <AiHint tone="block">
            王五 47 天零业务事件、工资照付——AI 止血分诊与约谈建议随人效操盘包开通。
          </AiHint>
        </BCard>

        {/* 右列：部门对比（老板全公司视图）＋ 转化 · 流失总览 */}
        <div className="space-y-3 lg:col-span-5">
          {role === 'boss' && !deptFilter && (
            <BCard title="部门对比" icon="🏁" tl={TL.pink}
              right={<span className="text-[10px] text-slate-500">{R.label}口径 · 点部门行可筛选</span>}
            >
              <div className="space-y-2">
                {data.departments.map((d) => {
                  const dm = computed.depts[d.id];
                  const rev = dm.memberIds.reduce((a, id) => a + (pm.perOwner[id]?.revenue ?? 0), 0);
                  const deals = dm.memberIds.reduce((a, id) => a + (pm.perOwner[id]?.firstDeals ?? 0) + (pm.perOwner[id]?.repeatOrders ?? 0), 0);
                  const rank = computed.rankings.deptRank.find((r) => r.id === d.id)?.rank ?? 0;
                  const maxRev = Math.max(1, ...data.departments.map((x) => computed.depts[x.id].memberIds.reduce((a, id) => a + (pm.perOwner[id]?.revenue ?? 0), 0)));
                  return (
                    <div key={d.id} className="cursor-pointer rounded-xl bg-white/[0.04] p-2.5 transition-colors hover:bg-white/[0.08]" onClick={() => setDeptFilter(d.id)}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-bold text-slate-100"><Medal n={rank} />{d.name}</span>
                        <span className="tabular-nums text-cyan-200 font-bold">{fmtYuan(rev)}</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
                        <div className="bar-anim h-full rounded-full" style={{ width: `${(rev / maxRev) * 100}%`, background: TL.cyan }} />
                      </div>
                      <div className="mt-1.5 grid grid-cols-4 gap-1 text-center text-[10px] text-slate-400">
                        <span>成交 <b className="text-slate-200">{deals}</b></span>
                        <span>labor_roi <b className="text-slate-200">{fmtRoi2(dm.roi)}</b></span>
                        <span>停滞 <b className="text-red-300">{dm.stall.dying}</b>/<b className="text-orange-300">{dm.stall.warning}</b>/<b className="text-yellow-300">{dm.stall.watch}</b></span>
                        <span>在管 <b className="text-slate-200">{dm.inManaged}</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </BCard>
          )}

          <BCard title="转化 · 流失总览" icon="🎛️" tl={TL.green}
            right={<span className="text-[10px] text-slate-500">累计制 §6.3 · 分母 0 显 —</span>}
          >
            <div className="grid grid-cols-4 gap-1">
              {([['线索', convAgg.lead], ['意向', convAgg.intent], ['样品', convAgg.sample], ['签约', convAgg.signed]] as const).map(([label, v], i) => (
                <div key={label} className="flex flex-col items-center">
                  <Ring pct={v} size={72} color={RING_COLORS[i]} center={<span className="text-[13px]">{fmtPct0(v)}</span>} sub={`${label}转化`} />
                </div>
              ))}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <div className="cursor-pointer rounded-xl bg-emerald-500/10 p-2.5 text-center ring-1 ring-emerald-400/20 hover:ring-emerald-400/50" onClick={() => setDrill({ kind: 'deals' })}>
                <div className="text-lg font-extrabold text-emerald-300">{fmtPct1(convAgg.close)}</div>
                <div className="text-[10px] text-slate-400">总成交转化率（累计首购÷累计线索）</div>
              </div>
              <div className="cursor-pointer rounded-xl bg-red-500/10 p-2.5 text-center ring-1 ring-red-400/20 hover:ring-red-400/50" onClick={() => setDrill({ kind: 'loss' })}>
                <div className="text-lg font-extrabold text-red-300">{fmtPct1(convAgg.churn)}</div>
                <div className="text-[10px] text-slate-400">客户流失率（累计流失÷累计建档）</div>
              </div>
            </div>
          </BCard>
        </div>
      </div>

      {/* 新人筛选（系统内置全套功能 · 看板同步上架）：老板用人痛点的第一现场 */}
      <BCard
        title="新人筛选 · 筛人漏斗"
        icon="🧪"
        tl={TL.pink}
        right={<Link to="/rookie" data-testid="rookie-detail-link" className="rounded-lg bg-gradient-to-r from-pink-500/30 to-purple-500/30 px-2.5 py-1 text-[11px] font-bold text-pink-200 ring-1 ring-pink-400/40 hover:ring-pink-300">进入筛选详情页 ›</Link>}
      >
        <div className="grid gap-2.5 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="rounded-xl border border-pink-400/25 bg-pink-500/[0.07] p-3">
              <p className="text-sm font-extrabold leading-6 text-slate-100">
                招错一个人 ＝ 白扔几万块 ＋ 市场延误 ＋ 客户差评 ＋ 老员工心态被带崩。
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-slate-400">
                想给高底薪招销冠，又怕养到混工资的——窗口 90 天，逐日数据筛人：
                谁是销冠苗子、谁在混，第 38 天就有判断依据，不用等半年。
                把省下的钱激励优秀，事半功倍。
              </p>
              <AiHint tone="block">
                每天盯新人单量与节奏，异常当天提醒；窗口满自动汇总，留还是汰，你一键拍板。
              </AiHint>
            </div>
          </div>
          <div className="lg:col-span-8">
            {(() => {
              const rookies = members.filter((p) => p.hireDate && tenureDays(p.hireDate!, computed.asOf) <= 90);
              if (rookies.length === 0) return <p className="py-6 text-center text-xs text-slate-500">当前无筛选期新人</p>;
              return rookies.map((p) => {
                const t = tenureDays(p.hireDate!, computed.asOf);
                const oc = computed.owners[p.id];
                const cost = Math.round(computed.folded.perOwnerLaborCost[p.id] ?? 0);
                const rev = computed.folded.perOwner[p.id]?.revenue ?? 0;
                const tiles = [
                  { k: '累计建档', v: `${oc?.convBase.leadNew ?? 0} 家` },
                  { k: '本月新客', v: `${oc?.monthFirstDeals ?? 0} 单` },
                  { k: '累计回款', v: fmtYuan(rev) },
                  { k: '累计投入（工资＋招培）', v: fmtYuan(cost) },
                  { k: 'labor_roi', v: fmtRoi2(computed.folded.perOwnerRoi[p.id]) },
                  { k: '窗口剩余', v: `${90 - t} 天` },
                ];
                return (
                  <Link key={p.id} to="/rookie" className="block rounded-xl bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.08]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 text-sm font-bold">{p.name[0]}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-100">
                          {p.name}
                          <span className="rounded bg-blue-500/20 px-1 text-[10px] font-medium text-blue-300">筛选中 · 第 {t} 天 / 窗口 90 天</span>
                          <span className="rounded bg-emerald-500/20 px-1 text-[10px] font-bold text-emerald-300">单量达标</span>
                          <span className="rounded bg-yellow-500/20 px-1 text-[10px] text-yellow-300">亏损爬坡 · 继续观察</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/8">
                          <div className="h-full rounded-full" style={{ width: `${(t / 90) * 100}%`, background: TL.pink }} />
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-pink-300">筛选详情 ›</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-center sm:grid-cols-6">
                      {tiles.map((x) => (
                        <div key={x.k} className="rounded-lg bg-white/[0.04] px-1 py-2">
                          <div className="text-[13px] font-extrabold tabular-nums text-slate-100">{x.v}</div>
                          <div className="text-[9px] leading-3 text-slate-500">{x.k}</div>
                        </div>
                      ))}
                    </div>
                  </Link>
                );
              });
            })()}
            <p className="mt-1.5 text-[10px] text-slate-500">
              筛人漏斗：本季筛选 2 人 → 筛剩 1 人（历史部分为示例数据）→ 李强转正窗口观察中——留下的每一个，都有 90 天数据背书。
            </p>
          </div>
        </div>
      </BCard>

      {/* 区五 · 武器坞（AI 四包＋经营智库货架） */}
      <BCard
        title="区五 · 武器坞（AI 增值包货架）"
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
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {packs.map((pk) => (
              <Link
                key={pk.key}
                to={pk.to}
                className={`glass-hover topline relative flex flex-col rounded-xl border p-3.5 ${
                  unlocked ? 'border-amber-400/40 bg-amber-500/[0.08]' : 'border-dashed border-white/20 bg-white/[0.03]'
                }`}
                style={{ ['--tl' as never]: unlocked ? TL.amber : pk.tl } as CSSProperties}
              >
                {unlocked ? (
                  <>
                    <div className="flex items-center gap-1.5 pr-14 text-[13px] font-bold text-slate-100">
                      ✨ {pk.name}
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">🤖 {pk.ai}</span>
                    </div>
                    <ExampleBadge />
                    <p className="mt-2 text-[11px] leading-4 text-slate-200">{pk.job}</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-400">
                      <span className="mr-1 rounded bg-emerald-500/15 px-1 text-[9px] font-bold text-emerald-300">结果</span>
                      {pk.effect}（示例）
                    </p>
                    <div className="mt-auto pt-2 text-[10px] font-semibold text-amber-300">点开查看完整样例长页 →</div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-200">
                      🔒 {pk.name}
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">🤖 {pk.ai}</span>
                    </div>
                    <div className="mt-2 space-y-1 text-[11px] leading-4">
                      <p className="text-slate-300">
                        <span className="mr-1 rounded bg-sky-500/15 px-1 text-[9px] font-bold text-sky-300">功能</span>
                        {pk.func}
                      </p>
                      <p className="text-slate-300">
                        <span className="mr-1 rounded bg-orange-500/15 px-1 text-[9px] font-bold text-orange-300">解决</span>
                        {pk.pain}
                      </p>
                      <p className="font-semibold text-slate-100">
                        <span className="mr-1 rounded bg-emerald-500/15 px-1 text-[9px] font-bold text-emerald-300">结果</span>
                        {pk.effect}
                      </p>
                    </div>
                    <div className="mt-2 inline-flex rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium leading-3 text-emerald-300 ring-1 ring-emerald-400/30">
                      数据就绪：该演示租户已沉淀 {computed.folded.totalDealCnt} 笔成交 / {openDays} 天数据
                    </div>
                    <div className="mt-auto flex items-center gap-2 pt-2">
                      <button
                        className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-900"
                        onClick={(e) => {
                          e.preventDefault();
                          setToast('试看申请已记录——上线后由商务开通');
                        }}
                      >
                        试看申请
                      </button>
                      <span className="text-[10px] text-slate-500">点卡片看完整样例 →</span>
                    </div>
                  </>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">（主管版摘除购买位——已购包的本部门作业行将在此显示）</p>
        )}
        <div className="mt-2.5 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-3">
          <button className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-left hover:bg-white/10" onClick={() => setDrill({ kind: 'stall' })}>
            <span className="font-medium text-slate-200">✅ 停滞预警</span>
            <span className="flex gap-1 tabular-nums text-[10px]">
              <span className="rounded bg-red-500/20 px-1 font-bold text-red-300">{scopeStall.dying}</span>
              <span className="rounded bg-orange-500/20 px-1 text-orange-300">{scopeStall.warning}</span>
              <span className="rounded bg-yellow-500/20 px-1 text-yellow-300">{scopeStall.watch}</span>
              <span className="ml-0.5 text-slate-500">›</span>
            </span>
          </button>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
            <span className="shrink-0 font-medium text-slate-200">✅ 悬赏令</span>
            <span className="truncate text-slate-400">{data.bounty}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
            <span className="font-medium text-slate-200">✅ 销售早报</span>
            <span className="text-slate-400">🤖 AI 生成 · 工作日 8:00 推送</span>
          </div>
        </div>
      </BCard>

      {/* 底部固定条 */}
      <BCard tl={TL.slate} className="!py-3">
        <div className="flex flex-col gap-1.5 text-xs text-slate-400">
          <div>
            <Link to="/rookie" className="font-semibold text-pink-300 hover:underline">筛人漏斗</Link>
            <span className="font-semibold text-slate-300">：</span>
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

      {/* ===== 下钻面板 ===== */}
      <DrillSheet open={drill?.kind === 'revenue'} title={`${R.label}回款下钻 · ${fmtWan(pm.revenue)}`} onClose={() => setDrill(null)}>
        <div className="mb-3 rounded-xl bg-white/5 p-2.5">
          <div className="mb-1 text-[10px] text-slate-500">近 14 天逐日回款（账务日口径）</div>
          <Spark data={daily14.map((d) => d.value)} w={440} h={64} stroke="#22d3ee" fillFrom="rgba(34,211,238,0.3)" />
          <div className="mt-1 flex justify-between text-[9px] text-slate-500">
            <span>{daily14[0]?.date.slice(5)}</span><span>{daily14[daily14.length - 1]?.date.slice(5)}</span>
          </div>
        </div>
        <div className="space-y-1">
          {[...members]
            .sort((a, b) => (pm.perOwner[b.id]?.revenue ?? 0) - (pm.perOwner[a.id]?.revenue ?? 0))
            .map((p) => (
              <DrillRow key={p.id} l={p.name} sub={`累计 ${fmtYuan(computed.folded.perOwner[p.id]?.revenue ?? 0)}`} r={fmtYuan(pm.perOwner[p.id]?.revenue ?? 0)} />
            ))}
        </div>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'net'} title={`${R.label}净利下钻（毛利 − 人力成本）`} onClose={() => setDrill(null)}>
        <div className="mb-2 space-y-1">
          <DrillRow l={`${R.label}毛利`} r={fmtWan(pm.gross)} />
          <DrillRow l={`${R.label}人力成本（§8.1 逐日累计）`} r={<span className="text-red-300">− {fmtWan(pm.laborCost)}</span>} />
          <DrillRow l={`${R.label}净利`} r={<span className={pm.net >= 0 ? 'text-emerald-300' : 'text-red-300'}>{fmtWan(pm.net)}</span>} />
        </div>
        <div className="mb-1 text-[10px] font-semibold text-slate-400">近三个自然月（公司口径）</div>
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
        <p className="mt-2 text-[10px] text-slate-500">毛利＝Σ成交单回款 × 品类快照毛利率（31%）。</p>
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

      <DrillSheet open={drill?.kind === 'deals'} title={`${R.label}成交单下钻 · ${pm.firstDeals + pm.repeatOrders} 单`} onClose={() => setDrill(null)}>
        <div className="max-h-[46dvh] space-y-1 overflow-y-auto">
          {periodOrdersList(data, computed.asOf, deptId ? memberIdSet : undefined, R.from).slice(0, 40).map((o, i) => (
            <DrillRow
              key={i}
              l={<span>{o.customer} <span className={`ml-1 rounded px-1 text-[9px] ${o.isRepeat ? 'bg-purple-500/20 text-purple-300' : 'bg-emerald-500/20 text-emerald-300'}`}>{o.isRepeat ? '复购' : '首购'}</span></span>}
              sub={`${o.date} · ${peopleName(o.ownerId)}`}
              r={fmtYuan(o.amount)}
            />
          ))}
          {pm.firstDeals + pm.repeatOrders === 0 && <p className="py-4 text-center text-xs text-slate-500">{R.label}暂无成交单</p>}
        </div>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'pace'} title={`目标进度下钻（${R.label} · pace＝实际 ÷ 应完成量）`} onClose={() => setDrill(null)}>
        {R.targetFactor == null ? (
          <p className="py-3 text-center text-xs text-slate-400">周不设独立目标（规格：周只做数据汇总，不拆周指标）</p>
        ) : (
          <div className="space-y-1">
            {(deptId ? [computed.depts[deptId]] : data.departments.map((d) => computed.depts[d.id])).map((d) => {
              const t = data.targets.deptMonthlyRevenue[d.id] * (R.targetFactor ?? 1);
              const rev = d.memberIds.reduce((a, id) => a + (pm.perOwner[id]?.revenue ?? 0), 0);
              const p = paceRate(rev, t, R.elapsed, R.totalDays);
              return (
                <DrillRow
                  key={d.id}
                  l={data.departments.find((x) => x.id === d.id)?.name}
                  sub={`实际 ${fmtWan(rev)} / ${R.label}目标 ${fmtWan(t)}`}
                  r={<span className="flex items-center gap-1.5">{fmtPct0(p)} <DarkLevelChip level={sevenLevel(p)} /></span>}
                />
              );
            })}
            {[...members]
              .sort((a, b) => (pm.perOwner[b.id]?.revenue ?? 0) - (pm.perOwner[a.id]?.revenue ?? 0))
              .map((p) => {
                const t = data.targets.personMonthlyRevenue[p.id] * (R.targetFactor ?? 1);
                const pp = paceRate(pm.perOwner[p.id]?.revenue ?? 0, t, R.elapsed, R.totalDays);
                return (
                  <DrillRow key={p.id} l={p.name} sub={`实际 ${fmtYuan(pm.perOwner[p.id]?.revenue ?? 0)} / 目标 ${fmtYuan(Math.round(t))}`}
                    r={<span className="flex items-center gap-1.5">{fmtPct0(pp)} <DarkLevelChip level={sevenLevel(pp)} /></span>} />
                );
              })}
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-500">已过 {R.elapsed}/{R.totalDays} 天；七级判定左闭右开、首次命中即停（§6.8）；单日目标＝月目标÷自然天数（§6.7）。</p>
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
        <p className="mt-2 text-[10px] text-slate-500">排序＝等级→ABCD→天数倒序（§8.5.1）；阈值＝通用列 15/30/20/7 天。</p>
      </DrillSheet>

      <DrillSheet open={drill?.kind === 'loss'} title={`${R.label}流失下钻 · ${pm.lossTotal} 家（累计流失率 ${fmtPct1(convAgg.churn)}）`} onClose={() => setDrill(null)}>
        <div className="mb-2 space-y-1">
          {Object.entries(pm.lossReasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
            <DrillRow key={reason} l={reason} r={`${n} 家 · ${fmtPct0(n / Math.max(1, pm.lossTotal))}`} />
          ))}
          {pm.lossTotal === 0 && <p className="py-3 text-center text-xs text-slate-500">{R.label}暂无流失</p>}
        </div>
        <div className="mb-1 text-[10px] font-semibold text-slate-400">{R.label}流失客户</div>
        <div className="max-h-[30dvh] space-y-1 overflow-y-auto">
          {data.events
            .filter((e) => e.type === 'stage_changed' && e.to === 'lost' && e.date >= R.from && e.date <= R.to && memberIdSet.has(e.ownerId))
            .slice(-12)
            .reverse()
            .map((e) => (
              <DrillRow
                key={e.id}
                l={data.customers.find((c) => c.id === e.customerId)?.name ?? e.customerId}
                sub={`${e.date} · ${peopleName(e.ownerId)} · 自 ${STAGE_LABEL[e.from as Stage]}`}
                r={e.lossReason ?? '—'}
              />
            ))}
        </div>
      </DrillSheet>

      {drill?.kind === 'stage' && (() => {
        const s = drill.stage;
        const d = stageDrillData(s);
        return (
          <DrillSheet open title={`${STAGE_LABEL[s]}池下钻 · 存量 ${d.stock} 家`} onClose={() => setDrill(null)}>
            <div className="mb-2 grid grid-cols-3 gap-1.5 text-center">
              {[
                { k: `${R.label}进入`, v: d.flow.entered },
                { k: s === 'deal' ? '—' : `${R.label}转出`, v: s === 'deal' || s === 'lost' ? '—' : d.flow.exited },
                { k: s === 'deal' || s === 'lost' ? '—' : `${R.label}流失`, v: s === 'deal' || s === 'lost' ? '—' : d.flow.lost },
              ].map((x, i) => (
                <div key={i} className="rounded-xl bg-white/5 py-2.5">
                  <div className="text-sm font-extrabold tabular-nums text-slate-100">{x.v}</div>
                  <div className="text-[9px] text-slate-500">{x.k}</div>
                </div>
              ))}
            </div>
            {s !== 'deal' && s !== 'lost' && (
              <>
                <div className="mb-1 text-[10px] font-semibold text-slate-400">该池最急的停滞客户</div>
                <div className="space-y-1">
                  {d.stalled.length === 0 ? (
                    <p className="py-2 text-center text-xs text-slate-500">该池暂无停滞客户</p>
                  ) : d.stalled.map((x) => (
                    <DrillRow key={x.customerId} l={x.name} sub={peopleName(x.ownerId)} r={`停留 ${x.days} 天`} />
                  ))}
                </div>
              </>
            )}
            <p className="mt-2 text-[10px] text-slate-500">守恒：新增 − 转出 − 流失 ＝ 存量（R1-12，日终自动平衡校验）。</p>
          </DrillSheet>
        );
      })()}

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
                { k: 'labor_roi（累计）', v: fmtRoi2(computed.folded.perOwnerRoi[p.id]) },
                { k: `${R.label}回款`, v: fmtYuan(pm.perOwner[p.id]?.revenue ?? 0) },
                { k: isMonth ? '全员排名' : `${R.label}排名`, v: `第 ${isMonth ? computed.rankings.totalByOwner[p.id] : periodRank[p.id]} 名` },
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
            <AiHint tone="block">照镜子诊断（对标销冠找带教点）随销冠 DNA 包开通。</AiHint>
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
