/* ============================================================
   C5 · 季度校准（v4.0 §7.6 唯一存活部分的云端实现；v5.1 §7 云端增量第 2/3 条）
   🔒 口径出处：
     - v5.1 §7：三传感器在云端为实时——市价（招人器 F5=m4.marketPrice）、
       四灯（招人器 F7=m8.tempLights）、守护线（留人器 M16.2）；转红即插卡，
       老板一键确认后新锚传导四处
     - 4号留人器 §16.2 守护线：totalIncome < 矩阵T 连续≥2月 → 插卡
       （云端简化：近 2 个完整月，逐人经 m2.incomeFor——公约 §4.1 宪法函数，零重算）
     - 🔴 三权分立不破（v5.1 §7）：proposeAnchor 只生成**草案**
       （action_cards kind='salary_review' state='pending'），绝不直接写 comp_plan_versions；
       老板二次确认（confirmAnchor）→ 走 m7.adoptPlan 生成新版本——不追溯
       （adoptPlan 拒绝 effectiveFrom < today + C3 planVersionAt 机制双保险）
   市价偏离阈值为云端原创常量（规格未给数值，同 m4 蓄水池阈值先例）：
     市价 median 高出当前版本矩阵 B_sales ≥20% → 红；≥10% → 黄。
   矩阵 B 从当期版本 inputs 经 domain.calcCardA 现算（服务层零公式重写）。
   - 时钟注入（公约 C-14）：本模块零真实时钟调用；业务日期一律 ctx.today
   - action_cards 无 created_by/updated_by 列（C0 底座表），无法走 writes.put/patch——
     本模块以同构的本地双写事务（表行+事件同一事务）落卡，语义与 writes 一致
   ============================================================ */
import { calcCardA } from '../domain/dingjia.mjs';
import { safeDiv } from '../domain/shared.mjs';
import { marketPrice } from './m4.mjs';
import { tempLights } from './m8.mjs';
import { planVersionAt, incomeFor } from './m2.mjs';
import { adoptPlan, saveScenario, tenantGetCoef } from './m7.mjs';

/* 云端原创阈值（规格 gap：v5.1 §7 只说"市价偏离"，未给数值） */
export const MARKET_DEV_RED = 0.20;      // 市价高出矩阵 B ≥20% → 红
export const MARKET_DEV_YELLOW = 0.10;   // ≥10% → 黄
export const GUARD_MONTHS = 2;           // 守护线连续月数（留人器 M16.2 逐字：≥2月）

/* 近第 n 个完整月（today 所在月不完整不计入）："2026-07-13",1 → "2026-06" */
const prevMonth = (today, n) => {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - n;
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
};

const FOUR_KEYS = ['offerAccept', 'noshow', 'cycleWorse', 'poachShare'];

/**
 * 三传感器实时值。每个传感器返回 { light, evidence }。
 * - market：m4.marketPrice(positionName) vs 当期版本矩阵 B_sales（calcCardA 现算）；
 *   无当期版本 / 样本<5（median=null）/ 版本 inputs 不可算 → grey
 * - fourLights：m8.tempLights 任一红→红；任一黄→黄；全灰→灰；其余绿
 * - guard：在职销售中 totalIncome<矩阵T 连续≥GUARD_MONTHS 个完整月的人数；>0 → 红
 */
export async function sensors(db, ctx, { positionName = '销售', windowDays = 90 } = {}) {
  const gc = await tenantGetCoef(db, ctx);
  const plan = await planVersionAt(db, ctx, ctx.today);
  const planInputs = plan
    ? (typeof plan.inputs === 'string' ? JSON.parse(plan.inputs) : plan.inputs) : null;

  /* ---- ① 市价（招人器 F5） ---- */
  const mp = await marketPrice(db, ctx, { positionName });
  let market;
  let matrixBAmt = null;
  if (planInputs) {
    try {   // 矩阵 B 现算（domain 唯一公式源）；legacy 版本 inputs 不全 → 不可算
      const B = calcCardA(planInputs, 1, planInputs.salesCount ?? 0, gc).sales.B;
      if (Number.isFinite(B) && B > 0) matrixBAmt = B;
    } catch { matrixBAmt = null; }
  }
  if (mp.medianAmt == null || matrixBAmt == null) {
    market = { light: 'grey', evidence: { ...mp, matrixBAmt, deviation: null } };
  } else {
    const deviation = safeDiv(mp.medianAmt - matrixBAmt, matrixBAmt);
    const light = deviation >= MARKET_DEV_RED ? 'red'
      : deviation >= MARKET_DEV_YELLOW ? 'yellow' : 'green';
    market = { light, evidence: { ...mp, matrixBAmt, deviation } };
  }

  /* ---- ② 四灯（招人器 F7） ---- */
  const tl = await tempLights(db, ctx, { windowDays, gc });
  const lights = Object.fromEntries(FOUR_KEYS.map(k => [k, { light: tl[k].light, value: tl[k].value, n: tl[k].n }]));
  const reds = FOUR_KEYS.filter(k => tl[k].light === 'red');
  const fourLight = reds.length ? 'red'
    : FOUR_KEYS.some(k => tl[k].light === 'yellow') ? 'yellow'
    : FOUR_KEYS.every(k => tl[k].light === 'grey') ? 'grey' : 'green';
  const fourLights = { light: fourLight, evidence: { reds, lights, windowDays } };

  /* ---- ③ 守护线（留人器 M16.2；🔒 收入经 m2.incomeFor→shared.totalIncome） ---- */
  let guard;
  const matrixTAmt = plan && plan.matrix_t_amt != null ? Number(plan.matrix_t_amt) : null;
  if (matrixTAmt == null) {
    guard = { light: 'grey', evidence: { matrixTAmt: null, months: [], count: null, people: [] } };
  } else {
    const months = Array.from({ length: GUARD_MONTHS }, (_, i) => prevMonth(ctx.today, GUARD_MONTHS - i));
    const { rows: emps } = await db.query(
      `select id, name from salespersons
        where tenant_id = $1 and level = 'sales' and is_active and deleted_at is null
        order by id`, [ctx.tenantId]);
    const people = [];
    for (const e of emps) {
      const incomes = [];
      for (const m of months) incomes.push((await incomeFor(db, ctx, { employeeId: e.id, month: m })).incomeAmt);
      if (incomes.every(v => v != null && v < matrixTAmt))
        people.push({ employeeId: e.id, name: e.name, months, incomes });
    }
    guard = { light: people.length ? 'red' : 'green',
      evidence: { matrixTAmt, months, count: people.length, people } };
  }

  return { market, fourLights, guard, planVersion: plan ? plan.version : null };
}

/* ---- action_cards 本地双写（表行+事件同一事务；该表无 created_by/updated_by 列） ---- */
async function insertCard(db, ctx, { kind, payload, eventType }) {
  let cardId = null;
  await db.transaction(async tx => {
    const r = await tx.query(
      `insert into action_cards(tenant_id, kind, state, payload) values ($1,$2,'pending',$3) returning card_id`,
      [ctx.tenantId, kind, JSON.stringify(payload)]);
    cardId = Number(r.rows[0].card_id);
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, eventType, ctx.actorId, String(cardId), JSON.stringify({ cardId, kind, ...payload })]);
  });
  return cardId;
}
async function cardToDone(db, ctx, cardId, trailEntry, eventType, eventPayload) {
  await db.transaction(async tx => {
    const r = await tx.query(
      `update action_cards
          set state = 'done', trail = trail || $3::jsonb, updated_at = now()
        where tenant_id = $1 and card_id = $2 returning card_id`,
      [ctx.tenantId, cardId, JSON.stringify([trailEntry])]);
    if (!r.rows.length) throw new Error(`action_card ${cardId} 不在租户内`);
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, eventType, ctx.actorId, String(cardId), JSON.stringify(eventPayload)]);
  });
}

/**
 * 任一传感器红 → 生成校准**草案**卡（kind='salary_review'，state='pending'）。
 * 🔴 只插卡，绝不写 comp_plan_versions（三权分立：新锚草案 ≠ 生效）。
 * 已有 pending 的 salary_review 卡 → 不重复插（返回 existingCardId）。
 * 全部非红 → 不出卡。
 */
export async function proposeAnchor(db, ctx, opts = {}) {
  const s = await sensors(db, ctx, opts);
  const redSensors = ['market', 'fourLights', 'guard'].filter(k => s[k].light === 'red');
  if (!redSensors.length) return { created: false, redSensors, sensors: s };

  const { rows: existing } = await db.query(
    `select card_id from action_cards
      where tenant_id = $1 and kind = 'salary_review' and state = 'pending'
      order by card_id limit 1`, [ctx.tenantId]);
  if (existing.length)
    return { created: false, existingCardId: Number(existing[0].card_id), redSensors, sensors: s };

  /* 建议新锚方向：市价压过矩阵 B → 抬锚；守护线破 → 复核 T/G（M16.2"G 定错了"口径）；
     仅四灯红 → 复核矩阵。方向只是草案建议，数值由老板在定价器里试算后确认。 */
  const direction = redSensors.includes('market') && s.market.evidence.deviation > 0 ? 'raise_anchor'
    : redSensors.includes('guard') ? 'review_threshold_or_G' : 'review_matrix';
  const payload = {
    reason: 'quarterly_calibration', proposedDate: ctx.today,
    planVersion: s.planVersion, redSensors,
    sensors: { market: s.market, fourLights: s.fourLights, guard: s.guard },
    suggestion: { direction },
  };
  const cardId = await insertCard(db, ctx,
    { kind: 'salary_review', payload, eventType: 'salary_review_card_created' });
  return { created: true, cardId, redSensors, direction, sensors: s };
}

/**
 * 老板二次确认：校准卡流转 done + 新锚经 m7.adoptPlan 生效（唯一路径）。
 * inputs = 老板在定价器确认的新 13 项输入；effectiveFrom ≥ today（不追溯，adoptPlan 内守卫）。
 */
export async function confirmAnchor(db, ctx, { cardId, inputs, effectiveFrom, targetYearMode = 'next' }) {
  const { rows } = await db.query(
    `select card_id, kind, state from action_cards where tenant_id = $1 and card_id = $2`,
    [ctx.tenantId, cardId]);
  if (!rows.length) throw new Error(`action_card ${cardId} 不存在`);
  if (rows[0].kind !== 'salary_review') throw new Error(`card ${cardId} 非 salary_review 卡`);
  if (rows[0].state === 'done') throw new Error(`card ${cardId} 已确认过（done）`);

  const { scenarioId } = await saveScenario(db, ctx,
    { name: `季度校准新锚（card#${cardId}）`, inputs, targetYearMode });
  const adopted = await adoptPlan(db, ctx, { scenarioId, effectiveFrom });   // 🔴 生效唯一路径 + 不追溯守卫
  await cardToDone(db, ctx, cardId,
    { at: ctx.today, by: ctx.actorId, action: 'boss_confirmed', version: adopted.version, scenarioId },
    'salary_review_card_done',
    { cardId: Number(cardId), scenarioId, version: adopted.version, effectiveFrom });
  return { cardId: Number(cardId), ...adopted };
}
