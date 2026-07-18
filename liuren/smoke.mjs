// 浏览器冒烟：加载 file://liuren.html，捕获控制台错误，核对自检 19/19，遍历所有屏。
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dir = dirname(fileURLToPath(import.meta.url));
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = 'file://' + join(__dir, '..', 'liuren.html');

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// 遍历导航
const routes = ['overview', 'pricetag', 'gates', 'm28', 'retention', 'dividend', 'sales', 'system', 'selftest'];
for (const r of routes) {
  await page.click(`[data-act="nav"][data-route="${r}"]`).catch(() => {});
  await page.waitForTimeout(120);
}

// 自检页读徽章
await page.click('[data-act="nav"][data-route="selftest"]');
await page.waitForTimeout(200);
const heroText = await page.locator('.selftest-hero .hero-num').first().textContent().catch(() => '?');
const passCount = await page.locator('.tcase.pass').count();
const failCount = await page.locator('.tcase.fail').count();

// 截图（全部屏）
for (const r of routes) {
  await page.click(`[data-act="nav"][data-route="${r}"]`); await page.waitForTimeout(150);
  await page.screenshot({ path: join(__dir, `shot-${r}.png`), fullPage: true });
}
await page.emulateMedia({ colorScheme: 'dark' });
await page.click('[data-act="nav"][data-route="sales"]'); await page.waitForTimeout(150);
await page.screenshot({ path: join(__dir, 'shot-sales-dark.png'), fullPage: true });

console.log('hero badge:', heroText);
console.log('tcase pass:', passCount, 'fail:', failCount);
console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'NONE');
await browser.close();
process.exit(errors.length || failCount ? 1 : 0);
