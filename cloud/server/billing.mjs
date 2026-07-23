/* ============================================================
   C12 · 商业化服务（v5.1 §10.4 / §11 / §12 C12 行）
   - boardEnabled / requireBoard：subscriptions.boards_enabled[] 板块级授权守卫
     （本阶段接线示范：m7.computePlan=dingjia / m12.setRecipeSource=yuren /
      m29.computeIndices=liuren；其余板块入口后续同法接线）
     🔴 无订阅行（测试直建租户 / 迁移期）= 默认全开——授权是商业化开关，不是功能锁
   - setBoards：平台方/老板改板块开关 + 事件（boards_updated）
   - expireTenant：订阅置 overdue/suspended（模拟到期）——
     🔴 到期只降级不锁数据（公约授-2/A-C05）：业务写入口拒（writes.assertTenantWritable
     前置检查，suspended → throw TENANT_SUSPENDED），导出（migrate.exportAll）永不拒
   - seatUsage：席位占用 vs 配额（席位流水不可变由 schema.sql seats 触发器保证）
   - 🔴 停机豁免名单（写锁不拦、板块开关不拦）：migrate.exportAll ——
     机检见 c11-13.test.mjs ⓪（migrate.mjs 的 exportAll 零 put/patch/requireBoard 调用）
   - 时钟注入（公约 C-14）：零真实时钟调用；时间戳列一律 DB now()
   ============================================================ */
import { logEvent } from './writes.mjs';

export const ALL_BOARDS = ['dingjia', 'zhaoren', 'suanzhang', 'liuren', 'yuren'];

/* pg text[] 字面量（PGlite 数组参数统一走字面量，防驱动差异） */
const pgArray = arr => `{${arr.join(',')}}`;
const parseBoards = v => Array.isArray(v) ? v
  : typeof v === 'string' ? v.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : [];

/** 订阅行（无 → null） */
export async function subscription(db, ctx) {
  const { rows } = await db.query(
    `select tenant_id, plan, boards_enabled, seat_quota, status,
            start_date::text as start_date, end_date::text as end_date
       from subscriptions where tenant_id = $1`, [ctx.tenantId]);
  if (!rows.length) return null;
  return { ...rows[0], boards_enabled: parseBoards(rows[0].boards_enabled) };
}

/** 板块是否开通：读 subscriptions.boards_enabled；无订阅行 = 默认全开 */
export async function boardEnabled(db, ctx, board) {
  if (!ALL_BOARDS.includes(board)) {
    const e = new Error(`未知板块：${board}`);
    e.code = 'UNKNOWN_BOARD';
    throw e;
  }
  const sub = await subscription(db, ctx);
  if (!sub) return true;
  return sub.boards_enabled.includes(board);
}

/** 板块守卫（各板块服务入口用）：未开通 → throw {code:'BOARD_DISABLED'} */
export async function requireBoard(db, ctx, board) {
  if (!(await boardEnabled(db, ctx, board))) {
    const e = new Error(`板块未开通：${board}（boardsEnabled 板块级授权，v5.1 §11）`);
    e.code = 'BOARD_DISABLED';
    e.board = board;
    throw e;
  }
}

/**
 * 改板块开关（平台方/老板）：boards ⊆ 五板块、去重；upsert subscriptions + 事件。
 * 🔴 只动 boards_enabled，不动 status/seat_quota（开关 ≠ 停机）。
 */
export async function setBoards(db, ctx, { boards }) {
  if (!Array.isArray(boards)) throw new Error('boards 必须是数组');
  const clean = [...new Set(boards)];
  const bad = clean.filter(b => !ALL_BOARDS.includes(b));
  if (bad.length) throw new Error(`未知板块：${bad.join(',')}`);
  await db.query(
    `insert into subscriptions(tenant_id, boards_enabled) values ($1, $2::text[])
     on conflict (tenant_id) do update set boards_enabled = excluded.boards_enabled, updated_at = now()`,
    [ctx.tenantId, pgArray(clean)]);
  await logEvent(db, ctx, 'boards_updated', null, { boards: clean });
  return { ok: true, boards: clean };
}

/**
 * 模拟到期/停机：subscriptions.status 置 overdue/suspended（tenants.status 同步）。
 * 后果：suspended → writes.put/patch/upsert 全拒（业务写锁）；
 * 🔴 exportAll 仍可调（A-C05 数据可带走 / 授-2 到期只降级不锁数据）。
 */
export async function expireTenant(db, ctx, { status = 'suspended' } = {}) {
  if (!['overdue', 'suspended'].includes(status)) throw new Error(`status ∈ {overdue,suspended}，得到 ${status}`);
  await db.query(
    `insert into subscriptions(tenant_id, status) values ($1, $2)
     on conflict (tenant_id) do update set status = excluded.status, updated_at = now()`,
    [ctx.tenantId, status]);
  await db.query(`update tenants set status = $2 where id = $1`, [ctx.tenantId, status]);
  await logEvent(db, ctx, 'tenant_expired', null, { status });
  return { ok: true, status };
}

/** 恢复订阅（续费）：status 回 active（数据一字未动——授-4 降级不删不改数据） */
export async function resumeTenant(db, ctx) {
  await db.query(
    `insert into subscriptions(tenant_id, status) values ($1, 'active')
     on conflict (tenant_id) do update set status = 'active', updated_at = now()`, [ctx.tenantId]);
  await db.query(`update tenants set status = 'active' where id = $1`, [ctx.tenantId]);
  await logEvent(db, ctx, 'tenant_resumed', null, {});
  return { ok: true, status: 'active' };
}

/** 席位占用 vs 配额（席位流水不可变：schema.sql trg_seats_immutable） */
export async function seatUsage(db, ctx) {
  const { rows: s } = await db.query(
    `select count(*) filter (where released_at is null)::int as used, count(*)::int as total
       from seats where tenant_id = $1`, [ctx.tenantId]);
  const sub = await subscription(db, ctx);
  const quota = sub ? Number(sub.seat_quota) : null;
  return {
    used: Number(s[0].used), totalRows: Number(s[0].total), quota,
    remaining: quota == null ? null : quota - Number(s[0].used),
  };
}
