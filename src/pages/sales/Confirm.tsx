/**
 * 每日确认页（P5）· 唯一事实源＝v1.0 §4.7（租户休息日除外）
 *  - 无手工填数：四池分区/成交区/当日总回款全部只读、由事件流自动汇总
 *  - 当日备注可编辑（留痕）；【提交确认】当日日界前可重复确认
 *  - R1-17 定版：自然日日界自动定版快照（演示以「模拟过一天」触发，见首页）
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { STAGE_LABEL, type Stage } from '../../domain/types';
import { buildConfirmSheet, type PoolSection } from '../../domain/confirmSheet';
import { isRestDay } from '../../domain/calendar';
import { DEMO_SALES_ID, useDemo } from '../../state';

const yuan = (v: number) => `¥${v.toLocaleString('zh-CN')}`;

const POOL_TITLE: Record<PoolSection['pool'], string> = {
  lead: '线索区',
  intent: '意向区',
  sample: '样品区',
  signed: '签约未回款区',
};

export default function ConfirmPage() {
  const { data, overlay, actions } = useDemo();
  const anchor = data.anchorDate;

  const sheet = useMemo(() => buildConfirmSheet(data, DEMO_SALES_ID, anchor, isRestDay), [data, anchor]);
  const confirmed = overlay.confirms.find((c) => c.date === anchor && c.ownerId === DEMO_SALES_ID) ?? null;
  const savedNote = overlay.notes.find((n) => n.date === anchor && n.ownerId === DEMO_SALES_ID)?.text ?? '';
  const [note, setNote] = useState(savedNote);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-md px-4 py-5 sm:max-w-2xl">
      <header className="mb-3">
        <Link to="/sales" className="text-xs text-gray-400">← 返回销售看板</Link>
        <h1 className="text-lg font-bold">每日确认页 <span className="text-sm font-normal text-gray-500">· {anchor}</span></h1>
        <p className="text-xs text-gray-400">无手工填数：对当日单据做日终确认即可（§4.7）</p>
      </header>

      {sheet.restDay && (
        <div className="mb-3 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
          今日为租户休息日：不计应确认、不点名；业务事件照常实时入账、照常定版
        </div>
      )}

      {/* 有效客户标准（纯提示文本，只读＋版本留痕） */}
      <section className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-medium text-gray-500">有效客户标准（只读 · 纯提示文本，不参与任何判定）</p>
        <p className="mt-1 text-sm text-gray-700">
          有稳定门店或固定采购渠道的快消终端/批发客户；单次意向采购额 ≥ ¥2,000；关键联系人可触达。
        </p>
        <p className="mt-1 text-xs text-gray-400">版本 v3 · 修改人 陈总 · 2026-05-12（历史按当时生效版本留痕）</p>
      </section>

      {/* 四池分区（全部只读，事件自动汇总） */}
      {sheet.pools.map((sec) => (
        <section key={sec.pool} className="mb-3 rounded-xl border border-gray-200 p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{POOL_TITLE[sec.pool]} <span className="text-xs font-normal text-gray-400">全部只读</span></h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row k="上期存量" v={sec.prevStock} />
            <Row k="今日新增" v={sec.newIn} />
            {(Object.entries(sec.out) as [Stage, number][]).map(([to, n]) => (
              <Row key={to} k={`转${STAGE_LABEL[to]}`} v={n} />
            ))}
            <Row k="流失" v={sec.lost} />
            <Row k="期末存量" v={sec.endStock} bold />
          </dl>
        </section>
      ))}

      {/* 成交区 */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">成交区</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Row k="首购客户数" v={sheet.firstDealCnt} />
          <Row k="复购客户数" v={sheet.repeatOrderCnt} />
        </dl>
        {sheet.orders.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
            {sheet.orders.map((o, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span className="truncate text-gray-700">{o.customerName}</span>
                <span className="ml-2 shrink-0 text-xs text-gray-400">{o.isRepeat ? '复购' : '首购'}</span>
                <span className="ml-3 shrink-0 font-semibold tabular-nums">{yuan(o.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-xs text-gray-300">回款当日日界前可编辑（跳成交客户改，留痕）——演示版请回客户卡操作</p>
      </section>

      {/* 当日总回款（只读） */}
      <section className="mb-3 flex items-baseline justify-between rounded-xl border border-gray-200 p-4">
        <span className="text-sm font-semibold text-gray-700">当日总回款（自动汇总 · 只读）</span>
        <span className="text-lg font-bold tabular-nums">{yuan(sheet.totalRevenue)}</span>
      </section>

      {/* 当日备注（可编辑，留痕） */}
      <section className="mb-3 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">当日备注（可编辑 · 留痕）</h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="自由文本"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </section>

      <button
        onClick={() => {
          actions.submitConfirm(note);
          setToast('已提交确认（当日日界前可重复确认；次日 00:00 自动定版 R1-17）');
        }}
        className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white active:bg-blue-700"
      >
        {confirmed ? `已于 ${confirmed.time} 确认 · 再次确认` : '提交确认'}
      </button>
      <p className="mt-1.5 text-center text-xs text-gray-400">
        定版后修改一律走审批（正式版此处走审批留痕）；演示日终请回首页点「模拟过一天」
      </p>

      {toast && (
        <div className="fixed inset-x-0 bottom-4 mx-auto max-w-md px-4" onClick={() => setToast(null)}>
          <p className="rounded-xl bg-gray-900/90 px-4 py-3 text-center text-xs text-white shadow-lg">{toast}（点按关闭）</p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: number; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{k}</dt>
      <dd className={`tabular-nums ${bold ? 'font-bold' : 'font-medium'}`}>{v}</dd>
    </div>
  );
}
