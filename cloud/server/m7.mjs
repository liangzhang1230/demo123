/* ============================================================
   C5 · M7 定价器服务（v5.1 §7：M7 整章作废，逻辑直连 1号定价器）
   🔒 口径出处：
     - 1号定价器 v2.5 件三（五件套+风洞）：引擎已在 C1 移植为 domain/dingjia.mjs，
       本模块只组装取数与落库，**零公式重写**（v5.1 §7 云端增量第 1 条）
     - salesCount / managerCount 在云端为同库直读派生（v5.1 §2.3 信封降级）：
       从 salespersons 在职行数派生并覆盖 inputs 对应项——老板不再手填团队人数
     - p90Eff：external_refs(board='suanzhang').derived.realP90Factor（算账器信封 🔧C-07），
       缺 → 引擎回退 p90ColdFactor=1.8（gateFraudRisk 内建回退，本层只传 null）
     - 系数只经 getCoef：coef_overrides 表 → makeGetCoef（数值权归老板，公约三权分立）
   写路径：
     - computePlan = 纯沙盒，不落库（1号"输出不存储、载入即重算"）
     - saveScenario → comp_plan_scenarios（13 项输入快照）
     - adoptPlan → m2.createPlanVersion —— 🔴 "方案生效"唯一路径；
       effectiveFrom < ctx.today 拒绝（配合 C3 planVersionAt = 改版不追溯）
     - issueCovenantDoc → covenant_docs（编号 SK-YYMMDD-XXXX；快照签发时刻固化，
       表级触发器禁改禁删——D-06 无第二写路径）
     - registerMenuChoice → menu_choices（irrevocable，公约#27）
   - 时钟注入（公约 C-14）：本模块零真实时钟调用；业务日期一律 ctx.today
   - 一切表行写走 writes.put；无表行的动作留痕走 writes.logEvent
   ============================================================ */
import { computeAll, makeMenuChoice } from '../domain/dingjia.mjs';
import { makeGetCoef } from '../domain/shared.mjs';
import { createPlanVersion } from './m2.mjs';
import { put, logEvent } from './writes.mjs';
import { requireBoard } from './billing.mjs';

/* 信用书编号字符集（去 I/O/0/1 防混淆；1号件二 CovenantDoc.code） */
export const COVENANT_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = n => Array.from({ length: n },
  () => COVENANT_CODE_CHARSET[Math.floor(Math.random() * COVENANT_CODE_CHARSET.length)]).join('');

/* ---------- 取数三件套（组装层只读） ---------- */

/** 租户系数：coef_overrides 全表 → makeGetCoef（getCoef(path)=Override??COEFFICIENTS） */
export async function tenantGetCoef(db, ctx) {
  const { rows } = await db.query(
    `select path, value from coef_overrides where tenant_id = $1 and deleted_at is null`,
    [ctx.tenantId]);
  const overrides = {};
  for (const r of rows) overrides[r.path] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  return makeGetCoef(overrides);
}

/** 团队人数派生（只读，覆盖 inputs.salesCount / managerCount——云端同库直读） */
export async function deriveTeamCounts(db, ctx) {
  const { rows } = await db.query(
    `select count(*) filter (where level = 'sales')::int   as sales,
            count(*) filter (where level = 'manager')::int as managers
       from salespersons
      where tenant_id = $1 and is_active and deleted_at is null`, [ctx.tenantId]);
  return { salesCount: rows[0].sales, managerCount: rows[0].managers };
}

/** 真 P90：算账器信封 derived.realP90Factor；缺/非法 → null（引擎回退 1.8） */
export async function realP90Factor(db, ctx) {
  const { rows } = await db.query(
    `select derived from external_refs
      where tenant_id = $1 and board = 'suanzhang' and deleted_at is null`, [ctx.tenantId]);
  if (!rows.length) return null;
  const d = typeof rows[0].derived === 'string' ? JSON.parse(rows[0].derived) : (rows[0].derived || {});
  const v = Number(d.realP90Factor);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/* 组装：派生人数覆盖 → 租户系数 → 真 P90 → domain.computeAll（today 显式注入） */
async function assemble(db, ctx, inputs, targetYearMode) {
  const gc = await tenantGetCoef(db, ctx);
  const team = await deriveTeamCounts(db, ctx);
  const merged = { ...inputs, salesCount: team.salesCount, managerCount: team.managerCount };
  const p90Real = await realP90Factor(db, ctx);
  const result = computeAll(merged, { today: ctx.today, targetYearMode, gc, p90Real });
  return { inputs: merged, team, p90Real, result };
}

/**
 * 沙盒试算（不落库）：返回五账单（A/B/C/D/E + total）与全部闸（gates/fraud/validation）。
 * salesCount/managerCount 由库派生覆盖；p90Eff 走信封实时值（缺→1.8）。
 */
export async function computePlan(db, ctx, { inputs, targetYearMode = 'next' }) {
  await requireBoard(db, ctx, 'dingjia');       // C12 板块级授权守卫（boardsEnabled，v5.1 §11）
  return assemble(db, ctx, inputs, targetYearMode);
}

/** 场景快照落库（输出不存储、载入即重算——1号 #2）；targetYearMode 随 inputs 快照保存 */
export async function saveScenario(db, ctx, { id = null, name, inputs, targetYearMode = 'next' }) {
  const scenarioId = id ?? `sc_${randCode(8)}`;
  await put(db, ctx, 'comp_plan_scenarios',
    { id: scenarioId, name, created_date: ctx.today, inputs: { ...inputs, targetYearMode } },
    'comp_plan_scenario_saved');
  return { scenarioId, name };
}

async function loadScenario(db, ctx, scenarioId) {
  const { rows } = await db.query(
    `select id, name, inputs from comp_plan_scenarios
      where tenant_id = $1 and id = $2 and deleted_at is null`, [ctx.tenantId, scenarioId]);
  if (!rows.length) return null;
  const raw = typeof rows[0].inputs === 'string' ? JSON.parse(rows[0].inputs) : rows[0].inputs;
  const { targetYearMode = 'next', ...inputs } = raw;
  return { scenarioId: rows[0].id, name: rows[0].name, inputs, targetYearMode };
}

/* 场景实算取"销售层三值"（B/T/r）；闸①拦截或校验不过 → 抛错（坏方案无生效路径） */
async function computeSalesRow(db, ctx, scenarioId) {
  const sc = await loadScenario(db, ctx, scenarioId);
  if (!sc) throw new Error(`场景不存在：${scenarioId}`);
  const { inputs, result } = await assemble(db, ctx, sc.inputs, sc.targetYearMode);
  if (!result.validation.ok)
    throw new Error(`场景输入校验不过（W-00×${result.validation.errors.length}），不可采纳/签发`);
  const sales = result.A.sales;
  if (sales.blocked || sales.r == null)
    throw new Error('闸①拦截（W-02）：底薪吃穿现金目标，r 不出——方案不可采纳/签发');
  return { sc, inputs, result, sales };
}

/**
 * 采纳方案 = 生成新 comp_plan_versions 行（append-only）。
 * 🔴 这是"方案生效"的唯一路径；effectiveFrom < ctx.today 拒绝——
 *    配合 C3 planVersionAt(date) 机制，历史月份永远命中历史版本（改版不追溯）。
 */
export async function adoptPlan(db, ctx, { scenarioId, effectiveFrom }) {
  if (!effectiveFrom || effectiveFrom < ctx.today)
    throw new Error(`新方案不追溯：effectiveFrom(${effectiveFrom}) 不得早于 today(${ctx.today})`);
  const { inputs, sales } = await computeSalesRow(db, ctx, scenarioId);
  const v = await createPlanVersion(db, ctx,
    { inputs, rRate: sales.r, matrixTAmt: sales.T, effectiveFrom });
  await logEvent(db, ctx, 'plan_adopted', scenarioId,
    { scenarioId, version: v.version, rRate: sales.r, matrixTAmt: sales.T, effectiveFrom });
  return { scenarioId, version: v.version, rRate: sales.r, matrixTAmt: sales.T, effectiveFrom };
}

/**
 * 签发招聘信用书：编号 SK-{YYMMDD}-{4位}（YYMMDD=ctx.today）；
 * snapshot 从场景**实算**固化 {levelType,tierGrade,baseSalaryAmt,thresholdTAmt,commissionRate}，
 * 🔴 永不随场景重算变化（covenant_docs 触发器禁改禁删 = D-06 无第二写路径）。
 */
export async function issueCovenantDoc(db, ctx, { id = null, candidateName, scenarioId }) {
  if (!candidateName || String(candidateName).length > 10)
    throw new Error('candidateName 必填且 ≤10 字（1号件二 CovenantDoc）');
  const { sc, sales } = await computeSalesRow(db, ctx, scenarioId);
  const code = `SK-${ctx.today.slice(2).replace(/-/g, '')}-${randCode(4)}`;
  const snapshot = {
    levelType: 'sales', tierGrade: sc.inputs.tierGrade || 'effective',
    baseSalaryAmt: sales.B, thresholdTAmt: sales.T, commissionRate: sales.r,
  };
  const covId = id ?? `cov_${randCode(8)}`;
  await put(db, ctx, 'covenant_docs',
    { id: covId, code, candidate_name: candidateName, scenario_id: scenarioId, issued_date: ctx.today, snapshot },
    'covenant_doc_issued');
  return { id: covId, code, candidateName, scenarioId, issuedDate: ctx.today, snapshot };
}

/**
 * 登记自选激励菜单选择（公约#27 irrevocable：表无 UPDATE/DELETE 成功路径）。
 * menu = domain.generateMenu 产物；快照/校验走 domain.makeMenuChoice，零重写。
 */
export async function registerMenuChoice(db, ctx, { id = null, salespersonName, menu, chosenTier }) {
  const mc = makeMenuChoice({ salespersonName, menu, chosenTier, today: ctx.today });
  if (!mc) throw new Error('菜单或档位非法（E-11：low/mid/high；menu 须为 generateMenu 产物）');
  const choiceId = id ?? `mc_${randCode(8)}`;
  await put(db, ctx, 'menu_choices',
    { id: choiceId, salesperson_name: mc.salespersonName, menu_snapshot: mc.menuSnapshot,
      chosen_tier: mc.chosenTier, chosen_date: mc.chosenDate, irrevocable: true },
    'menu_choice_locked');
  return { id: choiceId, ...mc };
}
