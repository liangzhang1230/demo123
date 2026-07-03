/**
 * npm run domain-check：P2 口径引擎验收。
 * 一半是纯函数边界用例（区间/并列/兜底逐条照抄 v1.0），一半是对种子事件流的关键数对拍（第二件·3）。
 * 全绿 exit 0，任一失败 exit 1。
 */
import { generateSeed } from '../src/seed/generator';
import { convRates, foldEvents, groupLaborRoi, laborCostInMonth, laborCostOf } from '../src/domain/engine';
import {
  absRate, DASH, fmtPct1, fmtRoi2, gradeOf, isCompleteMonth, momRate, paceRate, paceRateForRatio, rankWithTies,
} from '../src/domain/metrics';
import { computeStall, stallLevelOf } from '../src/domain/stall';
import { arbitrate } from '../src/domain/arbiter';

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const N = '\x1b[0m';

let failed = 0;
let count = 0;
let group = '';
function section(name: string) {
  group = name;
  console.log(`\n${B}── ${name} ──${N}`);
}
function eq(name: string, expected: unknown, actual: unknown) {
  count++;
  const pass = String(expected) === String(actual);
  if (!pass) failed++;
  console.log(`  ${pass ? `${G}✓${N}` : `${R}✗${N}`} ${name} ＝ ${pass ? String(actual) : `期望 ${expected}，实得 ${actual}`}`);
}

// ================= 1. 七级考核等级（§6.8 左闭右开、首次命中即停） =================
section('七级判定（左闭右开边界）');
eq('200% → 领先(紫)', '领先', gradeOf(2.0)?.label);
eq('199.99…% → 优秀(蓝)', '优秀', gradeOf(1.9999999)?.label);
eq('150% → 优秀(蓝)', '优秀', gradeOf(1.5)?.label);
eq('120% → 良好(绿)', '良好', gradeOf(1.2)?.label);
eq('100% → 合格(白)', '合格', gradeOf(1.0)?.label);
eq('99.99…% → 黄色预警', '黄色预警', gradeOf(0.9999999)?.label);
eq('80% → 黄色预警', '黄色预警', gradeOf(0.8)?.label);
eq('60% → 橙色预警', '橙色预警', gradeOf(0.6)?.label);
eq('0% → 红色预警', '红色预警', gradeOf(0)?.label);
eq('无目标(null) → 不参与判定', 'null', String(gradeOf(null)));

// ================= 2. 达标率与 pace（§6.7） =================
section('达标率 abs_rate / pace_rate');
eq('abs_rate＝612000÷550000', '111.3%', fmtPct1(absRate(612000, 550000)));
eq('目标 0 → —', DASH, fmtPct1(absRate(100, 0)));
eq('目标未设 → —', DASH, fmtPct1(absRate(100, null)));
// pace：应完成量＝550000×(29÷30)；612000÷531666.67
eq('pace_rate（29/30 天）', '115.1%', fmtPct1(paceRate(612000, 550000, 29, 30)));
eq('pace_rate 目标 0 → —', DASH, fmtPct1(paceRate(100, 0, 29, 30)));
eq('比率类不拆日：pace 恒 —（盲审定案）', DASH, fmtPct1(paceRateForRatio()));

// ================= 3. 环比（§6.5 仅完整自然月；基数≤0 → —） =================
section('环比 momRate');
eq('(612000−378200)÷378200', '61.8%', fmtPct1(momRate(378200, 612000)));
eq('5 月 vs 4 月（回款）', '-18.7%', fmtPct1(momRate(465000, 378200)));
eq('上期 0 → —（上期无基数）', DASH, fmtPct1(momRate(0, 100)));
eq('上期负（净利类）→ —', DASH, fmtPct1(momRate(-5, 100)));
eq('2026-05 在 6-29 时点已完整', 'true', isCompleteMonth('2026-05', '2026-06-29'));
eq('2026-06 在 6-29 时点未完整（残缺不计环比）', 'false', isCompleteMonth('2026-06', '2026-06-29'));

// ================= 4. 排名（§6.10 全精度、并列跳号、时间早者前） =================
section('排名并列跳号');
const ranked = rankWithTies([
  { id: 'a', value: 200, tieAt: '2026-06-02' },
  { id: 'b', value: 100 },
  { id: 'c', value: 200, tieAt: '2026-06-01' },
  { id: 'd', value: 50 },
]);
eq('名次序列＝1、1、3（并列跳号）', '1,1,3,4', ranked.map((r) => r.rank).join(','));
eq('并列时事件早者前（c 先于 a）', 'c,a,b,d', ranked.map((r) => r.id).join(','));
const fullPrec = rankWithTies([
  { id: 'x', value: 0.111_04 },
  { id: 'y', value: 0.111_03 },
]);
eq('全精度比较（显示同为 11.1% 仍分先后）', 'x=1,y=2', fullPrec.map((r) => `${r.id}=${r.rank}`).join(','));

// ================= 5. 停滞三级（§8.2/§8.4 左闭；通用列阈值） =================
section('停滞判定（通用列 15/30/20/7）');
eq('线索 14 天 → 未停滞', 'null', String(stallLevelOf(14, 15)));
eq('线索 15 天 → 关注(黄)（左闭：达到当天即触发）', 'yellow', stallLevelOf(15, 15));
eq('线索 22 天 → 关注(黄)', 'yellow', stallLevelOf(22, 15));
eq('线索 23 天 → 预警(橙)（≥1.5×）', 'orange', stallLevelOf(23, 15));
eq('线索 37 天 → 预警(橙)', 'orange', stallLevelOf(37, 15));
eq('线索 38 天 → 濒死(红)（≥2.5×，示例：38+）', 'red', stallLevelOf(38, 15));
eq('签约未回款 18 天 → 濒死（示例：18 天起）', 'red', stallLevelOf(18, 7));
const stallToy = computeStall(
  [
    { customerId: 'c1', ownerId: 'o1', stage: 'lead', enteredDate: '2026-06-29' }, // 进入当日记 0
    { customerId: 'c2', ownerId: 'o1', stage: 'signed', enteredDate: '2026-06-11' }, // 18 天 → 红
  ],
  '2026-06-29',
);
eq('进入当日记 0 → 不停滞', 0, stallToy.items.filter((i) => i.customerId === 'c1').length);
eq('签约 6-11 至 6-29 停留 18 天 → 红', 'red', stallToy.items.find((i) => i.customerId === 'c2')?.level);

// ================= 6. 兜底显示（§6.10） =================
section('兜底与精度');
eq('labor_roi null → —（未设成本）', `${DASH}（未设成本）`, fmtRoi2(null));
eq('比率 null → —', DASH, fmtPct1(null));
eq('labor_roi 2 位小数（显示才舍入）', '1.52', fmtRoi2(1.5249));

// ================= 7. 仲裁器（看板章 §3 固定序） =================
section('区一仲裁（待办＞诊断、首位即停）');
const arb = arbitrate([
  { slot: 7, layer: 'diagnosis', title: '停滞红色积压', detail: '' },
  { slot: 4, layer: 'todo', title: '昨日未确认', detail: '' },
]);
eq('待办层恒优先（④ 压过 ⑦）', '昨日未确认', arb.top?.title);
eq('其余折叠 1 件', 1, arb.rest.length);
eq('空候选 → 兜底语', '今天没有火，去看看钱', arbitrate([]).fallback);

// ================= 8. 对种子事件流逐项对拍（第二件·3 关键数） =================
section('种子对拍（全部由事件流折算）');
const data = generateSeed();
const f = foldEvents(data.events, data.people, data.categories, data.anchorDate, data.openDate);
eq('样品池本月进入', 82, f.monthlyPoolFlow['2026-06'].sample.entered);
eq('样品池本月转出', 9, f.monthlyPoolFlow['2026-06'].sample.exited);
eq('月回款（6 月）', 612000, f.revenueByMonth['2026-06']);
eq('平均客单（累计÷214）', '6800.00', (f.cumRevenue / f.totalDealCnt).toFixed(2));
eq('团队 labor_roi（先汇总再算）', '1.52', fmtRoi2(f.teamLaborRoi));
eq('王丽 labor_roi', '2.10', fmtRoi2(f.perOwnerRoi['wangli'] ?? null));
eq('本月成交（首购 65＋复购 12）', '65+12', `${f.firstDealsByMonth['2026-06']}+${f.repeatOrdersByMonth['2026-06']}`);
// 四环节转化率（累计制）＝ 各池累计前向转出 ÷ 累计新增（由流转配额可独立验算：如样品 123/250）
const cr = convRates(f.poolFlow);
eq('样品转化率（累计 123÷250）', '49.2%', fmtPct1(cr.sample));
eq('成交率 close_rate（214÷727）', '29.4%', fmtPct1(cr.close));
// 月度净利底料：月毛利 − 月人力成本（月固定项日摊×计提天数）
const juneLabor = data.people.reduce((a, p) => a + laborCostInMonth(p, '2026-06', data.openDate, data.anchorDate), 0);
eq('6 月人力成本（62700÷30×29）', '60610.00', juneLabor.toFixed(2));
const cumLabor = data.people.reduce((a, p) => a + laborCostOf(p, data.openDate, data.anchorDate), 0);
eq('累计人力成本＝逐日累计口径闭合', f.totalLaborCost.toFixed(2), cumLabor.toFixed(2));
// 部门汇总＝先汇总再算（辛普森悖论防线）：手工汇总 d1 对拍
const d1 = data.people.filter((p) => p.deptId === 'd1').map((p) => p.id);
const d1Agg = groupLaborRoi(f, d1);
const d1Manual = (d1.reduce((a, id) => a + (f.perOwner[id]?.grossProfit ?? 0), 0) - d1.reduce((a, id) => a + (f.perOwnerLaborCost[id] ?? 0), 0)) / d1.reduce((a, id) => a + (f.perOwnerLaborCost[id] ?? 0), 0);
eq('华东一部 labor_roi＝Σ净利÷Σ成本', d1Manual.toFixed(6), (d1Agg.roi ?? NaN).toFixed(6));
// 排名：月回款全员第 1＝王丽（¥100,000）
const monthRank = rankWithTies(
  data.people.filter((p) => p.role !== 'boss').map((p) => ({ id: p.id, value: f.perOwnerMonthly[p.id]?.['2026-06']?.revenue ?? 0 })),
);
eq('6 月回款全员第 1', 'wangli', monthRank[0].id);
eq('王五 6 月回款 0 → 末位', 'wangwu', monthRank[monthRank.length - 1].id);
// 停滞：对种子跑通用列，全量与逐人合计闭合
const stall = computeStall(f.poolStates, data.anchorDate);
const perOwnerSum = Object.values(stall.perOwner).reduce((a, c) => a + c.red + c.orange + c.yellow, 0);
eq('停滞逐人合计＝总数', stall.items.length, perOwnerSum);
eq('在管客户数＝四池存量和', f.stocks.lead + f.stocks.intent + f.stocks.sample + f.stocks.signed, stall.managedCnt);
eq('王五存在红色停滞（47 天零事件人设）', true, (stall.perOwner['wangwu']?.red ?? 0) > 0);
console.log(`    （停滞概览：红 ${stall.total.red} / 橙 ${stall.total.orange} / 黄 ${stall.total.yellow}，在管 ${stall.managedCnt}）`);

// ================= 汇总 =================
if (failed > 0) {
  console.error(`\n${R}${B}✗ domain-check 未通过：${failed}/${count} 项失败${N}`);
  process.exit(1);
}
console.log(`\n${G}${B}✓ domain-check 全绿：${count} 项断言全部通过${N}`);
