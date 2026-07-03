/**
 * 管理端决策看板（看板章【定稿】）：一屏五区＋底部固定条，F 型动线。
 * 死线①：看板不产口径——本组件零计算、零判定，只读 computeAll/engine 既有派生位排版。
 * 三级裁剪：老板＝全公司五区全量；主管＝本部门裁剪＋摘除武器坞购买位与投产参照。
 * 货架诚实法则：未购包一律上锁显 —＋一行价值语，绝不预演任何付费结论数字。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppStore';
import {
  absRate, DASH, daysInMonth, fmtPct0, fmtRoi2, fmtSignedPct1, fmtWan, fmtYuan,
  paceRate, sevenLevel, tenureDays,
} from '../domain/engine';
import { BoardGrid, Card, CardTitle, ExampleBadge, GrayNote, LevelChip, PaceBar, Shell, Stat, StallDots } from './ui';

export function ManagementBoard({ role }: { role: 'boss' | 'manager' }) {
  const { data, computed, unlocked, setUnlocked } = useApp();
  const [toast, setToast] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);

  const managerId = 'liumin';
  const deptId = role === 'manager' ? (data.people.find((p) => p.id === managerId)?.deptId ?? 'd1') : null;
  const dept = deptId ? computed.depts[deptId] : null;
  const deptName = deptId ? data.departments.find((d) => d.id === deptId)?.name : null;

  const members = useMemo(
    () =>
      data.people.filter((p) => p.role !== 'boss' && (deptId ? p.deptId === deptId : true)),
    [data.people, deptId],
  );

  // —— 区块取数（读侧直读，范围随三级裁剪）——
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

  const elapsed = Number(computed.asOf.slice(8, 10));
  const totalDays = daysInMonth(computed.ym);
  const pace = paceRate(scopeMonthRevenue, scopeTarget, elapsed, totalDays);
  const paceLevel = sevenLevel(pace);
  const [momPrev, momCur] = computed.company.momPair;
  const momLabel = `完整月环比 ${Number(momCur.slice(5, 7))}月 vs ${Number(momPrev.slice(5, 7))}月`;

  // 王五钩子（读侧：末次业务事件距今天数）
  const idleDaysOf = (id: string) => {
    const last = computed.folded.perOwner[id]?.lastEventDate;
    if (!last) return null;
    return Math.round((Date.parse(computed.asOf) - Date.parse(last)) / 86400000);
  };

  // 今日有单据/活动且未确认的账号（应确认口径 §6.9；演示中确认状态由 P5 操作产生）
  const unconfirmedToday = useMemo(() => {
    const confirmedSet = new Set(data.confirmations?.[computed.asOf] ?? []);
    return members.filter(
      (p) => data.events.some((e) => e.ownerId === p.id && e.date === computed.asOf) && !confirmedSet.has(p.id),
    );
  }, [data, computed.asOf, members]);

  // —— 区一 · 今日一件事（待办 ＞ 诊断，自上而下首次命中即停）——
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

  // —— 区四 · 团队一屏（紧急度分诊：红告警前置）——
  const teamRows = useMemo(() => {
    return members
      .map((p) => {
        const oc = computed.owners[p.id];
        const roi = computed.folded.perOwnerRoi[p.id] ?? null;
        return {
          p,
          roi,
          rankTotal: computed.rankings.totalByOwner[p.id],
          rankDept: computed.rankings.deptByOwner[p.id],
          monthRevenue: oc?.monthRevenue ?? 0,
          stall: oc?.stall ?? { dying: 0, warning: 0, watch: 0 },
          idle: idleDaysOf(p.id),
          tenure: p.hireDate ? tenureDays(p.hireDate, computed.asOf) : null,
        };
      })
      .sort(
        (a, b) =>
          b.stall.dying - a.stall.dying ||
          b.stall.warning - a.stall.warning ||
          (a.roi ?? Infinity) - (b.roi ?? Infinity),
      );
  }, [members, computed]);

  const openDays = Math.round((Date.parse(computed.asOf) - Date.parse(data.openDate)) / 86400000) + 1;

  const packs = [
    { key: 'pack1', name: '操盘包① · 人效操盘包', value: '这些人值不值、该招该汰该扩——招·用·汰·扩一条链', to: '/sample/pack1', job: '今日作业：王五每月净烧 ¥8,900——止血建议已就绪' },
    { key: 'pack2', name: '操盘包② · 增长操盘包', value: '下一笔钱在哪、现金什么时候回——找钱四步闭环', to: '/sample/pack2', job: '今日作业：样品→签约卡点，估算卡着 ¥49.6万' },
    { key: 'pack3', name: '操盘包③ · 销冠 DNA 克隆引擎', value: '她凭什么是销冠？她走了怎么办？——把销冠战法变成公司资产', to: '/sample/pack3', job: '今日作业：赵敏首要带教点＝样品→签约（对标王丽）' },
    { key: 'pack4', name: '操盘包④ · 经营黑匣子', value: '我是怎么走到今天的、我的拍板值不值——决策→结果因果回放', to: '/sample/pack4', job: '本月作业：6 月航迹已生成——B 品类提价回放' },
    { key: 'library', name: '经营智库', value: '定薪建议：底薪该给多少、提成该怎么设——用同行数据答', to: '/sample/library', job: '定薪建议：底薪带 ¥4,800–6,500 已就绪' },
  ];

  const roleTitle = role === 'boss' ? `${data.tenant.bossName}（老板）· 决策看板` : `刘敏（主管）· ${deptName}`;

  return (
    <Shell
      title={roleTitle}
      subtitle={`${data.tenant.name} ｜ 模拟今天 ${computed.asOf} · 开通第 ${openDays} 天`}
      tone="boss"
    >
      {/* AI 操盘手晨话（静态位：白话原语回退层——AI 挂了系统一字不缺） */}
      {role === 'boss' && (
        <div className="rounded-2xl bg-gray-900 px-4 py-3 text-sm leading-6 text-gray-100">
          🎙 陈总早。今天的火我已替你排好序：先看停滞红色积压，再看样品池的转出率——它掉得不正常。
          <div className="mt-1 text-[10px] text-gray-400">上线后由 AI 销售操盘手按你的真实数据每日生成</div>
        </div>
      )}

      {/* 区一 · 今日一件事 */}
      <Card>
        <CardTitle>区一 · 今日一件事{deptId ? '（本部门）' : ''}</CardTitle>
        {arbitration.length === 0 ? (
          <p className="text-sm text-gray-500">今天没有火，去看看钱——先看区二心跳。</p>
        ) : (
          <div>
            <div
              className={`rounded-xl border p-3 text-sm leading-5 ${
                arbitration[0].tone === 'red'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : arbitration[0].tone === 'orange'
                    ? 'border-orange-200 bg-orange-50 text-orange-800'
                    : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}
            >
              <span className="mr-1.5 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">{arbitration[0].kind}</span>
              {arbitration[0].text}
            </div>
            {arbitration.length > 1 && (
              <button className="mt-2 text-xs text-gray-500 underline-offset-2 hover:underline" onClick={() => setShowRest((v) => !v)}>
                今日其余 {arbitration.length - 1} 件 {showRest ? '▲' : '▼'}
              </button>
            )}
            {showRest &&
              arbitration.slice(1).map((it, i) => (
                <div key={i} className="mt-1.5 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                  <span className="mr-1 font-semibold">{it.kind}</span>
                  {it.text}
                </div>
              ))}
          </div>
        )}
      </Card>

      {/* 销售早报样卡（必发核心 §10.4.1；演示中随事件流实时重算，模拟过一天即刷新） */}
      {role === 'boss' && (
        <Card className="!border-sky-200 bg-sky-50/60">
          <CardTitle right={<span className="text-[10px] text-gray-400">工作日 8:00 推送 · 演示为实时刷新</span>}>
            📨 销售早报 · {Number(computed.asOf.slice(5, 7))}月{Number(computed.asOf.slice(8, 10))}日
          </CardTitle>
          <div className="space-y-1 text-xs leading-5 text-gray-700">
            <div>
              确认：已确认 {members.filter((p) => data.events.some((e) => e.ownerId === p.id && e.date === computed.asOf)).length - unconfirmedToday.length} ／ 未确认 {unconfirmedToday.length}
              {unconfirmedToday.length > 0 && `（${unconfirmedToday.slice(0, 3).map((p) => p.name).join('·')}${unconfirmedToday.length > 3 ? ' 等' : ''}）`}
            </div>
            <div>
              本月人效比 {fmtRoi2(scopeRoi)} ｜ 回款达标 {fmtPct0(absRate(scopeMonthRevenue, scopeTarget))} ｜ 剩 {totalDays - elapsed} 天
            </div>
            <div>停滞：{scopeStall.dying} 个濒死客户待处理</div>
            <div className="text-sky-600">打开系统 →</div>
          </div>
        </Card>
      )}

      {/* 区二 · 经营心跳（固定 6 数 · 数值＋白话双行） */}
      <Card>
        <CardTitle right={<span className="text-[10px] text-gray-400">固定 6 数 · 实时折算</span>}>
          区二 · 经营心跳{deptId ? '（本部门汇总）' : ''}
        </CardTitle>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          <Stat
            label="本月净利"
            value={fmtWan(scopeMonthNet)}
            plain={`${momLabel} ${fmtSignedPct1(scopeNetMom)}`}
          />
          <Stat
            label="本月回款"
            value={fmtWan(scopeMonthRevenue)}
            plain={`现金进账 ${fmtWan(scopeMonthRevenue)} · ${momLabel} ${fmtSignedPct1(scopeRevenueMom)}`}
          />
          <Stat
            label={deptId ? '部门 labor_roi' : '团队 labor_roi'}
            value={fmtRoi2(scopeRoi)}
            plain={scopeRoi != null ? `每付 1 元工资赚回 ${fmtRoi2(scopeRoi)} 元（Σ净利÷Σ成本）` : '—（未设成本）'}
          />
          <Stat
            label="本月成交"
            value={`${scopeFirstDeals + scopeRepeatOrders} 单`}
            plain={`新客 ${scopeFirstDeals} ＋ 复购 ${scopeRepeatOrders} 单（${scopeRepeatCusts} 家）`}
          />
          <Stat
            label="目标进度 pace"
            value={
              <span className="flex items-center gap-1.5">
                {fmtPct0(pace)}
                <LevelChip level={paceLevel} />
              </span>
            }
            plain={
              <span className="block">
                <PaceBar rate={pace} level={paceLevel} />
                <span className="mt-1 block">
                  {pace == null ? '目标未设' : pace >= 1 ? `进度 ${fmtPct0(pace)}，跑在日历前面` : `进度 ${fmtPct0(pace)}，落后于日历`}
                  （月目标 {fmtWan(scopeTarget)}）
                </span>
              </span>
            }
          />
          {unlocked ? (
            <Stat
              label="30 天现金前瞻"
              value={<span className="flex items-center gap-1.5">¥17.0万 <ExampleBadge inline /></span>}
              plain="未来 30 天预计回款（估算 · 示例数据）"
            />
          ) : (
            <Stat label="30 天现金前瞻" value={DASH} locked plain="开通增长操盘包，这里每天预告未来 30 天回款（估算）🔑" />
          )}
        </div>
      </Card>

      {/* 区三 · 钱事分诊条（三段 · 全部读包结论；未购显 —＋价值语；点亮＝静态示例值＋角标） */}
      <Card>
        <CardTitle right={unlocked ? <ExampleBadge inline /> : undefined}>区三 · 钱事分诊条</CardTitle>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-red-100 bg-red-50/50 p-3">
            <div className="text-[11px] font-semibold text-red-600">在漏 {unlocked ? '' : '🔒'}</div>
            {unlocked ? (
              <div className="text-sm font-bold leading-5 text-gray-900">
                ¥8,900/月<div className="text-[10px] font-normal text-gray-500">止血分诊 · 分列</div>
                ¥49.6万<div className="text-[10px] font-normal text-gray-500">卡点卡住营收（估算）</div>
              </div>
            ) : (
              <>
                <div className="text-lg font-bold text-gray-300">{DASH}</div>
                <p className="mt-1 text-[10px] leading-4 text-gray-500">开通人效操盘包，这里每天告诉你在漏多少钱</p>
              </>
            )}
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
            <div className="text-[11px] font-semibold text-amber-600">待拿 {unlocked ? '' : '🔒'}</div>
            {unlocked ? (
              <div className="text-sm font-bold leading-5 text-gray-900">
                ¥23.8万<div className="text-[10px] font-normal text-gray-500">38 家休眠唤醒估值（估算）</div>
              </div>
            ) : (
              <>
                <div className="text-lg font-bold text-gray-300">{DASH}</div>
                <p className="mt-1 text-[10px] leading-4 text-gray-500">开通增长操盘包，这里估算沉睡金矿与超期管道</p>
              </>
            )}
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
            <div className="text-[11px] font-semibold text-emerald-600">在赚 {unlocked ? '' : '🔒'}</div>
            {unlocked ? (
              <div className="text-sm font-bold leading-5 text-gray-900">
                7 / 10 人已回本<div className="text-[10px] font-normal text-gray-500">＋本月里程碑：回款新高</div>
              </div>
            ) : (
              <>
                <div className="text-lg font-bold text-gray-300">{DASH}</div>
                <p className="mt-1 text-[10px] leading-4 text-gray-500">开通人效操盘包，这里显示已回本人数与里程碑</p>
              </>
            )}
          </div>
        </div>
      </Card>

      <BoardGrid>
        {/* 区四 · 团队一屏 */}
        <Card>
          <CardTitle right={<span className="text-[10px] text-gray-400">紧急度分诊 · 红告警前置</span>}>
            区四 · 团队一屏{deptId ? `（${deptName}）` : ''}
          </CardTitle>
          <div className="divide-y divide-gray-100">
            <div className="grid grid-cols-12 gap-1 pb-1.5 text-[10px] text-gray-400">
              <div className="col-span-3">成员</div>
              <div className="col-span-2 text-right">labor_roi</div>
              <div className="col-span-1 text-right">排名</div>
              <div className="col-span-3 text-right">本月回款</div>
              <div className="col-span-3 text-right">停滞</div>
            </div>
            {teamRows.map((r) => (
              <div key={r.p.id} className="grid grid-cols-12 items-center gap-1 py-2">
                <div className="col-span-3 min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
                    {r.p.name}
                    {!deptId && (
                      <span className="text-[10px] text-gray-400">
                        {data.departments.find((d) => d.id === r.p.deptId)?.name.replace('华东', '')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {r.p.role === 'manager' && <span className="text-gray-400">主管</span>}
                    {r.tenure != null && r.tenure <= 90 && (
                      <span className="rounded bg-blue-50 px-1 text-blue-600">新人 · 第 {r.tenure} 天</span>
                    )}
                    {r.idle != null && r.idle >= 30 && (
                      <span className="rounded bg-red-50 px-1 font-semibold text-red-600">{r.idle} 天零业务事件</span>
                    )}
                  </div>
                </div>
                <div className={`col-span-2 text-right text-sm font-semibold tabular-nums ${r.roi != null && r.roi < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                  {fmtRoi2(r.roi)}
                </div>
                <div className="col-span-1 text-right text-sm tabular-nums text-gray-700">
                  {deptId ? r.rankDept : r.rankTotal}
                </div>
                <div className="col-span-3 text-right text-[13px] tabular-nums text-gray-800">{fmtYuan(r.monthRevenue)}</div>
                <div className="col-span-3 text-right">
                  <StallDots {...r.stall} />
                </div>
              </div>
            ))}
          </div>
          <GrayNote>回本状态列与量质象限列随人效/销冠 DNA 包开通后点亮（未购隐藏）。</GrayNote>
        </Card>

        {/* 区五 · 武器坞（活锁两态；「一键点亮全家桶」仅演示版存在，正式版无此物） */}
        <Card>
          <CardTitle
            right={
              role === 'boss' ? (
                <button
                  data-testid="unlock-toggle"
                  onClick={() => setUnlocked(!unlocked)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${
                    unlocked ? 'bg-amber-100 text-amber-700 ring-amber-300' : 'bg-gray-100 text-gray-600 ring-gray-300'
                  }`}
                >
                  {unlocked ? '⏻ 一键回锁（演示专属）' : '✨ 一键点亮全家桶（演示专属）'}
                </button>
              ) : (
                <span className="text-[10px] text-gray-400">货架 · 锁卡安静陈列</span>
              )
            }
          >
            区五 · 武器坞
          </CardTitle>
          {role === 'boss' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {packs.map((pk) => (
                <Link
                  key={pk.key}
                  to={pk.to}
                  className={`relative block rounded-xl border p-3 active:opacity-80 ${
                    unlocked ? 'border-amber-300 bg-amber-50/60' : 'border-dashed border-gray-300 bg-gray-50'
                  }`}
                >
                  {unlocked ? (
                    <>
                      <div className="flex items-start justify-between gap-2 pr-14">
                        <div className="text-sm font-semibold text-gray-800">✨ {pk.name}</div>
                      </div>
                      <ExampleBadge />
                      <p className="mt-1 text-xs leading-4 text-gray-600">{pk.job}</p>
                      <div className="mt-2 text-[11px] font-medium text-amber-700">点开查看样例长页 →</div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-semibold text-gray-700">🔒 {pk.name}</div>
                      <p className="mt-1 text-xs leading-4 text-gray-500">{pk.value}</p>
                      <div className="mt-2 inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                        数据就绪：该演示租户已沉淀 {computed.folded.totalDealCnt} 笔成交 / {openDays} 天数据
                      </div>
                      <div className="mt-2">
                        <button
                          className="rounded-lg bg-gray-900 px-2.5 py-1 text-xs text-white"
                          onClick={(e) => {
                            e.preventDefault();
                            setToast('试看申请已记录——上线后由商务开通');
                          }}
                        >
                          试看申请
                        </button>
                        <span className="ml-2 text-[10px] text-gray-400">点卡片看样例 →</span>
                      </div>
                    </>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <GrayNote>（主管版摘除购买位——已购包的本部门作业行将在此显示）</GrayNote>
          )}
          {/* 功能位活卡（随开关显隐；演示中全开） */}
          <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs">
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span className="font-medium text-gray-700">✅ 停滞预警</span>
              <StallDots {...scopeStall} />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span className="font-medium text-gray-700">✅ 悬赏令</span>
              <span className="max-w-[60%] truncate text-gray-500">{data.bounty}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span className="font-medium text-gray-700">✅ 销售早报</span>
              <span className="text-gray-500">工作日 8:00 推送</span>
            </div>
          </div>
        </Card>
      </BoardGrid>

      {/* 底部固定条 */}
      <Card className="!py-3">
        <div className="flex flex-col gap-1.5 text-xs text-gray-600">
          <div>
            <span className="font-semibold text-gray-700">筛人漏斗：</span>
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
            <GrayNote>系统投入产出参照 🔒：未购人效操盘包——开通后此处按月显示「系统费 vs 同期净利」诚实参照。</GrayNote>
          )}
        </div>
      </Card>

      {toast && (
        <div
          className="fixed inset-x-0 bottom-20 z-50 mx-auto w-fit cursor-pointer rounded-full bg-gray-900 px-4 py-2 text-xs text-white shadow-lg"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </Shell>
  );
}
