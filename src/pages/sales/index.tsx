/**
 * /sales 销售端看板 · 唯一事实源＝v1.0「租户决策看板 · 销售端」章（P4）
 * 结构固定：置顶悬赏令栏 ＋ 区一今日待办 ＋ 区二我的目标 ＋ 区三我的排名 ＋ 区四我的漏斗。
 * 五条死线落实：
 *  ① 看板不产口径——每个数字直读 domain 纯函数，本文件零判定、零阈值、零落库；
 *  ② 零经营口径——本页唯一金额＝本人回款实际 vs 回款目标（既有豁免）；
 *  ③ 零羞辱只给路——停滞只作待推进优先级提示，带教只显目标环节；
 *  ④ 休息日静默——待办区不点名不催办，业务照常可录；
 *  ⑤ 演示身份王丽无「新人」标签，正序切换逻辑不触发。
 * 建档/推进/确认页/客户卡为录入动作，发生在源模块页（P5 接入），本板只路由。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SeedData } from '../../domain/types';
import { FUNNEL_STAGES, STAGE_LABEL } from '../../domain/types';
import { isRestDay } from '../../domain/calendar';
import { absRate, dailyTarget, paceRate } from '../../domain/targets';
import { rankOf, rankWithSkippedTies, type Ranked } from '../../domain/ranking';
import {
  STALL_LEVEL_LABEL, STALL_LEVEL_ORDER, currentStagesOf, stallListForOwner, type StallLevelKey,
} from '../../domain/stallSales';
import { monthRevenueByOwner, ownerDayProcess } from '../../domain/selectors';
import GradeBadge from '../../components/GradeBadge';
import PaceBar from '../../components/PaceBar';

/** 演示身份（免密三身份之销售：王丽） */
const ME = 'wangli';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const STALL_DOT: Record<StallLevelKey, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-400',
  yellow: 'bg-yellow-400',
};
const STALL_TEXT: Record<StallLevelKey, string> = {
  red: 'text-red-600',
  orange: 'text-orange-600',
  yellow: 'text-yellow-600',
};

const yuan = (v: number) => `¥${v.toLocaleString('zh-CN')}`;

export default function SalesPage({ data, confirmedToday = false }: { data: SeedData; confirmedToday?: boolean }) {
  const [showAllStall, setShowAllStall] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  const anchor = data.anchorDate;
  const ym = anchor.slice(0, 7);
  const restDay = isRestDay(anchor);
  const me = data.people.find((p) => p.id === ME)!;
  const myDept = data.departments.find((d) => d.id === me.deptId)!;

  /** ① 确认页状态（P5 已接入：读当日确认记录）；休息日静默 */
  const confirmPending = !restDay && !confirmedToday;
  /** ③ 带教任务（受教者视角静态一条：目标环节＋指派人＋起始日，施工包 P4 清单） */
  const teachTask = { goal: '本周专练：意向→样品 推进', assigner: '刘敏', since: '06-24', status: '进行中' };

  const view = useMemo(() => {
    // 区一② 待推进（本人停滞列表，等级→ABCD→停留天数倒序）
    const stall = stallListForOwner(data.events, data.customers, ME, anchor);
    const stallCounts = { red: 0, orange: 0, yellow: 0 } as Record<StallLevelKey, number>;
    for (const s of stall) stallCounts[s.level]++;

    // 区二 单日三过程量 ＋ 月回款 pace
    const dayProc = ownerDayProcess(data.events, ME, anchor);
    const procTarget = data.targets.personMonthlyProcess[ME];
    const revTarget = data.targets.personMonthlyRevenue[ME] ?? null;
    const revByOwner = monthRevenueByOwner(data.events, ym, anchor);
    const myMonthRev = revByOwner[ME]?.value ?? 0;
    const pace = paceRate(myMonthRev, revTarget, anchor);

    // 区三 排名（本月回款，今日 vs 昨日定版对比）
    const participants = data.people.filter((p) => p.deptId !== null);
    const toInputs = (rev: Record<string, { value: number; lastTime: string }>, ids: string[]) =>
      ids.map((id) => ({ id, value: rev[id]?.value ?? 0, tieTime: rev[id]?.lastTime }));
    const allIds = participants.map((p) => p.id);
    const deptIds = participants.filter((p) => p.deptId === me.deptId).map((p) => p.id);
    const revYesterday = monthRevenueByOwner(data.events, ym, data.yesterdaySnapshot.date);
    const boardAll = rankWithSkippedTies(toInputs(revByOwner, allIds));
    const boardDept = rankWithSkippedTies(toInputs(revByOwner, deptIds));
    const yAll = rankWithSkippedTies(toInputs(revYesterday, allIds));
    const yDept = rankWithSkippedTies(toInputs(revYesterday, deptIds));

    // 区四 本人六态存量（由事件流派生的当前状态逐客户计数）
    const stages = currentStagesOf(data.events, anchor);
    const stocks = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<string, number>;
    for (const c of data.customers) {
      if (c.ownerId !== ME) continue;
      const info = stages.get(c.id);
      if (info) stocks[info.stage]++;
    }

    return {
      stall, stallCounts, dayProc, procTarget, revTarget, myMonthRev, pace,
      boardAll, boardDept,
      myRankAll: rankOf(boardAll, ME), myRankDept: rankOf(boardDept, ME),
      yRankAll: rankOf(yAll, ME), yRankDept: rankOf(yDept, ME),
      stocks,
    };
  }, [data, anchor, ym, me.deptId]);

  const stallTop5 = view.stall.slice(0, 5);
  const stallRest = view.stall.length - stallTop5.length;
  const nameOf = (id: string) => data.people.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-md px-4 py-5 sm:max-w-2xl">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <Link to="/" className="text-xs text-gray-400">← 身份切换</Link>
          <h1 className="text-lg font-bold">
            {me.name} <span className="text-sm font-normal text-gray-500">· {myDept.name} · 销售端</span>
          </h1>
        </div>
        <p className="text-xs text-gray-400">
          今天 {anchor} {WEEKDAY[new Date(anchor + 'T00:00:00Z').getUTCDay()]}
        </p>
      </header>

      {/* 置顶 · 悬赏令栏（法定落位：只显示，不判达成、不算钱） */}
      {data.bounty && (
        <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800">
          📣 {data.bounty}
        </div>
      )}

      {/* 区一 · 今日待办 */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">区一 · 今日待办</h2>
        {restDay ? (
          <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
            今日休息，业务照常可录
          </p>
        ) : confirmPending || view.stall.length > 0 || teachTask ? (
          <div className="space-y-3">
            {/* ① 今日确认页（未确认则置顶提示） */}
            {confirmPending && (
              <Link
                to="/sales/confirm"
                className="flex w-full items-center justify-between rounded-lg bg-blue-50 px-3 py-2.5 text-left"
              >
                <span className="text-sm font-medium text-blue-800">① 今日确认页 · 未完成</span>
                <span className="text-xs text-blue-500">23:00 前完成 ›</span>
              </Link>
            )}

            {/* ② 待推进（停滞预警销售端列表，Top 5） */}
            {view.stall.length > 0 && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="shrink-0 text-sm font-medium text-gray-700">② 待推进</span>
                <span className="text-xs text-gray-500">
                  你有 <b className="text-red-600">{view.stall.length}</b> 个客户停滞待处理（
                  {STALL_LEVEL_ORDER.map((k, i) => (
                    <span key={k} className={STALL_TEXT[k]}>
                      {i > 0 && ' / '}
                      {STALL_LEVEL_LABEL[k]} {view.stallCounts[k]}
                    </span>
                  ))}
                  ）
                </span>
              </div>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {(showAllStall ? view.stall : stallTop5).map((s) => (
                  <li key={s.customerId} className="flex items-center gap-2 px-3 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STALL_DOT[s.level]}`} />
                    <Link
                      to={`/sales/customer/${s.customerId}`}
                      className="min-w-0 flex-1 truncate text-left text-sm text-gray-800"
                    >
                      {s.name}
                    </Link>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      {s.abcd} · {STAGE_LABEL[s.stage]}
                    </span>
                    <span className={`w-20 text-right text-xs tabular-nums ${STALL_TEXT[s.level]}`}>
                      停留 {s.stayDays} 天
                    </span>
                  </li>
                ))}
              </ul>
              {stallRest > 0 && (
                <button
                  onClick={() => setShowAllStall((v) => !v)}
                  className="mt-1.5 w-full text-center text-xs text-gray-400"
                >
                  {showAllStall ? '收起 ▴' : `还有 ${stallRest} 家 ▾`}
                </button>
              )}
            </div>
            )}

            {/* ③ 带教任务（受教者视角，静态：只显目标环节，零差距零对比） */}
            {teachTask && (
              <div className="rounded-lg bg-gray-50 px-3 py-2.5">
                <p className="text-sm font-medium text-gray-700">③ 带教任务 · {teachTask.goal}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  指派人 {teachTask.assigner} · 起始 {teachTask.since} · {teachTask.status}
                </p>
              </div>
            )}

            {/* ④ 待联系清单：包②未购 → 本项自然缺位 */}
          </div>
        ) : (
          /* 四源全空 → 兜底语（销售端章 §3） */
          <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
            今日无待办——去区四建新档，或推一把黄色客户
          </p>
        )}
      </section>

      {/* 区二 · 我的目标 */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">区二 · 我的目标</h2>
        <div className="grid grid-cols-3 gap-2">
          {([
            ['线索', view.dayProc.lead, view.procTarget?.lead],
            ['意向', view.dayProc.intent, view.procTarget?.intent],
            ['样品', view.dayProc.sample, view.procTarget?.sample],
          ] as const).map(([label, actual, monthTarget]) => {
            const t = dailyTarget(monthTarget ?? null, ym);
            return (
              <div key={label} className="rounded-lg bg-gray-50 px-2 py-2.5 text-center">
                <div className="text-xs text-gray-500">{label}（今日）</div>
                <div className="my-0.5 text-2xl font-bold tabular-nums">{actual}</div>
                <div className="mb-1 text-xs text-gray-400">目标 {t == null ? '—' : t.toFixed(1)}</div>
                <GradeBadge rate={absRate(actual, t)} />
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm text-gray-600">本月回款目标</span>
            <span className="text-sm font-semibold tabular-nums">
              {yuan(view.myMonthRev)}
              <span className="font-normal text-gray-400"> / {view.revTarget ? yuan(view.revTarget) : '—'}</span>
            </span>
          </div>
          <PaceBar rate={view.pace} />
        </div>
      </section>

      {/* 区三 · 我的排名（只显名次与升降，不显差距） */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">区三 · 我的排名</h2>
          <span className="text-xs text-gray-400">本月回款榜</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <RankTile label="全员总排名" rank={view.myRankAll} prevRank={view.yRankAll} />
          <RankTile label={`部门排名 · ${myDept.name}`} rank={view.myRankDept} prevRank={view.yRankDept} />
        </div>
        <button
          onClick={() => setShowBoard((v) => !v)}
          className="mt-2 w-full text-center text-xs text-gray-400"
        >
          {showBoard ? '收起榜单 ▴' : '看完整榜单 ▾'}
        </button>
        {showBoard && (
          <div className="mt-1">
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {view.boardAll.map((r: Ranked) => (
                <li
                  key={r.id}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm ${r.id === ME ? 'bg-amber-50 font-semibold' : ''}`}
                >
                  <span className="w-8 tabular-nums text-gray-500">#{r.rank}</span>
                  <span className="flex-1">{nameOf(r.id)}{r.id === ME && '（我）'}</span>
                  {r.id === ME && <span className="tabular-nums">{yuan(r.value)}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-center text-xs text-gray-300">榜单脱敏：他人仅显名次，不显金额</p>
          </div>
        )}
      </section>

      {/* 区四 · 我的漏斗 */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">区四 · 我的漏斗</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          {FUNNEL_STAGES.map((s) => (
            <div key={s} className="rounded-lg bg-gray-50 py-2">
              <div className="text-xs text-gray-500">{STAGE_LABEL[s]}</div>
              <div className="text-xl font-bold tabular-nums">{view.stocks[s]}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Link
            to="/sales/new"
            className="flex-1 rounded-xl bg-gray-900 py-3 text-center text-sm font-semibold text-white active:bg-gray-700"
          >
            ＋ 建档
          </Link>
          <Link
            to="/sales/customers"
            className="flex-1 rounded-xl border border-gray-300 py-3 text-center text-sm font-semibold text-gray-700 active:bg-gray-50"
          >
            推进 ›
          </Link>
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-2.5">
          <span className="text-sm text-gray-600">本月回款小计</span>
          <span className="text-base font-bold tabular-nums">{yuan(view.myMonthRev)}</span>
        </div>
      </section>

    </div>
  );
}

function RankTile({ label, rank, prevRank }: { label: string; rank: number | null; prevRank: number | null }) {
  let arrow = <span className="text-xs text-gray-400">— 持平</span>;
  if (rank != null && prevRank != null && rank !== prevRank) {
    arrow =
      prevRank > rank ? (
        <span className="text-xs font-medium text-green-600">▲ 升 {prevRank - rank}</span>
      ) : (
        <span className="text-xs font-medium text-red-500">▼ 降 {rank - prevRank}</span>
      );
  }
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="my-0.5 text-2xl font-bold tabular-nums">{rank == null ? '—' : `第 ${rank} 名`}</div>
      {arrow}
    </div>
  );
}
