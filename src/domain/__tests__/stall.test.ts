/**
 * 停滞三级 · 对拍 v1.0 §8【盲审改正示例·通用列】：
 * 线索阈值 15 天 → 关注 15–22、预警 23–37、濒死 38+；签约未回款阈值 7 天 → 濒死 18 天起。
 * 停留天数＝当日−进入当前状态事件日（进入当日记 0，左闭）；倍数 1.5/2.5 为系统常量。
 */
import { describe, expect, it } from 'vitest';
import { GENERAL_STALL_THRESHOLDS, sortStallItems, stallDays, stallLevel, type StallItem } from '../stall';

describe('通用列阈值（§8.3.1 唯一推荐源）', () => {
  it('线索 15 / 意向 30 / 样品 20 / 签约未回款 7', () => {
    expect(GENERAL_STALL_THRESHOLDS).toEqual({ lead: 15, intent: 30, sample: 20, signed: 7 });
  });
});

describe('停留天数（自然日，进入当日记 0）', () => {
  it('进入当日＝0；次日＝1', () => {
    expect(stallDays('2026-06-29', '2026-06-29')).toBe(0);
    expect(stallDays('2026-06-28', '2026-06-29')).toBe(1);
  });
});

describe('三级判定（左闭；盲审改正示例·线索阈值 15）', () => {
  const t = 15;
  it('14 天未触发；15–22 关注；23–37 预警；38+ 濒死', () => {
    expect(stallLevel(14, t)).toBeNull();
    expect(stallLevel(15, t)).toBe('watch'); // 左闭：达到阈值当日即触发
    expect(stallLevel(22, t)).toBe('watch');
    expect(stallLevel(23, t)).toBe('warn');
    expect(stallLevel(37, t)).toBe('warn');
    expect(stallLevel(38, t)).toBe('dying');
  });

  it('签约未回款阈值 7 → 濒死＝18 天起（示例）', () => {
    expect(stallLevel(17, 7)).toBe('warn');
    expect(stallLevel(18, 7)).toBe('dying');
  });
});

describe('列表排序（§8.5.1 等级红→橙→黄 → ABCD → 停留天数倒序）', () => {
  it('排序键逐级生效', () => {
    const items: StallItem[] = [
      { customerId: 'c-yellow', ownerId: 'o', stage: 'lead', days: 16, level: 'watch' },
      { customerId: 'c-red-B-40', ownerId: 'o', stage: 'lead', days: 40, level: 'dying' },
      { customerId: 'c-red-A-38', ownerId: 'o', stage: 'lead', days: 38, level: 'dying' },
      { customerId: 'c-red-B-50', ownerId: 'o', stage: 'lead', days: 50, level: 'dying' },
      { customerId: 'c-orange', ownerId: 'o', stage: 'signed', days: 12, level: 'warn' },
    ];
    const abcd = (id: string): 'A' | 'B' | 'C' | 'D' => (id.includes('-A-') ? 'A' : id.includes('-B-') ? 'B' : 'C');
    expect(sortStallItems(items, abcd).map((x) => x.customerId)).toEqual([
      'c-red-A-38', // 红且 A 置顶
      'c-red-B-50', // 红 B，天数倒序
      'c-red-B-40',
      'c-orange',
      'c-yellow',
    ]);
  });
});
