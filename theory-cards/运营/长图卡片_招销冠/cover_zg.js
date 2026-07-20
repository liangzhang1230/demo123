const { chromium } = require('playwright');
function html(fmt){
  const horiz = fmt === 'h';
  const W = horiz ? 900 : 1080;
  const H = horiz ? 383 : 1080;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:${W}px;height:${H}px;overflow:hidden;}
  .cv{position:relative;width:${W}px;height:${H}px;
    background:radial-gradient(120% 140% at 12% 8%, #F6EDD9 0%, #F1E7D2 46%, #E7DABE 100%);
    font-family:"Noto Serif CJK SC",serif;color:#23211C;overflow:hidden;}
  .cv::before{content:"";position:absolute;inset:0;opacity:.05;pointer-events:none;
    background-image:repeating-linear-gradient(0deg,#000 0 1px,transparent 1px ${horiz?'4':'5'}px);}
  .bind{position:absolute;left:0;top:0;bottom:0;width:${horiz?46:70}px;background:#23211C;}
  .bind i{position:absolute;left:${horiz?18:30}px;width:${horiz?12:16}px;height:${horiz?12:16}px;border-radius:50%;
    background:#F1E7D2;box-shadow:inset 0 1px 2px rgba(0,0,0,.5);}
  .seal{position:absolute;border:${horiz?4:6}px solid #C33A26;border-radius:${horiz?10:14}px;color:#C33A26;
    display:flex;flex-direction:column;align-items:center;justify-content:center;transform:rotate(-9deg);opacity:.94;}
  .seal b{font-weight:900;line-height:1;} .seal span{letter-spacing:${horiz?3:5}px;}
  .content{position:absolute;}
  .eyebrow{display:flex;align-items:center;gap:${horiz?10:16}px;color:#5A554A;font-weight:700;font-family:"Noto Sans CJK SC",sans-serif;}
  .eyebrow .dot{width:${horiz?7:10}px;height:${horiz?7:10}px;background:#C33A26;border-radius:50%;}
  .support{color:#C33A26;font-weight:800;font-family:"Noto Sans CJK SC",sans-serif;}
  h1{font-weight:900;line-height:1.12;letter-spacing:1px;}
  h1 .r{color:#C33A26;} h1 .g{color:#127A4E;}
  .handle{font-family:"Noto Sans CJK SC",sans-serif;color:#5A554A;font-weight:700;}
  .handle b{color:#23211C;} .handle .g{color:#127A4E;}
  </style></head><body>
  <div class="cv">
    <div class="bind"><i style="top:${horiz?'18%':'16%'}"></i><i style="top:${horiz?'46%':'42%'}"></i><i style="top:${horiz?'74%':'68%'}"></i></div>
    ${horiz ? `
    <div class="seal" style="right:40px;top:52px;width:118px;height:118px;"><b style="font-size:40px;letter-spacing:4px;">实证</b><span style="font-size:15px;margin-top:6px;">档案</span></div>
    <div class="content" style="left:78px;right:190px;top:60px;">
      <div class="eyebrow" style="font-size:15px;letter-spacing:5px;margin-bottom:10px;"><span class="dot"></span>销售定价学 · 实证档案</div>
      <div class="support" style="font-size:15px;letter-spacing:1px;margin-bottom:18px;">哈佛10年 · 挖来的明星大多3个月就废</div>
      <h1 style="font-size:66px;">销冠是<span class="g">养</span>出来的，<br>不是<span class="r">挖</span>来的</h1>
    </div>
    <div class="handle" style="position:absolute;left:78px;bottom:26px;font-size:15px;letter-spacing:1px;"><b>@老良</b>.销售<span class="g">定价学</span> · 全球40年销售管理实证</div>
    ` : `
    <div class="seal" style="right:60px;top:70px;width:170px;height:170px;"><b style="font-size:60px;letter-spacing:6px;">实证</b><span style="font-size:22px;margin-top:8px;">档案</span></div>
    <div class="content" style="left:120px;right:80px;top:150px;">
      <div class="eyebrow" style="font-size:24px;letter-spacing:8px;margin-bottom:16px;"><span class="dot"></span>销售定价学 · 实证档案</div>
      <div class="support" style="font-size:24px;letter-spacing:1px;margin-bottom:34px;">哈佛10年 · 挖来的明星大多3个月就废</div>
      <h1 style="font-size:112px;">销冠是<span class="g">养</span>出来的，<br>不是<span class="r">挖</span>来的</h1>
    </div>
    <div class="handle" style="position:absolute;left:120px;bottom:64px;font-size:26px;letter-spacing:1px;"><b>@老良</b>.销售<span class="g">定价学</span><br><span style="font-size:20px;">全球40年销售管理实证 · 每条带论文出处</span></div>
    `}
  </div></body></html>`;
}
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [fmt,w,h,out] of [['h',900,383,'cover_zg_2.35x1.png'],['sq',1080,1080,'cover_zg_1x1.png']]) {
    const p = await b.newPage({ viewport:{ width:w, height:h }, deviceScaleFactor:2 });
    await p.setContent(html(fmt), { waitUntil:'networkidle' });
    await p.waitForTimeout(120);
    await p.screenshot({ path: out });
    await p.close();
    console.log('saved', out);
  }
  await b.close();
})();
