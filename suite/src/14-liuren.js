/* ============================================================
   留人器（信用层）—— 治理体检 / 十二道闸 / 流失价签 / 该谈·预检·离职 /
   产权 M28 / 蓝图与分红 / 钱途页(销售端)
   原版靠信封异步互导；一体版全部实时：X('suanzhang'|'dingjia'|'yuren'|'zhaoren')
   可能为 null——一律判空显示“—”与引导，不锁功能（原闸①锁改为引导 banner）。
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { fmt, esc, DASH, safeDiv } = SK;

  /* ================= 话术库 L 系（逐字复刻原版 scripts.js；📎 出处随文） ================= */
  const S = {
    L01: (v) => `高监督(${v.sii}) + 低授权(${v.ei}) + 低信用(${v.ahc}) → 🔴 分红会白花；🔴 销冠不会交出配方（他不信你）；🔴 你会一直留不住人（异议提出 0 次＝没人敢说话）。✅ 修复顺序按 ROI（各项收益＝修复后重算指数−当前值，系统实算）。`,
    L02: (v) => `你自评平均偏差 ${v.gap} 分。📎 世界管理调查（Bloom & Van Reenen, QJE）：管理者自评与客观评分几乎零相关——最差的企业自我感觉最好。愿意看这张图的老板，已经赢了一半同行。`,
    L03: () => `90 天内异议提出次数＝0。要么没人敢用，要么没人知道有这个入口——两种情况都指向：你的团队没有心理安全。`,
    L05: () => `留人功能已锁定。📎 Zoltners（数千个销售辖区）：约六成（≈56%）的辖区太大或太小；辖区不公平是销售流失的顶级驱动因素之一。他要走，是因为你没给他钱，还是因为你没给他饭吃？[ 导入算账器数据包，先做地盘审计 ]`,
    L06: (v) => `📎 Organization Science 2016：奖励一上，原本内在驱动的优秀者在奖励范围之外的日常任务上效率下降 8%——收益来自一小撮靠奖励驱动的人，成本来自所有人。✅ 必须开启静默认可通道：连续 ${v.n || 6} 月达标 → 灯塔+合约资格池，但不发奖、不播报、不排名。`,
    L07: (v) => `系统检测到 ${v.n} 个「交出物」事件，其中 ${v.m} 个没有产权补偿。📎 第四定理（Hart，诺奖 2016）：你不给他控制权，他就不会投入你测不到的努力。🔴 且你的 AHC 是 ${v.ahc}（全员可见）：这个分数下，就算现在给产权，他也不一定信。✅ [生成 M28 协议(带教 5%×12月)] [开启 irrevocable] [先兑现欠着的 ${v.k} 笔承诺]`,
    L08: (v) => `你准备启用${v.period}分红，池比例 ${v.rate}。📎 元回归（56 项研究）：分红只有与「低监督+授权+培训+市场水平底薪」组合才有效。系统体检：🔴 ${v.n} 条不达。✅ 修复顺序：${v.fix || '按 ROI'}。[ 我知道风险，仍要启用（留痕，计入 AHC 扣分）]`,
    L09: (v) => `${v.name}：归一化排名连续 ${v.m} 个月第 ${v.r}，剪刀差 ${v.sc}，12 个月零特殊奖励。冠军有超额提成，垫底有辅导和淘汰线——只有千年老二什么都没有，而猎头名单上他排最前。📎 Ahearne 2025：中上段承受最强"挫败-价值失配"，恰是流失与被挖高危带。✅ 建议：单独战役+单独承诺。`,
    L10a: (v) => `拟发 ${v.amt} 低于他去年同期实收 ${v.hist}——这不是发钱，是宣战。📎 Mas, QJE 2006。`,
    L10b: (v) => `拟发 ${v.amt} 高于去年（${v.hist}），但低于他心里的"应得数"（${v.trend}，按贡献增长 ${v.g} 推算）——涨了钱，买到怨气。📎 Mas, QJE 2006：参照点才是计价器。`,
    L10c: (v) => `拟发 ${v.amt} ≥ 趋势参照点 ${v.trend}。这笔钱他会记成"被看见"。`,
    L10d: () => `发放沟通铁律：公开"规则"（这笔钱怎么算出来的公式），永不公开"数字"（别人拿多少）。📎 Card et al., AER 2012：公开工资只做减法——伤人的是名次，不是金额。`,
    L11: (v) => `${v.leaver} 离职的余震期已开始。同部门错价最重的三个人：${v.list}。📎 AMJ 2009：离职会传染。📎 中国连锁企业 RCT：指定名单一对一周聊，流失率实打实降 1.7pp。一周内每人谈一次。你不去谈，猎头替你谈。`,
    L12: (v) => `他带走的不只是他自己：在途 ${v.n} 单、账面 ${v.sum}，按全球折损口径你将损失 ≈${v.loss}，其中约一半（${v.save}）可救。📎 接手他人管道的成交率比原销售低 30–50%（HBR）。交接卡已生成，请指派接手人。`,
    L13: (v) => `监督成本 MC=${v.mc} → 🟢 该发包。📎 Brickley & Dark 1987。⚠️ 漏水守恒：发包不是消除代理问题，是把"偷懒"换成"搭便车"（📎 Holmström & Milgrom 1991）。`,
    L14full: (v) => `你们老板的履约信用：${v.ahc} 分。过去 12 个月，他兑现了 ${v.a} 笔承诺中的 ${v.b} 笔，从未尝试下调过任何一笔分成。`,
    L14low: (v) => `你的反敲竹杠信用分是 ${v.ahc}。过去 12 个月：达成 ${v.a} 笔只兑现 ${v.b} 笔（履约率 ${v.r}）；尝试下调分成 ${v.c} 次（全部被系统拦截）。🔴 你的销冠都看得见这些数字。✅ 唯一解法：把 AHC 修上去——信用不能买，只能攒。`,
    L15: (v) => `你要挂的是一个**结果赏**（${v.templateName || '结果类悬赏'}）——奖的是他本来就想干的事。📎 Gubler-Larkin-Pierce (2016), Org Sci：象征与物质奖励挤出骨干，产出 −8%；📎 Heyman & Ariely：小额金钱把社会规范切成市场规范；📎 Gneezy & Rustichini 2000《A Fine Is a Price》：罚款取消后行为不回弹——切换不可逆。真正的风险不是"给了钱"，而是：当公司里所有值得做的事都明码标价，没标价的事就自动等于不值得做的事。✅ 系统不拦你发钱，只要求你同时留一条不发钱的承认路径：静默认可通道——连续 6 个月达标 → 进灯塔 + 进前程合约资格池，不发奖、不播报、不排名。不是不许用钱，是不许只有钱。`,
  };

  /* ================= 引擎（纯函数；系数经 SK.getCoef，测试可注入 fixture 系数） ================= */
  const bandBy = (v, lo, hi, higherIsBetter) => {
    if (v == null) return null;
    if (higherIsBetter) return v >= hi ? 'success' : v >= lo ? 'warning' : 'danger';
    return v > hi ? 'danger' : v > lo ? 'warning' : 'success'; // 越低越好（SII）
  };
  const bandWord = b => ({ success: '🟢 健康', warning: '🟡 注意', danger: '🔴 危险' })[b] || DASH;
  const toneOf = b => b === 'success' ? 'g' : b === 'warning' ? 'a' : b === 'danger' ? 'r' : 'n';
  const heroTone = b => b === 'success' ? 'green' : b === 'warning' ? 'amber' : b === 'danger' ? 'red' : '';
  const meterTone = b => b === 'success' ? '' : b === 'warning' ? 'a' : b === 'danger' ? 'r' : '';
  const activeHead = db => db.people.filter(p => p.isActive).length; // 原版 activeHeadcount＝在职总数

  // ---- 3.1 四大指数（SII/EI 本板块实时；DVI 直取算账器；AHC 计算得出改不了） ----
  function calcSII(g, head, c) {
    c = c || SK.getCoef('liuren.sii'); const w = c.w;
    const raw =
      w[0] * (g.dailyReportOn ? 1 : 0) +
      w[1] * (g.rollcallOn ? 1 : 0) +
      w[2] * Math.min(g.spotChecksPerWeek / c.spotCap, 1) +
      w[3] * Math.min(g.approvalLevels / c.approveCap, 1) +
      w[4] * Math.min((safeDiv(g.monthlyViewsTotal, head * c.viewPerCapMonth) ?? 0), 1) +
      w[5] * Math.min((safeDiv(g.rxCountTotal, head * c.rxPerCapMonth) ?? 0), 1);
    return Math.round(raw);
  }
  function calcEI(g, head, covenantConfirmRatio, c) {
    c = c || SK.getCoef('liuren.ei'); const w = c.w;
    // 🔧L-C15：建议提出数=0 → 采纳项按 0 计（授权通道未被使用，非证据缺失）
    const adoptRatio = g.suggestionsRaised > 0 ? g.suggestionsAdopted / g.suggestionsRaised : 0;
    const raw =
      w[0] * Math.min((safeDiv(g.objectionsRaisedQuarter, head * c.objectionPerCapQuarter) ?? 0), 1) +
      w[1] * adoptRatio +
      w[2] * covenantConfirmRatio +
      w[3] * (1 - g.cardIgnoreRate);
    return Math.round(raw);
  }
  function calcAHC(a, covenants, c) {
    c = c || SK.getCoef('liuren.ahc'); const w = c.w;
    const honoredRatio = safeDiv(a.honoredCount, a.achievedCount) ?? 0;
    const covs = covenants || [];
    const irrRatio = covs.length ? covs.filter(x => x.irrevocable).length / covs.length : 0; // 无 covenant → 0
    const raw =
      w[0] * honoredRatio +
      w[1] * irrRatio +
      w[2] * (1 - Math.min(a.interceptCount / c.interceptCap, 1)) +
      w[3] * (1 - Math.min(a.ratchetCount / c.ratchetCap, 1));
    return Math.round(raw);
  }
  function covConfirmRatio(covs) { return covs.length ? covs.filter(x => x.bothConfirmed).length / covs.length : 0; }
  function liveIndices(db) {
    const head = activeHead(db), covs = db.covenants || [];
    const sii = calcSII(db.governance.sii, head);
    const ei = calcEI(db.governance.ei, head, covConfirmRatio(covs));
    const ahc = calcAHC(db.governance.ahcInputs, covs);
    const sz = SK.X('suanzhang');
    const dvi = sz && sz.dvi != null ? sz.dvi : null;
    const cS = SK.getCoef('liuren.sii'), cE = SK.getCoef('liuren.ei'), cA = SK.getCoef('liuren.ahc');
    return {
      head, sii, ei, dvi, ahc,
      siiBand: bandBy(sii, cS.bands[0], cS.bands[1], false),
      eiBand: bandBy(ei, cE.bands[0], cE.bands[1], true),
      dviBand: bandBy(dvi, 30, 60, true),
      ahcBand: bandBy(ahc, cA.bands[0], cA.bands[1], true),
    };
  }
  const liveAhc = () => calcAHC(SK.DB.governance.ahcInputs, SK.DB.covenants);

  // ---- 3.2 M29.5 自评-实评偏差器（DVI 缺则 3 项均值） ----
  function calcDeviation(self, actual) {
    const pairs = [['监督 SII', self.sii, actual.sii], ['授权 EI', self.ei, actual.ei], ['可见 DVI', self.dvi, actual.dvi], ['信用 AHC', self.ahc, actual.ahc]];
    const rows = pairs.filter(p => p[2] != null).map(p => ({ label: p[0], self: p[1], actual: p[2], gap: Math.abs(p[1] - p[2]) }));
    const gap = rows.length ? Math.round(rows.reduce((s2, d) => s2 + d.gap, 0) / rows.length) : null;
    return { rows, gap };
  }

  // ---- 3.5 M28 产权对价 ----
  function m28Value(agr) {
    if (agr.kind === 'mentoring') return Math.round((agr.apprenticeMonthlyNetAmt || 0) * agr.rate * agr.durationMonths);
    if (agr.kind === 'royalty') return Math.round((agr.teamMonthlyIncrementAmt || 0) * agr.rate * agr.durationMonths);
    return null;
  }

  // ---- 3.7 M16.1 流失价签（权威 6 项；月毛利/爬坡当量/年招聘量全部实时） ----
  function lastMonths(today, k) {
    const [y, m] = today.split('-').map(Number); const out = [];
    for (let i = k - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
    return out;
  }
  function monthlyGrossMargin(db, spId, today) {
    const ms = new Set(lastMonths(today, 6));
    let sum = 0, found = false;
    for (const dl of db.deals) {
      if (dl.employeeId !== spId || dl.status !== 'won' || !dl.dealDate || !ms.has(SK.monthOf(dl.dealDate))) continue;
      const cat = db.categories.find(c => c.id === dl.categoryId);
      sum += dl.paymentAmt * (cat ? cat.grossMarginRate : db.company.blendedMarginRate);
      found = true;
    }
    if (found) return { amt: Math.round(sum / 6), source: 'deals' };
    const w = db.company.lastYearPerCapitaWan;
    return w ? { amt: Math.round(w * SK.WAN / 12), source: 'fallback' } : { amt: null, source: null };
  }
  function rampGapMonthsEq(cycle) { // Σ(1−curve[m]/100)；regular ≈ 5.78 月
    const arr = SK.RAMP[cycle] || SK.RAMP.regular;
    let s = 0; for (const v of arr) s += 1 - v / 100;
    return s;
  }
  function calcPriceTag(db, today) {
    const pt = db.priceTag;
    const sales = db.people.filter(p => p.isActive && p.positionType === 'sales');
    const spId = pt.spId && sales.some(s => s.spId === pt.spId) ? pt.spId : (sales[0] ? sales[0].spId : null);
    if (!spId) return null;
    const person = db.people.find(p => p.spId === spId);
    const gmr = monthlyGrossMargin(db, spId, today);
    if (gmr.amt == null) return null;
    const gm = gmr.amt;
    const hire = pt.hireMonths != null ? pt.hireMonths : 1.5;
    const pb = pt.paybackMonths != null ? pt.paybackMonths : 6;   // DB.priceTag.paybackMonths ?? 6
    const eq = rampGapMonthsEq(db.company.cycleTier);
    const headline = Math.round(gm * (hire + pb));
    const rampGap = Math.round(gm * eq);
    const rampGapShare = safeDiv(rampGap, headline);
    const raiseAnnual = (pt.raiseMonthlyAmt || 0) * 12;
    const hiresPerYear = sales.length * (db.company.attritionRate || 0); // 实时：在职销售数×流失率
    const shortenGainAnnual = Math.round(rampGap * (pt.shortenPct || 0) * hiresPerYear);
    const hCards = (db.handoverCards || []).filter(c => c.leaverId === spId);
    const handoverAmt = hCards.length ? Math.round(hCards.reduce((s2, c) => s2 + (c.amountAmt || 0), 0) * SK.getCoef('liuren.handoverLossRate')) : null;
    const items = [
      { key: 'hiring', name: '① 招聘成本', amt: person && person.hiringCostAmt != null ? person.hiringCostAmt : SK.getCoef('shared.hiringCostDefaultAmt'), scope: '完全招聘成本（员工档案）' },
      { key: 'ramp', name: '② 爬坡缺口', amt: rampGap, scope: `🔴 最大头 · ${SK.CYCLE_CN[db.company.cycleTier] || ''}曲线当量 ${fmt.num(eq, 2)} 月` },
      { key: 'idlepipe', name: '③ 空窗管道', amt: Math.round(gm * hire), scope: '招聘周期内无人产出' },
      { key: 'mgr', name: '④ 经理时间', amt: Math.round(gm * 0.4), scope: '重新带人的管理耗时' },
      { key: 'decay', name: '⑤ 接手劣化 35%（慢性）', amt: Math.round(gm * SK.getCoef('liuren.pipelineDecayInPriceTag')), scope: '常规客户/管道整体降效' },
      { key: 'handover', name: '⑥ 在途单交接 40%（急性）', amt: handoverAmt, scope: handoverAmt == null ? '仅具名交接卡；今日无在途单 → —' : `${hCards.length} 张具名交接卡 ×40%` },
    ];
    return {
      spId, name: person ? person.name : DASH, gm, gmSource: gmr.source, hireMonths: hire, paybackMonths: pb, rampGapMonthsEq: eq,
      headline, rampGap, rampGapShare, raiseAnnual, raiseVsTag: safeDiv(headline, raiseAnnual),
      hiresPerYear, shortenGainAnnual,
      hitGate5: rampGapShare != null && rampGapShare > SK.getCoef('liuren.rampGapShareRedline'),
      items,
    };
  }

  // ---- 3.7 M16.8 依赖度雷达 ----
  function calcDependency(db) {
    const sz = SK.X('suanzhang');
    if (!sz || !sz.perPerson) return { value: null };
    const rows = Object.entries(sz.perPerson).map(([id, v]) => ({ id, collected: v.collected6m || 0, leadIndex: v.leadIndex }));
    const total = rows.reduce((s2, r) => s2 + r.collected, 0);
    if (total === 0) return { value: null };
    rows.sort((a, b) => b.collected - a.collected);
    const top = rows[0], p = SK.personById(top.id), c = SK.getCoef('liuren.dependency');
    const ratio = safeDiv(top.collected, total);
    return {
      value: ratio, topName: p ? p.name : top.id, topLeadIndex: top.leadIndex,
      band: ratio >= c.danger ? 'danger' : ratio >= c.warn ? 'warning' : 'success',
      selfMade: top.leadIndex > 1.5,
    };
  }

  // ---- 3.7 M16.3 该谈名单（周年 / 剪刀差 / 榜眼） ----
  function secondPlace(pp, band, months) {
    if (!pp) return { hit: false };
    const [lo, hi] = band || SK.getCoef('liuren.secondPlaceRankBand');
    const n = months || SK.getCoef('liuren.secondPlaceMonths');
    const recent = (pp.normRankMonths || []).slice(-n);
    const bandOk = recent.length >= n && recent.every(r => r >= lo && r <= hi);
    const zeroSpecial = (pp.specialPayout12m || 0) === 0;
    const scissorsPos = (pp.scissors || 0) > 0;
    return { hit: bandOk && (scissorsPos || zeroSpecial), months: recent.length, rank: recent[recent.length - 1], scissors: pp.scissors, zeroSpecial };
  }
  function anniversaryInDays(hireDate, today) {
    if (!hireDate) return null;
    const y = +today.slice(0, 4), md = hireDate.slice(5);
    let next = `${y}-${md}`;
    let dd = SK.diffDays(today, next);
    if (dd < 0) { next = `${y + 1}-${md}`; dd = SK.diffDays(today, next); }
    return dd;
  }
  function talkList(db, today) {
    const sz = SK.X('suanzhang'), out = [];
    for (const s2 of db.people) {
      if (!s2.isActive || s2.positionType !== 'sales') continue;
      const triggers = [];
      const anni = anniversaryInDays(s2.hireDate, today);
      if (anni != null && anni >= 0 && anni <= 14) triggers.push({ src: 'anniversary', label: '周年档', detail: `${anni} 天后周年` });
      const pp = sz && sz.perPerson ? sz.perPerson[s2.spId] : null;
      if (pp && pp.scissors >= SK.getCoef('suanzhang.scissorsAlert') && pp.marketGap > 0) triggers.push({ src: 'scissors', label: '剪刀差档', detail: `剪刀差 ${fmt.pct(pp.scissors)}` });
      const sp = secondPlace(pp);
      if (sp.hit) triggers.push({ src: 'second_place', label: '榜眼档', detail: `连续 ${sp.months} 月第 ${sp.rank}`, sp });
      if (triggers.length) out.push({ spId: s2.spId, name: s2.name, triggers, pp });
    }
    return out;
  }

  // ---- 3.8 M37 参照点账本（发放预检） ----
  function precheckPure(hist, growth, plannedAmt, refRound) {
    if (hist == null) return { hist: null, growth, trend: null, verdict: null, plannedAmt };
    const g = growth == null ? 0 : growth;
    const trend = Math.round(hist * (1 + g) / refRound) * refRound;
    const verdict = plannedAmt < hist ? 'below_history' : plannedAmt < trend ? 'below_trend' : 'ok';
    return { hist, growth, trend, verdict, plannedAmt };
  }
  function precheckLive(db, spId, plannedAmt, today) {
    const lastYear = String(+today.slice(0, 4) - 1);
    const hist = db.payouts
      .filter(x => x.employeeId === spId && (x.type === 'year_end_bonus' || x.type === 'dividend') && x.period && x.period.startsWith(lastYear))
      .reduce((s2, x) => s2 + x.amount, 0) || null;
    const sz = SK.X('suanzhang');
    const pp = sz && sz.perPerson ? sz.perPerson[spId] : null;
    return precheckPure(hist, pp && pp.contribGrowth != null ? pp.contribGrowth : null, plannedAmt, SK.getCoef('liuren.refRound'));
  }

  // ---- 3.9 M38 余震与交接 ----
  function handoverSummary(cards, lossRate, savableShare) {
    const lr = lossRate != null ? lossRate : SK.getCoef('liuren.handoverLossRate');
    const sv = savableShare != null ? savableShare : SK.getCoef('liuren.handoverSavableShare');
    const sum = cards.reduce((s2, c) => s2 + (c.amountAmt || 0), 0);
    const loss = Math.round(sum * lr);
    return { count: cards.length, sum, loss, save: Math.round(loss * sv) };
  }
  function aftershockRank(db, leaverId) {
    const sz = SK.X('suanzhang');
    const leaver = db.people.find(p => p.spId === leaverId);
    const rows = [];
    for (const s2 of db.people) {
      if (!s2.isActive || s2.spId === leaverId) continue;
      const pp = sz && sz.perPerson ? sz.perPerson[s2.spId] : null; if (!pp) continue;
      let score = 0; const sig = [];
      if (pp.scissors > 0) { score++; sig.push('剪刀差>0'); }
      if (pp.marketGap > 0) { score++; sig.push('市价差>0'); }
      if (leaver && (s2.cityTier === leaver.cityTier || (!!s2.hireBatchId && s2.hireBatchId === leaver.hireBatchId))) { score++; sig.push('同辖区/批次'); }
      rows.push({ spId: s2.spId, name: s2.name, score, sig });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 3);
  }

  // ---- 3.3 M30 异议 pending>7 天 → 关联负面标记自动失效（render 时惰性 sweep） ----
  function sweepObjections(db, today) {
    let flipped = 0;
    for (const o of (db.objections || [])) {
      if (o.status === 'pending' && o.markActive !== false && o.createdAt && SK.diffDays(o.createdAt, today) > 7) { o.markActive = false; flipped++; }
    }
    return flipped;
  }

  // ---- 3.6 闸③ 挤出对冲（与原版三态逐字同源） ----
  const isResultTrigger = t => t === 'record_break' || t === 'sprint' || t === 'backlog_clear';
  const isExempt = t => t === 'first_deal' || t === 'hire';
  function bountySaveCheck(t, silentTrackOn) {
    if (isExempt(t)) return { ok: true, reason: 'exempt' };
    if (isResultTrigger(t) && !silentTrackOn) return { ok: false, reason: 'need_silent_track', script: 'L-15', showEnable: true };
    return { ok: true, reason: 'ok' };
  }
  // ---- 闸⑨ 黑暗三角崩塌 [10,18] ----
  function collapseHit(monthsIn, mom3Chg) {
    if (mom3Chg == null) return null;
    const [lo, hi] = SK.getCoef('liuren.collapseMonthIn');
    return monthsIn >= lo && monthsIn <= hi && mom3Chg < -0.40;
  }
  // ---- 3.10 MC 监督成本发包指数 ----
  function mcCalc(dvi, cityTier, c) {
    c = c || SK.getCoef('liuren.mc');
    if (dvi == null) return { value: null };
    const geo = cityTier === 'tier1' ? 0 : cityTier === 'tier2' ? 1 : 2;
    const w = c.w;
    const mc = w[0] * (1 - dvi / 100) + w[1] * (geo / 3) + w[2] * 0.5 + w[3] * 0.3;
    const v = Math.round(mc);
    return { value: v, band: v > c.bands[1] ? 'success' : v < c.bands[0] ? 'danger' : 'warning' };
  }

  // ---- 3.10 M17 分红：三重闸（资格门）⇄ 四问（体检）串联；体检永不清零池 ----
  function computeDividend(db) {
    const g = db.dividend.gates;
    const gates = [['companyCollect', '公司回款'], ['companyNet', '公司净贡献'], ['personalCollect', '个人回款']]
      .map(([k, label]) => ({ key: k, label, enabled: g[k].enabled, pass: g[k].pass }));
    const threeGatePass = gates.filter(x => x.enabled).every(x => x.pass);
    const sz = SK.X('suanzhang');
    const manual = !!db.dividend.netManualOn;
    const base = manual ? (db.dividend.netManualAmt != null ? db.dividend.netManualAmt : null)
      : (sz && sz.netContributionAmt != null ? sz.netContributionAmt : null);
    const res = { gates, threeGatePass, base, baseSource: manual ? 'manual' : (base != null ? 'suanzhang' : null), pool: null, fourQuestionsRun: false, four: null, fails: null, verdict: null };
    if (!threeGatePass) { res.pool = 0; res.verdict = 'no_eligibility'; return res; }   // 池=0，流程终止，四问零调用
    res.pool = base != null ? Math.round(base * db.dividend.poolRate) : null;
    res.fourQuestionsRun = true;
    const ind = liveIndices(db);
    const dj = SK.X('dingjia'), yr = SK.X('yuren');
    const ghi = dj && dj.goodHireIndex != null ? dj.goodHireIndex : null;
    const dose = yr && yr.coachingDoseActual != null ? yr.coachingDoseActual : null;
    res.four = [
      { q: 'Q1 好招指数≥1.0', pass: ghi != null ? ghi >= 1.0 : null, val: ghi != null ? fmt.num(ghi, 2) : null, src: '定价器实时' },
      { q: 'Q2 EI≥30', pass: ind.ei >= 30, val: String(ind.ei), src: '本板块实时' },
      { q: 'Q3 SII≤60', pass: ind.sii <= 60, val: String(ind.sii), src: '本板块实时' },
      { q: 'Q4 辅导剂量≥3h/月人', pass: dose == null ? null : dose >= 3, val: dose != null ? fmt.num(dose, 1) + 'h' : null, src: '育人器实时' },
    ];
    res.fails = res.four.filter(x => x.pass === false).length;
    res.verdict = res.fails >= 2 ? 'danger' : res.fails === 1 ? 'warning' : 'ok';
    return res;
  }

  /* ================= summary（X 契约；轻量，不调 SK.X 防环） ================= */
  SK.summary.liuren = (db, today) => {
    const head = activeHead(db), covs = db.covenants || [];
    const sii = calcSII(db.governance.sii, head);
    const ei = calcEI(db.governance.ei, head, covConfirmRatio(covs));
    const ahc = calcAHC(db.governance.ahcInputs, covs);
    const m28ByMaster = {};
    for (const a of db.m28Agreements) (m28ByMaster[a.masterId] = m28ByMaster[a.masterId] || []).push(a);
    const salesN = db.people.filter(p => p.isActive && p.positionType === 'sales').length;
    const ptc = calcPriceTag(db, today);
    return {
      ahc, sii, ei, m28ByMaster,
      m28CoverageRate: safeDiv(Object.keys(m28ByMaster).length, salesN),
      irrevocableAny: db.m28Agreements.some(a => a.irrevocable),
      priceTagHeadline: ptc ? ptc.headline : null,
    };
  };

  /* ================= 公共 UI 片段 ================= */
  function m21Banner() {
    const sz = SK.X('suanzhang');
    if (sz && sz.m21Done) return '';
    return h.banner(`<b>闸① 地盘前置（一体版不锁功能，仅引导）</b>：${esc(S.L05())}
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${h.btn('去算账器完成地盘审计（M21 归一化）', 'ui.nav', { cls: 'pri sm', data: 'data-board="suanzhang"' })}
      <span class="hint">数据未就绪的板块本页以「—」显示，功能不锁。</span></div>`, 'a');
  }
  const salesOpts = () => SK.activeSales().map(s2 => ({ v: s2.spId, t: s2.name }));
  const spSelectRaw = (id, sel) => `<select id="${id}">${SK.activeSales().map(s2 => `<option value="${s2.spId}" ${s2.spId === sel ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}</select>`;
  const BORDER = `<div class="callout">⚠️ 系统边界：这个系统不会让一个卖不动的产品卖动。如果你的产品本身有问题——先去改产品。</div>`;

  /* ================= 模块注册 ================= */
  SK.registerModule({
    id: 'liuren', title: '留人', icon: '🛡️', order: 6,
    subnav: [
      { id: 'overview', label: '治理体检' }, { id: 'gates', label: '十二道闸' },
      { id: 'pricetag', label: '流失价签' }, { id: 'retention', label: '该谈·预检·离职' },
      { id: 'm28', label: '产权 M28' }, { id: 'dividend', label: '蓝图与分红' },
      { id: 'sales', label: '钱途页(销售端)' },
    ],
    liveCells() {
      const ind = liveIndices(SK.DB);
      const pt = calcPriceTag(SK.DB, SK.today());
      return [
        { k: 'AHC 信用分', v: String(ind.ahc), tone: ind.ahc < 60 ? 'red' : ind.ahc < 80 ? 'amber' : 'green', board: 'liuren', sub: 'overview', tip: '老板履约信用 · 全员可见 · 计算得出改不了' },
        { k: '流失价签', v: pt ? fmt.wan(pt.headline) : DASH, tone: 'red', board: 'liuren', sub: 'pricetag', tip: pt ? `${pt.name} 若今天离职的完全成本` : '需员工与成交数据' },
      ];
    },
    alerts() { return this.alertList().filter(a => a.tone === 'r').length; },
    alertList() {
      const db = SK.DB, out = [], ind = liveIndices(db);
      if (ind.ahc < SK.getCoef('shared.ahcTrustLine')) out.push({ tone: 'r', text: `老板信用 AHC ${ind.ahc} < 60——承诺不可信，分红/产权都打折`, board: 'liuren', sub: 'overview' });
      if (ind.sii > 60) out.push({ tone: 'r', text: `监督指数 SII ${ind.sii} > 60——你在为不信任付双份钱`, board: 'liuren', sub: 'overview' });
      if (ind.ei < 30) out.push({ tone: 'a', text: `授权指数 EI ${ind.ei} < 30——没人敢说话`, board: 'liuren', sub: 'overview' });
      const talks = talkList(db, SK.today());
      if (talks.length) out.push({ tone: 'a', text: `该谈名单 ${talks.length} 人（周年/剪刀差/榜眼触发）`, board: 'liuren', sub: 'retention' });
      if (!(db.objections || []).length && !(db.governance.ei.objectionsRaisedQuarter > 0)) out.push({ tone: 'a', text: '异议提出 0 条——L03：要么没人敢用，要么没人知道有入口', board: 'liuren', sub: 'retention' });
      const dv = computeDividend(db);
      if (dv.verdict === 'danger') out.push({ tone: 'r', text: `分红四问 ${dv.fails} 条不达——发了也白花`, board: 'liuren', sub: 'dividend' });
      return out;
    },
    render(sub) {
      if (sweepObjections(SK.DB, SK.today()) > 0) SK.persist();   // M30 惰性 sweep
      switch (sub) {
        case 'gates': return vGates();
        case 'pricetag': return vPricetag();
        case 'retention': return vRetention();
        case 'm28': return vM28();
        case 'dividend': return vDividend();
        case 'sales': return vSales();
        default: return vOverview();
      }
    },
  });

  /* ================= 屏1 治理体检 ================= */
  function vOverview() {
    const db = SK.DB, ind = liveIndices(db);
    const dev = calcDeviation(db.governance.selfRating, { sii: ind.sii, ei: ind.ei, dvi: ind.dvi, ahc: ind.ahc });
    const kpi = (label, v, band, hint, extra, ratio, bands) => h.card('', `
      <div class="hint">${label}</div>
      <div style="display:flex;align-items:baseline;gap:8px"><div class="hero sm ${heroTone(band)}">${v == null ? DASH : v}</div>${v == null ? '' : h.badge(bandWord(band), toneOf(band))}</div>
      ${h.meter(ratio, meterTone(band), bands)}
      <div class="hint" style="margin-top:5px">${hint}</div>${extra || ''}`);
    const cards =
      kpi('监督 SII', ind.sii, ind.siiBand, '越低越好 · 带 [30/60]', '', ind.sii / 100, [0.3, 0.6]) +
      kpi('授权 EI', ind.ei, ind.eiBand, '越高越好 · 带 [30/60] · 双通道/合约确认实时计入', '', ind.ei / 100, [0.3, 0.6]) +
      kpi(`可见 DVI ${h.linked('算账器实时')}`, ind.dvi, ind.dviBand, ind.dvi == null ? '— 需算账器数据（去补录成交/线索）' : '数据可见性 · 算账器口径直取', '', (ind.dvi || 0) / 100, [0.3, 0.6]) +
      kpi('信用 AHC', ind.ahc, ind.ahcBand, '全员可见 · 及格线 60', `<div style="margin-top:5px">${h.badge('🔒 计算得出 · 老板改不了', 'n', true)}</div>`, ind.ahc / 100, [0.6, 0.8]);
    const devRows = dev.rows.map(r => `<div class="kv"><span class="k">${r.label}</span><b>自评 ${r.self} · 实测 ${r.actual} · 偏差 <span class="${r.gap > 40 ? 'hero' : ''}" style="font-size:inherit;color:var(--${r.gap > 40 ? 'red-hero' : r.gap > 20 ? 'amber' : 'green'})">${r.gap}</span></b></div>`).join('');
    const sr = db.governance.selfRating;
    const sliders = [['sii', '监督 SII'], ['ei', '授权 EI'], ['dvi', '可见 DVI'], ['ahc', '信用 AHC']]
      .map(([k, t]) => h.field(`自评 · ${t}`, h.range('governance.selfRating.' + k, sr[k], 0, 100, 1))).join('');
    // 修复清单（按 ROI；行动卡永不自动执行）
    const fixes = [];
    if (ind.ei < 30) fixes.push(h.action('开启异议与建议双通道', '授权分 EI 过低 → 没人敢说话。开双通道，让异议进得来。' + h.src('Doucouliagos et al. 2020 元回归：分红需与授权组合才有效。'), 'r', h.btn('去钱途页看双入口', 'ui.nav', { cls: 'sm', data: 'data-board="liuren" data-sub="sales"' })));
    if (ind.sii > 60) fixes.push(h.action('关闭事事审批', '监督分 SII 偏高 → 你在为不信任付双份钱。' + h.src('Org Sci 2016：高压监督挤出骨干努力。'), 'a', h.btn('改治理输入', 'ui.nav', { cls: 'sm', data: 'data-board="liuren" data-sub="overview"' })));
    if (ind.ahc < 60) fixes.push(h.action('兑现欠着的承诺 + 给 M28 加 irrevocable', '信用分 AHC 过低 → 销冠不信你，配方是他唯一筹码。' + h.src('Hart 2016 诺奖：控制权决定专用投入。'), 'r', h.btn('去产权 M28', 'ui.nav', { cls: 'sm', data: 'data-board="liuren" data-sub="m28"' })));
    if (!fixes.length) fixes.push(h.action('四指数健康', '当前无高优先级修复项。保持。', 'g', ''));
    // 治理输入（SII/EI/AHC 原始输入，data-bind 改动即全站重算）
    const g = db.governance;
    const ck = (path, v, label) => `<label style="display:flex;gap:7px;align-items:center;font-size:12.5px"><input type="checkbox" data-bind="${path}" data-type="bool" ${v ? 'checked' : ''}>${label}</label>`;
    const govForm = `
      <div class="grid g3">
        <div><b style="font-size:12.5px">监督 SII 输入</b>
          <div class="kv"><span class="k">在职人数 ${h.linked('自动')}</span><b>${ind.head} 人</b></div>
          ${ck('governance.sii.dailyReportOn', g.sii.dailyReportOn, '日报必填')}
          ${ck('governance.sii.rollcallOn', g.sii.rollcallOn, '点名开启')}
          ${h.field('抽检张/周', h.input('governance.sii.spotChecksPerWeek', 'int', { value: g.sii.spotChecksPerWeek }))}
          ${h.field('审批层级', h.input('governance.sii.approvalLevels', 'int', { value: g.sii.approvalLevels }))}
          ${h.field('月总查看次数', h.input('governance.sii.monthlyViewsTotal', 'int', { value: g.sii.monthlyViewsTotal }))}
          ${h.field('处方次数（总）', h.input('governance.sii.rxCountTotal', 'int', { value: g.sii.rxCountTotal }))}
        </div>
        <div><b style="font-size:12.5px">授权 EI 输入</b>
          ${h.field('异议提出（季）', h.input('governance.ei.objectionsRaisedQuarter', 'int', { value: g.ei.objectionsRaisedQuarter }), '销售端「我有异议」自动 +1')}
          ${h.field('建议提出', h.input('governance.ei.suggestionsRaised', 'int', { value: g.ei.suggestionsRaised }))}
          ${h.field('建议采纳', h.input('governance.ei.suggestionsAdopted', 'int', { value: g.ei.suggestionsAdopted }))}
          ${h.field('行动卡忽略率 %', h.input('governance.ei.cardIgnoreRate', 'pct100', { value: Math.round(g.ei.cardIgnoreRate * 1000) / 10, step: 1 }))}
          <div class="kv"><span class="k">合约双确认比例 ${h.linked('自动')}</span><b>${fmt.pct(covConfirmRatio(db.covenants))}</b></div>
        </div>
        <div><b style="font-size:12.5px">信用 AHC 输入（irrevocable 覆盖由前程合约自动算）</b>
          ${h.field('已达成笔数', h.input('governance.ahcInputs.achievedCount', 'int', { value: g.ahcInputs.achievedCount }))}
          ${h.field('已履约笔数', h.input('governance.ahcInputs.honoredCount', 'int', { value: g.ahcInputs.honoredCount }))}
          ${h.field('拦截下调次数', h.input('governance.ahcInputs.interceptCount', 'int', { value: g.ahcInputs.interceptCount }), 'M28 拦截/强行分红留痕自动 +1')}
          ${h.field('棘轮触发次数', h.input('governance.ahcInputs.ratchetCount', 'int', { value: g.ahcInputs.ratchetCount }))}
        </div>
      </div>`;
    // MC 监督成本发包指数
    const mcRows = SK.activeSales().map(p => {
      const mc = mcCalc(ind.dvi, p.cityTier);
      return `<tr><td>${esc(p.name)}</td><td>${SK.CITY_CN[p.cityTier] || p.cityTier}</td>
        <td class="num">${mc.value == null ? DASH : mc.value}</td>
        <td>${mc.value == null ? h.badge('需 DVI', 'n') : mc.band === 'success' ? h.badge('🟢 该发包', 'g') : mc.band === 'danger' ? h.badge('🔴 不宜发包', 'r') : h.badge('🟡 观察', 'a')}</td></tr>`;
    });
    const mcTop = SK.activeSales().map(p => mcCalc(ind.dvi, p.cityTier)).find(m => m.band === 'success');
    return `
      ${m21Banner()}
      <div class="sect"><h2>治理体检 · 四指数</h2><span class="sub">MC=40×(1−DVI/100)+30×geo/3+20×0.5+10×0.3 · 全部实时换算</span></div>
      ${h.banner(esc(S.L01({ sii: ind.sii, ei: ind.ei, ahc: ind.ahc })), ind.ahc < 60 || ind.sii > 60 ? 'r' : 'n')}
      <div class="grid g4" style="margin-top:10px">${cards}</div>
      <div class="grid g2" style="margin-top:12px">
        ${h.card('自评 vs 实测偏差（M29.5 · 先猜后看）', `
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div style="flex:1">${devRows}</div>
            ${h.hero(dev.gap == null ? DASH : dev.gap, '平均偏差（分）', dev.gap != null && dev.gap > 40 ? 'red' : 'amber')}
          </div>
          ${h.src(esc(S.L02({ gap: dev.gap == null ? DASH : dev.gap })))}
          <div class="divider"></div>${sliders}`)}
        ${h.card('修复清单 · 按 ROI <span class="sub">行动卡永不自动执行——由你点击</span>', fixes.join(''))}
      </div>
      ${h.acc('✎ 治理体检输入（改动即全站实时重算）', govForm)}
      ${h.card('MC 监督成本发包指数 <span class="sub">谁的监督成本高到不如发包</span>', h.tbl(
        [{ t: '员工' }, { t: '城市档' }, { t: 'MC', num: 1 }, { t: '判定' }], mcRows,
        { empty: '暂无在职销售' }) +
        (ind.dvi == null ? h.hint('DVI 缺失（需算账器数据）→ MC 全部显示 —') : '') +
        (mcTop ? h.src(esc(S.L13({ mc: mcTop.value }))) : ''))}
      ${BORDER}`;
  }

  /* ================= 屏2 十二道闸（11A + 1B，零 D） ================= */
  function vGates() {
    const db = SK.DB, ind = liveIndices(db), sz = SK.X('suanzhang');
    const pt = calcPriceTag(db, SK.today());
    const a = db.governance.ahcInputs;
    const gate = (n, name, tone, txt, body) => h.card(`闸${n} ${name}`, body, { right: h.badge(txt, tone) });
    // 闸⑦ 实时数：交出物=配方源人数；无补偿=其中无 M28 者；欠账=达成−履约
    const srcIds = db.recipeSource ? (db.recipeSource.sourceIds || []) : [];
    const masters = new Set(db.m28Agreements.map(x => x.masterId));
    const g7n = srcIds.length, g7m = srcIds.filter(id => !masters.has(id)).length, g7k = Math.max(0, a.achievedCount - a.honoredCount);
    // 闸⑨ 实时命中
    const collapseRows = SK.activeSales().map(p => {
      const monthsIn = Math.floor(SK.diffDays(p.hireDate, SK.today()) / 30);
      const pp = sz && sz.perPerson ? sz.perPerson[p.spId] : null;
      const mom3 = pp && pp.growth3m != null ? pp.growth3m : null;
      return { name: p.name, monthsIn, mom3, hit: collapseHit(monthsIn, mom3) };
    }).filter(r => r.hit);
    return `
      ${m21Banner()}
      <div class="sect"><h2>留人十二道闸（11A + 1B，零 D）</h2><span class="sub">结构权=系统 · 数值权=老板 · 全部判定实时</span></div>
      <div class="grid g2">
        ${gate('①', '地盘前置', sz && sz.m21Done ? 'g' : 'a', sz && sz.m21Done ? '已就绪' : '数据未就绪',
          `<p class="hint">${sz && sz.m21Done ? '算账器 M21 归一化已实时可用，排名/淘汰/配方/提拔已具备前提。' : '一体版不锁功能：算账器 M21 未完成前，本板块联动项以「—」显示。'}</p>
          ${sz && sz.m21Done ? '' : `<div style="margin-top:6px">${h.btn('去算账器', 'ui.nav', { cls: 'sm pri', data: 'data-board="suanzhang"' })}</div>`}`)}
        ${gate('②', '排行榜合法性', 'g', '合法',
          `<p class="hint">唯一合法配置：实名 · 只显名次 · 不显金额/配额 · 源＝M21 归一化。</p>
          <div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap">${h.badge('实名', 'n')}${h.badge('仅名次', 'n')}${h.badge('无金额', 'n')}${h.badge('无配额', 'n')}</div>`)}
        ${gate('③', '挤出对冲', db.silentTrackOn ? 'g' : 'a', db.silentTrackOn ? '通道已启' : '通道未启',
          `<p class="hint">悬赏可对结果，但不许只有钱。结果类悬赏需先启用静默认可通道。</p>
          <label style="display:flex;gap:7px;align-items:center;margin:7px 0;font-size:12.5px"><input type="checkbox" data-bind="silentTrackOn" data-type="bool" ${db.silentTrackOn ? 'checked' : ''}>静默认可通道（连续 6 月达标 → 灯塔 + 合约资格池，不发奖、不播报、不排名）</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${h.btn('试挂：破纪录赏', 'lr.bounty-demo', { cls: 'sm', data: 'data-t="record_break"' })}${h.btn('试挂：首单赏（豁免）', 'lr.bounty-demo', { cls: 'sm', data: 'data-t="first_deal"' })}</div>`)}
        ${gate('⑤', '爬坡优先', pt && pt.hitGate5 ? 'r' : 'g', pt && pt.hitGate5 ? '缺口过大' : '正常',
          `<p class="hint">爬坡缺口占流失价签比 ${pt ? fmt.pct(pt.rampGapShare) : DASH}（红线 ${fmt.pct(SK.getCoef('liuren.rampGapShareRedline'), 0)}）。${pt && pt.hitGate5 ? '你该修的是爬坡，不是留人。' : ''}</p>`)}
        ${gate('⑥', '棘轮硬闸', a.ratchetCount > 0 ? 'a' : 'g', `棘轮 ${a.ratchetCount} 次`,
          `<p class="hint">按去年业绩上调配额＝把努力当把柄。触发→[生成反棘轮条款]（irrevocable + AHC 加分）。</p>`)}
        ${gate('⑦', '反敲竹杠', ind.ahc < SK.getCoef('shared.ahcTrustLine') ? 'r' : 'g', `AHC ${ind.ahc}`,
          `<p class="hint">交出物无 M28 协议 / AHC<60 → 红。</p>${ind.ahc < SK.getCoef('shared.ahcTrustLine') ? h.banner(esc(S.L07({ n: g7n, m: g7m, ahc: ind.ahc, k: g7k })), 'r') + `<div style="margin-top:6px">${h.btn('去生成 M28 协议', 'ui.nav', { cls: 'sm pri', data: 'data-board="liuren" data-sub="m28"' })}</div>` : ''}`)}
        ${gate('⑧', '分红四问', 'b', '见分红页',
          `<p class="hint">前置＝M17 三重闸已过；本闸只体检、永不清零池。</p><div style="margin-top:6px">${h.btn('去蓝图与分红', 'ui.nav', { cls: 'sm', data: 'data-board="liuren" data-sub="dividend"' })}</div>`)}
        ${gate('⑨', '黑暗三角崩塌', collapseRows.length ? 'a' : 'n', collapseRows.length ? `命中 ${collapseRows.length} 人` : '窗口 [10,18]',
          `<p class="hint">高标记 ∧ 在职 10–18 月 ∧ 近 3 月环比 &lt;−40% → 🟡「预期中的崩塌」，只输出不建议挽留。</p>
          ${collapseRows.map(r => `<div class="kv"><span class="k">${esc(r.name)} · 在职 ${r.monthsIn} 月</span><b>环比 ${fmt.pct(r.mom3)}</b></div>`).join('')}`)}
        ${gate('⑩', '双目标隔离', 'g', '断言', `<p class="hint">蓝图进度与考核函数零依赖（蓝图里程碑不进任何排名/淘汰/分红判定）。</p>`)}
        ${gate('⑪', '只供氧', 'g', '断言', `<p class="hint">钱途页零排名/零对比/零员工红灯——唯一的红是老板的信用。</p>`)}
        ${gate('⑫', '履约准入', 'g', '枚举锁死', `<p class="hint">仅 bounty/challenge/contract/dividend/带教/使用费 入履约总账。</p>`)}
      </div>
      ${BORDER}`;
  }

  /* ================= 屏3 流失价签（M16.1 权威 6 项） ================= */
  function vPricetag() {
    const db = SK.DB, pt = calcPriceTag(db, SK.today());
    const zr = SK.X('zhaoren');
    if (!pt) return `${m21Banner()}<div class="sect"><h2>流失价签</h2></div>${h.banner('暂无在职销售或月毛利不可算——先到「数据中心 · 员工档案」录入员工与成交。', 'a')}${BORDER}`;
    const p = db.priceTag;
    const rows = pt.items.map(it => `<tr><td>${it.name}</td><td class="num mono">${it.amt == null ? DASH : fmt.wan(it.amt)}</td><td class="hint">${esc(it.scope)}</td></tr>`);
    const form = `<div class="grid g3">
      ${h.field('对象员工', h.select('priceTag.spId', salesOpts(), pt.spId))}
      ${h.field('招聘周期（月）', h.input('priceTag.hireMonths', 'num', { value: pt.hireMonths, step: 0.1 }))}
      ${h.field('批均回本（月）', h.input('priceTag.paybackMonths', 'num', { value: pt.paybackMonths, step: 0.1 }), '默认 6；招人器回本口径')}
      ${h.field('拟加薪（元/月）', h.input('priceTag.raiseMonthlyAmt', 'fen-yuan', { value: Math.round((p.raiseMonthlyAmt || 0) / 100) }))}
      ${h.field('缩短爬坡比例 %', h.input('priceTag.shortenPct', 'pct100', { value: Math.round((p.shortenPct || 0) * 100), step: 1 }))}
      <div>${h.field(`年招聘量 ${h.linked()}`, `<b>${fmt.num(pt.hiresPerYear, 2)} 人/年</b>`, `在职销售 ${SK.activeSales().length} 人 × 年流失率 ${fmt.pct(db.company.attritionRate, 0)}（实时）`)}</div>
    </div>`;
    return `
      ${m21Banner()}
      <div class="sect"><h2>流失价签 · 权威 6 项口径</h2><span class="sub">第⑤⑥项互不重叠、不得双计同一笔 · 全部实时换算</span></div>
      <div class="grid g2">
        ${h.card(`${esc(pt.name)} · 若今天离职`, `
          ${h.hero(fmt.wan(pt.headline), `权威估算＝月毛利 ${fmt.wan(pt.gm)} ×（招聘 ${fmt.num(pt.hireMonths, 1)} 月 + 回本 ${fmt.num(pt.paybackMonths, 1)} 月）`, 'red')}
          <div class="hint" style="margin:4px 0 8px">月毛利口径：${pt.gmSource === 'deals' ? `近 6 个月 won 成交毛利月均 ${h.linked('实时')}` : '⚠ 近 6 月无成交——回退公司人均口径（去年人均毛利 ÷12）'}</div>
          ${h.tbl([{ t: '构成项' }, { t: '金额', num: 1 }, { t: '口径' }], rows)}
          ${h.hint('六项为诊断口径，与总额估算法互为参照。')}`)}
        ${h.card('关键比值', `
          <div class="kv"><span class="k">爬坡缺口占比</span><b class="${pt.hitGate5 ? 'hero' : ''}" style="font-size:inherit;color:var(--${pt.hitGate5 ? 'red-hero' : 'green'})">${fmt.pct(pt.rampGapShare)}</b></div>
          ${pt.hitGate5 ? `<div style="margin:2px 0 6px">${h.badge('触闸⑤', 'r')}</div>` : ''}
          <div class="kv"><span class="k">加薪 vs 价签</span><b>${fmt.x(pt.raiseVsTag)}</b></div>
          <div class="kv"><span class="k">缩短爬坡 ${fmt.pct(p.shortenPct, 0)} 年化收益</span><b>${fmt.wan(pt.shortenGainAnnual)}</b></div>
          <div class="kv"><span class="k">爬坡月当量 ${h.linked()}</span><b>${fmt.num(pt.rampGapMonthsEq, 2)} 月（${SK.CYCLE_CN[db.company.cycleTier] || ''} S 曲线实时）</b></div>
          <div class="kv"><span class="k">招人器简版价签（3 项）${h.linked()}</span><b>${zr && zr.tagAmt != null ? fmt.wan(zr.tagAmt) : DASH}</b></div>
          ${h.hint('简版为招人器 3 项口径，与本 6 项权威口径不并列比较。')}
          ${pt.hitGate5 ? h.action('你该修的是爬坡，不是留人', '爬坡缺口占了流失成本的大头（>45%）。加薪留人是把钱浇在漏桶上。' + h.src('HBR/RAIN：接手他人管道成交率低 30–50%。'), 'r', h.btn('去育人器看带教配速', 'ui.nav', { cls: 'sm', data: 'data-board="yuren"' })) : ''}`)}
      </div>
      ${h.card('✎ 价签输入', form)}
      ${BORDER}`;
  }

  /* ================= 屏4 该谈 · 预检 · 离职 ================= */
  function vRetention() {
    const db = SK.DB, today = SK.today();
    const talks = talkList(db, today), dep = calcDependency(db);
    const talkRows = talks.map(t => `<tr><td><b>${esc(t.name)}</b></td>
      <td>${t.triggers.map(g => h.badge(g.label, g.src === 'second_place' ? 'gold' : 'a')).join(' ')}</td>
      <td class="hint">${t.triggers.map(g => esc(g.detail)).join('；')}</td></tr>`);
    const by = talks.find(t => t.triggers.some(g => g.src === 'second_place'));
    const bySp = by ? by.triggers.find(g => g.src === 'second_place').sp : null;
    const leavers = db.people.filter(p => !p.isActive);
    const covs = db.covenants || [];
    const objs = db.objections || [], sugs = db.suggestions || [];
    const OBJ_CN = { bad_debt: '坏账标记', stop_bleed: '止血候选', cull_suggest: '汰评估', rank_bottom: '排行末位', other: '其他' };
    const objRows = objs.length ? objs.map(o => `<div class="kv"><span class="k">异议 · ${OBJ_CN[o.reason] || esc(o.reason)} · ${esc(o.createdAt)}${o.status === 'pending' && o.markActive === false ? ' <span style="color:var(--amber)">(>7天，关联标记已自动失效)</span>' : ''}</span>
      <b>${o.status === 'pending'
        ? `${h.btn('采纳', 'lr.obj-resolve', { cls: 'sm', data: `data-id="${o.objId}" data-r="accepted"` })} ${h.btn('维持', 'lr.obj-resolve', { cls: 'sm ghost', data: `data-id="${o.objId}" data-r="upheld"` })}`
        : h.badge(o.status === 'accepted' ? '已采纳' : '维持原判', o.status === 'accepted' ? 'g' : 'n')}</b></div>`).join('') : '<div class="hint">暂无异议。</div>';
    const sugRows = sugs.length ? sugs.map(s2 => `<div class="kv"><span class="k">建议 · ${esc((s2.content || '').slice(0, 20))}${s2.employeeId ? '' : '（匿名）'}</span>
      <b>${s2.status === 'pending'
        ? `${h.btn('采纳', 'lr.sug-resolve', { cls: 'sm', data: `data-id="${s2.sugId}" data-r="adopted"` })} ${h.btn('忽略', 'lr.sug-resolve', { cls: 'sm ghost', data: `data-id="${s2.sugId}" data-r="ignored"` })}`
        : h.badge(s2.status === 'adopted' ? '已采纳' : '已忽略', s2.status === 'adopted' ? 'g' : 'n')}</b></div>`).join('') : '<div class="hint">暂无建议。</div>';
    return `
      ${m21Banner()}
      <div class="sect"><h2>留存运营 · 该谈 / 预检 / 离职</h2><span class="sub">系统永不指导「谈什么」，只告诉你「该谈谁」</span></div>
      <div class="grid g2">
        ${h.card('该谈名单 · 三触发源（M16.3）<span class="sub">周年 0–14 天 / 剪刀差≥30%∧市价差>0 / 榜眼</span>', h.tbl(
          [{ t: '员工' }, { t: '触发' }, { t: '理由' }], talkRows, { empty: SK.X('suanzhang') ? '当前无触发。' : '— 需算账器数据（剪刀差/榜眼档不可算，仅周年档生效）' }) +
          (by && bySp ? h.action(`榜眼预警：${esc(by.name)}`, esc(S.L09({ name: by.name, m: bySp.months, r: bySp.rank, sc: fmt.pct(bySp.scissors) })) + h.src('Ahearne 2025 JM：中上段是流失与被挖高危带。'), 'a',
            h.btn('生成单独承诺（前程合约）', 'lr.cov-add', { cls: 'sm pri', data: `data-sp="${by.spId}"` })) : ''))}
        ${h.card('依赖度雷达（M16.8）', dep.value == null
          ? h.hint('— 需算账器滚 6 月回款数据。') + `<div style="margin-top:6px">${h.btn('去算账器', 'ui.nav', { cls: 'sm', data: 'data-board="suanzhang"' })}</div>`
          : `${h.hero(fmt.pct(dep.value), `Top1（${esc(dep.topName)}）回款占比（滚 6 月，归一化后）${h.linked('算账器实时')}`, heroTone(dep.band))}
            <div style="margin:4px 0">${h.badge(bandWord(dep.band), toneOf(dep.band))} <span class="hint">≥60% 危险 / ≥40% 警戒</span></div>
            ${dep.selfMade ? h.banner('⚠️ 依赖度一部分是你自己造出来的——Top1 线索指数 >1.5（他吃的地盘就大）。', 'a') : ''}
            ${h.hint('传承预案四行：配方在库 / 蓄水池储备 / 徒弟名单 / M28 有无。')}`)}
      </div>
      <div class="grid g2" style="margin-top:12px">
        ${h.card('发放预检（M37 参照点账本）<span class="sub">发钱前预检：拟发 vs 历史/趋势参照点</span>', `
          ${h.field('员工', spSelectRaw('lr-pc-sp', db.priceTag.spId))}
          ${h.field('拟发金额（元）', `<input id="lr-pc-amt" type="number" value="30000" placeholder="如 30000">`)}
          ${h.btn('预检', 'lr.precheck', { cls: 'pri' })}
          <div id="lr-pc-out" style="margin-top:10px"></div>`)}
        ${h.card('离职余震与交接（M38）<span class="sub">离职登记在数据中心；这里做余震名单 + 交接卡</span>', (leavers.length
          ? leavers.map(p => `<div class="kv"><span class="k">${esc(p.name)} · ${esc(p.leaveDate || '')}（${esc(p.leaveReason || '原因未记录')}）</span><b>${h.btn('启动向导', 'lr.leave-wizard', { cls: 'sm pri', data: `data-id="${p.spId}"` })}</b></div>`).join('')
          : '<div class="hint">暂无离职者。员工离职请先到数据中心登记。</div>') +
          `<div style="margin-top:8px">${h.btn('去数据中心登记离职', 'ui.nav', { cls: 'sm', data: 'data-board="data" data-sub="people"' })}</div>` +
          h.src('中国连锁企业 RCT：指定名单一对一周聊，流失率降 1.7pp。'))}
      </div>
      <div class="grid g2" style="margin-top:12px">
        ${h.card('前程合约（M16.4 · 主管不可见）', (covs.length ? covs.map(c => `<div class="kv"><span class="k">${esc((SK.personById(c.employeeId) || { name: c.employeeId }).name)} · ${esc(c.promiseText || '承诺')}</span>
            <b>${c.bothConfirmed ? h.badge('双方确认', 'g') : h.btn('待确认→确认', 'lr.cov-confirm', { cls: 'sm', data: `data-id="${c.covId}"` })} ${c.irrevocable ? h.badge('🔒 irrevocable', 'gold') : ''}</b></div>`).join('')
          : '<div class="hint">暂无前程合约。为高危/榜眼员工拼装承诺（双确认比例计入 EI，irrevocable 覆盖计入 AHC）。</div>') +
          `<div style="margin-top:8px">${h.btn('＋ 新建合约', 'lr.cov-add', { cls: 'pri sm' })}</div>`)}
        ${h.card('M30 双通道 · 异议与建议 <span class="sub">pending>7 天自动失效关联负面标记 · 永不进考核路径</span>',
          objRows + '<div class="divider"></div>' + sugRows +
          (objs.length === 0 ? h.banner(esc(S.L03()), 'a') : ''))}
      </div>
      ${BORDER}`;
  }

  /* ================= 屏5 产权 M28 ================= */
  function vM28() {
    const db = SK.DB;
    const rows = db.m28Agreements.map(a => {
      const val = m28Value(a), master = SK.personById(a.masterId);
      return `<tr><td><b>${esc(master ? master.name : a.masterId)}</b></td>
        <td>${a.kind === 'mentoring' ? '带教分成' : '配方使用费'}</td>
        <td class="num mono">${fmt.pct(a.rate, 0)}</td><td class="num">${a.durationMonths} 月</td>
        <td class="num mono">${fmt.wan(val, 2)}</td>
        <td>${a.irrevocable ? h.badge('🔒 irrevocable', 'gold') : h.badge('可改', 'n')}</td>
        <td>${a.irrevocable ? h.btn('尝试下调', 'lr.try-down', { cls: 'sm danger', data: `data-id="${a.m28Id}"` }) : DASH}</td></tr>`;
    });
    const ovr = db.overrideEvents.slice(-6).reverse().map(o => `<div class="kv"><span class="k">${esc(o.at)} · ${esc(o.action)}${o.note ? ' · ' + esc(o.note) : ''}</span><b style="color:var(--red-hero)">已拦截/留痕 · 全员可见</b></div>`).join('') || '<div class="hint">暂无拦截记录。</div>';
    const men = db.m28Agreements.find(a => a.kind === 'mentoring');
    const menVal = men ? m28Value(men) : null;
    const oneOff = SK.getCoef('liuren.m28').oneOffAmt;
    return `
      ${m21Banner()}
      <div class="sect"><h2>产权 M28 · 配方产权与带教对价</h2><span class="sub">带教＝徒弟月净贡献×5%×12月 · 使用费＝团队月增量×2%×24月 · irrevocable 下调在代码层无成功路径</span></div>
      ${h.card('协议表', h.tbl([{ t: '师傅' }, { t: '类型' }, { t: '费率', num: 1 }, { t: '时长', num: 1 }, { t: '对价', num: 1 }, { t: '状态' }, { t: '拦截演示' }], rows,
        { empty: '暂无 M28 协议——销冠交配方前，先给他产权。' }) +
        `<div style="margin-top:8px">${h.btn('＋ 新建协议', 'lr.m28-add', { cls: 'pri' })}</div>`)}
      <div class="grid g2" style="margin-top:12px">
        ${h.card('拦截记录（G3 留痕 · 全员可见）', ovr + h.src('第四定理（Hart，诺奖 2016）：你不给他控制权，他就不会投入你测不到的努力。') +
          h.hint('尝试下调 irrevocable 协议：rate/时长不变，仅产生留痕 + interceptCount+1 → AHC 实时下降——全员可见。'))}
        ${h.card('带教 vs 一次性对比', `
          <div class="kv"><span class="k">带教分成（5%×12月）</span><b>${menVal != null ? fmt.wan(menVal, 2) : DASH}</b></div>
          <div class="kv"><span class="k">一次性奖金</span><b>${fmt.yuan(oneOff)}</b></div>
          <div class="kv total"><span class="k">倍数</span><b>${menVal != null ? fmt.x(menVal / oneOff) : DASH}</b></div>
          ${h.hint('种子算例：5.8万/月 ×5% ×12月 = 3.48 万 ÷ 500 元 = 69.6 倍——产权贵，但一次性买不来专用投入。')}`)}
      </div>
      ${BORDER}`;
  }

  /* ================= 屏6 蓝图与分红 ================= */
  function vDividend() {
    const db = SK.DB, dv = computeDividend(db), ind = liveIndices(db);
    const d = db.dividend, a = db.governance.ahcInputs;
    const gateRows = dv.gates.map(g => `<div class="kv"><span class="k">
        <label style="display:inline-flex;gap:5px;align-items:center"><input type="checkbox" data-bind="dividend.gates.${g.key}.enabled" data-type="bool" ${g.enabled ? 'checked' : ''}>启用</label>
        <label style="display:inline-flex;gap:5px;align-items:center;margin-left:8px"><input type="checkbox" data-bind="dividend.gates.${g.key}.pass" data-type="bool" ${g.pass ? 'checked' : ''}>已达标</label>
        ${g.label}</span>
      <b>${g.enabled ? (g.pass ? h.badge('达', 'g') : h.badge('未达', 'r')) : DASH}</b></div>`).join('');
    let fourHtml;
    if (!dv.threeGatePass) {
      fourHtml = h.banner('<b>未达发放资格，未体检</b>——三重闸任一不达 → 池 = 0，流程终止，四问零调用。', 'r');
    } else {
      const qs = dv.four.map(q => `<div class="kv"><span class="k">${q.q} <span class="hint">${q.src === '本板块实时' ? q.src : h.linked(q.src)}</span></span>
        <b>${q.pass == null ? '—（未就绪）' : q.pass ? h.badge('过', 'g') : h.badge('否', 'r')} <span class="hint">${q.val == null ? '' : q.val}</span></b></div>`).join('');
      fourHtml = qs + h.banner(`${dv.verdict === 'danger' ? '🔴' : dv.verdict === 'warning' ? '🟡' : '🟢'} ${dv.fails} 条不达。${dv.verdict === 'danger' ? esc(S.L08({ period: '季度', rate: fmt.pct(d.poolRate, 0), n: dv.fails })) : dv.verdict === 'warning' ? '一条不达——先修再发更划算。' : '体检通过。'}`, dv.verdict === 'danger' ? 'r' : dv.verdict === 'warning' ? 'a' : 'g') +
        (dv.verdict !== 'ok' ? `<div style="margin-top:7px">${h.btn('我知道风险，仍要启用（留痕，计入 AHC 扣分）', 'lr.force-dividend', { cls: 'danger sm' })}</div>` : '') +
        h.hint('🔴 体检永不清零池——只警告，数值权归老板。');
    }
    return `
      ${m21Banner()}
      <div class="sect"><h2>蓝图与分红 · 创业三级梯</h2><span class="sub">三重闸（发不发·资格门）→ 池 → 四问（该不该发·体检）串联</span></div>
      <div class="grid g2">
        ${h.card(`① 三重闸 · 发不发（资格门） <span class="sub">老板设、独立启停、不达池=0、不重分</span>`, gateRows +
          `<div class="divider"></div>
          <div class="kv"><span class="k">池基数（分红前净贡献）</span><b>${dv.base != null ? fmt.wan(dv.base) : DASH} ${dv.baseSource === 'suanzhang' ? h.linked('算账器净贡献实时') : dv.baseSource === 'manual' ? h.badge('手工覆盖', 'a') : ''}</b></div>
          <label style="display:flex;gap:7px;align-items:center;font-size:12.5px;margin:5px 0"><input type="checkbox" data-bind="dividend.netManualOn" data-type="bool" ${d.netManualOn ? 'checked' : ''}>手工覆盖基数</label>
          ${d.netManualOn ? h.field('手工基数（万）', h.input('dividend.netManualAmt', 'wan', { value: d.netManualAmt != null ? d.netManualAmt / SK.WAN : '', step: 0.1 })) : ''}
          ${h.field('池比例 %', h.input('dividend.poolRate', 'pct100', { value: Math.round(d.poolRate * 100), step: 1 }))}`,
          { right: `<span class="hero sm ${dv.threeGatePass ? 'green' : 'red'}" style="font-size:20px">${dv.threeGatePass ? '✓' : '池 0'}</span>` })}
        ${h.card('② 分红四问 · 该不该发（体检）', fourHtml,
          { right: dv.threeGatePass ? `<span class="hero sm ${dv.verdict === 'danger' ? 'red' : dv.verdict === 'warning' ? 'amber' : 'green'}" style="font-size:20px">${dv.pool != null ? fmt.wan(dv.pool) : DASH}</span>` : '' })}
      </div>
      <div class="grid g2" style="margin-top:12px">
        ${h.card('经营蓝图（与考核隔离 · 闸⑩）', (db.blueprint.milestones.length
          ? db.blueprint.milestones.map(m => `<div class="kv"><span class="k">${m.done ? '✓ ' : ''}${esc(m.name)}</span>
              <b>${h.btn(m.done ? '✓ 已达（点击撤销）' : '标记达成', 'lr.ms-toggle', { cls: 'sm' + (m.done ? '' : ' ghost'), data: `data-id="${m.id}"` })} ${h.btn('✕', 'lr.ms-del', { cls: 'sm ghost', data: `data-id="${m.id}"` })}</b></div>`).join('')
          : '<div class="hint">暂无里程碑。</div>') +
          `<div style="margin-top:8px">${h.btn('＋ 里程碑', 'lr.ms-add', { cls: 'sm pri' })}</div>` +
          h.hint('蓝图进度不被任何考核函数调用（闸⑩）。'))}
        ${h.card('履约总账（双时间戳 · 全员可见）', `
          <div class="kv"><span class="k">履约率（滚 12 月）</span><b>${fmt.pct(safeDiv(a.honoredCount, a.achievedCount))}</b></div>
          <div class="grid g2">
            ${h.field('已达成笔数', h.input('governance.ahcInputs.achievedCount', 'int', { value: a.achievedCount }))}
            ${h.field('已履约笔数', h.input('governance.ahcInputs.honoredCount', 'int', { value: a.honoredCount }))}
          </div>
          <div class="kv"><span class="k">当前 AHC ${h.linked('实时')}</span><b>${ind.ahc}</b></div>
          ${h.hint('赏在明处，催在暗处：未兑现黄脸仅老板自见。')}`)}
      </div>
      ${BORDER}`;
  }

  /* ================= 屏7 钱途页（销售端 · 只供氧：零排名/零对比/零员工红灯） ================= */
  function vSales() {
    const db = SK.DB, ind = liveIndices(db), a = db.governance.ahcInputs;
    const sales = SK.activeSales();
    if (!sales.length) return `${h.banner('暂无在职销售——先到数据中心录入员工。', 'a')}${BORDER}`;
    const spId = db.ui.salesSpId && sales.some(s2 => s2.spId === db.ui.salesSpId) ? db.ui.salesSpId : sales[0].spId;
    const p = SK.personById(spId);
    const myM28 = db.m28Agreements.filter(x => x.masterId === spId);
    const ms6 = new Set(lastMonths(SK.today(), 6));
    let myCollected = 0;
    for (const dl of db.deals) if (dl.employeeId === spId && dl.status === 'won' && dl.paidDate && ms6.has(SK.monthOf(dl.paidDate))) myCollected += dl.paymentAmt;
    const irrRatio = (db.covenants || []).length ? db.covenants.filter(c => c.irrevocable).length / db.covenants.length : 0;
    const ringTone = ind.ahcBand === 'success' ? 'g' : ind.ahcBand === 'warning' ? 'a' : 'r';
    const m28c = SK.getCoef('liuren.m28');
    return `
      ${h.banner('🌱 <b>销售端预览 · 钱途页</b>：只供氧——零排名、零对比、零员工红灯。唯一"红"是⑤栏：老板的信用（放老板的血）。', 'b')}
      <div class="sect"><h2>你的钱途</h2><span class="sub">预览对象：</span>${h.select('ui.salesSpId', salesOpts(), spId)}</div>
      <div class="grid g4">
        ${h.card('', `<div class="hint">① 现在</div><div class="hero sm">${fmt.yuan(p.baseSalaryAmt)}</div><div class="hint">底薪/月 · 本人回款可见（唯一利润豁免）</div>`)}
        ${h.card('', `<div class="hint">② 下一步</div><div class="hero sm">有效档</div><div class="hint">达标即进阶</div>`)}
        ${h.card('', `<div class="hint">③ 台阶</div><div class="hero sm">专家 / 主管</div><div class="hint">双轨可选——天花板>地板</div>`)}
        ${h.card('', `<div class="hint">④ 产权</div>${myM28.length
          ? myM28.map(x => `<div class="kv"><span class="k">${x.kind === 'mentoring' ? '带教分成' : '配方使用费'} ${fmt.pct(x.rate, 0)}×${x.durationMonths}月${x.irrevocable ? ' 🔒' : ''}</span><b>${fmt.wan(m28Value(x), 2)}</b></div>`).join('')
          : `<div class="hero sm">带教 ${fmt.pct(m28c.mentorRate, 0)}×${m28c.mentorDur}月</div><div class="hint">配方使用费 ${fmt.pct(m28c.royaltyRate, 0)}×${m28c.royaltyDur}月（可与老板签 M28）</div>`}`)}
      </div>
      <div class="card" style="margin-top:12px;border-color:var(--${ind.ahcBand === 'danger' ? 'red-hero' : ind.ahcBand === 'warning' ? 'amber' : 'green'})">
        <h3>⑤ 老板的信用（AHC）<span class="sub">ⓘ 这个分数由系统计算，老板改不了</span></h3>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          ${h.ring(ind.ahc, '信用 AHC（及格线 60）', ringTone)}
          <div style="flex:1;min-width:230px">
            <div class="kv"><span class="k">履约率（40 分项）</span><b>${fmt.pct(safeDiv(a.honoredCount, a.achievedCount))}</b></div>
            <div class="kv"><span class="k">irrevocable 覆盖（25 分项）</span><b>${fmt.pct(irrRatio)}</b></div>
            <div class="kv"><span class="k">拦截下调（20 分项）</span><b>${a.interceptCount} 次（全部被系统拦截）</b></div>
            <div class="kv"><span class="k">棘轮触发（15 分项）</span><b>${a.ratchetCount} 次</b></div>
          </div>
        </div>
        <div class="hint" style="margin-top:6px">${ind.ahc >= 80 ? esc(S.L14full({ ahc: ind.ahc, a: a.achievedCount, b: a.honoredCount })) : '信用不能买，只能攒。'}</div>
      </div>
      <div class="grid g2" style="margin-top:12px">
        ${h.card('⑥ 战绩', `<div class="hero sm">${fmt.wan(myCollected)}</div><div class="hint">你近 6 个月的回款（只看自己，不与任何人对比）· 里程碑与灯塔纪录：自动 + 老板手填，修改留痕全员可见。</div>`)}
        ${h.card('⑦ 灯塔 + 双入口', `
          <div style="display:flex;gap:6px;flex-wrap:wrap">${h.btn('我有异议', 'lr.obj-add', { cls: 'pri sm', data: `data-sp="${spId}"` })}${h.btn('我有个建议（可匿名）', 'lr.sug-add', { cls: 'sm', data: `data-sp="${spId}"` })}</div>
          ${h.hint('提出异议永不进考核路径。异议不可匿名；建议可匿名且仍计 EI 分母——提交即实时改 EI。')}`)}
      </div>`;
  }

  /* ================= 动作（lr.*）================= */
  const gv = id => document.getElementById(id);
  const gnum = id => +((gv(id) || {}).value) || 0;
  const gchk = id => !!(gv(id) || {}).checked;
  Object.assign(SK.actions, {
    // ---- 闸③ 悬赏三态演示 ----
    'lr.bounty-demo': d => {
      const chk = bountySaveCheck(d.t, SK.DB.silentTrackOn);
      if (chk.ok) return UI.toast(`🟢 「${d.t}」放行保存${chk.reason === 'exempt' ? '（豁免：首单/入职类）' : ''}`);
      UI.modal(`<h3>闸③ 拦截保存</h3>
        ${h.banner(esc(S.L15({ templateName: d.t })), 'r')}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${h.btn('一键启用静默认可通道', 'lr.enable-silent', { cls: 'pri' })}${h.btn('改用行为类悬赏', 'ui.modal-close')}</div>`);
    },
    'lr.enable-silent': () => { SK.DB.silentTrackOn = true; UI.closeModal(); UI.commit(); UI.toast('已启用静默认可通道（连续 6 月达标 → 灯塔 + 合约资格池）'); },

    // ---- M28：新建 / irrevocable 拦截（无成功路径，唯一出口=留痕→AHC 实时下降） ----
    'lr.m28-add': () => UI.modal(`<h3>新建 M28 协议</h3><div class="frm">
      ${h.field('师傅', spSelectRaw('lr-m-sp', SK.DB.priceTag.spId))}
      ${h.field('类型', `<select id="lr-m-kind"><option value="mentoring">带教分成（默认 5%×12月）</option><option value="royalty">配方使用费（默认 2%×24月）</option></select>`)}
      ${h.field('费率（0–1）', `<input id="lr-m-rate" type="number" step="0.01" placeholder="0.05">`)}
      ${h.field('时长（月）', `<input id="lr-m-dur" type="number" placeholder="12">`)}
      ${h.field('徒弟月净贡献 / 团队月增量（万）', `<input id="lr-m-amt" type="number" step="0.1" placeholder="5.8">`)}
      ${h.field('基准快照（万 · 使用费用，选填）', `<input id="lr-m-base" type="number" step="0.1">`)}
      <label style="display:flex;gap:7px;align-items:center;font-size:12.5px"><input type="checkbox" id="lr-m-irr" checked>irrevocable（只可上调延长；下调无成功路径）</label></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${h.btn('取消', 'ui.modal-close')}${h.btn('保存', 'lr.m28-save', { cls: 'pri' })}</div>`),
    'lr.m28-save': () => {
      const kind = gv('lr-m-kind').value;
      const a = {
        m28Id: SK.uid('m28'), masterId: gv('lr-m-sp').value, kind,
        rate: gnum('lr-m-rate') || (kind === 'mentoring' ? 0.05 : 0.02),
        durationMonths: gnum('lr-m-dur') || (kind === 'mentoring' ? 12 : 24),
        startTrigger: kind === 'mentoring' ? 'apprentice_ramp_done' : 'recipe_live',
        baselineSnapshotAmt: gv('lr-m-base').value ? Math.round(gnum('lr-m-base') * SK.WAN) : null,
        irrevocable: gchk('lr-m-irr'), createdAt: SK.today(),
      };
      if (kind === 'mentoring') a.apprenticeMonthlyNetAmt = Math.round(gnum('lr-m-amt') * SK.WAN);
      else a.teamMonthlyIncrementAmt = Math.round(gnum('lr-m-amt') * SK.WAN);
      SK.DB.m28Agreements.push(a); UI.closeModal(); UI.commit(); UI.toast('协议已创建（对价随净贡献实时换算）');
    },
    'lr.try-down': d => {
      const agr = SK.DB.m28Agreements.find(x => x.m28Id === d.id); if (!agr) return;
      const before = liveAhc();
      // 🔴 L-D1：无论输入如何，rate/duration 不被修改；唯一出口 = 留痕 + interceptCount+1 → AHC 重算下降
      SK.DB.overrideEvents.push({ id: SK.uid('oe'), m28Id: agr.m28Id, at: SK.today(), action: 'try_downgrade', note: '界面尝试下调被拦截', visibleToAll: true });
      SK.DB.governance.ahcInputs.interceptCount += 1;
      const after = liveAhc();
      UI.commit();
      UI.toast(`🔴 下调在代码层无成功路径——已留痕；AHC 已因此 −${before - after} 分（${before}→${after}），全员可见`);
    },

    // ---- 前程合约 ----
    'lr.cov-add': d => UI.modal(`<h3>新建前程合约</h3><div class="frm">
      ${h.field('员工', spSelectRaw('lr-c-sp', d.sp || null))}
      ${h.field('承诺模板', `<select id="lr-c-tpl">
        <option>连续达标→晋升有效档</option><option>连续达标→专家台阶（天花板>地板）</option>
        <option>带出满产新人→带教分成</option><option>关键客户录入→配方使用费</option>
        <option>单独战役→年度分红资格池</option><option value="irr">产权协议（irrevocable 强制）</option></select>`)}
      ${h.field('时长（月）', `<input id="lr-c-dur" type="number" placeholder="12">`)}
      <label style="display:flex;gap:7px;align-items:center;font-size:12.5px"><input type="checkbox" id="lr-c-both">双方已确认</label>
      ${h.hint('🔴 无自由文本条件栏；主管不可见。双确认比例实时计入 EI；irrevocable 覆盖实时计入 AHC。')}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${h.btn('取消', 'ui.modal-close')}${h.btn('保存', 'lr.cov-save', { cls: 'pri' })}</div>`),
    'lr.cov-save': () => {
      const tpl = gv('lr-c-tpl'), isIrr = tpl.value === 'irr';
      SK.DB.covenants.push({
        covId: SK.uid('cov'), employeeId: gv('lr-c-sp').value,
        promiseText: tpl.options[tpl.selectedIndex].text, bothConfirmed: gchk('lr-c-both'),
        irrevocable: isIrr, durationMonths: gnum('lr-c-dur') || 12, createdAt: SK.today(),
      });
      UI.closeModal(); UI.commit(); UI.toast('前程合约已创建（EI/AHC 已实时重算）');
    },
    'lr.cov-confirm': d => { const c = SK.DB.covenants.find(x => x.covId === d.id); if (c) { c.bothConfirmed = true; UI.commit(); UI.toast('已确认双方（EI 合约确认比例已重算）'); } },

    // ---- M37 发放预检（只读预检，不落库不重渲染） ----
    'lr.precheck': () => {
      const spId = gv('lr-pc-sp').value, amt = Math.round(gnum('lr-pc-amt') * 100);
      const pc = precheckLive(SK.DB, spId, amt, SK.today());
      const out = gv('lr-pc-out'); if (!out) return;
      if (pc.hist == null) { out.innerHTML = h.banner('—（首年无参照：去年无 year_end_bonus/dividend 发放记录）仅出提示。', 'b'); return; }
      const map = {
        below_history: ['r', S.L10a({ amt: fmt.yuan(amt), hist: fmt.yuan(pc.hist) })],
        below_trend: ['a', S.L10b({ amt: fmt.yuan(amt), hist: fmt.yuan(pc.hist), trend: fmt.yuan(pc.trend), g: fmt.pct(pc.growth) })],
        ok: ['g', S.L10c({ amt: fmt.yuan(amt), trend: fmt.yuan(pc.trend) })],
      };
      const [tone, msg] = map[pc.verdict];
      out.innerHTML = h.banner(esc(msg), tone) + `<div class="hint" style="margin-top:6px">${esc(S.L10d())}</div>`;
    },

    // ---- M38 离职向导：交接卡录入 → 余震 Top3 + L11/L12 ----
    'lr.leave-wizard': d => {
      const p = SK.personById(d.id); if (!p) return;
      UI.modal(`<h3>离职登记向导（M38）· ${esc(p.name)}</h3>
        ${h.hint('离职已在数据中心登记。这里录入在途单 → 生成具名交接卡（计入其流失价签第⑥项）+ 余震名单。')}
        <div class="frm">
        ${h.field('在途单账面合计（万元）', `<input id="lr-lw-sum" type="number" step="0.1" placeholder="如 96">`)}
        ${h.field('在途单笔数', `<input id="lr-lw-n" type="number" placeholder="如 11">`)}</div>
        <div style="display:flex;gap:8px;margin-top:10px">${h.btn('生成余震名单 + 交接卡', 'lr.leave-run', { cls: 'pri', data: `data-id="${p.spId}"` })}${h.btn('关闭', 'ui.modal-close')}</div>
        <div id="lr-lw-out" style="margin-top:12px"></div>`);
    },
    'lr.leave-run': d => {
      const leaverId = d.id, n = Math.max(1, gnum('lr-lw-n') || 1);
      const sum = Math.round(gnum('lr-lw-sum') * SK.WAN);
      const cards = []; for (let i = 0; i < n; i++) cards.push({ hcId: SK.uid('hc'), leaverId, amountAmt: Math.round(sum / n), assignee: null, createdAt: SK.today() });
      cards[0].amountAmt += sum - cards.reduce((s2, c) => s2 + c.amountAmt, 0);   // 精确凑齐
      SK.DB.handoverCards = SK.DB.handoverCards.filter(c => c.leaverId !== leaverId).concat(cards);
      const hs = handoverSummary(cards);
      const after = aftershockRank(SK.DB, leaverId);
      const leaver = SK.personById(leaverId);
      const list = after.length ? after.map(x => `${x.name}（${x.score}分：${x.sig.join('/') || '—'}）`).join('；') : '—（需算账器人均数据）';
      const out = gv('lr-lw-out');
      if (out) out.innerHTML =
        h.banner(esc(S.L11({ leaver: leaver ? leaver.name : leaverId, list })), 'a') +
        h.banner(esc(S.L12({ n, sum: fmt.wan(sum), loss: fmt.wan(hs.loss), save: fmt.wan(hs.save) })), 'r') +
        `<div class="hint" style="margin-top:6px">已生成 ${hs.count} 张交接卡（指派接手人）；损耗按 40% 折损口径回填该离职者流失价签第⑥项。</div>`;
      UI.commit();
    },

    // ---- M30 双通道（销售端入口 → 实时改 EI） ----
    'lr.obj-add': d => UI.modal(`<h3>我有异议</h3><div class="frm">
      ${h.field('提出人（异议不可匿名）', spSelectRaw('lr-o-sp', d.sp || null))}
      ${h.field('针对的负面判定', `<select id="lr-o-reason"><option value="bad_debt">坏账标记</option><option value="stop_bleed">止血候选</option><option value="cull_suggest">汰评估</option><option value="rank_bottom">排行末位</option><option value="other">其他</option></select>`)}
      ${h.field('说明（选填）', `<textarea id="lr-o-note" rows="2"></textarea>`)}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${h.btn('取消', 'ui.modal-close')}${h.btn('提交（永不进考核路径）', 'lr.obj-save', { cls: 'pri' })}</div>`),
    'lr.obj-save': () => {
      SK.DB.objections.push({ objId: SK.uid('obj'), employeeId: gv('lr-o-sp').value, createdAt: SK.today(), reason: gv('lr-o-reason').value, note: gv('lr-o-note').value || null, status: 'pending', markActive: true, resolvedAt: null });
      SK.DB.governance.ei.objectionsRaisedQuarter += 1;
      UI.closeModal(); UI.commit(); UI.toast('异议已提交（EI 分母 +1，指数已实时重算）');
    },
    'lr.obj-resolve': d => { const o = SK.DB.objections.find(x => x.objId === d.id); if (o) { o.status = d.r; o.resolvedAt = SK.today(); UI.commit(); UI.toast('已处理异议'); } },
    'lr.sug-add': d => UI.modal(`<h3>我有个建议</h3><div class="frm">
      <label style="display:flex;gap:7px;align-items:center;font-size:12.5px"><input type="checkbox" id="lr-s-anon">匿名提交（仍计 EI 分母）</label>
      ${h.field('提出人', spSelectRaw('lr-s-sp', d.sp || null))}
      ${h.field('类别', `<select id="lr-s-cat"><option value="lead_allocation">线索分配</option><option value="comp_plan">薪酬方案</option><option value="product">产品问题</option><option value="process">流程审批</option><option value="training">培训带教</option><option value="other">其他</option></select>`)}
      ${h.field('内容', `<textarea id="lr-s-content" rows="3"></textarea>`)}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${h.btn('取消', 'ui.modal-close')}${h.btn('提交', 'lr.sug-save', { cls: 'pri' })}</div>`),
    'lr.sug-save': () => {
      SK.DB.suggestions.push({ sugId: SK.uid('sug'), employeeId: gchk('lr-s-anon') ? null : gv('lr-s-sp').value, createdAt: SK.today(), category: gv('lr-s-cat').value, content: gv('lr-s-content').value || '（空）', status: 'pending', resolvedAt: null });
      SK.DB.governance.ei.suggestionsRaised += 1;
      UI.closeModal(); UI.commit(); UI.toast('建议已提交（EI 分母 +1）');
    },
    'lr.sug-resolve': d => {
      const s2 = SK.DB.suggestions.find(x => x.sugId === d.id); if (!s2) return;
      s2.status = d.r; s2.resolvedAt = SK.today();
      if (d.r === 'adopted') SK.DB.governance.ei.suggestionsAdopted += 1;
      UI.commit(); UI.toast('已处理建议（采纳率实时计入 EI）');
    },

    // ---- 分红强行启用（留痕；🔧修复原版 bug：原版此处 interceptCount += 0——留痕却不扣分，一体版真扣） ----
    'lr.force-dividend': () => {
      const before = liveAhc();
      SK.DB.overrideEvents.push({ id: SK.uid('oe'), at: SK.today(), action: 'force_dividend_risk_ack', note: '四问不达仍启用分红', visibleToAll: true });
      SK.DB.governance.ahcInputs.interceptCount += 1;   // 🔧 bugfix：原版 += 0
      const after = liveAhc();
      UI.commit();
      UI.toast(`已留痕：我知道风险仍要启用——AHC 已因此 −${before - after} 分（${before}→${after}），全员可见`);
    },

    // ---- 蓝图里程碑 ----
    'lr.ms-add': () => UI.modal(`<h3>添加里程碑</h3>
      ${h.field('里程碑名称', `<input id="lr-bp-name" type="text" placeholder="如：开出华东新品类">`)}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${h.btn('取消', 'ui.modal-close')}${h.btn('添加', 'lr.ms-save', { cls: 'pri' })}</div>`),
    'lr.ms-save': () => {
      const n = (gv('lr-bp-name').value || '').trim();
      if (!n) return UI.toast('请填写名称');
      SK.DB.blueprint.milestones.push({ id: SK.uid('ms'), name: n, done: false });
      UI.closeModal(); UI.commit(); UI.toast('里程碑已添加（与考核零依赖）');
    },
    'lr.ms-toggle': d => { const m = SK.DB.blueprint.milestones.find(x => x.id === d.id); if (m) { m.done = !m.done; UI.commit(); } },
    'lr.ms-del': d => { SK.DB.blueprint.milestones = SK.DB.blueprint.milestones.filter(x => x.id !== d.id); UI.commit(); },
  });

  /* ================= 对拍自检（fixture 纯函数 · 不依赖/不污染 SK.DB） ================= */
  const C_SII = { w: [25, 15, 15, 15, 20, 10], spotCap: 5, approveCap: 3, viewPerCapMonth: 4, rxPerCapMonth: 20, bands: [30, 60] };
  const C_EI = { w: [30, 25, 25, 20], objectionPerCapQuarter: 0.5, bands: [30, 60] };
  const C_AHC = { w: [40, 25, 20, 15], interceptCap: 10, ratchetCap: 3, bands: [60, 80] };
  SK.tests.push(
    {
      id: 'LR-T1', name: 'SII＝73（原版种子输入 · 10 人）',
      fn: () => { const got = calcSII({ dailyReportOn: true, rollcallOn: true, spotChecksPerWeek: 3, approvalLevels: 2, monthlyViewsTotal: 20, rxCountTotal: 80 }, 10, C_SII); return { pass: got === 73, got, want: 73 }; },
    },
    {
      id: 'LR-T2', name: 'EI＝4（异议0/无建议/确认0%/忽略82%）',
      fn: () => { const got = calcEI({ objectionsRaisedQuarter: 0, suggestionsRaised: 0, suggestionsAdopted: 0, cardIgnoreRate: 0.82 }, 10, 0, C_EI); return { pass: got === 4, got, want: 4 }; },
    },
    {
      id: 'LR-T3', name: 'AHC＝41（25/41履约·0 irr·4拦截·2棘轮）',
      fn: () => { const got = calcAHC({ achievedCount: 41, honoredCount: 25, interceptCount: 4, ratchetCount: 2 }, [], C_AHC); return { pass: got === 41, got, want: 41 }; },
    },
    {
      id: 'LR-T4', name: '偏差器＝42（自评40/70/80/85 vs 实测73/4/54/41）',
      fn: () => { const got = calcDeviation({ sii: 40, ei: 70, dvi: 80, ahc: 85 }, { sii: 73, ei: 4, dvi: 54, ahc: 41 }).gap; return { pass: got === 42, got, want: 42 }; },
    },
    {
      id: 'LR-T5', name: 'M28 带教＝3.48万 且 69.6 倍 vs 一次性 500 元',
      fn: () => {
        const v = m28Value({ kind: 'mentoring', apprenticeMonthlyNetAmt: 5800000, rate: 0.05, durationMonths: 12 });
        return { pass: v === 3480000 && Math.abs(v / 50000 - 69.6) < 1e-9, got: `${v}/${v / 50000}倍`, want: '3480000/69.6倍' };
      },
    },
    {
      id: 'LR-T6', name: 'M37 三态：趋势 3.8 万；2.8万🔴/3.0万🟡/3.8万🟢',
      fn: () => {
        const a = precheckPure(3000000, 0.267, 2800000, 10000);
        const b = precheckPure(3000000, 0.267, 3000000, 10000);
        const c = precheckPure(3000000, 0.267, 3800000, 10000);
        const pass = a.trend === 3800000 && a.verdict === 'below_history' && b.verdict === 'below_trend' && c.verdict === 'ok';
        return { pass, got: `${a.trend} ${a.verdict}/${b.verdict}/${c.verdict}`, want: '3800000 below_history/below_trend/ok' };
      },
    },
    {
      id: 'LR-T7', name: 'M38 交接：96 万 → 损耗 38.4 万 / 可救 19.2 万',
      fn: () => {
        const hs = handoverSummary([{ amountAmt: 9600000 }], 0.40, 0.50);
        return { pass: hs.loss === 3840000 && hs.save === 1920000, got: `${hs.loss}/${hs.save}`, want: '3840000/1920000' };
      },
    },
    {
      id: 'LR-T8', name: '榜眼：近3月[2,2,3]∧零特殊→触发；2月不触发',
      fn: () => {
        const a = secondPlace({ normRankMonths: [2, 2, 3], scissors: 0, specialPayout12m: 0 }, [2, 3], 3);
        const b = secondPlace({ normRankMonths: [2, 2], scissors: 0.1, specialPayout12m: 0 }, [2, 3], 3);
        return { pass: a.hit === true && b.hit === false, got: `${a.hit}/${b.hit}`, want: 'true/false' };
      },
    },
    {
      id: 'LR-T9', name: '爬坡月当量：regular 曲线 Σ(1−p)＝5.78 月',
      fn: () => { const got = Math.round(rampGapMonthsEq('regular') * 100) / 100; return { pass: Math.abs(got - 5.78) < 0.005, got, want: 5.78 }; },
    },
  );
})();
