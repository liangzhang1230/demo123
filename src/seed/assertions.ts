/**
 * P1 验收断言：全部从事件流折算后对拍《第二件·3》，不读任何预写汇总。
 * 关键数：82 / 9 / 11.0%（上月 27.0%）/ ¥6,800 / ¥61.2万 / 1.52 ＋ 逐池守恒 ＋ 人物钩子。
 */
import type { SeedData, Stage } from '../domain/types';
import { ALLOWED_TRANSITIONS, LOSS_REASONS } from '../domain/types';
import { foldEvents, type Folded } from './fold';
import { computeAll } from '../domain/compute';

export interface CheckResult {
  group: string;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

/** 比率显示口径：1 位小数百分比（显示才舍入） */
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const roi2 = (x: number) => x.toFixed(2);
const yuan = (x: number) => `¥${x.toLocaleString('zh-CN')}`;

export function runSeedChecks(data: SeedData): { results: CheckResult[]; folded: Folded } {
  const results: CheckResult[] = [];
  const ok = (group: string, name: string, expected: string, actual: string, pass: boolean) =>
    results.push({ group, name, expected, actual, pass });
  const eq = (group: string, name: string, expected: number | string, actual: number | string) =>
    ok(group, name, String(expected), String(actual), String(expected) === String(actual));

  const folded = foldEvents(data.events, data.people, data.categories, data.anchorDate, data.openDate);

  // ---- 1. 漏斗守恒（逐池：新增 − 转出 − 流失 ＝ 存量） ----
  for (const pool of ['lead', 'intent', 'sample', 'signed'] as const) {
    const f = folded.poolFlow[pool];
    eq('漏斗守恒', `${pool} 池平衡`, folded.stocks[pool], f.entered - f.exited - f.lost);
  }
  eq('漏斗守恒', '成交池（进入＝存量，无出口）', folded.stocks.deal, folded.poolFlow.deal.entered);
  eq('漏斗守恒', '流失池（Σ各池流失＝存量）', folded.stocks.lost, folded.poolFlow.lostTotal);

  // ---- 2. 期末存量分布（第二件·3） ----
  const expectStocks: Record<string, number> = { lead: 210, intent: 96, sample: 73, signed: 42, deal: 214, lost: 92 };
  for (const [pool, n] of Object.entries(expectStocks)) {
    eq('期末存量', `${pool} 存量`, n, folded.stocks[pool as Stage]);
  }
  eq('期末存量', '客户总数（＝Σ六池）', 727, data.customers.length);

  // ---- 3. 本月关键数 ----
  const jun = folded.monthlyPoolFlow['2026-06'];
  const may = folded.monthlyPoolFlow['2026-05'];
  eq('本月关键数', '样品池本月进入', 82, jun.sample.entered);
  eq('本月关键数', '样品池本月转出', 9, jun.sample.exited);
  eq('本月关键数', '样品→签约 本月转化（显示口径）', '11.0%', pct1(jun.sample.exited / jun.sample.entered));
  eq('本月关键数', '样品→签约 上月转化（显示口径）', '27.0%', pct1(may.sample.exited / may.sample.entered));
  eq('本月关键数', '月回款（6 月）', yuan(612000), yuan(folded.revenueByMonth['2026-06'] ?? 0));
  eq('本月关键数', '累计回款（÷214 须闭合客单）', yuan(1455200), yuan(folded.cumRevenue));
  eq('本月关键数', '成交总客户数 total_deal_cnt', 214, folded.totalDealCnt);
  eq('本月关键数', '平均客单 aov（累计回款÷214）', '¥6800.00', `¥${(folded.cumRevenue / folded.totalDealCnt).toFixed(2)}`);
  eq('本月关键数', '团队 labor_roi（先汇总再算，2 位）', '1.52', roi2(folded.teamLaborRoi ?? NaN));

  // ---- 4. 人物钩子 ----
  const wangwu = folded.perOwner['wangwu'];
  ok('人物钩子', '王五末次业务事件日', '2026-05-13', wangwu?.lastEventDate ?? '无', wangwu?.lastEventDate === '2026-05-13');
  // 零业务事件天数＝末次事件次日起至今日（5-14…6-29 共 47 天）
  const idleDays =
    (Date.parse(data.anchorDate) - Date.parse(wangwu?.lastEventDate ?? data.anchorDate)) / 86400000;
  eq('人物钩子', '王五连续零业务事件天数（含今日）', 47, idleDays);
  eq('人物钩子', '王五成交单数', 0, folded.perOwner['wangwu']?.firstDeals ?? 0);
  const liqiang = data.people.find((p) => p.id === 'liqiang')!;
  const hireDays = (Date.parse(data.anchorDate) - Date.parse(liqiang.hireDate!)) / 86400000 + 1;
  eq('人物钩子', '李强入职天数（含今日）', 38, hireDays);
  const liqiangFirstEvent = data.events.find((e) => e.ownerId === 'liqiang')?.date ?? '无';
  ok('人物钩子', '李强事件不早于入职日', `≥${liqiang.hireDate}`, liqiangFirstEvent, liqiangFirstEvent >= liqiang.hireDate!);
  const roiWL = folded.perOwnerRoi['wangli'];
  eq('人物钩子', '王丽 labor_roi（2 位）', '2.10', roi2(roiWL ?? NaN));
  const maxRevenue = Math.max(...data.people.filter((p) => p.role !== 'boss').map((p) => folded.perOwner[p.id]?.revenue ?? 0));
  ok('人物钩子', '王丽累计回款全员第 1', '最大', yuan(folded.perOwner['wangli']?.revenue ?? 0),
    (folded.perOwner['wangli']?.revenue ?? 0) === maxRevenue && maxRevenue > 0);
  // 样品→签约通过率（累计制：转出÷进入，样本 ≥5）
  const convOf = (id: string) => {
    const o = folded.perOwner[id];
    return o && o.sampleIn >= 5 ? o.sampleOut / o.sampleIn : null;
  };
  const wlConv = convOf('wangli');
  const allConv = data.people
    .filter((p) => p.role !== 'boss' && p.id !== 'wangli')
    .map((p) => convOf(p.id))
    .filter((x): x is number => x != null);
  ok('人物钩子', '王丽样品→签约通过率最高', '全员最高', wlConv == null ? '样本不足' : pct1(wlConv),
    wlConv != null && allConv.every((x) => x < wlConv));
  const zmConv = convOf('zhaomin');
  ok('人物钩子', '赵敏样品→签约≈9%（量大质弱）', '≤12%', zmConv == null ? '样本不足' : pct1(zmConv), zmConv != null && zmConv <= 0.12);
  const leadRank = data.people
    .filter((p) => p.role !== 'boss')
    .map((p) => ({ id: p.id, leads: folded.perOwner[p.id]?.leads ?? 0 }))
    .sort((a, b) => b.leads - a.leads);
  eq('人物钩子', '赵敏线索量全员第 2', 'zhaomin', leadRank[1]?.id ?? '无');

  // ---- 5. 复购与流失 ----
  eq('复购流失', '复购客户数（成交 214 含复购 27）', 27, folded.repeatCustCnt);
  eq('复购流失', '流失总数', 92, folded.stocks.lost);
  eq('复购流失', '本月流失（6 月）', 42, folded.monthlyLossTotal['2026-06'] ?? 0);
  eq('复购流失', '本月首要流失因＝价格偏高', 18, folded.lossReasonByMonth['2026-06']?.['价格偏高'] ?? 0);

  // ---- 5b. 停滞分布收敛（P8 调优目标：有火可救、不满屏着火；口径引擎零改动） ----
  {
    const call = computeAll(data);
    const st = call.company.stallTotal;
    const inRange = (name: string, v: number, lo: number, hi: number) =>
      ok('停滞分布', name, `[${lo}, ${hi}]`, String(v), v >= lo && v <= hi);
    inRange('濒死（红）6-10 家', st.dying, 6, 10);
    inRange('预警（橙）20-30 家', st.warning, 20, 30);
    inRange('关注（黄）40-60 家', st.watch, 40, 60);
    const wangwuStall = call.owners['wangwu']?.stall ?? { dying: 0, warning: 0, watch: 0 };
    ok('停滞分布', '王五名下濒死 ≥5（47 天钩子主载体）', '≥5', String(wangwuStall.dying), wangwuStall.dying >= 5);
    ok('停滞分布', '王五名下预警 ≥8（老化意向池）', '≥8', String(wangwuStall.warning), wangwuStall.warning >= 8);
  }

  // ---- 5c. P12 新人筛选与筛人漏斗（数据齐全可交互的前提断言） ----
  {
    const c2 = computeAll(data);
    const ten = (id: string) => {
      const p2 = data.people.find((x) => x.id === id)!;
      return (Date.parse(data.anchorDate) - Date.parse(p2.hireDate!)) / 86400000 + 1;
    };
    eq('新人组', '李曼在司第 7 天（优秀）', 7, ten('liman'));
    eq('新人组', '孙悦在司第 10 天（预警）', 10, ten('sunyue'));
    eq('新人组', '周舟在司第 13 天（普通）', 13, ten('zhouzhou'));
    eq('新人组', '陈昊在司第 63 天', 63, ten('chenhao'));
    eq('新人组', '韩雪在司第 81 天', 81, ten('hanxue'));
    const lm = c2.owners['liman'], sy = c2.owners['sunyue'], zz = c2.owners['zhouzhou'];
    ok('新人组', '李曼当日有业务数据（6-29）', '≥2', String(lm.dayProcess.lead + lm.dayProcess.intent), lm.dayProcess.lead + lm.dayProcess.intent >= 2);
    ok('新人组', '李曼累计线索达标（≥0.8×7）', '≥6', String(lm.convBase.leadNew), lm.convBase.leadNew >= 6);
    ok('新人组', '孙悦累计线索落后（<0.8×10 的 60%）', '<5', String(sy.convBase.leadNew), sy.convBase.leadNew < 5);
    eq('新人组', '孙悦当日零动作（第 10 天预警）', 0, sy.dayProcess.lead + sy.dayProcess.intent + sy.dayProcess.sample);
    ok('新人组', '周舟累计线索居中', '8-12', String(zz.convBase.leadNew), zz.convBase.leadNew >= 8 && zz.convBase.leadNew <= 12);
    ok('新人组', '韩雪累计回款 ¥68,000', '68000', String(c2.folded.perOwner['hanxue']?.revenue), c2.folded.perOwner['hanxue']?.revenue === 68000);
    ok('新人组', '陈昊累计回款 ¥54,400', '54400', String(c2.folded.perOwner['chenhao']?.revenue), c2.folded.perOwner['chenhao']?.revenue === 54400);
  }

  // ---- 6. 事件流完整性 ----
  let illegal = 0;
  let lossNoReason = 0;
  let orderBad = 0;
  const lastDate = new Map<string, string>();
  let orderIssues = 0;
  for (const e of data.events) {
    if (e.type === 'stage_changed') {
      if (!ALLOWED_TRANSITIONS[e.from!]?.includes(e.to!)) illegal++;
      if (e.to === 'lost' && !LOSS_REASONS.includes(e.lossReason as any)) lossNoReason++;
    }
    if (e.type === 'order_created' && (!e.amount || e.amount <= 0 || e.amount % 10 !== 0)) orderBad++;
    const prev = lastDate.get(e.customerId);
    if (prev && e.date < prev) orderIssues++;
    lastDate.set(e.customerId, e.date);
  }
  eq('事件流完整性', '非法状态流转数（照抄流转矩阵）', 0, illegal);
  eq('事件流完整性', '流失缺原因数（原因必选）', 0, lossNoReason);
  eq('事件流完整性', '异常金额成交单数', 0, orderBad);
  eq('事件流完整性', '客户事件时间倒流数', 0, orderIssues);
  const phones = new Set(data.customers.map((c) => c.phone));
  eq('事件流完整性', '手机号硬钥匙唯一', data.customers.length, phones.size);

  return { results, folded };
}
