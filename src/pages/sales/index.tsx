/**
 * /sales · 王丽 · 销售端看板（销售端章【定稿】：置顶悬赏＋四区，行动板不是报表板）。
 * 死线②零经营口径：管理端专属数字（利润类/成本类/roi 类/诊断结论）在本页一个像素不出现；
 * 销售可见金额仅限本人回款实际与回款目标（唯一豁免）。
 * 死线③零羞辱：停滞只作待推进优先级，不显总量羞辱口径；排名只显名次与升降，不显差距。
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { computeAll } from '../../domain/compute';
import { addDays, dailyTarget, daysInMonth, fmtPct0, fmtYuan, paceRate, sevenLevel } from '../../domain/engine';
import { STAGE_LABEL, FUNNEL_STAGES } from '../../domain/types';
import { Card, CardTitle, GrayNote, LevelChip, PaceBar, Shell, STALL_DOT } from '../../components/ui';

const ME = 'wangli';

export default function SalesPage() {
  const { data, computed } = useApp();
  const me = data.people.find((p) => p.id === ME)!;
  const oc = computed.owners[ME];
  const stocks = computed.folded.perOwner[ME]?.stocks;

  // 区一② 待推进：本人停滞列表（既有排序：红→橙→黄→ABCD→天数倒序），Top 5
  const myStalls = useMemo(() => computed.stallList.filter((s) => s.ownerId === ME), [computed]);

  // 区二 单日三过程量：当日实际 vs 单日目标（月度目标÷当月自然天数），达标率落七级色
  const procTargets = data.targets.personMonthlyProcess[ME];
  const dayRows = (['lead', 'intent', 'sample'] as const).map((k) => {
    const target = dailyTarget(procTargets?.[k] ?? null, computed.ym);
    const actual = oc.dayProcess[k];
    const rate = target != null ? actual / target : null;
    return { k, label: { lead: '线索', intent: '意向', sample: '样品' }[k], actual, target, level: sevenLevel(rate) };
  });

  // 区二 月回款目标 pace（销售端唯一金额豁免位）
  const revTarget = data.targets.personMonthlyRevenue[ME];
  const elapsed = Number(computed.asOf.slice(8, 10));
  const pace = paceRate(oc.monthRevenue, revTarget, elapsed, daysInMonth(computed.ym));
  const paceLevel = sevenLevel(pace);

  // 区三 排名：只显名次与升降（读昨日折算对比，非新口径）
  const yesterday = useMemo(() => computeAll(data, addDays(computed.asOf, -1)), [data, computed.asOf]);
  const rankNow = computed.rankings.totalByOwner[ME];
  const rankPrev = yesterday.rankings.totalByOwner[ME];
  const deptNow = computed.rankings.deptByOwner[ME];
  const deptPrev = yesterday.rankings.deptByOwner[ME];
  const arrow = (now: number, prev: number) => (now < prev ? '↑' : now > prev ? '↓' : '—');

  return (
    <Shell title={`${me.name}（销售）· 我的看板`} subtitle={`${data.tenant.name} ｜ 今天 ${computed.asOf}`}>
      {/* 置顶 · 悬赏令栏（法定落位：只显示，不判达成、不算钱） */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="text-[10px] font-bold tracking-wide text-amber-600">悬赏令</div>
        <div className="mt-0.5 text-sm font-medium text-amber-900">📣 {data.bounty}</div>
      </div>

      {/* 区一 · 今日待办（固定四源固定次序） */}
      <Card>
        <CardTitle>区一 · 今日待办</CardTitle>
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="text-sm text-blue-900">
              ① 今日确认页 <span className="font-semibold">未确认</span>
              <span className="ml-1 text-xs text-blue-500">23:00 前完成</span>
            </div>
            <Link to="/sales/confirm" className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white">
              去确认
            </Link>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div className="mb-1.5 flex items-center justify-between text-sm text-gray-800">
              <span>② 待推进（今天先推这 {Math.min(5, myStalls.length)} 家）</span>
              {myStalls.length > 5 && <span className="text-[11px] text-gray-400">还有 {myStalls.length - 5} 家</span>}
            </div>
            {myStalls.length === 0 ? (
              <GrayNote>暂无停滞客户</GrayNote>
            ) : (
              <ul className="divide-y divide-gray-100">
                {myStalls.slice(0, 5).map((s) => (
                  <li key={s.customerId} className="flex items-center justify-between py-1.5 text-xs">
                    <Link to={`/sales/customer/${s.customerId}`} className="flex min-w-0 items-center gap-1.5">
                      <i className={`h-2 w-2 shrink-0 rounded-full ${STALL_DOT[s.level]}`} />
                      <span className="truncate font-medium text-gray-800">{s.name}</span>
                      <span className="shrink-0 rounded bg-white px-1 text-[10px] text-gray-400 ring-1 ring-gray-200">{s.abcd}</span>
                    </Link>
                    <span className="shrink-0 tabular-nums text-gray-500">
                      {STAGE_LABEL[s.stage]} · 停留 {s.days} 天
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700">
            ③ 带教任务：本周把你的「样品跟进节奏」带教给 1 名同事
            <span className="ml-1 text-[11px] text-gray-400">指派人 刘敏 · 6-27 起</span>
          </div>
        </div>
      </Card>

      {/* 区二 · 我的目标（进度即语言） */}
      <Card>
        <CardTitle>区二 · 我的目标</CardTitle>
        <div className="grid grid-cols-3 gap-2">
          {dayRows.map((r) => (
            <div key={r.k} className="rounded-xl bg-gray-50 p-3 text-center">
              <div className="text-[11px] text-gray-500">今日{r.label}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums">
                {r.actual}
                <span className="text-xs font-normal text-gray-400">/{r.target == null ? '—' : r.target.toFixed(1)}</span>
              </div>
              <div className="mt-1"><LevelChip level={r.level} /></div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl bg-gray-50 p-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-gray-600">本月回款目标</span>
            <span className="font-bold tabular-nums">
              {fmtYuan(oc.monthRevenue)} <span className="text-xs font-normal text-gray-400">/ {fmtYuan(revTarget)}</span>
            </span>
          </div>
          <div className="mt-2"><PaceBar rate={pace} level={paceLevel} /></div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
            <span>{pace == null ? '目标未设' : pace >= 1 ? `进度 ${fmtPct0(pace)}，跑在日历前面` : `进度 ${fmtPct0(pace)}，加把劲`}</span>
            <LevelChip level={paceLevel} />
          </div>
        </div>
      </Card>

      {/* 区三 · 我的排名（荣誉位：只显名次与升降，不显差距） */}
      <Card>
        <CardTitle>区三 · 我的排名</CardTitle>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-[11px] text-gray-500">全员总排名</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">
              第 {rankNow} 名
              <span className={`ml-1 text-sm ${rankNow < rankPrev ? 'text-emerald-600' : rankNow > rankPrev ? 'text-red-500' : 'text-gray-400'}`}>
                {arrow(rankNow, rankPrev)}
              </span>
            </div>
            <div className="text-[10px] text-gray-400">较昨日</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-[11px] text-gray-500">部门内排名</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">
              第 {deptNow} 名
              <span className={`ml-1 text-sm ${deptNow < deptPrev ? 'text-emerald-600' : deptNow > deptPrev ? 'text-red-500' : 'text-gray-400'}`}>
                {arrow(deptNow, deptPrev)}
              </span>
            </div>
            <div className="text-[10px] text-gray-400">华东一部</div>
          </div>
        </div>
        <GrayNote>榜单脱敏：只显示你的名次与升降（并列跳号规则随全局）。</GrayNote>
      </Card>

      {/* 区四 · 我的漏斗（干活入口） */}
      <Card>
        <CardTitle right={<span className="text-[10px] text-gray-400">本月回款 {fmtYuan(oc.monthRevenue)}</span>}>
          区四 · 我的漏斗
        </CardTitle>
        <div className="grid grid-cols-3 gap-2 text-center">
          {FUNNEL_STAGES.map((s) => (
            <Link key={s} to={`/sales/customers?stage=${s}`} className="rounded-xl bg-gray-50 py-2.5 active:bg-gray-100">
              <div className="text-[11px] text-gray-500">{STAGE_LABEL[s]}</div>
              <div className="text-xl font-bold tabular-nums">{stocks?.[s] ?? 0}</div>
            </Link>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link to="/sales/customers/new" className="rounded-xl bg-gray-900 py-3 text-center text-sm font-semibold text-white active:bg-gray-700">
            ＋ 建档
          </Link>
          <Link to="/sales/customers" className="rounded-xl bg-gray-100 py-3 text-center text-sm font-semibold text-gray-800 active:bg-gray-200">
            推进客户 →
          </Link>
        </div>
      </Card>
    </Shell>
  );
}
