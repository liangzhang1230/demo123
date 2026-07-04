/**
 * npm run release（P8 发布收尾）：组装 demo-release/ 发布包并压缩为 演示版_v1.0.zip。
 * 前置：npm run build（dist/）与 npm run build:offline（dist-offline/）已完成。
 * 包内容：dist 全量 ＋ dist-offline/index.html 单文件版 ＋ Windows/Mac 双击启动脚本
 * （零依赖静态服务器 · 端口 5188 · 自动开浏览器）＋ README-演示指南.md。
 */
import { cpSync, chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = `${ROOT}/demo-release`;

if (!existsSync('dist/index.html') || !existsSync('dist-offline/index.html')) {
  throw new Error('请先执行 npm run build 与 npm run build:offline');
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/dist-offline`, { recursive: true });
cpSync('dist', `${OUT}/dist`, { recursive: true });
cpSync('dist-offline/index.html', `${OUT}/dist-offline/index.html`);

// ---- Windows：PowerShell TcpListener 静态服务器（零依赖、无需管理员即可监听局域网） ----
writeFileSync(`${OUT}/server.ps1`, `# 演示版静态服务器（零依赖 · 端口 5188 · 局域网可访问）
$port = 5188
$root = Join-Path $PSScriptRoot 'dist'
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css';
  '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.json'='application/json';
  '.ico'='image/x-icon'; '.woff2'='font/woff2'; '.webm'='video/webm' }
$ips = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress
Write-Host ''
Write-Host '================ AI 销售操盘手 · 演示版 ================'
Write-Host " 本机访问： http://localhost:$port/"
foreach ($ip in $ips) { Write-Host " 手机访问： http://$($ip):$port/   （手机与电脑同一 WiFi/热点）" }
Write-Host ' 按 Ctrl+C 或直接关窗口即停止'
Write-Host '========================================================'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
try { $listener.Start() } catch { Write-Host "端口 $port 被占用，请关闭占用程序后重试"; Read-Host '回车退出'; exit 1 }
Start-Process "http://localhost:$port/"
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object IO.StreamReader($stream)
    $line = $reader.ReadLine()
    while (($l = $reader.ReadLine()) -and $l -ne '') { }
    $path = '/'
    if ($line -match '^GET\\s+(\\S+)') { $path = $Matches[1] }
    $path = $path.Split('?')[0].Split('#')[0]
    if ($path -eq '/') { $path = '/index.html' }
    $file = Join-Path $root ($path.TrimStart('/') -replace '/', '\\')
    if (-not (Test-Path $file -PathType Leaf)) { $file = Join-Path $root 'index.html' }
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
    $header = "HTTP/1.1 200 OK\`r\`nContent-Type: $ct\`r\`nContent-Length: $($bytes.Length)\`r\`nCache-Control: no-cache\`r\`nConnection: close\`r\`n\`r\`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($bytes, 0, $bytes.Length)
  } catch { } finally { $client.Close() }
}
`);

writeFileSync(`${OUT}/启动演示-Windows.bat`, `@echo off\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"\r
pause\r
`);

// ---- Mac：python3 静态服务器（macOS 自带），缺失时回退单文件版 ----
writeFileSync(`${OUT}/启动演示-Mac.command`, `#!/bin/bash
cd "$(dirname "$0")"
PORT=5188
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "本机IP")
echo ""
echo "================ AI 销售操盘手 · 演示版 ================"
echo " 本机访问： http://localhost:$PORT/"
echo " 手机访问： http://$IP:$PORT/   （手机与电脑同一 WiFi/热点）"
echo " 按 Ctrl+C 或直接关窗口即停止"
echo "========================================================"
( sleep 1; open "http://localhost:$PORT/" ) &
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT" --directory dist --bind 0.0.0.0
else
  echo "未找到 python3——改用单文件应急版（仅本机）"
  open "dist-offline/index.html"
fi
`);
chmodSync(`${OUT}/启动演示-Mac.command`, 0o755);

// ---- 演示指南 ----
writeFileSync(`${OUT}/README-演示指南.md`, `# AI 销售操盘手 · 演示版 v1.0 · 演示指南

## 一、怎么启动（三选一）

1. **Windows**：双击 \`启动演示-Windows.bat\` —— 自动起本地服务器（端口 5188）并打开浏览器。
2. **Mac**：双击 \`启动演示-Mac.command\` —— 同上。（首次若被拦：右键 → 打开；或
   系统设置 → 隐私与安全性 → 仍要打开。）
3. **应急（任何电脑）**：直接双击 \`dist-offline/index.html\` 单文件版——零服务器、
   完全离线可演，功能与正式版一致（仅本机浏览，手机无法访问）。

## 二、手机演示（老板用手机看的概率大于电脑）

1. 手机与电脑连**同一个 WiFi**（现场没网就开手机热点、电脑连它）；
2. 电脑双击启动脚本，启动窗口里会打印「手机访问：http://电脑局域网IP:5188/」；
3. 手机浏览器输入该地址即可。查 IP 备用方法：Windows 命令行 \`ipconfig\`（IPv4 地址），
   Mac 系统设置 → WiFi → 详细信息。

## 三、演示前 30 秒检查单

- 打开页面后，**先点右下角 ↺ 一键重置**（清掉上一场的操作，恢复种子数据）；
- 把手机递给老板前，点右下角 🔓 **防误触锁定**（长按提示条 1 秒可解锁）；
- 全程可离线，现场没网不影响。

## 四、页面地图

- 首页 \`/\`：**三个免密身份入口**——陈总(老板) / 刘敏(主管) / 王丽(销售)，一键切换；
- \`/script\`：**商务演示脚本页**——10 分钟动线 ＋ 每步话术提词（讲解前先读一遍）；
- 老板看板 \`/boss\`：晨话 → 今日一件事 → 早报 → 心跳六数 → 钱事分诊 → 团队一屏 → 武器坞
  （区五右上角有演示专属「一键点亮全家桶 / 一键回锁」开关）；
- 销售端 \`/sales\`：建档 / 推进 / 成交 / 每日确认页（含演示专属「模拟过一天」）。

## 五、成交动线提醒

先锁态讲缺口（锁卡三要素：价值主张 ＋ 数据就绪 ＋ 试看申请）→ 一键点亮看「付费后的世界」
（全部带「示例数据」角标）→ 一键回锁 → 报价收尾。**演示卖的是看板与货架，不是功能清单。**
`);

// ---- 压缩 ----
rmSync(`${ROOT}/演示版_v1.0.zip`, { force: true });
execSync(`zip -r -q "演示版_v1.0.zip" demo-release`, { cwd: ROOT });
execSync(`unzip -l "演示版_v1.0.zip" | tail -3`, { cwd: ROOT, stdio: 'inherit' });
console.log('✓ 发布包组装完成：demo-release/ 与 演示版_v1.0.zip');
