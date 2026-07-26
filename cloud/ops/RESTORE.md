# 备份与恢复演练手册（试点期必读）

> 灾难场景:服务器被封/宕机/误删,数据目录没了。目标:把某天的备份包还原成可运行的系统。
> 备份包 = 整库 gzip 快照(PGlite `dumpDataDir`),已用真实测试验证可 `loadDataDir` 还原(ops.test ③)。

## 一、日常备份(装一次,天天自动)

1. 确保 API 以固定数据目录运行,并设了平台管理员:
   ```bash
   PGLITE_DIR=/data/suite-pglite PLATFORM_ADMIN_EMAIL=你的邮箱 PORT=39088 node cloud/api/index.mjs
   ```
2. 平台账号登录一次,拿到 Bearer 令牌(浏览器开发者工具 Network 里复制,或 curl 登录):
   ```bash
   curl -s -X POST http://127.0.0.1:39088/v1/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"你的邮箱","password":"你的密码"}' | grep -o '"token":"[^"]*"'
   ```
3. 配 crontab 每天凌晨 3 点跑(令牌较长有效,过期就换新的;后续可做长效运维密钥):
   ```
   0 3 * * *  API_BASE=http://127.0.0.1:39088 PLATFORM_TOKEN=粘贴令牌 \
              BACKUP_DIR=/data/backups KEEP_DAYS=14 RCLONE_REMOTE=你的异地:suite \
              bash /path/cloud/ops/backup.sh >> /var/log/suite-backup.log 2>&1
   ```
   **强烈建议配 RCLONE_REMOTE**(异地存一份)——本机没了才有救。没有 rclone 就退而求其次:定时把 `/data/backups` 里的包下载到你自己电脑。

## 二、恢复演练(每月至少演练一次,别等真出事才第一次做)

1. 停掉 API 进程。
2. 把要恢复的备份包放到一边,例如 `/data/backups/suite-20260726-030000.tar.gz`。
3. 用下面这个脚本把快照还原成一个新的数据目录:
   ```bash
   cd cloud
   node --input-type=module -e '
     import { readFileSync } from "node:fs";
     import { PGlite } from "@electric-sql/pglite";
     import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
     const buf = readFileSync(process.env.SRC);
     const blob = new Blob([buf], { type: "application/gzip" });
     const db = new PGlite({ loadDataDir: blob, extensions: { pgcrypto } });
     const t = await db.query("select count(*)::int n from tenants");
     const a = await db.query("select count(*)::int n from accounts");
     console.log("还原成功:", t.rows[0].n, "个租户,", a.rows[0].n, "个账号");
     await db.dumpDataDir("gzip"); // 触发一次确保库健康
     process.exit(0);
   '
   ```
   把 `SRC=备份包路径` 传进去运行。看到"还原成功: N 个租户"即验证包完好。
4. 正式恢复:把 API 的 `PGLITE_DIR` 指向一个空目录,首启会自动建 schema;然后用上面的 `loadDataDir` 产物覆盖——**更稳的做法**:直接让新 `PGLITE_DIR` 从备份恢复。当前 PGlite 版本用 `loadDataDir` 加载后需 `dumpDataDir` 落盘到目标目录;运维脚本 `restore.sh`(见下)已封装。
5. 重启 API 指向恢复后的目录,登录验证:租户数、成员、最近同步版本是否正确。

## 三、演练验收清单(每次演练打勾)
- [ ] 备份包能被 `loadDataDir` 加载,租户数/账号数与生产一致
- [ ] 恢复后老板能登录、能看到公司数据、云端版本号正确
- [ ] 恢复后员工能登录、日报/成交数据在
- [ ] 从"发现故障"到"恢复可用"的耗时记录(目标 < 30 分钟)

## 四、红线
- **绝不只保留一份、只在一台机器上**——异地副本是底线。
- 备份包含员工薪酬/绩效等敏感个人信息,**异地存储位置也要访问受控**(别丢公共网盘)。
- 换服务器/换端口不影响数据(数据在 PGLITE_DIR),但迁移时务必先备份再迁。
