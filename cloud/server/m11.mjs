/* ============================================================
   C6 · M11 主管增益服务（v5.1 §5.1 M11 行 🔴取代）
   🔒 口径出处：3号算账器 §3.8（唯一权威，S-C03 归一化口径）：
     - 跨队增益 = 该主管团队【归一化】月人均净贡献 / 同期全公司【归一化】月人均净贡献
       （🔴 v4.0"原始人均回款"口径已被 S-C03 推翻作废——好地盘主管会被误判为好教练）
     - 任期 < 3 月 → null（domain.managerLift 持有该分支，服务层不重写）
     - 换帅对比：同一团队换帅事件前后 90 天【原始】人均对比（同队前后天然控制地盘，
       故唯独此处允许原始口径）；两侧 < 60 天 → 积累中
   🔴 S-D14 机检口径：managerLift 函数体（分子分母）不得出现 payment_amt / paymentAmt
     ——归一化人均一律取 m21_norms.norm_margin（M21 已剥离地盘的唯一落表）。
   前置：requireM21（闸①硬闸门，公约 A-11 / v5.1 §12 C6 行——排名/提拔类全锁）。
   计算一律调 domain.managerLift（C1 引擎），服务层只组装 m21_norms 读数。
   - 时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today。只读模块（不落库）。
   ============================================================ */
import { managerLift as liftRatio } from '../domain/suanzhang.mjs';
import { mean, diffDays, addDays, monthOf } from '../domain/shared.mjs';
import { requireM21 } from './m21.mjs';

/** 任期起点 = 最近一次接手该队（manager_change_events.new_manager_id）；无换帅记录 → hire_date */
async function tenureMonthsOf(db, ctx, managerId) {
  const { rows: mc } = await db.query(
    `select max(change_date)::text as cd from manager_change_events
      where tenant_id = $1 and new_manager_id = $2 and deleted_at is null`,
    [ctx.tenantId, managerId]);
  let start = mc.length && mc[0].cd ? mc[0].cd.slice(0, 10) : null;
  if (!start) {
    const { rows: sp } = await db.query(
      `select hire_date::text as hd from salespersons
        where tenant_id = $1 and id = $2 and deleted_at is null`, [ctx.tenantId, managerId]);
    start = sp.length && sp[0].hd ? sp[0].hd.slice(0, 10) : null;
  }
  if (!start) return null;                              // 无任何任期起点 → null（不硬造）
  return Math.floor(diffDays(start, ctx.today) / 30);
}

/**
 * managerLift —— 跨队主管增益（🔴 归一化口径，S-C03 / S-D14）。
 * 分子 = 该主管在队成员的 m21_norms.norm_margin 人均；
 * 分母 = 同月全公司 m21_norms.norm_margin 人均；
 * 增益 = domain.managerLift(分子, 分母, 任期月)——任期 < 3 月 → null。
 * 🔴 本函数体禁止出现原始回款字段（机检 grep 对象），归一化值只从 m21_norms 读。
 */
export async function managerLift(db, ctx, { managerId }) {
  await requireM21(db, ctx);                            // 🔴 闸①（A-11：提拔/排名类全锁）
  const tenureMonths = await tenureMonthsOf(db, ctx, managerId);
  const { rows: mm } = await db.query(
    `select max(month) as m from m21_norms where tenant_id = $1`, [ctx.tenantId]);
  const month = mm.length ? mm[0].m : null;
  const { rows: team } = await db.query(
    `select id from salespersons
      where tenant_id = $1 and manager_id = $2 and is_active and deleted_at is null
        and (level is null or level = 'sales')`, [ctx.tenantId, managerId]);
  const teamIds = new Set(team.map(r => r.id));
  const { rows: norms } = month == null ? { rows: [] } : await db.query(
    `select sp_id, norm_margin::float8 as nm from m21_norms
      where tenant_id = $1 and month = $2 and norm_margin is not null`,
    [ctx.tenantId, month]);
  const companyVals = norms.map(r => Number(r.nm));
  const teamVals = norms.filter(r => teamIds.has(r.sp_id)).map(r => Number(r.nm));
  const teamNormPerCapita = mean(teamVals);             // 空集 → null（不硬造）
  const companyNormPerCapita = mean(companyVals);
  const lift = liftRatio(teamNormPerCapita, companyNormPerCapita, tenureMonths);
  return {
    managerId, month, tenureMonths, teamN: teamVals.length, companyN: companyVals.length,
    teamNormPerCapita, companyNormPerCapita, lift,
    reason: (tenureMonths != null && tenureMonths < 3) ? 'tenure_lt_3m' : (lift == null ? 'insufficient' : null),
  };
}

/**
 * rawCompareForHandover —— 换帅前后 90 天【原始人均回款】对比。
 * 🔴 注释限定用途（S-C03 / S-D14）：本函数是全模块唯一允许原始口径之处——
 *   仅限换帅对比使用：同一团队换帅事件前后对比，前后是同一块地盘，天然控制了
 *   地盘变量，故原始口径在此不失真。🔴 禁止将本函数输出用于跨队排名、主管考核、
 *   提拔或任何 M11 增益场景——那些一律走上面的归一化 managerLift。
 *   产出只作换帅真实值素材导出，不指名消费方（S-C13）。
 * 两侧任一 < 60 天 → { status:'accumulating' }（积累中，不出对比数）。
 */
export async function rawCompareForHandover(db, ctx, { teamId }) {
  const { rows: mc } = await db.query(
    `select new_manager_id, change_date::text as cd from manager_change_events
      where tenant_id = $1 and team_id = $2 and deleted_at is null
      order by change_date desc limit 1`, [ctx.tenantId, teamId]);
  if (!mc.length) return { teamId, status: 'no_change_event' };
  const changeDate = mc[0].cd.slice(0, 10);
  const afterDays = Math.min(90, diffDays(changeDate, ctx.today));
  if (afterDays < 60) return { teamId, changeDate, status: 'accumulating', afterDays };
  const { rows: team } = await db.query(
    `select id from salespersons
      where tenant_id = $1 and manager_id = $2 and deleted_at is null
        and (level is null or level = 'sales')`, [ctx.tenantId, mc[0].new_manager_id]);
  if (!team.length) return { teamId, changeDate, status: 'no_team' };
  const ids = team.map(r => r.id);
  const ph = ids.map((_, i) => '$' + (i + 4)).join(',');
  const side = async (from, to) => {
    const { rows } = await db.query(
      `select coalesce(sum(payment_amt), 0)::float8 as pay from deals
        where tenant_id = $1 and status = 'won' and paid_date is not null
          and paid_date >= $2 and paid_date < $3 and deleted_at is null
          and employee_id in (${ph})`,
      [ctx.tenantId, from, to, ...ids]);
    return Number(rows[0].pay) / ids.length;            // 原始人均回款（仅限本函数）
  };
  const beforePerCapitaAmt = await side(addDays(changeDate, -90), changeDate);
  const afterPerCapitaAmt = await side(changeDate, addDays(changeDate, 90));
  return {
    teamId, changeDate, status: 'ok', teamN: ids.length,
    beforePerCapitaAmt, afterPerCapitaAmt,
    deltaAmt: afterPerCapitaAmt - beforePerCapitaAmt,
    month: monthOf(changeDate),
  };
}
