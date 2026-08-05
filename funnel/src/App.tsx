import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { AppState } from './types';
import { fetchState, getToken } from './api';
import Login from './pages/Login';
import Board from './pages/Board';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import NewCustomer from './pages/NewCustomer';
import SettingsPage from './pages/Settings';

interface Ctx {
  state: AppState | null;
  refresh: () => Promise<void>;
}

const StateCtx = createContext<Ctx>({ state: null, refresh: async () => {} });
export const useAppState = () => useContext(StateCtx);

const TABS = [
  { to: '/', label: '漏斗', icon: '▤' },
  { to: '/customers', label: '客户', icon: '☰' },
  { to: '/new', label: '录入', icon: '＋' },
  { to: '/settings', label: '设置', icon: '⚙' },
];

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const location = useLocation();
  const authed = !!getToken();

  const refresh = useCallback(async () => {
    try {
      setState(await fetchState());
      setError('');
    } catch (e) {
      if ((e as Error).message !== '未登录') setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (authed) void refresh();
  }, [authed, refresh]);

  if (!authed && location.pathname !== '/login') return <Navigate to="/login" replace />;

  return (
    <StateCtx.Provider value={{ state, refresh }}>
      <div className="mx-auto min-h-dvh max-w-lg pb-20">
        {error && (
          <div className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
            <button className="ml-2 underline" onClick={() => void refresh()}>重试</button>
          </div>
        )}
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Board />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/new" element={<NewCustomer />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        {authed && (
          <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-lg">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.to === '/'}
                  className={({ isActive }) =>
                    `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                      isActive ? 'font-semibold text-blue-600' : 'text-slate-500'
                    }`
                  }
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  {t.label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>
    </StateCtx.Provider>
  );
}
