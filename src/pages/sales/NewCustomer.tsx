/**
 * /sales/customers/new · 客户建档（§4.2 建档与首条联系人一体＋写时查重）。
 * 手机号硬钥匙撞键 → 硬拦截并展示按权限脱敏的归属＋状态＋最后动态（第三部分 §5/§6）。
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../store/AppStore';
import { DuplicateError, type DupInfo } from '../../domain/actions';
import { Card, CardTitle, GrayNote, Shell } from '../../components/ui';

const ME = 'wangli';

export default function NewCustomerPage() {
  const { actions } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState<'A' | 'B' | 'C' | 'D'>('C');
  const [dup, setDup] = useState<DupInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    setDup(null);
    try {
      const id = actions.createCustomer({ name, contact, phone, ownerId: ME, level });
      nav(`/sales/customer/${id}`, { replace: true });
    } catch (e) {
      if (e instanceof DuplicateError) setDup(e.dup);
      else setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Shell title="客户建档" subtitle={<Link to="/sales" className="underline-offset-2 hover:underline">← 返回我的看板</Link>}>
      <Card>
        <CardTitle>新建客户（含首条联系人）</CardTitle>
        <div className="space-y-3">
          <Field label="客户名称 *">
            <input data-testid="cust-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：浦东新利华超市" className="input" />
          </Field>
          <Field label="联系人 *">
            <input data-testid="cust-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="如：周老板" className="input" />
          </Field>
          <Field label="联系人手机号 *（写时查重硬钥匙）">
            <input data-testid="cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 位手机号" inputMode="numeric" className="input" />
          </Field>
          <Field label="ABCD 等级（主观优先级，默认 C）">
            <div className="flex gap-2">
              {(['A', 'B', 'C', 'D'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`h-9 w-9 rounded-lg text-sm font-semibold ${level === l ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </Field>

          {dup && (
            <div data-testid="dup-block" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="font-bold">⛔ 重复建档拦截（手机号硬钥匙撞键）</div>
              <div className="mt-1.5 space-y-0.5 text-xs leading-5">
                <div>该号码已归属：<b>{dup.ownerMasked}</b>（按权限脱敏）</div>
                <div>客户状态：{dup.stageLabel} ｜ 最后动态：{dup.lastActive}</div>
                <div>号码：{dup.phoneMasked}</div>
              </div>
              <div className="mt-2 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] text-gray-500">
                如确属同一客户需要合并，请提交合并申请（正式版此处走审批留痕）
              </div>
            </div>
          )}
          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

          <button data-testid="cust-submit" onClick={submit} className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white active:bg-gray-700">
            建档（建档即线索，实时入账）
          </button>
          <GrayNote>建档时间与归属由系统自动生成，任何操作不可改（R1-10 归属日期永久封存）。</GrayNote>
        </div>
      </Card>
    </Shell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
