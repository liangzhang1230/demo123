/* ============================================================
   C6 · M32 UER 残差服务（v5.1 §5.2 M32 行 🟢补建）
   🔒 口径出处：3号算账器 §3.3 / §3.3b（唯一权威）：
     - 团队级 OLS：预测净贡献 = β₀+β₁线索量+β₂转化率+β₃客单价(万元)+β₄毛利率，
       y = 毛利 − laborCost；UER = 实际 − 预测；分档 ±σ 🟢⚪🔴
     - 🔴 minObs 48（8人×6月）：观测 < 48 → 不出 UER（gate:false，存 null 不硬造——
       v5.1 §5.2"minObs 48 在云端更易满足"，但不满足时照锁）
     - 🔴 三种解释必须全部展示、绝不下定论（S-03/S-05）；个人归因由 3.3b
       动态判定（domain.personAttribution），结论禁止硬编码（S-D16）
   计算一律调 domain：uerObservation / olsFit / stddev / uerBand /
     uerTeamMean / uerObsGate / personAttribution——服务层只组装输入。
   前置：requireM21（闸①，A-11——UER 在锁清单里）。
   落表：残差 → derived_scalars(scope='person', key='uer', period=月)；
         团队均值 → derived_scalars(scope='tenant', key='uerTeamMean')。
   - 观测构造：人×月，leads>0 ∧ dealCount>0 才构成观测（domain.uerObservation 同律）
   - laborCost 🔒 走 m2.laborCostFor（公约 §4.2 宪法函数，禁止重算）
   - 时钟注入（公约 C-14）：零真实时钟调用
   ============================================================ */
import {
  uerObservation, olsFit, stddev, uerBand, uerTeamMean, uerObsGate, personAttribution,
} from '../domain/suanzhang.mjs';
import { getCoef, safeDiv, addDays } from '../domain/shared.mjs';
import { upsert, logEvent } from './writes.mjs';
import { laborCostFor } from './m2.mjs';
import { requireM21 } from './m21.mjs';

/* ---------- 观测面板：全部 人×月（leads>0 ∧ deals>0） ---------- */
async function buildObservations(db, ctx) {
  const { rows: las } = await db.query(
    `select employee_id, month,
            coalesce(sum(assigned_leads),0)::int + coalesce(sum(self_dev_leads),0)::int as leads
       from lead_assignments where tenant_id = $1 and deleted_at is null
      group by employee_id, month`, [ctx.tenantId]);
  const { rows: ds } = await db.query(
    `select d.employee_id, to_char(d.paid_date, 'YYYY-MM') as month,
            count(*)::int as dc, coalesce(sum(d.payment_amt),0)::float8 as pay,
            coalesce(sum(round(d.payment_amt * coalesce(d.margin_rate_snapshot, c.gross_margin_rate))),0)::float8 as margin
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.status = 'won' and d.paid_date is not null and d.deleted_at is null
      group by d.employee_id, to_char(d.paid_date, 'YYYY-MM')`, [ctx.tenantId]);
  const dm = new Map(ds.map(r => [`${r.employee_id}|${r.month}`, r]));
  const obs = [];
  for (const l of las) {
    if (!l.leads) continue;
    const d = dm.get(`${l.employee_id}|${l.month}`);
    if (!d || !d.dc) continue;                        // 无成交 → 不构成观测（null ≠ 0）
    const lc = await laborCostFor(db, ctx, { employeeId: l.employee_id, month: l.month });
    const o = uerObservation({
      leads: l.leads, dealCount: d.dc, paymentAmt: Number(d.pay),
      grossMarginAmt: Number(d.margin), laborCostAmt: lc.laborCostAmt,
    });
    if (o) obs.push({ spId: l.employee_id, month: l.month, ...o });
  }
  return obs;
}

/**
 * runUER：前置 requireM21 → 人×月观测 → olsFit → 残差落 derived_scalars(person,'uer')。
 * 🔴 观测 < uerMinObs(48) 或矩阵奇异 → {gate:false}，uerTeamMean 存 null（不硬造）。
 */
export async function runUER(db, ctx, { gc = getCoef } = {}) {
  await requireM21(db, ctx);                          // 🔴 闸①：UER 在 A-11 锁清单里
  const obs = await buildObservations(db, ctx);
  const n = obs.length;
  const writeNullTeamMean = async reason => {
    await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
      { scope: 'tenant', target_id: null, key: 'uerTeamMean', period: ctx.today.slice(0, 7),
        value_num: null, value_json: { gate: false, n, reason } },
      'derived_scalar_written', { touch: ['computed_at'] });
  };
  if (!uerObsGate(n, gc)) {
    await writeNullTeamMean('minObs');
    await logEvent(db, ctx, 'uer_ran', null, { gate: false, n, reason: 'minObs' });
    return { gate: false, n, reason: 'minObs' };
  }
  const fit = olsFit(obs.map(o => o.x), obs.map(o => o.y));
  if (!fit) {
    await writeNullTeamMean('singular');
    await logEvent(db, ctx, 'uer_ran', null, { gate: false, n, reason: 'singular' });
    return { gate: false, n, reason: 'singular' };
  }
  const sigma = stddev(fit.resid);
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i], resid = fit.resid[i];
    await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
      { scope: 'person', target_id: o.spId, key: 'uer', period: o.month,
        value_num: resid, value_json: { band: uerBand(resid, sigma), pred: fit.pred[i], actual: o.y } },
      'derived_scalar_written', { touch: ['computed_at'] });
  }
  const latestMonth = obs.map(o => o.month).sort().at(-1);
  const teamMean = uerTeamMean(obs.map((o, i) => o.month === latestMonth ? fit.resid[i] : null));
  await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'tenant', target_id: null, key: 'uerTeamMean', period: latestMonth,
      value_num: teamMean, value_json: { gate: true, n, sigma } },
    'derived_scalar_written', { touch: ['computed_at'] });
  await logEvent(db, ctx, 'uer_ran', null, { gate: true, n, sigma, latestMonth, teamMean });
  return { gate: true, n, sigma, beta: fit.beta, latestMonth, teamMean };
}

/** 读取某人最新 UER（derived_scalars 读侧；无 → null——"—"） */
export async function personUER(db, ctx, spId) {
  const { rows } = await db.query(
    `select value_num::float8 as v, period from derived_scalars
      where tenant_id = $1 and scope = 'person' and target_id = $2 and key = 'uer'
      order by period desc limit 1`, [ctx.tenantId, spId]);
  return rows.length ? { uer: rows[0].v == null ? null : Number(rows[0].v), period: rows[0].period } : { uer: null, period: null };
}

/**
 * attribution：个人 UER 归因（3.3b 动态判定，S-C10）——🔴 三种解释强制全展示。
 * 返回三分支完整对象（hoarding/leak/territory 恒齐全）+ verdict（由 domain 返回，
 * 缺证据 → 'undetermined'，绝不下定论——S-03/S-05C）。
 * 证据：折扣泄漏率 = 近12月 Σdiscount/Σlist（个人 vs 全队）；客诉率云端暂无数据源
 * → null（null ≠ 0，不参与判定）；线索指数取 m21_norms 最新有效月。
 */
export async function attribution(db, ctx, { spId, gc = getCoef }) {
  await requireM21(db, ctx);
  const from = addDays(ctx.today, -365);
  const { rows: dr } = await db.query(
    `select employee_id, coalesce(sum(discount_amt),0)::float8 as disc, coalesce(sum(list_price_amt),0)::float8 as list
       from discount_entries
      where tenant_id = $1 and discount_date >= $2 and discount_date <= $3 and deleted_at is null
      group by employee_id`, [ctx.tenantId, from, ctx.today]);
  let allDisc = 0, allList = 0, ownDisc = 0, ownList = 0;
  for (const r of dr) {
    allDisc += Number(r.disc); allList += Number(r.list);
    if (r.employee_id === spId) { ownDisc = Number(r.disc); ownList = Number(r.list); }
  }
  const discountLeakRate = safeDiv(ownDisc, ownList);
  const teamDiscountLeakRate = safeDiv(allDisc, allList);
  const { rows: mi } = await db.query(
    `select lead_index::float8 as idx, month from m21_norms
      where tenant_id = $1 and sp_id = $2 and lead_index is not null
      order by month desc limit 1`, [ctx.tenantId, spId]);
  const leadIndex = mi.length ? Number(mi[0].idx) : null;
  const { uer } = await personUER(db, ctx, spId);
  const att = personAttribution({
    discountLeakRate, teamDiscountLeakRate,
    complaintRate: null, teamComplaintRate: null,     // 云端暂无客诉数据源：null ≠ 0
    leadIndex,
  }, gc);
  const band = gc('suanzhang.territoryBand');
  return {
    spId, uer, verdict: att.verdict, badList: att.badList,
    /* 🔴 三种解释强制全展示（S-05①②③），每条带证据与团队对照，让老板自己能验算 */
    explanations: {
      hoarding: {
        label: '① 他在藏（第四定理：被敲竹杠→撤回投入）',
        pointed: att.verdict === 'undetermined',
        note: 'UER 是信号不是结论；与其他测不到的原因无法区分时系统不下结论（S-03），要证因果用 M31',
      },
      leak: {
        label: '② 他在漏水', pointed: att.eLeak,
        discountLeakRate, teamDiscountLeakRate, complaintRate: null, teamComplaintRate: null,
        threshold: gc('suanzhang.personLeakX'),
      },
      territory: {
        label: '③ 地盘质量差', pointed: att.eTerritory,
        leadIndex, band,
      },
    },
  };
}
