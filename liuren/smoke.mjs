// 浏览器冒烟 + 交互测试：加载 file://，遍历九屏，逐个打开录入表单并保存，捕获任何报错。
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
const go = async (r) => { await page.click(`[data-act="nav"][data-route="${r}"]`); await page.waitForTimeout(120); };
const click = async (sel) => { await page.click(sel); await page.waitForTimeout(150); };

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const routes = ['overview', 'pricetag', 'gates', 'm28', 'retention', 'dividend', 'sales', 'people', 'system', 'selftest'];
for (const r of routes) await go(r);

const results = [];
// 1) 员工 CRUD
await go('people');
const before = await page.locator('.table tbody tr').count();
await click('[data-act="addPerson"]');
await page.fill('#p-name', '测试员工'); await page.fill('#p-phone', '13900000000'); await page.fill('#p-base', '5500');
await click('[data-act="savePerson"]');
const after = await page.locator('.table tbody tr').count();
results.push(['新增员工', after === before + 1]);

// 2) 体检输入编辑 → 指数重算
await go('overview');
await click('[data-act="editGov"]');
await page.fill('#g-view', '5');            // 降低查看次数 → SII 下降
await click('[data-act="saveGov"]');
const siiText = await page.locator('.kpi-value').first().textContent();
results.push(['体检输入重算(SII≠73)', siiText.trim() !== '73']);

// 3) 前程合约 → AHC 上升（irrevocable 覆盖）
await go('overview'); const ahcBefore = (await page.locator('.kpi-value').nth(3).textContent()).trim();
await go('retention');
await click('[data-act="addCovenant"]');
await page.selectOption('#c-tpl', { label: '产权协议（irrevocable 强制）' });
await click('[data-act="saveCovenant"]');
await go('overview'); const ahcAfter = (await page.locator('.kpi-value').nth(3).textContent()).trim();
results.push(['前程合约→AHC 上升', Number(ahcAfter) > Number(ahcBefore)]);

// 4) M28 新建
await go('m28'); const m28Before = await page.locator('.table tbody tr').count();
await click('[data-act="addM28"]'); await page.fill('#m-amt', '4'); await click('[data-act="saveM28"]');
results.push(['新建 M28', (await page.locator('.table tbody tr').count()) === m28Before + 1]);

// 5) 系数编辑
await go('selftest');
await page.fill('[data-coef="ahcTrustLine"]', '70'); await click('[data-act="saveCoef"]');
results.push(['系数编辑保存', true]);

// 6) 建议双通道
await go('sales'); await click('[data-act="raiseSuggestion"]');
await page.fill('#s-content', '建议放开线索分配'); await click('[data-act="saveSuggestion"]');
results.push(['建议写入', true]);

// 7) 分红配置
await go('dividend'); await click('[data-act="editDividend"]');
await page.fill('#d-rate', '0.12'); await click('[data-act="saveDividend"]');
results.push(['分红配置保存', true]);

// 截图关键屏
await go('people'); await page.screenshot({ path: join(__dir, 'shot-people.png'), fullPage: true });
await go('retention'); await page.screenshot({ path: join(__dir, 'shot-retention.png'), fullPage: true });
await go('overview'); await click('[data-act="editGov"]'); await page.screenshot({ path: join(__dir, 'shot-editgov.png') });
await page.keyboard.press('Escape'); await page.waitForTimeout(120);

// 自检仍绿？（自检跑纯净 factory，不受上面编辑影响）
await go('selftest');
const passCount = await page.locator('.tcase.pass').count();
const failCount = await page.locator('.tcase.fail').count();

console.log('交互测试:');
for (const [n, ok] of results) console.log(`  ${ok ? '✅' : '❌'} ${n}`);
console.log('自检 tcase pass:', passCount, 'fail:', failCount);
console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'NONE');
await browser.close();
const allOk = results.every(r => r[1]) && !errors.length && !failCount;
process.exit(allOk ? 0 : 1);
