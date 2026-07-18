// 真实测试两份原件：Offer 折算器 + 体检评分器。
// 核心：不只测"能渲染"，而是在 Node 侧独立复算数字，与页面显示逐一比对——验证计算逻辑真的对。
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

let failures = [];
const ok = (cond, name) => {
  if (cond) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name); failures.push(name); }
};
const near = (a, b, name, tol = 1) => ok(Math.abs(a - b) <= tol, `${name}（页面 ${a} vs 复算 ${b}）`);
const fileUrl = f => 'file://' + fileURLToPath(new URL('../03_工具/' + f, import.meta.url));
const yen = s => Number(String(s).replace(/[^\d.-]/g, '')); // "¥122,670" → 122670

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

/* ============ Offer 真实价值折算器 ============ */
console.log('— Offer 真实价值折算器 —');
await page.goto(fileUrl('Offer真实价值折算器.html'));
await page.waitForTimeout(200);
ok(errs.length === 0, '加载零控制台错误');
ok((await page.locator('.tab').count()) === 3, '三个标签页 (A / B / 折价系数)');

// 独立复算：从页面读取所有输入，用与源码同一公式在 Node 侧算 felt，再比对页面显示
function calcExpected(inp) {
  const salary = inp.base * inp.months;
  const commReal = inp.comm * (inp.conf / 100);
  const nominal = inp.base * inp.months + inp.comm + inp.sign;
  const cash = salary + commReal + inp.sign;
  const dSched = -cash * (inp.kS / 100) * inp.sched;
  const dWfh = cash * (inp.kW / 100) * inp.wfh;
  const dSoc = -cash * (inp.kO / 100) * inp.soc;
  const hourly = cash / (250 * 8);
  const hours = inp.commute * 2 / 60 * 250;
  const dTime = -hours * hourly;
  const felt = cash + dSched + dWfh + dSoc + dTime;
  return { nominal, cash, felt };
}
async function readInputs(i) {
  return await page.evaluate(idx => {
    const n = id => { const e = document.getElementById(id); const v = e ? parseFloat(e.value) : 0; return isFinite(v) ? v : 0; };
    return {
      base: n('base' + idx), months: n('months' + idx), comm: n('comm' + idx), sign: n('sign' + idx),
      conf: n('conf' + idx), commute: n('commute' + idx),
      sched: parseFloat(document.getElementById('sched' + idx).value),
      wfh: parseFloat(document.getElementById('wfh' + idx).value),
      soc: parseFloat(document.getElementById('soc' + idx).value),
      kS: n('s_sched'), kW: n('s_wfh'), kO: n('s_soc')
    };
  }, i);
}

// 默认值下 A / B 体感年包
const bigs = await page.locator('.big').allTextContents();
const expA = calcExpected(await readInputs(0));
const expB = calcExpected(await readInputs(1));
near(yen(bigs[0]), Math.round(expA.felt), 'A 体感年包 = 独立复算');
near(yen(bigs[1]), Math.round(expB.felt), 'B 体感年包 = 独立复算');
// 手算兜底：默认 A felt 应为 122670，B 为 175000（防止源码与我理解的公式一起错）
near(Math.round(expA.felt), 122670, 'A 复算值 = 手算 122670', 0);
near(Math.round(expB.felt), 175000, 'B 复算值 = 手算 175000', 0);

// 名义年包
const strikes = await page.locator('.strike').allTextContents();
near(yen(strikes[0]), Math.round(expA.nominal), 'A 名义年包正确');
// 默认 gap<0（B 胜），核定章应显示 B 胜
ok((await page.locator('.chop').textContent()).includes('B 胜'), '默认场景核定章判 B 胜（体感 A<B）');

// 改提成兑现率滑块 → 体感年包应随之变化且仍等于复算
await page.locator('#conf0').fill('100');
await page.locator('#conf0').dispatchEvent('input');
await page.waitForTimeout(100);
const bigA2 = yen((await page.locator('.big').allTextContents())[0]);
const expA2 = calcExpected(await readInputs(0));
near(bigA2, Math.round(expA2.felt), '提成兑现率拉到100%后 A 体感年包重算正确');
ok(bigA2 > yen(bigs[0]), '兑现率↑ → 体感年包↑（方向正确）');

// 标签页切换到"折价系数"，改排班折价系数，验证联动
await page.locator('#tabS').click();
ok(await page.locator('#paneS').isVisible(), '点标签切到折价系数页');
await page.locator('#s_sched').fill('35');
await page.locator('#s_sched').dispatchEvent('input');
await page.waitForTimeout(100);
ok((await page.locator('#v_sched').textContent()) === '35%', '折价系数标签实时更新为 35%');

// 提成>固定工资时应触发风险旗标（默认 A: comm 12万 > salary 10.4万）
await page.locator('#tabA').click();
const flagsTxt = await page.locator('.flags').textContent();
ok(flagsTxt.includes('提成比固定工资还多') || flagsTxt.includes('风险几乎全推'), 'A 提成>固定工资 → 触发风险旗标');

// 键盘可达：Tab 键聚焦标签并回车切换
await page.locator('#tabB').focus();
await page.keyboard.press('Enter');
ok(await page.locator('#paneB').isVisible(), '键盘 Enter 可切标签页');

const hsO = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hsO, '移动端无横向滚动');
await page.screenshot({ path: 'shot-ref-offer.png' });

/* ============ 选公司体检评分器 ============ */
console.log('— 选公司体检评分器 —');
await page.goto(fileUrl('选公司体检评分器.html'));
await page.waitForTimeout(200);
ok(errs.length === 0, '加载零控制台错误');
ok((await page.locator('.item').count()) === 7, '七个检测项');
ok((await page.locator('.flag').count()) === 5, '五条一票否决项');

const WEIGHTS = [20, 15, 20, 15, 15, 10, 5];
ok(WEIGHTS.reduce((a, b) => a + b) === 100, '权重合计 100（满分自洽）');
const markVal = () => page.locator('#mark').getAttribute('data-v').then(Number);

// 待检态
ok((await page.locator('#vt').textContent()) === '待检', '初始：待检');

// 全绿 → 满分 100 → 可以去
for (const it of await page.locator('.item').all()) await it.locator('.opt.g').click();
near(await markVal(), 100, '七项全绿 = 满分 100');
ok((await page.locator('#vt').textContent()) === '可以去', '满分判定：可以去');

// 全红 → 0 分 → 别去
for (const it of await page.locator('.item').all()) await it.locator('.opt.r').click();
near(await markVal(), 0, '七项全红 = 0 分');
ok((await page.locator('#vt').textContent()) === '别去', '0分判定：别去');

// 混合分：项1黄(1/3*20=6.67→显示7) 其余全绿 → 100-20+6.67=86.67→round 87 → 仍"可以去"
const items = await page.locator('.item').all();
for (const it of items) await it.locator('.opt.g').click();
await items[0].locator('.opt.y').click();
const expMixed = Math.round(100 - 20 + (1 / 3 * 20));
near(await markVal(), expMixed, `混合分复算：项1改黄应为 ${expMixed} 分`);

// 构造中档分验证边界：全部选黄 → 每项 1/3*weight，总 100/3≈33.33→33 → 25<=s<50 "高风险"
for (const it of items) await it.locator('.opt.y').click();
near(await markVal(), Math.round(100 / 3), '七项全黄 ≈ 33 分');
ok((await page.locator('#vt').textContent()) === '高风险', '33分判定：高风险');

// 一票否决：先给一个可以去的高分，再勾一条否决项 → 分数不再作数
for (const it of items) await it.locator('.opt.g').click();
ok((await page.locator('#vt').textContent()) === '可以去', '勾否决前：可以去');
await page.locator('.flag input').first().check();
ok((await page.locator('#vt').textContent()) === '一票否决', '勾一票否决项 → 结论翻转为一票否决');
ok((await page.locator('#vx').textContent()).includes('不再作数'), '否决说明：分数不再作数');
// 取消否决 → 恢复
await page.locator('.flag input').first().uncheck();
ok((await page.locator('#vt').textContent()) === '可以去', '取消否决 → 恢复原判定');

// 公司名联动
await page.locator('#co').fill('某某科技');
await page.locator('.item').first().locator('.opt.g').click(); // 触发 render
ok((await page.locator('#vx').textContent()).includes('某某科技'), '结论带公司名');

// 键盘可达
await page.locator('.item').first().locator('.opt.r').focus();
await page.keyboard.press('Enter');
ok(await page.locator('.item').first().locator('.opt.r').getAttribute('aria-pressed') === 'true', '键盘 Enter 可选档');

const hsH = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hsH, '移动端无横向滚动');
await page.screenshot({ path: 'shot-ref-check.png' });

// 桌面视口无横向滚动
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(150);
const hsHd = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
ok(!hsHd, '桌面无横向滚动');

ok(errs.length === 0, '全程零控制台错误 ' + (errs.length ? JSON.stringify(errs) : ''));
await browser.close();
console.log(failures.length ? `\n❌ ${failures.length} 项失败:\n` + failures.map(f => ' - ' + f).join('\n') : '\n✅ 全部通过 — 两份原件全绿');
process.exit(failures.length ? 1 : 0);
