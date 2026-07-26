/* ============================================================
   定价器（dingjia）— 销冠定价器 v2.5 一体化移植
   引擎逐字复刻原版：compute 顺序 B→D→A→C→E→合计。
   输入全部绑定共享字段 DB.company；salesCount/managerCount 由员工档案派生只读。
   系数：dingjia.* 与 shared.* 命名空间，只经 SK.getCoef。
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { fmt, esc, DASH, safeDiv, clamp } = SK;
  const WAN = SK.WAN;

  /* ================= 0. 常量与文案 ================= */
  const GRADE_IDX = { effective: 1, efficient: 2, leading: 3 };
  const gradeIndex = g => GRADE_IDX[g] != null ? GRADE_IDX[g] : 1;
  const GRADE_SHORT = { effective: '初级', efficient: '中级', leading: '高级' };
  const GRADE_TECH = { effective: '有效', efficient: '高效', leading: '领先' };
  const GRADE_DESC = {
    effective: '能独立签单、稳定达标的常规销售——多数团队按这档定薪',
    efficient: '持续超额、能自己带节奏的骨干',
    leading: '团队头部标杆，产出明显高于均值',
  };
  const LEVEL_DESC = {
    sales: '一线销售，直接签单回款',
    manager: '带 5–8 人的一线主管，约三成时间用于管人',
    executive: '定战略、背全盘目标，按 1 人计',
  };
  const levelName = l => ({ sales: '销售', manager: '主管', executive: '高管' })[l] || l;
  const gradeFull = g => `${GRADE_SHORT[g]}（${GRADE_TECH[g]}）`;
  const roundYuanFen = fen => Math.round(fen / 100) * 100;   // 四舍五入到元（分单位）

  const ENUMS = {
    cityTier: [['tier1', '一线'], ['tier2', '二线'], ['tier34', '三四线']],
    cycleTier: [['short', '一个月内成单'], ['regular', '1–3个月'], ['midLong', '4–6个月'], ['long', '7–12个月'], ['ultraLong', '一年以上']],
    tierGrade: [['effective', '初级（有效）'], ['efficient', '中级（高效）'], ['leading', '高级（领先）']],
    complementLevel: [['solo', '各干各的'], ['partial', '混着干（多数团队）'], ['chained', '环环相扣']],
    attributableLevel: [['no', '说不清谁干的'], ['partial', '大概分得清'], ['yes', '能精确到人头']],
    positionType: [['pure_sales', '纯销售（签单收钱）'], ['advisory', '顾问/技术岗'], ['aftersales', '售后岗']],
    commissionBaseType: [['contract_amount', '按合同额/回款提'], ['margin_based', '按毛利提'], ['neutral_kpi', '按复购/满意度提']],
    guardrailMetric: [['complaint_rate', '客户投诉多不多'], ['refund_rate', '退货退款多不多'], ['discount_rate', '打折打得凶不凶']],
  };
  const CONTROLS = [['no_discount', '不许降价'], ['discount_excluded', '折扣不计提成'], ['old_client_excluded', '老客续费不计'],
    ['heavy_monitoring', '过程强监控'], ['push_deadline', '月底冲刺压单'], ['forbid_backlog', '禁止押单挪单']];
  const LEAK_MAP = {
    no_discount: { exit: '该降不降 → 丢单', price: '失单率 ↑', watch: '失单原因=价格占比', w: 'lost_price' },
    discount_excluded: { exit: '隐性让利（送货/延期/口头承诺）', price: '成本不可见、数据变假', watch: 'DiscountEntry 缺录率', w: 'discount_missing' },
    old_client_excluded: { exit: '老客荒废', price: '复购率 ↓', watch: '复购率', w: 'repurchase' },
    heavy_monitoring: { exit: '表演性合规（摆拍/刷时长）', price: '可见产出 ≠ 真实产出', watch: '日报计数 vs 成交相关性', w: 'report_corr' },
    push_deadline: { exit: '透支下月 + 破坏价格锚点', price: '期末折扣率 ↑', watch: 'period_end_push', w: 'period_end_push' },
    forbid_backlog: { exit: '只做老客不开新客', price: '新客占比 ↓', watch: '新客成交占比', w: 'new_client_share' },
  };
  const controlLabel = v => { const f = CONTROLS.find(x => x[0] === v); return f ? f[1] : v; };

  /* ---- 警示话术库（v2.8 全部人话；编号只做内部标识，不再上屏）---- */
  const W_TEXT = {
    'W-01': g => `你的毛利率只有 ${fmt.pct(g.marginRate)}，是低毛利生意——提成给高一点就吃掉利润。本系统的参考值已经按毛利帮你算过账，放心用；但别在系统外再按回款私下加码。`,
    'W-02': g => `底薪 ${fmt.yuan(g.row.B)} 已经快赶上达标月收入 ${fmt.yuan(g.row.T)} 了——干多干少一个样，这不是激励方案，是死工资。要么调低底薪，要么调高收入档。`,
    'W-03': () => `底薪压到活命线以下了：人活不下去，要么走人、要么乱来。把底薪调回活命线以上。`,
    'W-04': () => `这套方案里，工资的 65% 以上要靠业绩挣——快成交的生意可以这么狠，但请确认底薪够活。`,
    'W-05': g => `全公司的提成加起来，要吃掉目标毛利的 ${fmt.pct(g.burdenRate)}（健康上限 35%）——目标毛利撑不起这套工资：要么哪一层给高了，要么目标定低了。人越多、亏越多。`,
    'W-06': g => `全公司的提成加起来只占目标毛利 ${fmt.pct(g.burdenRate)}（不到 25%）——给得太抠，好销售看不上这份钱。`,
    'W-09': () => `按这个人数，人均任务已经超过真实水平的 120%——「人人都干得到满产」是幻觉：全球真实达标的人只有四到五成。`,
    'W-29': g => `${levelName(g.row.level)}底薪 ${fmt.yuan(g.row.B)} 低于你所在城市的最低工资参考（${fmt.yuan(g.minW)}）——涉嫌违法，员工可以仲裁追讨。请上调底薪（如果你当地标准不同，可到「数据中心 · 系数矩阵」改）。`,
    'ok': () => `全公司提成占目标毛利在 25–35% 之间——给得起，也够香。`,
    'W-19': () => `先别玩「自选目标」：你的底薪已低于活命线，这时让员工自己挑目标，全员都会挑最低档。先修底薪。`,
    'W-20': g => `危险组合：人均目标已是团队真实能力上限的 ${fmt.pct(g.ratioCur)}（红线 130%），而且底薪贴着活命线。目标高到正常干够不着时，人只剩两条路——走人，或造假。（真实案例：美国富国银行就这么干，员工造出 350 万个假账户，罚了 30 多亿美元，CEO 下台。）`,
    'W-20b': g => `人均目标已是团队真实能力上限的 ${fmt.pct(g.ratioCur)}。底薪还有缓冲，暂时不至于逼人造假，但「人人满产」仍是幻觉——先塌的是达标率。`,
    'W-21': () => `提成方向和客户利益拧着：顾问/售后类岗位按合同额提成，等于鼓励他们过度推销。（真实案例：美国 Sears 修车店按修理费提成，结果「没病也修出病」，被 41 个州调查。）改法：这类岗位改按复购、留存、满意度提。`,
    'W-21b': () => `纯销售按合同额/回款提成，在低毛利品类会卖一单亏一单——建议按毛利口径算（本系统默认就是）。`,
    'W-22': () => `只考核回款一个数，砍价、乱承诺、冷落老客就会在你看不见的地方长出来——从「客诉率/退款率/折扣率」里挑一个一起盯着再发方案。`,
    'W-23': g => `你设了 ${g.n} 条「最低要求」。要求越多，员工越是只做到及格线。过程红线要少而致命，产出奖励上不封顶。`,
    'W-24': g => `开新市场/新产品，别用月度提成逼人：给 ${g.floorMonths} 个月保底期（底薪照发、不挂业绩、不得低于最低工资 ${fmt.yuan(g.minWage)}），设三档里程碑奖（首单/管道充足/首季回款），按季度结算。`,
    'W-25': g => `你堵了 ${g.n} 个口子，员工就会从另外 ${g.n} 个口子钻。没有方案能堵死所有口子——挑一个你付得起的，盯着它就行。`,
    'W-26': () => `勾选你现在用的管控手段，看看员工会从哪儿钻空子。`,
  };
  const GATE_BRIEF = {
    'W-01': '低毛利生意——提成多一点就吃掉利润',
    'W-02': '底薪快赶上达标收入——变死工资',
    'W-03': '底薪低于活命线',
    'W-04': '工资 65% 以上靠业绩挣——底薪要够活',
    'W-05': '提成总盘子超过毛利 35% 上限——会亏',
    'W-06': '提成总盘子不到毛利 25%——太抠',
    'W-29': '底薪低于当地最低工资——违法风险',
  };

  /* ================= 1. 引擎（纯函数，逐字复刻 v2.5）================= */

  // 账单B（六步链；today/targetYear 显式注入）
  function calcCardB(inp, today, targetYear) {
    const cyc = inp.cycleTier, I5 = inp.nextYearTargetGrossAmt, I6 = inp.lastYearPerCapitaGrossAmt,
      I7 = inp.salesCount, I9 = inp.attritionRate, I10 = inp.hiringCycleDays;
    if (!I6) return { ok: false };
    const midF = SK.getCoef('shared.midYearAttritionFactor');
    const kEff = m => SK.newHireYearRate(cyc, m) * (1 - I9 * midF);
    const k1 = SK.newHireYearRate(cyc, 1), kEff1 = kEff(1);
    const fullCap = I5 / I6;                                    // ① 满产当量
    const S1 = Math.max(0, Math.ceil(fullCap) - I7);            // ② 天真
    const expAttr = I7 * I9;                                    // ③ 预期流失（全额计入缺口）
    const gapCap = fullCap - I7 + expAttr;                      // ④ 缺口当量
    const S6 = Math.max(0, Math.ceil(safeDiv(gapCap, kEff1)));  // ⑥ 真实
    const overRate = safeDiv(S6 - S1, S6);
    const exposeAmt = Math.max(0, (gapCap - S1 * kEff1) * I6);
    const totalHeadTarget = I7 + S6;
    let latestMonth = null;
    for (let m = 12; m >= 1; m--) { if (kEff(m) * S6 >= gapCap) { latestMonth = m; break; } }
    let latestHire = null, isLate = false, lateDays = 0;
    if (latestMonth) {
      latestHire = SK.addDays(SK.firstDay(targetYear, latestMonth), -I10);
      lateDays = SK.diffDays(latestHire, today); isLate = lateDays > 0;
    }
    const seg = SK.SEGMENT_MAP[cyc], frr = SK.getCoef('dingjia.fullRampRatio')[seg];
    const stretch = safeDiv(I5, totalHeadTarget) != null && safeDiv(I5, totalHeadTarget) > (I6 / frr) * 1.2;
    return { ok: true, k1, kEff1, S1, fullCap, expAttr, gapCap, S6, overRate, exposeAmt,
      totalHeadTarget, latestMonth, latestHire, isLate, lateDays, ramp80: SK.calcRamp80(cyc), targetYear, stretch };
  }

  // 账单D（管理跨度）
  function calcCardD(inp, totalHeadTarget) {
    const I8 = inp.managerCount;
    const sd = SK.getCoef('shared.spanDefault');
    const availH = sd.weeklyHrs * sd.manageTimeShare - SK.getCoef('shared.fixedMeetingHrs');
    const spanCap = Math.floor(availH / SK.getCoef('shared.perHeadMgmtHrs'));
    const heads = (totalHeadTarget != null) ? totalHeadTarget : inp.salesCount;
    const managerNeeded = Math.ceil(safeDiv(heads, spanCap));
    const gap = Math.max(0, managerNeeded - I8);
    const curSpan = safeDiv(heads, Math.max(I8, 1));
    const coachMin = Math.round(Math.max(0, availH - heads * SK.getCoef('shared.perHeadAdminHrs')) / heads * 60);
    return { availH, spanCap, heads, managerNeeded, gap, curSpan, coachMin };
  }

  // 账单A（三层全链 + 六道闸）
  function calcCardA(inp, managerNeeded, totalHeadTarget) {
    const I1 = inp.cityTier, I2 = inp.cycleTier, grade = inp.tierGrade, I4 = inp.targetPersonalMonthlyGrossAmt,
      I5 = inp.nextYearTargetGrossAmt, I11 = inp.blendedMarginRate;
    // 🔴 v2.5：销售档 gi 与 主管/高管档 gmi 各自独立选择（idx 按层取）
    const gi = gradeIndex(grade), gmi = gradeIndex(inp.mgrGrade), cityB = SK.getCoef('dingjia.cityBase')[I1], cf = SK.getCoef('dingjia.cycleFactor')[I2],
      social = SK.getCoef('shared.socialCostRate'), ltr = SK.getCoef('shared.longTermRate'), minW = SK.getCoef('shared.minWageTable')[I1],
      lm = SK.getCoef('dingjia.levelMultiplier'), tt = SK.getCoef('dingjia.thresholdTTable')[I1];
    const Bof = (lv, idx) => roundYuanFen(cityB * lm[lv][idx] * cf);
    const Tof = (lv, idx) => tt[lv][idx] * 100;                 // 元→分
    const Gof = lv => lv === 'sales' ? I4 : lv === 'manager' ? safeDiv(I5, 12 * Math.max(managerNeeded, 1)) : I5 / 12;
    const layers = ['sales', 'manager', 'executive'];
    const count = { sales: totalHeadTarget, manager: managerNeeded, executive: 1 };
    const cp = inp.customPay || {};                             // v2.7：老板自定义底薪/提成为准，矩阵值降级为参考
    const rows = layers.map(lv => {
      const idx = lv === 'sales' ? gi : gmi;                    // 销售用销售档，主管+高管共用 mgrGrade 档
      const cRow = cp[lv === 'sales' ? 'sales_' + grade : lv] || {};
      const refB = Bof(lv, idx), T = Tof(lv, idx), G = Gof(lv);
      const custB = cRow.b > 0 ? roundYuanFen(cRow.b) : null;   // 自定义底薪（分/月），空=参考矩阵
      const B = custB != null ? custB : refB;
      const longAmt = Math.round(T * ltr);
      let gapAmt = Math.round(T * (1 - ltr)) - B;
      let blocked = B >= T * (1 - ltr), r = blocked ? null : safeDiv(gapAmt, G);
      const custRc = cRow.rc > 0 ? cRow.rc : null;              // 自定义提成（占回款 0–1），空=按 T 反推
      if (custRc != null && I11 > 0) { r = custRc / I11; gapAmt = Math.round(r * G); blocked = false; }
      const belowMinWage = B < minW, floatShare = safeDiv(gapAmt, T);
      const survivalB = Bof(lv, 0);                             // 该层活命线（预警档倍数）
      return { level: lv, B, refB, custB, custRc, T, G, longAmt, gapAmt, blocked, r,
        rc: (r != null && I11 > 0) ? r * I11 : null,            // 回款口径提成（展示：回款的 X%）
        belowMinWage, floatShare, survivalB, belowSurvival: B < survivalB, count: count[lv] };
    });
    const sales = rows[0], Bwarn = Bof('sales', 0), Twarn = Tof('sales', 0);
    const goodHire = Math.min(sales.B / Bwarn, sales.T / Twarn);
    const comp = ratio3(sales.B, sales.gapAmt, sales.longAmt);
    const burdenNum = rows.reduce((s, r) => s + (r.count || 0) * r.gapAmt * 12, 0);
    const burdenRate = safeDiv(burdenNum, I5);
    const fullNum = rows.reduce((s, r) => s + (r.count || 0) * (Math.round(r.B * (1 + social)) + r.gapAmt + r.longAmt) * 12, 0);
    const fullBurden = safeDiv(fullNum, I5), fullRev = fullBurden != null ? fullBurden * I11 : null;
    // 六道闸
    const gates = [];
    const anyBlocked = rows.some(r => r.blocked);
    if (anyBlocked) gates.push({ id: 1, light: 'red', code: 'W-02', row: rows.find(r => r.blocked) });
    if (I11 < 0.20) gates.push({ id: 2, light: 'red', code: 'W-01' });
    if (sales.B < Bwarn) gates.push({ id: 3, light: 'red', code: 'W-03' });
    if (sales.floatShare != null && sales.floatShare >= 0.65) gates.push({ id: 4, light: 'amber', code: 'W-04' });
    if (burdenRate != null) {
      if (burdenRate > 0.35) gates.push({ id: 5, light: 'red', code: 'W-05' });
      else if (burdenRate < 0.25) gates.push({ id: 5, light: 'amber', code: 'W-06' });
      else gates.push({ id: 5, light: 'green', code: 'ok' });
    }
    rows.forEach(r => { if (r.belowMinWage) gates.push({ id: 6, light: 'red', code: 'W-29', row: r, minW }); });
    return { rows, sales, Bwarn, Twarn, goodHire, comp, burdenRate, fullBurden, fullRev, marginRate: I11,
      hungerBait: sales.B < Bwarn, gates, anyBlocked };
  }
  function ratio3(a, b, c) {
    const t = a + b + c; if (t <= 0) return [0, 0, 0];
    let x = [Math.round(a / t * 100), Math.round(b / t * 100), Math.round(c / t * 100)];
    const diff = 100 - (x[0] + x[1] + x[2]); x[1] += diff; return x;
  }

  // 账单C（流失价签简版 3 项）
  function calcCardC(inp) {
    const I1 = inp.cityTier, I2 = inp.cycleTier, I6 = inp.lastYearPerCapitaGrossAmt,
      I7 = inp.salesCount, I9 = inp.attritionRate, I10 = inp.hiringCycleDays;
    const monthPer = I6 / 12, idle = monthPer * I10 / 30, arr = SK.RAMP[I2];
    let sumGap = 0; for (let pos = 1; pos <= 12; pos++) sumGap += (1 - arr[pos - 1] / 100);
    const rampGap = monthPer * sumGap, recruitFee = SK.getCoef('shared.recruitFeeDefaultAmt'), tag = idle + rampGap + recruitFee;
    const Tsales = SK.getCoef('dingjia.thresholdTTable')[I1].sales[1] * 100; // effective
    const ote = SK.getCoef('dingjia.turnoverCostOteRate');
    const oteLow = Tsales * 12 * ote[0], oteHigh = Tsales * 12 * ote[1];
    const annual = tag * I7 * I9;
    return { idle, rampGap, recruitFee, tag, oteLow, oteHigh, annual, sumGap };
  }

  // 账单E（团队奖 TIS）
  function calcCardE(inp) {
    const I7 = inp.salesCount, I12 = inp.complementLevel, I13 = inp.attributableLevel, tis = SK.getCoef('dingjia.teamBonusTIS');
    const sizeScore = 100 * clamp(1 - (I7 - tis.sizeFull) / (tis.sizeZero - tis.sizeFull), 0, 1);
    const compScore = tis.complementEnum[I12], visScore = { no: 0, partial: 50, yes: 100 }[I13];
    const TIS = tis.w[0] * sizeScore + tis.w[1] * compScore + tis.w[2] * visScore;
    const light = TIS >= tis.green ? 'green' : (TIS >= tis.red ? 'amber' : 'red');
    return { sizeScore, compScore, visScore, TIS, light };
  }

  // 合计
  function calcTotalLine(B, C) { return { total: (C ? C.annual : 0) + (B ? B.exposeAmt : 0), annual: C ? C.annual : 0, expose: B ? B.exposeAmt : 0 }; }

  /* ---- 风洞引擎 ---- */
  function generateMenu(baseQuotaAmt, baseBonusAmt, gate3Active) {
    if (gate3Active) return { blocked: true, code: 'W-19' };
    if (!(baseQuotaAmt > 0) || !(baseBonusAmt > 0)) return null;
    const steps = SK.getCoef('dingjia.menuQuotaSteps'), mid = SK.getCoef('dingjia.menuAttainMid'),
      slope = SK.getCoef('dingjia.menuAttainSlope'), round = SK.getCoef('dingjia.menuRound'),
      E = mid * baseBonusAmt, P = x => clamp(mid + slope * (1 - x), 0.05, 0.95);
    let tiers = steps.map(x => { const quota = baseQuotaAmt * x; let bonus = SK.roundTo(E / P(x), round); return { x, quota, bonus, P: P(x) }; });
    // 校验二（激励相容）：bonus/quota 严格递增；低档违反→下调（脚注 W-28）
    let adjusted = false;
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].bonus / tiers[i].quota <= tiers[i - 1].bonus / tiers[i - 1].quota) {
        tiers[i - 1].bonus = SK.roundTo(0.98 * (tiers[i].bonus / tiers[i].quota) * tiers[i - 1].quota, round); adjusted = true;
      }
    }
    tiers = tiers.map(t => ({ ...t, unitReturn: t.bonus / t.quota, dev: Math.abs(t.P * t.bonus - E) / E }));
    return { tiers, E, adjusted };
  }
  // 造假风险闸：p90Real 显式传入（一体版取 X('suanzhang').realP90Factor；null 回退 shared.p90ColdFactor）
  function gateFraudRisk(audit, inp, p90Real) {
    const I1 = inp.cityTier, I2 = inp.cycleTier, I5 = inp.nextYearTargetGrossAmt, I6 = inp.lastYearPerCapitaGrossAmt, I7 = inp.salesCount;
    const p90Eff = (p90Real != null) ? p90Real : SK.getCoef('shared.p90ColdFactor');
    const ratioCur = safeDiv(safeDiv(I5, I7), I6 * p90Eff);
    const Bwarn = roundYuanFen(SK.getCoef('dingjia.cityBase')[I1] * SK.getCoef('dingjia.levelMultiplier').sales[0] * SK.getCoef('dingjia.cycleFactor')[I2]);
    const hunger = audit.currentBaseSalaryAmt < Bwarn * SK.getCoef('dingjia.hungerBufferRate');
    const rl = SK.getCoef('dingjia.attainabilityRedline'); let light, code;
    if (ratioCur != null && ratioCur > rl && hunger) { light = 'red'; code = 'W-20'; }
    else if (ratioCur != null && ratioCur > rl && !hunger) { light = 'amber'; code = 'W-20b'; }
    else { light = 'green'; code = 'ok'; }
    return { p90Eff, ratioCur, Bwarn, hunger, light, code };
  }
  function gateAlignment(audit) {
    const p = audit.positionType, b = audit.currentCommissionBase;
    if ((p === 'advisory' || p === 'aftersales') && b === 'contract_amount') return { light: 'red', code: 'W-21' };
    if (p === 'pure_sales' && b === 'contract_amount') return { light: 'amber', code: 'W-21b' };
    return { light: 'green', code: 'ok' };
  }
  function checkGuardrail(hasMenuOrSprint, guardrailMetric) { return { locked: hasMenuOrSprint && !guardrailMetric, code: 'W-22' }; }
  function countProcessRedlines(n) { return { warn: n >= SK.getCoef('dingjia.processRedlineWarnCount'), n, code: 'W-23' }; }
  function explorationContract(inp) {
    const r80 = SK.calcRamp80(inp.cycleTier);
    return { floorMonths: r80 + 2, minWage: SK.getCoef('shared.minWageTable')[inp.cityTier] };
  }
  function leakSandbox(measures) { return measures.filter(m => LEAK_MAP[m]).map(m => ({ measure: m, ...LEAK_MAP[m] })); }

  /* ================= 2. 输入装配（DB.company → 引擎 inp，纯函数）================= */
  function buildInputs(db) {
    const c = db.company || {};
    const wanAmt = v => v == null ? null : Math.round(v * WAN);
    return {
      cityTier: c.cityTier, cycleTier: c.cycleTier, tierGrade: c.tierGrade || 'effective', mgrGrade: c.mgrGrade || 'effective',
      targetPersonalMonthlyGrossAmt: wanAmt(c.targetPersonalMonthlyGrossWan),
      nextYearTargetGrossAmt: wanAmt(c.targetYearGrossWan),
      lastYearPerCapitaGrossAmt: wanAmt(c.lastYearPerCapitaWan),
      salesCount: (db.people || []).filter(p => p.isActive && p.positionType === 'sales').length,
      managerCount: (db.people || []).filter(p => p.isActive && p.positionType === 'manager').length,
      attritionRate: c.attritionRate, hiringCycleDays: c.hiringCycleDays, blendedMarginRate: c.blendedMarginRate,
      complementLevel: c.complementLevel, attributableLevel: c.attributableLevel,
      targetYearMode: c.targetYearMode || 'next',
      customPay: c.customPay || null,
    };
  }
  // 主计算入口（顺序 B→D→A→C→E→合计；today 显式传入，纯函数）
  function computeAll(db, today) {
    const inp = buildInputs(db);
    const ty = (+today.slice(0, 4)) + (inp.targetYearMode === 'this' ? 0 : 1);
    const R = { inp, targetYear: ty };
    try {
      if (inp.cityTier && inp.cycleTier && inp.lastYearPerCapitaGrossAmt > 0 && inp.nextYearTargetGrossAmt > 0
        && inp.attritionRate != null && inp.hiringCycleDays > 0) {
        const b = calcCardB(inp, today, ty); if (b.ok) R.B = b;
      }
    } catch (e) { /* 缺数→整卡— */ }
    try { R.D = calcCardD(inp, R.B ? R.B.totalHeadTarget : null); } catch (e) {}
    try {
      if (inp.cityTier && inp.cycleTier && inp.targetPersonalMonthlyGrossAmt > 0 && inp.nextYearTargetGrossAmt > 0 && inp.blendedMarginRate != null) {
        R.A = calcCardA(inp, R.D ? R.D.managerNeeded : 1, R.B ? R.B.totalHeadTarget : (inp.salesCount != null ? inp.salesCount : 1));
      }
    } catch (e) {}
    try { if (inp.cityTier && inp.cycleTier && inp.lastYearPerCapitaGrossAmt > 0) R.C = calcCardC(inp); } catch (e) {}
    try { if (inp.complementLevel && inp.attributableLevel) R.E = calcCardE(inp); } catch (e) {}
    if (R.B || R.C) R.total = calcTotalLine(R.B || null, R.C || null);
    return R;
  }

  /* ================= 3. X 跨模块派生：summary 注册 ================= */
  SK.summary.dingjia = (db, today) => {
    const R = computeAll(db, today);
    const A = R.A, s = A ? A.sales : null;
    return {
      ok: !!s,
      r: s ? s.r : null,                       // 销售层提成率（毛利口径，跨板块引擎用）
      rCollect: s ? s.rc : null,               // 销售层提成率（回款口径，展示用）
      matrixT: s ? s.T : null,                 // 销售档达标收入 T（分）
      matrixB: s ? s.B : null,                 // 销售档底薪 B（分）
      floatShare: s ? s.floatShare : null,
      goodHireIndex: A ? A.goodHire : null,
      burdenRate: A ? A.burdenRate : null,
      total: R.total ? R.total.total : null,   // 今年漏损 = C.annual + B.exposeAmt（分）
      results: R,                              // 完整五账单（内部用）
    };
  };

  /* ================= 4. 模块内草稿态（闭包，不落 DB）================= */
  let menuDraft = { quota: null, bonus: null };  // 分
  let menuRes = null;
  let gradeBaseDraft = null;                     // 反查输入（元）
  let matchNote = '';

  function ensureAudit() {
    if (!SK.DB.audit) SK.DB.audit = {
      positionType: 'pure_sales', currentCommissionBase: 'margin_based', currentBaseSalaryAmt: null,
      processRedlineCount: 0, guardrailMetric: null, explorationMode: false, controlMeasures: [], claimedOutlets: [],
    };
    const a = SK.DB.audit;
    if (!Array.isArray(a.controlMeasures)) a.controlMeasures = [];
    if (!Array.isArray(a.claimedOutlets)) a.claimedOutlets = [];
    return a;
  }
  function results() { const dj = SK.X('dingjia'); return dj ? dj.results : null; }

  /* ================= 5. 渲染组件 ================= */
  const gate = (light, txt) => h.banner(`${light === 'red' ? '🔴' : light === 'amber' ? '🟡' : light === 'gold' ? '🏅' : '🟢'} ${txt}`,
    light === 'red' ? 'r' : light === 'amber' ? 'a' : 'g');
  const killer = t => `<div class="killer">💬 ${t}</div>`;
  // 每张账单开头的三行人话摘要：回答什么问题 / 你现在的答案 / 一句话原因
  const plain3 = (q, a, why) => `<div style="background:var(--accent-soft);border-radius:10px;padding:10px 13px;margin-bottom:10px;font-size:13px;line-height:1.7">
    <div class="hint">❓ ${q}</div><div style="font-weight:720">${a}</div><div class="hint">${why}</div></div>`;
  const compbar = segs => `<div style="display:flex;height:22px;border-radius:7px;overflow:hidden;margin:9px 0 4px;font-size:11px;color:#fff;font-weight:600">${
    segs.map(([flex, label, color]) => `<div style="flex:${flex};background:${color};display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden;white-space:nowrap">${label}</div>`).join('')}</div>`;
  const meterCap = (l, m, r) => `<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink3);margin-top:2px"><span>${l}</span><span>${m}</span><span>${r}</span></div>`;

  // A–E 可折叠卡（DB.ui.openCards 记状态）
  function dcard(key, name, sub, resV, resK, bodyHtml) {
    const open = !!(SK.DB.ui.openCards || {})[key];
    return `<div class="card">
      <div data-act="dj.card" data-key="${key}" style="display:flex;align-items:center;gap:11px;cursor:pointer;user-select:none">
        <span style="width:28px;height:28px;flex:0 0 28px;border-radius:8px;background:var(--accent-soft);color:var(--accent);font-weight:800;display:flex;align-items:center;justify-content:center">${key}</span>
        <div style="flex:1;min-width:0"><b>${name}</b><div class="hint">${sub}</div></div>
        <div style="text-align:right"><div style="font-size:19px;font-weight:760;letter-spacing:-.01em">${resV}</div><div class="hint">${resK}</div></div>
        <span class="hint">${open ? '▾' : '▸'}</span>
      </div>
      ${open ? `<div class="divider"></div>${bodyHtml}` : ''}
    </div>`;
  }

  /* ---- 输入面板（v2.7 极简三步：定薪表 → 两个回款数 → 选填）---- */
  function vInput() {
    const c = SK.DB.company;
    const salesN = SK.activeSales().length, mgrN = SK.activeManagers().length;
    const moreOpen = SK.DB.ui.pricingMoreOpen === true;
    const refMonthly = c.lastYearPerCapitaCollectWan > 0 ? Math.round(c.lastYearPerCapitaCollectWan / 12 * 1.2 * 10) / 10 : null;
    const attrHint = c.leaversLastYear != null
      ? `已按「走了 ${c.leaversLastYear} 人」换算年流失率 ≈ ${fmt.pct(c.attritionRate, 0)}`
      : `不填按行业均值 ${fmt.pct(c.attritionRate, 0)} 算`;
    const moreBody = `
    <div class="grid g2" style="margin-top:8px">
      ${h.card('去年的底子', `<div class="frm">
        ${h.field('去年人均回款（万元/年）', h.input('company.lastYearPerCapitaCollectWan', 'num', { value: c.lastYearPerCapitaCollectWan }), '去年全公司回款 ÷ 销售人数。用来算「该招几个人 / 走一个人亏多少」')}
        ${h.field('去年走了几个销售（人）', h.input('company.leaversLastYear', 'int?', { value: c.leaversLastYear != null ? c.leaversLastYear : '', ph: '如 3' }), attrHint)}
        ${h.field('招一个人多久能到岗', h.seg('company.hiringCycleDays', [{ v: 7, t: '一周内' }, { v: 15, t: '半个月' }, { v: 45, t: '一个半月' }, { v: 90, t: '三个月' }], c.hiringCycleDays, 'num'), '从发招聘到人坐到工位（影响「最晚开招日」和空窗损失）')}
      </div>`)}
    </div>`;
    return `
    <div class="sect"><h2>定价器 · 三步定薪</h2><span class="sub">选城市周期 → 定底薪提成（可自定义，以你为准）→ 填两个回款数。改一处，五个板块同帧换算。</span></div>
    <div class="sect" style="margin-top:2px"><h2 style="font-size:14px">第一步 · 定底薪、定提成</h2><span class="sub">先选城市和成单周期，参考价自动出来；每一行都能填你自己的数——<b>填了就按你的算</b>，不填用参考价。</span></div>
    ${h.card('', `
      <div class="grid g2">
        ${h.field('公司在什么城市', h.seg('company.cityTier', ENUMS.cityTier.map(([v, t]) => ({ v, t })), c.cityTier))}
        ${h.field('一单谈多久能回款', h.seg('company.cycleTier', ENUMS.cycleTier.map(([v, t]) => ({ v, t })), c.cycleTier), '从客户首次接触到钱到账的典型时长')}
      </div>
      ${tierTableHtml()}`)}
    <div class="sect" style="margin-top:10px"><h2 style="font-size:14px">第二步 · 两个回款数 + 毛利率</h2><span class="sub">只填回款（打到账上的钱），系统内部自动换算，不用你算毛利。</span></div>
    <div class="grid g2">
      ${h.card('两个回款数', `<div class="frm">
        ${h.field('达标销售一个月要回款多少（万元）', h.input('company.targetPersonalMonthlyCollectWan', 'num', { value: c.targetPersonalMonthlyCollectWan, step: 1 }), refMonthly != null ? `参考：去年人均月回款 ×1.2 ≈ ${refMonthly} 万` : '一个合格销售每月该收回来的钱')}
        ${h.field('今年全公司要回款多少（万元）', h.input('company.targetYearCollectWan', 'num', { value: c.targetYearCollectWan }), salesN ? `现有 ${salesN} 个销售。目标定多高，「该招几个人」就跟着变` : '')}
        ${h.field('这个目标是哪一年的', h.seg('company.targetYearMode', [{ v: 'next', t: '明年' }, { v: 'this', t: '今年' }], c.targetYearMode))}
      </div>`)}
      ${h.card('毛利率 + 人', `<div class="frm">
        ${h.field('100 块回款里大约赚几块毛利', h.seg('company.blendedMarginRate', [{ v: 0.1, t: '10%' }, { v: 0.2, t: '20%' }, { v: 0.3, t: '30%' }, { v: 0.4, t: '40%' }, { v: 0.5, t: '50%' }], c.blendedMarginRate, 'num'), '拿不准就选 30%。只用于系统内部把回款换算成毛利，你不用管')}
        ${h.field(`现有销售 / 主管 ${h.linked()}`, `<b style="font-size:16px">${salesN} 个销售 · ${mgrN} 个主管</b>`, SK.DB.meta && SK.DB.meta.seeded ? '⚠ 当前是演示数据（示例·王总的公司）——去员工档案换成你自己的人，数字才是你的' : '由员工档案实时统计，不用手填')}
        <div style="margin:-2px 0 4px">${h.btn('去员工档案维护 →', 'ui.nav', { cls: 'sm ghost', data: 'data-board="data" data-sub="people"' })}</div>
      </div>`)}
    </div>
    <div data-act="dj.more" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;margin-top:12px">
      <b style="font-size:12.8px">${moreOpen ? '▾' : '▸'} 想算得更准（选填 · 都有默认值，不填也能出账单）</b>
      <span class="hint">去年人均回款 · 去年走了几个人 · 招人要多久</span>
    </div>
    ${moreOpen ? moreBody : ''}
    <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
      ${h.btn('看五张账单 →', 'ui.nav', { cls: 'pri', data: 'data-board="dingjia" data-sub="dash"' })}
      <span class="hint">改任何一个数，五张账单和其他板块同帧重算。</span>
    </div>`;
  }
  function tierTableHtml() {
    const c = SK.DB.company, I1 = c.cityTier, I2 = c.cycleTier;
    if (!I1 || !I2) return `<div class="hint" style="padding:14px;text-align:center">⬆︎ 选好上面的「城市」与「成单周期」，这里会自动出参考底薪、参考提成——每行都能改成你自己的数。</div>`;
    const cityB = SK.getCoef('dingjia.cityBase')[I1], cf = SK.getCoef('dingjia.cycleFactor')[I2],
      lm = SK.getCoef('dingjia.levelMultiplier'), tt = SK.getCoef('dingjia.thresholdTTable')[I1],
      ltr = SK.getCoef('shared.longTermRate');
    const Bof = (lv, idx) => roundYuanFen(cityB * lm[lv][idx] * cf), Tof = (lv, idx) => tt[lv][idx] * 100;
    const cityLab = ENUMS.cityTier.find(x => x[0] === I1)[1], cycLab = ENUMS.cycleTier.find(x => x[0] === I2)[1];
    const cp = c.customPay || {};
    // 回款口径参考提成：rc = (T×(1−长期池) − 底薪) ÷ 月回款目标（销售用个人目标，主管/高管用公司目标分摊）
    const R = results(), mn = R && R.D ? Math.max(R.D.managerNeeded, 1) : 1;
    const Gc = {
      sales: c.targetPersonalMonthlyCollectWan > 0 ? c.targetPersonalMonthlyCollectWan * WAN : null,
      manager: c.targetYearCollectWan > 0 ? c.targetYearCollectWan * WAN / (12 * mn) : null,
      executive: c.targetYearCollectWan > 0 ? c.targetYearCollectWan * WAN / 12 : null,
    };
    const rcOf = (lv, B, T) => { const g = Gc[lv]; if (!g) return null; const gap = T * (1 - ltr) - B; return gap <= 0 ? null : gap / g; };
    const pctIn = v => v != null ? Math.round(v * 10000) / 100 : '';
    const margin = c.blendedMarginRate;
    const warns = []; let infeasible = false;
    // 一行：参考底薪 | 自定义底薪 | 参考提成(占回款) | 自定义提成 | 达标月收入
    const rowCells = (lv, key, idx, label) => {
      const cRow = cp[key] || {};
      const refB = Bof(lv, idx), T = Tof(lv, idx), surv = Bof(lv, 0);
      const custB = cRow.b > 0 ? cRow.b : null, B = custB != null ? roundYuanFen(custB) : refB;
      const refRc = rcOf(lv, B, T), rc = cRow.rc > 0 ? cRow.rc : refRc;
      if (B < surv) warns.push(`${label}：底薪 ${fmt.yuan(B)} 低于活命线 ${fmt.yuan(surv)}——低于这条线人留不住、还容易逼出动作变形（只提醒，不拦你）`);
      // 荒谬保护：参考提成 ≥ 毛利率 = 每收一块钱、提成先吃光毛利——不能当参考值上屏
      let rcCell;
      if (cRow.rc > 0) rcCell = '回款的 ' + fmt.pct(rc);
      else if (rc == null) rcCell = DASH;
      else if (margin > 0 && rc >= margin) { infeasible = true; rcCell = `<span style="color:var(--amber);font-weight:600">撑不起 ⚠</span>`; }
      else rcCell = '回款的 ' + fmt.pct(rc);
      return `
        <td class="num mono">${fmt.yuan(refB)}</td>
        <td class="num"><input type="number" data-bind="company.customPay.${key}.b" data-type="fen-yuan?"
          value="${custB != null ? Math.round(custB / 100) : ''}" placeholder="空=参考" style="width:96px" inputmode="numeric"></td>
        <td class="num mono">${rcCell}</td>
        <td class="num" style="white-space:nowrap"><input type="number" data-bind="company.customPay.${key}.rc" data-type="pct100?"
          value="${cRow.rc > 0 ? pctIn(cRow.rc) : ''}" placeholder="空=参考" step="0.1" style="width:76px" inputmode="decimal"> %</td>
        <td class="num mono">${fmt.yuan(T)}</td>`;
    };
    const gradeRows = ['effective', 'efficient', 'leading'].map(g => {
      const sel = c.tierGrade === g;
      return `<tr style="${sel ? 'background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)' : ''}">
        <td style="white-space:nowrap">${h.btn((sel ? '✓ ' : '') + '销售·' + GRADE_SHORT[g], 'dj.grade', { cls: 'sm' + (sel ? ' pri' : ' ghost'), data: `data-g="${g}"` })}
          <div class="hint" style="margin-top:3px;max-width:170px;white-space:normal">${GRADE_DESC[g]}</div></td>
        ${rowCells('sales', 'sales_' + g, gradeIndex(g), '销售·' + GRADE_SHORT[g])}</tr>`;
    });
    const cols = [{ t: '档位（点选给谁定薪）' }, { t: '参考底薪', num: 1 }, { t: '我要给的底薪（元/月）', num: 1 }, { t: '参考提成（占回款）', num: 1 }, { t: '我要给的提成', num: 1 }, { t: '达标月收入', num: 1 }];
    // 主管/高管：档位独立选择，同样可自定义
    const gmi = gradeIndex(c.mgrGrade), mgrCur = c.mgrGrade || 'effective';
    const subRows = ['manager', 'executive'].map(lv =>
      `<tr><td style="white-space:nowrap"><b>${levelName(lv)}</b><div class="hint" style="margin-top:3px;max-width:170px;white-space:normal">${LEVEL_DESC[lv]}</div></td>${rowCells(lv, lv, gmi, levelName(lv))}</tr>`);
    const mgrSeg = h.seg('company.mgrGrade', [{ v: 'effective', t: '初级' }, { v: 'efficient', t: '中级' }, { v: 'leading', t: '高级' }], mgrCur);
    const to = SK.DB.ui.tierOpen || {}, sOpen = to.sales !== false, mOpen = to.mgr === true;
    const head = (k, open, title, note) =>
      `<div data-act="dj.tier" data-k="${k}" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;margin-top:10px">
        <b style="font-size:12.8px">${title}</b> <span class="hint">${note}</span>
        <span class="hint" style="margin-left:auto;white-space:nowrap">${open ? '▾ 收起' : '▸ 展开'}</span>
      </div>`;
    // 已选档最终方案一句话（引擎口径，含自定义）
    const A = R ? R.A : null;
    const s = A ? A.sales : null;
    const planFeasible = !(s && s.custRc == null && margin > 0 && s.rc != null && s.rc >= margin);
    const planLine = s && s.r != null
      ? (planFeasible
        ? `<div style="margin-top:9px;padding:9px 12px;background:var(--accent-soft);border-radius:9px;font-size:13px"><b>✅ 你的销售方案：</b>底薪 <b>${fmt.yuan(s.B)}</b>${s.custB != null ? '（自定义）' : '（参考价）'} ＋ 回款的 <b>${s.rc != null ? fmt.pct(s.rc) : DASH}</b> 提成${s.custRc != null ? '（自定义）' : ''} → 达标月收入约 <b>${fmt.yuan(s.B + s.gapAmt + s.longAmt)}</b></div>`
        : `<div style="margin-top:9px;padding:9px 12px;background:var(--amber-soft,#fef3c7);border-radius:9px;font-size:13px">⚠ <b>按参考算撑不起这一档</b>：月回款目标只有 ${c.targetPersonalMonthlyCollectWan} 万，够不着该档市场收入。先核对目标（按「万元」填），或直接在上面「我要给的」里填你自己的底薪和提成。</div>`)
      : `<div class="hint" style="margin-top:8px">⬇︎ 填好第二步的「月回款目标」，这里会出参考提成和你的最终方案。</div>`;
    const salesBody = `
      ${h.tbl(cols, gradeRows)}
      ${planLine}
      ${h.hint('参考提成怎么来的：按你所在城市、该档销售的<b>市场达标月收入</b>倒推——底薪＋提成×月回款目标＋长期池＝达标月收入。它<b>与毛利率无关</b>（不管你卖什么行业的货，人才市场给这类销售的价就是这个数）；毛利率只用来判断这套方案你<b>付不付得起</b>——账单A里「全链提成负担占毛利 25–35% 健康带」那一条才看毛利率。')}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:10px 12px;background:var(--panel);border:1px solid var(--line);border-radius:9px">
        <label style="font-size:12.8px;font-weight:600;flex:1 1 auto;min-width:200px">不确定选哪档？输入你现在给销售的月底薪，点「帮我对号」＝自动选中最接近的档位（等于帮你点了那一行，立即生效）</label>
        <span>¥</span><input id="dj-gbase" type="number" placeholder="如 8000" style="width:110px" value="${gradeBaseDraft != null ? gradeBaseDraft : ''}">
        ${h.btn('帮我对号', 'dj.grade-match', { cls: 'sm' })}
        ${matchNote ? `<div class="hint" style="flex-basis:100%;color:var(--accent)">→ ${matchNote}</div>` : ''}
      </div>`;
    const mgrBody = `
      <div style="padding:8px 12px 11px;margin-top:6px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--card)">
        <div style="margin:2px 0 10px">${mgrSeg}</div>
        ${h.tbl(cols, subRows)}
        ${h.hint('主管/高管档位与销售档相互独立；同样可以直接填你要给的底薪和提成，填了就按你的算。')}
      </div>`;
    if (infeasible) warns.unshift(`有档位显示「撑不起」：按你填的月回款目标（${c.targetPersonalMonthlyCollectWan || '—'} 万/月），提成要吃掉的比例已超过毛利率（${fmt.pct(margin)}）——每收一块钱先亏一块。两种可能：① 月回款目标单位填错了（注意按「万元」填，3 万填 3 不是 30000）；② 你的生意撑不起这一档的市场收入——选低一档，或直接在「我要给的」里填你自己的底薪和提成。`);
    return `
      ${head('sales', sOpen, '① 给销售定薪', `（${cityLab} · ${cycLab} · 当前按「${GRADE_SHORT[c.tierGrade] || '未定'}」档算 · 参考价可直接改）`)}
      ${sOpen ? salesBody : ''}
      ${head('mgr', mOpen, '② 给主管 / 高管定薪', `（单独定档 · 当前「${GRADE_SHORT[mgrCur]}」档 · 同样可自定义）`)}
      ${mOpen ? mgrBody : ''}
      ${warns.length ? warns.map(w => h.banner('🟡 ' + w, 'a')).join('') : ''}`;
  }

  /* ---- 五张账单 ---- */
  function vDash() {
    const R = results();
    if (!R || (!R.A && !R.B && !R.C)) {
      return `<div class="sect"><h2>五张账单</h2></div>
        ${h.banner('还没有账单——在「输入面板」把共享字段填全，这里会实时展开明细。', 'n')}
        ${h.btn('去输入面板', 'ui.nav', { cls: 'pri', data: 'data-board="dingjia" data-sub="input"' })}`;
    }
    let out = `<div class="sect"><h2>五张账单</h2><span class="sub">算 ${R.targetYear} 年 · 销售按${GRADE_SHORT[R.inp.tierGrade]}档、管理层按${GRADE_SHORT[R.inp.mgrGrade]}档 · 每张账单点开看明细，改任何输入实时重算</span>
      <span style="margin-left:auto;display:flex;gap:6px">${h.btn('保存场景', 'dj.scn-save', { cls: 'sm' })}${h.btn('签发信用书', 'dj.cov-issue', { cls: 'sm' })}</span></div>`;
    // 总漏损条
    if (R.total) {
      const annual = R.total.annual, expose = R.total.expose;
      out += `<div class="card" style="background:linear-gradient(135deg,#191640,#2f2a6b 55%,#4a2f78);color:#fff;border:none">
        <div style="font-size:11.5px;color:#c4b5fd;font-weight:600;letter-spacing:.05em">照现在这么干，今年大约要白白亏掉</div>
        <div class="mono" style="font-size:38px;font-weight:800;letter-spacing:-.02em;margin:4px 0 8px">${fmt.wan(R.total.total)}</div>
        <div style="font-size:12.8px;color:#c9c5ea;line-height:1.6;max-width:680px">两笔钱：人员流失要亏 ${fmt.wan(annual)}（账单C）＋ 招人招少了要差 ${fmt.wan(expose)}（账单B）。都不在报表上，但都是真的。</div>
        <div style="display:flex;height:7px;border-radius:6px;overflow:hidden;margin-top:13px;max-width:520px">
          <span style="flex:${Math.max(annual, 1)};background:#f472b6"></span><span style="flex:${Math.max(expose, 1)};background:#a78bfa"></span></div>
        <div style="display:flex;gap:16px;font-size:10.5px;color:#a8a3d4;margin-top:5px;max-width:520px"><span>■ 人员流失亏的</span><span style="color:#c4b5fd">■ 少招人差的</span></div>
      </div>`;
    }
    out += `<div class="grid g2" style="margin-top:10px;align-items:start">`;
    if (R.A) out += `<div class="span2">${cardAHtml(R)}</div>`;
    out += R.B ? cardBHtml(R) : dcard('B', '账单B · 该招几个人', '去年人均回款缺失', DASH, '该招几人', `<div class="hint">「想算得更准」里的去年人均回款为 0，整卡无法计算，显“—”。</div>`);
    if (R.C) out += cardCHtml(R);
    if (R.D) out += cardDHtml(R);
    if (R.E) out += cardEHtml(R);
    out += `</div>`;
    out += `<div style="margin-top:12px;display:flex;align-items:center;gap:8px">
      ${h.btn('🔬 防钻空子体检（选用）→', 'ui.nav', { cls: 'sm ghost', data: 'data-board="dingjia" data-sub="wt"' })}
      <span class="hint">发方案之前，模拟一下员工会怎么钻这套方案的空子——想看再点，不看不影响。</span></div>`;
    return out;
  }
  function cardAHtml(R) {
    const A = R.A, s = A.sales;
    const rowsHtml = A.rows.map(r => `<tr><td>${levelName(r.level)}${r.custB != null || r.custRc != null ? ' <span class="hint">（自定义）</span>' : ''}</td>
      <td class="num ${r.belowMinWage ? '' : ''}" style="${r.belowMinWage ? 'color:var(--red);font-weight:600' : ''}">${fmt.yuan(r.B)}${r.belowMinWage ? ' ⚠︎' : ''}</td>
      <td class="num">${fmt.yuan(r.T)}</td><td class="num">${r.blocked ? DASH : (r.rc != null ? '回款的 ' + fmt.pct(r.rc) : fmt.pct(r.r))}</td><td class="num">${r.count != null ? r.count : DASH}</td></tr>`);
    const [cb, cg, cl] = A.comp;
    const gi = A.goodHire, giTone = gi < 1 ? 'r' : gi < 1.2 ? 'a' : gi < 1.4 ? 'g' : 'gold';
    const giLab = gi < 1 ? '🔴 偏低' : gi < 1.2 ? '🟡 及格' : gi < 1.4 ? '🟢 好招' : '🏅 极好招';
    const bTone = A.burdenRate > 0.35 ? 'r' : A.burdenRate < 0.25 ? 'a' : '';
    const verdict = A.burdenRate == null ? '数据不全'
      : A.burdenRate > 0.35 ? `不健康：全公司提成要吃掉目标毛利的 ${fmt.pct(A.burdenRate)}（上限 35%）——按这套发工资，目标毛利撑不住`
      : A.burdenRate < 0.25 ? `偏抠：提成总盘子只占目标毛利 ${fmt.pct(A.burdenRate)}（低于 25%）——好销售看不上`
      : `健康：提成总盘子占目标毛利 ${fmt.pct(A.burdenRate)}（25–35% 之间）——给得起，也够香`;
    const vShort = verdict.includes('：') ? verdict.slice(0, verdict.indexOf('：')) : verdict;
    let body = plain3('这样定薪，公司亏不亏、人来不来？', verdict,
      '两头看：①下面表里的「达标月收入」跟市场价比，决定招不招得到人；②全公司提成加起来占目标毛利的比例，决定你亏不亏。');
    if (A.anyBlocked) body += gate('red', W_TEXT['W-02']({ row: A.rows.find(r => r.blocked) }));
    A.rows.filter(r => (r.custB != null || r.custRc != null) && r.belowSurvival).forEach(r => {
      body += gate('amber', `${levelName(r.level)}自定义底薪 ${fmt.yuan(r.B)} 低于活命线（${fmt.yuan(r.survivalB)}）——低于这条线人留不住、容易逼出动作变形。只提醒，不拦你。`);
    });
    body += h.tbl([{ t: '层级' }, { t: '底薪', num: 1 }, { t: '达标月收入', num: 1 }, { t: '提成（占回款）', num: 1 }, { t: '目标人数', num: 1 }], rowsHtml);
    body += `<div class="hint" style="margin-top:6px">销售的钱怎么构成（底薪 : 提成 : 年底分红池）</div>`;
    body += compbar([[cb, cb, '#6366f1'], [cg, cg, '#f59e0b'], [cl, cl, '#10b981']]);
    body += `<div style="margin:10px 0">${h.badge(`这个待遇好不好招人：${gi.toFixed(2)} · ${giLab}`, giTone, true)}<span class="hint" style="margin-left:8px">（你给的钱 ÷ 市场价，1 以上才好招）</span></div>`;
    if (A.burdenRate != null) {
      body += `<div class="hint">全公司提成加起来，占目标毛利多少（25–35% 之间最健康）</div>${h.meter(A.burdenRate / 0.5, bTone, [0.5, 0.7])}${meterCap('0%', '健康 25–35%', '50%+')}`;
    }
    A.gates.filter(g => g.id !== 1).forEach(g => {
      body += gate(g.light, (W_TEXT[g.code] || (() => ''))(Object.assign({ burdenRate: A.burdenRate, marginRate: A.marginRate }, g)));
    });
    body += killer('提成越高、底薪越低，越是在赌员工拿命换钱——好方案是普通人踏实干就能拿到数，而不是逼人变成赌徒。');
    body += h.src(`📎 怎么算的：参考底薪 = 城市基数 × 层级倍数 × 成单周期系数；达标月收入 = 该城市该档位的市场价；提成 = (达标收入×90% − 底薪) ÷ 月回款目标。你自定义的值以你为准。全口径人力成本（含社保、分红池）约占目标毛利 ${A.fullBurden != null ? fmt.pct(A.fullBurden) : DASH}。`);
    return dcard('A', '账单A · 这样定薪亏不亏', `${vShort} · 销售${GRADE_SHORT[R.inp.tierGrade]}档`, s.rc != null ? '回款的 ' + fmt.pct(s.rc) : (s.r != null ? fmt.pct(s.r) : DASH), '销售提成', body);
  }
  function cardBHtml(R) {
    const B = R.B;
    const rows = [
      ['① 目标全靠老手干，需要几个人', B.fullCap.toFixed(2) + ' 人'],
      ['② 拍脑袋算：还差几个', B.S1 + ' 人'],
      ['③ 今年预计还会走掉几个', B.expAttr.toFixed(2) + ' 人'],
      ['④ 补上流失后，实际缺多少人的活儿', B.gapCap.toFixed(2) + ' 人'],
      ['⑤ 新人第一年只能顶老手的几成', (B.kEff1 * 100).toFixed(1) + '%'],
      ['⑥ 所以真实要招', `<b>${B.S6} 人</b>`],
      ['拍脑袋比真实少算了', B.overRate != null ? fmt.pct(B.overRate) : DASH],
      ['少招的人今年注定差的钱', fmt.wan(B.exposeAmt)],
      ['最晚哪天必须开始招', `${B.latestHire || DASH}${B.isLate ? `（已经晚了 ${B.lateDays} 天）` : '（还来得及）'}`],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    const late = B.isLate
      ? (R.inp.targetYearMode === 'this'
        ? `你已经晚了 ${B.lateDays} 天——今天不动手，今年目标从现在就开始漏。`
        : `再不动手，明年目标从今天就开始漏。`)
      : `最晚 ${B.latestHire} 必须开始招。`;
    let body = plain3(`${B.targetYear} 年这个目标，到底要招几个人？`,
      `拍脑袋算要招 ${B.S1} 个 → 真实要招 <b>${B.S6}</b> 个，${late}`,
      '为什么差这么多：新人第一年顶不了一个老手（要爬坡），今年还会走人——这两笔账拍脑袋时都没算。');
    body += h.tbl([{ t: '一步步看' }, { t: '数值', num: 1 }], rows);
    body += `${h.spark(SK.RAMP[R.inp.cycleTier], B.ramp80)}<div class="hint">新人成长曲线：入职后每个月能顶老手的几成（虚线＝干到八成功力的第 ${B.ramp80} 个月）</div>`;
    if (B.stretch) body += gate('amber', W_TEXT['W-09']());
    body += `<div class="hint" style="margin-top:8px">算的是哪一年：${B.targetYear}　${h.btn(R.inp.targetYearMode === 'this' ? '改算明年' : '改算今年', 'dj.ty', { cls: 'sm ghost' })}</div>`;
    body += `<div style="margin-top:8px;display:flex;align-items:center;gap:8px">${h.btn('去招人器看完整招聘计划 →', 'ui.nav', { cls: 'sm ghost', data: 'data-board="zhaoren"' })}<span class="hint">和招人器用同一份数据 ${h.linked()}</span></div>`;
    return dcard('B', '账单B · 该招几个人', `拍脑袋 ${B.S1} 人 → 真实 ${B.S6} 人`, `${B.S6}`, '真实要招几个', body);
  }
  function cardCHtml(R) {
    const C = R.C;
    const rows = [
      ['① 位子空着的损失（招到人之前，这份业绩没人干）', fmt.wan(C.idle)],
      ['② 新人顶不上的损失（成长期干不出老手的量）', fmt.wan(C.rampGap)],
      ['③ 招聘花的钱（渠道费、面试成本）', `${fmt.wan(C.recruitFee)} ${h.btn('改', 'dj.fee', { cls: 'sm ghost' })}`],
      ['走一个熟手，三项加起来亏', `<b>${fmt.wan(C.tag)}</b>`],
      ['按你的流失速度，今年一共要亏', `<b>${fmt.wan(C.annual)}</b>`],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    let body = plain3('走一个熟手销售，你实际亏多少钱？',
      `一个人 ≈ <b>${fmt.wan(C.tag)}</b>，按今年的流失速度全年 ≈ <b>${fmt.wan(C.annual)}</b>`,
      '这笔钱工资单上看不见：位子空着、新人顶不上、招聘花钱——三笔都是真金白银。');
    body += h.tbl([{ t: '亏在哪' }, { t: '金额', num: 1 }], rows);
    body += `<div class="hint" style="margin-top:6px">三笔损失的占比</div>`;
    body += compbar([[Math.max(C.idle, 1), '位子空着', '#6366f1'], [Math.max(C.rampGap, 1), '新人顶不上', '#f59e0b'], [Math.max(C.recruitFee, C.tag * 0.03), '招聘费', '#10b981']]);
    body += killer('最大的一块是「新人顶不上」——所以让新人更快出活，比压流失率更值钱。');
    body += h.src('📎 这是快算版（3 项）。留人器里有更全的 6 项算法（含客户流失、团队士气），数字会更大。');
    return dcard('C', '账单C · 走一个人亏多少钱', `一个 ${fmt.wan(C.tag)} · 全年 ${fmt.wan(C.annual)}`, fmt.wan(C.tag), '走一个熟手亏', body);
  }
  function cardDHtml(R) {
    const D = R.D, B = R.B;
    const rows = [
      ['一个主管每周真正能用来带人的时间', D.availH + ' 小时'],
      ['所以一个主管最多带好', D.spanCap + ' 个人'],
      ['你规划的总人数', D.heads + ' 人'],
      ['需要主管', `<b>${D.managerNeeded} 个</b>`],
      ['现在还缺', `<b>${D.gap} 个</b>`],
      ['照现在的配置，每个销售每周只能被辅导', (isFinite(D.coachMin) ? D.coachMin : DASH) + ' 分钟'],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    const S6 = B && B.ok ? B.S6 : DASH;
    let body = plain3('这些人需要几个主管带？',
      `需要 <b>${D.managerNeeded}</b> 个主管，现在缺 <b>${D.gap}</b> 个`,
      '一个主管开完会、处理完杂事，每周能实实在在带人的时间就 9 小时左右——最多带好 8 个人，超了就是放羊。');
    body += h.tbl([{ t: '一步步看' }, { t: '数值', num: 1 }], rows);
    body += killer(`你要招的不只是 ${S6} 个销售，还有 ${D.gap} 个主管——没人带的新人，走得更快、出活更慢。`);
    return dcard('D', '账单D · 该配几个主管', `需 ${D.managerNeeded} 个 · 缺 ${D.gap} 个`, `${D.gap}`, '还缺几个主管', body);
  }
  function cardEHtml(R) {
    const c = SK.DB.company;
    const E = R.E, light = E.light, dot = light === 'green' ? '🟢' : light === 'amber' ? '🟡' : '🔴';
    const rows = [
      ['团队大小（人越多，越容易有人躺平沾光）', E.sizeScore.toFixed(0) + ' 分'],
      ['要不要互相配合（越需要配合，团队奖越有用）', E.compScore.toFixed(0) + ' 分'],
      ['谁的功劳分不分得清（分得越清，越该发个人奖）', E.visScore.toFixed(0) + ' 分'],
      ['综合打分', `<b>${E.TIS.toFixed(0)}</b> 分（70 分以上再发）`],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    const tone = light === 'green' ? '' : light === 'amber' ? 'a' : 'r';
    const msg = light === 'green' ? '可以发：团队小、要配合、功劳看得清——团队奖能起作用。'
      : light === 'amber' ? '慎发：先弄清楚谁的功劳是谁的，再考虑团队奖。'
      : '别发：人多、各干各的、分不清谁的功——团队奖只会养懒人。';
    let body = plain3('团队奖该不该发？', `${dot} <b>${msg.slice(0, msg.indexOf('：'))}</b>（${E.TIS.toFixed(0)} 分，70 分及格）`,
      msg.slice(msg.indexOf('：') + 1));
    body += `<div class="grid g2" style="margin-bottom:8px">
      ${h.field('你的团队怎么干活', h.seg('company.complementLevel', ENUMS.complementLevel.map(([v, t]) => ({ v, t })), c.complementLevel), '改一下，分数实时变')}
      ${h.field('谁签的单分得清吗', h.seg('company.attributableLevel', ENUMS.attributableLevel.map(([v, t]) => ({ v, t })), c.attributableLevel))}
    </div>`;
    body += h.tbl([{ t: '打分依据' }, { t: '得分', num: 1 }], rows);
    body += h.meter(E.TIS / 100, tone, [0.4, 0.7]) + meterCap('0', '40 以下别发 · 40–70 慎发 · 70 以上可发', '100');
    return dcard('E', '账单E · 团队奖该不该发', msg.slice(0, msg.indexOf('：')), `${dot} ${E.TIS.toFixed(0)}`, '团队奖打分', body);
  }

  /* ---- 方案风洞 ---- */
  function vWT() {
    ensureAudit();
    const R = results();
    if (!R || !R.A) {
      return `<div class="sect"><h2>防钻空子体检</h2></div>
        ${h.banner('先到「三步定薪」把底薪和目标填好，再回来做体检。', 'n')}
        ${h.btn('去三步定薪', 'ui.nav', { cls: 'pri', data: 'data-board="dingjia" data-sub="input"' })}`;
    }
    return `<div class="sect"><h2>防钻空子体检 <span class="hint" style="font-weight:400">（选用的专业检查）</span></h2><span class="sub">方案发下去之前，先模拟员工会怎么钻空子。四个检查独立使用，看得懂哪个用哪个。</span>
      <span style="margin-left:auto">${h.btn('← 回五张账单', 'ui.nav', { cls: 'sm ghost', data: 'data-board="dingjia" data-sub="dash"' })}</span></div>
      ${wtGatesHtml(R)}${wtSandboxHtml()}${wtMenuHtml(R)}${wtGuardrailHtml(R)}`;
  }
  function wtMenuHtml(R) {
    const A = R.A;
    let body = '';
    if (A.hungerBait) {
      body = gate('red', W_TEXT['W-19']());
    } else {
      body = `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">
        <div class="field" style="flex:1;min-width:140px"><label>基准配额 <span class="hint">（万元/季）</span></label><input id="dj-mquota" type="number" placeholder="如 100" value="${menuDraft.quota != null ? menuDraft.quota / WAN : ''}"></div>
        <div class="field" style="flex:1;min-width:140px"><label>基准奖金 <span class="hint">（元）</span></label><input id="dj-mbonus" type="number" placeholder="如 30000" value="${menuDraft.bonus != null ? menuDraft.bonus / 100 : ''}"></div>
        ${h.btn('生成三档', 'dj.menu-gen', { cls: 'sm pri' })}</div>`;
      if (menuRes && menuRes.tiers) {
        const names = ['稳妥档', '基准档', '冲刺档'];
        body += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px">` +
          menuRes.tiers.map((t, i) => `<div style="border:1px solid ${i === 2 ? 'var(--gold)' : 'var(--line)'};border-radius:11px;padding:14px;text-align:center;background:${i === 2 ? 'var(--gold-soft)' : 'var(--panel)'}">
            <div class="hint" style="font-weight:600;text-transform:uppercase;letter-spacing:.04em">${names[i]}</div>
            <div class="mono" style="font-size:21px;font-weight:780;margin:7px 0 2px">${fmt.wan(t.quota)}</div>
            <div class="mono" style="color:var(--accent);font-weight:680">奖金 ${fmt.yuan(t.bonus)}</div>
            <div class="hint" style="margin-top:7px">大约 ${fmt.pct(t.P)} 的人能干到 · 每做 1 万任务奖 ${(t.bonus / (t.quota / 1e6)).toFixed(0)} 元</div>
          </div>`).join('') + `</div>`;
        body += h.hint('三档你平均要花的钱完全一样（误差 ≤3%）——员工挑哪档你都不吃亏。选择一经登记不可撤销：他选的目标他认，你承诺的奖金你不能改。');
        if (menuRes.adjusted) body += h.hint('稳妥档奖金自动微调过（保证「干得越多、单位回报越高」），微调方向对你有利。');
        body += `<div style="margin-top:10px">${h.btn('登记选择（不可撤销 🔒）', 'dj.menu-reg', { cls: 'sm' })}</div>`;
      }
    }
    return h.card('③ 目标改成三选一（进阶玩法）', `<p class="hint" style="margin-bottom:8px">同样的预算，把「派下去的任务」换成「稳妥/标准/冲刺三档自己挑」——你一分钱不多花，员工却对自己挑的目标更认账。填一个基准任务和基准奖金，系统生成等价三档。</p>${body}`);
  }
  function wtGatesHtml(R) {
    const a = SK.DB.audit;
    const sz = SK.X('suanzhang');
    const p90Real = (sz && sz.realP90Factor != null) ? sz.realP90Factor : null;
    let out = `<div class="grid g2" style="margin-bottom:0">
      ${h.field('要检查的岗位', h.seg('audit.positionType', ENUMS.positionType.map(([v, t]) => ({ v, t })), a.positionType))}
      ${h.field('这个岗位现在按什么提成', h.seg('audit.currentCommissionBase', ENUMS.commissionBaseType.map(([v, t]) => ({ v, t })), a.currentCommissionBase))}
    </div>
    ${h.field('现在给的底薪（元/月）', h.input('audit.currentBaseSalaryAmt', 'fen-yuan', { value: a.currentBaseSalaryAmt != null ? Math.round(a.currentBaseSalaryAmt / 100) : '', ph: '如 6000' }))}`;
    if (a.currentBaseSalaryAmt != null && a.currentBaseSalaryAmt > 0) {
      const fr = gateFraudRisk(a, R.inp, p90Real);
      const p90Src = p90Real != null ? `（算账器真实值）${h.linked('算账器联动')}` : '（全球默认 1.8）';
      out += gate(fr.light, fr.code === 'ok'
        ? `造假风险闸：人均目标为真实产能上限的 ${fmt.pct(fr.ratioCur)}（未过 130% 红线）。p90 口径 ${fr.p90Eff}${p90Src}。`
        : `${W_TEXT[fr.code](fr)}<div class="hint" style="margin-top:4px">p90 口径 ${fr.p90Eff}${p90Src}</div>`);
    } else {
      out += h.hint('填一下你现在给的底薪，系统判断「目标 vs 底薪」这个组合会不会把人逼到造假那条路上。');
    }
    const al = gateAlignment(a);
    out += gate(al.light, al.code === 'ok' ? '提成方向检查：员工多挣钱的方向 = 客户得好处的方向，没问题。' : W_TEXT[al.code]());
    return h.card('① 会不会逼人造假 / 提成方向对不对', `<p class="hint" style="margin-bottom:8px">两个致命检查：目标定太高+底薪太低会逼人造假；提成方向不对会让员工坑客户。只有纯销售岗的公司，岗位类型选「纯销售」即可。</p>${out}`);
  }
  function wtGuardrailHtml(R) {
    const a = SK.DB.audit;
    const segBtns = ENUMS.guardrailMetric.map(([v, t]) =>
      h.btn(t + (a.guardrailMetric === v ? ' ✓' : ''), 'dj.guard', { cls: 'sm' + (a.guardrailMetric === v ? ' pri' : ' ghost'), data: `data-v="${v}"` })).join(' ');
    let out = h.field('挑一个兜底指标一起盯（点选，再点取消）', `<div style="display:flex;gap:6px;flex-wrap:wrap">${segBtns}</div>`, '不用精确数字——你平时看哪个顺手就选哪个，目的是别让回款一个数遮住所有问题');
    out += h.field('你现在设了几条「最低要求」（日报条数、打卡次数这类）', `<div style="display:flex;align-items:center;gap:8px">
      ${h.btn('−', 'dj.pr', { cls: 'sm ghost', data: 'data-d="-1"' })}<b style="min-width:24px;text-align:center">${a.processRedlineCount}</b>${h.btn('＋', 'dj.pr', { cls: 'sm ghost', data: 'data-d="1"' })}</div>`);
    const gr = checkGuardrail(true, a.guardrailMetric);
    if (gr.locked) out += gate('amber', W_TEXT['W-22']());
    const pr = countProcessRedlines(a.processRedlineCount);
    if (pr.warn) out += gate('amber', W_TEXT['W-23'](pr));
    out += `<label style="display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin:8px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" data-bind="audit.explorationMode" data-type="bool" ${a.explorationMode ? 'checked' : ''}>
      <span>我在开新市场 / 推新产品：用「保底期」代替月度提成压人</span></label>`;
    if (a.explorationMode) {
      const ec = explorationContract(R.inp);
      out += gate('green', `📋 ${W_TEXT['W-24'](ec)}`);
      out += h.hint('开拓期不搞月度冲刺：新市场要的是试错空间，不是月度压强。');
    }
    return h.card('④ 防动作变形（进阶）', `<p class="hint" style="margin-bottom:8px">只盯回款一个数，员工的动作会变形（砍价、乱承诺、冷落老客）。这里帮你配一个「兜底指标」一起盯；「最低要求」别设太多；开新市场用保底期代替月度提成。</p>${out}`);
  }
  function wtSandboxHtml() {
    const a = SK.DB.audit;
    let out = CONTROLS.map(([v, l]) => `<label style="display:flex;align-items:center;gap:9px;padding:8px 11px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px;font-size:13px;cursor:pointer">
      <input type="checkbox" data-act="dj.leak" data-m="${v}" ${a.controlMeasures.includes(v) ? 'checked' : ''}><span>${l}</span></label>`).join('');
    const rows = leakSandbox(a.controlMeasures);
    if (!rows.length) {
      out += gate('green', `💧 ${W_TEXT['W-26']()}`);
    } else {
      out += h.tbl([{ t: '控制手段' }, { t: '泄漏出口' }, { t: '出口价格' }, { t: '认领监测' }],
        rows.map(r => `<tr><td>${controlLabel(r.measure)}</td><td>${r.exit}</td><td>${r.price}</td>
          <td><label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" data-act="dj.claim" data-m="${r.measure}" ${a.claimedOutlets.includes(r.measure) ? 'checked' : ''}><span>${r.watch}</span></label></td></tr>`));
      out += gate('amber', `🚰 ${W_TEXT['W-25']({ n: rows.length })}`);
    }
    return h.card('② 你的管控会被从哪儿钻空子', `<p class="hint" style="margin-bottom:8px">勾选你现在用的管控手段（不许降价、月底冲刺……），系统告诉你员工会从哪儿绕过去、代价是什么。堵不死所有口子——挑一个你付得起的盯住就行。</p>${out}`);
  }

  /* ---- 场景与信用书 ---- */
  const SNAP_FIELDS = ['cityTier', 'cycleTier', 'tierGrade', 'mgrGrade', 'complementLevel', 'attributableLevel', 'targetYearMode',
    'targetYearGrossWan', 'lastYearPerCapitaWan', 'targetPersonalMonthlyGrossWan', 'attritionRate', 'hiringCycleDays', 'blendedMarginRate', 'fullLoadWan',
    'targetYearCollectWan', 'lastYearPerCapitaCollectWan', 'targetPersonalMonthlyCollectWan', 'leaversLastYear', 'customPay'];
  function snapCompany() {
    const c = SK.DB.company, s = {};
    SNAP_FIELDS.forEach(f => { s[f] = c[f]; });
    return JSON.parse(JSON.stringify(s));
  }
  function genCovCode() {
    const t = SK.today(), yy = t.slice(2, 4), mm = t.slice(5, 7), dd = t.slice(8, 10);
    const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = Array.from({ length: 4 }, () => CH[Math.floor(Math.random() * 32)]).join('');
    return `SK-${yy}${mm}${dd}-${r}`;
  }
  function vData() {
    const scns = SK.DB.scenarios || [], covs = SK.DB.covenantDocs || [], mcs = SK.DB.menuChoices || [];
    return `
    <div class="sect"><h2>场景与信用书</h2><span class="sub">场景=共享字段 13 项快照；信用书与菜单登记一经签发不可撤销。全量备份在「数据中心」统一做。</span></div>
    <div class="grid g2" style="align-items:start">
      ${h.card('已保存场景', (scns.length ? scns.map(s => `<div class="kv"><span class="k"><b>${esc(s.name)}</b> <span class="hint">${s.createdDate}</span></span>
          <b style="display:flex;gap:6px">${h.btn('载入', 'dj.scn-load', { cls: 'sm ghost', data: `data-id="${s.scenarioId}"` })}${h.btn('删除', 'dj.scn-del', { cls: 'sm danger', data: `data-id="${s.scenarioId}"` })}</b></div>`).join('')
        : h.hint('还没有保存的场景。到「五张账单」点“保存场景”。')) + `<div style="margin-top:8px">${h.btn('保存当前为场景', 'dj.scn-save', { cls: 'sm' })}</div>`)}
      ${h.card('招聘信用书', (covs.length ? covs.map(cv => `<div class="kv"><span class="k"><b>${esc(cv.candidateName)}</b> · <span class="mono">${cv.code}</span>
          <div class="hint">底薪 ${fmt.yuan(cv.snapshot.baseSalaryAmt)} · 达标 ${fmt.yuan(cv.snapshot.thresholdTAmt)} · ${cv.issuedDate}</div></span>
          <b>${h.btn('查看/重打', 'dj.cov-show', { cls: 'sm ghost', data: `data-id="${cv.covenantId}"` })}</b></div>`).join('')
        : h.hint('还没有签发的信用书。到「五张账单」点“签发信用书”。')) + `<div style="margin-top:8px">${h.btn('签发招聘信用书', 'dj.cov-issue', { cls: 'sm pri' })}</div>`
        + h.hint('信用书 = 把「底薪多少、提成多少」白纸黑字发给候选人，一经签发不能反悔下调——招人时最有说服力的一张纸。'))}
    </div>
    ${h.card(`菜单登记（不可撤销 🔒 · ${mcs.length} 条）`, mcs.length ? h.tbl(
      [{ t: '销售' }, { t: '所选档' }, { t: '配额', num: 1 }, { t: '奖金', num: 1 }, { t: '登记日', num: 1 }],
      mcs.map(m => {
        const tierIdx = { low: 0, mid: 1, high: 2 }[m.chosenTier], t = m.menuSnapshot && m.menuSnapshot[tierIdx];
        return `<tr><td><b>${esc(m.salespersonName)}</b></td><td>${{ low: '稳妥档', mid: '基准档', high: '冲刺档' }[m.chosenTier] || m.chosenTier} 🔒</td>
          <td class="num">${t ? fmt.wan(t.quotaAmt) : DASH}</td><td class="num">${t ? fmt.yuan(t.bonusAmt) : DASH}</td><td class="num">${m.chosenDate}</td></tr>`;
      })) : h.hint('还没有登记的三选一目标。到「五张账单 → 防钻空子体检 → 目标改成三选一」生成后登记。'))}`;
  }
  function covModalHtml(cv) {
    const s = cv.snapshot;
    return `<div style="max-height:72vh;overflow:auto">
      <div style="border:4px double #b91c1c;padding:30px 32px;position:relative;background:#fff;color:#111;border-radius:2px">
        <div style="position:absolute;top:16px;right:18px;color:#b91c1c;border:2px solid #b91c1c;padding:4px 11px;border-radius:6px;transform:rotate(-3deg);font-weight:700;font-size:12.5px;letter-spacing:.05em">${cv.code}</div>
        <h1 style="text-align:center;font-size:20px;letter-spacing:.1em;margin:0 0 8px;color:#111">销售岗位薪酬信用书</h1>
        <div style="font-size:14px;line-height:2.1;margin:22px 0">兹承诺：<b style="border-bottom:1px solid #333;padding:0 4px">${esc(cv.candidateName)}</b> 入职后担任<b>销售</b>（<b>${gradeFull(s.tierGrade)}</b>档），
          月度底薪 <b>${fmt.yuan(s.baseSalaryAmt)}</b>；月度达标收入 <b>${fmt.yuan(s.thresholdTAmt)}</b>（含提成，${s.commissionRateCollect != null ? `提成按回款口径、比例 <b>${fmt.pct(s.commissionRateCollect)}</b>` : `提成按毛利口径、比例 <b>${s.commissionRate != null ? fmt.pct(s.commissionRate) : '—'}</b>`}）；
          本信用书编号 <b>${cv.code}</b>，一经签发，条款不因业绩上调而单方下调。</div>
        <div style="font-size:11.5px;color:#555;background:#faf5f0;border-left:3px solid #b91c1c;padding:11px 13px;line-height:1.7">依中国劳动法与司法实践，用人单位单方下调已约定提成/降薪，须负举证责任并经民主程序，否则劳动者可主张按原标准补发。本信用书即把这份「不可单方反悔」白纸黑字化——它保护员工，也帮你少打一场大概率会输的仲裁。</div>
        <div style="margin-top:30px;display:flex;justify-content:space-between;font-size:13px;color:#333"><div>签发日期：${cv.issuedDate}</div><div>——公司盖章处——</div></div>
        <div style="margin-top:20px;font-size:10.5px;color:#999;text-align:center">本报告为经营测算参考，不构成法律、税务或投资建议。</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${h.btn('关闭', 'ui.modal-close')}${h.btn('🖨 打印', 'ui.print', { cls: 'pri' })}</div>
    </div>`;
  }

  /* ================= 6. 动作 ================= */
  Object.assign(SK.actions, {
    'dj.card': d => { const oc = SK.DB.ui.openCards || (SK.DB.ui.openCards = {}); oc[d.key] = !oc[d.key]; UI.commit(); },
    'dj.tier': d => {                                       // ① 销售档 / ② 主管高管档 收合（持久化，修复重渲复位 bug）
      const to = SK.DB.ui.tierOpen || (SK.DB.ui.tierOpen = { sales: true, mgr: false });
      const cur = d.k === 'sales' ? (to.sales !== false) : (to.mgr === true);
      to[d.k] = !cur; UI.commit();
    },
    'dj.ty': () => { SK.DB.company.targetYearMode = SK.DB.company.targetYearMode === 'this' ? 'next' : 'this'; UI.commit(); },
    'dj.more': () => { SK.DB.ui.pricingMoreOpen = SK.DB.ui.pricingMoreOpen !== true; UI.commit(); },   // 「想算得更准」折叠开合
    'dj.grade': d => { SK.DB.company.tierGrade = d.g; gradeBaseDraft = null; matchNote = ''; UI.commit(); },
    'dj.grade-match': () => {
      const inp = document.getElementById('dj-gbase'); if (!inp) return;
      const v = parseFloat(inp.value);
      if (isNaN(v)) { UI.toast('先输入现行月底薪（元）'); return; }
      const c = SK.DB.company;
      if (!c.cityTier || !c.cycleTier) { UI.toast('先选城市线级与成交周期档'); return; }
      const cityB = SK.getCoef('dingjia.cityBase')[c.cityTier], cf = SK.getCoef('dingjia.cycleFactor')[c.cycleTier],
        lm = SK.getCoef('dingjia.levelMultiplier');
      const cand = ['effective', 'efficient', 'leading'].map(g => ({ g, B: roundYuanFen(cityB * lm.sales[gradeIndex(g)] * cf) }));
      const fen = Math.round(v * 100);
      let best = cand[0]; cand.forEach(x => { if (Math.abs(x.B - fen) < Math.abs(best.B - fen)) best = x; });
      const lo = cand[0].B, hi = cand[2].B;
      matchNote = fen < lo * 0.98 ? `低于「初级」矩阵底薪（${fmt.yuan(lo)}）——可能偏低；已按初级档算。`
        : fen > hi * 1.02 ? `高于「高级」矩阵底薪（${fmt.yuan(hi)}）——已按高级档算。`
        : `≈ 最接近「${GRADE_SHORT[best.g]}（${GRADE_TECH[best.g]}）」档（矩阵 ${fmt.yuan(best.B)}）。已为你选定该档。`;
      gradeBaseDraft = v;
      SK.DB.company.tierGrade = best.g;
      UI.commit();
    },
    'dj.fee': () => {
      const cur = SK.getCoef('shared.recruitFeeDefaultAmt') / WAN;
      const v = prompt('招聘直接费（万元）', cur);
      if (v != null && !isNaN(+v)) {
        SK.DB.coefOverrides['shared.recruitFeeDefaultAmt'] = Math.round(+v * WAN);
        UI.commit(); UI.toast('已更新招聘费并落库');
      }
    },
    'dj.menu-gen': () => {
      const q = parseFloat((document.getElementById('dj-mquota') || {}).value),
        bo = parseFloat((document.getElementById('dj-mbonus') || {}).value);
      menuDraft = { quota: isNaN(q) ? null : Math.round(q * WAN), bonus: isNaN(bo) ? null : Math.round(bo * 100) };
      const R = results();
      menuRes = generateMenu(menuDraft.quota, menuDraft.bonus, !!(R && R.A && R.A.hungerBait));
      if (!menuRes) UI.toast('请填入基准配额与基准奖金');
      UI.render();
    },
    'dj.menu-reg': () => {
      if (!menuRes || !menuRes.tiers) return;
      const nm = prompt('销售姓名'); if (!nm) return;
      const tier = prompt('选哪档？ low/mid/high', 'mid'); if (!tier) return;
      const map = { low: 0, mid: 1, high: 2 }; const idx = map[tier] != null ? map[tier] : 1;
      const snap = menuRes.tiers.map(t => ({ quotaAmt: t.quota, bonusAmt: t.bonus }));
      SK.DB.menuChoices.unshift({ choiceId: SK.uid('mc'), salespersonName: nm, menuSnapshot: snap,
        chosenTier: ['low', 'mid', 'high'][idx], chosenDate: SK.today(), irrevocable: true });
      UI.commit(); UI.toast('已登记（不可撤销 🔒）');
    },
    'dj.guard': d => { const a = ensureAudit(); a.guardrailMetric = a.guardrailMetric === d.v ? null : d.v; UI.commit(); },
    'dj.pr': d => { const a = ensureAudit(); a.processRedlineCount = clamp((a.processRedlineCount || 0) + (+d.d), 0, 10); UI.commit(); },
    'dj.leak': (d, el) => {
      const a = ensureAudit(); const m = d.m;
      if (el.checked) { if (!a.controlMeasures.includes(m)) a.controlMeasures.push(m); }
      else { a.controlMeasures = a.controlMeasures.filter(x => x !== m); a.claimedOutlets = a.claimedOutlets.filter(x => x !== m); }
      UI.commit();
    },
    'dj.claim': (d, el) => {
      const a = ensureAudit(); const m = d.m;
      if (el.checked) { if (!a.claimedOutlets.includes(m)) a.claimedOutlets.push(m); }
      else a.claimedOutlets = a.claimedOutlets.filter(x => x !== m);
      UI.commit(); UI.toast('监测清单已更新');
    },
    'dj.scn-save': () => {
      const n = prompt('方案名', '方案' + SK.today()); if (n == null) return;
      SK.DB.scenarios.unshift({ scenarioId: SK.uid('plan'), name: n || ('方案' + SK.today()), createdDate: SK.today(), snapshot: snapCompany() });
      UI.commit(); UI.toast('已保存场景');
    },
    'dj.scn-load': d => {
      const s = (SK.DB.scenarios || []).find(x => x.scenarioId === d.id); if (!s) return;
      Object.assign(SK.DB.company, JSON.parse(JSON.stringify(s.snapshot)));
      UI.commit(); UI.nav('dingjia', 'dash'); UI.toast('已载入并重算');
    },
    'dj.scn-del': d => {
      if (!confirm('删除该场景？')) return;
      SK.DB.scenarios = (SK.DB.scenarios || []).filter(x => x.scenarioId !== d.id);
      UI.commit(); UI.toast('已删除');
    },
    'dj.cov-issue': () => {
      const R = results();
      if (!R || !R.A) { UI.toast('请先在输入面板把定薪基准填全'); return; }
      const name = prompt('候选人姓名（≤10字）'); if (!name) return;
      const s = R.A.sales;
      const scn = { scenarioId: SK.uid('plan'), name: '信用书快照' + SK.today(), createdDate: SK.today(), snapshot: snapCompany() };
      SK.DB.scenarios.unshift(scn);
      const cv = { covenantId: SK.uid('cov'), code: genCovCode(), candidateName: name.slice(0, 10), scenarioId: scn.scenarioId, issuedDate: SK.today(),
        snapshot: { levelType: 'sales', tierGrade: SK.DB.company.tierGrade, baseSalaryAmt: s.B, thresholdTAmt: s.T, commissionRate: s.r, commissionRateCollect: s.rc } };
      SK.DB.covenantDocs.unshift(cv);
      UI.commit(); UI.modal(covModalHtml(cv));
    },
    'dj.cov-show': d => {
      const cv = (SK.DB.covenantDocs || []).find(x => x.covenantId === d.id);
      if (cv) UI.modal(covModalHtml(cv));
    },
  });

  /* ================= 7. 模块注册 ================= */
  SK.registerModule({
    id: 'dingjia', title: '定价', icon: '💰', order: 2,
    subnav: [{ id: 'input', label: '三步定薪' }, { id: 'dash', label: '五张账单' }, { id: 'data', label: '场景与信用书' }],   // 「防钻空子体检」（原方案风洞）从账单页进入，不占前台
    liveCells() {
      const dj = SK.X('dingjia'); if (!dj) return [];
      const b = dj.burdenRate;
      return [
        { k: '今年漏损', v: dj.total != null ? fmt.wan(dj.total) : DASH, tone: dj.total != null ? 'red' : 'dim', board: 'dingjia', sub: 'dash', tip: '人员流失 + 少招人，今年要白亏的钱（账单B+C）' },
        { k: '提成盘子', v: b != null ? fmt.pct(b) : DASH, tone: b == null ? 'dim' : (b > 0.35 ? 'red' : b < 0.25 ? 'amber' : 'green'), board: 'dingjia', sub: 'dash', tip: '全公司提成占目标毛利 · 25–35% 之间健康' },
      ];
    },
    alerts() { return this.alertList().filter(a => a.tone === 'r').length; },
    alertList() {
      const dj = SK.X('dingjia'); if (!dj || !dj.results) return [];
      const R = dj.results, out = [], go = { board: 'dingjia', sub: 'dash' };
      if (R.A) {
        if (R.A.anyBlocked) out.push(Object.assign({ tone: 'r', text: '定价：' + GATE_BRIEF['W-02'] }, go));
        R.A.gates.forEach(g => {
          if (g.id === 1 || g.code === 'ok') return;
          const brief = GATE_BRIEF[g.code]; if (!brief) return;
          if (g.light === 'red' || g.light === 'amber') out.push(Object.assign({ tone: g.light === 'red' ? 'r' : 'a', text: `定价：${brief}` }, go));
        });
      }
      if (R.B && R.B.isLate) out.push(Object.assign({ tone: 'r', text: `定价：最晚开招日 ${R.B.latestHire} 已过（晚 ${R.B.lateDays} 天）——目标从今天就开始漏` }, go));
      if (R.B && R.B.stretch) out.push(Object.assign({ tone: 'a', text: '定价：人均任务超真实水平 120%——「人人满产」是幻觉' }, go));
      if (R.E && R.E.light !== 'green') out.push(Object.assign({
        tone: R.E.light === 'red' ? 'r' : 'a',
        text: `定价：团队奖打分 ${R.E.TIS.toFixed(0)}（70 及格）${R.E.light === 'red' ? '——别发，会养懒人' : '——慎发，先分清谁的功劳'}`,
      }, go));
      return out;
    },
    render(sub) {
      ensureAudit();
      if (sub === 'dash') return vDash();
      if (sub === 'wt') return vWT();
      if (sub === 'data') return vData();
      return vInput();
    },
  });

  /* ================= 8. 对拍自检（黄金值；fixture 直接喂纯函数，不碰业务 DB）================= */
  const TEST_TODAY = '2026-07-13';
  const TW = w => w * 1e6;   // 万元→分
  function baseBFix() {
    return { cityTier: 'tier1', cycleTier: 'regular', tierGrade: 'effective',
      targetPersonalMonthlyGrossAmt: TW(9), nextYearTargetGrossAmt: TW(1000), lastYearPerCapitaGrossAmt: TW(100),
      salesCount: 5, managerCount: 1, attritionRate: 0.35, hiringCycleDays: 45, blendedMarginRate: 0.30,
      complementLevel: 'partial', attributableLevel: 'partial' };
  }
  // 出厂系数下跑（暂存并清空 coefOverrides，跑完精确还原）
  function withCleanCoef(fn) {
    const db = SK.DB, sv = db ? db.coefOverrides : null;
    if (db) db.coefOverrides = {};
    SK.setTestToday(TEST_TODAY);
    try { return fn(); }
    finally { if (db) db.coefOverrides = sv; SK.setTestToday(null); }
  }
  SK.tests.push({
    id: 'T-A1', name: '定价·定薪回算 r=19.5% 负担27.1%',
    fn: () => withCleanCoef(() => {
      // 原版 T-A1 fixture：tier1/short/effective，I4=10万/月，I5=1200万，managerNeeded=2，totalHeadTarget=10
      const A = calcCardA({ cityTier: 'tier1', cycleTier: 'short', tierGrade: 'effective',
        targetPersonalMonthlyGrossAmt: 100000 * 100, nextYearTargetGrossAmt: TW(1200), blendedMarginRate: 0.30, salesCount: 10 }, 2, 10);
      const got = { r: A.rows[0].r, burden: A.burdenRate };
      const pass = got.r != null && Math.abs(got.r - 0.195) <= 0.005 && got.burden != null && Math.abs(got.burden - 0.271) <= 0.005;
      return { pass, got: { r: (got.r * 100).toFixed(1) + '%', burden: (got.burden * 100).toFixed(1) + '%' }, want: { r: '19.5%', burden: '27.1%' } };
    }),
  });
  SK.tests.push({
    id: 'T-A-mgr', name: '定价·主管高管档独立联动（v2.5）',
    fn: () => withCleanCoef(() => {
      const base = { cityTier: 'tier1', cycleTier: 'short', targetPersonalMonthlyGrossAmt: 100000 * 100, nextYearTargetGrossAmt: TW(1200), blendedMarginRate: 0.30, salesCount: 10 };
      // 双档 effective：销售19.5% / 主管4.7% / 高管2.9%（旧口径不变）
      const A0 = calcCardA({ ...base, tierGrade: 'effective', mgrGrade: 'effective' }, 2, 10);
      // 销售 effective 不动，仅把管理层升到 leading：销售 r 恒 19.5%，主管↑6.2%，高管↑4.0%
      const A1 = calcCardA({ ...base, tierGrade: 'effective', mgrGrade: 'leading' }, 2, 10);
      const p = (x) => (x * 100).toFixed(1);
      const salesUnchanged = A1.rows[0].r === A0.rows[0].r && A1.rows[0].B === A0.rows[0].B;          // 解耦：改管理层档，销售层零变化
      const mgrShifted = A1.rows[1].B === 1750000 && A1.rows[2].B === 2500000                          // 管理层 B 按 leading 倍数（3.5/5.0）
        && A0.rows[1].B === 1250000 && A0.rows[2].B === 2000000;                                       // effective 倍数（2.5/4.0）
      const rOk = p(A0.rows[1].r) === '4.7' && p(A0.rows[2].r) === '2.9'
        && p(A1.rows[0].r) === '19.5' && p(A1.rows[1].r) === '6.2' && p(A1.rows[2].r) === '4.0';
      return {
        pass: salesUnchanged && mgrShifted && rOk,
        got: { effEff: `销${p(A0.rows[0].r)}/主${p(A0.rows[1].r)}/高${p(A0.rows[2].r)}`, effLead: `销${p(A1.rows[0].r)}/主${p(A1.rows[1].r)}/高${p(A1.rows[2].r)}`, 解耦: salesUnchanged },
        want: { effEff: '销19.5/主4.7/高2.9', effLead: '销19.5/主6.2/高4.0', 解耦: true },
      };
    }),
  });
  SK.tests.push({
    id: 'T-B1', name: '定价·六步链 S1=5 S6=16 开招2026-11-17',
    fn: () => withCleanCoef(() => {
      const B = calcCardB(baseBFix(), TEST_TODAY, 2027);
      const pass = B.S1 === 5 && B.S6 === 16 && (B.overRate * 100).toFixed(1) === '68.8'
        && B.latestMonth === 1 && B.latestHire === '2026-11-17' && B.isLate === false;
      return { pass, got: { S1: B.S1, S6: B.S6, over: fmt.pct(B.overRate), hire: B.latestHire }, want: { S1: 5, S6: 16, over: '68.8%', hire: '2026-11-17' } };
    }),
  });
  SK.tests.push({
    id: 'T-C1', name: '定价·流失价签 61.2万 / 年账 107.0万',
    fn: () => withCleanCoef(() => {
      const C = calcCardC(baseBFix());
      const pass = (C.tag / 1e6).toFixed(1) === '61.2' && (C.annual / 1e6).toFixed(1) === '107.0'
        && (C.oteLow / 1e6).toFixed(1) === '54.0' && (C.oteHigh / 1e6).toFixed(1) === '72.0';
      return { pass, got: { tag: fmt.wan(C.tag), annual: fmt.wan(C.annual) }, want: { tag: '61.2万', annual: '107.0万' } };
    }),
  });
  SK.tests.push({
    id: 'T-D1', name: '定价·管理跨度 heads=21 → 需3缺2',
    fn: () => withCleanCoef(() => {
      const D = calcCardD(baseBFix(), 21);
      const pass = D.availH === 9 && D.spanCap === 8 && D.managerNeeded === 3 && D.gap === 2 && D.coachMin === 0;
      return { pass, got: { spanCap: D.spanCap, need: D.managerNeeded, gap: D.gap, coach: D.coachMin }, want: { spanCap: 8, need: 3, gap: 2, coach: 0 } };
    }),
  });
  SK.tests.push({
    id: 'T-E1', name: '定价·TIS (5,partial,partial)=70 绿',
    fn: () => withCleanCoef(() => {
      const E = calcCardE({ salesCount: 5, complementLevel: 'partial', attributableLevel: 'partial' });
      return { pass: Math.round(E.TIS) === 70 && E.light === 'green', got: { TIS: Math.round(E.TIS), light: E.light }, want: { TIS: 70, light: 'green' } };
    }),
  });
  SK.tests.push({
    id: 'T-F16', name: '定价·菜单(100万,3万)→22700/30000/44100',
    fn: () => withCleanCoef(() => {
      const M = generateMenu(TW(100), 3 * 10000 * 100, false);
      const t = M.tiers;
      const pass = (t[0].quota / 1e6).toFixed(1) === '80.0' && t[0].bonus / 100 === 22700 && t[1].bonus / 100 === 30000 && t[2].bonus / 100 === 44100
        && t[0].unitReturn < t[1].unitReturn && t[1].unitReturn < t[2].unitReturn && !M.adjusted;
      return { pass, got: t.map(x => x.bonus / 100), want: [22700, 30000, 44100] };
    }),
  });
  SK.tests.push({
    id: 'T-F18', name: '定价·造假闸 3000万/5人/底薪5500→W-20 红 333.3%',
    fn: () => withCleanCoef(() => {
      const inp = { cityTier: 'tier1', cycleTier: 'regular', nextYearTargetGrossAmt: TW(3000), lastYearPerCapitaGrossAmt: TW(100), salesCount: 5 };
      const F1 = gateFraudRisk({ currentBaseSalaryAmt: 5500 * 100 }, inp, null);
      const F2 = gateFraudRisk({ currentBaseSalaryAmt: 8000 * 100 }, inp, null);
      const pass = F1.code === 'W-20' && F1.light === 'red' && (F1.ratioCur * 100).toFixed(1) === '333.3'
        && F2.code === 'W-20b' && F2.light === 'amber' && F1.p90Eff === 1.8;
      return { pass, got: { c1: F1.code, ratio: fmt.pct(F1.ratioCur), c2: F2.code, p90: F1.p90Eff }, want: { c1: 'W-20', ratio: '333.3%', c2: 'W-20b', p90: 1.8 } };
    }),
  });
  SK.tests.push({
    id: 'T-F19', name: '定价·探索保底月 9/11/13/14/14',
    fn: () => withCleanCoef(() => {
      const fl = cyc => explorationContract({ cityTier: 'tier1', cycleTier: cyc }).floorMonths;
      const got = [fl('short'), fl('regular'), fl('midLong'), fl('long'), fl('ultraLong')];
      const want = [9, 11, 13, 14, 14];
      return { pass: got.join() === want.join(), got, want };
    }),
  });
})();
