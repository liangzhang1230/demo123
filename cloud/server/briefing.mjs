/* ============================================================
   C10 · 早报与播报 briefing（v5.1 §10.9 / §12 C10 行；L3 推送层——云端原创）
   🔒 口径出处：
     - v5.1 §10.9 销售早报：内容源换血已在 v4.0 完成（内容源 = 五板块）；
       🔴 点名对象 = 日报未填报（育人器 M1 填报率——m1.missingToday 唯一口径，禁止另写）；
       🔴 休息日零推送（排班判定 = m1.isWorkday，Y-D8 休息日口径全系统唯一一份）
     - v5.1 §4 pushChannel：inapp / serviceAccount；§3.2 PushLog = 防重复、防轰炸
       （dedup_key：早报 brief_{userId}_{today}，同日重发跳过）
     - 🔴 A-13 语义（公约 §6.1）：播报（悬赏达成/灯塔纪录）永不含金额与配额——
       broadcast 写入前 stripMoney 递归剥离（机检约定：落库 payload
       grep 无 amount/amt/quota 字段）
   五板块内容源（有数则出，无数则省略）：
     ① 昨日成交/回款计数（deals——🔴 仅计数不含金额：早报全员可达，A-08 稳妥侧）
     ② 日报未填名单（m1.missingToday——点名，仅姓名，排行榜 name 级可见性先例）
     ③ 今日插卡摘要（cardBus.todayCards 前 3，按角色裁剪——sales 只见本人 todo）
     ④ 四灯任一红提示（m8.tempLights——boss/exec）
     ⑤ 守护线候选数（m16.guardLine——boss/exec，仅计数）
   - 时钟注入（公约 C-14）：本模块零真实时钟调用；今天 = ctx.today
   ============================================================ */
import { addDays } from '../domain/shared.mjs';
import { loadShift, isWorkday, missingToday } from './m1.mjs';
import { todayCards } from './cardbus.mjs';
import { tempLights } from './m8.mjs';
import { guardLine } from './m16.mjs';

const FOUR_KEYS = ['offerAccept', 'noshow', 'cycleWorse', 'poachShare'];
const EXEC_ROLES = new Set(['boss', 'exec']);
const MGMT_ROLES = new Set(['boss', 'exec', 'manager']);

/* 🔴 A-13 机检约定：键名含 amount / 以 amt 结尾（含 xxxAmt）/ quota / 金额 / 配额 → 剥离（递归） */
export const MONEY_KEY_RE = /amount|amt|quota|金额|配额/i;
export function stripMoney(v) {
  if (Array.isArray(v)) return v.map(stripMoney);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (MONEY_KEY_RE.test(k)) continue;
      out[k] = stripMoney(val);
    }
    return out;
  }
  return v;
}

/**
 * 早报组装（纯读，不落 push_log——发送走 sendBrief）。
 * 🔴 收件人当日休息（m1.isWorkday：本人排班 > '*' 兜底 > 默认周日休）→ 返回 null（零推送）。
 * 收件人身份从 members 读（role + sp_id）；无成员档 → 按最小权限 sales 处理。
 * 返回 { userId, role, date, sections }；sections 各段有数则出、无数则省略（键不存在）。
 */
export async function morningBrief(db, ctx, { userId }) {
  const { rows: mem } = await db.query(
    `select role, sp_id from members where tenant_id = $1 and user_id = $2 and is_active`,
    [ctx.tenantId, userId]);
  const role = mem.length ? mem[0].role : 'sales';
  const spId = mem.length ? mem[0].sp_id : null;

  const shift = await loadShift(db, ctx.tenantId);
  if (!isWorkday(shift, spId, ctx.today)) return null;   // 🔴 休息日零推送（Y-D8）

  const sections = {};

  /* ① 昨日成交/回款计数（仅计数，无金额） */
  if (MGMT_ROLES.has(role)) {
    const y = addDays(ctx.today, -1);
    const { rows } = await db.query(
      `select (count(*) filter (where deal_date = $2))::int as deals,
              (count(*) filter (where paid_date = $2))::int as paid
         from deals where tenant_id = $1 and status = 'won' and deleted_at is null`,
      [ctx.tenantId, y]);
    if (rows[0].deals > 0 || rows[0].paid > 0)
      sections.yesterday = { date: y, dealCount: rows[0].deals, paidCount: rows[0].paid };
  }

  /* ② 日报未填名单（🔴 点名对象唯一口径 = m1.missingToday；全员休息日自然为空） */
  const missing = await missingToday(db, ctx);
  if (missing.length) sections.missing = missing;

  /* ③ 今日插卡摘要（前 3；角色裁剪在 todayCards 内） */
  const cards = await todayCards(db, ctx, { role, userId });
  const top = [...cards.alerts.shown, ...cards.todos].slice(0, 3)
    .map(c => ({ cardId: c.cardId, kind: c.kind, targetId: c.targetId }));
  if (top.length)
    sections.cards = { top, foldedCount: cards.alerts.folded.length, todoCount: cards.todos.length };

  if (EXEC_ROLES.has(role)) {
    /* ④ 四灯任一红 → 提示引定价器复核（M8 云端增量；只提示不重述灯值） */
    const tl = await tempLights(db, ctx, {});
    const reds = FOUR_KEYS.filter(k => tl[k].light === 'red');
    if (reds.length) sections.fourLights = { reds, hint: '薪酬水温有灯转红——去定价器复核矩阵（§7）' };

    /* ⑤ 守护线候选数（m16.guardLine；仅计数——金额不进早报） */
    const g = await guardLine(db, ctx);
    if (g.count != null && g.count > 0)
      sections.guard = { count: g.count, gRedefineHint: g.gRedefineHint === true };
  }

  return { userId, role, date: ctx.today, sections };
}

/**
 * 发送早报：morningBrief 为 null（休息日）→ 零推送且🔴不落 push_log；
 * 同日已发（dedup_key = brief_{userId}_{today}）→ 跳过（行数不变）；
 * 否则 push_log + 事件（morning_brief_sent）同一事务双写。
 */
export async function sendBrief(db, ctx, { userId, channel = 'inapp' }) {
  const brief = await morningBrief(db, ctx, { userId });
  if (brief == null) return { sent: false, skipped: 'restday' };

  const dedupKey = `brief_${userId}_${ctx.today}`;
  const { rows } = await db.query(
    `select id from push_log where tenant_id = $1 and dedup_key = $2`, [ctx.tenantId, dedupKey]);
  if (rows.length) return { sent: false, skipped: 'duplicate', dedupKey };

  await db.transaction(async tx => {
    await tx.query(
      `insert into push_log(tenant_id, channel, kind, target_user, dedup_key) values ($1,$2,'morning_brief',$3,$4)`,
      [ctx.tenantId, channel, userId, dedupKey]);
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, 'morning_brief_sent', ctx.actorId, String(userId),
       JSON.stringify({ userId, day: ctx.today, channel, sections: Object.keys(brief.sections) })]);
  });
  return { sent: true, dedupKey, brief };
}

/**
 * 播报（悬赏达成 first_deal/hire 等三态放行后、灯塔新纪录——公约 A-12/留人器 16.5）。
 * 🔴 A-13：payload 写入前 stripMoney 剥离一切金额与配额字段（递归；机检 = 落库 grep 零命中）。
 * push_log（channel 默认 inapp，target_user null = 全员）+ 事件（broadcast_sent，携剥离后 payload）
 * 同一事务双写；可选 dedupKey 防重复播报。
 */
export async function broadcast(db, ctx, { kind, payload = {}, channel = 'inapp', dedupKey = null }) {
  const clean = stripMoney(payload);
  if (dedupKey != null) {
    const { rows } = await db.query(
      `select id from push_log where tenant_id = $1 and dedup_key = $2`, [ctx.tenantId, dedupKey]);
    if (rows.length) return { sent: false, skipped: 'duplicate', dedupKey };
  }
  await db.transaction(async tx => {
    await tx.query(
      `insert into push_log(tenant_id, channel, kind, target_user, dedup_key) values ($1,$2,$3,null,$4)`,
      [ctx.tenantId, channel, kind, dedupKey]);
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,null,$4)`,
      [ctx.tenantId, 'broadcast_sent', ctx.actorId,
       JSON.stringify({ kind, day: ctx.today, ...clean })]);
  });
  return { sent: true, kind, payload: clean };
}
