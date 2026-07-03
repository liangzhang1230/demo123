/**
 * P2 验收 · 对种子事件流跑口径引擎，逐项对拍《演示版施工包 · 第二件 · 3》关键数。
 * 全部数值由 buildFacts 折算事件流得出——引擎与 P1 fold.ts 为两套独立实现，互为对拍。
 */
import { describe, expect, it } from 'vitest';
import { generateSeed } from '../../seed/generator';
import { foldEvents } from '../engine';
import {
  buildFacts,
  stocksOf,
  tallyOf,
  conversionRates,
  poolConv,
  processQuantities,
  avgOrderValue,
  cumLaborCost,
  laborRoi,
  groupLaborRoi,
  absRate,
  paceRate,
  gradeOf,
  rankMap,
  stallOverview,
  momMonthPair,
  momRate,
  fmtPct,
  fmtRoi,
  fmtAmount,
} from '../index';

const seed = generateSeed();
const facts = buildFacts(seed.events, seed.categories, seed.anchorDate);
const salesIds = seed.people.filter((p) => p.role !== 'boss').map((p) => p.id);
const allCum = tallyOf(facts, salesIds, 'cum');

describe('期末存量分布（500 家口径 · 六池）', () => {
  it('线索 210 / 意向 96 / 样品 73 / 签约未回款 42 / 成交 214 / 流失 92', () => {
    expect(stocksOf(facts)).toEqual({ lead: 210, intent: 96, sample: 73, signed: 42, deal: 214, lost: 92 });
  });

  it('漏斗守恒：逐池 新增 − 转出 − 流失 ＝ 存量', () => {
    const stocks = stocksOf(facts);
    for (const pool of ['lead', 'intent', 'sample', 'signed'] as const) {
      expect(allCum.entered[pool] - allCum.exited[pool] - allCum.lost[pool]).toBe(stocks[pool]);
    }
  });
});

describe('本月关键数（2026-06，锚点 06-29）', () => {
  const jun = tallyOf(facts, salesIds, '2026-06');
  const may = tallyOf(facts, salesIds, '2026-05');

  it('样品池本月进入 82、转出 9', () => {
    expect(jun.entered.sample).toBe(82);
    expect(jun.exited.sample).toBe(9);
  });

  it('样品转化率本月 11.0%、上月 27.0%（比率 1 位小数显示口径）', () => {
    expect(fmtPct(poolConv(jun, 'sample'))).toBe('11.0%');
    expect(fmtPct(poolConv(may, 'sample'))).toBe('27.0%');
  });

  it('月回款 ¥61.2 万', () => {
    expect(jun.revenue).toBe(612_000);
  });

  it('累计回款 ¥1,455,200；成交总客户数 214；平均客单 ¥6,800（÷214 闭合）', () => {
    expect(allCum.revenue).toBe(1_455_200);
    expect(processQuantities(allCum).total_deal_cnt).toBe(214);
    expect(avgOrderValue(allCum)).toBe(6800);
    expect(fmtAmount(avgOrderValue(allCum))).toBe('¥6,800.00');
  });

  it('复购 27 客户 / 32 单；直成交单列 32 笔（线索直接→成交）', () => {
    const pq = processQuantities(allCum);
    expect(pq.repeat_cust_cnt).toBe(27);
    expect(pq.repeat_order_cnt).toBe(32);
    expect(pq.direct_deal_cnt).toBe(32);
  });
});

describe('labor_roi（§6.4/§6.6：先汇总再算）', () => {
  const parts = seed.people.map((p) => ({
    grossProfit: facts.byOwner[p.id]?.cum.grossProfit ?? 0,
    cost: cumLaborCost(p, seed.openDate, seed.anchorDate),
  }));

  it('团队 labor_roi ＝ 1.52（Σ净利÷Σ成本，2 位小数显示口径）', () => {
    expect(fmtRoi(groupLaborRoi(parts))).toBe('1.52');
  });

  it('王丽 labor_roi ＝ 2.10（销冠钩子）', () => {
    const wl = seed.people.find((p) => p.id === 'wangli')!;
    const roi = laborRoi(facts.byOwner.wangli.cum.grossProfit, cumLaborCost(wl, seed.openDate, seed.anchorDate));
    expect(fmtRoi(roi)).toBe('2.10');
  });

  it('成本为 0（陈总）→ null 显 —、不参与排名', () => {
    expect(laborRoi(facts.byOwner.chenzong?.cum.grossProfit ?? 0, 0)).toBeNull();
  });

  it('引擎 vs P1 fold 双实现对拍（团队 labor_roi 全精度一致）', () => {
    const folded = foldEvents(seed.events, seed.people, seed.categories, seed.anchorDate, seed.openDate);
    expect(groupLaborRoi(parts)).toBeCloseTo(folded.teamLaborRoi!, 10);
    expect(allCum.revenue).toBe(folded.cumRevenue);
    expect(allCum.grossProfit).toBeCloseTo(folded.cumGrossProfit, 6);
  });
});

describe('排名（全精度、并列跳号；全员/部门两类）', () => {
  const revenueInputs = salesIds.map((id) => ({ id, value: facts.byOwner[id]?.cum.revenue ?? 0 }));

  it('王丽累计回款全员总排名第 1', () => {
    expect(rankMap(revenueInputs).wangli).toBe(1);
  });

  it('赵敏线索量全员第 2（量大质弱钩子）', () => {
    const leadInputs = salesIds.map((id) => ({ id, value: facts.byOwner[id]?.cum.entered.lead ?? 0 }));
    expect(rankMap(leadInputs).zhaomin).toBe(2);
  });

  it('部门排名＝同一函数按部门名单裁剪（王丽一部第 1、赵敏二部前 2）', () => {
    const d1 = seed.people.filter((p) => p.deptId === 'd1').map((p) => p.id);
    const d2 = seed.people.filter((p) => p.deptId === 'd2').map((p) => p.id);
    const d1Rank = rankMap(d1.map((id) => ({ id, value: facts.byOwner[id]?.cum.revenue ?? 0 })));
    expect(d1Rank.wangli).toBe(1);
    const d2Lead = rankMap(d2.map((id) => ({ id, value: facts.byOwner[id]?.cum.entered.lead ?? 0 })));
    expect(d2Lead.zhaomin).toBe(1);
  });
});

describe('目标与七级（月度回款目标 ¥55 万 → 合格档）', () => {
  it('公司 6 月 abs_rate 与 pace_rate 均落合格档 [100%,120%)', () => {
    const jun = tallyOf(facts, salesIds, '2026-06');
    const target = seed.targets.companyMonthlyRevenue; // 550,000
    const abs = absRate(jun.revenue, target)!;
    const pace = paceRate(jun.revenue, target, 29, 30)!; // 锚点 06-29：已过 29 天/30 天
    expect(gradeOf(abs)!.code).toBe('pass');
    expect(gradeOf(pace)!.code).toBe('pass');
  });

  it('比率类（labor_roi/转化率）pace_rate 恒为 null 显 —（盲审定案：不拆日）', () => {
    expect(paceRate(1.52, 1.2, 29, 30, 'labor_roi')).toBeNull();
    expect(paceRate(0.11, 0.2, 29, 30, 'sample_conv')).toBeNull();
  });
});

describe('停滞与人物钩子', () => {
  it('王五末次业务事件日 2026-05-13（连续 47 天零业务事件）', () => {
    expect(facts.lastEventDate.wangwu).toBe('2026-05-13');
  });

  it('在管客户数＝四池存量之和 421；停滞清单只含受监控四态', () => {
    const ov = stallOverview(facts);
    expect(ov.managedTotal).toBe(210 + 96 + 73 + 42);
    expect(ov.stalledTotal).toBeGreaterThan(0);
    expect(ov.stalledShare).toBeCloseTo(ov.stalledTotal / ov.managedTotal, 10);
  });
});

describe('环比（§6.5 完整月）', () => {
  it('锚点 06-29：环比月对＝2026-05 vs 2026-04（6 月残缺不参与）', () => {
    expect(momMonthPair(seed.openDate, seed.anchorDate)).toEqual({ cur: '2026-05', prev: '2026-04' });
  });

  it('5 月回款环比＝(5 月−4 月)÷4 月（由事件流折算）', () => {
    const may = tallyOf(facts, salesIds, '2026-05');
    const apr = tallyOf(facts, salesIds, '2026-04');
    const rate = momRate(may.revenue, apr.revenue);
    expect(rate).toBeCloseTo((may.revenue - apr.revenue) / apr.revenue, 10);
    expect(apr.revenue).toBeGreaterThan(0);
  });
});
