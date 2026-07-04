/**
 * 演示浮钮（P7）：一键重置 ＋ 防误触锁定。
 * 锁定后全屏拦截点击（把手机递给老板看时不怕乱点），长按解锁条 1 秒解锁；
 * 重置需二次确认，清空演示操作并恢复种子数据。
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppStore';

export function FloatingControls() {
  const { reset } = useApp();
  const nav = useNavigate();
  const [locked, setLocked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = () => {
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      setLocked(false);
      setHolding(false);
    }, 1000);
  };
  const cancelHold = () => {
    setHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  };

  if (locked) {
    return (
      <div className="fixed inset-0 z-[90] flex items-end justify-center bg-transparent" style={{ touchAction: 'none' }}>
        <div className="pointer-events-auto mb-6 select-none rounded-full bg-gray-900/90 px-5 py-3 text-xs text-white shadow-xl">
          <button
            data-testid="unlock-hold"
            className={`select-none ${holding ? 'text-amber-300' : ''}`}
            onMouseDown={startHold}
            onMouseUp={cancelHold}
            onMouseLeave={cancelHold}
            onTouchStart={startHold}
            onTouchEnd={cancelHold}
          >
            🔒 演示已锁定（防误触）—— 长按此处 1 秒解锁{holding ? '…' : ''}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed bottom-5 right-4 z-[80] flex flex-col gap-2">
        <button
          data-testid="lock-btn"
          title="防误触锁定"
          onClick={() => setLocked(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg shadow-lg ring-1 ring-gray-200 active:bg-gray-100"
        >
          🔓
        </button>
        <button
          data-testid="reset-btn"
          title="一键重置演示数据"
          onClick={() => setConfirming(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg shadow-lg ring-1 ring-gray-200 active:bg-gray-100"
        >
          ↺
        </button>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirming(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900">重置演示数据？</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              将清空本次演示的全部操作（建档/流转/回款/确认/模拟日切），重新生成种子事件流并重跑守恒断言。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="rounded-xl bg-gray-100 py-2.5 text-sm" onClick={() => setConfirming(false)}>取消</button>
              <button
                data-testid="reset-confirm"
                className="rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white"
                onClick={() => {
                  reset();
                  setConfirming(false);
                  nav('/');
                }}
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
