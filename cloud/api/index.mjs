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
const server = buildServer(db);
server.listen(port, () => {
  console.log(`[api] listening :${port} · data=${dataDir} · devAuth=${process.env.API_DEV_AUTH === '1' ? 'ON（仅开发）' : 'off'}`);
  if (process.env.API_DEV_AUTH !== '1') console.log('[api] 提示：会话认证在 Step 2 接入前，所有需身份接口返回 501');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
