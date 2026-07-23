/* ============================================================
   C6 · dayRoll 日切批处理（v5.1 §1.2：每日 00:05 的批处理 / §2.3：derived 落表带 computedAt）
   顺序（🔴 先归一化，再一切依赖归一化的派生——闸①硬闸门决定的拓扑）：
     1) runM21(上月) + runM21(当月)——正常经营下 requireM21 恒新鲜（m21 注记）
     2) runUER——前置 requireM21；人数不足 2（A11_LOCKED）→ 跳过并记录，不炸整个日切
     3) 派生标量重算落 derived_scalars（公约 A-21：带 computed_at；asOf = 计算日）：
        - imbalanceRate：runM21 已落（本步不重复写，登记于结果）
        - realP90Factor：🔒 3号 §3.1b——P90(归一化人均)/mean，样本 < 8 → null（"—"，
          定价器富国闸回退 1.8）；输入 = 当月 m21_norms.norm_margin（M21 已完成 → 导出合法）
        - dvi：🔒 3号 §3.4 四项加权（当月口径）——填报率走 m1.fillRate（休息日不计分母）、
          录入时滞 median(entry_date − deal_date)、线索归因率、折扣录入率
          （分母 = 同品类成交价低于中位数 1σ 以上的笔数）；<10 笔成交 → null 不硬造
        - uerTeamMean：runUER 已落
     4) 事件 day_rolled（logEvent 双写口径）
   🔴 幂等：同日重跑 = 全部 UPSERT 覆盖（值刷新 + computed_at 刷新，行数不变）。
   - 时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today（生产由调度器注入当日）
   ============================================================ */
import { realP90Factor, dvi } from '../domain/suanzhang.mjs';
import { getCoef, safeDiv, median, stddevP, monthOf, firstDay, diffDays } from '../domain/shared.mjs';
import { upsert, logEvent } from './writes.mjs';
import { runM21, prevMonth } from './m21.mjs';
import { runUER } from './m32.mjs';
import { fillRate } from './m1.mjs';

/* ---------- 派生：realP90Factor（输入 = 该月 m21_norms 归一化值） ---------- */
async function computeRealP90(db, ctx, month, gc) {
  const { rows } = await db.query(
    `select norm_margin::float8 as nm from m21_norms
      where tenant_id = $1 and month = $2 and norm_margin is not null`, [ctx.tenantId, month]);
  return realP90Factor(rows.map(r => Number(r.nm)), gc);   // 样本 < 8 → null（不硬造）
}

/* ---------- 派生：DVI 四项组装（当月；口径 3号 §3.4，计算唯一出口 = domain.dvi） ---------- */
async function computeDVI(db, ctx, month, gc) {
  const from = firstDay(...month.split('-').map(Number));
  const to = ctx.today;
  const fr = await fillRate(db, ctx, { from, to });        // ① 日报填报率（Y-D8 休息日不计分母）
  const { rows: ds } = await db.query(
    `select id, category_id, payment_amt::float8 as pay, deal_date::text as dd, entry_date::text as ed,
            lead_source_type
       from deals
      where tenant_id = $1 and to_char(deal_date, 'YYYY-MM') = $2 and deleted_at is null`,
    [ctx.tenantId, month]);
  const dealCount = ds.length;
  const lags = ds.filter(r => r.ed != null)
    .map(r => Math.max(0, diffDays(r.dd.slice(0, 10), r.ed.slice(0, 10))));   // 录入日 − 成交日
  const medianEntryLagDays = lags.length ? median(lags) : null;   // ② 录入时滞
  const leadAttribRate = safeDiv(ds.filter(r => r.lead_source_type != null).length, dealCount); // ③ 线索归因率
  /* ④ 折扣录入率：分母 = 同品类成交价低于 中位数−1σ 的笔数；分子 = 其中挂有 DiscountEntry 者 */
  const byCat = new Map();
  for (const r of ds) {
    if (!byCat.has(r.category_id)) byCat.set(r.category_id, []);
    byCat.get(r.category_id).push(r);
  }
  const lowDeals = [];
  for (const arr of byCat.values()) {
    const pays = arr.map(r => Number(r.pay));
    const med = median(pays), sig = stddevP(pays);
    if (med == null || sig == null) continue;              // 样本不足 → 该品类不进分母
    for (const r of arr) if (Number(r.pay) < med - sig) lowDeals.push(r.id);
  }
  let discountRecordRate = null;
  if (lowDeals.length) {
    const ph = lowDeals.map((_, i) => '$' + (i + 2)).join(',');
    const { rows: de } = await db.query(
      `select count(distinct deal_id)::int as n from discount_entries
        where tenant_id = $1 and deal_id in (${ph}) and deleted_at is null`,
      [ctx.tenantId, ...lowDeals]);
    discountRecordRate = safeDiv(de[0].n, lowDeals.length);
  }
  return {
    inputs: {
      reportRate: fr.tenant.rate, medianEntryLagDays, leadAttribRate, discountRecordRate, dealCount,
    },
    value: dvi({
      reportRate: fr.tenant.rate ?? 0, medianEntryLagDays, leadAttribRate, discountRecordRate, dealCount,
    }, gc),                                                // <10 笔成交 → null（domain 持有门槛）
  };
}

/**
 * dayRoll —— 每日日切（v5.1 §1.2）。同日重跑幂等（UPSERT 覆盖 + computed_at 刷新）。
 * 返回各步结果摘要；任何派生值算不出 → 落 null（"—"），🔴 绝不硬造 0。
 */
export async function dayRoll(db, ctx, { gc = getCoef } = {}) {
  const cur = monthOf(ctx.today), prev = prevMonth(cur);
  /* 1) M21：上月 + 当月（闸①的供给侧——先归一化，其余才有合法输入） */
  const m21Prev = await runM21(db, ctx, { month: prev, gc });
  const m21Cur = await runM21(db, ctx, { month: cur, gc });
  /* 2) UER（前置 requireM21；租户人数不足 → A11_LOCKED 跳过，日切不炸） */
  let uer;
  try { uer = await runUER(db, ctx, { gc }); }
  catch (e) { if (e.code === 'A11_LOCKED') uer = { gate: false, reason: 'A11_LOCKED' }; else throw e; }
  /* 3) 派生标量重算（公约 A-21：落表带 computed_at；UPSERT 覆盖式幂等） */
  const p90 = await computeRealP90(db, ctx, cur, gc);
  await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'tenant', target_id: null, key: 'realP90Factor', period: cur,
      value_num: p90, value_json: { sample: m21Cur.n } },
    'derived_scalar_written', { touch: ['computed_at'] });
  const dviRes = await computeDVI(db, ctx, cur, gc);
  await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'tenant', target_id: null, key: 'dvi', period: cur,
      value_num: dviRes.value, value_json: dviRes.inputs },
    'derived_scalar_written', { touch: ['computed_at'] });
  /* 4) 事件：day_rolled（日切留痕；imbalanceRate/uerTeamMean 已由 1)2) 落表） */
  await logEvent(db, ctx, 'day_rolled', ctx.today, {
    today: ctx.today, months: [prev, cur],
    m21: { prev: { n: m21Prev.n, done: m21Prev.done }, cur: { n: m21Cur.n, done: m21Cur.done } },
    imbalanceRate: m21Cur.imbalanceRate,
    uer: { gate: uer.gate ?? false, reason: uer.reason ?? null, n: uer.n ?? null },
    realP90Factor: p90, dvi: dviRes.value,
  });
  return {
    today: ctx.today, months: [prev, cur],
    m21: { prev: m21Prev, cur: m21Cur }, uer,
    realP90Factor: p90, dvi: dviRes.value, dviInputs: dviRes.inputs,
  };
}
