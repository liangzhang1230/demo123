/* ============================================================
   算账器（suanzhang）· 经营真相层 —— 全系统数据地基
   引擎逐字复刻《销冠算账器 v3.3》（唯一事实源：公式/阈值/话术）。
   一体化差异：无锁屏/无免费版/无信封页——闸⑪三证据链实时取自
   X('liuren').ahc 与 DB.m28Agreements；提成率 r 实时取 SK.rRate()。
   口径：计毛利/回款的单 = deals.status==='won'（按 dealDate 归月）；
        挂账 = won 且 paidDate==null；本期 = 当月。
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { fmt, esc, DASH, safeDiv } = SK;
  const gc = p => SK.getCoef(p);

  /* ================= 枚举（件二 SE 系） ================= */
  const SE01 = { instant_bonus: '即时奖金', year_end_bonus: '年终奖', dividend: '分红', reimburse: '报销(只进成本)', mentoring_share: '带教分成', recipe_royalty: '配方使用费', sprint_vested: '冲刺金兑现', discretionary: '红包·慰问·普发', other: '其他' };
  const SE02 = { competitive_pressure: '竞争对手压价', volume_deal: '大单走量', period_end_push: '期末冲刺', customer_relationship: '老客户关系', strategic_entry: '战略性开口', authorized_promo: '公司授权促销', other: '其他' };
  const SE04 = { immediate: '立即发放', weekend_delayed: '延迟至周末', scheduled: '计划内' };
  const SE07 = { rent: '房租', marketing: '市场', admin: '行政', other: '其他' };

  /* ================= 引擎 E（逐字复刻 v3.3 计算引擎；系数改经 SK.getCoef） ================= */
  const E = {};
  E.round = x => Math.round(x);
  E.commission = (paymentAmt, g, r) => { if (paymentAmt == null || g == null || r == null) return null; return E.round(paymentAmt * g * r); };
  E.BONUS_TYPES = ['instant_bonus', 'year_end_bonus', 'dividend', 'mentoring_share', 'recipe_royalty', 'sprint_vested', 'discretionary'];
  E.totalIncome = ctx => {                                  // reimburse 永不进收入（闸③宪法级）
    let b = ctx.baseSalaryAmt || 0, c = ctx.commissionAmt || 0, bo = 0;
    (ctx.payouts || []).forEach(p => { if (E.BONUS_TYPES.indexOf(p.type) >= 0) bo += (p.amount || 0); });
    return b + c + bo;
  };
  E.laborCost = ctx => {                                    // 底薪 + 社保 + 提成 + 全部 payouts（含报销）
    const b = ctx.baseSalaryAmt || 0;
    const s = E.round(b * (ctx.socialCostRate != null ? ctx.socialCostRate : gc('shared.socialCostRate')));
    const c = ctx.commissionAmt || 0;
    let p = 0; (ctx.payouts || []).forEach(x => { p += (x.amount || 0); });
    return b + s + c + p;
  };
  E.netContribution = s => (s.grossMarginAmt || 0) - (s.laborCostAmt || 0) - (s.opCostAmt || 0) - (s.refundMarginAmt || 0) - (s.discountMarginAmt || 0);
  E.leverageChain = c => (c.leads || 0) * (c.convRate || 0) * (c.aov || 0) * (c.marginRate || 0) - (c.laborCostAmt || 0);

  E.m21Normalize = people => {
    const n = people.length; if (n === 0) return { done: false, rows: [], imbalanceRate: null };
    const totalLeads = people.reduce((a, p) => a + (p.leads || 0), 0);
    const totalMargin = people.reduce((a, p) => a + (p.grossMarginAmt || 0), 0);
    const perCapitaLeads = safeDiv(totalLeads, n); const band = gc('suanzhang.territoryBand');
    const rows = people.map(p => {
      const index = safeDiv(p.leads, perCapitaLeads);
      const over = index != null && index > band[1], under = index != null && index < band[0];
      const unit = safeDiv(p.grossMarginAmt, p.leads);
      const nb = (unit == null || perCapitaLeads == null) ? null : unit * perCapitaLeads;
      const ss = safeDiv(p.selfDevLeads || 0, p.leads); const sf = 1 + (ss || 0) * gc('suanzhang.selfDevBonusFactor');
      const nm = nb == null ? null : nb * sf;
      return { id: p.id, name: p.name, leads: p.leads, grossMarginAmt: p.grossMarginAmt, selfDevLeads: p.selfDevLeads || 0, index, over, under, unitLeadMargin: unit, normMargin: nm, selfFactor: sf };
    });
    const bo = rows.slice().sort((a, b) => (b.grossMarginAmt || 0) - (a.grossMarginAmt || 0));
    bo.forEach((r, i) => { r.origRank = i + 1; });
    const bn = rows.slice().sort((a, b) => { const av = a.normMargin == null ? -Infinity : a.normMargin, bv = b.normMargin == null ? -Infinity : b.normMargin; return bv - av; });
    bn.forEach((r, i) => { r.normRank = i + 1; });
    const ic = rows.filter(r => r.over || r.under).length;
    return { done: true, rows, n, totalLeads, totalMargin, perCapitaLeads, imbalanceRate: safeDiv(ic, n), imbalCount: ic, redrawBand: [totalMargin * gc('suanzhang.redrawGainBand')[0], totalMargin * gc('suanzhang.redrawGainBand')[1]] };
  };

  E.realP90Factor = g => {
    const v = (g || []).filter(x => x != null && isFinite(x));
    if (v.length < gc('suanzhang.p90MinSample')) return null;      // 样本 <8 → null（冷启动由消费方回退 1.8）
    const s = v.slice().sort((a, b) => a - b), m = v.reduce((a, b) => a + b, 0) / v.length;
    return safeDiv(SK.percentileR7(s, 0.90), m);
  };

  E.solveLinear = (Ain, bin) => {                            // 高斯消元（部分主元）
    const n = Ain.length; const M = Ain.map((r, i) => r.slice().concat([bin[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      const t = M[col]; M[col] = M[piv]; M[piv] = t; const pv = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= pv;
      for (let r2 = 0; r2 < n; r2++) { if (r2 === col) continue; const f2 = M[r2][col]; for (let c2 = col; c2 <= n; c2++) M[r2][c2] -= f2 * M[col][c2]; }
    }
    return M.map(r => r[n]);
  };
  E.olsFit = (X, y) => {
    const n = X.length, k = X[0].length, A = [], b = [];
    for (let i = 0; i < k; i++) { A.push(new Array(k).fill(0)); b.push(0); }
    for (let r = 0; r < n; r++) for (let a = 0; a < k; a++) { b[a] += X[r][a] * y[r]; for (let c = 0; c < k; c++) A[a][c] += X[r][a] * X[r][c]; }
    const beta = E.solveLinear(A, b); if (!beta) return null;
    const pred = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
    return { beta, pred, resid: y.map((v, i) => v - pred[i]) };
  };
  E.uerBand = (resid, sigma) => { if (resid == null || sigma == null || sigma === 0) return null; if (resid > sigma) return 'green'; if (resid < -sigma) return 'red'; return 'gray'; };
  E.stddev = arr => {                                        // 引擎原样：总体 σ，n≥1
    const v = arr.filter(x => x != null); if (v.length === 0) return null;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
  };
  E.propertyValue = (w, o, mw, mo) => {
    const req = gc('suanzhang.propertyMinEach');
    if (w.length < req.people || o.length < req.people || (mw != null && mw < req.months) || (mo != null && mo < req.months)) return null;
    return w.reduce((a, b) => a + b, 0) / w.length - o.reduce((a, b) => a + b, 0) / o.length;
  };
  E.personAttribution = x => {                               // 3.3b 个人归因三分支
    const kX = gc('suanzhang.personLeakX'), band = gc('suanzhang.territoryBand');
    const leakD = (x.discountLeakRate != null && x.teamDiscountLeakRate != null && x.discountLeakRate > x.teamDiscountLeakRate * kX);
    const leakC = (x.complaintRate != null && x.teamComplaintRate != null && x.complaintRate > x.teamComplaintRate * kX);
    const eLeak = leakD || leakC; const eTer = (x.leadIndex != null && x.leadIndex < band[0]);
    const verdict = eLeak ? 'leak' : (eTer ? 'territory' : 'undetermined'); const badList = [];
    if (leakD) badList.push('折扣泄漏率' + fmt.pct(x.discountLeakRate) + '＞均值×' + kX);
    if (leakC) badList.push('客诉率' + fmt.pct(x.complaintRate) + '＞均值×' + kX);
    return { verdict, badList, eLeak, eTerritory: eTer };
  };
  E.amortizeForScissors = (type, amount, pm) => { if (amount == null) return null; if (type === 'year_end_bonus') return amount / 12; if (type === 'dividend') return pm ? amount / pm : amount; return amount; };
  E.uerObsGate = n => (n || 0) >= gc('suanzhang.uerMinObs');
  E.dvi = x => {
    if (x.dealCount != null && x.dealCount < gc('suanzhang.dviMinDeals')) return null;
    const lag = Math.min((x.medianEntryLagDays || 0) / 7, 1);
    return 25 * (x.reportRate || 0) + 25 * (1 - lag) + 25 * (x.leadAttribRate || 0) + 25 * (x.discountRecordRate || 0);
  };
  E.dviBand = v => { if (v == null) return null; return v > 70 ? 'green' : (v >= 40 ? 'amber' : 'red'); };
  E.hijackVerdict = ev => {                                  // 闸⑪ 三证据链
    const e1 = ev.ahc, e2 = ev.m28Coverage, e3 = ev.irrevocable;
    if (e1 == null || e2 == null || e3 == null) {
      const mi = []; if (e1 == null) mi.push('AHC'); if (e2 == null) mi.push('M28 协议数'); if (e3 == null) mi.push('irrevocable 条款');
      return { verdict: 'insufficient', missingList: mi };
    }
    const line = gc('shared.ahcTrustLine');
    const bad = (e1 < line ? 1 : 0) + (e2 === 0 ? 1 : 0) + (e3 === false ? 1 : 0); const bl = [];
    if (e1 < line) bl.push('AHC ' + e1 + '<' + line);
    if (e2 === 0) bl.push('M28 覆盖 0%'); if (e3 === false) bl.push('irrevocable 未开');
    return { verdict: bad >= 1 ? 'pointed_hoarding' : 'not_supported', bad, badList: bl };
  };
  E.m33Evidence = x => {
    const e1 = x.winRate != null && x.winRate < gc('suanzhang.winRateCeiling');
    const e2 = x.refundByCategoryX != null && x.refundByCategoryX > gc('suanzhang.refundConcentrationX');
    const fd = gc('suanzhang.forcedDiscount');
    const e3 = x.discountRate != null && x.pushShare != null && x.discountRate > fd.rate && x.pushShare > fd.share;
    const e4 = x.leaverLowMarginRatioMedian != null && x.teamLowMarginRatio != null && x.leaverLowMarginRatioMedian > x.teamLowMarginRatio * gc('suanzhang.leaverCategoryX');
    return { e1, e2, e3, e4, any: e1 || e2 || e3 || e4 };
  };
  E.gateDiscountLeak = ds => {
    let sd = 0, sl = 0, sp = 0;
    (ds || []).forEach(d => { sd += (d.discountAmt || 0); sl += (d.listPriceAmt || 0); if (d.reason === 'period_end_push') sp += (d.discountAmt || 0); });
    const lr = safeDiv(sd, sl), ps = safeDiv(sp, sd);
    return { leakRate: lr, pushShare: ps, sumDiscountAmt: sd, leakRed: lr != null && lr > gc('suanzhang.discountLeakRedline'), pushRed: ps != null && ps > gc('suanzhang.pushShareRedline') };
  };
  E.scissors = (cg, ig) => { if (cg == null || ig == null) return null; return cg - ig; };
  E.categoryFuse = (mr, ps) => mr != null && ps != null && mr < gc('suanzhang.categoryFuseMarginRate') && ps > gc('suanzhang.categoryFuseShareRate');
  E.m34ArbitrageFromRates = (tr, hr, typ, thr, bi) => {
    const diff = (tr || 0) - (hr || 0), leak = Math.max(0, diff) * (typ || 0);
    return { tailRate: tr, headRate: hr, diff, annualLeakAmt: leak, bunchIndex: bi, red: diff > gc('suanzhang.m34DiffRedline') || (bi != null && bi > gc('suanzhang.m34BunchRedline')) };
  };
  E.m35Misfire = (o, nn, tn) => { const j = o - nn, t = Math.ceil(tn * gc('suanzhang.m35RankJumpShare')); return { jump: j, threshold: t, misfire: j >= t }; };
  E.m36BunchRate = (counts, base) => {
    if (base == null) return null;
    const hi = Math.floor(base * (1 + gc('suanzhang.m36Band'))), total = counts.length;
    if (total < gc('suanzhang.m36MinManDays')) return { rate: null, band: [base, hi], reason: 'insufficient' };
    const inb = counts.filter(c => c >= base && c <= hi).length, rate = safeDiv(inb, total);
    return { rate, band: [base, hi], inBand: inb, total, red: rate != null && rate > gc('suanzhang.m36Redline') };
  };
  E.hongbaoCheck = x => {
    const r1 = x.dailyAvgCommission != null && x.amount < x.dailyAvgCommission * gc('suanzhang.hongbaoDailyX');
    const r2 = x.timing === 'immediate' && x.hasCondition === false && (x.rolling12ImmediateUncondCount || 0) >= gc('suanzhang.hongbaoRepeatN');
    return { rule1: r1, rule2: r2 };
  };
  E.managerLift = (m, c, t) => { if (t != null && t < 3) return null; return safeDiv(m, c); };
  E.paybackProgress = (g, l) => safeDiv(g, l);
  E.stopBleedTriage = x => {                                 // 止血分诊双校验
    const cand = (x.zeroEventDays >= gc('suanzhang.stopBleedDays')) && x.isActivePaid;
    if (!cand) return { candidate: false };
    if (x.leadIndex != null && x.leadIndex < gc('suanzhang.territoryStarveIdx')) return { candidate: true, verdict: 'starved', block: true };
    if (x.uer != null && x.uer > 0) return { candidate: true, verdict: 'invisible_work', block: false };
    return { candidate: true, verdict: 'proceed', block: false };
  };

  /* ================= 派生层（统一 DB → 各屏数字唯一来源） ================= */
  const mShift = (m, k) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + k, 1)).toISOString().slice(0, 7); };
  const dim = m => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
  const dayOfMonth = d => +String(d).slice(8, 10) || 1;
  const catMarginOf = (db, id) => { const c = db.categories.find(x => x.id === id); return c ? c.grossMarginRate : 0; };
  const G = (o, sp, m) => (o[sp] && o[sp][m]) || 0;

  function buildIdx(db, r) {                                 // 一次扫描 → 人×月聚合
    const gm = {}, pay = {}, cnt = {}, comm = {}, la = {}, self = {}, po = {}, months = {};
    const bump = (o, sp, m, v) => { (o[sp] || (o[sp] = {}))[m] = (o[sp][m] || 0) + v; };
    db.deals.forEach(d => {
      if (d.status !== 'won' || !d.dealDate) return;         // 口径：只有 won 计毛利，按 dealDate 归月
      const m = SK.monthOf(d.dealDate); months[m] = 1;
      const g = catMarginOf(db, d.categoryId);
      bump(gm, d.employeeId, m, d.paymentAmt * g);
      bump(pay, d.employeeId, m, d.paymentAmt);
      bump(cnt, d.employeeId, m, 1);
      bump(comm, d.employeeId, m, E.commission(d.paymentAmt, g, r) || 0);
    });
    db.leads.forEach(l => { months[l.month] = 1; bump(la, l.employeeId, l.month, l.assignedLeads || 0); bump(self, l.employeeId, l.month, l.selfDevLeads || 0); });
    db.payouts.forEach(p => { const m = SK.monthOf(p.payoutDate); (po[p.employeeId] || (po[p.employeeId] = {}))[m] = ((po[p.employeeId] || {})[m] || []).concat([p]); });
    return { gm, pay, cnt, comm, la, self, po, monthList: Object.keys(months).sort() };
  }
  function ctx(db, T) { const r = SK.rRate(); return { db, T, curM: SK.monthOf(T), r, idx: buildIdx(db, r) }; }
  const C = () => ctx(SK.DB, SK.today());

  function personLabor(c, p, m) {
    return E.laborCost({ baseSalaryAmt: p.baseSalaryAmt, commissionAmt: G(c.idx.comm, p.spId, m), payouts: (c.idx.po[p.spId] && c.idx.po[p.spId][m]) || [] });
  }
  function m21Month(c, m) {
    const rows = c.db.people.filter(p => p.positionType === 'sales').map(p => ({
      id: p.spId, name: p.name, leads: G(c.idx.la, p.spId, m), selfDevLeads: G(c.idx.self, p.spId, m), grossMarginAmt: G(c.idx.gm, p.spId, m),
    })).filter(r => r.leads > 0 || r.grossMarginAmt > 0);
    return E.m21Normalize(rows);
  }
  function discountsIn(c, m) { return c.db.discounts.filter(d => SK.monthOf(d.discountDate) === m); }
  function gate5(c, m) { return E.gateDiscountLeak(discountsIn(c, m).map(d => ({ listPriceAmt: d.listPriceAmt, discountAmt: d.listPriceAmt - d.actualPriceAmt, reason: d.reason }))); }
  function personLeak(c, spId, m) {
    const ds = discountsIn(c, m).filter(d => d.employeeId === spId);
    return safeDiv(ds.reduce((a, d) => a + (d.listPriceAmt - d.actualPriceAmt), 0), ds.reduce((a, d) => a + d.listPriceAmt, 0));
  }
  function ledgerFor(c, m) {
    let gmT = 0; Object.keys(c.idx.gm).forEach(sp => { gmT += G(c.idx.gm, sp, m); });
    gmT = Math.round(gmT);                                   // 公约：金额「分」int（毛利 = Σ 回款×毛利率，汇总后取整）
    const lc = c.db.people.filter(p => p.isActive).reduce((a, p) => a + personLabor(c, p, m), 0);
    const oc = c.db.opcosts.reduce((a, o) => a + (o.monthlyAmt || 0), 0);
    const rm = Math.round(c.db.refunds.filter(x => SK.monthOf(x.refundDate) === m).reduce((a, x) => a + x.amount * catMarginOf(c.db, x.categoryId), 0));
    const dm = Math.round(discountsIn(c, m).reduce((a, d) => a + (d.listPriceAmt - d.actualPriceAmt) * catMarginOf(c.db, d.categoryId), 0));
    return { grossMarginAmt: gmT, laborCostAmt: lc, opCostAmt: oc, refundMarginAmt: rm, discountMarginAmt: dm, net: E.netContribution({ grossMarginAmt: gmT, laborCostAmt: lc, opCostAmt: oc, refundMarginAmt: rm, discountMarginAmt: dm }) };
  }

  /* UER 团队 OLS 面板：X=[1, leads, conv, aov/1e6, marginRate]，y=personNet */
  function uerAll(c) {
    const sales = c.db.people.filter(p => p.positionType === 'sales');
    const X = [], y = [], keys = [];
    c.idx.monthList.forEach(m => {
      sales.forEach(p => {
        const L = G(c.idx.la, p.spId, m), n = G(c.idx.cnt, p.spId, m);
        if (!n || !L) return;
        const pay = G(c.idx.pay, p.spId, m), gm = G(c.idx.gm, p.spId, m);
        X.push([1, L, safeDiv(n, L) || 0, (safeDiv(pay, n) || 0) / 1e6, safeDiv(gm, pay) || 0]);
        y.push(gm - personLabor(c, p, m));
        keys.push({ sp: p.spId, m });
      });
    });
    if (!E.uerObsGate(X.length)) return { ok: false, obs: X.length, need: gc('suanzhang.uerMinObs') };
    const fit = E.olsFit(X, y);
    if (!fit) return { ok: false, obs: X.length, singular: true };
    const sigma = E.stddev(fit.resid);
    const rows = [], series = {};
    keys.forEach((k, i) => {
      (series[k.sp] || (series[k.sp] = [])).push(fit.resid[i]);
      if (k.m === c.curM) rows.push({ sp: k.sp, resid: fit.resid[i], band: E.uerBand(fit.resid[i], sigma) });
    });
    const teamMean = rows.length ? rows.reduce((a, r) => a + r.resid, 0) / rows.length : null;
    return { ok: true, obs: X.length, sigma, rows, series, teamMean };
  }

  /* M34 时点套利（近 12 月；末段 = 当月最后 1/3） */
  function m34Calc(c) {
    const from = mShift(c.curM, -11) + '-01';
    let tailList = 0, tailDisc = 0, headList = 0, headDisc = 0, tailPay = 0;
    c.db.discounts.forEach(d => {
      if (d.discountDate < from) return;
      const tailStart = dim(SK.monthOf(d.discountDate)) * (1 - gc('suanzhang.m34TailShare'));
      const disc = d.listPriceAmt - d.actualPriceAmt;
      if (dayOfMonth(d.discountDate) > tailStart) { tailList += d.listPriceAmt; tailDisc += disc; }
      else { headList += d.listPriceAmt; headDisc += disc; }
    });
    c.db.deals.forEach(d => {
      if (d.status !== 'won' || !d.dealDate || d.dealDate < from) return;
      if (dayOfMonth(d.dealDate) > dim(SK.monthOf(d.dealDate)) * (1 - gc('suanzhang.m34TailShare'))) tailPay += d.paymentAmt;
    });
    const tr = safeDiv(tailDisc, tailList), hr = safeDiv(headDisc, headList);
    if (tr == null || hr == null) return { ok: false };
    const res = E.m34ArbitrageFromRates(tr, hr, tailPay, null, null);
    res.ok = true; return res;
  }

  /* 红包体检（本期 discretionary）：dailyAvg ≈ 累计提成 ÷ max(1, 成交笔数×9) */
  function hongbaoRows(c) {
    return c.db.payouts.filter(p => p.type === 'discretionary' && SK.monthOf(p.payoutDate) === c.curM).map(p => {
      let comm = 0, n = 0;
      Object.keys(c.idx.comm[p.employeeId] || {}).forEach(m => { comm += c.idx.comm[p.employeeId][m]; });
      Object.keys(c.idx.cnt[p.employeeId] || {}).forEach(m => { n += c.idx.cnt[p.employeeId][m]; });
      const dailyAvg = safeDiv(comm, Math.max(1, n * 9)) || 0;
      const rolling = c.db.payouts.filter(q => q.employeeId === p.employeeId && q.type === 'discretionary' && q.timing === 'immediate' && q.hasCondition === false).length;
      const chk = E.hongbaoCheck({ amount: p.amount, dailyAvgCommission: dailyAvg, timing: p.timing, hasCondition: p.hasCondition, rolling12ImmediateUncondCount: rolling });
      return { p, chk, dailyAvg };
    });
  }
  function lastWonDays(c, spId) {
    const ds = c.db.deals.filter(d => d.employeeId === spId && d.status === 'won' && d.dealDate).map(d => d.dealDate).sort();
    if (!ds.length) return null; return SK.diffDays(ds[ds.length - 1], c.T);
  }
  function fuseRows(c, m) {
    let totalPay = 0; const byCat = {};
    c.db.deals.forEach(d => {
      if (d.status !== 'won' || !d.dealDate || SK.monthOf(d.dealDate) !== m) return;
      totalPay += d.paymentAmt; byCat[d.categoryId] = (byCat[d.categoryId] || 0) + d.paymentAmt;
    });
    return c.db.categories.map(cat => {
      const pay = byCat[cat.id] || 0, share = safeDiv(pay, totalPay);
      return { cat, share, pay, fuse: E.categoryFuse(cat.grossMarginRate, share || 0) };
    }).filter(r => r.pay > 0);
  }

  /* ================= SK.summary.suanzhang —— 全系统数据地基 ================= */
  function compute(db, T) {
    const c = ctx(db, T);
    const sales = db.people.filter(p => p.positionType === 'sales');
    const actSales = sales.filter(p => p.isActive);
    const m12 = []; for (let k = 11; k >= 0; k--) m12.push(mShift(c.curM, -k));
    const m6 = m12.slice(6), last3 = m12.slice(9), prev3 = m12.slice(6, 9);
    const growth = (a, b) => (b > 0 ? (a - b) / b : null);

    const Mcur = m21Month(c, c.curM);
    const m21Done = !!Mcur.done && Mcur.n >= 2;
    const m21rows = (Mcur.rows || []).map(r => ({
      spId: r.id, name: r.name, leads: r.leads, selfShare: safeDiv(r.selfDevLeads, r.leads),
      index: r.index, over: r.over, under: r.under, grossMarginAmt: r.grossMarginAmt,
      unitLeadMargin: r.unitLeadMargin, normMargin: r.normMargin, origRank: r.origRank, normRank: r.normRank,
    }));
    const idxBySp = {}; (Mcur.rows || []).forEach(r => { idxBySp[r.id] = r; });

    const L = ledgerFor(c, c.curM);
    const hasLedger = !(L.grossMarginAmt === 0 && L.laborCostAmt === 0);
    const laborRoi = hasLedger ? safeDiv(L.grossMarginAmt, L.laborCostAmt) : null;

    const uer = uerAll(c);
    const uerBySp = {}; if (uer.ok) uer.rows.forEach(r => { uerBySp[r.sp] = { resid: r.resid, band: r.band }; });

    const g5 = gate5(c, c.curM);

    // realP90Factor：本期归一化毛利分布（样本 <8 → null）
    const realP90 = E.realP90Factor((Mcur.rows || []).map(r => r.normMargin).filter(x => x != null).map(x => x / 1e4));

    // DVI（按原版公式，用现有数据近似；录入滞后分项无 entryDate 概念 → 记满 25）
    let dvi = null;
    {
      let dealCur = 0; Object.keys(c.idx.cnt).forEach(sp => { dealCur += G(c.idx.cnt, sp, c.curM); });
      if (dealCur >= gc('suanzhang.dviMinDeals') && actSales.length) {
        let wd = 0; const wdSet = {};
        for (let d = 29; d >= 0; d--) { const ds = SK.addDays(T, -d); if (SK.weekdayOf(ds) === 0) continue; wd++; wdSet[ds] = 1; }
        const salesSet = {}; actSales.forEach(p => { salesSet[p.spId] = 1; });
        let rep = 0; db.dailyReports.forEach(r => { if (wdSet[r.date] && salesSet[r.employeeId]) rep++; });
        const reportRate = SK.clamp(rep / Math.max(1, wd * actSales.length), 0, 1);
        const leadAttribRate = actSales.filter(p => G(c.idx.la, p.spId, c.curM) > 0).length / actSales.length;
        const discMonths = {}; db.discounts.forEach(d => { discMonths[SK.monthOf(d.discountDate)] = 1; });
        const dealMonths = m12.filter(m => Object.keys(c.idx.cnt).some(sp => G(c.idx.cnt, sp, m) > 0));
        const discountRecordRate = dealMonths.length ? dealMonths.filter(m => discMonths[m]).length / dealMonths.length : 0;
        dvi = Math.round(SK.clamp(E.dvi({ reportRate, medianEntryLagDays: 0, leadAttribRate, discountRecordRate, dealCount: dealCur }), 0, 100));
      }
    }

    // 逐月归一名次（近 ≤6 月）
    const rankByMonth = m6.map(m => {
      const M = m21Month(c, m); const map = {};
      (M.rows || []).forEach(r => { map[r.id] = r.normRank; });
      return map;
    });

    // 单遍：近6月已回款 / 近12月特殊发放
    const m6Set = {}; m6.forEach(m => { m6Set[m] = 1; });
    const m12Set = {}; m12.forEach(m => { m12Set[m] = 1; });
    const collected6 = {}, special12 = {};
    db.deals.forEach(d => {
      if (d.status !== 'won' || !d.dealDate || !d.paidDate) return;
      if (m6Set[SK.monthOf(d.dealDate)]) collected6[d.employeeId] = (collected6[d.employeeId] || 0) + d.paymentAmt;
    });
    db.payouts.forEach(p => {
      if (['instant_bonus', 'discretionary', 'sprint_vested'].indexOf(p.type) < 0) return;
      if (m12Set[SK.monthOf(p.payoutDate)]) special12[p.employeeId] = (special12[p.employeeId] || 0) + 1;
    });

    const dj = SK.X('dingjia');
    const perPerson = {};
    actSales.forEach(p => {
      const sp = p.spId;
      const gmOf = m => G(c.idx.gm, sp, m), commOf = m => G(c.idx.comm, sp, m), cntOf = m => G(c.idx.cnt, sp, m);
      const sum = (arr, f) => arr.reduce((a, m) => a + f(m), 0);
      const cg = growth(sum(last3, gmOf), sum(prev3, gmOf));
      const ig = growth(sum(last3, m => p.baseSalaryAmt + commOf(m)), sum(prev3, m => p.baseSalaryAmt + commOf(m)));
      const avgInc6 = (6 * p.baseSalaryAmt + sum(m6, commOf)) / 6;
      const marketGap = (dj && dj.matrixT != null && dj.matrixT > 0) ? (dj.matrixT - avgInc6) / dj.matrixT : null;
      const hireM = SK.monthOf(p.hireDate);
      let trajEarly = null;
      if (mShift(hireM, 5) <= c.curM) { trajEarly = []; for (let k = 0; k < 6; k++) trajEarly.push(gmOf(mShift(hireM, k)) / 1e6); }
      perPerson[sp] = {
        normRankMonths: rankByMonth.map(map => (map[sp] != null ? map[sp] : null)),
        scissors: E.scissors(cg, ig),
        marketGap,
        leadIndex: idxBySp[sp] ? idxBySp[sp].index : null,
        collected6m: collected6[sp] || 0,
        specialPayout12m: special12[sp] || 0,
        contribGrowth: cg,
        margin12: m12.map(m => (cntOf(m) > 0 ? gmOf(m) : null)),
        traj6: m6.map(m => gmOf(m) / 1e6),
        trajEarly,
        uerSeries: (uer.ok && uer.series[sp]) ? uer.series[sp] : [],
        discountRate: personLeak(c, sp, c.curM),
        complaintCount: null,                                 // 无客诉数据源，消费方需判空
        growth3m: cg,
      };
    });

    return {
      m21Done,
      imbalanceRate: Mcur.imbalanceRate != null ? Mcur.imbalanceRate : null,
      uerTeamMean: uer.ok ? uer.teamMean : null,
      realP90Factor: realP90,
      dvi,
      netContributionAmt: hasLedger ? L.net : null,
      laborRoi,
      ledger: hasLedger ? { net: L.net, rate: safeDiv(L.net, L.grossMarginAmt) } : null,
      m21rows,
      uerBySp,
      teamDiscountLeakRate: g5.leakRate,
      perPerson,
    };
  }
  SK.summary.suanzhang = (db, today) => compute(db, today);

  /* ================= 通用 UI 片段 ================= */
  const sect = (t, s) => `<div class="sect"><h2>${t}</h2><span class="sub">${s}</span></div>`;
  const chipFor = red => red ? h.badge('🔴 触发', 'r') : h.badge('🟢 正常', 'g');
  function guide(msg) {
    return h.card('', `<div style="text-align:center;padding:26px 16px">
      <div style="font-size:34px">📭</div>
      <div style="font-weight:700;font-size:16px;margin:8px 0 4px">还没有足够数据</div>
      <p class="hint" style="max-width:56ch;margin:0 auto">${msg}</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        ${h.btn('去录入中心', 'ui.nav', { cls: 'pri', data: 'data-board="suanzhang" data-sub="entry"' })}
        ${h.btn('载入演示数据', 'data.seed')}
      </div></div>`);
  }
  const idxChip = r => r.over ? h.badge('超配 ' + r.index.toFixed(2), 'r') : r.under ? h.badge('欠配 ' + r.index.toFixed(2), 'a') : h.badge(r.index == null ? DASH : r.index.toFixed(2), 'n', true);

  /* ================= 屏 · 地盘审计 ================= */
  function vTerritory() {
    const c = C(); const M = m21Month(c, c.curM);
    const head = sect('🗺️ 地盘审计 · 强制第一步', `排名之前先回答：你的线索，是不是平均分给了每个人？本期 = ${c.curM}`);
    if (!M.done || M.n === 0) return head + guide('录入每人本月的线索分配与成交后，这里会显示你的团队失衡率。');
    const glob = gc('shared.imbalanceGlobal');
    const red = M.imbalanceRate != null && M.imbalanceRate > glob;
    return head + `
      <div class="grid g3">
        ${h.card('', h.hero(fmt.pct(M.imbalanceRate, 0), '团队失衡率 · 全球基准 ≈56%（Zoltners 2000，数千个销售辖区）', red ? 'red' : 'green'))}
        ${h.card('', h.hero('0.34', '销售人力弹性 · 每 1 元产出弹性', 'green', true) + h.hint('广告弹性仅 0.22 —— 销售支出约广告 3 倍有效'))}
        ${h.card('', h.hero('≈56%', '全球辖区太大或太小的比例', 'amber', true) + h.hint('如果一半以上的地盘是错的，那你的排行榜，一半在测地盘，不是测人'))}
      </div>
      ${h.action(M.done ? '✅ 已可归一化' : '⚠️ 数据不足',
        `本期共 ${M.n} 人、${M.totalLeads.toLocaleString('zh-CN')} 条线索，人均应得 ${Math.round(M.perCapitaLeads || 0)} 条。失衡率 <b>${fmt.pct(M.imbalanceRate)}</b>（全球基准 ≈56%）。${red ? '🔴 已超全球水平。' : ''}`,
        red ? 'r' : 'g',
        h.btn('看归一化真相 →', 'ui.nav', { cls: 'pri', data: 'data-board="suanzhang" data-sub="normalize"' }) + h.btn('补录线索/成交', 'ui.nav', { data: 'data-board="suanzhang" data-sub="entry"' }))}
      ${h.src('『投在销售身上的每一块钱，比投在广告上的更有效——但几乎没人像研究广告那样研究销售人力（弹性 0.34 vs 0.22）』。（Albers-Mantrala-Sridhar 2010 JMR）')}
      ${h.src('唯一跳过路径：若你声明「全员 100% 自开发线索」，可在录入端将线索登记为自开发——系统会在所有排名页顶标注。')}
      <div class="callout" style="margin-top:12px">⚠️ <b>系统边界（必读）</b>：这个系统不会让一个卖不动的产品卖动。</div>`;
  }

  /* ================= 屏 · 归一化真相（核弹屏） ================= */
  function vNormalize() {
    const c = C(); const M = m21Month(c, c.curM);
    const head = sect('💣 归一化真相 · 核弹屏', `同样一张榜，剥掉地盘之后，谁在上、谁在下——本期 ${c.curM}`);
    if (!M.done || M.n === 0) return head + guide('录入每人本月线索分配与成交后，这里会实时算出归一化榜与三句杀手。');
    if (M.n < 2) return head + h.banner('本期只有 1 人有数据——归一化排名需要 ≥2 人。补录其他人的线索/成交后即点亮（不锁功能）。', 'a') + guide('归一化排名需要 ≥2 人有线索或毛利。');
    const orig = M.rows.slice().sort((a, b) => a.origRank - b.origRank);
    const topOrig = orig[0], botOrig = orig[orig.length - 1];
    const x = topOrig.index, y = safeDiv(botOrig.unitLeadMargin, topOrig.unitLeadMargin);
    const g = M.totalMargin, lo = M.redrawBand[0], hi = M.redrawBand[1];
    const glob = gc('shared.imbalanceGlobal');
    const selfAll = M.rows.every(r => r.leads > 0 && r.selfDevLeads >= r.leads);
    const kill = h.action('💣 三句杀手',
      `<p>①『你的销冠 <b>${esc(topOrig.name)}</b>，业绩第一（${fmt.wan(topOrig.grossMarginAmt)}）。但他拿的是 ${topOrig.leads} 条线索——平均份额的 <b>${(x || 0).toFixed(1)} 倍</b>。归一化后，他排第 <b>${topOrig.normRank}</b>。』</p>
       <p style="margin-top:7px">②『你的垫底 <b>${esc(botOrig.name)}</b>，业绩最差（${fmt.wan(botOrig.grossMarginAmt)}），你正准备淘汰他。但他只拿到 ${botOrig.leads} 条线索，单位线索产出是销冠的 <b>${(y || 0).toFixed(1)} 倍</b>。归一化后，他是<b>全队第 ${botOrig.normRank}</b>。』</p>
       <p style="margin-top:7px">③『团队失衡率 <b>${fmt.pct(M.imbalanceRate)}</b>。📎 仅重新划分线索，销售额预计提升 2%–7%。按你 ${fmt.wan(g)} 的月毛利：每月 ¥${Math.round(lo / 100).toLocaleString('zh-CN')}–${Math.round(hi / 100).toLocaleString('zh-CN')}，每年 ¥${Math.round(lo * 12 / 100).toLocaleString('zh-CN')}–${Math.round(hi * 12 / 100).toLocaleString('zh-CN')}。』</p>`,
      'r', h.btn('采纳重划建议（生成沙盒）', 'ui.toast-ac', { cls: 'pri' }));
    const tbl = h.tbl(
      [{ t: '榜' }, { t: '销售' }, { t: '线索', num: 1 }, { t: '线索指数', num: 1 }, { t: '原始毛利', num: 1 }, { t: '归一化毛利', num: 1 }, { t: '归一名次', num: 1 }],
      orig.map(r => `<tr data-sp="${r.id}"><td class="num" style="color:var(--ink3)">${r.origRank}</td><td><b>${esc(r.name)}</b></td><td class="num">${r.leads}${r.selfDevLeads ? ` <span class="hint">自开${r.selfDevLeads}</span>` : ''}</td><td class="num">${idxChip(r)}</td><td class="num">${fmt.wan(r.grossMarginAmt)}</td><td class="num"><b>${fmt.wan(r.normMargin)}</b></td><td class="num">${h.badge('#' + r.normRank, r.normRank <= 3 ? 'g' : r.normRank >= M.n - 2 ? 'r' : 'n')}</td></tr>`));
    return head +
      (selfAll ? h.banner('本队线索已声明为全员自开发——归一化仍按自开发加成（selfFactor）计算，此声明已在排名页顶标注。', 'b') : '') + `
      <div class="grid g3">
        ${h.card('', h.hero(fmt.pct(M.imbalanceRate), '团队失衡率 · 全球基准 ≈56% · 超此即 🔴', M.imbalanceRate > glob ? 'red' : ''))}
        ${h.card('', h.hero('#' + topOrig.normRank + `<span style="font-size:.45em;color:var(--ink3)"> / ${M.n}</span>`, `销冠归一名次 · 原始 #${topOrig.origRank} → 归一 #${topOrig.normRank} · 拿了 ${(x || 0).toFixed(1)}× 份额`))}
        ${h.card('', h.hero('#' + botOrig.normRank, `垫底归一名次 · 原始 #${botOrig.origRank} → 归一 #${botOrig.normRank} · 单位产出 ${(y || 0).toFixed(1)}× 销冠`, 'green'))}
      </div>
      ${h.card('原始榜 → 归一化榜', `<table class="tbl-flip-holder" style="display:none"></table><div id="sz-rank-wrap">${tbl}</div>`, { right: h.btn('▶ 播放归一化翻转', 'sz.flip', { cls: 'sm' }) })}
      ${h.src('归一化排名 = 全系统排名唯一合法输入（A-11）。重划增益 2–7% 为 Zoltners 铁证。')}
      ${kill}`;
  }

  /* ================= 屏 · 净贡献总账 + 十二道闸 ================= */
  function vLedger() {
    const c = C(); const L = ledgerFor(c, c.curM);
    const head = sect('📒 净贡献总账', '五行账全部由你录入的记录实时算出。每道闸可展开，附 📎 出处；建议一律走 action_card');
    if (L.grossMarginAmt === 0 && L.laborCostAmt === 0) return head + guide('录入成交、员工薪酬（数据中心）、经营成本后，这里会实时算出五行账。');
    const rate = safeDiv(L.net, L.grossMarginAmt), roi = safeDiv(L.grossMarginAmt, L.laborCostAmt);
    const mo = c.curM;
    const nDeals = c.db.deals.filter(d => d.status === 'won' && d.dealDate && SK.monthOf(d.dealDate) === mo).length;
    const overdue = c.db.deals.filter(d => d.status === 'won' && d.dealDate && !d.paidDate);
    const overdue60 = overdue.filter(d => SK.diffDays(d.dealDate, c.T) > 60);
    const ledgerCard = h.card(`经营净贡献（本期 ${mo}）`, `
      ${h.hero(fmt.yuan(L.net) + `<span style="font-size:.42em;color:var(--ink3)"> · ${fmt.pct(rate)}</span>`, '经营净贡献口径，非财务报表口径 · 目标准确率 90%', L.net < 0 ? 'red' : '')}
      <div style="margin-top:10px">${h.kv([
        { k: '毛利（Σ 回款 × 品类毛利率）', v: fmt.yuan(L.grossMarginAmt) },
        { k: '− 人力成本 laborCost（底薪+社保+提成+全部发放）', v: '−' + fmt.yuan(L.laborCostAmt) },
        { k: '− 经营成本（按月）', v: '−' + fmt.yuan(L.opCostAmt) },
        { k: '− 退款毛利冲减', v: '−' + fmt.yuan(L.refundMarginAmt) },
        { k: '− 折扣毛利泄漏', v: '−' + fmt.yuan(L.discountMarginAmt) },
        { k: '= 经营净贡献', v: fmt.yuan(L.net), total: true },
      ])}</div>`);
    const roiCard = h.card('团队 labor_roi', `
      ${h.hero(roi == null ? DASH : roi.toFixed(2), `毛利 ÷ laborCost · 提成率 r=${fmt.pct(c.r, 2)} ${h.linked('定价器实时')}`, roi != null && roi < 1 ? 'red' : '', true)}
      <div class="divider"></div>
      ${h.kv([
        { k: '本期成交（won）', v: nDeals + ' 笔' },
        { k: '本期折扣记录', v: discountsIn(c, mo).length + ' 笔' },
        { k: '经营成本项', v: c.db.opcosts.length + ' 项' },
        { k: '挂账（won 未回款）', v: `${overdue.length} 笔${overdue60.length ? ` · 其中 >60 天 ${overdue60.length} 笔 🔴` : ''}` },
      ])}
      ${h.hint('口径：计毛利/回款的单 = won（按 dealDate 归月）；挂账 = won 且 paidDate 为空。')}`);
    return head + `<div class="grid g2" style="align-items:start">${ledgerCard}${roiCard}</div>
      <div class="sect"><h2>十二道闸（实时判定）</h2><span class="sub">闸⑤⑨⑪ 实时取证 · 闸⑦③ 口径说明</span></div>
      ${gatesHtml(c, mo)}`;
  }
  function gatesHtml(c, mo) {
    const g5 = gate5(c, mo);
    const fr = fuseRows(c, mo); const anyFuse = fr.some(r => r.fuse);
    const uer = uerAll(c); const teamMean = uer.ok ? uer.teamMean : null;
    const gates = [];
    gates.push(h.acc(`⑤ 折扣泄漏 <span style="margin-left:auto">${chipFor(g5.leakRed || g5.pushRed)}</span>`, gate5Body(g5), g5.leakRed || g5.pushRed));
    gates.push(h.acc(`⑨ 品类泄漏熔断 <span style="margin-left:auto">${chipFor(anyFuse)}</span>`, gate9Body(fr), anyFuse));
    gates.push(h.acc(`⑪ 敲竹杠（三证据链） <span style="margin-left:auto">${teamMean == null ? h.badge('需 UER', 'n') : chipFor(teamMean < 0)}</span>`, gate11Body(c, teamMean), teamMean != null && teamMean < 0));
    gates.push(h.acc(`⑦ 剪刀差 <span style="margin-left:auto">${h.badge('口径', 'n')}</span>`, `<div class="hint" style="font-size:12.6px">剪刀差 = 贡献增长率 − 收入增长率 = 借款利率的计量器。正值大：他在给你打白工，利率越来越高——他会走。负值大：🔴 你在向未来透支。需 ≥2 个周期数据点亮逐人榜（逐人剪刀差已注入 summary.perPerson.scissors，留人器实时消费）。`));
    gates.push(h.acc(`③ 报销永不进收入 <span style="margin-left:auto">${h.badge('铁律', 'g')}</span>`, `<div class="hint" style="font-size:12.6px">报销（reimburse）只进 laborCost 成本侧，永不计入 totalIncome。宪法函数级，代码不可绕过。</div>`));
    return gates.join('');
  }
  function gate5Body(g) {
    if (g.leakRate == null) return '<div class="hint">本期没有折扣记录。在录入中心添加折扣后点亮。</div>';
    return `<div style="font-size:12.8px;line-height:1.6">你的折扣泄漏率 <b>${fmt.pct(g.leakRate)}</b>${g.leakRed ? ' 🔴（红线 6%）' : ''}。📎 Larkin (2014) JLE：定价扭曲损失 6–8% 收入。折扣里 <b>${fmt.pct(g.pushShare)}</b> 打的原因是「期末冲刺」${g.pushRed ? ' 🔴（红线 40%）' : ''}——是你的提成结构在诱导销售砍价。</div>
      ${h.src('⚠️ 漏水守恒（Holmström & Milgrom 1991）：堵死砍价，水会从别处漏。你不是消灭作弊，是给作弊指定一个便宜出口。')}
      ${h.action('', '建议：打开【定价】→ 方案风洞，压平提成拐点。', 'b', h.btn('去定价器', 'ui.nav', { cls: 'sm', data: 'data-board="dingjia"' }))}`;
  }
  function gate9Body(rows) {
    if (!rows.length) return '<div class="hint">本期无成交。</div>';
    return h.kv(rows.map(r => ({ k: `${esc(r.cat.name)}（毛利率 ${fmt.pct(r.cat.grossMarginRate)}，回款占比 ${fmt.pct(r.share)}）`, v: r.fuse ? h.badge('🔴 熔断', 'r') : h.badge('正常', 'g') }))) +
      h.src('低价熔断线：毛利率 <22% ∧ 回款占比 >20% → 🔴。你的销售把大量时间花在给你赚最少的品类上。[ 打开产品证据包 ]');
  }
  function gate11Body(c, teamMean) {
    const lr = SK.X('liuren');
    const e1 = (lr && lr.ahc != null) ? lr.ahc : null;                                     // 实时取证①：留人器 AHC
    const Mn = m21Month(c, c.curM).n || 0;
    const masters = {}; c.db.m28Agreements.forEach(a => { masters[a.masterId] = 1; });     // 实时取证②：M28 覆盖率
    const e2 = Mn > 0 ? (safeDiv(Object.keys(masters).length, Mn) || 0) : null;
    const e3 = c.db.m28Agreements.some(a => a.irrevocable);                                // 实时取证③：不可撤销条款
    const hj = E.hijackVerdict({ ahc: e1, m28Coverage: e2, irrevocable: e3 });
    const head = `<div style="font-size:12.8px;line-height:1.6">你的团队 UER 均值 = <b>${teamMean == null ? '—（需 ≥' + gc('suanzhang.uerMinObs') + ' 观测）' : fmt.wan(teamMean) + '/人/月'}</b>。📌 第四定理（Hart 诺奖 2016）：你不给他控制权，他就不会投入那些你测不到的努力。</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin:10px 0">
        <div><div class="hint">AHC 信用分 ${h.linked('留人器实时')}</div><b style="font-size:16px">${e1 == null ? DASH : e1}</b></div>
        <div><div class="hint">M28 产权覆盖 ${h.linked('DB 实时')}</div><b style="font-size:16px">${e2 == null ? DASH : fmt.pct(e2, 0)}</b></div>
        <div><div class="hint">irrevocable 条款</div><b style="font-size:16px">${e3 ? '是' : '否'}</b></div>
      </div>`;
    let body;
    if (teamMean != null && teamMean >= 0) body = h.action('', '团队 UER 均值 ≥ 0，闸⑪ 未触发。', 'g');
    else if (hj.verdict === 'pointed_hoarding')
      body = h.action(`${h.dot('r')} 证据指向①（在藏）`, `三项里有 <b>${hj.bad}</b> 项不利（${hj.badList.join('、')}）。测不到的努力可以被事后剥夺，所以他不会投。`, 'r',
        h.btn('开启不可撤销条款', 'ui.toast-ac', { cls: 'sm' }) + h.btn('给销冠签 M28', 'ui.nav', { cls: 'sm', data: 'data-board="liuren"' }) + h.btn('三个月后回看', 'ui.toast-ac', { cls: 'sm' }));
    else if (hj.verdict === 'not_supported')
      body = h.action(`${h.dot('a')} 三个证据都不支持「他在藏」`, '你在信用这一侧已做到了——UER 为负更可能是②漏水或③地盘。系统<b>不建议</b>继续追究「藏努力」，也不建议再加产权。', 'a',
        h.btn('折扣泄漏（闸⑤）', 'ui.nav', { cls: 'sm', data: 'data-board="suanzhang" data-sub="ledger"' }) + h.btn('线索指数（M21）', 'ui.nav', { cls: 'sm', data: 'data-board="suanzhang" data-sub="normalize"' }));
    else
      body = h.action(`${h.dot('n')} 证据不全，系统不下结论`, `<b>${(hj.missingList || []).join('、')}</b> 尚未点亮（一体版实时取自留人器/统一 DB，无需导入信封）。UER 为负本身只说明「这里有事情发生」。`, '',
        h.btn('去留人器补 AHC 输入', 'ui.nav', { cls: 'sm', data: 'data-board="liuren"' }));
    return head + body + h.src('⚠️ 诚实边界：相关性非因果，要证因果用 M31。verdict 由判定函数返回，话术库无写死结论（S-D16）。');
  }

  /* ================= 屏 · UER 残差 ================= */
  function vUer() {
    const c = C(); const uer = uerAll(c);
    const head = sect('🔬 UER 残差 · 剥离可观测之后', '第四定理引言：可观测努力（线索/转化/客单/毛利率）解释不了的部分，就是残差。它是信号，不是结论');
    if (!uer.ok) {
      return head + h.card('', h.hero(DASH, uer.singular ? '数据共线，回归不可解' : `观测 ${uer.obs || 0} < ${uer.need || gc('suanzhang.uerMinObs')}（8人×6月）`)) +
        h.banner('📌 UER 是团队级 OLS 残差，需足够的人-月观测才可解。当前不足 → 系统显 "—"，绝不假装知道（A-19）。继续录入历史月成交即可点亮。', 'n') + guide('录入 ≥48 条「人×月」观测（每人每月有线索且有成交）后，UER 面板自动点亮。');
    }
    const M = m21Month(c, c.curM);
    const byId = {}; uer.rows.forEach(r => { byId[r.sp] = r; });
    const mrows = (M.rows || []).slice().sort((a, b) => ((byId[b.id] || {}).resid || 0) - ((byId[a.id] || {}).resid || 0));
    const tbl = h.tbl([{ t: '销售' }, { t: 'UER 残差', num: 1 }, { t: '分档' }, { t: '解读（不下定论）' }],
      mrows.filter(r => byId[r.id]).map(r => {
        const u = byId[r.id];
        const col = u.band === 'red' ? 'var(--red)' : u.band === 'green' ? 'var(--green)' : 'var(--ink)';
        return `<tr><td><b>${esc(r.name)}</b></td><td class="num" style="color:${col}">${fmt.wan(u.resid)}</td><td>${h.dot(u.band === 'green' ? 'g' : u.band === 'red' ? 'r' : 'n')}</td><td class="hint">${u.band === 'red' ? '有事情发生（负残差）' : u.band === 'green' ? '超出可观测预期' : '在预期带内'}</td></tr>`;
      }));
    // 销冠个人归因卡（3.3b）
    let aCard = '';
    const A = (M.rows || []).slice().sort((a, b) => a.origRank - b.origRank)[0];
    if (A && byId[A.id]) {
      const aLeak = personLeak(c, A.id, c.curM), teamLeak = gate5(c, c.curM).leakRate;
      const attr = E.personAttribution({ discountLeakRate: aLeak, teamDiscountLeakRate: teamLeak, complaintRate: null, teamComplaintRate: null, leadIndex: A.index });
      if (byId[A.id].band === 'red') {
        let block;
        if (attr.verdict === 'leak') block = h.action(`${h.dot('r')} 证据指向②（${attr.badList.join('、')}）`, `他在用你的毛利，买他自己的提成。他的折扣泄漏率 ${fmt.pct(aLeak)}，团队均值 ${fmt.pct(teamLeak)}。`, 'r', h.btn('查看他的折扣明细', 'ui.nav', { cls: 'sm', data: 'data-board="suanzhang" data-sub="crime"' }));
        else if (attr.verdict === 'territory') block = h.action(`${h.dot('a')} 证据指向③（地盘）`, `他的线索指数只有 ${A.index == null ? DASH : A.index.toFixed(2)}（合理带下沿 0.90）——先补足线索，再谈他这个人。`, 'a');
        else block = h.action(`${h.dot('n')} 三查无异常`, '折扣、客诉、地盘三查无异常。「①他在藏」与其他测不到的原因无法区分——系统不下结论。用 M31 做 A/B。');
        aCard = h.card(`${esc(A.name)} 的 UER 卡`, `<div style="font-size:12.8px;line-height:1.6">${esc(A.name)} 的可观测努力（${A.leads} 条线索），按杠杆链应产出更高净贡献，实际残差 ${fmt.wan(byId[A.id].resid)}。三种可能：①他在藏 ②他在漏水 ③地盘差（但他线索指数 ${A.index == null ? DASH : A.index.toFixed(2)}，拿的是最多的）。</div>${block}`, { right: h.badge('残差 ' + fmt.wan(byId[A.id].resid) + ' 🔴', 'r') });
      } else {
        aCard = h.hint(`销冠 ${esc(A.name)} 本期残差 ${fmt.wan(byId[A.id].resid)}（${byId[A.id].band === 'green' ? '绿档' : '灰档'}）——个人归因卡仅在其 UER 落入红档时展开。`);
      }
    }
    // 产权价值（M28 分组，样本门槛 4 人×6 月）
    const masters = {}; c.db.m28Agreements.forEach(a => { masters[a.masterId] = 1; });
    const w = uer.rows.filter(r => masters[r.sp]).map(r => r.resid), o = uer.rows.filter(r => !masters[r.sp]).map(r => r.resid);
    const pv = E.propertyValue(w, o, c.idx.monthList.length, c.idx.monthList.length);
    const pvCard = h.card('产权价值（M28 分组 · 相关性非因果）', `
      ${h.hero(pv == null ? DASH : fmt.wan(pv), pv == null ? `样本不足：有产权 ${w.length} 人 / 无产权 ${o.length} 人（需各 ≥${gc('suanzhang.propertyMinEach').people} 人 × ≥${gc('suanzhang.propertyMinEach').months} 月）` : '有产权组 − 无产权组 · UER 残差均值差', '', true)}
      ${h.banner('⚠️ 有产权协议的人 UER 更高，可能因为产权，也可能因为你本来就把产权给了更强的人。要证因果请用 M31 随机对照。[ 启动实验 5：M28 产权化带教 vs 一次性奖金 ]（S-04）', 'n')}`);
    return head +
      h.card('', h.hero(fmt.wan(uer.teamMean), `${uer.teamMean < 0 ? '团队整体为负 🔴 → 触发闸⑪三证据链' : '正常'} · 面板 ${uer.obs} 观测 · σ=${fmt.wan(uer.sigma)}`, uer.teamMean < 0 ? 'red' : 'green')) +
      h.banner('📌 <b>三种解释必须全部展示，绝不下定论</b>：UER 是信号，不是结论。它告诉你「这里有事情发生」，不告诉你「发生了什么」。要弄清原因，请看分项或用 M31 做 A/B。（S-03，写死不可编辑）', 'n') +
      h.card('逐人残差（本期）', tbl) + aCard + pvCard;
  }

  /* ================= 屏 · 产品证据包 ================= */
  function vProduct() {
    const c = C(); const mo = c.curM;
    const head = sect('📦 产品证据包', '四组证据，指向同一个问题：也许问题不在人，在产品');
    const g5 = gate5(c, mo);
    const fr = fuseRows(c, mo); const lowFuse = fr.some(r => r.fuse);
    const won = c.db.deals.filter(d => d.status === 'won').length, lost = c.db.deals.filter(d => d.status === 'lost').length;
    const winRate = (won + lost) > 0 && lost > 0 ? safeDiv(won, won + lost) : null;
    const fd = gc('suanzhang.forcedDiscount');
    const forced = g5.leakRate != null && g5.leakRate > fd.rate && g5.pushShare != null && g5.pushShare > fd.share;
    // 退款品类集中度：品类退款占比 ÷ 品类回款占比 的最大值
    let refundX = null;
    {
      const refM = c.db.refunds.filter(x => SK.monthOf(x.refundDate) === mo);
      const totalRef = refM.reduce((a, x) => a + x.amount, 0);
      let totalPay = 0; const payByCat = {};
      c.db.deals.forEach(d => { if (d.status !== 'won' || !d.dealDate || SK.monthOf(d.dealDate) !== mo) return; totalPay += d.paymentAmt; payByCat[d.categoryId] = (payByCat[d.categoryId] || 0) + d.paymentAmt; });
      if (totalRef > 0 && totalPay > 0) {
        const refByCat = {}; refM.forEach(x => { refByCat[x.categoryId] = (refByCat[x.categoryId] || 0) + x.amount; });
        Object.keys(refByCat).forEach(cid => {
          const xv = safeDiv(refByCat[cid] / totalRef, (payByCat[cid] || 0) / totalPay);
          if (xv != null && (refundX == null || xv > refundX)) refundX = xv;
        });
      }
    }
    const ev = (title, hit, stat, note) => h.card('', `
      <div style="display:flex;align-items:center;gap:8px"><b>${title}</b><span style="margin-left:auto">${hit == null ? h.badge('需补录', 'n') : hit ? h.badge('触发', 'r') : h.badge('未触发', 'g')}</span></div>
      <div style="font-size:15px;font-weight:650;margin:8px 0 2px">${stat}</div>${h.src(note)}`);
    return head + `<div class="grid g2">
      ${ev('① 赢单天花板', winRate == null ? null : winRate < gc('suanzhang.winRateCeiling'), winRate == null ? '需录入 lost 单点亮赢单率' : `赢单率 ${fmt.pct(winRate)}（won ${won} / lost ${lost}）`, '顶级销售也撞到同一堵墙 → 产品/定位问题（winRate<20%）')}
      ${ev('② 品类退款集中', refundX == null ? (c.db.refunds.length > 0 ? false : null) : refundX > gc('suanzhang.refundConcentrationX'), `本期退款 ${c.db.refunds.filter(r => SK.monthOf(r.refundDate) === mo).length} 笔${refundX != null ? ` · 集中度 ×${refundX.toFixed(1)}` : ''}`, '退款集中在特定品类 = 该品类承诺与交付有缺口（集中度 >3× 触发）')}
      ${ev('③ 被迫折扣', forced, `折扣率 ${fmt.pct(g5.leakRate)} / 期末占比 ${fmt.pct(g5.pushShare)}`, '不是销售爱砍价，是产品撑不住原价（>15% ∧ 压价>60%）')}
      ${ev('④ 低毛利熔断品类', lowFuse, esc(fr.filter(r => r.fuse).map(r => r.cat.name).join('、') || '无'), '强销先流失——销冠最不能忍受「卖不动」')}
    </div>
    <div class="callout" style="margin-top:14px">以上是数据。判断归你。但请记住系统的边界：<b>这个系统不会让一个卖不动的产品卖动。</b>销售只是产品的传声筒。产品是地基。地基不稳，一定翻车。而产品不好的公司，销冠会最先流失——因为销冠最不能忍受「卖不动」。如果你看完这四组数据，仍然认为产品没有问题——我们尊重你的判断。系统会继续为你优化其他环节。但我们必须诚实地告诉你：如果问题在地基，那么我们能帮你的，最多是让翻车晚一点发生。<div class="hint" style="margin-top:6px">（S-06，代码写死不可编辑）</div></div>`;
  }

  /* ================= 屏 · 人效止血 ================= */
  function vEfficiency() {
    const c = C(); const mo = c.curM; const L = ledgerFor(c, mo);
    const head = sect('⚙️ 人效 · 错价 · 主管', `本期 ${mo}。回本与止血由你录入的成交/薪酬实时算出`);
    if (L.grossMarginAmt === 0 && L.laborCostAmt === 0) return head + guide('录入成交与员工薪酬后，这里会实时算出回本进度与止血分诊。');
    const payback = E.paybackProgress(L.grossMarginAmt, L.laborCostAmt);
    const S = SK.X('suanzhang');
    const dvi = S ? S.dvi : null; const dband = E.dviBand(dvi);
    const M = m21Month(c, mo); const idxBySp = {}; (M.rows || []).forEach(r => { idxBySp[r.id] = r; });
    const uerBySp = S ? S.uerBySp : {};
    const triage = c.db.people.filter(p => p.isActive && p.positionType === 'sales').map(p => {
      const d = lastWonDays(c, p.spId);
      if (d == null || d < gc('suanzhang.stopBleedDays')) return null;
      const rr = idxBySp[p.spId], u = uerBySp[p.spId];
      const t = E.stopBleedTriage({ zeroEventDays: d, isActivePaid: true, leadIndex: rr ? rr.index : null, uer: u ? u.resid : null });
      return { p, days: d, idx: rr ? rr.index : null, t };
    }).filter(Boolean);
    const triHtml = !triage.length
      ? h.action('', `本期没有连续 ≥${gc('suanzhang.stopBleedDays')} 天零成交的在职销售。`, 'g')
      : triage.map(x => {
        if (x.t.verdict === 'starved') return h.action(`${h.dot('r')} 止血拦截 · ${esc(x.p.name)}`, `连续 ${x.days} 天零成交，但线索指数只有 <b>${x.idx == null ? DASH : x.idx.toFixed(2)}</b>（拦截线 ${gc('suanzhang.territoryStarveIdx')}）。🔴 这不是他不干活，这是你没给他饭吃。止血之前，请先补足他的线索。`, 'r', h.btn('去看线索分配', 'ui.nav', { cls: 'sm', data: 'data-board="suanzhang" data-sub="normalize"' }));
        if (x.t.verdict === 'invisible_work') return h.action(`${h.dot('a')} 看不见的工作 · ${esc(x.p.name)}`, `连续 ${x.days} 天零成交，但他的 UER 残差为正——他可能在做你测不到的工作（帮带/大单铺垫）。双校验未通过，不建议直接止血。`, 'a');
        return h.action('', `${esc(x.p.name)}：连续 ${x.days} 天零成交，线索指数 ${x.idx == null ? DASH : x.idx.toFixed(2)}。双校验通过前不建议直接止血。`, 'a');
      }).join('');
    return head + `<div class="grid g3">
      ${h.card('', h.hero(fmt.pct(payback, 0), '团队回本进度 · 本期毛利 ÷ 人力成本', payback != null && payback < 1 ? 'red' : 'green', true))}
      ${h.card('', h.hero(DASH, '主管增益（归一化） · 需录入团队/换帅归属点亮', '', true) + h.src('换差主管 = 白得一个人；主管效应主要是教学成分（Lazear-Shaw-Stanton 2015）。主管唯一合法考核指标 = 归一化人均，且对全队可见。'))}
      ${h.card('', h.hero(dvi == null ? DASH : Math.round(dvi), 'DVI 数据可见度（0–100）· >70 🟢 / 40–70 🟡 / <40 🔴', dband === 'red' ? 'red' : dband === 'amber' ? 'amber' : dband === 'green' ? 'green' : '', true) + h.hint('分项：日报填报率 / 录入滞后（无滞后概念记满）/ 线索归因率 / 折扣记录率，各占 25 分；本期成交 <10 单 → —'))}
    </div>
    <div class="sect"><h2>止血分诊 · 双校验</h2><span class="sub">连续 ${gc('suanzhang.stopBleedDays')} 天零成交 → 先查地盘（线索指数 <${gc('suanzhang.territoryStarveIdx')} 拦截），再查 UER（>0 = 看不见的工作）</span></div>
    ${triHtml}
    ${h.action('扩编算钱器（只读沙盒）', 'Zoltners 边际判据：加人加到边际 = 边际；三年最优规模 ×1.18。此沙盒不落库、不写员工数据（招人器七步链已实时消费本模块人效口径）。', 'b', h.btn('去招人器', 'ui.nav', { cls: 'sm', data: 'data-board="zhaoren"' }))}`;
  }

  /* ================= 屏 · 罪证屏 ================= */
  function vCrime() {
    const c = C(); const mo = c.curM;
    const head = sect('🚨 罪证屏 · 三台打印机', '这些钱不在任何报表上——它们被「冲刺」「人情折算」吃掉了。全部从你录入的折扣/红包实时派生');
    const m34r = m34Calc(c);
    const m34Card = m34r.ok
      ? h.card('M34 时点套利（近 12 月）', `
          ${h.hero(fmt.wan(m34r.annualLeakAmt), '年化泄漏 = max(0, 时段差) × 末段回款', m34r.annualLeakAmt > 0 ? 'red' : '', true)}
          <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:8px">
            <div><div class="hint">末段折扣率（当月最后 1/3）</div><b>${fmt.pct(m34r.tailRate)}</b></div>
            <div><div class="hint">平时折扣率</div><b>${fmt.pct(m34r.headRate)}</b></div>
            <div><div class="hint">时段差${m34r.red ? ' 🔴（红线 2pp）' : ''}</div><b>${(m34r.diff * 100).toFixed(1)} pp</b></div>
          </div>
          ${h.src('Larkin JLE 2014：同一病灶损失 6–8% 收入。✅ 不建议砍奖金（Steenburgh 2008：奖金努力增量压倒时点低效）。建议回定价器压平拐点。')}`)
      : h.card('M34 时点套利', h.hero(DASH, '需录入折扣记录点亮', '', true));
    const m36Card = h.card('M36 卡线率', h.hero(DASH, '需录入你设的每日底线指标（ProcessBaseline）点亮 · 引擎已就绪（带 [基线, +15%] 区间与 40% 红线）', '', true) +
      h.src('Falk & Kosfeld AER 2006：设了底线，多数人把产出降到底线附近——你的底线成了他们的上限。'));
    const M = m21Month(c, mo);
    let m35Html = '';
    if (M.done && M.n >= 2) {
      const bot = M.rows.slice().sort((a, b) => b.origRank - a.origRank)[0];
      const mis = E.m35Misfire(bot.origRank, bot.normRank, M.n);
      m35Html = h.acc(`${h.dot(mis.misfire ? 'r' : 'n')} M35 淘汰误杀预检 · ${esc(bot.name)} <span style="margin-left:auto" class="hint">扣扳机前的最后核查</span>`,
        `<div style="font-size:12.8px;line-height:1.6">若你要开 <b>${esc(bot.name)}</b>：原始 #${bot.origRank}，归一化 #${bot.normRank}。jump = ${mis.jump}${mis.misfire ? ` ≥ 阈值 ${mis.threshold} → 🔴 <b>误杀警报</b>：他坐在最烂地盘上（${bot.leads} 条线索）。` : ` < 阈值 ${mis.threshold}，非误杀。`}</div>
        ${h.src('末位淘汰兴衰史：GE 废除、微软「失落的十年」。相对排名杀死协作。')}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${h.btn('换地盘观察一季', 'ui.toast-ac', { cls: 'sm' })}${h.btn('切换绝对生存线', 'ui.toast-ac', { cls: 'sm' })}${h.btn('仍坚持淘汰（留痕）', 'ui.toast-ac', { cls: 'sm' })}</div>`, true);
    }
    const hb = hongbaoRows(c);
    const hbHtml = !hb.length ? '<div class="hint">本期无 discretionary 红包记录。</div>' : hb.map(x => {
      let out = '';
      if (x.chk.rule1) out += h.action('', `这笔 ${fmt.yuan(x.p.amount)} 的红包 < 他日均提成的 ${gc('suanzhang.hongbaoDailyX')} 倍（≈${fmt.yuan(x.dailyAvg * gc('suanzhang.hongbaoDailyX'))}）——你正在把人情折算成时薪。📎 Heyman & Ariely：小额金钱把社会规范切换成市场规范（📎 Gneezy & Rustichini 2000：切换不可逆）。要么给足走市场，要么零金额走人情。`, 'a');
      if (x.chk.rule2) out += h.action('', `${esc((SK.personById(x.p.employeeId) || {}).name || x.p.employeeId)} 的即时无条件红包已达 ${gc('suanzhang.hongbaoRepeatN')} 笔以上。📎 Chung & Narayandas JMR 2017：立刻发的无条件奖金让业绩不升反降。建议延迟至周末、降低频次。`, 'a');
      return out || h.kv([{ k: `${fmt.yuan(x.p.amount)} 红包（${esc((SK.personById(x.p.employeeId) || {}).name || '')}）`, v: h.badge('正常', 'g') }]);
    }).join('');
    return head + `<div class="grid g2" style="align-items:start">${m34Card}${m36Card}</div>
      <div style="margin-top:10px">${m35Html}</div>
      ${h.card('红包体检记录（本期）', hbHtml + h.hint('近似口径：日均提成 = 累计提成 ÷ max(1, 成交笔数×9)。红包体检不产生任何扣减建议（S-D11）。'))}`;
  }

  /* ================= 屏 · 录入中心 ================= */
  let entryTab = 'deals';
  const yuanFen = y => { const n = parseFloat(y); return isNaN(n) ? 0 : Math.round(n * 100); };
  const pctRate = p => { const n = parseFloat(p); return isNaN(n) ? 0 : n / 100; };
  const pName = id => { const p = SK.personById(id); return p ? p.name : id; };
  const cName = id => { const ct = SK.catById(id); return ct ? ct.name : id; };
  const FORMS = {
    people: { title: '人员', key: 'people' },                     // 特殊：跳转数据中心
    categories: {
      title: '品类', key: 'categories', head: ['品类', '毛利率', '停留中位(天)'],
      cols: r => [esc(r.name), fmt.pct(r.grossMarginRate), r.medianStayDays],
      fields: [['name', '品类名', 'text'], ['margin', '毛利率(%)', 'number'], ['stay', '客户停留中位(天)', 'number', 30]],
      make: v => ({ id: SK.uid('cat'), name: v.name, grossMarginRate: pctRate(v.margin), medianStayDays: +v.stay || 30 }),
    },
    leads: {
      title: '线索分配', key: 'leads', head: ['销售', '月份', '分配', '自开发'],
      cols: r => [esc(pName(r.employeeId)), r.month, r.assignedLeads, r.selfDevLeads],
      fields: [['employeeId', '销售', 'person'], ['month', '月份', 'month'], ['assignedLeads', '分配线索', 'number'], ['selfDevLeads', '自开发', 'number', 0]],
      make: v => ({ id: SK.uid('la'), employeeId: v.employeeId, month: v.month, assignedLeads: +v.assignedLeads || 0, selfDevLeads: +v.selfDevLeads || 0 }),
    },
    deals: {
      title: '成交单', key: 'deals', head: ['销售', '成交日', '回款', '品类', '回款状态'],
      cols: r => [esc(pName(r.employeeId)), r.dealDate || (r.status === 'lost' ? '（丢单）' : '（在途）'), fmt.yuan(r.paymentAmt), esc(cName(r.categoryId)), r.status !== 'won' ? (r.status === 'lost' ? '丢单' : '在途') : (r.paidDate ? '已回款' : '挂账')],
      fields: [['employeeId', '销售', 'person'], ['categoryId', '品类', 'category'], ['dealDate', '成交日（归月口径）', 'date'], ['paymentAmt', '回款(元)', 'number'], ['paidDate', '回款日（留空=挂账）', 'date-opt']],
      make: v => ({ id: SK.uid('deal'), employeeId: v.employeeId, categoryId: v.categoryId, dealDate: v.dealDate, intentDate: null, paidDate: v.paidDate || null, closeDate: v.dealDate, status: 'won', paymentAmt: yuanFen(v.paymentAmt), discountRate: 0 }),
    },
    discounts: {
      title: '折扣', key: 'discounts', head: ['销售', '日期', '折扣额', '原因'],
      cols: r => [esc(pName(r.employeeId)), r.discountDate, fmt.yuan(r.listPriceAmt - r.actualPriceAmt), SE02[r.reason] || r.reason],
      fields: [['employeeId', '销售', 'person'], ['discountDate', '日期', 'date'], ['categoryId', '品类', 'category'], ['listPriceAmt', '标价(元)', 'number'], ['actualPriceAmt', '实收(元)', 'number'], ['reason', '原因', 'se02']],
      make: v => ({ id: SK.uid('disc'), employeeId: v.employeeId, discountDate: v.discountDate, categoryId: v.categoryId, listPriceAmt: yuanFen(v.listPriceAmt), actualPriceAmt: yuanFen(v.actualPriceAmt), reason: v.reason }),
    },
    payouts: {
      title: '奖金/红包', key: 'payouts', head: ['销售', '日期', '类型', '金额'],
      cols: r => [esc(pName(r.employeeId)), r.payoutDate, SE01[r.type] || r.type, fmt.yuan(r.amount)],
      fields: [['employeeId', '销售', 'person'], ['payoutDate', '日期', 'date'], ['type', '类型', 'se01'], ['amount', '金额(元)', 'number'], ['timing', '时点', 'se04'], ['hasCondition', '有条件', 'bool']],
      make: v => ({ id: SK.uid('pay'), employeeId: v.employeeId, payoutDate: v.payoutDate, period: SK.monthOf(v.payoutDate), type: v.type, amount: yuanFen(v.amount), timing: v.timing, hasCondition: v.hasCondition === 'true' }),
    },
    refunds: {
      title: '退款', key: 'refunds', head: ['销售', '日期', '品类', '退款额'],
      cols: r => [esc(pName(r.employeeId)), r.refundDate, esc(cName(r.categoryId)), fmt.yuan(r.amount)],
      fields: [['employeeId', '销售', 'person'], ['refundDate', '日期', 'date'], ['categoryId', '品类', 'category'], ['amount', '退款额(元)', 'number']],
      make: v => ({ id: SK.uid('ref'), employeeId: v.employeeId, refundDate: v.refundDate, categoryId: v.categoryId, amount: yuanFen(v.amount) }),
    },
    opcosts: {
      title: '经营成本(按月)', key: 'opcosts', head: ['名称', '类型', '月额'],
      cols: r => [esc(r.name), SE07[r.kind] || r.kind, fmt.yuan(r.monthlyAmt)],
      fields: [['name', '名称', 'text'], ['kind', '类型', 'se07'], ['monthlyAmt', '月额(元)', 'number']],
      make: v => ({ id: SK.uid('oc'), name: v.name, kind: v.kind, monthlyAmt: yuanFen(v.monthlyAmt) }),
    },
  };
  function fldHtml(fd, curM, T) {
    const [id, , type, def] = [fd[0], fd[1], fd[2], fd[3]];
    const eid = 'szf_' + id;
    const selEnum = map => `<select id="${eid}">${Object.keys(map).map(k => `<option value="${k}">${esc(map[k])}</option>`).join('')}</select>`;
    if (type === 'person') return `<select id="${eid}">${SK.DB.people.filter(p => p.isActive).map(p => `<option value="${p.spId}">${esc(p.name)}</option>`).join('')}</select>`;
    if (type === 'category') return `<select id="${eid}">${SK.DB.categories.map(ct => `<option value="${ct.id}">${esc(ct.name)}</option>`).join('')}</select>`;
    if (type === 'se01') return selEnum(SE01);
    if (type === 'se02') return selEnum(SE02);
    if (type === 'se04') return selEnum(SE04);
    if (type === 'se07') return selEnum(SE07);
    if (type === 'bool') return `<select id="${eid}"><option value="false">否</option><option value="true">是</option></select>`;
    if (type === 'month') return `<input id="${eid}" type="month" value="${curM}">`;
    if (type === 'date') return `<input id="${eid}" type="date" value="${T}">`;
    if (type === 'date-opt') return `<input id="${eid}" type="date">`;
    return `<input id="${eid}" type="${type === 'number' ? 'number' : 'text'}" ${def != null ? `value="${def}"` : ''}>`;
  }
  function vEntry() {
    const c = C();
    const head = sect('🗄️ 录入中心', '你在这里录入的每条记录，都会立刻改变前面所有屏幕的数字（添加 → 全站同帧重算）');
    const counts = [['人员', SK.DB.people.length], ['品类', SK.DB.categories.length], ['线索', SK.DB.leads.length], ['成交', SK.DB.deals.length], ['折扣', SK.DB.discounts.length], ['发放', SK.DB.payouts.length], ['退款', SK.DB.refunds.length], ['成本', SK.DB.opcosts.length]];
    const overview = h.card(`数据概览 · 本期 ${c.curM}`, `<div style="display:flex;gap:18px;flex-wrap:wrap">${counts.map(x => `<div><div class="hint">${x[0]}</div><b style="font-size:16px">${x[1]}</b></div>`).join('')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${h.btn('载入演示数据', 'data.seed')}${h.btn('导出全量备份', 'data.export')}</div>`);
    const tabs = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">${Object.keys(FORMS).map(k =>
      `<button class="btn sm ${entryTab === k ? 'pri' : ''}" data-act="sz.tab" data-tab="${k}">${FORMS[k].title} (${SK.DB[FORMS[k].key].length})</button>`).join('')}</div>`;
    let body;
    if (entryTab === 'people') {
      body = h.banner(`员工档案（含底薪/入职/离职）由「数据中心 · 员工档案」统一维护——算账器按 spId 实时关联，在职销售 <b>${SK.activeSales().length}</b> 人。`, 'b') +
        `<div style="display:flex;gap:8px">${h.btn('去数据中心维护员工 →', 'ui.nav', { cls: 'pri', data: 'data-board="data" data-sub="people"' })}</div>`;
    } else {
      const F = FORMS[entryTab];
      const rows = SK.DB[F.key].slice().reverse().slice(0, 40).map(r =>
        `<tr>${F.cols(r).map((cell, i) => `<td${i > 0 ? ' class="num"' : ''}>${cell}</td>`).join('')}<td class="num">${h.btn('删', 'sz.del', { cls: 'sm danger', data: `data-key="${F.key}" data-id="${r.id}"` })}</td></tr>`);
      body = `<div style="display:flex;gap:8px;margin-bottom:8px">${h.btn('＋ 添加' + F.title, 'sz.add', { cls: 'pri' })}</div>` +
        h.tbl(F.head.map(t => ({ t })).concat([{ t: '' }]), rows, { empty: '还没有记录——点上方按钮添加' }) +
        (SK.DB[F.key].length > 40 ? h.hint(`仅显示最近 40 条（共 ${SK.DB[F.key].length}）。`) : '');
    }
    return head + overview + h.card('录入中心 · 8 类实体', tabs + body) +
      h.banner('🔒 单向铁律：跨板块字段（AHC / M28 / 提成率 r）一体版实时取自统一 DB 与 X 总线——无需信封导入，永不回写他方板块。', 'n');
  }

  /* ================= 动作 ================= */
  Object.assign(SK.actions, {
    'sz.tab': d => { entryTab = d.tab; UI.render(); },
    'sz.add': () => {
      const F = FORMS[entryTab]; if (!F || !F.fields) return;
      if (F.fields.some(f2 => f2[2] === 'person') && !SK.DB.people.filter(p => p.isActive).length) return UI.toast('请先到数据中心添加员工');
      if (F.fields.some(f2 => f2[2] === 'category') && !SK.DB.categories.length) return UI.toast('请先添加品类');
      const c = C();
      UI.modal(`<h3>添加${F.title}</h3><div class="frm">${F.fields.map(fd => h.field(fd[1], fldHtml(fd, c.curM, c.T))).join('')}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">${h.btn('取消', 'ui.modal-close')}${h.btn('保存', 'sz.save', { cls: 'pri' })}</div>`);
    },
    'sz.save': () => {
      const F = FORMS[entryTab]; if (!F || !F.fields) return;
      const v = {}; let ok = true;
      F.fields.forEach(fd => {
        const el = document.getElementById('szf_' + fd[0]); v[fd[0]] = el ? el.value : '';
        if ((fd[2] === 'text' || fd[2] === 'number' || fd[2] === 'date') && (v[fd[0]] === '' || v[fd[0]] == null)) ok = false;
      });
      if (!ok) return UI.toast('请填写完整（文本/数字/日期字段不能为空）');
      SK.DB[F.key].push(F.make(v));
      UI.closeModal(); UI.commit(); UI.toast(`已添加${F.title}——全屏数字已即时重算`);
    },
    'sz.del': d => { SK.DB[d.key] = SK.DB[d.key].filter(r => r.id !== d.id); UI.commit(); UI.toast('已删除——全屏数字已即时重算'); },
    'sz.flip': () => {
      const wrap = document.getElementById('sz-rank-wrap'); if (!wrap) return;
      const tbody = wrap.querySelector('tbody'); if (!tbody) return;
      const c = C(); const M = m21Month(c, c.curM);
      const rank = {}; (M.rows || []).forEach(r => { rank[r.id] = r.normRank; });
      const rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-sp]')); if (!rows.length) return;
      const first = {}; rows.forEach(tr => { first[tr.dataset.sp] = tr.getBoundingClientRect().top; });
      rows.sort((a, b) => (rank[a.dataset.sp] || 99) - (rank[b.dataset.sp] || 99));
      rows.forEach(tr => tbody.appendChild(tr));
      rows.forEach(tr => {
        const dy = first[tr.dataset.sp] - tr.getBoundingClientRect().top;
        tr.style.transform = `translateY(${dy}px)`; tr.style.transition = 'none';
        requestAnimationFrame(() => { tr.style.transition = 'transform .6s cubic-bezier(.2,0,0,1)'; tr.style.transform = ''; });
      });
    },
  });

  /* ================= 模块注册 ================= */
  SK.registerModule({
    id: 'suanzhang', title: '算账', icon: '📒', order: 3,
    subnav: [
      { id: 'territory', label: '地盘审计' }, { id: 'normalize', label: '归一化真相' },
      { id: 'ledger', label: '净贡献总账' }, { id: 'uer', label: 'UER 残差' },
      { id: 'product', label: '产品证据' }, { id: 'efficiency', label: '人效止血' },
      { id: 'crime', label: '罪证屏' }, { id: 'entry', label: '录入中心' },
    ],
    liveCells() {
      const S = SK.X('suanzhang'); if (!S) return [];
      return [
        { k: '本月净贡献', v: S.ledger ? fmt.wan(S.ledger.net) : DASH, tone: S.ledger ? (S.ledger.net < 0 ? 'red' : 'green') : 'dim', board: 'suanzhang', sub: 'ledger', tip: '五行账：毛利−人力−经营成本−退款冲减−折扣泄漏' },
        { k: 'labor_roi', v: S.laborRoi != null ? fmt.num(S.laborRoi, 2) : DASH, tone: S.laborRoi != null && S.laborRoi < 1 ? 'red' : 'dim', board: 'suanzhang', sub: 'ledger', tip: '毛利 ÷ 人力成本' },
      ];
    },
    alerts() { return this.alertList().filter(a => a.tone === 'r').length; },
    alertList() {
      const S = SK.X('suanzhang'); if (!S) return [];
      const out = []; const c = C();
      if (S.imbalanceRate != null && S.imbalanceRate > gc('shared.imbalanceGlobal'))
        out.push({ tone: 'r', text: `算账·地盘失衡率 ${fmt.pct(S.imbalanceRate, 0)} 超全球基准 56%——排行榜一半在测地盘`, board: 'suanzhang', sub: 'territory' });
      if (S.ledger && S.ledger.net < 0)
        out.push({ tone: 'r', text: `算账·本月经营净贡献为负（${fmt.wan(S.ledger.net)}）`, board: 'suanzhang', sub: 'ledger' });
      const g5 = gate5(c, c.curM);
      if (g5.leakRed) out.push({ tone: 'r', text: `算账·闸⑤ 折扣泄漏率 ${fmt.pct(g5.leakRate)} 超红线 6%`, board: 'suanzhang', sub: 'ledger' });
      if (g5.pushRed) out.push({ tone: 'r', text: `算账·闸⑤ 期末冲刺占折扣 ${fmt.pct(g5.pushShare, 0)} 超红线 40%`, board: 'suanzhang', sub: 'ledger' });
      if (S.uerTeamMean != null && S.uerTeamMean < 0)
        out.push({ tone: 'r', text: `算账·团队 UER 均值为负（${fmt.wan(S.uerTeamMean)}/人/月）→ 触发闸⑪三证据链`, board: 'suanzhang', sub: 'uer' });
      const fr = fuseRows(c, c.curM).filter(r => r.fuse);
      if (fr.length) out.push({ tone: 'a', text: `算账·闸⑨ 品类熔断：${fr.map(r => r.cat.name).join('、')}（<22% 毛利 ∧ >20% 占比）`, board: 'suanzhang', sub: 'ledger' });
      const ovSet = {}; c.db.deals.forEach(d => { if (d.status === 'won' && d.dealDate && !d.paidDate && SK.diffDays(d.dealDate, c.T) > 60) ovSet[d.employeeId] = 1; });
      const ovN = Object.keys(ovSet).length;
      if (ovN) out.push({ tone: 'a', text: `算账·挂账超 60 天涉及 ${ovN} 人——回款口径正在失真`, board: 'suanzhang', sub: 'ledger' });
      const hbBad = hongbaoRows(c).filter(x => x.chk.rule1 || x.chk.rule2).length;
      if (hbBad) out.push({ tone: 'a', text: `算账·红包体检 ${hbBad} 笔触发（小额人情折算/即时无条件重复）`, board: 'suanzhang', sub: 'crime' });
      return out;
    },
    render(sub) {
      switch (sub) {
        case 'normalize': return vNormalize();
        case 'ledger': return vLedger();
        case 'uer': return vUer();
        case 'product': return vProduct();
        case 'efficiency': return vEfficiency();
        case 'crime': return vCrime();
        case 'entry': return vEntry();
        case 'territory': default: return vTerritory();
      }
    },
  });

  /* ================= 对拍自检（fixture 纯函数，独立于 SK.DB） ================= */
  const approx = (a, b, e) => a != null && Math.abs(a - b) <= (e || 1e-6);
  const withClock = fn => { SK.setTestToday('2026-07-13'); try { return fn(); } finally { SK.setTestToday(null); } };
  // M21 fixture：原版核弹表 10 人（黄金值来自原件 T4/T5/T6：失衡率 70%、垫底归一 #1、销冠归一 #8）
  const NUKE10 = [['A', 180, 12.0e6], ['B', 120, 10.0e6], ['C', 120, 9.5e6], ['D', 100, 8.0e6], ['E', 100, 7.5e6], ['F', 100, 7.0e6], ['G', 85, 6.0e6], ['H', 85, 5.0e6], ['I', 80, 4.0e6], ['J', 30, 3.0e6]]
    .map(p => ({ id: p[0], name: p[0], leads: p[1], grossMarginAmt: p[2], selfDevLeads: 0 }));
  SK.tests.push(
    { id: 'SZ-T1', name: '提成 commission(1000000,0.5,0.2706)=135300', fn: () => withClock(() => { const got = E.commission(1000000, 0.5, 0.2706); return { pass: got === 135300, got, want: 135300 }; }) },
    {
      id: 'SZ-T2', name: '净贡献五行账 ¥291,330 · labor_roi 2.14', fn: () => withClock(() => {
        const NET = { grossMarginAmt: 100e6, laborCostAmt: 46.667e6, opCostAmt: 15e6, refundMarginAmt: 2e6, discountMarginAmt: 7.2e6 };
        const net = E.netContribution(NET);
        const roi = +(NET.grossMarginAmt / NET.laborCostAmt).toFixed(2);
        return { pass: net === 29133000 && roi === 2.14, got: [net, roi], want: [29133000, 2.14] };
      }),
    },
    {
      id: 'SZ-T3', name: 'M21 核弹表：失衡70% / 垫底#1 / 销冠#8', fn: () => withClock(() => {
        const M = E.m21Normalize(NUKE10);
        const rid = x => M.rows.find(r => r.id === x);
        const pass = fmt.pct(M.imbalanceRate) === '70.0%' && rid('J').normRank === 1 && rid('A').normRank === 8 && rid('A').origRank === 1 && rid('J').origRank === 10;
        return { pass, got: [fmt.pct(M.imbalanceRate), rid('J').normRank, rid('A').normRank], want: ['70.0%', 1, 8] };
      }),
    },
    {
      id: 'SZ-T4', name: '闸⑤ leakRate 7.2%红 / pushShare 58%红', fn: () => withClock(() => {
        const g = E.gateDiscountLeak([{ listPriceAmt: 58e6, discountAmt: 4176000, reason: 'period_end_push' }, { listPriceAmt: 42e6, discountAmt: 3024000, reason: 'competitive_pressure' }]);
        return { pass: fmt.pct(g.leakRate) === '7.2%' && g.leakRed && fmt.pct(g.pushShare) === '58.0%' && g.pushRed, got: [fmt.pct(g.leakRate), fmt.pct(g.pushShare)], want: ['7.2%', '58.0%'] };
      }),
    },
    {
      id: 'SZ-T5', name: 'M34 diff 5.6pp / 年化 33.6 万 / 红', fn: () => withClock(() => {
        const m = E.m34ArbitrageFromRates(.087, .031, 600e6, null, 2.6);
        return { pass: approx(+(m.diff * 100).toFixed(1), 5.6) && m.annualLeakAmt === Math.max(0, m.diff) * 600e6 && fmt.wan(m.annualLeakAmt) === '33.6万' && m.red, got: [+(m.diff * 100).toFixed(1), fmt.wan(m.annualLeakAmt)], want: [5.6, '33.6万'] };
      }),
    },
    {
      id: 'SZ-T6', name: 'M35 jump=9 ≥ ceil(10×0.30)=3 → 误杀', fn: () => withClock(() => {
        const m = E.m35Misfire(10, 1, 10);
        return { pass: m.jump === 9 && m.threshold === 3 && m.misfire === true, got: [m.jump, m.threshold, m.misfire], want: [9, 3, true] };
      }),
    },
    {
      id: 'SZ-T7', name: 'realP90Factor=1.44；样本<8→null', fn: () => withClock(() => {
        const got = +((E.realP90Factor([5, 6, 7, 8, 9, 10, 11, 12, 14, 18]) || 0).toFixed(2));
        return { pass: got === 1.44 && E.realP90Factor([5, 6, 7]) === null, got, want: 1.44 };
      }),
    },
    {
      id: 'SZ-T8', name: '红包 rule①② + 止血 starved拦截/invisible_work', fn: () => withClock(() => {
        const hb = E.hongbaoCheck({ amount: 20000, dailyAvgCommission: 30000, timing: 'immediate', hasCondition: false, rolling12ImmediateUncondCount: 3 });
        const sa = E.stopBleedTriage({ zeroEventDays: 30, isActivePaid: true, leadIndex: 0.3, uer: null });
        const sb = E.stopBleedTriage({ zeroEventDays: 30, isActivePaid: true, leadIndex: 1, uer: 5e5 });
        return { pass: hb.rule1 && hb.rule2 && sa.block && sa.verdict === 'starved' && !sb.block && sb.verdict === 'invisible_work', got: [hb, sa.verdict, sb.verdict], want: ['rule1&2', 'starved', 'invisible_work'] };
      }),
    },
    {
      id: 'SZ-T9', name: '闸⑪ 三分支 + 3.3b 三分支', fn: () => withClock(() => {
        const v1 = E.hijackVerdict({ ahc: 41, m28Coverage: 0, irrevocable: false });
        const v2 = E.hijackVerdict({ ahc: 85, m28Coverage: .4, irrevocable: true });
        const v3 = E.hijackVerdict({ ahc: null, m28Coverage: null, irrevocable: false });
        const a1 = E.personAttribution({ discountLeakRate: .11, teamDiscountLeakRate: .05, complaintRate: .03, teamComplaintRate: .03, leadIndex: 1.8 }).verdict;
        const a2 = E.personAttribution({ discountLeakRate: .04, teamDiscountLeakRate: .05, complaintRate: .02, teamComplaintRate: .03, leadIndex: .3 }).verdict;
        const a3 = E.personAttribution({ discountLeakRate: .05, teamDiscountLeakRate: .05, complaintRate: .03, teamComplaintRate: .03, leadIndex: 1 }).verdict;
        const pass = v1.verdict === 'pointed_hoarding' && v1.bad === 3 && v2.verdict === 'not_supported' && v3.verdict === 'insufficient' && v3.missingList.indexOf('AHC') >= 0
          && a1 === 'leak' && a2 === 'territory' && a3 === 'undetermined';
        return { pass, got: [v1.verdict, v2.verdict, v3.verdict, a1, a2, a3], want: ['pointed_hoarding', 'not_supported', 'insufficient', 'leak', 'territory', 'undetermined'] };
      }),
    },
  );
})();
