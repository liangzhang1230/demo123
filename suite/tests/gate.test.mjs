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

/* ⑤ 平台管理后台：标准开户流程（平台建租户+指定老板 → 老板注册即接管） */
console.log('— 平台管理后台（标准开户流程） —');
const viewText = () => page.evaluate(() => (document.getElementById('view') || {}).textContent || '');
{
  // 注册平台账号 + 直插 platform_admins（生产由 PLATFORM_ADMIN_EMAIL 启动注入）
  const reg = await fetch(base + '/v1/auth/register', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@t.cn', password: 'adminPw88' }) }).then(r => r.json());
  await db.query(`insert into platform_admins(user_id, note) values ($1, 'test')`, [reg.userId]);

  await page.fill('#cl-email', 'admin@t.cn'); await page.fill('#cl-pass', 'adminPw88');
  await page.click('[data-act="cloud.login"]');
  await page.waitForTimeout(1600);                      // 登录 + 平台探测 + 面板首拉
  const vt = await viewText();
  const adm = await page.evaluate(() => ({
    noCreateTeam: !document.querySelector('#cl-tname'),
    gated: document.body.classList.contains('gated'),
    hasProvision: !!document.querySelector('#pt-name') && !!document.querySelector('#pt-email'),
    hasReset: !!document.querySelector('#pr-email'),
  }));
  ok(/平台管理后台/.test(vt) && adm.noCreateTeam, '平台管理员登录 → 管理后台（无"创建团队"页）');
  ok(adm.gated, '业务应用仍隐藏（管理员不进业务界面）');
  ok(adm.hasProvision && adm.hasReset, '面板含 开户(公司名+老板邮箱) + 重置密码 区块');
  ok(/闸测试公司/.test(vt), '租户概览列出已有租户（闸测试公司）');

  // 开户：创建"甲方建材公司"+老板邮箱 → 待注册
  await page.fill('#pt-name', '甲方建材公司'); await page.fill('#pt-email', 'newboss@t.cn'); await page.fill('#pt-note', '年付7800');
  await page.click('[data-act="plat.tenant-add"]'); await page.waitForTimeout(1000);
  const vt2 = await viewText();
  ok(/甲方建材公司/.test(vt2) && /newboss@t\.cn/.test(vt2) && /待注册/.test(vt2), '开户 → 列表显示 公司+老板邮箱+待注册');

  // 老板注册 → 自动接管该租户（boss 角色 + 公司名是平台起的）
  const bossReg = await fetch(base + '/v1/auth/register', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'newboss@t.cn', password: 'bossPw888' }) }).then(r => r.json());
  ok(bossReg.joinedTenant && bossReg.joinedTenant.role === 'boss', '老板注册 → 自动接管（角色 boss，零手动建团队）');
  const me = await fetch(base + '/v1/me', { headers: { authorization: `Bearer ${bossReg.token}` } }).then(r => r.json());
  ok(me.memberships[0].tenant_name === '甲方建材公司', '老板 whoami → 公司名=平台开户时起的名');

  await page.click('[data-act="plat.refresh"]'); await page.waitForTimeout(900);
  ok(/已接管/.test(await viewText()), '管理员刷新 → 开户状态转已接管');

  // 撤销开户：再开一个空户 → 撤销 → 消失；已接管的不可删（无撤销按钮）
  await page.fill('#pt-name', '误开户公司'); await page.fill('#pt-email', 'oops@t.cn');
  await page.click('[data-act="plat.tenant-add"]'); await page.waitForTimeout(900);
  await page.evaluate(() => { const btns = [...document.querySelectorAll('[data-act="plat.invite-del"]')]; btns[0] && btns[0].click(); });
  await page.waitForTimeout(900);
  ok(!/误开户公司/.test(await viewText()), '撤销未注册开户 → 租户级联清除');

  // 重置密码：对 gate@t.cn 重置 → 弹临时密码
  await page.fill('#pr-email', 'gate@t.cn');
  await page.click('[data-act="plat.reset"]'); await page.waitForTimeout(1200);
  const temp = await page.evaluate(() => {
    const el = document.querySelector('#modal-root .hero'); return el ? el.textContent.trim() : null;
  });
  ok(temp && /^[A-Z0-9]{8}$/.test(temp), `重置客户密码 → 弹出 8 位临时密码(${temp})`);
  await page.click('[data-act="ui.modal-close"]');

  const opsBtn = await page.evaluate(() => !!document.querySelector('[data-act="plat.tenant-status"]'));
  ok(opsBtn, '租户行带停机/复通操作');

  // 退出 → 回登录闸（只看 #view，避免 script 源码文本误判）
  await page.evaluate(() => { document.querySelector('[data-act="cloud.logout"]').click(); });
  await page.waitForTimeout(900);
  const out = await page.evaluate(() => !!document.querySelector('[data-act="cloud.login"]'));
  ok(out && !/平台管理后台/.test(await viewText()), '管理员退出 → 回登录闸');
}

ok(errs.length === 0, '全程零页面错误', JSON.stringify(errs.slice(0, 3)));

await browser.close(); server.close();
console.log(failures ? `\n❌ ${failures} 条未过` : '\n✅ 登录闸验收全绿');
process.exit(failures ? 1 : 0);
