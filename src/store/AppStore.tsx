/**
 * 应用状态层：SeedData（localStorage 持久）＋ 实时折算结果（computeAll，铁律 2：
 * 一切展示数字由事件流实时计算）。P5 在此追加业务操作（建档/流转/回款/确认/模拟过一天），
 * P6 追加「一键点亮全家桶」，P7 追加防误触锁定。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { SeedData } from '../domain/types';
import { computeAll, type Computed } from '../domain/compute';
import { loadSeed, resetSeed } from '../seed/store';

interface AppState {
  data: SeedData;
  computed: Computed;
  /** P6 一键点亮全家桶（仅演示版存在；点亮后锁位显示静态示例值＋「示例」角标） */
  unlocked: boolean;
  setUnlocked: (v: boolean) => void;
  reset: () => void;
  error: string | null;
}

const Ctx = createContext<AppState | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SeedData | null>(() => {
    try {
      return loadSeed();
    } catch (e) {
      setError(String(e));
      return null;
    }
  });
  const [unlocked, setUnlocked] = useState(false);

  const computed = useMemo(() => (data ? computeAll(data) : null), [data]);

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

  const reset = () => {
    try {
      setData(resetSeed());
      setUnlocked(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Ctx.Provider value={{ data, computed, unlocked, setUnlocked, reset, error }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp 须在 AppStoreProvider 内使用');
  return v;
}
