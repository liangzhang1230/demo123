/**
 * 排名 · 唯一事实源＝v1.0 §6.10 / §6.11
 *  - 排名比较用全精度（显示才舍入）
 *  - 并列：全精度仍相等则并列跳号（1、1、3），次序按事件发生时间早者前
 */

export interface RankInput {
  id: string;
  value: number;
  /** 达到当前值的事件发生时间（并列时早者前）；缺省排后 */
  tieTime?: string;
}

export interface Ranked extends RankInput {
  rank: number;
}

export function rankWithSkippedTies(inputs: RankInput[]): Ranked[] {
  const sorted = [...inputs].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value; // 全精度比较
    return (a.tieTime ?? '9999') < (b.tieTime ?? '9999') ? -1 : 1; // 并列按事件时间早者前
  });
  const out: Ranked[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const rank = i > 0 && sorted[i].value === out[i - 1].value ? out[i - 1].rank : i + 1; // 并列跳号
    out.push({ ...sorted[i], rank });
  }
  return out;
}

export function rankOf(ranked: Ranked[], id: string): number | null {
  return ranked.find((r) => r.id === id)?.rank ?? null;
}
