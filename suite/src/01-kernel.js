/* ============================================================
   内核 · SK — 工具 / 系数 / 统一数据库 / 跨模块派生中枢
   公约：金额一律以「分」(int) 存储；除法只经 safeDiv（除零→null→“—”）；
   比率 0–1；日期 'YYYY-MM-DD' UTC；系数只经 getCoef（覆盖层优先）。
   ============================================================ */
const SK = (() => {
  'use strict';
  const YUAN = 100, WAN = 1000000;

  /* ---------- 基础工具 ---------- */
  const safeDiv = (a, b) => (b === 0 || b == null || a == null || !isFinite(b)) ? null : a / b;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const roundTo = (v, step) => v == null ? null : Math.round(v / step) * step;
  const round100 = x => Math.round(x / 100) * 100;
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const stddevP = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  const stddevS = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  function pearson(xs, ys) {
    const n = xs.length; if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; sxy += xs[i] * ys[i]; }
    const cov = n * sxy - sx * sy, dx = Math.sqrt(n * sxx - sx * sx), dy = Math.sqrt(n * syy - sy * sy), den = dx * dy;
    return den === 0 ? null : cov / den;
  }
  function percentileR7(sorted, p) { const n = sorted.length; if (!n) return null; const h = (n - 1) * p, lo = Math.floor(h), f = h - lo; return lo + 1 >= n ? sorted[n - 1] : sorted[lo] + f * (sorted[lo + 1] - sorted[lo]); }
  let _seq = 0;
  const uid = p => p + '_' + Date.now().toString(36) + '_' + (++_seq) + Math.floor(Math.random() * 900 + 100);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- 日期（UTC，字符串口径） ---------- */
  const dParse = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const dNum = s => Math.floor(dParse(s) / 864e5);
  const numDate = n => { const d = new Date(n * 864e5); return d.toISOString().slice(0, 10); };
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const addDays = (s, n) => numDate(dNum(s) + n);
  const diffDays = (a, b) => dNum(b) - dNum(a);           // b − a
  const daysBetween = (a, b) => dNum(b) - dNum(a);
  const monthOf = s => s.slice(0, 7);
  const firstDay = (y, m) => ymd(y, m, 1);
  const weekdayOf = s => new Date(dParse(s)).getUTCDay(); // 0=周日
  let _todayOverride = null;                              // 测试时钟注入（C-14）
  const today = () => _todayOverride || new Date().toISOString().slice(0, 10);
  const setTestToday = s => { _todayOverride = s; };

  /* ---------- 展示层格式化（null → “—”，从不假装知道） ---------- */
  const DASH = '—';
  const fmt = {
    yuan: fen => fen == null ? DASH : '¥' + Math.round(fen / YUAN).toLocaleString('zh-CN'),
    wan: (fen, dp = 1) => fen == null ? DASH : (fen / WAN).toFixed(dp) + '万',
    pct: (r, dp = 1) => r == null ? DASH : (r * 100).toFixed(dp) + '%',
    num: (n, dp = 0) => n == null ? DASH : Number(n).toFixed(dp),
    x: n => n == null ? DASH : Number(n).toFixed(1) + ' 倍',
    d: s => s == null ? DASH : s,
  };

  /* ---------- 全系统唯一 S 曲线（🔧C-04 头部和口径，四板块共用） ---------- */
  const RAMP = {
    short:     [0, 12, 25, 42, 60, 73, 85, 93, 100, 100, 100, 100],
    regular:   [0, 5, 12, 22, 35, 48, 60, 72, 82, 90, 96, 100],
    midLong:   [0, 0, 5, 12, 20, 30, 42, 53, 63, 72, 80, 87],
    long:      [0, 0, 0, 5, 10, 18, 27, 36, 45, 54, 62, 70],
    ultraLong: [0, 0, 0, 0, 5, 10, 16, 23, 30, 37, 44, 50],
  };
  const SEGMENT_MAP = { short: 'smb', regular: 'smb', midLong: 'mid', long: 'ent', ultraLong: 'strategic' };
  const CYCLE_CN = { short: '短周期（≤30天）', regular: '常规（1–3月）', midLong: '中长（4–6月）', long: '长（7–12月）', ultraLong: '超长（>12月）' };
  function newHireYearRate(cycle, m) {
    const arr = RAMP[cycle]; if (!arr || m < 1 || m > 12) return null;
    let s = 0; for (let i = 0; i < 13 - m && i < 12; i++) s += arr[i];
    return s / 12 / 100;                                  // 咬合基准 short,1 → 65.8%；short,5 → 32.5%
  }
  function calcRamp80(cycle) { const arr = RAMP[cycle]; for (let p = 1; p <= 12; p++) if (arr[p - 1] >= 80) return p; return 12; }

  /* ---------- 系数总表（唯一阈值权威源；分区命名空间；可被 DB.coefOverrides 按 path 覆盖） ---------- */
  const COEF_DEFAULT = {
    shared: {
      socialCostRate: 0.30, attritionRateDefault: 0.35, hiringCostDefaultAmt: 15000_00,
      recruitFeeDefaultAmt: 5000_00, minSampleDefault: 5, midYearAttritionFactor: 0.5,
      longTermRate: 0.10, backupNudgeDays: 14, ahcTrustLine: 60,
      minWageTable: { tier1: 2420_00, tier2: 2000_00, tier34: 1700_00 },
      threeYearScaleFactor: 1.18, pipelineDecayResidual: 0.65,
      spanDefault: { manageTimeShare: 0.30, weeklyHrs: 40 },
      fixedMeetingHrs: 3, perHeadMgmtHrs: 1.1, perHeadAdminHrs: 0.6,
      p90ColdFactor: 1.8, imbalanceGlobal: 0.56,
    },
    dingjia: {
      cityBase: { tier1: 500000, tier2: 400000, tier34: 300000 },
      levelMultiplier: { sales: [1.0, 1.5, 1.8, 2.0], manager: [2.0, 2.5, 3.0, 3.5], executive: [3.0, 4.0, 4.5, 5.0] },
      cycleFactor: { short: 1.0000, regular: 1.1500, midLong: 1.3225, long: 1.5606, ultraLong: 2.0000 },
      thresholdTTable: {
        tier1: { sales: [25000, 30000, 35000, 40000], manager: [33000, 40000, 47000, 54000], executive: [45000, 54000, 63000, 72000] },
        tier2: { sales: [20000, 24000, 28000, 32000], manager: [27000, 32000, 37000, 43000], executive: [36000, 43000, 50000, 57000] },
        tier34: { sales: [15000, 18000, 21000, 24000], manager: [20000, 24000, 28000, 32000], executive: [27000, 32000, 38000, 43000] } },
      fullRampRatio: { smb: 0.70, mid: 0.67, ent: 0.63, strategic: 0.60 },
      globalAttainRate: [0.43, 0.51], turnoverCostOteRate: [1.5, 2.0],
      teamBonusTIS: { w: [0.4, 0.3, 0.3], sizeFull: 8, sizeZero: 20, complementEnum: { solo: 0, partial: 50, chained: 100 }, green: 70, red: 40 },
      burdenBand: [0.25, 0.35],
      menuQuotaSteps: [0.8, 1.0, 1.2], menuAttainMid: 0.47, menuAttainSlope: 0.75,
      menuEquivalenceTolerance: 0.03, menuRound: 10000,
      attainabilityRedline: 1.3, hungerBufferRate: 1.1, processRedlineWarnCount: 3,
    },
    suanzhang: {
      redrawGainBand: [0.02, 0.07], territoryBand: [0.90, 1.10], selfDevBonusFactor: 0.5,
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
    zhaoren: {
      overestimateRedline: 0.20, fullRampBand: [0.55, 0.75],
      practiceMinCount14d: 50, practiceCurveShiftMonths: 2, cognitiveGapRedline: 0.30,
      ackAutoConfirmDays: 7, coachingDose: { floorHrsMonth: 3, ceilHrsMonth: 5, weeklyMin: 0.5 },
      validityMinSample: 12, calibrateMinSample: 30,
      weightCaps: { experience: 0, charisma: 0.10 },
      collapseRule: { scoreGt: 70, monthIn: [10, 18], dropLt: -0.40, minSample: 8 },
      rpiRedline: 0.60, rpiGreen: 0.35, overrideQuotaDefault: 0.20, epsMinSampleEach: 3,
      referralBonusRate: 0.01, qcsWeights: [0.4, 0.3, 0.3],
      tempLightThresholds: { offerAccept: [0.60, 0.40], noshow: [0.15, 0.30], cycleWorse: [0.20, 0.50], poachShare: 0.30 },
      hiringWeightsFactory: { achievement: 35, cognitive: 25, integrity: 20, situational: 15, charisma: 0, experience: 0, adaptive: 5 },
      hiringCycleDaysDefault: 45, systemRecommendThreshold: 60,
    },
    yuren: {
      momentumTrigger: { lossStreak: 3, score: 0.6 },
      recipeGate: { topN: 3, uerMin: 0, discountLeMean: true, complaintLeMean: true },
      rxRules: { volumeLt: 0.70, qualityLt: 0.60, doseGe: 0.70, ratioGe: 0.80, speedX: 1.5 },
      psi: { w: [25, 25, 25, 25], bands: [40, 70] },
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
      cullGuard: { leadsIndexLt: 0.70, practice14Min: 50 },
    },
    liuren: {
      pipelineDecayInPriceTag: 0.35, handoverLossRate: 0.40, handoverSavableShare: 0.50,
      rampGapShareRedline: 0.45, silentMonthsDefault: 6, dividendPayoutDelayDays: 45,
      refRound: 10000, aftershockTalkDays: 7,
      secondPlaceRankBand: [2, 3], secondPlaceMonths: 3,
      sii: { w: [25, 15, 15, 15, 20, 10], spotCap: 5, approveCap: 3, viewPerCapMonth: 4, rxPerCapMonth: 20, bands: [30, 60] },
      ei: { w: [30, 25, 25, 20], objectionPerCapQuarter: 0.5, bands: [30, 60] },
      ahc: { w: [40, 25, 20, 15], interceptCap: 10, ratchetCap: 3, bands: [60, 80] },
      mc: { w: [40, 30, 20, 10], bands: [40, 65] },
      m28: { mentorRate: 0.05, royaltyRate: 0.02, mentorDur: 12, royaltyDur: 24, oneOffAmt: 500_00 },
      dependency: { warn: 0.40, danger: 0.60 }, collapseMonthIn: [10, 18], freeRiderRules: { discountX: 2, complaintX: 1.5 },
    },
  };
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
  function getCoef(path) {
    const ov = DB && DB.coefOverrides ? DB.coefOverrides[path] : undefined;
    if (ov !== undefined && ov !== null && ov !== '') return ov;
    const v = getPath(COEF_DEFAULT, path);
    return typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  }

  /* ---------- 统一数据库 ---------- */
  const LS_KEY = 'skab_suite_v1';
  const CITY_CN = { tier1: '一线', tier2: '二线', tier34: '三四线' };
  const POS_CN = { sales: '销售', manager: '主管', executive: '高管' };
  function emptyDB() {
    return {
      meta: { createdAt: today(), dataVersion: 1, seeded: false },
      ui: { theme: 'auto', lastExportAt: null, openCards: { A: true, B: true, C: false, D: false, E: false }, tierOpen: { sales: true, mgr: false } },
      company: {
        name: '我的公司', cityTier: 'tier1', cycleTier: 'regular', tierGrade: 'effective', mgrGrade: 'effective',
        complementLevel: 'partial', attributableLevel: 'partial', targetYearMode: 'next',
        targetYearGrossWan: 1000, lastYearPerCapitaWan: 100, targetPersonalMonthlyGrossWan: 9,
        attritionRate: 0.35, hiringCycleDays: 45, blendedMarginRate: 0.30, fullLoadWan: 28,
        rMode: 'auto', rManual: 0.2706,
      },
      people: [], categories: [], leads: [], deals: [], discounts: [], payouts: [], refunds: [], opcosts: [],
      candidates: [], weights: JSON.parse(JSON.stringify(COEF_DEFAULT.zhaoren.hiringWeightsFactory)),
      dt: { externalAttrib: 40, detailMissing: 35, charisma: 60, detail: 55, selfMention: 45 },
      criteria: { minExperienceYears: 0, ageRange: null },
      dailyReports: [], prescriptions: [], coachingAcks: [], bounties: [], spotChecks: [], practiceLogs: [],
      recipeSource: null, pairAssignments: [], oxygen: {}, insistLog: [],
      paceConfig: { manualQuotaBySp: {} }, shiftConfig: { '*': [0] }, silentTrackOn: false,
      governance: {
        sii: { dailyReportOn: true, rollcallOn: true, spotChecksPerWeek: 3, approvalLevels: 2, monthlyViewsTotal: 20, rxCountTotal: 80 },
        ei: { objectionsRaisedQuarter: 0, suggestionsRaised: 0, suggestionsAdopted: 0, cardIgnoreRate: 0.82 },
        ahcInputs: { achievedCount: 41, honoredCount: 25, interceptCount: 4, ratchetCount: 2 },
        selfRating: { sii: 40, ei: 70, dvi: 80, ahc: 85 },
      },
      priceTag: { spId: null, hireMonths: 1.5, raiseMonthlyAmt: 3000_00, shortenPct: 0.37 },
      dividend: {
        poolRate: 0.10,
        gates: { companyCollect: { enabled: true, pass: true }, companyNet: { enabled: true, pass: true }, personalCollect: { enabled: true, pass: true } },
      },
      blueprint: { milestones: [] },
      m28Agreements: [], covenants: [], objections: [], suggestions: [], overrideEvents: [], handoverCards: [],
      menuChoices: [], covenantDocs: [], scenarios: [], audit: null,
      coefOverrides: {},
    };
  }
  let DB = null;
  function loadDB() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        DB = Object.assign(emptyDB(), stored);
        // 对象字段一层合并，保证新版本字段有默认值
        for (const k of ['ui', 'company', 'governance', 'priceTag', 'dividend', 'paceConfig', 'shiftConfig', 'weights', 'dt']) {
          DB[k] = Object.assign(getPath(emptyDB(), k) || {}, stored[k] || {});
        }
        return;
      }
    } catch (e) { /* 损坏则重建 */ }
    DB = emptyDB();
    seedDemo();
    persist();
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); return true; }
    catch (e) { toastFn && toastFn('⚠ localStorage 写入失败，请立即导出备份'); return false; }
  }
  function storageKB() { try { const raw = localStorage.getItem(LS_KEY) || ''; return Math.round(raw.length * 2 / 1024); } catch (e) { return null; } }

  /* ---------- 统一演示种子（确定性随机，相对“今天”生成，保证全部诊断点亮） ---------- */
  function seedDemo() {
    const rng = mulberry32(42), T = today();
    const D0 = emptyDB(); Object.assign(DB, D0, { coefOverrides: DB.coefOverrides || {} });
    DB.meta.seeded = true;
    DB.company = Object.assign(DB.company, {
      name: '示例 · 王总的公司', cityTier: 'tier1', cycleTier: 'regular', tierGrade: 'effective', mgrGrade: 'effective',
      targetYearGrossWan: 1800, lastYearPerCapitaWan: 100, targetPersonalMonthlyGrossWan: 9,
      attritionRate: 0.30, hiringCycleDays: 45, blendedMarginRate: 0.30, fullLoadWan: 28,
    });
    // 品类
    const catStd = { id: 'cat_std', name: '标准品', grossMarginRate: 0.50, medianStayDays: 30 };
    const catLow = { id: 'cat_low', name: '低毛利品C', grossMarginRate: 0.18, medianStayDays: 45 };
    DB.categories = [catStd, catLow];
    // 人（10 销售 + 1 主管 + 1 新人）；线索/毛利分布来自算账器核弹表 → 地盘失衡+归一化翻转全部点亮
    const NUKE = [
      ['赵一', 180, 12.0e6, 8000], ['钱二', 120, 10.0e6, 7000], ['孙三', 120, 9.5e6, 7000],
      ['李四', 100, 8.0e6, 6500], ['周五', 100, 7.5e6, 6500], ['吴六', 100, 7.0e6, 6000],
      ['郑七', 85, 6.0e6, 6000], ['王八', 85, 5.0e6, 5500], ['冯九', 80, 4.0e6, 5000], ['陈十', 30, 3.0e6, 5000],
    ];
    const tNum = dNum(T);
    const hireDates = [-1600, -1400, -1300, -1100, -1000, -900, -700, -560, -400, -320];
    DB.people = NUKE.map(([name, , , base], i) => ({
      spId: 'sp_' + i, name, phone: '138' + String(10000000 + i * 111111).slice(0, 8),
      cityTier: 'tier1', level: i < 3 ? 2 : 1, positionType: 'sales',
      hireDate: numDate(tNum + hireDates[i]), leaveDate: null, leaveReason: null,
      managerId: 'sp_mgr', hireBatchId: 'b' + (i % 3), sourceChannel: i % 3 === 0 ? 'referral' : 'boss_zhipin',
      baseSalaryAmt: base * 100, hiringCostAmt: 15000_00, isActive: true,
    }));
    DB.people.push({ spId: 'sp_mgr', name: '陈立', phone: '13899990001', cityTier: 'tier1', level: 2, positionType: 'manager', hireDate: numDate(tNum - 1800), leaveDate: null, leaveReason: null, managerId: null, hireBatchId: null, sourceChannel: 'referral', baseSalaryAmt: 9000_00, hiringCostAmt: 15000_00, isActive: true });
    DB.people.push({ spId: 'sp_new', name: '李新', phone: '13899990002', cityTier: 'tier1', level: 0, positionType: 'sales', hireDate: numDate(tNum - 8), leaveDate: null, leaveReason: null, managerId: 'sp_mgr', hireBatchId: 'b_new', sourceChannel: 'boss_zhipin', baseSalaryAmt: 5000_00, hiringCostAmt: 15000_00, isActive: true });
    // 近 7 个月（含当月）的线索 / 成交 / 折扣 / 发放 / 成本
    const months = []; { let d = new Date(dParse(T)); for (let i = 6; i >= 0; i--) { const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(m.toISOString().slice(0, 7)); } }
    const curM = months[6];
    const dayInM = (mStr, frac) => { const [y, m] = mStr.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); const dd = clamp(Math.round(frac * last) || 1, 1, last); const s = ymd(y, m, dd); return dNum(s) > tNum ? T : s; };
    NUKE.forEach(([name, leadsN, gmFen], i) => {
      const spId = 'sp_' + i;
      months.forEach((mStr, mi) => {
        const jit = mi === 6 ? 1 : 0.82 + rng() * 0.32;
        DB.leads.push({ id: uid('la'), employeeId: spId, month: mStr, assignedLeads: Math.round(leadsN * jit), selfDevLeads: i === 9 ? 10 : (i % 4 === 0 ? 6 : 0) });
        const gm = gmFen * jit, pay = Math.round(gm / 0.50);
        const dd = dayInM(mStr, 0.35 + rng() * 0.4);
        DB.deals.push({ id: uid('deal'), employeeId: spId, categoryId: 'cat_std', dealDate: dd, intentDate: addDays(dd, -25), paidDate: mi >= 5 && rng() < 0.25 ? null : dd, closeDate: dd, status: 'won', paymentAmt: pay, discountRate: rng() < 0.3 ? 0.08 : 0 });
        if (rng() < 0.7) {
          const list = Math.round(pay * 0.25), disc = Math.round(list * (0.10 + rng() * 0.06));
          DB.discounts.push({ id: uid('disc'), employeeId: spId, discountDate: dayInM(mStr, 0.9), categoryId: 'cat_std', listPriceAmt: list, actualPriceAmt: list - disc, reason: 'period_end_push' });
        }
      });
    });
    // 点亮项：赵一当期高额折扣（个人泄漏）；两笔低毛利品成交（闸⑨）；低毛利退款；红包；房租+市场
    DB.discounts.push({ id: uid('disc'), employeeId: 'sp_0', discountDate: dayInM(curM, 0.55), categoryId: 'cat_std', listPriceAmt: 6000000, actualPriceAmt: 5340000, reason: 'competitive_pressure' });
    [0.3, 0.6].forEach(f => DB.deals.push({ id: uid('deal'), employeeId: 'sp_3', categoryId: 'cat_low', dealDate: dayInM(curM, f), intentDate: addDays(dayInM(curM, f), -40), paidDate: dayInM(curM, f), closeDate: dayInM(curM, f), status: 'won', paymentAmt: 5200000, discountRate: 0 }));
    DB.refunds.push({ id: uid('ref'), employeeId: 'sp_3', refundDate: dayInM(curM, 0.5), categoryId: 'cat_low', amount: 4000000 });
    const lastYear = String(Number(T.slice(0, 4)) - 1);
    DB.payouts.push({ id: uid('pay'), employeeId: 'sp_0', payoutDate: `${lastYear}-07-15`, period: `${lastYear}-07`, type: 'year_end_bonus', amount: 12000000, timing: 'scheduled', hasCondition: true });
    for (let k = 0; k < 3; k++) DB.payouts.push({ id: uid('pay'), employeeId: 'sp_1', payoutDate: dayInM(months[4 + (k % 2)], 0.3 + k * 0.2), period: months[4 + (k % 2)], type: 'discretionary', amount: 20000, timing: 'immediate', hasCondition: false });
    DB.opcosts.push({ id: uid('oc'), name: '房租', kind: 'rent', monthlyAmt: 3000000 });
    DB.opcosts.push({ id: uid('oc'), name: '市场投放', kind: 'marketing', monthlyAmt: 2000000 });
    // 招人器：候选人 4 + 练习记录（李新 34 次 → 汰前拦截②）
    DB.candidates = [
      { candId: 'cand_1', name: '张strong', phone: '13712340001', pool: 'interview', sourceChannel: 'referral', expectedWan: 1.2, poolEnteredDate: addDays(T, -6) },
      { candId: 'cand_2', name: '刘敏', phone: '13712340002', pool: 'resume', sourceChannel: 'boss_zhipin', expectedWan: 1.0, poolEnteredDate: addDays(T, -2) },
      { candId: 'cand_3', name: '陈晨', phone: '13712340003', pool: 'offer', sourceChannel: 'boss_zhipin', expectedWan: 1.1, poolEnteredDate: addDays(T, -12) },
      { candId: 'cand_4', name: '杨帆', phone: '13712340004', pool: 'reserve', sourceChannel: 'reserve_pool', expectedWan: 0.9, poolEnteredDate: addDays(T, -30) },
    ];
    DB.practiceLogs = [{ spId: 'sp_new', count14: 34 }, { spId: 'sp_9', count14: 62 }];
    // 育人器：近 30 天日报（按画像泊松取样）；秦朗式连败→用 sp_6；安豪式JOLT→sp_7 高折扣
    const profile = { sp_0: [14, 5, 2.4, 0.9], sp_1: [12, 4, 2, 0.7], sp_2: [11, 3.6, 1.8, 0.65], sp_3: [9, 2.8, 1.3, 0.45], sp_4: [9, 2.6, 1.2, 0.4], sp_5: [8, 2.4, 1.1, 0.38], sp_6: [7, 2, 0.9, 0.28], sp_7: [7, 1.9, 0.8, 0.26], sp_8: [6, 1.6, 0.7, 0.2], sp_9: [12, 2.2, 0.9, 0.5], sp_new: [5, 1.2, 0.4, 0.1] };
    const pois = m => { let l = Math.exp(-m), k = 0, p = 1; do { k++; p *= rng(); } while (p > l); return k - 1; };
    for (let d = 29; d >= 0; d--) {
      const ds = addDays(T, -d);
      if (weekdayOf(ds) === 0) continue;             // 周日休（Y-D8）
      for (const spId of Object.keys(profile)) {
        if (spId === 'sp_new' && diffDays(DB.people.find(p => p.spId === spId).hireDate, ds) < 0) continue;
        if (rng() < 0.12) continue;                  // 偶发漏报
        const [a, b, c, e] = profile[spId];
        DB.dailyReports.push({ drId: uid('dr'), employeeId: spId, date: ds, counts: { leads: pois(a), intents: pois(b), samples: pois(c), contracts: pois(e) }, submittedAt: ds });
      }
    }
    // 带教回执（认知鸿沟 ≈44%：reported = duration×1.8）
    for (let w = 0; w < 4; w++) {
      ['sp_3', 'sp_6', 'sp_8', 'sp_new'].forEach((spId, i) => {
        const dur = 0.5 + (i % 2) * 0.5;
        DB.coachingAcks.push({ ackId: uid('ack'), spId, coachId: 'sp_mgr', date: addDays(T, -(w * 7 + i + 1)), durationHrs: dur, reportedHrs: Math.round(dur * 1.8 * 10) / 10, status: w === 3 && i === 1 ? 'no_response' : 'confirmed' });
      });
    }
    // sp_6 连败 4（触发 M41）；sp_7 高犹豫在途单+高折扣（JOLT）
    for (let k = 0; k < 4; k++) DB.deals.push({ id: uid('deal'), employeeId: 'sp_6', categoryId: 'cat_std', dealDate: null, intentDate: addDays(T, -(40 + k * 5)), paidDate: null, closeDate: addDays(T, -(3 + k * 4)), status: 'lost', paymentAmt: Math.round(2000000 + rng() * 800000), discountRate: 0 });
    DB.deals.push({ id: uid('deal'), employeeId: 'sp_7', categoryId: 'cat_std', dealDate: null, intentDate: addDays(T, -70), paidDate: null, closeDate: null, status: 'open', paymentAmt: 3200000, discountRate: 0.12 });
    DB.deals.push({ id: uid('deal'), employeeId: 'sp_6', categoryId: 'cat_std', dealDate: null, intentDate: addDays(T, -20), paidDate: null, closeDate: null, status: 'open', paymentAmt: 900000, discountRate: 0 });
    // 挂账：45 / 70 天未回款
    DB.deals.push({ id: uid('deal'), employeeId: 'sp_4', categoryId: 'cat_std', dealDate: addDays(T, -45), intentDate: addDays(T, -80), paidDate: null, closeDate: addDays(T, -45), status: 'won', paymentAmt: 4600000, discountRate: 0 });
    DB.deals.push({ id: uid('deal'), employeeId: 'sp_8', categoryId: 'cat_std', dealDate: addDays(T, -70), intentDate: addDays(T, -110), paidDate: null, closeDate: addDays(T, -70), status: 'won', paymentAmt: 3800000, discountRate: 0 });
    DB.recipeSource = { sourceIds: ['sp_1'], setAt: T, setBy: 'boss' };
    DB.paceConfig.manualQuotaBySp = { sp_0: 30000000, sp_1: 30000000, sp_2: 30000000, sp_3: 30000000, sp_4: 30000000, sp_5: 30000000, sp_6: 30000000, sp_7: 30000000, sp_8: 30000000, sp_9: 30000000 };
    // 留人器：M28 ×2（赵一）、前程合约、异议/建议、蓝图
    DB.m28Agreements = [
      { m28Id: 'm28_1', masterId: 'sp_0', kind: 'mentoring', rate: 0.05, durationMonths: 12, startTrigger: 'apprentice_ramp_done', apprenticeMonthlyNetAmt: 5800000, irrevocable: true, createdAt: addDays(T, -60) },
      { m28Id: 'm28_2', masterId: 'sp_0', kind: 'royalty', rate: 0.02, durationMonths: 24, startTrigger: 'recipe_live', teamMonthlyIncrementAmt: 7300000, baselineSnapshotAmt: 12000000, irrevocable: true, createdAt: addDays(T, -45) },
    ];
    DB.covenants = [
      { covId: 'cov_1', employeeId: 'sp_1', promiseText: '连续达标→晋升有效档', bothConfirmed: true, irrevocable: false, durationMonths: 12, createdAt: addDays(T, -90) },
      { covId: 'cov_2', employeeId: 'sp_0', promiseText: '产权协议（irrevocable）', bothConfirmed: true, irrevocable: true, durationMonths: 12, createdAt: addDays(T, -60) },
    ];
    DB.blueprint.milestones = [{ id: uid('ms'), name: '年毛利 1800 万', done: false }, { id: uid('ms'), name: '第二梯队 3 人满产', done: false }];
    DB.overrideEvents = [{ id: uid('oe'), m28Id: 'm28_1', at: addDays(T, -20), action: 'try_downgrade', note: '尝试下调带教分成被拦截', visibleToAll: true }];
    DB.priceTag.spId = 'sp_0';
  }

  /* ---------- 跨模块派生中枢 X（每次渲染重建缓存；模块注册 summary） ---------- */
  const summary = {};                          // 模块注册：summary.dingjia = (db, today) => {...}
  let _xCache = {}, _xBusy = {};
  function xReset() { _xCache = {}; _xBusy = {}; }
  function X(id) {
    if (_xCache[id] !== undefined) return _xCache[id];
    if (_xBusy[id]) return null;               // 环路保护
    if (!summary[id]) return null;
    _xBusy[id] = true;
    let v = null;
    try { v = summary[id](DB, today()); } catch (e) { console.error('X(' + id + ')', e); }
    _xBusy[id] = false;
    _xCache[id] = v;
    return v;
  }
  /* 提成率 r 全局解析：定价器实时结果优先（rMode=auto），可手工锁定 */
  function rRate() {
    const c = DB.company;
    if (c.rMode === 'manual') return c.rManual;
    const dj = X('dingjia');
    return (dj && dj.r != null) ? dj.r : (c.rManual != null ? c.rManual : 0.2706);
  }
  /* 共用聚合：在职销售 / 主管 */
  const activeSales = () => DB.people.filter(p => p.isActive && p.positionType === 'sales');
  const activeManagers = () => DB.people.filter(p => p.isActive && p.positionType === 'manager');
  const personById = id => DB.people.find(p => p.spId === id) || null;
  const catById = id => DB.categories.find(c => c.id === id) || null;
  const maskPhone = p => !p ? '' : p.slice(0, 3) + '****' + p.slice(-2);

  /* ---------- 模块注册 / 动作 / 测试 ---------- */
  const modules = [];                                  // {id,title,icon,order,subnav,render,alerts?}
  const actions = {};                                  // data-act → fn(dataset, el, ev)
  const tests = [];                                    // {id, name, fn:()=>bool|{pass,got,want}}
  function registerModule(m) { modules.push(m); modules.sort((a, b) => a.order - b.order); }

  let toastFn = null;
  return {
    YUAN, WAN, DASH, safeDiv, clamp, roundTo, round100, mean, median, stddevP, stddevS, pearson, percentileR7,
    uid, esc, mulberry32, dParse, dNum, numDate, ymd, addDays, diffDays, daysBetween, monthOf, firstDay, weekdayOf,
    today, setTestToday, fmt, RAMP, SEGMENT_MAP, CYCLE_CN, CITY_CN, POS_CN, newHireYearRate, calcRamp80,
    COEF_DEFAULT, getCoef, getPath,
    get DB() { return DB; }, loadDB, persist, emptyDB: () => { DB = emptyDB(); }, seedDemo, storageKB, LS_KEY,
    X, xReset, summary, rRate, activeSales, activeManagers, personById, catById, maskPhone,
    modules, registerModule, actions, tests,
    _setToast(fn) { toastFn = fn; },
  };
})();
