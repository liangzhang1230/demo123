/* ============================================================
   云端 C1 · 5号《销冠育人器》业务引擎（服务端纯函数模块）
   权威口径：《5号育人器 v2.3》件三（唯一权威）＋《0号公约 v1.5》§6.1 A-12
   底稿：suite/originals-yuren.html（件七 19 条可执行版）/ suite/src/13-yuren.js —— 冲突以规格为准
   铁律：
   - 全部纯函数；today 显式传参（公约 C-14 时钟注入）；本模块零 new Date()
   - 系数只经 gc（makeGetCoef 产物）参数化注入；除法只经 safeDiv；null ≠ 0（A-19）
   - 本板块最高红线：①PLV 任一层不过=拦截保存 ②配方源资格闸不合格=拦截
     ③处方永不挂钱（本模块零 commission/penalty/rank 依赖，Y-D2 引擎级等效）
   ============================================================ */

import {
  safeDiv, mean, stddevS, roundTo,
  addDays, diffDays, weekdayOf,
  getCoef, buildEnvelope,
} from './shared.mjs';

/* ============================================================
   常量（枚举 / 话术 / 声明——Y 系逐字同源）
   ============================================================ */
export const DEFAULT_CULL_VERDICT = 'keep';   // Y-D6 兜底默认「留」
export const M26_DISCLAIMER = '前后对比，非随机对照，要证因果用 M31（留人器系数实验室）。';
export const CALENDAR_WAR_TALK = '主管的个人业绩指标建议下降 30%；主考核换轨为算账器 M11 团队增益——带教有效率只是补充证据，二者互补不混用。';
// M41③ 动量期 PLV 加强词（原版 COEF_DEFAULTS.momentumBannedWords；shared 件二未收录 → 本板块常量，gc('yuren.momentumBannedWords') 可覆盖）
export const MOMENTUM_BANNED = ['冲', '拼', '必须拿下'];
// 汰前三拦截阈值（件三 3.6：线索指数<0.7 / 前14天练习<50；原版 COEF_DEFAULTS.cullGuard；gc('yuren.cullGuard') 可覆盖）
export const CULL_GUARD_DEFAULT = { leadsIndexLt: 0.70, practice14Min: 50 };
// 第二层去人名测试的任务词表（原版逐字）
export const TASK_WORDS = ['电话', '线索', '意向', '样品', '签约', '需求', '拜访', '报价', '跟进', '复盘',
  '话术', '异议', '分钟', '客户', '单', '转化', '演示', '确认'];
// M44b 🟤 CallMetrics 埋设：只建表（schema 常量）不建界面（Y-D13/T17 引擎级等效——本模块零 DOM/渲染引用）
// 倒 U 判定式（注释埋设，界面与判定不实现）：倾听占比≈55–65% 最优、提问数 10–14/通最优，两端皆衰减。
export const CALLMETRICS_FIELDS = ['cmId', 'employeeId', 'callDate', 'talkListenRatio', 'questionCount', 'durationSec'];

export const TALK = {
  landing1: '这个系统不复制销冠。销冠不可复制。它做两件事：① 把你团队的地板，抬高三万块。② 让你的销冠，第一次敢把他的本事交出来。',
  boundary: '这个系统不会让一个卖不动的产品卖动。如果你的产品本身有问题——先去改产品。这个系统帮不了你。',
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

/* ============================================================
   3.2 闸① PLV 处方语言校验器（三层全拦截）
   ============================================================ */
export function plvCheck(text, opts = {}, gc = getCoef) {
  const t = String(text || '').trim();
  const banned = (opts.banned || gc('yuren.plvBanned'))
    .concat(opts.momentum ? (opts.momentumBanned || gc('yuren.momentumBannedWords') || MOMENTUM_BANNED) : []);
  // 第一层：拦截词库
  const hits = banned.filter(w => t.includes(w));
  const l1 = { pass: hits.length === 0, hits };
  // 第二层：去人名测试——删人名/你/他/她后，句子仍指向任务（含数字或业务环节词）才成立
  let residual = t.replace(/你|他|她|您/g, '');
  (opts.names || []).forEach(n => { residual = residual.split(n).join(''); });
  const l2 = { pass: /\d/.test(residual) || TASK_WORDS.some(w => residual.includes(w)) };
  // 第三层：三槽位（行为数据 + 具体动作 + 可测基准，缺一拦截）
  const hasBehaviorData = /\d/.test(t) && TASK_WORDS.some(w => t.includes(w));
  const hasAction = /(试试|改成|下次|先|把|问|打|加上|换成|今天|本周|再|多做|列出|准备)/.test(t);
  const hasBenchmark = /(基准|配方源|团队均值|上周|上月|参考|对标)/.test(t) && /[\d％%]/.test(t);
  const l3 = { pass: hasBehaviorData && hasAction && hasBenchmark,
    slots: { behaviorData: hasBehaviorData, action: hasAction, benchmark: hasBenchmark } };
  return { l1, l2, l3, passed: l1.pass && l2.pass && l3.pass };
}
export function plvRewriteHint(plvResult) {
  // 改写建议 = 三槽位写作脚手架（不是替老板下结论，A-19）
  const s = plvResult.l3.slots || {};
  const parts = [];
  if (!plvResult.l1.pass) parts.push('去掉指向"人"的词（' + plvResult.l1.hits.join('、') + '），改说他做了什么');
  if (!s.behaviorData) parts.push('补一条行为数据：昨天/上周他在哪个环节、多少次');
  if (!s.action) parts.push('补一个今天就能做的具体动作（"试试在第 3 分钟问…"）');
  if (!s.benchmark) parts.push('补一个可测基准：配方源或团队均值的数字');
  return parts;
}

/* ============================================================
   3.3 闸② PSI 个性化指数（parts∈[0,1]；逐项 25 分制四舍五入求和；任一 null → null）
   ============================================================ */
export function psiScore(parts, gc = getCoef) {
  if (!parts) return null;
  const w = gc('yuren.psi').w;
  const keys = ['targeting', 'benchmark', 'dataRef', 'ackRate'];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const v = parts[keys[i]];
    if (v == null) return null;
    sum += Math.round(w[i] * v);
  }
  return sum;
}
export function psiBand(score, gc = getCoef) {
  if (score == null) return null;
  const b = gc('yuren.psi').bands;
  return score > b[1] ? 'green' : (score >= b[0] ? 'amber' : 'red');
}

/* ============================================================
   3.1 闸④ 配方源资格（硬闸：四条同时满足；M21 未运行 → 整体锁定 Y-D3/T3）
   ============================================================ */
export function recipeGateCheck(p, ctx, gc = getCoef) {
  // p: {rankNorm, uer, discountRate, complaintCount}  ctx: {m21Done, teamDiscountMean, teamComplaintMean, coef?}
  const coef = (ctx && ctx.coef) || gc('yuren.recipeGate');
  if (!ctx || !ctx.m21Done) return { locked: true, qualified: false, fails: ['m21_missing'] };
  const fails = [];
  if (p.rankNorm == null || p.rankNorm > coef.topN) fails.push('rank');
  if (p.uer == null || p.uer < coef.uerMin) fails.push('uer');
  if (coef.discountLeMean && (p.discountRate == null || ctx.teamDiscountMean == null
      || p.discountRate > ctx.teamDiscountMean)) fails.push('discount');
  if (coef.complaintLeMean && (p.complaintCount == null || ctx.teamComplaintMean == null
      || p.complaintCount > ctx.teamComplaintMean)) fails.push('complaint');
  return { locked: false, qualified: fails.length === 0, fails };
}

/* ============================================================
   闸③ 产权前提：无 M28 ∨ AHC<信任线 → 锁定；UER 趋势 <−0.5σ →「他开始藏了」（Y-D4）
   ============================================================ */
export function propertyGate(p, gc = getCoef) {
  // p: {hasM28, ahc}；信任线 = 公约共享系数 ahcTrustLine（与算账器闸⑪双侧同改 R-04）
  const line = gc('ahcTrustLine');
  if (!p.hasM28) return { locked: true, reason: 'no_m28' };
  if (p.ahc == null) return { locked: true, reason: 'ahc_missing' };
  if (p.ahc < line) return { locked: true, reason: 'ahc_low' };
  return { locked: false, reason: null };
}
export function hidingCheck(uerSeries, minSample, gc = getCoef) {
  // 上线后配方源 UER 趋势监测：最新值相对此前均值下滑 < −0.5σ → hiding
  const min = minSample || gc('minSampleDefault');
  if (!uerSeries || uerSeries.length < min) return { hiding: null };   // 样本不足不下结论（A-19）
  const prev = uerSeries.slice(0, -1), last = uerSeries[uerSeries.length - 1];
  const sd = stddevS(prev);
  if (sd == null || sd === 0) return { hiding: null };
  return { hiding: (last - mean(prev)) < -0.5 * sd };
}

/* ============================================================
   3.7 闸⑩ 认知鸿沟 = 1 − 确认/上报（>30% 红；与招人器同口径）
   ============================================================ */
export function cognitiveGap(reportedHrs, confirmedHrs) {
  const r = safeDiv(confirmedHrs, reportedHrs);
  return r == null ? null : 1 - r;
}

/* ============================================================
   3.5 M14 第三闸 · 有效动作分（刷量不增分 → 虚报数学收益归零；只供 M12/M15）
   ============================================================ */
export function effectiveLeads(leads, intents, convLowerBand) {
  if (leads == null) return null;
  if (intents == null || convLowerBand == null || convLowerBand <= 0) return leads;
  return Math.min(leads, intents / convLowerBand);
}
export function effectiveChain(counts, bands) {
  // counts:{leads,intents,samples,contracts}  bands:{lead2intent,intent2sample,sample2contract}（个人近90天下限带宽）
  const eLeads = effectiveLeads(counts.leads, counts.intents, bands && bands.lead2intent);
  const eIntents = effectiveLeads(counts.intents, counts.samples, bands && bands.intent2sample);
  const eSamples = effectiveLeads(counts.samples, counts.contracts, bands && bands.sample2contract);
  return { leads: eLeads, intents: eIntents, samples: eSamples, contracts: counts.contracts };
}

/* ============================================================
   3.6 M15 汰前三道拦截（任一命中 → 汰建议渲染前拦截；兜底默认「留」）
   ============================================================ */
export function cullInterceptors(ctx, coef, gc = getCoef) {
  // ctx: {leadsIndex, practice14, ackConfirmedCount}
  const c = coef || gc('yuren.cullGuard') || CULL_GUARD_DEFAULT;
  const blocks = [];
  if (ctx.leadsIndex != null && ctx.leadsIndex < c.leadsIndexLt) blocks.push('no_leads');
  if (ctx.practice14 != null && ctx.practice14 < c.practice14Min) blocks.push('no_practice');
  if (ctx.ackConfirmedCount === 0) blocks.push('no_coaching');
  return blocks;
}

/* ============================================================
   3.4 M13 闸⑧ 挤出对冲三态（🔴 与公约 §6.1 A-12 细则、4号留人器闸③ 逐字同源，R-04 三处同改）
   ============================================================ */
export const isResultTrigger = t => ['record_break', 'sprint', 'backlog_clear'].indexOf(t) >= 0;
export const isExempt = t => ['first_deal', 'hire'].indexOf(t) >= 0;   // 🔴 豁免：无内在动机可挤出
export function bountyGate(template, silentTrackOn) {
  if (isExempt(template)) return { allow: true, state: 'exempt' };
  if (isResultTrigger(template) && !silentTrackOn) return { allow: false, state: 'blocked', talk: 'Y-13' };
  return { allow: true, state: 'pass' };
}

/* ============================================================
   3.8 M25 JOLT 闸⑫（高犹豫 = 停留 > 品类中位 ×1.5；加压 = 期间出现折扣；折扣率 > 其他 ×1.5 → 红）
   ============================================================ */
export function joltCheck(d, coef, gc = getCoef) {
  // d:{stayDays, categoryMedianStayDays, hasDiscountDuring, personDiscountRate, othersDiscountRate}
  const c = coef || gc('yuren.joltRule');
  const high = (d.stayDays != null && d.categoryMedianStayDays != null)
    ? d.stayDays > d.categoryMedianStayDays * c.stallX : null;
  const pressure = high === true && !!d.hasDiscountDuring;
  let ratioRed = null;
  const ratio = safeDiv(d.personDiscountRate, d.othersDiscountRate);
  if (ratio != null) ratioRed = ratio > c.discountX;
  return { highHesitation: high, pressure, ratioRed };
}

/* ============================================================
   3.9 M26 地板抬升计量器（前后对比，非随机对照——M26_DISCLAIMER 必随行）
   ============================================================ */
export function floorLift(group, coef, gc = getCoef) {
  // group: {members:[{beforeMonthlyAmt, afterMonthlyAmt}], windowDaysOk:bool}；每组≥minEach 人且前后各≥90天，否则 null
  const c = coef || gc('yuren.floorLift');
  if (!group || !group.members || group.members.length < c.minEach || !group.windowDaysOk)
    return { annualLiftAmt: null, insufficient: true };
  let lift = 0;
  for (const m of group.members) {
    if (m.beforeMonthlyAmt == null || m.afterMonthlyAmt == null) return { annualLiftAmt: null, insufficient: true };
    lift += m.afterMonthlyAmt - m.beforeMonthlyAmt;
  }
  return { annualLiftAmt: lift * 12, monthlyLiftAmt: lift, insufficient: false };
}
export function recipeRoi(annualLiftAmt, monthlyCostAmt) {
  // 配方ROI = 地板抬升(年) ÷ (使用费+带教分成+主管机会成本)(年化)
  return safeDiv(annualLiftAmt, monthlyCostAmt == null ? null : monthlyCostAmt * 12);
}

/* ============================================================
   3.10 M40 配对传帮带排班器（教练池=前3∩闸④∩闸③M28；学员池=(20%,80%]；增幅升序；3周轮换）
   ============================================================ */
export function m40Pairing(input, coef, gc = getCoef) {
  // input: {people:[{spId,rankNorm,growth3m}], gate4PassIds:[], m28SignedIds:[], prevWeeks:{'coach|learner':n}}
  const c = coef || gc('yuren.m40');
  const n = input.people.length;
  const coachCand = input.people
    .filter(p => p.rankNorm != null && p.rankNorm <= c.coachTopN)
    .filter(p => input.gate4PassIds.indexOf(p.spId) >= 0)
    .sort((a, b) => a.rankNorm - b.rankNorm);
  const frozen = coachCand.filter(p => input.m28SignedIds.indexOf(p.spId) < 0);   // 🔴 未签 M28 → 席位冻结
  const coaches = coachCand.filter(p => input.m28SignedIds.indexOf(p.spId) >= 0);
  const coachIds = coachCand.map(p => p.spId);
  const lo = n * c.learnerBand[0], hi = n * c.learnerBand[1];
  const learners = input.people
    .filter(p => p.rankNorm != null && p.rankNorm > lo && p.rankNorm <= hi)
    .filter(p => coachIds.indexOf(p.spId) < 0)
    .sort((a, b) => (a.growth3m == null ? 1 : b.growth3m == null ? -1 : a.growth3m - b.growth3m));  // 最需要的先配
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
export function pairAllowed(consecutiveWeeks, coef, gc = getCoef) {
  const max = (coef && coef.pairWeeksMax) || gc('yuren.m40').pairWeeksMax;
  return consecutiveWeeks < max;
}

/* ============================================================
   3.11 M41 动量连败干预器（0.6/0.4 权重；连败≥3 或 分≥0.60 触发；干预全部 action_card）
   ============================================================ */
export function momentum(lossStreak, prevWinRate, curWinRate, coef, gc = getCoef) {
  const c = coef || gc('yuren.m41');
  const dropRatio = (prevWinRate == null || curWinRate == null || prevWinRate <= 0) ? null
    : Math.max(0, (prevWinRate - curWinRate) / prevWinRate);
  if (lossStreak == null && dropRatio == null) return { score: null, triggered: null };
  const s = c.w[0] * Math.min((lossStreak || 0) / c.streakCap, 1)
          + c.w[1] * Math.min(dropRatio == null ? 0 : dropRatio, 1);
  const score = Math.round(s * 100) / 100;
  return { score, triggered: (lossStreak || 0) >= c.lossStreakTrigger || score >= c.scoreTrigger };
}

/* ============================================================
   3.12 M42 深板凳榜样匹配（曼哈顿轨迹距离，万元；匹配空 → null，"—" 绝不硬凑）
   ============================================================ */
export function trajDistance(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) return null;
    s += Math.abs(a[i] - b[i]);
  }
  return s;
}
export function m42Match(laggardTraj, candidates) {
  // candidates: [{spId, traj, nowBandOk}]（nowBandOk = 现在 ≥ 中 1/3）
  let best = null;
  for (const cand of candidates || []) {
    if (!cand.nowBandOk) continue;
    const d = trajDistance(laggardTraj, cand.traj);
    if (d == null) continue;
    if (!best || d < best.dist) best = { spId: cand.spId, dist: d };
  }
  return best;
}

/* ============================================================
   3.13 M43 分层节奏引擎 + M44a 资历忽视
   ============================================================ */
export function paceZone(completion, opts, coef, gc = getCoef) {
  // completion = 周期回款 ÷ 个人配额（null → 整模块 "—"）
  if (completion == null) return null;
  const c = coef || gc('yuren.m43');
  const o = opts || {};
  const bigDealProtect = (o.inFlightBigDealAmt != null && o.monthQuotaAmt != null
    && o.inFlightBigDealAmt > o.monthQuotaAmt * c.protectBigDealShare);
  if (completion >= 1.0 || bigDealProtect) return 'protect';
  if (completion < c.quitLt) return 'quit_risk';
  if (completion >= c.accel[0] && completion < c.accel[1]) return 'accel';
  return 'normal';
}
export function subGoalAmt(remainWorkdays, dailyAvgAmt, coef, gc = getCoef) {
  // 子目标 = roundTo(剩余工作日 × 个人历史日均回款 × 1.1, 百元)；只影响推送节奏，不写配额/提成（Y-D12：本函数无任何 db 写路径）
  const c = coef || gc('yuren.m43');
  if (remainWorkdays == null || dailyAvgAmt == null) return null;
  return roundTo(remainWorkdays * dailyAvgAmt * c.subGoalX, 10000);   // 百元 = 10000 分
}
export function m44aRatio(veteranAvgDoseHrs, teamAvgDoseHrs) {
  // 老手辅导比 = 司龄>2年者的人均 confirmed 剂量 ÷ 全队人均；<0.5 → 🟡 Y-09
  return safeDiv(veteranAvgDoseHrs, teamAvgDoseHrs);
}

/* ============================================================
   闸⑪ 辅导剂量（人均月 confirmed 时长；导出信封供留人器分红闸⑧ Q4，Y-C02/Y-D15）
   ============================================================ */
export function coachingDoseActual(acks, activeCount, windowDays, today) {
  // acks: [{status, durationHrs, date}]；只计 confirmed；按 windowDays 折算为"人均月"
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

/* ============================================================
   休息日规则（排班表 ShiftConfig；分母/连续计数/催报/插卡四处全部排除，Y-D8）
   ============================================================ */
export function isWorkday(dateStr, shiftConfig, spId) {
  // shiftConfig: {spId 或 '*': [0..6 为休息的星期]}；默认周日休（0=周日）
  const sc = shiftConfig || {};
  const rest = sc[spId] || sc['*'] || [0];
  return rest.indexOf(weekdayOf(dateStr)) < 0;
}

/* ============================================================
   M14① 挂账爆破 + 量增质塌
   ============================================================ */
export function backlogCheck(d, today, coef, gc = getCoef) {
  // d:{contractDate, paidDate|null}；>30天主管黄条 / >60天老板插卡
  const c = coef || gc('yuren.backlogAlert');
  if (d.paidDate) return null;
  const days = diffDays(d.contractDate, today);   // today − contractDate
  if (days > c.bossDays) return 'boss';
  if (days > c.managerDays) return 'manager';
  return null;
}
export function surgeCollapse(cur, prev, coef, gc = getCoef) {
  // 量增质塌：计数 +50% ∧ 转化 −30% → 抽检加权 ×3
  const c = coef || gc('yuren.backlogAlert');
  const up = safeDiv(cur.leads - prev.leads, prev.leads);
  const down = safeDiv(prev.conv - cur.conv, prev.conv);
  if (up == null || down == null) return null;
  return up >= c.surgeUp && down >= c.dropDown;
}

/* ============================================================
   存储实体骨架（件二 2.2；服务层建库参考——纯数据形状，零 UI）
   ============================================================ */
export function emptyDB() {
  return {
    salespeople: [],        // Salesperson 最小字段集（公约【1A】）
    dailyReports: [],       // DailyReport（写方=本板块；原始计数永不被有效分改写，Y-D5）
    prescriptions: [],      // Prescription
    coachTasks: [],         // CoachTask
    coachingAcks: [],       // CoachingAck {ackId, spId, coachId, date, durationHrs, status, reportedHrs}
    bounties: [],           // Bounty
    spotChecks: [],         // SpotCheckCard（只出题不记结果，Y-D7）
    practiceLogs: [],       // PracticeLog（本地补录；招人器信封为权威源）
    recipeSource: null,     // RecipeSource {sourceIds[], setAt, setBy, qualifiedFlags}
    pairAssignments: [],    // PairAssignment
    callMetrics: [],        // CallMetrics 🟤 埋设：建表不建界面（Y-D13；字段=CALLMETRICS_FIELDS）
    paceConfig: { periodType: 'month', quotaSource: 'manual', manualQuotaBySp: {} },
    shiftConfig: { '*': [0] },   // 默认周日休
    externalRef: {},        // ExternalRef：board → 只读缓存（A-20；永不进信封）
    settings: { silentTrackOn: false, lastExportAt: null, insistLog: [] },
    coefOverrides: {},
  };
}

/* ============================================================
   信封（公约【7】skab_v1）：导入点亮 / 导出含辅导剂量（经 shared.buildEnvelope）
   ============================================================ */
export const BOARD = 'yuren';
export const KNOWN_BOARDS = ['dingjia', 'zhaoren', 'suanzhang', 'liuren', 'yuren'];
export const ENTITY_WHITELIST = ['Salesperson', 'CompPlanScenario', 'TeamStructure', 'CovenantDoc', 'Covenant', 'Deal',
  'Category', 'PayoutEntry', 'RefundEntry', 'DiscountEntry', 'LeadAssignment', 'DailyReport', 'CoachingAck',
  'CoachTask', 'Prescription', 'Bounty', 'HiringCriteria', 'Candidate', 'InterviewScorePack', 'PracticeLog',
  'HireBatch', 'ManagerChangeEvent', 'LedgerEntry', 'ObjectionEntry', 'SuggestionEntry', 'M28Agreement',
  'MenuChoice', 'OverrideEvent', 'Experiment', 'HandoverCard', 'CallMetrics', 'M21Norm'];

export function importEnvelope(db, json, today) {
  // 🔴 A-20：ExternalRef 整条覆盖，不做字段级合并；未知实体静默跳过（向前兼容）
  if (!json || json.schema !== 'skab_v1') return { ok: false, err: '不是 skab_v1 信封' };
  if (KNOWN_BOARDS.indexOf(json.board) < 0) return { ok: false, err: '未知 board：' + json.board };
  if (json.board === BOARD) return { ok: false, err: '这是育人器自己的信封，无需导入' };
  const entities = {};
  Object.keys(json.entities || {}).forEach(k => {
    if (ENTITY_WHITELIST.indexOf(k) >= 0) entities[k] = json.entities[k];
  });
  db.externalRef[json.board] = {
    exportedAt: json.exportedAt, dataVersion: json.dataVersion || 1,
    coefficientsHash: json.coefficientsHash || null,
    derived: json.derived || {}, entities, importedAt: today,
  };
  return { ok: true, board: json.board };
}

/* —— 跨板块只读取数器（消费侧统一入口；缺失回退遵公约 7.2） —— */
export const XREF = {
  suanzhang(db) { return db.externalRef.suanzhang || null; },
  m21Done(db) {
    const r = XREF.suanzhang(db);
    return !!(r && r.entities.M21Norm && r.entities.M21Norm.length);
  },
  m21Row(db, spId) {
    const r = XREF.suanzhang(db);
    if (!r || !r.entities.M21Norm) return null;
    return r.entities.M21Norm.find(x => x.spId === spId) || null;
  },
  deals(db) {
    const r = XREF.suanzhang(db);
    return (r && r.entities.Deal) || [];
  },
  ahc(db, spId) {
    const r = db.externalRef.liuren;
    const map = r && r.derived.ahcBySp;
    return map && map[spId] != null ? map[spId] : null;
  },
  m28(db, spId) {
    const r = db.externalRef.liuren;
    const list = (r && r.entities.M28Agreement) || [];
    return list.find(a => a.spId === spId || a.masterId === spId) || null;
  },
  practice14(db, spId) {
    const r = db.externalRef.zhaoren;
    const list = (r && r.entities.PracticeLog) || [];
    const row = list.find(x => x.spId === spId);
    if (row) return row.count14;
    const local = db.practiceLogs.find(x => x.spId === spId);
    return local ? local.count14 : null;
  },
  quota(db, spId) {
    const manual = db.paceConfig.manualQuotaBySp[spId];
    if (manual != null) return { amt: manual, src: 'manual' };
    const r = db.externalRef.dingjia;
    const map = r && r.derived.monthQuotaBySp;
    if (map && map[spId] != null) return { amt: map[spId], src: 'dingjia' };
    return null;
  },
};

export function exportEnvelope(db, today, coefficientsHash = '') {
  // 🔧Y-C02/Y-D15：derived.coachingDoseActual（人均月 confirmed，30 天窗）供留人器分红闸⑧ Q4
  const activeCount = db.salespeople.filter(p => p.isActive).length;
  const dose = coachingDoseActual(db.coachingAcks, activeCount, 30, today);
  return buildEnvelope({
    board: BOARD, exportedAt: today, coefficientsHash,
    derived: { coachingDoseActual: dose },
    entities: {
      DailyReport: db.dailyReports,
      CoachingAck: db.coachingAcks,
      CoachTask: db.coachTasks,
      Prescription: db.prescriptions,
      Bounty: db.bounties,
    },
  });
}

/* ============================================================
   领域写入口（保存校验 = 唯一路径；拦截即无保存。id 由调用方注入或走确定性计数器——零时钟）
   ============================================================ */
let _seq = 0;
const uid = prefix => prefix + '_' + (++_seq);

export function savePrescription(db, rx, today, gc = getCoef) {
  // 闸① PLV：任一层不过 = 拦截保存（不是警告，Y-D1）；坚持原文 → 留痕 + 计入认知鸿沟风险
  const names = db.salespeople.map(p => p.name).filter(Boolean);
  const plv = plvCheck(rx.text, { banned: rx.banned, names, momentum: !!rx.momentumMode }, gc);
  if (!plv.passed && !rx.insist) return { ok: false, plv, hints: plvRewriteHint(plv) };
  if (!plv.passed && rx.insist)
    db.settings.insistLog.push({ date: today, spId: rx.employeeId || null, text: rx.text });
  db.prescriptions.push({
    rxId: uid('rx'), employeeId: rx.employeeId || null, date: today,
    type: rx.type || 'volume', target: rx.target || 'self',
    slotData: rx.slotData || null, text: rx.text,
    psiParts: rx.psiParts || null, plvPassed: plv.passed, coachAckId: null,
  });
  return { ok: true, plv };
}

export function saveBounty(db, b, today) {
  // 闸⑧ 三态（表单校验层：拦截即保存路径不存在，Y-D16）；同时活动 ≤ 3
  const gate = bountyGate(b.template, db.settings.silentTrackOn);
  if (!gate.allow) return { ok: false, talk: gate.talk, state: gate.state };
  const activeCount = db.bounties.filter(x => x.active).length;
  if (activeCount >= 3) return { ok: false, err: '同时活动的悬赏 ≤ 3' };
  db.bounties.push({ bountyId: uid('bt'), template: b.template, params: b.params || {},
    amountAmt: b.amountAmt || null, active: true, createdAt: today, achievedEvents: [] });
  return { ok: true, state: gate.state };
}

export function saveDailyReport(db, r) {
  // Y-D5：原始计数原样保留；有效动作分只在 M12/M15 派生使用
  const dup = db.dailyReports.find(x => x.employeeId === r.spId && x.date === r.date);
  const counts = { leads: r.counts.leads | 0, intents: r.counts.intents | 0,
    samples: r.counts.samples | 0, contracts: r.counts.contracts | 0 };
  if (dup) { dup.counts = counts; return { ok: true, updated: true }; }
  db.dailyReports.push({ drId: uid('dr'), employeeId: r.spId, date: r.date, counts, submittedAt: r.date });
  return { ok: true };
}

export function makeSpotCheckCard(spId, weekOf, stage, reportedCount) {
  // Y-D7：只出题不记结果——schema 不存在结果/负面标记字段
  return { sccId: uid('scc'), weekOf, employeeId: spId, checkDate: weekOf, stage, reportedCount };
}

export function setRecipeSource(db, sourceIds, today, gc = getCoef) {
  // 每次设定必过闸④（Y-D3）
  const ctx = teamGateContext(db, gc);
  for (const id of sourceIds) {
    const row = XREF.m21Row(db, id) || {};
    const check = recipeGateCheck(row, ctx, gc);
    if (check.locked || !check.qualified) return { ok: false, spId: id, check };
  }
  db.recipeSource = { sourceIds, setAt: today, setBy: 'boss', qualifiedFlags: true };
  return { ok: true };
}

/* ============================================================
   派生视图层（读 db + XREF → 纯派生；全部显式收 today）
   ============================================================ */
export const activeSps = db => db.salespeople.filter(p => p.isActive);
export const reportsFor = (db, spId, from, to) =>
  db.dailyReports.filter(r => r.employeeId === spId && r.date >= from && r.date <= to);
export function sumCounts(reports) {
  const s = { leads: 0, intents: 0, samples: 0, contracts: 0 };
  for (const r of reports) {
    s.leads += r.counts.leads; s.intents += r.counts.intents;
    s.samples += r.counts.samples; s.contracts += r.counts.contracts;
  }
  return s;
}
export function workdaysIn(db, spId, from, to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, db.shiftConfig, spId)) n++;
  return n;
}
export function teamGateContext(db, gc = getCoef) {
  const ref = XREF.suanzhang(db);
  const rows = (ref && ref.entities.M21Norm) || [];
  return { m21Done: XREF.m21Done(db),
    teamDiscountMean: mean(rows.map(r => r.discountRate).filter(v => v != null)),
    teamComplaintMean: mean(rows.map(r => r.complaintCount).filter(v => v != null)),
    coef: gc('yuren.recipeGate') };
}
const tenureDays = (db, spId, today) => {
  const p = db.salespeople.find(x => x.spId === spId);
  return p ? diffDays(p.hireDate, today) : null;   // today − hireDate
};

/* —— 个人近90天转化率下限带宽（周桶最小值；桶<3 → null） —— */
export function convBands(db, spId, today) {
  const from = addDays(today, -90);
  const buckets = {};
  for (const r of reportsFor(db, spId, from, today)) {
    const wk = Math.floor(diffDays(r.date, today) / 7);
    const b = buckets[wk] || (buckets[wk] = { leads: 0, intents: 0, samples: 0, contracts: 0 });
    b.leads += r.counts.leads; b.intents += r.counts.intents;
    b.samples += r.counts.samples; b.contracts += r.counts.contracts;
  }
  const ratios = { lead2intent: [], intent2sample: [], sample2contract: [] };
  Object.keys(buckets).forEach(k => {
    const b = buckets[k];
    if (b.leads > 0) ratios.lead2intent.push(b.intents / b.leads);
    if (b.intents > 0) ratios.intent2sample.push(b.samples / b.intents);
    if (b.samples > 0) ratios.sample2contract.push(b.contracts / b.samples);
  });
  const band = arr => arr.length >= 3 ? Math.min.apply(null, arr) : null;
  return { lead2intent: band(ratios.lead2intent), intent2sample: band(ratios.intent2sample),
    sample2contract: band(ratios.sample2contract) };
}
export function bandsFor(db, spId, today, gc = getCoef) {
  // 新人 <30 天：用配方源带宽 × newbieBandFactor(0.60)（3.5③）
  const t = tenureDays(db, spId, today);
  if (t != null && t < 30 && db.recipeSource && db.recipeSource.sourceIds.length) {
    const src = convBands(db, db.recipeSource.sourceIds[0], today);
    const f = gc('yuren.effectiveScore').newbieBandFactor;
    return { lead2intent: src.lead2intent == null ? null : src.lead2intent * f,
      intent2sample: src.intent2sample == null ? null : src.intent2sample * f,
      sample2contract: src.sample2contract == null ? null : src.sample2contract * f };
  }
  return convBands(db, spId, today);
}

/* —— M12 三张牌（剂量 / 配比 / 节奏；近180天，零新增录入） —— */
export function threeCards(db, today) {
  if (!db.recipeSource || !db.recipeSource.sourceIds.length) return null;
  const ids = db.recipeSource.sourceIds;
  const from = addDays(today, -180);
  const per = ids.map(id => {
    const reps = reportsFor(db, id, from, today);
    const wd = Math.max(1, reps.length);   // 有报工作日
    const s = sumCounts(reps);
    const deals = XREF.deals(db).filter(d => d.spId === id && d.status === 'won')
      .sort((a, b) => a.contractDate < b.contractDate ? -1 : 1);
    const gaps = [];
    for (let i = 1; i < deals.length; i++) gaps.push(diffDays(deals[i - 1].contractDate, deals[i].contractDate));
    const catCount = {};
    deals.forEach(d => catCount[d.category] = (catCount[d.category] || 0) + 1);
    const topCat = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0] || null;
    const p = db.salespeople.find(x => x.spId === id);
    return {
      dose: { leads: s.leads / wd, intents: s.intents / wd, samples: s.samples / wd, contracts: s.contracts / wd },
      mix: { l2i: safeDiv(s.intents, s.leads), i2s: safeDiv(s.samples, s.intents), s2c: safeDiv(s.contracts, s.samples) },
      pace: { firstDealDays: (deals.length && p) ? diffDays(p.hireDate, deals[0].contractDate) : null,
        gapMedian: gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null,
        topCat, topCatShare: deals.length ? (catCount[topCat] || 0) / deals.length : null },
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

/* —— 首N天基准（配方源入职期日报；样本<3 → 单人基准 + 标注） —— */
export function firstNDaysBaseline(db, today, gc = getCoef) {
  if (!db.recipeSource || !db.recipeSource.sourceIds.length) return null;
  const N = gc('yuren.newbieWindow').days;
  const samples = [];
  for (const id of db.recipeSource.sourceIds) {
    const p = db.salespeople.find(x => x.spId === id);
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
    daily: { leads: mean(samples.map(s => s.leads)), intents: mean(samples.map(s => s.intents)),
      samples: mean(samples.map(s => s.samples)) },
  };
}

/* —— 处方诊断三型（量差/质差/速差按 rxRules 取偏差最大；A-19 证据不全不下结论） —— */
export function rxDiagnose(db, spId, today, gc = getCoef) {
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
  const coef = gc('yuren.rxRules');
  const doseRatio = safeDiv(myDose, cards.dose.leads);
  const mixRatio = safeDiv(myMix, srcMix);
  const dev = [];
  if (doseRatio != null && doseRatio < coef.volumeLt) dev.push({ type: 'volume', gap: coef.volumeLt - doseRatio, doseRatio });
  if (mixRatio != null && mixRatio < coef.qualityLt) dev.push({ type: 'quality', gap: coef.qualityLt - mixRatio, mixRatio });
  const sorted = XREF.deals(db).filter(d => d.spId === spId && d.status === 'won')
    .slice().sort((a, b) => a.contractDate < b.contractDate ? -1 : 1);
  const gapDays = [];
  for (let i = 1; i < sorted.length; i++) gapDays.push(diffDays(sorted[i - 1].contractDate, sorted[i].contractDate));
  const myGap = gapDays.length ? mean(gapDays) : null;
  if (myGap != null && cards.pace.gapMedian != null && myGap > cards.pace.gapMedian * coef.speedX)
    dev.push({ type: 'speed', gap: myGap / cards.pace.gapMedian - coef.speedX, myGap });
  if (!dev.length) return { none: true, reason: '三型偏差均未触发（量/质/速都在带内）' };
  dev.sort((a, b) => b.gap - a.gap);
  return { none: false, top: dev[0], all: dev,
    facts: { myDose, srcDose: cards.dose.leads, myMix, srcMix, myGap, srcGap: cards.pace.gapMedian, days: reps.length } };
}

/* —— M15 新人筛选看板（7 天窗口 · 阈值=首N天基准×80% · 日红线60% · 连红3 → 建议；兜底「留」） —— */
export function newbieBoard(db, today, gc = getCoef) {
  const nw = gc('yuren.newbieWindow');
  const cullCoef = gc('yuren.cullGuard') || CULL_GUARD_DEFAULT;
  const base = firstNDaysBaseline(db, today, gc);
  return activeSps(db).filter(p => {
    const t = diffDays(p.hireDate, today);
    return t >= 0 && t <= 30;
  }).map(p => {
    const t = diffDays(p.hireDate, today);
    const reps = reportsFor(db, p.spId, p.hireDate, today);
    const days = [];
    let redStreak = 0, maxStreak = 0;
    if (base && !base.missing) {
      for (let d = p.hireDate; d <= today && diffDays(p.hireDate, d) < nw.days; d = addDays(d, 1)) {
        if (!isWorkday(d, db.shiftConfig, p.spId)) continue;   // 休息日不计（Y-D8）
        const r = reps.find(x => x.date === d);
        const eff = r ? effectiveChain(r.counts, bandsFor(db, p.spId, today, gc)) : null;   // 达标用有效动作分
        const att = eff ? safeDiv(eff.leads, base.daily.leads * nw.thresholdRate) : 0;
        const red = att == null || att < nw.redLine;
        days.push({ date: d, att, red });
        redStreak = red ? redStreak + 1 : 0;
        maxStreak = Math.max(maxStreak, redStreak);
      }
    }
    const s = sumCounts(reps);
    const monthlyLeads = t > 0 ? Math.round(s.leads * (30 / Math.max(1, t))) : s.leads;
    const teamLeadMean = mean(activeSps(db).filter(x => x.spId !== p.spId).map(x => {
      const rr = reportsFor(db, x.spId, addDays(today, -30), today);
      return rr.length ? sumCounts(rr).leads : null;
    }).filter(v => v != null));
    const leadsIndex = safeDiv(monthlyLeads, teamLeadMean);
    const acks = db.coachingAcks.filter(a => a.spId === p.spId && a.status === 'confirmed');
    const ctx = { leadsIndex, practice14: XREF.practice14(db, p.spId), ackConfirmedCount: acks.length };
    const blocks = cullInterceptors(ctx, cullCoef);
    const suggestCull = !!(base && !base.missing) && maxStreak >= nw.redStreakDays;   // 连红3工作日 → 建议（渲染前必过三拦截）
    return { sp: p, tenure: t, days, maxStreak, suggestCull, blocks, ctx,
      verdict: DEFAULT_CULL_VERDICT, baselineMissing: !base || base.missing,
      singleSample: !!(base && base.singleSample) };
  });
}
