#!/usr/bin/env node
/* 边界校验：空库全站巡检 / 极端值 / 关键交互流 / NaN·undefined 扫描 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pwCandidates = ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'];
let chromium = null;
for (const c of pwCandidates) { try { ({ chromium } = await import(c)); break; } catch (e) {} }
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = 'file://' + join(root, 'dist', 'index.html');

let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(url); await page.waitForTimeout(500);

const routes = await page.evaluate(() =>
  SK.modules.flatMap(m => (m.subnav && m.subnav.length ? m.subnav.map(s => m.id + '/' + s.id) : [m.id])));

async function crawl(label) {
  let bad = 0;
  for (const r of routes) {
    const b = errs.length;
    await page.evaluate(hash => { location.hash = '#/' + hash; }, r);
    await page.waitForTimeout(80);
    const html = await page.$eval('#view', el => el.innerHTML);
    const hasNaN = /NaN|undefined万|¥undefined|undefined%|nullh|null 人/.test(html);
    const broken = html.includes('渲染出错') || errs.length > b || hasNaN;
    if (broken) { bad++; console.log(`    ✗ ${label} #/${r} ${hasNaN ? '含 NaN/undefined 上屏' : errs.slice(b).join('|').slice(0, 200)}`); }
  }
  ok(bad === 0, `${label}：${routes.length} 页无渲染错误/无 NaN·undefined 上屏`);
}

/* 1. 演示库巡检（NaN 扫描比 e2e 更严） */
console.log('— 演示库 NaN/undefined 扫描 —');
await crawl('演示库');

/* 2. 空库全站巡检 */
console.log('— 空库边界 —');
await page.evaluate(() => { SK.emptyDB(); SK.persist(); UI.render(); });
await page.waitForTimeout(200);
await crawl('空库');
const emptyDash = await page.evaluate(() => { location.hash = '#/dash'; UI.render(); return document.getElementById('view').innerHTML.length; });
ok(emptyDash > 300, '空库驾驶舱可用（引导态）');

/* 3. 极端值 */
console.log('— 极端值 —');
await page.evaluate(() => { SK.seedDemo(); SK.persist(); UI.render(); });
await page.waitForTimeout(200);
const extreme = await page.evaluate(() => {
  const out = [];
  const trials = [
    ['attritionRate', 0], ['attritionRate', 0.9], ['targetYearGrossWan', 0], ['targetYearGrossWan', 999999],
    ['lastYearPerCapitaWan', 0.01], ['hiringCycleDays', 365], ['blendedMarginRate', 0.01], ['targetPersonalMonthlyGrossWan', 0],
  ];
  for (const [k, v] of trials) {
    const old = SK.DB.company[k];
    SK.DB.company[k] = v; SK.xReset();
    try {
      const dj = SK.X('dingjia'), zr = SK.X('zhaoren'), sz = SK.X('suanzhang'), lr = SK.X('liuren'), yr = SK.X('yuren');
      const vals = JSON.stringify([dj && dj.total, zr && zr.trueHires, sz && sz.laborRoi, lr && lr.ahc, yr && yr.coachingDoseActual]);
      if (/NaN|Infinity/.test(vals)) out.push(`${k}=${v} → 派生含 NaN/Infinity: ${vals}`);
    } catch (e) { out.push(`${k}=${v} → 抛错 ${e.message}`); }
    SK.DB.company[k] = old;
  }
  SK.xReset();
  return out;
});
ok(extreme.length === 0, '8 组极端共享输入下五板块派生无 NaN/Infinity/抛错', JSON.stringify(extreme).slice(0, 300));

/* 4. 关键交互流（按动作注册表直接调用） */
console.log('— 关键交互流 —');
const flows = await page.evaluate(() => {
  const out = {};
  // 员工离职 → 余震可算
  const p = SK.DB.people.find(x => x.spId === 'sp_5');
  p.isActive = false; p.leaveDate = SK.today(); p.leaveReason = 'resign_other';
  SK.xReset();
  const lrOK = SK.X('liuren') != null;
  out.leave = lrOK && SK.activeSales().length === (SK.DB.people.filter(x => x.isActive && x.positionType === 'sales').length);
  p.isActive = true; p.leaveDate = null; p.leaveReason = null;
  // 派生人数联动：salesCount 进招人器
  const n0 = SK.activeSales().length;
  SK.DB.people.push({ spId: 'sp_tmp', name: '临时', phone: '13000000099', cityTier: 'tier1', level: 1, positionType: 'sales', hireDate: SK.today(), leaveDate: null, leaveReason: null, managerId: null, hireBatchId: null, sourceChannel: 'manual', baseSalaryAmt: 500000, hiringCostAmt: 1500000, isActive: true });
  SK.xReset();
  const zr = SK.X('zhaoren');
  out.headcount = SK.activeSales().length === n0 + 1 && zr != null;
  SK.DB.people = SK.DB.people.filter(x => x.spId !== 'sp_tmp');
  SK.xReset();
  // 系数覆盖 → 全站生效
  const t0 = SK.X('zhaoren').trueHires;
  SK.DB.coefOverrides['shared.midYearAttritionFactor'] = 0.9;
  SK.xReset();
  const t1 = SK.X('zhaoren').trueHires;
  delete SK.DB.coefOverrides['shared.midYearAttritionFactor'];
  SK.xReset();
  out.coef = t1 >= t0;
  // r 手工锁定
  SK.DB.company.rMode = 'manual'; SK.DB.company.rManual = 0.10;
  const rManual = SK.rRate();
  SK.DB.company.rMode = 'auto';
  out.rlock = Math.abs(rManual - 0.10) < 1e-9;
  return out;
});
ok(flows.leave, '离职登记：留人器/人数派生正常');
ok(flows.headcount, '新增员工 → 招人器现有人数实时 +1');
ok(flows.coef, '系数覆盖（流失折半 0.5→0.9）→ 该招人数不降反升，实时生效');
ok(flows.rlock, '提成率手工锁定模式生效');

/* 5. 数据绑定完整性：所有 data-bind path 可写回 DB */
console.log('— 数据绑定完整性 —');
const bindBad = await page.evaluate(() => {
  const bad = [];
  const routes2 = SK.modules.flatMap(m => (m.subnav && m.subnav.length ? m.subnav.map(s => [m.id, s.id]) : [[m.id, null]]));
  for (const [b, s] of routes2) {
    location.hash = '#/' + b + (s ? '/' + s : '');
    UI.render();
    document.querySelectorAll('#view [data-bind]').forEach(el => {
      const path = el.dataset.bind;
      if (path.startsWith('coef:')) return;
      const ks = path.split('.'); let o = SK.DB;
      for (let i = 0; i < ks.length - 1; i++) { o = o == null ? null : o[ks[i]]; }
      if (o == null || typeof o !== 'object') bad.push(`${b}/${s}: ${path}`);
    });
  }
  return [...new Set(bad)];
});
ok(bindBad.length === 0, '全部 data-bind 路径均指向真实 DB 容器', JSON.stringify(bindBad).slice(0, 300));

ok(errs.length === 0, '全程零 console 错误', errs.slice(0, 5).join('|').slice(0, 300));
await browser.close();
console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 边界校验全部通过');
process.exit(failures ? 1 : 0);
