#!/usr/bin/env bash
# ============================================================
# 从备份包还原到一个数据目录（PGlite loadDataDir → dumpDataDir 落盘）。
# 用法：SRC=备份包.tar.gz DEST=/data/suite-pglite-restored bash restore.sh
#   还原完成后，把 API 的 PGLITE_DIR 指向 DEST 重启即可。
# ============================================================
set -euo pipefail
: "${SRC:?需要 SRC=备份包路径}"
: "${DEST:?需要 DEST=目标数据目录（应为空或不存在）}"
[ -f "$SRC" ] || { echo "❌ 备份包不存在：$SRC"; exit 1; }
[ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null || true)" ] && { echo "❌ DEST 非空，请用空目录：$DEST"; exit 1; }

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # cloud/
cd "$HERE"
SRC="$SRC" DEST="$DEST" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { PGlite } from "@electric-sql/pglite";
  import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
  const blob = new Blob([readFileSync(process.env.SRC)], { type: "application/gzip" });
  // 正确写法：位置参数 dataDir + loadDataDir，一次构造即把快照落盘到该目录
  const db = new PGlite(process.env.DEST, { loadDataDir: blob, extensions: { pgcrypto } });
  await db.query("select 1");
  const t = (await db.query("select count(*)::int n from tenants")).rows[0].n;
  const a = (await db.query("select count(*)::int n from accounts")).rows[0].n;
  await db.close();
  // 二次打开（不带 loadDataDir）确认盘上数据确已持久
  const db2 = new PGlite(process.env.DEST, { extensions: { pgcrypto } });
  const t2 = (await db2.query("select count(*)::int n from tenants")).rows[0].n;
  await db2.close();
  if (t2 !== t) { console.error("❌ 落盘校验失败"); process.exit(1); }
  console.log(`✅ 已还原并落盘到 ${process.env.DEST}：${t} 租户 / ${a} 账号——把 API 的 PGLITE_DIR 指向它重启即可`);
  process.exit(0);
'
