import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const FILE = 'file://' + fileURLToPath(new URL('../主控台.html', import.meta.url)) + '';
let failures = [];
const ok = (cond, name) => {
  if (cond) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name); failures.push(name); }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // 移动优先：iPhone 尺寸
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

console.log('— 加载与数据自检 —');
await page.goto(FILE);
await page.waitForTimeout(300);
ok(consoleErrors.length === 0, '零控制台错误 ' + (consoleErrors.length ? JSON.stringify(consoleErrors) : ''));
ok(!(await page.locator('#selfcheck').isVisible()), '数据守恒自检通过（无红色报警条）');
ok((await page.title()) === '销冠底牌 · 主控台', '页面标题正确');

console.log('— 总览数字 —');
const stats = await page.locator('.stat .v').allTextContents();
ok(stats[0].trim() === '127', '总条数 127');
ok(stats[1].trim() === '37', '已动用 37');
ok(stats[2].trim() === '90', '未动用 90');
ok(stats[3].includes('2'), '完成包 2/8');
ok((await page.locator('.pill-row').count()) === 8, '八柱各有一行');
const zhu5 = await page.locator('.pill-row').nth(4).textContent();
ok(zhu5.includes('1 / 31'), '柱五消耗 1/31（底105）: ' + zhu5.trim());

console.log('— 键盘导航（Linear 式） —');
await page.keyboard.press('2');
ok(await page.locator('#view-ammo').isVisible(), '按 2 切到弹药台账');
await page.keyboard.press('/');
ok(await page.locator('#q').evaluate(el => document.activeElement === el), '按 / 聚焦搜索框');

console.log('— 台账检索与过滤 —');
ok((await page.locator('.a-row').count()) === 127, '默认列出全部 127 条');
await page.locator('#q').fill('拒绝');
await page.waitForTimeout(100);
const nSearch = await page.locator('.a-row').count();
ok(nSearch >= 4 && nSearch < 127, '搜索「拒绝」得到 ' + nSearch + ' 条');
await page.keyboard.press('Escape'); // blur
await page.keyboard.press('Escape'); // clear query
await page.waitForTimeout(100);
ok((await page.locator('.a-row').count()) === 127, 'Esc 清空搜索恢复 127 条');
await page.locator('#chipsP .chip', { hasText: '柱五' }).click();
await page.locator('#chipsU .chip', { hasText: '未动用' }).click();
await page.waitForTimeout(100);
ok((await page.locator('.a-row').count()) === 30, '柱五+未动用 = 30 条（出单包弹药）');
// 空一句话条目的呈现（底071/底099）
await page.locator('#chipsP .chip', { hasText: '柱四' }).click();
await page.locator('#chipsU .chip', { hasText: '全部' }).first().click();
await page.waitForTimeout(100);
ok((await page.locator('.a-row .missing').count()) === 2, '底071/底099 缺一句话如实标注（不编造）');

console.log('— 选弹 → 工单 —');
await page.locator('.a-row[data-id=底021]').click();
await page.locator('.a-row[data-id=底086]').click();
ok(await page.locator('#cartbar').isVisible(), '选中后出现工单栏');
ok((await page.locator('#cartN').textContent()) === '2', '计数 = 2');
await page.locator('#cartGo').click();
const orderText = await page.locator('#dlgPre').textContent();
ok(orderText.includes('底021') && orderText.includes('底086'), '工单包含所选编号');
ok(orderText.includes('逐字复制'), '工单带铁律提示');
ok(orderText.includes('复用 2 条'), '复用统计正确（两条均已用于谈判包）');
await page.locator('#dlgClose').click();

console.log('— 验收台：自动扫描 —');
await page.keyboard.press('4');
await page.locator('#scanDemo').click();
await page.locator('#scanBtn').click();
const scanOut = await page.locator('#scanOut').textContent();
ok(scanOut.includes('未通过'), '示例判为未通过');
ok(scanOut.includes('底111'), '拦下停用号 底111');
ok(/第1行.*五大/.test(scanOut) || scanOut.includes('五大维度'), '拦下凑数结构「五大维度」');
ok(scanOut.includes('研究表明'), '拦下无主语引用');
ok(scanOut.includes('三天开单'), '拦下禁用套路「三天开单」');
const bannedHit = ['底层逻辑', '打法', '闭环'].every(w => scanOut.includes(w));
ok(bannedHit, '拦下禁用词（底层逻辑/打法/闭环）');
// 干净文本应通过
await page.locator('#scanIn').fill('✅ 报价别报整数：报¥4980，对方还的幅度反而更小（底021）。');
await page.locator('#scanBtn').click();
const cleanOut = await page.locator('#scanOut').textContent();
ok(cleanOut.includes('字面检查全部通过'), '干净文本判为通过');

console.log('— 验收台：十二项清单 + 持久化 —');
ok((await page.locator('.ck-item input').count()) === 12, '清单共 12 项');
ok((await page.locator('#verdict').textContent()).includes('0 / 12'), '初始 0/12 不许交付');
await page.locator('#deliverName').fill('出单包_v1.0.md');
for (const cb of await page.locator('.ck-item input').all()) await cb.check();
ok((await page.locator('#verdict').textContent()).includes('12 / 12'), '勾满 12/12 判可交付');
await page.locator('#ckReport').click();
const report = await page.locator('#dlgPre').textContent();
ok(report.includes('出单包_v1.0.md') && report.includes('12 / 12'), '验收报告含交付物名与结果');
await page.locator('#dlgClose').click();
await page.reload();
await page.waitForTimeout(300);
await page.keyboard.press('4');
ok((await page.locator('.ck-item input:checked').count()) === 12, '刷新后清单勾选持久（localStorage）');
ok((await page.locator('#deliverName').inputValue()) === '出单包_v1.0.md', '交付物名持久');
await page.keyboard.press('2');
ok((await page.locator('#cartN').textContent()) === '2', '刷新后选弹持久');

await page.keyboard.press("4");
await page.locator("#ckReset").click();
await page.waitForTimeout(100);
ok((await page.locator("#verdict").textContent()).includes("0 / 12"), "清零后 0/12");
await page.locator(".ck-item input").first().check();
ok((await page.locator("#verdict").textContent()).includes("1 / 12"), "重渲染后勾选仍正常计数 1/12");
await page.locator("#ckReset").click();
await page.waitForTimeout(100);
console.log('— 其余视图渲染 —');
await page.keyboard.press('3');
ok((await page.locator('#view-products .pack').count()) === 8, '产品线 8 个包');
ok((await page.locator('#view-products').textContent()).includes('99 单包 / 168 双包'), '合售建议在位');
await page.keyboard.press('5');
ok((await page.locator('#view-spec details').count()) === 7, '规范速查 7 节');
await page.locator('#view-spec details').nth(4).click();
await page.locator('#copyLaw').click(); // 剪贴板在 headless file:// 下走 fallback，不应报错
await page.keyboard.press('6');
ok((await page.locator('#view-history tbody tr').count()) === 7, '版本历史 7 行');

console.log('— 数据完整性（页面内核对） —');
const integrity = await page.evaluate(() => {
  const ids = ALL.map(a => a.id);
  return {
    total: ALL.length,
    used: ALL.filter(a => a.u > 0).length,
    dup: ids.length !== new Set(ids).size,
    stopped: ['底108','底111','底112'].some(s => ids.includes(s)),
    range: ids.every(id => { const n = +id.slice(1); return n >= 1 && n <= 130; }),
    overlapAll3: ["底004","底053","底067","底080","底099","底121","底122","底126","底128"].every(id => ALL.find(a => a.id === id)?.u === 3)
  };
});
ok(integrity.total === 127 && integrity.used === 37, '127 条 / 37 已用');
ok(!integrity.dup, '编号无重复');
ok(!integrity.stopped, '停用号未混入');
ok(integrity.range, '编号全部落在 底001–底130');
ok(integrity.overlapAll3, '9 条重叠条目全部标注双包共用');

console.log('— 桌面视口 + 截图 —');
await page.setViewportSize({ width: 1280, height: 900 });
await page.keyboard.press('1');
await page.waitForTimeout(200);
const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hScroll, '桌面无横向滚动');
await page.screenshot({ path: 'shot-desktop.png' });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const hScrollM = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hScrollM, '移动端无横向滚动');
await page.keyboard.press('2');
await page.waitForTimeout(200);
await page.screenshot({ path: 'shot-mobile.png' });

ok(consoleErrors.length === 0, '全程零控制台错误/页面异常');
await browser.close();
console.log(failures.length ? `\n❌ ${failures.length} 项失败:\n` + failures.map(f => ' - ' + f).join('\n') : '\n✅ 全部通过');
process.exit(failures.length ? 1 : 0);
