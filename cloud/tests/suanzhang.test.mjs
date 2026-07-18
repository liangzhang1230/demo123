/* ============================================================
   件七 · 22 条对拍（T1–T21 + T8b）—— Node 服务端版
   fixture 逐字提取自原版单文件 runSelfTest（件七的可执行版）。
   时钟注入（公约 C-14 / R-11 / S-C11）：TEST_TODAY='2026-07-13'，
   对拍不依赖真实系统时钟。运行：node cloud/tests/suanzhang.test.mjs
   ============================================================ */
import {
  commission, netContribution,
  m21Normalize, realP90Factor,
  uerBand, uerObsGate, stddev,
  personAttribution, propertyValue,
  dvi, hijackVerdict, gateDiscountLeak,
  amortizeForScissors, m34Arbitrage, m35Misfire, m36BunchRate,
  hongbaoCheck, stopBleedTriage,
  buildSuanzhangEnvelope, toExternalRef, staleDays, isStale,
  fmtPct, fmtYuan, fmtWan,
} from '../domain/suanzhang.mjs';

const TEST_TODAY = '2026-07-13';           // 🔴 注入基准日（与 1号/2号同源，公约 C-14）
const approx = (a, b, e) => a != null && Math.abs(a - b) <= (e || 1e-6);

/* ---- 固定 fixture（原版自检区逐字提取，独立于任何录入数据） ---- */
const NUKE = [['A', 180, 12.0e6], ['B', 120, 10.0e6], ['C', 120, 9.5e6], ['D', 100, 8.0e6], ['E', 100, 7.5e6],
  ['F', 100, 7.0e6], ['G', 85, 6.0e6], ['H', 85, 5.0e6], ['I', 80, 4.0e6], ['J', 30, 3.0e6]]
  .map(p => ({ id: p[0], name: p[0], leads: p[1], grossMarginAmt: p[2], selfDevLeads: 0 }));
const M = m21Normalize(NUKE);
const rid = x => M.rows.find(r => r.id === x);
const NET = { grossMarginAmt: 100e6, laborCostAmt: 46.667e6, opCostAmt: 15e6, refundMarginAmt: 2e6, discountMarginAmt: 7.2e6 };
const UER = { A: -1.5e6, B: -1.0e6, C: -0.9e6, D: -0.7e6, E: -0.5e6, F: 0.1e6, G: -0.3e6, H: -0.1e6, I: 0.0, J: 0.9e6 };
const uarr = Object.values(UER);
const umean = uarr.reduce((a, b) => a + b, 0) / uarr.length;
const usig = stddev(uarr);

const T = [];
const t = (id, desc, ok) => T.push({ id, desc, ok: !!ok });

/* T1 全链提成占毛利 27.06%（与定价器咬合；含黄金值 commission(1000000,0.5,0.2706)=135300） */
t('T1', '提成占毛利27.06%；commission(1000000,.5,.2706)=135300',
  approx(+((commission(200e6, 0.5, 0.2706) / 100e6) * 100).toFixed(2), 27.06) &&
  commission(1000000, 0.5, 0.2706) === 135300);

/* T2 净贡献 ¥291,330（29.1%）＝ 毛利100万−人力46.667万−经营15万−退款2万−折扣7.2万 */
const net = netContribution(NET);
t('T2', '净贡献¥291,330（29.1%）', fmtYuan(net) === '¥291,330' && fmtPct(net / NET.grossMarginAmt) === '29.1%');

/* T3 labor_roi = 2.14 */
t('T3', 'labor_roi=2.14', approx(+(NET.grossMarginAmt / NET.laborCostAmt).toFixed(2), 2.14));

/* T4–T6 M21 核弹表 */
t('T4', '失衡率70%', fmtPct(M.imbalanceRate) === '70.0%');
t('T5', 'rank(J)=1', rid('J').normRank === 1);
t('T6', 'rank(A)=8（原始#1）', rid('A').normRank === 8 && rid('A').origRank === 1 && rid('J').origRank === 10);

/* T7 DVI = 54 🟡 */
t('T7', 'DVI=54🟡', Math.round(dvi({ reportRate: .85, medianEntryLagDays: 3, leadAttribRate: .34, discountRecordRate: .40, dealCount: 100 })) === 54);

/* T8 / T8b / T9 / T10 UER */
t('T8', 'A 的 UER=−1.5万🔴', fmtWan(UER.A) === '-1.5 万' && uerBand(UER.A, usig) === 'red');
t('T8b', '3.3b 三分支 leak/territory/undetermined',
  personAttribution({ discountLeakRate: .11, teamDiscountLeakRate: .05, complaintRate: .03, teamComplaintRate: .03, leadIndex: 1.8 }).verdict === 'leak' &&
  personAttribution({ discountLeakRate: .04, teamDiscountLeakRate: .05, complaintRate: .02, teamComplaintRate: .03, leadIndex: .3 }).verdict === 'territory' &&
  personAttribution({ discountLeakRate: .05, teamDiscountLeakRate: .05, complaintRate: .03, teamComplaintRate: .03, leadIndex: 1 }).verdict === 'undetermined');
t('T9', 'J UER=+0.9万🟢；均值−0.4万', fmtWan(UER.J) === '0.9 万' && uerBand(UER.J, usig) === 'green' && fmtWan(umean) === '-0.4 万');
t('T10', '观测<48→null', uerObsGate(40) === false && uerObsGate(48) === true);

/* T11 剪刀差摊薄：年终奖 12 万 ÷ 12 正确入月 */
t('T11', '年终奖12万÷12', amortizeForScissors('year_end_bonus', 12e6, 1) === 1e6);

/* T12 闸⑤ 折扣泄漏 7.2% 红 / 期末占比 58% 红 */
const g5 = gateDiscountLeak([
  { listPriceAmt: 58e6, discountAmt: 4176000, reason: 'period_end_push' },
  { listPriceAmt: 42e6, discountAmt: 3024000, reason: 'competitive_pressure' },
]);
t('T12', '闸⑤ 7.2%红/58%红', fmtPct(g5.leakRate) === '7.2%' && g5.leakRed && fmtPct(g5.pushShare) === '58.0%' && g5.pushRed);

/* T13 M34：折扣差 5.6pp、年化泄漏 33.6 万、聚集指数 2.6；threshold=null→聚集"—" */
const m34 = m34Arbitrage(.087, .031, 600e6, 50e6, 2.6);
const m34NoThr = m34Arbitrage(.087, .031, 600e6, null, null);
t('T13', 'M34 5.6pp/33.6万/2.6；无阈值→聚集—',
  approx(+(m34.diff * 100).toFixed(1), 5.6) && fmtWan(m34.annualLeakAmt) === '33.6 万' && m34.bunchIndex === 2.6 && m34.red &&
  m34NoThr.bunchIndex == null && m34NoThr.red);

/* T14 M35：J 拟淘汰 → jump=9 ≥ ceil(10×0.3)=3 → 警报 */
const mm = m35Misfire(10, 1, 10);
t('T14', 'M35 jump=9≥3', mm.jump === 9 && mm.threshold === 3 && mm.misfire);

/* T15 M36：61% > 40% 红；<30 人天 → rate:null */
const cc = [...Array(61).fill(32), ...Array(39).fill(20)];
const m36 = m36BunchRate(cc, 30);
t('T15', 'M36 61%红；<30人天→null', fmtPct(m36.rate) === '61.0%' && m36.red && m36BunchRate(cc.slice(0, 20), 30).rate === null);

/* T16 红包 rule①②（200元<日均300×2 → ①；第3笔即时无条件 → ②） */
const hb = hongbaoCheck({ amount: 20000, dailyAvgCommission: 30000, timing: 'immediate', hasCondition: false, rolling12ImmediateUncondCount: 3 });
t('T16', '红包 rule①②', hb.rule1 && hb.rule2);

/* T17 止血双校验：线索指数 0.3 → 拦截 S-13；UER>0 → 提示卡 */
const sa = stopBleedTriage({ zeroEventDays: 30, isActivePaid: true, leadIndex: 0.3, uer: null });
const sb = stopBleedTriage({ zeroEventDays: 30, isActivePaid: true, leadIndex: 1, uer: 5e5 });
t('T17', '止血 拦截/提示', sa.block && sa.verdict === 'starved' && !sb.block && sb.verdict === 'invisible_work');

/* T18 信封：derived 四项齐全 + ExternalRef 只读缓存 */
const env = buildSuanzhangEnvelope(TEST_TODAY, { realP90Factor: 1.44, dvi: 54, imbalanceRate: .7, uerTeamMean: -4e5 }, {}, 'h');
t('T18', '信封 derived 四项 + ExternalRef',
  ['realP90Factor', 'dvi', 'imbalanceRate', 'uerTeamMean'].every(k => k in env.derived) &&
  env.schema === 'skab_v1' && env.board === 'suanzhang' &&
  toExternalRef({ board: 'liuren', exportedAt: '2026-01-10', derived: { ahc: 41 } }, TEST_TODAY).derived.ahc === 41);

/* T19 realP90Factor=1.44（R-7 法）；样本<8→null */
t('T19', 'realP90Factor=1.44；<8→null',
  approx(+realP90Factor([5, 6, 7, 8, 9, 10, 11, 12, 14, 18]).toFixed(2), 1.44) && realP90Factor([5, 6, 7]) === null);

/* T20 闸⑪ 三证据链 V-A / V-B / V-C */
const v1 = hijackVerdict({ ahc: 41, m28Coverage: 0, irrevocable: false });
const v2 = hijackVerdict({ ahc: 85, m28Coverage: .4, irrevocable: true });
const v3 = hijackVerdict({ ahc: null, m28Coverage: null, irrevocable: false });
t('T20', '闸⑪ V-A/V-B/V-C',
  v1.verdict === 'pointed_hoarding' && v1.bad === 3 &&
  v2.verdict === 'not_supported' && v2.bad === 0 &&
  v3.verdict === 'insufficient' && v3.missingList.includes('AHC') && v3.missingList.includes('M28 协议数'));

/* T21 新鲜度：staleDays=184>90 → 🟡；过期不改 verdict */
const d = staleDays(TEST_TODAY, '2026-01-10');
t('T21', '新鲜度184>90；过期不改 verdict',
  d === 184 && isStale(TEST_TODAY, '2026-01-10') && !isStale(TEST_TODAY, TEST_TODAY) &&
  v1.verdict === 'pointed_hoarding');

/* ---- 附加内核咬合（不计入 22 徽章，仅防移植回归；失败同样红） ---- */
const extra = [];
extra.push(['X1 产权价值 minEach 兜底', propertyValue([1, 2, 3], [1, 2, 3, 4], 6, 6) === null &&
  approx(propertyValue([2, 2, 2, 2], [1, 1, 1, 1], 6, 6), 1)]);

/* ---- 输出 ---- */
let pass = 0;
for (const x of T) { if (x.ok) pass++; console.log(`${x.ok ? '✓' : '✗'} ${x.id.padEnd(4)} ${x.desc}`); }
let extraFail = 0;
for (const [name, ok] of extra) { if (!ok) { extraFail++; console.log(`✗ ${name}`); } }
console.log(`\n${pass}/${T.length} 绿${pass === T.length ? '（三绿=收货）' : '（有红=原样发回修）'}  · TEST_TODAY=${TEST_TODAY}`);
if (pass !== T.length || extraFail) process.exit(1);
