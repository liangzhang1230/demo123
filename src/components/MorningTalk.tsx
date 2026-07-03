import { useState } from 'react';
import { MORNING_REPORT_SAMPLE, MORNING_TALK, MORNING_TALK_NOTE } from './packContent';
import { SampleTag } from './SampleBadge';

/**
 * AI 操盘手晨话静态位＋早报样卡（P6 · 静态展示范围）：
 * 晨话一句静态文案（照抄 v1.0 白话原语引擎示例句）＋标注「上线后由 AI 销售操盘手按你的真实数据每日生成」；
 * 早报样卡 ≤150 字，可展开查看，零计算、带示例角标。
 * 这同时演示了回退层：AI 挂了，系统一字不缺。
 */
export default function MorningTalk() {
  const [showReport, setShowReport] = useState(false);
  return (
    <section className="rounded-xl bg-gray-900 p-3 text-white">
      <div className="flex items-start gap-2">
        <span className="text-lg">🎙️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-relaxed">「{MORNING_TALK}」</p>
          <p className="mt-1 text-[11px] text-gray-400">{MORNING_TALK_NOTE}</p>
        </div>
      </div>
      <button
        onClick={() => setShowReport((v) => !v)}
        className="mt-2 w-full rounded-lg bg-white/10 py-1.5 text-xs font-semibold text-gray-200"
      >
        {showReport ? '收起早报样卡 ▲' : '📮 查看今晨早报样卡 ▼'}
      </button>
      {showReport && (
        <div className="mt-2 rounded-lg bg-white p-3 text-gray-900">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-bold">销售早报 · 早 8:00 推送</span>
            <SampleTag />
          </div>
          <p className="text-xs leading-relaxed">{MORNING_REPORT_SAMPLE}</p>
        </div>
      )}
    </section>
  );
}
