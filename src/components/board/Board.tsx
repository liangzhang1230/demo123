/**
 * 管理端决策看板（P3，看板章「一屏五区＋底部固定条」）。
 * 同一张板、两级裁剪：老板＝五区全量＋底部条；主管＝本部门裁剪＋摘除武器坞购买位与投产参照（§2）。
 * 死线①：本组件零计算——一切数字来自 buildBoardModel（domain 引擎直读）。
 */
import { useMemo, useState } from 'react';
import type { SeedData } from '../../domain/types';
import { fmtPct1, fmtRoi2 } from '../../domain/metrics';
import { buildBoardModel, type BoardScope, type TeamRow } from './model';
import { GradeChip, LockDash, Section, StallDots } from './ui';

export default function Board({ data, scope }: { data: SeedData; scope: BoardScope }) {
  const m = useMemo(() => buildBoardModel(data, scope), [data, scope]);
  const [toast, setToast] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const applyTrial = () => {
    setToast('已收到试看申请——上线后由商务开通（走经营智库既有试看方案）');
    window.setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="mx-auto max-w-md space-y-3 px-3 pb-10 pt-3 lg:max-w-5xl lg:space-y-4 lg:px-6">
      {/* ===== 看板头 ===== */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <div>
          <h1 className="text-base font-bold text-gray-900 lg:text-lg">
            {m.scopeTitle} · 决策看板
          </h1>
          <p className="text-[11px] text-gray-400">
            {m.isBoss ? `老板 ${m.viewerName}` : `主管 ${m.viewerName} · 本部门视图`} ｜ 模拟今天 {m.anchorDate}（开通第 {m.openDay} 天）
          </p>
        </div>
      </header>

      {/* ===== 区一 · 今日一件事（全局唯一置顶：待办＞诊断） ===== */}
      <Section no="区一" title="今日一件事" note="待办 ＞ 诊断 · 只置顶 1 件">
        {m.arbiter.top ? (
          <a
            href={m.arbiter.top.href}
            className="block rounded-xl border border-red-200 bg-red-50 p-3 active:bg-red-100"
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {m.arbiter.top.layer === 'todo' ? '待办' : '诊断'}
              </span>
              <span className="text-sm font-bold text-red-800">{m.arbiter.top.title}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-red-700">{m.arbiter.top.detail}</p>
            <p className="mt-1 text-[11px] text-red-400">→ 一键直达：团队一屏带教名单（动作在源模块落痕）</p>
          </a>
        ) : (
          <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-500">{m.arbiter.fallback}</p>
        )}
        {m.arbiter.rest.length > 0 && (
          <p className="mt-2 text-[11px] text-gray-400">今日其余 {m.arbiter.rest.length} 件（折叠）</p>
        )}
      </Section>

      {/* ===== 区二 · 经营心跳（固定 6 数 · 数值＋白话双行） ===== */}
      <Section no="区二" title="经营心跳" note="固定 6 数 · 不增不减">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {m.heartbeat.map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-50 p-2.5">
              <div className="text-[11px] text-gray-500">{c.label}</div>
              {c.locked ? (
                <LockDash line={c.locked.valueLine} />
              ) : (
                <>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-lg font-bold tabular-nums text-gray-900">{c.value ?? '—'}</span>
                    {c.mom != null && (
                      <span className={`text-[11px] font-semibold ${c.mom >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {c.mom >= 0 ? '↑' : '↓'}
                        {fmtPct1(Math.abs(c.mom))}
                      </span>
                    )}
                    <GradeChip grade={c.grade} />
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{c.sub}</p>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ===== 区三 · 钱事分诊条（三段：全部读包结论 → 未购锁段显 —＋一行价值语） ===== */}
      <Section no="区三" title="钱事分诊条" note="在漏｜待拿｜在赚 · 直读包结论">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border-l-4 border-red-300 bg-red-50/50 p-3">
            <div className="text-xs font-bold text-red-700">在漏（红）</div>
            <LockDash line="开通人效操盘包，这里每天告诉你在漏多少钱" />
          </div>
          <div className="rounded-xl border-l-4 border-yellow-300 bg-yellow-50/50 p-3">
            <div className="text-xs font-bold text-yellow-700">待拿（黄）</div>
            <LockDash line="开通增长操盘包，沉睡客户与超期管道都翻成钱" />
          </div>
          <div className="rounded-xl border-l-4 border-green-300 bg-green-50/50 p-3">
            <div className="text-xs font-bold text-green-700">在赚（绿）</div>
            <LockDash line="开通人效操盘包，谁已回本、谁在替你赚一眼可见" />
          </div>
        </div>
      </Section>

      {/* ===== 区四 · 团队一屏（人的矩阵；回本列/象限列随未购包隐藏） ===== */}
      <Section
        id="team"
        no="区四"
        title="团队一屏"
        note={`紧急度分诊排序 · 停滞在管 ${m.stall.managedCnt} 家（红 ${m.stall.total.red}／橙 ${m.stall.total.orange}／黄 ${m.stall.total.yellow}）`}
      >
        <div className="mb-1 hidden grid-cols-[1fr_5rem_7rem_6rem] gap-2 px-2 text-[11px] text-gray-400 lg:grid">
          <span>成员</span>
          <span className="text-right">labor_roi</span>
          <span className="text-right">排名（全员·部门）</span>
          <span className="text-right">停滞 红/橙/黄</span>
        </div>
        <ul className="divide-y divide-gray-100">
          {m.team.map((r) => (
            <TeamRowView key={r.id} r={r} isBoss={m.isBoss} open={openRow === r.id} onToggle={() => setOpenRow(openRow === r.id ? null : r.id)} />
          ))}
        </ul>
      </Section>

      {/* ===== 区五 · 武器坞（货架 · 锁卡三要素；主管摘除购买位整排） ===== */}
      {m.lockCards && (
        <Section no="区五" title="武器坞" note="锁的不是功能，是你已攒好的数据">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {m.lockCards.map((c) => (
              <div key={c.key} className="flex flex-col rounded-xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[13px] font-bold text-gray-800">{c.name}</h3>
                  <span className="text-sm" aria-label="未购上锁">🔒</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">{c.tagline}</p>
                <p className="mt-1.5 text-[11px] italic leading-snug text-gray-400">「{c.hook}」</p>
                <div className="mt-auto pt-2">
                  <p className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                    ✅ {c.readyBadge}
                  </p>
                  <button
                    onClick={applyTrial}
                    className="mt-2 w-full rounded-lg border border-gray-300 py-1.5 text-xs font-semibold text-gray-700 active:bg-gray-100"
                  >
                    试看申请
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ===== 底部固定条（筛人漏斗小块＋系统投入产出参照——仅老板，§8） ===== */}
      {m.isBoss && (
        <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="font-bold text-gray-700">筛人漏斗</span>
              {m.screening ? (
                <span className="ml-2">
                  在筛 1 人：{m.screening.name} · 第 {m.screening.day} 天／{m.screening.windowDays} 天转正窗 · 窗内 labor_roi{' '}
                  <b className="tabular-nums">{fmtRoi2(m.screening.roi)}</b>（爬坡中，转正窗满出结论）
                </span>
              ) : (
                <span className="ml-2 text-gray-400">本期无在筛新人</span>
              )}
            </div>
            <div className="text-gray-400">
              <span className="font-bold text-gray-500">系统投入产出参照</span>
              <span className="ml-2">— 🔑 随人效操盘包 · 回本仪表盘开通后显示（仅老板可见）</span>
            </div>
          </div>
        </section>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-gray-900 px-4 py-2 text-xs text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function TeamRowView({
  r, isBoss, open, onToggle,
}: { r: TeamRow; isBoss: boolean; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button onClick={onToggle} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5 px-1 py-2 text-left lg:grid-cols-[1fr_5rem_7rem_6rem] lg:px-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-gray-900">{r.name}</span>
            {r.isManager && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">主管</span>}
            {isBoss && <span className="text-[10px] text-gray-400">{r.deptName}</span>}
            {r.screeningDay != null && (
              <span className="rounded bg-blue-50 px-1 text-[10px] font-medium text-blue-600">筛选中 · 第 {r.screeningDay} 天</span>
            )}
            {r.idleDays != null && r.idleDays >= 30 && (
              <span className="rounded bg-red-50 px-1 text-[10px] font-bold text-red-600">{r.idleDays} 天零业务事件</span>
            )}
          </div>
          {/* 手机端第二行：三列指标合并展示 */}
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-gray-500 lg:hidden">
            <span>roi <b className="tabular-nums text-gray-800">{fmtRoi2(r.laborRoi)}</b></span>
            <span>全员 <b className="text-gray-800">#{r.companyRank}</b> · 部门 <b className="text-gray-800">#{r.deptRank}</b></span>
          </div>
        </div>
        <span className="justify-self-end lg:hidden"><StallDots {...r.stall} /></span>
        <span className="hidden text-right text-sm font-semibold tabular-nums text-gray-800 lg:block">{fmtRoi2(r.laborRoi)}</span>
        <span className="hidden text-right text-sm text-gray-700 lg:block">#{r.companyRank} · #{r.deptRank}</span>
        <span className="hidden justify-self-end lg:block"><StallDots {...r.stall} /></span>
      </button>
      {open && (
        <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-[11px] text-gray-600 sm:grid-cols-5">
          <span>线索 <b className="tabular-nums">{r.stocks.lead}</b></span>
          <span>意向 <b className="tabular-nums">{r.stocks.intent}</b></span>
          <span>样品 <b className="tabular-nums">{r.stocks.sample}</b></span>
          <span>签约未回款 <b className="tabular-nums">{r.stocks.signed}</b></span>
          <span>本月回款 <b className="tabular-nums">¥{r.monthRevenue.toLocaleString('zh-CN')}</b></span>
        </div>
      )}
    </li>
  );
}
