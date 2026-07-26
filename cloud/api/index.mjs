#!/usr/bin/env node
/* API 启动入口：PGLITE_DIR 持久化目录（缺省 cloud/data/pglite），PORT 缺省 8787。
   API_DEV_AUTH=1 → 接受 X-Actor-Id 开发身份（Step 2 上会话认证后关闭）。 */
import { openDb } from './db.mjs';
import { buildServer } from './server.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.PGLITE_DIR || join(here, '..', 'data', 'pglite');
const port = Number(process.env.PORT || 8787);

const db = await openDb({ dataDir });

/* 平台管理员注入（幂等）：PLATFORM_ADMIN_EMAIL=你的邮箱 —— 该账号注册后每次启动自动授平台面。
   平台面只见计费/席位/健康度（A-C02），不是任何租户成员，业务数据天然 403。 */
if (process.env.PLATFORM_ADMIN_EMAIL) {
  const em = process.env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase();
  const { rows } = await db.query(`select user_id from accounts where email = $1`, [em]);
  if (rows.length) {
    await db.query(`insert into platform_admins(user_id, note) values ($1, 'env:PLATFORM_ADMIN_EMAIL')
      on conflict (user_id) do nothing`, [rows[0].user_id]);
    console.log(`[api] 平台管理员已就位：${em}`);
  } else console.log(`[api] 提示：PLATFORM_ADMIN_EMAIL=${em} 尚未注册账号——注册后重启即授权`);
}

const server = buildServer(db);
server.listen(port, () => {
  console.log(`[api] listening :${port} · data=${dataDir} · devAuth=${process.env.API_DEV_AUTH === '1' ? 'ON（仅开发）' : 'off'}`);
  if (process.env.API_DEV_AUTH !== '1') console.log('[api] 提示：会话认证在 Step 2 接入前，所有需身份接口返回 501');
});

/* 🔴 优雅退出：先停止收新请求，再 flush 数据库（PGlite 目录持久化是后台异步刷盘，
   退出前显式 close() 把内存中未落盘的写入刷到磁盘，降低硬退时丢最近几秒写入的风险）。
   兜底：无论如何 3 秒后强制退出，避免卡死进程管理器。 */
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return; shuttingDown = true;
  console.log(`[api] 收到 ${sig}，优雅退出中…`);
  const force = setTimeout(() => process.exit(0), 3000);
  try {
    await new Promise(res => server.close(res));   // 停止 accept 新连接
    await db.close();                              // flush PGlite 到磁盘
    console.log('[api] 已 flush 数据库，安全退出');
  } catch (e) { console.error('[api] 退出时出错：', e.message); }
  finally { clearTimeout(force); process.exit(0); }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
