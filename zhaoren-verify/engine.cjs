/* ============================================================================
 * 销冠招人器 · 计算引擎 (engine)  —  纯函数层
 * 遵《0号·全局公约》：safeDiv 唯一实现 / 系数只经 getCoef / 时钟注入(today 显式传参)
 * 本文件在 Node(测试) 与 浏览器(内联) 下同源运行，禁止 new Date() 读现钟、禁止 Math.random。
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SKAB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 【3】兜底铁律 ---------- */
  function safeDiv(a, b) { return (b === 0 || b == null || a == null) ? null : a / b; }
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  /* ---------- 金额/比率单位 (存分算分, 展示转元) ---------- */
  const YUAN = 100;                 // 1 元 = 100 分
  const WAN = 1000000;              // 1 万元 = 100_0000 分
  const toWan = (fen) => fen == null ? null : fen / WAN;         // 分 → 万元(数)
  const fmtWan = (fen, d = 1) => fen == null ? '—' : (fen / WAN).toFixed(d) + '万';
  const fmtYuan = (fen) => fen == null ? '—' : '¥' + Math.round(fen / YUAN).toLocaleString('zh-CN');
  const fmtPct = (rate, d = 1) => rate == null ? '—' : (rate * 100).toFixed(d) + '%';

  /* ============================================================================
   * 【5】COEFFICIENTS — 跨板块共享(公约§5) + 招人器增补(件二§2.4)
   * 结构权系统 / 数值权老板(可 Override) / 启用权老板
   * ==========================================================================*/
  const DEFAULT_COEF = {
    /* §4.7 全系统唯一 S 曲线 (12 点月度产能%) */
    rampCurve12: {
      short:     [0, 12, 25, 42, 60, 73, 85, 93, 100, 100, 100, 100], // 满产 9 月
      regular:   [0,  5, 12, 22, 35, 48, 60, 72,  82,  90,  96, 100], // 满产 12 月
      midLong:   [0,  0,  5, 12, 20, 30, 42, 53,  63,  72,  80,  87], // 满产 15 月
      long:      [0,  0,  0,  5, 10, 18, 27, 36,  45,  54,  62,  70], // 满产 18 月
      ultraLong: [0,  0,  0,  0,  5, 10, 16, 23,  30,  37,  44,  50]  // 满产 24 月
    },
    /* §5.2 全球基准 + 招人器增补 */
    midYearAttritionFactor: 0.5,      // C-17 新人当年自身流失·年中折半
    pipelineDecayResidual: 0.65,      // 流失产能残值(接手管道成交率低30-50%)；仅显示
    overestimateRedline: 0.20,        // 高估率>20% 红 (闸①)
    fullRampBand: [0.55, 0.75],       // ⑤满产系数校验黄区外沿
    threeYearScaleFactor: 1.18,       // ZS 三年最优规模 +18%
    hiringCostDefaultAmt: 15000_00,   // 完全招聘成本(含入职行政)
    recruitFeeDefaultAmt: 5000_00,    // (定价器口径, 纯外部直接费) — 仅供 UI 标注 scope 差异
    practiceMinCount14d: 50,          // 前14天练习红线
    practiceCurveShiftMonths: 2,      // 不达标 → S 曲线右移
    cognitiveGapRedline: 0.30,        // 认知鸿沟>30% 红
    ackAutoConfirmDays: 7,
    coachingDose: { floorHrsMonth: 3, ceilHrsMonth: 5, weeklyMin: 0.5 },
    validityMinSample: 12, calibrateMinSample: 30,
    weightCaps: { experience: 0, charisma: 0.10 },
    collapseRule: { scoreGt: 70, monthIn: [10, 18], dropLt: -0.40, minSample: 8 },
    rpiRedline: 0.60, rpiGreen: 0.35,
    overrideQuotaDefault: 0.20, epsMinSampleEach: 3,
    referralBonusRate: 0.01,
    qcsWeights: [0.4, 0.3, 0.3],
    funnelStallDays: { resume: [3, 6, 9], invite: [5, 10, 15], interview: [7, 14, 21], offer: [3, 6, 9] },
    tempLightThresholds: { offerAccept: [0.60, 0.40], noshow: [0.15, 0.30], cycleWorse: [0.20, 0.50], poachShare: 0.30 },
    attainDesignBase: 0.70,
    minSampleDefault: 5,
    /* 跨度三件 (定价器卡D / 招人器F1第七步共用) */
    spanDefault: { manageTimeShare: 0.30, weeklyHrs: 40 },
    fixedMeetingHrs: 3, perHeadMgmtHrs: 1.1, perHeadAdminHrs: 0.6,
    /* 招聘包出厂权重 (组件①) */
    hiringWeightsFactory: { achievement: 35, cognitive: 25, integrity: 20, situational: 15, charisma: 0, experience: 0, adaptive: 5 },
    /* 兜底/合规 */
    hiringCycleDaysDefault: 45,
    attritionRateDefault: 0.35,
    socialCostRate: 0.30,
    minWageTable: { tier1: 2420_00, tier2: 2000_00, tier34: 1700_00 },
    envelopeStaleDays: 90,
    backupNudgeDays: 14,
    ahcTrustLine: 60,
    systemRecommendThreshold: 60      // F14 systemRecommend 阈值
  };

  // 运行期覆盖表(老板金框覆盖) — 只读快照式，getCoef 合并
  function makeCoefStore(overrides) {
    const ov = overrides || {};
    function getCoef(key) {
      if (Object.prototype.hasOwnProperty.call(ov, key)) return ov[key];
      return DEFAULT_COEF[key];
    }
    return { getCoef, overrides: ov };
  }
  const _default = makeCoefStore({});
  const getCoef = _default.getCoef;

  /* ============================================================================
   * §4.7 newHireYearRate — 🔴 C-04 头部和(在职 tenure 前段)，非尾部和
   *   入职月 m 当年只剩 (13−m) 个在职月 → 取爬坡曲线前 (13−m) 段
   * ==========================================================================*/
  function newHireYearRate(cycle, m, gc) {
    gc = gc || getCoef;
    const curve = gc('rampCurve12')[cycle];
    if (!curve) return null;
    const n = 13 - m;                         // 1-indexed [1..(13−m)] == 0-indexed slice(0, 13−m)
    if (n <= 0) return 0;
    let s = 0;
    for (let i = 0; i < Math.min(n, curve.length); i++) s += curve[i];
    return s / 12 / 100;
  }

  /* ============================================================================
   * 3.1 F1 · 产能算钱器 (七步链 · 含双算法 · kEff 接线)
   *   inputs: {targetYearGrossAmt Z1, perCapitaActualAmt Z2, salesCount Z3,
   *            cycleTier Z4, attritionRate Z5, hiringCycleDays Z6,
   *            fullLoadCostAmt Z7, managerCount Z8, planMonth(默认1)}
   *   ctx: { today:'YYYY-MM-DD', targetYear:int, gc }
   * ==========================================================================*/
  function capacityChain(inp, ctx) {
    const gc = (ctx && ctx.gc) || getCoef;
    const today = ctx.today;                          // 显式注入 (公约 C-14)
    const Z1 = inp.targetYearGrossAmt, Z2 = inp.perCapitaActualAmt, Z3 = inp.salesCount;
    const Z4 = inp.cycleTier, Z5 = inp.attritionRate, Z6 = inp.hiringCycleDays;
    const Z7 = inp.fullLoadCostAmt, Z8 = inp.managerCount;
    const planMonth = inp.planMonth || 1;
    const targetYear = ctx.targetYear;
    const midFac = gc('midYearAttritionFactor');

    // 算法A 天真 (系统自跑, 不问老板)
    const naiveHires = Math.ceil(safeDiv(Z1, Z2)) - Z3;

    // kEff(m) = k(m) × (1 − Z5 × midYearAttritionFactor)
    const k = (m) => newHireYearRate(Z4, m, gc);
    const kEff = (m) => { const kv = k(m); return kv == null ? null : kv * (1 - Z5 * midFac); };

    // ① 需要满产当量
    const fullEquiv = safeDiv(Z1, Z2);
    // ② 新人年贡献率
    const k1 = k(1), kEff1 = kEff(1);
    // ③ 预期流失 + 流失带走的管道残值(仅显示)
    const expLoss = Z3 * Z5;
    const residualLostAmt = expLoss * Z2 * gc('pipelineDecayResidual');
    // ④ 缺口当量 → trueHires
    const gapEquiv = fullEquiv - Z3 + expLoss;
    const trueHires = Math.ceil(safeDiv(gapEquiv, kEff1));
    // ⑤ 满产系数校验 (改用 kEff, 与④同口径)
    const fullRampCoef = safeDiv(Z3 + trueHires * kEff1, Z3 + trueHires);
    const band = gc('fullRampBand');
    const fullRampFlag = (fullRampCoef == null) ? 'grey'
      : (fullRampCoef > band[1] || fullRampCoef < band[0]) ? 'yellow' : 'green';
    // ⑥ 最晚入职月 = max{m: kEff(m)×trueHires ≥ 缺口当量}
    let latestJoinMonth = 1;
    for (let m = 1; m <= 12; m++) {
      const ke = kEff(m);
      if (ke != null && ke * trueHires >= gapEquiv) latestJoinMonth = m;
    }
    // 最晚开招日 = targetYear 该月首日 − Z6 天
    const joinFirst = ymd(targetYear, latestJoinMonth, 1);
    const latestStart = addDays(joinFirst, -Z6);
    const lateDays = daysBetween(latestStart, today);      // today − latestStart
    const isLate = lateDays > 0;

    // 高估率
    const overRate = safeDiv(trueHires - naiveHires, trueHires);

    // 边际(闸③欠配)
    const marginProfit = Z2 * kEff1;                        // 边际利润
    const marginCost = Z7 + gc('hiringCostDefaultAmt');     // 边际成本
    const underStaffed = marginProfit > marginCost;
    const netGain = marginProfit - marginCost;

    // 第七步 主管编制
    const sp = gc('spanDefault');
    const targetHeads = Z3 + trueHires;
    const avail = gc('spanDefault').weeklyHrs * sp.manageTimeShare - gc('fixedMeetingHrs');
    const span = Math.floor(safeDiv(avail, gc('perHeadMgmtHrs')));
    const managerNeeded = Math.ceil(safeDiv(targetHeads, span));
    const mgrGap = Math.max(0, managerNeeded - Z8);
    const pureCoachMin = Math.round(safeDiv(Math.max(0, avail - targetHeads * gc('perHeadAdminHrs')), targetHeads) * 60);

    // ROI (F8): 新招人数 × 压缩月数(默认3) × 人均月毛利
    // 🔴 对拍口径 T17：人均月毛利按【万元一位小数】展示口径(8.3万)相乘 → 498万
    const perCapMonthAmt = safeDiv(Z2, 12);
    const perCapMonthWan1 = Math.round(perCapMonthAmt / WAN * 10) / 10;   // 8.3
    const roiWan = Math.round(trueHires * 3 * perCapMonthWan1 * 10) / 10; // 498 (去浮点尾数)
    const roiAmt = roiWan * WAN;

    return {
      naiveHires, trueHires,
      fullEquiv, k1, kEff1, kEff2: kEff(2),
      expLoss, residualLostAmt,
      gapEquiv, fullRampCoef, fullRampFlag,
      latestJoinMonth, latestStart, lateDays, isLate,
      overRate,
      marginProfit, marginCost, underStaffed, netGain,
      targetHeads, avail, span, managerNeeded, mgrGap, pureCoachMin,
      roiAmt, roiWan, perCapMonthAmt,
      // 附加校验
      threeYearHeads: Math.round((Z3 + trueHires) * gc('threeYearScaleFactor'))
    };
  }

  /* ============================================================================
   * 3.2 十二道闸 (判定式)
   * ==========================================================================*/
  function gateVerdicts(r, crit) {
    crit = crit || {};
    const gc = getCoef;
    const gates = [];
    const push = (id, name, light, active, judge) => gates.push({ id, name, light, active, judge });

    // ① 产能高估
    push('G1', '产能高估', 'red', r.overRate != null && r.overRate > gc('overestimateRedline'),
      `高估率 ${fmtPct(r.overRate)} ＞ 20%`);
    // ② 爬坡窗口
    push('G2', '爬坡窗口', 'red', r.isLate, `最晚开招 ${r.latestStart}，已晚 ${r.lateDays} 天`);
    // ③ 欠配
    push('G3', '欠配', 'red', r.underStaffed, `边际利润 ${fmtWan(r.marginProfit)} ＞ 边际成本 ${fmtWan(r.marginCost)}`);
    // ④ 经验陷阱
    const expTrap = (crit.minExperienceYears > 0) || (crit.ageRange != null) || ((crit.weights && crit.weights.experience) > 0);
    push('G4', '经验陷阱', 'red', !!expTrap, '设了经验/年龄门槛 (r=−.06)');
    // ⑤ 黑暗三角(魅力筛选机)
    const charismaHi = crit.weights && crit.weights.charisma > 30;
    push('G5', '黑暗三角', 'red', !!charismaHi, '魅力权重 ＞ 30% (筛选机)');
    // ⑥ 非结构化
    const achLow = crit.weights && crit.weights.achievement < 25;
    push('G6', '非结构化', 'yellow', !!achLow, '成就动机权重 ＜ 25% (r=.41)');
    return gates;
  }

  // 招聘标准硬校验：Σ权重=100
  function validateWeights(w) {
    const sum = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0);
    return { sum, ok: sum === 100 };
  }

  /* ============================================================================
   * 3.3 F3 黑暗三角评分 (行为编码, 非人格测评)
   *   =30×归因外部程度+30×细节缺失度+25×(魅力分−细节分)+15×自我提及频率
   *   四项输入 0–100(比率化 /100)；魅力/细节亦 0–100
   * ==========================================================================*/
  function darkTriadScore(o) {
    // o: { externalAttrib, detailMissing, charisma, detail, selfMention } 各 0–100
    const v = 30 * (o.externalAttrib / 100)
      + 30 * (o.detailMissing / 100)
      + 25 * ((o.charisma - o.detail) / 100)
      + 15 * (o.selfMention / 100);
    return Math.max(0, Math.min(100, v));
  }

  /* ============================================================================
   * 统计工具
   * ==========================================================================*/
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; sxy += xs[i] * ys[i]; }
    const cov = n * sxy - sx * sy;
    const dx = Math.sqrt(n * sxx - sx * sx), dy = Math.sqrt(n * syy - sy * sy);
    const den = dx * dy;
    return den === 0 ? null : cov / den;
  }
  function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
  function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function round100(x) { return Math.round(x / 100) * 100; }

  /* ============================================================================
   * 3.7 F11 预测效度追踪器
   *   people: [{ scores:{dim:val}, margin12 }...]；只对已到 12 月的样本计算
   *   minSample=12；<12 → null
   * ==========================================================================*/
  function validityR(people, dim, gc) {
    gc = gc || getCoef;
    const rows = people.filter(p => p.margin12 != null && p.scores[dim] != null);
    if (rows.length < gc('validityMinSample')) return { r: null, n: rows.length };
    return { r: pearson(rows.map(p => p.scores[dim]), rows.map(p => p.margin12)), n: rows.length };
  }

  /* 3.8 F12 崩塌追踪：崩塌=(分>70)∧(月∈[10,18])∧(近3月归一化环比<−40%) */
  function collapseStats(people, gc) {
    gc = gc || getCoef;
    const rule = gc('collapseRule');
    const highs = people.filter(p => p.peakScore > rule.scoreGt);
    if (highs.length === 0) return { rate: null, medianMonth: null, n: 0, lowSample: true };
    const collapsed = highs.filter(p => p.collapseMonth != null && p.collapseMonth >= rule.monthIn[0]
      && p.collapseMonth <= rule.monthIn[1] && p.momDrop != null && p.momDrop < rule.dropLt);
    const rate = safeDiv(collapsed.length, highs.length);
    const med = median(collapsed.map(p => p.collapseMonth));
    // minSample=8 不阻断计算，仅标注低样本 (对拍 T18 以 6 高分者取值)
    return { rate, medianMonth: med, n: highs.length, collapsedN: collapsed.length, lowSample: highs.length < rule.minSample };
  }

  /* 3.9 F13 排序效应：RPI = 浮动占比 × min(生存线/B, 1) */
  function rpiValue(floatShare, survivalLine, B) {
    const ratio = safeDiv(survivalLine, B);
    if (ratio == null) return null;
    return floatShare * Math.min(ratio, 1);
  }
  function rpiPredict(rpi, gc) {
    gc = gc || getCoef;
    if (rpi == null) return null;
    if (rpi >= gc('rpiRedline')) return 'gambler';       // 筛进赌徒/黑暗三角
    if (rpi < gc('rpiGreen')) return 'achievement';      // 筛进成就动机型
    return 'neutral';
  }

  /* 3.10 F14 例外权：EPS = 复合质量(推翻组) − 复合质量(遵从组) */
  function overrideScorecard(againstNet, complyNet, overrideCount, decisionCount, gc) {
    gc = gc || getCoef;
    const minEach = gc('epsMinSampleEach');
    const eps = (againstNet.length >= minEach && complyNet.length >= minEach)
      ? mean(againstNet) - mean(complyNet) : null;
    const overrideRate = safeDiv(overrideCount, decisionCount);
    const warn = overrideRate != null && overrideRate > gc('overrideQuotaDefault');
    return { eps, overrideRate, warn };
  }
  function systemRecommend(totalScore, gc) {
    gc = gc || getCoef;
    return totalScore >= gc('systemRecommendThreshold') ? 'hire' : 'reject';
  }

  /* 3.11 F15 渠道质量归因 + 单人流失价签(本板块口径) + 内推奖 */
  function priceTag(inp, gc) {
    gc = gc || getCoef;
    const Z2 = inp.perCapitaActualAmt, Z4 = inp.cycleTier, Z6 = inp.hiringCycleDays;
    const curve = gc('rampCurve12')[Z4];
    const perMonth = Z2 / 12;
    const vacancy = perMonth * (Z6 / 30);                 // 空缺期损失
    let rampLoss = 0;
    for (let m = 1; m <= 12; m++) rampLoss += (1 - curve[m - 1] / 100);
    rampLoss = perMonth * rampLoss;                      // 爬坡损失
    const hiring = gc('hiringCostDefaultAmt');
    const tagAmt = vacancy + rampLoss + hiring;
    return { tagAmt, vacancyAmt: vacancy, rampLossAmt: rampLoss, hiringAmt: hiring };
  }
  function referralBonus(tagAmt, gc) {
    gc = gc || getCoef;
    const raw = round100((tagAmt / YUAN) * gc('referralBonusRate'));   // 元
    return Math.max(1000, raw);                                        // 元
  }
  function qcs(channel, allChannels, gc) {
    gc = gc || getCoef;
    const w = gc('qcsWeights');
    const maxNet = Math.max(...allChannels.map(c => c.netMean));
    const norm = safeDiv(channel.netMean, maxNet);
    if (norm == null) return null;
    return 100 * (w[0] * channel.retain12 + w[1] * channel.survive90 + w[2] * norm);
  }

  /* ============================================================================
   * 3.4 F4 查重三条 (件三)
   * ==========================================================================*/
  function maskName(name) {
    if (!name) return '*';
    if (name.length <= 1) return name + '*';
    return name[0] + '*'.repeat(name.length - 1);
  }
  function maskPhone(p) { return p ? p.slice(0, 3) + '****' + p.slice(-2) : '—'; }
  // pool: {candidates:[{phone,name}], employees:[{phone,isActive,leaveDate,leaveReason}]}
  function dedupPhone(phone, ctx) {
    const inCand = (ctx.candidates || []).find(c => c.phone === phone);
    if (inCand) return { verdict: 'block', reason: 'candidate', tip: `候选人库已存在：${maskName(inCand.name)} / ${maskPhone(phone)}` };
    const active = (ctx.employees || []).find(e => e.phone === phone && e.isActive);
    if (active) return { verdict: 'block', reason: 'active', tip: `与在职员工重复` };
    const left = (ctx.employees || []).find(e => e.phone === phone && !e.isActive);
    if (left) return { verdict: 'pass', reason: 'left', tip: `曾于 ${(left.leaveDate || '').slice(0, 7)} 在职，原因 ${left.leaveReason || '—'}`, warn: true };
    return { verdict: 'pass', reason: 'new' };
  }

  /* ============================================================================
   * 日期工具 (纯：从显式 Y/M/D 构造, 不读现钟)
   * ==========================================================================*/
  function ymd(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function addDays(s, n) {
    const t = parse(s) + n * 86400000, dt = new Date(t);
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); } // b − a

  /* ============================================================================
   * 3.6/闸⑫ F9 认知鸿沟 · 闸⑪ 练习 · CoachingAck 自动确认
   * ==========================================================================*/
  function cognitiveGap(reported, confirmed) {
    // 鸿沟 = 1 − 确认数/上报数
    const ratio = safeDiv(confirmed, reported);
    if (ratio == null) return null;
    return 1 - ratio;
  }
  function autoConfirm(daysSinceReport, gc) {
    gc = gc || getCoef;
    return daysSinceReport > gc('ackAutoConfirmDays');   // >7 天 → 自动 confirmed
  }
  function practiceGate(count14d, gc) {
    gc = gc || getCoef;
    const floor = gc('practiceMinCount14d');
    const red = count14d < floor;
    return { red, floor, count: count14d, shiftMonths: red ? gc('practiceCurveShiftMonths') : 0 };
  }

  /* F13 验证闭环：预测赌徒 且 (黑暗中位>团队均值 且 成就中位<团队均值) → 已验证 */
  function verifyRPI(rpi, dark, ach, gc) {
    // dark:{median,teamMean}  ach:{median,teamMean}
    const pred = rpiPredict(rpi, gc);
    if (pred === 'gambler' && dark.median > dark.teamMean && ach.median < ach.teamMean) return 'verified';
    if (pred === 'achievement') return 'achievement';
    return 'unverified';
  }

  /* ============================================================================
   * F4/Z-D1 hired → Employee 转池：黑暗三角明细 + joltType 立即销毁
   *   仅保留 darkTriadScore 数值(供 F12 匿名统计) 与各维分数(供 F11)
   * ==========================================================================*/
  function hireCandidate(cand, scorePack, form) {
    const employee = {
      spId: 'emp_' + form.stamp,
      name: form.name, phone: form.phone, hireDate: form.hireDate,
      hiringCostAmt: form.hiringCostAmt, baseSalaryAmt: form.startBaseSalaryAmt,
      hireBatchId: form.batchId, managerId: form.mentorManagerName,
      sourceChannel: cand.sourceChannel, level: 0, positionType: 'sales',
      cityTier: form.cityTier || 'tier1', leaveDate: null, leaveReason: null,
      managerName: form.mentorManagerName, isActive: true
    };
    // scorePack 销毁明细：删 darkTriadDetail / joltType；保留数值与各维
    const scorePackAfter = {
      packId: scorePack.packId, candId: scorePack.candId,
      scores: scorePack.scores,                 // 各维分数保留(供 F11)
      darkTriadScore: scorePack.darkTriadScore, // 仅数值保留(供 F12 匿名)
      scoredDate: scorePack.scoredDate,
      employeeId: employee.spId
      // darkTriadDetail / joltType 已销毁(不出现)
    };
    return { employee, scorePackAfter, candLink: employee.spId };
  }

  /* ============================================================================
   * 【7】信封 skab_v1 (board=zhaoren) 构建 / 导入
   * ==========================================================================*/
  function buildEnvelope(entities, derived, ctx) {
    return {
      schema: 'skab_v1', board: 'zhaoren',
      exportedAt: ctx.today, dataVersion: 1,
      coefficientsHash: ctx.coefficientsHash || null,
      derived: derived || {},
      entities: entities || {}
    };
  }
  // 导入他方信封 → ExternalRef 只读缓存(整条覆盖)；未知实体/derived 键静默跳过
  function importEnvelope(env) {
    if (!env || env.schema !== 'skab_v1' || !env.board) return { ok: false, reason: 'schema' };
    return {
      ok: true, board: env.board,
      ref: {
        exportedAt: env.exportedAt, dataVersion: env.dataVersion,
        coefficientsHash: env.coefficientsHash || null,
        derived: env.derived || {}, importedAt: null
      }
    };
  }
  function staleDays(exportedAt, today) { return daysBetween(exportedAt, today); }

  return {
    safeDiv, isNum, YUAN, WAN, toWan, fmtWan, fmtYuan, fmtPct,
    DEFAULT_COEF, makeCoefStore, getCoef,
    newHireYearRate, capacityChain, gateVerdicts, validateWeights,
    darkTriadScore, pearson, mean, median, round100,
    validityR, collapseStats, rpiValue, rpiPredict, overrideScorecard, systemRecommend,
    priceTag, referralBonus, qcs,
    maskName, maskPhone, dedupPhone,
    cognitiveGap, autoConfirm, practiceGate, verifyRPI,
    hireCandidate, buildEnvelope, importEnvelope, staleDays,
    ymd, parse, addDays, daysBetween
  };
});
