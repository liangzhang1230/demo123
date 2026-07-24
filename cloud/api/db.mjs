/* ============================================================
   API · 数据库适配层（Step 1）
   - openDb(): PGlite（内嵌真 Postgres）+ 一次性 schema 引导（幂等：以 tenants 表存在为标记）
   - withActor(uid, fn): 每请求的 RLS 身份闸——set role app_user + app.uid，
     互斥串行（PGlite 单连接，请求间不得交错身份），finally 必复位。
   - 🔴 生产 Postgres（DATABASE_URL）适配器属 Step 7 部署阶段：需在真实 PG 上验证后才接入，
     本步显式拒绝，禁止携带未经验证的死代码（硬性要求：每步做扎实）。
   - 时钟注入（公约 C-14）：本模块零业务日期决策；todayShanghai() 只服务 API 边界默认值。
   ============================================================ */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));   // cloud/

const SCHEMA_FILES = ['schema.sql', 'schema-c2.sql', 'schema-c3.sql', 'schema-c4.sql', 'schema-c6.sql'];

/* auth 兼容层 + 角色：与 tests/c*.test.mjs 引导完全同源（一字不差的语义） */
const AUTH_SHIM = `
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role app_user login;       exception when duplicate_object then null; end $$;
  grant usage on schema public to app_user;
  grant authenticated to app_user;
`;
const GRANTS = `
  grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;
  revoke update, delete on comp_plan_versions from app_user;
`;

export async function openDb({ dataDir } = {}) {
  if (process.env.DATABASE_URL) {
    throw new Error('生产 Postgres 适配器在 Step 7 部署阶段接入并在真实 PG 上验证（本步仅 PGlite 路径，拒绝未验证代码）');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = dataDir
    ? new PGlite(dataDir, { extensions: { pgcrypto } })
    : new PGlite({ extensions: { pgcrypto } });

  /* 幂等引导：tenants 表已存在 = 已引导（dataDir 持久化后二次启动跳过） */
  const { rows } = await db.query(`select to_regclass('public.tenants') as t`);
  if (!rows[0].t) {
    await db.exec(AUTH_SHIM);
    for (const f of SCHEMA_FILES) await db.exec(readFileSync(join(root, 'db', f), 'utf8'));
    await db.exec(GRANTS);
  }
  return db;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID_RE.test(v);

/* 互斥锁：PGlite 单连接，身份(set role/app.uid)是连接级状态——
   整个请求的 DB 工作必须原子占用连接，否则并发请求会串身份（越权事故级）。 */
function makeMutex() {
  let tail = Promise.resolve();
  return fn => {
    const run = tail.then(fn, fn);                      // 前序失败不阻塞后续
    tail = run.then(() => {}, () => {});
    return run;
  };
}

export function makeActorGate(db) {
  const lock = makeMutex();
  return function withActor(uid, fn) {
    if (!isUuid(uid)) return Promise.reject(Object.assign(new Error('invalid actor uuid'), { code: 'BAD_ACTOR' }));
    return lock(async () => {
      await db.exec(`set role app_user`);
      await db.query(`select set_config('app.uid', $1, false)`, [uid]);
      try { return await fn(db); }
      finally {
        await db.exec(`reset role`);
        await db.query(`select set_config('app.uid', '', false)`);
      }
    });
  };
}

/* API 边界的默认业务日（Asia/Shanghai）。仅当请求未显式注入 X-Today（dev）时使用。 */
export function todayShanghai() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
