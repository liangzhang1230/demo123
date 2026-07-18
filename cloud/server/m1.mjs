/* ============================================================
   C3 · M1 填报服务（v5.1 §5.1 M1 行 🔴取代）
   🔒 口径出处：5号育人器 §3.x M1 填报中心 + ShiftConfig 点名排班
     - DailyReport 四计数 YE-01：leads / intents / samples / contracts（公约【1A】#12）
     - 同人同日唯一：重复提交 = 覆盖 counts（UPDATE + 事件），行数不变
     - ShiftConfig：员工 × 星期几；员工专属排班优先，'*' 兜底，默认周日休（weekday 0）
     - Y-D8：休息日四处排除——本模块承接其中两处：填报率分母 / 催报（missingToday）
   云端增量：填报率按 tenant 与逐人聚合；missingToday = 21:00 站内黄条数据源
   - 时钟注入（公约 C-14）：本模块零真实时钟调用；today/日期一律显式传入（ctx.today）
   - 写路径唯一：一切写走 writes.put / writes.patch（表行 + 事件双写）
   ============================================================ */
import { safeDiv, weekdayOf, dNum, numDate } from '../domain/shared.mjs';
import { put, patch } from './writes.mjs';

/* 四计数 |0 清洗（null/undefined/字符串/小数 → 整数；负数落 0，与 DB CHECK >= 0 同源） */
const c0 = v => { const n = v | 0; return n < 0 ? 0 : n; };

/**
 * 提交日报：同人同日已存在 → 覆盖 counts（UPDATE + daily_report_overwritten 事件），
 * 否则插入（INSERT + daily_report_submitted 事件）。
 * id 确定性生成（dr_{employeeId}_{date}）：与 unique(tenant_id, employee_id, report_date) 同构，零时钟调用。
 */
export async function submitDailyReport(db, ctx, { employeeId, date, counts = {} }) {
  const clean = {
    leads: c0(counts.leads), intents: c0(counts.intents),
    samples: c0(counts.samples), contracts: c0(counts.contracts),
  };
  const { rows } = await db.query(
    `select id from daily_reports
      where tenant_id = $1 and employee_id = $2 and report_date = $3 and deleted_at is null`,
    [ctx.tenantId, employeeId, date]);
  if (rows.length) {                                   // 覆盖：行数不变，counts 更新，事件 +1
    const row = await patch(db, ctx, 'daily_reports', 'id', rows[0].id,
      { ...clean, submitted_at: date }, 'daily_report_overwritten');
    return { mode: 'overwritten', id: row.id, counts: clean };
  }
  const id = `dr_${employeeId}_${date}`;
  await put(db, ctx, 'daily_reports',
    { id, employee_id: employeeId, report_date: date, ...clean, submitted_at: date, updated_by: ctx.actorId },
    'daily_report_submitted');
  return { mode: 'submitted', id, counts: clean };
}

/* ---------- 排班：员工专属 > '*' 兜底 > 默认周日休 ---------- */
async function loadShift(db, tenantId) {
  const { rows } = await db.query(
    `select employee_id, weekday, is_workday from shift_configs
      where tenant_id = $1 and deleted_at is null`, [tenantId]);
  const byEmp = new Map(), wildcard = new Map();
  for (const r of rows) {
    const wd = Number(r.weekday), on = !!r.is_workday;
    if (r.employee_id === '*') wildcard.set(wd, on);
    else {
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, new Map());
      byEmp.get(r.employee_id).set(wd, on);
    }
  }
  return { byEmp, wildcard };
}
function isWorkday(shift, employeeId, dateStr) {
  const wd = weekdayOf(dateStr);                       // 0 = 周日（shared.mjs 唯一口径）
  const own = shift.byEmp.get(employeeId)?.get(wd);
  if (own !== undefined) return own;                   // ① 员工专属排班优先
  const wild = shift.wildcard.get(wd);
  if (wild !== undefined) return wild;                 // ② '*' 租户兜底
  return wd !== 0;                                     // ③ 默认周日休
}

async function activeSales(db, tenantId) {
  const { rows } = await db.query(
    `select id, name from salespersons
      where tenant_id = $1 and level = 'sales' and is_active and deleted_at is null
      order by id`, [tenantId]);
  return rows;
}

/**
 * 填报率（区间 [from, to] 闭区间）：
 *   分母 = 该员工在区间内的工作日数（休息日不计分母，Y-D8）
 *   分子 = 有日报的工作日数（休息日提交的日报不进分子——分子恒 ≤ 分母）
 * 返回 { tenant: {workdays, filed, rate}, byEmployee: [{employeeId, name, workdays, filed, rate}] }
 * rate 走 safeDiv（分母 0 → null，不造 0%）。
 */
export async function fillRate(db, ctx, { from, to }) {
  const shift = await loadShift(db, ctx.tenantId);
  const people = await activeSales(db, ctx.tenantId);
  const { rows: reps } = await db.query(
    `select employee_id, report_date::text as d from daily_reports
      where tenant_id = $1 and report_date between $2 and $3 and deleted_at is null`,
    [ctx.tenantId, from, to]);
  const filedBy = new Map();
  for (const r of reps) {
    if (!filedBy.has(r.employee_id)) filedBy.set(r.employee_id, new Set());
    filedBy.get(r.employee_id).add(r.d.slice(0, 10));
  }
  const dates = [];
  for (let n = dNum(from); n <= dNum(to); n++) dates.push(numDate(n));
  const byEmployee = [];
  let tWork = 0, tFiled = 0;
  for (const p of people) {
    const set = filedBy.get(p.id) || new Set();
    let workdays = 0, filed = 0;
    for (const d of dates) {
      if (!isWorkday(shift, p.id, d)) continue;        // 休息日：分母分子双排除
      workdays++;
      if (set.has(d)) filed++;
    }
    tWork += workdays; tFiled += filed;
    byEmployee.push({ employeeId: p.id, name: p.name, workdays, filed, rate: safeDiv(filed, workdays) });
  }
  return { tenant: { workdays: tWork, filed: tFiled, rate: safeDiv(tFiled, tWork) }, byEmployee };
}

/**
 * 今日未填名单（21:00 站内黄条数据源；v5.1 §5.1 M1 云端增量）。
 * 今日 = ctx.today（显式注入，不取真实时钟）。
 * 该员工今日休息 → 不进名单（Y-D8 催报排除）；全员休息日 → 返回空数组。
 */
export async function missingToday(db, ctx) {
  const today = ctx.today;
  const shift = await loadShift(db, ctx.tenantId);
  const people = await activeSales(db, ctx.tenantId);
  const { rows } = await db.query(
    `select employee_id from daily_reports
      where tenant_id = $1 and report_date = $2 and deleted_at is null`, [ctx.tenantId, today]);
  const filed = new Set(rows.map(r => r.employee_id));
  return people
    .filter(p => isWorkday(shift, p.id, today) && !filed.has(p.id))
    .map(p => ({ employeeId: p.id, name: p.name }));
}
