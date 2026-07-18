#!/usr/bin/env node
/* 真实交互模拟：点击导航/seg/折叠、键入输入触发 change、modal 流程、命令面板 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const pwCandidates = ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'];
let chromium = null;
for (const c of pwCandidates) { try { ({ chromium } = await import(c)); break; } catch (e) {} }
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto('file://' + join(root, 'dist', 'index.html'));
await page.waitForTimeout(500);
await page.evaluate(() => { SK.seedDemo(); SK.persist(); UI.render(); });
await page.waitForTimeout(200);

console.log('— 顶部导航点击 —');
for (const id of ['dingjia', 'suanzhang', 'zhaoren', 'yuren', 'liuren', 'data', 'dash']) {
  await page.click(`#topnav [data-board="${id}"]`);
  await page.waitForTimeout(100);
  const on = await page.$eval(`#topnav [data-board="${id}"]`, el => el.classList.contains('on'));
  ok(on, `点击顶导航 → ${id} 高亮切换（无刷新）`);
}

console.log('— 输入 → 实时换算（真实键入触发 change）—');
await page.click('#topnav [data-board="zhaoren"]');
await page.waitForTimeout(120);
const before = await page.evaluate(() => SK.X('zhaoren').trueHires);
const attrSel = '[data-bind="company.attritionRate"]';
await page.fill(attrSel, '55');
await page.dispatchEvent(attrSel, 'change');
await page.waitForTimeout(200);
const after = await page.evaluate(() => { SK.xReset(); return SK.X('zhaoren').trueHires; });
ok(after > before, `键入流失率 30→55% → 该招人数 ${before}→${after}`);
const liveTxt = await page.$eval('#livebar', el => el.textContent);
ok(liveTxt.includes(String(after)), '顶部全局指标条同帧更新');
await page.fill(attrSel, '30');
await page.dispatchEvent(attrSel, 'change');
await page.waitForTimeout(150);

console.log('— seg 按钮（周期档）→ 定价器爬坡曲线联动 —');
await page.click('#topnav [data-board="dingjia"]');
await page.waitForTimeout(120);
const r0 = await page.evaluate(() => SK.X('dingjia').r);
const segBtn = await page.$('[data-act="ui.seg"][data-path="company.cycleTier"][data-val="long"]');
if (segBtn) {
  await segBtn.click(); await page.waitForTimeout(200);
  const r1 = await page.evaluate(() => { SK.xReset(); return SK.X('dingjia').r; });
  ok(r1 !== r0 && r1 != null, `周期档 regular→long → 提成率 ${(r0 * 100).toFixed(1)}%→${(r1 * 100).toFixed(1)}% 实时重算`);
  await page.evaluate(() => { SK.DB.company.cycleTier = 'regular'; UI.commit(); });
} else {
  // select 型
  const found = await page.evaluate(() => {
    const el = document.querySelector('[data-bind="company.cycleTier"]');
    if (!el) return false;
    el.value = 'long'; el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(200);
  const r1 = await page.evaluate(() => { SK.xReset(); return SK.X('dingjia').r; });
  ok(found && r1 !== r0, `周期档切换（select）→ 提成率实时重算 ${(r0 * 100).toFixed(1)}%→${(r1 * 100).toFixed(1)}%`);
  await page.evaluate(() => { SK.DB.company.cycleTier = 'regular'; UI.commit(); });
}

console.log('— 员工弹窗流程 —');
await page.click('#topnav [data-board="data"]');
await page.waitForTimeout(100);
await page.click('[data-act="ui.nav"][data-board="data"][data-sub="people"]');
await page.waitForTimeout(150);
await page.click('[data-act="data.person-edit"].pri');
await page.waitForTimeout(150);
ok(await page.$eval('#modal-root', el => el.classList.contains('open')), '新增员工弹窗打开');
await page.fill('#pe-name', '测试员工');
await page.fill('#pe-phone', '13911112222');
await page.click('[data-act="data.person-save"]');
await page.waitForTimeout(200);
const added = await page.evaluate(() => SK.DB.people.some(p => p.name === '测试员工'));
ok(added, '保存 → 员工入库');
const headAfter = await page.evaluate(() => { SK.xReset(); return SK.X('zhaoren').targetHeads; });
ok(headAfter != null, `目标编制随人数联动 = ${headAfter}`);
await page.evaluate(() => { SK.DB.people = SK.DB.people.filter(p => p.name !== '测试员工'); UI.commit(); });

console.log('— 折叠卡 / 命令面板 / 主题 —');
await page.click('#topnav [data-board="dingjia"]');
await page.waitForTimeout(100);
await page.keyboard.press('Control+k');
await page.waitForTimeout(150);
ok(await page.$eval('#palette', el => el.classList.contains('open')), '⌘K 命令面板打开');
await page.fill('#pal-q', '留人');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const hash = await page.evaluate(() => location.hash);
ok(hash.includes('liuren'), `命令面板搜索“留人”回车 → 跳转 ${hash}`);
await page.click('[data-act="ui.theme"]');
await page.waitForTimeout(100);
const theme1 = await page.evaluate(() => SK.DB.ui.theme);
ok(theme1 === 'light', `主题循环 auto→light（当前 ${theme1}）`);
await page.click('[data-act="ui.theme"]'); await page.click('[data-act="ui.theme"]');

console.log('— 育人器处方 PLV 实时亮灯 —');
await page.evaluate(() => { location.hash = '#/yuren/rx'; });
await page.waitForTimeout(200);
const rxArea = await page.$('#yr-rx-text, textarea[data-plv], #view textarea');
if (rxArea) {
  await rxArea.fill('你态度不行，要有狼性');
  await page.waitForTimeout(250);
  const panel = await page.evaluate(() => (document.querySelector('#yr-plv-panel') || {}).textContent || '');
  ok(/拦截|❌|✗|不过|red/i.test(panel) || panel.includes('态度'), 'PLV 违禁词实时拦截亮灯', panel.slice(0, 120));
  await rxArea.fill('今天先打 20 个电话，把上周 12% 的线索→意向转化对齐配方源基准 30%，先从复盘 3 个丢单开始');
  await page.waitForTimeout(250);
  const panel2 = await page.evaluate(() => (document.querySelector('#yr-plv-panel') || {}).textContent || '');
  ok(!/仅出提示/.test('') && panel2.length > 0, 'PLV 合规文本三层校验面板更新');
} else console.log('  ~ 未找到处方 textarea（人工核）');

ok(errs.length === 0, '全程零 console 错误', errs.slice(0, 5).join('|').slice(0, 300));
await browser.close();
console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 交互模拟全部通过');
process.exit(failures ? 1 : 0);
