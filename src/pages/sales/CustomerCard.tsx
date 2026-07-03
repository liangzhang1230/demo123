/**
 * /sales/customer/:id · 客户卡（§4.3 六态流转）：
 * 普通推进免确认；仅「转成交（回款必填 R1-05）」与「转流失（原因必选 R1-07）」二次确认弹层。
 * 已成交客户可新增复购单（R1-19，不产状态事件）。事件时间线直读事件流。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { ALLOWED_TRANSITIONS, LOSS_REASONS, STAGE_LABEL, type LossReason, type Stage } from '../../domain/types';
import { fmtYuan, stallLevel, stayDays, type MonitoredStage } from '../../domain/engine';
import { STALL_LEVEL_LABEL } from '../../domain/engine';
import { Card, CardTitle, GrayNote, Shell } from '../../components/ui';

const STAGE_BTN: Partial<Record<Stage, string>> = {
  intent: 'bg-sky-600',
  sample: 'bg-indigo-600',
  signed: 'bg-violet-600',
  deal: 'bg-emerald-600',
  lost: 'bg-gray-400',
};

export default function CustomerCardPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, computed, actions } = useApp();
  const live = id ? computed.customers.get(id) : undefined;
  const [modal, setModal] = useState<'deal' | 'lost' | 'repeat' | null>(null);
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState(data.categories[0]?.code ?? 'A');
  const [reason, setReason] = useState<LossReason | ''>('');
  const [err, setErr] = useState<string | null>(null);

  const timeline = useMemo(
    () => (id ? data.events.filter((e) => e.customerId === id).slice().reverse() : []),
    [data.events, id],
  );

  if (!live) {
    return (
      <Shell title="客户不存在">
        <Card><Link to="/sales/customers" className="text-sm text-blue-600">← 返回客户列表</Link></Card>
      </Shell>
    );
  }

  const c = live.customer;
  const monitored = (['lead', 'intent', 'sample', 'signed'] as Stage[]).includes(live.stage);
  const days = monitored ? stayDays(live.stageEntryDate, computed.asOf) : null;
  const lv = monitored && days != null ? stallLevel(live.stage as MonitoredStage, days) : null;
  const targets = ALLOWED_TRANSITIONS[live.stage];

  const doTransition = (to: Stage) => {
    setErr(null);
    try {
      if (to === 'deal') { setModal('deal'); return; }
      if (to === 'lost') { setModal('lost'); return; }
      actions.transition(c.id, { to }); // 普通推进免确认（§4.3 二次确认仅两处）
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const submitDeal = () => {
    setErr(null);
    try {
      actions.transition(c.id, { to: 'deal', amount: Number(amount), categoryCode: cat });
      setModal(null);
      setAmount('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const submitLost = () => {
    setErr(null);
    try {
      actions.transition(c.id, { to: 'lost', lossReason: (reason || undefined) as LossReason });
      setModal(null);
      nav('/sales/customers');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const submitRepeat = () => {
    setErr(null);
    try {
      actions.addRepeatOrder(c.id, Number(amount), cat);
      setModal(null);
      setAmount('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Shell title={c.name} subtitle={<Link to="/sales/customers" className="underline-offset-2 hover:underline">← 返回客户列表</Link>}>
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span data-testid="cust-stage" className="rounded-lg bg-gray-900 px-2 py-1 text-xs font-bold text-white">
                {STAGE_LABEL[live.stage]}
              </span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{c.level} 级</span>
              {lv && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
                  {STALL_LEVEL_LABEL[lv].name} · 停留 {days} 天
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              联系人 {c.contact} ｜ {c.phone}
            </div>
            <div className="text-xs text-gray-400">建档 {live.createdDate} ｜ 归属 王丽</div>
          </div>
          {live.revenue > 0 && (
            <div className="text-right">
              <div className="text-[10px] text-gray-400">累计回款</div>
              <div className="text-base font-bold tabular-nums">{fmtYuan(live.revenue)}</div>
            </div>
          )}
        </div>
      </Card>

      {(targets.length > 0 || live.stage === 'deal') && (
        <Card>
          <CardTitle>推进（状态操作即生效，实时计数入当日账）</CardTitle>
          <div className="grid grid-cols-2 gap-2">
            {targets.map((t) => (
              <button
                key={t}
                data-testid={`to-${t}`}
                onClick={() => doTransition(t)}
                className={`rounded-xl py-2.5 text-sm font-semibold text-white active:opacity-80 ${STAGE_BTN[t]}`}
              >
                {t === 'lost' ? '标记流失' : t === 'deal' ? '转成交（录回款）' : `→ ${STAGE_LABEL[t]}`}
              </button>
            ))}
            {live.stage === 'deal' && (
              <button
                data-testid="add-repeat"
                onClick={() => { setModal('repeat'); }}
                className="rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white active:opacity-80"
              >
                ＋ 新增复购单
              </button>
            )}
          </div>
          {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
          <div className="mt-2"><GrayNote>普通推进免确认；回退每客户终生 1 次（正式版此处走审批留痕）。</GrayNote></div>
        </Card>
      )}

      <Card>
        <CardTitle>事件时间线（直读事件流）</CardTitle>
        <ul className="space-y-1.5 text-xs">
          {timeline.map((e) => (
            <li key={e.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-2.5 py-1.5">
              <span className="text-gray-700">
                {e.type === 'customer_created' && '建档（线索新增）'}
                {e.type === 'stage_changed' && `${STAGE_LABEL[e.from!]} → ${STAGE_LABEL[e.to!]}${e.lossReason ? `（${e.lossReason}）` : ''}`}
                {e.type === 'order_created' && `${e.isRepeat ? '复购单' : '首购成交单'} ${fmtYuan(e.amount ?? 0)} · ${data.categories.find((x) => x.code === e.categoryCode)?.name ?? ''}`}
              </span>
              <span className="shrink-0 tabular-nums text-gray-400">{e.date} {e.time}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 二次确认弹层（仅转成交/转流失两处，防误触不伤人效） */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            {modal === 'deal' && (
              <>
                <h3 className="text-sm font-bold">转成交 · 回款必填（R1-05）</h3>
                <p className="mt-1 text-xs text-gray-500">不录回款不允许完成转化；金额当日日界前可改，定版后修改走审批（正式版留痕）。</p>
                <input data-testid="deal-amount" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="回款金额（¥）" inputMode="numeric" className="input mt-3" />
                <CategoryPicker cat={cat} setCat={setCat} categories={data.categories} />
                {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="rounded-xl bg-gray-100 py-2.5 text-sm" onClick={() => setModal(null)}>取消</button>
                  <button data-testid="deal-confirm" className="rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white" onClick={submitDeal}>确认成交</button>
                </div>
              </>
            )}
            {modal === 'lost' && (
              <>
                <h3 className="text-sm font-bold">标记流失 · 原因必选（R1-07）</h3>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {LOSS_REASONS.map((r) => (
                    <button
                      key={r}
                      data-testid={`loss-${r}`}
                      onClick={() => setReason(r)}
                      className={`rounded-lg px-2 py-2 text-xs ${reason === r ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="rounded-xl bg-gray-100 py-2.5 text-sm" onClick={() => setModal(null)}>取消</button>
                  <button data-testid="lost-confirm" className="rounded-xl bg-gray-700 py-2.5 text-sm font-semibold text-white" onClick={submitLost}>确认流失</button>
                </div>
              </>
            )}
            {modal === 'repeat' && (
              <>
                <h3 className="text-sm font-bold">新增复购单（不产状态事件）</h3>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="回款金额（¥）" inputMode="numeric" className="input mt-3" />
                <CategoryPicker cat={cat} setCat={setCat} categories={data.categories} />
                {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="rounded-xl bg-gray-100 py-2.5 text-sm" onClick={() => setModal(null)}>取消</button>
                  <button className="rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white" onClick={submitRepeat}>确认复购</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function CategoryPicker({ cat, setCat, categories }: {
  cat: string;
  setCat: (c: string) => void;
  categories: { code: string; name: string }[];
}) {
  return (
    <div className="mt-2 flex gap-1.5">
      {categories.map((x) => (
        <button
          key={x.code}
          onClick={() => setCat(x.code)}
          className={`rounded-lg px-2.5 py-1.5 text-xs ${cat === x.code ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          {x.name}
        </button>
      ))}
    </div>
  );
}
