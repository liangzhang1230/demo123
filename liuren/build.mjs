#!/usr/bin/env node
// 零依赖打包器：把 src/ 下的模块内联成单个 HTML 文件（双击即用，无网络无 CDN）。
// 交付形态遵《0号公约》§8：单 HTML（HTML+CSS+JS 内联）。构建产物 = 上级目录 liuren.html。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(__dir, 'src', p), 'utf8');

// JS 模块按依赖顺序拼接（全部包进一个 IIFE，见 boot.js 尾部闭合）。
const JS_ORDER = [
  'core.js',          // 宪法函数：safeDiv/getCoef/fmt/id/rampCurve12/newHireYearRate/双口径
  'coefficients.js',  // COEFFICIENTS 系数总表（公约§5 + 件二§2.3）
  'storage.js',       // StorageAdapter / 实体 / 信封 / ExternalRef / 种子
  'engine.js',        // SII/EI/DVI/AHC · M28 · 十二道闸 · M16 · M37 · M38 · M17 · MC
  'scripts.js',       // 话术库 L 系（逐字，变量注入）
  'selftest.js',      // 件七 T1–T19 对拍 + 件六 L-D 断言（TEST_TODAY 注入）
  'ui.js',            // 路由 / 组件 / 八屏 + 钱途页 + 系数自检页
  'boot.js',          // 启动装配
];

const css = src('app.css');
const head = src('head.html');
const js = JS_ORDER.map((f) => `/* ==================== ${f} ==================== */\n${src('js/' + f)}`).join('\n\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
${head.trim()}
<style>
${css.trim()}
</style>
</head>
<body>
<div id="app"></div>
<script>
"use strict";
(function(){
${js}
})();
</script>
</body>
</html>
`;

const out = join(__dir, '..', 'liuren.html');
writeFileSync(out, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`✓ built ${out}  (${kb} KB)`);
