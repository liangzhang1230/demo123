/* ============================================================
   API · HTTP 服务（Step 1 端点 + Step 2 认证会话）——零业务逻辑复制
   - 身份三通道（优先级从高到低）：
     ① Authorization: Bearer <token>（API 客户端）
     ② Cookie: sid=<token>（HttpOnly，浏览器）
     ③ X-Actor-Id（仅 API_DEV_AUTH=1 的开发/测试模式）
   - 双 DB 通道同一把锁（见 db.mjs）：withActor=RLS 业务身份；withSystem=系统身份
     （auth 表对 app_user 零权限，只能走系统通道——物理隔离）
   - /v1/auth/* 按 IP 限速（默认 30 次/分）；账号连错 5 次锁 15 分钟（auth.mjs）
   - 租户上下文一律 whoami() 推导；业务写统一过 C12 写锁；业务日期仅 API 边界注入（C-14）
   ============================================================ */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, send, readJson, errorToHttp, matchRoute } from './http.mjs';
import { makeActorGate, isUuid, todayShanghai } from './db.mjs';
import { register, login, logout, sessionUser } from './auth.mjs';
import { assertTenantWritable } from '../server/writes.mjs';
import { todayCards, transition, STATE_ORDER } from '../server/cardbus.mjs';
import { submitDailyReport } from '../server/m1.mjs';
import { subscription, seatUsage, setBoards, expireTenant, resumeTenant, ALL_BOARDS } from '../server/billing.mjs';
import { morningBrief } from '../server/briefing.mjs';
import { logEvent } from '../server/writes.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROLES = ['boss', 'exec', 'manager', 'recruiter', 'sales'];
const MGMT = new Set(['boss', 'exec', 'manager']);

const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;

/* ---- 静态托管：suite 单文件（GET / 即开即用的网页版；生产同源零 CORS 依赖）
   缺省 suite/dist/index.html，API_APP_FILE 可覆盖；mtime 变了自动重读（热更新构建产物） ---- */
const APP_FILE = process.env.API_APP_FILE
  || join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'suite', 'dist', 'index.html');
let appCache = null;                                     // { mtimeMs, buf }
function appHtml() {
  try {
    const { mtimeMs } = statSync(APP_FILE);
    if (!appCache || appCache.mtimeMs !== mtimeMs)
      appCache = { mtimeMs, buf: readFileSync(APP_FILE) };
    return appCache.buf;
  } catch { return null; }
}

/* ---- Cookie 工具（无依赖，够用且严谨） ---- */
function parseCookie(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function sessionCookie(token, maxAgeMs) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}
const CLEAR_COOKIE = 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';

export function buildServer(db, {
  devAuth = process.env.API_DEV_AUTH === '1',
  log = true,
  authRate = { limit: 30, windowMs: 60_000 },
} = {}) {
  const { withActor, withSystem } = makeActorGate(db);

  /* ---- /v1/auth/* 按 IP 限速（内存滑窗；生产多实例时换 Redis——Step 7 议题） ---- */
  const rateMap = new Map();
  function checkAuthRate(ip) {
    const now = Date.now();
    if (rateMap.size > 10000) for (const [k, v] of rateMap) { if (v.resetAt < now) rateMap.delete(k); }
    const e = rateMap.get(ip);
    if (!e || e.resetAt < now) { rateMap.set(ip, { count: 1, resetAt: now + authRate.windowMs }); return; }
    if (++e.count > authRate.limit) throw new ApiError(429, 'RATE_LIMITED', '请求太频繁，请稍后再试');
  }

  const routes = [
    { method: 'GET', re: /^\/healthz$/, opts: { public: true, system: true },
      handler: async ({ db }) => {
        const [{ ok }] = await q(db, `select 1 as ok`);
        return { status: 200, body: { ok: ok === 1, service: 'suite-cloud-api', step: 2 } };
      } },

    /* ══════════ 认证（系统通道；对 app_user 物理不可见） ══════════ */
    { method: 'POST', re: /^\/v1\/auth\/register$/, opts: { public: true, system: true, auth: true },
      handler: async ({ db, body, ip, ua }) => {
        if (process.env.AUTH_ALLOW_REGISTER === '0')
          throw new ApiError(403, 'REGISTER_CLOSED', '注册暂未开放（内测邀请制）');
        const r = await register(db, { email: body.email, password: body.password, ip, ua });
        return { status: 201, body: { userId: r.userId, email: r.email, token: r.token, expiresInMs: r.expiresInMs },
          headers: { 'set-cookie': sessionCookie(r.token, r.expiresInMs) } };
      } },

    { method: 'POST', re: /^\/v1\/auth\/login$/, opts: { public: true, system: true, auth: true },
      handler: async ({ db, body, ip, ua }) => {
        const r = await login(db, { email: body.email, password: body.password, ip, ua });
        return { status: 200, body: { userId: r.userId, email: r.email, token: r.token, expiresInMs: r.expiresInMs },
          headers: { 'set-cookie': sessionCookie(r.token, r.expiresInMs) } };
      } },

    { method: 'POST', re: /^\/v1\/auth\/logout$/, opts: { public: true, system: true, auth: true },
      handler: async ({ db, token }) => {
        await logout(db, token);
        return { status: 200, body: { ok: true }, headers: { 'set-cookie': CLEAR_COOKIE } };
      } },

    { method: 'GET', re: /^\/v1\/auth\/session$/, opts: { public: true, system: true },
      handler: async ({ db, token }) => {
        const s = token ? await sessionUser(db, token) : null;
        if (!s) throw new ApiError(401, 'NO_SESSION', '未登录或会话已失效');
        const [acc] = await q(db, `select email from accounts where user_id = $1`, [s.userId]);
        return { status: 200, body: { userId: s.userId, email: acc?.email ?? null, expiresAt: s.expiresAt } };
      } },

    /* ══════════ 业务（RLS 身份通道） ══════════ */
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

    /* Step 5：今日早报（休息日返回 null——Y-D8 零推送；金额永不进早报 C10 口径） */
    { method: 'GET', re: /^\/v1\/brief$/, opts: { member: true },
      handler: async ({ db, ctx }) => {
        const brief = await morningBrief(db, ctx, { userId: ctx.actorId });
        return { status: 200, body: { brief } };
      } },

    { method: 'GET', re: /^\/v1\/members$/, opts: { member: true, mgmt: true },
      handler: async ({ db, ctx }) => {
        const rows = await q(db,
          `select user_id, role, email, sp_id, is_active, joined_at from members
            where tenant_id = $1 order by joined_at`, [ctx.tenantId]);
        return { status: 200, body: { members: rows } };
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

    /* ══════════ Step 6 · 平台面（A-C02：跨租户仅计费/席位/健康度，永不碰业务数据） ══════════ */
    { method: 'GET', re: /^\/v1\/platform\/overview$/, opts: { platform: true },
      handler: async ({ db }) => {
        const rows = await q(db, `select * from platform_overview()`);
        return { status: 200, body: { tenants: rows } };
      } },

    { method: 'PATCH', re: /^\/v1\/platform\/subscriptions\/(?<tid>[0-9a-f-]{36})$/, opts: { platform: true },
      handler: async ({ db, ctx, body, params }) => {
        const tid = params.tid;
        const t = await q(db, `select 1 from tenants where id = $1`, [tid]);
        if (!t.length) throw new ApiError(404, 'NOT_FOUND', `租户不存在：${tid}`);
        const tctx = { tenantId: tid, actorId: ctx.actorId, today: ctx.today };
        const changed = {};

        if (body.seat_quota !== undefined) {
          if (!Number.isInteger(body.seat_quota) || body.seat_quota < 1 || body.seat_quota > 10000)
            throw new ApiError(400, 'BAD_QUOTA', 'seat_quota 须为 1–10000 的整数');
          changed.seat_quota = body.seat_quota;
        }
        if (body.plan !== undefined) {
          if (typeof body.plan !== 'string' || !body.plan || body.plan.length > 40)
            throw new ApiError(400, 'BAD_PLAN', 'plan 须为 ≤40 字符串');
          changed.plan = body.plan;
        }
        if (body.end_date !== undefined) {
          if (body.end_date !== null && !DATE_RE.test(body.end_date))
            throw new ApiError(400, 'BAD_END_DATE', 'end_date 须为 YYYY-MM-DD 或 null');
          changed.end_date = body.end_date;
        }
        if (Object.keys(changed).length) {
          const sets = Object.keys(changed).map((k, i) => `${k} = $${i + 2}`).join(', ');
          await db.query(
            `insert into subscriptions(tenant_id) values ($1) on conflict (tenant_id) do nothing`, [tid]);
          await db.query(
            `update subscriptions set ${sets}, updated_at = now() where tenant_id = $1`,
            [tid, ...Object.values(changed)]);
          await logEvent(db, tctx, 'subscription_updated', null, changed);
        }
        if (body.boards_enabled !== undefined)
          await setBoards(db, tctx, { boards: body.boards_enabled });   // 校验 ⊆ 五板块 + 事件
        if (body.status !== undefined) {
          if (body.status === 'active') await resumeTenant(db, tctx);
          else if (body.status === 'overdue' || body.status === 'suspended')
            await expireTenant(db, tctx, { status: body.status });
          else throw new ApiError(400, 'BAD_STATUS', 'status ∈ active|overdue|suspended');
        }
        const sub = await subscription(db, tctx);
        return { status: 200, body: { subscription: sub } };
      } },
  ];

  /* ---- 请求携带的会话令牌（Bearer 优先，其次 Cookie sid） ---- */
  function extractToken(req) {
    const m = /^Bearer\s+(.{16,200})$/.exec(req.headers.authorization ?? '');
    if (m) return m[1];
    const sid = parseCookie(req.headers.cookie).sid;
    return sid || null;
  }
  /* ---- 身份解析：会话 → dev 头（仅 devAuth） ---- */
  async function resolveActor(req, token) {
    if (token) {
      const s = await withSystem(db => sessionUser(db, token));
      if (!s) throw new ApiError(401, 'BAD_SESSION', '会话无效或已过期，请重新登录');
      return s.userId;
    }
    if (devAuth) {
      const uid = req.headers['x-actor-id'];
      if (uid) {
        if (!isUuid(uid)) throw new ApiError(400, 'BAD_ACTOR', 'X-Actor-Id 必须是 UUID');
        return uid;
      }
    }
    throw new ApiError(401, 'NO_SESSION', '未登录（Bearer 令牌或 sid Cookie）');
  }
  function resolveToday(req) {
    const h = req.headers['x-today'];
    if (h != null && devAuth) {
      if (!DATE_RE.test(h)) throw new ApiError(400, 'BAD_TODAY', 'X-Today 须为 YYYY-MM-DD');
      return h;
    }
    return todayShanghai();
  }
  function clientIp(req) {
    if (process.env.TRUST_PROXY === '1') {
      const xf = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress ?? '?';
  }

  /* ---- CORS：suite 单文件从 file:// 或任意站点直连 API（Bearer 令牌，不靠 Cookie，
     故 '*' 对认证安全无损；要收紧设 API_CORS_ORIGIN） ---- */
  const CORS = {
    'access-control-allow-origin': process.env.API_CORS_ORIGIN || '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-actor-id, x-today',
    'access-control-max-age': '600',
  };

  const server = createServer(async (req, res) => {
    const t0 = process.hrtime.bigint();
    const url = new URL(req.url, 'http://local');
    let status = 500;
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      /* 网页版入口：GET / 直接吐 suite 单文件（同源部署 = 客户浏览器打开即用） */
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app')) {
        const buf = appHtml();
        if (!buf) throw new ApiError(404, 'NO_APP', '应用文件未构建——先在 suite/ 运行 node build.mjs');
        status = 200;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
          'content-length': buf.length, 'cache-control': 'no-cache' });
        res.end(buf);
        return;
      }
      const hit = matchRoute(routes, req.method, url.pathname);
      if (!hit) throw new ApiError(404, 'NO_ROUTE', `无此接口：${req.method} ${url.pathname}`);
      const { route, params } = hit;

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? await readJson(req, { limit: route.opts.bodyLimit ?? 64 * 1024 }) : {};
      const token = extractToken(req);
      const ip = clientIp(req);

      let out;
      if (route.opts.public) {
        if (route.opts.auth) checkAuthRate(ip);
        out = route.opts.system
          ? await withSystem(db => route.handler({ db, body, params, query: url.searchParams, token, ip, ua: req.headers['user-agent'] }))
          : await route.handler({ db, body, params, query: url.searchParams, token, ip });
      } else if (route.opts.platform) {
        /* 平台面：系统通道执行（跨租户），入口先验 platform_admins——
           平台管理员不是任何租户成员，业务端点对其天然 403（A-C02 双向隔离） */
        const uid = await resolveActor(req, token);
        const today = resolveToday(req);
        out = await withSystem(async db => {
          const r = await q(db, `select 1 from platform_admins where user_id = $1`, [uid]);
          if (!r.length) throw new ApiError(403, 'NOT_PLATFORM', '仅平台管理员');
          /* 注入 app.uid（不切角色）：platform_overview() 等 security definer 函数
             自带 where is_platform() 守卫，需 auth.uid() 可见调用者——schema 守卫是
             唯一权威口径，API 前置检查只是双保险 */
          await db.query(`select set_config('app.uid', $1, false)`, [uid]);
          try {
            return await route.handler({ db, ctx: { actorId: uid, today }, body, params, query: url.searchParams });
          } finally {
            await db.query(`select set_config('app.uid', '', false)`);
          }
        });
      } else {
        const uid = await resolveActor(req, token);
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
      send(res, out.status, out.body, out.headers ?? {});
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
