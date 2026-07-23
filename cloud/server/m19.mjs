/* ============================================================
   C6 · M19 产品组合利润雷达（v5.1 §5.1 M19 行 🔴取代）
   🔒 口径出处：
     - 3号算账器 M19 品类雷达 + 闸⑨ 品类泄漏：毛利率 < categoryFuseMarginRate(22%)
       ∧ 回款占比 > categoryFuseShareRate(20%) → 🔴 低价熔断（话术 S-11）
       —— 熔断判定唯一出口 = domain.categoryFuse，服务层零阈值重写
     - 公约 §4.4 杠杆链：净贡献 = 线索 × 转化率 × 客单价 × 毛利率 − laborCost
       —— 五因子分解唯一口径 = domain.leverageChain；除法只经 safeDiv（分母 0 → null "—"）
   v5.1 云端增量：管理端专属；杠杆链下钻页（leverageDrill）。
   - 毛利已回款口径（won ∧ paid_date），快照缺失回退品类毛利率（与 m2/m21 同法）
   - laborCost 🔒 走 m2.laborCostFor（公约 §4.2 宪法函数）
   - 时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today。只读模块（不落库）。
   ============================================================ */
import { categoryFuse, leverageChain } from '../domain/suanzhang.mjs';
import { safeDiv, getCoef, addDays, monthOf } from '../domain/shared.mjs';
import { laborCostFor } from './m2.mjs';

/**
 * categoryRadar —— 逐品类：回款占比 / 毛利率 / 熔断灯（近 windowDays=365 天，已回款口径）。
 * fused = domain.categoryFuse(毛利率, 回款占比)——闸⑨ 判定式，阈值只经 getCoef。
 */
export async function categoryRadar(db, ctx, { windowDays = 365, gc = getCoef } = {}) {
  const from = addDays(ctx.today, -windowDays);
  const { rows } = await db.query(
    `select d.category_id, max(c.name) as name,
            coalesce(sum(d.payment_amt),0)::float8 as pay,
            coalesce(sum(round(d.payment_amt * coalesce(d.margin_rate_snapshot, c.gross_margin_rate))),0)::float8 as margin,
            count(*)::int as deal_count
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.status = 'won' and d.paid_date is not null
        and d.paid_date >= $2 and d.paid_date <= $3 and d.deleted_at is null
      group by d.category_id`, [ctx.tenantId, from, ctx.today]);
  const totalPay = rows.reduce((a, r) => a + Number(r.pay), 0);
  const items = rows.map(r => {
    const pay = Number(r.pay), margin = Number(r.margin);
    const payShare = safeDiv(pay, totalPay);
    const marginRate = safeDiv(margin, pay);
    return {
      categoryId: r.category_id, name: r.name, dealCount: r.deal_count,
      payAmt: pay, marginAmt: margin, payShare, marginRate,
      fused: categoryFuse(marginRate, payShare, gc),     // 🔴 闸⑨：<22% ∧ >20% → 熔断
    };
  }).sort((a, b) => (b.payShare ?? 0) - (a.payShare ?? 0));
  return { windowDays, totalPayAmt: totalPay, items, anyFused: items.some(i => i.fused) };
}

/**
 * leverageDrill —— 杠杆链下钻（某月租户级五因子分解，v5.1 M19 云端增量）。
 * 五因子：线索量（lead_assignments 分配+自开发）/ 转化率 = 成交笔数÷线索 /
 * 客单价 = 回款÷笔数 / 毛利率 = 毛利÷回款 / laborCost = Σ在职销售当月 laborCostFor。
 * 全部除法走 safeDiv（分母 0 → null，展示"—"）；
 * 估算净贡献 = domain.leverageChain（公约 §4.4 唯一分解口径）。
 */
export async function leverageDrill(db, ctx, { month, gc = getCoef } = {}) {
  if (!month) month = monthOf(ctx.today);
  const { rows: la } = await db.query(
    `select coalesce(sum(assigned_leads + self_dev_leads),0)::int as leads
       from lead_assignments
      where tenant_id = $1 and month = $2 and deleted_at is null`, [ctx.tenantId, month]);
  const leads = la[0].leads;
  const { rows: ds } = await db.query(
    `select count(*)::int as dc, coalesce(sum(d.payment_amt),0)::float8 as pay,
            coalesce(sum(round(d.payment_amt * coalesce(d.margin_rate_snapshot, c.gross_margin_rate))),0)::float8 as margin
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.status = 'won' and d.paid_date is not null
        and to_char(d.paid_date, 'YYYY-MM') = $2 and d.deleted_at is null`, [ctx.tenantId, month]);
  const dealCount = ds[0].dc, payAmt = Number(ds[0].pay), marginAmt = Number(ds[0].margin);
  const { rows: sps } = await db.query(
    `select id from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales') order by id`, [ctx.tenantId]);
  let laborCostAmt = 0;
  for (const sp of sps) {
    laborCostAmt += (await laborCostFor(db, ctx, { employeeId: sp.id, month })).laborCostAmt;
  }
  const convRate = safeDiv(dealCount, leads);
  const aov = safeDiv(payAmt, dealCount);
  const marginRate = safeDiv(marginAmt, payAmt);
  return {
    month,
    factors: { leads, convRate, aov, marginRate, laborCostAmt },
    dealCount, payAmt, marginAmt,
    /* 🔒 公约 4.4：估算净贡献 = 五因子相乘 − laborCost（domain.leverageChain 唯一出口） */
    estimatedNetContributionAmt: leverageChain({ leads, convRate, aov, marginRate, laborCostAmt }),
  };
}
