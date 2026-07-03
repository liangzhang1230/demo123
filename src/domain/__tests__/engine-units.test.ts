/**
 * 引擎单元边界 · 转化率兜底（§6.3/§6.10）、人力成本逐日模型（§8.1）、
 * labor_roi 先汇总再算（§6.6 辛普森悖论防线）、环比基数异常（§6.5）、展示精度（§6.10）。
 */
import { describe, expect, it } from 'vitest';
import type { Person } from '../types';
import { conversionRates, ratio } from '../conversion';
import { emptyTally } from '../facts';
import { cumLaborCost, dayCost, groupLaborRoi, laborCostRange, laborRoi, monthLaborCost } from '../laborCost';
import { momMonthPair, momRate } from '../mom';
import { DASH, fmtAmount, fmtPct, fmtRoi } from '../format';

describe('转化率兜底（分母 0 显 —）', () => {
  it('空周期四环节转化率与成交率全为 null', () => {
    const c = conversionRates(emptyTally());
    expect(c).toEqual({ lead_conv: null, intent_conv: null, sample_conv: null, signed_conv: null, close_rate: null });
  });

  it('ratio：分母 0/负 → null；正常相除', () => {
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(5, -1)).toBeNull();
    expect(ratio(9, 82)).toBeCloseTo(9 / 82, 12);
  });
});

describe('人力成本逐日累计（§8.1）', () => {
  const p: Person = { id: 'x', name: 'X', role: 'sales', deptId: 'd1', monthlyCost: 6200, hireDate: '2026-05-23', onboardingCost: 3000 };
  const open = '2026-04-01';

  it('月固定项日摊＝月额÷当月自然天数；入职前不计提', () => {
    expect(dayCost(p, open, '2026-05-22')).toBe(0);
    expect(dayCost(p, open, '2026-05-24')).toBeCloseTo(6200 / 31, 10);
    expect(dayCost(p, open, '2026-06-01')).toBeCloseTo(6200 / 30, 10);
  });

  it('招培一次性仅入职当日计入一次', () => {
    expect(dayCost(p, open, '2026-05-23')).toBeCloseTo(6200 / 31 + 3000, 10);
    // 5-23 → 6-29：5 月 9 天日摊 ＋ 6 月 29 天日摊 ＋ 招培 3000
    const expected = (6200 / 31) * 9 + (6200 / 30) * 29 + 3000;
    expect(cumLaborCost(p, open, '2026-06-29')).toBeCloseTo(expected, 8);
    // 拆两段求和＝整段（招培只入含入职日的那段）
    const a = laborCostRange(p, open, '2026-04-01', '2026-05-31');
    const b = laborCostRange(p, open, '2026-06-01', '2026-06-29');
    expect(a + b).toBeCloseTo(expected, 8);
  });

  it('老员工（hireDate=null）自开通日起算、无招培', () => {
    const old: Person = { ...p, hireDate: null, onboardingCost: 0, monthlyCost: 8900 };
    expect(cumLaborCost(old, open, '2026-04-30')).toBeCloseTo(8900, 8);
    expect(monthLaborCost(old, open, '2026-06', '2026-06-29')).toBeCloseTo((8900 / 30) * 29, 8);
  });
});

describe('labor_roi（先汇总再算，严禁平均个人比值）', () => {
  it('成本 0 → null（—未设成本）', () => {
    expect(laborRoi(1000, 0)).toBeNull();
  });

  it('团队 roi＝Σ净利÷Σ成本，与个人 roi 平均值不同（辛普森悖论防线）', () => {
    const parts = [
      { grossProfit: 300, cost: 100 }, // 个人 roi 2.0
      { grossProfit: 1100, cost: 1000 }, // 个人 roi 0.1
    ];
    const team = groupLaborRoi(parts)!; // (1400-1100)/1100 ≈ 0.2727
    expect(team).toBeCloseTo(300 / 1100, 10);
    const avgOfRoi = (2.0 + 0.1) / 2; // 1.05——错误口径
    expect(Math.abs(team - avgOfRoi)).toBeGreaterThan(0.5);
  });
});

describe('环比（§6.5）', () => {
  it('上期 0 或负 → null（上期无基数显 —）', () => {
    expect(momRate(100, 0)).toBeNull();
    expect(momRate(100, -50)).toBeNull();
    expect(momRate(100, null)).toBeNull();
  });

  it('残缺周期不计算：开通当月不足整月/进行中当月不参与', () => {
    expect(momMonthPair('2026-04-15', '2026-06-29')).toBeNull(); // 4 月残缺 → 5 月无完整上期
    expect(momMonthPair('2026-04-01', '2026-05-15')).toBeNull(); // 5 月进行中，4 月无上期
    expect(momMonthPair('2026-04-01', '2026-06-30')).toEqual({ cur: '2026-06', prev: '2026-05' });
  });
});

describe('展示精度（§6.10：金额 2 位、比率 1 位百分比、labor_roi 2 位；null 显 —）', () => {
  it('显示才舍入', () => {
    expect(fmtPct(9 / 82)).toBe('11.0%');
    expect(fmtRoi(1.5249)).toBe('1.52');
    expect(fmtAmount(6800)).toBe('¥6,800.00');
    expect(fmtPct(null)).toBe(DASH);
    expect(fmtRoi(null)).toBe(DASH);
    expect(fmtAmount(null)).toBe(DASH);
  });
});
