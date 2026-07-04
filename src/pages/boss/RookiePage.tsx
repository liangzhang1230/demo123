/**
 * /rookie · 新人筛选详情页（P11）：系统内置新人筛选全套功能的看板上架位。
 * 全部人员数据由事件流实时折算；筛人漏斗历史段为示例数据（角标标注）；
 * 决策按钮为演示位（正式版走「窗口满综合判定＋留痕，老板一键、默认留人」）。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { periodOrdersList } from '../../domain/compute';
import { fmtPct1, fmtRoi2, fmtYuan, tenureDays } from '../../domain/engine';
import { FUNNEL_STAGES, STAGE_LABEL } from '../../domain/types';
import { ExampleBadge } from '../../components/ui';
import { AiHint, BCard, BoardShell, DrillRow, TL } from '../../components/board';

const ROOKIE = 'liqiang';

export default function RookiePage() {
  const { data, computed } = useApp();
  const [toast, setToast] = useState<string | null>(null);
  const p = data.people.find((x) => x.id === ROOKIE)!;
  const t = tenureDays(p.hireDate!, computed.asOf);
  const oc = computed.owners[ROOKIE];
  const fo = computed.folded.perOwner[ROOKIE];
  const cost = Math.round(computed.folded.perOwnerLaborCost[ROOKIE] ?? 0);
  const rev = fo?.revenue ?? 0;
  const roi = computed.folded.perOwnerRoi[ROOKIE];
  const orders = useMemo(() => periodOrdersList(data, computed.asOf, new Set([ROOKIE]), data.openDate), [data, computed.asOf]);

  const tiles = [
    { k: '在司天数（R2-01）', v: `第 ${t} 天` },
    { k: '窗口剩余', v: `${90 - t} 天` },
    { k: '累计建档', v: `${oc?.convBase.leadNew ?? 0} 家` },
    { k: '转意向', v: `${oc?.convBase.intentNew ?? 0} 家` },
    { k: '首购成交', v: `${oc?.convBase.toDeal ?? 0} 单` },
    { k: '累计回款', v: fmtYuan(rev) },
    { k: '累计投入（工资＋招培）', v: fmtYuan(cost) },
    { k: 'labor_roi（累计）', v: fmtRoi2(roi) },
  ];

  return (
    <BoardShell
      title="新人筛选 · 详情页"
      subtitle={
        <>
          <span>{data.tenant.name}</span>
          <span>窗口 90 天 · 逐日数据筛人</span>
          <span className="flex items-center gap-1"><i className="live-dot" />🤖 AI 日度滚动预警在线</span>
        </>
      }
      badges={<Link to="/boss" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/15">← 返回看板</Link>}
    >
      {/* 痛点定调 */}
      <div className="glass topline rounded-2xl p-4" style={{ ['--tl' as never]: TL.pink } as CSSProperties}>
        <p className="text-base font-extrabold leading-7 text-slate-100">
          招错一个人 ＝ 白扔几万块 ＋ 市场延误 ＋ 客户差评 ＋ 老员工心态被带崩。
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          高底薪招得到人、但怕养错人；低底薪招不到人。这套筛选窗口的用法：放心给高底薪，
          90 天内用逐日数据把销冠苗子和混工资的分开——省下的钱，激励留下的人。
        </p>
      </div>

      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-3 lg:space-y-0">
        {/* 李强 · 筛选面板（全实算） */}
        <BCard title={`李强 · 筛选中 第 ${t} 天 / 窗口 90 天`} icon="🧪" tl={TL.pink} className="lg:col-span-7"
          right={<span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">单量达标 · 继续观察</span>}
        >
          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-white/8">
            <div className="bar-anim h-full rounded-full" style={{ width: `${(t / 90) * 100}%`, background: TL.pink }} />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4">
            {tiles.map((x) => (
              <div key={x.k} className="rounded-xl bg-white/[0.04] px-1 py-2.5">
                <div className="text-sm font-extrabold tabular-nums text-slate-100">{x.v}</div>
                <div className="text-[9px] leading-3 text-slate-500">{x.k}</div>
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
          <div className="space-y-1">
            <DrillRow l="线索转化率（累计制 §6.3）" r={fmtPct1(oc?.conv.lead)} />
            <DrillRow l="日度滚动预警（只提示、不自动执行）" r={<span className="text-emerald-300">今日无预警</span>} />
            <DrillRow l="评级 · 单量" r={<span className="text-emerald-300">达标（本月新客 {oc?.monthFirstDeals ?? 0} 单）</span>} />
            <DrillRow l="评级 · 爬坡" r={<span className="text-yellow-300">亏损爬坡中（对照历史新人节奏 · 示例）</span>} />
          </div>
          <AiHint tone="block">
            第 {t} 天判断依据已足：单量达标、节奏正常——不是招错了，是还在爬坡。窗口满我给你汇总，留还是汰你一键拍板。
          </AiHint>
        </BCard>

        {/* 筛人漏斗分层 ＋ 决策位 */}
        <div className="space-y-3 lg:col-span-5">
          <BCard title="筛人漏斗（分层）" icon="🔻" tl={TL.purple} right={<ExampleBadge inline />}>
            <div className="space-y-1.5">
              {[
                { label: '① 本季筛选进入', v: '2 人', pct: 1, tag: '示例', grad: 'linear-gradient(90deg,#8b5cf6,#a78bfa)' },
                { label: '② 窗口内淘汰', v: '1 人', pct: 0.5, tag: '示例', grad: 'linear-gradient(90deg,#64748b,#94a3b8)' },
                { label: '③ 转正窗口观察中', v: '李强 · 第 ' + t + ' 天', pct: 0.5, tag: '实时', grad: 'linear-gradient(90deg,#ec4899,#f472b6)' },
              ].map((x) => (
                <div key={x.label} className="flex items-center gap-2 text-[11px]">
                  <span className="w-28 shrink-0 text-slate-400">{x.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-white/5">
                    <div className="bar-anim flex h-full items-center rounded-lg px-2 text-[10px] font-bold text-white" style={{ width: `${x.pct * 100}%`, background: x.grad }}>
                      {x.v}
                    </div>
                  </div>
                  <span className={`w-8 shrink-0 text-right text-[9px] ${x.tag === '实时' ? 'text-emerald-400' : 'text-slate-500'}`}>{x.tag}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">
              留下的每一个人都有 90 天数据背书；淘汰的止损在窗口内，不再养到年底。
            </p>
          </BCard>

          <BCard title="窗口满 · 老板一键拍板" icon="⚖️" tl={TL.amber}>
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
            <p className="mt-2 text-[10px] text-slate-500">
              🔒 「第几天回本、值不值得续用」的深度账 → <Link to="/sample/pack1" className="text-indigo-300 hover:underline">人效操盘包</Link>；
              「底薪该给多少」 → <Link to="/sample/library" className="text-indigo-300 hover:underline">经营智库定薪建议</Link>。
            </p>
          </BCard>

          <BCard title="李强 · 成交流水（实时）" icon="🧾" tl={TL.green}>
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {orders.length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-500">暂无成交</p>
              ) : (
                orders.map((o, i) => (
                  <DrillRow key={i} l={o.customer} sub={o.date} r={fmtYuan(o.amount)} />
                ))
              )}
            </div>
          </BCard>
        </div>
      </div>

      {toast && (
        <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-fit cursor-pointer rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-900 shadow-xl" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </BoardShell>
  );
}
