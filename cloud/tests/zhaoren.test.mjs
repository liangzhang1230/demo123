/* ============================================================
   2号《销冠招人器》v3.2 · 件七对拍 T1–T24（Node 对拍，三绿=收货）
   测试冻结注入（公约 C-14 / R-11）：TEST_TODAY='2026-07-13'、targetYear=2026
   黄金值逐字照规格件七；UI 断言实现为引擎级等效并逐条标注。
   运行：node cloud/tests/zhaoren.test.mjs
   ============================================================ */
import {
  WAN, fmtWan, fmtPct, toWan,
  capacityChain, gateVerdicts, validateWeights, darkTriadScore,
  validityR, collapseStats, rpiValue, rpiPredict, verifyRPI,
  epsScorecard, systemRecommend, priceTag, referralBonus, qcs,
  maskName, maskPhone, dedupPhone, cognitiveGap, autoConfirm, practiceGate,
  hireCandidate, exportEnvelope, importEnvelope,
  SIM, f11people, HIRING_WEIGHTS_FACTORY,
} from '../domain/zhaoren.mjs';
import { newHireYearRate, getCoef } from '../domain/shared.mjs';

const TEST_TODAY = '2026-07-13';       // 🔴 注入值（R-11：凡含日期的对拍逐字写明）
const TARGET_YEAR = 2026;              // 🆕 Z-C07：targetYear=2026（"改算今年"口径）
const CTX = { today: TEST_TODAY, targetYear: TARGET_YEAR };

/* 出厂对拍输入（规格 3.1）：1800万/100万/10人/短期/30%/45天/28万/主管2人 */
const INP = { targetYearGrossAmt: 1800 * WAN, perCapitaActualAmt: 100 * WAN, salesCount: 10,
  cycleTier: 'short', attritionRate: 0.30, hiringCycleDays: 45, fullLoadCostAmt: 28 * WAN, managerCount: 2 };

const near = (a, b, e = 1e-6) => a != null && Math.abs(a - b) <= e;
const results = [];
function T(id, name, ok, got, want) { results.push({ id, name, ok: !!ok, got, want }); }

/* —— 公约 §4.7 咬合基准（R-05：基准①测不出 C-04，必须双基准同跑） —— */
const b1 = newHireYearRate('short', 1), b2 = newHireYearRate('short', 5);
if (!(near(b1, 0.658333, 1e-4) && near(b2, 0.325, 1e-4))) {
  console.error(`✗ 咬合基准失败：newHireYearRate('short',1)=${b1}（应 65.8%）、('short',5)=${b2}（应 32.5%）`);
  process.exit(1);
}

const r = capacityChain(INP, CTX);

/* T1 k(短期,1月)=65.8% 且 kEff=55.96%（🔧Z-C06） */
T('T1', 'k(短期,1月)=65.8% ∧ kEff=55.96%', near(r.k1, 0.658333, 1e-4) && near(r.kEff1, 0.559583, 1e-4), [r.k1, r.kEff1], [0.658333, 0.559583]);
/* T2 trueHires=20 */
T('T2', 'trueHires=20', r.trueHires === 20, r.trueHires, 20);
/* T3 naive=8 */
T('T3', 'naive=8', r.naiveHires === 8, r.naiveHires, 8);
/* T4 高估率=60.0% */
T('T4', '高估率=60.0%', fmtPct(r.overRate) === '60.0%', fmtPct(r.overRate), '60.0%');
/* T5 最晚开招=2025-11-17 且晚238天（TEST_TODAY=2026-07-13、targetYear=2026） */
T('T5', '最晚开招=2025-11-17 ∧ 晚238天', r.latestStart === '2025-11-17' && r.lateDays === 238 && r.isLate && r.latestJoinMonth === 1,
  [r.latestStart, r.lateDays, r.latestJoinMonth], ['2025-11-17', 238, 1]);
/* T6 边际利润56.0万 */
T('T6', '边际利润=56.0万', fmtWan(r.marginProfit) === '56.0万', fmtWan(r.marginProfit), '56.0万');
/* T7 边际成本29.5万（28+1.5 完全招聘成本） */
T('T7', '边际成本=29.5万', fmtWan(r.marginCost) === '29.5万', fmtWan(r.marginCost), '29.5万');
/* T8 净增26.5万/人（欠配闸③同时应触发） */
T('T8', '净增=26.5万 ∧ 欠配触发', fmtWan(r.netGain) === '26.5万' && r.underStaffed === true, [fmtWan(r.netGain), r.underStaffed], ['26.5万', true]);
/* T9 span=8/需4/缺2/纯辅导0分钟（targetHeads=30） */
T('T9', 'span=8/需主管4/缺2/纯辅导0分钟(targetHeads=30)',
  r.span === 8 && r.managerNeeded === 4 && r.mgrGap === 2 && r.pureCoachMin === 0 && r.targetHeads === 30,
  [r.span, r.managerNeeded, r.mgrGap, r.pureCoachMin, r.targetHeads], [8, 4, 2, 0, 30]);
/* T9b ⑤满产系数=70.6% → 带内 ✓（Z-C06 改用 kEff 后短周期不再误报黄） */
T('T9b', '满产系数=70.6% 带内✓', fmtPct(r.fullRampCoef) === '70.6%' && r.fullRampFlag === 'green', [fmtPct(r.fullRampCoef), r.fullRampFlag], ['70.6%', 'green']);
/* T10 闸⑫ 鸿沟 = 1−19/42 = 54.8% 红（>30% 红线） */
const gap = cognitiveGap(42, 19);
const g12 = gateVerdicts(r, {}, { ack: { reported: 42, confirmed: 19 } }).find(g => g.id === 'G12');
T('T10', '鸿沟=1−19/42=54.8% 红', fmtPct(gap) === '54.8%' && gap > getCoef('zhaoren.cognitiveGapRedline') && g12 && g12.active && g12.light === 'red',
  [fmtPct(gap), g12 && g12.active], ['54.8%', true]);
/* T11 no_response 第8天自动 confirmed（第7天不确认） */
T('T11', 'no_response第8天自动confirmed', autoConfirm(8) === true && autoConfirm(7) === false, [autoConfirm(8), autoConfirm(7)], [true, false]);
/* T12–T15 F11 模拟集（原版 HTML SIM 常量，12 人） */
const P = f11people();
const rAch = validityR(P, 'achievement'), rCha = validityR(P, 'charisma'), rExp = validityR(P, 'experience');
T('T12', 'F11 成就 r=+0.38', rAch.r != null && rAch.r.toFixed(2) === '0.38', rAch.r, '+0.38');
T('T13', 'F11 魅力 r=−0.09', rCha.r != null && rCha.r.toFixed(2) === '-0.09', rCha.r, '-0.09');
T('T14', 'F11 经验 r=−0.11', rExp.r != null && rExp.r.toFixed(2) === '-0.11', rExp.r, '-0.11');
const r11 = validityR(P.slice(0, 11), 'achievement');
T('T15', 'F11 样本11→null"—"', r11.r === null && r11.n === 11, [r11.r, r11.n], [null, 11]);
/* T16 闸⑪ 练习 8/50 → 红 + S曲线右移2月；Z-06 变量注入为引擎级等效断言：
   practiceGate 返回 {count:8, floor:50, shiftMonths:2} 即话术 Z-06 的 {n}/{floor}/{m2−m1} 变量源（UI 断言→引擎级） */
const pg = practiceGate(8);
const g11 = gateVerdicts(r, {}, { practiceCount14d: 8 }).find(g => g.id === 'G11');
T('T16', '练习8/50→红+右移2月（Z-06变量注入·引擎级等效）',
  pg.red && pg.shiftMonths === 2 && pg.count === 8 && pg.floor === 50 && g11 && g11.active,
  [pg.red, pg.shiftMonths, pg.count, pg.floor], [true, 2, 8, 50]);
/* T17 ROI = 20×3×8.3万 = 498万（🔧Z-C06） */
T('T17', 'ROI=20×3×8.3万=498万', r.roiWan === 498 && fmtWan(r.roiAmt) === '498.0万', [r.roiWan, fmtWan(r.roiAmt)], [498, '498.0万']);
/* T18 F12 模拟：崩塌率67%（4/6）、月份中位12.5 */
const cs = collapseStats(SIM.f12);
T('T18', 'F12 崩塌率67%(4/6) ∧ 月中位12.5', near(cs.rate, 4 / 6) && cs.medianMonth === 12.5 && fmtPct(cs.rate, 0) === '67%', [cs.rate, cs.medianMonth], [4 / 6, 12.5]);
/* T19 F13：RPI=0.70 + 黑暗中位68(均42)/成就中位31(均55) → "预测被验证" */
const rpi = rpiValue(0.70, 5000_00, 5000_00);
const v19 = verifyRPI(rpi, { median: 68, teamMean: 42 }, { median: 31, teamMean: 55 });
T('T19', 'RPI=0.70 + 中位68/31 → verified', near(rpi, 0.70) && rpiPredict(rpi) === 'gambler' && v19 === 'verified', [rpi, v19], [0.70, 'verified']);
/* T20 F14：EPS=−16.0万（推翻组均21万−遵从组均37万）、推翻率9/40=22.5%>20% 预警 */
const sc = epsScorecard(SIM.f14_against, SIM.f14_comply, SIM.f14_over, SIM.f14_dec);
T('T20', 'EPS=−16.0万 ∧ 推翻率22.5%>20%预警', fmtWan(sc.eps) === '-16.0万' && fmtPct(sc.overrideRate) === '22.5%' && sc.warn === true,
  [fmtWan(sc.eps), fmtPct(sc.overrideRate), sc.warn], ['-16.0万', '22.5%', true]);
/* T21 F15：价签=12.5+34.17+1.5=48.17万 → 内推奖¥4,800；QCS referral 88 vs boss_zhipin 61 */
const tag = priceTag(INP), bonus = referralBonus(tag.tagAmt), ch = SIM.channels;
T('T21', '价签48.17万 ∧ 内推奖¥4,800 ∧ QCS 88 vs 61',
  toWan(tag.tagAmt).toFixed(2) === '48.17' && bonus === 4800 && Math.round(qcs(ch[0], ch)) === 88 && Math.round(qcs(ch[1], ch)) === 61,
  [toWan(tag.tagAmt).toFixed(2), bonus, Math.round(qcs(ch[0], ch)), Math.round(qcs(ch[1], ch))], ['48.17', 4800, 88, 61]);
/* T22 查重三态：表内重复→拦截+脱敏（姓+*、前三后二）；在职→拦截；离职→放行黄条（曾于{年月}在职） */
const dctx = { candidates: [{ phone: '13800000138', name: '张三' }],
  employees: [{ phone: '13900000139', isActive: true }, { phone: '13700000137', isActive: false, leaveDate: '2024-05-01', leaveReason: 'resign_other' }] };
const d1 = dedupPhone('13800000138', dctx), d2 = dedupPhone('13900000139', dctx), d3 = dedupPhone('13700000137', dctx);
T('T22', '查重三态（拦截脱敏/在职拦截/离职放行黄条）',
  d1.verdict === 'block' && d1.tip.includes('张*') && d1.tip.includes('138****38') &&
  d2.verdict === 'block' && d2.reason === 'active' &&
  d3.verdict === 'pass' && d3.warn === true && d3.tip.includes('2024-05'),
  [d1.verdict, d2.verdict, d3.verdict, d1.tip], ['block+张*+138****38', 'block', 'pass+warn+2024-05']);
/* T23 hired→Employee 建档回链 + 黑暗明细/joltType 销毁（Z-D1，转池函数删除明细字段·引擎级断言；
   "弹窗必填齐全"UI 断言→引擎级等效：form 必填字段全部落入 Employee） */
const hired = hireCandidate(
  { candId: 'c', sourceChannel: 'referral' },
  { packId: 'p', candId: 'c', scores: { achievement: 70 }, darkTriadScore: 55, darkTriadDetail: { a: 1 }, joltType: 'jolt', scoredDate: '2026-06-01' },
  { stamp: '1', name: '李四', phone: '13911112222', hireDate: '2026-07-01', hiringCostAmt: 15000_00, startBaseSalaryAmt: 5000_00, batchId: '2026-Q3', mentorManagerName: '王' });
T('T23', 'hired建档回链 ∧ 黑暗明细/joltType 销毁（Z-D1）',
  hired.employee.spId === hired.candLink && hired.employee.sourceChannel === 'referral' &&
  hired.employee.hireDate === '2026-07-01' && hired.employee.hiringCostAmt === 15000_00 &&
  hired.employee.baseSalaryAmt === 5000_00 && hired.employee.hireBatchId === '2026-Q3' &&
  hired.scorePackAfter.darkTriadScore === 55 && hired.scorePackAfter.employeeId === hired.employee.spId &&
  hired.scorePackAfter.darkTriadDetail === undefined && hired.scorePackAfter.joltType === undefined &&
  !('darkTriadDetail' in hired.scorePackAfter) && !('joltType' in hired.scorePackAfter),
  [hired.candLink, hired.scorePackAfter.darkTriadDetail, hired.scorePackAfter.joltType], ['emp_1', undefined, undefined]);
/* T24 信封：导出 board=zhaoren（shared.buildEnvelope）；导入定价器信封（shared.validateEnvelope）→ derived 点亮 RPI */
const env = exportEnvelope({ entities: { Candidate: [] }, derived: {}, today: TEST_TODAY });
const imp = importEnvelope({ schema: 'skab_v1', board: 'dingjia', exportedAt: '2026-07-01', dataVersion: 1,
  coefficientsHash: '', derived: { rpiFloatShare: 0.70, survivalLine: 5000_00, matrixB: 5000_00 }, entities: {} }, TEST_TODAY);
const lit = imp.ok ? rpiValue(imp.ref.derived.rpiFloatShare, imp.ref.derived.survivalLine, imp.ref.derived.matrixB) : null;
const impBad = importEnvelope({ schema: 'nope' });
T('T24', '信封导出board=zhaoren ∧ 导入定价器derived点亮RPI=0.70',
  env.schema === 'skab_v1' && env.board === 'zhaoren' && env.exportedAt === TEST_TODAY && env.dataVersion === 1 &&
  imp.ok && imp.board === 'dingjia' && near(lit, 0.70) && impBad.ok === false,
  [env.board, imp.board, lit], ['zhaoren', 'dingjia', 0.70]);

/* —— 附带回归哨兵（不计入 24 条）：出厂权重Σ=100、荐才线60、黑暗三角公式 —— */
const vw = validateWeights(HIRING_WEIGHTS_FACTORY);
const extra = vw.ok && systemRecommend(60) === 'hire' && systemRecommend(59) === 'reject'
  && near(darkTriadScore({ externalAttrib: 100, detailMissing: 100, charisma: 100, detail: 0, selfMention: 100 }), 100);
if (!extra) { console.error('✗ 回归哨兵失败（出厂权重Σ/荐才线/黑暗三角公式）'); process.exit(1); }

/* —— 输出（件七=24 条：T9b 为 T9 的 Z-C06 子断言，逐行显示、并入 T9 计数 · R-10 徽章数=24） —— */
for (const t of results) {
  if (t.ok) console.log(`✓ ${t.id.padEnd(4)} ${t.name}`);
  else console.log(`✗ ${t.id.padEnd(4)} ${t.name}\n    got=${JSON.stringify(t.got)} want=${JSON.stringify(t.want)}`);
}
const okOf = id => { const t = results.find(x => x.id === id); return t ? t.ok : false; };
const mainIds = results.map(t => t.id).filter(id => id !== 'T9b');
const green = mainIds.filter(id => id === 'T9' ? (okOf('T9') && okOf('T9b')) : okOf(id)).length;
console.log(`\n${green}/${mainIds.length} 绿  （注入：TEST_TODAY=${TEST_TODAY}、targetYear=${TARGET_YEAR}）`);
if (green !== mainIds.length) process.exit(1);
