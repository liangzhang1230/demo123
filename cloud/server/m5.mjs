/* ============================================================
   C4 · M5 招聘者考核 90 天窗（v5.1 §5.1 M5 行 🔴取代）
   🔒 口径出处：2号招人器 闸⑧（唯一权威，判定式逐字）：
     - 坏账 = (离职日 ≤ hire+90 且 原因 ≠ layoff)          ——ZE-05：layoff 🔴 不计坏账
     - 责任切割：事件日 ≤ hire+90 → 招聘者；> 90 → 当时主管
     - 坏账率 = 坏账 / 窗口期满入职数（滚12月）
       窗口期满 = hire_date + 90 ≤ today（未满窗者分子分母双排除）
   云端增量（v5.1）：招聘者端看板（byRecruiter 按建档招聘者聚合）；
     终生追溯视图只读页固定注 Z-16『90 天后表现归属培养与管理』（UI 层）
   - 时钟注入（公约 C-14）：零真实时钟调用；today = ctx.today
   - 本模块只读（考核视图无写路径）
   ============================================================ */
import { addDays, diffDays, safeDiv } from '../domain/shared.mjs';

export const BAD_DEBT_WINDOW_DAYS = 90;
export const ROLLING_MONTHS_DAYS = 365;          // 滚12月窗（按入职日圈定 cohort）
export const MIN_SAMPLE = 3;                     // 样本不足 → null（与四灯/闸⑩ 灰灯同门槛）

/** 责任切割（闸⑧判定式）：事件日 ≤ hire+90 → 'recruiter'；> 90 → 'manager' */
export function responsibilityOf(eventDate, hireDate) {
  return diffDays(hireDate, eventDate) <= BAD_DEBT_WINDOW_DAYS ? 'recruiter' : 'manager';
}

/** 坏账判定：离职日 ≤ hire+90 且 原因 ≠ layoff（🔴 layoff 公司裁撤不计坏账） */
export function isBadDebt(leaveDate, hireDate, leaveReason) {
  if (!leaveDate || !hireDate) return false;
  if (leaveReason === 'layoff') return false;
  return diffDays(hireDate, leaveDate) <= BAD_DEBT_WINDOW_DAYS;
}

/**
 * 坏账 90 天窗（滚12月）：
 *   cohort   = hire_date ∈ [today−365, today] 的入职者
 *   分母     = cohort 中窗口期满者（hire+90 ≤ today）
 *   分子     = 分母中坏账者
 *   rate     = 分子/分母（safeDiv；分母 < MIN_SAMPLE → null 不硬造）
 * items 含逐人 responsibility（有离职事件才有切割结论）；
 * byRecruiter 经 candidates.employee_id 回链取建档招聘者（无回链归 '—'）。
 */
export async function badDebt90(db, ctx, { minSample = MIN_SAMPLE } = {}) {
  const from = addDays(ctx.today, -ROLLING_MONTHS_DAYS);
  const { rows } = await db.query(
    `select s.id, s.name, s.hire_date::text as hire_date, s.leave_date::text as leave_date,
            s.leave_reason, c.recruiter_name
       from salespersons s
       left join candidates c on c.tenant_id = s.tenant_id and c.employee_id = s.id and c.deleted_at is null
      where s.tenant_id = $1 and s.hire_date is not null
        and s.hire_date >= $2 and s.hire_date <= $3 and s.deleted_at is null`,
    [ctx.tenantId, from, ctx.today]);
  const items = rows.map(r => {
    const hd = r.hire_date.slice(0, 10);
    const ld = r.leave_date ? r.leave_date.slice(0, 10) : null;
    const matured = diffDays(hd, ctx.today) >= BAD_DEBT_WINDOW_DAYS;
    return {
      employeeId: r.id, name: r.name, recruiterName: r.recruiter_name ?? null,
      hireDate: hd, leaveDate: ld, leaveReason: r.leave_reason ?? null,
      matured,
      badDebt: matured && ld ? isBadDebt(ld, hd, r.leave_reason) : false,
      responsibility: ld ? responsibilityOf(ld, hd) : null,
    };
  });
  const matured = items.filter(i => i.matured);
  const badCount = matured.filter(i => i.badDebt).length;
  const rate = matured.length < minSample ? null : safeDiv(badCount, matured.length);
  const groups = new Map();
  for (const i of matured) {
    const k = i.recruiterName || '—';
    if (!groups.has(k)) groups.set(k, { recruiterName: k, matured: 0, bad: 0 });
    const g = groups.get(k); g.matured++; if (i.badDebt) g.bad++;
  }
  const byRecruiter = [...groups.values()]
    .map(g => ({ ...g, rate: g.matured < minSample ? null : safeDiv(g.bad, g.matured) }));
  return { windowFrom: from, windowTo: ctx.today, maturedCount: matured.length, badCount, rate, items, byRecruiter };
}
