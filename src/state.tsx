/**
 * 演示会话状态（P5）：种子（只读）＋ overlay（现场操作）→ 合并数据下发全部页面。
 * 一切展示数字由合并后事件流实时折算；每次写操作先过写时守卫、后跑守恒断言，跑不平即拒绝落库。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Customer, LossReason, SeedData, Stage } from './domain/types';
import {
  buildCreateCustomer, buildRepeatOrder, buildStageChange, findPhoneConflict,
  type Clock, type PhoneConflict,
} from './domain/ops';
import { loadSeed, resetSeed } from './seed/store';
import {
  assertConservation, closeDay, emptyOverlay, loadOverlay, mergeData, saveOverlay, clearOverlay,
  type Overlay,
} from './seed/overlay';

/** 演示身份（免密三身份之销售：王丽）——一切现场录入动作以她的身份发生 */
export const DEMO_SALES_ID = 'wangli';

export type OpResult = { ok: true } | { ok: false; error: string };

export interface DemoActions {
  /** 建档（写时查重：撞键返回 conflict，由拦截页展示脱敏归属） */
  createCustomer(input: { name: string; contact: string; phone: string; level: Customer['level'] }):
    | { ok: true; customerId: string }
    | { ok: false; error: string; conflict?: PhoneConflict };
  advanceStage(
    customerId: string,
    to: Stage,
    opts?: { lossReason?: LossReason; amount?: number; categoryCode?: string },
  ): OpResult;
  recordRepeatOrder(customerId: string, amount: number, categoryCode: string): OpResult;
  submitConfirm(note: string): void;
  simulateDay(): void;
  resetAll(): void;
}

export interface DemoState {
  data: SeedData;
  overlay: Overlay;
  actions: DemoActions;
}

const DemoCtx = createContext<DemoState | null>(null);

export function useDemo(): DemoState {
  const ctx = useContext(DemoCtx);
  if (!ctx) throw new Error('useDemo 须在 DemoProvider 内使用');
  return ctx;
}

function nowClock(data: SeedData): Clock {
  const t = new Date();
  return {
    date: data.anchorDate,
    time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
  };
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<{ base: SeedData | null; error: string | null }>(() => {
    try {
      return { base: loadSeed(), error: null };
    } catch (e) {
      return { base: null, error: String(e) };
    }
  });
  const [overlay, setOverlay] = useState<Overlay>(loadOverlay);
  const base = boot.base;

  const data = useMemo(() => (base ? mergeData(base, overlay) : null), [base, overlay]);

  const commit = useCallback(
    (next: Overlay) => {
      // 落库前守恒复验（R1-12）：跑不平即拒绝
      assertConservation(mergeData(base!, next));
      saveOverlay(next);
      setOverlay(next);
    },
    [base],
  );

  const actions = useMemo<DemoActions>(() => {
    return {
      createCustomer(input) {
        if (!data) return { ok: false, error: '数据未就绪' };
        const conflict = findPhoneConflict(data, input.phone.trim());
        if (conflict) return { ok: false, error: '手机号撞键，禁止重复建档', conflict };
        try {
          const { customer, event } = buildCreateCustomer(data, { ...input, ownerId: DEMO_SALES_ID }, nowClock(data));
          commit({ ...overlay, customers: [...overlay.customers, customer], events: [...overlay.events, event] });
          return { ok: true, customerId: customer.id };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      advanceStage(customerId, to, opts = {}) {
        if (!data) return { ok: false, error: '数据未就绪' };
        try {
          const evs = buildStageChange(data, customerId, to, nowClock(data), opts);
          commit({ ...overlay, events: [...overlay.events, ...evs] });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      recordRepeatOrder(customerId, amount, categoryCode) {
        if (!data) return { ok: false, error: '数据未就绪' };
        try {
          const ev = buildRepeatOrder(data, customerId, amount, categoryCode, nowClock(data));
          commit({ ...overlay, events: [...overlay.events, ev] });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      submitConfirm(note) {
        if (!data) return;
        const clock = nowClock(data);
        const confirms = [
          ...overlay.confirms.filter((c) => !(c.date === clock.date && c.ownerId === DEMO_SALES_ID)),
          { date: clock.date, ownerId: DEMO_SALES_ID, time: clock.time },
        ];
        const notes = note.trim()
          ? [
              ...overlay.notes.filter((n) => !(n.date === clock.date && n.ownerId === DEMO_SALES_ID)),
              { date: clock.date, ownerId: DEMO_SALES_ID, text: note.trim() },
            ]
          : overlay.notes;
        commit({ ...overlay, confirms, notes });
      },
      simulateDay() {
        if (!base) return;
        commit(closeDay(base, overlay));
      },
      resetAll() {
        try {
          clearOverlay();
          setOverlay(emptyOverlay());
          setBoot({ base: resetSeed(), error: null });
        } catch (e) {
          setBoot({ base: null, error: String(e) });
        }
      },
    };
  }, [base, data, overlay, commit]);

  if (boot.error || !data) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-bold">种子守恒断言失败，拒绝启动</p>
          <p className="mt-2 break-all">{boot.error}</p>
        </div>
      </div>
    );
  }
  return <DemoCtx.Provider value={{ data, overlay, actions }}>{children}</DemoCtx.Provider>;
}
