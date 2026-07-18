/* ============================================================
   C3 · 服务层唯一写入口（C2 收口建议的落地）
   - put(db, ctx, table, row, eventType)   : 事务内 表行 INSERT + event_stream append【双写】
   - patch(db, ctx, table, keyCol, keyVal, changes, eventType) : 事务内 UPDATE + 事件双写
   - ctx = { tenantId, actorId, today }：tenant_id / created_by 由 ctx 注入，业务日期一律走 ctx.today
   - 🔴 本模块零真实时钟调用（公约 C-14 时钟注入）：时间戳列走 DB now()（DEFAULT / SET now()），
     业务日期从 ctx.today 显式传入
   - 事件 payload = 行数据的小驼峰投影（与 seed.mjs / replay.mjs fold 同一约定），
     这是"任一汇总数可由事件流复算"的物理基础（A-C03 / v5.1 §1.2）
   ============================================================ */

const camel = s => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function toPayload(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[camel(k)] = v;
  return out;
}

/* jsonb/数组参数序列化（与 seed.mjs insertRow 同法） */
const param = v => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;

/**
 * 表行 INSERT + 事件 append，同一事务（要么都进，要么都不进）。
 * row：snake_case 列名 → 值；tenant_id / created_by 由 ctx 注入（row 不必带）。
 * 返回插入的完整行（含注入列）。
 */
export async function put(db, ctx, table, row, eventType) {
  const full = { tenant_id: ctx.tenantId, created_by: ctx.actorId, ...row };
  const cols = Object.keys(full);
  const sql = `insert into ${table}(${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`;
  await db.transaction(async tx => {
    await tx.query(sql, cols.map(k => param(full[k])));
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, eventType, ctx.actorId, row.id != null ? String(row.id) : null, JSON.stringify(toPayload(row))]);
  });
  return full;
}

/**
 * 表行 UPDATE + 事件 append，同一事务。
 * changes：snake_case 列 → 新值；updated_by = ctx.actorId、updated_at = DB now() 自动补。
 * WHERE 恒带 tenant_id（A-C01 隔离）。0 行命中 → 抛错（事务回滚，事件不落）。
 * 返回更新后的行。
 */
export async function patch(db, ctx, table, keyCol, keyVal, changes, eventType) {
  const cols = Object.keys(changes);
  const sets = cols.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const sql = `update ${table}
                  set ${sets}, updated_by = $${cols.length + 1}, updated_at = now()
                where tenant_id = $${cols.length + 2} and ${keyCol} = $${cols.length + 3}
                returning *`;
  let updated = null;
  await db.transaction(async tx => {
    const r = await tx.query(sql, [...cols.map(k => param(changes[k])), ctx.actorId, ctx.tenantId, keyVal]);
    if (!r.rows.length) throw new Error(`patch ${table}: no row for ${keyCol}=${keyVal} in tenant`);
    updated = r.rows[0];
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, eventType, ctx.actorId, String(keyVal),
       JSON.stringify({ [camel(keyCol)]: keyVal, changes: toPayload(changes) })]);
  });
  return updated;
}
