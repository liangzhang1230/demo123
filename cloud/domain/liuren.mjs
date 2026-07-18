/* ============================================================
   云端 C1 · 4号《销冠留人器》业务引擎（服务端纯函数模块）
   权威口径：《4号留人器 v4.4》件三（唯一权威）＋《0号公约 v1.5》
   底稿：suite/originals-liuren.html（件七 T1–T19 可执行版）——冲突以规格为准
   铁律：
   - 全部纯函数：不读全局、不写入参状态；变更以「指令 events」返回（如 tryDowngradeM28）
   - today 显式传参（公约 C-14 时钟注入）；本模块零 new Date()
   - 系数只经 gc（makeGetCoef 产物）参数化注入；除法只经 safeDiv
   - null ≠ 0：证据缺失返回 null（上层渲染"—"），绝不退化为默认结论（A-19）
   ============================================================ */

import {
  safeDiv, diffDays, getCoef, rampCurve12, buildEnvelope, validateEnvelope, pearson,
} from './shared.mjs';

/* ---------- 分带（原版同源：SII 越低越好，其余越高越好） ---------- */
export const bandBy = (v, lo, hi, higherIsBetter) => {
  if (v == null) return null;
  if (higherIsBetter) return v >= hi ? 'success' : v >= lo ? 'warning' : 'danger';
  return v > hi ? 'danger' : v > lo ? 'warning' : 'success'; // 越低越好（SII）
};

/* ============================================================
   3.1 M29 四大指数（SII/EI 本板块；DVI 直传算账器信封；AHC 计算得出老板改不了）
   ============================================================ */
export function indices(db, today, gc = getCoef) {
  const gS = db.governance.sii, cS = gc('liuren.sii'), wS = cS.w, hS = gS.activeHeadcount;
  const siiRaw =
    wS[0] * (gS.dailyReportOn ? 1 : 0) +
    wS[1] * (gS.rollcallOn ? 1 : 0) +
    wS[2] * Math.min(gS.spotChecksPerWeek / cS.spotCap, 1) +
    wS[3] * Math.min(gS.approvalLevels / cS.approveCap, 1) +
    wS[4] * Math.min((safeDiv(gS.monthlyViewsTotal, hS * cS.viewPerCapMonth) ?? 0), 1) +
    wS[5] * Math.min((safeDiv(gS.rxCountTotal, hS * cS.rxPerCapMonth) ?? 0), 1);
  const sii = Math.round(siiRaw);

  const gE = db.governance.ei, cE = gc('liuren.ei'), wE = cE.w, hE = gE.activeHeadcount;
  // 🔧L-C15：建议提出数=0 → 采纳项按 0 计（A-19 例外显性化：授权通道未被使用，非证据缺失）
  const adoptRatio = gE.suggestionsRaised > 0 ? gE.suggestionsAdopted / gE.suggestionsRaised : 0;
  const eiRaw =
    wE[0] * Math.min((safeDiv(gE.objectionsRaisedQuarter, hE * cE.objectionPerCapQuarter) ?? 0), 1) +
    wE[1] * adoptRatio +
    wE[2] * gE.covenantConfirmRatio +
    wE[3] * (1 - gE.cardIgnoreRate);
  const ei = Math.round(eiRaw);

  // DVI：数据源=算账器信封 derived.dvi 直传；未导入 → null（"—（需算账器数据）"）
  const sz = db.externalRefs ? db.externalRefs.suanzhang : null;
  const dvi = (sz && sz.derived && sz.derived.dvi != null) ? sz.derived.dvi : null;

  const a = db.governance.ahcInputs, cA = gc('liuren.ahc'), wA = cA.w;
  // irrevocable 覆盖 = 前程合约 irrevocable 占比（0 合约 → 回退 ahcInputs.irrevocableRatio）
  const covs = (db.entities && db.entities.Covenant) || [];
  const irrRatio = covs.length ? covs.filter(c => c.irrevocable).length / covs.length : (a.irrevocableRatio || 0);
  const ahcRaw =
    wA[0] * a.honoredRatio +
    wA[1] * irrRatio +
    wA[2] * (1 - Math.min(a.interceptCount / cA.interceptCap, 1)) +
    wA[3] * (1 - Math.min(a.ratchetCount / cA.ratchetCap, 1));
  const ahc = Math.round(ahcRaw);

  return {
    sii: { value: sii, raw: siiRaw, band: bandBy(sii, cS.bands[0], cS.bands[1], false), asOf: today, source: '本机' },
    ei: { value: ei, raw: eiRaw, band: bandBy(ei, cE.bands[0], cE.bands[1], true), asOf: today, source: '本机' },
    dvi: { value: dvi, raw: dvi, band: bandBy(dvi, 30, 60, true), asOf: sz ? sz.exportedAt : null, source: dvi == null ? null : '算账器' },
    ahc: { value: ahc, raw: ahcRaw, band: bandBy(ahc, cA.bands[0], cA.bands[1], true), asOf: today, source: '本机' },
  };
}

/* ---------- 3.2 M29.5 自评-实评偏差器（DVI 缺 → 3 项均值） ---------- */
export function selfRatingDeviation(self, actual) {
  const pairs = [['监督 SII', self.sii, actual.sii], ['授权 EI', self.ei, actual.ei],
                 ['可见 DVI', self.dvi, actual.dvi], ['信用 AHC', self.ahc, actual.ahc]];
  const rows = pairs.filter(p => p[2] != null).map(p => ({ label: p[0], self: p[1], actual: p[2], gap: Math.abs(p[1] - p[2]) }));
  const gap = rows.length ? Math.round(rows.reduce((s, d) => s + d.gap, 0) / rows.length) : null;
  return { rows, gap };
}

/* ============================================================
   3.5 M28 产权四件（对价 + irrevocable 代码拦截 L-D1）
   ============================================================ */
export function m28Value(agr) {
  if (agr.kind === 'mentoring') return (agr.apprenticeMonthlyNetAmt || 0) * agr.rate * agr.durationMonths;
  if (agr.kind === 'royalty') return (agr.teamMonthlyIncrementAmt || 0) * agr.rate * agr.durationMonths;
  return null;
}

/** 🔴 L-D1：下调/缩短在代码层无成功路径。纯函数——不改任何状态，只返回变更指令 events：
 *  ① OverrideEvent 留痕（全员可见）② interceptCount +1（→AHC 重算下降）。由服务层应用。 */
export function tryDowngradeM28(agreements, m28Id, today, note) {
  const agr = (agreements || []).find(x => x.m28Id === m28Id);
  if (!agr) return { ok: false, reason: 'not_found', events: [] };
  return {
    ok: false, reason: 'irrevocable_blocked', downgraded: false, logged: true,
    events: [
      { op: 'append', entity: 'OverrideEvent', record: { m28Id, at: today, action: 'try_downgrade', note: note || '', visibleToAll: true } },
      { op: 'inc', path: 'governance.ahcInputs.interceptCount', by: 1 },
    ],
  };
}

/* ============================================================
   3.7 M16.1 流失价签（🔧L-C04 全系统权威 6 项口径）T1–T4
   ============================================================ */
/** 爬坡缺口月当量 = Σ(1−curve[m]/100)（公约 §4.7 rampCurve12 实算；regular ≈ 5.78 月） */
export function rampGapMonthsEqOf(cycle) {
  const arr = rampCurve12[cycle];
  if (!arr) return null;
  let s = 0;
  for (const v of arr) s += 1 - v / 100;
  return s;
}

export function priceTag6(db, today, gc = getCoef) {
  const p = db.priceTag;
  if (!p) return null;
  const gm = p.monthlyGrossMarginAmt;
  if (gm == null) return null;
  const person = ((db.entities && db.entities.Salesperson) || []).find(s => s.spId === p.spId);
  // 月当量：件七可执行版以输入快照为准（出厂 5.078）；未提供 → 由 cycleTier 曲线实算 Σ(1−c/100)
  const eq = p.rampGapMonthsEq != null ? p.rampGapMonthsEq
    : rampGapMonthsEqOf((db.company && db.company.cycleTier) || 'regular');
  const headline = Math.round(gm * (p.hireMonths + p.paybackMonths));   // ① 权威估算（T1=75万）
  const rampGap = Math.round(gm * eq);                                  // ② 最大头
  const rampGapShare = safeDiv(rampGap, headline);                      // T2
  const raiseAnnual = (p.raiseMonthlyAmt || 0) * 12;
  const raiseVsTag = safeDiv(headline, raiseAnnual);                    // T3
  const shortenGainAnnual = Math.round(rampGap * (p.shortenPct || 0) * (p.hiresPerYear || 0)); // T4
  // ⑥ 在途单交接损耗（急性）：仅已录 HandoverCard 的具名在途单（M38 回填）；无 → null（"—"）
  const hCards = ((db.entities && db.entities.HandoverCard) || []).filter(c => c.leaverId === p.spId);
  const handoverAmt = hCards.length
    ? Math.round(hCards.reduce((s, c) => s + (c.amountAmt || 0), 0) * gc('handoverLossRate'))
    : null;
  const items = [
    { key: 'hiring', name: '① 招聘成本', amt: person ? person.hiringCostAmt : gc('hiringCostDefaultAmt'), scope: '完全招聘成本' },
    { key: 'ramp', name: '② 爬坡缺口', amt: rampGap, scope: '🔴 最大头', big: true },
    { key: 'idlepipe', name: '③ 空窗管道', amt: Math.round(gm * p.hireMonths), scope: '招聘周期内无人产出' },
    { key: 'mgr', name: '④ 经理时间', amt: Math.round(gm * 0.4), scope: '重新带人的管理耗时' },
    // 🔴 ⑤⑥ 互不重叠、不得双计（公约 5.4#3 / L-D15）：⑤慢性=管道整体降效；⑥急性=具名在途单一次性折损
    { key: 'decay', name: '⑤ 接手劣化 35%（慢性）', amt: Math.round(gm * gc('liuren.pipelineDecayInPriceTag')), scope: '常规客户/管道整体降效' },
    { key: 'handover', name: '⑥ 在途单交接 40%（急性）', amt: handoverAmt, scope: handoverAmt == null ? '仅具名 HandoverCard；无在途单 → —' : `${hCards.length} 张具名交接卡 ×40%` },
  ];
  return {
    spId: p.spId, name: person ? person.name : null, gm, rampGapMonthsEq: eq,
    headline, rampGap, rampGapShare, raiseAnnual, raiseVsTag, shortenGainAnnual,
    hitGate5: rampGapShare != null && rampGapShare > gc('liuren.rampGapShareRedline'), // 闸⑤
    items, asOf: today,
  };
}

/* ---------- 3.7 M16.8 依赖度雷达 ---------- */
export function dependencyRadar(db, gc = getCoef) {
  const sz = db.externalRefs ? db.externalRefs.suanzhang : null;
  if (!sz || !sz.perPerson) return { value: null };
  const rows = Object.entries(sz.perPerson).map(([id, v]) => ({ id, collected: v.collected6m || 0, leadIndex: v.leadIndex }));
  const total = rows.reduce((s, r) => s + r.collected, 0);
  if (total === 0) return { value: null };
  rows.sort((a, b) => b.collected - a.collected);
  const top = rows[0];
  const ratio = safeDiv(top.collected, total);
  const person = ((db.entities && db.entities.Salesperson) || []).find(s => s.spId === top.id);
  const c = gc('liuren.dependency');
  return {
    value: ratio, topName: person ? person.name : top.id, topLeadIndex: top.leadIndex,
    band: ratio >= c.danger ? 'danger' : ratio >= c.warn ? 'warning' : 'success',
    selfMade: top.leadIndex > 1.5,                       // 地盘校正：依赖度一部分是你自己造出来的
    asOf: sz.exportedAt,
  };
}

/* ============================================================
   3.7 M16.3 该谈名单（五触发源中的 周年/剪刀差/榜眼 三源）T15
   ============================================================ */
export function anniversaryInDays(hireDate, today) {
  if (!hireDate) return null;
  const y = +today.slice(0, 4), md = hireDate.slice(5);
  let next = `${y}-${md}`;
  let dd = diffDays(today, next);
  if (dd < 0) { next = `${y + 1}-${md}`; dd = diffDays(today, next); }
  return dd;
}

export function secondPlaceTrigger(db, spId, gc = getCoef) {
  const sz = db.externalRefs ? db.externalRefs.suanzhang : null;
  if (!sz || !sz.perPerson || !sz.perPerson[spId]) return { hit: false };
  const pp = sz.perPerson[spId];
  const [lo, hi] = gc('liuren.secondPlaceRankBand');
  const n = gc('liuren.secondPlaceMonths');
  const recent = (pp.normRankMonths || []).slice(-n);
  const bandOk = recent.length >= n && recent.every(r => r >= lo && r <= hi);
  const zeroSpecial = (pp.specialPayout12m || 0) === 0;      // 滚 12 月特殊 PayoutEntry = 0 笔
  const scissorsPos = (pp.scissors || 0) > 0;
  return { hit: bandOk && (scissorsPos || zeroSpecial), months: recent.length, rank: recent[recent.length - 1], scissors: pp.scissors, zeroSpecial };
}

export function talkList(db, today, gc = getCoef) {
  const out = [];
  const sz = db.externalRefs ? db.externalRefs.suanzhang : null;
  for (const s of ((db.entities && db.entities.Salesperson) || [])) {
    if (!s.isActive) continue;
    const triggers = [];
    // ① 周年前 14 天
    const anni = anniversaryInDays(s.hireDate, today);
    if (anni != null && anni >= 0 && anni <= 14) triggers.push({ src: 'anniversary', label: '周年档', detail: `${anni} 天后周年` });
    // ④ 剪刀差 ≥30% ∧ 市价差 >0（阈值与算账器闸⑦同源）
    const pp = sz && sz.perPerson ? sz.perPerson[s.spId] : null;
    if (pp && pp.scissors >= gc('suanzhang.scissorsAlert') && pp.marketGap > 0) triggers.push({ src: 'scissors', label: '剪刀差档', detail: `剪刀差 ${Math.round(pp.scissors * 1000) / 10}%` });
    // ⑤ 榜眼档（理由卡 L-09）
    const sp = secondPlaceTrigger(db, s.spId, gc);
    if (sp.hit) triggers.push({ src: 'second_place', label: '榜眼档', detail: `连续 ${sp.months} 月第 ${sp.rank}`, sp });
    if (triggers.length) out.push({ spId: s.spId, name: s.name, triggers, pp });
  }
  return out;
}

/* ============================================================
   3.8 M37 参照点账本（发钱前预检）T13   LE-08 三态
   ============================================================ */
export function payoutPrecheck(db, spId, plannedAmt, today, gc = getCoef) {
  const sz = db.externalRefs ? db.externalRefs.suanzhang : null;
  const pp = sz && sz.perPerson ? sz.perPerson[spId] : null;
  // 历史参照点 = 去年同期同名目（year_end_bonus / dividend）实收；无 → "—（首年无参照）"仅出提示
  const lastYear = String(+today.slice(0, 4) - 1);
  const hist = (((db.entities && db.entities.PayoutEntry) || [])
    .filter(x => x.employeeId === spId && (x.type === 'year_end_bonus' || x.type === 'dividend') && x.period && x.period.startsWith(lastYear))
    .reduce((s, x) => s + x.amt, 0)) || null;
  const growth = pp && pp.contribGrowth != null ? pp.contribGrowth : null;   // 剪刀差·贡献增长率；null→退化为历史参照点
  let trend = null;
  if (hist != null) {
    const refRound = gc('liuren.refRound');
    const g = growth == null ? 0 : growth;
    trend = Math.round(hist * (1 + g) / refRound) * refRound;   // 取整到百元
  }
  let verdict = null;
  if (hist != null) {
    if (plannedAmt < hist) verdict = 'below_history';           // 🔴 L-10a
    else if (trend != null && plannedAmt < trend) verdict = 'below_trend'; // 🟡 L-10b
    else verdict = 'ok';                                        // 🟢 L-10c
  }
  return { hist, growth, trend, verdict, plannedAmt };
}

/* ============================================================
   3.9 M38 离职余震与交接损耗（72h SOP）T14
   ============================================================ */
export function handoverSummary(cards, gc = getCoef) {
  const sum = (cards || []).reduce((s, c) => s + (c.amountAmt || 0), 0);
  const loss = Math.round(sum * gc('handoverLossRate'));       // 40% 急性折损
  const save = Math.round(loss * gc('liuren.handoverSavableShare')); // 约一半可救
  return { count: (cards || []).length, sum, loss, save };
}

export function aftershockRank(db, leaverId) {
  const sz = db.externalRefs ? db.externalRefs.suanzhang : null;
  const people = (db.entities && db.entities.Salesperson) || [];
  const leaver = people.find(s => s.spId === leaverId);
  const rows = [];
  for (const s of people) {
    if (!s.isActive || s.spId === leaverId) continue;
    const pp = sz && sz.perPerson ? sz.perPerson[s.spId] : null;
    if (!pp) continue;
    let score = 0; const sig = [];
    if (pp.scissors > 0) { score++; sig.push('剪刀差>0'); }
    if (pp.marketGap > 0) { score++; sig.push('市价差>0'); }
    const sameTerr = !!leaver && (s.cityTier === leaver.cityTier || (!!s.hireBatchId && s.hireBatchId === leaver.hireBatchId));
    if (sameTerr) { score++; sig.push('同辖区/批次'); }
    rows.push({ spId: s.spId, name: s.name, score, sig, scissors: pp.scissors, marketGap: pp.marketGap });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, 3);   // Top3 → 一周内每人一次一对一（L-11）
}

/* ---------- 3.3 M30：异议 pending>7 天 → 关联负面标记自动失效（L-D6，默认保护员工）
   纯函数：返回应失效的 objId 清单，由服务层落库。 ---------- */
export function sweepObjections(objections, today) {
  const flipped = [];
  for (const o of (objections || [])) {
    if (o.status === 'pending' && o.markActive !== false && o.createdAt && diffDays(o.createdAt, today) > 7) flipped.push(o.objId);
  }
  return { count: flipped.length, flippedIds: flipped };
}

/* ============================================================
   3.6 十二道闸（本模块承载可计算的闸：①②③⑤⑥⑨；⑤已在 priceTag6.hitGate5）
   ============================================================ */
/** 闸①：M21 未出（算账器信封未导入）→ 全锁（话术 L-05） */
export function boardLocked(db) {
  const sz = db.externalRefs ? db.externalRefs.suanzhang : null;
  const m21Done = !!(sz && (sz.m21Done === true || (sz.derived && sz.derived.m21Done === true)));
  return !m21Done;
}

/** 闸②：排行榜唯一合法配置（引擎级配置常量白名单，T5） */
export function rankingConfig() {
  return { realName: true, showRankOnly: true, hideAmount: true, hideQuota: true, dataSource: 'm21_normalized' };
}

/* 闸③ 挤出对冲三态（🔴 与公约 §6.1 A-12 细则、5号闸⑧ 逐字同源，R-04 三处同改）T18 */
export const isResultTrigger = t => t === 'record_break' || t === 'sprint' || t === 'backlog_clear';
export const isExempt = t => t === 'first_deal' || t === 'hire';   // 豁免：无内在动机可挤出
export function bountyGate(t, silentTrackOn) {
  if (isExempt(t)) return { ok: true, reason: 'exempt' };
  if (isResultTrigger(t) && !silentTrackOn) return { ok: false, reason: 'need_silent_track', script: 'L-15', showEnable: true };
  return { ok: true, reason: 'ok' };
}

/** 闸⑥ 棘轮硬闸：棘轮系数 = corr(今年个人配额, 去年个人业绩) > 0.5 → 红 */
export function ratchetGate(quotaThisYear, perfLastYear, gc = getCoef) {
  const corr = pearson(quotaThisYear || [], perfLastYear || []);
  const threshold = gc('liuren.ratchetCorrThreshold');
  if (corr == null) return { corr: null, threshold, hit: null, verdict: null };   // 样本不足 → "—"
  const hit = corr > threshold;
  return { corr, threshold, hit, verdict: hit ? 'danger' : 'ok' };
}

/** 闸⑨ 黑暗三角崩塌（🔧L-C13 窗口统一 [10,18]，权威源=2号 collapseRule.monthIn） */
export function collapseGate(monthsIn, mom3Chg, hasScore, gc = getCoef) {
  if (!hasScore) return { verdict: null, note: '无评分数据 → —' };
  const [lo, hi] = gc('liuren.collapseMonthIn');
  const hit = monthsIn >= lo && monthsIn <= hi && mom3Chg < -0.40;
  return { verdict: hit ? 'warning' : null, note: hit ? '预期中的崩塌（只输出不建议挽留）' : '' };
}

/* ============================================================
   3.10 M17 分红（🔧L-C08 三重闸→四问 串联，顺序不可换）T11 / T19
   ============================================================ */
/** 闸⑧ 分红四问（体检；结构权归系统）——唯一调用点在 dividendCompute 三重闸判定之后（L-D16） */
export function fourQuestions(db, today, ind, goodHireIndex, gc = getCoef) {
  const yr = db.externalRefs ? db.externalRefs.yuren : null;
  const dose = yr && yr.derived ? yr.derived.coachingDoseActual : null;   // 未导入→null（退化为三问，"—"按未采集）
  const four = [
    { q: 'Q1 好招指数≥1.0', pass: goodHireIndex != null ? goodHireIndex >= 1.0 : null, val: goodHireIndex },
    { q: 'Q2 EI≥30', pass: ind.ei.value >= 30, val: ind.ei.value },
    { q: 'Q3 SII≤60', pass: ind.sii.value <= 60, val: ind.sii.value },
    { q: 'Q4 辅导剂量≥3h/月人', pass: dose == null ? null : dose >= 3, val: dose },
  ];
  const fails = four.filter(x => x.pass === false).length;
  return { four, fails, verdict: fails >= 2 ? 'danger' : fails === 1 ? 'warning' : 'ok' };   // 一否🟡 两否🔴 四否🔴
}

export function dividendCompute(db, today, opts = {}, gc = getCoef) {
  const cfg = opts.cfg || db.dividend;
  // ① 三重闸 = 发不发的资格门（数值权归老板；老板设、独立启停）
  const gates = [
    { key: 'companyCollect', label: '公司回款', ...cfg.gateCompanyCollect },
    { key: 'companyNet', label: '公司净贡献', ...cfg.gateCompanyNet },
    { key: 'personalCollect', label: '个人回款', ...cfg.gatePersonalCollect },
  ];
  const threeGatePass = gates.filter(g => g.enabled).every(g => g.pass);
  const result = { gates, threeGatePass, pool: 0, fourQuestionsRun: false, four: null, fourFailCount: null, verdict: null };
  if (!threeGatePass) {
    // 🔴 L-C08：不达 → 池=0，流程终止，不进四问（四问零调用，L-D16 调用链断言）
    result.pool = 0;
    result.verdict = 'no_eligibility';
    return result;
  }
  // 池（三重闸过后才算）
  result.pool = Math.round(cfg.netBeforeDividendAmt * cfg.poolRate);
  // ② 四问 = 该不该发的体检（结构权归系统）—— 🔴 永不清零池，只警告
  result.fourQuestionsRun = true;
  const ind = opts.indicators || indices(db, today, gc);
  const dj = db.externalRefs ? db.externalRefs.dingjia : null;
  const ghi = opts.goodHireIndex != null ? opts.goodHireIndex
    : (dj && dj.derived && dj.derived.goodHireIndex != null ? dj.derived.goodHireIndex : null);
  const fq = (opts._fourQuestions || fourQuestions)(db, today, ind, ghi, gc);   // 🔴 唯一调用点
  result.four = fq.four;
  result.fourFailCount = fq.fails;
  result.verdict = fq.verdict;
  return result;
}

/** [我知道风险，仍要启用]：纯函数返回留痕指令（留痕 + interceptCount+1 → AHC 扣分），不清零池 */
export function forceDividendAck(today, note) {
  return {
    acknowledged: true,
    events: [
      { op: 'append', entity: 'OverrideEvent', record: { at: today, action: 'force_dividend_risk_ack', note: note || '四问不达仍启用分红', visibleToAll: true } },
      { op: 'inc', path: 'governance.ahcInputs.interceptCount', by: 1 },
    ],
  };
}

/* ---------- 3.10 M17.4 MC 监督成本发包指数 ---------- */
export function mcCalc(dvi, cityTier, gc = getCoef, opts = {}) {
  if (dvi == null) return { value: null, reason: '需 DVI（算账器数据）' };
  const c = gc('liuren.mc'), w = c.w;
  const geo = cityTier === 'tier1' ? 0 : cityTier === 'tier2' ? 1 : cityTier === 'tier3' ? 2 : 3;   // LE-06 地理档
  const localJudge = opts.localJudge != null ? opts.localJudge : 0.5;   // normalize(客单价CV+周期CV+品类熵)，缺→中位
  const attrRate = opts.attrRate != null ? opts.attrRate : 0.7;         // 线索归因率
  const mc = w[0] * (1 - dvi / 100) + w[1] * (geo / 3) + w[2] * localJudge + w[3] * (1 - attrRate);
  const v = Math.round(mc);
  return { value: v, band: mc > c.bands[1] ? 'success' : mc < c.bands[0] ? 'danger' : 'warning' };   // >65🟢发包 <40🔴不发
}

/* ============================================================
   信封（公约【7】）：导出双载荷（🔧L-C11）＋ 整条覆盖式导入（A-20）T10 / T17
   ============================================================ */
/** 导出 board=liuren：ahc（derived，供算账器闸⑪证据 e1）+ M28Agreement（entities，证据 e2）双载荷；导出永不锁定（授-2） */
export function exportEnvelope(db, today, { coefficientsHash = '' } = {}, gc = getCoef) {
  const ind = indices(db, today, gc);
  const e = db.entities || {};
  return buildEnvelope({
    board: 'liuren', exportedAt: today, coefficientsHash,
    derived: { ahc: ind.ahc.value, dvi: ind.dvi.value },
    entities: {
      M28Agreement: e.M28Agreement || [],
      Covenant: e.Covenant || [],
      LedgerEntry: e.LedgerEntry || [],
      ObjectionEntry: e.ObjectionEntry || [],
      SuggestionEntry: e.SuggestionEntry || [],
      HandoverCard: e.HandoverCard || [],
    },
  });
}

/** 导入：校验信封 → 返回 ExternalRef（整条覆盖、只读；🔴 永不进信封）。纯函数：由服务层写 db.externalRefs[board] */
export function importEnvelope(env, today) {
  const v = validateEnvelope(env);
  if (!v.ok) return { ok: false, reason: 'bad_schema' };
  return {
    ok: true, board: env.board,
    ref: {
      board: env.board, exportedAt: env.exportedAt, dataVersion: env.dataVersion,
      coefficientsHash: env.coefficientsHash, derived: env.derived || {}, entities: env.entities || {},
      importedAt: today,
    },
  };
}
