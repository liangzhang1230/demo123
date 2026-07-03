/**
 * P5 验收断言 · 业务操作闭环
 *  A 建档写时查重（撞键拦截显脱敏归属；流失手机号释放；硬钥匙格式）
 *  B 六态流转守卫（§4.3 矩阵；流失原因必选 R1-07；成交回款/品类必填 R1-05/R1-18；is_repeat 自动判定）
 *  C 现场剧本：建 1 客户推到成交 → 看板 6 处数字联动（销售端过程量/漏斗存量/本月回款/排名，管理端心跳回款/成交＋团队一屏）
 *  D 确认页 §4.7 分区折算（区内行恒等式：上期存量＋今日新增−转出−流失＝期末存量）
 *  E 「模拟过一天」：定版快照归档、停滞 +1、环比重算、早报样卡刷新（≤150 字、点名口径）
 * 全部数字由种子＋现场事件流实时折算（铁律 2）；每次写操作后复跑漏斗守恒。
 */
import { generateSeed } from '../src/seed/generator';
import {
  assertConservation, closeDay, emptyOverlay, mergeData, type Overlay,
} from '../src/seed/overlay';
import {
  buildCreateCustomer, buildRepeatOrder, buildStageChange, customerStateOf, findPhoneConflict, isValidPhone,
} from '../src/domain/ops';
import { maskName, maskPhone } from '../src/domain/mask';
import { currentStagesOf, STALL_THRESHOLDS_GENERAL, type StallPool } from '../src/domain/stallSales';
import { monthRevenueByOwner, ownerDayProcess } from '../src/domain/selectors';
import { rankWithSkippedTies, rankOf } from '../src/domain/ranking';
import { buildConfirmSheet } from '../src/domain/confirmSheet';
import { deriveMorningReport } from '../src/domain/morningReport';
import { momMonthPair } from '../src/domain/mom';
import { isRestDay, dayDiff } from '../src/domain/calendar';
import { buildBoardModel } from '../src/components/board/model';
import type { SeedData, SeedEvent, Stage } from '../src/domain/types';

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const X = '\x1b[0m';

let passCnt = 0;
let failCnt = 0;
let group = '';

function section(name: string) {
  group = name;
  console.log(`\n${B}── ${name} ──${X}`);
}
function check(name: string, cond: boolean, actual?: unknown) {
  if (cond) {
    passCnt++;
    console.log(`  ${G}✓${X} ${name}${actual !== undefined ? ` ＝ ${actual}` : ''}`);
  } else {
    failCnt++;
    console.log(`  ${R}✗ ${name}${actual !== undefined ? ` ＝ ${actual}` : ''}${X}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  check(`${name}（期望 ${expected}）`, String(actual) === String(expected), actual);
}
function throws(name: string, fn: () => void, msgPart: string) {
  try {
    fn();
    check(`${name}（应拒绝）`, false, '未抛错');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(`${name}（应拒绝：${msgPart}）`, msg.includes(msgPart), msg);
  }
}

// ================= 演示会话（纯函数复刻 state.tsx 的动作管线） =================
const base = generateSeed();
let ov: Overlay = emptyOverlay();
const merged = (): SeedData => mergeData(base, ov);
const CLOCK = () => ({ date: merged().anchorDate, time: '15:00' });

function commitEvents(evs: SeedEvent[]) {
  ov = { ...ov, events: [...ov.events, ...evs] };
  assertConservation(merged());
}

const ME = 'wangli';
const ANCHOR0 = base.anchorDate; // 2026-06-29

// ================= A 建档与写时查重 =================
section('A 建档写时查重（§5 写时守卫）');
{
  const data = merged();
  // 在库活跃客户撞键 → 硬拦截 ＋ 脱敏归属
  const stages = currentStagesOf(data.events, data.anchorDate);
  const active = data.customers.find((c) => {
    const s = stages.get(c.id);
    return s && s.stage !== 'lost' && c.ownerId !== ME;
  })!;
  const conflict = findPhoneConflict(data, active.phone);
  check('活跃客户手机号撞键 → 返回冲突（硬拦截）', conflict != null && conflict.customer.id === active.id);
  const owner = data.people.find((p) => p.id === active.ownerId)!;
  check('拦截展示归属脱敏（姓氏＋掩码）', maskName(owner.name).endsWith('＊') && !maskName(owner.name).includes(owner.name.slice(1)), maskName(owner.name));
  check('拦截展示手机号脱敏（前3后4）', maskPhone(active.phone) === `${active.phone.slice(0, 3)}****${active.phone.slice(-4)}`, maskPhone(active.phone));
  check('拦截展示客户状态＋最后动态时间', conflict!.stage !== 'lost' && /^\d{4}-\d{2}-\d{2}$/.test(conflict!.lastEventDate));

  // 流失客户手机号已释放 → 允许重新建档
  const lostCust = data.customers.find((c) => stages.get(c.id)?.stage === 'lost')!;
  check('流失客户手机号已释放（查重不拦截）', findPhoneConflict(data, lostCust.phone) == null, lostCust.phone);

  // 硬钥匙格式
  check('手机号格式守卫：1 开头 11 位', isValidPhone('13912345678') && !isValidPhone('2391234567') && !isValidPhone('139123'));
  throws('撞键建档', () => buildCreateCustomer(data, { name: 'x', contact: 'y', phone: active.phone, level: 'C', ownerId: ME }, CLOCK()), '撞键');
}

// ================= B 六态流转守卫（§4.3） =================
section('B 六态流转守卫（§4.3 矩阵 ＋ R1-05/R1-07/R1-18）');
{
  const data = merged();
  const stages = currentStagesOf(data.events, data.anchorDate);
  const myBy = (st: Stage) => data.customers.find((c) => c.ownerId === ME && stages.get(c.id)?.stage === st)!;

  const intentCust = myBy('intent');
  throws('后退 意向→线索', () => buildStageChange(data, intentCust.id, 'lead', CLOCK()), '状态机禁止');
  throws('转流失缺原因', () => buildStageChange(data, intentCust.id, 'lost', CLOCK()), '流失原因');
  throws('转成交缺回款', () => buildStageChange(data, intentCust.id, 'deal', CLOCK(), { categoryCode: 'A' }), '回款必填');
  throws('转成交缺品类', () => buildStageChange(data, intentCust.id, 'deal', CLOCK(), { amount: 1000 }), '品类必选');

  const dealCust = data.customers.find((c) => stages.get(c.id)?.stage === 'deal')!;
  throws('成交态再流转（终态）', () => buildStageChange(data, dealCust.id, 'lost', CLOCK()), '状态机禁止');
  const rep = buildRepeatOrder(data, dealCust.id, 5000, 'B', CLOCK());
  check('成交态复购单：is_repeat 自动判定＝复购、状态不变', rep.isRepeat === true && rep.type === 'order_created');

  const leadCust = myBy('lead');
  const jump = buildStageChange(data, leadCust.id, 'sample', CLOCK());
  check('允许跳级前进（线索→样品，中间不补计）', jump.length === 1 && jump[0].from === 'lead' && jump[0].to === 'sample');
}

// ================= C 现场剧本：建 1 客户推到成交 → 6 处联动 =================
section('C 现场剧本：建档 → 六态推进 → 成交录回款 → 看板 6 处联动');
{
  const AMOUNT = 8800;
  const ym = ANCHOR0.slice(0, 7);

  // —— 快照「操作前」看板读数（全部经页面同款选择器/模型取数） ——
  const before = merged();
  const b_dayLead = ownerDayProcess(before.events, ME, ANCHOR0).lead; // 销售端区二 线索（今日）
  const b_stocksDeal = countMyStock(before, 'deal'); // 销售端区四 成交存量
  const b_myRev = monthRevenueByOwner(before.events, ym, ANCHOR0)[ME]?.value ?? 0; // 区二/区四 本月回款
  const b_board = buildBoardModel(before, { role: 'boss' });
  const b_bossRev = b_board.monthRevenue; // 管理端心跳 本月回款
  const b_bossDeals = Number(b_board.heartbeat[3].value); // 管理端心跳 本月成交
  const b_teamRowRev = b_board.team.find((t) => t.id === ME)!.monthRevenue; // 团队一屏 王丽行

  // —— 剧本执行 ——
  const created = buildCreateCustomer(
    merged(),
    { name: '现场演示商行', contact: '周老板', phone: '13800009999', level: 'A', ownerId: ME },
    CLOCK(),
  );
  ov = { ...ov, customers: [...ov.customers, created.customer], events: [...ov.events, created.event] };
  assertConservation(merged());
  const cid = created.customer.id;

  for (const to of ['intent', 'sample', 'signed'] as Stage[]) {
    commitEvents(buildStageChange(merged(), cid, to, CLOCK()));
  }
  commitEvents(buildStageChange(merged(), cid, 'deal', CLOCK(), { amount: AMOUNT, categoryCode: 'A' }));

  const after = merged();
  const st = customerStateOf(after.events, cid, ANCHOR0);
  check('客户已推到成交（六态全链路）', st?.stage === 'deal');
  const order = after.events.find((e) => e.customerId === cid && e.type === 'order_created')!;
  check('首购单 is_repeat 自动判定＝首购', order.isRepeat === false && order.amount === AMOUNT);

  // —— 6 处联动断言 ——
  const a_board = buildBoardModel(after, { role: 'boss' });
  eq('联动① 销售端·区二 线索过程量（今日）+1', ownerDayProcess(after.events, ME, ANCHOR0).lead, b_dayLead + 1);
  eq('联动② 销售端·区四 我的漏斗成交存量 +1', countMyStock(after, 'deal'), b_stocksDeal + 1);
  eq('联动③ 销售端·本月回款 +¥8,800', monthRevenueByOwner(after.events, ym, ANCHOR0)[ME]?.value ?? 0, b_myRev + AMOUNT);
  const boardAll = rankWithSkippedTies(
    after.people.filter((p) => p.deptId !== null).map((p) => ({
      id: p.id,
      value: monthRevenueByOwner(after.events, ym, ANCHOR0)[p.id]?.value ?? 0,
    })),
  );
  const myRank = rankOf(boardAll, ME);
  const myRankVal = boardAll.find((r) => r.id === ME)!.value;
  check('联动④ 销售端·区三 排名实时重算（王丽金额进榜、全员第 1）', myRank === 1 && myRankVal === b_myRev + AMOUNT, `第 ${myRank} 名 ¥${myRankVal}`);
  eq('联动⑤ 管理端·心跳 本月回款 +¥8,800', a_board.monthRevenue, b_bossRev + AMOUNT);
  check(
    '联动⑥ 管理端·心跳 本月成交 +1 且团队一屏王丽行回款 +¥8,800',
    Number(a_board.heartbeat[3].value) === b_bossDeals + 1 &&
      a_board.team.find((t) => t.id === ME)!.monthRevenue === b_teamRowRev + AMOUNT,
    `成交 ${a_board.heartbeat[3].value} · 王丽 ¥${a_board.team.find((t) => t.id === ME)!.monthRevenue}`,
  );
}

// ================= D 确认页 §4.7 分区折算 =================
section('D 确认页（§4.7 四池分区＋成交区＋当日总回款）');
{
  const data = merged();
  const sheet = buildConfirmSheet(data, ME, ANCHOR0, isRestDay);
  const lead = sheet.pools[0];
  check('线索区 今日新增 ≥1（含现场建档）', lead.newIn >= 1, lead.newIn);
  for (const sec of sheet.pools) {
    const outSum = Object.values(sec.out).reduce((a, b) => a + (b ?? 0), 0);
    eq(
      `${sec.pool} 区行恒等式：上期存量＋新增−转出−流失＝期末存量`,
      sec.prevStock + sec.newIn - outSum - sec.lost,
      sec.endStock,
    );
  }
  check('成交区 首购客户数 ≥1（现场成交）', sheet.firstDealCnt >= 1, sheet.firstDealCnt);
  const todayOrders = data.events.filter((e) => e.type === 'order_created' && e.date === ANCHOR0 && e.ownerId === ME);
  eq('当日总回款＝当日成交单逐笔累加（自动汇总只读）', sheet.totalRevenue, todayOrders.reduce((a, e) => a + (e.amount ?? 0), 0));
  check('应确认判定：当日有单据/活动', sheet.hasActivity === true);
  check('休息日判定接线（2026-06-28 周日＝休）', isRestDay('2026-06-28') && !isRestDay(ANCHOR0));
}

// ================= E 模拟过一天（R1-17 定版） =================
section('E 「模拟过一天」：快照归档、停滞+1、环比重算、早报刷新');
{
  // 记录切日前状态
  const before = merged();
  const bBoard = buildBoardModel(before, { role: 'boss' });
  check('切日前（06-29）：当月未完整 → 心跳环比不计', bBoard.heartbeat[1].mom == null);

  // 选一个受监控客户对拍停滞 +1
  const stages0 = currentStagesOf(before.events, before.anchorDate);
  const watched = before.customers.find((c) => {
    const s = stages0.get(c.id);
    return s && (s.stage as string) in STALL_THRESHOLDS_GENERAL;
  })!;
  const stay0 = dayDiff(before.anchorDate, stages0.get(watched.id)!.enteredDate);

  // 王丽当日确认（早报点名应排除她）
  ov = { ...ov, confirms: [...ov.confirms, { date: ANCHOR0, ownerId: ME, time: '18:00' }] };

  // 日切
  ov = closeDay(base, ov);
  const day1 = merged();
  eq('锚点日 +1', day1.anchorDate, '2026-06-30');
  eq('定版快照归档：快照日＝被定版日', day1.yesterdaySnapshot.date, ANCHOR0);
  check('快照为折算归档（本月回款与事件流闭合）', day1.yesterdaySnapshot.monthRevenue === buildBoardModel({ ...day1, anchorDate: ANCHOR0 }, { role: 'boss' }).monthRevenue);

  const stages1 = currentStagesOf(day1.events, day1.anchorDate);
  eq('停滞天数 +1（受监控客户停留天数）', dayDiff(day1.anchorDate, stages1.get(watched.id)!.enteredDate), stay0 + 1);

  const board1 = buildBoardModel(day1, { role: 'boss' });
  check('环比重算：6 月已完整 → 心跳回款环比出现（vs 5 月）', board1.heartbeat[1].mom != null, board1.heartbeat[1].mom);

  // 早报样卡
  const report = deriveMorningReport(day1, ANCHOR0, ov.confirms, isRestDay);
  check('早报样卡 ≤150 字', report.text.length <= 150, `${report.text.length} 字`);
  const dayEvents = day1.events.filter((e) => e.date === ANCHOR0);
  eq('早报·新增线索＝当日建档事件数', report.leadNew, dayEvents.filter((e) => e.type === 'customer_created').length);
  eq('早报·回款＝当日成交单逐笔累加', report.revenue, dayEvents.filter((e) => e.type === 'order_created').reduce((a, e) => a + (e.amount ?? 0), 0));
  check('早报点名：已确认的王丽不点名', !report.unconfirmed.includes('王丽'), report.unconfirmed.join('、') || '（无）');
  const activeNames = new Set(dayEvents.map((e) => day1.people.find((p) => p.id === e.ownerId)?.name));
  check('早报点名口径：仅当日有单据/活动的未确认账号', report.unconfirmed.every((n) => activeNames.has(n)));

  // 再切一天到 7 月：月度周期物理隔离
  ov = closeDay(base, ov);
  const day2 = merged();
  eq('再切一天：跨入新月', day2.anchorDate, '2026-07-01');
  const board2 = buildBoardModel(day2, { role: 'boss' });
  eq('新月心跳回款从 0 起算（跨期隔离 R1-11）', board2.monthRevenue, 0);
  check('7 月进行中＝残缺月 → 心跳当月环比不计（§6.5）', board2.heartbeat[1].mom == null);
  const pair2 = momMonthPair(day2.openDate, day2.anchorDate);
  check('可比环比月对重算：6 月 vs 5 月（切日前为 5 月 vs 4 月）', pair2?.cur === '2026-06' && pair2?.prev === '2026-05', `${pair2?.cur} vs ${pair2?.prev}`);
}

// ================= 汇总 =================
function countMyStock(data: SeedData, stage: Stage): number {
  const stages = currentStagesOf(data.events, data.anchorDate);
  let n = 0;
  for (const c of data.customers) {
    if (c.ownerId !== ME) continue;
    if (stages.get(c.id)?.stage === stage) n++;
  }
  return n;
}

console.log('');
if (failCnt > 0) {
  console.log(`${R}${B}✗ p5-check 失败：${failCnt}/${passCnt + failCnt} 项未通过${X}`);
  process.exit(1);
} else {
  console.log(`${G}${B}✓ p5-check 全绿：${passCnt} 项断言全部通过${X}`);
}
