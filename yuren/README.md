# 销冠育人器 v2.3 · 单文件交付

依据《0号·销冠算盘全局公约 v1.5》+《5号·销冠育人器完整规格 v2.3》开发。

## 使用（小白三步）

1. 双击打开 `销冠育人器.html`（Chrome/Edge，无需安装、无网络）。
2. 「起点」页点 **载入演示数据** 一键体验全部模块；正式使用则清空后按屏⑧「信封」导入其余板块数据包。
3. 「数据与系数 → 自检」看徽章：**19/19 绿 = 收货**。

## 交付形态（公约【8】技术栈冻结）

- 单 HTML 文件，HTML+CSS+JS 全内联；零框架、零 CDN、零网络请求、零埋点。
- 存储：`localStorage`，前缀 `skab_yuren_`，经 StorageAdapter 读写（预留 IndexedDB 切换位）；启动做配额自检；距上次导出 >14 天顶部黄条催备份（A-24）。
- 双构建：文件头部常量 `BUILD_MODE = 'full' | 'free'`（本仓库版本为 `full`；发 free 版仅改此一常量，屏②/屏⑦为钩子屏，其余 `.locked`）。
- 时钟注入（公约 C-14）：UI 层唯一一处取真实时钟；计算层全部纯函数显式收 `today`；对拍固定注入 `TEST_TODAY=2026-07-13`。

## 自测报告（三绿）

`node yuren/tools/selfcheck.mjs` 输出（提交时实测）：

- **件七对拍 19/19 🟢**（T1–T19：闸④资格 / 闸③产权 / PLV 三层 / PSI 32→96 / 认知鸿沟 54.8% / 35 倍 / ROI 9.5 / 汰前三拦截 / 有效动作分防刷 / M40 配对+冻结+轮换 / M41 0.64 / M42 轨迹 3万 vs 18万 / M43 三区+子目标 3.3 万 / M44a 0.40 / 信封三包点亮+剂量导出 2.0h / 闸⑧三态）
- **件六断言 19/19 🟢**（含源码自扫描：无 fetch/XHR/sendBeacon/外链 script；PLV 词库逐字一致；抽检卡无结果字段；子目标不入配额；CallMetrics 埋设无界面；R-05 公约 §4.7 双咬合基准 65.8% / 32.5%）
- **授权联测 3/3 🟢**（合法码验签通过 / 伪造码拒绝 / 过期码降级且信封导出不锁）

浏览器内同样可复核：屏⑧「自检」页实时重跑全部对拍并渲染徽章。

## 授权（公约【11】· ECDSA P-256 离线验签）

- HTML 内只有公钥（授-5）；签发在作者本地：`node yuren/tools/license-signer.mjs "王总" yuren 2027-07-18`。
- ⚠️ `tools/demo-keys.json` 为**演示密钥对**。生产发布前运行 `--gen-keys` 重新生成，替换 HTML 中 `LICENSE_PUBKEY_JWK`，私钥离线保存、绝不入库。
- 到期只降级不锁数据；信封导出永不锁定（授-2）；无机器绑定（授-3）。

## 信封（公约【7】）

- 导出：`board=yuren`，`derived.coachingDoseActual`（供留人器分红闸⑧ Q4）+ DailyReport / CoachingAck / CoachTask / Prescription / Bounty。
- 导入：算账器（M21/UER/Deal——配方引擎与一切排名的地基）、留人器（M28/AHC——闸③钥匙）、招人器（PracticeLog——闸⑨）、定价器（配额——M43）。未知实体静默跳过；同 board 重导=整条覆盖；过期只标注不阻断。

## 目录

```
yuren/销冠育人器.html        交付物本体（唯一必需文件）
yuren/tools/selfcheck.mjs    对拍执行器（Node ≥18，无第三方依赖）
yuren/tools/license-signer.mjs  授权码离线签发器（作者侧）
yuren/tools/demo-keys.json   演示密钥对（生产必换）
docs/设计借鉴清单.md          全球头部同类软件设计调研与落地映射
```
