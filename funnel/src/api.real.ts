import type { AppState, Customer, Member, Settings } from './types';

const TOKEN_KEY = 'funnel_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 && path !== '/api/login') {
    clearToken();
    location.hash = '#/login';
    throw new Error('未登录');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `请求失败 (${res.status})`);
  return body as T;
}

export const login = (password: string) =>
  request<{ token: string }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) });

export const fetchState = () => request<AppState>('/api/state');

export const saveSettings = (s: Settings) =>
  request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) });

export const createCustomer = (data: {
  name: string; source?: string; note?: string; members?: Member[];
}) => request<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(data) });

export const updateCustomer = (id: string, data: Partial<Pick<Customer, 'name' | 'source' | 'note' | 'members'>>) =>
  request<Customer>(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteCustomer = (id: string) =>
  request<{ ok: boolean }>(`/api/customers/${id}`, { method: 'DELETE' });

export const addFollowUp = (id: string, text: string) =>
  request<Customer>(`/api/customers/${id}/followups`, { method: 'POST', body: JSON.stringify({ text }) });

export const setStage = (id: string, to: string, lostReason?: string) =>
  request<Customer>(`/api/customers/${id}/stage`, { method: 'POST', body: JSON.stringify({ to, lostReason }) });

export const claim = (id: string) =>
  request<Customer>(`/api/customers/${id}/claim`, { method: 'POST' });

export const release = (id: string, reason?: string) =>
  request<Customer>(`/api/customers/${id}/release`, { method: 'POST', body: JSON.stringify({ reason }) });
