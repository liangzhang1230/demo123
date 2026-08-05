/** DEMO=1 构建走浏览器本地实现，否则走真实后端 */
import * as real from './api.real';
import * as demo from './api.demo';

const impl = (import.meta.env.VITE_DEMO ? demo : real) as typeof real;

export const {
  getToken, setToken, clearToken,
  login, fetchState, saveSettings,
  createCustomer, updateCustomer, deleteCustomer,
  addFollowUp, setStage, claim, release,
} = impl;
