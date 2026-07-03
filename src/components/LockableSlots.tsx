import { SampleTag } from './SampleBadge';

/**
 * P6 可点亮锁位两件：心跳第 6 格＋钱事分诊条三段。
 * 锁态：按 v1.0 看板章——第 6 格「未购包②则本格上锁显 —＋钥匙标」；分诊条「任一段所依赖的包未购 →
 * 该段显 — ＋ 锁标 ＋ 一行价值语（在漏段价值语照抄原文）」——货架诚实法则：显缺口、不显假数。
 * 点亮态：亮起样例值，全部带「示例」角标（零计算）。
 * 其余五格与真算段位属 P3 清单，本文件只承载锁位两件，P3 直接嵌装。
 */

export function HeartbeatCell6({ lit }: { lit: boolean }) {
  return (
    <div className={`rounded-lg p-2 text-center ${lit ? 'bg-amber-50' : 'bg-gray-50'}`}>
      <div className="text-xs text-gray-500">30 天现金前瞻</div>
      {lit ? (
        <>
          <div className="text-lg font-bold tabular-nums text-gray-900">
            ¥17.0 万<SampleTag />
          </div>
          <div className="text-[11px] text-gray-500">预计回 ¥17.0 万（估算）</div>
        </>
      ) : (
        <>
          <div className="text-lg font-bold text-gray-400">—</div>
          <div className="text-[11px] text-gray-400">🔑 开通增长操盘包解锁</div>
        </>
      )}
    </div>
  );
}

export function MoneyTriageBar({ lit }: { lit: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {/* 在漏（红）＝包①止血月净烧＋包②卡点卡住营收（分列两行、不相加） */}
      <TriageSeg
        color="red"
        title="在漏"
        lit={lit}
        litLines={['止血净烧 ¥8,900/月', '卡点卡着 ¥49.6 万']}
        lockLine="开通人效操盘包，这里每天告诉你在漏多少钱"
      />
      {/* 待拿（黄）＝包②沉睡金矿估值＋休眠数＋超期签约管道数 */}
      <TriageSeg
        color="yellow"
        title="待拿"
        lit={lit}
        litLines={['金矿估值 ¥15.6 万', '休眠 23 家 · 管道 9 家']}
        lockLine="开通增长操盘包，这里每天告诉你还有多少钱没去拿"
      />
      {/* 在赚（绿）＝包①已回本人数/总人数（里程碑徽标随包④） */}
      <TriageSeg
        color="green"
        title="在赚"
        lit={lit}
        litLines={['已回本 6 / 10 人', '🏅 月净利新高']}
        lockLine="开通人效操盘包，这里每天告诉你几个人已在替你赚钱"
      />
    </div>
  );
}

const SEG_STYLE = {
  red: { head: 'text-red-600', box: 'border-red-200', litBox: 'border-red-300 bg-red-50' },
  yellow: { head: 'text-amber-600', box: 'border-amber-200', litBox: 'border-amber-300 bg-amber-50' },
  green: { head: 'text-emerald-600', box: 'border-emerald-200', litBox: 'border-emerald-300 bg-emerald-50' },
} as const;

function TriageSeg({
  color,
  title,
  lit,
  litLines,
  lockLine,
}: {
  color: keyof typeof SEG_STYLE;
  title: string;
  lit: boolean;
  litLines: string[];
  lockLine: string;
}) {
  const s = SEG_STYLE[color];
  return (
    <div className={`rounded-lg border p-2 ${lit ? s.litBox : s.box}`}>
      <div className={`text-xs font-bold ${s.head}`}>{title}</div>
      {lit ? (
        <div className="mt-1 space-y-0.5">
          {litLines.map((l) => (
            <div key={l} className="text-[11px] font-medium leading-tight text-gray-800">
              {l}
              <SampleTag />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1">
          <div className="text-base font-bold text-gray-400">— 🔒</div>
          <div className="text-[10px] leading-tight text-gray-400">{lockLine}</div>
        </div>
      )}
    </div>
  );
}
