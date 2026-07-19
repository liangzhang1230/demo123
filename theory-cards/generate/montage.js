const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const dataUri = n => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, n)).toString('base64');
const items = [
  { img: 'card_020_wine.png',  label: '酒红（现方案）', hex: '#9B2D2A' },
  { img: 'card_020_blue.png',  label: '深蓝', hex: '#1F5090' },
  { img: 'card_020_green.png', label: '墨绿', hex: '#1F6B4C' },
];
const cell = items.map(it => `
  <div class="col">
    <div class="lab"><i style="background:${it.hex}"></i>柱F 晋升 · ${it.label}</div>
    <img src="${dataUri(it.img)}">
  </div>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  body{background:#2b2b2b;padding:40px;font-family:'Noto Sans CJK SC',sans-serif;}
  .row{display:flex;gap:32px;align-items:flex-start;}
  .col{width:720px;}
  .lab{color:#fff;font-size:30px;font-weight:800;margin-bottom:16px;display:flex;align-items:center;gap:14px;}
  .lab i{width:34px;height:34px;border-radius:8px;display:inline-block;}
  img{width:720px;height:auto;display:block;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5);}
</style></head><body><div class="row">${cell}</div></body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 2400, height: 1700 }, deviceScaleFactor: 1.5 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  const row = await p.$('.row');
  await row.screenshot({ path: path.join(__dirname, 'compare_F_colors.png') });
  await b.close();
  console.log('wrote compare_F_colors.png');
})();
