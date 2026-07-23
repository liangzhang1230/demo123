/* ============================================================
   C8 · 按角色出数据包（v5.1 §8 权限矩阵的物理落点 · C8 起步版）
   🔒 口径出处：
     - 公约 A-08 利润隔离（v5.1 §8 逐字）：销售端 bundle 中 毛利/净利/laborRoi/
       客单/剪刀差/折扣泄漏/UER 零出现，唯一豁免本人回款（字段名 myCollected*）。
       🔴 机检：JSON.stringify(salesBundle) 正则
       /grossMargin|netContribution|laborRoi|aov|scissors|discountLeak|uer|rank|peerCompare|redAlert/i
       零命中（c8.test.mjs ③）。
     - A-09 钱途页只供氧：禁排名/禁对比/禁员工红色预警——bundle 零 rank/compare/
       redAlert 字段；第⑤栏 AHC 红为"老板的红灯"豁免（band 值放行）。
     - 4号 §3.7 16.6 钱途页七栏：①现在 ②下一步 ③台阶 ④我的产权 ⑤🔴老板的信用
       （AHC+四拆解+拦截记录+"ⓘ这个分数由系统计算，老板改不了"）⑥战绩 ⑦灯塔
       + 底部 M30 双通道入口。钱途页 = 销售端首屏（v5.1 M16 行）。
     - L-D2：AHC 在销售端渲染（本 bundle 第⑤栏）；老板端零编辑入口——bossBundle
       只读 readIndices，唯一写点 = m29.computeIndices（写侧机检 c8 ①）。
   读侧组装原则：本模块零计算（金额求和的 SQL 聚合除外）、零写库；
     台阶 = 当期方案版本矩阵 T × 定价器 M 档步进（menuQuotaSteps）——无版本 → "—"。
   - 时钟注入（公约 C-14）：零真实时钟调用
   ============================================================ */
import { getCoef, monthOf } from '../domain/shared.mjs';
import { incomeFor, planVersionAt } from './m2.mjs';
import { readIndices, interceptRecords, selfDeviation, bossOpLogOn } from './m29.mjs';
import { listM28, m28Board } from './m28.mjs';
import { guardLine, dependencyRadarNow, talkListNow, lighthouse } from './m16.mjs';
import { channelBoard } from './m30.mjs';
import { prevMonth } from './m21.mjs';

const lastNMonths = (month, n) => {
  const out = [month];
  for (let i = 1; i < n; i++) out.unshift(prevMonth(out[0]));
  return out;
};

/* 本人回款（唯一豁免字段 myCollected*）：won ∧ paid_date 逐月 */
async function myCollectedByMonth(db, ctx, spId, months) {
  const ph = months.map((_, i) => '$' + (i + 3)).join(',');
  const { rows } = await db.query(
    `select to_char(paid_date, 'YYYY-MM') as month, coalesce(sum(payment_amt), 0)::bigint as amt
       from deals
      where tenant_id = $1 and employee_id = $2 and status = 'won' and paid_date is not null
        and to_char(paid_date, 'YYYY-MM') in (${ph}) and deleted_at is null
      group by to_char(paid_date, 'YYYY-MM')`, [ctx.tenantId, spId, ...months]);
  const m = new Map(rows.map(r => [r.month, Number(r.amt)]));
  return months.map(mm => ({ month: mm, myCollectedAmt: m.get(mm) ?? 0 }));
}

/**
 * 🔴 salesBundle —— 钱途页七栏（销售端首屏数据包；A-08/A-09 机检对象）。
 * 缺数据 → 对应栏 null（"—"，四态），绝不硬造。
 */
export async function salesBundle(db, ctx, { spId, gc = getCoef }) {
  const cur = monthOf(ctx.today);
  const { rows: sp } = await db.query(
    `select id, name, hire_date::text as hire_date, base_salary_amt::bigint as base
       from salespersons where tenant_id = $1 and id = $2 and deleted_at is null`, [ctx.tenantId, spId]);
  if (!sp.length) return null;

  /* ① 现在 = 底薪 + 本人回款（+ 本人收入——公约 §4.1，本人可见） */
  const income = await incomeFor(db, ctx, { employeeId: spId, month: cur });
  const collected = await myCollectedByMonth(db, ctx, spId, [cur]);

  /* ②③ 下一步档 / 台阶：当期方案版本矩阵 T × 定价器 M 档步进；无版本 → "—" */
  const plan = await planVersionAt(db, ctx, ctx.today);
  const matrixTAmt = plan && plan.matrix_t_amt != null ? Number(plan.matrix_t_amt) : null;
  let ladder = null, next = null;
  if (matrixTAmt != null) {
    const steps = gc('dingjia.menuQuotaSteps');                       // [0.8, 1.0, 1.2]
    ladder = steps.map(s => ({ stepRate: s, targetAmt: Math.round(matrixTAmt * s),
      reached: income.incomeAmt != null && income.incomeAmt >= Math.round(matrixTAmt * s) }));
    next = ladder.find(l => !l.reached) ?? null;
  }

  /* ④ 我的产权 = 本人 M28 协议 */
  const property = await listM28(db, ctx, { masterId: spId });

  /* ⑤ 🔴 老板的信用：AHC + 四拆解 + 拦截记录 + 固定说明（老板端零编辑入口——读侧唯一） */
  const ind = await readIndices(db, ctx);
  const bossCredit = {
    ahc: ind.ahc.value,
    band: ind.ahc.json ? ind.ahc.json.band : null,                    // ⑤栏红 = 老板的红灯（A-09 豁免）
    four: ind.ahc.json ? ind.ahc.json.four : null,
    interceptRecords: await interceptRecords(db, ctx),
    computedAt: ind.ahc.computedAt,
    note: 'ⓘ 这个分数由系统计算，老板改不了',
  };

  /* ⑥ 战绩 = 本人回款近 6 月（唯一豁免） */
  const record = await myCollectedByMonth(db, ctx, spId, lastNMonths(cur, 6));

  /* ⑦ 灯塔 + M30 双通道入口（灯塔=公司纪录（供氧锚点）+ 本人最好成绩；
     🔴 不含其他人逐人数字——L-10d"永不公开别人拿多少"，纪录本身为灯塔设计豁免） */
  const lhFull = await lighthouse(db, ctx);
  const lh = { mode: lhFull.mode, metric: lhFull.metric, record: lhFull.record,
    myBest: lhFull.personalBest[spId] ?? null, asOf: lhFull.asOf };

  return {
    spId, name: sp[0].name, asOf: ctx.today,
    now: { month: cur, baseSalaryAmt: sp[0].base == null ? null : Number(sp[0].base),
      incomeAmt: income.incomeAmt, myCollectedAmt: collected[0].myCollectedAmt },
    next, ladder,
    property,
    bossCredit,
    record,
    lighthouse: lh,
    channels: { objection: true, suggestion: true },                  // M30 双入口（表现层挂按钮）
  };
}

/**
 * bossBundle —— 老板端全量（§8 权限矩阵第一行：全公司经营数据归老板）。
 * AHC 同为只读（readIndices）：全员可见、无人可编辑（含老板——L-D2）。
 * 依赖 M21 的部分未运行 → 诚实锁定标记（A-11，不放水）。
 */
export async function bossBundle(db, ctx, { gc = getCoef } = {}) {
  let talk;
  try { talk = { locked: false, list: await talkListNow(db, ctx, { gc }) }; }
  catch (e) {
    if (e.code === 'A11_LOCKED') talk = { locked: true, code: 'A11_LOCKED' };
    else throw e;
  }
  return {
    asOf: ctx.today,
    indices: await readIndices(db, ctx),                              // 四指数（只读；含四拆解 json）
    selfDeviation: await selfDeviation(db, ctx),
    bossOpLogOn: await bossOpLogOn(db, ctx),                          // L-D10 开关明示
    m28: await m28Board(db, ctx, { gc }),
    interceptRecords: await interceptRecords(db, ctx),
    guard: await guardLine(db, ctx),
    dependency: await dependencyRadarNow(db, ctx, { gc }),
    talk,
    channels: await channelBoard(db, ctx),
  };
}
