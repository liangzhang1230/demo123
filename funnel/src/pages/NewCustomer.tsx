import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCustomer } from '../api';
import { useAppState } from '../App';
import type { Member, Relation } from '../types';

const RELATIONS: Relation[] = ['本人', '孩子', '家长', '其他'];

export default function NewCustomer() {
  const { refresh } = useAppState();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    name: '', relation: '孩子' as Relation, phone: '',
    parentName: '', parentPhone: '',
    source: '', note: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const members: Member[] = [];
      // 主姓名同时作为一名成员，身份可选（默认孩子——教培场景孩子是服务对象）
      members.push({ relation: form.relation, name: form.name.trim(), phone: form.phone.trim() });
      if (form.parentName.trim()) {
        members.push({ relation: '家长', name: form.parentName.trim(), phone: form.parentPhone.trim() });
      }
      const c = await createCustomer({
        name: form.name.trim(),
        source: form.source,
        note: form.note,
        members,
      });
      await refresh();
      nav(`/customers/${c.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500';

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-bold">快速录入</h1>
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex gap-2">
          <select
            value={form.relation}
            onChange={(e) => setForm({ ...form, relation: e.target.value as Relation })}
            className="rounded-xl border border-slate-300 bg-white px-2 py-2.5 text-sm"
          >
            {RELATIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="姓名（必填，档案以 TA 命名）"
            autoFocus
            className={input}
          />
        </div>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="电话（可空）" className={input} />

        <div className="rounded-xl bg-slate-100 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">家长（可空，之后详情页还能加）</div>
          <div className="space-y-2">
            <input value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })}
              placeholder="家长姓名" className={input} />
            <input value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
              placeholder="家长电话" className={input} />
          </div>
        </div>

        <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
          placeholder="来源（如：转介绍、抖音、地推）" className={input} />
        <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder="备注" rows={2} className={input} />

        <button
          type="submit"
          disabled={busy || !form.name.trim()}
          className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? '保存中…' : '建档（进入第一阶段）'}
        </button>
      </form>
    </div>
  );
}
