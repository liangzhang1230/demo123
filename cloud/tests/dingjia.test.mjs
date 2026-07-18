/* ============================================================
   件七 · 定价器 25 条对拍（徽章口径：五件套 13 + 风洞 10 + 合规 2）
   运行：node cloud/tests/dingjia.test.mjs → 逐条 ✓/✗ + "N/25 绿"，失败 exit 1
   时钟注入（公约 C-14 / R-11）：TEST_TODAY='2026-07-13'；
   targetYear：T-B1=2027、T-B4=2026；其余不涉日期。
   黄金值逐字照《1号定价器 v2.5》件三/件七，禁止改黄金值。
   纯 UI 断言实现为引擎级等效，用例名标注 [UI等效→引擎级]。
   ============================================================ */
import {
  validateInputs, calcCardA, calcCardB, calcCardC, calcCardD, calcCardE, calcTotalLine,
  generateMenu, makeMenuChoice, gateFraudRisk, gateAlignment,
  checkGuardrail, countProcessRedlines, explorationContract, leakSandbox, LEAK_MAP,
} from '../domain/dingjia.mjs';
import { getCoef, makeGetCoef, newHireYearRate } from '../domain/shared.mjs';

const TEST_TODAY = '2026-07-13';
const W = n => n * 1e6;               // 万元 → 分
const pct1 = v => (v * 100).toFixed(1);
const pct2 = v => (v * 100).toFixed(2);
const wan1 = fen => (fen / 1e6).toFixed(1);
const wan2 = fen => (fen / 1e6).toFixed(2);

/* ---- 零依赖 assert 收集器 ---- */
const results = [];
function T(id, name, fn) {
  try { fn(); results.push({ id, name, ok: true }); }
  catch (e) { results.push({ id, name, ok: false, err: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(got, want, label) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  assert(g === w, `${label}: got=${g} want=${w}`);
}
function close(got, want, eps, label) {
  assert(got != null && Math.abs(got - want) <= eps, `${label}: got=${got} want≈${want}`);
}

/* ---- 咬合基准前置（公约 §4.7：两个基准缺一不可，只跑基准①视为未验证） ---- */
eq(pct1(newHireYearRate('short', 1)), '65.8', '咬合基准① newHireYearRate(short,1)');
eq(pct1(newHireYearRate('short', 5)), '32.5', '咬合基准② newHireYearRate(short,5)');

/* ---- fixtures ---- */
const inputsA = {   // 对拍A：tier1/short/effective；G 由 I4/I5+结构(10/2/1)函数级得出；部门年毛利 1200 万
  cityTier: 'tier1', cycleTier: 'short', tierGrade: 'effective',
  targetPersonalMonthlyGrossAmt: W(10), nextYearTargetGrossAmt: W(1200), lastYearPerCapitaGrossAmt: W(100),
  salesCount: 10, managerCount: 2, attritionRate: 0.35, hiringCycleDays: 45, blendedMarginRate: 0.30,
  complementLevel: 'partial', attributableLevel: 'partial',
};
const inputsB = {   // 对拍B：1000万/100万/5人/regular/35%/45天
  cityTier: 'tier1', cycleTier: 'regular', tierGrade: 'effective',
  targetPersonalMonthlyGrossAmt: W(9), nextYearTargetGrossAmt: W(1000), lastYearPerCapitaGrossAmt: W(100),
  salesCount: 5, managerCount: 1, attritionRate: 0.35, hiringCycleDays: 45, blendedMarginRate: 0.30,
  complementLevel: 'partial', attributableLevel: 'partial',
};
const inputsB4 = {  // 对拍B-咬合：招人器出厂算例 1800万/100万/10人/短期/30%/45天
  ...inputsB, cycleTier: 'short', nextYearTargetGrossAmt: W(1800), salesCount: 10, attritionRate: 0.30,
};

/* ================= 五件套 13 条 ================= */

T('T-A1', '对拍A：r=19.5/4.7/2.86%、负担率27.06%、全口径47.0万→47.0%（五常量写死）', () => {
  eq(validateInputs(inputsA).ok, true, '输入校验');
  const A = calcCardA(inputsA, 2, 10);
  close(A.rows[0].r, 0.195, 1e-12, 'r_sales');
  close(A.rows[1].r, 0.047, 1e-12, 'r_manager');
  close(A.rows[2].r, 0.0286, 1e-12, 'r_executive');
  close(A.burdenRate, 0.2706, 1e-12, '负担率');
  close(A.fullMonthlyAmt, 47000000, 1e-6, '全口径 47.0 万/月（恰为整数）');   // 分
  close(A.fullBurdenRate, 0.47, 1e-12, '全口径负担率 47.0%');
  eq(pct1(A.fullRevShare), '14.1', '折营收 ≈14.1%');
  // 验算月入 = B + gap + long = T：3.0/4.0/5.4 万
  A.rows.forEach((r, i) => eq(r.B + r.gapAmt + r.longAmt, [3000000, 4000000, 5400000][i], `月入验算层${i}`));
  eq(A.gates.find(g => g.id === 5).code, 'ok', '负担率带内绿');
});

T('T-A2', 'B改27,500→W-02 拦截卡、该层 r 不出 [UI等效→引擎级]', () => {
  const A = calcCardA(inputsA, 2, 10, getCoef, { sales: 2750000 });
  eq(A.rows[0].blocked, true, '闸①拦截');
  eq(A.rows[0].r, null, 'r 不出（null）');
  const g = A.gates.find(g => g.code === 'W-02');
  assert(g && g.vars.level === 'sales' && g.vars.B === 2750000, 'W-02 码+变量注入');
});

T('T-A3', 'G=0→r="—"（null）无 NaN [UI等效→引擎级]', () => {
  const A = calcCardA({ ...inputsA, targetPersonalMonthlyGrossAmt: 0 }, 2, 10);
  eq(A.rows[0].r, null, 'G=0 → safeDiv → null');
  assert(!A.rows.some(r => Number.isNaN(r.r)), '全卡无 NaN');
});

T('T-B1', '对拍B：S1=5 S6=16 高估68.8% 暴露461.2万 最晚入职1月 开招2026-11-17未晚（targetYear=2027）', () => {
  const B = calcCardB(inputsB, TEST_TODAY, 2027);
  eq(B.ok, true, '整卡可算');
  eq(pct1(B.k1), '51.8', 'k(1)=0.5183');
  eq(pct2(B.kEff1), '42.76', 'kEff(1)=0.4276（🔧C-14）');
  eq(B.S1, 5, 'S1 天真');
  close(B.gapCap, 6.75, 1e-12, '缺口当量');
  eq(B.S6, 16, 'S6 六步链');
  eq(pct1(B.overRate), '68.8', '高估率');
  eq(wan1(B.exposeAmt), '461.2', '高估暴露');
  eq(B.latestMonth, 1, '最晚入职月（🔧C-06 HEAD 口径）');
  eq(B.latestHireDate, '2026-11-17', '最晚开招日');
  eq(B.isLate, false, '未晚');
  eq(B.ramp80, 9, 'ramp80=9');
  eq(B.code, 'W-07', 'W-07 判定码');
  eq([B.vars.S1, B.vars.S6, B.vars.diff, B.vars.deadline], [5, 16, 11, '2026-11-17'], 'W-07 注入变量');
});

T('T-B2', 'I6=0→整卡"—"（ok:false）[UI等效→引擎级]', () => {
  const B = calcCardB({ ...inputsB, lastYearPerCapitaGrossAmt: 0 }, TEST_TODAY, 2027);
  eq(B.ok, false, '整卡拒算');
});

T('T-B3', 'I7=20/I6=100万/I5=1000万→S1=0 且 S6 与手算一致', () => {
  const B = calcCardB({ ...inputsB, salesCount: 20 }, TEST_TODAY, 2027);
  eq(B.S1, 0, 'S1=max(0,10−20)=0');
  // 手算：缺口当量 = 10 − 20 + 20×0.35 = −3 → S6 = max(0, ceil(−3/0.427625)) = 0
  close(B.gapCap, -3, 1e-12, '缺口当量=−3');
  eq(B.S6, 0, 'S6 与手算一致（=0）');
});

T('T-B4', '跨板块咬合：短期1800万→S6=20 S1=8 高估60.0% 开招2025-11-17晚238天（targetYear=2026）', () => {
  const B = calcCardB(inputsB4, TEST_TODAY, 2026);
  eq(pct1(B.k1), '65.8', 'k(1)=65.8%（咬合基准①）');
  eq(pct2(B.kEff1), '55.96', 'kEff(1)=55.96%（🔧C-14）');
  eq(B.S1, 8, 'S1');
  eq(B.S6, 20, 'S6');
  eq(pct1(B.overRate), '60.0', '高估率（🔧C-14）');
  eq(B.latestHireDate, '2025-11-17', '最晚开招（与 2号 v3.2 T5 逐值一致）');
  eq(B.isLate, true, '已晚');
  eq(B.lateDays, 238, '晚 238 天');
});

T('T-C1', '对拍C：价签61.17万 年账107.0万 OTE 54–72万（+合计568.2万经 calcTotalLine）', () => {
  const C = calcCardC(inputsB);
  eq(wan1(C.idleAmt), '12.5', '空窗 12.5 万');
  eq(wan2(C.rampGapAmt), '48.17', '爬坡缺口 48.17 万');
  eq(wan2(C.tagAmt), '61.17', '单人价签 61.17 万（简版 3 项）');
  eq(wan1(C.oteLowAmt), '54.0', 'OTE 下限 54 万');
  eq(wan1(C.oteHighAmt), '72.0', 'OTE 上限 72 万');
  eq(wan1(C.annualAmt), '107.0', '年流失总账 107.0 万');
  eq(C.code, 'W-10', 'W-10 判定码');
  eq(C.vars.n, 5, 'W-10 变量注入');
  // 合计行（件七 T-总1 黄金值，随卡验证）：107.0 + 461.2 → 568.2 万
  const total = calcTotalLine(calcCardB(inputsB, TEST_TODAY, 2027), C, calcCardD(inputsB, 21));
  eq(wan1(total.totalAmt), '568.2', '合计漏损 568.2 万（🔧C-14）');
  eq(total.riskGate.code, 'W-12', '缺口>0 → W-12 风险行');
});

T('T-C2', '招聘费 Override 2万→价签62.67万（经 getCoef 生效）[UI等效→引擎级]', () => {
  const gc = makeGetCoef({ recruitFeeDefaultAmt: 2000000 });   // MatrixOverride 落库 → 租户覆盖层
  const C = calcCardC(inputsB, gc);
  eq(C.recruitFeeAmt, 2000000, 'Override 生效');
  eq(wan2(C.tagAmt), '62.67', '价签 62.67 万');
});

T('T-D1', '对拍D：heads=21→跨度上限8、需3、缺2、纯辅导0分钟', () => {
  const D = calcCardD(inputsB, 21);   // 21 = 5 + 16（随 C-14）；I8=1
  eq(D.availH, 9, '周管理可用 9h');
  eq(D.spanCap, 8, '跨度上限 8');
  eq(D.managerNeeded, 3, '需 3 主管');
  eq(D.gap, 2, '缺 2');
  eq(D.coachMin, 0, '纯辅导 0 分钟（9−21×0.6<0）');
  eq(D.code, 'W-11', 'W-11 判定码');
  eq([D.vars.span, D.vars.heads, D.vars.mgr, D.vars.min], [8, 21, 3, 0], 'W-11 注入变量');
});

T('T-D2', 'I8=0→分母取1 无除零', () => {
  const D = calcCardD({ ...inputsB, managerCount: 0 }, 21);
  eq(D.curSpan, 21, '现跨度 21/max(0,1)=21');
  assert(Number.isFinite(D.curSpan) && Number.isFinite(D.managerNeeded), '无 Infinity/NaN');
  eq(D.gap, 3, '缺口 = 3−0');
});

T('T-E1', 'TIS：5人/partial/partial→70 绿（含界）', () => {
  const E = calcCardE({ salesCount: 5, complementLevel: 'partial', attributableLevel: 'partial' });
  close(E.TIS, 70, 1e-9, 'TIS=70');
  eq(E.light, 'green', '≥70 含界为绿');
});

T('T-E2', 'TIS：27人/solo/no→0 红', () => {
  const E = calcCardE({ salesCount: 27, complementLevel: 'solo', attributableLevel: 'no' });
  close(E.TIS, 0, 1e-9, 'TIS=0');
  eq(E.light, 'red', '红');
});

/* ================= 风洞 10 条 ================= */

T('T-F16-1', '菜单(100万/3万)→80万/¥22,700｜100万/¥30,000｜120万/¥44,100，偏差−0.18/0/+0.09%，单位回报严格递增', () => {
  const M = generateMenu(W(100), 3000000);   // 100万/季（分）、3万元（分）
  const t = M.tiers;
  eq(t.map(x => x.quotaAmt), [80000000, 100000000, 120000000], '三档配额');
  eq(t.map(x => x.bonusAmt), [2270000, 3000000, 4410000], '三档奖金 22700/30000/44100 元');
  eq(t.map(x => pct2(x.dev)), ['-0.18', '0.00', '0.09'], '等价偏差 −0.18%/0/+0.09%');
  assert(t[0].unitReturn < t[1].unitReturn && t[1].unitReturn < t[2].unitReturn, '单位回报严格递增');
  eq(M.adjusted, false, '未触发 W-28 修正');
});

T('T-F16-2', '闸③触发→W-19 拦截（blocked）[UI等效→引擎级]', () => {
  const M = generateMenu(W(100), 3000000, { gate3Active: true });
  eq(M.blocked, true, '拦截');
  eq(M.code, 'W-19', 'W-19 码');
});

T('T-F16-3', '登记"张三·冲刺档"→irrevocable 快照落库 [UI等效→引擎级]', () => {
  const M = generateMenu(W(100), 3000000);
  const mc = makeMenuChoice({ salespersonName: '张三', menu: M, chosenTier: 'high', today: TEST_TODAY });
  eq(mc.irrevocable, true, 'irrevocable=true（🔒）');
  eq(mc.chosenTier, 'high', '冲刺档');
  eq(mc.chosenDate, TEST_TODAY, '登记日=注入 today');
  eq(mc.menuSnapshot.length, 3, '三档快照');
  eq(mc.menuSnapshot[2], { tier: 'high', quotaAmt: 120000000, bonusAmt: 4410000 }, '快照锁定值');
});

T('T-F18-1', '造假闸：3000万/5人/底薪5500→红 W-20、ratio=333.3%、引 S6', () => {
  const inp = { cityTier: 'tier1', cycleTier: 'regular', nextYearTargetGrossAmt: W(3000), lastYearPerCapitaGrossAmt: W(100), salesCount: 5, attritionRate: 0.35, hiringCycleDays: 45 };
  const B = calcCardB(inp, TEST_TODAY, 2027);
  const F = gateFraudRisk({ currentBaseSalaryAmt: 550000 }, inp, { cardB: B });
  eq(F.code, 'W-20', 'W-20 红');
  eq(F.light, 'red', '红灯');
  eq(pct1(F.ratioCur), '333.3', 'ratio=333.3%');
  eq(F.p90Eff, 1.8, 'p90 冷启动回退 1.8');
  eq(F.Bwarn, 575000, '预警 B=5,750 元');
  eq(F.hunger, true, '5,500 < 6,325（×1.1 缓冲）');
  assert(F.vars.S6 != null && F.vars.S6 === B.S6, 'W-20 变量引 S6');
});

T('T-F18-2', '造假闸：底薪改8000→黄 W-20b', () => {
  const inp = { cityTier: 'tier1', cycleTier: 'regular', nextYearTargetGrossAmt: W(3000), lastYearPerCapitaGrossAmt: W(100), salesCount: 5 };
  const F = gateFraudRisk({ currentBaseSalaryAmt: 800000 }, inp, {});
  eq(F.code, 'W-20b', 'W-20b');
  eq(F.light, 'amber', '黄灯');
  eq(F.hunger, false, '8,000 ≥ 6,325 无饥饿');
});

T('T-F18-3', '同向闸：advisory+contract→红 W-21；pure_sales+margin→绿', () => {
  const r1 = gateAlignment({ positionType: 'advisory', currentCommissionBase: 'contract_amount' });
  eq([r1.light, r1.code], ['red', 'W-21'], '顾问岗按合同额 → 红');
  const r2 = gateAlignment({ positionType: 'pure_sales', currentCommissionBase: 'margin_based' });
  eq([r2.light, r2.code], ['green', 'ok'], '纯销售按毛利 → 绿');
  const r3 = gateAlignment({ positionType: 'pure_sales', currentCommissionBase: 'contract_amount' });
  eq([r3.light, r3.code], ['amber', 'W-21b'], '纯销售按合同额 → 黄（附带核对）');
});

T('T-F19-1', '护栏软锁：有菜单未选护栏→locked+W-22；选后解锁', () => {
  const g1 = checkGuardrail(true, null);
  eq([g1.locked, g1.code], [true, 'W-22'], '未选护栏 → 软锁');
  const g2 = checkGuardrail(true, 'complaint_rate');
  eq(g2.locked, false, '选定护栏 → 解锁');
  eq(checkGuardrail(false, null).locked, false, '无菜单/冲刺 → 不锁');
});

T('T-F19-2', '过程红线：4→W-23+PendingEvidence(bunching)；2→静默', () => {
  const p4 = countProcessRedlines(4, TEST_TODAY);
  eq([p4.warn, p4.code, p4.vars.n], [true, 'W-23', 4], '4 条触发');
  eq(p4.pendingEvidence, [{ type: 'bunching', bookedDate: TEST_TODAY, note: '算账器M36到期兑付' }], '信封 PendingEvidence');
  const p2 = countProcessRedlines(2, TEST_TODAY);
  eq([p2.warn, p2.code, p2.pendingEvidence.length], [false, null, 0], '2 条静默');
});

T('T-F19-3', '探索保底期 9/11/13/14/14（long/ultraLong 封顶 fallback 不报错，回归 C-02）', () => {
  const floors = ['short', 'regular', 'midLong', 'long', 'ultraLong']
    .map(c => explorationContract({ cityTier: 'tier1', cycleTier: c }));
  eq(floors.map(f => f.floorMonths), [9, 11, 13, 14, 14], '全周期保底月');
  assert(floors.every(f => Number.isFinite(f.floorMonths)), 'long/ultraLong 有限值（D-15）');
  eq(floors[0].minWageAmt, 242000, '保底底薪合规下限（tier1）');
  eq([floors[0].code, floors[0].menuDisabledCode], ['W-24', 'W-24b'], '模板码 + 菜单禁用码');
});

T('T-F20-1', '沙盘：勾3→精确3行；认领 push_deadline→watch_list=["period_end_push"]', () => {
  const sb = leakSandbox(['no_discount', 'push_deadline', 'heavy_monitoring'], ['push_deadline']);
  eq(sb.rows.length, 3, '精确 3 行');
  eq(sb.rows.map(r => r.measure), ['no_discount', 'push_deadline', 'heavy_monitoring'], '行=勾选，无新增出口');
  eq(sb.claimedOutlets, ['push_deadline'], '认领落库');
  eq(sb.watchList, ['period_end_push'], 'watch_list 进导出信封');
  eq([sb.code, sb.vars.n], ['W-25', 3], 'W-25 收口');
  eq(leakSandbox([]).code, 'W-26', '勾0 → W-26 空态');
  eq(Object.keys(LEAK_MAP).length, 6, '映射表恰 6 行（D-12）');
});

/* ================= 合规 2 条 ================= */

T('T-合1', '闸⑥：一线 B_sales=2000<2420→W-29 红且不阻断；改6000→W-29 消失 [UI等效→引擎级]', () => {
  const A1 = calcCardA(inputsA, 2, 10, getCoef, { sales: 200000 });   // 注入 B_sales=2000 元
  const g = A1.gates.find(g => g.code === 'W-29');
  assert(g, 'W-29 触发');
  eq([g.light, g.vars.levelLabel, g.vars.B, g.vars.floor], ['red', 'sales', 200000, 242000], 'W-29 变量注入');
  eq(A1.rows[0].belowMinWage, true, '该层标"底薪疑似违法"');
  assert(A1.burdenRate != null && A1.rows[1].r != null && A1.rows[2].r != null, '其余计算不阻断');
  const A2 = calcCardA(inputsA, 2, 10, getCoef, { sales: 600000 });   // 改 B=6000 元
  assert(!A2.gates.some(g => g.code === 'W-29'), 'W-29 消失');
});

T('T-合2', '闸⑥ Override：minWage 改3000→B_sales=2800 触发 W-29（验证 Override 经 getCoef）[UI等效→引擎级]', () => {
  const gc = makeGetCoef({ minWageTable: { tier1: 300000, tier2: 200000, tier34: 170000 } });
  const A = calcCardA(inputsA, 2, 10, gc, { sales: 280000 });          // B_sales=2800 元
  const g = A.gates.find(g => g.code === 'W-29');
  assert(g, 'Override 后 2800<3000 触发 W-29');
  eq(g.vars.floor, 300000, '闸⑥ 读到的下限=Override 值');
  // 对照：出厂系数下 2800>2420 不触发
  const A0 = calcCardA(inputsA, 2, 10, getCoef, { sales: 280000 });
  assert(!A0.gates.some(g => g.code === 'W-29'), '出厂值下同底薪不触发（差异只来自 Override）');
});

/* ================= 汇总输出 ================= */
let pass = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.id} ${r.name}`); }
  else { console.log(`  ✗ ${r.id} ${r.name}\n      └ ${r.err}`); }
}
console.log(`\n${pass}/${results.length} 绿（徽章口径：五件套 13 + 风洞 10 + 合规 2；TEST_TODAY=${TEST_TODAY}）`);
if (pass !== results.length || results.length !== 25) process.exit(1);
