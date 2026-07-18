// ============================================================================
// 引擎层：件三函数库（唯一权威口径）。全部纯函数，读 DB + 显式 today。
// SII/EI/DVI/AHC · M29.5 · M28 · 十二道闸 · M16 · M37 · M38 · M17 · MC
// ============================================================================
const Engine = (() => {

  const bandBy = (v, lo, hi, higherIsBetter) => {
    if (v == null) return null;
    if (higherIsBetter) return v >= hi ? 'success' : v >= lo ? 'warning' : 'danger';
    return v > hi ? 'danger' : v > lo ? 'warning' : 'success'; // 越低越好（SII）
  };

  // ---------- 3.1 四大指数 ----------
  function indices(DB, today) {
    const gS = DB.governance.sii, cS = getCoef('sii'), wS = cS.w, hS = gS.activeHeadcount;
    const siiRaw =
      wS[0] * (gS.dailyReportOn ? 1 : 0) +
      wS[1] * (gS.rollcallOn ? 1 : 0) +
      wS[2] * Math.min(gS.spotChecksPerWeek / cS.spotCap, 1) +
      wS[3] * Math.min(gS.approvalLevels / cS.approveCap, 1) +
      wS[4] * Math.min((safeDiv(gS.monthlyViewsTotal, hS * cS.viewPerCapMonth) ?? 0), 1) +
      wS[5] * Math.min((safeDiv(gS.rxCountTotal, hS * cS.rxPerCapMonth) ?? 0), 1);
    const sii = Math.round(siiRaw);

    const gE = DB.governance.ei, cE = getCoef('ei'), wE = cE.w, hE = gE.activeHeadcount;
    // 🔧L-C15：建议提出数=0 → 采纳项按 0 计（A-19 例外：授权通道未被使用，非证据缺失）
    const adoptRatio = gE.suggestionsRaised > 0 ? gE.suggestionsAdopted / gE.suggestionsRaised : 0;
    const eiRaw =
      wE[0] * Math.min((safeDiv(gE.objectionsRaisedQuarter, hE * cE.objectionPerCapQuarter) ?? 0), 1) +
      wE[1] * adoptRatio +
      wE[2] * gE.covenantConfirmRatio +
      wE[3] * (1 - gE.cardIgnoreRate);
    const ei = Math.round(eiRaw);

    // DVI：数据源=算账器信封；未导入→null（"—（需算账器数据）"）
    const sz = DB.externalRefs.suanzhang;
    const dvi = (sz && sz.derived && sz.derived.dvi != null) ? sz.derived.dvi : null;

    const a = DB.governance.ahcInputs, cA = getCoef('ahc'), wA = cA.w;
    // irrevocable 覆盖 = 前程合约中 irrevocable 占比（0 合约→回退 ahcInputs.irrevocableRatio）
    const covs = DB.entities.Covenant || [];
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

  // ---------- 3.2 M29.5 自评-实评偏差器 ----------
  function deviation(DB, today) {
    const s = DB.governance.selfRating, ind = indices(DB, today);
    const pairs = [['监督 SII', s.sii, ind.sii.value], ['授权 EI', s.ei, ind.ei.value], ['可见 DVI', s.dvi, ind.dvi.value], ['信用 AHC', s.ahc, ind.ahc.value]];
    const diffs = pairs.filter(p => p[2] != null).map(p => ({ label: p[0], self: p[1], actual: p[2], gap: Math.abs(p[1] - p[2]) }));
    const gap = diffs.length ? Math.round(diffs.reduce((s2, d) => s2 + d.gap, 0) / diffs.length) : null;
    return { rows: diffs, gap };
  }

  // ---------- 3.5 M28 产权 ----------
  function m28Value(agr) {
    if (agr.kind === 'mentoring') return (agr.apprenticeMonthlyNetAmt || 0) * agr.rate * agr.durationMonths;
    if (agr.kind === 'royalty') return (agr.teamMonthlyIncrementAmt || 0) * agr.rate * agr.durationMonths;
    return null;
  }
  // 🔴 irrevocable：下调/缩短在代码层无成功路径（L-D1）。唯一出口=留痕。
  function tryDowngradeM28(DB, m28Id, today, note) {
    const agr = DB.entities.M28Agreement.find(x => x.m28Id === m28Id);
    if (!agr) return { ok: false, reason: 'not_found' };
    // 无论输入如何，rate/duration 不被修改；只产生留痕 + AHC 扣分事件 + 全员可见
    DB.entities.OverrideEvent.push({ id: makeId('ovr'), m28Id, at: today, action: 'try_downgrade', note: note || '', visibleToAll: true });
    DB.governance.ahcInputs.interceptCount += 1; // 拦截下调次数 +1 → AHC 重算下降
    return { ok: false, reason: 'irrevocable_blocked', downgraded: false, logged: true };
  }

  // ---------- 3.7 M16.1 价签（权威 6 项）T1–T4 ----------
  function priceTag(DB, today) {
    const p = DB.priceTag; const gm = p.monthlyGrossMarginAmt;
    const person = DB.entities.Salesperson.find(s => s.spId === p.spId);
    const headline = Math.round(gm * (p.hireMonths + p.paybackMonths));  // ≈ 权威估算 = 75 万
    const rampGap = Math.round(gm * p.rampGapMonthsEq);                    // ② 最大头
    const rampGapShare = safeDiv(rampGap, headline);
    const raiseAnnual = p.raiseMonthlyAmt * 12;
    const raiseVsTag = safeDiv(headline, raiseAnnual);
    const shortenGainAnnual = Math.round(rampGap * p.shortenPct * p.hiresPerYear); // T4
    const items = [
      { key: 'hiring', name: '① 招聘成本', amt: person ? person.hiringCostAmt : getCoef('hiringCostDefaultAmt'), scope: '完全招聘成本' },
      { key: 'ramp', name: '② 爬坡缺口', amt: rampGap, scope: '🔴 最大头', big: true },
      { key: 'idlepipe', name: '③ 空窗管道', amt: Math.round(gm * p.hireMonths), scope: '招聘周期内无人产出' },
      { key: 'mgr', name: '④ 经理时间', amt: Math.round(gm * 0.4), scope: '重新带人的管理耗时' },
      { key: 'decay', name: '⑤ 接手劣化 35%（慢性）', amt: Math.round(gm * getCoef('pipelineDecayInPriceTag')), scope: '常规客户/管道整体降效' },
      { key: 'handover', name: '⑥ 在途单交接 40%（急性）', amt: null, scope: '仅具名 HandoverCard；王丽今日无在途单 → —' },
    ];
    return {
      spId: p.spId, name: person ? person.name : '—',
      headline, rampGap, rampGapShare, raiseAnnual, raiseVsTag, shortenGainAnnual,
      hitGate5: rampGapShare != null && rampGapShare > getCoef('rampGapShareRedline'),
      items, asOf: today,
    };
  }

  // ---------- 3.7 M16.8 依赖度雷达 ----------
  function dependency(DB, today) {
    const sz = DB.externalRefs.suanzhang;
    if (!sz || !sz.perPerson) return { value: null };
    const rows = Object.entries(sz.perPerson).map(([id, v]) => ({ id, collected: v.collected6m || 0, leadIndex: v.leadIndex }));
    const total = rows.reduce((s, r) => s + r.collected, 0);
    if (total === 0) return { value: null };
    rows.sort((a, b) => b.collected - a.collected);
    const top = rows[0];
    const ratio = safeDiv(top.collected, total);
    const person = DB.entities.Salesperson.find(s => s.spId === top.id);
    const c = getCoef('dependency');
    return {
      value: ratio, topName: person ? person.name : top.id, topLeadIndex: top.leadIndex,
      band: ratio >= c.danger ? 'danger' : ratio >= c.warn ? 'warning' : 'success',
      selfMade: top.leadIndex > 1.5, asOf: sz.exportedAt,
    };
  }

  // ---------- 3.7 M16.3 该谈名单（五触发源）含榜眼 T15 ----------
  function secondPlaceTrigger(DB, spId) {
    const sz = DB.externalRefs.suanzhang; if (!sz || !sz.perPerson || !sz.perPerson[spId]) return { hit: false };
    const pp = sz.perPerson[spId]; const [lo, hi] = getCoef('secondPlaceRankBand'); const n = getCoef('secondPlaceMonths');
    const recent = (pp.normRankMonths || []).slice(-n);
    const bandOk = recent.length >= n && recent.every(r => r >= lo && r <= hi);
    const zeroSpecial = (pp.specialPayout12m || 0) === 0;
    const scissorsPos = (pp.scissors || 0) > 0;
    const hit = bandOk && (scissorsPos || zeroSpecial);
    return { hit, months: recent.length, rank: recent[recent.length - 1], scissors: pp.scissors, zeroSpecial };
  }
  function talkList(DB, today) {
    const out = [];
    for (const s of DB.entities.Salesperson) {
      if (!s.isActive) continue;
      const triggers = [];
      // ① 周年前14天
      const anni = anniversaryInDays(s.hireDate, today);
      if (anni != null && anni >= 0 && anni <= 14) triggers.push({ src: 'anniversary', label: '周年档', detail: `${anni} 天后周年` });
      // ④ 剪刀差≥30% ∧ 市价差>0
      const sz = DB.externalRefs.suanzhang; const pp = sz && sz.perPerson ? sz.perPerson[s.spId] : null;
      if (pp && pp.scissors >= 0.30 && pp.marketGap > 0) triggers.push({ src: 'scissors', label: '剪刀差档', detail: `剪刀差 ${Rate.pct(pp.scissors)}` });
      // ⑤ 榜眼
      const sp = secondPlaceTrigger(DB, s.spId);
      if (sp.hit) triggers.push({ src: 'second_place', label: '榜眼档', detail: `连续 ${sp.months} 月第 ${sp.rank}` });
      if (triggers.length) out.push({ spId: s.spId, name: s.name, triggers, pp });
    }
    return out;
  }
  function anniversaryInDays(hireDate, today) {
    if (!hireDate) return null;
    const t = D.parse(today); const y = t.getUTCFullYear();
    const md = hireDate.slice(5);
    let next = `${y}-${md}`;
    if (D.diffDays(today, next) < 0) next = `${y + 1}-${md}`;
    return D.diffDays(today, next);
  }

  // ---------- 3.8 M37 参照点账本 T13 ----------
  function precheck(DB, spId, plannedAmt, today) {
    const sz = DB.externalRefs.suanzhang; const pp = sz && sz.perPerson ? sz.perPerson[spId] : null;
    // 历史参照点 = 去年同期同名目实收
    const lastYear = D.parse(today).getUTCFullYear() - 1;
    const hist = DB.entities.PayoutEntry.filter(x => x.employeeId === spId && (x.type === 'year_end_bonus' || x.type === 'dividend') && x.period && x.period.startsWith(String(lastYear)))
      .reduce((s, x) => s + x.amt, 0) || null;
    const growth = pp && pp.contribGrowth != null ? pp.contribGrowth : null;
    let trend = null;
    if (hist != null) {
      const refRound = getCoef('refRound');
      const g = growth == null ? 0 : growth;
      trend = Math.round(hist * (1 + g) / refRound) * refRound;
    }
    let verdict = null;
    if (hist != null) {
      if (plannedAmt < hist) verdict = 'below_history';
      else if (trend != null && plannedAmt < trend) verdict = 'below_trend';
      else verdict = 'ok';
    }
    return { hist, growth, trend, verdict, plannedAmt };
  }

  // ---------- 3.9 M38 余震与交接 T14 ----------
  function handoverSummary(cards) {
    const sum = cards.reduce((s, c) => s + (c.amountAmt || 0), 0);
    const loss = Math.round(sum * getCoef('handoverLossRate'));
    const save = Math.round(loss * getCoef('handoverSavableShare'));
    return { count: cards.length, sum, loss, save };
  }
  function aftershockRank(DB, leaverId, today) {
    const sz = DB.externalRefs.suanzhang; const leaver = DB.entities.Salesperson.find(s => s.spId === leaverId);
    const rows = [];
    for (const s of DB.entities.Salesperson) {
      if (!s.isActive || s.spId === leaverId) continue;
      const pp = sz && sz.perPerson ? sz.perPerson[s.spId] : null; if (!pp) continue;
      let score = 0; const sig = [];
      if (pp.scissors > 0) { score++; sig.push('剪刀差>0'); }
      if (pp.marketGap > 0) { score++; sig.push('市价差>0'); }
      const sameTerr = !!leaver && (s.cityTier === leaver.cityTier || (!!s.hireBatchId && s.hireBatchId === leaver.hireBatchId));
      if (sameTerr) { score++; sig.push('同辖区/批次'); }
      rows.push({ spId: s.spId, name: s.name, score, sig, scissors: pp.scissors, marketGap: pp.marketGap });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 3);
  }

  // ---------- 3.3 M30：异议 pending>7天 → 关联负面标记自动失效（L-D6，默认保护员工）----
  function sweepObjections(DB, today) {
    let flipped = 0;
    for (const o of DB.entities.ObjectionEntry) {
      if (o.status === 'pending' && o.createdAt && D.diffDays(o.createdAt, today) > 7) {
        o.markActive = false; flipped++;
      }
    }
    return flipped;
  }

  // ---------- 3.6 十二道闸 ----------
  function boardLocked(DB) { const sz = DB.externalRefs.suanzhang; return !(sz && sz.m21Done); } // 闸①
  function rankingConfig() { return { realName: true, showRankOnly: true, hideAmount: true, hideQuota: true, dataSource: 'm21_normalized' }; } // 闸②唯一合法
  // 闸③ 挤出对冲（A-12 / L-C07；与 5号闸⑧、公约§6.1 逐字同源 R-04）
  function isResultTrigger(t) { return t === 'record_break' || t === 'sprint' || t === 'backlog_clear'; }
  function isExempt(t) { return t === 'first_deal' || t === 'hire'; }
  function bountySaveCheck(t, silentTrackOn) {
    if (isExempt(t)) return { ok: true, reason: 'exempt' };
    if (isResultTrigger(t) && !silentTrackOn) return { ok: false, reason: 'need_silent_track', script: 'L-15', showEnable: true };
    return { ok: true, reason: 'ok' };
  }
  // 闸⑨ 黑暗三角崩塌 [10,18]
  function collapseGate(monthsIn, mom3Chg, hasScore) {
    if (!hasScore) return { verdict: null, note: '无评分数据 → —' };
    const [lo, hi] = getCoef('collapseMonthIn');
    const hit = monthsIn >= lo && monthsIn <= hi && mom3Chg < -0.40;
    return { verdict: hit ? 'warning' : null, note: hit ? '预期中的崩塌（只输出不建议挽留）' : '' };
  }

  // ---------- 3.10 M17 分红（三重闸 ⇄ 四问 串联）T11 / T19 ----------
  function computeDividend(DB, today, opts) {
    opts = opts || {};
    const cfg = opts.cfg || DB.dividend;
    const ind = opts.indicators || indices(DB, today);
    // ① 三重闸 = 资格门（数值权归老板）
    const gates = [
      { key: 'companyCollect', label: '公司回款', ...cfg.gateCompanyCollect },
      { key: 'companyNet', label: '公司净贡献', ...cfg.gateCompanyNet },
      { key: 'personalCollect', label: '个人回款', ...cfg.gatePersonalCollect },
    ];
    const threeGatePass = gates.filter(g => g.enabled).every(g => g.pass);
    const result = { gates, threeGatePass, pool: 0, fourQuestionsRun: false, four: null, fourFailCount: null, verdict: null };
    if (!threeGatePass) {
      result.pool = 0; result.verdict = 'no_eligibility'; // 池=0，流程终止，四问零调用
      return result;
    }
    // 池（三重闸过后才算）
    result.pool = Math.round(cfg.netBeforeDividendAmt * cfg.poolRate);
    // ② 四问 = 体检（结构权归系统）—— 🔴 永不清零池
    result.fourQuestionsRun = true;
    const dose = DB.externalRefs.yuren && DB.externalRefs.yuren.derived ? DB.externalRefs.yuren.derived.coachingDoseActual : null;
    const ghi = opts.goodHireIndex != null ? opts.goodHireIndex : (DB.externalRefs.dingjia && DB.externalRefs.dingjia.derived ? DB.externalRefs.dingjia.derived.goodHireIndex : null);
    const four = [
      { q: 'Q1 好招指数≥1.0', pass: ghi != null ? ghi >= 1.0 : null, val: ghi },
      { q: 'Q2 EI≥30', pass: ind.ei.value >= 30, val: ind.ei.value },
      { q: 'Q3 SII≤60', pass: ind.sii.value <= 60, val: ind.sii.value },
      { q: 'Q4 辅导剂量≥3h/月人', pass: dose == null ? null : dose >= 3, val: dose }, // 未导入→null（退化为三问）
    ];
    const fails = four.filter(x => x.pass === false).length;
    result.four = four; result.fourFailCount = fails;
    result.verdict = fails >= 2 ? 'danger' : fails === 1 ? 'warning' : 'ok'; // 一否🟡 两否🔴 四否🔴
    return result;
  }

  // ---------- 3.10 MC 监督成本发包 ----------
  function monitorCost(DB, spId, today) {
    const ind = indices(DB, today); const dvi = ind.dvi.value;
    const s = DB.entities.Salesperson.find(x => x.spId === spId); if (!s) return { value: null };
    const c = getCoef('mc'), w = c.w;
    const geo = s.cityTier === 'tier1' ? 0 : s.cityTier === 'tier2' ? 1 : s.cityTier === 'tier3' ? 2 : 3;
    if (dvi == null) return { value: null, reason: '需 DVI（算账器数据）' };
    const localJudge = 0.5; // normalize(客单价CV+周期CV+品类熵) 占位（需 Deal 明细，缺→中位）
    const attrRate = 0.7;
    const mc = w[0] * (1 - dvi / 100) + w[1] * (geo / 3) + w[2] * localJudge + w[3] * (1 - attrRate);
    return { value: Math.round(mc), band: mc > c.bands[1] ? 'success' : mc < c.bands[0] ? 'danger' : 'warning' };
  }

  return {
    indices, deviation, m28Value, tryDowngradeM28, priceTag, dependency,
    talkList, secondPlaceTrigger, anniversaryInDays, precheck, handoverSummary, aftershockRank,
    boardLocked, rankingConfig, isResultTrigger, isExempt, bountySaveCheck, collapseGate,
    computeDividend, monitorCost, sweepObjections,
  };
})();
