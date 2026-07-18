/* ============================================================
   云端 L2 · 2号《销冠招人器》业务引擎（规格 v3.2 件三逐字移植 · 纯函数 ESM）
   - 唯一权威：docs/specs/2号招人器v3.2.md（件三 + 件七 T1–T24）；冲突以规格为准
   - 公约层内核一律 import 自 ./shared.mjs（rampCurve12 / newHireYearRate /
     safeDiv / pearson / mean / median / round100 / 日期 / 信封），禁止重复实现
   - 时钟注入（公约 C-14）：today / targetYear 一律显式传参，本模块无 new Date()
   - 系数经 gc 参数化（默认公约 getCoef；租户覆盖用 makeGetCoef(overrides)）
   业务口径零改写：与 originals-zhaoren.html 引擎区（ENGINE:BEGIN..END）及 suite/src/12-zhaoren.js 同源。
   ============================================================ */
import {
  safeDiv, mean, median, pearson, round100,
  rampCurve12, newHireYearRate,
  ymd, addDays, diffDays,
  getCoef, buildEnvelope, validateEnvelope,
} from './shared.mjs';

/* ---------- 金额/比率展示（公约【2】：分存储；万元 1 位；比率 ×100 1 位） ---------- */
export const YUAN = 100, WAN = 1000000;                       // 单位：分
export const toWan = fen => fen == null ? null : fen / WAN;
export const fmtWan = (fen, d = 1) => fen == null ? '—' : (fen / WAN).toFixed(d) + '万';
export const fmtPct = (rate, d = 1) => rate == null ? '—' : (rate * 100).toFixed(d) + '%';

/* ---------- 件二增补 · 本板块专属缺省（宿主件二唯一权威；shared 未收录项在此兜底） ---------- */
export const HIRING_WEIGHTS_FACTORY = { achievement: 35, cognitive: 25, integrity: 20, situational: 15, charisma: 0, experience: 0, adaptive: 5 };
const ZH_LOCAL = { systemRecommendThreshold: 60, hiringWeightsFactory: HIRING_WEIGHTS_FACTORY };
/** 板块系数读取：优先 gc('zhaoren.*')（shared COEFFICIENTS.zhaoren / 租户覆盖），未收录走本地缺省 */
const zc = (gc, key) => { const v = gc('zhaoren.' + key); return v === undefined ? ZH_LOCAL[key] : v; };

/* ============================================================
   3.1 F1 · 产能算钱器（七步链，含双算法 / kEff / 最晚开招 / 边际账 / 主管编制 / ROI）
   输入 inp = CapacityInputs（Z1–Z8，金额分）；ctx = { today, targetYear, gc? }
   ============================================================ */
export function capacityChain(inp, ctx) {
  const gc = (ctx && ctx.gc) || getCoef;
  const today = ctx.today, targetYear = ctx.targetYear;   // 🔴 显式注入（公约 C-14 / Z-C07）
  const Z1 = inp.targetYearGrossAmt, Z2 = inp.perCapitaActualAmt, Z3 = inp.salesCount;
  const Z4 = inp.cycleTier, Z5 = inp.attritionRate, Z6 = inp.hiringCycleDays;
  const Z7 = inp.fullLoadCostAmt, Z8 = inp.managerCount;
  const midFac = gc('midYearAttritionFactor');            // 公约 §5.2（C-17，与 1号账单B 同一函数卡）
  // 算法A 天真（系统自己跑老板脑子里的，🔴 不问老板）
  const naiveHires = Math.ceil(safeDiv(Z1, Z2)) - Z3;
  // 算法B 六步
  const k = m => newHireYearRate(Z4, m);                  // ② k(m) 头部和口径（C-04 / Z-C02）
  const kEff = m => { const kv = k(m); return kv == null ? null : kv * (1 - Z5 * midFac); }; // 🔧Z-C06
  const fullEquiv = safeDiv(Z1, Z2);                      // ①需要满产当量
  const k1 = k(1), kEff1 = kEff(1);
  const expLoss = Z3 * Z5;                                // ③预期流失
  const residualLostAmt = expLoss * Z2 * gc('zhaoren.pipelineDecayResidual'); // 流失带走的管道残值（仅显示，🔧Z-C08）
  const gapEquiv = fullEquiv - Z3 + expLoss;              // ④缺口当量
  const trueHires = Math.ceil(safeDiv(gapEquiv, kEff1));  // ④ trueHires（🔧Z-C06 用 kEff）
  const fullRampCoef = safeDiv(Z3 + trueHires * kEff1, Z3 + trueHires);       // ⑤满产系数校验（同④口径）
  const band = gc('zhaoren.fullRampBand');
  const fullRampFlag = (fullRampCoef == null) ? 'grey' : (fullRampCoef > band[1] || fullRampCoef < band[0]) ? 'yellow' : 'green';
  // ⑥最晚入职月 = max{m: kEff(m)×trueHires ≥ 缺口当量}
  let latestJoinMonth = 1;
  const kEffByMonth = [];
  for (let m = 1; m <= 12; m++) { const ke = kEff(m); kEffByMonth.push(ke); if (ke != null && ke * trueHires >= gapEquiv) latestJoinMonth = m; }
  const joinFirst = ymd(targetYear, latestJoinMonth, 1);
  const latestStart = addDays(joinFirst, -Z6);            // 最晚开招 = 目标年该月首日 − Z6 天
  const lateDays = diffDays(latestStart, today);          // today − latestStart
  const isLate = lateDays > 0;
  const overRate = safeDiv(trueHires - naiveHires, trueHires);                // 高估率（闸①）
  // 欠配（闸③）：边际账
  const marginProfit = Z2 * kEff1, marginCost = Z7 + gc('hiringCostDefaultAmt');
  const underStaffed = marginProfit > marginCost, netGain = marginProfit - marginCost;
  // 第七步 主管编制（与定价器同函数卡）
  const sp = gc('spanDefault'), targetHeads = Z3 + trueHires;
  const avail = sp.weeklyHrs * sp.manageTimeShare - gc('fixedMeetingHrs');
  const span = Math.floor(safeDiv(avail, gc('perHeadMgmtHrs')));
  const managerNeeded = Math.ceil(safeDiv(targetHeads, span));
  const mgrGap = Math.max(0, managerNeeded - Z8);
  const pureCoachMin = Math.round(safeDiv(Math.max(0, avail - targetHeads * gc('perHeadAdminHrs')), targetHeads) * 60);
  // F8 ROI = 新招人数 × 压缩月数3 × 人均月毛利（万 1 位）
  const perCapMonthAmt = safeDiv(Z2, 12);
  const perCapMonthWan1 = Math.round(perCapMonthAmt / WAN * 10) / 10;
  const roiWan = Math.round(trueHires * 3 * perCapMonthWan1 * 10) / 10;
  const roiAmt = roiWan * WAN;
  return { naiveHires, trueHires, fullEquiv, k1, kEff1, kEff2: kEff(2), kEffByMonth,
    expLoss, residualLostAmt, gapEquiv, fullRampCoef, fullRampFlag,
    latestJoinMonth, latestStart, lateDays, isLate, overRate,
    marginProfit, marginCost, underStaffed, netGain,
    targetHeads, avail, span, managerNeeded, mgrGap, pureCoachMin,
    roiAmt, roiWan, perCapMonthAmt,
    threeYearHeads: Math.round((Z3 + trueHires) * gc('threeYearScaleFactor')) };  // ZS +18%
}

/* ============================================================
   3.2 十二道闸 · 判定式全集（引擎可判定的 8 道：G1–G6 即时闸 + ⑪练习 + ⑫认知鸿沟）
   闸⑦查重=dedupPhone 三态；⑧⑨⑩为漏斗/批次数据视图，由服务层聚合后按本判定式点灯
   live = { practiceCount14d?, ack?: { reported, confirmed } }（缺省不判，null≠0 · A-19）
   ============================================================ */
export function gateVerdicts(r, crit, live, gc) {
  crit = crit || {}; live = live || {}; gc = gc || getCoef;
  const gates = [];
  const push = (id, name, light, active, judge) => gates.push({ id, name, light, active, judge });
  push('G1', '产能高估', 'red', r.overRate != null && r.overRate > gc('zhaoren.overestimateRedline'), `高估率 ${fmtPct(r.overRate)} ＞ 20%`);
  push('G2', '爬坡窗口', 'red', r.isLate, `最晚开招 ${r.latestStart}，已晚 ${r.lateDays} 天`);
  push('G3', '欠配', 'red', r.underStaffed, `边际利润 ${fmtWan(r.marginProfit)} ＞ 边际成本 ${fmtWan(r.marginCost)}`);
  const expTrap = (crit.minExperienceYears > 0) || (crit.ageRange != null) || ((crit.weights && crit.weights.experience) > 0);
  push('G4', '经验陷阱', 'red', !!expTrap, '设了经验/年龄门槛 (r=−.06)');
  const charismaHi = crit.weights && crit.weights.charisma > 30;
  push('G5', '黑暗三角', 'red', !!charismaHi, '魅力权重 ＞ 30% (筛选机)');
  const achLow = crit.weights && crit.weights.achievement < 25;
  push('G6', '非结构化', 'yellow', !!achLow, '成就动机权重 ＜ 25% (r=.41)');
  // 闸⑪ 练习量（🔴 永不阻止打电话——只右移 S 曲线预测）
  if (live.practiceCount14d != null) {
    const pg = practiceGate(live.practiceCount14d, gc);
    push('G11', '练习量', 'red', pg.red, `前14天练习 ${pg.count}/${pg.floor}${pg.red ? `，S 曲线右移 ${pg.shiftMonths} 个月` : ''}`);
  }
  // 闸⑫ 认知鸿沟（分子只取 confirmed）
  if (live.ack != null) {
    const gap = cognitiveGap(live.ack.reported, live.ack.confirmed);
    push('G12', '认知鸿沟', 'red', gap != null && gap > gc('zhaoren.cognitiveGapRedline'), `鸿沟 ${fmtPct(gap)} vs 红线 ${fmtPct(gc('zhaoren.cognitiveGapRedline'), 0)}`);
  }
  return gates;
}

/* ---------- F3 组件① 题库权重 Σ=100 硬校验 ---------- */
export function validateWeights(w) { const sum = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0); return { sum, ok: sum === 100 }; }

/* ---------- F3 组件③ 黑暗三角评分（行为编码，非人格测评；o 各维 0–100） ---------- */
export function darkTriadScore(o) {
  const v = 30 * (o.externalAttrib / 100) + 30 * (o.detailMissing / 100) + 25 * ((o.charisma - o.detail) / 100) + 15 * (o.selfMention / 100);
  return Math.max(0, Math.min(100, v));
}

/* ---------- 3.7 F11 预测效度 r_d = Pearson(面试 d 分, 12 月归一化毛利)；<12 样本→null ---------- */
export function validityR(people, dim, gc) {
  gc = gc || getCoef;
  const rows = people.filter(p => p.margin12 != null && p.scores[dim] != null);
  if (rows.length < gc('zhaoren.validityMinSample')) return { r: null, n: rows.length };
  return { r: pearson(rows.map(p => p.scores[dim]), rows.map(p => p.margin12)), n: rows.length };
}

/* ---------- 3.8 F12 崩塌追踪：分>70 ∧ 月∈[10,18] ∧ 近3月环比<−40%；minSample 8 ---------- */
export function collapseStats(people, gc) {
  gc = gc || getCoef; const rule = gc('zhaoren.collapseRule');
  const highs = people.filter(p => p.peakScore > rule.scoreGt);
  if (highs.length === 0) return { rate: null, medianMonth: null, n: 0, lowSample: true };
  const collapsed = highs.filter(p => p.collapseMonth != null && p.collapseMonth >= rule.monthIn[0] && p.collapseMonth <= rule.monthIn[1] && p.momDrop != null && p.momDrop < rule.dropLt);
  return { rate: safeDiv(collapsed.length, highs.length), medianMonth: median(collapsed.map(p => p.collapseMonth)), n: highs.length, collapsedN: collapsed.length, lowSample: highs.length < rule.minSample };
}

/* ---------- 3.9 F13 排序效应：RPI = 浮动占比 × min(生存线/B, 1) ---------- */
export function rpiValue(floatShare, survivalLine, B) { const ratio = safeDiv(survivalLine, B); return ratio == null ? null : floatShare * Math.min(ratio, 1); }
export function rpiPredict(rpi, gc) { gc = gc || getCoef; if (rpi == null) return null; if (rpi >= gc('zhaoren.rpiRedline')) return 'gambler'; if (rpi < gc('zhaoren.rpiGreen')) return 'achievement'; return 'neutral'; }
export function verifyRPI(rpi, dark, ach, gc) {
  const pred = rpiPredict(rpi, gc);
  if (pred === 'gambler' && dark.median > dark.teamMean && ach.median < ach.teamMean) return 'verified';
  if (pred === 'achievement') return 'achievement';
  return 'unverified';
}

/* ---------- 3.10 F14 例外权：EPS = 复合质量(推翻组) − 复合质量(遵从组)；推翻率>20% 预警 ---------- */
export function epsScorecard(againstNet, complyNet, overrideCount, decisionCount, gc) {
  gc = gc || getCoef; const minEach = gc('zhaoren.epsMinSampleEach');
  const eps = (againstNet.length >= minEach && complyNet.length >= minEach) ? mean(againstNet) - mean(complyNet) : null;
  const overrideRate = safeDiv(overrideCount, decisionCount);
  return { eps, overrideRate, warn: overrideRate != null && overrideRate > gc('overrideQuotaDefault') };
}
export const overrideScorecard = epsScorecard;   // 原版命名别名

/* ---------- F14 系统荐才线：总分 ≥60 → hire（阈值✏️；推荐≠终决自动生成 OverrideEvent） ---------- */
export function systemRecommend(totalScore, gc) { gc = gc || getCoef; return totalScore >= zc(gc, 'systemRecommendThreshold') ? 'hire' : 'reject'; }

/* ---------- 3.11 F15 单人流失价签（🔴 本板块简版 3 项口径，公约 5.4#1：UI 须标注"简版(3项)"，
   禁与留人器 6 项 75 万并列比较；hiringCost=1.5万完全招聘成本，scope 见 Z-C04） ---------- */
export function priceTag(inp, gc) {
  gc = gc || getCoef;
  const Z2 = inp.perCapitaActualAmt, Z4 = inp.cycleTier, Z6 = inp.hiringCycleDays;
  const curve = rampCurve12[Z4], perMonth = Z2 / 12;
  const vacancy = perMonth * (Z6 / 30);                                    // 项1 空缺期
  let rampLoss = 0; for (let m = 1; m <= 12; m++) rampLoss += (1 - curve[m - 1] / 100);
  rampLoss = perMonth * rampLoss;                                          // 项2 爬坡损失
  const hiring = gc('hiringCostDefaultAmt');                               // 项3 完全招聘成本
  return { tagAmt: vacancy + rampLoss + hiring, vacancyAmt: vacancy, rampLossAmt: rampLoss, hiringAmt: hiring };
}

/* ---------- F15 内推奖 = max(1000元, round100(价签 × 1%))（金额入参为分，返回元） ---------- */
export function referralBonus(tagAmt, gc) { gc = gc || getCoef; return Math.max(1000, round100((tagAmt / YUAN) * gc('zhaoren.referralBonusRate'))); }

/* ---------- F15 QCS = 100×(0.4×留存12 + 0.3×存活90 + 0.3×净贡献归一) ---------- */
export function qcs(channel, allChannels, gc) {
  gc = gc || getCoef; const w = gc('zhaoren.qcsWeights');
  const maxNet = Math.max(...allChannels.map(c => c.netMean));
  const norm = safeDiv(channel.netMean, maxNet); if (norm == null) return null;
  return 100 * (w[0] * channel.retain12 + w[1] * channel.survive90 + w[2] * norm);
}

/* ---------- 闸⑦ 查重三条（phone 硬钥匙；脱敏：姓+*、前三后二） ---------- */
export function maskName(name) { if (!name) return '*'; if (name.length <= 1) return name + '*'; return name[0] + '*'.repeat(name.length - 1); }
export function maskPhone(p) { return p ? p.slice(0, 3) + '****' + p.slice(-2) : '—'; }
export function dedupPhone(phone, ctx) {
  const inCand = (ctx.candidates || []).find(c => c.phone === phone);
  if (inCand) return { verdict: 'block', reason: 'candidate', tip: `候选人库已存在：${maskName(inCand.name)} / ${maskPhone(phone)}` };
  const active = (ctx.employees || []).find(e => e.phone === phone && e.isActive);
  if (active) return { verdict: 'block', reason: 'active', tip: `与在职员工重复` };
  const left = (ctx.employees || []).find(e => e.phone === phone && !e.isActive);
  if (left) return { verdict: 'pass', reason: 'left', tip: `曾于 ${(left.leaveDate || '').slice(0, 7)} 在职，原因 ${left.leaveReason || '—'}`, warn: true };
  return { verdict: 'pass', reason: 'new' };
}

/* ---------- 闸⑫ 认知鸿沟 = 1 − 确认/上报（🔴 分子只取 confirmed）；no_response>7天→自动 confirmed ---------- */
export function cognitiveGap(reported, confirmed) { const ratio = safeDiv(confirmed, reported); return ratio == null ? null : 1 - ratio; }
export function autoConfirm(daysSinceReport, gc) { gc = gc || getCoef; return daysSinceReport > gc('zhaoren.ackAutoConfirmDays'); }

/* ---------- 闸⑪ 练习量：前14天<50 → 🔴 + S曲线右移2月（🔴 永不阻止打电话） ---------- */
export function practiceGate(count14d, gc) {
  gc = gc || getCoef; const floor = gc('zhaoren.practiceMinCount14d');
  const red = count14d < floor;
  return { red, floor, count: count14d, shiftMonths: red ? gc('zhaoren.practiceCurveShiftMonths') : 0 };
}

/* ---------- T23 · 转池函数：候选人 hired → Employee 建档回链；
   🔴 Z-D1：darkTriad 明细编码与 joltType 立即销毁——仅保留 darkTriadScore 数值供 F12 匿名统计 ---------- */
export function hireCandidate(cand, scorePack, form) {
  const employee = { spId: 'emp_' + form.stamp, name: form.name, phone: form.phone, hireDate: form.hireDate,
    hiringCostAmt: form.hiringCostAmt, baseSalaryAmt: form.startBaseSalaryAmt, hireBatchId: form.batchId,
    managerId: form.mentorManagerName, sourceChannel: cand.sourceChannel, level: 0, positionType: 'sales',
    cityTier: form.cityTier || 'tier1', leaveDate: null, leaveReason: null, managerName: form.mentorManagerName, isActive: true };
  const scorePackAfter = { packId: scorePack.packId, candId: scorePack.candId, scores: scorePack.scores,
    darkTriadScore: scorePack.darkTriadScore, scoredDate: scorePack.scoredDate, employeeId: employee.spId };
  // 明细销毁 = 白名单重建：darkTriadDetail / joltType 无任何拷贝路径
  return { employee, scorePackAfter, candLink: employee.spId };
}

/* ---------- 信封（公约【7】skab_v1；board=zhaoren；用 shared.buildEnvelope/validateEnvelope） ---------- */
export function exportEnvelope({ derived = {}, entities = {}, today, coefficientsHash = '' }) {
  return buildEnvelope({ board: 'zhaoren', exportedAt: today, derived, entities, coefficientsHash });
}
/** 导入他方信封 → ExternalRef 记录（🔴 只读、整条覆盖、永不进信封——存储由服务层负责） */
export function importEnvelope(env, importedAt = null) {
  const v = validateEnvelope(env);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, board: env.board, ref: { exportedAt: env.exportedAt, dataVersion: env.dataVersion,
    coefficientsHash: env.coefficientsHash || null, derived: env.derived || {}, importedAt } };
}
export function staleDays(exportedAt, today) { return diffDays(exportedAt, today); }

/* ============================================================
   效度实验室 · 内置演示模拟集（数值与原版 HTML SIM 常量逐字同源，对拍 T12–T21 依据）
   ============================================================ */
export const SIM = {
  f11_y:   [82, 41, 63, 90, 28, 55, 74, 47, 60, 35, 69, 51],
  f11_ach: [50, 44, 48, 68, 40, 59, 50, 64, 61, 50, 50, 65],
  f11_cha: [48, 62, 50, 60, 49, 43, 44, 42, 68, 67, 55, 48],
  f11_exp: [40, 51, 66, 45, 48, 47, 59, 73, 66, 43, 57, 74],
  f12: [{ peakScore: 82, collapseMonth: 11, momDrop: -0.55 }, { peakScore: 78, collapseMonth: 12, momDrop: -0.48 },
    { peakScore: 90, collapseMonth: 13, momDrop: -0.62 }, { peakScore: 74, collapseMonth: 14, momDrop: -0.44 },
    { peakScore: 76, collapseMonth: null, momDrop: -0.10 }, { peakScore: 81, collapseMonth: null, momDrop: 0.05 }],
  f14_against: [18 * WAN, 21 * WAN, 24 * WAN], f14_comply: [34 * WAN, 36 * WAN, 38 * WAN, 40 * WAN],
  f14_over: 9, f14_dec: 40, f14_s2: 0.44, f14_s1: 0.78,
  channels: [{ name: '内推 referral', key: 'referral', retain12: 0.81, survive90: 0.85, netMean: 43 * WAN },
    { name: 'Boss直聘', key: 'boss_zhipin', retain12: 0.52, survive90: 0.61, netMean: 31 * WAN }],
};
export function f11people() { return SIM.f11_y.map((y, i) => ({ margin12: y, scores: { achievement: SIM.f11_ach[i], charisma: SIM.f11_cha[i], experience: SIM.f11_exp[i] } })); }
