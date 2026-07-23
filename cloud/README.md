# AI 销售操盘手 · 云端版（按《云端版规格 v5.1》施工）

引用锁架构：业务口径 100% 以五板块规格为准（`docs/specs/`），本目录只做云端增量。

## 分层与目录

```
cloud/
  domain/          L2 业务层——五板块纯函数引擎原样移植（引用锁，零改写）
    shared.mjs       公约层：宪法函数/S曲线(双咬合基准)/系数总表/兜底铁律/信封 schema
    dingjia.mjs      1号 定价器（25 条对拍）
    zhaoren.mjs      2号 招人器（24 条对拍）
    suanzhang.mjs    3号 算账器（22 条对拍）
    liuren.mjs       4号 留人器（19 条对拍）
    yuren.mjs        5号 育人器（19 条对拍）
  db/schema.sql    L1 底座——多租户/五级角色/事件流不可变/action_card/席位订阅/RLS
  tests/           验收：c0-rls（底座 31 断言）+ 五板块对拍 + run-all（109 条汇总）
```

## 验收（v5.1 §12）

```bash
npm install                      # PGlite（真 Postgres 语义测试）
node tests/run-all.mjs           # C0 + C1 全量：109 条对拍 + 底座隔离
node tests/c0-rls.test.mjs       # 单跑 C0：A-C01 零穿透 / A-C02 平台方零业务读路径 / A-C03 事件流不可变
node tests/dingjia.test.mjs      # 单跑任一板块
```

- 对拍按各板块件七注入值运行（TEST_TODAY=2026-07-13、targetYear 逐条注明，公约 C-14/R-11）；
- `newHireYearRate` 双咬合基准（65.8% / 32.5%）前置强跑，只跑基准①视为未验证；
- 计算层零 `new Date()`；系数只经 `makeGetCoef(租户覆盖)`；除法只经 safeDiv。

## 引擎约定（对 C2+ 服务层）

- 引擎为**纯函数**：数据入参、判定出参（`{light, code, vars}`），话术渲染在表现层；
- 有副作用语义的操作（M28 下调拦截、分红强启、异议失效）返回**变更指令**（events），
  由服务层唯一写入口在事务内落库——天然满足 A-05 / L-D1 / A-C04；
- `today` 由 API 层唯一取真实时钟下传；生产由 dayRoll 注入当日；
- 跨板块字段走 `external_refs(tenant_id, board)` 整条覆盖只读缓存（A-20/A-21），
  云端同库直读时 staleDays 恒 0，字段仍带 computedAt。

## 阶段进度

- ✅ C0 底座（31 断言全绿）：五级角色 / 事件流不可变 / action_card 状态机 / 席位配额与流水不可变 / 平台方零业务读路径 / 租户隔离零穿透
- ✅ C1 L2 移植（109 条对拍）：定价 25 / 招人 24 / 算账 22 / 留人 19 / 育人 19
- ✅ C2 数据模型（公约 32 实体真表化 + 事件流复算 + 种子）
- ✅ C3–C9 业务七层（按角色拆端 + 接事件流）
- ✅ C10 推送层（插卡两级限流 / 早报休息日零推送 / 播报剥金额 / 状态机）
- ✅ C11 白话原语（`server/vernacular.mjs`）：静态模板兜底（五板块话术码内置，缺 var → '—' 零缺字）+
  可插拔 AI 润色（client 抛错/超时/缺席 → 静态回退）+ 🔴 A-C07 出参审计（sanitizeForAI 白名单，
  name/phone/clientName 剥离为 '员工A' 占位，prompt 机检无原值）
- ✅ C12 商业化（`server/billing.mjs`）：boardsEnabled 板块级授权守卫（requireBoard 已接
  m7.computePlan / m12.setRecipeSource / m29.computeIndices 三个示范入口）+ 到期降级
  （suspended → writes.put/upsert/patch 全拒，🔴 导出永不拒 A-C05/授-2）+ 席位占用 vs 配额
- ✅ C13 双向迁移（`server/migrate.mjs`）：importEnvelopes（单机 1–5 信封 → 实体白名单落真表 +
  external_refs 整条覆盖 + 事件留痕；未知实体静默跳过；同 board 重复导入整条覆盖）/
  exportAll（5 个 skab_v1 信封随时可出，回落单机版；停机豁免机检）
