/* ============================================================
   C6 · M21 地盘归一化服务（v5.1 §5.2 M21 行 🟢补建 · 全系统最重的锁）
   🔒 口径出处：3号算账器 §3.2（唯一权威）：
     人均应得=总量/人数；指数=个人/人均；超配>1.10/欠配<0.90；失衡率=(超+欠)/人数；
     单位线索毛利=月毛利/线索量；归一化毛利=单位×人均应得×自开发加成(1+占比×0.5)；
     🔴 归一化排名 = 全系统排名唯一合法输入；重划预期=总毛利×[2%,7%]。
     计算一律调 domain.m21Normalize（C1 引擎，服务层零重写）。
   🔴 闸①硬闸门（公约 A-11 / v5.1 §5.2）：M21 未运行 → 排名/淘汰/剪刀差/配方/
     提拔/UER/M35/M2-P90 导出 全锁。requireM21 是唯一守卫入口，导出给
     m32/m9/m11/m18 等复用——"最容易被为了好看先放开的地方，不许"。
   云端增量：
     - 结果落 m21_norms（逐人逐月，UPSERT 覆盖）+ derived_scalars
       （imbalanceRate / redrawBand，带 computed_at，公约 A-21 / v5.1 §2.3）
     - 事件 m21_ran（写入一律经 writes 双写）
   口径注记：
     - 人口 = 在职销售（is_active ∧ 未删 ∧ level ∉ {manager, executive}）——
       M21 归一的是"拿线索卖货的人"，主管另走 M11
     - 该月线索 = Σ(assigned_leads + self_dev_leads)（自开发与分配分开统计后合计为基数）
     - 该月毛利 = Σ round(payment_amt × 毛利率快照)，won ∧ paid_date 落该月
       （已回款口径，与 m2/m6 同法；快照缺失回退品类毛利率）
   - 时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today
   ============================================================ */
import { m21Normalize } from '../domain/suanzhang.mjs';
import { getCoef, monthOf } from '../domain/shared.mjs';
import { upsert, logEvent } from './writes.mjs';

/** 'YYYY-MM' 上一月 */
export const prevMonth = m => {
  const [y, mm] = m.split('-').map(Number);
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
};

/* ---------- 聚合：该月逐人 {leads, selfDevLeads, grossMarginAmt} ---------- */
async function peopleOfMonth(db, ctx, month) {
  const { rows: sps } = await db.query(
    `select id, name from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales')
      order by id`, [ctx.tenantId]);
  const { rows: las } = await db.query(
    `select employee_id, coalesce(sum(assigned_leads),0)::int as al, coalesce(sum(self_dev_leads),0)::int as sl
       from lead_assignments
      where tenant_id = $1 and month = $2 and deleted_at is null
      group by employee_id`, [ctx.tenantId, month]);
  const { rows: ms } = await db.query(
    `select d.employee_id,
            coalesce(sum(round(d.payment_amt * coalesce(d.margin_rate_snapshot, c.gross_margin_rate))),0)::float8 as margin
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.status = 'won' and d.paid_date is not null
        and to_char(d.paid_date, 'YYYY-MM') = $2 and d.deleted_at is null
      group by d.employee_id`, [ctx.tenantId, month]);
  const la = new Map(las.map(r => [r.employee_id, r]));
  const mg = new Map(ms.map(r => [r.employee_id, Number(r.margin)]));
  return sps.map(s => {
    const l = la.get(s.id);
    return {
      id: s.id, name: s.name,
      leads: l ? l.al + l.sl : 0,
      selfDevLeads: l ? l.sl : 0,
      grossMarginAmt: mg.get(s.id) ?? 0,
    };
  });
}

/**
 * runM21：lead_assignments + deals 聚合 → domain.m21Normalize →
 *   m21_norms 逐人 UPSERT + derived_scalars(imbalanceRate/redrawBand) + 事件 m21_ran。
 * 幂等：同月重跑 = 覆盖值 + 刷新 computed_at，行数不变。
 */
export async function runM21(db, ctx, { month, gc = getCoef } = {}) {
  if (!month) month = monthOf(ctx.today);
  const people = await peopleOfMonth(db, ctx, month);
  const M = m21Normalize(people, gc);
  for (const r of M.rows) {
    await upsert(db, ctx, 'm21_norms', { cols: ['tenant_id', 'sp_id', 'month'] },
      { sp_id: r.id, month, leads: r.leads, lead_index: r.index,
        unit_lead_margin: r.unitLeadMargin, norm_margin: r.normMargin,
        orig_rank: r.origRank, norm_rank: r.normRank },
      'm21_norm_written', { touch: ['computed_at'] });
  }
  if (M.done) {
    await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
      { scope: 'tenant', target_id: null, key: 'imbalanceRate', period: month,
        value_num: M.imbalanceRate, value_json: { imbalCount: M.imbalCount, n: M.n } },
      'derived_scalar_written', { touch: ['computed_at'] });
    await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
      { scope: 'tenant', target_id: null, key: 'redrawBand', period: month,
        value_num: null, value_json: { band: M.redrawBand, totalMarginAmt: M.totalMargin } },
      'derived_scalar_written', { touch: ['computed_at'] });
  }
  await logEvent(db, ctx, 'm21_ran', month,
    { month, n: M.n, imbalanceRate: M.imbalanceRate, done: M.done });
  return { month, n: M.n, done: M.done, imbalanceRate: M.imbalanceRate, redrawBand: M.redrawBand, rows: M.rows };
}

/** m21Done：该月 m21_norms 是否已有 ≥2 行（1 人不成"盘"，谈不上归一） */
export async function m21Done(db, ctx, { month }) {
  const { rows } = await db.query(
    `select count(*)::int as n from m21_norms where tenant_id = $1 and month = $2`,
    [ctx.tenantId, month]);
  return rows[0].n >= 2;
}

/**
 * 🔴 requireM21 —— 闸①硬闸门（公约 A-11 的云端断言，v5.1 §12 C6 行）。
 * 判据：本月或上月已运行（dayRoll 每日跑 上月+当月，正常经营下恒新鲜）。
 * 未运行 → throw {code:'A11_LOCKED'}（锁屏话术 S-01 由表现层渲染）。
 * 🔴 排名/淘汰/剪刀差/配方/UER/提拔的入口一律先过本守卫，禁止绕行。
 */
export async function requireM21(db, ctx) {
  const cur = monthOf(ctx.today);
  if (await m21Done(db, ctx, { month: cur })) return true;
  if (await m21Done(db, ctx, { month: prevMonth(cur) })) return true;
  const err = new Error('A11_LOCKED: M21 地盘归一化未运行——排名/淘汰/剪刀差/配方/UER/提拔全锁（S-01）');
  err.code = 'A11_LOCKED';
  throw err;
}
