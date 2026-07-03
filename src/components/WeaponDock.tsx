import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PACKS, THINKTANK } from './packContent';
import { SampleTag } from './SampleBadge';

/**
 * 区五 · 武器坞（P6 货架与点亮）
 * - 锁卡（未购）＝三要素定式：①一句价值主张（照抄各包一句话定位）②数据就绪徽标（读侧事实：
 *   成交笔数由事件流实时折算传入，绝不预演任何付费结论数字）③『试看申请』键（点击仅弹「上线后由商务开通」）。
 * - 点开锁卡 → 四包静态样例长页（/boss/pack/:id，示例角标常驻）。
 * - 「一键点亮全家桶」＝仅演示版机能：点亮后四包变活卡样式、作业一行显示样例值（带示例角标），回锁瞬时还原。
 * - 三条货架铁律：绝不弹窗推销、锁卡上绝不显示任何计算结果、卡序固定 包①→②→③→④→功能位。
 */
export default function WeaponDock({
  dealCnt,
  lit,
  onToggleLit,
}: {
  /** 由事件流实时折算的成交总客户数（数据就绪徽标用，读侧事实陈述） */
  dealCnt: number;
  lit: boolean;
  onToggleLit: () => void;
}) {
  const nav = useNavigate();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const readyBadge = `该演示租户已沉淀 ${dealCnt} 笔成交 / 90 天数据——开通即出结论`;
  const applyTrial = () => setToast('上线后由商务开通');

  return (
    <section className="rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">区五 · 武器坞（货架）</h2>
        <button
          onClick={onToggleLit}
          className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
            lit ? 'bg-amber-500 text-white' : 'bg-gray-900 text-white'
          }`}
        >
          {lit ? '🔓 一键回锁' : '✨ 一键点亮全家桶'}
        </button>
      </div>
      <p className="mb-3 text-[11px] text-gray-400">
        「一键点亮」为演示专属机能，正式版无此物；点亮后所有数字均为示例。
      </p>

      <div className="space-y-2">
        {PACKS.map((p) => (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => nav(`/boss/pack/${p.id}`)}
            onKeyDown={(e) => e.key === 'Enter' && nav(`/boss/pack/${p.id}`)}
            className={`cursor-pointer rounded-lg border p-3 transition ${
              lit ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-bold text-gray-900">
                {lit ? '🟢' : '🔒'} {p.seq} {p.name}
                <span className="ml-1 text-xs font-normal text-gray-500">【{p.ask}】</span>
              </div>
              <span className="shrink-0 text-xs text-gray-400">{lit ? '进入 ›' : '点开看样例 ›'}</span>
            </div>
            {lit ? (
              <p className="mt-1 text-xs text-gray-700">
                {p.litSummary}
                <SampleTag />
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs leading-relaxed text-gray-600">{p.valueProp}</p>
                <p className="mt-1.5 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                  ✅ {readyBadge}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    applyTrial();
                  }}
                  className="mt-1.5 block w-full rounded-md border border-gray-300 bg-white py-1.5 text-xs font-semibold text-gray-700"
                >
                  试看申请
                </button>
              </>
            )}
          </div>
        ))}

        {/* 功能位 · 经营智库锁卡（无样例长页，仅三要素） */}
        <div className={`rounded-lg border p-3 ${lit ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
          <div className="text-sm font-bold text-gray-900">
            {lit ? '🟢' : '🔒'} {THINKTANK.name}
            <span className="ml-1 text-xs font-normal text-gray-500">【增值包】</span>
          </div>
          {lit ? (
            <p className="mt-1 text-xs text-gray-700">
              定薪建议样卡已就绪
              <SampleTag />
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{THINKTANK.valueProp}</p>
              <p className="mt-1.5 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                ✅ {readyBadge}
              </p>
              <button
                onClick={applyTrial}
                className="mt-1.5 block w-full rounded-md border border-gray-300 bg-white py-1.5 text-xs font-semibold text-gray-700"
              >
                试看申请
              </button>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </section>
  );
}
