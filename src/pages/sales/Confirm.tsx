/**
 * /sales/confirm · 每日确认页（§4.7【定稿】：无手工填数，全部只读事件汇总；
 * 当日日界前可重复确认）＋ 演示专属「模拟过一天」按钮（R1-17 定版机制：
 * 自动定版快照→昨日快照归档→停滞天数+1→早报样卡/环比随新锚点重算）。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { computeAll } from '../../domain/compute';
import { addDays, fmtYuan } from '../../domain/engine';
import { STAGE_LABEL, type Stage } from '../../domain/types';
import { Card, CardTitle, GrayNote, Shell } from '../../components/ui';

const ME = 'wangli';
const POOLS: Stage[] = ['lead', 'intent', 'sample', 'signed'];

export default function ConfirmPage() {
  const { data, computed, actions } = useApp();
  const [note, setNote] = useState('');

  const confirmed = (data.confirmations?.[computed.asOf] ?? []).includes(ME);

  // 上期存量＝昨日折算（定版快照口径）；期末存量＝当前实时
  const yesterday = useMemo(() => computeAll(data, addDays(computed.asOf, -1)), [data, computed.asOf]);
  const prevStocks = yesterday.folded.perOwner[ME]?.stocks;
  const nowStocks = computed.folded.perOwner[ME]?.stocks;

  // 当日事件汇总（只读，直读事件流）
  const today = useMemo(() => {
    const evs = data.events.filter((e) => e.ownerId === ME && e.date === computed.asOf);
    const trans: Record<string, number> = {};
    let newLeads = 0, firstDeals = 0, repeatOrders = 0, revenue = 0;
    const dealList: { name: string; amount: number; isRepeat: boolean }[] = [];
    for (const e of evs) {
      if (e.type === 'customer_created') newLeads++;
      if (e.type === 'stage_changed') trans[`${e.from}>${e.to}`] = (trans[`${e.from}>${e.to}`] ?? 0) + 1;
      if (e.type === 'order_created') {
        revenue += e.amount ?? 0;
        if (e.isRepeat) repeatOrders++;
        else firstDeals++;
        dealList.push({
          name: data.customers.find((c) => c.id === e.customerId)?.name ?? e.customerId,
          amount: e.amount ?? 0,
          isRepeat: !!e.isRepeat,
        });
      }
    }
    return { trans, newLeads, firstDeals, repeatOrders, revenue, dealList, count: evs.length };
  }, [data, computed.asOf]);

  const t = (from: Stage, to: Stage) => today.trans[`${from}>${to}`] ?? 0;

  return (
    <Shell title="每日确认页" subtitle={<Link to="/sales" className="underline-offset-2 hover:underline">← 返回我的看板 ｜ {computed.asOf}</Link>}>
      <Card>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-4 text-gray-500">
          <b className="text-gray-600">有效客户标准（v3 · 陈总 2026-06-01 修订）：</b>
          月进货 ≥ ¥2,000 的商超/便利店/批发部；找对采购决策人再建档。（纯提示文本，不参与统计）
        </div>
      </Card>

      {POOLS.map((pool) => (
        <Card key={pool}>
          <CardTitle>{STAGE_LABEL[pool]}区（只读 · 事件自动汇总）</CardTitle>
          <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
            <Cell k="上期存量" v={prevStocks?.[pool] ?? 0} />
            {pool === 'lead' && <Cell k="今日新增" v={today.newLeads} hot />}
            {pool === 'lead' && <Cell k="转意向" v={t('lead', 'intent')} />}
            {pool !== 'lead' && pool !== 'intent' && null}
            {pool === 'intent' && <Cell k="转样品" v={t('intent', 'sample')} />}
            {pool === 'lead' && <Cell k="转样品" v={t('lead', 'sample')} />}
            {pool === 'intent' && <Cell k="转签约" v={t('intent', 'signed')} />}
            {pool === 'sample' && <Cell k="转签约" v={t('sample', 'signed')} />}
            {pool === 'lead' && <Cell k="转签约" v={t('lead', 'signed')} />}
            {pool === 'intent' && <Cell k="转成交" v={t('intent', 'deal')} />}
            {pool === 'sample' && <Cell k="转成交" v={t('sample', 'deal')} />}
            {pool === 'signed' && <Cell k="转成交" v={t('signed', 'deal')} />}
            {pool === 'lead' && <Cell k="转成交" v={t('lead', 'deal')} />}
            <Cell k="流失" v={t(pool, 'lost')} />
            <Cell k="期末存量" v={nowStocks?.[pool] ?? 0} hot />
          </div>
        </Card>
      ))}

      <Card>
        <CardTitle>成交区</CardTitle>
        <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
          <Cell k="首购客户数" v={today.firstDeals} hot />
          <Cell k="复购单数" v={today.repeatOrders} />
          <Cell k="当日总回款" v={fmtYuan(today.revenue)} hot />
        </div>
        {today.dealList.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {today.dealList.map((d, i) => (
              <li key={i} className="flex justify-between rounded-lg bg-gray-50 px-2.5 py-1.5">
                <span>{d.name} <span className="text-gray-400">{d.isRepeat ? '复购' : '首购'}</span></span>
                <span className="font-medium tabular-nums">{fmtYuan(d.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <GrayNote>回款当日日界前可编辑（跳成交客户改，留痕）；定版后修改一律走审批（正式版留痕）。</GrayNote>
      </Card>

      <Card>
        <CardTitle>当日备注（可编辑 · 留痕）</CardTitle>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="今天的补充说明…" className="input" />
        <button
          data-testid="confirm-submit"
          disabled={confirmed}
          onClick={() => actions.confirmToday(ME)}
          className={`mt-3 w-full rounded-xl py-3 text-sm font-semibold ${confirmed ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-900 text-white active:bg-gray-700'}`}
        >
          {confirmed ? '✓ 已确认（当日日界前可重复确认）' : '提交确认'}
        </button>
      </Card>

      <Card className="border-dashed !border-indigo-300 bg-indigo-50/50">
        <CardTitle right={<span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">演示专属</span>}>
          模拟过一天
        </CardTitle>
        <p className="text-xs leading-5 text-gray-600">
          触发日终定版（R1-17）：当日快照自动归档为「昨日快照」→ 模拟时钟 +1 天 → 停滞天数 +1、
          排名升降箭头、早报样卡、环比全部随新锚点实时重算。
        </p>
        <button
          data-testid="simulate-day"
          onClick={() => actions.simulateDayPass()}
          className="mt-3 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white active:bg-indigo-500"
        >
          🌙 模拟过一天（{computed.asOf} → {addDays(computed.asOf, 1)}）
        </button>
      </Card>
    </Shell>
  );
}

function Cell({ k, v, hot }: { k: string; v: number | string; hot?: boolean }) {
  return (
    <div className={`rounded-lg py-2 ${hot ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-800'}`}>
      <div className={`text-[10px] ${hot ? 'text-gray-300' : 'text-gray-400'}`}>{k}</div>
      <div className="text-base font-bold tabular-nums">{v}</div>
    </div>
  );
}
