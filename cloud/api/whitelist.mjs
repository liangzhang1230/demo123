/* ============================================================
   白名单自动入位（v5.1 §10.2）——注册/登录后在系统通道调用
   - normalizeContact：邮箱→小写；手机号→纯数字（大陆 1[3-9] 开头 11 位）
   - tryAutoJoin：命中未使用白名单 → 事务内（行锁+席位配额 FOR UPDATE 硬校验，
     与 schema join_tenant 同款防超卖）建 members+seats、标记使用、事件留痕。
     席位满 → 静默不入位（返回 skipped，注册本身不失败——老板扩容后登录即入位）。
   - 🔴 一账号一租户（与 create/join_tenant 同规）：已入租户则不再触发。
   ============================================================ */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

export function normalizeContact(raw) {
  const s = String(raw ?? '').trim();
  if (s.includes('@')) {
    const em = s.toLowerCase();
    return EMAIL_RE.test(em) ? { kind: 'email', contact: em } : null;
  }
  const digits = s.replace(/[\s-]/g, '');
  return PHONE_RE.test(digits) ? { kind: 'phone', contact: digits } : null;
}

/** 注册/登录后调用（系统通道）。返回 {tenantId, role} | {skipped} | null（无命中）。 */
export async function tryAutoJoin(db, { userId, contact }) {
  const norm = normalizeContact(contact);
  if (!norm) return null;
  let result = null;
  await db.transaction(async tx => {
    const { rows: hits } = await tx.query(
      `select tenant_id, role, sp_id, contact from member_whitelist
        where contact = $1 and used_by is null
        order by created_at asc limit 1 for update`, [norm.contact]);
    if (!hits.length) return;
    const hit = hits[0];
    const { rows: already } = await tx.query(
      `select 1 from members where user_id = $1`, [userId]);
    if (already.length) return;                          // 一账号一租户
    const { rows: [{ seat_quota }] } = await tx.query(
      `select seat_quota from subscriptions where tenant_id = $1 for update`, [hit.tenant_id]);
    const { rows: [{ n }] } = await tx.query(
      `select count(*)::int as n from seats where tenant_id = $1 and released_at is null`, [hit.tenant_id]);
    if (n >= seat_quota) { result = { skipped: 'seat_full', tenantId: hit.tenant_id }; return; }
    await tx.query(
      `insert into members(user_id, tenant_id, role, email, sp_id) values ($1,$2,$3,$4,$5)`,
      [userId, hit.tenant_id, hit.role, norm.kind === 'email' ? norm.contact : null, hit.sp_id]);
    await tx.query(`insert into seats(tenant_id, user_id) values ($1,$2)`, [hit.tenant_id, userId]);
    await tx.query(
      `update member_whitelist set used_by = $2, used_at = now() where tenant_id = $1 and contact = $3`,
      [hit.tenant_id, userId, hit.contact]);
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [hit.tenant_id, 'member_joined_via_whitelist', userId, userId,
       JSON.stringify({ contact: hit.contact, role: hit.role })]);
    result = { tenantId: hit.tenant_id, role: hit.role };
  });
  return result;
}
