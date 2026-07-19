const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const dataUri = n => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, n)).toString('base64');
const BATCHES = {
  '1': ['001','002','003','004','005','006','007','008','009','010'],
  '2': ['011','012','013','014','015','016','017','018','019','020'],
  '3': ['021','022','023','024','025','026','027','028','029','030'],
};
const nos = BATCHES[process.env.BATCH || '1'];
const pillar = { '001':'A','002':'A','003':'A','004':'A','005':'A','006':'B','007':'B','008':'B','009':'C','010':'C',
  '011':'C','012':'C','013':'D','014':'D','015':'D','016':'E','017':'E','018':'E','019':'E','020':'F',
  '021':'F','022':'G','023':'G','024':'H','025':'H','026':'I','027':'I','028':'I','029':'I','030':'A' };
const cells = nos.map(n => `
  <div class="col">
    <div class="lab">NO.${n} · 柱${pillar[n]}</div>
    <img src="${dataUri('card_'+n+'.png')}">
  </div>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
 *{margin:0;box-sizing:border-box}
 body{background:#232323;padding:44px;font-family:'Noto Sans CJK SC',sans-serif;}
 .grid{display:grid;grid-template-columns:repeat(5,560px);gap:36px 32px;}
 .lab{color:#fff;font-size:26px;font-weight:800;margin-bottom:12px;}
 img{width:560px;height:auto;display:block;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);}
</style></head><body><div class="grid">${cells}</div></body></html>`;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 3100, height: 2600 }, deviceScaleFactor: 1.4 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  const g = await p.$('.grid');
  const first = nos[0], last = nos[nos.length - 1];
  const outName = `batch_${first}-${last}.png`;
  await g.screenshot({ path: path.join(__dirname, outName) });
  await b.close(); console.log('wrote', outName);
})();
