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
    cycleTier: [['short', '短期≤30天'], ['regular', '常规1–3月'], ['midLong', '中长4–6月'], ['long', '长期7–12月'], ['ultraLong', '超长>12月']],
    tierGrade: [['effective', '初级（有效）'], ['efficient', '中级（高效）'], ['leading', '高级（领先）']],
    complementLevel: [['solo', '各干各的'], ['partial', '部分协作'], ['chained', '环环相扣']],
    attributableLevel: [['no', '说不清谁干的'], ['partial', '部分能分清'], ['yes', '能精确到人头']],
    positionType: [['pure_sales', '纯销售'], ['advisory', '顾问建议岗'], ['aftersales', '售后服务岗']],
    commissionBaseType: [['contract_amount', '按合同额/回款额'], ['margin_based', '按毛利'], ['neutral_kpi', '按中性指标']],
    guardrailMetric: [['complaint_rate', '客诉率'], ['refund_rate', '退款率'], ['discount_rate', '折扣率']],
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

  /* ---- W 系话术库（逐字，件五 W-00~W-31）---- */
  const W_TEXT = {
    'W-01': g => `你的综合毛利率 ${fmt.pct(g.marginRate)}，属于低毛利生意——提成必须按毛利口径计（本系统默认如此）。若你现行方案按回款提成，大概率卖一单亏一单。`,
    'W-02': g => `底薪已吃穿现金目标：底薪 ${fmt.yuan(g.row.B)} ≥ 月收入目标的 90%（${fmt.yuan(g.row.T)}×90%）。这不是方案，是固定工资。请调低底薪或上调收入档位。`,
    'W-03': () => `饥饿-鱼饵警报：你把底薪压到了预警线以下。底薪低于生存线 + 提成高到刺眼 = 你不是在激励销售，是在制造一个必然作弊的人。`,
    'W-04': () => `浮动占比已贴着鱼饵线（65%）。短周期生意可用，但请确认底薪足以生存。`,
    'W-05': g => `全链提成占目标毛利 ${fmt.pct(g.burdenRate)}，超过 35% 红线——团队长大这套方案会把你撑穿。（35% 毛利 ≈ 毛利率约 25–30% 时的营收薪酬上限）`,
    'W-06': g => `全链提成占目标毛利仅 ${fmt.pct(g.burdenRate)}，低于 25%——鱼饵不香，好手不来（提成给薄了）。`,
    'W-09': () => `按此人数，人均目标已超满产真实水平的 120%——这是「人人满产」的幻觉。全球真实达标率（达标人数占比）只有 43–51%。`,
    'W-29': g => `底薪疑似违法：${levelName(g.row.level)} 底薪 ${fmt.yuan(g.row.B)} 低于你所在城市的最低工资参考（${fmt.yuan(g.minW)}）。底薪低于当地最低工资涉嫌违法，员工可追讨差额并申请劳动仲裁。请上调底薪，或到「数据中心 · 系数矩阵」把 minWageTable 改成你当地真实标准。`,
    'ok': () => `全链提成占目标毛利在 25–35% 健康带内——鱼饵香、撑不穿。`,
    'W-19': () => `菜单暂不可用：你的底薪已低于生存线。饥饿状态下的「自选目标」只会全员挤最低档——先修底薪，再谈菜单。`,
    'W-20': g => `富国银行方程成立：人均目标已达真实产能上限的 ${fmt.pct(g.ratioCur)}（红线 130%），且底薪贴着生存线。目标高到正常干法够不着时，人只剩两条路——走人，或造假。📎 结局参考：350 万个假账户、累计罚款和解超 30 亿美元、5,300 人被开、CEO 下台、2017 年起永久废除销售配额。`,
    'W-20b': g => `人均目标已达真实产能上限的 ${fmt.pct(g.ratioCur)}。底薪尚有缓冲，暂不构成造假高压，但「人人满产」仍是幻觉——达标率会先塌。`,
    'W-21': () => `提成基数与客户利益反向：顾问/售后按合同额提成 = 系统性诱导过度推销。📎 Sears 1992 同构方案 → 全公司「没病修出病」（卧底 37 例中 34 例被荐不必要维修）→ 41 州调查、1500 万美元和解、19 起集体诉讼、董事长立即废除提成。✅ 改法：基数换成留存·复购·满意度联动的中性指标。`,
    'W-21b': () => `纯销售岗按合同额/回款额提成，在低毛利品类会卖一单亏一单——建议切换毛利口径（本系统默认口径）。`,
    'W-22': () => `每个强目标必须配一个护栏指标（客诉率/退款率/折扣率任选其一）。你把 100% 的光打在回款上，阴影里长出来的就是砍价、乱承诺、老客荒废——选定护栏后方可导出方案书。`,
    'W-23': g => `你设了 ${g.n} 条「最低要求」。📎 AER 2006：底线管理换来底线员工——多数人会把产出降到底线附近。系统已预约一个证据：接入算账器后，M36 将用你自己的数据算出团队「卡线率」。过程红线要少而致命，产出激励要上不封顶。`,
    'W-24': g => `开拓型任务合同（模板）：保底期 ${g.floorMonths} 个月，底薪按矩阵、不挂业绩（且不得低于当地最低工资 ${fmt.yuan(g.minWage)}）；里程碑奖三档（首单成交 / 管道达月配额 3 倍 / 首季回款达标）；结算周期为季度，禁用月结提成。📎 MS 2013：纯绩效工资惩罚试错，而试错是探索的必经之路。`,
    'W-25': g => `你堵了 ${g.n} 个洞，水改从上面 ${g.n} 个出口漏。没有一个方案能同时堵死所有洞——你能做的是选一个付得起的出口，并让它可见、可归因。`,
    'W-26': () => `勾选你现行方案里的控制手段，看看水会从哪里漏出来。`,
  };
  const GATE_BRIEF = {
    'W-01': '低毛利生意——提成必须按毛利口径计',
    'W-02': '底薪吃穿现金目标（固定工资化）',
    'W-03': '饥饿-鱼饵警报：底薪压到预警线以下',
    'W-04': '浮动占比贴着鱼饵线 65%',
    'W-05': '全链提成负担超过 35% 红线',
    'W-06': '全链提成负担低于 25%（鱼饵不香）',
    'W-29': '底薪疑似低于当地最低工资',
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
    const gi = gradeIndex(grade), cityB = SK.getCoef('dingjia.cityBase')[I1], cf = SK.getCoef('dingjia.cycleFactor')[I2],
      social = SK.getCoef('shared.socialCostRate'), ltr = SK.getCoef('shared.longTermRate'), minW = SK.getCoef('shared.minWageTable')[I1],
      lm = SK.getCoef('dingjia.levelMultiplier'), tt = SK.getCoef('dingjia.thresholdTTable')[I1];
    const Bof = (lv, idx) => roundYuanFen(cityB * lm[lv][idx] * cf);
    const Tof = (lv, idx) => tt[lv][idx] * 100;                 // 元→分
    const Gof = lv => lv === 'sales' ? I4 : lv === 'manager' ? safeDiv(I5, 12 * Math.max(managerNeeded, 1)) : I5 / 12;
    const layers = ['sales', 'manager', 'executive'];
    const count = { sales: totalHeadTarget, manager: managerNeeded, executive: 1 };
    const rows = layers.map(lv => {
      const B = Bof(lv, gi), T = Tof(lv, gi), G = Gof(lv);
      const longAmt = Math.round(T * ltr), gapAmt = Math.round(T * (1 - ltr)) - B;
      const blocked = B >= T * (1 - ltr), r = blocked ? null : safeDiv(gapAmt, G);
      const belowMinWage = B < minW, floatShare = safeDiv(gapAmt, T);
      return { level: lv, B, T, G, longAmt, gapAmt, blocked, r, belowMinWage, floatShare, count: count[lv] };
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
      cityTier: c.cityTier, cycleTier: c.cycleTier, tierGrade: c.tierGrade || 'effective',
      targetPersonalMonthlyGrossAmt: wanAmt(c.targetPersonalMonthlyGrossWan),
      nextYearTargetGrossAmt: wanAmt(c.targetYearGrossWan),
      lastYearPerCapitaGrossAmt: wanAmt(c.lastYearPerCapitaWan),
      salesCount: (db.people || []).filter(p => p.isActive && p.positionType === 'sales').length,
      managerCount: (db.people || []).filter(p => p.isActive && p.positionType === 'manager').length,
      attritionRate: c.attritionRate, hiringCycleDays: c.hiringCycleDays, blendedMarginRate: c.blendedMarginRate,
      complementLevel: c.complementLevel, attributableLevel: c.attributableLevel,
      targetYearMode: c.targetYearMode || 'next',
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
      r: s ? s.r : null,                       // 销售层提成率
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

  /* ---- 输入面板 ---- */
  function vInput() {
    const c = SK.DB.company;
    const salesN = SK.activeSales().length, mgrN = SK.activeManagers().length;
    return `
    <div class="sect"><h2>销售人力总算盘</h2><span class="sub">输入共享字段（改一处，五个板块同帧换算），5 分钟看清：定薪定多少、该招几个人、走一个人亏多少、缺几个主管、团队奖该不该发。</span></div>
    <div class="sect" style="margin-top:2px"><h2 style="font-size:14px">第一步 · 定薪基准</h2><span class="sub">给“什么样的人”定薪？</span></div>
    ${h.card('', `
      <p class="hint" style="margin-bottom:8px">先选城市与成交周期——下面会实时算出销售初级/中级/高级、以及配套主管、高管的<b>真实底薪与达标月收入</b>。你不用理解「有效/高效/领先」，看数、点一行就行。</p>
      <div class="grid g2">
        ${h.field('城市线级', h.seg('company.cityTier', ENUMS.cityTier.map(([v, t]) => ({ v, t })), c.cityTier))}
        ${h.field('成交周期档', h.seg('company.cycleTier', ENUMS.cycleTier.map(([v, t]) => ({ v, t })), c.cycleTier), '从客户首次接触到回款的典型时长')}
      </div>
      ${tierTableHtml()}`)}
    <div class="sect" style="margin-top:10px"><h2 style="font-size:14px">第二步 · 目标 · 团队 · 生意</h2></div>
    <div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr));display:grid;gap:10px">
      ${h.card('钱与目标', `<div class="frm">
        ${h.field('达标销售的月毛利目标（万元）', h.input('company.targetPersonalMonthlyGrossWan', 'num', { value: c.targetPersonalMonthlyGrossWan, step: 0.5 }), '参考：去年人均月毛利 ×1.1–1.3')}
        ${h.field('目标年公司毛利（万元/年）', h.input('company.targetYearGrossWan', 'num', { value: c.targetYearGrossWan }))}
        ${h.field('去年人均毛利（万元/年·真值）', h.input('company.lastYearPerCapitaWan', 'num', { value: c.lastYearPerCapitaWan }), '总毛利÷销售人数，别用配额')}
        ${h.field('规划年份', h.seg('company.targetYearMode', [{ v: 'next', t: '明年' }, { v: 'this', t: '今年' }], c.targetYearMode))}
      </div>`)}
      ${h.card('人', `<div class="frm">
        ${h.field(`现有销售人数 ${h.linked()}`, `<b style="font-size:16px">${salesN} 人</b>`, '由员工档案实时统计，不再手填')}
        ${h.field(`现有销售主管人数 ${h.linked()}`, `<b style="font-size:16px">${mgrN} 人</b>`, '由员工档案实时统计')}
        <div style="margin:-2px 0 8px">${h.btn('去员工档案维护 →', 'ui.nav', { cls: 'sm ghost', data: 'data-board="data" data-sub="people"' })}</div>
        ${h.field('年流失率 %', h.input('company.attritionRate', 'pct100', { value: Math.round(c.attritionRate * 1000) / 10, step: 1 }), '全球销售岗基准约 35%')}
        ${h.field('招聘周期（天）', h.input('company.hiringCycleDays', 'int', { value: c.hiringCycleDays }), '从发帖到到岗，行业参考 45 天')}
      </div>`)}
      ${h.card('生意', `<div class="frm">
        ${h.field('综合毛利率 %', h.input('company.blendedMarginRate', 'pct100', { value: Math.round(c.blendedMarginRate * 1000) / 10, step: 0.1 }), '全品类加权')}
        ${h.field('团队任务互补性', h.seg('company.complementLevel', ENUMS.complementLevel.map(([v, t]) => ({ v, t })), c.complementLevel))}
        ${h.field('个人贡献可见度', h.seg('company.attributableLevel', ENUMS.attributableLevel.map(([v, t]) => ({ v, t })), c.attributableLevel))}
      </div>`)}
    </div>
    <div style="display:flex;gap:10px;margin-top:12px;align-items:center">
      ${h.btn('查看五张账单 →', 'ui.nav', { cls: 'pri', data: 'data-board="dingjia" data-sub="dash"' })}
      <span class="hint">所有输入 change 即全站重算——底部实时条与其他板块同帧更新。</span>
    </div>
    <div class="footer-note hint" style="margin-top:14px;text-align:center">本工具纯本地运行，数据不出你的电脑——我们碰不到，也不想碰。</div>`;
  }
  function tierTableHtml() {
    const c = SK.DB.company, I1 = c.cityTier, I2 = c.cycleTier;
    if (!I1 || !I2) return `<div class="hint" style="padding:14px;text-align:center">⬆︎ 选好上面的「城市线级」与「成交周期档」，这里会自动展开销售初级/中级/高级、以及主管、高管的真实底薪与达标月收入。</div>`;
    const cityB = SK.getCoef('dingjia.cityBase')[I1], cf = SK.getCoef('dingjia.cycleFactor')[I2],
      lm = SK.getCoef('dingjia.levelMultiplier'), tt = SK.getCoef('dingjia.thresholdTTable')[I1];
    const Bof = (lv, idx) => roundYuanFen(cityB * lm[lv][idx] * cf), Tof = (lv, idx) => tt[lv][idx] * 100;
    const cityLab = ENUMS.cityTier.find(x => x[0] === I1)[1], cycLab = ENUMS.cycleTier.find(x => x[0] === I2)[1];
    const gi = gradeIndex(c.tierGrade);
    const gradeRows = ['effective', 'efficient', 'leading'].map(g => {
      const idx = gradeIndex(g), sel = c.tierGrade === g;
      return `<tr data-act="dj.grade" data-g="${g}" style="cursor:pointer;${sel ? 'background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)' : ''}">
        <td><b>销售·${GRADE_SHORT[g]}</b> <span class="hint">（${GRADE_TECH[g]}）${sel ? ' ✓ 已选' : ''}</span></td>
        <td class="num mono">${fmt.yuan(Bof('sales', idx))}</td><td class="num mono">${fmt.yuan(Tof('sales', idx))}</td>
        <td class="hint">${GRADE_DESC[g]}</td></tr>`;
    });
    const subRows = ['manager', 'executive'].map(lv =>
      `<tr><td>${levelName(lv)}</td><td class="num mono">${fmt.yuan(Bof(lv, gi))}</td><td class="num mono">${fmt.yuan(Tof(lv, gi))}</td><td class="hint">${LEVEL_DESC[lv]}</td></tr>`);
    return `
      <div style="margin-top:8px"><b style="font-size:12.8px">① 选销售档</b> <span class="hint">（${cityLab} · ${cycLab} 实算 · 点一行选定）</span></div>
      ${h.tbl([{ t: '销售档位' }, { t: '底薪/月', num: 1 }, { t: '达标月收入', num: 1 }, { t: '这是什么人' }], gradeRows)}
      <div style="margin-top:8px"><b style="font-size:12.8px">② 配套主管 / 高管</b> <span class="hint">（随所选「${GRADE_SHORT[c.tierGrade]}」档联动）</span></div>
      ${h.tbl([{ t: '层级' }, { t: '底薪/月', num: 1 }, { t: '达标月收入', num: 1 }, { t: '说明' }], subRows)}
      ${h.hint('底薪随成交周期升高（周期越长、噪音越大，底薪保险越厚）；达标月收入只随城市与档位变、不随周期变。')}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:10px 12px;background:var(--panel);border:1px solid var(--line);border-radius:9px">
        <label style="font-size:12.8px;font-weight:600;flex:1 1 auto;min-width:200px">不确定选哪档？直接输入你现在给销售的月底薪，系统帮你反查</label>
        <span>¥</span><input id="dj-gbase" type="number" placeholder="如 8000" style="width:110px" value="${gradeBaseDraft != null ? gradeBaseDraft : ''}">
        ${h.btn('反查匹配', 'dj.grade-match', { cls: 'sm' })}
        ${matchNote ? `<div class="hint" style="flex-basis:100%;color:var(--accent)">→ ${matchNote}</div>` : ''}
      </div>`;
  }

  /* ---- 五张账单 ---- */
  function vDash() {
    const R = results();
    if (!R || (!R.A && !R.B && !R.C)) {
      return `<div class="sect"><h2>五张账单</h2></div>
        ${h.banner('还没有账单——在「输入面板」把共享字段填全，这里会实时展开明细。', 'n')}
        ${h.btn('去输入面板', 'ui.nav', { cls: 'pri', data: 'data-board="dingjia" data-sub="input"' })}`;
    }
    let out = `<div class="sect"><h2>五张账单</h2><span class="sub">规划年份 ${R.targetYear} · 销售按${gradeFull(R.inp.tierGrade)}档 · 全部数字实时换算</span>
      <span style="margin-left:auto;display:flex;gap:6px">${h.btn('保存场景', 'dj.scn-save', { cls: 'sm' })}${h.btn('签发信用书', 'dj.cov-issue', { cls: 'sm' })}</span></div>`;
    // 总漏损条
    if (R.total) {
      const annual = R.total.annual, expose = R.total.expose;
      out += `<div class="card" style="background:linear-gradient(135deg,#191640,#2f2a6b 55%,#4a2f78);color:#fff;border:none">
        <div style="font-size:11.5px;color:#c4b5fd;font-weight:600;letter-spacing:.05em;text-transform:uppercase">今年已注定漏损 ≈</div>
        <div class="mono" style="font-size:38px;font-weight:800;letter-spacing:-.02em;margin:4px 0 8px">${fmt.wan(R.total.total)}</div>
        <div style="font-size:12.8px;color:#c9c5ea;line-height:1.6;max-width:680px">流失总账 ${fmt.wan(annual)} ＋ 产能高估暴露 ${fmt.wan(expose)}。这两笔钱不在任何报表上——它们是「按老算法办事」的价格。</div>
        <div style="display:flex;height:7px;border-radius:6px;overflow:hidden;margin-top:13px;max-width:520px">
          <span style="flex:${Math.max(annual, 1)};background:#f472b6"></span><span style="flex:${Math.max(expose, 1)};background:#a78bfa"></span></div>
        <div style="display:flex;gap:16px;font-size:10.5px;color:#a8a3d4;margin-top:5px;max-width:520px"><span>■ 流失总账</span><span style="color:#c4b5fd">■ 产能高估暴露</span></div>
      </div>`;
    }
    out += `<div class="grid g2" style="margin-top:10px;align-items:start">`;
    if (R.A) out += `<div class="span2">${cardAHtml(R)}</div>`;
    out += R.B ? cardBHtml(R) : dcard('B', '账单B · 产能与招人算钱器', '人均毛利缺失', DASH, '该招几人', `<div class="hint">去年人均毛利为 0，整卡无法计算，显“—”。</div>`);
    if (R.C) out += cardCHtml(R);
    if (R.D) out += cardDHtml(R);
    if (R.E) out += cardEHtml(R);
    out += `</div>`;
    return out;
  }
  function cardAHtml(R) {
    const A = R.A, s = A.sales;
    const rowsHtml = A.rows.map(r => `<tr><td>${levelName(r.level)}</td>
      <td class="num ${r.belowMinWage ? '' : ''}" style="${r.belowMinWage ? 'color:var(--red);font-weight:600' : ''}">${fmt.yuan(r.B)}${r.belowMinWage ? ' ⚠︎' : ''}</td>
      <td class="num">${fmt.yuan(r.T)}</td><td class="num">${r.blocked ? DASH : fmt.pct(r.r)}</td><td class="num">${r.count != null ? r.count : DASH}</td></tr>`);
    const [cb, cg, cl] = A.comp;
    const gi = A.goodHire, giTone = gi < 1 ? 'r' : gi < 1.2 ? 'a' : gi < 1.4 ? 'g' : 'gold';
    const giLab = gi < 1 ? '🔴 偏低' : gi < 1.2 ? '🟡 及格' : gi < 1.4 ? '🟢 好招' : '🏅 极好招';
    const bTone = A.burdenRate > 0.35 ? 'r' : A.burdenRate < 0.25 ? 'a' : '';
    let body = '';
    if (A.anyBlocked) body += gate('red', W_TEXT['W-02']({ row: A.rows.find(r => r.blocked) }));
    body += h.tbl([{ t: '层级' }, { t: '底薪 B', num: 1 }, { t: '达标收入 T', num: 1 }, { t: '提成率 r', num: 1 }, { t: '目标人数', num: 1 }], rowsHtml);
    body += `<div class="hint" style="margin-top:6px">销售层薪酬构成（底薪 : 提成缺口 : 长期分红池）</div>`;
    body += compbar([[cb, cb, '#6366f1'], [cg, cg, '#f59e0b'], [cl, cl, '#10b981']]);
    body += `<div style="margin:10px 0">${h.badge(`好招指数 ${gi.toFixed(2)} · ${giLab}`, giTone, true)}</div>`;
    if (A.burdenRate != null) {
      body += `<div class="hint">全链提成负担占目标毛利（健康带 25–35%）</div>${h.meter(A.burdenRate / 0.5, bTone, [0.5, 0.7])}${meterCap('0%', '健康带 25–35%', '50%+')}`;
    }
    A.gates.filter(g => g.id !== 1).forEach(g => {
      body += gate(g.light, (W_TEXT[g.code] || (() => ''))(Object.assign({ burdenRate: A.burdenRate, marginRate: A.marginRate }, g)));
    });
    if (A.fullBurden != null) body += h.banner(`ℹ️ 全口径人力负担（含底薪/社保/长期分红池）≈ <b>${fmt.pct(A.fullBurden)}</b>；按毛利率折营收 ≈ <b>${fmt.pct(A.fullRev)}</b>，对标 CCOS 健康带 8–15% 营收。`, 'n');
    body += killer('这不是工资单，是一张「普通人干出头部水平」压强表——r 越高、底薪越低，越像鱼饵。');
    body += h.src('📎 三层定薪回算：B=城市基数×层级倍数×周期因子；T 查阈值矩阵；r=(T×90%−B)÷月毛利目标 G');
    return dcard('A', '账单A · 定薪回算', `好招指数 ${A.goodHire.toFixed(2)} · 销售按${gradeFull(R.inp.tierGrade)}档`, s.r != null ? fmt.pct(s.r) : DASH, '销售提成率 r', body);
  }
  function cardBHtml(R) {
    const B = R.B;
    const rows = [
      ['① 需要满产当量', B.fullCap.toFixed(2) + ' 人'],
      ['② 你脑子里（天真）需招 S1', B.S1 + ' 人'],
      ['③ 预期流失', B.expAttr.toFixed(2) + ' 人'],
      ['④ 缺口当量', B.gapCap.toFixed(2) + ' 人'],
      ['⑤ 单人当年有效产能 kEff(1)', (B.kEff1 * 100).toFixed(1) + '%（原始 k(1)=' + (B.k1 * 100).toFixed(1) + '%）'],
      ['⑥ 六步链真实需招 S6', `<b>${B.S6} 人</b>`],
      ['产能高估率', B.overRate != null ? fmt.pct(B.overRate) : DASH],
      ['高估暴露（今年注定差的钱）', fmt.wan(B.exposeAmt)],
      ['最晚开招日', `${B.latestHire || DASH}${B.isLate ? `（已晚 ${B.lateDays} 天）` : '（未晚）'}`],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    const late = B.isLate
      ? (R.inp.targetYearMode === 'this'
        ? `否则今年目标在今天就已经完不成了——你已经晚了 ${B.lateDays} 天。`
        : `否则明年目标在今天就已经完不成了。`)
      : `最晚 ${B.latestHire} 必须开招。`;
    let body = h.tbl([{ t: '口径' }, { t: '数值', num: 1 }], rows);
    body += `${h.spark(SK.RAMP[R.inp.cycleTier], B.ramp80)}<div class="hint">12 个月产能爬坡曲线（满产=100%）· 虚线＝满 80% 的第 ${B.ramp80} 月</div>`;
    if (B.stretch) body += gate('amber', W_TEXT['W-09']());
    body += killer(`你以为招 ${B.S1} 个，六步链算出要招 ${B.S6} 个——差的 ${B.S6 - B.S1} 个，就是「人头×配额」高估产能的代价。${late}`);
    body += `<div class="hint" style="margin-top:8px">规划年份：${B.targetYear}　${h.btn(R.inp.targetYearMode === 'this' ? '改回算明年' : '改算今年', 'dj.ty', { cls: 'sm ghost' })}</div>`;
    body += `<div style="margin-top:8px;display:flex;align-items:center;gap:8px">${h.btn('招人器有完整十二道闸与时间轴 →', 'ui.nav', { cls: 'sm ghost', data: 'data-board="zhaoren"' })}<span class="hint">「该招几人」六步链与招人器同源共享字段 ${h.linked()}</span></div>`;
    return dcard('B', '账单B · 产能与招人算钱器', `天真 ${B.S1} 人 → 六步链 ${B.S6} 人`, `${B.S6}`, '真实需招人数', body);
  }
  function cardCHtml(R) {
    const C = R.C;
    const rows = [
      ['空窗损失（招聘周期内产能为0）', fmt.wan(C.idle)],
      ['爬坡缺口（新人未满产的累计差）', fmt.wan(C.rampGap)],
      ['招聘直接费', `${fmt.wan(C.recruitFee)} ${h.btn('改', 'dj.fee', { cls: 'sm ghost' })}`],
      ['单人价签（简版 3 项）', `<b>${fmt.wan(C.tag)}</b>`],
      ['OTE 比例口径（全球）', `${fmt.wan(C.oteLow)} – ${fmt.wan(C.oteHigh)}`],
      ['今年流失总账', `<b>${fmt.wan(C.annual)}</b>`],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    let body = h.tbl([{ t: '构成' }, { t: '金额', num: 1 }], rows);
    body += `<div class="hint" style="margin-top:6px">单人价签构成（空窗 : 爬坡缺口 : 招聘费）</div>`;
    body += compbar([[Math.max(C.idle, 1), '空窗', '#6366f1'], [Math.max(C.rampGap, 1), '爬坡', '#f59e0b'], [Math.max(C.recruitFee, C.tag * 0.03), '招聘', '#10b981']]);
    body += h.hint('注：本卡为「简版（3 项）」，不与留人器 6 项口径（约 75 万）并列比较。');
    body += killer('最大的一块是爬坡缺口——所以「缩短爬坡」比「降低流失」更值钱。');
    return dcard('C', '账单C · 流失价签', '简版（3 项）', fmt.wan(C.tag), '走一个销售亏（明细口径）', body);
  }
  function cardDHtml(R) {
    const D = R.D, B = R.B;
    const rows = [
      ['周管理可用工时', D.availH + ' h'], ['一个主管跨度上限', D.spanCap + ' 人'],
      ['规划总人数', D.heads + ' 人'], ['需要主管数', D.managerNeeded + ' 人'],
      ['主管缺口', D.gap + ' 人'], ['每人每周分到辅导', (isFinite(D.coachMin) ? D.coachMin : DASH) + ' 分钟'],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    const S6 = B && B.ok ? B.S6 : DASH;
    let body = h.tbl([{ t: '口径' }, { t: '数值', num: 1 }], rows);
    body += killer(`你要招的不是 ${S6} 个销售，是 ${S6} 个销售加 ${D.gap} 个主管——辅导剂量不足会推高流失与爬坡时长。`);
    body += h.src('📎 跨度公式：周管理可用 = 40h×30% − 3h 固定会议 = 9h；跨度上限 = ⌊9 ÷ 1.1h/人⌋ = 8 人');
    return dcard('D', '账单D · 管理跨度', `需 ${D.managerNeeded} 主管 · 缺 ${D.gap}`, `${D.gap}`, '主管缺口', body);
  }
  function cardEHtml(R) {
    const E = R.E, light = E.light, dot = light === 'green' ? '🟢' : light === 'amber' ? '🟡' : '🔴';
    const rows = [
      ['规模分（人越多越懈怠）', E.sizeScore.toFixed(0)], ['互补分', E.compScore.toFixed(0)],
      ['可见分（能否精确到人头）', E.visScore.toFixed(0)],
      ['团队激励适配 TIS', `<b>${E.TIS.toFixed(0)}</b>（≥70 绿 / 40–70 黄 / <40 红）`],
    ].map(([a, b]) => `<tr><td>${a}</td><td class="num">${b}</td></tr>`);
    const tone = light === 'green' ? '' : light === 'amber' ? 'a' : 'r';
    const msg = light === 'green' ? '小团队 + 互补 + 可见——团队奖能活。'
      : light === 'amber' ? '介于之间：发团队奖前先确认贡献可见度。'
      : '人多、各干各的、说不清谁干的——团队奖只会喂出搭便车。';
    let body = h.tbl([{ t: '维度' }, { t: '得分', num: 1 }], rows);
    body += h.meter(E.TIS / 100, tone, [0.4, 0.7]) + meterCap('0', '红 <40 · 黄 40–70 · 绿 ≥70', '100');
    body += killer(msg);
    body += h.src('📎 TIS = 0.4×规模分 + 0.3×互补分 + 0.3×可见分；规模分 8 人满分线性递减至 20 人归零');
    return dcard('E', '账单E · 团队奖红绿灯', `TIS ${E.TIS.toFixed(0)}`, `${dot} ${E.TIS.toFixed(0)}`, '团队激励适配分', body);
  }

  /* ---- 方案风洞 ---- */
  function vWT() {
    ensureAudit();
    const R = results();
    if (!R || !R.A) {
      return `<div class="sect"><h2>方案风洞</h2></div>
        ${h.banner('🌀 方案风洞需要先有方案——先到「输入面板」把定薪基准与目标填全，再回来给方案做风洞测试。', 'n')}
        ${h.btn('去输入面板', 'ui.nav', { cls: 'pri', data: 'data-board="dingjia" data-sub="input"' })}`;
    }
    return `<div class="sect"><h2>方案风洞</h2><span class="sub">发之前，先看它会被怎么玩。</span></div>
      ${wtMenuHtml(R)}${wtGatesHtml(R)}${wtGuardrailHtml(R)}${wtSandboxHtml()}`;
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
            <div class="hint" style="margin-top:7px">达标概率 ${fmt.pct(t.P)} · 单位回报 ${(t.bonus / (t.quota / 1e6)).toFixed(1)} 元/万 · 偏差 ${(t.dev * 100).toFixed(2)}%</div>
          </div>`).join('') + `</div>`;
        body += h.hint('三档对你的期望成本完全相等（偏差 ≤3%）。选择一经登记不可撤销：他选的目标他认，你印的奖金你不能改。📎 Bommaraju & Hohenberg (2018) JM 82(5)。');
        if (menuRes.adjusted) body += h.hint('稳妥档奖金按激励相容规则下调，期望成本略低于基准——偏差方向对你有利。');
        body += `<div style="margin-top:10px">${h.btn('登记选择（不可撤销 🔒）', 'dj.menu-reg', { cls: 'sm' })}</div>`;
      }
    }
    return h.card('① 自选激励菜单（三档等价）', `<p class="hint" style="margin-bottom:8px">同样的钱，把「派下去的目标」换成「三选一菜单」——你一分钱不多花，买到每个人对自己选择的承诺。</p>${body}`);
  }
  function wtGatesHtml(R) {
    const a = SK.DB.audit;
    const sz = SK.X('suanzhang');
    const p90Real = (sz && sz.realP90Factor != null) ? sz.realP90Factor : null;
    let out = `<div class="grid g2" style="margin-bottom:0">
      ${h.field('岗位类型', h.seg('audit.positionType', ENUMS.positionType.map(([v, t]) => ({ v, t })), a.positionType))}
      ${h.field('现行提成基数', h.seg('audit.currentCommissionBase', ENUMS.commissionBaseType.map(([v, t]) => ({ v, t })), a.currentCommissionBase))}
    </div>
    ${h.field('现行底薪（元/月）', h.input('audit.currentBaseSalaryAmt', 'fen-yuan', { value: a.currentBaseSalaryAmt != null ? Math.round(a.currentBaseSalaryAmt / 100) : '', ph: '如 6000' }))}`;
    if (a.currentBaseSalaryAmt != null && a.currentBaseSalaryAmt > 0) {
      const fr = gateFraudRisk(a, R.inp, p90Real);
      const p90Src = p90Real != null ? `（算账器真实值）${h.linked('算账器联动')}` : '（全球默认 1.8）';
      out += gate(fr.light, fr.code === 'ok'
        ? `造假风险闸：人均目标为真实产能上限的 ${fmt.pct(fr.ratioCur)}（未过 130% 红线）。p90 口径 ${fr.p90Eff}${p90Src}。`
        : `${W_TEXT[fr.code](fr)}<div class="hint" style="margin-top:4px">p90 口径 ${fr.p90Eff}${p90Src}</div>`);
    } else {
      out += h.hint('填入现行底薪后，这里会出「造假风险闸」判定（富国银行方程）。');
    }
    const al = gateAlignment(a);
    out += gate(al.light, al.code === 'ok' ? '同向性闸：提成基数与客户利益同向，通过。' : W_TEXT[al.code]());
    return h.card('② 造假风险闸 + 同向性闸', `<p class="hint" style="margin-bottom:8px">你的方案会不会逼人造假？提成基数是否与客户利益反向？</p>${out}`);
  }
  function wtGuardrailHtml(R) {
    const a = SK.DB.audit;
    const segBtns = ENUMS.guardrailMetric.map(([v, t]) =>
      h.btn(t + (a.guardrailMetric === v ? ' ✓' : ''), 'dj.guard', { cls: 'sm' + (a.guardrailMetric === v ? ' pri' : ' ghost'), data: `data-v="${v}"` })).join(' ');
    let out = h.field('护栏指标（点选，再点取消）', `<div style="display:flex;gap:6px;flex-wrap:wrap">${segBtns}</div>`);
    out += h.field('过程「最低要求」条数', `<div style="display:flex;align-items:center;gap:8px">
      ${h.btn('−', 'dj.pr', { cls: 'sm ghost', data: 'data-d="-1"' })}<b style="min-width:24px;text-align:center">${a.processRedlineCount}</b>${h.btn('＋', 'dj.pr', { cls: 'sm ghost', data: 'data-d="1"' })}</div>`);
    const gr = checkGuardrail(true, a.guardrailMetric);
    if (gr.locked) out += gate('amber', W_TEXT['W-22']());
    const pr = countProcessRedlines(a.processRedlineCount);
    if (pr.warn) out += gate('amber', W_TEXT['W-23'](pr));
    out += `<label style="display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin:8px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" data-bind="audit.explorationMode" data-type="bool" ${a.explorationMode ? 'checked' : ''}>
      <span>开拓型任务：启用探索合同（禁用月度冲刺与菜单）</span></label>`;
    if (a.explorationMode) {
      const ec = explorationContract(R.inp);
      out += gate('green', `📋 ${W_TEXT['W-24'](ec)}`);
      out += h.hint('开拓期已禁用短期冲刺与菜单：探索要的是试错空间，不是月度压强。');
    }
    return h.card('③ 护栏配对 · 过程红线 · 探索合同', `<p class="hint" style="margin-bottom:8px">每个强目标必须配一个护栏；过程红线要少而致命；新战场用新契约。</p>${out}`);
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
    return h.card('④ 漏水导流沙盘', `<p class="hint" style="margin-bottom:8px">你堵一个洞，水就从别处漏。选一个付得起的出口，让它可见、可归因。</p>${out}`);
  }

  /* ---- 场景与信用书 ---- */
  const SNAP_FIELDS = ['cityTier', 'cycleTier', 'tierGrade', 'complementLevel', 'attributableLevel', 'targetYearMode',
    'targetYearGrossWan', 'lastYearPerCapitaWan', 'targetPersonalMonthlyGrossWan', 'attritionRate', 'hiringCycleDays', 'blendedMarginRate', 'fullLoadWan'];
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
        + h.hint('信用书是当前定薪结果的 irrevocable 快照——一经签发，条款不因业绩上调而单方下调。'))}
    </div>
    ${h.card(`菜单登记（不可撤销 🔒 · ${mcs.length} 条）`, mcs.length ? h.tbl(
      [{ t: '销售' }, { t: '所选档' }, { t: '配额', num: 1 }, { t: '奖金', num: 1 }, { t: '登记日', num: 1 }],
      mcs.map(m => {
        const tierIdx = { low: 0, mid: 1, high: 2 }[m.chosenTier], t = m.menuSnapshot && m.menuSnapshot[tierIdx];
        return `<tr><td><b>${esc(m.salespersonName)}</b></td><td>${{ low: '稳妥档', mid: '基准档', high: '冲刺档' }[m.chosenTier] || m.chosenTier} 🔒</td>
          <td class="num">${t ? fmt.wan(t.quotaAmt) : DASH}</td><td class="num">${t ? fmt.yuan(t.bonusAmt) : DASH}</td><td class="num">${m.chosenDate}</td></tr>`;
      })) : h.hint('还没有登记的菜单选择。到「方案风洞 · ①菜单」生成三档后登记。'))}`;
  }
  function covModalHtml(cv) {
    const s = cv.snapshot;
    return `<div style="max-height:72vh;overflow:auto">
      <div style="border:4px double #b91c1c;padding:30px 32px;position:relative;background:#fff;color:#111;border-radius:2px">
        <div style="position:absolute;top:16px;right:18px;color:#b91c1c;border:2px solid #b91c1c;padding:4px 11px;border-radius:6px;transform:rotate(-3deg);font-weight:700;font-size:12.5px;letter-spacing:.05em">${cv.code}</div>
        <h1 style="text-align:center;font-size:20px;letter-spacing:.1em;margin:0 0 8px;color:#111">销售岗位薪酬信用书</h1>
        <div style="font-size:14px;line-height:2.1;margin:22px 0">兹承诺：<b style="border-bottom:1px solid #333;padding:0 4px">${esc(cv.candidateName)}</b> 入职后担任<b>销售</b>（<b>${gradeFull(s.tierGrade)}</b>档），
          月度底薪 <b>${fmt.yuan(s.baseSalaryAmt)}</b>；月度达标收入 <b>${fmt.yuan(s.thresholdTAmt)}</b>（含提成，提成按毛利口径、比例 <b>${s.commissionRate != null ? fmt.pct(s.commissionRate) : '—'}</b>）；
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
    'dj.ty': () => { SK.DB.company.targetYearMode = SK.DB.company.targetYearMode === 'this' ? 'next' : 'this'; UI.commit(); },
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
        snapshot: { levelType: 'sales', tierGrade: SK.DB.company.tierGrade, baseSalaryAmt: s.B, thresholdTAmt: s.T, commissionRate: s.r } };
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
    subnav: [{ id: 'input', label: '输入面板' }, { id: 'dash', label: '五张账单' }, { id: 'wt', label: '方案风洞' }, { id: 'data', label: '场景与信用书' }],
    liveCells() {
      const dj = SK.X('dingjia'); if (!dj) return [];
      const b = dj.burdenRate;
      return [
        { k: '今年漏损', v: dj.total != null ? fmt.wan(dj.total) : DASH, tone: dj.total != null ? 'red' : 'dim', board: 'dingjia', sub: 'dash', tip: '流失总账 + 产能高估暴露——「按老算法办事」的价格' },
        { k: '全链负担', v: b != null ? fmt.pct(b) : DASH, tone: b == null ? 'dim' : (b > 0.35 ? 'red' : b < 0.25 ? 'amber' : 'green'), board: 'dingjia', sub: 'dash', tip: '全链提成占目标毛利 · 健康带 25–35%' },
      ];
    },
    alerts() { return this.alertList().filter(a => a.tone === 'r').length; },
    alertList() {
      const dj = SK.X('dingjia'); if (!dj || !dj.results) return [];
      const R = dj.results, out = [], go = { board: 'dingjia', sub: 'dash' };
      if (R.A) {
        if (R.A.anyBlocked) out.push(Object.assign({ tone: 'r', text: '定价 W-02：' + GATE_BRIEF['W-02'] }, go));
        R.A.gates.forEach(g => {
          if (g.id === 1 || g.code === 'ok') return;
          const brief = GATE_BRIEF[g.code]; if (!brief) return;
          if (g.light === 'red' || g.light === 'amber') out.push(Object.assign({ tone: g.light === 'red' ? 'r' : 'a', text: `定价 ${g.code}：${brief}` }, go));
        });
      }
      if (R.B && R.B.isLate) out.push(Object.assign({ tone: 'r', text: `定价 · 最晚开招日 ${R.B.latestHire} 已过（晚 ${R.B.lateDays} 天）——目标从今天就开始漏` }, go));
      if (R.B && R.B.stretch) out.push(Object.assign({ tone: 'a', text: '定价 W-09：人均目标超满产真实水平 120%（人人满产幻觉）' }, go));
      if (R.E && R.E.light !== 'green') out.push(Object.assign({
        tone: R.E.light === 'red' ? 'r' : 'a',
        text: `定价 · 团队奖 TIS ${R.E.TIS.toFixed(0)}${R.E.light === 'red' ? '：团队奖只会喂出搭便车' : '：发团队奖前先确认贡献可见度'}`,
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
