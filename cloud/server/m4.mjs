/* ============================================================
   C4 · M4 蓄水池服务（v5.1 §5.1 M4 行 🔴取代）
   🔒 口径出处：2号招人器 §3.4 F5 蓄水池市价（唯一权威）：
     - 市价(岗位) = median(近180天该岗位候选人 expectedSalary)，样本 <5 → null
       （MarketPriceCache 为派生视图非实体——本模块现算不落表；median 🔒 走 shared）
     - 蓄水池：≥30天未触达 → 待触达进招聘者待办；≥90天 → 红
   云端增量（v5.1）：CandidateTouch 触达记录落库（candidate_touches，schema-c4）；
     触达同时回写 candidates.last_touch_date（实体 lastTouchDate 字段）
   - 时钟注入（公约 C-14）：零真实时钟调用；业务日期一律 ctx.today
   - 写路径唯一：writes.put / writes.patch（表行 + 事件双写）
   ============================================================ */
import { median, diffDays, addDays } from '../domain/shared.mjs';
import { put, patch } from './writes.mjs';

/* v5.1 M4 云端增量阈值（板块系数表无此二值，云端原创常量） */
export const RESERVE_PENDING_DAYS = 30;   // ≥30 天未触达 → 待触达
export const RESERVE_RED_DAYS = 90;       // ≥90 天 → 红
export const MARKET_PRICE_WINDOW_DAYS = 180;
export const MARKET_PRICE_MIN_SAMPLE = 5;

/**
 * 触达落库：candidate_touches +1 行（touch_date = ctx.today）
 * 并回写 candidates.last_touch_date（两次写 = 两条事件，均经唯一写入口）。
 */
export async function touchCandidate(db, ctx, { id, candId, channel = null, note = null }) {
  await put(db, ctx, 'candidate_touches',
    { id, cand_id: candId, touch_date: ctx.today, channel, note }, 'candidate_touched');
  await patch(db, ctx, 'candidates', 'id', candId,
    { last_touch_date: ctx.today }, 'candidate_last_touch_updated');
  return { id, candId, touchDate: ctx.today };
}

/**
 * 蓄水池看板：sinceDays = (lastTouchDate ?? 入池日) → ctx.today。
 * status：≥90 'red'｜≥30 'pending'｜其余 'ok'；无任何日期 → 'pending'（保守进待办）。
 * pending 列表 = status ≠ ok（红也在待办里，排前）。
 */
export async function reserveBoard(db, ctx) {
  const { rows } = await db.query(
    `select id, name, position_name, last_touch_date::text as lt, pool_entered_date::text as pe
       from candidates where tenant_id = $1 and pool = 'reserve' and deleted_at is null`,
    [ctx.tenantId]);
  const items = rows.map(r => {
    const base = (r.lt || r.pe || '').slice(0, 10) || null;
    const days = base ? diffDays(base, ctx.today) : null;
    const status = days == null ? 'pending'
      : days >= RESERVE_RED_DAYS ? 'red'
      : days >= RESERVE_PENDING_DAYS ? 'pending' : 'ok';
    return { candId: r.id, name: r.name, positionName: r.position_name, sinceDays: days, status };
  });
  const rank = { red: 0, pending: 1 };
  const pending = items.filter(i => i.status !== 'ok')
    .sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.sinceDays ?? 0) - (a.sinceDays ?? 0)));
  return { items, pending };
}

/**
 * 市价传感器：median(近180天同岗 expected_salary_amt)，样本 <5 → null。
 * 窗口日期列 = candidates.created_at::date（实体 createdDate 的 C2 落列）。
 */
export async function marketPrice(db, ctx, { positionName }) {
  const from = addDays(ctx.today, -MARKET_PRICE_WINDOW_DAYS);
  const { rows } = await db.query(
    `select expected_salary_amt::float8 as amt from candidates
      where tenant_id = $1 and position_name = $2 and expected_salary_amt is not null
        and created_at::date >= $3 and created_at::date <= $4 and deleted_at is null`,
    [ctx.tenantId, positionName, from, ctx.today]);
  const amts = rows.map(r => Number(r.amt));
  if (amts.length < MARKET_PRICE_MIN_SAMPLE) return { positionName, n: amts.length, medianAmt: null };
  return { positionName, n: amts.length, medianAmt: median(amts) };
}
