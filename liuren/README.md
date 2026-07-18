# 销冠留人器 · 信用层（4号板块 v4.4）

单 HTML 文件、双击即用、无后端、无网络、无 CDN、localStorage 落地。严格按
《0号·全局公约 v1.5》+《4号·留人器规格 v4.4》实现，从外到内借鉴全球头部
（Linear / Stripe / Geist 的克制视觉；Lattice / CultureAmp / Credit Karma 的
信任与诊断范式；Baremetrics / Amplitude 的 hero + 拆解 + 空态口径）。

## 交付物

- **`../liuren.html`** —— 唯一交付物。双击即用；打开「系数与自检」页看徽章，**19/19 绿＝收货**。

## 开发 / 构建（零依赖）

```bash
node liuren/build.mjs            # src/ → liuren.html（内联 CSS/JS，单文件）
node liuren/selftest.node.mjs    # 无头跑件七 T1–T19 + 件六 L-D 断言（退出码 0=全绿）
node liuren/smoke.mjs            # 浏览器冒烟（需 playwright-core + 本机 Chromium）
```

构建器 `build.mjs` 只用 Node 标准库（`fs`），不装任何 npm 包。

## 源码结构（单文件按依赖顺序拼接）

| 模块 | 职责 |
|---|---|
| `src/head.html` | `<head>`（meta / title / favicon） |
| `src/app.css` | 设计系统（令牌 / 组件 / 双主题 / 打印 A4） |
| `src/js/core.js` | 宪法层：`safeDiv`/格式化/`rampCurve12`/`newHireYearRate`/双口径（公约 §2–4） |
| `src/js/coefficients.js` | COEFFICIENTS 系数表 + `getCoef`（公约 §5 + 件二 §2.3） |
| `src/js/storage.js` | StorageAdapter / 实体 / 信封 / ExternalRef / 授权验签 / 出厂种子 |
| `src/js/engine.js` | 件三函数库：四指数 / M28 / 十二道闸 / M16 / M37 / M38 / M17 / MC |
| `src/js/scripts.js` | 话术库 L 系（逐字，变量注入） |
| `src/js/selftest.js` | 件七 T1–T19 对拍 + 件六 L-D 断言（TEST_TODAY 注入） |
| `src/js/ui.js` | 路由 / 组件 / 八屏 + 钱途页 + 系数自检页 |
| `src/js/boot.js` | 启动装配 + 事件委托 |

## 红线落点（结构性保证）

- **irrevocable**：`tryDowngradeM28` 无成功路径，只留痕 + AHC 扣分 + 全员可见（L-D1/T12）。
- **AHC 全员可见、老板改不了**：钱途页⑤栏渲染，附「🔒 计算得出」标记；老板端无编辑入口。
- **钱途页只供氧**：零排名 / 零对比 / 零员工红灯（唯一红＝⑤栏老板信用）。
- **null≠0**：`safeDiv` 除零→null，全局唯一空态渲染「—」；无 Infinity/NaN。
- **跨板块字段只读**：ExternalRef 整条覆盖、带来源与 `asOf`、过期只标注不阻断。
- **授权**：HTML 内只含 ECDSA P-256 公钥；到期只降级不锁数据；导出永不锁定；无设备指纹；全程零网络。
- **📎 出处 / 边界同句**：每条建议含引用；五板块同句边界声明。

详见 `验收报告.md`。
