/* ============================================================
   C4 · M8 薪酬水温四灯（v5.1 §5.1 M8 行 🔴取代）
   🔒 口径出处：2号招人器 §3.4 F7 四灯（唯一权威，阈值与灰灯规则逐条同源）：
     - Offer接受率 ≥60%🟢 / 40–60%🟡 / <40%🔴
     - 爽约率      <15%🟢 / 15–30%🟡 / >30%🔴
     - 周期恶化    ≥20%🟡 / ≥50%🔴（近窗 vs 前窗 resume→hired 中位天数变化率）
     - 挖角占比    =0🟢 / >0🟡 / ≥30%🔴（resign_salary / 离职总数）
     - 滚动窗、阈值可调（getCoef('zhaoren.tempLightThresholds')）、样本 <3 → 灰
     - 任一转红 → 插卡引定价器复核矩阵（推送层 C10 承接，本模块只出灯）
   云端增量（v5.1）：老板端「薪酬水温」卡数据源。
   取数（汇总由事件流复算，v5.1 §1.2）：
     约面数 = candidate_pool_moved(pool=interview_invite) 入窗事件
     爽约   = candidate_dropped(dropReason=interview_noshow)
     Offer 决断 = candidate_hired + candidate_dropped(dropReason∈Offer 流失集)
     周期   = candidates.created_at::date（createdDate）→ hired 入池日
     挖角   = salespersons.leave_date 入窗离职者
   业务日期一律取事件 payload.changes.poolEnteredDate（写入时 = ctx.today，
   时钟注入闭环，公约 C-14）；本模块零真实时钟调用、只读。
   ============================================================ */
import { addDays, diffDays, safeDiv, median, getCoef } from '../domain/shared.mjs';

/* Offer 池流失原因集（ZE-03 中发生在 Offer 阶段的三值；谈薪未拢按 Offer 决断计） */
export const OFFER_LOSS_REASONS = new Set(['offer_rejected_salary', 'offer_rejected_other', 'salary_gap']);
export const GREY_MIN_SAMPLE = 3;

/* ---------- 四灯判定（纯函数；阈值逐值读系数，样本<3 → grey） ---------- */
export function offerAcceptLight(rate, n, gc = getCoef) {
  if (n == null || n < GREY_MIN_SAMPLE || rate == null) return 'grey';
  const [g, y] = gc('zhaoren.tempLightThresholds').offerAccept;      // [0.60, 0.40]
  return rate >= g ? 'green' : rate >= y ? 'yellow' : 'red';
}
export function noshowLight(rate, n, gc = getCoef) {
  if (n == null || n < GREY_MIN_SAMPLE || rate == null) return 'grey';
  const [y, r] = gc('zhaoren.tempLightThresholds').noshow;           // [0.15, 0.30]
  return rate < y ? 'green' : rate <= r ? 'yellow' : 'red';
}
export function cycleWorseLight(change, n, gc = getCoef) {
  if (n == null || n < GREY_MIN_SAMPLE || change == null) return 'grey';
  const [y, r] = gc('zhaoren.tempLightThresholds').cycleWorse;       // [0.20, 0.50]
  return change >= r ? 'red' : change >= y ? 'yellow' : 'green';
}
export function poachShareLight(share, n, gc = getCoef) {
  if (n == null || n < GREY_MIN_SAMPLE || share == null) return 'grey';
  const r = gc('zhaoren.tempLightThresholds').poachShare;            // 0.30
  return share === 0 ? 'green' : share >= r ? 'red' : 'yellow';
}

/**
 * 四灯聚合：windowDays 滚动窗（默认 90），近窗 [today−w, today]，前窗 [today−2w, today−w)。
 * 返回每灯 { value, n, light, ...明细 }；n<3 或值不可得 → 'grey'。
 */
export async function tempLights(db, ctx, { windowDays = 90, gc = getCoef } = {}) {
  const to = ctx.today, from = addDays(to, -windowDays), prevFrom = addDays(to, -2 * windowDays);
  const inWin = d => !!d && d >= from && d <= to;                    // ISO 字符串可直接比大小
  const inPrev = d => !!d && d >= prevFrom && d < from;

  /* 事件流复算：约面进入 / 爽约 / Offer 流失 / 入职 */
  const { rows: evs } = await db.query(
    `select type, payload from event_stream
      where tenant_id = $1 and type in ('candidate_pool_moved','candidate_dropped','candidate_hired')`,
    [ctx.tenantId]);
  let invites = 0, noshow = 0, offerLost = 0, hiredN = 0;
  for (const e of evs) {
    const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : (e.payload || {});
    const ch = p.changes || {};
    const d = (ch.poolEnteredDate || '').slice(0, 10);
    if (e.type === 'candidate_pool_moved' && ch.pool === 'interview_invite' && inWin(d)) invites++;
    if (e.type === 'candidate_dropped' && inWin(d)) {
      if (ch.dropReason === 'interview_noshow') noshow++;
      if (OFFER_LOSS_REASONS.has(ch.dropReason)) offerLost++;
    }
    if (e.type === 'candidate_hired' && ch.pool === 'hired' && inWin(d)) hiredN++;
  }
  const offerN = hiredN + offerLost;
  const offerRate = safeDiv(hiredN, offerN);
  const noshowRate = safeDiv(noshow, invites);

  /* 周期恶化：resume(createdDate) → hired 中位天数，近窗 vs 前窗 */
  const { rows: hc } = await db.query(
    `select created_at::date::text as cd, pool_entered_date::text as pe
       from candidates where tenant_id = $1 and pool = 'hired'
        and pool_entered_date is not null and deleted_at is null`, [ctx.tenantId]);
  const cyc = hc.map(r => ({
    hiredAt: r.pe.slice(0, 10),
    days: diffDays(r.cd.slice(0, 10), r.pe.slice(0, 10)),
  }));
  const recent = cyc.filter(c => inWin(c.hiredAt)).map(c => c.days);
  const prev = cyc.filter(c => inPrev(c.hiredAt)).map(c => c.days);
  const recMed = median(recent), prevMed = median(prev);
  const worse = (recMed != null && prevMed != null) ? safeDiv(recMed - prevMed, prevMed) : null;
  const cycN = Math.min(recent.length, prev.length);

  /* 挖角占比：resign_salary / 窗内离职总数 */
  const { rows: lv } = await db.query(
    `select leave_reason from salespersons
      where tenant_id = $1 and leave_date is not null
        and leave_date >= $2 and leave_date <= $3 and deleted_at is null`,
    [ctx.tenantId, from, to]);
  const leavers = lv.length, poach = lv.filter(r => r.leave_reason === 'resign_salary').length;
  const poachRate = safeDiv(poach, leavers);

  return {
    windowDays, from, to,
    offerAccept: { value: offerRate, n: offerN, accepted: hiredN, lost: offerLost, light: offerAcceptLight(offerRate, offerN, gc) },
    noshow: { value: noshowRate, n: invites, noshowCount: noshow, light: noshowLight(noshowRate, invites, gc) },
    cycleWorse: { value: worse, n: cycN, recentMedianDays: recMed, prevMedianDays: prevMed, light: cycleWorseLight(worse, cycN, gc) },
    poachShare: { value: poachRate, n: leavers, poachCount: poach, light: poachShareLight(poachRate, leavers, gc) },
  };
}
