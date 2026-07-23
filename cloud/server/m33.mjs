/* ============================================================
   C9 · M33 产品证据包服务（v5.1 §5.2 M33 行：S-06 结语代码写死不可编辑）
   🔒 口径出处：3号算账器 §3.5（唯一权威）：四证据判定式
     ① 赢单天花板 winRate < 20%（won/(won+lost)；无 lost 单 → null"需录入 lost 单点亮"）
     ② 品类退款集中：max(品类退款占比 ÷ 品类回款占比) > 3×（当月；无退款 → null）
     ③ 被迫折扣：折扣率 > 15% ∧ 期末冲刺占比 > 60%（当月 discount_entries，闸⑤同源分子分母）
     ④ 离职者低毛利品类占比中位 > 团队均值 × 1.5（低毛利品类 = 毛利率 < 22% 熔断线）
     判定唯一出口 = domain.m33Evidence（服务层只组装输入，零阈值重写）。
   🔴 S-06 结语（3号 话术库 S-06，S-D7）：代码写死不可编辑，一个字不能改——
     本模块顶层 const 为唯一持有点；无任何写路径、无任何函数参数可改写它
     （逐字比对 + 无编辑入口机检见 c9.test.mjs ①）。
   只读模块（零写库、零事件）；时钟注入（公约 C-14）：今天 = ctx.today，零真实时钟调用。
   ============================================================ */
import { m33Evidence } from '../domain/suanzhang.mjs';
import { getCoef, safeDiv, monthOf, median } from '../domain/shared.mjs';

/* 🔴 S-06 固定结语（3号 v3.3 话术库 S-06 逐字；代码写死不可编辑） */
export const S06_TEXT = '以上是数据。判断归你。但请记住系统的边界：这个系统不会让一个卖不动的产品卖动。销售只是产品的传声筒。产品是地基。地基不稳，一定翻车。而产品不好的公司，销冠会最先流失——因为销冠最不能忍受"卖不动"。如果你看完这四组数据，仍然认为产品没有问题——我们尊重你的判断。系统会继续为你优化其他环节。但我们必须诚实地告诉你：如果问题在地基，那么我们能帮你的，最多是让翻车晚一点发生。';

/* ---------- 证据① 输入：赢单率 = won/(won+lost)；🔴 无 lost 单 → null（样本不足不硬造） ---------- */
async function winRateInput(db, ctx) {
  const { rows } = await db.query(
    `select count(*) filter (where status = 'won')::int  as won,
            count(*) filter (where status = 'lost')::int as lost
       from deals where tenant_id = $1 and deleted_at is null`, [ctx.tenantId]);
  const { won, lost } = rows[0];
  return { won, lost, winRate: (won + lost) > 0 && lost > 0 ? safeDiv(won, won + lost) : null };
}

/* ---------- 证据② 输入：当月 max(品类退款占比 ÷ 品类回款占比)；无退款/无回款 → null ---------- */
async function refundConcentrationInput(db, ctx, month) {
  const { rows: refs } = await db.query(
    `select category_id, coalesce(sum(amount_amt),0)::float8 as amt
       from refund_entries
      where tenant_id = $1 and to_char(refund_date, 'YYYY-MM') = $2 and deleted_at is null
      group by category_id`, [ctx.tenantId, month]);
  const { rows: pays } = await db.query(
    `select category_id, coalesce(sum(payment_amt),0)::float8 as amt
       from deals
      where tenant_id = $1 and status = 'won'
        and to_char(deal_date, 'YYYY-MM') = $2 and deleted_at is null
      group by category_id`, [ctx.tenantId, month]);
  const totalRef = refs.reduce((a, r) => a + Number(r.amt), 0);
  const totalPay = pays.reduce((a, r) => a + Number(r.amt), 0);
  if (!(totalRef > 0) || !(totalPay > 0)) return { refundByCategoryX: null, refundCount: refs.length };
  const payByCat = new Map(pays.map(r => [r.category_id, Number(r.amt)]));
  let x = null;
  for (const r of refs) {
    const xv = safeDiv(Number(r.amt) / totalRef, (payByCat.get(r.category_id) || 0) / totalPay);
    if (xv != null && (x == null || xv > x)) x = xv;
  }
  return { refundByCategoryX: x, refundCount: refs.length };
}

/* ---------- 证据③ 输入：当月折扣率 / 期末冲刺占比（闸⑤同源分子分母） ---------- */
async function forcedDiscountInput(db, ctx, month) {
  const { rows } = await db.query(
    `select coalesce(sum(discount_amt),0)::float8 as disc,
            coalesce(sum(list_price_amt),0)::float8 as list,
            coalesce(sum(discount_amt) filter (where reason = 'period_end_push'),0)::float8 as push
       from discount_entries
      where tenant_id = $1 and to_char(discount_date, 'YYYY-MM') = $2 and deleted_at is null`,
    [ctx.tenantId, month]);
  const { disc, list, push } = rows[0];
  return { discountRate: safeDiv(Number(disc), Number(list)), pushShare: safeDiv(Number(push), Number(disc)) };
}

/* ---------- 证据④ 输入：离职者低毛利品类占比中位 vs 团队整体占比（低毛利=<22% 熔断线） ---------- */
async function leaverCategoryInput(db, ctx, gc) {
  const fuse = gc('suanzhang.categoryFuseMarginRate');
  const { rows } = await db.query(
    `select d.employee_id,
            coalesce(sum(d.payment_amt),0)::float8 as pay,
            coalesce(sum(d.payment_amt) filter (where c.gross_margin_rate < $2),0)::float8 as low_pay,
            bool_or(s.is_active = false or s.leave_date is not null) as leaver
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
       left join salespersons s on s.tenant_id = d.tenant_id and s.id = d.employee_id and s.deleted_at is null
      where d.tenant_id = $1 and d.status = 'won' and d.deleted_at is null
      group by d.employee_id`, [ctx.tenantId, fuse]);
  let teamPay = 0, teamLow = 0;
  const leaverRatios = [];
  for (const r of rows) {
    teamPay += Number(r.pay); teamLow += Number(r.low_pay);
    if (r.leaver === true) {
      const ratio = safeDiv(Number(r.low_pay), Number(r.pay));
      if (ratio != null) leaverRatios.push(ratio);
    }
  }
  return {
    leaverLowMarginRatioMedian: leaverRatios.length ? median(leaverRatios) : null,
    teamLowMarginRatio: safeDiv(teamLow, teamPay),
    leaverCount: leaverRatios.length,
  };
}

/**
 * evidencePack —— 产品证据包：四证据输入组装 → domain.m33Evidence（判定唯一出口）。
 * 🔴 数据缺 → 对应输入 null（"—"/"需补录"），domain 判 false 不硬造（null ≠ 0）。
 * 🔴 s06 = 顶层 S06_TEXT 原样注入：本函数无参数、无路径可改它（S-D7 无编辑入口）。
 */
export async function evidencePack(db, ctx, { gc = getCoef } = {}) {
  const month = monthOf(ctx.today);
  const w = await winRateInput(db, ctx);
  const r = await refundConcentrationInput(db, ctx, month);
  const f = await forcedDiscountInput(db, ctx, month);
  const l = await leaverCategoryInput(db, ctx, gc);
  const inputs = {
    winRate: w.winRate,
    refundByCategoryX: r.refundByCategoryX,
    discountRate: f.discountRate, pushShare: f.pushShare,
    leaverLowMarginRatioMedian: l.leaverLowMarginRatioMedian, teamLowMarginRatio: l.teamLowMarginRatio,
  };
  const evidence = m33Evidence(inputs, gc);        // 🔒 四证据判定唯一出口（3号 §3.5）
  return {
    month, inputs, evidence,
    detail: { won: w.won, lost: w.lost, refundCount: r.refundCount, leaverCount: l.leaverCount },
    s06: S06_TEXT,                                 // 🔴 固定结语：写死、不可编辑
  };
}
