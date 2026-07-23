/* ============================================================
   C7 · M12 配方引擎服务（v5.1 §5.1 M12 行 🔴取代）
   🔒 口径出处：5号育人器 v2.3 件三（唯一权威）：
     - 闸④ 配方源资格（3.1）：①M21 归一化排名∈前3 ②UER≥0 ③折扣泄漏≤团队均值
       ④客诉/退款≤团队均值；任一不满足→拦截；M21 未运行→配方引擎整体锁定（Y-D3/T3）
     - 闸③ 产权前提（3.1）：无 M28 ∨ AHC<信任线(ahcTrustLine=60) → 锁定（Y-D4/T4）
     - 闸① PLV 三层校验（3.2）：任一层不过 = 拦截保存（不是警告，Y-D1/T5-6）；
       坚持原文 → 留痕 + 计入认知鸿沟风险
     - 闸② PSI（3.3）：25×4 加权；>70🟢 / 40–70🟡 / <40🔴（T7）
     - 三张牌（3.1）：剂量/配比/节奏，近180天日报+成交喂 domain.threeCards，零新增录入
     - 带教任务（3.1）：同人同环节 7 天不重复；14 天回弹单次定稿；
       完成=主管上报 ∧ CoachingAck confirmed（no_response 7 天自动 confirmed；
       disputed 不计剂量+进老板异议列表）
   计算一律调 domain（C1 引擎，服务层只调不重写）：recipeGateCheck / propertyGate /
     plvCheck / plvRewriteHint / psiScore / psiBand / threeCards。
   前置：requireM21（闸①硬闸门，A-11——"配方"在锁清单里，m21.mjs 唯一守卫入口）。
   口径注记（P-1 现行口径）：闸④第④条"客诉/退款≤团队均值"——云端暂无客诉数据源
     （与 m32.attribution 同况：complaintRate 恒 null，null ≠ 0），该分项跳过并在
     qualified_flags 与返回值注明 complaint_skipped，待数据源接入后自动恢复判定。
   🔴 Y-D2：本模块（处方/悬赏域）永不被提成(m2)/排名(m21)/七级引用——调用链断言见 c7.test.mjs ②。
   时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today；写入一律经 writes 双写。
   ============================================================ */
import {
  recipeGateCheck, propertyGate, plvCheck, plvRewriteHint, psiScore, psiBand,
  threeCards as domainThreeCards,
} from '../domain/yuren.mjs';
import { getCoef, safeDiv, addDays, monthOf } from '../domain/shared.mjs';
import { put, patch, logEvent } from './writes.mjs';
import { requireM21, m21Done, prevMonth } from './m21.mjs';
import { personUER } from './m32.mjs';
import { loadShift, isWorkday as m1IsWorkday } from './m1.mjs';

/* no_response 自动确认天数（件三 3.1：no_response 7 天自动 confirmed；gc 可覆盖） */
export const ACK_AUTO_CONFIRM_DAYS = 7;

/* ---------- M21 最新有效月（requireM21 同判据：本月 → 上月） ---------- */
export async function latestM21Month(db, ctx) {
  const cur = monthOf(ctx.today);
  if (await m21Done(db, ctx, { month: cur })) return cur;
  if (await m21Done(db, ctx, { month: prevMonth(cur) })) return prevMonth(cur);
  return null;
}

/* ---------- 折扣泄漏率（近12月 Σdiscount/Σlist，个人 + 团队——与 m32.attribution 同法） ---------- */
async function discountRates(db, ctx) {
  const from = addDays(ctx.today, -365);
  const { rows } = await db.query(
    `select employee_id, coalesce(sum(discount_amt),0)::float8 as disc, coalesce(sum(list_price_amt),0)::float8 as list
       from discount_entries
      where tenant_id = $1 and discount_date >= $2 and discount_date <= $3 and deleted_at is null
      group by employee_id`, [ctx.tenantId, from, ctx.today]);
  let allDisc = 0, allList = 0;
  const bySp = new Map();
  for (const r of rows) {
    allDisc += Number(r.disc); allList += Number(r.list);
    bySp.set(r.employee_id, safeDiv(Number(r.disc), Number(r.list)));
  }
  return { bySp, teamMean: safeDiv(allDisc, allList) };
}

/* ---------- 闸④ 单人输入组装（rankNorm ← m21_norms；uer ← derived_scalars；折扣 ← discount_entries） ---------- */
export async function recipeGateFor(db, ctx, spId, { month, disc, gc = getCoef } = {}) {
  const m = month || await latestM21Month(db, ctx);
  const d = disc || await discountRates(db, ctx);
  const { rows } = await db.query(
    `select norm_rank from m21_norms where tenant_id = $1 and sp_id = $2 and month = $3`,
    [ctx.tenantId, spId, m]);
  const rankNorm = rows.length && rows[0].norm_rank != null ? Number(rows[0].norm_rank) : null;
  const { uer } = await personUER(db, ctx, spId);
  /* P-1：客诉数据源缺失 → complaintLeMean 关闭该分项（跳过并注明），其余三条照判 */
  const coef = { ...gc('yuren.recipeGate'), complaintLeMean: false };
  const check = recipeGateCheck(
    { rankNorm, uer, discountRate: d.bySp.get(spId) ?? null, complaintCount: null },
    { m21Done: m != null, teamDiscountMean: d.teamMean, teamComplaintMean: null, coef }, gc);
  return { spId, rankNorm, uer, check, complaintSkipped: true };
}

/**
 * 设定配方源（1–3 人）：前置 requireM21 → 逐人过 domain.recipeGateCheck（闸④）→
 * 任一不过 = 拒绝（零写入）→ 全过 = 落 recipe_sources + 事件 recipe_source_set。
 */
export async function setRecipeSource(db, ctx, { sourceIds, gc = getCoef }) {
  await requireM21(db, ctx);                            // 🔴 闸①：配方在 A-11 锁清单里
  const month = await latestM21Month(db, ctx);
  const disc = await discountRates(db, ctx);
  const perSp = [];
  for (const spId of sourceIds) {
    const r = await recipeGateFor(db, ctx, spId, { month, disc, gc });
    perSp.push(r);
    if (r.check.locked || !r.check.qualified)
      return { ok: false, spId, check: r.check, perSp,
        notes: ['complaint_skipped_no_datasource(P-1)'] };  // 拒 A 荐 J（话术 Y-01 表现层渲染）
  }
  const { rows } = await db.query(
    `select count(*)::int as n from recipe_sources where tenant_id = $1`, [ctx.tenantId]);
  const id = `rs_${rows[0].n + 1}`;
  await put(db, ctx, 'recipe_sources',
    { id, source_ids: sourceIds, set_at: ctx.today, set_by: String(ctx.actorId),
      qualified_flags: { month, perSp: perSp.map(p => ({ spId: p.spId, rankNorm: p.rankNorm, uer: p.uer })), complaintSkipped: true } },
    'recipe_source_set');
  return { ok: true, id, month, perSp, notes: ['complaint_skipped_no_datasource(P-1)'] };
}

/** 现行配方源（最新一次设定；无 → null） */
export async function currentRecipeSource(db, ctx) {
  const { rows } = await db.query(
    `select id, source_ids, set_at::text as set_at from recipe_sources
      where tenant_id = $1 and deleted_at is null
      order by set_at desc nulls last, created_at desc limit 1`, [ctx.tenantId]);
  if (!rows.length) return null;
  const sj = rows[0].source_ids;
  return { id: rows[0].id, sourceIds: typeof sj === 'string' ? JSON.parse(sj) : sj, setAt: rows[0].set_at };
}

/**
 * 闸③ 产权前提（Y-D4）：配方源逐人 M28（m28_agreements 直读）+ AHC
 * （derived_scalars(tenant,'ahc') 最新期；缺 → null → 锁定并说明 ahc_missing，null ≠ 0）。
 */
export async function propertyGateCheck(db, ctx, { gc = getCoef } = {}) {
  const rs = await currentRecipeSource(db, ctx);
  if (!rs) return { locked: true, reason: 'no_recipe_source', perSource: [], ahc: null };
  const { rows: ar } = await db.query(
    `select value_num::float8 as v from derived_scalars
      where tenant_id = $1 and scope = 'tenant' and key = 'ahc'
      order by period desc, computed_at desc limit 1`, [ctx.tenantId]);
  const ahc = ar.length && ar[0].v != null ? Number(ar[0].v) : null;   // 缺 → null 锁定说明
  const perSource = [];
  for (const spId of rs.sourceIds) {
    const { rows: m28 } = await db.query(
      `select id from m28_agreements where tenant_id = $1 and master_id = $2 and deleted_at is null limit 1`,
      [ctx.tenantId, spId]);
    perSource.push({ spId, hasM28: m28.length > 0, gate: propertyGate({ hasM28: m28.length > 0, ahc }, gc) });
  }
  const locked = perSource.some(p => p.gate.locked);
  return { locked, ahc, perSource,
    reason: locked ? perSource.find(p => p.gate.locked).gate.reason : null };
}

/**
 * 🔴 保存处方（闸① PLV 三层）：任一层不过 → 拒绝保存（返回三层结果 + plvRewriteHint
 * 改写脚手架，零写入——拦截不是警告，Y-D1）；insist=true 才放行并写 prescription_insisted
 * 留痕事件（坚持原文 → 计入认知鸿沟风险）。过闸 → prescriptions 落库 + psiScore 存 psi_parts + 事件。
 */
export async function savePrescription(db, ctx, {
  employeeId, type = 'volume', target = 'self', text, slotData = null,
  psiParts = null, insist = false, momentumMode = false, gc = getCoef,
}) {
  const { rows: sps } = await db.query(
    `select name from salespersons where tenant_id = $1 and deleted_at is null`, [ctx.tenantId]);
  const plv = plvCheck(text, { names: sps.map(r => r.name).filter(Boolean), momentum: momentumMode }, gc);
  if (!plv.passed && !insist)
    return { ok: false, plv, hints: plvRewriteHint(plv) };            // 🔴 保存路径不存在（零写入）
  if (!plv.passed && insist)
    await logEvent(db, ctx, 'prescription_insisted', employeeId,
      { employeeId, text, plv: { l1: plv.l1.pass, l2: plv.l2.pass, l3: plv.l3.pass } });
  const psi = psiScore(psiParts, gc);                                 // parts 缺 → null（不硬造）
  const { rows: cnt } = await db.query(
    `select count(*)::int as n from prescriptions where tenant_id = $1 and employee_id = $2 and rx_date = $3`,
    [ctx.tenantId, employeeId, ctx.today]);
  const id = `rx_${employeeId}_${ctx.today}_${cnt[0].n + 1}`;
  await put(db, ctx, 'prescriptions',
    { id, employee_id: employeeId, rx_date: ctx.today, type, target,
      slot_data: slotData, text,
      psi_parts: psiParts == null ? null : { ...psiParts, score: psi, band: psiBand(psi, gc) },
      plv_passed: plv.passed },
    'prescription_saved');
  return { ok: true, id, plv, psi, band: psiBand(psi, gc), insisted: !plv.passed && insist };
}

/* ============================================================
   领域视图组装：SQL → domain-db 形状（C1 引擎 emptyDB 同构；服务层只组装不重算）
   - 休息日解析复用 m1.loadShift/isWorkday（Y-D8 唯一口径），折成 domain 的
     restDays 列表：对星期 0..6 逐一问 m1（2026-01-04 恰为周日，+wd 得对应星期的样本日）
   ============================================================ */
const SUNDAY_ANCHOR = '2026-01-04';                     // 周日样本日（weekdayOf=0）
function restDaysFor(shift, employeeId) {
  const rest = [];
  for (let wd = 0; wd <= 6; wd++)
    if (!m1IsWorkday(shift, employeeId, addDays(SUNDAY_ANCHOR, wd))) rest.push(wd);
  return rest;
}

export async function buildDomainDb(db, ctx) {
  const { rows: sps } = await db.query(
    `select id, name, hire_date::text as hire_date, is_active from salespersons
      where tenant_id = $1 and (level is null or level = 'sales') and deleted_at is null
      order by id`, [ctx.tenantId]);
  const { rows: reps } = await db.query(
    `select employee_id, report_date::text as d, leads, intents, samples, contracts
       from daily_reports where tenant_id = $1 and deleted_at is null order by report_date`, [ctx.tenantId]);
  const { rows: deals } = await db.query(
    `select employee_id, deal_date::text as d, status, category_id, payment_amt::bigint as pay
       from deals where tenant_id = $1 and deleted_at is null order by deal_date`, [ctx.tenantId]);
  const { rows: acks } = await db.query(
    `select employee_id, coach_task_id, employee_ack_status as status, duration_min,
            manager_reported_at::date::text as d
       from coaching_acks where tenant_id = $1 and deleted_at is null`, [ctx.tenantId]);
  const rs = await currentRecipeSource(db, ctx);
  const month = await latestM21Month(db, ctx);
  const m21rows = month == null ? [] : (await db.query(
    `select sp_id, norm_rank, lead_index::float8 as li from m21_norms where tenant_id = $1 and month = $2`,
    [ctx.tenantId, month])).rows;
  const shift = await loadShift(db, ctx.tenantId);
  const shiftConfig = { '*': restDaysFor(shift, '__none__') };
  for (const p of sps) shiftConfig[p.id] = restDaysFor(shift, p.id);
  /* 前14天练习计数（practice_logs → domain XREF.practice14 期望的 {spId, count14}） */
  const practiceLogs = [];
  for (const p of sps) {
    if (!p.hire_date) { practiceLogs.push({ spId: p.id, count14: null }); continue; }
    const { rows: pr } = await db.query(
      `select count(*)::int as n from practice_logs
        where tenant_id = $1 and employee_id = $2 and deleted_at is null
          and practice_date >= $3 and practice_date <= $4`,
      [ctx.tenantId, p.id, p.hire_date, addDays(p.hire_date, 13)]);
    practiceLogs.push({ spId: p.id, count14: pr[0].n });
  }
  return {
    salespeople: sps.map(p => ({ spId: p.id, name: p.name, hireDate: p.hire_date, isActive: p.is_active })),
    dailyReports: reps.map(r => ({ employeeId: r.employee_id, date: r.d,
      counts: { leads: r.leads, intents: r.intents, samples: r.samples, contracts: r.contracts } })),
    prescriptions: [], coachTasks: [],
    coachingAcks: acks.map(a => ({ spId: a.employee_id, coachId: null, date: a.d,
      durationHrs: a.duration_min == null ? null : a.duration_min / 60, status: a.status })),
    bounties: [], spotChecks: [],
    practiceLogs,
    recipeSource: rs ? { sourceIds: rs.sourceIds, setAt: rs.setAt, setBy: null, qualifiedFlags: true } : null,
    pairAssignments: [], callMetrics: [],
    paceConfig: { periodType: 'month', quotaSource: 'manual', manualQuotaBySp: {} },
    shiftConfig,
    externalRef: {
      suanzhang: { exportedAt: ctx.today, dataVersion: 1, coefficientsHash: null, importedAt: ctx.today,
        derived: {},
        entities: {
          M21Norm: m21rows.map(r => ({ spId: r.sp_id, rankNorm: r.norm_rank, leadIndex: r.li })),
          Deal: deals.map(d => ({ spId: d.employee_id, status: d.status, contractDate: d.d,
            category: d.category_id, paymentAmt: Number(d.pay) })),
        } },
    },
    settings: { silentTrackOn: false, lastExportAt: null, insistLog: [] },
    coefOverrides: {},
  };
}

/** 三张牌（剂量/配比/节奏）：daily_reports + deals 近180天喂 domain.threeCards（窗口在引擎内） */
export async function threeCards(db, ctx) {
  const ddb = await buildDomainDb(db, ctx);
  return domainThreeCards(ddb, ctx.today);
}

/**
 * 建带教任务：同人同环节 7 天不重复（判据零时钟：rebound_due = 创建日+14 ⇒
 * 近7天建的任务 rebound_due > today+7）。落 coach_tasks（rebound_due=+14d）
 * + 配套 coaching_acks 回执行（no_response 起步）+ 事件。带教任务进主管待办（表现层按 manager_id 取）。
 */
export async function createCoachTask(db, ctx, { employeeId, managerId, stage }) {
  const { rows: dup } = await db.query(
    `select id from coach_tasks
      where tenant_id = $1 and employee_id = $2 and stage = $3 and deleted_at is null
        and rebound_due > $4`,
    [ctx.tenantId, employeeId, stage, addDays(ctx.today, 7)]);
  if (dup.length) return { ok: false, err: '同人同环节 7 天不重复', existingId: dup[0].id };
  const id = `ct_${employeeId}_${stage}_${ctx.today}`;
  await put(db, ctx, 'coach_tasks',
    { id, employee_id: employeeId, manager_id: managerId, stage, rebound_due: addDays(ctx.today, 14) },
    'coach_task_created');
  const ackId = `ack_${id}`;
  await put(db, ctx, 'coaching_acks',
    { id: ackId, coach_task_id: id, manager_id: managerId, employee_id: employeeId,
      employee_ack_status: 'no_response' },
    'coaching_ack_created');
  return { ok: true, id, ackId, reboundDue: addDays(ctx.today, 14) };
}

/** 主管上报带教发生（时长入回执；完成=上报 ∧ confirmed） */
export async function reportCoachTask(db, ctx, { coachTaskId, durationMin = null }) {
  await patch(db, ctx, 'coach_tasks', 'id', coachTaskId,
    { manager_reported_at: ctx.today }, 'coach_task_reported');
  const { rows } = await db.query(
    `select id from coaching_acks where tenant_id = $1 and coach_task_id = $2 and deleted_at is null`,
    [ctx.tenantId, coachTaskId]);
  if (rows.length)
    await patch(db, ctx, 'coaching_acks', 'id', rows[0].id,
      { manager_reported_at: ctx.today, duration_min: durationMin }, 'coaching_ack_reported');
  return { ok: true, ackId: rows.length ? rows[0].id : null };
}

/**
 * 惰性 sweep：no_response 且主管已上报超 ACK_AUTO_CONFIRM_DAYS(7) 天 → 自动 confirmed
 * （件三 3.1；employee_ack_at 留空以区分"本人确认"与"超时视同"）。
 */
export async function sweepAcks(db, ctx) {
  const cutoff = addDays(ctx.today, -ACK_AUTO_CONFIRM_DAYS);
  const { rows } = await db.query(
    `select id from coaching_acks
      where tenant_id = $1 and deleted_at is null and employee_ack_status = 'no_response'
        and manager_reported_at is not null and manager_reported_at::date <= $2`,
    [ctx.tenantId, cutoff]);
  for (const r of rows)
    await patch(db, ctx, 'coaching_acks', 'id', r.id,
      { employee_ack_status: 'confirmed' }, 'coaching_ack_autoconfirmed');
  return { swept: rows.length };
}

/**
 * 销售端回执确认/异议（CoachingAck 确认按钮）：入口先跑惰性 sweep。
 * disputed：不计剂量（剂量分子只取 confirmed——DB 读侧口径）+ 事件即老板异议列表数据源。
 */
export async function ackCoaching(db, ctx, { ackId, status = 'confirmed' }) {
  const sweep = await sweepAcks(db, ctx);
  if (!ackId) return { ok: true, ...sweep };
  if (!['confirmed', 'disputed'].includes(status)) return { ok: false, err: 'status ∈ {confirmed,disputed}' };
  const row = await patch(db, ctx, 'coaching_acks', 'id', ackId,
    { employee_ack_status: status, employee_ack_at: ctx.today }, 'coaching_ack_updated');
  return { ok: true, id: row.id, status, ...sweep };
}
