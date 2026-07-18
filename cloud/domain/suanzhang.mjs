/* ============================================================
   云端 L2 · 3号《销冠算账器 v3.3》业务引擎（服务端纯函数版）
   唯一权威口径：《0号公约 v1.5》§4/§5 + 《3号算账器 v3.3》件三。
   业务口径零改写：公式/阈值/分支与原版单文件引擎逐字同源。
   铁律：
   - 宪法函数（totalIncome/laborCost/netContribution/commission）
     由 ../domain/shared.mjs 唯一提供，本模块只 re-export，禁止重复实现。
   - 除法只经 safeDiv；系数只经 gc（默认 getCoef，可注入租户覆盖层）。
   - 时钟注入（公约 C-14）：含日期计算 today 一律显式传参，本模块无 new Date()。
   - 金额一律「分」(int)；比率 0–1 小数；null ≠ 0（证据缺失显"—"）。
   ============================================================ */
import {
  safeDiv, percentileR7, getCoef, makeGetCoef, buildEnvelope, diffDays,
  commission, totalIncome, laborCost, netContribution,
} from './shared.mjs';

/* 宪法函数 re-export（唯一源 = shared.mjs，公约【4】） */
export { commission, totalIncome, laborCost, netContribution, safeDiv, percentileR7, getCoef, makeGetCoef };

/* ---------- 公约 4.4 杠杆链（全系统唯一分解口径） ---------- */
export const leverageChain = c =>
  (c.leads || 0) * (c.convRate || 0) * (c.aov || 0) * (c.marginRate || 0) - (c.laborCostAmt || 0);

/* ---------- 3.2 M21 地盘归一化（全系统最重的锁） ---------- */
export function m21Normalize(people, gc = getCoef) {
  const n = people.length; if (n === 0) return { done: false, rows: [], imbalanceRate: null };
  const totalLeads = people.reduce((a, p) => a + (p.leads || 0), 0);
  const totalMargin = people.reduce((a, p) => a + (p.grossMarginAmt || 0), 0);
  const perCapitaLeads = safeDiv(totalLeads, n);
  const band = gc('suanzhang.territoryBand');
  const rows = people.map(p => {
    const index = safeDiv(p.leads, perCapitaLeads);
    const over = index != null && index > band[1], under = index != null && index < band[0];
    const unit = safeDiv(p.grossMarginAmt, p.leads);
    const nb = (unit == null || perCapitaLeads == null) ? null : unit * perCapitaLeads;
    const ss = safeDiv(p.selfDevLeads || 0, p.leads);
    const sf = 1 + (ss || 0) * gc('suanzhang.selfDevBonusFactor');
    const nm = nb == null ? null : nb * sf;
    return { id: p.id, name: p.name, leads: p.leads, grossMarginAmt: p.grossMarginAmt, selfDevLeads: p.selfDevLeads || 0, index, over, under, unitLeadMargin: unit, normMargin: nm, selfFactor: sf };
  });
  const bo = rows.slice().sort((a, b) => (b.grossMarginAmt || 0) - (a.grossMarginAmt || 0));
  bo.forEach((r, i) => { r.origRank = i + 1; });
  const bn = rows.slice().sort((a, b) => {
    const av = a.normMargin == null ? -Infinity : a.normMargin, bv = b.normMargin == null ? -Infinity : b.normMargin;
    return bv - av;
  });
  bn.forEach((r, i) => { r.normRank = i + 1; });
  const ic = rows.filter(r => r.over || r.under).length;
  const rb = gc('redrawGainBand');
  return {
    done: true, rows, n, totalLeads, totalMargin, perCapitaLeads,
    imbalanceRate: safeDiv(ic, n), imbalCount: ic,
    redrawBand: [totalMargin * rb[0], totalMargin * rb[1]],
  };
}

/* ---------- 3.1b M2-P90 真实头部因子（样本<8→null，P90 用 R-7 法） ---------- */
export function realP90Factor(g, gc = getCoef) {
  const v = (g || []).filter(x => x != null && isFinite(x));
  if (v.length < gc('suanzhang.p90MinSample')) return null;
  const s = v.slice().sort((a, b) => a - b);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return safeDiv(percentileR7(s, 0.90), m);
}

/* ---------- 3.3 M32 UER 全套 ---------- */
/** 观测构造：一条人×月观测 → {x:[1, 线索量, 转化率, 客单价(万元), 毛利率], y: 净贡献(毛利−laborCost)}
    与原版 uerAll 面板逐字同口径（aov 以 1e6 分 = 万元为单位入回归，防条件数病态）。 */
export function uerObservation({ leads, dealCount, paymentAmt, grossMarginAmt, laborCostAmt }) {
  if (!dealCount || !leads) return null;                       // 无成交或无线索 → 不构成观测
  return {
    x: [1, leads, safeDiv(dealCount, leads) || 0, (safeDiv(paymentAmt, dealCount) || 0) / 1e6, safeDiv(grossMarginAmt, paymentAmt) || 0],
    y: (grossMarginAmt || 0) - (laborCostAmt || 0),
  };
}
/** 高斯消元（部分主元）；奇异 → null */
export function solveLinear(Ain, bin) {
  const n = Ain.length; const M = Ain.map((r, i) => r.slice().concat([bin[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    const t = M[col]; M[col] = M[piv]; M[piv] = t; const pv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r2 = 0; r2 < n; r2++) { if (r2 === col) continue; const f2 = M[r2][col]; for (let c2 = col; c2 <= n; c2++) M[r2][c2] -= f2 * M[col][c2]; }
  }
  return M.map(r => r[n]);
}
/** OLS（正规方程 + 高斯消元）→ {beta, pred, resid}；奇异 → null */
export function olsFit(X, y) {
  const n = X.length, k = X[0].length, A = [], b = [];
  for (let i = 0; i < k; i++) { A.push(new Array(k).fill(0)); b.push(0); }
  for (let r = 0; r < n; r++) for (let a = 0; a < k; a++) { b[a] += X[r][a] * y[r]; for (let c = 0; c < k; c++) A[a][c] += X[r][a] * X[r][c]; }
  const beta = solveLinear(A, b); if (!beta) return null;
  const pred = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
  return { beta, pred, resid: y.map((v, i) => v - pred[i]) };
}
/** 引擎原样：总体 σ（滤 null，n≥1；与公约 stddevP 的差异是口径级——UER 分档基准，不改） */
export function stddev(arr) {
  const v = arr.filter(x => x != null); if (v.length === 0) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
}
/** UER 分档：>+σ 🟢green / <−σ 🔴red / 带内 ⚪gray；σ 缺失或为 0 → null */
export const uerBand = (resid, sigma) => {
  if (resid == null || sigma == null || sigma === 0) return null;
  if (resid > sigma) return 'green'; if (resid < -sigma) return 'red'; return 'gray';
};
/** 观测门槛：≥ uerMinObs(48 = 8人×6月) 才允许出 UER */
export const uerObsGate = (n, gc = getCoef) => (n || 0) >= gc('suanzhang.uerMinObs');
/** 团队 UER 均值（本期各人残差的算术平均；空集 → null） */
export const uerTeamMean = resids => {
  const v = (resids || []).filter(x => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/* ---------- 3.3 产权价值（每组≥4人、≥6月；相关性非因果——话术 S-04 强制） ---------- */
export function propertyValue(withM28, without, monthsWith, monthsWithout, gc = getCoef) {
  const req = gc('suanzhang.propertyMinEach');
  if (withM28.length < req.people || without.length < req.people ||
      (monthsWith != null && monthsWith < req.months) || (monthsWithout != null && monthsWithout < req.months)) return null;
  return withM28.reduce((a, b) => a + b, 0) / withM28.length - without.reduce((a, b) => a + b, 0) / without.length;
}

/* ---------- 3.3b 个人 UER 归因动态判定（S-C10：leak / territory / undetermined） ---------- */
export function personAttribution(x, gc = getCoef) {
  const kX = gc('suanzhang.personLeakX'), band = gc('suanzhang.territoryBand');
  const leakD = (x.discountLeakRate != null && x.teamDiscountLeakRate != null && x.discountLeakRate > x.teamDiscountLeakRate * kX);
  const leakC = (x.complaintRate != null && x.teamComplaintRate != null && x.complaintRate > x.teamComplaintRate * kX);
  const eLeak = leakD || leakC;
  const eTer = (x.leadIndex != null && x.leadIndex < band[0]);
  const verdict = eLeak ? 'leak' : (eTer ? 'territory' : 'undetermined');
  const badList = [];
  if (leakD) badList.push('折扣泄漏率' + fmtPct(x.discountLeakRate) + '＞均值×' + kX);
  if (leakC) badList.push('客诉率' + fmtPct(x.complaintRate) + '＞均值×' + kX);
  return { verdict, badList, eLeak, eTerritory: eTer };
}

/* ---------- 3.4 DVI（<10 笔成交→null；分档 >70🟢 / 40–70🟡 / <40🔴） ---------- */
export function dvi(x, gc = getCoef) {
  if (x.dealCount != null && x.dealCount < gc('suanzhang.dviMinDeals')) return null;
  const lag = Math.min((x.medianEntryLagDays || 0) / 7, 1);
  return 25 * (x.reportRate || 0) + 25 * (1 - lag) + 25 * (x.leadAttribRate || 0) + 25 * (x.discountRecordRate || 0);
}
export const dviBand = v => { if (v == null) return null; return v > 70 ? 'green' : (v >= 40 ? 'amber' : 'red'); };

/* ---------- 3.6b 闸⑪ 敲竹杠三证据链动态判定（S-C07 · 结论禁止硬编码 S-D16） ---------- */
export function hijackVerdict(ev, gc = getCoef) {
  const e1 = ev.ahc, e2 = ev.m28Coverage, e3 = ev.irrevocable;
  if (e1 == null || e2 == null || e3 == null) {
    const mi = [];
    if (e1 == null) mi.push('AHC'); if (e2 == null) mi.push('M28 协议数'); if (e3 == null) mi.push('irrevocable 条款');
    return { verdict: 'insufficient', missingList: mi };
  }
  const line = gc('ahcTrustLine');
  const bad = (e1 < line ? 1 : 0) + (e2 === 0 ? 1 : 0) + (e3 === false ? 1 : 0);
  const bl = [];
  if (e1 < line) bl.push('AHC ' + e1 + '<' + line);
  if (e2 === 0) bl.push('M28 覆盖 0%');
  if (e3 === false) bl.push('irrevocable 未开');
  return { verdict: bad >= 1 ? 'pointed_hoarding' : 'not_supported', bad, badList: bl };
}

/* ---------- 3.5 M33 产品证据包（四证据判定式；结语 S-06 固定文案由展示层持有） ---------- */
export function m33Evidence(x, gc = getCoef) {
  const e1 = x.winRate != null && x.winRate < gc('suanzhang.winRateCeiling');
  const e2 = x.refundByCategoryX != null && x.refundByCategoryX > gc('suanzhang.refundConcentrationX');
  const fd = gc('suanzhang.forcedDiscount');
  const e3 = x.discountRate != null && x.pushShare != null && x.discountRate > fd.rate && x.pushShare > fd.share;
  const e4 = x.leaverLowMarginRatioMedian != null && x.teamLowMarginRatio != null && x.leaverLowMarginRatioMedian > x.teamLowMarginRatio * gc('suanzhang.leaverCategoryX');
  return { e1, e2, e3, e4, any: e1 || e2 || e3 || e4 };
}

/* ---------- 3.6 闸⑤ 折扣泄漏（泄漏率>6%🔴、期末冲刺占比>40%🔴） ---------- */
export function gateDiscountLeak(ds, gc = getCoef) {
  let sd = 0, sl = 0, sp = 0;
  (ds || []).forEach(d => { sd += (d.discountAmt || 0); sl += (d.listPriceAmt || 0); if (d.reason === 'period_end_push') sp += (d.discountAmt || 0); });
  const lr = safeDiv(sd, sl), ps = safeDiv(sp, sd);
  return {
    leakRate: lr, pushShare: ps, sumDiscountAmt: sd,
    leakRed: lr != null && lr > gc('suanzhang.discountLeakRedline'),
    pushRed: ps != null && ps > gc('suanzhang.pushShareRedline'),
  };
}

/* ---------- 3.6 闸⑦ 剪刀差 + 一笔六吃摊薄 ---------- */
export const scissors = (contribGrowth, incomeGrowth) =>
  (contribGrowth == null || incomeGrowth == null) ? null : contribGrowth - incomeGrowth;
/** 摊薄口径：年终奖÷12、分红按周期月数、即时照实（periodMonths 仅 dividend 用） */
export function amortizeForScissors(type, amount, periodMonths) {
  if (amount == null) return null;
  if (type === 'year_end_bonus') return amount / 12;
  if (type === 'dividend') return periodMonths ? amount / periodMonths : amount;
  return amount;
}

/* ---------- 3.6 闸⑨ 品类低价熔断（毛利率<22% ∧ 回款占比>20%） ---------- */
export const categoryFuse = (marginRate, payShare, gc = getCoef) =>
  marginRate != null && payShare != null &&
  marginRate < gc('suanzhang.categoryFuseMarginRate') && payShare > gc('suanzhang.categoryFuseShareRate');

/* ---------- 3.9 M34 时点套利（罪证打印机①） ---------- */
export function m34Arbitrage(tailRate, headRate, tailYearPayAmt, threshold, bunchIndex, gc = getCoef) {
  const diff = (tailRate || 0) - (headRate || 0);
  const leak = Math.max(0, diff) * (tailYearPayAmt || 0);
  return {
    tailRate, headRate, diff, annualLeakAmt: leak, bunchIndex,
    red: diff > gc('suanzhang.m34DiffRedline') || (bunchIndex != null && bunchIndex > gc('suanzhang.m34BunchRedline')),
  };
}
export const m34ArbitrageFromRates = m34Arbitrage;   // 原版函数名别名（同一实现）

/* ---------- 3.11 M35 淘汰误杀（jump = 原始排名 − 归一化排名 ≥ ceil(n×30%) → 警报） ---------- */
export function m35Misfire(origRank, normRank, teamN, gc = getCoef) {
  const j = origRank - normRank, t = Math.ceil(teamN * gc('suanzhang.m35RankJumpShare'));
  return { jump: j, threshold: t, misfire: j >= t };
}

/* ---------- 3.12 M36 卡线率（带=[底线, floor(底线×1.15)]；<30人天→rate:null） ---------- */
export function m36BunchRate(counts, baseline, gc = getCoef) {
  if (baseline == null) return null;
  const hi = Math.floor(baseline * (1 + gc('suanzhang.m36Band'))), total = counts.length;
  if (total < gc('suanzhang.m36MinManDays')) return { rate: null, band: [baseline, hi], reason: 'insufficient' };
  const inb = counts.filter(c => c >= baseline && c <= hi).length, rate = safeDiv(inb, total);
  return { rate, band: [baseline, hi], inBand: inb, total, red: rate != null && rate > gc('suanzhang.m36Redline') };
}

/* ---------- 3.10 红包体检（PayoutEntry 第六吃：rule① 金额过小 / rule② 即时无条件≥3笔） ---------- */
export function hongbaoCheck(x, gc = getCoef) {
  const r1 = x.dailyAvgCommission != null && x.amount < x.dailyAvgCommission * gc('suanzhang.hongbaoDailyX');
  const r2 = x.timing === 'immediate' && x.hasCondition === false &&
             (x.rolling12ImmediateUncondCount || 0) >= gc('suanzhang.hongbaoRepeatN');
  return { rule1: r1, rule2: r2 };
}

/* ---------- 3.7 M18 止血分诊双校验（starved 拦截 / invisible_work 提示 / proceed） ---------- */
export function stopBleedTriage(x, gc = getCoef) {
  const cand = (x.zeroEventDays >= gc('suanzhang.stopBleedDays')) && x.isActivePaid;
  if (!cand) return { candidate: false };
  if (x.leadIndex != null && x.leadIndex < gc('suanzhang.territoryStarveIdx')) return { candidate: true, verdict: 'starved', block: true };
  if (x.uer != null && x.uer > 0) return { candidate: true, verdict: 'invisible_work', block: false };
  return { candidate: true, verdict: 'proceed', block: false };
}

/* ---------- 3.7 回本进度率 / 3.8 M11 主管增益（归一化口径 S-C03；任期<3月→null） ---------- */
export const paybackProgress = (cumMarginAmt, cumLaborAmt) => safeDiv(cumMarginAmt, cumLaborAmt);
export function managerLift(teamNormPerCapita, companyNormPerCapita, tenureMonths) {
  if (tenureMonths != null && tenureMonths < 3) return null;
  return safeDiv(teamNormPerCapita, companyNormPerCapita);
}

/* ---------- 3.13 信封（board=suanzhang）+ ExternalRef（只读缓存，整条覆盖） ---------- */
export function buildSuanzhangEnvelope(exportedAt, derived, entities, coefficientsHash) {
  return buildEnvelope({ board: 'suanzhang', exportedAt, derived: derived || {}, entities: entities || {}, coefficientsHash: coefficientsHash || '' });
}
export function toExternalRef(env, importedAt) {
  if (!env || !env.board) return null;
  return {
    board: env.board, exportedAt: env.exportedAt || null, dataVersion: env.dataVersion || 1,
    coefficientsHash: env.coefficientsHash || '', derived: env.derived || {}, entities: env.entities || {},
    importedAt: importedAt || null,
  };
}

/* ---------- 3.14 信封新鲜度（today 显式传参；过期只标注、不阻断、不改判定） ---------- */
export function staleDays(today, exportedAt) {
  if (!today || !exportedAt) return null;
  try { return diffDays(exportedAt, today); } catch { return null; }
}
export function isStale(today, exportedAt, gc = getCoef) {
  const d = staleDays(today, exportedAt);
  return d != null && d > gc('envelopeStaleDays');
}

/* ---------- 展示层格式（公约【2】：金额分→元千分位整数；万 1 位；比率 ×100 1 位） ---------- */
export const fmtPct = (rate, dp) => rate == null ? '—' : (rate * 100).toFixed(dp == null ? 1 : dp) + '%';
export const fmtYuan = fen => fen == null ? '—' : '¥' + Math.round(fen / 100).toLocaleString('en-US');
export const fmtWan = (fen, dp) => fen == null ? '—' : (fen / 100 / 10000).toFixed(dp == null ? 1 : dp) + ' 万';
