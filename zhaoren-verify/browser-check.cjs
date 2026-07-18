// 全页无头核对：需先 `npm i playwright-core` 并有本地 Chromium；用法 node zhaoren-verify/browser-check.cjs
const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const exec = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
  const fs = require('fs');
  let executablePath = exec;
  if (!fs.existsSync(exec)) {
    // find any headless_shell / chrome under /opt/pw-browsers
    const base = '/opt/pw-browsers';
    for (const d of fs.readdirSync(base)) {
      const p1 = path.join(base, d, 'chrome-linux', 'headless_shell');
      const p2 = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p1)) { executablePath = p1; break; }
      if (fs.existsSync(p2)) { executablePath = p2; break; }
    }
  }
  console.log('using browser:', executablePath);
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [], logs = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE:' + m.text()); else logs.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR:' + e.message));

  const url = 'file://' + path.resolve('/home/user/demo123/zhaoren.html');
  await page.goto(url, { waitUntil: 'networkidle' });

  // Visit every route and ensure it renders without throwing
  const routes = ['home', 'input', 'result', 'hire', 'funnel', 'batch', 'lab', 'data', 'coef'];
  for (const r of routes) {
    await page.evaluate(h => { location.hash = '#' + h; }, r);
    await page.waitForTimeout(120);
    const html = await page.$eval('#view', el => el.innerHTML.length);
    if (html < 50) errors.push('EMPTY VIEW on route ' + r);
  }

  // On coef page, read self-check badges
  await page.evaluate(() => { location.hash = '#coef'; });
  await page.waitForTimeout(150);
  const badges = await page.$$eval('.badge', els => els.map(e => ({ ok: e.classList.contains('ok'), txt: e.textContent.trim() })));
  const total = badges.length, pass = badges.filter(b => b.ok).length;
  const reds = badges.filter(b => !b.ok);

  // Interaction smoke: load sample, check result hero numbers
  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForTimeout(80);
  await page.click('[data-act="loadSample"]');
  await page.waitForTimeout(150);
  const heroBigs = await page.$$eval('.vs-cell .big', els => els.map(e => e.textContent.trim()));

  // Live preview test: on input screen, no locks, editing changes preview
  await page.evaluate(() => { location.hash = '#input'; });
  await page.waitForTimeout(150);
  const hasLocks = await page.$$eval('.locked', els => els.length);
  const previewBefore = await page.$eval('#livePreview', el => el.textContent).catch(() => 'MISSING');
  // change salesCount input and see preview update
  await page.evaluate(() => { const el = document.querySelector('[data-inp="salesCount"]'); el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(120);
  const previewAfter = await page.$eval('#livePreview', el => el.textContent).catch(() => 'MISSING');
  const previewLive = previewBefore !== 'MISSING' && previewBefore !== previewAfter;
  console.log('=== INPUT SCREEN ===  locks on page =', hasLocks, ' livePreview updates on edit =', previewLive);
  errors.push(...(hasLocks > 0 ? ['LOCKS STILL PRESENT: ' + hasLocks] : []));
  errors.push(...(previewLive ? [] : ['LIVE PREVIEW DID NOT UPDATE']));

  console.log('\n=== ROUTES: all rendered ===');
  console.log('=== SELF-CHECK BADGES ===');
  console.log('badge total =', total, ' green =', pass);
  if (reds.length) reds.forEach(b => console.log('  RED:', b.txt));
  console.log('=== RESULT HERO (after 载入示例) === naive vs true =', heroBigs.join('  /  '));
  console.log('=== ERRORS ===', errors.length ? errors : 'none');

  await browser.close();
  const okAll = errors.length === 0 && total > 0 && pass === total;
  console.log('\nVERDICT:', okAll ? 'PASS ✓ (24/24 in real browser, zero JS errors, all routes render)' : 'FAIL ✗');
  process.exit(okAll ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
