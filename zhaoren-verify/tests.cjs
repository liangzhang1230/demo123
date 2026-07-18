/* 24 条对拍 (件七)  —  三绿方交付。测试冻结注入 TEST_TODAY=2026-07-13 / targetYear=2026 (公约 C-14/R-11) */
const E = require('./engine.cjs');
const WAN = E.WAN;
let pass = 0, fail = 0; const fails = [];
function ok(id, cond, got) { if (cond) { pass++; } else { fail++; fails.push(`${id}  got=${JSON.stringify(got)}`); } }
function near(a, b, eps) { return a != null && Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

const TODAY = '2026-07-13', TARGET = 2026;
const ctx = { today: TODAY, targetYear: TARGET };

/* ---- F1 七步链 ---- */
const inp = {
  targetYearGrossAmt: 1800 * WAN, perCapitaActualAmt: 100 * WAN, salesCount: 10,
  cycleTier: 'short', attritionRate: 0.30, hiringCycleDays: 45,
  fullLoadCostAmt: 28 * WAN, managerCount: 2, planMonth: 1
};
const r = E.capacityChain(inp, ctx);

ok('T1 k(short,1)=65.8% & kEff=55.96%', near(r.k1, 0.658333, 1e-4) && near(r.kEff1, 0.559583, 1e-4), [r.k1, r.kEff1]);
ok('T2 trueHires=20', r.trueHires === 20, r.trueHires);
ok('T3 naive=8', r.naiveHires === 8, r.naiveHires);
ok('T4 高估率=60.0%', E.fmtPct(r.overRate) === '60.0%', E.fmtPct(r.overRate));
ok('T5 最晚开招=2025-11-17 & 晚238天', r.latestStart === '2025-11-17' && r.lateDays === 238, [r.latestStart, r.lateDays]);
ok('T6 边际利润=56.0万', E.fmtWan(r.marginProfit) === '56.0万', E.fmtWan(r.marginProfit));
ok('T7 边际成本=29.5万', E.fmtWan(r.marginCost) === '29.5万', E.fmtWan(r.marginCost));
ok('T8 净增=26.5万', E.fmtWan(r.netGain) === '26.5万', E.fmtWan(r.netGain));
ok('T9 span8/需4/缺2/纯辅导0 (heads30)',
  r.span === 8 && r.managerNeeded === 4 && r.mgrGap === 2 && r.pureCoachMin === 0 && r.targetHeads === 30,
  [r.span, r.managerNeeded, r.mgrGap, r.pureCoachMin, r.targetHeads]);
ok('T9b ⑤满产系数=70.6% 带内✓', E.fmtPct(r.fullRampCoef) === '70.6%' && r.fullRampFlag === 'green', [E.fmtPct(r.fullRampCoef), r.fullRampFlag]);

/* ---- 闸①/③ ---- */
const gates = E.gateVerdicts(r, { weights: E.DEFAULT_COEF.hiringWeightsFactory });
ok('闸① 高估激活 & 闸③ 欠配激活',
  gates.find(g => g.id === 'G1').active === true && gates.find(g => g.id === 'G3').active === true, gates.map(g => [g.id, g.active]));

/* ---- 闸⑫ 认知鸿沟 T10 / 自动确认 T11 ---- */
ok('T10 鸿沟=1−19/42=54.8%红', E.fmtPct(E.cognitiveGap(42, 19)) === '54.8%' && E.cognitiveGap(42, 19) > 0.30, E.fmtPct(E.cognitiveGap(42, 19)));
ok('T11 no_response 第8天自动confirmed', E.autoConfirm(8) === true && E.autoConfirm(7) === false, [E.autoConfirm(8), E.autoConfirm(7)]);

/* ---- F11 效度 T12–T15 ---- */
const F11_Y = [82, 41, 63, 90, 28, 55, 74, 47, 60, 35, 69, 51];
const F11_ACH = [50, 44, 48, 68, 40, 59, 50, 64, 61, 50, 50, 65];
const F11_CHA = [48, 62, 50, 60, 49, 43, 44, 42, 68, 67, 55, 48];
const F11_EXP = [40, 51, 66, 45, 48, 47, 59, 73, 66, 43, 57, 74];
const people11 = F11_Y.map((y, i) => ({ margin12: y, scores: { achievement: F11_ACH[i], charisma: F11_CHA[i], experience: F11_EXP[i] } }));
ok('T12 成就 r=+0.38', E.validityR(people11, 'achievement').r.toFixed(2) === '0.38', E.validityR(people11, 'achievement').r);
ok('T13 魅力 r=−0.09', E.validityR(people11, 'charisma').r.toFixed(2) === '-0.09', E.validityR(people11, 'charisma').r);
ok('T14 经验 r=−0.11', E.validityR(people11, 'experience').r.toFixed(2) === '-0.11', E.validityR(people11, 'experience').r);
const people11short = people11.slice(0, 11); // 11 样本 → null
ok('T15 样本11→null"—"', E.validityR(people11short, 'achievement').r === null, E.validityR(people11short, 'achievement'));

/* ---- T16 练习 8/50 → 右移2月 ---- */
const pg = E.practiceGate(8);
ok('T16 练习8/50→S曲线右移2月', pg.red === true && pg.shiftMonths === 2, pg);

/* ---- T17 ROI=498万 ---- */
ok('T17 ROI=20×3×8.3万=498万', r.roiWan === 498 && E.fmtWan(r.roiAmt) === '498.0万', [r.roiWan, E.fmtWan(r.roiAmt)]);

/* ---- T18 F12 崩塌 ---- */
const highs = [
  { peakScore: 82, collapseMonth: 11, momDrop: -0.55 },
  { peakScore: 78, collapseMonth: 12, momDrop: -0.48 },
  { peakScore: 90, collapseMonth: 13, momDrop: -0.62 },
  { peakScore: 74, collapseMonth: 14, momDrop: -0.44 },
  { peakScore: 76, collapseMonth: null, momDrop: -0.10 },
  { peakScore: 81, collapseMonth: null, momDrop: 0.05 }
];
const cs = E.collapseStats(highs);
ok('T18 崩塌率67% 月中位12.5', near(cs.rate, 4 / 6) && cs.medianMonth === 12.5, [cs.rate, cs.medianMonth]);

/* ---- T19 F13 RPI ---- */
const rpi = E.rpiValue(0.70, 5000_00, 5000_00);
const verdict19 = E.verifyRPI(rpi, { median: 68, teamMean: 42 }, { median: 31, teamMean: 55 });
ok('T19 RPI0.70+中位68/31→预测被验证', near(rpi, 0.70) && verdict19 === 'verified', [rpi, verdict19]);

/* ---- T20 F14 EPS ---- */
const sc = E.overrideScorecard([18 * WAN, 21 * WAN, 24 * WAN], [34 * WAN, 36 * WAN, 38 * WAN, 40 * WAN], 9, 40);
ok('T20 EPS=−16.0万 推翻率22.5%>20%预警',
  E.fmtWan(sc.eps) === '-16.0万' && E.fmtPct(sc.overrideRate) === '22.5%' && sc.warn === true,
  [E.fmtWan(sc.eps), E.fmtPct(sc.overrideRate), sc.warn]);

/* ---- T21 F15 价签/内推奖/QCS ---- */
const tag = E.priceTag(inp);
const bonus = E.referralBonus(tag.tagAmt);
const channels = [
  { name: 'referral', retain12: 0.81, survive90: 0.85, netMean: 43 * WAN },
  { name: 'boss_zhipin', retain12: 0.52, survive90: 0.61, netMean: 31 * WAN }
];
const qRef = E.qcs(channels[0], channels);
const qBoss = E.qcs(channels[1], channels);
ok('T21 价签48.17万/内推奖¥4800/QCS 88vs61',
  E.toWan(tag.tagAmt).toFixed(2) === '48.17' && bonus === 4800 && Math.round(qRef) === 88 && Math.round(qBoss) === 61,
  [E.toWan(tag.tagAmt).toFixed(2), bonus, Math.round(qRef), Math.round(qBoss)]);

/* ---- T22 查重三条 ---- */
const dctx = {
  candidates: [{ phone: '13800000001', name: '张三' }],
  employees: [{ phone: '13800000002', isActive: true }, { phone: '13800000003', isActive: false, leaveDate: '2024-05-01', leaveReason: 'resign_other' }]
};
const d1 = E.dedupPhone('13800000001', dctx);   // 表内 → block + 脱敏
const d2 = E.dedupPhone('13800000002', dctx);   // 在职 → block
const d3 = E.dedupPhone('13800000003', dctx);   // 离职 → pass + warn
ok('T22 查重三条(脱敏拦截/在职拦截/离职放行黄条)',
  d1.verdict === 'block' && d1.tip.includes('张') && d1.tip.includes('****') &&
  d2.verdict === 'block' && d3.verdict === 'pass' && d3.warn === true,
  [d1, d2, d3]);

/* ---- T23 hired→Employee + 黑暗明细销毁 ---- */
const cand = { candId: 'cand_1', sourceChannel: 'referral' };
const pack = { packId: 'p1', candId: 'cand_1', scores: { achievement: 70, charisma: 20 }, darkTriadScore: 55, darkTriadDetail: { a: 1 }, joltType: 'jolt', scoredDate: '2026-06-01' };
const hired = E.hireCandidate(cand, pack, { stamp: '123', name: '李四', phone: '13900000000', hireDate: '2026-07-01', hiringCostAmt: 15000_00, startBaseSalaryAmt: 5000_00, batchId: 'b1', mentorManagerName: '王经理' });
ok('T23 hired回链齐全 & 黑暗明细销毁',
  hired.employee.spId === hired.candLink &&
  hired.scorePackAfter.darkTriadScore === 55 &&
  hired.scorePackAfter.scores.achievement === 70 &&
  hired.scorePackAfter.darkTriadDetail === undefined &&
  hired.scorePackAfter.joltType === undefined &&
  hired.employee.name === '李四' && hired.employee.phone === '13900000000' && hired.employee.hireDate === '2026-07-01',
  hired.scorePackAfter);

/* ---- T24 信封 board=zhaoren + 导入定价器信封点亮 RPI ---- */
const env = E.buildEnvelope({ Candidate: [] }, { }, { today: TODAY });
const pricingEnv = { schema: 'skab_v1', board: 'dingjia', exportedAt: '2026-07-01', dataVersion: 1, derived: { rpiFloatShare: 0.70, survivalLine: 5000_00, matrixB: 5000_00 }, entities: {} };
const imp = E.importEnvelope(pricingEnv);
const rpiLit = imp.ok && E.rpiValue(imp.ref.derived.rpiFloatShare, imp.ref.derived.survivalLine, imp.ref.derived.matrixB);
ok('T24 导出board=zhaoren & 导入定价器→RPI点亮',
  env.schema === 'skab_v1' && env.board === 'zhaoren' && imp.board === 'dingjia' && near(rpiLit, 0.70),
  [env.board, imp.board, rpiLit]);

/* ---- 结果 ---- */
console.log('\n================  对拍自检  ================');
if (fails.length) { console.log('❌ FAILED:'); fails.forEach(f => console.log('   ' + f)); }
console.log(`\n结果: ${pass} 绿 / ${fail} 红   (共 ${pass + fail} 条)`);
process.exit(fail ? 1 : 0);
