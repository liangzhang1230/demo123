/* ============================================================
   C4 · M6 批次分析 vintage（v5.1 §5.1 M6 行 🔴取代）
   🔒 口径出处：
     - 2号招人器 §3.5 F6：存活 S(t)=在职/入职，t∈{30,60,90,180,360}，不满 t 显"—"(null)；
       回本日 = min{t: 累计毛利贡献 ≥ hiringCost + laborCost月 × t/30}
     - 2号招人器 闸⑩：死亡归因三切片 = 90天存活率按（入职月 / 带教主管 / 起始底薪档
       <B、B~1.2B、>1.2B）分组；组样本 <3 置灰（null）
   云端增量（v5.1）：三切片按 tenant；B 取 comp_plan_versions 入职日当期版本
     inputs.baseSalaryAmt（🔒 planVersionAt 走 m2，改版不追溯口径复用）
   - laborCost 🔒 走 shared.laborCost（公约 §4.2：底薪+社保；月口径取 commissionAmt=0
     保守——提成随毛利同增，不入固定月成本）；毛利=payment_amt×margin_rate_snapshot
     （快照缺失回退品类毛利率，与 m2.commissionFor 同法）
   - 时钟注入（公约 C-14）：零真实时钟调用；today = ctx.today。只读模块。
   ============================================================ */
import { diffDays, safeDiv, laborCost, getCoef } from '../domain/shared.mjs';
import { planVersionAt } from './m2.mjs';

export const SURVIVAL_TS = [30, 60, 90, 180, 360];
export const MIN_SAMPLE = 3;                     // 闸⑩：组样本<3置灰

const jsonArr = v => Array.isArray(v) ? v : JSON.parse(v || '[]');

async function batchMembers(db, ctx, batchId) {
  const { rows: b } = await db.query(
    `select member_ids from hire_batches where tenant_id = $1 and id = $2 and deleted_at is null`,
    [ctx.tenantId, batchId]);
  if (!b.length) throw new Error(`批次 ${batchId} 不存在`);
  const ids = jsonArr(b[0].member_ids);
  if (!ids.length) return [];
  const ph = ids.map((_, i) => '$' + (i + 2)).join(',');
  const { rows } = await db.query(
    `select id, hire_date::text as hd, leave_date::text as ld
       from salespersons where tenant_id = $1 and id in (${ph}) and deleted_at is null`,
    [ctx.tenantId, ...ids]);
  return rows.map(r => ({ id: r.id, hd: r.hd ? r.hd.slice(0, 10) : null, ld: r.ld ? r.ld.slice(0, 10) : null }));
}

/**
 * 存活曲线 S(t) = 在职/入职，t∈{30,60,90,180,360}。
 * 批次不满 t（任一成员 hire+t > today）→ 该点 null（"—"）。
 * 在职于 t = 无离职 或 离职日 − 入职日 > t。
 */
export async function survival(db, ctx, { batchId }) {
  const members = await batchMembers(db, ctx, batchId);
  const s = {};
  for (const t of SURVIVAL_TS) {
    if (!members.length || members.some(m => !m.hd || diffDays(m.hd, ctx.today) < t)) { s[t] = null; continue; }
    const alive = members.filter(m => !m.ld || diffDays(m.hd, m.ld) > t).length;
    s[t] = safeDiv(alive, members.length);
  }
  return { batchId, n: members.length, s };
}

/**
 * 回本日 = min{t: 累计毛利贡献(≤hire+t) ≥ hiring_cost + laborCost月 × t/30}；
 * 走到 today 仍不满足 → null。毛利按已回款口径（paid_date 落账日）逐日累计。
 */
export async function paybackDay(db, ctx, { employeeId, gc = getCoef }) {
  const { rows: sp } = await db.query(
    `select hire_date::text as hd, base_salary_amt::float8 as base, hiring_cost_amt::float8 as hc
       from salespersons where tenant_id = $1 and id = $2 and deleted_at is null`,
    [ctx.tenantId, employeeId]);
  if (!sp.length || !sp[0].hd) return { employeeId, paybackDay: null, reason: 'no_hire_date' };
  const hd = sp[0].hd.slice(0, 10);
  const hiringCost = Number(sp[0].hc ?? 0);
  const monthlyLabor = laborCost({ baseAmt: Number(sp[0].base ?? 0), commissionAmt: 0, payouts: [] }, gc);
  const { rows: ds } = await db.query(
    `select d.paid_date::text as pd, d.payment_amt::float8 as amt,
            coalesce(d.margin_rate_snapshot, c.gross_margin_rate)::float8 as rate
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.employee_id = $2 and d.status = 'won'
        and d.paid_date is not null and d.deleted_at is null`,
    [ctx.tenantId, employeeId]);
  const events = ds
    .filter(r => r.rate != null)
    .map(r => ({ t: diffDays(hd, r.pd.slice(0, 10)), m: Math.round(Number(r.amt) * Number(r.rate)) }))
    .filter(e => e.t >= 0)
    .sort((a, b) => a.t - b.t);
  const maxT = diffDays(hd, ctx.today);
  let cum = 0, ei = 0;
  for (let t = 1; t <= maxT; t++) {
    while (ei < events.length && events[ei].t <= t) cum += events[ei++].m;
    if (cum >= hiringCost + monthlyLabor * t / 30) {
      return { employeeId, paybackDay: t, cumMarginAmt: cum, monthlyLaborAmt: monthlyLabor, hiringCostAmt: hiringCost };
    }
  }
  return { employeeId, paybackDay: null, cumMarginAmt: cum, monthlyLaborAmt: monthlyLabor, hiringCostAmt: hiringCost };
}

/**
 * 死亡归因三切片（闸⑩）：90天存活率按 入职月 / 带教主管 / 起始底薪档 分组。
 * 总体 = 窗口期满入职者（hire+90 ≤ today，未满窗不入任何组）。
 * 底薪档：B = 入职日当期 comp_plan_versions.inputs.baseSalaryAmt（无版本 → 档 '—'）；
 *   <B ｜ B~1.2B（含两端）｜ >1.2B。组样本 < 3 → s90=null + grey=true（置灰）。
 */
export async function deathSlices(db, ctx, { minSample = MIN_SAMPLE } = {}) {
  const { rows } = await db.query(
    `select id, hire_date::text as hd, leave_date::text as ld, manager_id, base_salary_amt::float8 as base
       from salespersons where tenant_id = $1 and hire_date is not null and deleted_at is null`,
    [ctx.tenantId]);
  const matured = rows
    .map(r => ({ id: r.id, hd: r.hd.slice(0, 10), ld: r.ld ? r.ld.slice(0, 10) : null, mgr: r.manager_id, base: r.base == null ? null : Number(r.base) }))
    .filter(r => diffDays(r.hd, ctx.today) >= 90);
  const survived90 = r => !r.ld || diffDays(r.hd, r.ld) > 90;
  for (const r of matured) {                     // 底薪档（B 按入职日当期版本，改版不追溯）
    const plan = await planVersionAt(db, ctx, r.hd);
    const B = plan?.inputs?.baseSalaryAmt != null ? Number(plan.inputs.baseSalaryAmt) : null;
    r.band = (B == null || r.base == null) ? '—'
      : r.base < B ? '<B' : r.base <= 1.2 * B ? 'B~1.2B' : '>1.2B';
  }
  const sliceBy = keyFn => {
    const m = new Map();
    for (const r of matured) {
      const k = keyFn(r) ?? '—';
      if (!m.has(k)) m.set(k, { key: k, n: 0, dead: 0 });
      const g = m.get(k); g.n++; if (!survived90(r)) g.dead++;
    }
    return [...m.values()]
      .map(g => ({ key: g.key, n: g.n, grey: g.n < minSample, s90: g.n < minSample ? null : safeDiv(g.n - g.dead, g.n) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  };
  return {
    maturedCount: matured.length,
    byMonth: sliceBy(r => r.hd.slice(0, 7)),
    byMentor: sliceBy(r => r.mgr),
    byBaseBand: sliceBy(r => r.band),
  };
}
