/* ============================================================
   API · HTTP 服务（Step 1）——「HTTP → RLS 身份 → 已验证函数」，零业务逻辑复制
   - 身份（Step 1 dev 模式）：X-Actor-Id 头，仅 API_DEV_AUTH=1 时接受；
     Step 2 用注册/登录会话替换此处（唯一要动的点：resolveActor）。
   - 每请求整体跑在 withActor 互斥闸内：set role app_user + app.uid → RLS 生效。
   - 租户上下文一律来自 whoami()（security definer），不信任任何请求头里的 tenant。
   - 业务日期：ctx.today = X-Today（仅 dev，YYYY-MM-DD）｜默认 Asia/Shanghai 当日（公约 C-14：
     墙钟只允许在 API 边界进入，服务层内部零真实时钟）。
   - C12 业务写锁：写端点先过 assertTenantWritable（suspended/closed → 423；读/导出永不锁 A-C05）。
   ============================================================ */
import { createServer } from 'node:http';
import { ApiError, send, readJson, errorToHttp, matchRoute } from './http.mjs';
import { makeActorGate, isUuid, todayShanghai } from './db.mjs';
import { assertTenantWritable } from '../server/writes.mjs';
import { todayCards, transition, STATE_ORDER } from '../server/cardbus.mjs';
import { submitDailyReport } from '../server/m1.mjs';
import { subscription, seatUsage, ALL_BOARDS } from '../server/billing.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROLES = ['boss', 'exec', 'manager', 'recruiter', 'sales'];
const MGMT = new Set(['boss', 'exec', 'manager']);

const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;

export function buildServer(db, { devAuth = process.env.API_DEV_AUTH === '1', log = true } = {}) {
  const withActor = makeActorGate(db);

  /* ---------- 路由表 ----------
     opts.public: 无需身份；opts.member: 需已是某租户成员（ctx 注入）；
     opts.write: 业务写（先过 C12 写锁）；opts.mgmt: 仅管理层。 */
  const routes = [
    { method: 'GET', re: /^\/healthz$/, opts: { public: true },
      handler: async () => {
        const [{ ok }] = await q(db, `select 1 as ok`);
        return { status: 200, body: { ok: ok === 1, service: 'suite-cloud-api', step: 1 } };
      } },

    { method: 'GET', re: /^\/v1\/me$/, opts: {},
      handler: async ({ db }) => {
        const rows = await q(db, `select * from whoami()`);
        return { status: 200, body: { memberships: rows } };
      } },

    { method: 'POST', re: /^\/v1\/tenants$/, opts: {},
      handler: async ({ db, body }) => {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 80) throw new ApiError(400, 'BAD_NAME', 'name 必填（≤80 字）');
        const [{ create_tenant: tenantId }] = await q(db,
          `select create_tenant($1, $2)`, [name, body.email ?? null]);
        return { status: 201, body: { tenantId } };
      } },

    { method: 'POST', re: /^\/v1\/invites$/, opts: { member: true },
      handler: async ({ db, body }) => {
        const role = body.role ?? 'sales';
        if (!ROLES.includes(role)) throw new ApiError(400, 'BAD_ROLE', `role ∈ ${ROLES.join('|')}`);
        const [{ make_invite: code }] = await q(db, `select make_invite($1)`, [role]);
        return { status: 201, body: { code, role } };
      } },

    { method: 'POST', re: /^\/v1\/join$/, opts: {},
      handler: async ({ db, body }) => {
        if (typeof body.code !== 'string' || body.code.length < 4 || body.code.length > 32)
          throw new ApiError(400, 'BAD_CODE', 'code 必填（4–32 字符）');
        const [{ join_tenant: tenantId }] = await q(db,
          `select join_tenant($1, $2)`, [body.code, body.email ?? null]);
        return { status: 200, body: { tenantId } };
      } },

    { method: 'GET', re: /^\/v1\/state$/, opts: { member: true },
      handler: async ({ db }) => {
        const rows = await q(db, `select * from pull_state()`);
        if (!rows.length) throw new ApiError(404, 'NO_STATE', 'suite_state 不存在');
        const { doc, version, updated_at } = rows[0];
        return { status: 200, body: { doc, version: Number(version), updatedAt: updated_at } };
      } },

    { method: 'PUT', re: /^\/v1\/state$/, opts: { member: true, write: true, bodyLimit: 5 * 1024 * 1024 },
      handler: async ({ db, body }) => {
        if (body.doc === null || typeof body.doc !== 'object' || Array.isArray(body.doc))
          throw new ApiError(400, 'BAD_DOC', 'doc 必须是 JSON 对象');
        const v = body.version;
        if (!Number.isInteger(v) || v < 1) throw new ApiError(400, 'BAD_VERSION', 'version 必须是 ≥1 的整数');
        const [{ push_state: newVersion }] = await q(db,
          `select push_state($1::jsonb, $2)`, [JSON.stringify(body.doc), v]);
        return { status: 200, body: { version: Number(newVersion) } };
      } },

    { method: 'GET', re: /^\/v1\/subscription$/, opts: { member: true },
      handler: async ({ db, ctx }) => {
        const sub = await subscription(db, ctx);
        const seats = await seatUsage(db, ctx);
        return { status: 200, body: { subscription: sub, seats, allBoards: ALL_BOARDS } };
      } },

    { method: 'POST', re: /^\/v1\/reports\/daily$/, opts: { member: true, write: true },
      handler: async ({ db, ctx, body }) => {
        if (typeof body.employeeId !== 'string' || !body.employeeId || body.employeeId.length > 64)
          throw new ApiError(400, 'BAD_EMPLOYEE', 'employeeId 必填（≤64 字符）');
        const date = body.date ?? ctx.today;
        if (!DATE_RE.test(date)) throw new ApiError(400, 'BAD_DATE', 'date 须为 YYYY-MM-DD');
        const counts = (body.counts && typeof body.counts === 'object') ? body.counts : {};
        const r = await submitDailyReport(db, ctx, { employeeId: body.employeeId, date, counts });
        return { status: 200, body: r };
      } },

    { method: 'GET', re: /^\/v1\/cards\/today$/, opts: { member: true },
      handler: async ({ db, ctx, me }) => {
        const r = await todayCards(db, ctx, { role: me.role, userId: ctx.actorId });
        return { status: 200, body: r };
      } },

    { method: 'POST', re: /^\/v1\/cards\/(?<id>\d{1,18})\/transition$/, opts: { member: true, write: true },
      handler: async ({ db, ctx, body, params }) => {
        if (!STATE_ORDER.includes(body.toState))
          throw new ApiError(400, 'BAD_STATE', `toState ∈ ${STATE_ORDER.join('|')}`);
        const r = await transition(db, ctx, { cardId: Number(params.id), toState: body.toState });
        return { status: 200, body: r };
      } },

    { method: 'GET', re: /^\/v1\/events$/, opts: { member: true, mgmt: true },
      handler: async ({ db, ctx, query }) => {
        let limit = Number(query.get('limit') ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) limit = 50;
        const rows = await q(db,
          `select event_id, type, actor_id, target_id, payload, occurred_at from event_stream
            where tenant_id = $1 order by event_id desc limit $2`, [ctx.tenantId, limit]);
        return { status: 200, body: { events: rows } };
      } },
  ];

  /* ---------- 身份解析（Step 2 唯一替换点） ---------- */
  function resolveActor(req) {
    if (!devAuth) throw new ApiError(501, 'AUTH_NOT_READY', '会话认证于 Step 2 接入；当前仅 API_DEV_AUTH=1 的开发模式可用');
    const uid = req.headers['x-actor-id'];
    if (!uid) throw new ApiError(401, 'NO_ACTOR', '缺少身份（dev 模式需 X-Actor-Id 头）');
    if (!isUuid(uid)) throw new ApiError(400, 'BAD_ACTOR', 'X-Actor-Id 必须是 UUID');
    return uid;
  }
  function resolveToday(req) {
    const h = req.headers['x-today'];
    if (h != null && devAuth) {
      if (!DATE_RE.test(h)) throw new ApiError(400, 'BAD_TODAY', 'X-Today 须为 YYYY-MM-DD');
      return h;
    }
    return todayShanghai();
  }

  const server = createServer(async (req, res) => {
    const t0 = process.hrtime.bigint();
    const url = new URL(req.url, 'http://local');
    let status = 500;
    try {
      const hit = matchRoute(routes, req.method, url.pathname);
      if (!hit) throw new ApiError(404, 'NO_ROUTE', `无此接口：${req.method} ${url.pathname}`);
      const { route, params } = hit;

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await readJson(req, { limit: route.opts.bodyLimit ?? 64 * 1024 }) : {};

      let out;
      if (route.opts.public) {
        out = await route.handler({ db, body, params, query: url.searchParams });
      } else {
        const uid = resolveActor(req);
        const today = resolveToday(req);
        out = await withActor(uid, async db => {
          let ctx = null, me = null;
          if (route.opts.member) {
            const rows = await q(db, `select * from whoami()`);
            if (!rows.length) throw new ApiError(403, 'NOT_MEMBER', '当前账号不属于任何租户');
            me = rows[0];
            ctx = { tenantId: me.tenant_id, actorId: uid, today };
            if (route.opts.mgmt && !MGMT.has(me.role))
              throw new ApiError(403, 'MGMT_ONLY', '仅管理层（boss/exec/manager）');
            if (route.opts.write) await assertTenantWritable(db, ctx);   // C12：suspended → 423
          }
          return route.handler({ db, ctx, me, body, params, query: url.searchParams });
        });
      }
      status = out.status;
      send(res, out.status, out.body);
    } catch (e) {
      const mapped = errorToHttp(e);
      status = mapped.status;
      if (mapped.status === 500) console.error('[api:500]', req.method, url.pathname, e);
      /* 413：请求体没读完，响应后必须关连接（继续复用会让残余字节污染下一请求的解析） */
      send(res, mapped.status, { error: { code: mapped.code, message: mapped.message } },
        mapped.status === 413 ? { connection: 'close' } : {});
    } finally {
      if (log) {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        console.log(`[api] ${req.method} ${url.pathname} → ${status} ${ms.toFixed(1)}ms`);
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 31_000;
  return server;
}
