/* ============================================================
   招人器（zhaoren）— 该招几人 / 何时招 / 怎么面不招错
   原版《销冠招人器 v3.2》引擎逐字复刻（capacityChain 七步链 / 十二道闸 /
   黑暗三角 / 效度回验 / RPI / EPS / QCS / 价签内推奖 / 三态查重）。
   一体化差异：
   - 输入直接绑定 DB.company 共享字段（与定价器同源，改一处两板块同变）；
     salesCount / managerCount 由员工档案实时派生（不再手填）。
   - 闸⑫认知鸿沟 / 闸⑪练习量 / QCS 渠道表 / vintage 批次全部实时取数
     （coachingAcks、practiceLogs 与育人器同一张表；candidates→people 转正打通）。
   - 系数一律 SK.getCoef 实时生效（原版 coefOverride 未接线的 bug 不复刻）。
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { fmt, esc, DASH, safeDiv } = SK;
  const W = SK.WAN, YUAN = SK.YUAN;
  const gc = p => SK.getCoef(p);

  /* ================= 引擎（纯函数 · 与原版 ENGINE:BEGIN..END 段逐字同源） ================= */

  /* 共享输入组装：company 共享字段 + 员工档案派生人数 */
  function liveInputs(db) {
    const c = db.company;
    return {
      targetYearGrossAmt: (c.targetYearGrossWan || 0) * W,
      perCapitaActualAmt: (c.lastYearPerCapitaWan || 0) * W,
      salesCount: db.people.filter(p => p.isActive && p.positionType === 'sales').length,
      cycleTier: c.cycleTier,
      attritionRate: c.attritionRate,
      hiringCycleDays: c.hiringCycleDays,
      fullLoadCostAmt: (c.fullLoadWan || 0) * W,
      managerCount: db.people.filter(p => p.isActive && p.positionType === 'manager').length,
    };
  }
  function targetYearOf(db, T) { return Number(T.slice(0, 4)) + (db.company.targetYearMode === 'next' ? 1 : 0); }

  /* 七步产能链（inputs + targetYear + today 显式传参，便于对拍） */
  function capacityChain(inp, targetYear, today) {
    const Z1 = inp.targetYearGrossAmt, Z2 = inp.perCapitaActualAmt, Z3 = inp.salesCount;
    const Z4 = inp.cycleTier, Z5 = inp.attritionRate, Z6 = inp.hiringCycleDays;
    const Z7 = inp.fullLoadCostAmt, Z8 = inp.managerCount;
    const midFac = gc('shared.midYearAttritionFactor');
    const naiveHires = Math.ceil(safeDiv(Z1, Z2)) - Z3;
    const k = m => SK.newHireYearRate(Z4, m);
    const kEff = m => { const kv = k(m); return kv == null ? null : kv * (1 - Z5 * midFac); };
    const fullEquiv = safeDiv(Z1, Z2);
    const k1 = k(1), kEff1 = kEff(1);
    const expLoss = Z3 * Z5;
    const residualLostAmt = expLoss * Z2 * gc('shared.pipelineDecayResidual');
    const gapEquiv = fullEquiv - Z3 + expLoss;
    const trueHires = Math.ceil(safeDiv(gapEquiv, kEff1));
    const fullRampCoef = safeDiv(Z3 + trueHires * kEff1, Z3 + trueHires);
    const band = gc('zhaoren.fullRampBand');
    const fullRampFlag = (fullRampCoef == null) ? 'grey' : (fullRampCoef > band[1] || fullRampCoef < band[0]) ? 'yellow' : 'green';
    let latestJoinMonth = 1;
    for (let m = 1; m <= 12; m++) { const ke = kEff(m); if (ke != null && ke * trueHires >= gapEquiv) latestJoinMonth = m; }
    const joinFirst = SK.ymd(targetYear, latestJoinMonth, 1);
    const latestStart = SK.addDays(joinFirst, -Z6);
    const lateDays = SK.daysBetween(latestStart, today);
    const isLate = lateDays > 0;
    const overRate = safeDiv(trueHires - naiveHires, trueHires);
    const marginProfit = Z2 * kEff1, marginCost = Z7 + gc('shared.hiringCostDefaultAmt');
    const underStaffed = marginProfit > marginCost, netGain = marginProfit - marginCost;
    const sp = gc('shared.spanDefault'), targetHeads = Z3 + trueHires;
    const avail = sp.weeklyHrs * sp.manageTimeShare - gc('shared.fixedMeetingHrs');
    const span = Math.floor(safeDiv(avail, gc('shared.perHeadMgmtHrs')));
    const managerNeeded = Math.ceil(safeDiv(targetHeads, span));
    const mgrGap = Math.max(0, managerNeeded - Z8);
    const pureCoachMin = Math.round(safeDiv(Math.max(0, avail - targetHeads * gc('shared.perHeadAdminHrs')), targetHeads) * 60);
    const perCapMonthAmt = safeDiv(Z2, 12);
    const perCapMonthWan1 = Math.round(perCapMonthAmt / W * 10) / 10;
    const roiWan = Math.round(trueHires * 3 * perCapMonthWan1 * 10) / 10;
    const roiAmt = roiWan * W;
    return { naiveHires, trueHires, fullEquiv, k1, kEff1, kEff2: kEff(2), expLoss, residualLostAmt,
      gapEquiv, fullRampCoef, fullRampFlag, latestJoinMonth, latestStart, lateDays, isLate, overRate,
      marginProfit, marginCost, underStaffed, netGain, targetHeads, avail, span, managerNeeded, mgrGap,
      pureCoachMin, roiAmt, roiWan, perCapMonthAmt, threeYearHeads: Math.round((Z3 + trueHires) * gc('shared.threeYearScaleFactor')) };
  }

  /* 六道即时闸（G1–G6）；⑪⑫在批次屏实时判定 */
  function gateVerdicts(r, crit) {
    crit = crit || {}; const gates = [];
    const push = (id, name, light, active, judge) => gates.push({ id, name, light, active, judge });
    push('G1', '产能高估', 'red', r.overRate != null && r.overRate > gc('zhaoren.overestimateRedline'), `高估率 ${fmt.pct(r.overRate)} ＞ 20%`);
    push('G2', '爬坡窗口', 'red', r.isLate, `最晚开招 ${r.latestStart}，已晚 ${r.lateDays} 天`);
    push('G3', '欠配', 'red', r.underStaffed, `边际利润 ${fmt.wan(r.marginProfit)} ＞ 边际成本 ${fmt.wan(r.marginCost)}`);
    const expTrap = (crit.minExperienceYears > 0) || (crit.ageRange != null) || ((crit.weights && crit.weights.experience) > 0);
    push('G4', '经验陷阱', 'red', !!expTrap, '设了经验/年龄门槛 (r=−.06)');
    const charismaHi = crit.weights && crit.weights.charisma > 30;
    push('G5', '黑暗三角', 'red', !!charismaHi, '魅力权重 ＞ 30% (筛选机)');
    const achLow = crit.weights && crit.weights.achievement < 25;
    push('G6', '非结构化', 'yellow', !!achLow, '成就动机权重 ＜ 25% (r=.41)');
    return gates;
  }
  const gateNo = id => ({ G1: '①', G2: '②', G3: '③', G4: '④', G5: '⑤', G6: '⑥' }[id] || '');
  const GATE_INFO = {
    G1: { phen: '系统跑“人头×配额”得到的招人数，比七步链少一大截。', mech: '人头×配额假装每个新人立刻满产、且没人流失——两个假设都错，于是系统性低估缺口。', src: ['Bridge Group：人头×配额高估产能 30–55%'], action: '以七步链人数为准做预算与编制。' },
    G2: { phen: '最晚开招日已经过去。', mech: '新人要走完爬坡曲线才满产；开招越晚，今年可捕获的爬坡月越少（头部和口径）。', src: ['rampCurve12 · newHireYearRate 头部和(C-04)'], action: '立即开招，或下调今年目标至数学可行区间。' },
    G3: { phen: '再多招一个人，边际利润仍高于边际成本。', mech: '只算边际、不问计划：只要边际利润>边际成本，不招=把产能让给对手。', src: ['Zoltners/ZS：加人加到边际利润=边际成本为止'], action: '继续加人直到边际打平；缺的产能是让出去的市场。' },
    G4: { phen: '招聘标准里设了经验年限 / 年龄门槛 / 经验权重>0。', mech: '经验与客观销售业绩相关 r=−.06——你在用一个负相关指标筛人。', src: ['Vinchur 1998：经验 r=−.06'], action: '把经验权重降为 0；用工作样本与成就动机替代。' },
    G5: { phen: '魅力/气场权重 > 30%。', mech: '魅力是黑暗三角的伪装色；高魅力筛选机专门筛进短期冲高、第 13–15 月崩塌的人。', src: ['Satornino 2023 JM：魅力伪装/从神坛跌落'], action: '魅力权重压到 ≤10%（系统硬顶）。' },
    G6: { phen: '成就动机权重 < 25%。', mech: '成就动机 r=.41 是全表最强预测因子，权重过低=丢掉最有效的信号。', src: ['Vinchur 1998：成就动机 r=.41'], action: '成就动机权重提到 ≥25%（出厂 35%）。' },
  };

  function validateWeights(w) { const sum = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0); return { sum, ok: sum === 100 }; }
  function darkTriadScore(o) {
    const v = 30 * (o.externalAttrib / 100) + 30 * (o.detailMissing / 100) + 25 * ((o.charisma - o.detail) / 100) + 15 * (o.selfMention / 100);
    return Math.max(0, Math.min(100, v));
  }
  function validityR(people, dim) {
    const rows = people.filter(p => p.margin12 != null && p.scores[dim] != null);
    if (rows.length < gc('zhaoren.validityMinSample')) return { r: null, n: rows.length };
    return { r: SK.pearson(rows.map(p => p.scores[dim]), rows.map(p => p.margin12)), n: rows.length };
  }
  function collapseStats(people) {
    const rule = gc('zhaoren.collapseRule'); const highs = people.filter(p => p.peakScore > rule.scoreGt);
    if (highs.length === 0) return { rate: null, medianMonth: null, n: 0, lowSample: true };
    const collapsed = highs.filter(p => p.collapseMonth != null && p.collapseMonth >= rule.monthIn[0] && p.collapseMonth <= rule.monthIn[1] && p.momDrop != null && p.momDrop < rule.dropLt);
    return { rate: safeDiv(collapsed.length, highs.length), medianMonth: SK.median(collapsed.map(p => p.collapseMonth)), n: highs.length, collapsedN: collapsed.length, lowSample: highs.length < rule.minSample };
  }
  function rpiValue(floatShare, survivalLine, B) { const ratio = safeDiv(survivalLine, B); return ratio == null ? null : floatShare * Math.min(ratio, 1); }
  function rpiPredict(rpi) { if (rpi == null) return null; if (rpi >= gc('zhaoren.rpiRedline')) return 'gambler'; if (rpi < gc('zhaoren.rpiGreen')) return 'achievement'; return 'neutral'; }
  function verifyRPI(rpi, dark, ach) {
    const pred = rpiPredict(rpi);
    if (pred === 'gambler' && dark.median > dark.teamMean && ach.median < ach.teamMean) return 'verified';
    if (pred === 'achievement') return 'achievement'; return 'unverified';
  }
  function overrideScorecard(againstNet, complyNet, overrideCount, decisionCount) {
    const minEach = gc('zhaoren.epsMinSampleEach');
    const eps = (againstNet.length >= minEach && complyNet.length >= minEach) ? SK.mean(againstNet) - SK.mean(complyNet) : null;
    const overrideRate = safeDiv(overrideCount, decisionCount);
    return { eps, overrideRate, warn: overrideRate != null && overrideRate > gc('zhaoren.overrideQuotaDefault') };
  }
  function systemRecommend(totalScore) { return totalScore >= gc('zhaoren.systemRecommendThreshold') ? 'hire' : 'reject'; }
  function priceTag(inp) {
    const Z2 = inp.perCapitaActualAmt, Z4 = inp.cycleTier, Z6 = inp.hiringCycleDays;
    const curve = SK.RAMP[Z4], perMonth = Z2 / 12, vacancy = perMonth * (Z6 / 30);
    let rampLoss = 0; for (let m = 1; m <= 12; m++) rampLoss += (1 - curve[m - 1] / 100); rampLoss = perMonth * rampLoss;
    const hiring = gc('shared.hiringCostDefaultAmt');
    return { tagAmt: vacancy + rampLoss + hiring, vacancyAmt: vacancy, rampLossAmt: rampLoss, hiringAmt: hiring };
  }
  function referralBonus(tagAmt) { return Math.max(1000, SK.round100((tagAmt / YUAN) * gc('zhaoren.referralBonusRate'))); }
  function qcs(channel, allChannels) {
    const w = gc('zhaoren.qcsWeights'); const maxNet = Math.max(...allChannels.map(c => c.netMean));
    const norm = safeDiv(channel.netMean, maxNet); if (norm == null) return null;
    return 100 * (w[0] * channel.retain12 + w[1] * channel.survive90 + w[2] * norm);
  }
  function maskName(name) { if (!name) return '*'; if (name.length <= 1) return name + '*'; return name[0] + '*'.repeat(name.length - 1); }
  function dedupPhone(phone, ctx) {
    const inCand = (ctx.candidates || []).find(c => c.phone === phone);
    if (inCand) return { verdict: 'block', reason: 'candidate', tip: `候选人库已存在：${maskName(inCand.name)} / ${SK.maskPhone(phone)}` };
    const active = (ctx.employees || []).find(e => e.phone === phone && e.isActive);
    if (active) return { verdict: 'block', reason: 'active', tip: `与在职员工重复` };
    const left = (ctx.employees || []).find(e => e.phone === phone && !e.isActive);
    if (left) return { verdict: 'pass', reason: 'left', tip: `曾于 ${(left.leaveDate || '').slice(0, 7)} 在职，原因 ${left.leaveReason || '—'}`, warn: true };
    return { verdict: 'pass', reason: 'new' };
  }
  function cognitiveGap(reported, confirmed) { const ratio = safeDiv(confirmed, reported); return ratio == null ? null : 1 - ratio; }
  function autoConfirm(daysSinceReport) { return daysSinceReport > gc('zhaoren.ackAutoConfirmDays'); }
  function practiceGate(count14d) { const floor = gc('zhaoren.practiceMinCount14d'); const red = count14d < floor; return { red, floor, count: count14d, shiftMonths: red ? gc('zhaoren.practiceCurveShiftMonths') : 0 }; }

  /* ================= 内置模拟集（效度实验室 · 数值与原版对拍同源） ================= */
  const SIM = {
    f11_y: [82, 41, 63, 90, 28, 55, 74, 47, 60, 35, 69, 51],
    f11_ach: [50, 44, 48, 68, 40, 59, 50, 64, 61, 50, 50, 65],
    f11_cha: [48, 62, 50, 60, 49, 43, 44, 42, 68, 67, 55, 48],
    f11_exp: [40, 51, 66, 45, 48, 47, 59, 73, 66, 43, 57, 74],
    f12: [{ peakScore: 82, collapseMonth: 11, momDrop: -0.55 }, { peakScore: 78, collapseMonth: 12, momDrop: -0.48 },
      { peakScore: 90, collapseMonth: 13, momDrop: -0.62 }, { peakScore: 74, collapseMonth: 14, momDrop: -0.44 },
      { peakScore: 76, collapseMonth: null, momDrop: -0.10 }, { peakScore: 81, collapseMonth: null, momDrop: 0.05 }],
    f14_against: [18 * W, 21 * W, 24 * W], f14_comply: [34 * W, 36 * W, 38 * W, 40 * W], f14_over: 9, f14_dec: 40,
    f14_s2: 0.44, f14_s1: 0.78,
    channels: [{ name: '内推 referral', key: 'referral', retain12: 0.81, survive90: 0.85, netMean: 43 * W },
      { name: 'Boss直聘', key: 'boss_zhipin', retain12: 0.52, survive90: 0.61, netMean: 31 * W }],
  };
  function f11people() { return SIM.f11_y.map((y, i) => ({ margin12: y, scores: { achievement: SIM.f11_ach[i], charisma: SIM.f11_cha[i], experience: SIM.f11_exp[i] } })); }

  /* ================= 实时聚合（与育人器/算账器同源取数） ================= */

  /* 闸⑫：认知鸿沟 = 1 − confirmed 时长合计 / reportedHrs 合计（no_response > 7 天自动 confirmed） */
  function ackAgg(db, T) {
    let reported = 0, confirmed = 0, n = 0;
    for (const a of (db.coachingAcks || [])) {
      n++;
      reported += a.reportedHrs || 0;
      const auto = a.status === 'no_response' && autoConfirm(SK.diffDays(a.date, T));
      if (a.status === 'confirmed' || auto) confirmed += a.durationHrs || 0;
    }
    return { reported: Math.round(reported * 10) / 10, confirmed: Math.round(confirmed * 10) / 10, n, gap: cognitiveGap(reported, confirmed) };
  }

  /* t 日存活率：入职满 t 天者中，第 t 天仍在职的比例（不满 t → null 显 “—”） */
  function rateAtDay(ps, day, T) {
    const elig = ps.filter(p => SK.diffDays(p.hireDate, T) > day);
    if (!elig.length) return { rate: null, n: 0 };
    const ok = elig.filter(p => p.isActive || (p.leaveDate && SK.diffDays(p.hireDate, p.leaveDate) > day));
    return { rate: ok.length / elig.length, n: elig.length };
  }

  const CH_CN = { referral: '内推', boss_zhipin: 'Boss直聘', liepin: '猎聘', reserve_pool: '蓄水池', manual: '其他' };

  /* QCS 渠道表：按 people.sourceChannel 分组实算；人均净贡献 ≈ 算账器 collected6m 均值 */
  function channelStats(db, T) {
    const sz = SK.X('suanzhang');
    const by = {};
    for (const p of db.people) {
      if (p.positionType !== 'sales') continue;
      const ch = p.sourceChannel || 'manual';
      (by[ch] = by[ch] || []).push(p);
    }
    const rows = Object.entries(by).map(([key, ps]) => {
      const s90 = rateAtDay(ps, 90, T), r12 = rateAtDay(ps, 360, T);
      const nets = ps.map(p => (sz && sz.perPerson && sz.perPerson[p.spId]) ? sz.perPerson[p.spId].collected6m : null).filter(v => v != null);
      return { key, name: CH_CN[key] || key, n: ps.length, low: ps.length < 3,
        survive90: s90.rate, retain12: r12.rate, n90: s90.n, n12: r12.n,
        netMean: nets.length ? SK.mean(nets) : null };
    }).sort((a, b) => b.n - a.n);
    const valid = rows.filter(r => !r.low && r.netMean != null && r.survive90 != null && r.retain12 != null);
    for (const r of rows) r.q = valid.includes(r) ? qcs(r, valid) : null;
    return rows;
  }

  /* vintage：按 hireBatchId 分组 */
  function vintageRows(db, T) {
    const by = {};
    for (const p of db.people) { if (!p.hireBatchId) continue; (by[p.hireBatchId] = by[p.hireBatchId] || []).push(p); }
    return Object.entries(by).map(([bid, ps]) => ({
      bid, n: ps.length, firstHire: ps.map(p => p.hireDate).sort()[0],
      s30: rateAtDay(ps, 30, T), s90: rateAtDay(ps, 90, T),
    })).sort((a, b) => a.firstHire < b.firstHire ? -1 : 1);
  }

  function critNow(db) { return { weights: db.weights, minExperienceYears: db.criteria.minExperienceYears, ageRange: db.criteria.ageRange }; }
  function chainNow(db, T) { return capacityChain(liveInputs(db), targetYearOf(db, T), T); }

  /* ================= 小组件 ================= */
  const stat = (k, v, s, extra = '', vStyle = '') =>
    `<div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px;min-width:0;${extra}">
      <div class="hint">${k}</div><div class="num" style="font-size:22px;font-weight:750;letter-spacing:-.01em;${vStyle}">${v}</div>${s ? `<div class="hint">${s}</div>` : ''}</div>`;
  const redStat = 'background:var(--red-soft);border-color:color-mix(in srgb,var(--red) 30%,transparent);';

  /* ================= 屏 1 · 七步输入 ================= */
  function vInput(db, T) {
    const c = db.company, r = chainNow(db, T), ty = targetYearOf(db, T);
    const sales = liveInputs(db).salesCount, mgrs = liveInputs(db).managerCount;
    const cycleOpts = [['short', '短周期 · 满产 9 月'], ['regular', '常规 · 12 月'], ['midLong', '中长 · 15 月'], ['long', '长 · 18 月'], ['ultraLong', '超长 · 24 月']].map(([v, t]) => ({ v, t }));
    return `
    <div class="sect"><h2>七步输入</h2><span class="sub">填 6 个数 + 2 个联动数 · 右侧实时出结果 · 与定价器共享同一份公司档案（改一处两板块同变）</span></div>
    <div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:start">
      <div class="card">
        <h3>共享输入 <span class="sub">🔴 系统不问你“打算招几个”——双算法自己跑</span></h3>
        <div class="frm">
          ${h.field(`规划年份（目标年 = ${ty}）`, h.seg('company.targetYearMode', [{ v: 'next', t: '明年' }, { v: 'this', t: '今年' }], c.targetYearMode))}
          ${h.field('① 目标年毛利（万元）', h.input('company.targetYearGrossWan', 'num', { value: c.targetYearGrossWan }))}
          ${h.field('② 人均年实际毛利（万元 · 去年真值）', h.input('company.lastYearPerCapitaWan', 'num', { value: c.lastYearPerCapitaWan }), '不是配额')}
          ${h.field(`③ 现有销售人数 ${h.linked()}`, `<input disabled value="${sales} 人">`, '员工档案实时统计，不再手填')}
          ${h.field('④ 成交周期档', h.select('company.cycleTier', cycleOpts, c.cycleTier), '短周期=快消/满产9月')}
          ${h.field('⑤ 年流失率 %', h.input('company.attritionRate', 'pct100', { value: Math.round(c.attritionRate * 1000) / 10, step: 1 }), '全球约 35%')}
          ${h.field('⑥ 招聘周期（天）', h.input('company.hiringCycleDays', 'int', { value: c.hiringCycleDays }), '发帖到到岗，参考 45 天')}
          ${h.field('⑦ 单人全负担年成本（万元）', h.input('company.fullLoadWan', 'num', { value: c.fullLoadWan }), '底薪+社保+提成全含')}
          ${h.field(`⑧ 现有销售主管人数 ${h.linked()}`, `<input disabled value="${mgrs} 人">`, '供主管编制测算')}
        </div>
        <div class="divider"></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${h.btn('维护员工档案 →', 'ui.nav', { cls: 'sm', data: 'data-board="data" data-sub="people"' })}
          <span class="hint">与定价器 / 算账器共用同一份公司档案与员工档案。</span>
        </div>
      </div>
      <div class="card" style="position:sticky;top:104px;background:var(--panel)">
        <h3>实时结果</h3>
        <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;text-align:center;margin-bottom:8px">
          <div style="background:var(--panel2);border-radius:9px;padding:12px 6px"><div class="hint">❌ 拍脑袋</div><div class="num" style="font-size:38px;font-weight:750;line-height:1.1">${r.naiveHires}</div></div>
          <div style="color:var(--ink3);font-weight:600">→</div>
          <div style="background:var(--accent-soft);border-radius:9px;padding:12px 6px"><div class="hint">✅ 该招</div><div class="num" style="font-size:38px;font-weight:750;line-height:1.1;color:var(--accent)">${r.trueHires}</div></div>
        </div>
        <div style="text-align:center;margin-bottom:8px">${h.badge('产能高估率 ' + fmt.pct(r.overRate), r.overRate != null && r.overRate > gc('zhaoren.overestimateRedline') ? 'r' : 'g')}</div>
        ${h.kv([
          { k: '最晚开招日', v: fmt.d(r.latestStart), cls: r.isLate ? 'red' : '' },
          { k: r.isLate ? '已晚' : '还剩', v: (r.isLate ? r.lateDays : -r.lateDays) + ' 天', cls: r.isLate ? 'red' : '' },
          { k: '目标编制', v: fmt.num(r.targetHeads) + ' 人' },
          { k: '需主管 / 缺', v: `${fmt.num(r.managerNeeded)} / ${fmt.num(r.mgrGap)}` },
          { k: '每多招一人净增', v: fmt.wan(r.netGain) },
        ])}
        ${h.btn('看完整结果与十二闸 →', 'ui.nav', { cls: 'pri', data: 'data-board="zhaoren" data-sub="result"' })}
      </div>
    </div>`;
  }

  /* ================= 屏 2 · 结果 · 十二闸 ================= */
  function vResult(db, T) {
    const r = chainNow(db, T), ty = targetYearOf(db, T);
    const gates = gateVerdicts(r, critNow(db));
    const i = liveInputs(db);
    const late = r.isLate;
    return `
    <div class="sect"><h2>结果 · 十二道闸</h2><span class="sub">双算法对比 → 时间轴 → 主管编制 → 逐闸展开 = 现象 → 机制 → 📎出处 → 建议</span></div>
    ${h.card('双算法对比 · 你的产能高估率', `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;text-align:center">
        <div style="background:var(--panel2);border-radius:10px;padding:16px 8px"><div class="hint">❌ 天真：人头 × 配额</div><div class="num" style="font-size:52px;font-weight:750;letter-spacing:-.03em;line-height:1.1">${r.naiveHires}</div><div class="hint">系统自己跑老板脑子里的账</div></div>
        <div style="color:var(--ink3);font-weight:600;font-size:15px">→</div>
        <div style="background:var(--accent-soft);border-radius:10px;padding:16px 8px"><div class="hint">✅ 七步链</div><div class="num" style="font-size:52px;font-weight:750;letter-spacing:-.03em;line-height:1.1;color:var(--accent)">${r.trueHires}</div><div class="hint">含爬坡 / 流失 / kEff 折算</div></div>
      </div>
      <div style="text-align:center;margin-top:8px">${h.badge('产能高估率 ' + fmt.pct(r.overRate), r.overRate != null && r.overRate > gc('zhaoren.overestimateRedline') ? 'r' : 'g')}</div>
      <p style="text-align:center;margin-top:8px;color:var(--ink2)">你以为再招 <b>${r.naiveHires}</b> 个，七步链算出要招 <b>${r.trueHires}</b> 个——高估率 <b>${fmt.pct(r.overRate)}</b>。
      预期流失 <b>${fmt.num(r.expLoss, 1)}</b> 人 · 管道残值损失 ≈ <b>${fmt.wan(r.residualLostAmt)}</b>（×${gc('shared.pipelineDecayResidual')}）</p>
      ${h.src('全球基准：人头×配额高估产能 30%–55%（Bridge Group）')}`)}

    ${h.card('时间轴 · 你还来得及吗', `
      <div class="grid g4">
        ${stat('最晚入职月', r.latestJoinMonth + ' 月', '目标年 ' + ty)}
        ${stat('招聘周期', i.hiringCycleDays + ' 天', '从开招到到岗')}
        ${stat('最晚开招日', fmt.d(r.latestStart), late ? '🔴 已晚 ' + r.lateDays + ' 天' : '✓ 还有 ' + (-r.lateDays) + ' 天', late ? redStat : '', late ? 'color:var(--red-hero)' : '')}
        ${stat('满产系数', fmt.pct(r.fullRampCoef), r.fullRampFlag === 'green' ? '✓ 健康带 55–75%' : r.fullRampFlag === 'yellow' ? '🟡 出健康带 55–75%' : DASH, '', r.fullRampFlag === 'yellow' ? 'color:var(--amber)' : '')}
      </div>
      ${late ? `<p style="color:var(--red);margin-top:10px;font-weight:600">按现有编制与爬坡曲线，${ty} 年的目标，数学上已不可能——晚一天开招，就少一天爬坡。</p>` : ''}`,
      late ? { cls: '', right: h.badge('🔴 已晚 ' + r.lateDays + ' 天', 'r') } : {}).replace('<div class="card ', late ? '<div style="border-color:color-mix(in srgb,var(--red) 34%,var(--line))" class="card ' : '<div class="card ')}

    ${h.card(`你要招的不是 ${r.trueHires} 个销售，是 ${r.trueHires} 个销售 + ${r.mgrGap} 个主管`, `
      <div class="grid g3">
        ${stat('目标编制', fmt.num(r.targetHeads) + ' 人', `现有 ${i.salesCount} + 新招 ${r.trueHires}`)}
        ${stat('需主管 / 缺', `${fmt.num(r.managerNeeded)} / ${fmt.num(r.mgrGap)}`, `跨度 span=${fmt.num(r.span)}（每主管带）· 可用 ${fmt.num(r.avail, 1)}h/周`)}
        ${stat('每人每周纯辅导', fmt.num(r.pureCoachMin) + ' 分钟', '有效地板 = 30 分钟', r.pureCoachMin < 30 ? 'background:var(--amber-soft);border-color:color-mix(in srgb,var(--amber) 26%,transparent);' : '', r.pureCoachMin < 30 ? 'color:var(--amber)' : '')}
      </div>
      <p class="hint" style="margin-top:8px">📎 Zoltners：三年最优规模比一年最优大 18% ≈ <b class="num">${fmt.num(r.threeYearHeads)}</b> 人 · 边际利润 <b>${fmt.wan(r.marginProfit)}</b> vs 边际成本 <b>${fmt.wan(r.marginCost)}</b>（含招聘成本 ${fmt.wan(gc('shared.hiringCostDefaultAmt'))}） → 每多招一人净增 <b>${fmt.wan(r.netGain)}</b></p>`)}

    ${h.card('十二道闸 · 已可判定的 6 闸', gates.map(g => gateRow(g)).join('') +
      h.hint('④–⑥ 由招聘包权重即时点灯；⑪ 练习量、⑫ 认知鸿沟在「批次入职」屏实时判定；其余闸随漏斗/批次数据点亮。'))}`;
  }
  function gateRow(g) {
    const tone = g.active ? (g.light === 'red' ? 'r' : 'a') : 'n';
    const info = GATE_INFO[g.id] || {};
    const body = `
      <div style="margin-top:7px"><b>现象</b>　${info.phen || g.judge}</div>
      <div style="margin-top:6px"><b>机制</b>　${info.mech || DASH}</div>
      ${(info.src || []).map(s => h.src(s)).join('')}
      ${g.active ? `<div class="action-card ${g.light === 'red' ? 'r' : 'a'}"><h4>建议</h4><div>${info.action || '复核该项配置'}</div>
        <div style="margin-top:7px;display:flex;gap:6px">${h.btn('采纳', 'zr.adopt', { cls: 'sm pri' })}${h.btn('忽略', 'zr.ignore', { cls: 'sm' })}${h.btn('稍后', 'zr.later', { cls: 'sm ghost' })}</div></div>` : ''}`;
    return h.acc(`${h.dot(tone)} 闸${gateNo(g.id)} ${g.name}　<span class="hint" style="font-weight:450">${g.active ? g.judge : '未触发'}</span>`, body, g.active && g.light === 'red');
  }

  /* ================= 屏 3 · 招聘包 ================= */
  function vHire(db) {
    const w = db.weights, v = validateWeights(w), caps = gc('zhaoren.weightCaps');
    const chaMax = Math.round((caps.charisma || 0) * 100), expMax = Math.round((caps.experience || 0) * 100);
    const dims = [
      ['achievement', '成就动机', 'r=.41 全表最强', 100],
      ['cognitive', '认知能力', 'GMA .51 支撑', 100],
      ['integrity', '正直诚信', '整合测验增益', 100],
      ['situational', '情境判断', '', 100],
      ['adaptive', '适应性', '跨场景最稳(可上调)', 100],
      ['charisma', '魅力气场', `🔴>30%触闸⑤ · 硬顶${chaMax}%`, chaMax],
      ['experience', '经验年限', `🔴>0触闸④ · 硬顶${expMax}`, expMax],
    ];
    const dt = darkTriadScore(db.dt);
    const dtDims = [['externalAttrib', '归因外部'], ['detailMissing', '细节缺失'], ['charisma', '魅力分'], ['detail', '细节分'], ['selfMention', '自我提及']];
    return `
    <div class="sect"><h2>招聘包</h2><span class="sub">题库权重 Σ=100 硬校验 · 黑暗三角行为编码 · 适应性双画像卡 · 荐才线 ≥${gc('zhaoren.systemRecommendThreshold')} → hire</span></div>
    <div class="grid g2">
      ${h.card('组件① 题库权重（Σ=100 硬校验 · 即时灯 闸④⑤⑥）', `
        ${dims.map(([k, t, hint, max]) => h.field(`${t} <span class="hint" style="font-weight:450">${hint}</span>`, h.range('weights.' + k, w[k] || 0, 0, max, 1))).join('')}
        <div class="kv total"><span class="k">合计</span><b>${h.badge(v.sum + '% ' + (v.ok ? '✓' : '必须=100'), v.ok ? 'g' : 'r')}</b></div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          ${w.charisma > 30 ? h.badge('🔴 闸⑤ 黑暗三角：魅力筛选机', 'r') : ''}
          ${w.experience > 0 ? h.badge('🔴 闸④ 经验陷阱', 'r') : ''}
          ${w.achievement < 25 ? h.badge('🟡 闸⑥ 非结构化：成就动机<25%', 'a') : ''}
          ${v.ok && w.charisma <= 30 && w.experience === 0 && w.achievement >= 25 ? h.badge('🟢 三闸皆过', 'g') : ''}
          ${h.btn('恢复出厂 35/25/20/15/5', 'zr.reset-weights', { cls: 'sm ghost' })}
        </div>
        <div class="divider"></div>
        ${h.field('经验年限门槛（年 · 🔴 >0 即触闸④）', h.input('criteria.minExperienceYears', 'int', { value: db.criteria.minExperienceYears, min: 0 }), '经验与业绩相关 r=−.06——建议保持 0')}
        ${h.hint(`系统荐才线：结构化总分 ≥ ${gc('zhaoren.systemRecommendThreshold')} → hire，否则 reject（systemRecommend · 推翻请记入 F14 例外权追踪）。`)}`)}
      ${h.card('组件③ 黑暗三角评分（行为编码，非人格测评）', `
        <p class="hint" style="margin-bottom:6px">= 30×归因外部 + 30×细节缺失 + 25×(魅力−细节) + 15×自我提及</p>
        <p style="color:var(--red);font-size:12px;margin-bottom:8px">🔴 招聘阶段限定 / 入职即销毁明细 / 不出人格报告 / 候选人知情异议权</p>
        ${dtDims.map(([k, t]) => h.field(t, h.range('dt.' + k, db.dt[k], 0, 100, 1))).join('')}
        <div class="kv total"><span class="k">黑暗三角分</span><b>${h.badge(dt.toFixed(1), dt > 60 ? 'r' : dt > 40 ? 'a' : 'g')}</b></div>
        ${h.hint('>60 红 · >40 黄。正向模式：低魅力 + 高细节 + 归因内部 + 能精确复述失败与改进。')}`)}
    </div>
    ${h.card('组件⑤ 适应性样本（可打印 · 只打一项：打法换没换）', `
      <div class="grid g2">
        ${stat('卡甲 · 价格敏感型个体老板', '💰', '只关心多少钱、能不能再便宜。')}
        ${stat('卡乙 · 流程导向型集团采购', '🏢', '只关心立项流程、合规与验收标准。')}
      </div>
      <p class="hint" style="margin-top:8px">候选人当场向两人卖同一产品各 5 分钟。完全切换=100 / 部分=50 / 一套话术打两人=0 → 计入 adaptive 维度。</p>
      ${h.src('Verbeke 2011：适应性是跨场景最稳绩效因子')}
      <div style="margin-top:8px">${h.btn('🖨 打印双画像卡', 'ui.print', { cls: 'sm', data: 'class="no-print"' })}</div>
      <div class="print-foot">销冠操盘系统 · 招人器 · ${esc(SK.DB.company.name)} · 本材料不含税务/法律实质建议</div>`)}`;
  }

  /* ================= 屏 4 · 漏斗水温 ================= */
  const POOLS = [['resume', '简历'], ['interview', '面试'], ['offer', 'Offer'], ['hired', '入职'], ['reserve', '蓄水池']];
  function vFunnel(db, T) {
    const byPool = p => db.candidates.filter(c => c.pool === p);
    const poolHtml = ([p, t]) => `
      <div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:9px 10px;min-height:130px">
        <div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:650;color:var(--ink3)"><span>${t}</span><b class="num">${byPool(p).length}</b></div>
        ${byPool(p).map(c => `
          <div style="background:var(--card);border:1px solid var(--line);border-radius:7px;padding:6px 8px;margin-top:7px;font-size:12px">
            <b>${esc(c.name)}</b> <span class="hint mono">${SK.maskPhone(c.phone)}</span>
            <div class="hint">${CH_CN[c.sourceChannel] || c.sourceChannel} · 期望 ${fmt.num(c.expectedWan, 1)}万/月 · 入池 ${SK.diffDays(c.poolEnteredDate, T)} 天</div>
            <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
              ${p === 'offer' ? h.btn('转正建档 →', 'zr.hire-open', { cls: 'sm pri', data: `data-id="${c.candId}"` }) : ''}
              ${p === 'resume' || p === 'interview' ? h.btn('前进 ▸', 'zr.cand-next', { cls: 'sm', data: `data-id="${c.candId}"` }) : ''}
              ${p === 'reserve' ? h.btn('激活 ▸ 简历', 'zr.cand-next', { cls: 'sm', data: `data-id="${c.candId}"` }) : ''}
              ${p !== 'hired' ? h.btn('流失', 'zr.cand-lose', { cls: 'sm danger', data: `data-id="${c.candId}"` }) : h.badge('已入职建档', 'g')}
            </div>
          </div>`).join('') || '<div class="hint" style="margin-top:10px">—</div>'}
      </div>`;
    const lights = [['Offer 接受率', '65%', 'green'], ['爽约率', '12%', 'green'], ['周期恶化', '+8%', 'green'], ['挖角占比', '0%', 'green']];
    const chs = channelStats(db, T);
    const sz = SK.X('suanzhang');
    const tag = priceTag(liveInputs(db)), bonus = referralBonus(tag.tagAmt);
    return `
    <div class="sect"><h2>漏斗水温</h2><span class="sub">五池只前进一格或流失 · 手机号三态查重 · hired 转正直接写入员工档案（跨板块打通）</span></div>
    ${h.card('招聘漏斗五池', `
      <div class="grid" style="grid-template-columns:repeat(5,1fr)">${POOLS.map(poolHtml).join('')}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
        ${h.btn('＋ 新增候选人', 'zr.cand-add', { cls: 'pri sm' })}
        <span class="hint">录入即对 DB.people 实时查重：候选人重复/在职重复 → 🔴 拦截；曾离职 → 🟡 放行并提示离职原因。转正建档后由算账器/育人器按 spId 继续跟踪。</span>
      </div>`)}
    ${h.card('F7 薪酬水温 · 四灯 <span class="sub">示例值 · 滚动窗 · 阈值可调（zhaoren.tempLightThresholds）· 样本<3 灰</span>', `
      <div class="grid g4">${lights.map(([t, v, c]) => stat(t, v, '', '', `color:var(--${c === 'green' ? 'green' : c})`)).join('')}</div>`)}
    ${h.card('F15 渠道质量归因 QCS（实时 · 按 people.sourceChannel 分组）', `
      ${h.tbl([{ t: '渠道' }, { t: '样本', num: 1 }, { t: '存活90', num: 1 }, { t: '留存12', num: 1 }, { t: '人均净贡献(6月回款)', num: 1 }, { t: 'QCS', num: 1 }],
        chs.map(c => `<tr ${c.low ? 'style="opacity:.55"' : ''}>
          <td>${esc(c.name)}${c.low ? ' ' + h.badge('样本<3', 'n') : ''}</td>
          <td class="num">${c.n}</td>
          <td class="num">${fmt.pct(c.survive90, 0)}</td>
          <td class="num">${fmt.pct(c.retain12, 0)}</td>
          <td class="num">${fmt.wan(c.netMean)}</td>
          <td class="num"><b>${c.q == null ? DASH : Math.round(c.q)}</b></td></tr>`),
        { empty: '暂无员工渠道数据——转正建档后自动出现' })}
      ${h.hint('QCS = 100×(0.4×留存12 + 0.3×存活90 + 0.3×归一净贡献)。净贡献取算账器 perPerson.collected6m 均值近似' + (sz ? '（算账器实时联动中）' : '——算账器暂无数据时显 “—”') + '；样本<3 的渠道置灰不评分。')}
      ${h.action('内推奖定价（价签 ×1%）', `按你的流失价签 <b>${fmt.wan(tag.tagAmt, 2)}</b>（空缺 ${fmt.wan(tag.vacancyAmt)} + 爬坡损失 ${fmt.wan(tag.rampLossAmt)} + 招聘成本 ${fmt.wan(tag.hiringAmt)}）×1%，内推奖建议给到 <b>¥${bonus.toLocaleString('zh-CN')}</b> 依然血赚。` + h.src('Burks 2015 QJE：内推离职率低 10–30%'), 'gold',
        h.btn('生成内推奖行动卡', 'ui.toast-ac', { cls: 'sm' }))}`)}`;
  }

  /* ================= 屏 5 · 批次入职 ================= */
  function vBatch(db, T) {
    const rows = vintageRows(db, T);
    const r = chainNow(db, T);
    const floor = gc('zhaoren.practiceMinCount14d');
    const logs = db.practiceLogs || [];
    const agg = ackAgg(db, T);
    const gapRed = agg.gap != null && agg.gap > gc('zhaoren.cognitiveGapRedline');
    return `
    <div class="sect"><h2>批次入职</h2><span class="sub">vintage 存活实算（people 在职状态） · 闸⑪练习量 / 闸⑫认知鸿沟实时（与育人器同一张表）</span></div>
    ${h.card('F6 批次 vintage（存活 / 爬坡 / 回本 · 不满 t 显“—”）', `
      ${h.tbl([{ t: '批次' }, { t: '人数', num: 1 }, { t: '首入职', num: 1 }, { t: 'S(30)', num: 1 }, { t: 'S(90)', num: 1 }, { t: '爬坡完成', num: 1 }],
        rows.map(v => `<tr><td><b>${esc(v.bid)}</b></td><td class="num">${v.n}</td><td class="num">${v.firstHire}</td>
          <td class="num">${fmt.pct(v.s30.rate, 0)}</td><td class="num">${fmt.pct(v.s90.rate, 0)}</td><td class="num">${DASH}</td></tr>`),
        { empty: '暂无 hireBatchId——转正建档时填批次号即可入表' })}
      <p style="color:var(--red);font-size:12px;margin-top:8px">🔴 爬坡完成日 = 连续 3 月月度毛利 ≥ 人均配额×80%，严禁用“第一单”判定。某周期档 ≥5 批次完整爬坡 → 自动替换出厂曲线。</p>`)}
    ${h.card(`闸⑪ 练习量（前 14 天 < ${floor} → S 曲线右移 · 🔴 永不阻止打电话）`, `
      ${h.tbl([{ t: '新人' }, { t: '前14天练习', num: 1 }, { t: '判定' }, { t: 'S 曲线右移', num: 1 }],
        logs.map(l => {
          const p = SK.personById(l.spId), pg = practiceGate(l.count14);
          return `<tr><td>${p ? esc(p.name) : l.spId}</td><td class="num" ${pg.red ? 'style="color:var(--red-hero);font-weight:700"' : ''}>${l.count14} / ${pg.floor}</td>
            <td>${pg.red ? h.badge('🔴 不达标', 'r') : h.badge('达标', 'g')}</td><td class="num">${pg.shiftMonths ? pg.shiftMonths + ' 个月' : DASH}</td></tr>`;
        }), { empty: '暂无练习记录（practiceLogs 与育人器同源）' })}
      <div class="grid g3" style="margin-top:8px">
        ${stat('不达标人数', logs.filter(l => practiceGate(l.count14).red).length + ' 人', '爬坡预测顺延 ' + gc('zhaoren.practiceCurveShiftMonths') + ' 个月')}
        ${stat('ROI（入职压缩）', fmt.num(r.roiWan, 1) + '万', `${r.trueHires}×3×${r.perCapMonthAmt == null ? DASH : (r.perCapMonthAmt / W).toFixed(1)}万`)}
        ${stat('该招 · 七步链', fmt.num(r.trueHires) + ' 人', '练习量只影响爬坡预测，不减编制')}
      </div>
      <p style="font-size:12.5px;color:var(--ink2);margin-top:8px">📎 前两周 50–100 次模拟通话可把爬坡缩短 37%；系统只提示，不锁电话——让他现在上线，是在浪费你的线索。</p>`)}
    ${h.card('闸⑫ 认知鸿沟（实时 · 分子只取 confirmed · no_response > ' + gc('zhaoren.ackAutoConfirmDays') + ' 天自动 confirmed）', `
      <div class="grid g3">
        ${stat('主管上报辅导', fmt.num(agg.reported, 1) + ' 小时', '回执 ' + agg.n + ' 条 · reportedHrs 合计')}
        ${stat('销售确认', fmt.num(agg.confirmed, 1) + ' 小时', 'confirmed 时长合计（与育人器同源）')}
        ${stat('鸿沟指数', fmt.pct(agg.gap), gapRed ? '🔴 > 30%' : '健康线 ≤30%', gapRed ? redStat : '', gapRed ? 'color:var(--red-hero)' : '')}
      </div>
      <p style="font-size:12.5px;color:var(--ink2);margin-top:8px">📎 全球：90% 领导认为自己辅导了，只有 62% 销售确认收到（鸿沟≈31%）。✅ 建议：把辅导写成指向任务的具体处方（Kluger & DeNisi 1996）——去育人器开处方。</p>
      ${gapRed ? h.action('认知鸿沟红灯', '主管的“我辅导了”与销售的“我被辅导了”严重不符。建议本周抽 3 条回执当面对质，并改用书面处方。', 'r', h.btn('去育人器 →', 'ui.nav', { cls: 'sm', data: 'data-board="yuren"' })) : ''}`)}`;
  }

  /* ================= 屏 6 · 效度实验室 ================= */
  function vLab(db, T) {
    const sz = SK.X('suanzhang'), dj = SK.X('dingjia');
    const m12n = sz && sz.perPerson ? Object.values(sz.perPerson).filter(p => p.margin12 != null).length : 0;
    const P = f11people();
    const rAch = validityR(P, 'achievement'), rCha = validityR(P, 'charisma'), rExp = validityR(P, 'experience');
    const cs = collapseStats(SIM.f12);
    const sc = overrideScorecard(SIM.f14_against, SIM.f14_comply, SIM.f14_over, SIM.f14_dec);
    const rline = (lab, rr, note) => `<tr><td>${lab}</td><td class="num"><b style="color:var(--${rr.r == null ? 'ink3' : rr.r > 0.2 ? 'green' : rr.r < -0.05 ? 'red' : 'amber'})">${rr.r == null ? DASH : (rr.r > 0 ? '+' : '') + rr.r.toFixed(2)}</b></td><td class="hint">${note}</td></tr>`;
    // F13 实时：定价器方案 + 城市生存线
    const survivalLine = gc('shared.minWageTable.' + db.company.cityTier);
    const rpi = (dj && dj.floatShare != null && dj.matrixB != null) ? rpiValue(dj.floatShare, survivalLine, dj.matrixB) : null;
    const pred = rpiPredict(rpi);
    const dark = { median: 68, teamMean: 42 }, ach = { median: 31, teamMean: 55 };   // 演示观测量
    const verdict = rpi == null ? null : verifyRPI(rpi, dark, ach);
    return `
    <div class="sect"><h2>效度实验室</h2><span class="sub">全球第一个 12 个月后回头验证“自己面试评分准不准”的招聘系统</span></div>
    ${h.card('F11 预测效度追踪器', `
      ${h.banner(`🧪 演示模拟集（12 人）：正式回验需「入职员工的面试评分包 + 算账器 12 个月归一化毛利 margin12」。当前算账器可用 margin12 样本 ${m12n} 人、面试评分历史 0 份——数据满 ${gc('zhaoren.validityMinSample')} 人后自动切换真数据，正式数据待 12 个月回验。`, 'b')}
      ${h.tbl([{ t: '面试维度' }, { t: 'r（vs 12月归一化毛利）', num: 1 }, { t: '结论' }],
        [rline('成就动机', rAch, '✅ 你复现了全球 .41——题库有效'),
         rline('魅力/气场', rCha, '🔴 与业绩负相关——你在用负相关指标筛人'),
         rline('经验年限', rExp, '🔴 r≈−.06 同向——经验陷阱')])}
      ${h.hint(`🔴 三条封顶不可绕过：样本<${gc('zhaoren.calibrateMinSample')} 禁校准 · 经验永 0% · 魅力永 ≤10%。样本<${gc('zhaoren.validityMinSample')} → 整屏“—（需算账器归一化数据）”。`)}
      ${h.src('Satornino 2023 JM')}`)}
    ${h.card('F12 黑暗三角崩塌追踪（SIM · 分>70 ∧ 月∈[10,18] ∧ 近3月环比<−40%）', `
      <div class="grid g3">
        ${stat('高分者', cs.n + ' 人', cs.lowSample ? '低样本(<8)' : '样本充足')}
        ${stat('崩塌率', fmt.pct(cs.rate, 0), `${cs.collapsedN}/${cs.n} 断崖`, '', 'color:var(--red-hero)')}
        ${stat('崩塌月份中位', '第 ' + fmt.num(cs.medianMonth, 1) + ' 月', '从神坛跌落')}
      </div>
      ${h.hint('⚠️ 本预测永不进考核、永不影响提成、永不对该员工可见；系统只输出【提前做传承预案（留人器）】，永不输出【建议开除】。')}`)}
    <div class="grid g2">
      ${h.card('F13 排序效应验证闭环（实时读定价器）', dj == null || dj.floatShare == null || dj.matrixB == null
        ? h.banner('需先在定价器完成方案：RPI = 浮动占比 × min(生存线/矩阵底薪, 1)。', 'a') + h.btn('去定价器 →', 'ui.nav', { cls: 'sm', data: 'data-board="dingjia"' })
        : `${stat('RPI（薪酬结构筛人指数）', fmt.num(rpi, 2), `浮动占比 ${fmt.pct(dj.floatShare, 0)} · 生存线 ${fmt.yuan(survivalLine)}（${SK.CITY_CN[db.company.cityTier]}最低工资） · 矩阵底薪 ${fmt.yuan(dj.matrixB)}`, rpi >= gc('zhaoren.rpiRedline') ? redStat : '', rpi >= gc('zhaoren.rpiRedline') ? 'color:var(--red-hero)' : '')}
          <p style="font-size:12.5px;color:var(--ink2);margin-top:8px">≥${gc('zhaoren.rpiRedline')} 预测筛进赌徒/黑暗三角；<${gc('zhaoren.rpiGreen')} 吸引成就动机型。
          验证观测（演示值）：黑暗中位 ${dark.median}（均值 ${dark.teamMean}）· 成就中位 ${ach.median}（均值 ${ach.teamMean}）→ ${h.badge(pred === 'gambler' ? (verdict === 'verified' ? '✅ 预测被验证：赌徒型' : '赌徒预测 · 未验证') : pred === 'achievement' ? '🟢 成就动机型' : '中性区', pred === 'gambler' ? 'r' : pred === 'achievement' ? 'g' : 'n')}</p>
          ${h.hint('你不是招不到好人——你在用一个只有赌徒会应聘的薪酬结构。')}`)}
      ${h.card('F14 例外权追踪器（SIM 演示 · 推翻测评）', `
        ${stat('EPS = 推翻组 − 遵从组（12月净贡献）', fmt.wan(sc.eps), `推翻组均值低 = 主管直觉在损毁质量（各组样本 ≥${gc('zhaoren.epsMinSampleEach')} 才计）`, '', 'color:var(--red-hero)')}
        <p style="font-size:12.5px;color:var(--ink2);margin-top:8px">推翻率 <b>${fmt.pct(sc.overrideRate)}</b>（配额 ${fmt.pct(gc('zhaoren.overrideQuotaDefault'), 0)}）${sc.warn ? h.badge('🟡 超配额预警', 'a') : ''}　推翻组 90 天存活 ${fmt.pct(SIM.f14_s2, 0)} vs 遵从组 ${fmt.pct(SIM.f14_s1, 0)}</p>
        ${h.hint('说明：正式数据需在转正建档时记录「系统推荐 vs 主管决定」。系统不禁止推翻——只把推翻的代价记在账上。')}
        ${h.src('Hoffman-Kahn-Li 2018 QJE：越频繁推翻测评的主管，招到的人越差')}`)}
    </div>`;
  }

  /* ================= 模块注册 ================= */
  SK.registerModule({
    id: 'zhaoren', title: '招人', icon: '🧲', order: 4,
    subnav: [
      { id: 'input', label: '七步输入' }, { id: 'result', label: '结果·十二闸' }, { id: 'hire', label: '招聘包' },
      { id: 'funnel', label: '漏斗水温' }, { id: 'batch', label: '批次入职' }, { id: 'lab', label: '效度实验室' },
    ],
    liveCells() {
      const z = SK.X('zhaoren'); if (!z) return [];
      return [
        { k: '该招人数', v: fmt.num(z.trueHires) + ' 人', tone: z.isLate ? 'red' : '', board: 'zhaoren', sub: 'result', tip: `拍脑袋 ${fmt.num(z.naiveHires)} 人 · 高估率 ${fmt.pct(z.overRate, 0)}` },
        { k: '最晚开招', v: z.isLate ? `已晚 ${z.lateDays} 天` : fmt.d(z.latestStart), tone: z.isLate ? 'red' : '', board: 'zhaoren', sub: 'result', tip: '晚一天开招，少一天爬坡' },
      ];
    },
    alerts() { return this.alertList().filter(a => a.tone === 'r').length; },
    alertList() {
      const db = SK.DB, T = SK.today(), out = [];
      try {
        const r = chainNow(db, T);
        for (const g of gateVerdicts(r, critNow(db))) if (g.active)
          out.push({ tone: g.light === 'red' ? 'r' : 'a', text: `招人闸${gateNo(g.id)} ${g.name}：${g.judge}`, board: 'zhaoren', sub: ['G4', 'G5', 'G6'].includes(g.id) ? 'hire' : 'result' });
        const floor = gc('zhaoren.practiceMinCount14d');
        const bad = (db.practiceLogs || []).filter(l => l.count14 < floor);
        if (bad.length) out.push({ tone: 'r', text: `招人闸⑪ 练习量：${bad.length} 名新人前 14 天 < ${floor} 次（S 曲线右移 ${gc('zhaoren.practiceCurveShiftMonths')} 月）`, board: 'zhaoren', sub: 'batch' });
        const agg = ackAgg(db, T);
        if (agg.gap != null && agg.gap > gc('zhaoren.cognitiveGapRedline'))
          out.push({ tone: 'r', text: `招人闸⑫ 认知鸿沟 ${fmt.pct(agg.gap)} ＞ ${fmt.pct(gc('zhaoren.cognitiveGapRedline'), 0)}`, board: 'zhaoren', sub: 'batch' });
      } catch (e) { console.error('zhaoren.alertList', e); }
      return out;
    },
    render(sub) {
      const db = SK.DB, T = SK.today();
      switch (sub) {
        case 'result': return vResult(db, T);
        case 'hire': return vHire(db);
        case 'funnel': return vFunnel(db, T);
        case 'batch': return vBatch(db, T);
        case 'lab': return vLab(db, T);
        default: return vInput(db, T);
      }
    },
  });

  /* ================= 跨模块 summary ================= */
  SK.summary.zhaoren = (db, today) => {
    const r = capacityChain(liveInputs(db), targetYearOf(db, today), today);
    const tag = priceTag(liveInputs(db));
    const practiceBySp = {};
    for (const l of (db.practiceLogs || [])) practiceBySp[l.spId] = l.count14;
    return { trueHires: r.trueHires, naiveHires: r.naiveHires, overRate: r.overRate,
      latestStart: r.latestStart, isLate: r.isLate, lateDays: r.lateDays,
      targetHeads: r.targetHeads, managerNeeded: r.managerNeeded, mgrGap: r.mgrGap,
      tagAmt: tag.tagAmt, practiceBySp };
  };

  /* ================= 动作 ================= */
  const NEXT_POOL = { resume: 'interview', interview: 'offer', reserve: 'resume' };
  const candById = id => SK.DB.candidates.find(c => c.candId === id);
  Object.assign(SK.actions, {
    'zr.adopt': () => UI.toast('已采纳 · 建议记入 ActionCard（系统永不自动执行）'),
    'zr.ignore': () => UI.toast('已忽略'),
    'zr.later': () => UI.toast('已稍后'),
    'zr.reset-weights': () => { SK.DB.weights = Object.assign({}, gc('zhaoren.hiringWeightsFactory')); UI.commit(); UI.toast('已恢复出厂权重 35/25/20/15/5'); },

    'zr.cand-add': () => {
      const chOpts = Object.entries(CH_CN).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
      UI.modal(`<h3>新增候选人</h3>
        <div class="frm">
          ${h.field('姓名', '<input id="zc-name" type="text">')}
          ${h.field('手机（三态查重键）', '<input id="zc-phone" type="text">', '保存时对候选人库 + 员工档案实时查重')}
          ${h.field('渠道', `<select id="zc-ch">${chOpts}</select>`)}
          ${h.field('期望月薪（万）', '<input id="zc-exp" type="number" step="0.1" value="1.0">')}
          ${h.field('入池', `<select id="zc-pool"><option value="resume">简历池</option><option value="reserve">蓄水池</option></select>`)}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">${h.btn('取消', 'ui.modal-close')}${h.btn('保存', 'zr.cand-save', { cls: 'pri' })}</div>`);
    },
    'zr.cand-save': () => {
      const g = id => document.getElementById(id);
      const name = g('zc-name').value.trim(), phone = g('zc-phone').value.trim();
      if (!name) return UI.toast('姓名必填');
      if (phone) {
        const d = dedupPhone(phone, { candidates: SK.DB.candidates, employees: SK.DB.people });
        if (d.verdict === 'block') return UI.toast(`🔴 已拦截：${d.tip}`);
        if (d.warn) UI.toast(`🟡 放行：${d.tip}`);
      }
      SK.DB.candidates.push({ candId: SK.uid('cand'), name, phone, pool: g('zc-pool').value,
        sourceChannel: g('zc-ch').value, expectedWan: parseFloat(g('zc-exp').value) || 0, poolEnteredDate: SK.today() });
      UI.closeModal(); UI.commit();
    },
    'zr.cand-next': d => {
      const c = candById(d.id); if (!c) return;
      const next = NEXT_POOL[c.pool]; if (!next) return;
      c.pool = next; c.poolEnteredDate = SK.today();
      UI.commit(); UI.toast(`${c.name} → ${POOLS.find(p => p[0] === next)[1]}（只前进一格）`);
    },
    'zr.cand-lose': d => {
      const c = candById(d.id); if (!c) return;
      SK.DB.candidates = SK.DB.candidates.filter(x => x.candId !== d.id);
      UI.commit(); UI.toast(`${c.name} 已流失出漏斗`);
    },
    'zr.hire-open': d => {
      const c = candById(d.id); if (!c) return;
      const mgrs = SK.activeManagers();
      const q = Math.ceil((Number(SK.monthOf(SK.today()).slice(5, 7))) / 3);
      UI.modal(`<h3>转正建档 · ${esc(c.name)} <span class="hint">（渠道 ${CH_CN[c.sourceChannel] || c.sourceChannel} 自动继承 → QCS 追踪）</span></h3>
        <div class="frm">
          ${h.field('入职日期', `<input id="zh-date" type="date" value="${SK.today()}">`)}
          ${h.field('起始底薪（元/月）', '<input id="zh-base" type="number" value="6000">')}
          ${h.field('批次号（vintage 分组键）', `<input id="zh-batch" type="text" value="${SK.today().slice(0, 4)}-Q${q}">`)}
          ${h.field('带教主管', `<select id="zh-mgr"><option value="">（暂不指定）</option>${mgrs.map(m => `<option value="${m.spId}">${esc(m.name)}</option>`).join('')}</select>`)}
          ${h.field('城市档', `<select id="zh-city">${[['tier1', '一线'], ['tier2', '二线'], ['tier34', '三四线']].map(([v, t]) => `<option value="${v}" ${SK.DB.company.cityTier === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
          ${h.field('完全招聘成本（元）', `<input id="zh-cost" type="number" value="${Math.round(gc('shared.hiringCostDefaultAmt') / 100)}">`)}
        </div>
        ${h.banner('保存后：在 DB.people 新建员工（跨板块打通）——算账器计毛利/提成、育人器管爬坡处方、留人器算价签，全部按此 spId 关联。黑暗三角评分明细即刻销毁，只留总分。', 'b')}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">${h.btn('取消', 'ui.modal-close')}${h.btn('确认转正', 'zr.hire-save', { cls: 'pri', data: `data-id="${c.candId}"` })}</div>`);
    },
    'zr.hire-save': d => {
      const c = candById(d.id); if (!c) return;
      const g = id => document.getElementById(id);
      const dupA = c.phone && SK.DB.people.find(p => p.phone === c.phone && p.isActive);
      if (dupA) return UI.toast(`🔴 与在职员工 ${dupA.name} 手机号重复，已拦截`);
      const emp = {
        spId: SK.uid('sp'), name: c.name, phone: c.phone, cityTier: g('zh-city').value,
        level: 0, positionType: 'sales', hireDate: g('zh-date').value || SK.today(),
        leaveDate: null, leaveReason: null, managerId: g('zh-mgr').value || null,
        hireBatchId: g('zh-batch').value.trim() || null,
        sourceChannel: c.sourceChannel,
        baseSalaryAmt: Math.round((parseFloat(g('zh-base').value) || 0) * 100),
        hiringCostAmt: Math.round((parseFloat(g('zh-cost').value) || 0) * 100),
        isActive: true,
      };
      SK.DB.people.push(emp);
      c.pool = 'hired'; c.poolEnteredDate = SK.today();
      UI.closeModal(); UI.commit();
      UI.toast(`${emp.name} 已入职建档（渠道 ${CH_CN[emp.sourceChannel] || emp.sourceChannel} 继承）——五个板块开始按 spId 跟踪`);
    },
  });

  /* ================= 对拍自检（黄金值照原版 T1–T9 系列 · 纯函数喂 fixture） ================= */
  const TFIX = { targetYearGrossAmt: 1800 * W, perCapitaActualAmt: 100 * W, salesCount: 10, cycleTier: 'short',
    attritionRate: 0.30, hiringCycleDays: 45, fullLoadCostAmt: 28 * W, managerCount: 2 };
  const T_TODAY = '2026-07-13', T_YEAR = 2026;
  const near = (a, b, e) => a != null && Math.abs(a - b) <= (e == null ? 1e-6 : e);
  SK.tests.push(
    { id: 'ZR-T1', name: 'k1=65.83% kEff1=55.96%', fn: () => { const r = capacityChain(TFIX, T_YEAR, T_TODAY); return { pass: near(r.k1, 0.658333, 1e-4) && near(r.kEff1, 0.559583, 1e-4), got: [r.k1, r.kEff1], want: [0.658333, 0.559583] }; } },
    { id: 'ZR-T2', name: 'naive=8 true=20 高估60.0%', fn: () => { const r = capacityChain(TFIX, T_YEAR, T_TODAY); return { pass: r.naiveHires === 8 && r.trueHires === 20 && fmt.pct(r.overRate) === '60.0%', got: [r.naiveHires, r.trueHires, fmt.pct(r.overRate)], want: [8, 20, '60.0%'] }; } },
    { id: 'ZR-T3', name: '开招2025-11-17 晚238天', fn: () => { const r = capacityChain(TFIX, T_YEAR, T_TODAY); return { pass: r.latestStart === '2025-11-17' && r.lateDays === 238 && r.isLate, got: [r.latestStart, r.lateDays], want: ['2025-11-17', 238] }; } },
    { id: 'ZR-T4', name: 'span8 需4缺2 满产70.6% 净增26.5万', fn: () => { const r = capacityChain(TFIX, T_YEAR, T_TODAY); return { pass: r.span === 8 && r.managerNeeded === 4 && r.mgrGap === 2 && r.targetHeads === 30 && r.pureCoachMin === 0 && fmt.pct(r.fullRampCoef) === '70.6%' && r.fullRampFlag === 'green' && fmt.wan(r.marginProfit) === '56.0万' && fmt.wan(r.marginCost) === '29.5万' && fmt.wan(r.netGain) === '26.5万', got: [r.span, r.managerNeeded, r.mgrGap, fmt.pct(r.fullRampCoef), fmt.wan(r.netGain)], want: [8, 4, 2, '70.6%', '26.5万'] }; } },
    { id: 'ZR-T5', name: '价签48.17万 内推奖4800 QCS88/61', fn: () => { const tag = priceTag(TFIX), b = referralBonus(tag.tagAmt), ch = SIM.channels; return { pass: (tag.tagAmt / W).toFixed(2) === '48.17' && b === 4800 && Math.round(qcs(ch[0], ch)) === 88 && Math.round(qcs(ch[1], ch)) === 61, got: [(tag.tagAmt / W).toFixed(2), b, Math.round(qcs(ch[0], ch)), Math.round(qcs(ch[1], ch))], want: ['48.17', 4800, 88, 61] }; } },
    { id: 'ZR-T6', name: '效度 r=+.38/−.09/−.11 样本11→null', fn: () => { const P = f11people(); const a = validityR(P, 'achievement').r, c = validityR(P, 'charisma').r, e = validityR(P, 'experience').r; return { pass: a.toFixed(2) === '0.38' && c.toFixed(2) === '-0.09' && e.toFixed(2) === '-0.11' && validityR(P.slice(0, 11), 'achievement').r === null, got: [a.toFixed(2), c.toFixed(2), e.toFixed(2)], want: ['0.38', '-0.09', '-0.11'] }; } },
    { id: 'ZR-T7', name: '练习8/50右移2月 · 鸿沟54.8%红 · 第8天autoConfirm', fn: () => { const pg = practiceGate(8), gp = cognitiveGap(42, 19); return { pass: pg.red && pg.shiftMonths === 2 && fmt.pct(gp) === '54.8%' && gp > gc('zhaoren.cognitiveGapRedline') && autoConfirm(8) === true && autoConfirm(7) === false, got: [pg.shiftMonths, fmt.pct(gp)], want: [2, '54.8%'] }; } },
    { id: 'ZR-T8', name: '崩塌67%中位12.5 · RPI0.70验证 · EPS−16万推翻22.5%', fn: () => { const cs = collapseStats(SIM.f12); const rpi = rpiValue(0.70, 5000_00, 5000_00); const v = verifyRPI(rpi, { median: 68, teamMean: 42 }, { median: 31, teamMean: 55 }); const sc = overrideScorecard(SIM.f14_against, SIM.f14_comply, SIM.f14_over, SIM.f14_dec); return { pass: near(cs.rate, 4 / 6) && cs.medianMonth === 12.5 && near(rpi, 0.70) && v === 'verified' && fmt.wan(sc.eps) === '-16.0万' && fmt.pct(sc.overrideRate) === '22.5%' && sc.warn, got: [cs.rate, cs.medianMonth, rpi, v, fmt.wan(sc.eps)], want: [0.6667, 12.5, 0.70, 'verified', '-16.0万'] }; } },
    { id: 'ZR-T9', name: '查重三态 + 权重Σ + 荐才线', fn: () => { const dctx = { candidates: [{ phone: '138', name: '张三' }], employees: [{ phone: '139', isActive: true }, { phone: '137', isActive: false, leaveDate: '2024-05-01', leaveReason: 'resign_other' }] }; const d1 = dedupPhone('138', dctx), d2 = dedupPhone('139', dctx), d3 = dedupPhone('137', dctx); const vw = validateWeights(gc('zhaoren.hiringWeightsFactory')); return { pass: d1.verdict === 'block' && d1.tip.includes('张') && d2.verdict === 'block' && d3.verdict === 'pass' && d3.warn === true && vw.ok && systemRecommend(60) === 'hire' && systemRecommend(59) === 'reject', got: [d1.verdict, d2.verdict, d3.verdict, vw.sum], want: ['block', 'block', 'pass', 100] }; } },
  );
})();
