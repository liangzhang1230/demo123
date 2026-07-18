import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

let failures = [];
const ok = (cond, name) => {
  if (cond) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name); failures.push(name); }
};
const fileUrl = f => 'file://' + fileURLToPath(new URL('../03_工具/' + f, import.meta.url));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

/* ———— 工具 1：30 天替代选项排班表 ———— */
console.log('— 30天替代选项排班表 —');
await page.goto(fileUrl('30天替代选项排班表.html'));
await page.waitForTimeout(200);
ok(errs.length === 0, '加载零错误');
ok((await page.locator('.week').count()) === 4, '四个周块');
ok((await page.locator('.task').count()) === 13, '默认 13 个任务格');

// 处境联动
ok(await page.locator('#gapAlert').isHidden(), '在职时不显示空窗警告');
await page.selectOption('#status', 'gap2');
ok(await page.locator('#gapAlert').isVisible(), '空窗时显示底067警告');
const w2a = await page.locator('.task', { hasText: '动作量周' }).textContent();
await page.locator('#hours').fill('20');
const w2after = await page.locator('.task', { hasText: '动作量周' }).textContent();
ok(w2a !== w2after && w2after.includes('30'), '小时数拉满后投递量联动为 30 份/周');
await page.locator('#ties').fill('0');
ok((await page.locator('.task', { hasText: '先把点头之交的名单列出来' }).count()) === 1, '点头之交为 0 时任务换成先列名单');
await page.locator('#ties').fill('8');

// 勾任务 → 筹码表
ok((await page.locator('#vt').textContent()) === '空手', '初始判定：空手');
const boxes = await page.locator('.task input').all();
for (let i = 0; i < 5; i++) await boxes[i].check();
ok((await page.locator('#vt').textContent()) === '有动静', '勾 5 格后：有动静');
for (let i = 5; i < 10; i++) await boxes[i].check();
ok((await page.locator('#vt').textContent()) === '有人选', '勾 10 格后：有人选');
await page.locator('#milestone').check();
ok((await page.locator('#vt').textContent()) === '有替代选项', '关键一格勾上：有替代选项');
ok((await page.locator('#vx').textContent()).includes('底126'), '终态判定引用底126松一口');

// 复制排班表
await page.locator('#copyBtn').click();
await page.waitForTimeout(100);
ok(await page.locator('#copied').isVisible(), '复制反馈出现');
// 输入变化后任务勾选保留
await page.locator('#hours').fill('10');
ok((await page.locator('.task input:checked').count()) === 10, '改输入后已勾任务保留');
const hs1 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hs1, '移动端无横向滚动');
await page.screenshot({ path: 'shot-tool-30d.png', fullPage: false });

/* ———— 工具 2：出单卡点诊断器 ———— */
console.log('— 出单卡点诊断器 —');
await page.goto(fileUrl('出单卡点诊断器.html'));
await page.waitForTimeout(200);
ok(errs.length === 0, '加载零错误');
ok((await page.locator('.stage').count()) === 6, '六个阶段');
ok((await page.locator('.q').count()) === 12, '十二格');
ok((await page.locator('#vt').textContent()) === '待判', '初始：待判');

// 判 11 格全绿 → 仍是待判
const qs = await page.locator('.q').all();
for (let i = 0; i < 11; i++) await qs[i].locator('.opt.g').click();
ok((await page.locator('#vt').textContent()) === '待判', '差一格仍是待判');
ok((await page.locator('#vx').textContent()).includes('还有 1 格'), '提示剩余格数');
// 第 12 格也绿 → 无主要卡点
await qs[11].locator('.opt.g').click();
ok((await page.locator('#vt').textContent()).includes('挑不出大毛病'), '全绿：动作挑不出大毛病');
ok((await page.locator('#vx').textContent()).includes('底007'), '全绿结论引用底007（别加倍殷勤）');
ok(await page.locator('#chop').isVisible(), '核定章出现');

// 把「问需求」两格判红 → 主要卡点=回炉重问，处方 2 条
await qs[2].locator('.opt.r').click();
await qs[3].locator('.opt.r').click();
ok((await page.locator('#vt').textContent()) === '回炉重问', '最大丢分段判定：回炉重问');
ok((await page.locator('.rx-item').count()) === 2, '处方只开给 2 个红格');
ok((await page.locator('.rx-item').first().textContent()).includes('底035'), '处方引用真实编号');
ok((await page.locator('#rank tr.worst').count()) === 1, '病灶排序标出主要卡点');
ok((await page.locator('#rank tr').first().textContent()).includes('问需求'), '丢分最多的排第一');
ok((await page.locator('#chopT').textContent()) === '问需求', '章面=卡点阶段名');

// 单名联动
await page.locator('#deal').fill('华东王总那单');
ok((await page.locator('#vx').textContent()).includes('华东王总那单'), '结论带单名');

// 三档互斥
await qs[0].locator('.opt.r').click();
const pressed = await qs[0].locator('.opt[aria-pressed="true"]').count();
ok(pressed === 1, '同格三档互斥');

// 键盘可达：Enter 触发判定
await qs[0].locator('.opt.g').focus();
await page.keyboard.press('Enter');
ok(await qs[0].locator('.opt.g').getAttribute('aria-pressed') === 'true', '键盘 Enter 可判定');

const hs2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hs2, '移动端无横向滚动');
await page.screenshot({ path: 'shot-tool-deal.png', fullPage: false });

// 桌面视口
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(150);
const hs3 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hs3, '桌面无横向滚动');

ok(errs.length === 0, '全程零控制台错误 ' + (errs.length ? JSON.stringify(errs) : ''));
await browser.close();
console.log(failures.length ? `\n❌ ${failures.length} 项失败:\n` + failures.map(f => ' - ' + f).join('\n') : '\n✅ 全部通过');
process.exit(failures.length ? 1 : 0);
