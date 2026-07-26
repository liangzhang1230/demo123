#!/usr/bin/env node
/* 构建：把 src/ 下的 CSS 与 JS 按文件名顺序内联进单文件 HTML */
import { readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const files = readdirSync(srcDir).sort();
const css = files.filter(f => f.endsWith('.css')).map(f => readFileSync(join(srcDir, f), 'utf8')).join('\n');
const js = files.filter(f => f.endsWith('.js')).map(f => `/* ===== ${f} ===== */\n` + readFileSync(join(srcDir, f), 'utf8')).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>销冠操盘系统 · 一体版</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧭</text></svg>">
<style>
${css}
</style>
</head>
<body>
<nav id="topnav"></nav>
<div id="livebar"></div>
<div id="subnav"></div>
<main id="view"></main>
<div class="footer-note" id="backup-note"></div>
<div class="footer-note">系统边界：这个系统不会让一个卖不动的产品卖动。 · 数据归你 · 随时全量导出 · 永不锁定</div>
<nav id="bottomnav"></nav>
<div id="moresheet"></div>
<div id="modal-root"></div>
<div id="palette"></div>
<div id="toast"></div>
<script>
${js}
</script>
</body>
</html>`;

writeFileSync(join(root, 'dist', 'index.html'), html);
copyFileSync(join(root, 'dist', 'index.html'), join(root, '..', '销冠操盘系统.html'));
console.log(`built: ${(html.length / 1024).toFixed(0)} KB → suite/dist/index.html + 销冠操盘系统.html`);
