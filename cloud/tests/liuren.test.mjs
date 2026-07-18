/* ============================================================
   件七 · 验收用例集 T1–T19（4号《销冠留人器》v4.4 → 云端 C1 对拍）
   🔴 时钟注入（公约 C-14/R-11）：TEST_TODAY = '2026-07-13'，零真实时钟
   黄金值逐字同源：suite/originals-liuren.html 自检区（件七可执行版）
   运行：node cloud/tests/liuren.test.mjs  → 逐条 ✓/✗ + "N/19 绿"；失败 exit 1
   ============================================================ */

import { getCoef, safeDiv } from '../domain/shared.mjs';
import {
  indices, bandBy, selfRatingDeviation, m28Value, tryDowngradeM28,
  priceTag6, rampGapMonthsEqOf, dependencyRadar, talkList, anniversaryInDays, secondPlaceTrigger,
  payoutPrecheck, handoverSummary, aftershockRank, sweepObjections,
  boardLocked, rankingConfig, bountyGate, isResultTrigger, isExempt,
  ratchetGate, collapseGate, fourQuestions, dividendCompute, forceDividendAck, mcCalc,
  exportEnvelope, importEnvelope,
} from '../domain/liuren.mjs';

const TEST_TODAY = '2026-07-13';

/* ---------- 出厂 fixture（工程化复现原版 factory()；每例深拷贝，互不污染） ---------- */
function factory() {
  return {
    governance: {
      sii: { dailyReportOn: true, rollcallOn: true, spotChecksPerWeek: 3, approvalLevels: 2, monthlyViewsTotal: 20, activeHeadcount: 10, rxCountTotal: 80 },
      ei: { objectionsRaisedQuarter: 0, suggestionsRaised: 0, suggestionsAdopted: 0, covenantConfirmRatio: 0, cardIgnoreRate: 0.82, activeHeadcount: 10, objection90dCount: 0 },
      ahcInputs: { honoredRatio: 0.61, achievedCount: 41, honoredCount: 25, irrevocableRatio: 0, interceptCount: 4, ratchetCount: 2, raiseUpCount: 3 },
      selfRating: { sii: 40, ei: 70, dvi: 80, ahc: 85 },
    },
    entities: {
      Salesperson: [
        { spId: 'sp_wangli', name: '王丽', cityTier: 'tier1', positionType: 'sales', hireDate: '2022-08-01', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_wangwu', name: '王五', cityTier: 'tier1', positionType: 'sales', hireDate: '2026-05-20', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_zhaomin', name: '赵敏', cityTier: 'tier2', positionType: 'sales', hireDate: '2024-01-15', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_liqiang', name: '李强', cityTier: 'tier1', positionType: 'sales', hireDate: '2026-06-05', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_sunhao', name: '孙浩', cityTier: 'tier2', positionType: 'sales', hireDate: '2023-07-13', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_zhouqi', name: '周琦', cityTier: 'tier2', positionType: 'sales', hireDate: '2024-03-01', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_wuqi', name: '吴琪', cityTier: 'tier2', positionType: 'sales', hireDate: '2023-09-01', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_zheng', name: '郑爽', cityTier: 'tier3', positionType: 'sales', hireDate: '2024-06-01', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_feng', name: '冯波', cityTier: 'tier2', positionType: 'sales', hireDate: '2023-02-01', hiringCostAmt: 1500000, isActive: true },
        { spId: 'sp_chen', name: '陈立', cityTier: 'tier2', positionType: 'manager', hireDate: '2021-05-01', hiringCostAmt: 1500000, isActive: true },
      ],
      Covenant: [],
      M28Agreement: [
        { m28Id: 'm28_demo1', masterId: 'sp_wangli', kind: 'mentoring', rate: 0.05, durationMonths: 12, startTrigger: 'apprentice_ramp_done', apprenticeMonthlyNetAmt: 5800000, baselineSnapshotAmt: null, irrevocable: true, createdAt: '2026-05-01' },
        { m28Id: 'm28_demo2', masterId: 'sp_wangli', kind: 'royalty', rate: 0.02, durationMonths: 24, startTrigger: 'recipe_live', teamMonthlyIncrementAmt: 7300000, baselineSnapshotAmt: 12000000, irrevocable: true, createdAt: '2026-05-01' },
      ],
      LedgerEntry: [], ObjectionEntry: [], SuggestionEntry: [], HandoverCard: [], OverrideEvent: [],
      PayoutEntry: [
        { peId: 'pe_1', employeeId: 'sp_wangli', type: 'year_end_bonus', amt: 3000000, period: '2025-07', createdAt: '2025-07-15' },
      ],
    },
    // 价签出厂算例（T1–T4）：近6月月均毛利 10万；招聘 1.5月 + 批均回本 6月 = 75万
    // 🔧D-C1-1 裁决：月当量一律曲线实算（regular=5.78），旧快照 5.078 作废
    priceTag: { spId: 'sp_wangli', monthlyGrossMarginAmt: 10000000, hireMonths: 1.5, paybackMonths: 6, raiseMonthlyAmt: 300000, shortenPct: 0.37, hiresPerYear: 2.267 },
    dividend: {
      period: 'quarter', poolRate: 0.10, netBeforeDividendAmt: 80000000,
      gateCompanyCollect: { enabled: true, pass: true }, gateCompanyNet: { enabled: true, pass: true }, gatePersonalCollect: { enabled: true, pass: true },
    },
    externalRefs: {
      suanzhang: {
        board: 'suanzhang', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02',
        derived: { dvi: 54, imbalanceRate: 0.56, uerTeamMean: 0.31 }, entities: {},
        perPerson: {
          sp_wangli: { normRankMonths: [1, 1, 1, 1, 1, 1], scissors: 0.12, marketGap: 0.05, leadIndex: 1.7, collected6m: 180000000, specialPayout12m: 3, contribGrowth: 0.267 },
          sp_zhaomin: { normRankMonths: [2, 2, 2, 2, 2, 2], scissors: 0.34, marketGap: 0.08, leadIndex: 1.1, collected6m: 90000000, specialPayout12m: 0 },
          sp_sunhao: { normRankMonths: [4, 3, 5, 4, 4, 5], scissors: -0.05, marketGap: -0.02, leadIndex: 0.9, collected6m: 52000000, specialPayout12m: 0 },
          sp_zhouqi: { normRankMonths: [6, 6, 7, 6, 6, 6], scissors: 0.02, marketGap: 0.10, leadIndex: 0.8, collected6m: 41000000, specialPayout12m: 0 },
          sp_wuqi: { normRankMonths: [3, 4, 3, 3, 4, 3], scissors: 0.31, marketGap: -0.06, leadIndex: 1.0, collected6m: 70000000, specialPayout12m: 0 },
        },
        m21Done: true, netContributionAmt: 80000000,
      },
      dingjia: { board: 'dingjia', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02', derived: { goodHireIndex: 1.05, r: 0.18, irrevocable: true, matrixTAmt: 4000000 }, entities: {} },
      zhaoren: { board: 'zhaoren', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02', derived: { batchPaybackMonths: 6, rampCycle: 'regular' }, entities: {} },
      yuren: { board: 'yuren', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02', derived: { coachingDoseActual: 3.4 }, entities: {} },
    },
    silentTrackOn: false,
  };
}
const fx = () => structuredClone(factory());

/* ---------- 变更指令应用器（服务层行为的最小模拟：验证纯函数返回的 events 可落库） ---------- */
function applyEvents(db, events) {
  for (const e of events) {
    if (e.op === 'append') db.entities[e.entity].push(e.record);
    else if (e.op === 'inc') {
      const keys = e.path.split('.'); let o = db;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] += e.by;
    }
  }
}

/* ---------- 断言微框架 ---------- */
const wanNum = fen => (fen == null ? null : fen / 1e6);
const round1 = n => Math.round(n * 10) / 10;
const approx = (a, b, tol = 0.5) => a != null && b != null && Math.abs(a - b) <= tol;
const cases = [];
const T = (id, title, fn) => cases.push({ id, title, fn });

/* ================= T1–T4 价签（权威 6 项） ================= */
T('T1', '价签＝75 万（权威 6 项口径）', () => {
  const pt = priceTag6(fx(), TEST_TODAY);
  return { pass: approx(wanNum(pt.headline), 75, 0.05), got: `${wanNum(pt.headline)} 万`, want: '75.0 万' };
});
T('T2', '爬坡缺口占比＝77.1% 触闸⑤（D-C1-1：曲线实算 5.78，原 67.7%/5.078 作废）', () => {
  const pt = priceTag6(fx(), TEST_TODAY);
  return { pass: approx(pt.rampGapShare, 0.7707, 0.001) && pt.hitGate5 === true && approx(pt.rampGapMonthsEq, 5.78, 0.001), got: `月当量=${pt.rampGapMonthsEq} · ${Math.round(pt.rampGapShare * 1000) / 10}% 触闸=${pt.hitGate5}`, want: '5.78 · 77.1% · 触闸' };
});
T('T3', '加薪 vs 价签＝20.8 倍', () => {
  const pt = priceTag6(fx(), TEST_TODAY);
  return { pass: approx(round1(pt.raiseVsTag), 20.8, 0.05), got: `${round1(pt.raiseVsTag)} 倍`, want: '20.8 倍' };
});
T('T4', '缩短爬坡 37% 年化＝48.5 万（D-C1-1 级联：57.8万×0.37×2.267）', () => {
  const pt = priceTag6(fx(), TEST_TODAY);
  return { pass: approx(round1(wanNum(pt.shortenGainAnnual)), 48.5, 0.05), got: `${round1(wanNum(pt.shortenGainAnnual))} 万`, want: '48.5 万' };
});

/* ================= T5 闸② 排行榜合法配置（引擎级配置常量白名单） ================= */
T('T5', '排行榜合法配置断言（实名/仅名次/无金额/无配额/源＝M21 归一化）', () => {
  const rc = rankingConfig();
  const pass = rc.realName === true && rc.showRankOnly === true && rc.hideAmount === true && rc.hideQuota === true && rc.dataSource === 'm21_normalized'
    && Object.keys(rc).length === 5;   // 白名单：不得多字段（如金额/配额展示开关）
  return { pass, got: JSON.stringify(rc), want: '{实名,仅名次,无金额,无配额,m21_normalized}' };
});

/* ================= T6/T7 M28 产权对价 ================= */
T('T6', '带教分成＝3.48 万（69.6 倍 vs 一次性 500 元）', () => {
  const db = fx();
  const men = db.entities.M28Agreement.find(a => a.kind === 'mentoring');
  const v = m28Value(men), oneOff = getCoef('liuren.m28').oneOffAmt;
  return { pass: approx(wanNum(v), 3.48, 0.005) && approx(v / oneOff, 69.6, 0.1), got: `${wanNum(v)} 万 / ${round1(v / oneOff)} 倍`, want: '3.48 万 / 69.6 倍' };
});
T('T7', '配方使用费＝3.5 万', () => {
  const db = fx();
  const roy = db.entities.M28Agreement.find(a => a.kind === 'royalty');
  return { pass: approx(round1(wanNum(m28Value(roy))), 3.5, 0.05), got: `${round1(wanNum(m28Value(roy)))} 万`, want: '3.5 万' };
});

/* ================= T8–T10 四指数 ================= */
T('T8', 'SII＝73（月总查看 20 次 · 10 人）', () => {
  const ind = indices(fx(), TEST_TODAY);
  return { pass: ind.sii.value === 73 && ind.sii.band === 'danger', got: `${ind.sii.value}(${ind.sii.band})`, want: '73(🔴)' };
});
T('T9', 'EI＝4（异议 0/无建议/确认 0%/忽略 82%）', () => {
  const ind = indices(fx(), TEST_TODAY);
  return { pass: ind.ei.value === 4 && ind.ei.band === 'danger', got: `${ind.ei.value}(${ind.ei.band})`, want: '4(🔴)' };
});
T('T10', 'AHC＝41 + 信封双载荷（derived.ahc + entities.M28Agreement，shared.buildEnvelope）', () => {
  const db = fx();
  const ind = indices(db, TEST_TODAY);
  const env = exportEnvelope(db, TEST_TODAY);
  const pass = ind.ahc.value === 41 && ind.dvi.value === 54
    && env.schema === 'skab_v1' && env.board === 'liuren' && env.exportedAt === TEST_TODAY
    && env.derived.ahc === 41 && Array.isArray(env.entities.M28Agreement) && env.entities.M28Agreement.length >= 2;
  return { pass, got: `AHC=${ind.ahc.value} 信封 ahc=${env.derived.ahc} M28×${env.entities.M28Agreement.length}`, want: '41 / 双载荷' };
});

/* ================= T11 分红四问四红 ================= */
T('T11', '分红四问四红 → 硬红灯 + 留痕指令 + 池未清零', () => {
  const db = fx();
  db.externalRefs.yuren.derived.coachingDoseActual = 2;   // Q4 fail
  const dv = dividendCompute(db, TEST_TODAY, { indicators: { ei: { value: 10 }, sii: { value: 70 } }, goodHireIndex: 0.8 });
  const ack = forceDividendAck(TEST_TODAY);   // 二次确认留痕（纯函数返回指令）
  const hasIntercept = ack.events.some(e => e.op === 'inc' && e.path === 'governance.ahcInputs.interceptCount');
  const hasTrace = ack.events.some(e => e.op === 'append' && e.entity === 'OverrideEvent' && e.record.action === 'force_dividend_risk_ack');
  const pass = dv.fourFailCount === 4 && dv.verdict === 'danger' && dv.pool === 8000000 && hasIntercept && hasTrace;
  return { pass, got: `${dv.fourFailCount} 否/${dv.verdict}/池 ${wanNum(dv.pool)} 万/留痕指令 ${ack.events.length}`, want: '4 否 / 🔴 / 池 8 万未清零 / 留痕+扣分指令' };
});

/* ================= T12 irrevocable 下调拦截 ================= */
T('T12', '下调分成 → 失败 + 留痕 + AHC 重算下降 + 拦截+1（纯函数指令式）', () => {
  const db = fx();
  const before = indices(db, TEST_TODAY).ahc.value;
  const res = tryDowngradeM28(db.entities.M28Agreement, 'm28_demo1', TEST_TODAY, '试图下调');
  // 纯函数断言：调用本身不改任何状态
  const pure = db.governance.ahcInputs.interceptCount === 4 && db.entities.OverrideEvent.length === 0
    && db.entities.M28Agreement.find(a => a.m28Id === 'm28_demo1').rate === 0.05;
  applyEvents(db, res.events);   // 服务层应用变更指令
  const after = indices(db, TEST_TODAY).ahc.value;
  const pass = res.ok === false && res.reason === 'irrevocable_blocked' && res.downgraded === false && pure
    && db.entities.M28Agreement.find(a => a.m28Id === 'm28_demo1').rate === 0.05
    && db.governance.ahcInputs.interceptCount === 5 && db.entities.OverrideEvent.length === 1
    && db.entities.OverrideEvent[0].action === 'try_downgrade' && db.entities.OverrideEvent[0].visibleToAll === true
    && after < before;
  return { pass, got: `ok=${res.ok}(${res.reason}) rate=0.05 AHC ${before}→${after} 拦截 4→${db.governance.ahcInputs.interceptCount}`, want: '失败/不变/41→39 降/+1' };
});

/* ================= T13 M37 参照点三态 ================= */
T('T13', 'M37：历史 3.0 万/增长 26.7% → 趋势 3.8 万；28000🔴/30000🟡/38000🟢', () => {
  const db = fx();
  const a = payoutPrecheck(db, 'sp_wangli', 2800000, TEST_TODAY);
  const b = payoutPrecheck(db, 'sp_wangli', 3000000, TEST_TODAY);
  const c = payoutPrecheck(db, 'sp_wangli', 3800000, TEST_TODAY);
  const pass = a.hist === 3000000 && approx(a.growth, 0.267, 1e-9) && a.trend === 3800000
    && a.verdict === 'below_history' && b.verdict === 'below_trend' && c.verdict === 'ok';
  return { pass, got: `趋势 ¥${a.trend / 100} ${a.verdict}/${b.verdict}/${c.verdict}`, want: '¥38,000 🔴/🟡/🟢' };
});

/* ================= T14 M38 余震 + 交接 + 价签第六项回填 ================= */
T('T14', 'M38：11 单 96 万→38.4/19.2 万/11 张；余震 2/2/1；价签⑥回填不与⑤双计', () => {
  const db = fx();
  const cards = [];
  for (let i = 0; i < 11; i++) cards.push({ hcId: 'hc' + i, leaverId: 'sp_wangli', amountAmt: Math.round(96000000 / 11) });
  cards[0].amountAmt += 96000000 - cards.reduce((s, c) => s + c.amountAmt, 0);   // 精确凑齐 96 万
  const hs = handoverSummary(cards);
  const after = aftershockRank(db, 'sp_wangli');
  const scores = after.map(x => x.score).join('/');
  // 第六项回填：具名 HandoverCard 入库后，价签⑥＝Σ×40%；⑤仍为管道整体 35%（不同 scope，不双计同一笔）
  db.entities.HandoverCard = cards;
  const pt = priceTag6(db, TEST_TODAY);
  const i5 = pt.items.find(i => i.key === 'decay'), i6 = pt.items.find(i => i.key === 'handover');
  const pass = approx(wanNum(hs.loss), 38.4, 0.05) && approx(wanNum(hs.save), 19.2, 0.05) && hs.count === 11
    && scores === '2/2/1'
    && i6.amt === hs.loss && i5.amt === Math.round(10000000 * 0.35) && i5.key !== i6.key;
  return { pass, got: `损耗 ${wanNum(hs.loss)}/可救 ${wanNum(hs.save)}/${hs.count} 张/余震 ${scores}/⑥=${wanNum(i6.amt)} 万 ⑤=${wanNum(i5.amt)} 万`, want: '38.4/19.2/11/2-2-1/⑥回填 ⑤独立' };
});

/* ================= T15 榜眼档 ================= */
T('T15', '榜眼：连续 4 月第 2 + 剪刀差 34% + 零特殊 → 触发⑤；连续 2 月 → 不触发', () => {
  const db = fx();
  const a = secondPlaceTrigger(db, 'sp_zhaomin');
  const db2 = fx();
  db2.externalRefs.suanzhang.perPerson.sp_test = { normRankMonths: [2, 2], scissors: 0.1, specialPayout12m: 0 };
  const b = secondPlaceTrigger(db2, 'sp_test');
  const tl = talkList(db, TEST_TODAY);
  const zhaomin = tl.find(t => t.spId === 'sp_zhaomin');
  const hasSecond = !!(zhaomin && zhaomin.triggers.some(g => g.src === 'second_place'));
  const anniHit = tl.some(t => t.spId === 'sp_sunhao' && t.triggers.some(g => g.src === 'anniversary'));   // 2023-07-13 周年 0 天
  const pass = a.hit === true && a.zeroSpecial === true && b.hit === false && hasSecond && anniHit
    && anniversaryInDays('2023-07-13', TEST_TODAY) === 0;
  return { pass, got: `4月:${a.hit} 2月:${b.hit} 名单含榜眼:${hasSecond} 周年:${anniHit}`, want: 'true/false/true/true' };
});

/* ================= T16 偏差器 ================= */
T('T16', '偏差器：自评(40/70/80/85) vs 实测(73/4/54/41) → 总偏差 42', () => {
  const db = fx();
  const ind = indices(db, TEST_TODAY);
  const dev = selfRatingDeviation(db.governance.selfRating, { sii: ind.sii.value, ei: ind.ei.value, dvi: ind.dvi.value, ahc: ind.ahc.value });
  return { pass: dev.gap === 42 && dev.rows.length === 4, got: `${dev.gap}（${dev.rows.map(r => r.gap).join('/')}）`, want: '42（33/66/26/44）' };
});

/* ================= T17 信封导入导出 ================= */
T('T17', '信封：导入算账器包点亮+解锁 / 未导入锁标志(L-05) / 导出 liuren 双载荷', () => {
  const db = fx();
  const unlocked = boardLocked(db) === false;
  const dbLocked = fx();
  dbLocked.externalRefs.suanzhang = null;
  const locked = boardLocked(dbLocked) === true && indices(dbLocked, TEST_TODAY).dvi.value === null;   // DVI "—（需算账器数据）"
  // 真导入链路：算账器信封 → importEnvelope → ExternalRef 整条覆盖 → DVI 点亮 + 闸①解锁
  const szEnv = { schema: 'skab_v1', board: 'suanzhang', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: '', derived: { dvi: 54, m21Done: true }, entities: {} };
  const imp = importEnvelope(szEnv, TEST_TODAY);
  dbLocked.externalRefs.suanzhang = imp.ref;
  const relit = imp.ok === true && boardLocked(dbLocked) === false && indices(dbLocked, TEST_TODAY).dvi.value === 54 && imp.ref.importedAt === TEST_TODAY;
  const bad = importEnvelope({ schema: 'nope' }, TEST_TODAY).ok === false;
  const env = exportEnvelope(db, TEST_TODAY);
  const dual = env.board === 'liuren' && env.derived.ahc != null && env.entities.M28Agreement.length >= 1;
  const pass = unlocked && locked && relit && bad && dual;
  return { pass, got: `解锁:${unlocked} 锁:${locked} 导入点亮:${relit} 拒坏包:${bad} 双载荷:${dual}`, want: '全 true' };
});

/* ================= T18 闸③三态（A-12 逐字同源） ================= */
T('T18', '闸③三态：record_break∧未启→拦截+L-15；∧已启→放行；first_deal→豁免', () => {
  const g1 = bountyGate('record_break', false);
  const g2 = bountyGate('record_break', true);
  const g3 = bountyGate('first_deal', false);
  const pass = g1.ok === false && g1.reason === 'need_silent_track' && g1.script === 'L-15' && g1.showEnable === true
    && g2.ok === true && g2.reason === 'ok'
    && g3.ok === true && g3.reason === 'exempt'
    && isResultTrigger('record_break') && isResultTrigger('sprint') && isResultTrigger('backlog_clear')
    && isExempt('first_deal') && isExempt('hire') && bountyGate('ride_along', false).ok === true;   // 行为类直接合法
  return { pass, got: `拦:${!g1.ok}(${g1.script}) 放:${g2.ok} 豁免:${g3.ok}(${g3.reason})`, want: '拦(L-15)/放/豁免' };
});

/* ================= T19 分红串联三态（L-C08/L-D16） ================= */
T('T19', '分红串联：①闸不达→池 0+四问零调用 ②全过∧四否→池未清零+🔴 ③全过∧全过→出参考额', () => {
  let calls = 0;
  const spy = (...args) => { calls++; return fourQuestions(...args); };
  // ① 三重闸任一不达 → 池=0，流程终止，四问零调用（调用计数断言）
  const dbA = fx();
  dbA.dividend.gateCompanyCollect.pass = false;
  const a = dividendCompute(dbA, TEST_TODAY, { _fourQuestions: spy });
  const callsAfterA = calls;
  // ② 三重闸全过 ∧ 四问四否 → 池照常算出（未清零）+ 硬红灯（二次确认走 forceDividendAck 留痕）
  const dbB = fx();
  dbB.externalRefs.yuren.derived.coachingDoseActual = 2;
  const b = dividendCompute(dbB, TEST_TODAY, { _fourQuestions: spy, indicators: { ei: { value: 10 }, sii: { value: 70 } }, goodHireIndex: 0.8 });
  // ③ 三重闸全过 ∧ 四问全过 → 直接出参考分红额
  const dbC = fx();
  const c = dividendCompute(dbC, TEST_TODAY, { _fourQuestions: spy, indicators: { ei: { value: 40 }, sii: { value: 50 } }, goodHireIndex: 1.2 });
  const pass = a.pool === 0 && a.fourQuestionsRun === false && a.verdict === 'no_eligibility' && callsAfterA === 0
    && b.pool === 8000000 && b.fourQuestionsRun === true && b.fourFailCount === 4 && b.verdict === 'danger'
    && c.pool === 8000000 && c.fourFailCount === 0 && c.verdict === 'ok'
    && calls === 2;
  return { pass, got: `①池${a.pool}/调用${callsAfterA} ②池${wanNum(b.pool)}万/${b.verdict} ③池${wanNum(c.pool)}万/${c.verdict}（四问共调用${calls}次）`, want: '0-零调用 / 8万-🔴 / 8万-ok' };
});

/* ================= 运行器 ================= */
console.log(`件七对拍 T1–T19 · 4号留人器 v4.4 → 云端 C1 · TEST_TODAY=${TEST_TODAY}（公约 C-14/R-11 时钟注入）\n`);
let green = 0;
for (const c of cases) {
  let r;
  try { r = c.fn(); }
  catch (e) { r = { pass: false, got: `异常: ${e.message}`, want: '' }; }
  const ok = !!r.pass;
  if (ok) green++;
  console.log(`${ok ? '✓' : '✗'} ${c.id} ${c.title}`);
  if (!ok) console.log(`    got:  ${r.got}\n    want: ${r.want}`);
}
console.log(`\n${green}/${cases.length} 绿`);
if (green !== cases.length) process.exit(1);
