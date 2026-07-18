# SaaS 底座 — 登录 / 多租户隔离 / 数据同步

一份 schema、一份前端，三种部署方式任选，之间**零改动迁移**。

## 架构一句话

前端仍是单文件（`销冠操盘系统.html`），新增「云端」页；后端 = 任意 Supabase 兼容栈
（Postgres + GoTrue 认证 + PostgREST 接口）；**多租户隔离 = 数据库行级安全（RLS）**，
不依赖前端、不依赖后端应用代码——即使有人拿到 anon key 直连数据库，也只能看到自己租户的行。

```
浏览器（单文件前端） ──HTTPS──▶ /auth/v1/*  登录注册（GoTrue）
                              /rest/v1/rpc/* 受控读写（PostgREST → schema.sql 里的 RPC）
                                             │
                                     Postgres + RLS（隔离在这一层，26 条自动化测试盯着）
```

## 部署方式（按省心程度排序）

### A. Supabase 官方云（5 分钟，先跑起来验证生意）
1. supabase.com 建项目（免费档即可起步）；
2. SQL Editor 里整份执行 `schema.sql`；
3. Authentication → Providers → Email：按需关闭「Confirm email」（关了免邮箱验证，开发期方便）；
4. 前端「云端」页填入 Project URL 和 anon key，注册登录即用。
> 限制：服务器在境外，国内访问偶有延迟；正式卖国内客户换 B/C，数据原样搬。

### B. 国内云服务器自托管 Supabase（正式售卖推荐）
1. 买台国内云服务器（2核4G 起步）+ 域名 + ICP 备案；
2. `git clone https://github.com/supabase/supabase && cd supabase/docker`，
   按官方 self-hosting 文档改 `.env`（改密码/JWT secret/域名），`docker compose up -d`；
3. 数据库里执行 `schema.sql`；Nginx/Caddy 反代 + HTTPS；
4. 前端填自己域名 + anon key。完事。

### C. 云厂商托管 Postgres（阿里 RDS/腾讯云）+ 自跑 GoTrue/PostgREST
数据库运维（备份/高可用）交给云厂商，两个无状态小服务自己跑。B 的省心升级版，客户多了再换不迟。

## 隔离为什么靠谱（回答“租户多了怕 BUG”）

- 隔离逻辑只有一处：`schema.sql` 的 RLS 策略 + `security definer` RPC，全部表 `force row level security`（连表拥有者都绕不过）；
- `tests/rls.mjs` 用 PGlite（真 Postgres 语义）穷举越权路径：跨租户读/写/指名查询/伪造成员/邀请码复用/匿名访问/审计篡改，**26 条断言全绿才算过**；
- 加任何新表：照抄本文件模板 + 加隔离用例，否则默认拒绝（无策略 = 无权访问）；
- 平台托管 vs 自托管不影响隔离——同一份 SQL。托管平台更靠谱的是**运维**（备份、升级、补丁），不是隔离。

```bash
cd saas && npm install && node tests/rls.mjs        # 26 条隔离测试
cd ../suite && node tests/cloud-sync.mjs            # 前端云同步端到端（伪后端）
```

## 使用流程（老板视角）

1. 云端页 → 填服务器 → 注册登录 → 「创建租户」（本机数据自动作为首版推上云端）；
2. 「生成销售邀请码」发给员工；员工在自己电脑打开同一个 HTML → 登录 → 凭码加入 → 数据自动拉下来；
3. 之后任何人的改动 3 秒内自动推送，其他人「拉取云端」或重新打开即见；并发写有乐观锁，冲突必弹窗、绝不静默覆盖。

## v1 边界（收钱前想清楚）

- **整库一份 JSON 文档**：并发以「份」为单位，多人高频同时编辑会常见冲突弹窗。适合 ≤20 人团队、老板主录入。
- **租户内角色是软约束**：销售端界面自我克制，但技术上同租户成员共享整库读写。
- **v2 路线**（客户付费后再做）：拆热点表（日报/带教回执/异议建议 → 真实行 + 行级角色 RLS，销售只能写自己的行）、
  Supabase Realtime 推送（免手动拉取）、Stripe/微信支付订阅、租户用量与封禁后台。
- 卖国内企业客户的合规三件套：ICP 备案、软件著作权、对公收款资质（详见主对话清单）。
