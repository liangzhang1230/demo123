#!/usr/bin/env node
/* 云同步端到端（Step 3 验收）：真浏览器 UI ↔ 真云端 API（cloud/api）↔ 真 Postgres（PGlite+RLS）
   注册即登录 → 建租户(本地首版推送) → 改数据 3 秒去抖自动推送 → 邀请码 → 第二设备凭码加入拉取 →
   双端并发 → 过期版本推送冲突弹窗 → 拉取云端收敛 → 服务端状态全程核对 → 双端零页面错误 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright/index.js');
const { openDb } = await import('../../cloud/api/db.mjs');
const { buildServer } = await import('../../cloud/api/server.mjs');

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // suite/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

/* ---------- 真后端：内存 PGlite + 生产形态（devAuth=false，只认会话） ---------- */
const db = await openDb();
const server = buildServer(db, { devAuth: false, log: false, authRate: { limit: 200, windowMs: 60_000 } });
await new Promise(r => server.listen(0, r));
const apiBase = `http://127.0.0.1:${server.address().port}`;
console.log(`  · API @ ${apiBase}（生产形态：仅会话认证）`);

/* 服务端视角核对器：用老板账号经真实登录读 /v1/state */
async function serverState(email, password) {
  const login = await fetch(apiBase + '/v1/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(r => r.json());
  const st = await fetch(apiBase + '/v1/state', {
    headers: { authorization: `Bearer ${login.token}` },
  }).then(r => r.json());
  return st;
}

/* ---------- 浏览器 ---------- */
const browser = await chromium.launch();
const PASS = 'cloudPw88';                                 // 符合密码策略（≥8 位含字母数字）
async function device() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page._errs = [];
  page.on('pageerror', e => page._errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page._errs.push(m.text()); });
  await page.goto('file://' + join(root, 'dist', 'index.html'));
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = '#/cloud'; });
  await page.waitForTimeout(250);
  return page;
}
async function cfg(page) {
  await page.fill('#cl-url', apiBase);
  await page.click('[data-act="cloud.save-cfg"]');
  await page.waitForTimeout(200);
}
async function signup(page, email) {
  await page.fill('#cl-email', email);
  await page.fill('#cl-pass', PASS);
  await page.click('[data-act="cloud.signup"]');          // 注册即登录，视图直接切换
  await page.waitForTimeout(600);
}
async function loginExisting(page, email) {
  await page.fill('#cl-email', email);
  await page.fill('#cl-pass', PASS);
  await page.click('[data-act="cloud.login"]');
  await page.waitForTimeout(800);
}

/* ═══ 老板设备 ═══ */
console.log('— 老板设备：注册 → 建租户（本地首版推送） —');
const boss = await device();
await cfg(boss);
await signup(boss, 'boss@x.com');
ok(await boss.evaluate(() => document.getElementById('cl-tname') != null), '注册即登录 → 进入建租户界面');
await boss.evaluate(() => { SK.DB.company.name = '云同步测试公司'; SK.persist(); });
await boss.fill('#cl-tname', '云同步测试公司');
await boss.click('[data-act="cloud.create-tenant"]');
await boss.waitForTimeout(1200);
{
  const st = await serverState('boss@x.com', PASS);
  ok(st.version === 2 && st.doc.company && st.doc.company.name === '云同步测试公司',
    `建租户 → 本地数据作为首版推送（服务端版本 ${st.version}）`);
}

console.log('— 改动 3 秒去抖自动推送 —');
await boss.evaluate(() => { SK.DB.company.targetYearGrossWan = 2222; UI.commit(); });
await boss.waitForTimeout(3900);
{
  const st = await serverState('boss@x.com', PASS);
  ok(st.version === 3 && st.doc.company.targetYearGrossWan === 2222,
    `改目标 → 自动推送（服务端版本 ${st.version}·目标 ${st.doc.company.targetYearGrossWan}）`);
}

/* ═══ 邀请 + 销售设备 ═══ */
console.log('— 邀请码 + 销售设备凭码加入 —');
await boss.click('[data-act="cloud.invite"][data-role="sales"]');
await boss.waitForTimeout(400);
const code = await boss.evaluate(() => document.querySelector('#modal-root .hero').textContent.trim());
ok(/^[0-9A-F]{12}$/.test(code), `邀请码生成（12 位 hex：${code}）`);
await boss.click('[data-act="ui.modal-close"]');

const sales = await device();
await cfg(sales);
await signup(sales, 'sales@x.com');
await sales.fill('#cl-code', code);
await sales.click('[data-act="cloud.join-tenant"]');
await sales.waitForTimeout(1200);
{
  const pulled = await sales.evaluate(() => ({ name: SK.DB.company.name, goal: SK.DB.company.targetYearGrossWan }));
  ok(pulled.name === '云同步测试公司' && pulled.goal === 2222, '凭码加入 → 云端数据拉到本机（公司名/目标一致）');
  const c = await sales.evaluate(() => JSON.parse(localStorage.getItem('skab_suite_cloud')));
  ok(c.role === 'sales' && c.version === 3, `角色=sales · 本地版本=服务端版本(3)`);
}

/* ═══ 双端并发 → 冲突弹窗 → 收敛 ═══ */
console.log('— 双端并发冲突 —');
await sales.evaluate(() => { SK.DB.company.attritionRate = 0.5; UI.commit(); });
await sales.waitForTimeout(3900);
{
  const st = await serverState('boss@x.com', PASS);
  ok(st.version === 4 && st.doc.company.attritionRate === 0.5, `销售端改动自动推送（服务端版本 ${st.version}）`);
}
await boss.evaluate(() => { SK.DB.company.hiringCycleDays = 99; SK.persist(); });
await boss.click('[data-act="cloud.push"]');              // 老板本地 version=3，服务端已 4 → 409
await boss.waitForTimeout(800);
ok(await boss.evaluate(() => document.querySelector('#modal-root').classList.contains('open')
  && document.querySelector('#modal-root').textContent.includes('云端有更新')),
  '过期版本推送 → 冲突弹窗（不静默覆盖）');
await boss.click('[data-act="cloud.conflict-pull"]');
await boss.waitForTimeout(900);
{
  const got = await boss.evaluate(() => ({ ar: SK.DB.company.attritionRate, v: JSON.parse(localStorage.getItem('skab_suite_cloud')).version }));
  ok(got.ar === 0.5 && got.v === 4, '选择拉取云端 → 老板端拿到销售端改动，版本对齐 4');
}

/* ═══ 成员与席位卡片（Step 4 壳）＋ 网页版静态托管 ═══ */
console.log('— 成员与席位 + 网页版托管 —');
{
  await boss.click('[data-act="cloud.team-refresh"]');
  await boss.waitForTimeout(900);
  const txt = await boss.evaluate(() => document.getElementById('view').textContent);
  ok(txt.includes('sales@x.com') && txt.includes('2 / '), '老板端成员卡：见 sales 成员 + 席位 2/N');
  ok(txt.includes('定价') && txt.includes('留人'), '板块授权徽章齐全');
  const web = await fetch(apiBase + '/');
  const html = await web.text();
  ok(web.status === 200 && /text\/html/.test(web.headers.get('content-type')) && html.includes('销冠操盘系统'),
    'GET / → 同一服务托管网页版（零安装入口）');
}

/* ═══ 会话失效自动回登录页 ═══ */
console.log('— 会话失效处理 —');
{
  await db.query(`update sessions set expires_at = now() - interval '1 second'`);
  await boss.evaluate(() => SK.actions['cloud.pull']());
  await boss.waitForTimeout(800);
  const backToLogin = await boss.evaluate(() => document.getElementById('cl-email') != null);
  ok(backToLogin, '会话过期 → 自动清令牌回登录界面（数据保留本地）');
}

/* 409(冲突推送)与 401(会话过期)是本场景故意触发的预期响应——Chromium 会把它们记为
   console 网络错误行，予以豁免；其余任何页面错误一律不放过 */
const EXPECTED = /Failed to load resource.*(409|401)/;
const bossReal = boss._errs.filter(e => !EXPECTED.test(e));
const salesReal = sales._errs.filter(e => !EXPECTED.test(e));
ok(bossReal.length === 0 && salesReal.length === 0, '两台设备全程零非预期页面错误',
  JSON.stringify([bossReal.slice(0, 3), salesReal.slice(0, 3)]));

await browser.close(); server.close();
console.log(failures ? `\n❌ ${failures} 项失败` : '\n✅ 云同步端到端（真 API + 真浏览器）全部通过');
process.exit(failures ? 1 : 0);
