#!/usr/bin/env bash
# ============================================================
# 每日异地备份：从运行中的 API 拉整库 gzip 快照，保留 N 天，可选传第二地点。
# 用法（放进 crontab，每天凌晨 3 点）：
#   0 3 * * *  API_BASE=http://127.0.0.1:39088 PLATFORM_TOKEN=xxx /path/cloud/ops/backup.sh >> /var/log/suite-backup.log 2>&1
# 环境变量：
#   API_BASE         API 地址（默认 http://127.0.0.1:8787）
#   PLATFORM_TOKEN   平台管理员登录后拿到的 Bearer 令牌（平台账号：见 PLATFORM_ADMIN_EMAIL）
#   BACKUP_DIR       本地存放目录（默认 ./backups）
#   KEEP_DAYS        保留天数（默认 14）
#   RCLONE_REMOTE    可选：rclone 远端名:路径（配了就再传一份异地，强烈建议）
# ============================================================
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8787}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
: "${PLATFORM_TOKEN:?需要 PLATFORM_TOKEN（平台管理员 Bearer 令牌）}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/suite-$STAMP.tar.gz"

echo "[backup] $(date) 拉取 $API_BASE/v1/platform/backup"
HTTP=$(curl -s -w '%{http_code}' -o "$OUT" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  "$API_BASE/v1/platform/backup")

if [ "$HTTP" != "200" ]; then
  echo "[backup] ❌ 失败：HTTP $HTTP（令牌过期？平台权限？）"; rm -f "$OUT"; exit 1
fi

SIZE=$(wc -c < "$OUT")
if [ "$SIZE" -lt 1000 ]; then
  echo "[backup] ❌ 文件过小（${SIZE}B），疑似坏包，已删除"; rm -f "$OUT"; exit 1
fi
echo "[backup] ✅ 本地：$OUT（${SIZE} 字节）"

# 异地副本（强烈建议：本机没了才有救）
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$OUT" "$RCLONE_REMOTE" && echo "[backup] ✅ 异地：$RCLONE_REMOTE"
else
  echo "[backup] ⚠ 未配 RCLONE_REMOTE——目前只有本机一份，强烈建议配异地（服务器一没就全灭）"
fi

# 清理过期
find "$BACKUP_DIR" -name 'suite-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "[backup] 保留最近 ${KEEP_DAYS} 天；当前共 $(ls -1 "$BACKUP_DIR"/suite-*.tar.gz 2>/dev/null | wc -l) 份"
