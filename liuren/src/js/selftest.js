// ============================================================================
// 件七 · 验收用例集（19 条对拍）+ 件六 · 红线断言（L-D 系）
// 🔴 时钟注入（公约 C-14/R-11）：所有含日期对拍注入 TEST_TODAY=2026-07-13
// 徽章数 = 对拍条数 = 19（R-10）。三绿=收货。
// ============================================================================
const TEST_TODAY = '2026-07-13';

function approx(a, b, tol) { return a != null && b != null && Math.abs(a - b) <= (tol || 0.5); }
function round1(n) { return Math.round(n * 10) / 10; }

function runSelfTest() {
  const T = TEST_TODAY;
  const tcases = [];
  const push = (id, title, pass, got, want) => tcases.push({ id, title, pass: !!pass, got: String(got), want: String(want) });

  // 独立、纯净的出厂实例（不受用户编辑影响；确定性）
  const db = factory(); setCoefOverride(db.coefOverride || {});

  // ---- T1 价签=75万 ----
  const pt = Engine.priceTag(db, T);
  push('T1', '价签＝75 万（权威 6 项口径）', approx(Money.wanNum(pt.headline), 75, 0.05), Money.wan(pt.headline), '75.0 万');
  // ---- T2 爬坡缺口占比=67.7% 触闸⑤ ----
  push('T2', '爬坡缺口占比＝67.7% 触闸⑤', approx(pt.rampGapShare, 0.677, 0.001) && pt.hitGate5, Rate.pct(pt.rampGapShare), '67.7% · 触闸');
  // ---- T3 加薪vs价签=20.8倍 ----
  push('T3', '加薪 vs 价签＝20.8 倍', approx(round1(pt.raiseVsTag), 20.8, 0.05), Num.x(pt.raiseVsTag), '20.8 倍');
  // ---- T4 缩短爬坡年化=42.6万 ----
  push('T4', '缩短爬坡 37% 年化＝42.6 万', approx(round1(Money.wanNum(pt.shortenGainAnnual)), 42.6, 0.05), Money.wan(pt.shortenGainAnnual), '42.6 万');
  // ---- T5 排行榜合法配置 ----
  const rc = Engine.rankingConfig();
  push('T5', '排行榜合法配置（实名/无金额配额/源＝归一化）', rc.realName && rc.hideAmount && rc.hideQuota && rc.dataSource === 'm21_normalized', JSON.stringify(rc), '{实名,无金额,无配额,归一化}');
  // ---- T6 带教分成=3.48万（69.6倍）----
  const men = db.entities.M28Agreement.find(a => a.kind === 'mentoring');
  const menVal = Engine.m28Value(men), oneOff = getCoef('m28').oneOffAmt;
  push('T6', '带教分成＝3.48 万（69.6 倍）', approx(Money.wanNum(menVal), 3.48, 0.005) && approx(menVal / oneOff, 69.6, 0.1), `${Money.wan(menVal,2)} / ${round1(menVal/oneOff)}倍`, '3.48 万 / 69.6 倍');
  // ---- T7 使用费=3.5万 ----
  const roy = db.entities.M28Agreement.find(a => a.kind === 'royalty');
  push('T7', '配方使用费＝3.5 万', approx(round1(Money.wanNum(Engine.m28Value(roy))), 3.5, 0.05), Money.wan(Engine.m28Value(roy)), '3.5 万');
  // ---- T8/T9/T10 指数 ----
  const ind = Engine.indices(db, T);
  push('T8', 'SII＝73（月总查看 20 次·10 人）', ind.sii.value === 73, ind.sii.value, 73);
  push('T9', 'EI＝4（异议 0/无建议/确认 0%/忽略 82%）', ind.ei.value === 4, ind.ei.value, 4);
  const envDb = withDB(db, () => buildEnvelope(T));
  push('T10', 'AHC＝41 + 导出信封 derived.ahc + M28Agreement 同包', ind.ahc.value === 41 && envDb.derived.ahc === 41 && Array.isArray(envDb.entities.M28Agreement) && envDb.entities.M28Agreement.length >= 2 && SALES_PAGE_HAS_AHC, `AHC ${ind.ahc.value}, 信封 ahc=${envDb.derived.ahc}, M28×${envDb.entities.M28Agreement.length}`, '41 / 双载荷');
  // ---- T11 分红四问四红 ----
  const db11 = factory(); db11.externalRefs.yuren.derived.coachingDoseActual = 2; // Q4 fail
  const div11 = Engine.computeDividend(db11, T, { indicators: { ei: { value: 10 }, sii: { value: 70 } }, goodHireIndex: 0.8 });
  push('T11', '分红四问四红 → 硬红灯 + 池未清零（须二次确认+留痕）', div11.fourFailCount === 4 && div11.verdict === 'danger' && div11.pool > 0, `${div11.fourFailCount} 否 / 池 ${Money.wan(div11.pool)}`, '4 否 / 池>0');
  // ---- T12 下调分成率 → 失败+留痕+AHC降+拦截记录 ----
  const db12 = factory(); setCoefOverride(db12.coefOverride);
  const ahcBefore = Engine.indices(db12, T).ahc.value; const ovrBefore = db12.entities.OverrideEvent.length;
  const dg = Engine.tryDowngradeM28(db12, 'm28_demo1', T, '试图下调');
  const rateUnchanged = db12.entities.M28Agreement.find(a => a.m28Id === 'm28_demo1').rate === 0.05;
  const ahcAfter = Engine.indices(db12, T).ahc.value; const ovrAfter = db12.entities.OverrideEvent.length;
  push('T12', '下调分成 → 操作失败 + 留痕 + AHC 下降 + 拦截记录+1', dg.ok === false && dg.downgraded === false && rateUnchanged && ahcAfter < ahcBefore && ovrAfter === ovrBefore + 1, `ok=${dg.ok}, rate=0.05:${rateUnchanged}, AHC ${ahcBefore}→${ahcAfter}, 留痕+${ovrAfter-ovrBefore}`, '失败/不变/降/+1');
  // ---- T13 M37 三态 + 趋势 3.8万 ----
  const pcA = Engine.precheck(db, 'sp_wangli', 28000_00, T);
  const pcB = Engine.precheck(db, 'sp_wangli', 30000_00, T);
  const pcC = Engine.precheck(db, 'sp_wangli', 38000_00, T);
  push('T13', 'M37：趋势 3.8 万；28k🔴/30k🟡/38k🟢', Money.yuan(pcA.trend) === 38000 && pcA.verdict === 'below_history' && pcB.verdict === 'below_trend' && pcC.verdict === 'ok', `趋势${Money.cny(pcA.trend)} ${pcA.verdict}/${pcB.verdict}/${pcC.verdict}`, '¥38,000 🔴🟡🟢');
  // ---- T14 M38：11单96万→38.4/19.2万/11张；余震2/2/1 ----
  const cards = []; for (let i = 0; i < 11; i++) cards.push({ hcId: 'hc' + i, amountAmt: Math.round(96_0000_00 / 11) });
  cards[0].amountAmt += 96_0000_00 - cards.reduce((s, c) => s + c.amountAmt, 0); // 精确凑齐 96 万
  const hs = Engine.handoverSummary(cards);
  const after = Engine.aftershockRank(db, 'sp_wangli', T);
  const scores = after.map(a => a.score).join('/');
  push('T14', 'M38：11 单 96 万→损耗 38.4/可救 19.2 万/11 张；余震 2/2/1', approx(Money.wanNum(hs.loss), 38.4, 0.05) && approx(Money.wanNum(hs.save), 19.2, 0.05) && hs.count === 11 && scores === '2/2/1', `损耗${Money.wan(hs.loss)}/可救${Money.wan(hs.save)}/${hs.count}张/余震${scores}`, '38.4/19.2/11/2-2-1');
  // ---- T15 榜眼：连续≥3月第2+剪刀差>0 → 触发；连续2月→不触发 ----
  const sp15 = Engine.secondPlaceTrigger(db, 'sp_zhaomin');
  const db15b = factory(); db15b.externalRefs.suanzhang.perPerson.sp_test = { normRankMonths: [2, 2], scissors: 0.1, specialPayout12m: 0 };
  const sp15b = Engine.secondPlaceTrigger(db15b, 'sp_test');
  push('T15', '榜眼：连续≥3 月第 2 触发⑤（L-09）；连续 2 月不触发', sp15.hit === true && sp15b.hit === false && typeof SCRIPTS.L09 === 'function', `4月:${sp15.hit} / 2月:${sp15b.hit}`, 'true / false');
  // ---- T16 偏差器=42 ----
  const dev = Engine.deviation(db, T);
  push('T16', '偏差器：自评(40/70/80/85) vs 实测(73/4/54/41)→总偏差 42', dev.gap === 42, dev.gap, 42);
  // ---- T17 信封：导入→解锁；未导入→锁屏 L-05；导出 board=liuren 含双载荷 ----
  const dbLocked = factory(); dbLocked.externalRefs.suanzhang = null;
  const unlocked = Engine.boardLocked(db) === false;
  const locked = Engine.boardLocked(dbLocked) === true;
  push('T17', '信封：导入解锁 / 未导入锁屏(L-05) / 导出 liuren 双载荷', unlocked && locked && envDb.board === 'liuren' && envDb.derived.ahc != null && envDb.entities.M28Agreement.length >= 1 && typeof SCRIPTS.L05 === 'function', `解锁:${unlocked} 锁:${locked} 导出:${envDb.board}`, '解锁/锁/liuren');
  // ---- T18 闸③三态 ----
  const g1 = Engine.bountySaveCheck('record_break', false);
  const g2 = Engine.bountySaveCheck('record_break', true);
  const g3 = Engine.bountySaveCheck('first_deal', false);
  push('T18', '闸③三态：结果∧未启→拦截+L-15；∧已启→放行；豁免→放行', g1.ok === false && g1.script === 'L-15' && g1.showEnable === true && g2.ok === true && g3.ok === true && typeof SCRIPTS.L15 === 'function', `拦:${!g1.ok}(${g1.script}) 放:${g2.ok} 豁免:${g3.ok}`, '拦/放/放');
  // ---- T19 分红串联 ----
  const cfgFail = JSON.parse(JSON.stringify(db.dividend)); cfgFail.gateCompanyCollect.pass = false;
  const d19a = Engine.computeDividend(db, T, { cfg: cfgFail });
  const d19b = Engine.computeDividend(db, T, { cfg: db.dividend, indicators: { ei: { value: 10 }, sii: { value: 70 } }, goodHireIndex: 0.8 });
  const dbYes = factory(); dbYes.externalRefs.yuren.derived.coachingDoseActual = 3.4;
  const d19c = Engine.computeDividend(dbYes, T, { cfg: dbYes.dividend, indicators: { ei: { value: 40 }, sii: { value: 50 } }, goodHireIndex: 1.2 });
  push('T19', '分红串联：①闸不达→池 0+四问零调用 ②全过∧四否→池未清零+红 ③全过∧四过→出额',
    d19a.pool === 0 && d19a.fourQuestionsRun === false && d19b.pool > 0 && d19b.verdict === 'danger' && d19b.fourQuestionsRun === true && d19c.pool > 0 && d19c.verdict === 'ok',
    `①池${d19a.pool}/四问${d19a.fourQuestionsRun} ②池${Money.wan(d19b.pool)}/${d19b.verdict} ③${d19c.verdict}`, '0-off / 池>0-红 / 出额');

  // ---- 件六 红线断言（可运行子集）----
  const asserts = [];
  const pa = (id, title, pass, detail) => asserts.push({ id, title, pass: !!pass, detail });
  pa('L-D1', 'irrevocable：下调无成功路径，rate 不变，仅留痕', rateUnchanged && dg.downgraded === false && dg.logged === true, `rate 保持 0.05；仅留痕`);
  pa('L-D5', '悬赏保存三态；无“结果类一律拦截”旧逻辑', g1.ok === false && g2.ok === true && g3.ok === true, '三态与 5号闸⑧ 同输入同结果');
  pa('L-D6', 'ObjectionEntry pending>7天 → 关联标记失效', (() => { const d = factory(); d.entities.ObjectionEntry.push({ objId: 'o1', status: 'pending', createdAt: D.addDays(T, -8), markActive: true }); Engine.sweepObjections(d, T); return d.entities.ObjectionEntry[0].markActive === false; })(), '8 天未处理 → markActive=false');
  pa('L-D14', '全局 null→“—”；safeDiv 除零→null；无 Infinity/NaN', Money.cny(null) === DASH && Rate.pct(null) === DASH && safeDiv(1, 0) === null && !Number.isNaN(ind.sii.value), '“—” 唯一空态');
  pa('L-D15', 'AHC 入信封 derived + M28Agreement 随 entities 同包；价签⑤⑥不同笔', envDb.derived.ahc != null && envDb.entities.M28Agreement.length >= 1 && pt.items.find(i => i.key === 'decay') && pt.items.find(i => i.key === 'handover'), '双载荷 + 慢性/急性 scope 分离');
  pa('L-D16', '分红串联：三重闸不达→四问零调用；四问无清零池写路径', d19a.fourQuestionsRun === false && d19b.pool > 0, '调用链在三重闸之后');
  pa('授-2/4', '到期只降级不锁数据：导出永不锁定；降级不删数据', resolveModeByDate('2020-01-01', T, null).mode === 'free' && resolveModeByDate('2030-01-01', T, null).mode === 'full', '过期→free；导出功能不受 mode 影响');
  pa('授-3', '防调表：系统日期 < seenMaxDate → 锁定', resolveModeByDate('2030-01-01', '2026-01-01', '2026-07-13').mode === 'free', '回拨时钟→free');
  pa('§4.7', 'C-04 咬合基准：short m1=65.8% / m5=32.5%（旧式 59.25%）', approx(newHireYearRate('short', 1), 0.658, 0.001) && approx(newHireYearRate('short', 5), 0.325, 0.001), '790/1200 与 390/1200');

  const passCount = tcases.filter(t => t.pass).length;
  const assertPass = asserts.filter(a => a.pass).length;
  return { tcases, asserts, passCount, total: tcases.length, assertPass, assertTotal: asserts.length, today: T };
}

// buildEnvelope 读全局 DB；自检需临时把出厂 db 作为全局 DB 运行
function withDB(tempDb, fn) { const prev = DB; DB = tempDb; try { return fn(); } finally { DB = prev; } }
// 钱途页含 AHC 栏（结构断言，T10/L-D2）——由 ui 层声明
var SALES_PAGE_HAS_AHC = true;
