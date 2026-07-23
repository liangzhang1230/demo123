/* ============================================================
   C8 · M30 异议/建议双通道服务（v5.1 §5.2 M30 行 🟢补建）
   🔒 口径出处：4号留人器 §3.3 M30 + 件二 ObjectionEntry/SuggestionEntry（唯一权威）：
     通道A「我有异议」：负面标记旁固定按钮；🔴 异议不可匿名（employee_id 必填）；
       老板必处理 [采纳/维持/重核]；🔴 pending>7天 → 关联负面标记自动失效
       （mark_active=false，默认保护员工——L-D6，惰性 sweep）；
       🔴 提出异议永不进考核路径（本模块只写 objection_entries，零考核表引用）。
     通道B「我有个建议」：钱途页底部入口；[采纳/忽略/稍后]；采纳率进 EI；
       product 类汇总给老板但系统不给建议。
     🔴 匿名真匿名（v5.1 M30 行）：anonymous=true → employee_id 与 created_by 均置
       null，事件不落个人 actorId——event_stream.actor_id 非空约束下落 ANON_ACTOR
       哨兵（全零段 UUID，非任何成员），事件 payload 零 actor 标识（机检 c8 ⑥）。
       匿名仍计 EI 分母（m29 按行数计，与身份无关）。
   - 时钟注入（公约 C-14）：objection_entries.created_at 落业务日 ctx.today——
     7 天保护窗与 EI 季窗均为业务日窗口，真实时钟会使其不可测（C-14 优先于
     "时间戳走 DB now()"的一般约定，此为本表特例，写在此处备查）
   - 写入一律经 writes 双写
   ============================================================ */
import { sweepObjections as domainSweep } from '../domain/liuren.mjs';
import { put, patch } from './writes.mjs';

/** 匿名哨兵 actor（非任何成员；事件流 actor_id 非空约束下的真匿名落点） */
export const ANON_ACTOR = '00000000-0000-4000-8000-000000000000';

const nextId = async (db, ctx, table, prefix) => {
  const { rows } = await db.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [ctx.tenantId]);
  return `${prefix}_${rows[0].n + 1}`;
};

/** 通道A：提出异议（🔴 不可匿名；落库 + 事件；EI 分母实时变——m29 读侧按行数实算） */
export async function raiseObjection(db, ctx, { id = null, employeeId, targetType, targetId = null, reason = null, note = null }) {
  if (!employeeId) throw new Error('异议不可匿名：employeeId 必填（件二 ObjectionEntry 铁律）');
  const objId = id ?? await nextId(db, ctx, 'objection_entries', 'ob');
  await put(db, ctx, 'objection_entries',
    { id: objId, employee_id: employeeId, target_type: targetType, target_id: targetId,
      reason, note, status: 'pending', mark_active: true, created_at: ctx.today },
    'objection_raised');
  return { ok: true, objId };
}

/** 老板必处理：[采纳 accepted / 维持 upheld / 重核 recheck]（LE-02） */
export async function resolveObjection(db, ctx, { objId, decision }) {
  if (!['accepted', 'upheld', 'recheck'].includes(decision))
    return { ok: false, err: 'decision ∈ {accepted,upheld,recheck}' };
  await patch(db, ctx, 'objection_entries', 'id', objId,
    { status: decision, resolved_at: ctx.today }, 'objection_resolved');
  return { ok: true, objId, decision };
}

/**
 * 通道B：提出建议。anonymous=true → 🔴 employee_id 不落、created_by 显式 null、
 * 事件 actor = ANON_ACTOR 哨兵（payload 无 employeeId 键、createdBy 为 null）。
 * 匿名仍计 EI 分母（行数即分母）。
 */
export async function raiseSuggestion(db, ctx, { id = null, employeeId = null, category, content, anonymous = false }) {
  const sugId = id ?? await nextId(db, ctx, 'suggestion_entries', 'sg');
  if (anonymous) {
    await put(db, { ...ctx, actorId: ANON_ACTOR }, 'suggestion_entries',
      { id: sugId, category, content, status: 'pending', created_by: null },
      'suggestion_raised');
  } else {
    await put(db, ctx, 'suggestion_entries',
      { id: sugId, employee_id: employeeId, category, content, status: 'pending' },
      'suggestion_raised');
  }
  return { ok: true, sugId, anonymous };
}

/** [采纳 adopted / 忽略 ignored / 稍后 later]；采纳率进 EI（m29 读侧实算） */
export async function resolveSuggestion(db, ctx, { sugId, decision }) {
  if (!['adopted', 'ignored', 'later'].includes(decision))
    return { ok: false, err: 'decision ∈ {adopted,ignored,later}' };
  await patch(db, ctx, 'suggestion_entries', 'id', sugId,
    { status: decision, resolved_at: ctx.today }, 'suggestion_resolved');
  return { ok: true, sugId, decision };
}

/**
 * 🔴 L-D6 惰性 sweep：pending > 7 天 → mark_active=false（关联负面标记自动失效，
 * 默认保护员工）；异议本身仍 pending（老板必处理不豁免）。判定 🔒 domain.sweepObjections。
 */
export async function sweepObjections(db, ctx) {
  const { rows } = await db.query(
    `select id, status, mark_active, created_at::date::text as created from objection_entries
      where tenant_id = $1 and deleted_at is null and status = 'pending' and mark_active`, [ctx.tenantId]);
  const verdict = domainSweep(
    rows.map(r => ({ objId: r.id, status: r.status, markActive: r.mark_active, createdAt: r.created })),
    ctx.today);
  for (const objId of verdict.flippedIds)
    await patch(db, ctx, 'objection_entries', 'id', objId,
      { mark_active: false }, 'objection_mark_expired');
  return verdict;
}

/** 双通道列表（老板端；🔴 主管不可见——角色裁剪在表现层/RLS，读侧此处只给 boss bundle 用） */
export async function channelBoard(db, ctx) {
  const { rows: objections } = await db.query(
    `select id, employee_id, target_type, target_id, reason, status, mark_active,
            created_at::date::text as created_at, resolved_at::date::text as resolved_at
       from objection_entries where tenant_id = $1 and deleted_at is null order by created_at, id`, [ctx.tenantId]);
  const { rows: suggestions } = await db.query(
    `select id, employee_id, category, content, status,
            created_at::date::text as created_at, resolved_at::date::text as resolved_at
       from suggestion_entries where tenant_id = $1 and deleted_at is null order by created_at, id`, [ctx.tenantId]);
  return { objections, suggestions };
}
