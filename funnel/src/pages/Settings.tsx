import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../App';
import { clearToken, saveSettings } from '../api';

export default function SettingsPage() {
  const { state, refresh } = useAppState();
  const nav = useNavigate();
  const [stagesText, setStagesText] = useState('');
  const [recycleDays, setRecycleDays] = useState(14);
  const [noRecycleFrom, setNoRecycleFrom] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!state) return;
    setStagesText(state.settings.stages.join('\n'));
    setRecycleDays(state.settings.recycleDays);
    setNoRecycleFrom(state.settings.noRecycleFrom);
  }, [state]);

  if (!state) return <p className="p-6 text-center text-sm text-slate-400">加载中…</p>;

  const stages = stagesText.split('\n').map((s) => s.trim()).filter(Boolean);

  async function save() {
    setMsg('');
    try {
      await saveSettings({ stages, recycleDays, noRecycleFrom });
      await refresh();
      setMsg('已保存');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `funnel-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const input = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500';

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-bold">设置</h1>

      <div className="mt-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-500">漏斗阶段（一行一个，从上到下）</label>
          <textarea
            value={stagesText}
            onChange={(e) => setStagesText(e.target.value)}
            rows={7}
            className={`${input} mt-1 font-mono`}
          />
          <p className="mt-1 text-xs text-slate-400">
            「流失」是内置侧出口不用列。改名后老客户还挂在旧阶段名上，去详情页点一下新阶段即可。
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500">超过多少天没跟进自动回收到公海</label>
          <input
            type="number" min={1} max={365}
            value={recycleDays}
            onChange={(e) => setRecycleDays(Number(e.target.value))}
            className={`${input} mt-1`}
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500">从哪个阶段起不再回收（成交后的客户不该掉公海）</label>
          <select
            value={noRecycleFrom}
            onChange={(e) => setNoRecycleFrom(e.target.value)}
            className={`${input} mt-1 bg-white`}
          >
            {stages.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <button onClick={() => void save()} className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white">
          保存设置
        </button>
        {msg && <p className="text-center text-sm text-slate-500">{msg}</p>}

        <hr className="border-slate-200" />

        <button onClick={exportData} className="w-full rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-600">
          导出全部数据（JSON 备份）
        </button>
        <p className="text-xs text-slate-400">
          数据本体在服务器 funnel/data/db.json，定期备份该文件即可；导出仅是快捷方式。
        </p>

        <button
          onClick={() => { clearToken(); nav('/login'); }}
          className="w-full rounded-xl py-3 text-sm text-red-500"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
