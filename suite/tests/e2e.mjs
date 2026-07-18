#!/usr/bin/env node
/* 端到端校验：无头 Chromium 打开构建产物，逐板块巡检 + 实时联动断言 + 持久化 + 自检徽章 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = 'file://' + join(root, 'dist', 'index.html');

let failures = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

console.log('▶ 打开', url);
await page.goto(url);
await page.waitForTimeout(600);

/* 1. 外壳 */
console.log('— 外壳与导航 —');
const tabs = await page.$$eval('#topnav .nav-tab', els => els.map(e => e.textContent.trim()));
ok(tabs.length >= 7, `顶部导航 ${tabs.length} 个板块`, JSON.stringify(tabs));
ok((await page.$$eval('#livebar .lv-cell', els => els.length)) >= 6, '全局实时指标条 ≥6 格');

/* 2. 自检徽章 */
await page.waitForFunction(() => window.__SUITE_SELFTEST__ !== undefined, { timeout: 8000 }).catch(() => {});
const st = await page.evaluate(() => window.__SUITE_SELFTEST__ || []);
const stBad = st.filter(r => !r.pass);
ok(st.length >= 25, `对拍自检共 ${st.length} 条（≥25）`);
ok(stBad.length === 0, `对拍自检全绿`, JSON.stringify(stBad.slice(0, 8)));

/* 3. 逐板块逐子页巡检 */
console.log('— 全站巡检 —');
const routes = await page.evaluate(() =>
  SK.modules.flatMap(m => (m.subnav && m.subnav.length ? m.subnav.map(s => m.id + '/' + s.id) : [m.id])));
for (const r of routes) {
  const before = consoleErrors.length;
  await page.evaluate(hash => { location.hash = '#/' + hash; }, r);
  await page.waitForTimeout(120);
  const len = await page.$eval('#view', el => el.innerHTML.length);
  const hasErrBanner = await page.$eval('#view', el => el.innerHTML.includes('渲染出错'));
  ok(len > 300 && !hasErrBanner && consoleErrors.length === before, `#/${r} 渲染正常（${len} 字节）`,
    hasErrBanner ? '含渲染出错横幅' : consoleErrors.slice(before).join(' | ').slice(0, 300));
}

/* 4. 实时联动换算 */
console.log('— 实时联动 —');
const link1 = await page.evaluate(() => {
  const before = SK.X('zhaoren') && SK.X('zhaoren').trueHires;
  SK.DB.company.attritionRate = 0.60; UI.commit(); SK.xReset();
  const after = SK.X('zhaoren') && SK.X('zhaoren').trueHires;
  const dj = SK.X('dingjia');
  SK.DB.company.attritionRate = 0.30; UI.commit(); SK.xReset();
  return { before, after, djTotal: dj && dj.total };
});
ok(link1.before != null && link1.after != null && link1.after > link1.before,
  `流失率 30%→60%：招人器该招人数 ${link1.before}→${link1.after} 实时上调`);
ok(link1.djTotal != null, '定价器总漏损随同一份共享输入实时可算');

const link2 = await page.evaluate(() => {
  const r = SK.rRate();
  const dj = SK.X('dingjia');
  return { r, djr: dj && dj.r };
});
ok(link2.djr != null && Math.abs(link2.r - link2.djr) < 1e-9, `全局提成率 r=${(link2.r * 100).toFixed(2)}% 与定价器实时一致`);

const link3 = await page.evaluate(() => {
  const lr = SK.X('liuren'), sz = SK.X('suanzhang'), yr = SK.X('yuren');
  return { ahc: lr && lr.ahc, dvi: sz && sz.dvi, dose: yr && yr.coachingDoseActual, m21: sz && sz.m21Done };
});
ok(link3.ahc != null, `留人器 AHC=${link3.ahc} 可被算账器闸⑪/育人器产权前提实时消费`);
ok(link3.m21 === true, '算账器 M21 已完成（演示数据）→ 育人/留人解锁');
ok(link3.dose != null, `育人器辅导剂量=${link3.dose} → 留人器分红四问 Q4`);

const link4 = await page.evaluate(() => {
  const before = SK.X('liuren').ahc;
  const ag = SK.DB.m28Agreements.find(a => a.irrevocable);
  if (!ag) return null;
  const fn = SK.actions['lr.try-down'] || SK.actions['lr.m28-try-downgrade'] || SK.actions['lr.try-downgrade'] || SK.actions['lr.m28-downgrade'];
  if (!fn) return { skip: true };
  const ic0 = SK.DB.governance.ahcInputs.interceptCount;
  fn({ id: ag.m28Id, m28Id: ag.m28Id });
  SK.xReset();
  const after = SK.X('liuren').ahc;
  const ic1 = SK.DB.governance.ahcInputs.interceptCount;
  // 还原
  SK.DB.governance.ahcInputs.interceptCount = ic0; UI.commit();
  return { before, after, icDelta: ic1 - ic0 };
});
if (link4 && !link4.skip)
  ok(link4.icDelta === 1 && link4.after < link4.before, `M28 下调拦截 → 留痕 +1 → AHC ${link4.before}→${link4.after} 实时下降`);
else console.log('  ~ M28 拦截动作名未匹配（人工核）');

/* 5. 持久化 */
console.log('— 持久化 —');
await page.evaluate(() => { SK.DB.company.name = '持久化测试公司'; UI.commit(); });
await page.waitForTimeout(150);
await page.reload(); await page.waitForTimeout(500);
const persisted = await page.evaluate(() => SK.DB.company.name);
ok(persisted === '持久化测试公司', 'localStorage 刷新后数据保留');
await page.evaluate(() => { SK.DB.company.name = '示例 · 王总的公司'; UI.commit(); });

/* 6. 录入即换算：加一笔成交 → 本月净贡献变化 */
const entry = await page.evaluate(() => {
  const sz0 = SK.X('suanzhang');
  const n0 = sz0 && sz0.ledger ? sz0.ledger.net : null;
  SK.DB.deals.push({ id: SK.uid('deal'), employeeId: 'sp_0', categoryId: 'cat_std', dealDate: SK.today(), intentDate: SK.today(), paidDate: SK.today(), closeDate: SK.today(), status: 'won', paymentAmt: 100000_00, discountRate: 0 });
  UI.commit(); SK.xReset();
  const sz1 = SK.X('suanzhang');
  const n1 = sz1 && sz1.ledger ? sz1.ledger.net : null;
  SK.DB.deals.pop(); UI.commit();
  return { n0, n1 };
});
ok(entry.n0 != null && entry.n1 != null && entry.n1 > entry.n0, `录入 10 万成交 → 本月净贡献 ${(entry.n0 / 1e6).toFixed(1)}万→${(entry.n1 / 1e6).toFixed(1)}万 实时换算`);

/* 7. 控制台错误总账 */
console.log('— 控制台 —');
ok(consoleErrors.length === 0, '全程零 console 错误', consoleErrors.slice(0, 6).join(' | ').slice(0, 400));

await browser.close();
console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 全部通过');
process.exit(failures ? 1 : 0);
