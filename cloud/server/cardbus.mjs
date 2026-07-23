/* ============================================================
   C10 · 插卡总线 cardBus（v5.1 §12 C10 行；L3 推送层——云端原创）
   🔒 口径出处：
     - v5.1 §1.2：插卡 =「今日一件事」的一条。待办级（todo）不限量置顶 /
       预警级（alert）每日 ≤3 张；action_card = 一切建议动作的唯一载体，
       统一状态机、统一留痕、🔴 永不自动执行（A-C04——本模块零员工状态写路径）
     - v5.1 §5.3：插卡总线两级限流 + 固定优先级（v4.0 原创保留，五板块无对应）
     - v5.1 §4 / §10.8：actionCardKind 10 值；actionCardState 5 态
       pending→assigned→doing→done→filled（顺序流转，跳态拒）
   🔴 本模块 = 全系统唯一插卡入口：calibrate.proposeAnchor / m37_38.offboard /
     m15.cullCheck 的内联插卡已全部收口改线到 insertCard（C10 改造）。
   - action_cards 无 created_by/updated_by 列（C0 底座表），无法走 writes.put/patch——
     本模块以本地双写事务（表行+事件同一事务）落卡，语义与 writes 一致（原 calibrate 先例）
   - 🔴 防疲劳（dedupKey + cooldownDays）：同 tenant+dedupKey
       ① 已有未完成卡（state ∉ done/filled）→ 恒跳过（原「已有 pending 不重复」语义的总线化）；
       ② 已完成卡在 cooldownDays 内 → 跳过（时间冷却，剪刀差"30天防疲劳"同魂）。
     跳过返回 { skipped:'cooldown', existingCardId }，零落库零事件。
   - 🔴 两级限流：level='alert' 当日（ctx.today）已展示满 ALERT_DAILY_LIMIT=3 张
     → 本张 payload.folded=true（仍落库可查，todayCards 折叠区展示）；todo 级不限量。
     "当日"以 payload.day = ctx.today 记（业务日注入，公约 C-14——created_at 是墙钟不可用）。
   - 时钟注入（公约 C-14）：本模块零真实时钟调用；业务日期一律 ctx.today
   ============================================================ */
import { diffDays } from '../domain/shared.mjs';

/* 🔴 固定优先级（v5.1 §5.3 只说"固定优先级"未给顺序——本序为云端常量，
   注释可覆盖：业务危急度递减 止血>留任>该谈>薪酬复核>汰评估>带教>履约>抽检>扩编>新人判定。
   若板块规格日后给出权威顺序，改此常量即可（唯一一处）。 */
export const KIND_PRIORITY = [
  'stopbleed', 'retain', 'talk', 'salary_review', 'eliminate',
  'coaching', 'honor', 'spotcheck', 'expand', 'newhire_judge',
];
export const ALERT_DAILY_LIMIT = 3;                      // v5.1 §1.2：预警级每日 ≤3 张
export const STATE_ORDER = ['pending', 'assigned', 'doing', 'done', 'filled'];
export const MGMT_ROLES = new Set(['boss', 'exec', 'manager']);
const TERMINAL = new Set(['done', 'filled']);

export const kindPriority = kind => {
  const i = KIND_PRIORITY.indexOf(kind);
  return i === -1 ? KIND_PRIORITY.length : i;
};
const byPriority = (a, b) => kindPriority(a.kind) - kindPriority(b.kind) || a.cardId - b.cardId;
const parseJson = v => (typeof v === 'string' ? JSON.parse(v) : (v ?? {}));

/**
 * 🔴 唯一插卡入口。
 * level：'todo'（待办级，不限量置顶）| 'alert'（预警级，每日 ≤3 展示，超限折叠）。
 * dedupKey + cooldownDays：防疲劳（见文件头两条规则）；不传 dedupKey = 不去重。
 * eventType：事件双写类型，默认 'action_card_created'；改线模块传各自历史类型
 *   （salary_review_card_created / talk_card_created / eliminate_card_created——测试语义兼容）。
 * 返回 { cardId, folded, level } 或 { skipped:'cooldown', existingCardId }。
 */
export async function insertCard(db, ctx, {
  kind, level = 'todo', targetId = null, payload = {}, assignedTo = null,
  dedupKey = null, cooldownDays = 0, eventType = 'action_card_created',
}) {
  if (!KIND_PRIORITY.includes(kind)) throw new Error(`未知 actionCardKind：${kind}（§4 枚举 10 值）`);
  if (level !== 'todo' && level !== 'alert') throw new Error(`未知插卡级别：${level}（todo|alert）`);

  /* ---- 🔴 防疲劳 ---- */
  if (dedupKey != null) {
    const { rows } = await db.query(
      `select card_id, state, payload->>'day' as day from action_cards
        where tenant_id = $1 and payload->>'dedupKey' = $2
        order by card_id desc`, [ctx.tenantId, dedupKey]);
    for (const r of rows) {
      const active = !TERMINAL.has(r.state);             // 未完成卡恒去重（原"已有 pending 不重复"）
      const cooling = cooldownDays > 0 && r.day != null && diffDays(r.day, ctx.today) < cooldownDays;
      if (active || cooling) return { skipped: 'cooldown', existingCardId: Number(r.card_id) };
    }
  }

  /* ---- 🔴 预警级当日限流（folded 标记，仍落库可查） ---- */
  let folded = false;
  if (level === 'alert') {
    const { rows } = await db.query(
      `select count(*)::int as n from action_cards
        where tenant_id = $1 and payload->>'day' = $2 and payload->>'level' = 'alert'
          and coalesce((payload->>'folded')::boolean, false) = false`,
      [ctx.tenantId, ctx.today]);
    folded = rows[0].n >= ALERT_DAILY_LIMIT;
  }

  const fullPayload = {
    ...payload, level, day: ctx.today,
    ...(dedupKey != null ? { dedupKey } : {}),
    ...(level === 'alert' ? { folded } : {}),
  };
  const trail = [{ at: ctx.today, by: ctx.actorId, action: 'created', state: 'pending' }];

  let cardId = null;
  try {
    await db.transaction(async tx => {                   // 表行 + 事件同一事务（双写）
      const r = await tx.query(
        `insert into action_cards(tenant_id, kind, state, target_id, payload, assigned_to, trail)
         values ($1,$2,'pending',$3,$4,$5,$6) returning card_id`,
        [ctx.tenantId, kind, targetId, JSON.stringify(fullPayload), assignedTo, JSON.stringify(trail)]);
      cardId = Number(r.rows[0].card_id);
      await tx.query(
        `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
        [ctx.tenantId, eventType, ctx.actorId, String(cardId),
         JSON.stringify({ cardId, kind, targetId, ...fullPayload })]);
    });
  } catch (e) {
    // 🔴 并发去重兜底：ac_dedup_active 唯一索引冲突 = 同 dedupKey 已有活跃卡先落库 → 按去重跳过。
    //    弥补 check-then-act 的 TOCTOU 窗口（SELECT 查重与 INSERT 之间的并发穿插）。
    if (dedupKey != null && /unique|duplicate key|ac_dedup_active/i.test(e.message)) {
      return { skipped: 'dedup_race' };
    }
    throw e;
  }
  return { cardId, folded, level };
}

/**
 * 当日卡列表（「今日一件事」数据源）：
 *   todos：待办级全量（不限量置顶，按优先级排）；
 *   alerts.shown：预警级未折叠 ≤3 张，🔴 按 KIND_PRIORITY 展示；alerts.folded：折叠区（可展开查看）。
 * 🔴 角色裁剪：sales/recruiter 只见 assignedTo 本人的 todo 卡——alert 卡是老板/管理层的
 *   （§8 权限矩阵：action_card 确认仅管理层；员工红色预警不进销售端，A-09 同魂）。
 */
export async function todayCards(db, ctx, { role = 'boss', userId = null } = {}) {
  const { rows } = await db.query(
    `select card_id, kind, state, target_id, assigned_to, payload from action_cards
      where tenant_id = $1 and payload->>'day' = $2 order by card_id`, [ctx.tenantId, ctx.today]);
  const cards = rows.map(r => ({
    cardId: Number(r.card_id), kind: r.kind, state: r.state,
    targetId: r.target_id, assignedTo: r.assigned_to, payload: parseJson(r.payload),
  }));
  const todos = cards.filter(c => c.payload.level === 'todo').sort(byPriority);
  if (!MGMT_ROLES.has(role))
    return { todos: todos.filter(c => c.assignedTo != null && c.assignedTo === userId),
      alerts: { shown: [], folded: [] } };
  const alerts = cards.filter(c => c.payload.level === 'alert');
  return {
    todos,
    alerts: {
      shown: alerts.filter(c => !c.payload.folded).sort(byPriority),   // ≤3（插入时限流保证）
      folded: alerts.filter(c => c.payload.folded).sort(byPriority),
    },
  };
}

/**
 * 🔴 状态机流转（唯一流转入口；A-C04：本函数只改卡状态，永不写任何员工状态）：
 *   pending→assigned→doing→done→filled 顺序校验，跳态/回退一律拒（BAD_TRANSITION）；
 *   trail 留痕 + 事件双写（action_card_transitioned）。
 *   🔴 仅管理层（RLS ac_upd 已限 is_mgmt，服务层再校验一遍 members.role——双保险）。
 */
export async function transition(db, ctx, { cardId, toState }) {
  const { rows: mem } = await db.query(
    `select role from members where tenant_id = $1 and user_id = $2 and is_active`,
    [ctx.tenantId, ctx.actorId]);
  const role = mem.length ? mem[0].role : null;
  if (!MGMT_ROLES.has(role ?? ''))
    throw Object.assign(new Error(`action_card 流转仅管理层（当前角色 ${role ?? '非成员'}）`), { code: 'FORBIDDEN' });

  const ti = STATE_ORDER.indexOf(toState);
  if (ti === -1) throw new Error(`未知 actionCardState：${toState}`);
  const { rows } = await db.query(
    `select card_id, kind, state from action_cards where tenant_id = $1 and card_id = $2`,
    [ctx.tenantId, cardId]);
  if (!rows.length) throw new Error(`action_card ${cardId} 不存在`);
  const from = rows[0].state;
  if (ti !== STATE_ORDER.indexOf(from) + 1)
    throw Object.assign(new Error(`跳态拒：${from} → ${toState}（合法次态 = ${STATE_ORDER[STATE_ORDER.indexOf(from) + 1] ?? '无（终态）'}）`),
      { code: 'BAD_TRANSITION' });

  const entry = { at: ctx.today, by: ctx.actorId, from, to: toState };
  await db.transaction(async tx => {
    await tx.query(
      `update action_cards set state = $3, trail = trail || $4::jsonb, updated_at = now()
        where tenant_id = $1 and card_id = $2`,
      [ctx.tenantId, cardId, toState, JSON.stringify([entry])]);
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, 'action_card_transitioned', ctx.actorId, String(cardId),
       JSON.stringify({ cardId: Number(cardId), kind: rows[0].kind, from, to: toState })]);
  });
  return { cardId: Number(cardId), from, to: toState };
}
