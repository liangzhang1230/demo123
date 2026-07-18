/* ============================================================
   云端 L2 · 公约层（《0号公约》v1.5 的可执行版）
   - 兜底铁律【3】：safeDiv 唯一除法出口；null≠0；时钟注入（today 显式传参，本模块无 new Date()）
   - 宪法函数【4】：totalIncome / laborCost / netContribution / commission(margin_based) / 回算引擎 / S曲线
   - 系数【5】：跨板块共享系数唯一源；getCoef(overrides) 三权分立（数值权归租户老板）
   业务口径零改写（引用锁 L-1/L-2/L-3）：与五板块规格逐字同源。
   ============================================================ */

/* ---------- 兜底铁律 ---------- */
export const safeDiv = (a, b) => (b === 0 || b == null || a == null || !isFinite(b)) ? null : a / b;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const roundTo = (v, step) => v == null ? null : Math.round(v / step) * step;
export const round100 = x => Math.round(x / 100) * 100;
export const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
export const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const stddevP = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
export const stddevS = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export function pearson(xs, ys) {
  const n = xs.length; if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; sxy += xs[i] * ys[i]; }
  const cov = n * sxy - sx * sy, dx = Math.sqrt(n * sxx - sx * sx), dy = Math.sqrt(n * syy - sy * sy), den = dx * dy;
  return den === 0 ? null : cov / den;
}
export function percentileR7(sorted, p) { const n = sorted.length; if (!n) return null; const h = (n - 1) * p, lo = Math.floor(h), f = h - lo; return lo + 1 >= n ? sorted[n - 1] : sorted[lo] + f * (sorted[lo + 1] - sorted[lo]); }

/* ---------- 日期（YYYY-MM-DD，UTC；计算层禁 new Date()——today 一律显式传入 C-14） ---------- */
export const dParse = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const dNum = s => Math.floor(dParse(s) / 864e5);
export const numDate = n => new Date(n * 864e5).toISOString().slice(0, 10);
export const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const addDays = (s, n) => numDate(dNum(s) + n);
export const diffDays = (a, b) => dNum(b) - dNum(a);          // b − a
export const monthOf = s => s.slice(0, 7);
export const firstDay = (y, m) => ymd(y, m, 1);
export const weekdayOf = s => new Date(dParse(s)).getUTCDay(); // 0=周日

/* ---------- 全系统唯一 S 曲线（公约 §4.7，🔧C-04 头部和口径） ---------- */
export const rampCurve12 = {
  short:     [0, 12, 25, 42, 60, 73, 85, 93, 100, 100, 100, 100],  // 满产 9 月
  regular:   [0, 5, 12, 22, 35, 48, 60, 72, 82, 90, 96, 100],      // 满产 12 月
  midLong:   [0, 0, 5, 12, 20, 30, 42, 53, 63, 72, 80, 87],        // 满产 15 月
  long:      [0, 0, 0, 5, 10, 18, 27, 36, 45, 54, 62, 70],         // 满产 18 月
  ultraLong: [0, 0, 0, 0, 5, 10, 16, 23, 30, 37, 44, 50],          // 满产 24 月
};
export const SEGMENT_MAP = { short: 'smb', regular: 'smb', midLong: 'mid', long: 'ent', ultraLong: 'strategic' };
// 入职月 m 的当年贡献率 = 在职 tenure 的头部和 Σ[1..(13−m)] ÷12÷100
// 🔴 咬合基准①('short',1)=65.8%；基准②('short',5)=32.5%（只有②能测出 C-04，两个缺一不可）
export function newHireYearRate(cycle, m) {
  const arr = rampCurve12[cycle]; if (!arr || m < 1 || m > 12) return null;
  let s = 0; for (let i = 0; i < 13 - m && i < 12; i++) s += arr[i];
  return s / 12 / 100;
}
export function calcRamp80(cycle) { const arr = rampCurve12[cycle]; for (let p = 1; p <= 12; p++) if (arr[p - 1] >= 80) return p; return 12; } // 无≥80 → 封顶 12（1号 C-02）

/* ---------- 系数总表（公约【5】共享 + 各板块件二增补；两级架构 C-03） ---------- */
export const COEFFICIENTS = {
  /* 5.1 锚定矩阵（1号件二为 36 格唯一权威，此处逐字迁移） */
  cityBase: { tier1: 500000, tier2: 400000, tier34: 300000 },
  levelMultiplier: { sales: [1.0, 1.5, 1.8, 2.0], manager: [2.0, 2.5, 3.0, 3.5], executive: [3.0, 4.0, 4.5, 5.0] },
  cycleFactor: { short: 1.0000, regular: 1.1500, midLong: 1.3225, long: 1.5606, ultraLong: 2.0000 },
  thresholdTTable: {
    tier1: { sales: [25000, 30000, 35000, 40000], manager: [33000, 40000, 47000, 54000], executive: [45000, 54000, 63000, 72000] },
    tier2: { sales: [20000, 24000, 28000, 32000], manager: [27000, 32000, 37000, 43000], executive: [36000, 43000, 50000, 57000] },
    tier34: { sales: [15000, 18000, 21000, 24000], manager: [20000, 24000, 28000, 32000], executive: [27000, 32000, 38000, 43000] } },
  minWageTable: { tier1: 242000, tier2: 200000, tier34: 170000 },
  longTermRate: 0.10, maxLevels: 4,
  /* 5.2 全球基准 */
  globalAttainRate: [0.43, 0.51], attainDesignBase: 0.70,
  fullRampRatio: { smb: 0.70, mid: 0.67, ent: 0.63, strategic: 0.60 },
  attritionRateDefault: 0.35, hiringCycleDaysDefault: 45,
  hiringCostDefaultAmt: 1500000, recruitFeeDefaultAmt: 500000,   // scope 不同（公约 5.4#2），非错误
  socialCostRate: 0.30, pipelineCoverageHealthy: [3, 5], turnoverCostOteRate: [1.5, 2.0],
  coachingDose: { floorHrsMonth: 3, ceilHrsMonth: 5, weeklyMin: 0.5 },
  spanDefault: { manageTimeShare: 0.30, weeklyHrs: 40 },
  fixedMeetingHrs: 3, perHeadMgmtHrs: 1.1, perHeadAdminHrs: 0.6,
  teamBonusTIS: { w: [0.4, 0.3, 0.3], sizeFull: 8, sizeZero: 20, complementEnum: { solo: 0, partial: 50, chained: 100 }, green: 70, red: 40 },
  referencePointTolerance: 0.00, bunchingBand: 0.15,
  momentumTrigger: { lossStreak: 3, score: 0.6 },
  menuEquivalenceTolerance: 0.03, overrideQuotaDefault: 0.20, minSampleDefault: 5,
  minWage2025Note: '2025 人社部保守下限，用户按本地 Override',
  p90ColdFactor: 1.8, imbalanceGlobal: 0.56, redrawGainBand: [0.02, 0.07],
  pipelineDecay: { loss: 0.35, residual: 0.65, inPriceTag: 0.35 },
  handoverLossRate: 0.40, threeYearScaleFactor: 1.18,
  envelopeStaleDays: 90, ahcTrustLine: 60, midYearAttritionFactor: 0.5, backupNudgeDays: 14,
  /* 5.3 红线阈值 */
  commissionShareOfMargin: { highMarginMax: 0.35, floor: 0.25 },
  /* —— 板块专属增补（宿主板块件二唯一权威，命名空间隔离防撞） —— */
  dingjia: {
    burdenBand: [0.25, 0.35], menuQuotaSteps: [0.8, 1.0, 1.2], menuAttainMid: 0.47, menuAttainSlope: 0.75,
    menuRound: 10000, attainabilityRedline: 1.3, hungerBufferRate: 1.1, processRedlineWarnCount: 3,
  },
  zhaoren: {
    pipelineDecayResidual: 0.65, overestimateRedline: 0.20, fullRampBand: [0.55, 0.75],
    practiceMinCount14d: 50, practiceCurveShiftMonths: 2, cognitiveGapRedline: 0.30, ackAutoConfirmDays: 7,
    validityMinSample: 12, calibrateMinSample: 30, weightCaps: { experience: 0, charisma: 0.10 },
    collapseRule: { scoreGt: 70, monthIn: [10, 18], dropLt: -0.40, minSample: 8 },
    rpiRedline: 0.60, rpiGreen: 0.35, epsMinSampleEach: 3, referralBonusRate: 0.01,
    qcsWeights: [0.4, 0.3, 0.3],
    funnelStallDays: { resume: [3, 6, 9], invite: [5, 10, 15], interview: [7, 14, 21], offer: [3, 6, 9] },
    tempLightThresholds: { offerAccept: [0.60, 0.40], noshow: [0.15, 0.30], cycleWorse: [0.20, 0.50], poachShare: 0.30 },
  },
  suanzhang: {
    territoryBand: [0.90, 1.10], selfDevBonusFactor: 0.5,
    discountLeakRedline: 0.06, pushShareRedline: 0.40, scissorsAlert: 0.30, uerMinObs: 48,
    propertyMinEach: { people: 4, months: 6 }, dviMinDeals: 10,
    categoryFuseMarginRate: 0.22, categoryFuseShareRate: 0.20, winRateCeiling: 0.20,
    refundConcentrationX: 3, forcedDiscount: { rate: 0.15, share: 0.60 },
    leaverCategoryX: 1.5, stopBleedDays: 30, territoryStarveIdx: 0.7,
    dataGapWarn: 0.10, personLeakX: 1.5, p90MinSample: 8,
    m34TailShare: 1 / 3, m34BunchBand: 0.10, m34DiffRedline: 0.02, m34BunchRedline: 1.5,
    m35RankJumpShare: 0.30, m36Band: 0.15, m36Redline: 0.40, m36MinManDays: 30,
    hongbaoDailyX: 2, hongbaoRepeatN: 3, scissorsBunchBand: 0.15,
  },
  liuren: {
    sii: { w: [25, 15, 15, 15, 20, 10], spotCap: 5, approveCap: 3, viewPerCapMonth: 4, rxPerCapMonth: 20, bands: [30, 60] },
    ei: { w: [30, 25, 25, 20], objectionPerCapQuarter: 0.5, bands: [30, 60] },
    ahc: { w: [40, 25, 20, 15], interceptCap: 10, ratchetCap: 3, bands: [60, 80] },
    mc: { w: [40, 30, 20, 10], bands: [40, 65] },
    ratchetCorrThreshold: 0.5,
    freeRiderRules: { discountX: 2, complaintX: 1.5, concentration: 0.60, lowMarginShare: 0.40 },
    rampGapShareRedline: 0.45, pipelineDecayInPriceTag: 0.35, silentMonthsDefault: 6,
    dividendPayoutDelayDays: 45, refRound: 10000, aftershockTalkDays: 7, handoverSavableShare: 0.50,
    secondPlaceRankBand: [2, 3], secondPlaceMonths: 3,
    m28: { mentorRate: 0.05, royaltyRate: 0.02, mentorDur: 12, royaltyDur: 24, oneOffAmt: 50000 }, // oneOffAmt=500元 对拍算例常量（原版系数表同值）
    dependency: { warn: 0.40, danger: 0.60 }, collapseMonthIn: [10, 18],   // 🔧L-C13 权威源=2号 collapseRule
  },
  yuren: {
    recipeGate: { topN: 3, uerMin: 0, discountLeMean: true, complaintLeMean: true },
    plvBanned: ['态度', '心态', '性格', '狼性', '拼劲', '不够努力', '意识', '格局', '悟性', '主动性', '责任心', '上进心', '你这个人', '不用心', '不上心', '没激情', '抗压能力', '逆商', '企图心', '不行', '不专业', '笨', '懒', '没脑子', '态度端正'],
    rxRules: { volumeLt: 0.70, qualityLt: 0.60, doseGe: 0.70, ratioGe: 0.80, speedX: 1.5 },
    psi: { w: [25, 25, 25, 25], targeting: { top: 1.0, second: 0.6, other: 0.2 }, benchmark: { source: 1.0, teamMean: 0.5, generic: 0 }, bands: [40, 70] },
    newbieWindow: { days: 7, thresholdRate: 0.80, redStreakDays: 3, redLine: 0.60, holdDays: 3 },
    effectiveScore: { newbieBandFactor: 0.60 },
    spotCheck: { weeklyK: 2, kRange: [0, 5], flagWeight: 3 },
    backlogAlert: { managerDays: 30, bossDays: 60, surgeUp: 0.50, dropDown: 0.30 },
    joltRule: { stallX: 1.5, discountX: 1.5 },
    floorLift: { minEach: 3, windowDays: 90 },
    m40: { coachTopN: 3, learnerBand: [0.20, 0.80], pairWeeksMax: 3, sessionMinutes: 20 },
    m41: { lossStreakTrigger: 3, scoreTrigger: 0.60, w: [0.6, 0.4], streakCap: 5, winRateWindowDays: 30, smallDealAovX: 0.5 },
    m42: { laggardBand: 1 / 3, trajMonths: 6 },
    m43: { accel: [0.60, 0.95], quitLt: 0.40, protectBigDealShare: 0.50, subGoalX: 1.1, middleCoachWeight: 0.60 },
    m44: { tenureYears: 2, neglectRatioLt: 0.5 },
  },
};
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
/** 系数读取唯一入口：getCoef(path, overrides) —— overrides = 租户覆盖层（数值权归老板） */
export function makeGetCoef(overrides = {}) {
  return path => {
    const ov = overrides[path];
    if (ov !== undefined && ov !== null && ov !== '') return ov;
    const v = getPath(COEFFICIENTS, path);
    return typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  };
}
export const getCoef = makeGetCoef({});

/* ---------- 宪法函数【4】（唯一源，各板块 import，禁止重复实现） ---------- */
export const INCOME_BONUS = new Set(['instant_bonus', 'year_end_bonus', 'dividend', 'mentoring_share', 'recipe_royalty', 'sprint_vested', 'discretionary']);

/** 4.5 提成口径（护城河）：margin_based 永不可换；禁止统一毛利折算系数 */
export const commission = (collectedAmt, categoryMarginRate, r) => Math.round(collectedAmt * categoryMarginRate * r);

/** 4.1 员工视角"我拿到多少"（报销永不计入；VSA vested 前不计入） */
export function totalIncome({ baseAmt, commissionAmt, payouts = [] }) {
  return baseAmt + commissionAmt + payouts.filter(p => INCOME_BONUS.has(p.type)).reduce((s, p) => s + p.amount, 0);
}
/** 4.2 老板视角"我花了多少"（报销只进成本） */
export function laborCost({ baseAmt, commissionAmt, payouts = [] }, gc = getCoef) {
  return baseAmt + Math.round(baseAmt * gc('socialCostRate')) + commissionAmt + payouts.reduce((s, p) => s + p.amount, 0);
}
/** 4.3 经营净贡献（经营口径，非财务报表口径） */
export function netContribution({ grossMarginAmt, laborCostAmt, opCostAmt, refundMarginAmt, discountMarginAmt }) {
  return grossMarginAmt - laborCostAmt - opCostAmt - refundMarginAmt - discountMarginAmt;
}
/** 4.6 回算引擎核心（定价器心脏，公约级公式） */
export function recalcEngine(T, longTermRate, B, G) {
  if (B >= T * (1 - longTermRate)) return { blocked: '底薪已吃穿现金目标（B ≥ T×(1−长期占比)）', r: null };
  if (G == null || G <= 0) return { blocked: '毛利口径 G ≤ 0', r: null };
  const gap = T * (1 - longTermRate) - B;
  return { gap, r: safeDiv(gap, G), longMonthly: T * longTermRate, blocked: null };
}
/** 好招指数 = min(拟定B÷预警档B, 拟定T÷预警线T)；<1.0🔴 1.0–1.2🟡 1.2–1.4🟢 ≥1.4金 */
export const goodHireIndex = (planB, warnB, planT, warnT) => {
  const a = safeDiv(planB, warnB), b = safeDiv(planT, warnT);
  return (a == null || b == null) ? null : Math.min(a, b);
};
export const goodHireBand = gi => gi == null ? null : gi < 1.0 ? 'red' : gi < 1.2 ? 'yellow' : gi < 1.4 ? 'green' : 'gold';

/* ---------- 信封 schema（公约【7】skab_v1）——C13 迁移层使用 ---------- */
export function buildEnvelope({ board, exportedAt, derived = {}, entities = {}, coefficientsHash = '' }) {
  return { schema: 'skab_v1', board, exportedAt, dataVersion: 1, coefficientsHash, derived, entities };
}
export function validateEnvelope(env) {
  if (!env || env.schema !== 'skab_v1') return { ok: false, reason: 'schema' };
  if (!['dingjia', 'zhaoren', 'suanzhang', 'liuren', 'yuren'].includes(env.board)) return { ok: false, reason: 'board' };
  return { ok: true };
}
