import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = 'file://' + path.join(__dirname, 'cards.html');

// 只改颜色，其它全部不动
const THEMES = {
  emerald: { name:'翡翠绿(原)', vars:{ '--acc':'#2FE0A0','--acc-rgb':'47,224,160','--acc-2':'#7DF3C8','--acc-deep':'#14a978','--ink-0':'#0A1613','--ink-1':'#0E201A','--rev':'#FF7A66','--rev-rgb':'255,122,102' } },
  azure:   { name:'青蓝',      vars:{ '--acc':'#37C7FF','--acc-rgb':'55,199,255','--acc-2':'#9FE4FF','--acc-deep':'#1385CC','--ink-0':'#0A1420','--ink-1':'#0D1E2E','--rev':'#FF8A5C','--rev-rgb':'255,138,92' } },
  violet:  { name:'靛紫',      vars:{ '--acc':'#A98BFF','--acc-rgb':'169,139,255','--acc-2':'#CDBBFF','--acc-deep':'#6E4FE0','--ink-0':'#100A1E','--ink-1':'#17102A','--rev':'#FF7DA0','--rev-rgb':'255,125,160' } },
  rose:    { name:'玫红',      vars:{ '--acc':'#FF5C8A','--acc-rgb':'255,92,138','--acc-2':'#FF9DBB','--acc-deep':'#D62E63','--ink-0':'#17090F','--ink-1':'#210E17','--rev':'#FFC24A','--rev-rgb':'255,194,74' } },
  amber:   { name:'琥珀金',    vars:{ '--acc':'#F5B13C','--acc-rgb':'245,177,60','--acc-2':'#FFD588','--acc-deep':'#C9861A','--ink-0':'#16110A','--ink-1':'#1E170D','--rev':'#FF6B5E','--rev-rgb':'255,107,94' } },
  teal:    { name:'蓝绿松石',  vars:{ '--acc':'#2FD9C8','--acc-rgb':'47,217,200','--acc-2':'#86F0E5','--acc-deep':'#149B90','--ink-0':'#08161A','--ink-1':'#0C2026','--rev':'#FF8A5C','--rev-rgb':'255,138,92' } },
};

const only = process.argv.slice(2); // 可指定主题名，默认全部

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(htmlPath, { waitUntil: 'networkidle' });
await page.waitForTimeout(200);

const names = only.length ? only : Object.keys(THEMES);
for (const key of names) {
  const t = THEMES[key];
  await page.evaluate((vars) => {
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  }, t.vars);
  await page.waitForTimeout(120);
  const cards = await page.$$('.card');
  for (let i = 0; i < cards.length; i++) {
    const n = String(i + 1).padStart(3, '0');
    const scrollH = await cards[i].evaluate(el => el.scrollHeight);
    await cards[i].screenshot({ path: path.join(__dirname, `theme-${key}-${n}.png`) });
    console.log(`${key.padEnd(8)} card ${n}: ${scrollH>1441?'⚠️ OVERFLOW '+scrollH:'ok'}`);
  }
}
await browser.close();
console.log('done');
