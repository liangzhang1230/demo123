/**
 * /rookie · 新人筛选详情页（P12）：筛选组（≤15 天 · 优秀/普通/预警）全量面板
 * ＋ 筛人漏斗组（第 38/63/81 天）转正窗口对比。全部数据由事件流实时折算。
 * 决策按钮为演示位（正式版走「窗口满综合判定＋留痕，老板一键、默认留人」）。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { periodOrdersList } from '../../domain/compute';
import { fmtPct0, fmtRoi2, fmtWan, fmtYuan, sevenLevel, tenureDays } from '../../domain/engine';
import { FUNNEL_STAGES, STAGE_LABEL } from '../../domain/types';
import { AiHint, BCard, BoardShell, DarkLevelChip, DrillRow, Medal, TL } from '../../components/board';

const D_TARGET = 0.8; // 单日线索目标＝月 24 ÷ 30（目标分解引擎 §6.7）

export default function RookiePage() {
  const { data, computed } = useApp();
  const [toast, setToast] = useState<string | null>(null);

  const screen = useMemo(() => {
    return data.people
      .filter((p) => p.hireDate && tenureDays(p.hireDate, computed.asOf) <= 15)
      .map((p) => {
        const t = tenureDays(p.hireDate!, computed.asOf);
        const oc = computed.owners[p.id];
        const cumRate = oc.convBase.leadNew / (D_TARGET * t);
        const grade = cumRate >= 1.2 ? { txt: '优秀', cls: 'bg-emerald-500/20 text-emerald-300' }
          : cumRate >= 0.8 ? { txt: '普通', cls: 'bg-white/10 text-slate-300' }
          : { txt: '预警', cls: 'bg-red-500/20 text-red-300' };
        const cost = Math.round(computed.folded.perOwnerLaborCost[p.id] ?? 0);
        return { p, t, oc, cumRate, grade, cost };
      })
      .sort((a, b) =>
        b.oc.convBase.leadNew - a.oc.convBase.leadNew ||
        b.oc.convBase.intentNew - a.oc.convBase.intentNew ||
        b.oc.convBase.sampleNew - a.oc.convBase.sampleNew);
  }, [data, computed]);

  const funnel = useMemo(() => {
    return ['liqiang', 'chenhao', 'hanxue']
      .map((id) => {
        const p = data.people.find((x) => x.id === id)!;
        const oc = computed.owners[id];
        const fo = computed.folded.perOwner[id];
        return {
          p, t: tenureDays(p.hireDate!, computed.asOf),
          oc, fo,
          cost: Math.round(computed.folded.perOwnerLaborCost[id] ?? 0),
          rank: computed.rankings.totalByOwner[id],
          roi: computed.folded.perOwnerRoi[id],
          orders: periodOrdersList(data, computed.asOf, new Set([id]), data.openDate).slice(0, 4),
        };
      })
      .sort((a, b) => (b.oc?.monthRevenue ?? 0) - (a.oc?.monthRevenue ?? 0)); // 流转倒序：回款在前
  }, [data, computed]);

  const deptName = (id: string | null) => data.departments.find((d) => d.id === id)?.name ?? '';

  return (
    <BoardShell
      title="新人筛选 · 详情页"
      subtitle={
        <>
          <span>{data.tenant.name}</span>
          <span>窗口 90 天 · 第 10 天即预警 · 逐日数据筛人</span>
          <span className="flex items-center gap-1"><i className="live-dot" />🤖 AI 日度滚动预警在线</span>
        </>
      }
      badges={<Link to="/boss" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/15">← 返回看板</Link>}
    >
      {/* 痛点定调（文案按老板拍板版） */}
      <div className="glass topline rounded-2xl p-4" style={{ ['--tl' as never]: TL.pink } as CSSProperties}>
        <p className="text-base font-extrabold leading-7 text-slate-100">
          想给高底薪招销冠，又怕混工资的——窗口几个月！逐日数据筛人：
          谁是销冠苗子、谁在混，几天就有数据依据，实战数据卡住庸才，1 年筛出 10 个人就省十几万。
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          招错一个人 ＝ 白扔几万块 ＋ 市场延误 ＋ 客户差评 ＋ 老员工心态被带崩——把省下的钱激励优秀，事半功倍。
        </p>
      </div>

      {/* 筛选组（≤15 天 · 新人标签）：3 人全量面板 */}
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="text-sm font-bold text-slate-200">筛选组（≤15 天 · 带「新人」标签）· 排名＝正向流转正序</h2>
        <span className="text-[10px] text-slate-500">单日线索目标 0.8（月 24 ÷ 30 · §6.7）</span>
      </div>
      <div className="space-y-3 lg:grid lg:grid-cols-3 lg:gap-3 lg:space-y-0">
        {screen.map((r, idx) => (
          <BCard
            key={r.p.id}
            tl={r.grade.txt === '优秀' ? TL.green : r.grade.txt === '预警' ? TL.red : TL.slate}
            title={
              <span className="flex items-center gap-1.5">
                <Medal n={idx + 1} />
                {r.p.name}（新人）
                <span className="text-[10px] font-normal text-slate-500">{deptName(r.p.deptId)}</span>
              </span>
            }
            right={<span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.grade.cls}`}>{r.grade.txt}</span>}
          >
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <span className="rounded bg-blue-500/20 px-1 text-blue-300">第 {r.t} 天 / 窗口 90 天</span>
              <span>剩 {90 - r.t} 天</span>
              <span>投入 {fmtYuan(r.cost)}</span>
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full" style={{ width: `${(r.t / 90) * 100}%`, background: TL.pink }} />
            </div>
            {r.grade.txt === '预警' && (
              <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-bold text-red-300">
                ⚠ 第 {r.t} 天预警：累计线索 {r.oc.convBase.leadNew}（应 ≥{Math.round(D_TARGET * r.t)}）· 近 3 日零动作
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {[
                { k: '今日线索', v: r.oc.dayProcess.lead, lv: sevenLevel(r.oc.dayProcess.lead / D_TARGET) },
                { k: '今日意向', v: r.oc.dayProcess.intent, lv: null },
                { k: '今日样品', v: r.oc.dayProcess.sample, lv: null },
                { k: '累计线索', v: r.oc.convBase.leadNew, lv: sevenLevel(r.cumRate) },
                { k: '累计意向', v: r.oc.convBase.intentNew, lv: null },
                { k: '累计样品', v: r.oc.convBase.sampleNew, lv: null },
              ].map((x) => (
                <div key={x.k} className="rounded-lg bg-white/[0.04] px-1 py-1.5">
                  <div className="text-sm font-extrabold tabular-nums text-slate-100">{x.v}</div>
                  <div className="text-[9px] leading-3 text-slate-500">{x.k}</div>
                  {x.lv && <div className="mt-0.5"><DarkLevelChip level={x.lv} /></div>}
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-1">
              <DrillRow l="日度滚动预警（只提示、不自动执行）"
                r={r.grade.txt === '预警' ? <span className="text-red-300">今日已预警</span> : <span className="text-emerald-300">今日无预警</span>} />
              <DrillRow l="筛选排名（正向流转正序）" r={`第 ${idx + 1} 名 / ${screen.length} 人`} />
            </div>
            <AiHint tone="block">
              {r.grade.txt === '优秀' && `第 ${r.t} 天日均 ${(r.oc.convBase.leadNew / r.t).toFixed(1)} 条线索——销冠苗子节奏，窗口过半建议预沟通转正。`}
              {r.grade.txt === '普通' && `达标线附近，本周盯日量——第 ${r.t + 7} 天再判一次。`}
              {r.grade.txt === '预警' && `数据落后且近 3 日零动作——今天约谈，问清楚是不会做还是不想做，止损要趁早。`}
            </AiHint>
          </BCard>
        ))}
      </div>

      {/* 筛人漏斗组（第 38/63/81 天）：转正窗口对比 · 全员排名口径 */}
      <div className="mb-1 mt-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-bold text-slate-200">筛人漏斗组（第 38 / 63 / 81 天）· 排名＝全员总排名（回款在前 · 与老员工同口径）</h2>
      </div>
      <div className="space-y-3 lg:grid lg:grid-cols-3 lg:gap-3 lg:space-y-0">
        {funnel.map((r) => (
          <BCard
            key={r.p.id}
            tl={TL.purple}
            title={
              <span className="flex items-center gap-1.5">
                {r.p.name}
                <span className="text-[10px] font-normal text-slate-500">{deptName(r.p.deptId)}</span>
              </span>
            }
            right={<span className="flex items-center gap-1 text-[10px] text-slate-400">全员第 <Medal n={r.rank} /> 名</span>}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="rounded bg-blue-500/20 px-1 text-blue-300">第 {r.t} 天 / 窗口 90 天</span>
              <span>labor_roi {fmtRoi2(r.roi)}</span>
              <span>投入 {fmtYuan(r.cost)}</span>
            </div>
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full" style={{ width: `${(r.t / 90) * 100}%`, background: TL.purple }} />
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {[
                { k: '本月回款', v: fmtWan(r.oc?.monthRevenue ?? 0) },
                { k: '累计回款', v: fmtWan(r.fo?.revenue ?? 0) },
                { k: '首购单', v: r.oc?.convBase.toDeal ?? 0 },
                { k: '样品', v: r.oc?.convBase.sampleNew ?? 0 },
                { k: '意向', v: r.oc?.convBase.intentNew ?? 0 },
                { k: '线索', v: r.oc?.convBase.leadNew ?? 0 },
              ].map((x) => (
                <div key={x.k} className="rounded-lg bg-white/[0.04] px-1 py-1.5">
                  <div className="text-sm font-extrabold tabular-nums text-slate-100">{x.v}</div>
                  <div className="text-[9px] leading-3 text-slate-500">{x.k}</div>
                </div>
              ))}
            </div>
            <div className="mb-1 mt-2 grid grid-cols-6 gap-1 text-center text-[10px]">
              {FUNNEL_STAGES.map((st) => (
                <div key={st} className="rounded-lg bg-white/5 py-1">
                  <div className="text-xs font-bold tabular-nums text-slate-200">{r.fo?.stocks[st] ?? 0}</div>
                  <div className="text-slate-500">{STAGE_LABEL[st].slice(0, 2)}</div>
                </div>
              ))}
            </div>
            {r.orders.length > 0 && (
              <div className="space-y-1">
                {r.orders.slice(0, 2).map((o, i) => (
                  <DrillRow key={i} l={o.customer} sub={o.date} r={fmtYuan(o.amount)} />
                ))}
              </div>
            )}
          </BCard>
        ))}
      </div>

      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        {/* 筛人漏斗分层 */}
        <BCard title="筛人漏斗（分层）" icon="🔻" tl={TL.pink} className="lg:col-span-7">
          <div className="space-y-1.5">
            {[
              { label: '① 筛选进入（≤15 天新人）', v: `${screen.length} 人：${screen.map((x) => x.p.name).join('、')}`, pct: 1, grad: 'linear-gradient(90deg,#ec4899,#f472b6)' },
              { label: '② 转正窗口观察（16–90 天）', v: `3 人：李强 38 天、陈昊 63 天、韩雪 81 天`, pct: 0.75, grad: 'linear-gradient(90deg,#8b5cf6,#a78bfa)' },
              { label: '③ 窗口满 · 老板拍板', v: '韩雪还剩 9 天到窗', pct: 0.4, grad: 'linear-gradient(90deg,#10b981,#34d399)' },
            ].map((x) => (
              <div key={x.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-40 shrink-0 text-slate-400">{x.label}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-lg bg-white/5">
                  <div className="bar-anim flex h-full items-center rounded-lg px-2 text-[10px] font-bold text-white" style={{ width: `${x.pct * 100}%`, background: x.grad }}>
                    {x.v}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">
            淘汰的止损在窗口内、不再养到年底；留下的每一个，都有 90 天逐日数据背书。
          </p>
          <AiHint tone="block">
            窗口满自动汇总单量/节奏/投入产出，留还是汰你一键拍板（默认留人）；「第几天回本、该给多少底薪」的深度账随
            人效包与经营智库开通。
          </AiHint>
        </BCard>

        {/* 决策位 */}
        <BCard title="窗口满 · 老板一键拍板" icon="⚖️" tl={TL.amber} className="lg:col-span-5">
          <div className="grid grid-cols-3 gap-2">
            {['留用（转正）', '汰（释放席位）', '延长观察'].map((x) => (
              <button
                key={x}
                onClick={() => setToast('演示位：正式版此处走「窗口满综合判定＋留痕」（老板一键，默认留人）')}
                className="rounded-xl bg-white/8 py-2.5 text-xs font-bold text-slate-100 ring-1 ring-white/15 hover:bg-white/15"
              >
                {x}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">
            🔒 深度账目 → <Link to="/sample/pack1" className="text-indigo-300 hover:underline">人效操盘包</Link>；
            「底薪该给多少」 → <Link to="/sample/library" className="text-indigo-300 hover:underline">经营智库定薪建议</Link>。
          </p>
          <div className="mt-2 space-y-1">
            <DrillRow l="孙悦 · 第 10 天预警" sub="累计线索 3 · 近 3 日零动作" r={<span className="text-red-300">建议今日约谈</span>} />
            <DrillRow l="李曼 · 第 7 天优秀" sub={`累计线索 ${screen.find((x) => x.p.id === 'liman')?.oc.convBase.leadNew ?? '—'} · 日均超标`} r={<span className="text-emerald-300">销冠苗子</span>} />
            <DrillRow l="韩雪 · 第 81 天" sub="窗口将满" r={<span className="text-amber-300">准备转正裁定</span>} />
          </div>
        </BCard>
      </div>

      {toast && (
        <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-fit cursor-pointer rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 shadow-xl" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </BoardShell>
  );
}
