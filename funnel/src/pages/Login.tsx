import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, setToken } from '../api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await login(password);
      setToken(token);
      nav('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <h1 className="text-2xl font-bold">销售漏斗</h1>
      <p className="mt-1 text-sm text-slate-500">私人客户跟进工具</p>
      <form onSubmit={submit} className="mt-8 w-full max-w-xs space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="登录密码"
          autoFocus
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
      <p className="mt-6 max-w-xs text-center text-xs text-slate-400">
        首次运行的密码打印在服务器启动日志里，可用环境变量 FUNNEL_PASSWORD 覆盖
      </p>
    </div>
  );
}
