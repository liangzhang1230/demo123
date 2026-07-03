import { Link, Navigate, useParams } from 'react-router-dom';
import { PACKS } from '../../components/packContent';
import { SampleBadge, SampleTag } from '../../components/SampleBadge';

/**
 * P6 · 四包静态样例长页（/boss/pack/:packId）
 * 素材按《演示版施工包 · 第二件·2》人物故事线各写一页；「示例数据」角标常驻右上角；
 * 全页零计算——所有数字为静态精修样例（铁律 2 豁免区），绝不读取事件流。
 */
export default function PackSamplePage() {
  const { packId } = useParams();
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return <Navigate to="/boss" replace />;

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:max-w-2xl">
      <SampleBadge />
      <Link to="/boss" className="text-sm text-gray-400">← 返回决策看板</Link>

      <header className="mt-3 rounded-xl bg-gray-900 p-4 text-white">
        <div className="text-xs text-gray-400">{pack.seq} · 静态样例页</div>
        <h1 className="mt-1 text-lg font-bold">{pack.name}</h1>
        <p className="mt-1 text-xs text-gray-300">【{pack.ask}】</p>
        <div className="mt-3 rounded-lg bg-white/10 p-3">
          <div className="text-[11px] text-gray-400">{pack.hook.person}</div>
          <div className="mt-0.5 text-sm font-semibold">{pack.hook.question}</div>
        </div>
      </header>

      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
        本页为精修样例（示例数据）：正式开通后，以下每个数字都由你的真实事件流实时计算——就像你刚才在看板上看到的那些数一样。
      </p>

      <div className="mt-3 space-y-3">
        {pack.sections.map((s) => (
          <section key={s.title} className="rounded-xl border border-gray-200 p-4">
            <div className="text-[11px] text-gray-400">{s.member}</div>
            <h2 className="mt-0.5 text-sm font-bold text-gray-900">{s.title}</h2>
            {s.stat && (
              <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                <div className="text-[11px] text-gray-500">{s.stat.label}</div>
                <div className="text-2xl font-bold tabular-nums text-gray-900">
                  {s.stat.value}
                  <SampleTag />
                </div>
              </div>
            )}
            <ul className="mt-2 space-y-1.5">
              {s.lines.map((l) => (
                <li key={l} className="text-xs leading-relaxed text-gray-700">
                  {l}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-gray-300 p-3 text-center text-[11px] text-gray-400">
        （正式版此处走试看/开通流程；演示版点『试看申请』仅提示「上线后由商务开通」）
      </div>

      <Link
        to="/boss"
        className="mt-3 block w-full rounded-xl bg-gray-900 py-3 text-center text-sm font-semibold text-white"
      >
        ← 回到看板继续演示
      </Link>
    </div>
  );
}
