/**
 * 客户卡（P5）· 六态流转按钮 ＋ 事件史
 *  - 流转矩阵照抄 §4.3：允许跳级前进（线索直达成交＝直成交），禁止一切后退；成交/流失为终态
 *  - 二次确认仅两处：转成交（回款必填 R1-05 ＋ 品类必选 R1-18）、转流失（原因必选 R1-07）；普通推进免确认
 *  - 成交类型系统自动判定（首购/复购，is_repeat 不可手选）；成交态客户可录复购单（状态不变）
 *  - 操作即生效、实时计数入当日账——看板全部数字随之联动（铁律 2）
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ALLOWED_TRANSITIONS, LOSS_REASONS, STAGE_LABEL, type LossReason, type Stage } from '../../domain/types';
import { customerStateOf, hasDeal } from '../../domain/ops';
import { stallLevelOf, STALL_LEVEL_LABEL, STALL_THRESHOLDS_GENERAL, type StallPool } from '../../domain/stallSales';
import { dayDiff } from '../../domain/calendar';
import { useDemo } from '../../state';

const yuan = (v: number) => `¥${v.toLocaleString('zh-CN')}`;

type Dialog = { kind: 'deal' } | { kind: 'lost' } | { kind: 'repeat' } | null;

export default function CustomerCardPage() {
  const { id } = useParams();
  const { data, actions } = useDemo();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);

  const customer = data.customers.find((c) => c.id === id);
  const anchor = data.anchorDate;

  const view = useMemo(() => {
    if (!customer) return null;
    const st = customerStateOf(data.events, customer.id, anchor);
    const stage = st?.stage ?? 'lead';
    const stayDays = st ? dayDiff(anchor, st.enteredDate) : 0;
    const pool = stage as StallPool;
    const stall = pool in STALL_THRESHOLDS_GENERAL ? stallLevelOf(stayDays, STALL_THRESHOLDS_GENERAL[pool]) : null;
    const history = data.events
      .filter((e) => e.customerId === customer.id && e.date <= anchor)
      .sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1));
    const orders = history.filter((e) => e.type === 'order_created');
    return { stage: stage as Stage, enteredDate: st?.enteredDate ?? '', stayDays, stall, history, orders };
  }, [customer, data, anchor]);

  if (!customer || !view) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <p className="text-sm text-gray-500">客户不存在。<Link className="text-blue-600" to="/sales/customers">返回列表</Link></p>
      </div>
    );
  }

  const targets = ALLOWED_TRANSITIONS[view.stage];
  const plainTargets = targets.filter((t) => t !== 'deal' && t !== 'lost');

  const doPlainMove = (to: Stage) => {
    const r = actions.advanceStage(customer.id, to);
    setToast(r.ok ? `已推进：${STAGE_LABEL[view.stage]} → ${STAGE_LABEL[to]}（免确认，实时入当日账）` : r.error);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-5 sm:max-w-2xl">
      <header className="mb-3">
        <Link to="/sales/customers" className="text-xs text-gray-400">← 我的客户</Link>
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold">{customer.name}</h1>
          <span className="text-xs text-gray-400">{customer.level} 级 · 归属 王丽</span>
        </div>
        <p className="text-xs text-gray-400">{customer.contact} · {customer.phone}</p>
      </header>

      {/* 当前状态 */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">当前状态</p>
            <p className="text-xl font-bold">{STAGE_LABEL[view.stage]}</p>
          </div>
          {view.stage !== 'deal' && view.stage !== 'lost' && (
            <div className="text-right">
              <p className="text-xs text-gray-500">进入本状态 {view.enteredDate}</p>
              <p className={`text-sm font-semibold ${view.stall === 'red' ? 'text-red-600' : view.stall === 'orange' ? 'text-orange-500' : view.stall === 'yellow' ? 'text-yellow-600' : 'text-gray-600'}`}>
                停留 {view.stayDays} 天{view.stall ? ` · ${STALL_LEVEL_LABEL[view.stall]}` : ''}
              </p>
            </div>
          )}
        </div>

        {/* 流转按钮（§4.3 矩阵） */}
        {targets.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {plainTargets.map((t) => (
              <button
                key={t}
                onClick={() => doPlainMove(t)}
                className="rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 active:bg-gray-50"
              >
                转{STAGE_LABEL[t]}
              </button>
            ))}
            {targets.includes('deal') && (
              <button
                onClick={() => setDialog({ kind: 'deal' })}
                className="rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white active:bg-green-700"
              >
                转成交（录回款）
              </button>
            )}
            {targets.includes('lost') && (
              <button
                onClick={() => setDialog({ kind: 'lost' })}
                className="rounded-lg border border-red-300 py-2.5 text-sm font-semibold text-red-600 active:bg-red-50"
              >
                标记流失
              </button>
            )}
          </div>
        ) : view.stage === 'deal' ? (
          <div className="mt-3">
            <button
              onClick={() => setDialog({ kind: 'repeat' })}
              className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white active:bg-green-700"
            >
              录复购单（复购走成交单，状态不变）
            </button>
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">
            流失为终态；复活仅原归属账号可发起（正式版走复活机制留痕，演示版未开放）
          </p>
        )}
        {view.stage === 'lead' && targets.includes('deal') && (
          <p className="mt-2 text-xs text-gray-400">线索直接转成交＝「直成交」单列，中间阶段不补计（R1-04）</p>
        )}
        <p className="mt-2 text-xs text-gray-300">（正式版误操作走回退：每客户终生 1 次、留痕）</p>
      </section>

      {/* 成交单 */}
      {view.orders.length > 0 && (
        <section className="mb-3 rounded-xl border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">成交单（{view.orders.length} 笔）</h2>
          <ul className="divide-y divide-gray-100">
            {view.orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-gray-500">
                  {o.date} <span className={`ml-1 rounded px-1 py-0.5 text-xs ${o.isRepeat ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-700'}`}>{o.isRepeat ? '复购' : '首购'}</span>
                </span>
                <span className="font-semibold tabular-nums">{yuan(o.amount ?? 0)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 事件史 */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">事件史（归属日期永久封存 R1-10）</h2>
        <ul className="space-y-1.5">
          {view.history.map((e) => (
            <li key={e.id} className="flex gap-2 text-xs">
              <span className="w-24 shrink-0 tabular-nums text-gray-400">{e.date} {e.time}</span>
              <span className="text-gray-700">
                {e.type === 'customer_created' && '建档（线索新增）'}
                {e.type === 'stage_changed' &&
                  `${STAGE_LABEL[e.from as Stage]} → ${STAGE_LABEL[e.to as Stage]}${e.lossReason ? `（原因：${e.lossReason}）` : ''}`}
                {e.type === 'order_created' && `成交单 ${yuan(e.amount ?? 0)}（${e.isRepeat ? '复购' : '首购'}）`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {dialog?.kind === 'deal' && (
        <DealDialog
          title={`转成交 · ${customer.name}`}
          isRepeat={hasDeal(data.events, customer.id, anchor)}
          onCancel={() => setDialog(null)}
          onConfirm={(amount, categoryCode) => {
            const r = actions.advanceStage(customer.id, 'deal', { amount, categoryCode });
            setDialog(null);
            setToast(r.ok ? `已成交并录回款 ${yuan(amount)}——个人/部门/公司汇总已实时联动` : r.error);
          }}
        />
      )}
      {dialog?.kind === 'repeat' && (
        <DealDialog
          title={`录复购单 · ${customer.name}`}
          isRepeat
          onCancel={() => setDialog(null)}
          onConfirm={(amount, categoryCode) => {
            const r = actions.recordRepeatOrder(customer.id, amount, categoryCode);
            setDialog(null);
            setToast(r.ok ? `复购单已入账 ${yuan(amount)}（不计首购/转化，回款照常入经营盘）` : r.error);
          }}
        />
      )}
      {dialog?.kind === 'lost' && (
        <LostDialog
          name={customer.name}
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => {
            const r = actions.advanceStage(customer.id, 'lost', { lossReason: reason });
            setDialog(null);
            setToast(r.ok ? `已标记流失（原因：${reason}）——手机号硬钥匙已释放` : r.error);
          }}
        />
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-4 mx-auto max-w-md px-4" onClick={() => setToast(null)}>
          <p className="rounded-xl bg-gray-900/90 px-4 py-3 text-center text-xs text-white shadow-lg">{toast}（点按关闭）</p>
        </div>
      )}
    </div>
  );
}

/** 转成交/复购弹窗（二次确认：回款必填 R1-05、品类必选 R1-18、类型自动判定不可手选） */
function DealDialog({
  title, isRepeat, onCancel, onConfirm,
}: {
  title: string;
  isRepeat: boolean;
  onCancel: () => void;
  onConfirm: (amount: number, categoryCode: string) => void;
}) {
  const { data } = useDemo();
  const [amount, setAmount] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const amt = Number(amount);

  return (
    <Modal onCancel={onCancel}>
      <h3 className="text-base font-bold">{title}</h3>
      <p className="mt-0.5 text-xs text-gray-400">
        成交类型（系统自动判定，不可手选）：
        <b className={isRepeat ? 'text-blue-600' : 'text-green-700'}>{isRepeat ? '复购单' : '首购单'}</b>
      </p>
      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-gray-500">回款金额（必填，R1-05）*</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          placeholder="¥"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm tabular-nums"
        />
      </label>
      <label className="mt-2 block">
        <span className="mb-1 block text-xs font-medium text-gray-500">产品/品类（必选，录入即定、随单冻结 R1-18）*</span>
        <select
          value={categoryCode}
          onChange={(e) => setCategoryCode(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
        >
          <option value="">请选择品类</option>
          {data.categories.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </label>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm text-gray-600">取消</button>
        <button
          onClick={() => {
            if (!amt || amt <= 0) return setErr('转成交回款必填（R1-05），金额须 ＞ 0');
            if (!categoryCode) return setErr('成交单品类必选（R1-18）');
            onConfirm(amt, categoryCode);
          }}
          className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white"
        >
          确认成交入账
        </button>
      </div>
    </Modal>
  );
}

/** 转流失弹窗（二次确认：原因必选枚举 R1-07） */
function LostDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: (r: LossReason) => void }) {
  const [reason, setReason] = useState<LossReason | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal onCancel={onCancel}>
      <h3 className="text-base font-bold">标记流失 · {name}</h3>
      <p className="mt-0.5 text-xs text-gray-400">流失原因必选（R1-07）；流失后手机号硬钥匙释放、允许他人重新建档</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {LOSS_REASONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={`rounded-lg border py-2 text-sm ${reason === r ? 'border-red-500 bg-red-50 font-semibold text-red-700' : 'border-gray-300 text-gray-600'}`}
          >
            {r}
          </button>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm text-gray-600">取消</button>
        <button
          onClick={() => (reason ? onConfirm(reason) : setErr('请先选择流失原因（必选枚举）'))}
          className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white"
        >
          确认流失
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
