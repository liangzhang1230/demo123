/* ============================================================
   C9 · M23 提拔预测八维服务（v5.1 §5.2 M23 行 · 3号 闸⑥ · 🔴 老板端专属）
   🔒 口径出处：3号算账器 §3.6 闸⑥（唯一权威）：八维度 =
     ①归一排名 ②客户集中度 ③月度方差 ④陪访带教 ⑤成就vs自恋
     ⑥折扣泄漏 ⑦客诉退款 ⑧UER —— 话术 S-08（QJE 三发现，有源量级：
     被提拔者售前业绩每翻倍，其下属产出约 −6%～−7.5%，Benson-Li-Shue 2019 QJE）。
   🔴 前置：requireM21（闸① A-11——"提拔"在锁清单里，未归一化 → 本功能锁定）。
   🔴 数据不足维显 null（"—"），不硬造（公约 A-19 / null ≠ 0）：
     ②客户集中度（云端 deals 无客户字段）、⑤成就vs自恋（访谈/测评维，无数据源）恒 null；
     其余维可算则算、样本不足 null。
   🔴 bossOnly: true —— 老板端专属标记：bundles 层裁剪备注——salesBundle 永不
     注入本模块任何输出（八维含 rank/uer/discountLeak 等 A-08/A-09 禁词字段，
     进销售端即违宪；c8 ③ 正则机检为其兜底）。
   只读模块（零写库、零事件）；时钟注入（公约 C-14）：今天 = ctx.today，零真实时钟调用。
   ============================================================ */
import { getCoef, safeDiv, addDays, mean, stddevP } from '../domain/shared.mjs';
import { requireM21 } from './m21.mjs';
import { personUER } from './m32.mjs';

/* ---------- ①③ 归一排名 + 月度方差（m21_norms 逐月，排名唯一合法输入） ---------- */
async function normDims(db, ctx, spId) {
  const { rows } = await db.query(
    `select month, norm_margin::float8 as nm, norm_rank
       from m21_norms where tenant_id = $1 and sp_id = $2 order by month`, [ctx.tenantId, spId]);
  const latest = rows.length ? rows[rows.length - 1] : null;
  const series = rows.filter(r => r.nm != null).map(r => Number(r.nm));
  let cv = null;
  if (series.length >= 3) {
    const m = mean(series), sd = stddevP(series);
    cv = (m != null && m !== 0 && sd != null) ? sd / m : null;   // 变异系数：越低越稳
  }
  return {
    normRank: latest ? latest.norm_rank : null, rankMonth: latest ? latest.month : null,
    monthsObserved: rows.length, varianceCv: cv,
  };
}

/* ---------- ④ 陪访带教：近90天 作为带教方的已确认回执数（coaching_acks，ZE-08） ---------- */
async function coachingDim(db, ctx, spId) {
  const from = addDays(ctx.today, -90);
  const { rows } = await db.query(
    `select count(*)::int as n from coaching_acks
      where tenant_id = $1 and manager_id = $2 and employee_ack_status = 'confirmed'
        and manager_reported_at >= $3 and deleted_at is null`, [ctx.tenantId, spId, from]);
  return rows[0].n;
}

/* ---------- ⑥ 折扣泄漏：近12月 个人 Σdisc/Σlist vs 团队（3.3b 同源分子分母） ---------- */
async function discountDim(db, ctx, spId) {
  const from = addDays(ctx.today, -365);
  const { rows } = await db.query(
    `select employee_id, coalesce(sum(discount_amt),0)::float8 as disc,
            coalesce(sum(list_price_amt),0)::float8 as list
       from discount_entries
      where tenant_id = $1 and discount_date >= $2 and discount_date <= $3 and deleted_at is null
      group by employee_id`, [ctx.tenantId, from, ctx.today]);
  let allD = 0, allL = 0, ownD = 0, ownL = 0;
  for (const r of rows) {
    allD += Number(r.disc); allL += Number(r.list);
    if (r.employee_id === spId) { ownD = Number(r.disc); ownL = Number(r.list); }
  }
  return { rate: safeDiv(ownD, ownL), teamRate: safeDiv(allD, allL) };
}

/* ---------- ⑦ 客诉退款：近12月 个人退款额 ÷ 个人回款额 vs 团队 ---------- */
async function refundDim(db, ctx, spId) {
  const from = addDays(ctx.today, -365);
  const { rows: refs } = await db.query(
    `select employee_id, coalesce(sum(amount_amt),0)::float8 as amt from refund_entries
      where tenant_id = $1 and refund_date >= $2 and refund_date <= $3 and deleted_at is null
      group by employee_id`, [ctx.tenantId, from, ctx.today]);
  const { rows: pays } = await db.query(
    `select employee_id, coalesce(sum(payment_amt),0)::float8 as amt from deals
      where tenant_id = $1 and status = 'won' and deal_date >= $2 and deal_date <= $3 and deleted_at is null
      group by employee_id`, [ctx.tenantId, from, ctx.today]);
  const refBy = new Map(refs.map(r => [r.employee_id, Number(r.amt)]));
  let allR = 0, allP = 0;
  for (const r of refs) allR += Number(r.amt);
  for (const p of pays) allP += Number(p.amt);
  const ownP = pays.filter(p => p.employee_id === spId).reduce((a, p) => a + Number(p.amt), 0);
  return { rate: safeDiv(refBy.get(spId) || 0, ownP), teamRate: safeDiv(allR, allP) };
}

/**
 * 🔴 promotionPredict —— 闸⑥ 提拔预测八维（老板端专属；数据不足维 null 不硬造）。
 * 返回 dims 恒 8 项（顺序=3号 闸⑥ 原文），每项 { no, key, label, value, computable, ... }；
 * 阈值/红绿判定 3号 未定义 → 本模块只出值与团队对照，让老板自己能验算（S-D16 同律：
 * 不写死结论）。
 */
export async function promotionPredict(db, ctx, { spId, gc = getCoef }) {
  await requireM21(db, ctx);                       // 🔴 闸①：提拔在 A-11 锁清单里
  const nd = await normDims(db, ctx, spId);
  const coach = await coachingDim(db, ctx, spId);
  const disc = await discountDim(db, ctx, spId);
  const ref = await refundDim(db, ctx, spId);
  const uer = await personUER(db, ctx, spId);
  const dim = (no, key, label, value, extra = {}) =>
    ({ no, key, label, value, computable: value != null, ...extra });
  const dims = [
    dim(1, 'norm_rank', '归一化排名（M21，排名唯一合法输入）', nd.normRank,
      { month: nd.rankMonth }),
    dim(2, 'customer_concentration', '客户集中度', null,
      { note: '云端 deals 暂无客户字段——数据不足显"—"，不硬造' }),
    dim(3, 'monthly_variance', '月度方差（归一业绩稳定性，变异系数）', nd.varianceCv,
      { monthsObserved: nd.monthsObserved, note: nd.varianceCv == null ? '需 ≥3 个月归一化毛利' : null }),
    dim(4, 'coaching', '陪访带教（近90天已确认带教回执数）', coach),
    dim(5, 'achievement_vs_narcissism', '成就 vs 自恋', null,
      { note: '访谈/测评维度，云端无数据源——显"—"' }),
    dim(6, 'discount_leak', '折扣泄漏（近12月 Σ折扣/Σ牌价）', disc.rate,
      { teamRate: disc.teamRate }),
    dim(7, 'complaint_refund', '客诉退款（近12月 退款额/回款额）', ref.rate,
      { teamRate: ref.teamRate }),
    dim(8, 'uer', 'UER（不可解释残差，M32）', uer.uer, { period: uer.period }),
  ];
  return {
    spId, asOf: ctx.today,
    bossOnly: true,                                // 🔴 老板端专属：bundles 层据此裁剪，销售端零像素
    dims,
    computableCount: dims.filter(d => d.computable).length,
    /* S-08 有源量级（🔧S-C13：原 −12% 写死数已按论文口径改） */
    qjeNote: '📎 Benson-Li-Shue 2019 QJE：以业绩而非管理潜质提拔，被提拔者售前业绩每翻倍，其下属产出约 −6%～−7.5%',
  };
}
