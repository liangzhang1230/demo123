import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppState } from '../App';
import {
  addFollowUp, claim, deleteCustomer, release, setStage, updateCustomer,
} from '../api';
import { LOST, daysSince } from '../types';
import type { Member, Relation } from '../types';

const RELATIONS: Relation[] = ['本人', '家长', '孩子', '其他'];

const EVENT_COLORS: Record<string, string> = {
  note: 'bg-slate-300',
  stage: 'bg-blue-500',
  claim: 'bg-cyan-500',
  release: 'bg-amber-500',
  recycle: 'bg-red-400',
};

export default function CustomerDetail() {
  const { id } = useParams();
  const { state, refresh } = useAppState();
  const nav = useNavigate();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingMember, setAddingMember] = useState(false);

  const c = state?.customers.find((x) => x.id === id);
  if (!state) return <p className="p-6 text-center text-sm text-slate-400">加载中…</p>;
  if (!c) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">
        客户不存在 <Link to="/customers" className="text-blue-600 underline">返回列表</Link>
      </div>
    );
  }
  const { stages } = state.settings;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function changeStage(to: string) {
    if (to === LOST) {
      const reason = prompt('流失原因（如：价格、没时间、选了别家）');
      if (reason === null) return;
      void run(() => setStage(c!.id, LOST, reason));
    } else {
      void run(() => setStage(c!.id, to));
    }
  }

  function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    void run(async () => {
      await addFollowUp(c!.id, note.trim());
      setNote('');
    });
  }

  function saveMember(m: Member) {
    void run(() => updateCustomer(c!.id, { members: [...c!.members, m] }));
    setAddingMember(false);
  }

  function removeMember(i: number) {
    if (!confirm(`删除成员「${c!.members[i].name}」？`)) return;
    void run(() => updateCustomer(c!.id, { members: c!.members.filter((_, j) => j !== i) }));
  }

  const days = daysSince(c.lastFollowUpAt);

  return (
    <div className="px-4 py-5">
      <Link to="/customers" className="text-sm text-slate-400">← 客户列表</Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">{c.name}</h1>
          <div className="mt-1 text-xs text-slate-400">
            {c.source || '来源未填'} · 建档 {c.createdAt.slice(0, 10)} ·{' '}
            {days === 0 ? '今天有跟进' : `${days} 天未跟进`}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          c.owner === 'me' ? 'bg-blue-50 text-blue-700' : 'bg-cyan-50 text-cyan-700'
        }`}>
          {c.owner === 'me' ? '私海' : '公海'}
        </span>
      </div>

      {c.note && <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm">{c.note}</p>}

      {/* 阶段流转 */}
      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-500">阶段</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {stages.map((s) => (
            <button
              key={s}
              disabled={busy}
              onClick={() => changeStage(s)}
              className={`rounded-full px-3 py-1.5 text-sm ${
                c.stage === s
                  ? 'bg-blue-600 font-semibold text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => changeStage(LOST)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              c.stage === LOST ? 'bg-slate-700 font-semibold text-white' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {LOST}
          </button>
        </div>
        {c.stage === LOST && c.lostReason && (
          <p className="mt-1.5 text-xs text-slate-500">流失原因：{c.lostReason}</p>
        )}
      </div>

      {/* 公海操作 */}
      <div className="mt-3 flex gap-2">
        {c.owner === 'me' ? (
          <button
            disabled={busy}
            onClick={() => {
              const reason = prompt('放回公海的原因（可空）');
              if (reason === null) return;
              void run(() => release(c.id, reason));
            }}
            className="rounded-lg bg-cyan-50 px-3 py-1.5 text-sm text-cyan-700"
          >
            放回公海
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => void run(() => claim(c.id))}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white"
          >
            认领到私海
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => setEditing((v) => !v)}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600"
        >
          {editing ? '收起编辑' : '编辑资料'}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (!confirm(`确定删除「${c.name}」？跟进记录一并删除，不可恢复`)) return;
            void run(async () => { await deleteCustomer(c.id); nav('/customers'); });
          }}
          className="ml-auto rounded-lg px-3 py-1.5 text-sm text-red-500"
        >
          删除
        </button>
      </div>

      {editing && <EditForm id={c.id} name={c.name} source={c.source} note={c.note}
        onDone={() => { setEditing(false); void refresh(); }} />}

      {/* 家庭成员 */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-500">家庭成员 / 联系人</div>
          <button onClick={() => setAddingMember((v) => !v)} className="text-xs text-blue-600">
            {addingMember ? '取消' : '＋ 添加'}
          </button>
        </div>
        <div className="mt-1.5 space-y-1.5">
          {c.members.length === 0 && !addingMember && (
            <p className="text-xs text-slate-400">还没有成员，比如给孩子建档后把家长加进来</p>
          )}
          {c.members.map((m, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div>
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{m.relation}</span>
                <span className="text-sm font-medium">{m.name}</span>
                <div className="mt-0.5 text-xs text-slate-400">
                  {[m.phone && `📞 ${m.phone}`, m.wechat && `微信 ${m.wechat}`, m.note]
                    .filter(Boolean).join(' · ') || '无联系方式'}
                </div>
              </div>
              <button onClick={() => removeMember(i)} className="text-xs text-slate-300">✕</button>
            </div>
          ))}
          {addingMember && <MemberForm onSave={saveMember} />}
        </div>
      </div>

      {/* 跟进 */}
      <div className="mt-5">
        <div className="text-xs font-semibold text-slate-500">跟进记录</div>
        <form onSubmit={submitNote} className="mt-1.5 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="记一条跟进：聊了什么、下一步…"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={busy || !note.trim()}
            className="rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            记录
          </button>
        </form>
        <div className="mt-3 space-y-2.5">
          {[...c.followUps].reverse().map((f) => (
            <div key={f.id} className="flex gap-2.5">
              <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${EVENT_COLORS[f.type] ?? 'bg-slate-300'}`} />
              <div>
                <div className="text-sm">{f.text}</div>
                <div className="text-xs text-slate-400">{f.at.slice(0, 16).replace('T', ' ')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditForm({ id, name, source, note, onDone }: {
  id: string; name: string; source: string; note: string; onDone: () => void;
}) {
  const [form, setForm] = useState({ name, source, note });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void updateCustomer(id, form).then(onDone).catch((err) => alert((err as Error).message));
      }}
      className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3"
    >
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="姓名" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
        placeholder="来源（如：转介绍、抖音、地推）" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
        placeholder="备注" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <button type="submit" className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white">
        保存
      </button>
    </form>
  );
}

function MemberForm({ onSave }: { onSave: (m: Member) => void }) {
  const [m, setM] = useState<Member>({ relation: '家长', name: '', phone: '', wechat: '', note: '' });
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (m.name.trim()) onSave({ ...m, name: m.name.trim() }); }}
      className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3"
    >
      <div className="flex gap-2">
        <select value={m.relation} onChange={(e) => setM({ ...m, relation: e.target.value as Relation })}
          className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
          {RELATIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })}
          placeholder="姓名" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className="flex gap-2">
        <input value={m.phone} onChange={(e) => setM({ ...m, phone: e.target.value })}
          placeholder="电话" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={m.wechat} onChange={(e) => setM({ ...m, wechat: e.target.value })}
          placeholder="微信" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <input value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })}
        placeholder="备注（如：孩子 8 岁 / 想学编程 / 白天勿扰）"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <button type="submit" disabled={!m.name.trim()}
        className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50">
        添加成员
      </button>
    </form>
  );
}
