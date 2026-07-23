/* ============================================================
   C9 · M36 卡线率检测器服务（v5.1 §5.2 M36 行 · 兑付定价器"预约证据"）
   🔒 口径出处：3号算账器 §3.12 / S-C04（唯一权威）：
     - 带 = [底线, floor(底线 × 1.15)]；卡线率 = 带内人天 ÷ 有该指标总人天（minSample 30 人天）
     - > 40% → 🔴 S-19；判定唯一出口 = domain.m36BunchRate（阈值只经 getCoef）
     - source='imported' 且未补录 → 显"待补录你设的底线数"，不出卡线率
     - source='imported' 且已补录 → 卡顶加『📌 预约于 {bookedDate} 的证据，今日兑付。』
   🔴 v5.1 云端增量：PendingEvidence 走同库直读——定价器信封桩（process_baselines
     source='imported'）与日报计数同库，老板补录 metricName/baselineValue 后立即出
     卡线率，单机版"建桩→导入→补录"的跨文件限制在云端消失。
   计数分布：metricName 命中 daily_reports 四计数（YE-01 leads/intents/samples/contracts，
     含中文别名）→ 人天 = 每人每日该计数；未命中 → 回退 deals 计数（每人每日成交笔数）。
   时钟注入（公约 C-14）：今天 = ctx.today，零真实时钟调用；写入一律经 writes 双写。
   ============================================================ */
import { m36BunchRate } from '../domain/suanzhang.mjs';
import { getCoef, addDays } from '../domain/shared.mjs';
import { put, patch } from './writes.mjs';

/* metricName → daily_reports 计数列（YE-01 四计数 + 中文别名；未命中 → null＝deals 回退） */
const FIELD_ALIAS = {
  leads: 'leads', intents: 'intents', samples: 'samples', contracts: 'contracts',
  '线索': 'leads', '线索数': 'leads', '意向': 'intents', '意向数': 'intents',
  '样品': 'samples', '样品数': 'samples', '签约': 'contracts', '签约数': 'contracts',
};
const FIELDS = new Set(['leads', 'intents', 'samples', 'contracts']);

/**
 * bunchRate —— 卡线率（近 windowDays=90 天窗口，"每季度重测"口径）：
 *   有基线（metric_name 命中且 baseline_value 已录）→ 计数分布 → domain.m36BunchRate；
 *   无基线 / imported 桩未补录 → { pending:true, message:'待补录你设的底线数' }（不出卡线率）。
 * 纯读（零写库）。
 */
export async function bunchRate(db, ctx, { metricName, windowDays = 90, gc = getCoef }) {
  const { rows: pbs } = await db.query(
    `select id, metric_name, baseline_value, source, booked_date::text as booked
       from process_baselines where tenant_id = $1 and deleted_at is null order by id`,
    [ctx.tenantId]);
  const row = pbs.find(r => r.metric_name === metricName && r.baseline_value != null);
  if (!row) {
    /* 桩在场（imported 未补录 / 同名未录底线）与全无基线，同显"待补录"（S-C04） */
    const stub = pbs.some(r => r.baseline_value == null && (r.metric_name == null || r.metric_name === metricName));
    return { metricName, pending: true, reason: stub ? 'imported_stub' : 'no_baseline',
      message: '待补录你设的底线数' };
  }
  const from = addDays(ctx.today, -(windowDays - 1));
  const field = FIELD_ALIAS[metricName] ?? null;
  let counts;
  if (field && FIELDS.has(field)) {
    const { rows } = await db.query(
      `select ${field}::int as c from daily_reports
        where tenant_id = $1 and report_date >= $2 and report_date <= $3 and deleted_at is null`,
      [ctx.tenantId, from, ctx.today]);
    counts = rows.map(r => Number(r.c));
  } else {
    /* 回退：deals 计数（每人每日成交笔数为一"人天"计数） */
    const { rows } = await db.query(
      `select count(*)::int as c from deals
        where tenant_id = $1 and deal_date >= $2 and deal_date <= $3 and deleted_at is null
        group by employee_id, deal_date`, [ctx.tenantId, from, ctx.today]);
    counts = rows.map(r => Number(r.c));
  }
  /* 🔒 判定唯一出口：带/卡线率/红灯/minSample 全由 domain 计算 */
  const r = m36BunchRate(counts, Number(row.baseline_value), gc);
  const redeemed = row.source === 'imported' && row.booked != null;
  return {
    metricName, field, pending: false,
    baseline: Number(row.baseline_value), source: row.source, bookedDate: row.booked,
    manDays: counts.length, ...r,
    redeemNote: redeemed ? `📌 预约于 ${row.booked} 的证据，今日兑付。` : null,   // S-19 卡顶标识
  };
}

/**
 * setBaseline —— 老板补录/设置底线（UI 强制补录的落点，S-C04）：
 *   pbId 给定 → 补录 imported 桩（metric_name + baseline_value，patch + 事件）；
 *   否则 → 新建本地基线（source='local'，put + 事件）。
 */
export async function setBaseline(db, ctx, { pbId = null, metricName, baselineValue }) {
  if (pbId != null) {
    const row = await patch(db, ctx, 'process_baselines', 'id', pbId,
      { metric_name: metricName, baseline_value: baselineValue }, 'process_baseline_backfilled');
    return { ok: true, id: pbId, source: row.source, backfilled: true };
  }
  const { rows } = await db.query(
    `select count(*)::int as n from process_baselines where tenant_id = $1`, [ctx.tenantId]);
  const id = `pb_${rows[0].n + 1}`;
  await put(db, ctx, 'process_baselines',
    { id, metric_name: metricName, baseline_value: baselineValue, source: 'local' },
    'process_baseline_set');
  return { ok: true, id, source: 'local', backfilled: false };
}
