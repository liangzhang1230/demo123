/**
 * P4 验收断言（销售端看板）
 *  A. 零利润口径断言：/sales 页面与共用组件源码 grep 不得出现 毛利/净利/labor_roi/利润/客单 字样（死线②）
 *  B. 七级判定：区间左闭右开、自上而下首次命中即停（§6.8 默认参数逐档对拍）
 *  C. 达标率/目标分解：单日目标＝月度÷自然天数；比率类不拆日 pace 返回 null；目标 0/未设 → null（§6.7）
 *  D. 排名：全精度并列跳号（1、1、3）、并列次序按事件时间早者前；种子对拍（王丽双榜第 1、
 *     刘敏/赵敏 ¥72,000 并列跳号、陈静昨日→今日升 1）（§6.10/§6.11）
 *  E. 停滞三级：通用列阈值 15/30/20/7；左闭；倍数 1.5/2.5 系统常量；盲审改正示例对拍
 *     （线索 15 天 → 关注 15–22、预警 23–37、濒死 38+）；列表排序 等级→ABCD→停留天数倒序（§8）
 *  F. 一切展示数字由事件流实时计算：存量双算法交叉对拍（currentStagesOf vs foldEvents）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateSeed } from '../src/seed/generator';
import { foldEvents } from '../src/domain/engine';
import { FUNNEL_STAGES } from '../src/domain/types';
import { gradeOf } from '../src/domain/levels';
import { absRate, dailyTarget, paceRate } from '../src/domain/targets';
import { rankOf, rankWithSkippedTies } from '../src/domain/ranking';
import {
  STALL_THRESHOLDS_GENERAL, stallLevelOf, stallListForOwner, currentStagesOf,
} from '../src/domain/stallSales';
import { monthRevenueByOwner, ownerDayProcess } from '../src/domain/selectors';

interface Check { group: string; name: string; pass: boolean; actual: string }
const checks: Check[] = [];
function check(group: string, name: string, pass: boolean, actual: unknown) {
  checks.push({ group, name, pass, actual: String(actual) });
}
function eq(group: string, name: string, actual: unknown, expected: unknown) {
  check(group, `${name}（期望 ${expected}）`, String(actual) === String(expected), actual);
}

// ---------- A. 零利润口径 grep ----------
const FORBIDDEN = /毛利|净利|labor_roi|利润|客单/;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
// 销售端可达面＝销售页＋共享组件；src/components/board 为管理端（/boss、/manager）专用看板，
// 合法含 labor_roi 等经营口径，不在销售端零利润断言范围内
const salesSurface = [...walk('src/pages/sales'), ...walk('src/components')].filter(
  (p) => !p.includes(join('src/components', 'board')),
);
for (const file of salesSurface) {
  const hits = readFileSync(file, 'utf8').match(FORBIDDEN);
  check('A 零利润口径', `${file} 无利润类字样`, hits == null, hits ? `命中 ${hits[0]}` : '干净');
}

// ---------- B. 七级判定（左闭右开，首次命中即停） ----------
const gradeName = (r: number | null) => gradeOf(r)?.name ?? '—';
for (const [rate, want] of [
  [2.0, '领先'], [1.9999, '优秀'], [1.5, '优秀'], [1.4999, '良好'], [1.2, '良好'],
  [1.1999, '合格'], [1.0, '合格'], [0.9999, '黄色预警'], [0.8, '黄色预警'],
  [0.7999, '橙色预警'], [0.6, '橙色预警'], [0.5999, '红色预警'], [0, '红色预警'],
] as const) {
  eq('B 七级判定', `达标率 ${(rate * 100).toFixed(2)}%`, gradeName(rate), want);
}
eq('B 七级判定', '达标率 null（目标未设）不参与判定', gradeName(null), '—');

// ---------- C. 达标率与目标分解 ----------
eq('C 目标口径', '单日目标＝24÷30（2026-06 自然天数）', dailyTarget(24, '2026-06'), 0.8);
eq('C 目标口径', '目标为 0 → abs_rate null 显 —', absRate(5, 0), 'null');
eq('C 目标口径', '目标未设 → 单日目标 null 显 —', dailyTarget(null, '2026-06'), 'null');
eq('C 目标口径', '比率类不拆日 → pace_rate 恒 null 显 —', paceRate(0.5, 0.4, '2026-06-29', true), 'null');
const paceMid = paceRate(50, 100, '2026-06-15'); // 应完成＝100×15/30＝50 → 100%
eq('C 目标口径', 'pace＝实际÷(月目标×已过/总天)', paceMid, 1);

// ---------- D. 排名（并列跳号 · 种子对拍） ----------
const synth = rankWithSkippedTies([
  { id: 'a', value: 100 }, { id: 'b', value: 72, tieTime: '2026-06-02 10:00' },
  { id: 'c', value: 72, tieTime: '2026-06-01 10:00' }, { id: 'd', value: 50 },
]);
eq('D 排名', '并列跳号 1、2、2、4', synth.map((r) => r.rank).join(','), '1,2,2,4');
eq('D 排名', '并列次序按事件时间早者前', synth.map((r) => r.id).join(','), 'a,c,b,d');

const seed = generateSeed();
const anchor = seed.anchorDate;
const ym = anchor.slice(0, 7);
const participants = seed.people.filter((p) => p.deptId !== null);
const revToday = monthRevenueByOwner(seed.events, ym, anchor);
const revYesterday = monthRevenueByOwner(seed.events, ym, seed.yesterdaySnapshot.date);
const inputs = (rev: Record<string, { value: number; lastTime: string }>, ids: string[]) =>
  ids.map((id) => ({ id, value: rev[id]?.value ?? 0, tieTime: rev[id]?.lastTime }));
const allIds = participants.map((p) => p.id);
const d1Ids = participants.filter((p) => p.deptId === 'd1').map((p) => p.id);
const boardAll = rankWithSkippedTies(inputs(revToday, allIds));
const boardD1 = rankWithSkippedTies(inputs(revToday, d1Ids));
const yAll = rankWithSkippedTies(inputs(revYesterday, allIds));

eq('D 排名', '王丽全员总排名第 1（本月回款）', rankOf(boardAll, 'wangli'), 1);
eq('D 排名', '王丽部门排名第 1（华东一部）', rankOf(boardD1, 'wangli'), 1);
eq('D 排名', '王丽本月回款（照抄配方 ¥100,000）', revToday['wangli']?.value, 100000);
const liumin = boardAll.find((r) => r.id === 'liumin')!;
const zhaomin = boardAll.find((r) => r.id === 'zhaomin')!;
check('D 排名', '刘敏/赵敏全精度相等（¥72,000）并列同名次',
  liumin.value === 72000 && zhaomin.value === 72000 && liumin.rank === zhaomin.rank,
  `${liumin.rank} / ${zhaomin.rank}`);
const nextAfterTie = boardAll.filter((r) => r.rank > liumin.rank).sort((a, b) => a.rank - b.rank)[0];
eq('D 排名', '并列后名次跳号（并列名次＋2）', nextAfterTie.rank, liumin.rank + 2);
check('D 排名', '升降箭头素材：陈静 昨日→今日 升 1',
  rankOf(yAll, 'chenjing')! - rankOf(boardAll, 'chenjing')! === 1,
  `${rankOf(yAll, 'chenjing')} → ${rankOf(boardAll, 'chenjing')}`);
eq('D 排名', '王丽昨日亦第 1（箭头显持平）', rankOf(yAll, 'wangli'), 1);

// 区二种子对拍：王丽月回款 pace（目标 ¥80,000，已过 29/30 天）
const wangliPace = paceRate(revToday['wangli'].value, seed.targets.personMonthlyRevenue['wangli'], anchor)!;
eq('D 排名', '王丽回款 pace＝100000÷(80000×29/30)', wangliPace.toFixed(4), (100000 / (80000 * 29 / 30)).toFixed(4));
eq('D 排名', '王丽 pace 落七级＝良好', gradeName(wangliPace), '良好');

// ---------- E. 停滞三级 ----------
eq('E 停滞', '通用列阈值 线索/意向/样品/签约未回款',
  `${STALL_THRESHOLDS_GENERAL.lead}/${STALL_THRESHOLDS_GENERAL.intent}/${STALL_THRESHOLDS_GENERAL.sample}/${STALL_THRESHOLDS_GENERAL.signed}`,
  '15/30/20/7');
for (const [days, want] of [
  [14, 'null'], [15, 'yellow'], [22, 'yellow'], [23, 'orange'], [37, 'orange'], [38, 'red'],
] as const) {
  eq('E 停滞', `线索阈值 15 天 · 停留 ${days} 天（盲审改正示例）`, stallLevelOf(days, 15), want);
}
eq('E 停滞', '签约未回款阈值 7 天 · 停留 18 天＝濒死', stallLevelOf(18, 7), 'red');

const stall = stallListForOwner(seed.events, seed.customers, 'wangli', anchor);
const counts = { red: 0, orange: 0, yellow: 0 };
for (const s of stall) counts[s.level]++;
check('E 停滞', '王丽停滞列表非空（Top5＋折叠有素材）', stall.length >= 6, `${stall.length} 家（红${counts.red}/橙${counts.orange}/黄${counts.yellow}）`);
check('E 停滞', '全部触发均为左闭（停留 ≥ 阈值）',
  stall.every((s) => s.stayDays >= STALL_THRESHOLDS_GENERAL[s.stage]), 'ok');
const LV = { red: 0, orange: 1, yellow: 2 } as const;
let sorted = true;
for (let i = 1; i < stall.length; i++) {
  const a = stall[i - 1]; const b = stall[i];
  if (LV[a.level] > LV[b.level]) { sorted = false; break; }
  if (LV[a.level] === LV[b.level]) {
    if (a.abcd > b.abcd) { sorted = false; break; }
    if (a.abcd === b.abcd && a.stayDays < b.stayDays) { sorted = false; break; }
  }
}
check('E 停滞', '排序＝等级（红→橙→黄）→ABCD→停留天数倒序', sorted, sorted ? 'ok' : '乱序');
check('E 停滞', '仅受监控四池（成交/流失退出监控）',
  stall.every((s) => ['lead', 'intent', 'sample', 'signed'].includes(s.stage)), 'ok');

// ---------- F. 实时计算交叉对拍 ----------
const folded = foldEvents(seed.events, seed.people, seed.categories, anchor, seed.openDate);
const stages = currentStagesOf(seed.events, anchor);
const myStocks = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<string, number>;
for (const c of seed.customers) {
  if (c.ownerId !== 'wangli') continue;
  const info = stages.get(c.id);
  if (info) myStocks[info.stage]++;
}
check('F 实时计算', '王丽六态存量：双算法交叉一致（页面口径 vs 折算器）',
  FUNNEL_STAGES.every((s) => myStocks[s] === folded.perOwner['wangli'].stocks[s]),
  FUNNEL_STAGES.map((s) => `${s}:${myStocks[s]}`).join(' '));
const dayLeadTotal = Object.values(
  participants.reduce((acc: Record<string, number>, p) => {
    acc[p.id] = ownerDayProcess(seed.events, p.id, anchor).lead;
    return acc;
  }, {}),
).reduce((a, b) => a + b, 0);
const createdToday = seed.events.filter((e) => e.type === 'customer_created' && e.date === anchor).length;
eq('F 实时计算', '当日 lead_new 合计＝当日建档事件数（独立复算）', dayLeadTotal, createdToday);
const monthRevSum = Object.values(revToday).reduce((a, b) => a + b.value, 0);
eq('F 实时计算', '各人当月回款合计＝月回款 ¥612,000（逐笔累加）', monthRevSum, 612000);

// ---------- 汇报 ----------
let failed = 0;
let lastGroup = '';
for (const c of checks) {
  if (c.group !== lastGroup) {
    console.log(`\n\x1b[1m── ${c.group} ──\x1b[0m`);
    lastGroup = c.group;
  }
  if (c.pass) console.log(`  \x1b[32m✓\x1b[0m ${c.name} ＝ ${c.actual}`);
  else { failed++; console.log(`  \x1b[31m✗ ${c.name} ＝ ${c.actual}\x1b[0m`); }
}
console.log('');
if (failed > 0) {
  console.log(`\x1b[31m\x1b[1m✗ p4-check 失败：${failed}/${checks.length} 项未通过\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32m\x1b[1m✓ p4-check 全绿：${checks.length} 项断言全部通过\x1b[0m`);
