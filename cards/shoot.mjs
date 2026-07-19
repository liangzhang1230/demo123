import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = 'file://' + path.join(__dirname, 'cards.html');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(htmlPath, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const cards = await page.$$('.card');
for (let i = 0; i < cards.length; i++) {
  const n = String(i + 1).padStart(3, '0');
  await cards[i].screenshot({ path: path.join(__dirname, `out-${n}.png`) });
  // report overflow: does content exceed 1440?
  const box = await cards[i].boundingBox();
  const scrollH = await cards[i].evaluate(el => el.scrollHeight);
  console.log(`card ${n}: box=${Math.round(box.height)} scrollH=${scrollH} ${scrollH>1441?'⚠️ OVERFLOW':'ok'}`);
}
await browser.close();
console.log('done');
