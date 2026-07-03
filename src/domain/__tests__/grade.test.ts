/**
 * 七级判定与达标率边界 · 对拍 v1.0 §6.7/§6.8（左闭右开、自上而下首次命中即停）＋目标分解引擎。
 */
import { describe, expect, it } from 'vitest';
import { absRate, dailyTarget, gradeOf, isRatioMetric, paceRate, proratedMonthlyTarget } from '../grade';

describe('七级区间（左闭右开，R2-04 默认参数）', () => {
  const cases: [number, string][] = [
    [2.0, 'leading'], // ≥200% 紫（左闭）
    [2.5, 'leading'],
    [1.9999, 'excellent'], // [150%,200%)
    [1.5, 'excellent'],
    [1.4999, 'good'], // [120%,150%)
    [1.2, 'good'],
    [1.1999, 'pass'], // [100%,120%)
    [1.0, 'pass'],
    [0.9999, 'yellow'], // [80%,100%)：黄警上界恒＝基数 1.0
    [0.8, 'yellow'],
    [0.7999, 'orange'], // [60%,80%)
    [0.6, 'orange'],
    [0.5999, 'red'], // [0,60%)
    [0, 'red'],
  ];
  it.each(cases)('达标率 %f → %s', (rate, code) => {
    expect(gradeOf(rate)!.code).toBe(code);
  });

  it('负达标率（净利类实际为负）归红色预警，永不显示怪值', () => {
    expect(gradeOf(-0.3)!.code).toBe('red');
  });

  it('null（目标未设/分母 0）不参与等级判定', () => {
    expect(gradeOf(null)).toBeNull();
    expect(gradeOf(Number.NaN)).toBeNull();
  });
});

describe('abs_rate 与 pace_rate（§6.7）', () => {
  it('abs_rate＝实际÷目标；目标 0 或未设 → null 显 —', () => {
    expect(absRate(120, 100)).toBe(1.2);
    expect(absRate(120, 0)).toBeNull();
    expect(absRate(120, null)).toBeNull();
  });

  it('pace_rate＝实际÷(目标×已过天数/周期总天数)', () => {
    // 目标 300、总 30 天、已过 10 天 → 应完成 100；实际 120 → 120%
    expect(paceRate(120, 300, 10, 30)).toBeCloseTo(1.2, 10);
  });

  it('比率类目标不拆日、不计算 pace_rate（盲审定案，返回 null 显 —）', () => {
    for (const code of ['lead_conv', 'intent_conv', 'sample_conv', 'signed_conv', 'close_rate', 'labor_roi']) {
      expect(isRatioMetric(code)).toBe(true);
      expect(paceRate(1, 1, 15, 30, code)).toBeNull();
    }
    expect(isRatioMetric('revenue')).toBe(false);
    expect(paceRate(100, 100, 15, 30, 'revenue')).toBe(2);
  });

  it('目标未设/已过天数 0 → pace_rate null', () => {
    expect(paceRate(100, null, 10, 30)).toBeNull();
    expect(paceRate(100, 300, 0, 30)).toBeNull();
  });
});

describe('目标分解（唯一单日口径＋人员折算 §6.7.1）', () => {
  it('单日目标恒＝当月月度目标÷当月自然天数', () => {
    expect(dailyTarget(300, '2026-06')).toBe(10); // 6 月 30 天
    expect(dailyTarget(310, '2026-05')).toBe(10); // 5 月 31 天
    expect(dailyTarget(290, '2026-02')).toBe(10.357142857142858); // 平年 2 月 28 天，全精度
  });

  it('比率类不拆单日目标 → null', () => {
    expect(dailyTarget(1.2, '2026-06', 'labor_roi')).toBeNull();
  });

  it('中途入职折算：李强 2026-05-23 入职，5 月目标＝月目标÷31×9 天（入职当天计入考核）', () => {
    expect(proratedMonthlyTarget(30_000, '2026-05', '2026-05-23')).toBeCloseTo((30_000 / 31) * 9, 10);
    // 入职整月在岗 → 不折算
    expect(proratedMonthlyTarget(30_000, '2026-06', '2026-05-23')).toBe(30_000);
    // 入职晚于该月 → 周期内无在职天数，不生成目标
    expect(proratedMonthlyTarget(30_000, '2026-04', '2026-05-23')).toBeNull();
  });
});
