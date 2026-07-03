/**
 * 区一 · 今日一件事 仲裁器（看板章 §3）：
 * 两层固定序列，自上而下首次命中即停——零新增判定，只对各源既有信号排序。
 *  待办层（恒优先）：① 新人筛选窗口满待裁 → ② 合并队列临近 48h SLA → ③ 改单/定版后修改审批 → ④ 昨日未确认异常聚集
 *  诊断层（待办清空后）：⑤ 包①置顶卡 → ⑥ 包②置顶卡 → ⑦ 停滞红色积压显著 → ⑧ 包③依赖度红档 → ⑨ 包④月度置顶卡
 *  全空 → 兜底语「今天没有火，去看看钱」
 * 未购包/无信号的源不产候选（源关 → 该格随之隐藏，死线①）；看板自身不出 action_card。
 */

export type ArbiterSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ArbiterCandidate {
  slot: ArbiterSlot;
  layer: 'todo' | 'diagnosis';
  title: string;
  detail: string;
  /** 一键直达源模块动作位（页内锚点/路由） */
  href?: string;
}

export interface ArbiterResult {
  top: ArbiterCandidate | null;
  rest: ArbiterCandidate[];
  fallback: string;
}

export const ARBITER_FALLBACK = '今天没有火，去看看钱';

export function arbitrate(candidates: ArbiterCandidate[]): ArbiterResult {
  const sorted = [...candidates].sort((a, b) => a.slot - b.slot);
  return {
    top: sorted[0] ?? null,
    rest: sorted.slice(1),
    fallback: ARBITER_FALLBACK,
  };
}
