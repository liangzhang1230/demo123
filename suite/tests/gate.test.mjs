#!/usr/bin/env node
/* 登录闸验收（Salesforce 式）：页面经 http 由真 API 托管(webMode)→ 未登录只显示登录框，
   整个应用(顶栏/板块/数据面板)隐藏；注册→开通团队→登录后完整应用出现；登出→回到闸。
   附：全页零 Claude/Artifact 品牌痕迹。 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright/index.js');
const { openDb } = await import('../../cloud/api/db.mjs');
const { buildServer } = await import('../../cloud/api/server.mjs');

let failures = 0;
const ok = (c, n, e = '') => { if (c) console.log(`  ✓ ${n}`); else { failures++; console.log(`  ✗ ${n} ${e}`); } };

const db = await openDb();
const server = buildServer(db, { devAuth: false, log: false });
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;   // 🔴 经 http 访问 = webMode = 触发闸

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(base + '/');                 // API 托管的网页版
await page.waitForTimeout(500);

/* ① 未登录：闸生效 */
const gated = await page.evaluate(() => ({
  bodyGated: document.body.classList.contains('gated'),
  authgate: !!document.querySelector('.authgate'),
  topnavHidden: getComputedStyle(document.querySelector('#topnav')).display === 'none',
  hasLoginBtn: !!document.querySelector('[data-act="cloud.login"]'),
  hasEmail: !!document.querySelector('#cl-email'),
  // 关键：驾驶舱/板块内容不可见
  noBoards: !document.querySelector('.nav-tab'),
  viewText: (document.querySelector('#view').textContent || '').slice(0, 40),
}));
ok(gated.bodyGated && gated.authgate, 'body.gated + .authgate 出现');
ok(gated.topnavHidden, '顶部导航隐藏(display:none)');
ok(gated.hasLoginBtn && gated.hasEmail, '只显示登录/注册框');
ok(gated.noBoards, '所有板块 tab 不存在(整个应用隐藏)');

/* 品牌痕迹检查 */
const brandLeak = await page.evaluate(() => /claude|artifact|anthropic/i.test(document.documentElement.outerHTML));
ok(!brandLeak, '全页零 Claude/Artifact 痕迹');

/* ② 注册 → 应进入"开通团队"阶段(仍在闸内) */
await page.fill('#cl-email', 'gate@t.cn'); await page.fill('#cl-pass', 'gatePw888');
await page.click('[data-act="cloud.signup"]');
await page.waitForTimeout(900);
const stage2 = await page.evaluate(() => ({
  stillGated: document.body.classList.contains('gated'),
  hasTname: !!document.querySelector('#cl-tname'),
  hasCode: !!document.querySelector('#cl-code'),
}));
ok(stage2.stillGated && stage2.hasTname && stage2.hasCode, '注册后 → 开通团队闸(创建/加入二选一)');

/* ③ 创建团队 → 完整应用出现，闸消失 */
await page.fill('#cl-tname', '闸测试公司');
await page.click('[data-act="cloud.create-tenant"]');
await page.waitForTimeout(1200);
const full = await page.evaluate(() => ({
  gone: !document.body.classList.contains('gated'),
  topnavShown: getComputedStyle(document.querySelector('#topnav')).display !== 'none',
  boards: [...document.querySelectorAll('.nav-tab')].map(e => e.textContent.trim()).length,
  hasDash: /驾驶舱|经营/.test(document.querySelector('#view').textContent || ''),
}));
ok(full.gone && full.topnavShown, '登录+入租户后 → 闸消失，顶部导航显示');
ok(full.boards >= 5 && full.hasDash, `完整应用出现(${full.boards} 个板块 + 驾驶舱内容)`);

/* ④ 登出 → 回到登录闸 */
await page.evaluate(() => { location.hash = '#/cloud'; });
await page.waitForTimeout(300);
await page.evaluate(() => { const b = document.querySelector('[data-act="cloud.logout"]'); if (b) b.click(); });
await page.waitForTimeout(900);
const back = await page.evaluate(() => document.body.classList.contains('gated') && !!document.querySelector('[data-act="cloud.login"]'));
ok(back, '登出 → 回到登录闸');

ok(errs.length === 0, '全程零页面错误', JSON.stringify(errs.slice(0, 3)));

await browser.close(); server.close();
console.log(failures ? `\n❌ ${failures} 条未过` : '\n✅ 登录闸验收全绿');
process.exit(failures ? 1 : 0);
