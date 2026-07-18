/* ============================================================
   云端 L2 · 定价器业务引擎（《1号定价器》v2.5 件三 的服务端纯函数移植）
   - 业务口径零改写（引用锁 L-1）：公式以规格件三为唯一事实源
   - 一切含日期的函数 today / targetYear 显式传参（公约 C-14），本模块零 new Date()
   - 系数只经 getCoef：每个函数接受 gc 参数，默认 shared 的 getCoef；
     租户覆盖由调用方传 makeGetCoef(overrides)
   - 金额一律"分"（int）、比率 0–1、除法一律 safeDiv、舍入只在展示层
     （规格明写 round 处除外：B 四舍五入到元、gapAmt/longAmt 取整到分）
   - 话术 W 系文案不搬入服务端：每个闸/判定只返回 code（如 'W-02'）与注入变量对象，
     话术渲染在表现层（件五 W-00～W-31 为唯一文案权威）
   计算顺序（件三）：B → D → A → C → E → 合计
   ============================================================ */
import {
  safeDiv, clamp, roundTo,
  getCoef as sharedGetCoef,
  rampCurve12, SEGMENT_MAP, newHireYearRate, calcRamp80,
  addDays, diffDays, firstDay,
  goodHireIndex, goodHireBand,
} from './shared.mjs';

/* ---------- 常量（件二 2.1 枚举注册表 / 件三 F20 映射表） ---------- */
export const ENUMS = {
  cityTier: ['tier1', 'tier2', 'tier34'],
  cycleTier: ['short', 'regular', 'midLong', 'long', 'ultraLong'],
  tierGrade: ['effective', 'efficient', 'leading'],   // warning 存在于矩阵但不可选（E-03）
  complementLevel: ['solo', 'partial', 'chained'],
  attributableLevel: ['no', 'partial', 'yes'],
  levelType: ['sales', 'manager', 'executive'],
  positionType: ['pure_sales', 'advisory', 'aftersales'],
  commissionBaseType: ['contract_amount', 'margin_based', 'neutral_kpi'],
  controlMeasure: ['no_discount', 'discount_excluded', 'old_client_excluded', 'heavy_monitoring', 'push_deadline', 'forbid_backlog'],
  guardrailMetric: ['complaint_rate', 'refund_rate', 'discount_rate'],
  menuTier: ['low', 'mid', 'high'],
};

/* 档序（E-03）：warning=0 仅作警戒线与好招指数分母，不可选 */
const GRADE_IDX = { effective: 1, efficient: 2, leading: 3 };
const gradeIndex = g => GRADE_IDX[g] != null ? GRADE_IDX[g] : 1;

/* F20-01 确定性映射表（件三六行，禁止推断新出口；watch = watch_list 机器值） */
export const LEAK_MAP = {
  no_discount:        { exit: '该降不降→丢单',                 price: '失单率↑',               watchLabel: '失单原因=价格占比',        watch: 'lost_price' },
  discount_excluded:  { exit: '隐性让利(送货/延期/口头承诺)',   price: '成本不可见、数据变假',   watchLabel: 'DiscountEntry 缺录率',     watch: 'discount_missing' },
  old_client_excluded:{ exit: '老客荒废',                       price: '复购率↓',               watchLabel: '复购率',                   watch: 'repurchase' },
  heavy_monitoring:   { exit: '表演性合规(摆拍/刷时长)',        price: '可见产出≠真实产出',     watchLabel: '日报计数vs成交相关性',     watch: 'report_corr' },
  push_deadline:      { exit: '透支下月+破坏价格锚点',          price: '期末折扣率↑',           watchLabel: 'period_end_push',          watch: 'period_end_push' },
  forbid_backlog:     { exit: '只做老客不开新客',               price: '新客占比↓',             watchLabel: '新客成交占比',             watch: 'new_client_share' },
};

const roundYuanFen = fen => Math.round(fen / 100) * 100;   // 四舍五入到元（分单位）

/* ---------- F-00 validateInputs（件二 2.2 · 13 项约束） ---------- */
const FIELD_RULES = [
  ['cityTier',   '城市线级',       v => ENUMS.cityTier.includes(v),                        '必选：一线/二线/三四线'],
  ['cycleTier',  '成交周期档',     v => ENUMS.cycleTier.includes(v),                       '必选：短期～超长'],
  ['tierGrade',  '定价档位',       v => v == null || ENUMS.tierGrade.includes(v),          '有效/高效/领先（默认有效）'],
  ['targetPersonalMonthlyGrossAmt', '达标销售的月毛利目标', v => Number.isFinite(v) && v > 0, '必须大于 0'],
  ['nextYearTargetGrossAmt',        '明年公司毛利目标（年）', v => Number.isFinite(v) && v > 0, '必须大于 0'],
  ['lastYearPerCapitaGrossAmt',     '去年人均毛利（年·真值）', v => Number.isFinite(v) && v > 0, '必须大于 0'],
  ['salesCount',   '现有销售人数',     v => Number.isInteger(v) && v >= 0,                 '整数且 ≥0'],
  ['managerCount', '现有销售主管人数', v => Number.isInteger(v) && v >= 0,                 '整数且 ≥0'],
  ['attritionRate', '年流失率',       v => Number.isFinite(v) && v >= 0 && v <= 0.9,      '0–0.9（0–90%）'],
  ['hiringCycleDays', '招聘周期（天）', v => Number.isInteger(v) && v >= 1 && v <= 365,   '整数 1–365'],
  ['blendedMarginRate', '综合毛利率', v => Number.isFinite(v) && v >= 0.01 && v <= 0.95,  '0.01–0.95（1%–95%）'],
  ['complementLevel',   '团队任务互补性', v => ENUMS.complementLevel.includes(v),         '必选'],
  ['attributableLevel', '个人贡献可见度', v => ENUMS.attributableLevel.includes(v),       '必选'],
];
export function validateInputs(inputs) {
  const errors = [];
  for (const [field, fieldLabel, check, constraintText] of FIELD_RULES) {
    if (!check(inputs ? inputs[field] : undefined)) {
      errors.push({ field, code: 'W-00', vars: { fieldLabel, constraintText } });
    }
  }
  return { ok: errors.length === 0, errors };
}

/* ---------- 账单B（六步链；与 2号 F1 同一函数卡；today/targetYear 显式注入） ---------- */
export function calcCardB(inputs, today, targetYear, gc = sharedGetCoef) {
  const cyc = inputs.cycleTier,
    I5 = inputs.nextYearTargetGrossAmt, I6 = inputs.lastYearPerCapitaGrossAmt,
    I7 = inputs.salesCount, I9 = inputs.attritionRate, I10 = inputs.hiringCycleDays;
  if (!I6) return { ok: false, blocked: 'I6=0', code: null };   // 整卡"—"（引擎级等效）
  const midF = gc('midYearAttritionFactor');                    // 🔧C-14 kEff 接线（公约 C-17）
  const kEff = m => { const k = newHireYearRate(cyc, m); return k == null ? null : k * (1 - I9 * midF); };
  const k1 = newHireYearRate(cyc, 1), kEff1 = kEff(1);
  const fullCap = I5 / I6;                                      // ① 需要满产当量
  const S1 = Math.max(0, Math.ceil(fullCap) - I7);              // ② 天真（老板脑内算法）
  const expAttr = I7 * I9;                                      // ③ 预期流失（全额计入缺口）
  const gapCap = fullCap - I7 + expAttr;                        // ④ 缺口当量
  const s6raw = safeDiv(gapCap, kEff1);
  const S6 = s6raw == null ? null : Math.max(0, Math.ceil(s6raw));   // ⑥ 真实需招
  const overRate = S6 == null ? null : safeDiv(S6 - S1, S6);         // >0.20 红（闸口径同招人器）
  const exposeAmt = kEff1 == null ? null : Math.max(0, (gapCap - S1 * kEff1) * I6);
  const totalHeadTarget = S6 == null ? null : I7 + S6;
  // ⑥ 最晚入职月 = max{m: kEff(m)×S6 ≥ 缺口当量}
  let latestMonth = null;
  if (S6 != null) for (let m = 12; m >= 1; m--) { const ke = kEff(m); if (ke != null && ke * S6 >= gapCap) { latestMonth = m; break; } }
  let latestHireDate = null, isLate = false, lateDays = 0;
  if (latestMonth != null) {
    latestHireDate = addDays(firstDay(targetYear, latestMonth), -I10);   // targetYear 该月首日 − I10 天
    lateDays = diffDays(latestHireDate, today);                          // today 显式注入（公约 C-14）
    isLate = lateDays > 0;
  }
  const seg = SEGMENT_MAP[cyc], frr = gc('fullRampRatio')[seg];
  const perHead = totalHeadTarget != null ? safeDiv(I5, totalHeadTarget) : null;
  const stretch = perHead != null && perHead > (I6 / frr) * 1.2;         // 拉伸预警 → W-09
  return {
    ok: true, k1, kEff1, fullCap, S1, expAttr, gapCap, S6, overRate, exposeAmt,
    totalHeadTarget, latestMonth, latestHireDate, isLate, lateDays,
    ramp80: calcRamp80(cyc), targetYear, stretch,
    code: 'W-07',
    vars: { S1, S6, diff: S6 == null ? null : S6 - S1, deadline: latestHireDate, late: lateDays, isLate, targetYear },
    stretchGate: stretch ? { code: 'W-09', vars: {} } : null,
  };
}

/* ---------- 账单D（管理跨度） ---------- */
export function calcCardD(inputs, totalHeadTarget, gc = sharedGetCoef) {
  const I8 = inputs.managerCount;
  const sd = gc('spanDefault');
  const availH = sd.weeklyHrs * sd.manageTimeShare - gc('fixedMeetingHrs');   // 周管理可用 h
  const spanCap = Math.floor(availH / gc('perHeadMgmtHrs'));                  // 跨度上限
  const heads = (totalHeadTarget != null) ? totalHeadTarget : inputs.salesCount;
  const mn = safeDiv(heads, spanCap);
  const managerNeeded = mn == null ? null : Math.ceil(mn);
  const gap = managerNeeded == null ? null : Math.max(0, managerNeeded - I8);
  const curSpan = safeDiv(heads, Math.max(I8, 1));                            // I8=0 → 分母取 1
  const coachRaw = heads > 0 ? safeDiv(Math.max(0, availH - heads * gc('perHeadAdminHrs')), heads) : null;
  const coachMin = coachRaw == null ? null : Math.round(coachRaw * 60);       // 每人每周纯辅导分钟
  return {
    availH, spanCap, heads, managerNeeded, gap, curSpan, coachMin,
    code: 'W-11', vars: { span: spanCap, heads, mgr: managerNeeded, min: coachMin, gap },
  };
}

/* ---------- 账单A（三层全链 + 闸①–⑥）
   bOverrides = 引擎级注入点（UI"改底薪"的等效；如 {sales: 2750000} 分） ---------- */
export function calcCardA(inputs, managerNeeded, totalHeadTarget, gc = sharedGetCoef, bOverrides = {}) {
  const I1 = inputs.cityTier, I2 = inputs.cycleTier, grade = inputs.tierGrade || 'effective',
    I4 = inputs.targetPersonalMonthlyGrossAmt, I5 = inputs.nextYearTargetGrossAmt, I11 = inputs.blendedMarginRate;
  const gi = gradeIndex(grade),
    cityB = gc('cityBase')[I1], cf = gc('cycleFactor')[I2],
    lm = gc('levelMultiplier'), tt = gc('thresholdTTable')[I1],
    ltr = gc('longTermRate'), social = gc('socialCostRate'), minW = gc('minWageTable')[I1];
  const Bof = (lv, idx) => roundYuanFen(cityB * lm[lv][idx] * cf);      // 四舍五入到元
  const Tof = (lv, idx) => tt[lv][idx] * 100;                           // 元→分
  const Gof = lv => lv === 'sales' ? I4
    : lv === 'manager' ? safeDiv(I5, 12 * Math.max(managerNeeded, 1))
    : safeDiv(I5, 12);                                                  // 高管固定 1 人（脚注 W-13）
  const count = { sales: totalHeadTarget, manager: managerNeeded, executive: 1 };
  const rows = ['sales', 'manager', 'executive'].map(lv => {
    const B = bOverrides[lv] != null ? bOverrides[lv] : Bof(lv, gi);
    const T = Tof(lv, gi), G = Gof(lv);
    const longAmt = Math.round(T * ltr);
    const gapAmt = Math.round(T * (1 - ltr)) - B;
    const blocked = B >= T * (1 - ltr);                                 // 闸① 边界守卫
    const r = blocked ? null : safeDiv(gapAmt, G);
    const belowMinWage = B < minW;                                      // 闸⑥
    return { level: lv, B, T, G, longAmt, gapAmt, blocked, r, belowMinWage, count: count[lv] };
  });
  const sales = rows[0];
  const Bwarn = Bof('sales', 0), Twarn = Tof('sales', 0);               // warning 档（分母）
  const goodHire = goodHireIndex(sales.B, Bwarn, sales.T, Twarn);
  const comp = ratio3(sales.B, sales.gapAmt, sales.longAmt);            // 构成比（和=100）
  const floatShare = safeDiv(sales.gapAmt, sales.T);
  const burdenNum = rows.reduce((s, r) => s + (r.count || 0) * r.gapAmt * 12, 0);
  const burdenRate = safeDiv(burdenNum, I5);
  // 🆕C-13 全口径人力负担（灰字行，不设闸不变灯；链式计算不中途舍入）
  const fullMonthlyAmt = rows.reduce((s, r) => s + (r.count || 0) * (r.B * (1 + social) + r.gapAmt + r.longAmt), 0);
  const fullBurdenRate = safeDiv(fullMonthlyAmt * 12, I5);
  const fullRevShare = fullBurdenRate == null ? null : fullBurdenRate * I11;   // 折营收（对标 CCOS 8–15%）
  /* 闸①–⑥（判定码 + 注入变量；话术渲染在表现层） */
  const band = gc('dingjia.burdenBand');
  const gates = [];
  rows.filter(r => r.blocked).forEach(r =>
    gates.push({ id: 1, light: 'red', code: 'W-02', vars: { level: r.level, B: r.B, T: r.T } }));
  if (I11 < 0.20) gates.push({ id: 2, light: 'red', code: 'W-01', vars: { marginPct: I11 } });
  if (sales.B < Bwarn) gates.push({ id: 3, light: 'red', code: 'W-03', vars: { Bwarn } });
  if (floatShare != null && floatShare >= 0.65) gates.push({ id: 4, light: 'amber', code: 'W-04', vars: { floatPct: floatShare } });
  if (burdenRate != null) {
    if (burdenRate > band[1]) gates.push({ id: 5, light: 'red', code: 'W-05', vars: { burdenPct: burdenRate } });
    else if (burdenRate < band[0]) gates.push({ id: 5, light: 'amber', code: 'W-06', vars: { burdenPct: burdenRate } });
    else gates.push({ id: 5, light: 'green', code: 'ok', vars: { burdenPct: burdenRate } });
  }
  rows.filter(r => r.belowMinWage).forEach(r =>                          // 🆕闸⑥ 不阻断其余计算
    gates.push({ id: 6, light: 'red', code: 'W-29', vars: { levelLabel: r.level, B: r.B, floor: minW } }));
  return {
    rows, sales, Bwarn, Twarn, goodHire, goodHireBand: goodHireBand(goodHire), comp, floatShare,
    burdenRate, fullMonthlyAmt, fullBurdenRate, fullRevShare, marginRate: I11,
    hungerBait: sales.B < Bwarn,                                         // 闸③状态（F16 前置闸用）
    anyBlocked: rows.some(r => r.blocked), gates,
  };
}
function ratio3(a, b, c) {
  const t = a + b + c; if (t <= 0) return [0, 0, 0];
  const x = [Math.round(a / t * 100), Math.round(b / t * 100), Math.round(c / t * 100)];
  x[1] += 100 - (x[0] + x[1] + x[2]);
  return x;
}

/* ---------- 账单C（流失价签·简版 3 项；UI 必须标注"简版"，公约 5.4#1） ---------- */
export function calcCardC(inputs, gc = sharedGetCoef) {
  const I1 = inputs.cityTier, I2 = inputs.cycleTier, I6 = inputs.lastYearPerCapitaGrossAmt,
    I7 = inputs.salesCount, I9 = inputs.attritionRate, I10 = inputs.hiringCycleDays;
  const monthPer = safeDiv(I6, 12);
  if (monthPer == null) return { ok: false };
  const idleAmt = monthPer * I10 / 30;                                   // 空窗
  const arr = rampCurve12[I2];
  let sumGap = 0; for (let pos = 1; pos <= 12; pos++) sumGap += (1 - arr[pos - 1] / 100);
  const rampGapAmt = monthPer * sumGap;                                  // 爬坡缺口
  const recruitFeeAmt = gc('recruitFeeDefaultAmt');                      // 内联可改 → MatrixOverride（经 gc）
  const tagAmt = idleAmt + rampGapAmt + recruitFeeAmt;                   // 单人价签（3 项）
  const Tsales = gc('thresholdTTable')[I1].sales[1] * 100;               // T_sales_effective 元→分
  const ote = gc('turnoverCostOteRate');
  const oteLowAmt = Tsales * 12 * ote[0], oteHighAmt = Tsales * 12 * ote[1];
  const annualAmt = tagAmt * I7 * I9;                                    // 年流失总账
  return {
    ok: true, idleAmt, rampGapAmt, recruitFeeAmt, tagAmt, oteLowAmt, oteHighAmt, annualAmt, sumGap,
    code: 'W-10',
    vars: { tag: tagAmt, idle: idleAmt, ramp: rampGapAmt, fee: recruitFeeAmt, oteLow: oteLowAmt, oteHigh: oteHighAmt, n: I7, attrPct: I9, annual: annualAmt },
  };
}

/* ---------- 账单E（团队奖 TIS 红绿灯） ---------- */
export function calcCardE(inputs, gc = sharedGetCoef) {
  const I7 = inputs.salesCount, I12 = inputs.complementLevel, I13 = inputs.attributableLevel;
  const tis = gc('teamBonusTIS');
  const sizeScore = 100 * clamp(1 - (I7 - tis.sizeFull) / (tis.sizeZero - tis.sizeFull), 0, 1);
  const compScore = tis.complementEnum[I12];
  const visScore = { no: 0, partial: 50, yes: 100 }[I13];
  const TIS = tis.w[0] * sizeScore + tis.w[1] * compScore + tis.w[2] * visScore;
  const light = TIS >= tis.green ? 'green' : TIS >= tis.red ? 'amber' : 'red';   // ≥70 绿(含) / 40–70 黄 / <40 红
  return { sizeScore, compScore, visScore, TIS, light };
}

/* ---------- 合计（合计漏损 = C.年账 + B.高估暴露；D.缺口>0 → 附 W-12 风险行） ---------- */
export function calcTotalLine(B, C, D = null) {
  const annualAmt = C && C.ok !== false ? C.annualAmt : 0;
  const exposeAmt = B && B.ok ? B.exposeAmt : 0;
  const totalAmt = annualAmt + exposeAmt;
  const riskGate = D && D.gap > 0 ? { code: 'W-12', vars: { gap: D.gap } } : null;
  return { totalAmt, annualAmt, exposeAmt, code: 'W-14', vars: { total: totalAmt, annual: annualAmt, expose: exposeAmt }, riskGate };
}

/* ---------- 风洞F16 generateMenu（三档等价自选激励菜单） ---------- */
export function generateMenu(baseQuotaAmt, baseBonusAmt, { gate3Active = false, gc = sharedGetCoef } = {}) {
  if (gate3Active) return { blocked: true, code: 'W-19', vars: {} };     // 前置闸：账单A 闸③触发中
  if (!(baseQuotaAmt > 0) || !(baseBonusAmt > 0)) return null;           // 入参≤0 → null
  const steps = gc('dingjia.menuQuotaSteps'), mid = gc('dingjia.menuAttainMid'),
    slope = gc('dingjia.menuAttainSlope'), mRound = gc('dingjia.menuRound'),
    tol = gc('menuEquivalenceTolerance');
  const P = x => clamp(mid + slope * (1 - x), 0.05, 0.95);
  const E = mid * baseBonusAmt;                                          // 期望成本（分）
  const names = ['low', 'mid', 'high'];
  let tiers = steps.map((x, i) => {
    const quotaAmt = baseQuotaAmt * x;
    let bonusAmt = roundTo(E / P(x), mRound);
    let dev = (P(x) * bonusAmt - E) / E;                                 // 签名偏差
    if (Math.abs(dev) > tol) {                                           // 校验一：超差改取整到十元再验
      bonusAmt = roundTo(E / P(x), 1000);
      dev = (P(x) * bonusAmt - E) / E;
    }
    return { tier: names[i], x, quotaAmt, bonusAmt, P: P(x), dev };
  });
  // 校验二（激励相容）：bonus/quota 严格递增；低档违反 → 下调至 0.98×上一档单位回报×quota（脚注 W-28）
  let adjusted = false;
  for (let i = tiers.length - 1; i >= 1; i--) {
    const hi = tiers[i], lo = tiers[i - 1];
    if (lo.bonusAmt / lo.quotaAmt >= hi.bonusAmt / hi.quotaAmt) {
      lo.bonusAmt = roundTo(0.98 * (hi.bonusAmt / hi.quotaAmt) * lo.quotaAmt, mRound);
      lo.dev = (lo.P * lo.bonusAmt - E) / E;
      adjusted = true;
    }
  }
  tiers = tiers.map(t => ({ ...t, unitReturn: t.bonusAmt / t.quotaAmt }));
  return { tiers, E, adjusted, adjustedCode: adjusted ? 'W-28' : null };
}

/* MenuChoice 落库记录（公约#27：irrevocable，无更新删除路径；choiceId 由服务层派发） */
export function makeMenuChoice({ salespersonName, menu, chosenTier, today }) {
  if (!menu || !menu.tiers || !ENUMS.menuTier.includes(chosenTier)) return null;
  return {
    salespersonName,
    menuSnapshot: menu.tiers.map(t => ({ tier: t.tier, quotaAmt: t.quotaAmt, bonusAmt: t.bonusAmt })),
    chosenTier,
    chosenDate: today,                                                   // today 显式传入（公约 C-14）
    irrevocable: true,
  };
}

/* ---------- 风洞F18-01 造假风险闸（富国闸）
   p90Real = 信封.derived.realP90Factor（🔧C-07；null → 回退 p90ColdFactor） ---------- */
export function gateFraudRisk(audit, inputs, { p90Real = null, cardB = null, gc = sharedGetCoef } = {}) {
  const I1 = inputs.cityTier, I2 = inputs.cycleTier,
    I5 = inputs.nextYearTargetGrossAmt, I6 = inputs.lastYearPerCapitaGrossAmt, I7 = inputs.salesCount;
  const p90Eff = p90Real != null ? p90Real : gc('p90ColdFactor');
  const ratioCur = safeDiv(safeDiv(I5, I7), I6 * p90Eff);
  const Bwarn = roundYuanFen(gc('cityBase')[I1] * gc('levelMultiplier').sales[0] * gc('cycleFactor')[I2]);
  const hunger = audit.currentBaseSalaryAmt < Bwarn * gc('dingjia.hungerBufferRate');
  const redline = gc('dingjia.attainabilityRedline');
  let light = 'green', code = 'ok';
  if (ratioCur != null && ratioCur > redline && hunger) { light = 'red'; code = 'W-20'; }
  else if (ratioCur != null && ratioCur > redline && !hunger) { light = 'amber'; code = 'W-20b'; }
  return { p90Eff, ratioCur, Bwarn, hunger, light, code, vars: { ratioPct: ratioCur, S6: cardB && cardB.ok ? cardB.S6 : null } };
}

/* ---------- 风洞F18-02 同向性闸 ---------- */
export function gateAlignment(audit) {
  const p = audit.positionType, b = audit.currentCommissionBase;
  if ((p === 'advisory' || p === 'aftersales') && b === 'contract_amount')
    return { light: 'red', code: 'W-21', vars: { positionLabel: p } };
  if (p === 'pure_sales' && b === 'contract_amount')
    return { light: 'amber', code: 'W-21b', vars: { positionLabel: p } };
  return { light: 'green', code: 'ok', vars: { positionLabel: p } };
}

/* ---------- 风洞F19-01 护栏配对（软锁：导出置灰） ---------- */
export function checkGuardrail(hasMenuOrSprint, guardrailMetric) {
  const locked = !!hasMenuOrSprint && !guardrailMetric;
  return { locked, code: locked ? 'W-22' : null, vars: {} };
}

/* ---------- 风洞F19-02 过程红线（≥3 → W-23 + PendingEvidence 预约算账器 M36） ---------- */
export function countProcessRedlines(n, today = null, gc = sharedGetCoef) {
  const warn = n >= gc('dingjia.processRedlineWarnCount');
  return {
    n, warn,
    code: warn ? 'W-23' : null, vars: { n },
    pendingEvidence: warn ? [{ type: 'bunching', bookedDate: today, note: '算账器M36到期兑付' }] : [],
  };
}

/* ---------- 风洞F19-03 探索合同（🆕C-02：ramp80 无≥80 档封顶 12 → floorMonths≤14） ---------- */
export function explorationContract(inputs, gc = sharedGetCoef) {
  const floorMonths = calcRamp80(inputs.cycleTier) + 2;
  const minWageAmt = gc('minWageTable')[inputs.cityTier];                // 保底底薪 ≥ 当地最低工资（与闸⑥联动）
  return { floorMonths, minWageAmt, code: 'W-24', menuDisabledCode: 'W-24b', vars: { floorMonths, minWage: minWageAmt } };
}

/* ---------- 风洞F20-01 漏水导流沙盘（确定性映射，禁止推断新出口） ---------- */
export function leakSandbox(measures = [], claimedOutlets = []) {
  const rows = measures.filter(m => LEAK_MAP[m]).map(m => ({ measure: m, ...LEAK_MAP[m] }));
  const claimed = claimedOutlets.filter(c => measures.includes(c) && LEAK_MAP[c]);   // 认领 ⊆ 勾选
  const watchList = claimed.map(c => LEAK_MAP[c].watch);                 // → 导出信封监测清单
  return {
    rows, claimedOutlets: claimed, watchList,
    code: rows.length ? 'W-25' : 'W-26', vars: { n: rows.length },
  };
}

/* ---------- 主装配（件三顺序 B→D→A→C→E→合计；today 显式传参） ---------- */
export function computeAll(inputs, { today, targetYearMode = 'next', gc = sharedGetCoef, bOverrides = {}, p90Real = null } = {}) {
  const validation = validateInputs(inputs);
  const targetYear = Number(today.slice(0, 4)) + (targetYearMode === 'this' ? 0 : 1);   // 🆕C-12 不新增第 14 个输入
  const R = { validation, targetYear };
  if (!validation.ok) return R;
  const B = calcCardB(inputs, today, targetYear, gc);
  if (B.ok) R.B = B;
  R.D = calcCardD(inputs, R.B ? R.B.totalHeadTarget : null, gc);
  R.A = calcCardA(inputs, R.D.managerNeeded != null ? R.D.managerNeeded : 1,
    R.B ? R.B.totalHeadTarget : inputs.salesCount, gc, bOverrides);
  const C = calcCardC(inputs, gc);
  if (C.ok) R.C = C;
  R.E = calcCardE(inputs, gc);
  R.total = calcTotalLine(R.B || null, R.C || null, R.D);
  R.fraud = gateFraudRisk({ currentBaseSalaryAmt: R.A.sales.B }, inputs, { p90Real, cardB: R.B || null, gc });
  return R;
}
