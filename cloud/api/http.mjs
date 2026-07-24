/* ============================================================
   API · HTTP 工具（Step 1）：零依赖 node:http 之上的最小可靠层
   - readJson：限长读体（超限 413、坏 JSON 400），Content-Type 宽松（缺省按 JSON 试解）
   - send：统一 JSON 响应（无 x-powered-by，禁缓存）
   - ApiError / errorToHttp：服务层异常 → HTTP 状态码的唯一映射表
   ============================================================ */

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function send(res, status, body, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body ?? null));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(buf);
}

export function readJson(req, { limit = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let done = false;
    /* 🔴 超限不可 destroy socket——那会掐断 413 响应（客户端只见断连）。
       正确姿势：停止累积 + resume 排空剩余字节，让响应携 Connection: close 完整送达。 */
    const fail = e => {
      if (done) return;
      done = true;
      req.removeAllListeners('data');
      req.resume();                                     // 排空，别让对端卡在写半截
      reject(e);
    };
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > limit) return fail(new ApiError(413, 'BODY_TOO_LARGE', `请求体超限（>${limit}B）`));
      chunks.push(c);
    });
    req.on('error', () => fail(new ApiError(400, 'BAD_BODY', '请求体读取失败')));
    req.on('end', () => {
      if (done) return;
      done = true;
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'BAD_JSON', 'JSON 解析失败')); }
    });
  });
}

/* 服务层/SQL 异常 → HTTP 的唯一映射（新增错误类型只改这里） */
const MSG_MAP = [
  [/not authenticated/i,            [401, 'NOT_AUTHENTICATED']],
  [/already in a tenant/i,          [409, 'ALREADY_IN_TENANT']],
  [/boss only/i,                    [403, 'BOSS_ONLY']],
  [/仅管理层/,                       [403, 'MGMT_ONLY']],
  [/seat quota exceeded/i,          [409, 'SEAT_QUOTA_EXCEEDED']],
  [/invalid or expired invite/i,    [400, 'BAD_INVITE']],
  [/version conflict/i,             [409, 'VERSION_CONFLICT']],
  [/不存在/,                         [404, 'NOT_FOUND']],
  [/violates row-level security/i,  [403, 'RLS_DENIED']],
  [/permission denied/i,            [403, 'DB_DENIED']],
];
export function errorToHttp(e) {
  if (e instanceof ApiError) return { status: e.status, code: e.code, message: e.message };
  if (e && e.code === 'TENANT_SUSPENDED') return { status: 423, code: 'TENANT_SUSPENDED', message: e.message };
  if (e && e.code === 'BAD_TRANSITION')   return { status: 409, code: 'BAD_TRANSITION', message: e.message };
  if (e && e.code === 'FORBIDDEN')        return { status: 403, code: 'FORBIDDEN', message: e.message };
  if (e && e.code === 'BAD_ACTOR')        return { status: 400, code: 'BAD_ACTOR', message: e.message };
  for (const [re, [status, code]] of MSG_MAP) {
    if (re.test(e?.message || '')) return { status, code, message: e.message };
  }
  return { status: 500, code: 'INTERNAL', message: '服务器内部错误' };   // 不泄栈
}

/* 极简路由表：{ method, re(命名组), handler, opts } */
export function matchRoute(routes, method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: m.groups || {} };
  }
  return null;
}
