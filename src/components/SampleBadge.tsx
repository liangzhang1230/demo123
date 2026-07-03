/**
 * 「示例数据」角标 —— 铁律 2：锁卡与样例页零计算、常驻本角标。
 * SampleBadge＝页面级常驻角标（右上角固定）；SampleTag＝行内小标（点亮后的样例值旁）。
 */

export function SampleBadge() {
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 rounded-full bg-amber-500/95 px-3 py-1 text-xs font-bold text-white shadow">
      示例数据
    </div>
  );
}

export function SampleTag() {
  return (
    <span className="ml-1 inline-block rounded bg-amber-100 px-1 py-px align-middle text-[10px] font-semibold leading-none text-amber-700">
      示例
    </span>
  );
}
