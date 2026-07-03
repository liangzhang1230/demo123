/**
 * 排名引擎 · 对拍 v1.0 §6.10「排名比较用全精度，显示才舍入；全精度仍相等则并列跳号（1、1、3），
 * 次序按事件发生时间早者前」＋ §6.4「成本为 0 → — 不参与排名」。
 */
import { describe, expect, it } from 'vitest';
import { rankDesc, rankMap } from '../rank';

describe('并列跳号', () => {
  it('1、1、3：全精度相等并列，下一名跳号', () => {
    const m = rankMap([
      { id: 'a', value: 100 },
      { id: 'b', value: 100 },
      { id: 'c', value: 90 },
    ]);
    expect([m.a, m.b, m.c]).toEqual([1, 1, 3]);
  });

  it('三人并列 → 1、1、1、4', () => {
    const m = rankMap([
      { id: 'a', value: 5 },
      { id: 'b', value: 5 },
      { id: 'c', value: 5 },
      { id: 'd', value: 1 },
    ]);
    expect([m.a, m.b, m.c, m.d]).toEqual([1, 1, 1, 4]);
  });
});

describe('全精度比较（显示才舍入）', () => {
  it('显示同为 33.3% 的 1/3 与 0.333 不并列', () => {
    const m = rankMap([
      { id: 'x', value: 1 / 3 },
      { id: 'y', value: 0.333 },
    ]);
    expect(m.x).toBe(1);
    expect(m.y).toBe(2);
  });
});

describe('并列展示次序＝事件发生时间早者前', () => {
  it('同值时 tieAt 早者排前，名次相同', () => {
    const r = rankDesc([
      { id: 'late', value: 100, tieAt: '2026-06-20T10:00' },
      { id: 'early', value: 100, tieAt: '2026-06-01T09:00' },
    ]);
    expect(r.map((x) => x.id)).toEqual(['early', 'late']);
    expect(r.map((x) => x.rank)).toEqual([1, 1]);
  });
});

describe('null 不参与排名', () => {
  it('未设成本的 labor_roi（null）名次为 null、排末尾，不占名次号', () => {
    const r = rankDesc([
      { id: 'a', value: 2.1 },
      { id: 'noCost', value: null },
      { id: 'b', value: 1.1 },
    ]);
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'noCost']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, null]);
  });
});
