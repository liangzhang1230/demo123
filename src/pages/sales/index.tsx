/**
 * /sales · 王丽 · 销售端看板（销售端章【定稿】：置顶悬赏＋四区，行动板不是报表板）· P9 战绩中心升级。
 * 死线②零经营口径：管理端专属数字（利润类/成本类/roi 类/诊断结论）一个像素不出现；
 * 可见金额仅限本人回款实际与回款目标（唯一豁免）。
 * 死线③零羞辱：排名只显自己名次与升降（榜单脱敏），停滞只作待推进优先级。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { computeAll, dailyRevenueSeries, personalRecords } from '../../domain/compute';
import { addDays, dailyTarget, daysInMonth, fmtPct0, fmtYuan, paceRate, sevenLevel } from '../../domain/engine';
import { STAGE_LABEL, FUNNEL_STAGES } from '../../domain/types';
import { BCard, BoardShell, DarkLevelChip, DarkPaceBar, DrillRow, DrillSheet, TL } from '../../components/board';
import { HeatGrid, Ring, Spark } from '../../components/charts';

const ME = 'wangli';

const LEVEL_RING: Record<string, string> = {
  lead: '#a78bfa', excellent: '#60a5fa', good: '#34d399', pass: '#cbd5e1',
  yellow: '#facc15', orange: '#fb923c', red: '#f87171',
};

const STAGE_GRAD: Record<string, string> = {
  lead: 'linear-gradient(135deg,#06b6d4,#22d3ee)',
  intent: 'linear-gradient(135deg,#6366f1,#818cf8)',
  sample: 'linear-gradient(135deg,#8b5cf6,#a78bfa)',
  signed: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
  deal: 'linear-gradient(135deg,#10b981,#34d399)',
  lost: 'linear-gradient(135deg,#475569,#64748b)',
};

export default function SalesPage() {
  const { data, computed } = useApp();
  const me = data.people.find((p) => p.id === ME)!;
  const oc = computed.owners[ME];
  const stocks = computed.folded.perOwner[ME]?.stocks;
  const [drill, setDrill] = useState<null | 'stall'>(null);

  const myStalls = useMemo(() => computed.stallList.filter((s) => s.ownerId === ME), [computed]);

  // 区二 · 单日三过程量（单日目标＝月度目标÷当月自然天数；达标率落七级色）
  const procTargets = data.targets.personMonthlyProcess[ME];
  const dayRows = (['lead', 'intent', 'sample'] as const).map((k) => {
    const target = dailyTarget(procTargets?.[k] ?? null, computed.ym);
    const actual = oc.dayProcess[k];
    const rate = target != null ? actual / target : null;
    const level = sevenLevel(rate);
    return { k, label: { lead: '今日线索', intent: '今日意向', sample: '今日样品' }[k], actual, target, rate, level };
  });

  // 区二 · 月回款目标（销售端唯一金额豁免位）
  const revTarget = data.targets.personMonthlyRevenue[ME];
  const elapsed = Number(computed.asOf.slice(8, 10));
  const pace = paceRate(oc.monthRevenue, revTarget, elapsed, daysInMonth(computed.ym));
  const paceLevel = sevenLevel(pace);

  // 区三 · 排名（只显名次与升降，读昨日折算对比）
  const yesterday = useMemo(() => computeAll(data, addDays(computed.asOf, -1)), [data, computed.asOf]);
  const rankNow = computed.rankings.totalByOwner[ME];
  const rankPrev = yesterday.rankings.totalByOwner[ME];
  const deptNow = computed.rankings.deptByOwner[ME];
  const deptPrev = yesterday.rankings.deptByOwner[ME];

  // 我的近 14 天回款（本人口径豁免）＋ 个人最佳 ＋ 7 日活跃
  const my14 = useMemo(() => dailyRevenueSeries(data, computed.asOf, 14, new Set([ME])), [data, computed.asOf]);
  const records = useMemo(() => personalRecords(data, ME, computed.asOf), [data, computed.asOf]);
  const myHeat = useMemo(() => {
    const from = addDays(computed.asOf, -6);
    const cells = new Array(7).fill(0) as number[];
    for (const e of data.events) {
      if (e.ownerId !== ME || e.date < from || e.date > computed.asOf) continue;
      const i = Math.round((Date.parse(e.date) - Date.parse(from)) / 86400000);
      if (i >= 0 && i < 7) cells[i]++;
    }
    return cells;
  }, [data, computed.asOf]);
  const heatCols = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(computed.asOf) - (6 - i) * 86400000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  });

  const RankBadge = ({ now, prev }: { now: number; prev: number }) => (
    <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${now < prev ? 'bg-emerald-500/15 text-emerald-400' : now > prev ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-slate-400'}`}>
      {now < prev ? `↑ ${prev - now} 位` : now > prev ? `↓ ${now - prev} 位` : '— 持平'}
    </span>
  );

  return (
    <BoardShell
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-base font-extrabold">
            {me.name[0]}
          </span>
          {me.name} · 我的战绩
        </span>
      }
      subtitle={
        <>
          <span>华东一部 · 销售</span>
          <span>今天 {computed.asOf}</span>
          <span className="flex items-center gap-1"><i className="live-dot" />本月成交 {records.monthDeals} 单</span>
        </>
      }
    >
      {/* 置顶 · 悬赏令栏（法定落位：只显示，不判达成、不算钱） */}
      <div className="topline glass rounded-2xl p-3.5" style={{ ['--tl' as never]: TL.amber } as CSSProperties}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-lg">📣</span>
          <div>
            <div className="text-[10px] font-bold tracking-[0.35em] text-amber-400">悬赏令</div>
            <div className="text-sm font-semibold text-amber-100">{data.bounty}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        {/* 区一 · 今日待办 */}
        <BCard title="区一 · 今日待办" icon="✅" tl={TL.red} className="lg:col-span-7">
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-sky-500/25 bg-sky-500/10 p-3">
              <div className="text-sm text-sky-200">
                ① 今日确认页 <b>{(data.confirmations?.[computed.asOf] ?? []).includes(ME) ? '已确认 ✓' : '未确认'}</b>
                <span className="ml-1.5 text-xs text-sky-400/70">23:00 前完成</span>
              </div>
              <Link to="/sales/confirm" className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-bold text-white active:opacity-80">
                去确认
              </Link>
            </div>

            <div className="rounded-xl bg-white/[0.04] p-3">
              <div className="mb-1.5 flex items-center justify-between text-sm text-slate-200">
                <span>② 待推进（今天先推这 {Math.min(5, myStalls.length)} 家）</span>
                {myStalls.length > 5 && (
                  <button className="text-[11px] text-indigo-300 hover:underline" onClick={() => setDrill('stall')}>
                    还有 {myStalls.length - 5} 家 ›
                  </button>
                )}
              </div>
              {myStalls.length === 0 ? (
                <p className="text-xs text-slate-500">暂无停滞客户</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {myStalls.slice(0, 5).map((s) => (
                    <li key={s.customerId}>
                      <Link to={`/sales/customer/${s.customerId}`} className="flex items-center justify-between py-1.5 text-xs hover:bg-white/5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <i className={`h-2 w-2 shrink-0 rounded-full ${s.level === 'dying' ? 'bg-red-500' : s.level === 'warning' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
                          <span className="truncate font-medium text-slate-200">{s.name}</span>
                          <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] text-slate-400">{s.abcd}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-400">
                          {STAGE_LABEL[s.stage]} · 停留 {s.days} 天 ›
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl bg-white/[0.04] p-3 text-sm text-slate-300">
              ③ 带教任务：本周把你的「样品跟进节奏」带教给 1 名同事
              <span className="ml-1 text-[11px] text-slate-500">指派人 刘敏 · 6-27 起</span>
            </div>
          </div>
        </BCard>

        {/* 区三 · 我的排名（荣誉位：只显名次与升降） */}
        <BCard title="区三 · 我的排名" icon="🏆" tl={TL.amber} className="lg:col-span-5"
          right={<span className="text-[10px] text-slate-500">榜单脱敏 · 并列跳号随全局</span>}
        >
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/15 to-transparent p-3.5 text-center">
              <div className="text-[11px] text-slate-400">全员总排名</div>
              <div className={`my-1 text-4xl font-black ${rankNow === 1 ? 'gold-text' : 'text-slate-100'}`}>{rankNow}</div>
              <RankBadge now={rankNow} prev={rankPrev} />
              <div className="mt-1 text-[9px] text-slate-500">较昨日定版快照</div>
            </div>
            <div className="rounded-2xl border border-indigo-400/30 bg-gradient-to-br from-indigo-500/15 to-transparent p-3.5 text-center">
              <div className="text-[11px] text-slate-400">部门内排名</div>
              <div className={`my-1 text-4xl font-black ${deptNow === 1 ? 'gold-text' : 'text-slate-100'}`}>{deptNow}</div>
              <RankBadge now={deptNow} prev={deptPrev} />
              <div className="mt-1 text-[9px] text-slate-500">华东一部</div>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">
            只显示你的名次与升降——不显示与他人的差距（把注意力留给客户，不留给焦虑）。
          </p>

          {/* 个人最佳记录（本人口径） */}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {[
              { icon: '🏆', k: '单日最高回款', v: records.bestDay ? fmtYuan(records.bestDay.value) : '—', d: records.bestDay?.date },
              { icon: '💎', k: '单笔最大成交', v: records.biggestOrder ? fmtYuan(records.biggestOrder.value) : '—', d: records.biggestOrder?.date },
              { icon: '📈', k: '最高单月回款', v: records.bestMonth ? fmtYuan(records.bestMonth.value) : '—', d: records.bestMonth?.ym },
              { icon: '⚡', k: '最快成交周期', v: records.fastestCycleDays != null ? `${records.fastestCycleDays} 天` : '—', d: '建档→成交' },
            ].map((r) => (
              <div key={r.k} className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-2.5 py-2">
                <span className="text-base">{r.icon}</span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold tabular-nums text-slate-100">{r.v}</div>
                  <div className="text-[9px] text-slate-500">{r.k} · {r.d}</div>
                </div>
              </div>
            ))}
          </div>
        </BCard>
      </div>

      {/* 区二 · 我的目标（进度即语言：三环＋pace 条＋趋势） */}
      <BCard title="区二 · 我的目标" icon="🎯" tl={TL.indigo}
        right={<span className="text-[10px] text-slate-500">单日目标＝月度目标 ÷ 自然天数 · 七级色</span>}
      >
        <div className="grid grid-cols-3 gap-2">
          {dayRows.map((r) => (
            <div key={r.k} className="flex flex-col items-center rounded-xl bg-white/[0.04] py-3">
              <Ring
                pct={r.rate == null ? null : Math.min(1, r.rate)}
                color={r.level ? LEVEL_RING[r.level.key] : '#64748b'}
                center={<span>{r.actual}<span className="text-[10px] font-normal text-slate-400">/{r.target == null ? '—' : r.target.toFixed(1)}</span></span>}
                sub={r.label}
              />
              <div className="mt-1.5"><DarkLevelChip level={r.level} /></div>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-400">本月回款目标</span>
              <span className="font-extrabold tabular-nums text-cyan-200">
                {fmtYuan(oc.monthRevenue)} <span className="text-xs font-normal text-slate-500">/ {fmtYuan(revTarget)}</span>
              </span>
            </div>
            <div className="mt-2"><DarkPaceBar rate={pace} level={paceLevel} /></div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
              <span>{pace == null ? '目标未设' : pace >= 1 ? `进度 ${fmtPct0(pace)}，跑在日历前面` : `进度 ${fmtPct0(pace)}，加把劲`}</span>
              <DarkLevelChip level={paceLevel} />
            </div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3">
            <div className="mb-1 text-[10px] text-slate-500">我的近 14 天回款</div>
            <Spark data={my14.map((d) => d.value)} w={300} h={44} stroke="#22d3ee" fillFrom="rgba(34,211,238,0.28)" />
            <div className="mt-0.5 flex justify-between text-[9px] text-slate-500">
              <span>{my14[0]?.date.slice(5)}</span><span>今天</span>
            </div>
          </div>
        </div>
      </BCard>

      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        {/* 区四 · 我的漏斗（干活入口） */}
        <BCard title="区四 · 我的漏斗" icon="🔻" tl={TL.cyan} className="lg:col-span-7"
          right={<span className="text-[10px] tabular-nums text-slate-400">本月回款 {fmtYuan(oc.monthRevenue)}</span>}
        >
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {FUNNEL_STAGES.map((s) => (
              <Link
                key={s}
                to={`/sales/customers?stage=${s}`}
                className="glass-hover rounded-xl p-0.5"
                style={{ background: STAGE_GRAD[s] }}
              >
                <div className="rounded-[10px] bg-[#0d1526]/90 py-2.5 text-center">
                  <div className="text-xl font-extrabold tabular-nums text-slate-100">{stocks?.[s] ?? 0}</div>
                  <div className="text-[10px] text-slate-400">{STAGE_LABEL[s]}</div>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/sales/customers/new" className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-3 text-center text-sm font-bold text-white active:opacity-80">
              ＋ 建档
            </Link>
            <Link to="/sales/customers" className="rounded-xl bg-white/10 py-3 text-center text-sm font-bold text-slate-100 ring-1 ring-white/15 active:bg-white/15">
              推进客户 →
            </Link>
          </div>
        </BCard>

        {/* 我的 7 日活跃（本人口径） */}
        <BCard title="我的 7 日活跃" icon="🔥" tl={TL.green} className="lg:col-span-5"
          right={<span className="text-[10px] text-slate-500">业务事件＝建档/推进/成交</span>}
        >
          <HeatGrid cols={heatCols} rows={[{ label: '动作', cells: myHeat.map((v, i) => ({ v, hint: `${heatCols[i]} · ${v} 条` })) }]} />
          <p className="mt-2 text-[10px] leading-4 text-slate-500">
            打开就三眼：顶上有没有彩头、今天先推谁、我排第几——看完拿起电话。
          </p>
        </BCard>
      </div>

      {/* 待推进全量下钻 */}
      <DrillSheet open={drill === 'stall'} title={`待推进全量 · ${myStalls.length} 家`} onClose={() => setDrill(null)}>
        <div className="max-h-[50dvh] space-y-1 overflow-y-auto">
          {myStalls.map((s) => (
            <Link key={s.customerId} to={`/sales/customer/${s.customerId}`} className="block">
              <DrillRow
                l={
                  <span className="flex items-center gap-1.5">
                    <i className={`h-2 w-2 rounded-full ${s.level === 'dying' ? 'bg-red-500' : s.level === 'warning' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
                    {s.name}
                    <span className="rounded bg-white/10 px-1 text-[9px] text-slate-400">{s.abcd}</span>
                  </span>
                }
                sub={STAGE_LABEL[s.stage]}
                r={`停留 ${s.days} 天 ›`}
              />
            </Link>
          ))}
        </div>
      </DrillSheet>
    </BoardShell>
  );
}
