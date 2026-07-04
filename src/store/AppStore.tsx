/**
 * 应用状态层：SeedData（localStorage 持久）＋ 实时折算结果（computeAll，铁律 2：
 * 一切展示数字由事件流实时计算）＋ P5 业务操作（建档/流转/回款/确认/模拟过一天）。
 * P6 追加「一键点亮全家桶」，P7 追加防误触锁定。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SeedData } from '../domain/types';
import { computeAll, type Computed } from '../domain/compute';
import {
  addRepeatOrder, confirmToday, createCustomer, simulateDayPass, transitionStage,
  type NewCustomerInput, type TransitionInput,
} from '../domain/actions';
import { loadSeed, resetSeed, saveSeed } from '../seed/store';

interface AppState {
  data: SeedData;
  computed: Computed;
  /** P6 一键点亮全家桶（仅演示版存在；点亮后锁位显示静态示例值＋「示例」角标） */
  unlocked: boolean;
  setUnlocked: (v: boolean) => void;
  reset: () => void;
  error: string | null;
  /** —— P5 业务操作（全部走 src/domain/actions 纯函数，事件追加＋持久化）—— */
  actions: {
    createCustomer: (input: NewCustomerInput) => string;
    transition: (customerId: string, input: TransitionInput) => void;
    addRepeatOrder: (customerId: string, amount: number, categoryCode: string) => void;
    confirmToday: (ownerId: string) => void;
    simulateDayPass: () => void;
  };
}

const Ctx = createContext<AppState | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SeedData | null>(null);
  const [booting, setBooting] = useState(true);

  // P7 加载动画：先绘制开屏，再同步折算 90 天事件流（loadSeed 内含守恒校验）
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setData(loadSeed());
      } catch (e) {
        setError(String(e));
      }
      setBooting(false);
    }, 60);
    return () => clearTimeout(timer);
  }, []);
  const [unlocked, setUnlockedState] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('sales-demo/unlocked') === '1',
  );
  const setUnlocked = (v: boolean) => {
    setUnlockedState(v);
    if (typeof localStorage !== 'undefined') localStorage.setItem('sales-demo/unlocked', v ? '1' : '0');
  };

  const computed = useMemo(() => (data ? computeAll(data) : null), [data]);

  if (booting) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-gray-900 text-white">
        <div className="text-2xl font-bold tracking-wide">AI 销售操盘手</div>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-white/70" />
        </div>
        <div className="animate-pulse text-xs text-gray-400">正在折算 90 天种子事件流（守恒校验中）…</div>
      </div>
    );
  }

  if (error || !data || !computed) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-bold">种子守恒断言失败，拒绝启动</p>
          <p className="mt-2 break-all">{error ?? '数据缺失'}</p>
        </div>
      </div>
    );
  }

  const apply = (next: SeedData) => {
    saveSeed(next);
    setData(next);
  };

  const reset = () => {
    try {
      setData(resetSeed());
      setUnlocked(false);
    } catch (e) {
      setError(String(e));
    }
  };


  const actions: AppState['actions'] = {
    createCustomer: (input) => {
      const { data: next, customerId } = createCustomer(data, input);
      apply(next);
      return customerId;
    },
    transition: (customerId, input) => apply(transitionStage(data, customerId, input)),
    addRepeatOrder: (customerId, amount, categoryCode) => apply(addRepeatOrder(data, customerId, amount, categoryCode)),
    confirmToday: (ownerId) => apply(confirmToday(data, ownerId)),
    simulateDayPass: () => apply(simulateDayPass(data)),
  };

  return (
    <Ctx.Provider value={{ data, computed, unlocked, setUnlocked, reset, error, actions }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp 须在 AppStoreProvider 内使用');
  return v;
}
