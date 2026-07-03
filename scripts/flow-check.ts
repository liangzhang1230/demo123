/**
 * npm run flow-check（P5 验收 · 现场剧本）：
 * 建 1 客户（王丽）→ 推进 线索→意向→样品→签约→成交（录回款 ¥8,000）→
 * 断言看板 6 处数字联动正确（公司月回款/王丽月回款/成交存量/本月成交/pace/aov）＋
 * 守恒保持＋查重拦截脱敏＋流失原因必选＋复购单＋确认页状态＋「模拟过一天」定版。
 * 页面与本脚本共用同一动作层（src/domain/actions），UI 即所测。
 */
import { generateSeed } from '../src/seed/generator';
import { computeAll } from '../src/domain/compute';
import {
  addRepeatOrder, confirmToday, createCustomer, currentStageOf, DuplicateError,
  simulateDayPass, transitionStage,
} from '../src/domain/actions';
import { fmtPct1, paceRate, stayDays } from '../src/domain/engine';

const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', N = '\x1b[0m';
let failed = 0;
function sec(name: string) { console.log(`\n${B}── ${name} ──${N}`); }
function t(name: string, pass: boolean, detail?: string) {
  console.log(`  ${pass ? `${G}✓${N}` : `${R}✗${N}`} ${name}${detail ? ` ＝ ${detail}` : ''}`);
  if (!pass) failed++;
}
function eq(name: string, expected: unknown, actual: unknown) {
  t(name, String(expected) === String(actual), String(expected) === String(actual) ? String(actual) : `期望 ${expected}，实得 ${actual}`);
}

let data = generateSeed();
const before = computeAll(data);

sec('剧本 · 建 1 客户推到成交（¥8,000 · A 品类）');
const created = createCustomer(data, {
  name: '浦东新利华超市', phone: '139 0000-0001', contact: '周老板', ownerId: 'wangli', level: 'A',
});
data = created.data;
const cid = created.customerId;
eq('建档后当前状态＝线索', 'lead', currentStageOf(data, cid).stage);
data = transitionStage(data, cid, { to: 'intent' });
data = transitionStage(data, cid, { to: 'sample' });
data = transitionStage(data, cid, { to: 'signed' });
data = transitionStage(data, cid, { to: 'deal', amount: 8000, categoryCode: 'A' });
eq('成交后当前状态＝成交', 'deal', currentStageOf(data, cid).stage);

const after = computeAll(data);

sec('看板 6 处数字联动（实时折算，无一硬编码）');
eq('① 公司本月回款 +8000', before.company.monthRevenue + 8000, after.company.monthRevenue);
eq('② 王丽本月回款 +8000（团队一屏/我的目标）', before.owners['wangli'].monthRevenue + 8000, after.owners['wangli'].monthRevenue);
eq('③ 成交池存量 +1（六态漏斗）', before.folded.stocks.deal + 1, after.folded.stocks.deal);
eq('④ 本月成交新客 +1（心跳第 4 格）', before.company.monthFirstDeals + 1, after.company.monthFirstDeals);
t('⑤ 目标进度 pace 上升（心跳第 5 格）',
  paceRate(after.company.monthRevenue, 550000, 29, 30)! > paceRate(before.company.monthRevenue, 550000, 29, 30)!,
  fmtPct1(paceRate(after.company.monthRevenue, 550000, 29, 30)));
eq('⑥ 平均客单 aov 重算（总回款÷215）',
  ((before.folded.cumRevenue + 8000) / (before.folded.totalDealCnt + 1)).toFixed(2),
  (after.folded.cumRevenue / after.folded.totalDealCnt).toFixed(2));
eq('王丽当日线索过程量 +1（确认页/单日目标）', before.owners['wangli'].dayProcess.lead + 1, after.owners['wangli'].dayProcess.lead);

sec('守恒与铁规保持');
for (const pool of ['lead', 'intent', 'sample', 'signed'] as const) {
  const f = after.folded.poolFlow[pool];
  eq(`${pool} 池守恒（新增−转出−流失＝存量）`, after.folded.stocks[pool], f.entered - f.exited - f.lost);
}

sec('查重拦截（手机号硬钥匙 · 脱敏归属）');
try {
  createCustomer(data, { name: '重复测试', phone: '+8613900000001', contact: '张三', ownerId: 'zhaomin', level: 'C' });
  t('重复手机号被硬拦截', false);
} catch (e) {
  t('重复手机号被硬拦截（含 +86/空格归一化）', e instanceof DuplicateError);
  if (e instanceof DuplicateError) {
    eq('拦截页归属脱敏', '王*', e.dup.ownerMasked);
    eq('拦截页号码脱敏', '139****0001', e.dup.phoneMasked);
    eq('拦截页显示客户状态', '成交', e.dup.stageLabel);
  }
}

sec('流失/成交防呆（口径强制）');
try {
  transitionStage(data, data.customers.find((c) => c.ownerId === 'wangli' && currentStageOf(data, c.id).stage === 'lead')!.id, { to: 'lost' });
  t('流失不选原因被拒（R1-07）', false);
} catch (e) { t('流失不选原因被拒（R1-07）', String(e).includes('流失原因必选')); }
try {
  transitionStage(data, data.customers.find((c) => c.ownerId === 'wangli' && currentStageOf(data, c.id).stage === 'signed')!.id, { to: 'deal' });
  t('转成交不录回款被拒（R1-05）', false);
} catch (e) { t('转成交不录回款被拒（R1-05）', String(e).includes('回款必填')); }
try {
  transitionStage(data, cid, { to: 'intent' });
  t('成交为终态、禁止逆向流转（矩阵照抄）', false);
} catch (e) { t('成交为终态、禁止逆向流转（矩阵照抄）', String(e).includes('流转矩阵禁止')); }

sec('复购单（R1-19 不产状态事件、全额进回款）');
{
  const b = computeAll(data);
  data = addRepeatOrder(data, cid, 3000, 'B');
  const a = computeAll(data);
  eq('复购后回款 +3000', b.company.monthRevenue + 3000, a.company.monthRevenue);
  eq('复购不计首购（first_deal 不变）', b.company.monthFirstDeals, a.company.monthFirstDeals);
  eq('复购客户数 +1', b.company.monthRepeatCusts + 1, a.company.monthRepeatCusts);
  eq('状态仍为成交（无状态事件）', 'deal', currentStageOf(data, cid).stage);
}

sec('确认页与「模拟过一天」（R1-17 定版机制）');
{
  data = confirmToday(data, 'wangli');
  t('王丽今日已确认', (data.confirmations?.[data.anchorDate] ?? []).includes('wangli'));
  const anchorBefore = data.anchorDate;
  const stallProbe = computeAll(data).stallList.find((s) => s.ownerId === 'wangwu')!;
  data = simulateDayPass(data);
  eq('模拟时钟 +1 天', '2026-06-30', data.anchorDate);
  eq('昨日快照归档为当日', anchorBefore, data.yesterdaySnapshot.date);
  const afterDay = computeAll(data);
  eq('停滞天数 +1（无事件自然增长）',
    stallProbe.days + 1,
    afterDay.stallList.find((s) => s.customerId === stallProbe.customerId)?.days);
  eq('快照存量与折算一致（定版口径）', JSON.stringify(computeAll(data, anchorBefore).folded.stocks), JSON.stringify(data.yesterdaySnapshot.stocks));
  t('新锚点下确认状态清零（新的一天待确认）', !(data.confirmations?.[data.anchorDate] ?? []).includes('wangli'));
  // 王五零业务事件天数随日推进 +1（47 → 48）
  const wangwuIdle = (Date.parse(data.anchorDate) - Date.parse(afterDay.folded.perOwner['wangwu'].lastEventDate!)) / 86400000;
  eq('王五零业务事件天数 48', 48, wangwuIdle);
  eq('停留天数口径复核（进入当日记 0）', 1, stayDays('2026-06-29', '2026-06-30'));
}

console.log('');
if (failed > 0) {
  console.error(`${R}${B}✗ flow-check 未通过：${failed} 项失败${N}`);
  process.exit(1);
}
console.log(`${G}${B}✓ flow-check 全绿：现场剧本闭环${N}`);
