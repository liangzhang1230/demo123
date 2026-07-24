/* ============================================================
   Step 2 · 认证服务（零新依赖：node:crypto scrypt + sha256）
   - 密码：scrypt N=16384 r=8 p=1，64B 密钥，timingSafeEqual 比对
   - 会话：32B 随机令牌 → 库存 sha256(token)；固定 TTL（默认 30 天）
   - 防爆破：连错 AUTH_MAX_FAILS(5) 次锁 AUTH_LOCK_MS(15min)；
     登录成败一律同一句错话（不泄露"账号存在与否"）
   - 🔴 本模块一律经 withSystem 通道调用（系统身份），与 RLS 业务通道同一把锁
   ============================================================ */
import { randomBytes, scrypt as _scrypt, createHash, timingSafeEqual } from 'node:crypto';

const scrypt = (pw, salt, len, opt) => new Promise((res, rej) =>
  _scrypt(pw, salt, len, opt, (e, k) => e ? rej(e) : res(k)));

const SCRYPT = { N: 16384, r: 8, p: 1, len: 64, maxmem: 64 * 1024 * 1024 };
/* 🔴 配置调用时读取（勿模块级定型）：ESM import 提升会让"先设 env 再 import"失效 */
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const authCfg = () => ({
  maxFails: num(process.env.AUTH_MAX_FAILS, 5),
  lockMs: num(process.env.AUTH_LOCK_MS, 15 * 60 * 1000),
  sessionTtlMs: num(process.env.AUTH_SESSION_TTL_MS, 30 * 24 * 3600 * 1000),
});

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
export const normEmail = e => String(e ?? '').trim().toLowerCase();
export const validEmail = e => EMAIL_RE.test(e);
/* 密码策略：≥8 位，至少一个字母 + 一个数字（对老板客户可执行、可解释） */
export const validPassword = p =>
  typeof p === 'string' && p.length >= 8 && p.length <= 128 && /[a-zA-Z]/.test(p) && /\d/.test(p);

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, SCRYPT.len, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('base64')}:${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [algo, N, r, p, saltB64, hashB64] = String(stored).split(':');
  if (algo !== 'scrypt') return false;
  const want = Buffer.from(hashB64, 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64, 'base64'), want.length,
    { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return want.length === got.length && timingSafeEqual(want, got);
}

const sha256 = t => createHash('sha256').update(t).digest('hex');
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;

/* ---- 注册：成功即建会话（省一次登录往返） ---- */
export async function register(db, { email, password, ip = null, ua = null }) {
  const em = normEmail(email);
  if (!validEmail(em)) throw err(400, 'BAD_EMAIL', '邮箱格式不对');
  if (!validPassword(password)) throw err(400, 'WEAK_PASSWORD', '密码需 ≥8 位且含字母和数字');
  const dup = await q(db, `select 1 from accounts where email = $1`, [em]);
  if (dup.length) throw err(409, 'EMAIL_TAKEN', '该邮箱已注册');
  const hash = await hashPassword(password);
  const [{ user_id }] = await q(db,
    `insert into accounts(email, password_hash) values ($1, $2) returning user_id`, [em, hash]);
  const session = await createSession(db, user_id, { ip, ua });
  return { userId: user_id, email: em, ...session };
}

/* ---- 登录：锁定检查 → 校验 → 计数/复位（成败同话术） ---- */
const LOGIN_FAIL = () => err(401, 'BAD_CREDENTIALS', '邮箱或密码不对');

export async function login(db, { email, password, ip = null, ua = null }) {
  const em = normEmail(email);
  if (!validEmail(em) || typeof password !== 'string') throw LOGIN_FAIL();
  const rows = await q(db,
    `select user_id, password_hash, failed_attempts, locked_until,
            (locked_until is not null and locked_until > now()) as locked
       from accounts where email = $1`, [em]);
  if (!rows.length) { await hashPassword(password); throw LOGIN_FAIL(); }  // 恒时：不泄露账号是否存在
  const a = rows[0];
  if (a.locked) throw err(429, 'ACCOUNT_LOCKED', '失败次数过多，账号已临时锁定，请稍后再试');
  const pass = await verifyPassword(password, a.password_hash);
  if (!pass) {
    const { maxFails, lockMs } = authCfg();
    const fails = a.failed_attempts + 1;
    /* 🔴 显式转型：$2 同时用于赋值(int)与比较，PG 参数推断会冲突(42P08) */
    await q(db, `update accounts set failed_attempts = $2::int,
        locked_until = case when $2::int >= $3::int
                            then now() + ($4::bigint * interval '1 millisecond')
                            else locked_until end
      where user_id = $1`, [a.user_id, fails, maxFails, String(lockMs)]);
    if (fails >= maxFails) throw err(429, 'ACCOUNT_LOCKED', '失败次数过多，账号已临时锁定，请稍后再试');
    throw LOGIN_FAIL();
  }
  await q(db, `update accounts set failed_attempts = 0, locked_until = null, last_login_at = now()
    where user_id = $1`, [a.user_id]);
  await q(db, `delete from sessions where user_id = $1 and expires_at < now()`, [a.user_id]);  // 顺手清过期
  const session = await createSession(db, a.user_id, { ip, ua });
  return { userId: a.user_id, email: em, ...session };
}

async function createSession(db, userId, { ip, ua }) {
  const { sessionTtlMs } = authCfg();
  const token = randomBytes(32).toString('base64url');
  await q(db, `insert into sessions(token_hash, user_id, expires_at, ip, ua)
    values ($1, $2, now() + ($3::bigint * interval '1 millisecond'), $4, $5)`,
    [sha256(token), userId, String(sessionTtlMs), ip, ua?.slice(0, 300) ?? null]);
  return { token, expiresInMs: sessionTtlMs };
}

/* ---- 会话解析：令牌 → userId（无效/过期/撤销 → null） ---- */
export async function sessionUser(db, token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  const rows = await q(db,
    `select s.user_id, s.expires_at from sessions s
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sha256(token)]);
  return rows.length ? { userId: rows[0].user_id, expiresAt: rows[0].expires_at } : null;
}

export async function logout(db, token) {
  if (typeof token !== 'string' || !token) return { revoked: 0 };
  const r = await db.query(
    `update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`, [sha256(token)]);
  return { revoked: r.affectedRows ?? 0 };
}

function err(status, code, message) {
  const e = new Error(message); e.httpStatus = status; e.httpCode = code; return e;
}
