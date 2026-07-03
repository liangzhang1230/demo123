/**
 * 排名引擎 · 口径来源＝v1.0 §6.10/§6.11
 *  - 排名比较用全精度（显示才舍入）；
 *  - 排名并列：全精度仍相等则并列跳号（1、1、3），次序按事件发生时间早者前；
 *  - 值为 null（如成本为 0 的 labor_roi「—（未设成本）」）不参与排名，排在末尾、名次为 null；
 *  - 个人排名分两类：本租户内全员总排名、所属部门内部排名——同一函数按传入名单裁剪即得。
 */

export interface RankInput {
  id: string;
  /** 全精度指标值；null＝不参与排名 */
  value: number | null;
  /** 并列时的展示次序键（事件发生时间，早者前）；缺省按 id 稳定排序 */
  tieAt?: string;
}

export interface Ranked extends RankInput {
  /** 并列跳号名次；不参与排名者为 null */
  rank: number | null;
}

/** 降序排名（业绩类指标通用）。返回按展示次序排好的数组。 */
export function rankDesc(inputs: readonly RankInput[]): Ranked[] {
  const ranked = inputs
    .filter((x) => x.value != null && Number.isFinite(x.value))
    .sort((a, b) => {
      if (a.value! !== b.value!) return b.value! - a.value!; // 全精度比较
      const ta = a.tieAt ?? '';
      const tb = b.tieAt ?? '';
      if (ta !== tb) return ta < tb ? -1 : 1; // 并列次序：事件发生时间早者前
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((x, i, arr) => {
      // 并列跳号：与前一名全精度相等 → 沿用其名次；否则名次＝下标+1（1、1、3）
      const rank = i > 0 && arr[i - 1].value === x.value ? undefined : i + 1;
      return { ...x, rank: rank ?? 0 };
    });
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].rank === 0) ranked[i].rank = ranked[i - 1].rank;
  }
  const excluded: Ranked[] = inputs
    .filter((x) => x.value == null || !Number.isFinite(x.value as number))
    .map((x) => ({ ...x, value: null, rank: null }));
  return [...ranked, ...excluded];
}

/** id → 名次 速查表（null＝不参与排名） */
export function rankMap(inputs: readonly RankInput[]): Record<string, number | null> {
  return Object.fromEntries(rankDesc(inputs).map((x) => [x.id, x.rank]));
}
