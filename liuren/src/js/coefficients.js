// ============================================================================
// COEFFICIENTS 系数总表（公约【5】跨板块共享 + 4号件二 §2.3 增补）
// 三权分立：结构权=系统 / 数值权=老板（Override）/ 启用权=老板
// 取用一律经 getCoef；null→"—"，绝不假装知道（公约【10】不变量 7）
// ============================================================================
const COEF_DEFAULT = {
  // ---- §5.2 全球基准（🔄 出厂值，真实数据回灌替换）----
  socialCostRate: 0.30,
  attritionRateDefault: 0.35,
  hiringCostDefaultAmt: 15000_00,          // 完全招聘成本（招人器口径，含入职行政）
  minSampleDefault: 5,
  envelopeStaleDays: 90,                    // 跨板块字段过期标注阈值（只标注不阻断）
  ahcTrustLine: 60,                         // AHC 信任线（闸⑦ / 算账器闸⑪ e1，双侧同步）
  midYearAttritionFactor: 0.5,
  backupNudgeDays: 14,                      // 备份提醒阈值（A-24）
  pipelineDecay: { loss: 0.35, residual: 0.65, inPriceTag: 0.35 }, // 接手劣化 35%（慢性）
  handoverLossRate: 0.40,                   // 在途单交接折损（急性，仅具名 HandoverCard）
  imbalanceGlobal: 0.56,                    // 全球辖区失衡基准（约六成）
  redrawGainBand: [0.02, 0.07],
  minWageTable: { tier1: 2420_00, tier2: 2000_00, tier34: 1700_00 },
  longTermRate: 0.10,

  // ---- 4号件二 §2.3 留人器专属增补 ----
  sii: { w: [25, 15, 15, 15, 20, 10], spotCap: 5, approveCap: 3, viewPerCapMonth: 4, rxPerCapMonth: 20, bands: [30, 60] }, // <30🟢 30–60🟡 >60🔴
  ei:  { w: [30, 25, 25, 20], objectionPerCapQuarter: 0.5, bands: [30, 60] },   // >60🟢 <30🔴
  ahc: { w: [40, 25, 20, 15], interceptCap: 10, ratchetCap: 3, bands: [60, 80] }, // ≥80🟢 <60🔴
  mc:  { w: [40, 30, 20, 10], bands: [40, 65] },                                  // >65🟢 <40🔴
  ratchetCorrThreshold: 0.5,
  freeRiderRules: { discountX: 2, complaintX: 1.5, concentration: 0.60, lowMarginShare: 0.40 },
  rampGapShareRedline: 0.45,
  pipelineDecayInPriceTag: 0.35,           // = 招人器/算账器 pipelineDecay.loss（一致）
  silentMonthsDefault: 6,
  dividendPayoutDelayDays: 45,
  refRound: 10000,                          // 参照点取整到 100 元（=10000 分）
  aftershockTalkDays: 7,
  handoverSavableShare: 0.50,
  secondPlaceRankBand: [2, 3],
  secondPlaceMonths: 3,
  m28: { mentorRate: 0.05, royaltyRate: 0.02, mentorDur: 12, royaltyDur: 24, oneOffAmt: 500_00 }, // 带教/使用费默认
  dependency: { warn: 0.40, danger: 0.60 }, // 依赖度雷达
  collapseMonthIn: [10, 18],               // 🔧L-C13 黑暗三角崩塌窗口（权威源=2号 collapseRule）
};

// 数值权归老板：Override 层（落 localStorage）。启动时由 storage 注入。
let COEF_OVERRIDE = {};
function setCoefOverride(obj) { COEF_OVERRIDE = obj || {}; }
function getCoef(key) {
  if (Object.prototype.hasOwnProperty.call(COEF_OVERRIDE, key)) return COEF_OVERRIDE[key];
  return COEF_DEFAULT[key];
}
// 系数表指纹（信封 coefficientsHash 用；导入时校验一致性，不一致提示不阻断）
function coefficientsHash() {
  const merged = { ...COEF_DEFAULT, ...COEF_OVERRIDE };
  const s = JSON.stringify(merged, Object.keys(merged).sort());
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return 'cf_' + (h >>> 0).toString(16);
}
