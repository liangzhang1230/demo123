/* ============================================================
   育人器（yuren）——「销冠育人器 v2.3」一体版移植
   抬地板，不抬天花板。公式/闸/话术逐字复刻原件；
   跨板块数据不再走信封：M21/UER ← SK.X('suanzhang')，AHC ← SK.X('liuren')，
   M28 ← DB.m28Agreements，练习量 ← DB.practiceLogs，配额 ← DB.paceConfig（缺省回退公司月目标）。
   一体版规约：数据不足 → 引导 banner + 跳转，不上硬锁；null 分项资格闸视为通过并注明。
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { esc, fmt, DASH, safeDiv, mean } = SK;
  const dd = (a, b) => SK.diffDays(a, b);            // b − a（原件 diffDays(a,b)=a−b，移植时已逐处换序）
  const addDays = SK.addDays;

  /* ========= 词库与话术（Y 系逐字） ========= */
  const PLV_BANNED = ["态度", "心态", "性格", "狼性", "拼劲", "不够努力", "意识", "格局", "悟性", "主动性",
    "责任心", "上进心", "你这个人", "不用心", "不上心", "没激情", "抗压能力", "逆商", "企图心",
    "不行", "不专业", "笨", "懒", "没脑子", "态度端正"];                       // ✏️ 只增不删
  const MOMENTUM_BANNED = ["冲", "拼", "必须拿下"];                             // M41③ 动量期加强词
  const TASK_WORDS = ['电话', '线索', '意向', '样品', '签约', '需求', '拜访', '报价', '跟进', '复盘',
    '话术', '异议', '分钟', '客户', '单', '转化', '演示', '确认'];
  const DEFAULT_CULL_VERDICT = 'keep';               // Y-D6 兜底默认「留」
  const M26_DISCLAIMER = '前后对比，非随机对照，要证因果用 M31（留人器系数实验室）。';
  const CALENDAR_WAR_TALK = '主管的个人业绩指标建议下降 30%；主考核换轨为算账器 M11 团队增益——带教有效率只是补充证据，二者互补不混用。';
  const TALK = {
    landing1: '这个系统不复制销冠。销冠不可复制。它做两件事：① 把你团队的地板，抬高三万块。② 让你的销冠，第一次敢把他的本事交出来。',
    boundary: '这个系统不会让一个卖不动的产品卖动。如果你的产品本身有问题——先去改产品。这个系统帮不了你。',
    privacy: '数据不出你电脑：本文件无后端、无网络请求、无埋点。',
    rxFooter: '处方为成长参考，不构成考核依据。',
    spotFooter: '抽检为随机生成，全员同规。',
    y01_reject: '如果把他设为配方源，系统会蒸馏出什么？"多要线索+多打折+快速成交+不管售后"，然后教给你全公司的人。这不是在复制销冠。这是在把一个人的漏水，规模化。',
    y01_accept: '而 J，就是那个只拿到 30 条线索、业绩垫底、三个月前你正准备开掉的那个人。',
    y02: '他会发现。然后他会开始藏。而系统能测到（UER 会下降）。他交出的不是筹码，是一块碑——而这块碑，还在替他赚钱。',
    y02_hiding: '他开始藏了',
    y04: '你在加压。而加压，在 84% 的情况下会杀死这个单子。你不只是在杀单——你还在用公司的毛利，杀单。',
    y10: '稳定输出者要的不是奖，是"被看见"。发奖会挤出他；不看见会失去他。静默认可，是唯一的中间路径。',
    y11: [
      n => `他一个月只拿到 ${n} 条线索。这不是他不干活，这是你没给他饭吃。`,
      p => `他前两周只练了 ${p} 次（基准 50–100）。你还没给他机会，就要淘汰他。`,
      d => `他入职 ${d} 天，一次被确认的辅导都没有。你在淘汰一个没人教过的人。`,
    ],
    y13(templateName) {
      return `你要挂的是一个结果赏（${templateName}）——奖的是他本来就想干的事。` +
      `📎 Gubler-Larkin-Pierce (2016), Org Sci：象征与物质奖励会挤出骨干，产出 −8%；` +
      `📎 Heyman & Ariely：小额金钱把社会规范切换成市场规范（📎 Gneezy & Rustichini 2000《A Fine Is a Price》：罚款取消后行为不回弹——切换不可逆）。` +
      `真正的风险不是"给了钱"，而是：当公司里所有值得做的事都明码标价，没标价的事就自动等于不值得做的事。` +
      `他会完成一次翻译——"冲大单原来是额外有赏的事，那没赏的事就是不用干的事"。` +
      `而你最需要的那部分努力（带徒弟不留一手、关键客户录进系统、难单也接），恰恰是你测不到、也买不到的。` +
      `✅ 所以系统不拦你发钱，只要求你同时留一条不发钱的承认路径：静默认可通道——连续 6 个月达标 → 进灯塔 + 进前程合约资格池，不发奖、不播报、不排名。` +
      `它回答"没赏的事还值不值得干"：值得，因为长期干得好通向的是产权和台阶，不是奖金。不是不许用钱，是不许只有钱。`;
    },
    bountyNames: { first_deal: '首单赏', record_break: '破纪录赏', sprint: '冲刺赏', backlog_clear: '挂账清零赏', hire: '入职赏' },
    stageNames: { leads: '线索', intents: '意向', samples: '样品', contracts: '签约' },
    zoneNames: { accel: '加速区', normal: '常规区', quit_risk: '弃赛区', protect: '保护区' },
  };

  /* ========= 引擎（纯函数，逐字复刻原件 CALC） ========= */
  function extraBanned() {
    if (!Array.isArray(SK.DB.plvExtraWords)) SK.DB.plvExtraWords = [];   // 初始化判空（老库无此字段）
    return SK.DB.plvExtraWords;
  }
  const bannedAll = () => PLV_BANNED.concat(extraBanned());

  /* —— 闸① PLV 处方语言校验器（三层全拦截） —— */
  function plvCheck(text, opts) {
    opts = opts || {};
    const t = String(text || '').trim();
    const banned = (opts.banned || PLV_BANNED)
      .concat(opts.momentum ? (opts.momentumBanned || MOMENTUM_BANNED) : []);
    const hits = banned.filter(w => t.includes(w));
    const l1 = { pass: hits.length === 0, hits };
    let residual = t.replace(/你|他|她|您/g, '');
    (opts.names || []).forEach(n => { residual = residual.split(n).join(''); });
    const l2 = { pass: /\d/.test(residual) || TASK_WORDS.some(w => residual.includes(w)) };
    const hasBehaviorData = /\d/.test(t) && TASK_WORDS.some(w => t.includes(w));
    const hasAction = /(试试|改成|下次|先|把|问|打|加上|换成|今天|本周|再|多做|列出|准备)/.test(t);
    const hasBenchmark = /(基准|配方源|团队均值|上周|上月|参考|对标)/.test(t) && /[\d％%]/.test(t);
    const l3 = { pass: hasBehaviorData && hasAction && hasBenchmark,
      slots: { behaviorData: hasBehaviorData, action: hasAction, benchmark: hasBenchmark } };
    return { l1, l2, l3, passed: l1.pass && l2.pass && l3.pass };
  }
  function plvRewriteHint(plvResult) {
    // 改写建议 = 三槽位写作脚手架（不是替老板下结论，A-19）
    const s = plvResult.l3.slots || {};
    const parts = [];
    if (!plvResult.l1.pass) parts.push('去掉指向"人"的词（' + plvResult.l1.hits.join('、') + '），改说他做了什么');
    if (!s.behaviorData) parts.push('补一条行为数据：昨天/上周他在哪个环节、多少次');
    if (!s.action) parts.push('补一个今天就能做的具体动作（"试试在第 3 分钟问…"）');
    if (!s.benchmark) parts.push('补一个可测基准：配方源或团队均值的数字');
    return parts;
  }

  /* —— 闸② PSI（parts∈[0,1]，逐项 25 分制四舍五入求和；任一 null → null） —— */
  function psiScore(parts) {
    if (!parts) return null;
    const w = SK.getCoef('yuren.psi').w;
    const keys = ['targeting', 'benchmark', 'dataRef', 'ackRate'];
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const v = parts[keys[i]];
      if (v == null) return null;
      sum += Math.round(w[i] * v);
    }
    return sum;
  }
  function psiBand(score) {
    if (score == null) return null;
    const b = SK.getCoef('yuren.psi').bands;
    return score > b[1] ? 'green' : (score >= b[0] ? 'amber' : 'red');
  }

  /* —— 闸④ 配方源资格（四条；一体版：null 分项视为通过并注明，不硬锁） —— */
  function recipeGateCheck(p, ctx) {
    const coef = (ctx && ctx.coef) || SK.getCoef('yuren.recipeGate');
    if (!ctx || !ctx.m21Done) return { locked: true, qualified: false, fails: ['m21_missing'], nulls: [] };
    const fails = [], nulls = [];
    if (p.rankNorm == null) nulls.push('rank');
    else if (p.rankNorm > coef.topN) fails.push('rank');
    if (p.uer == null) nulls.push('uer');
    else if (p.uer < coef.uerMin) fails.push('uer');
    if (coef.discountLeMean) {
      if (p.discountRate == null || ctx.teamDiscountMean == null) nulls.push('discount');
      else if (p.discountRate > ctx.teamDiscountMean) fails.push('discount');
    }
    if (coef.complaintLeMean) {
      if (p.complaintCount == null || ctx.teamComplaintMean == null) nulls.push('complaint');
      else if (p.complaintCount > ctx.teamComplaintMean) fails.push('complaint');
    }
    return { locked: false, qualified: fails.length === 0, fails, nulls };
  }

  /* —— 闸③ 产权前提 + UER 藏拙监测 —— */
  function propertyGate(p) {
    const line = SK.getCoef('shared.ahcTrustLine');
    if (!p.hasM28) return { locked: true, reason: 'no_m28' };
    if (p.ahc == null) return { locked: true, reason: 'ahc_missing' };
    if (p.ahc < line) return { locked: true, reason: 'ahc_low' };
    return { locked: false, reason: null };
  }
  function hidingCheck(uerSeries, minSample) {
    const min = minSample || SK.getCoef('shared.minSampleDefault');
    if (!uerSeries || uerSeries.length < min) return { hiding: null };   // 样本不足不下结论（A-19）
    const prev = uerSeries.slice(0, -1), last = uerSeries[uerSeries.length - 1];
    const sd = SK.stddevS(prev);
    if (sd == null || sd === 0) return { hiding: null };
    return { hiding: (last - mean(prev)) < -0.5 * sd };
  }

  /* —— 闸⑩ 认知鸿沟 = 1 − 确认/上报 —— */
  function cognitiveGap(reportedHrs, confirmedHrs) {
    const r = safeDiv(confirmedHrs, reportedHrs);
    return r == null ? null : 1 - r;
  }

  /* —— M14③ 有效动作分（刷量不增分） —— */
  function effectiveLeads(leads, intents, convLowerBand) {
    if (leads == null) return null;
    if (intents == null || convLowerBand == null || convLowerBand <= 0) return leads;
    return Math.min(leads, intents / convLowerBand);
  }
  function effectiveChain(counts, bands) {
    const eLeads = effectiveLeads(counts.leads, counts.intents, bands && bands.lead2intent);
    const eIntents = effectiveLeads(counts.intents, counts.samples, bands && bands.intent2sample);
    const eSamples = effectiveLeads(counts.samples, counts.contracts, bands && bands.sample2contract);
    return { leads: eLeads, intents: eIntents, samples: eSamples, contracts: counts.contracts };
  }

  /* —— M15 汰前三道拦截 —— */
  function cullInterceptors(ctx, coef) {
    const c = coef || SK.getCoef('yuren.cullGuard');
    const blocks = [];
    if (ctx.leadsIndex != null && ctx.leadsIndex < c.leadsIndexLt) blocks.push('no_leads');
    if (ctx.practice14 != null && ctx.practice14 < c.practice14Min) blocks.push('no_practice');
    if (ctx.ackConfirmedCount === 0) blocks.push('no_coaching');
    return blocks;
  }

  /* —— M13 闸⑧ 挤出对冲（三态） —— */
  const isResultTrigger = t => ['record_break', 'sprint', 'backlog_clear'].indexOf(t) >= 0;
  const isExempt = t => ['first_deal', 'hire'].indexOf(t) >= 0;
  function bountyGate(template, silentTrackOn) {
    if (isExempt(template)) return { allow: true, state: 'exempt' };
    if (isResultTrigger(template) && !silentTrackOn) return { allow: false, state: 'blocked', talk: 'Y-13' };
    return { allow: true, state: 'pass' };
  }

  /* —— M25 JOLT 闸⑫ —— */
  function joltCheck(d, coef) {
    const c = coef || SK.getCoef('yuren.joltRule');
    const high = (d.stayDays != null && d.categoryMedianStayDays != null)
      ? d.stayDays > d.categoryMedianStayDays * c.stallX : null;
    const pressure = high === true && !!d.hasDiscountDuring;
    let ratioRed = null;
    const ratio = safeDiv(d.personDiscountRate, d.othersDiscountRate);
    if (ratio != null) ratioRed = ratio > c.discountX;
    return { highHesitation: high, pressure, ratioRed };
  }

  /* —— M26 地板抬升计量器（前后对比，非随机对照） —— */
  function floorLift(group, coef) {
    const c = coef || SK.getCoef('yuren.floorLift');
    if (!group || !group.members || group.members.length < c.minEach || !group.windowDaysOk)
      return { annualLiftAmt: null, insufficient: true };
    let lift = 0;
    for (const m of group.members) {
      if (m.beforeMonthlyAmt == null || m.afterMonthlyAmt == null) return { annualLiftAmt: null, insufficient: true };
      lift += m.afterMonthlyAmt - m.beforeMonthlyAmt;
    }
    return { annualLiftAmt: lift * 12, monthlyLiftAmt: lift, insufficient: false };
  }
  function recipeRoi(annualLiftAmt, monthlyCostAmt) {
    return safeDiv(annualLiftAmt, monthlyCostAmt == null ? null : monthlyCostAmt * 12);
  }

  /* —— M40 配对传帮带排班器 —— */
  function m40Pairing(input, coef) {
    const c = coef || SK.getCoef('yuren.m40');
    const n = input.people.length;
    const coachCand = input.people
      .filter(p => p.rankNorm != null && p.rankNorm <= c.coachTopN)
      .filter(p => input.gate4PassIds.indexOf(p.spId) >= 0)
      .sort((a, b) => a.rankNorm - b.rankNorm);
    const frozen = coachCand.filter(p => input.m28SignedIds.indexOf(p.spId) < 0);
    const coaches = coachCand.filter(p => input.m28SignedIds.indexOf(p.spId) >= 0);
    const coachIds = coachCand.map(p => p.spId);
    const lo = n * c.learnerBand[0], hi = n * c.learnerBand[1];
    const learners = input.people
      .filter(p => p.rankNorm != null && p.rankNorm > lo && p.rankNorm <= hi)
      .filter(p => coachIds.indexOf(p.spId) < 0)
      .sort((a, b) => (a.growth3m == null ? 1 : b.growth3m == null ? -1 : a.growth3m - b.growth3m));
    const pairs = [], queued = [];
    let li = 0;
    for (const coach of coaches) {
      // 轮换铁律：同一对 consecutiveWeeks ≥ pairWeeksMax → 第 4 周强制轮换（跳过该学员）
      while (li < learners.length) {
        const cw = (input.prevWeeks || {})[coach.spId + '|' + learners[li].spId] || 0;
        if (cw >= c.pairWeeksMax) { queued.push(learners[li].spId); li++; continue; }
        break;
      }
      if (li >= learners.length) break;
      pairs.push({ coachId: coach.spId, learnerId: learners[li].spId });
      li++;
    }
    for (; li < learners.length; li++) queued.push(learners[li].spId);
    return { pairs, queued, frozenCoachIds: frozen.map(p => p.spId) };
  }
  function pairAllowed(consecutiveWeeks, coef) {
    const max = (coef && coef.pairWeeksMax) || SK.getCoef('yuren.m40').pairWeeksMax;
    return consecutiveWeeks < max;
  }

  /* —— M41 动量连败干预器 —— */
  function momentum(lossStreak, prevWinRate, curWinRate, coef) {
    const c = coef || SK.getCoef('yuren.m41');
    const dropRatio = (prevWinRate == null || curWinRate == null || prevWinRate <= 0) ? null
      : Math.max(0, (prevWinRate - curWinRate) / prevWinRate);
    if (lossStreak == null && dropRatio == null) return { score: null, triggered: null };
    const s = c.w[0] * Math.min((lossStreak || 0) / c.streakCap, 1)
            + c.w[1] * Math.min(dropRatio == null ? 0 : dropRatio, 1);
    const score = Math.round(s * 100) / 100;
    return { score, triggered: (lossStreak || 0) >= c.lossStreakTrigger || score >= c.scoreTrigger };
  }

  /* —— M42 深板凳榜样匹配（曼哈顿轨迹距离，万元；匹配空 → null 不硬凑） —— */
  function trajDistance(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return null;
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] == null || b[i] == null) return null;
      s += Math.abs(a[i] - b[i]);
    }
    return s;
  }
  function m42Match(laggardTraj, candidates) {
    let best = null;
    for (const cand of candidates || []) {
      if (!cand.nowBandOk) continue;
      const d = trajDistance(laggardTraj, cand.traj);
      if (d == null) continue;
      if (!best || d < best.dist) best = { spId: cand.spId, dist: d };
    }
    return best;
  }

  /* —— M43 分层节奏引擎 —— */
  function paceZone(completion, opts, coef) {
    if (completion == null) return null;
    const c = coef || SK.getCoef('yuren.m43');
    const o = opts || {};
    const bigDealProtect = (o.inFlightBigDealAmt != null && o.monthQuotaAmt != null
      && o.inFlightBigDealAmt > o.monthQuotaAmt * c.protectBigDealShare);
    if (completion >= 1.0 || bigDealProtect) return 'protect';
    if (completion < c.quitLt) return 'quit_risk';
    if (completion >= c.accel[0] && completion < c.accel[1]) return 'accel';
    return 'normal';
  }
  function subGoalAmt(remainWorkdays, dailyAvgAmt, coef) {
    // 子目标 = roundTo(剩余工作日 × 个人历史日均回款 × 1.1, 百元)；只影响推送节奏，不写配额/提成
    const c = coef || SK.getCoef('yuren.m43');
    if (remainWorkdays == null || dailyAvgAmt == null) return null;
    return SK.roundTo(remainWorkdays * dailyAvgAmt * c.subGoalX, 10000);   // 百元 = 10000 分
  }

  /* —— M44a 资历忽视 —— */
  const m44aRatio = (veteranAvgDoseHrs, teamAvgDoseHrs) => safeDiv(veteranAvgDoseHrs, teamAvgDoseHrs);

  /* —— 闸⑪ 辅导剂量（confirmed，窗口 90 天，人均月；供留人器分红闸 Q4 实时取用） —— */
  function coachingDoseActual(acks, activeCount, windowDays, today) {
    if (!activeCount || !windowDays) return null;
    const from = addDays(today, -windowDays);
    let total = 0;
    for (const a of acks || []) {
      if (a.status === 'confirmed' && a.durationHrs != null && a.date > from && a.date <= today)
        total += a.durationHrs;
    }
    const perCapitaMonthly = safeDiv(total, activeCount) == null ? null
      : (total / activeCount) * (30 / windowDays);
    return perCapitaMonthly == null ? null : Math.round(perCapitaMonthly * 10) / 10;
  }

  /* —— 休息日规则（分母/连续计数/催报/插卡四处全排除，Y-D8） —— */
  function isWorkday(dateStr, shiftConfig, spId) {
    const sc = shiftConfig || {};
    const rest = sc[spId] || sc['*'] || [0];
    return rest.indexOf(SK.weekdayOf(dateStr)) < 0;
  }

  /* —— M14① 挂账爆破 + 量增质塌 —— */
  function backlogCheck(d, today, coef) {
    const c = coef || SK.getCoef('yuren.backlogAlert');
    if (d.paidDate) return null;
    const days = dd(d.contractDate, today);
    if (days > c.bossDays) return 'boss';
    if (days > c.managerDays) return 'manager';
    return null;
  }
  function surgeCollapse(cur, prev, coef) {
    // 量增质塌：计数 +50% ∧ 转化 −30% → 抽检加权 ×3
    const c = coef || SK.getCoef('yuren.backlogAlert');
    const up = safeDiv(cur.leads - prev.leads, prev.leads);
    const down = safeDiv(prev.conv - cur.conv, prev.conv);
    if (up == null || down == null) return null;
    return up >= c.surgeUp && down >= c.dropDown;
  }

  /* ========= 跨板块实时取数（原信封 XREF → 一体版实时总线） ========= */
  function m21Data() {
    const sz = SK.X('suanzhang');
    if (!sz || !sz.m21rows || !sz.m21rows.length) return null;
    return sz.m21rows.map(r => {
      const pp = (sz.perPerson || {})[r.spId] || {};
      const uer = sz.uerBySp && sz.uerBySp[r.spId] ? sz.uerBySp[r.spId].resid : null;
      return {
        spId: r.spId, name: r.name, rankNorm: r.normRank != null ? r.normRank : null,
        uer: uer != null ? uer : (pp.uer != null ? pp.uer : null),
        discountRate: r.discountRate != null ? r.discountRate : (pp.discountRate != null ? pp.discountRate : null),
        complaintCount: pp.complaintCount != null ? pp.complaintCount : null,   // 一体版恒 null：无客诉数据源
        growth3m: pp.growth3m != null ? pp.growth3m : null,
        traj6: pp.traj6 || null, trajEarly: pp.trajEarly || null,
        uerSeries: pp.uerSeries || null, leadIndex: pp.leadIndex != null ? pp.leadIndex : null,
      };
    }).sort((a, b) => (a.rankNorm == null ? 99 : a.rankNorm) - (b.rankNorm == null ? 99 : b.rankNorm));
  }
  function gateCtx(rows) {
    return {
      m21Done: !!(rows && rows.length),
      teamDiscountMean: rows ? mean(rows.map(r => r.discountRate).filter(v => v != null)) : null,
      teamComplaintMean: rows ? mean(rows.map(r => r.complaintCount).filter(v => v != null)) : null,
      coef: SK.getCoef('yuren.recipeGate'),
    };
  }
  const m21Row = spId => { const rows = m21Data(); return rows ? rows.find(r => r.spId === spId) || null : null; };
  const teamAhc = () => { const lr = SK.X('liuren'); return lr && lr.ahc != null ? lr.ahc : null; };
  const m28For = spId => SK.DB.m28Agreements.filter(a => a.masterId === spId);
  const practice14 = spId => { const row = SK.DB.practiceLogs.find(x => x.spId === spId); return row ? row.count14 : null; };
  function quotaFor(db, spId) {
    const manual = db.paceConfig.manualQuotaBySp[spId];
    if (manual != null) return { amt: manual, src: 'manual' };
    const w = db.company.targetPersonalMonthlyGrossWan;
    return w ? { amt: Math.round(w * SK.WAN), src: 'company' } : null;
  }

  /* ========= 派生视图层（读 DB + X → 屏所需数据） ========= */
  const activeSps = () => SK.activeSales();
  const spName = spId => { const p = SK.personById(spId); return p ? p.name : spId; };
  const tenureDays = (spId, today) => { const p = SK.personById(spId); return p ? dd(p.hireDate, today) : null; };
  const reportsFor = (db, spId, from, to) => db.dailyReports.filter(r => r.employeeId === spId && r.date >= from && r.date <= to);
  function workdaysIn(db, spId, from, to) {
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, db.shiftConfig, spId)) n++;
    return n;
  }
  function sumCounts(reports) {
    const s = { leads: 0, intents: 0, samples: 0, contracts: 0 };
    for (const r of reports) { s.leads += r.counts.leads; s.intents += r.counts.intents; s.samples += r.counts.samples; s.contracts += r.counts.contracts; }
    return s;
  }
  const wonDeals = (db, spId) => db.deals.filter(d => d.employeeId === spId && d.status === 'won' && d.dealDate)
    .sort((a, b) => a.dealDate < b.dealDate ? -1 : 1);
  const catName = id => { const c = SK.catById(id); return c ? c.name : '—'; };

  /* —— 个人近90天转化率下限带宽（周桶最小值；桶<3 → null） —— */
  function convBands(db, spId, today) {
    const from = addDays(today, -90);
    const buckets = {};
    for (const r of reportsFor(db, spId, from, today)) {
      const wk = Math.floor(dd(r.date, today) / 7);
      const b = buckets[wk] || (buckets[wk] = { leads: 0, intents: 0, samples: 0, contracts: 0 });
      b.leads += r.counts.leads; b.intents += r.counts.intents; b.samples += r.counts.samples; b.contracts += r.counts.contracts;
    }
    const ratios = { lead2intent: [], intent2sample: [], sample2contract: [] };
    Object.keys(buckets).forEach(k => {
      const b = buckets[k];
      if (b.leads > 0) ratios.lead2intent.push(b.intents / b.leads);
      if (b.intents > 0) ratios.intent2sample.push(b.samples / b.intents);
      if (b.samples > 0) ratios.sample2contract.push(b.contracts / b.samples);
    });
    const band = arr => arr.length >= 3 ? Math.min.apply(null, arr) : null;
    return { lead2intent: band(ratios.lead2intent), intent2sample: band(ratios.intent2sample), sample2contract: band(ratios.sample2contract) };
  }
  function bandsFor(db, spId, today) {
    // 新人 <30 天：用配方源带宽 × newbieBandFactor(0.60)
    const t = tenureDays(spId, today);
    if (t != null && t < 30 && db.recipeSource && db.recipeSource.sourceIds.length) {
      const src = convBands(db, db.recipeSource.sourceIds[0], today);
      const f = SK.getCoef('yuren.effectiveScore').newbieBandFactor;
      return { lead2intent: src.lead2intent == null ? null : src.lead2intent * f,
        intent2sample: src.intent2sample == null ? null : src.intent2sample * f,
        sample2contract: src.sample2contract == null ? null : src.sample2contract * f };
    }
    return convBands(db, spId, today);
  }

  /* —— M12 三张牌（剂量/配比/节奏；近180天，零新增录入） —— */
  function threeCards(db, today) {
    if (!db.recipeSource || !db.recipeSource.sourceIds.length) return null;
    const ids = db.recipeSource.sourceIds;
    const from = addDays(today, -180);
    const per = ids.map(id => {
      const reps = reportsFor(db, id, from, today);
      const wd = Math.max(1, reps.length);   // 有报工作日
      const s = sumCounts(reps);
      const deals = wonDeals(db, id);
      const gaps = [];
      for (let i = 1; i < deals.length; i++) gaps.push(dd(deals[i - 1].dealDate, deals[i].dealDate));
      const catCount = {};
      deals.forEach(d => catCount[d.categoryId] = (catCount[d.categoryId] || 0) + 1);
      const topCatId = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0] || null;
      const p = SK.personById(id);
      return {
        dose: { leads: s.leads / wd, intents: s.intents / wd, samples: s.samples / wd, contracts: s.contracts / wd },
        mix: { l2i: safeDiv(s.intents, s.leads), i2s: safeDiv(s.samples, s.intents), s2c: safeDiv(s.contracts, s.samples) },
        pace: { firstDealDays: (deals.length && p) ? dd(p.hireDate, deals[0].dealDate) : null,
          gapMedian: gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null,
          topCat: topCatId ? catName(topCatId) : null,
          topCatShare: deals.length ? (catCount[topCatId] || 0) / deals.length : null },
      };
    });
    const avg = key1 => {
      const out = {};
      Object.keys(per[0][key1]).forEach(k => {
        const vals = per.map(x => x[key1][k]).filter(v => v != null && typeof v === 'number');
        out[k] = vals.length ? mean(vals) : per[0][key1][k];
      });
      return out;
    };
    return { dose: avg('dose'), mix: avg('mix'), pace: per[0].pace, nSources: ids.length };
  }

  /* —— 首N天基准（配方源入职期日报；样本<3 → 单人基准标注） —— */
  function firstNDaysBaseline(db, today) {
    if (!db.recipeSource || !db.recipeSource.sourceIds.length) return null;
    const N = SK.getCoef('yuren.newbieWindow').days;
    const samples = [];
    for (const id of db.recipeSource.sourceIds) {
      const p = SK.personById(id);
      if (!p) continue;
      const reps = reportsFor(db, id, p.hireDate, addDays(p.hireDate, N - 1));
      if (reps.length >= 3) {
        const s = sumCounts(reps);
        samples.push({ leads: s.leads / reps.length, intents: s.intents / reps.length, samples: s.samples / reps.length });
      }
    }
    if (!samples.length) return { missing: true };
    return {
      missing: false, singleSample: samples.length < 3, n: samples.length,
      daily: { leads: mean(samples.map(s => s.leads)), intents: mean(samples.map(s => s.intents)), samples: mean(samples.map(s => s.samples)) },
    };
  }

  /* —— 量×质散点（横轴=有效动作分/工作日 · 纵轴=线索→签约转化） —— */
  function scatterData(db, today) {
    const from = addDays(today, -90);
    return activeSps().map(p => {
      const reps = reportsFor(db, p.spId, from, today);
      if (!reps.length) return null;
      const s = sumCounts(reps);
      const eff = effectiveChain(s, bandsFor(db, p.spId, today));
      const x = safeDiv(eff.leads, reps.length);
      const y = safeDiv(s.contracts, s.leads);
      return (x == null || y == null) ? null : { spId: p.spId, name: p.name, x, y };
    }).filter(Boolean);
  }

  /* —— 处方诊断三型（量差/质差/速差按偏差最大；证据不全不下结论 A-19） —— */
  function rxDiagnose(db, spId, today) {
    const cards = threeCards(db, today);
    if (!cards) return { none: true, reason: '未设定配方源' };
    const from = addDays(today, -30);
    const reps = reportsFor(db, spId, from, today);
    if (reps.length < 5) return { none: true, reason: '近 30 天填报不足 5 天，证据不全，不下结论' };
    const s = sumCounts(reps);
    const myDose = s.leads / reps.length;
    const myMix = safeDiv(s.contracts, s.leads);
    const srcMix = (cards.mix.l2i != null && cards.mix.i2s != null && cards.mix.s2c != null)
      ? cards.mix.l2i * cards.mix.i2s * cards.mix.s2c : null;
    const coef = SK.getCoef('yuren.rxRules');
    const doseRatio = safeDiv(myDose, cards.dose.leads);
    const mixRatio = safeDiv(myMix, srcMix);
    const dev = [];
    if (doseRatio != null && doseRatio < coef.volumeLt) dev.push({ type: 'volume', gap: coef.volumeLt - doseRatio, doseRatio });
    if (mixRatio != null && mixRatio < coef.qualityLt) dev.push({ type: 'quality', gap: coef.qualityLt - mixRatio, mixRatio });
    const sorted = wonDeals(db, spId);
    const gapDays = [];
    for (let i = 1; i < sorted.length; i++) gapDays.push(dd(sorted[i - 1].dealDate, sorted[i].dealDate));
    const myGap = gapDays.length ? mean(gapDays) : null;
    if (myGap != null && cards.pace.gapMedian != null && myGap > cards.pace.gapMedian * coef.speedX)
      dev.push({ type: 'speed', gap: myGap / cards.pace.gapMedian - coef.speedX, myGap });
    if (!dev.length) return { none: true, reason: '三型偏差均未触发（量/质/速都在带内）' };
    dev.sort((a, b) => b.gap - a.gap);
    return { none: false, top: dev[0], all: dev,
      facts: { myDose, srcDose: cards.dose.leads, myMix, srcMix, myGap, srcGap: cards.pace.gapMedian, days: reps.length } };
  }
  function rxAutoText(db, spId, today) {
    const d = rxDiagnose(db, spId, today);
    if (d.none) return null;
    const f = d.facts;
    if (d.top.type === 'volume')
      return `近 ${f.days} 个工作日你日均 ${f.myDose.toFixed(1)} 条线索，配方源基准 ${f.srcDose.toFixed(1)} 条。` +
        `今天试试先把老客户名单里 3 个未跟进的联系一遍，本周把日均线索补到 ${(f.srcDose * 0.8).toFixed(0)} 条。`;
    if (d.top.type === 'quality')
      return `近 30 天你的线索→签约转化 ${fmt.pct(f.myMix)}，配方源基准 ${fmt.pct(f.srcMix)}。` +
        `今天试试在第 3 分钟问"您现在最头疼的是什么？"，把需求确认做在报价前——已为你生成带教任务。`;
    return `你的出单间隔约 ${f.myGap.toFixed(0)} 天，配方源基准 ${f.srcGap} 天。` +
      `今天先挑 1 个停在样品环节超 2 周的客户，把下一步动作约到本周内。`;
  }
  function psiPartsFor(db, spId, text, diag) {
    const acked = db.prescriptions.filter(r => r.employeeId === spId);
    const ackRate = acked.length >= 3 ? acked.filter(r => r.ackedAt).length / acked.length : null;
    return {
      targeting: diag && !diag.none ? 1.0 : 0.2,
      benchmark: text.indexOf('配方源') >= 0 ? 1.0 : (text.indexOf('均值') >= 0 ? 0.5 : 0),
      dataRef: /\d/.test(text) ? 1.0 : 0,
      ackRate,
    };
  }

  /* —— M15 新人筛选看板（7 天红绿灯 · 阈值=首N天基准×80% · 兜底「留」） —— */
  function newbieBoard(db, today) {
    const nw = SK.getCoef('yuren.newbieWindow');
    const base = firstNDaysBaseline(db, today);
    return activeSps().filter(p => { const t = dd(p.hireDate, today); return t >= 0 && t <= 30; }).map(p => {
      const t = dd(p.hireDate, today);
      const reps = reportsFor(db, p.spId, p.hireDate, today);
      const days = [];
      let redStreak = 0, maxStreak = 0;
      if (base && !base.missing) {
        for (let d = p.hireDate; d <= today && dd(p.hireDate, d) < nw.days; d = addDays(d, 1)) {
          if (!isWorkday(d, db.shiftConfig, p.spId)) continue;   // 休息日不计（Y-D8）
          const r = reps.find(x => x.date === d);
          const eff = r ? effectiveChain(r.counts, bandsFor(db, p.spId, today)) : null;
          const att = eff ? safeDiv(eff.leads, base.daily.leads * nw.thresholdRate) : 0;
          const red = att == null || att < nw.redLine;
          days.push({ date: d, att, red });
          redStreak = red ? redStreak + 1 : 0;
          maxStreak = Math.max(maxStreak, redStreak);
        }
      }
      const s = sumCounts(reps);
      const monthlyLeads = t > 0 ? Math.round(s.leads * (30 / Math.max(1, t))) : s.leads;
      const teamLeadMean = mean(activeSps().filter(x => x.spId !== p.spId).map(x => {
        const rr = reportsFor(db, x.spId, addDays(today, -30), today);
        return rr.length ? sumCounts(rr).leads : null;
      }).filter(v => v != null));
      const leadsIndex = safeDiv(monthlyLeads, teamLeadMean);
      const acks = db.coachingAcks.filter(a => a.spId === p.spId && a.status === 'confirmed');
      const ctx = { leadsIndex, practice14: practice14(p.spId), ackConfirmedCount: acks.length };
      const blocks = cullInterceptors(ctx);
      const suggestCull = base && !base.missing && maxStreak >= nw.redStreakDays;
      return { sp: p, tenure: t, days, maxStreak, suggestCull, blocks, ctx,
        verdict: DEFAULT_CULL_VERDICT, baselineMissing: !base || base.missing, singleSample: !!(base && base.singleSample) };
    });
  }

  /* —— M41 动量（从 Deal 事件流派生，无独立存储） —— */
  function momentumStates(db, today) {
    const coef = SK.getCoef('yuren.m41');
    return activeSps().map(p => {
      const closed = db.deals.filter(d => d.employeeId === p.spId && d.closeDate && (d.status === 'won' || d.status === 'lost'))
        .sort((a, b) => a.closeDate < b.closeDate ? -1 : 1);
      if (!closed.length) return null;
      let streak = 0;
      for (let i = closed.length - 1; i >= 0; i--) { if (closed[i].status === 'lost') streak++; else break; }
      const win = (from, to) => {
        const w = closed.filter(d => d.closeDate > from && d.closeDate <= to);
        return w.length >= 5 ? w.filter(d => d.status === 'won').length / w.length : null;
      };
      const cur = win(addDays(today, -coef.winRateWindowDays), today);
      const prev = win(addDays(today, -2 * coef.winRateWindowDays), addDays(today, -coef.winRateWindowDays));
      const m = momentum(streak, prev, cur, coef);
      return m.triggered ? { sp: p, streak, prev, cur, score: m.score } : null;
    }).filter(Boolean);
  }
  function smallDealLeads(db, spId, today) {
    // ① 高把握小单：历史赢率最高品类中，金额 ≤ aov×0.5 的在库单
    const coef = SK.getCoef('yuren.m41');
    const deals = db.deals.filter(d => d.employeeId === spId);
    const byCat = {};
    deals.filter(d => d.closeDate).forEach(d => {
      const b = byCat[d.categoryId] || (byCat[d.categoryId] = { won: 0, n: 0 });
      b.n++; if (d.status === 'won') b.won++;
    });
    const bestCat = Object.keys(byCat).sort((a, b) => (byCat[b].won / byCat[b].n) - (byCat[a].won / byCat[a].n))[0];
    const wonAmts = deals.filter(d => d.status === 'won').map(d => d.paymentAmt);
    const aov = wonAmts.length ? mean(wonAmts) : null;
    if (!bestCat || aov == null) return { bestCat: null, list: [] };
    return { bestCat: catName(bestCat), aov,
      list: deals.filter(d => d.status === 'open' && d.categoryId === bestCat && d.paymentAmt <= aov * coef.smallDealAovX) };
  }

  /* —— M42 深板凳（榜样匹配） —— */
  function m42Board(db, today) {
    const rows = m21Data();
    if (!rows) return null;
    const withRank = rows.filter(r => r.rankNorm != null);
    const n = withRank.length;
    const band = SK.getCoef('yuren.m42').laggardBand;
    const laggards = withRank.filter(r => r.rankNorm > n * (1 - band));
    const midLine = n * (2 / 3);
    return laggards.map(lag => {
      if (!lag.traj6) return { lag, best: null };
      const candidates = withRank.filter(r => r.spId !== lag.spId && r.trajEarly)
        .map(r => ({ spId: r.spId, traj: r.trajEarly, nowBandOk: r.rankNorm <= midLine }));
      return { lag, best: m42Match(lag.traj6, candidates) };
    });
  }

  /* —— M43 节奏台 —— */
  function paceBoard(db, today) {
    const coef = SK.getCoef('yuren.m43');
    const monthStart = today.slice(0, 8) + '01';
    return activeSps().map(p => {
      const q = quotaFor(db, p.spId);
      if (!q) return { sp: p, zone: null };
      const paid = db.deals.filter(d => d.employeeId === p.spId && d.status === 'won' && d.paidDate
        && d.paidDate >= monthStart && d.paidDate <= today);
      const paidAmt = paid.reduce((s, d) => s + d.paymentAmt, 0);
      const completion = safeDiv(paidAmt, q.amt);
      const inFlightBig = Math.max(0, ...db.deals
        .filter(d => d.employeeId === p.spId && d.status === 'open').map(d => d.paymentAmt), 0);
      const zone = paceZone(completion, { inFlightBigDealAmt: inFlightBig, monthQuotaAmt: q.amt }, coef);
      // 弃赛区子目标：剩余工作日 × 90 天日均回款 × 1.1（不写配额）
      let sub = null;
      if (zone === 'quit_risk') {
        const monthEnd = addDays(monthStart.slice(0, 8) + '28', 4).slice(0, 8) + '01';
        const remainWd = workdaysIn(db, p.spId, addDays(today, 1), addDays(monthEnd, -1));
        const past = db.deals.filter(d => d.employeeId === p.spId && d.status === 'won' && d.paidDate
          && d.paidDate > addDays(today, -90) && d.paidDate <= today);
        const wd90 = workdaysIn(db, p.spId, addDays(today, -90), today);
        const dailyAvg = safeDiv(past.reduce((s, d) => s + d.paymentAmt, 0), wd90);
        sub = subGoalAmt(remainWd, dailyAvg, coef);
      }
      return { sp: p, completion, zone, quota: q, sub };
    });
  }

  /* —— M40 本周配对装配（M21 + 闸④③；PairAssignment 落库） —— */
  function m40WeeklyInput(db, today) {
    const rows = m21Data();
    if (!rows) return null;
    const ctx = gateCtx(rows);
    const people = rows.map(r => ({ spId: r.spId, rankNorm: r.rankNorm, growth3m: r.growth3m }));
    const gate4PassIds = rows.filter(r => recipeGateCheck(r, ctx).qualified).map(r => r.spId);
    const m28SignedIds = people.filter(p => m28For(p.spId).length > 0).map(p => p.spId);
    const prevWeeks = {};
    db.pairAssignments.forEach(pa => { prevWeeks[pa.coachId + '|' + pa.learnerId] = pa.consecutiveWeeks || 1; });
    return { people, gate4PassIds, m28SignedIds, prevWeeks };
  }
  function topicFor(db, learnerId, today) {
    const d = rxDiagnose(db, learnerId, today);
    if (d.none) return { stage: '需求确认', text: '本周话题：把最近 3 个丢单各用 5 分钟复盘一遍——丢在哪个环节，下次那个环节做什么动作。' };
    const map = { volume: '线索获取', quality: '需求确认', speed: '推进节奏' };
    return { stage: map[d.top.type], text: '本周话题（20 分钟）：围绕「' + map[d.top.type] + '」，教练讲自己的 2 个具体做法，学员当场选 1 个，下周回执确认。' };
  }

  /* —— M44a / 剂量统计（confirmed 窗口 90 天） —— */
  function doseStats(db, today) {
    const m44 = SK.getCoef('yuren.m44');
    const W = SK.getCoef('yuren.floorLift').windowDays;   // 90 天窗
    const from = addDays(today, -W);
    const per = activeSps().map(p => {
      const hrs = db.coachingAcks.filter(a => a.spId === p.spId && a.status === 'confirmed'
        && a.date > from && a.date <= today).reduce((s, a) => s + (a.durationHrs || 0), 0);
      return { sp: p, hrs };
    });
    const teamAvg = mean(per.map(x => x.hrs));
    const vets = per.filter(x => { const t = tenureDays(x.sp.spId, today); return t != null && t > m44.tenureYears * 365; });
    const vetAvg = vets.length ? mean(vets.map(x => x.hrs)) : null;
    const ratio = m44aRatio(vetAvg, teamAvg);
    const reported = db.coachingAcks.filter(a => a.date > from && a.date <= today)
      .reduce((s, a) => s + (a.reportedHrs || a.durationHrs || 0), 0);
    const confirmed = db.coachingAcks.filter(a => a.status === 'confirmed' && a.date > from && a.date <= today)
      .reduce((s, a) => s + (a.durationHrs || 0), 0);
    return { per, teamAvg, vetAvg, ratio, vetsCount: vets.length,
      gap: cognitiveGap(reported, confirmed),
      dose: coachingDoseActual(db.coachingAcks, activeSps().length, W, today) };
  }

  /* —— M14① 挂账 + M25 JOLT 看板 —— */
  function backlogBoard(db, today) {
    return db.deals.filter(d => d.status === 'won' && d.dealDate && !d.paidDate).map(d => {
      const level = backlogCheck({ contractDate: d.dealDate, paidDate: d.paidDate }, today);
      return level ? { deal: d, level, days: dd(d.dealDate, today) } : null;
    }).filter(Boolean);
  }
  function teamDiscountRateExcept(db, spId) {
    const others = db.deals.filter(d => d.employeeId !== spId);
    if (!others.length) return null;
    return others.filter(d => d.discountRate > 0).length / others.length;
  }
  function joltBoard(db, today) {
    const out = [];
    for (const p of activeSps()) {
      const mine = db.deals.filter(d => d.employeeId === p.spId);
      const discounted = mine.filter(d => d.discountRate > 0);
      const pRate = mine.length ? discounted.length / mine.length : null;
      for (const d of mine.filter(d => d.status === 'open' && d.intentDate)) {
        const cat = SK.catById(d.categoryId);
        const median = cat ? cat.medianStayDays : null;
        const r = joltCheck({ stayDays: dd(d.intentDate, today), categoryMedianStayDays: median,
          hasDiscountDuring: d.discountRate > 0, personDiscountRate: pRate,
          othersDiscountRate: teamDiscountRateExcept(db, p.spId) });
        if (r.highHesitation) out.push({ sp: p, deal: d, check: r, median });
      }
    }
    return out;
  }

  /* —— M26 你的账实算位（锚点=首张处方日；条件不足 → 诚实“—”） —— */
  function monthlyPaidAvg(db, spId, from, to) {
    const ds = db.deals.filter(d => d.employeeId === spId && d.status === 'won' && d.dealDate && d.dealDate >= from && d.dealDate < to);
    if (!ds.length) return null;
    const days = Math.max(1, dd(from, to));
    return ds.reduce((s, d) => s + d.paymentAmt, 0) * 30 / days;
  }
  function myFloorAccount(db, today) {
    const c = SK.getCoef('yuren.floorLift');
    const rows = m21Data();
    if (!rows) return { insufficient: true, why: '需要算账器 M21 归一化（后 50% 的划分依据）' };
    const anchor = db.prescriptions.map(r => r.date).sort()[0] || null;
    if (!anchor) return { insufficient: true, why: '还没有任何处方——前后各 90 天窗口无从锚定' };
    if (dd(anchor, today) < c.windowDays) return { insufficient: true, why: `处方后窗口未满 ${c.windowDays} 天（现 ${dd(anchor, today)} 天）` };
    const withRank = rows.filter(r => r.rankNorm != null);
    const half = withRank.slice(Math.ceil(withRank.length / 2));   // 后 50%
    const members = half.map(r => ({
      beforeMonthlyAmt: monthlyPaidAvg(db, r.spId, addDays(anchor, -c.windowDays), anchor),
      afterMonthlyAmt: monthlyPaidAvg(db, r.spId, anchor, addDays(anchor, c.windowDays)),
    }));
    const lift = floorLift({ members, windowDaysOk: true }, c);
    if (lift.insufficient) return { insufficient: true, why: `后 50% 成员 ≥${c.minEach} 人且前后各 ${c.windowDays} 天均有成交数据才计（现 ${members.length} 人）` };
    return { insufficient: false, annualLiftAmt: lift.annualLiftAmt, monthlyLiftAmt: lift.monthlyLiftAmt,
      n: members.length, anchor, roi: recipeRoi(lift.annualLiftAmt, 736000) };
  }

  /* ========= 领域写入口（保存校验 = 唯一路径；拦截即无保存） ========= */
  function savePrescription(db, rx, today) {
    const names = db.people.map(p => p.name).filter(Boolean);
    const plv = plvCheck(rx.text, { banned: bannedAll(), names, momentum: !!rx.momentumMode });
    if (!plv.passed && !rx.insist) return { ok: false, plv, hints: plvRewriteHint(plv) };
    if (!plv.passed && rx.insist)
      db.insistLog.push({ date: today, spId: rx.employeeId || null, text: rx.text });  // 坚持原文留痕 → 认知鸿沟风险
    db.prescriptions.push({
      rxId: SK.uid('rx'), employeeId: rx.employeeId || null, date: today,
      type: rx.type || 'volume', text: rx.text,
      psiParts: rx.psiParts || null, plvPassed: plv.passed, ackedAt: null,
    });
    return { ok: true, plv };
  }
  function saveBounty(db, b, today) {
    const gate = bountyGate(b.template, db.silentTrackOn);
    if (!gate.allow) return { ok: false, talk: gate.talk, state: gate.state };   // 🔴 拦截保存
    const activeCount = db.bounties.filter(x => x.active).length;
    if (activeCount >= 3) return { ok: false, err: '同时活动的悬赏 ≤ 3' };
    db.bounties.push({ bountyId: SK.uid('bt'), template: b.template, amountAmt: b.amountAmt || null,
      active: true, createdAt: today, achievedEvents: [] });
    return { ok: true, state: gate.state };
  }
  function saveDailyReport(db, r) {
    const dup = db.dailyReports.find(x => x.employeeId === r.spId && x.date === r.date);
    const counts = { leads: r.counts.leads | 0, intents: r.counts.intents | 0,
      samples: r.counts.samples | 0, contracts: r.counts.contracts | 0 };
    if (dup) { dup.counts = counts; return { ok: true, updated: true }; }
    db.dailyReports.push({ drId: SK.uid('dr'), employeeId: r.spId, date: r.date, counts, submittedAt: r.date });
    return { ok: true };
  }
  function makeSpotCheckCard(spId, weekOf, stage, reportedCount) {
    // Y-D7：只出题不记结果——schema 不存在结果/标记字段
    return { sccId: SK.uid('scc'), weekOf, employeeId: spId, checkDate: weekOf, stage, reportedCount };
  }
  function setRecipeSource(db, sourceIds, today) {
    // 每次设定必过闸④（Y-D3）
    const rows = m21Data();
    const ctx = gateCtx(rows);
    for (const id of sourceIds) {
      const check = recipeGateCheck(m21Row(id) || {}, ctx);
      if (check.locked || !check.qualified) return { ok: false, spId: id, check };
    }
    db.recipeSource = { sourceIds, setAt: today, setBy: 'boss' };
    return { ok: true };
  }

  /* ========= 屏渲染 ========= */
  let rxSp = null, rxDraft = '', mySp = null, fillDate = null, bountyBlocked = null;   // 模块草稿态（不入库）
  const curRxSp = () => rxSp && SK.personById(rxSp) ? rxSp : (activeSps()[0] || {}).spId || null;
  const btnNav = (label, board, sub, cls) => h.btn(label, 'ui.nav', { cls: cls || 'sm', data: `data-board="${board}"${sub ? ` data-sub="${sub}"` : ''}` });
  const srcLine = t => h.src('📎 ' + esc(t));
  const needSz = () => h.banner(`需要算账器 M21 归一化结果——排名的唯一合法输入是归一化（未归一化的"业绩第一"可能只是地盘最肥）。一体版不上锁：把人员/线索/成交数据补齐后本屏自动点亮。 ${btnNav('去算账器 →', 'suanzhang')}`, 'a');
  const gateName = { rank: '归一化排名不在前 3', uer: 'UER < 0（拿了超额资源才有超额业绩）', discount: '折扣泄漏 > 团队均值', complaint: '客诉/退款 > 团队均值' };
  const gateShort = { rank: '排名', uer: 'UER', discount: '折扣', complaint: '客诉' };
  const nullNote = { rank: '无归一化排名', uer: '无 UER 数据', discount: '无折扣数据', complaint: '无客诉数据源' };

  /* —— 分诊聚合（起点屏 + alertList 共用） —— */
  function triage(db, today) {
    const out = [];
    try {
      const mom = momentumStates(db, today);
      if (mom.length) out.push({ tone: 'r', text: `${mom.map(m => m.sp.name).join('、')} 触发动量连败警报`, sub: 'pace' });
      const quits = paceBoard(db, today).filter(x => x.zone === 'quit_risk');
      if (quits.length) out.push({ tone: 'a', text: `${quits.length} 人处于弃赛区（目标数学上已够不着）`, sub: 'pace' });
      const backlog = backlogBoard(db, today).filter(b => b.level === 'boss');
      if (backlog.length) out.push({ tone: 'r', text: `${backlog.length} 笔签约挂账超 60 天未回款`, sub: 'pace' });
      const nb = newbieBoard(db, today).filter(x => x.suggestCull);
      if (nb.length) out.push({ tone: 'a', text: `新人 ${nb.map(x => x.sp.name).join('、')} 连续 3 日红警（汰前拦截审查中）`, sub: 'fill' });
      const jolt = joltBoard(db, today).filter(j => j.check.pressure);
      if (jolt.length) out.push({ tone: 'a', text: `${jolt.map(j => j.sp.name).join('、')} 对高犹豫客户加压（JOLT）`, sub: 'pace' });
      const ds = doseStats(db, today);
      if (ds.ratio != null && ds.ratio < SK.getCoef('yuren.m44').neglectRatioLt)
        out.push({ tone: 'a', text: `老手辅导比 ${fmt.num(ds.ratio, 2)}——资历忽视预警`, sub: 'pace' });
      if (ds.gap != null && ds.gap > 0.3)
        out.push({ tone: 'r', text: `认知鸿沟 ${fmt.pct(ds.gap)}（>30%）——你以为的辅导没有发生`, sub: 'pace' });
    } catch (e) { console.error('yuren triage', e); }
    return out;
  }

  /* —— ① 起点 · 分诊 —— */
  function vStart(db, today) {
    const tri = triage(db, today);
    return `
    <div class="sect"><h2>🌱 销冠育人器</h2><span class="sub">抬地板，不抬天花板 · 原五件套信封已换成同库实时总线</span></div>
    ${h.card('', `<div class="callout">${esc(TALK.landing1)}</div>
      <p class="hint">${esc(TALK.boundary)}</p><p class="hint">${esc(TALK.privacy)}</p>`)}
    ${h.card('今日分诊台 ' + h.badge('只提示，不执行——一切动作由你点击（A-05）', 'n'),
      tri.length ? tri.map(t => `<div class="kv"><span class="k">${h.dot(t.tone)} ${esc(t.text)}</span><b>${btnNav('去处理 →', 'yuren', t.sub)}</b></div>`).join('')
        : h.hint('当前无待处理预警。数据越全，分诊越准——先把日报四计数填上。'))}
    <div class="grid g2">
      ${h.card('三步开始', `<p>① 员工/成交/线索数据在「数据中心」与「算账器」维护——本板块实时取用，无需信封；<br>
        ② 在「配方源资格」让系统选出真正值得复制的人；<br>
        ③ 每天打开「处方工作台」，给每人一张过了语言闸的处方。</p>
        ${h.hint('销售端入口在「我的今天(销售端)」——零排名、零对比、零员工红灯。')}`)}
      ${h.card('这套系统的立身之本', `<p>天赋归招人器筛，动作归育人器蒸馏。配方引擎不抬天花板，抬地板——
        出厂账：后 50% 五人每人拉 1.4 万/月 = <b>84 万/年</b>，是天花板收益的 <b>35 倍</b>。</p>
        ${srcLine('Sandvik et al., QJE 2020：结构化配对谈话平均业绩 +15%，效果持续≥20 周')}`)}
    </div>`;
  }

  /* —— ② 配方源资格核弹（闸④） —— */
  function vGate4(db, today) {
    const head = `<div class="sect"><h2>② 配方源资格核弹</h2><span class="sub">四条同时满足才配当配方源：M21 归一化前 3 · UER≥0 · 折扣泄漏≤均值 · 客诉≤均值。规则全员可见（A-02）</span></div>`;
    const rows = m21Data();
    if (!rows) return head + needSz();
    const ctx = gateCtx(rows);
    const results = rows.map(r => ({ r, check: recipeGateCheck(r, ctx) }));
    const qualified = results.filter(x => x.check.qualified);
    const flashy = results.filter(x => !x.check.qualified)
      .sort((a, b) => (b.r.traj6 ? b.r.traj6[5] : 0) - (a.r.traj6 ? a.r.traj6[5] : 0))[0];
    const cell = (v, f) => v == null ? DASH : f(v);
    return head +
    (ctx.teamComplaintMean == null ? h.banner('客诉分项：一体版暂无客诉数据源——按公约"null 分项视为通过"并全表注明，不硬锁。', 'n') : '') +
    (flashy ? h.card(`${h.badge('拒', 'r')} ${esc(spName(flashy.r.spId))} —— 不合格`, `
      ${h.tbl([{ t: '检查项' }, { t: '结果' }],
        flashy.check.fails.map(f => `<tr><td>${esc(gateName[f])}</td><td>${h.badge('不过', 'r')}</td></tr>`))}
      <div class="callout" style="border-color:var(--red-hero)">${esc(TALK.y01_reject)}</div>
      ${h.btn(`坚持用${esc(spName(flashy.r.spId))}（留痕，不推荐）`, 'yr.insist-source', { cls: 'danger sm', data: `data-sp="${flashy.r.spId}"` })}
      ${srcLine('Zoltners（地盘污染排名）；Hart 2016（剩余控制权与藏拙）')}`, { cls: '' }) : '') +
    h.card(`${h.badge('荐', 'g')} 通过全部四闸的人`,
      (qualified.length ? h.tbl([{ t: '姓名' }, { t: '归一化排名', num: 1 }, { t: 'UER', num: 1 }, { t: '折扣泄漏', num: 1 }, { t: '客诉', num: 1 }, { t: '' }],
        qualified.map(x => `<tr><td><b>${esc(spName(x.r.spId))}</b></td><td class="num">第 ${x.r.rankNorm}</td>
          <td class="num">${cell(x.r.uer, v => (v >= 0 ? '+' : '') + fmt.num(v, 1) + ' 万')}</td>
          <td class="num">${fmt.pct(x.r.discountRate)}</td>
          <td class="num">${x.r.complaintCount == null ? DASH + '<span class="hint">（无客诉数据源·视为过）</span>' : fmt.num(x.r.complaintCount)}</td>
          <td>${h.btn('设为配方源', 'yr.set-source', { cls: 'sm pri', data: `data-sp="${x.r.spId}"` })}</td></tr>`))
        + `<div class="callout">${esc(TALK.y01_accept)}</div>`
        : h.hint('—（暂无人同时通过四闸；这本身就是诊断结果）'))
      + h.hint('数据来源：算账器 M21 归一化 / UER 残差——同库实时换算 ' + h.linked())
      + (db.recipeSource && db.recipeSource.sourceIds.length ? `<p style="margin-top:8px">当前配方源：<b>${db.recipeSource.sourceIds.map(id => esc(spName(id))).join('、')}</b>（${db.recipeSource.setAt} 设定）</p>` : '')) +
    h.card('全员四闸明细', h.tbl(
      [{ t: '归一化排名', num: 1 }, { t: '姓名' }, { t: 'UER', num: 1 }, { t: '折扣', num: 1 }, { t: '客诉', num: 1 }, { t: '结论' }],
      results.map(x => `<tr><td class="num">第 ${x.r.rankNorm == null ? DASH : x.r.rankNorm}</td><td>${esc(spName(x.r.spId))}</td>
        <td class="num">${cell(x.r.uer, v => (v >= 0 ? '+' : '') + fmt.num(v, 1) + ' 万')}</td>
        <td class="num">${fmt.pct(x.r.discountRate)}</td>
        <td class="num">${x.r.complaintCount == null ? DASH : fmt.num(x.r.complaintCount)}</td>
        <td>${x.check.qualified
          ? h.badge('通过', 'g') + (x.check.nulls.length ? ` <span class="hint">${x.check.nulls.map(f => nullNote[f]).join('、')}·视为过</span>` : '')
          : h.badge(x.check.fails.map(f => gateShort[f]).join('·'), 'r')}</td></tr>`)));
  }

  /* —— ③ 产权前提（闸③） —— */
  function vGate3(db, today) {
    const head = `<div class="sect"><h2>③ 产权前提</h2><span class="sub">配方源没签产权、或 AHC 低于信任线，配方引擎不该开——否则他会开始藏，而系统测得到</span></div>`;
    const ids = db.recipeSource ? db.recipeSource.sourceIds : [];
    if (!ids.length) return head + h.banner(`先在「配方源资格」屏选出配方源——闸③检查的是"这个人肯不肯交出本事"，先得有人选。 ${btnNav('去选配方源 →', 'yuren', 'gate4')}`, 'a');
    const line = SK.getCoef('shared.ahcTrustLine');
    const ahc = teamAhc();
    return head + ids.map(id => {
      const m28s = m28For(id);
      const gate = propertyGate({ hasM28: m28s.length > 0, ahc });
      const row = m21Row(id) || {};
      const hide = hidingCheck(row.uerSeries);
      return h.card(`${esc(spName(id))} · 闸③ 产权前提 ${gate.locked ? h.badge('锁定', 'r') : h.badge('已解锁', 'g')}`, `
        ${h.kv([
          { k: 'M28 产权协议（留人器·实时）' + ' ' + h.linked(), v: m28s.length ? `已签 ${m28s.length} 份${m28s.some(a => a.irrevocable) ? '（irrevocable）' : ''}` : h.badge('未签', 'r') },
          { k: `AHC 承诺兑现指数（信任线 ${line}）` + ' ' + h.linked(), v: ahc == null ? DASH + '（需留人器数据）' : `${fmt.num(ahc)} ${ahc < line ? h.badge('低于信任线', 'r') : h.badge('≥ ' + line, 'g')}` },
          { k: 'UER 藏拙监测（算账器·实时）' + ' ' + h.linked(), v: hide.hiding == null ? '—（样本不足，不下结论）' : (hide.hiding ? h.badge('🔴 ' + TALK.y02_hiding + '（UER 下滑 > 0.5σ）', 'r') : h.badge('平稳', 'g')) },
        ])}
        ${ahc != null ? h.meter(ahc / 100, ahc < line ? 'r' : 'g', [line / 100]) : ''}
        ${gate.locked ? `<div class="callout" style="margin-top:10px">${esc(TALK.y02)}</div>
          <p><b>产权四件报价</b>：配方署名（免费）· 配方使用费 3.5 万/年 · 带教分成 3.48 万（69.6 倍杠杆）· irrevocable 不可撤销条款</p>
          ${btnNav('去留人器签 M28 →', 'liuren', null, 'pri sm')}` : ''}
        ${srcLine('Hart 2016 诺奖第四定理：不给控制权，他就不会投入你测不到的努力')}`);
    }).join('');
  }

  /* —— ④ 配方引擎 · 三张牌 —— */
  function renderScatter(pts) {
    if (!pts.length) return h.hint('—（近 90 天日报不足）');
    const W = 660, H = 300, pad = 40;
    const mx = Math.max(...pts.map(p => p.x)) * 1.15 || 1;
    const my = Math.max(...pts.map(p => p.y)) * 1.3 || 1;
    const medX = pts.map(p => p.x).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
    const medY = pts.map(p => p.y).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
    const X = v => pad + (v / mx) * (W - pad - 10);
    const Y = v => H - 30 - (v / my) * (H - 50);
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      <line x1="${pad}" y1="${H - 30}" x2="${W - 5}" y2="${H - 30}" stroke="var(--line)"/>
      <line x1="${pad}" y1="10" x2="${pad}" y2="${H - 30}" stroke="var(--line)"/>
      <line x1="${X(medX)}" y1="10" x2="${X(medX)}" y2="${H - 30}" stroke="var(--line)" stroke-dasharray="4 4"/>
      <line x1="${pad}" y1="${Y(medY)}" x2="${W - 5}" y2="${Y(medY)}" stroke="var(--line)" stroke-dasharray="4 4"/>
      <text x="${W - 70}" y="${H - 12}" font-size="10" fill="var(--ink3)">量（有效）</text>
      <text x="8" y="20" font-size="10" fill="var(--ink3)">质</text>
      ${pts.map(p => `<g style="cursor:pointer" data-act="yr.goto-rx" data-sp="${p.spId}">
        <circle cx="${X(p.x)}" cy="${Y(p.y)}" r="6" fill="var(--accent)" opacity=".75" data-act="yr.goto-rx" data-sp="${p.spId}"/>
        <text x="${X(p.x) + 9}" y="${Y(p.y) + 4}" font-size="10" fill="var(--ink3)">${esc(p.name)}</text></g>`).join('')}
    </svg>`;
  }
  function vCards(db, today) {
    const head = `<div class="sect"><h2>④ 配方引擎 · 三张牌</h2><span class="sub">每月日切自动重算，零新增录入。蒸馏的是动作，不是天赋</span></div>`;
    const rows = m21Data();
    const pre = rows ? '' : needSz();
    if (!db.recipeSource || !db.recipeSource.sourceIds.length)
      return head + pre + h.banner(`未设定配方源——先过闸④选出值得复制的人。 ${btnNav('去选配方源 →', 'yuren', 'gate4')}`, 'a');
    const gate3Locked = db.recipeSource.sourceIds.some(id =>
      propertyGate({ hasM28: m28For(id).length > 0, ahc: teamAhc() }).locked);
    const cards = threeCards(db, today);
    const base = firstNDaysBaseline(db, today);
    const N = SK.getCoef('yuren.newbieWindow').days;
    const sc = scatterData(db, today);
    return head + pre +
    (gate3Locked ? h.banner(`闸③ 产权前提未满足（配方源未签 M28 或 AHC 低于信任线）——配方可看，但先把产权补上，否则他会开始藏。 ${btnNav('去看产权前提 →', 'yuren', 'gate3')}`, 'r') : '') +
    `<div class="grid" style="grid-template-columns:repeat(3,1fr)">
      ${h.card('牌一 · 剂量', h.tbl([{ t: '环节' }, { t: '配方源 日均', num: 1 }],
        ['leads', 'intents', 'samples', 'contracts'].map(k => `<tr><td>${TALK.stageNames[k]}</td><td class="num">${fmt.num(cards.dose[k], 1)}</td></tr>`))
        + h.hint(`近 180 天 ÷ 有报工作日${cards.nSources > 1 ? '（' + cards.nSources + ' 人合成均值）' : ''}`))}
      ${h.card('牌二 · 配比', h.kv([
        { k: '线索 → 意向', v: fmt.pct(cards.mix.l2i) }, { k: '意向 → 样品', v: fmt.pct(cards.mix.i2s) },
        { k: '样品 → 签约', v: fmt.pct(cards.mix.s2c) }]) + h.hint('四环节累计制转化率'))}
      ${h.card('牌三 · 节奏', h.kv([
        { k: '首单用时', v: cards.pace.firstDealDays == null ? DASH : cards.pace.firstDealDays + ' 天' },
        { k: '出单间隔（中位）', v: cards.pace.gapMedian == null ? DASH : cards.pace.gapMedian + ' 天' },
        { k: '主打品类', v: `${esc(cards.pace.topCat || DASH)}（${fmt.pct(cards.pace.topCatShare)}）` }])
        + h.hint('来自成交单 · 同库实时 ' + h.linked()))}
    </div>` +
    h.card(`首 ${N} 天基准（新人筛选的地基）`,
      (!base || base.missing) ? h.hint('—（缺配方源入职期日报数据，基准不硬凑；补录后自动点亮）')
      : h.tbl([{ t: '环节' }, { t: '基准 · 日均', num: 1 }, { t: '新人阈值（×80%）', num: 1 }],
          ['leads', 'intents', 'samples'].map(k => `<tr><td>${TALK.stageNames[k]}</td>
            <td class="num">${fmt.num(base.daily[k], 1)}</td><td class="num">${fmt.num(base.daily[k] * 0.8, 1)}</td></tr>`))
        + (base.singleSample ? h.hint('⚠ 样本 < 3，当前为单人基准（已标注）') : '')) +
    h.card('量 × 质散点（横轴=有效动作分/工作日 · 纵轴=线索→签约转化）',
      renderScatter(sc) + h.hint('点一个点，直达他的处方。有效动作分已防刷（M14③：刷量不增分，虚报数学收益归零）。'));
  }

  /* —— ⑤ 处方工作台 —— */
  function renderPlvPanel(plv, text) {
    if (!text) return h.hint('开始输入，三层校验实时亮灯。');
    const li = (ok, label, extra) => `<div class="kv"><span class="k">${ok ? h.badge('过', 'g') : h.badge('拦', 'r')} <b>${label}</b></span><b class="hint" style="text-align:right">${extra ? esc(extra) : ''}</b></div>`;
    const hints = plvRewriteHint(plv);
    return `${li(plv.l1.pass, '第一层 · 拦截词库', plv.l1.hits.length ? '命中：' + plv.l1.hits.join('、') : '')}
    ${li(plv.l2.pass, '第二层 · 去人名测试', plv.l2.pass ? '删掉"你/他"后句子仍指向任务' : '删掉"你/他"后句子失去意义——它说的是人，不是事')}
    ${li(plv.l3.pass, '第三层 · 三槽位', '行为数据' + (plv.l3.slots.behaviorData ? '✓' : '✗') + ' 动作' + (plv.l3.slots.action ? '✓' : '✗') + ' 基准' + (plv.l3.slots.benchmark ? '✓' : '✗'))}
    ${!plv.passed && hints.length ? '<div style="margin-top:6px"><b>系统改写建议：</b>' + hints.map(x => `<div class="hint">· ${esc(x)}</div>`).join('') + '</div>' : ''}`;
  }
  function vRx(db, today) {
    const sel = curRxSp();
    const diag = sel ? rxDiagnose(db, sel, today) : { none: true, reason: '未选员工' };
    const auto = sel ? rxAutoText(db, sel, today) : null;
    const text = rxDraft;
    const momOn = momentumStates(db, today).some(m => m.sp.spId === sel);
    const plv = plvCheck(text, { banned: bannedAll(), names: db.people.map(p => p.name), momentum: momOn });
    const todayRx = db.prescriptions.filter(r => r.date === today);
    const psiVals = todayRx.map(r => psiScore(r.psiParts)).filter(v => v != null);
    const ds = doseStats(db, today);
    const gateRows = [
      ['闸① PLV 语言校验', '三层全拦截；不过=无保存路径'],
      ['闸② PSI 个性化', todayRx.length ? '今日均值 ' + (psiVals.length ? Math.round(mean(psiVals)) : DASH) : '今日暂无处方'],
      ['闸③ 产权前提', db.recipeSource ? '见「产权前提」屏' : '未设配方源'],
      ['闸④ 配方源资格', db.recipeSource ? '已过' : '未设'],
      ['闸⑤ 处方不挂钱', '结构断言：处方零耦合提成/排名（Y-D2）'],
      ['闸⑧ 悬赏挤出对冲', db.silentTrackOn ? '静默认可通道已启用' : '通道未启用（结果赏将被拦截）'],
      ['闸⑨ 练习量', '前 14 天 < 50 次 → 拦截汰'],
      ['闸⑩ 认知鸿沟', ds.gap == null ? DASH : fmt.pct(ds.gap) + (ds.gap > 0.3 ? ' 🔴' : '')],
      ['闸⑪ 辅导剂量', ds.dose == null ? DASH : ds.dose + ' h/人·月'],
      ['闸⑫ JOLT 犹豫处方', joltBoard(db, today).length + ' 个高犹豫客户'],
    ];
    return `<div class="sect"><h2>⑤ 处方工作台</h2><span class="sub">处方只许说三件事：他做了什么（数据）· 今天做什么（动作）· 对标什么（基准）</span></div>
    <div class="grid" style="grid-template-columns:1fr 320px;align-items:start">
      <div>
        ${h.card('手写处方 · PLV 实时三层校验' + (momOn ? ' ' + h.badge('动量期：词库已加强（拦"' + MOMENTUM_BANNED.join('、') + '"）', 'a') : ''), `
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <select id="yr-rx-sp">${activeSps().map(p => `<option value="${p.spId}"${p.spId === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
            <span class="hint">${diag.none ? esc(diag.reason || '') : '诊断：' + ({ volume: '量差', quality: '质差', speed: '速差' }[diag.top.type]) + '型偏差最大'}</span>
          </div>
          <textarea id="yr-rx-text" style="width:100%;min-height:110px;line-height:1.7" placeholder='例：你昨天 12 通电话，9 通没做需求确认。今天试试在第 3 分钟问……配方源基准 87%'>${esc(text)}</textarea>
          <div id="yr-plv-panel">${renderPlvPanel(plv, text)}</div>
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            ${h.btn('保存并派发', 'yr.rx-save', { cls: 'pri', disabled: !(plv.passed && text) })}
            <span id="yr-rx-insist-wrap" style="display:${text && !plv.passed ? 'inline' : 'none'}">${h.btn('坚持原文（留痕，计入认知鸿沟风险）', 'yr.rx-insist', { cls: 'danger' })}</span>
            ${auto ? h.btn('采纳系统建议稿', 'yr.rx-adopt') : ''}
          </div>
          ${srcLine('Kluger & DeNisi 1996：超过 1/3 的反馈指向"人"而非"任务"，反而降低绩效')}`)}
        ${auto ? h.card('系统建议稿（已过三层）', `<p>${esc(auto)}</p>
          <div style="margin-top:8px">${h.btn('一键派发给 ' + esc(spName(sel)), 'yr.rx-dispatch', { cls: 'sm pri' })}</div>
          ${srcLine('个性化/具体反馈效应量约 3 倍（反馈特异性文献）')}`) : ''}
        ${h.card(`今日处方（${todayRx.length} 条 · PSI 均值 ${psiVals.length ? Math.round(mean(psiVals)) : DASH}）`,
          (todayRx.length ? h.tbl([{ t: '员工' }, { t: '类型' }, { t: 'PSI', num: 1 }, { t: '回执' }],
            todayRx.map(r => {
              const s = psiScore(r.psiParts), b = psiBand(s);
              return `<tr><td>${esc(spName(r.employeeId))}</td><td>${esc(r.type)}</td>
                <td class="num">${s == null ? DASH : h.badge(s + (b === 'red' ? ' 你在做统一培训' : ''), b === 'green' ? 'g' : b === 'amber' ? 'a' : 'r')}</td>
                <td>${r.ackedAt ? '已确认' : '待确认'}</td></tr>`;
            })) : h.hint('今日暂无。带教 KPI 别写"20 小时"，写"20 条处方、PSI 均值 78、回执率 90%"。'))
          + h.hint(TALK.rxFooter))}
        ${h.card('PLV 拦截词库（只增不删）', `<p class="hint">${bannedAll().map(esc).join('、')}</p>
          <div style="display:flex;gap:6px;margin-top:6px"><input id="yr-plv-add" type="text" placeholder="新增拦截词">${h.btn('加入', 'yr.add-banned', { cls: 'sm' })}</div>
          ${h.hint('出厂 25 词逐字锁定；你的增补词存本机（DB.plvExtraWords），随备份迁移。')}`)}
      </div>
      <div>${h.card('十二闸速览', gateRows.map(g => `<div class="kv"><span class="k"><b>${g[0]}</b></span><b class="hint" style="text-align:right">${g[1]}</b></div>`).join(''))}</div>
    </div>`;
  }

  /* —— ⑥ 节奏台（M43/M40/M41/M42/M44a/挂账/JOLT） —— */
  function vPace(db, today) {
    const m40c = SK.getCoef('yuren.m40'), m43c = SK.getCoef('yuren.m43'), m44c = SK.getCoef('yuren.m44');
    const doseC = SK.getCoef('zhaoren.coachingDose');
    const pace = paceBoard(db, today);
    const zones = { protect: [], accel: [], normal: [], quit_risk: [] };
    pace.forEach(x => { if (x.zone) zones[x.zone].push(x); });
    const zoneTone = { accel: 'g', normal: 'b', quit_risk: 'r', protect: 'n' };
    const mom = momentumStates(db, today);
    const m40in = m40WeeklyInput(db, today);
    const weekPairs = db.pairAssignments.filter(pa => pa.status === 'active');
    const m42 = m42Board(db, today) || [];
    const ds = doseStats(db, today);
    const backlog = backlogBoard(db, today);
    const jolt = joltBoard(db, today);
    const noQuota = pace.filter(x => !x.zone).length;
    return `<div class="sect"><h2>⑥ 育人节奏台</h2><span class="sub">分层节奏 · 配对传帮带 · 动量干预 · 深板凳 · 资历忽视——全部建议是卡片，不是命令</span></div>
    ${h.card('M43 分层节奏 ' + h.badge('完成度 = 本月回款 ÷ 个人配额', 'n'), `
      <div class="grid" style="grid-template-columns:repeat(4,1fr)">
        ${['protect', 'accel', 'normal', 'quit_risk'].map(z => `<div style="border:1px solid var(--line);border-radius:8px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><b>${TALK.zoneNames[z]}</b>${h.badge(zones[z].length + ' 人', zoneTone[z])}</div>
          ${zones[z].map(x => `<div class="kv"><span class="k">${esc(x.sp.name)}</span><b class="num">${fmt.pct(x.completion)}</b></div>`).join('') || h.hint('—')}
        </div>`).join('')}
      </div>
      ${noQuota ? h.hint(`${noQuota} 人无配额 → 整模块对其显示"—"（在「填报中心」设配额；缺省回退公司「达标销售月毛利目标」）`) : ''}
      ${zones.quit_risk.map(x => h.action(`${esc(x.sp.name)} · 弃赛区`, `完成度 ${fmt.pct(x.completion)}，本周期数学上已够不着。继续推同一个目标=他提前躺平。
        系统已生成子目标 <b>${fmt.wan(x.sub)}</b>：把"必输的大仗"换成"能赢的小仗"。
        <div class="hint">⚠ 子目标只影响推送节奏，不改变正式配额与提成口径。</div>
        ${srcLine('目标梯度效应（Hull；Kivetz et al. 2006）：够得着的目标才有梯度效应')}`, 'r')).join('')}
      ${h.hint(`辅导剂量再分配建议：中间 60%（按归一化排名）获得剂量权重 ≥ ${fmt.pct(m43c.middleCoachWeight)}。`)}`)}
    ${h.card('M40 配对传帮带 ' + h.badge('全系统性价比之王', 'gold'),
      m40in ? `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">${h.btn('生成/刷新本周配对', 'yr.gen-pairs', { cls: 'pri sm' })}
        <span class="hint">教练池 = 归一化前 ${m40c.coachTopN} ∩ 闸④全过 ∩ 闸③已签产权；学员池 = 中间层 20%–80%（尾部先走 M15/M42）</span></div>`
        + (weekPairs.length ? h.tbl([{ t: '教练' }, { t: '学员' }, { t: '话题（学员最弱环节）' }, { t: '连续周数', num: 1 }, { t: '轮换倒计时' }],
            weekPairs.map(pa => {
              const t = topicFor(db, pa.learnerId, today);
              return `<tr><td>${esc(spName(pa.coachId))}</td><td>${esc(spName(pa.learnerId))}</td>
                <td>${esc(t.stage)}<div class="hint">${esc(t.text)}</div></td><td class="num">${pa.consecutiveWeeks}</td>
                <td>${pa.consecutiveWeeks >= m40c.pairWeeksMax ? h.badge('本周强制轮换', 'r') : (m40c.pairWeeksMax - pa.consecutiveWeeks) + ' 周'}</td></tr>`;
            })) : h.hint('尚未生成本周配对。'))
        + (() => { const r = m40Pairing(m40in, m40c); return r.frozenCoachIds.length
            ? h.banner(`席位冻结：${r.frozenCoachIds.map(id => esc(spName(id))).join('、')} 待签产权（M28）——未签则该教练席位不排。 ${btnNav('去留人器 →', 'liuren')}`, 'a') : ''; })()
        + srcLine('Sandvik et al., QJE 2020：结构化配对谈话平均业绩 +15%、持续≥20 周，匹配高绩效同事收益最大；收益来自打法转移而非努力')
        + h.hint(`每对每周 ${m40c.sessionMinutes} 分钟；session 走 CoachingAck 回执；配对组 vs 非配对组 90 天差 → 汇入 M26 验证你自己的 +15%。你的教练不白教：带教分成已在留人器 M28 签好，徒弟越强他越赚。`)
      : needSz())}
    ${h.card('M41 动量连败干预 ' + h.badge(mom.length + ' 人触发', mom.length ? 'r' : 'n'),
      mom.length ? mom.map(m => {
        const sd = smallDealLeads(db, m.sp.spId, today);
        return h.action(`${esc(m.sp.name)} · 连败 ${m.streak} 单`, `近 30 天赢率 ${fmt.pct(m.prev)}→${fmt.pct(m.cur)}，负动量分 ${fmt.num(m.score, 2)}。
          连败会自我强化：此刻压任务，是把他往水下按。先赢一场小的。
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${h.badge(`卡① 高把握小单清单：${sd.list.length} 条（${esc(sd.bestCat || DASH)}，≤ 客单×0.5）`, 'b')}
            ${h.badge('卡② 主管陪访（走回执）', 'b')}
            ${h.badge(`卡③ 动量期处方已切换：拦截"${MOMENTUM_BANNED.join('、')}"，只许小动作`, 'b')}
          </div>
          ${srcLine('连败自我强化（行为文献；热手经 Miller-Sanjurjo 2018 部分平反）')}`, 'r');
      }).join('') : h.hint('当前无人触发（连败≥3 或 负动量分≥0.6）。'))}
    <div class="grid g2">
      ${h.card('M42 深板凳榜样匹配',
        m42.length ? m42.map(x => x.best ? `<div style="padding:8px 0;border-bottom:1px dashed var(--line)">
            <b>${esc(spName(x.lag.spId))}</b> 的可用榜样：<b>${esc(spName(x.best.spId))}</b>（轨迹距离 ${fmt.num(x.best.dist, 0)} 万，全队最近）。
            给他看天生销冠只会让他绝望——可比的人，才是可用的希望。
            <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
              ${h.btn('发送供氧卡（只显榜样爬升曲线）', 'yr.send-oxygen', { cls: 'sm', data: `data-sp="${x.lag.spId}" data-model="${x.best.spId}"` })}
              ${h.badge(`例会请 ${esc(spName(x.best.spId))} 分享 10 分钟`, 'b')}
            </div></div>`
          : `<div style="padding:8px 0"><b>${esc(spName(x.lag.spId))}</b>：—（暂无同轨迹榜样，不硬凑）</div>`).join('')
        : h.hint('需要算账器 M21 轨迹数据（traj6/trajEarly）。')
        + '') + srcLine('社会学习/社会比较：榜样的可比性决定效力')}
      ${h.card('M44a 资历忽视 · 认知鸿沟 · 剂量', h.kv([
          { k: `老手辅导比（司龄>${m44c.tenureYears}年）`, v: fmt.num(ds.ratio, 2) + (ds.ratio != null && ds.ratio < m44c.neglectRatioLt ? ' ' + h.badge('🟡 触发', 'a') : '') },
          { k: '认知鸿沟（1−确认/上报）', v: fmt.pct(ds.gap) + (ds.gap != null && ds.gap > 0.3 ? ' ' + h.badge('🔴 >30%', 'r') : '') },
          { k: '人均月确认剂量', v: (ds.dose == null ? DASH : ds.dose + ' h') + (ds.dose != null ? (ds.dose < doseC.floorHrsMonth ? ' ' + h.badge('低于 3h 下限', 'a') : ds.dose > doseC.ceilHrsMonth ? ' ' + h.badge('超 5h 递减带', 'a') : ' ' + h.badge('带内', 'g')) : '') },
        ])
        + (ds.ratio != null && ds.ratio < m44c.neglectRatioLt ? h.banner(`你的老手人均确认辅导 ${fmt.num(ds.vetAvg, 1)}h/月，全队人均 ${fmt.num(ds.teamAvg, 1)}h——老手辅导比 ${fmt.num(ds.ratio, 2)}。辅导资源天然流向新人，老手被默认"不需要"，而他们的技能衰减无人监测、经验红利正在吃老本。✅ 建议：每季度一次老手专项复盘（走回执），话题=他最近 90 天转化率变化最大的环节。`, 'a') : '')
        + srcLine('3h 阈值/5h 天花板：CSO Insights/Korn Ferry；频率 76% vs 47%＝29pp')
        + h.hint(CALENDAR_WAR_TALK))}
    </div>
    <div class="grid g2">
      ${h.card('M14① 挂账爆破', backlog.length ? h.tbl([{ t: '销售' }, { t: '单', num: 1 }, { t: '签约天数', num: 1 }, { t: '级别' }],
        backlog.map(b => `<tr><td>${esc(spName(b.deal.employeeId))}</td><td class="num">${esc(catName(b.deal.categoryId))} ${fmt.wan(b.deal.paymentAmt)}</td>
          <td class="num">${b.days} 天</td><td>${b.level === 'boss' ? h.badge('>60 天 · 老板插卡', 'r') : h.badge('>30 天 · 主管黄条', 'a')}</td></tr>`))
        : h.hint('无挂账预警。'))}
      ${h.card('M25 JOLT 犹豫处方（闸⑫）', jolt.length ? jolt.map(j => h.action(
          `${esc(j.sp.name)} · ${esc(catName(j.deal.categoryId))} ${fmt.wan(j.deal.paymentAmt)}`,
          `意向停留 ${dd(j.deal.intentDate, today)} 天（品类中位 ${j.median} 天 × 1.5）` +
          (j.check.pressure ? `，期间出现折扣——<b>你的加压模式已被识别</b>。${esc(TALK.y04)}` : '，高犹豫客户') +
          `<div class="hint">JOLT 四步：判断犹豫类型 → 给具体推荐 → 拿掉风险 → 限制探索（处方已过 PLV）</div>` +
          srcLine('JOLT Effect（Dixon-McKenna 2022）：高犹豫赢率差 5 倍；加压 84% 适得其反'),
          j.check.pressure ? 'r' : 'a')).join('')
        : h.hint('无高犹豫客户。'))}
    </div>`;
  }

  /* —— ⑦ 地板抬升计量器（M26） —— */
  function vFloor(db, today) {
    const mine = myFloorAccount(db, today);
    const flc = SK.getCoef('yuren.floorLift');
    return `<div class="sect"><h2>⑦ 地板抬升计量器</h2><span class="sub">地板抬升 = Σ(处方后90天归一化净贡献 − 前90天)，只看后 50%</span></div>
    <div class="grid" style="grid-template-columns:repeat(4,1fr)">
      ${h.card('', h.hero('84 万/年', '地板抬升（出厂账）· 后 50% 五人 2.8→4.2 万/月（+1.4/人）', 'green'))}
      ${h.card('', h.hero('2.4 万/年', '天花板同构（前 20%）· +0.1 万/人·月'))}
      ${h.card('', h.hero('35 倍', '地板 ÷ 天花板 · 抬地板，不抬天花板', 'accent'))}
      ${h.card('', h.hero('9.5 倍', '配方 ROI（出厂账）· 84 万/年 ÷（使用费+分成+机会成本 7,360/月）', 'gold'))}
    </div>
    ${h.card('出厂示例账（非你的数据）', h.tbl(
      [{ t: '组' }, { t: '人数', num: 1 }, { t: '前 90 天 月均', num: 1 }, { t: '后 90 天 月均', num: 1 }, { t: '抬升/人·月', num: 1 }, { t: '年化', num: 1 }],
      [`<tr><td>后 50%（地板）</td><td class="num">5</td><td class="num">2.8 万</td><td class="num">4.2 万</td><td class="num">+1.4 万</td><td class="num"><b>84 万</b></td></tr>`,
       `<tr><td>前 20%（天花板）</td><td class="num">2</td><td class="num">${DASH}</td><td class="num">${DASH}</td><td class="num">+0.1 万</td><td class="num">2.4 万</td></tr>`])
      + h.hint('🔴 ' + M26_DISCLAIMER))}
    ${h.card('你的账（自动计算位 · 实时）', `
      <p class="hint">条件：后 50% 每组 ≥ ${flc.minEach} 人、处方前后各 ≥ ${flc.windowDays} 天数据；不足则显示"—"，绝不假装知道。</p>
      ${mine.insufficient
        ? `<div class="hero sm">${DASH}</div><p class="hint">（${esc(mine.why)}）</p>`
        : h.kv([
            { k: `地板抬升（后 50% · ${mine.n} 人 · 锚点 ${mine.anchor}）`, v: fmt.wan(mine.annualLiftAmt) + '/年', cls: 'green' },
            { k: '月度抬升合计', v: fmt.wan(mine.monthlyLiftAmt) + '/月' },
            { k: '配方 ROI（按出厂成本 7,360/月口径）', v: mine.roi == null ? DASH : fmt.num(mine.roi, 1) + ' 倍' },
          ]) + h.hint('🔴 ' + M26_DISCLAIMER)}
      <p class="hint">配对组 vs 非配对组的 90 天归一化净贡献差将在此汇入——用你自己的数据验证 QJE 的 +15%。</p>`)}
    ${srcLine('『地板是天花板的 35 倍』：出厂账推演；因果检验请用留人器 M31 系数实验室')}`;
  }

  /* —— ⑧ 填报中心（日报 / 排班 / 配额 / M15 / 悬赏 / 抽检） —— */
  function vFill(db, today) {
    const d = fillDate || today;
    const board = newbieBoard(db, today);
    const blockName = { no_leads: '拦截①', no_practice: '拦截②', no_coaching: '拦截③' };
    const nw = SK.getCoef('yuren.newbieWindow');
    const wk = db.spotChecks.filter(c => dd(c.weekOf, today) < 7);
    const activeBt = db.bounties.filter(b => b.active);
    return `<div class="sect"><h2>⑧ 填报中心</h2><span class="sub">日报四计数是本板块唯一员工输入；练习量/成交/M28 全部同库实时</span></div>
    ${h.card('M1 日报四计数（唯一员工填报；一键提交）', `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><label class="hint">日期</label>
        <input type="date" id="yr-fill-date" value="${d}">
        ${isWorkday(d, db.shiftConfig, '*') ? '' : h.badge('休息日：不催不计（分母/连续计数/催报/插卡四处排除）', 'n')}</div>
      ${h.tbl([{ t: '员工' }, { t: '线索', num: 1 }, { t: '意向', num: 1 }, { t: '样品', num: 1 }, { t: '签约', num: 1 }, { t: '' }],
        activeSps().map(p => {
          const r = db.dailyReports.find(x => x.employeeId === p.spId && x.date === d);
          const c = r ? r.counts : {};
          return `<tr><td>${esc(p.name)}</td>
          ${['leads', 'intents', 'samples', 'contracts'].map(k =>
            `<td class="num"><input type="number" min="0" style="width:70px" id="yr-c-${p.spId}-${k}" value="${c[k] != null ? c[k] : ''}" placeholder="0"></td>`).join('')}
          <td>${h.btn('存', 'yr.save-report', { cls: 'sm', data: `data-sp="${p.spId}" data-date="${d}"` })}</td></tr>`;
        }))}
      ${h.hint('原始计数永远原样保留与展示；有效动作分只在 M12/M15 内部使用（Y-D5）。')}`)}
    ${h.card('排班表（ShiftConfig · 全员默认）', `<div style="display:flex;gap:14px;flex-wrap:wrap">
      ${['日', '一', '二', '三', '四', '五', '六'].map((w, i) =>
        `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-act="yr.shift" data-day="${i}"
          ${(db.shiftConfig['*'] || []).indexOf(i) >= 0 ? 'checked' : ''}>周${w}休</label>`).join('')}</div>`)}
    ${h.card('个人月配额（M43 用；留空 = 回退公司「达标销售月毛利目标」）', h.tbl(
      [{ t: '员工' }, { t: '月配额（元）', num: 1 }, { t: '当前来源' }, { t: '' }],
      activeSps().map(p => {
        const q = quotaFor(db, p.spId);
        return `<tr><td>${esc(p.name)}</td>
        <td class="num"><input type="number" style="width:130px" id="yr-q-${p.spId}"
          value="${db.paceConfig.manualQuotaBySp[p.spId] != null ? db.paceConfig.manualQuotaBySp[p.spId] / 100 : ''}"
          placeholder="${q && q.src === 'company' ? Math.round(q.amt / 100) + '（公司目标）' : '未设'}"></td>
        <td class="hint">${q ? (q.src === 'manual' ? '手工' : '公司月目标 ' + h.linked()) : DASH}</td>
        <td>${h.btn('存', 'yr.save-quota', { cls: 'sm', data: `data-sp="${p.spId}"` })}</td></tr>`;
      })) + h.hint('A-06 三权分立：系统不预填数值，参考值只在灰字。'))}
    ${h.card(`M15 新人筛选（${nw.days} 天窗口 · 阈值 = 首N天基准 × 80% · 兜底默认「留」）`,
      (board.length ? board.map(x => `<div style="padding:10px 0;border-bottom:1px dashed var(--line)">
        <div style="display:flex;justify-content:space-between"><b>${esc(x.sp.name)}</b><span class="hint">入职第 ${x.tenure} 天</span></div>
        ${x.baselineMissing ? h.hint('—（首N天基准缺失，筛选不运行；见「配方引擎」）') : `
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin:6px 0">${x.days.map(dy =>
          h.badge(dy.att == null ? DASH : Math.round(dy.att * 100) + '%', dy.red ? 'r' : 'g')).join('')}
          ${x.singleSample ? '<span class="hint">（单人基准）</span>' : ''}</div>
        ${x.suggestCull ? (x.blocks.length
          ? h.banner(`<b>建议淘汰——但被 ${x.blocks.length} 道拦截挡下：</b>` +
              x.blocks.map(b => `<div>${blockName[b]}：${esc(
                b === 'no_leads' ? TALK.y11[0](Math.round((x.ctx.leadsIndex || 0) * 30)) :
                b === 'no_practice' ? TALK.y11[1](x.ctx.practice14 == null ? 0 : x.ctx.practice14) :
                TALK.y11[2](x.tenure))}</div>`).join('') +
              '<div class="hint">先解决拦截项，汰的建议才会放行。开人永远由你手动执行，系统只建议（A-05）。</div>', 'a')
          : h.action(`连续 ${x.maxStreak} 个工作日 < 60%`,
              `三类建议：<b>留（默认）/ 汰 / 待定（仅一次，${nw.holdDays} 天）</b>`, 'r',
              h.btn('留（默认）', 'ui.toast-ac', { cls: 'sm pri' }) + h.btn('汰（生成交接清单，不自动执行）', 'ui.toast-ac', { cls: 'sm danger' }) + h.btn(`待定 ${nw.holdDays} 天`, 'ui.toast-ac', { cls: 'sm' })))
        : h.hint('窗口内表现正常，无建议。')}`}
        ${h.hint(`前 14 天练习：${practice14(x.sp.spId) == null ? DASH : practice14(x.sp.spId)} 次（与招人器同表 ${h.linked()}）；被确认辅导：${x.ctx.ackConfirmedCount} 次`)}
      </div>`).join('') : h.hint('当前无 30 天内新人。'))
      + srcLine('前两周 50–100 次练习缩短爬坡 37%；仅线索/意向/样品设目标，签约成交只展示'))}
    ${h.card('静默认可通道 ' + (db.silentTrackOn ? h.badge('已启用', 'g') : h.badge('未启用', 'n')), `
      <p>连续 6 月达标 → 灯塔 + 前程合约资格池；<b>不发奖、不播报、不排名</b>。</p>
      <div class="callout">${esc(TALK.y10)}</div>
      ${db.silentTrackOn ? '' : h.btn('一键启用静默认可通道', 'yr.enable-silent', { cls: 'pri' })}
      ${srcLine('Gubler-Larkin-Pierce 2016 Org Sci：象征/物质奖励挤出骨干 −8%')}`)}
    ${bountyBlocked ? h.banner(`<b>闸⑧ 已拦截保存。</b>${esc(TALK.y13(TALK.bountyNames[bountyBlocked]))}
      <div style="margin-top:8px;display:flex;gap:6px">${h.btn('一键启用静默认可通道', 'yr.enable-silent', { cls: 'pri sm' })}</div>`, 'r') : ''}
    ${h.card('M13 发布悬赏（同时活动 ≤ 3 · 事件流自动判定 · 不进提成/排名/七级）', `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="yr-bt-template">${Object.keys(TALK.bountyNames).map(k =>
          `<option value="${k}">${TALK.bountyNames[k]}${isResultTrigger(k) ? '（结果类）' : isExempt(k) ? '（豁免）' : ''}</option>`).join('')}</select>
        <input type="number" id="yr-bt-amount" placeholder="金额（元，建议制）" style="width:150px">
        ${h.btn('发布', 'yr.save-bounty', { cls: 'pri' })}</div>
      ${h.hint('闸⑧三态：first_deal/hire 豁免放行；record_break/sprint/backlog_clear 在静默认可通道未启用时拦截保存。拦的不是悬赏本身，是"只有钱这一条路"的公司结构。')}
      ${activeBt.length ? h.tbl([{ t: '模板' }, { t: '金额', num: 1 }, { t: '发布日' }],
        activeBt.map(b => `<tr><td>${TALK.bountyNames[b.template]}</td><td class="num">${fmt.yuan(b.amountAmt)}</td><td>${b.createdAt}</td></tr>`))
        : h.hint('暂无在挂悬赏。即时性四件套：发布即活 / 瞬时播报 / 兑现待办 24h 转黄 / cashed_at 留痕。')}`)}
    ${h.card(`M14② 抽检生成器（每周 ${SK.getCoef('yuren.spotCheck').weeklyK} 张随机）`, `
      ${h.btn('生成本周抽检卡', 'yr.gen-spot', { cls: 'pri sm' })}
      ${wk.length ? h.tbl([{ t: '员工' }, { t: '环节' }, { t: '上报数', num: 1 }, { t: '出题日' }],
        wk.map(c => `<tr><td>${esc(spName(c.employeeId))}</td><td>${TALK.stageNames[c.stage]}</td>
          <td class="num">${c.reportedCount}</td><td>${c.checkDate}</td></tr>`)) : ''}
      ${h.hint(TALK.spotFooter + '——只出题不记结果，无造假字段，不构成负面标记（Y-D7）。量增质塌（+50%∧−30%）者抽检加权 ×3。')}`)}`;
  }

  /* —— ⑨ 我的今天（销售端 · 🔴 零排名 · 零对比 · 零员工红灯） —— */
  function renderOxygenCard(model) {
    // oxygen-no-compare：本卡只渲染榜样的爬升曲线与当年处境，结构上不含本人任何数据（Y-D11）
    const row = m21Row(model);
    const traj = (row && row.trajEarly) || [];
    if (!traj.length) return '';
    const W = 300, H = 90;
    const mx = Math.max(...traj, 1);
    const pts = traj.map((v, i) => `${20 + i * ((W - 40) / Math.max(1, traj.length - 1))},${H - 15 - (v / mx) * (H - 35)}`).join(' ');
    return h.card('可比的人，才是可用的希望', `
      <p>${esc(spName(model))} 当年也在同样的位置。后来他爬到了中上。这是他当年的爬升曲线：</p>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/></svg>
      ${h.hint('曲线为榜样当年同司龄段月度表现（万元）。')}`, { cls: 'oxygen-no-compare' });
  }
  function vMy(db, today) {
    const sps = activeSps();
    const spId = mySp && sps.some(p => p.spId === mySp) ? mySp : (sps[0] || {}).spId;
    if (!spId) return h.banner('尚无员工档案——先到「数据中心 → 员工档案」添加。', 'a');
    const myRx = db.prescriptions.filter(r => r.employeeId === spId).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    const myPair = db.pairAssignments.filter(pa => pa.status === 'active' && (pa.coachId === spId || pa.learnerId === spId));
    const oxygenModel = db.oxygen ? db.oxygen[spId] : null;
    const r = db.dailyReports.find(x => x.employeeId === spId && x.date === today);
    const c = r ? r.counts : {};
    const activeBt = db.bounties.filter(b => b.active);
    return `<div style="max-width:560px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <h2 style="font-size:17px">我的今天</h2>
      <select id="yr-my-sp">${sps.map(p => `<option value="${p.spId}"${p.spId === spId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    ${myRx ? h.card(`今日处方 · ${myRx.date}`, `<p style="font-size:14px">${esc(myRx.text)}</p>
      <div style="margin-top:8px">${myRx.ackedAt ? h.badge('已确认', 'g') : h.btn('我看到了，今天照做', 'yr.ack-rx', { cls: 'pri sm', data: `data-rx="${myRx.rxId}"` })}</div>
      ${h.hint(TALK.rxFooter)}`)
      : h.card('', h.hint('今天还没有处方。做好四计数，处方会越来越准。'))}
    ${h.card('今日四计数（一键提交）', `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      ${['leads', 'intents', 'samples', 'contracts'].map(k =>
        `<label style="display:flex;gap:4px;align-items:center">${TALK.stageNames[k]}
        <input type="number" min="0" style="width:64px" id="yr-c-${spId}-${k}" value="${c[k] != null ? c[k] : ''}" placeholder="0"></label>`).join('')}
      ${h.btn('提交', 'yr.save-report', { cls: 'pri sm', data: `data-sp="${spId}" data-date="${today}"` })}</div>
      ${isWorkday(today, db.shiftConfig, spId) ? '' : h.hint('今天是休息日，不催不计。')}`)}
    ${myPair.map(pa => {
      const isCoach = pa.coachId === spId;
      const t = topicFor(db, pa.learnerId, today);
      return h.card(`本周配对 · ${isCoach ? '我带 ' + esc(spName(pa.learnerId)) : esc(spName(pa.coachId)) + ' 带我'}`,
        `<p>话题：${esc(t.stage)} · 每周 ${SK.getCoef('yuren.m40').sessionMinutes} 分钟。</p><p class="hint">${esc(t.text)}</p>
        ${pa.coachAckId ? h.badge('本周已回执', 'g') : h.btn('本周已聊，确认回执', 'yr.ack-pair', { cls: 'sm', data: `data-pair="${pa.pairId}"` })}`);
    }).join('')}
    ${oxygenModel ? renderOxygenCard(oxygenModel) : ''}
    ${activeBt.length ? h.card('在挂悬赏', activeBt.map(b => `<div class="kv"><span class="k">${TALK.bountyNames[b.template]}</span><b class="num">${fmt.yuan(b.amountAmt)}</b></div>`).join('')
      + h.hint('达成由系统事件流自动判定，无需申报。')) : ''}
    <p class="hint" style="text-align:center;margin-top:20px">${esc(TALK.privacy)}</p></div>`;
  }

  /* ========= 动作 ========= */
  Object.assign(SK.actions, {
    'yr.set-source': d => {
      const r = setRecipeSource(SK.DB, [d.sp], SK.today());
      if (r.ok) { UI.commit(); UI.toast('已设为配方源（每次设定必过闸④）'); }
      else UI.toast('闸④未过：' + (r.check.locked ? '需要 M21 归一化' : r.check.fails.map(f => gateShort[f]).join('、')));
    },
    'yr.insist-source': d => {
      SK.DB.insistLog.push({ date: SK.today(), type: 'source', spId: d.sp });
      UI.commit();
      UI.toast('已留痕。系统仍不会把不合格者设为配方源——这不是复制销冠，是把漏水规模化。');
    },
    'yr.goto-rx': d => { rxSp = d.sp; UI.nav('yuren', 'rx'); },
    'yr.rx-adopt': () => {
      rxDraft = rxAutoText(SK.DB, curRxSp(), SK.today()) || '';
      UI.render();
    },
    'yr.rx-save': () => yrSaveRx(false),
    'yr.rx-insist': () => yrSaveRx(true),
    'yr.rx-dispatch': () => {
      const db = SK.DB, today = SK.today(), sp = curRxSp();
      const text = rxAutoText(db, sp, today);
      if (!text) return;
      const diag = rxDiagnose(db, sp, today);
      savePrescription(db, { employeeId: sp, text, type: diag.none ? 'volume' : diag.top.type,
        psiParts: psiPartsFor(db, sp, text, diag) }, today);
      UI.commit(); UI.toast('系统建议稿已派发');
    },
    'yr.add-banned': () => {
      const el = document.getElementById('yr-plv-add');
      const w = el ? el.value.trim() : '';
      if (w && bannedAll().indexOf(w) < 0) { extraBanned().push(w); UI.commit(); UI.toast('已加入拦截词库（只增不删）'); }
    },
    'yr.gen-pairs': () => {
      const db = SK.DB, today = SK.today();
      const input = m40WeeklyInput(db, today);
      if (!input) return UI.toast('需要算账器 M21 数据');
      const r = m40Pairing(input, SK.getCoef('yuren.m40'));
      const old = {};
      db.pairAssignments.forEach(pa => { if (pa.status === 'active') old[pa.coachId + '|' + pa.learnerId] = pa.consecutiveWeeks; });
      db.pairAssignments.forEach(pa => { if (pa.status === 'active') pa.status = 'rotated'; });
      r.pairs.forEach(p => db.pairAssignments.push({ pairId: SK.uid('pair'), weekOf: today,
        coachId: p.coachId, learnerId: p.learnerId, topicStage: topicFor(db, p.learnerId, today).stage,
        status: 'active', consecutiveWeeks: (old[p.coachId + '|' + p.learnerId] || 0) + 1, coachAckId: null }));
      UI.commit(); UI.toast(`本周配对已生成：${r.pairs.length} 对` + (r.queued.length ? `，候补 ${r.queued.length} 人` : ''));
    },
    'yr.send-oxygen': d => {
      if (!SK.DB.oxygen) SK.DB.oxygen = {};
      SK.DB.oxygen[d.sp] = d.model;
      UI.commit(); UI.toast(`供氧卡已放入 ${spName(d.sp)} 的销售端（只显榜样曲线，无对比）`);
    },
    'yr.save-report': d => {
      const db = SK.DB;
      const date = d.date || fillDate || SK.today();
      const counts = {};
      ['leads', 'intents', 'samples', 'contracts'].forEach(k => {
        counts[k] = parseInt((document.getElementById(`yr-c-${d.sp}-${k}`) || {}).value || '0', 10) || 0;
      });
      saveDailyReport(db, { spId: d.sp, date, counts });
      UI.commit(); UI.toast(`已记 ${spName(d.sp)} ${date} 四计数`);
    },
    'yr.save-quota': d => {
      const v = (document.getElementById('yr-q-' + d.sp) || {}).value;
      if (v === '' || v == null) delete SK.DB.paceConfig.manualQuotaBySp[d.sp];
      else SK.DB.paceConfig.manualQuotaBySp[d.sp] = Math.round(parseFloat(v) * 100);
      UI.commit();
    },
    'yr.shift': (d, el) => {
      const day = parseInt(d.day, 10);
      const rest = SK.DB.shiftConfig['*'] || [];
      SK.DB.shiftConfig['*'] = el.checked ? rest.concat(day) : rest.filter(x => x !== day);
      UI.commit();
    },
    'yr.enable-silent': () => { SK.DB.silentTrackOn = true; bountyBlocked = null; UI.commit(); UI.toast('静默认可通道已启用'); },
    'yr.save-bounty': () => {
      const template = (document.getElementById('yr-bt-template') || {}).value;
      const amountYuan = parseFloat((document.getElementById('yr-bt-amount') || {}).value || '0');
      const r = saveBounty(SK.DB, { template, amountAmt: Math.round(amountYuan * 100) }, SK.today());
      if (r.ok) { bountyBlocked = null; UI.commit(); UI.toast('悬赏已发布'); }
      else if (r.talk === 'Y-13') { bountyBlocked = template; UI.render(); }
      else UI.toast(r.err || '未保存');
    },
    'yr.gen-spot': () => {
      const db = SK.DB, today = SK.today();
      const k = SK.getCoef('yuren.spotCheck').weeklyK;
      const sps = activeSps();
      for (let i = 0; i < k && sps.length; i++) {
        const p = sps[Math.floor(Math.random() * sps.length)];
        const stage = ['leads', 'intents', 'samples'][Math.floor(Math.random() * 3)];
        const rr = db.dailyReports.filter(x => x.employeeId === p.spId && dd(x.date, today) < 7);
        db.spotChecks.push(makeSpotCheckCard(p.spId, today, stage, sumCounts(rr)[stage]));
      }
      UI.commit(); UI.toast('本周抽检卡已生成——只出题不记结果');
    },
    'yr.ack-rx': d => {
      const rx = SK.DB.prescriptions.find(x => x.rxId === d.rx);
      if (rx) rx.ackedAt = SK.today();
      UI.commit(); UI.toast('已确认：我看到了，今天照做');
    },
    'yr.ack-pair': d => {
      const db = SK.DB;
      const pa = db.pairAssignments.find(x => x.pairId === d.pair);
      if (pa) {
        const min = SK.getCoef('yuren.m40').sessionMinutes;
        const ack = { ackId: SK.uid('ack'), spId: pa.learnerId, coachId: pa.coachId, date: SK.today(),
          durationHrs: min / 60, reportedHrs: min / 60, status: 'confirmed' };
        db.coachingAcks.push(ack);
        pa.coachAckId = ack.ackId;
      }
      UI.commit(); UI.toast('配对回执已确认（计入辅导剂量）');
    },
  });
  function yrSaveRx(insist) {
    const db = SK.DB, today = SK.today();
    const sp = (document.getElementById('yr-rx-sp') || {}).value || curRxSp();
    const text = ((document.getElementById('yr-rx-text') || {}).value || '').trim();
    if (!text) return;
    const diag = rxDiagnose(db, sp, today);
    const momOn = momentumStates(db, today).some(m => m.sp.spId === sp);
    const r = savePrescription(db, { employeeId: sp, text, insist, momentumMode: momOn,
      type: diag.none ? 'volume' : diag.top.type, psiParts: psiPartsFor(db, sp, text, diag) }, today);
    if (r.ok) { rxDraft = ''; UI.commit(); UI.toast(insist ? '已保存（坚持原文已留痕）' : '处方已派发'); }
    else { rxDraft = text; UI.render(); UI.toast('PLV 未过——无保存路径（可坚持原文留痕）'); }
  }

  /* —— PLV 实时亮灯（input 局部更新，不整页重绘）+ 模块内选择器 —— */
  if (typeof document !== 'undefined') {
    document.addEventListener('input', ev => {
      const t = ev.target;
      if (!t || t.id !== 'yr-rx-text') return;
      rxDraft = t.value;
      const db = SK.DB;
      const momOn = momentumStates(db, SK.today()).some(m => m.sp.spId === curRxSp());
      const plv = plvCheck(rxDraft, { banned: bannedAll(), names: db.people.map(p => p.name), momentum: momOn });
      const panel = document.getElementById('yr-plv-panel');
      if (panel) panel.innerHTML = renderPlvPanel(plv, rxDraft);
      const btn = document.querySelector('[data-act="yr.rx-save"]');
      if (btn) btn.disabled = !(plv.passed && rxDraft.trim());
      const insistWrap = document.getElementById('yr-rx-insist-wrap');
      if (insistWrap) insistWrap.style.display = (rxDraft.trim() && !plv.passed) ? 'inline' : 'none';
    });
    document.addEventListener('change', ev => {
      const t = ev.target;
      if (!t || !t.id) return;
      if (t.id === 'yr-rx-sp') { rxSp = t.value; rxDraft = ''; UI.render(); }
      else if (t.id === 'yr-my-sp') { mySp = t.value; UI.render(); }
      else if (t.id === 'yr-fill-date') { fillDate = t.value; UI.render(); }
    });
  }

  /* ========= summary（跨板块契约）/ 模块注册 ========= */
  SK.summary.yuren = (db, today) => {
    const W = 90;
    const doseA = coachingDoseActual(db.coachingAcks, SK.activeSales().length, W, today);
    const from = addDays(today, -W);
    const reported = db.coachingAcks.filter(a => a.date > from && a.date <= today)
      .reduce((s, a) => s + (a.reportedHrs || a.durationHrs || 0), 0);
    const confirmed = db.coachingAcks.filter(a => a.status === 'confirmed' && a.date > from && a.date <= today)
      .reduce((s, a) => s + (a.durationHrs || 0), 0);
    let redNewbies = [];
    try { redNewbies = newbieBoard(db, today).filter(x => x.suggestCull).map(x => x.sp.spId); } catch (e) { /* 基准缺失 → 空 */ }
    return {
      coachingDoseActual: doseA,
      cognitiveGapRate: cognitiveGap(reported, confirmed),
      redNewbies,
      recipeSourceIds: db.recipeSource ? db.recipeSource.sourceIds.slice() : [],
    };
  };

  SK.registerModule({
    id: 'yuren', title: '育人', icon: '🌱', order: 5,
    subnav: [
      { id: 'start', label: '起点·分诊' }, { id: 'gate4', label: '配方源资格' }, { id: 'gate3', label: '产权前提' },
      { id: 'cards', label: '配方引擎' }, { id: 'rx', label: '处方工作台' }, { id: 'pace', label: '节奏台' },
      { id: 'floor', label: '地板抬升' }, { id: 'fill', label: '填报中心' }, { id: 'my', label: '我的今天(销售端)' },
    ],
    liveCells() {
      const yr = SK.X('yuren');
      if (!yr) return [];
      const d = yr.coachingDoseActual, g = yr.cognitiveGapRate;
      return [
        { k: '辅导剂量', v: d == null ? DASH : d + ' h/人·月', tone: d != null && d < SK.getCoef('zhaoren.coachingDose').floorHrsMonth ? 'red' : 'green', board: 'yuren', sub: 'pace', tip: '闸⑪ confirmed 回执 90 天窗，人均月；下限 3h/上限 5h' },
        { k: '认知鸿沟', v: fmt.pct(g), tone: g != null && g > 0.3 ? 'red' : '', board: 'yuren', sub: 'pace', tip: '闸⑩ 1 − 确认/上报；>30% 红——你以为的辅导没有发生' },
      ];
    },
    alerts() { return triage(SK.DB, SK.today()).filter(a => a.tone === 'r').length; },
    alertList() { return triage(SK.DB, SK.today()).map(a => ({ tone: a.tone, text: '育人 · ' + a.text, board: 'yuren', sub: a.sub })); },
    render(sub) {
      const db = SK.DB, today = SK.today();
      switch (sub) {
        case 'gate4': return vGate4(db, today);
        case 'gate3': return vGate3(db, today);
        case 'cards': return vCards(db, today);
        case 'rx': return vRx(db, today);
        case 'pace': return vPace(db, today);
        case 'floor': return vFloor(db, today);
        case 'fill': return vFill(db, today);
        case 'my': return vMy(db, today);
        default: return vStart(db, today);
      }
    },
  });

  /* ========= 对拍自检（fixture 纯函数，不碰 DB） ========= */
  SK.tests.push(
    { id: 'YR-T1', name: 'PLV「态度/狼性」三层全拦截+改写建议', fn: () => {
      const r = plvCheck('你态度不端正，要拿出狼性');
      const hints = plvRewriteHint(r);
      return { pass: !r.l1.pass && !r.l2.pass && !r.l3.pass && !r.passed && hints.length > 0, got: r.l1.hits.join('、'), want: '态度、狼性命中' };
    } },
    { id: 'YR-T2', name: 'PLV 合规句三层通过', fn: () => {
      const r = plvCheck('你昨天 12 通电话，9 通没做需求确认。今天试试在第 3 分钟问"您现在最头疼的是什么？"配方源基准 87%');
      return { pass: r.l1.pass && r.l2.pass && r.l3.pass && r.passed, got: r.l3.slots, want: '三槽位全真' };
    } },
    { id: 'YR-T3', name: 'PSI 改造前 32 红 / 改造后 96 绿', fn: () => {
      const before = psiScore({ targeting: 0.48, benchmark: 0.32, dataRef: 0.24, ackRate: 0.24 });
      const after = psiScore({ targeting: 0.92, benchmark: 1.0, dataRef: 1.0, ackRate: 0.92 });
      return { pass: before === 32 && after === 96 && psiBand(before) === 'red' && psiBand(after) === 'green', got: before + '/' + after, want: '32/96' };
    } },
    { id: 'YR-T4', name: '有效动作分：刷线索×2 → 有效分不变', fn: () => {
      const e1 = effectiveLeads(40, 6, 0.2), e2 = effectiveLeads(80, 6, 0.2);
      return { pass: e1 === 30 && e2 === 30, got: e1 + '→' + e2, want: '30→30' };
    } },
    { id: 'YR-T5', name: 'M41：连败4 + 赢率30%→18% → 0.64 触发', fn: () => {
      const m = momentum(4, 0.30, 0.18);
      const plv = plvCheck('必须拿下这一单', { momentum: true });
      return { pass: m.score === 0.64 && m.triggered === true && !plv.l1.pass, got: m.score, want: 0.64 };
    } },
    { id: 'YR-T6', name: '认知鸿沟 cognitiveGap(3.6,2)=0.444', fn: () => {
      const g = cognitiveGap(3.6, 2);
      return { pass: Math.round(g * 1000) / 1000 === 0.444 && g > 0.30, got: Math.round(g * 1000) / 1000, want: 0.444 };
    } },
    { id: 'YR-T7', name: 'M43：0.35→弃赛/0.70→加速/1.05→保护；子目标=3.3万不入配额', fn: () => {
      const z1 = paceZone(0.35), z2 = paceZone(0.70), z3 = paceZone(1.05);
      const sub = subGoalAmt(10, 300000);   // 10 工作日 × 日均 0.3万 × 1.1 → roundTo 百元
      return { pass: z1 === 'quit_risk' && z2 === 'accel' && z3 === 'protect' && sub === 3300000, got: [z1, z2, z3, sub].join('/'), want: 'quit_risk/accel/protect/3300000' };
    } },
    { id: 'YR-T8', name: '咬合基准 newHireYearRate("short",1)=0.658333（内核）', fn: () => {
      const v = SK.newHireYearRate('short', 1);
      return { pass: v != null && v.toFixed(6) === '0.658333', got: v && v.toFixed(6), want: '0.658333' };
    } },
    { id: 'YR-T9', name: 'M40 配对黄金值：J↔P7 F↔P8 G↔P5 + 候补 P4/P6；撤 M28 → 冻结', fn: () => {
      const people = [
        { spId: 'J', rankNorm: 1 }, { spId: 'F', rankNorm: 2 }, { spId: 'G', rankNorm: 3 },
        { spId: 'P4', rankNorm: 4, growth3m: 0.05 }, { spId: 'P5', rankNorm: 5, growth3m: 0.02 },
        { spId: 'P6', rankNorm: 6, growth3m: 0.09 }, { spId: 'P7', rankNorm: 7, growth3m: -0.12 },
        { spId: 'P8', rankNorm: 8, growth3m: -0.08 }, { spId: 'P9', rankNorm: 9 }, { spId: 'P10', rankNorm: 10 },
      ];
      const gate4 = ['J', 'F', 'G'];
      const r1 = m40Pairing({ people, gate4PassIds: gate4, m28SignedIds: ['J', 'F', 'G'], prevWeeks: {} });
      const k1 = r1.pairs.map(p => p.coachId + '↔' + p.learnerId).join(' ');
      const r2 = m40Pairing({ people, gate4PassIds: gate4, m28SignedIds: ['J', 'F'], prevWeeks: {} });
      const rotate = !pairAllowed(3) && pairAllowed(2);
      return { pass: k1 === 'J↔P7 F↔P8 G↔P5' && r1.queued.join('/') === 'P4/P6'
        && r2.pairs.length === 2 && r2.frozenCoachIds.indexOf('G') >= 0 && rotate, got: k1 + ' 候补 ' + r1.queued.join('/'), want: 'J↔P7 F↔P8 G↔P5 候补 P4/P6' };
    } },
    { id: 'YR-T10', name: '闸⑧三态 + Y-13 金句；M42 曼哈顿距离 3<18 → W', fn: () => {
      const a = bountyGate('record_break', false), b = bountyGate('record_break', true), c = bountyGate('first_deal', false);
      const y13ok = TALK.y13(TALK.bountyNames.record_break).indexOf('不是不许用钱，是不许只有钱') >= 0;
      const best = m42Match([2, 2, 3, 3, 4, 4], [
        { spId: 'W', traj: [2, 3, 3, 4, 4, 5], nowBandOk: true },
        { spId: 'V', traj: [5, 5, 6, 6, 7, 7], nowBandOk: true }]);
      const none = m42Match([2, 2, 3, 3, 4, 4], []);
      return { pass: a.allow === false && a.talk === 'Y-13' && b.allow === true && c.state === 'exempt' && y13ok
        && best.spId === 'W' && best.dist === 3 && trajDistance([2, 2, 3, 3, 4, 4], [5, 5, 6, 6, 7, 7]) === 18 && none === null,
        got: [a.state, b.state, c.state, best && best.spId].join('/'), want: 'blocked/pass/exempt/W' };
    } },
  );
})();
