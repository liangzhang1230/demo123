/* ============================================================
   件七 · 验收用例集 T1–T19（5号《销冠育人器》v2.3 → 云端 C1 对拍）
   🔴 时钟注入（公约 C-14/R-11）：TEST_TODAY = '2026-07-13'，零真实时钟
   黄金值逐字同源：suite/originals-yuren.html 自检区（件七可执行版）
   UI 断言（Y-D13 无界面 / Y-D12 无配额写路径）做引擎级等效：源码扫描 + 数据结构断言，已逐条标注
   运行：node cloud/tests/yuren.test.mjs → 逐条 ✓/✗ + "N/19 绿"；失败 exit 1
   ============================================================ */

import { readFileSync } from 'node:fs';
import { safeDiv } from '../domain/shared.mjs';
import {
  recipeGateCheck, propertyGate, hidingCheck,
  plvCheck, plvRewriteHint, psiScore, psiBand,
  cognitiveGap, effectiveLeads, effectiveChain,
  cullInterceptors, newbieBoard, firstNDaysBaseline,
  bountyGate, isResultTrigger, isExempt,
  joltCheck, floorLift, recipeRoi, M26_DISCLAIMER,
  m40Pairing, pairAllowed, momentum, trajDistance, m42Match,
  paceZone, subGoalAmt, m44aRatio, coachingDoseActual, isWorkday,
  backlogCheck, surgeCollapse,
  emptyDB, importEnvelope, exportEnvelope, XREF,
  TALK, CALLMETRICS_FIELDS, DEFAULT_CULL_VERDICT,
} from '../domain/yuren.mjs';
import { bountyGate as liurenBountyGate } from '../domain/liuren.mjs';

const TEST_TODAY = '2026-07-13';
const SRC = readFileSync(new URL('../domain/yuren.mjs', import.meta.url), 'utf8');
const fmtRate = r => r == null ? '—' : (r * 100).toFixed(1) + '%';
const fmtWan = cents => cents == null ? '—' : (cents / 1000000).toFixed(1) + ' 万';
const fmtNum = (n, d) => n == null ? '—' : Number(n).toFixed(d == null ? 1 : d);
const safeShow = v => (v == null || (typeof v === 'number' && !isFinite(v))) ? '—' : String(v);

const cases = [];
const T = (id, title, fn) => cases.push({ id, title, fn });

/* T1 —— 配方源 A 被拒（归一第8 + UER −1.5万 → reject） */
T('T1', '配方源 A 被拒（归一第8 + UER −1.5万 → reject）', () => {
  const r = recipeGateCheck({ rankNorm: 8, uer: -1.5, discountRate: 0.09, complaintCount: 4 },
    { m21Done: true, teamDiscountMean: 0.05, teamComplaintMean: 1.2 });
  return { pass: !r.locked && r.qualified === false && r.fails.indexOf('rank') >= 0 && r.fails.indexOf('uer') >= 0,
    got: 'fails=' + r.fails.join(','), want: 'reject 且 fails 含 rank+uer' };
});

/* T2 —— J 通过（归一第1 / UER +0.9万 → accept） */
T('T2', 'J 通过（归一第1 / UER +0.9万 → accept）', () => {
  const r = recipeGateCheck({ rankNorm: 1, uer: 0.9, discountRate: 0.02, complaintCount: 0 },
    { m21Done: true, teamDiscountMean: 0.05, teamComplaintMean: 1.2 });
  return { pass: r.qualified === true, got: 'qualified=' + r.qualified, want: 'true' };
});

/* T3 —— M21 未导入 → 配方引擎整体锁定 */
T('T3', 'M21 未导入 → 配方引擎整体锁定', () => {
  const r = recipeGateCheck({ rankNorm: 1, uer: 1 }, { m21Done: false });
  return { pass: r.locked === true && r.qualified === false && r.fails[0] === 'm21_missing',
    got: 'locked=' + r.locked + ' fails=' + r.fails.join(','), want: 'locked=true' };
});

/* T4 —— 闸③：无 M28 → 锁定；AHC<60 → 锁定；齐备 → 放行 */
T('T4', '闸③：无 M28 → 锁定；AHC<60 → 锁定；齐备 → 放行', () => {
  const a = propertyGate({ hasM28: false, ahc: 80 });
  const b = propertyGate({ hasM28: true, ahc: 55 });
  const c = propertyGate({ hasM28: true, ahc: 78 });
  // 附：UER 藏拙监测 −0.5σ 口径（件三 3.1 闸③；样本不足→null 不下结论）
  const hide = hidingCheck([2.0, 2.1, 1.9, 2.0, 2.1, 0.2]);
  const hideNull = hidingCheck([2.0, 2.1]);
  return { pass: a.locked && a.reason === 'no_m28' && b.locked && b.reason === 'ahc_low' && !c.locked
      && hide.hiding === true && hideNull.hiding === null,
    got: [a.reason, b.reason, c.reason].join('/') + '，hiding=' + hide.hiding, want: 'no_m28/ahc_low/放行，hiding=true' };
});

/* T5 —— PLV『态度/狼性』句三层全拦截 + 改写建议出现 */
T('T5', 'PLV『你态度不端正，要拿出狼性』三层全拦截 + 改写建议非空', () => {
  const r = plvCheck('你态度不端正，要拿出狼性');
  const rewrite = plvRewriteHint(r);
  return { pass: !r.l1.pass && !r.l2.pass && !r.l3.pass && !r.passed && rewrite.length > 0,
    got: 'l1 hits=' + r.l1.hits.join('、') + '，建议 ' + rewrite.length + ' 条', want: '三层全❌ + 建议非空' };
});

/* T6 —— PLV 合法句三层通过 */
T('T6', 'PLV 合法句三层全通过', () => {
  const r = plvCheck('你昨天 12 通电话，9 通没做需求确认。今天试试在第 3 分钟问"您现在最头疼的是什么？"配方源基准 87%');
  return { pass: r.l1.pass && r.l2.pass && r.l3.pass && r.passed,
    got: 'slots=' + JSON.stringify(r.l3.slots), want: '三层全✅' };
});

/* T7 —— PSI 改造前 32 / 改造后 96 */
T('T7', 'PSI 改造前 32（🔴）/ 改造后 96（🟢）', () => {
  const before = psiScore({ targeting: 0.48, benchmark: 0.32, dataRef: 0.24, ackRate: 0.24 });
  const after = psiScore({ targeting: 0.92, benchmark: 1.0, dataRef: 1.0, ackRate: 0.92 });
  return { pass: before === 32 && after === 96 && psiBand(before) === 'red' && psiBand(after) === 'green',
    got: before + ' / ' + after, want: '32 / 96' };
});

/* T8 —— 认知鸿沟 = 54.8% 红（与招人器同口径） */
T('T8', '认知鸿沟 = 54.8% 红（与招人器同口径）', () => {
  const gap = cognitiveGap(42, 19);
  return { pass: fmtRate(gap) === '54.8%' && gap > 0.30, got: fmtRate(gap), want: '54.8%（>30% 红）' };
});

/* T9 —— M26 地板/天花板 = 35 倍 */
T('T9', 'M26 地板 84 万/年 ÷ 天花板 2.4 万/年 = 35 倍', () => {
  const floor = floorLift({ windowDaysOk: true,
    members: Array.from({ length: 5 }, () => ({ beforeMonthlyAmt: 2.8e6, afterMonthlyAmt: 4.2e6 })) });
  const ceil = floorLift({ windowDaysOk: true,
    members: [{ beforeMonthlyAmt: 9.0e6, afterMonthlyAmt: 9.1e6 },
      { beforeMonthlyAmt: 8.0e6, afterMonthlyAmt: 8.1e6 },
      { beforeMonthlyAmt: 7.0e6, afterMonthlyAmt: 7.0e6 }] });
  const ratio = safeDiv(floor.annualLiftAmt, ceil.annualLiftAmt);
  return { pass: floor.annualLiftAmt === 8.4e7 && ceil.annualLiftAmt === 2.4e6 && ratio === 35,
    got: fmtWan(floor.annualLiftAmt) + '/年 vs ' + fmtWan(ceil.annualLiftAmt) + '/年 = ' + ratio + ' 倍', want: '84.0 万 vs 2.4 万 = 35 倍' };
});

/* T10 —— 配方 ROI = 9.5 倍（含"非随机对照"标注断言） */
T('T10', '配方 ROI = 9.5 倍 + 非随机对照标注', () => {
  const roi = recipeRoi(8.4e7, 736000);   // 84万/年 ÷ 7,360元/月（单位：分）
  const label = M26_DISCLAIMER.indexOf('非随机对照') >= 0;
  return { pass: fmtNum(roi, 1) === '9.5' && label, got: 'ROI=' + fmtNum(roi, 1) + '，标注=' + label, want: '9.5 + 标注存在' };
});

/* T11 —— 汰前三拦截全部生效（Y-11 三连注入） */
T('T11', '汰前三拦截全部生效（Y-11 三连注入）', () => {
  const b1 = cullInterceptors({ leadsIndex: 0.6, practice14: 80, ackConfirmedCount: 5 });
  const b2 = cullInterceptors({ leadsIndex: 0.9, practice14: 30, ackConfirmedCount: 5 });
  const b3 = cullInterceptors({ leadsIndex: 0.9, practice14: 80, ackConfirmedCount: 0 });
  const texts = [TALK.y11[0](18), TALK.y11[1](30), TALK.y11[2](21)];
  return { pass: b1[0] === 'no_leads' && b2[0] === 'no_practice' && b3[0] === 'no_coaching'
      && texts.every(t => t.length > 10) && DEFAULT_CULL_VERDICT === 'keep',
    got: [b1, b2, b3].map(x => x[0]).join('/') + '，兜底=' + DEFAULT_CULL_VERDICT, want: 'no_leads/no_practice/no_coaching，兜底 keep' };
});

/* T12 —— 有效动作分：刷线索计数 ×2 → 有效分不变（虚报数学收益归零） */
T('T12', '有效动作分：刷线索 ×2 → 有效分不变（虚报收益归零）', () => {
  const e1 = effectiveLeads(40, 6, 0.2);
  const e2 = effectiveLeads(80, 6, 0.2);
  const chain = effectiveChain({ leads: 80, intents: 6, samples: 1, contracts: 0 }, { lead2intent: 0.2 });
  return { pass: e1 === 30 && e2 === 30 && chain.leads === 30,
    got: e1 + ' → ' + e2, want: '30 → 30' };
});

/* T13 —— M40：10人集 → (J↔P7)(F↔P8)(G↔P5)+候补P4/P6；G 撤 M28 → 仅 2 对；第 4 周强制轮换 */
T('T13', 'M40：(J↔P7)(F↔P8)(G↔P5)+候补P4/P6；G 撤 M28 → 冻结仅 2 对；第 4 周强制轮换', () => {
  const people = [
    { spId: 'J', rankNorm: 1 }, { spId: 'F', rankNorm: 2 }, { spId: 'G', rankNorm: 3 },
    { spId: 'P4', rankNorm: 4, growth3m: 0.05 }, { spId: 'P5', rankNorm: 5, growth3m: 0.02 },
    { spId: 'P6', rankNorm: 6, growth3m: 0.09 }, { spId: 'P7', rankNorm: 7, growth3m: -0.12 },
    { spId: 'P8', rankNorm: 8, growth3m: -0.08 }, { spId: 'P9', rankNorm: 9 }, { spId: 'P10', rankNorm: 10 },
  ];
  const gate4 = ['J', 'F', 'G'];
  const r1 = m40Pairing({ people, gate4PassIds: gate4, m28SignedIds: ['J', 'F', 'G'], prevWeeks: {} });
  const k1 = r1.pairs.map(p => p.coachId + '↔' + p.learnerId).join(' ');
  const q1 = r1.queued.join('/');
  const r2 = m40Pairing({ people, gate4PassIds: gate4, m28SignedIds: ['J', 'F'], prevWeeks: {} });
  const rotate = !pairAllowed(3) && pairAllowed(2);   // 同对第 4 周（consecutiveWeeks=3）强制轮换
  const r3 = m40Pairing({ people, gate4PassIds: gate4, m28SignedIds: ['J', 'F', 'G'], prevWeeks: { 'J|P7': 3 } });
  const k3 = r3.pairs.map(p => p.coachId + '↔' + p.learnerId).join(' ');
  return { pass: k1 === 'J↔P7 F↔P8 G↔P5' && q1 === 'P4/P6'
      && r2.pairs.length === 2 && r2.frozenCoachIds.indexOf('G') >= 0 && rotate
      && k3 === 'J↔P8 F↔P5 G↔P4',   // 轮换后 J 不再配 P7
    got: k1 + ' 候补 ' + q1 + '；冻结=' + r2.frozenCoachIds.join(',') + '；轮换周=' + k3,
    want: 'J↔P7 F↔P8 G↔P5 候补 P4/P6；冻结=G 仅2对；J|P7 满3周后强制换' };
});

/* T14 —— M41：连败4 + 赢率30%→18% → 分 0.64 触发；卡与词库切换生效 */
T('T14', 'M41：连败4 + 赢率30%→18% → 0.64 触发；动量期加压词拦截', () => {
  const m = momentum(4, 0.30, 0.18);
  const plv = plvCheck('必须拿下这一单', { momentum: true });
  return { pass: m.score === 0.64 && m.triggered === true && !plv.l1.pass,
    got: 'score=' + m.score + '，动量期命中=' + plv.l1.hits.join('、'), want: '0.64 触发 + 拦"必须拿下"' };
});

/* T15 —— M42：dist(W)=3万 < dist(V)=18万 → 榜样=W；匹配空 → "—" */
T('T15', 'M42：dist(W)=3万 < dist(V)=18万 → 榜样=W；空集 → null("—")', () => {
  const P = [2, 2, 3, 3, 4, 4];
  const best = m42Match(P, [
    { spId: 'W', traj: [2, 3, 3, 4, 4, 5], nowBandOk: true },
    { spId: 'V', traj: [5, 5, 6, 6, 7, 7], nowBandOk: true }]);
  const none = m42Match(P, []);
  return { pass: best.spId === 'W' && best.dist === 3
      && trajDistance(P, [5, 5, 6, 6, 7, 7]) === 18 && none === null,
    got: 'W=' + best.dist + '万 V=18万；空集=' + safeShow(none), want: 'W(3) 胜 V(18)；空集 null' };
});

/* T16 —— M43：35%→弃赛区+子目标3.3万；70%→加速区；达标→保护区；子目标不入配额
   （Y-D12 引擎级等效：subGoalAmt 无 db 参数=无配额写路径 + 源码扫描零 paceConfig 赋值 + 调用前后配额快照不变） */
T('T16', 'M43：35%→弃赛区+子目标3.3万；70%→加速；达标→保护；子目标不入配额（引擎级）', () => {
  const z1 = paceZone(0.35), z2 = paceZone(0.70), z3 = paceZone(1.05);
  const db = emptyDB();
  db.paceConfig.manualQuotaBySp.x = 5e6;
  const before = JSON.stringify(db.paceConfig);
  const sub = subGoalAmt(10, 300000);   // 剩余 10 工作日 × 日均 0.3万 × 1.1 → 百元取整
  const noQuotaWrite = JSON.stringify(db.paceConfig) === before
    && !/paceConfig\.[A-Za-z]+\s*=/.test(SRC) && !/manualQuotaBySp\[[^\]]*\]\s*=/.test(SRC);
  return { pass: z1 === 'quit_risk' && z2 === 'accel' && z3 === 'protect' && sub === 3300000 && noQuotaWrite,
    got: [z1, z2, z3].join('/') + '，子目标=' + fmtWan(sub) + '，无配额写路径=' + noQuotaWrite,
    want: 'quit_risk/accel/protect，3.3 万，true' };
});

/* T17 —— M44a：0.8/2.0=0.40<0.5 → Y-09 触发；CallMetrics 建表无界面
   （Y-D13 引擎级等效：schema 常量存在 + emptyDB 建表 + 模块源码零 DOM/渲染引用） */
T('T17', 'M44a：0.8/2.0=0.40<0.5 触发；CallMetrics 建表无界面（引擎级）', () => {
  const r = m44aRatio(0.8, 2.0);
  const tableExists = Array.isArray(emptyDB().callMetrics)
    && JSON.stringify(CALLMETRICS_FIELDS) === JSON.stringify(['cmId', 'employeeId', 'callDate', 'talkListenRatio', 'questionCount', 'durationSec']);
  const noUI = SRC.indexOf('document.') < 0 && SRC.indexOf('innerHTML') < 0
    && SRC.indexOf('render' + 'CallMetrics') < 0 && SRC.indexOf('<div') < 0;
  return { pass: r === 0.4 && r < 0.5 && tableExists && noUI,
    got: '比值=' + r + '，建表=' + tableExists + '，无界面=' + noUI, want: '0.4，true，true' };
});

/* T18 —— 信封：导入三包 → 闸④③⑨⑩点亮；导出 board=yuren 含辅导剂量（shared.buildEnvelope） */
T('T18', '信封：三包导入点亮闸④③⑨⑩；导出 board=yuren 含辅导剂量', () => {
  const db = emptyDB();
  db.salespeople = [{ spId: 'a', isActive: true }, { spId: 'b', isActive: true }];
  db.coachingAcks = [
    { ackId: 'k1', spId: 'a', date: '2026-07-01', durationHrs: 4, status: 'confirmed' },
    { ackId: 'k2', spId: 'b', date: '2026-07-02', durationHrs: 2, status: 'disputed' }];   // disputed 不计剂量
  const i1 = importEnvelope(db, { schema: 'skab_v1', board: 'suanzhang', exportedAt: '2026-07-10', dataVersion: 1,
    derived: { uerTeamMean: 0 },
    entities: { M21Norm: [{ spId: 'a', rankNorm: 1, uer: 0.5 }], UnknownEntity: [{ x: 1 }] } }, TEST_TODAY);
  const i2 = importEnvelope(db, { schema: 'skab_v1', board: 'liuren', exportedAt: '2026-07-11', dataVersion: 1,
    derived: { ahcBySp: { a: 78 } }, entities: { M28Agreement: [{ spId: 'a', irrevocable: true }] } }, TEST_TODAY);
  const i3 = importEnvelope(db, { schema: 'skab_v1', board: 'zhaoren', exportedAt: '2026-07-12', dataVersion: 1,
    derived: {}, entities: { PracticeLog: [{ spId: 'a', count14: 88 }] } }, TEST_TODAY);
  const lit = XREF.m21Done(db) && XREF.ahc(db, 'a') === 78 && !!XREF.m28(db, 'a') && XREF.practice14(db, 'a') === 88;
  const skipped = !db.externalRef.suanzhang.entities.UnknownEntity;   // 未知实体静默跳过（向前兼容）
  const env = exportEnvelope(db, TEST_TODAY);
  // 30 天窗内 confirmed 4h ÷ 2 人 × (30/30) = 2.0 h/人·月
  const doseOk = env.board === 'yuren' && env.derived.coachingDoseActual === 2.0
    && env.schema === 'skab_v1' && Array.isArray(env.entities.DailyReport);
  return { pass: i1.ok && i2.ok && i3.ok && lit && skipped && doseOk,
    got: '剂量=' + env.derived.coachingDoseActual + 'h/人·月，点亮=' + lit + '，未知实体跳过=' + skipped,
    want: '2.0h/人·月，true，true' };
});

/* T19 —— 闸⑧三态（Y-C05/Y-D16）：拦截/放行/豁免 + 与 4号留人器闸③ 同输入同结果（直接断言判定函数输出） */
T('T19', '闸⑧三态：结果赏∧未启→拦截+Y-13；已启→放行；首单赏豁免；与 4号闸③ 同输入同结果', () => {
  const a = bountyGate('record_break', false);
  const b = bountyGate('record_break', true);
  const c = bountyGate('first_deal', false);
  const y13 = TALK.y13(TALK.bountyNames.record_break);
  // 🔴 与 4号留人器闸③（公约 A-12 逐字同源，R-04）同输入同结果：全模板 × 通道两态穷举比对
  const templates = ['first_deal', 'record_break', 'sprint', 'backlog_clear', 'hire'];
  let sameAsLiuren = true;
  for (const t of templates) for (const on of [false, true]) {
    if (bountyGate(t, on).allow !== liurenBountyGate(t, on).ok) sameAsLiuren = false;
  }
  // grep 无"结果类一律拦截"旧逻辑：结果类在通道开启时必须可存（b.allow 已证）
  return { pass: a.allow === false && a.state === 'blocked' && a.talk === 'Y-13'
      && b.allow === true && b.state === 'pass' && c.allow === true && c.state === 'exempt'
      && y13.indexOf('不是不许用钱，是不许只有钱') >= 0
      && isResultTrigger('sprint') && isExempt('hire') && sameAsLiuren,
    got: [a.state, b.state, c.state].join('/') + '，与4号一致=' + sameAsLiuren,
    want: 'blocked/pass/exempt，true' };
});

/* ================= 运行器 ================= */
console.log(`件七对拍 T1–T19 · 5号育人器 v2.3 → 云端 C1 · TEST_TODAY=${TEST_TODAY}（公约 C-14/R-11 时钟注入）\n`);
let green = 0;
for (const c of cases) {
  let r;
  try { r = c.fn(); }
  catch (e) { r = { pass: false, got: `异常: ${e.message}`, want: '' }; }
  const ok = !!r.pass;
  if (ok) green++;
  console.log(`${ok ? '✓' : '✗'} ${c.id} ${c.title}`);
  if (!ok) console.log(`    got:  ${r.got}\n    want: ${r.want}`);
}
console.log(`\n${green}/${cases.length} 绿`);
if (green !== cases.length) process.exit(1);
