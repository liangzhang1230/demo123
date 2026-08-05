# 销售漏斗（自用版）

单人使用的客户跟进工具：漏斗看板 ＋ 公海 ＋ 家庭成员档案。
前端 React SPA，后端 Node（Express），数据存服务器上的 JSON 文件，
手机、电脑浏览器都能访问。

## 功能

- **漏斗看板**：各阶段当前存量、逐级转化率（按「曾到达」人数算，跳阶段不漏计）；
- **客户档案**：以个人姓名建档，一个客户挂多名家庭成员（本人/家长/孩子/其他，各带电话微信）；
- **公海**：私海客户超过 N 天（默认 14，可改）无跟进自动回收进公海，一键认领/释放；
  「成交」及之后阶段不回收；
- **跟进时间线**：每条跟进、阶段流转、认领释放回收全部落事件记录；
- **阶段可配置**：默认「线索→已联系→有意向→试听/体验→成交→复购/转介绍」，
  设置页随意改（如加「就业跟进」）；「流失」是内置侧出口，任何阶段可进，需填原因。

## 本地开发

```bash
cd funnel
npm install
npm run dev:server   # 终端 1：后端 :8787
npm run dev          # 终端 2：前端 :5173（/api 已代理到后端）
```

## 部署到服务器

```bash
cd funnel
npm install
npm run build                                # 产出 dist/
FUNNEL_PASSWORD=你的密码 PORT=8787 npm start   # 后端托管 API + 前端静态文件
```

- 不设 `FUNNEL_PASSWORD` 时，首次启动会生成随机密码打印在日志里
  （存于 `data/db.json` 的 `auth.password`）；
- 数据全部在 `funnel/data/db.json`，**备份 = 复制这个文件**；
- 建议用 nginx/caddy 反代并配 HTTPS（客户资料含手机号，别裸 HTTP 挂公网）；
- 用 pm2 / systemd 保活，例如 `pm2 start server/index.mjs --name funnel`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8787 | 监听端口 |
| `FUNNEL_PASSWORD` | 无 | 登录密码，覆盖 db.json 里的生成密码 |
| `FUNNEL_DATA_DIR` | `funnel/data` | 数据目录位置 |
