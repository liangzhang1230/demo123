/**
 * 建档页（P5）· 唯一事实源＝v1.0 第三部分（建档与联系人不是两件事：首条联系人随建档创建）
 *  - 手机号硬钥匙写时守卫：撞键硬拦截，拦截页展示＝按权限脱敏的归属 ＋ 客户状态 ＋ 最后动态时间（§5）
 *  - 已流失客户手机号已释放，允许重新建档
 *  - ABCD 默认 C（§4.4，与线索完全正交、仅作列表排序）
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Customer } from '../../domain/types';
import { STAGE_LABEL } from '../../domain/types';
import { maskName, maskPhone } from '../../domain/mask';
import type { PhoneConflict } from '../../domain/ops';
import { useDemo } from '../../state';

const LEVELS: Customer['level'][] = ['A', 'B', 'C', 'D'];

export default function NewCustomerPage() {
  const { data, actions } = useDemo();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState<Customer['level']>('C');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PhoneConflict | null>(null);

  const deptNameOf = (ownerId: string) => {
    const p = data.people.find((x) => x.id === ownerId);
    return p?.deptId ? data.departments.find((d) => d.id === p.deptId)?.name ?? '' : '';
  };
  const ownerNameOf = (ownerId: string) => data.people.find((x) => x.id === ownerId)?.name ?? ownerId;

  const submit = () => {
    setError(null);
    setConflict(null);
    const r = actions.createCustomer({ name, contact, phone, level });
    if (r.ok) {
      navigate(`/sales/customer/${r.customerId}`, { replace: true });
    } else {
      setError(r.error);
      if ('conflict' in r && r.conflict) setConflict(r.conflict);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-5 sm:max-w-2xl">
      <header className="mb-4">
        <Link to="/sales" className="text-xs text-gray-400">← 返回销售看板</Link>
        <h1 className="text-lg font-bold">客户建档</h1>
        <p className="text-xs text-gray-400">归属：王丽 · 建档即产线索事件，计 create_time 当日</p>
      </header>

      <div className="space-y-3 rounded-xl border border-gray-200 p-4">
        <Field label="客户名称 *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：新客串串香商行"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
          />
        </Field>
        <Field label="首条联系人（姓名/职务）*">
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="例：周老板"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
          />
        </Field>
        <Field label="手机号（硬钥匙，写时查重）*">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="11 位手机号"
            inputMode="numeric"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm tabular-nums"
          />
        </Field>
        <Field label="ABCD 分级（默认 C；与线索正交，仅作列表排序）">
          <div className="flex gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`flex-1 rounded-lg border py-2 text-sm font-semibold ${
                  level === l ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-600'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </Field>

        <button
          onClick={submit}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white active:bg-gray-700"
        >
          建档（原子事务：写档案＋跑本租户查重）
        </button>
        {error && !conflict && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {conflict && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-700">🚫 手机号撞键，禁止重复建档</p>
          <p className="mt-1 text-xs text-red-600">
            该号码已归属本租户在库客户（查重范围＝除流失外全部状态，写时守卫）：
          </p>
          <dl className="mt-2 space-y-1 rounded-lg bg-white/70 p-3 text-sm">
            <ConflictRow k="归属（脱敏）" v={`${maskName(ownerNameOf(conflict.customer.ownerId))}（${deptNameOf(conflict.customer.ownerId)}）`} />
            <ConflictRow k="客户" v={`${maskName(conflict.customer.name)} · ${maskPhone(conflict.customer.phone)}`} />
            <ConflictRow k="客户状态" v={STAGE_LABEL[conflict.stage]} />
            <ConflictRow k="最后动态时间" v={conflict.lastEventDate} />
          </dl>
          <button
            disabled
            className="mt-3 w-full cursor-not-allowed rounded-lg border border-gray-300 py-2 text-sm text-gray-400"
          >
            提交合并申请
          </button>
          <p className="mt-1 text-center text-xs text-gray-400">（正式版此处提交合并申请，走审批留痕）</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function ConflictRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
