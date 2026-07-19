const { chromium } = require('playwright');
const { PILLARS, CARDS } = require('./cards.js');
const path = require('path');
const fs = require('fs');

const FONTS = path.join(__dirname, 'fonts');
const f = n => 'file://' + path.join(FONTS, n);

// 固定三色系统：黑 + 红 + 绿（钩子块另配金色）。绿=唯一强调色，全卡统一。
const ACCENT = '#127A4E'; // 绿

function css() {
  return `
@font-face{font-family:'Anton';src:url('${f('Anton.woff2')}') format('woff2');font-weight:400;}
@font-face{font-family:'ArchivoBlack';src:url('${f('ArchivoBlack.woff2')}') format('woff2');font-weight:400;}
@font-face{font-family:'SpaceMono';src:url('${f('SpaceMono.woff2')}') format('woff2');font-weight:700;}

:root{
  --paper:#F1E7D2;      /* warm archival cream */
  --paper2:#EADFC6;
  --ink:#23211C;        /* warm near-black */
  --ink2:#5A554A;       /* muted ink */
  --seal:#C33A26;       /* vermillion official-seal red */
  --loss:#C33A26;
  --gain:#127A4E;       /* 绿 = 正向数字，与 --acc 同色 */
  --line:#C9BC9E;       /* hairline on paper */
  --acc:#127A4E;        /* 绿 = 唯一强调色 */
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased;}
html,body{background:#333;}
.card{
  position:relative;width:1080px;height:1520px;overflow:hidden;
  background:
    linear-gradient(180deg,#F4EBD8 0%, #EFE3CC 55%, #EADFC6 100%);
  color:var(--ink);
  font-family:'Noto Sans CJK SC',sans-serif;
  padding:40px 60px 30px;
  display:flex;flex-direction:column;
}
/* archival texture: ledger grid + paper fiber grain */
.card::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:1;
  background-image:
   repeating-linear-gradient(0deg, rgba(120,95,50,.05) 0 1px, transparent 1px 56px),
   repeating-linear-gradient(90deg, rgba(120,95,50,.035) 0 1px, transparent 1px 3px),
   repeating-linear-gradient(0deg, rgba(120,95,50,.03) 0 1px, transparent 1px 3px);
}
.card::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:1;
  background:radial-gradient(130% 70% at 88% -12%, rgba(255,255,255,.55), transparent 55%),
             radial-gradient(120% 80% at 4% 108%, rgba(120,90,45,.16), transparent 52%),
             radial-gradient(60% 40% at 50% 50%, transparent 60%, rgba(120,90,45,.07));
  mix-blend-mode:multiply;opacity:.75;}
.card>*{position:relative;z-index:3;}

/* left-edge 卷宗 binding: two punch holes + margin line */
.punch{position:absolute;z-index:2;left:26px;top:0;bottom:0;width:2px;
  background:repeating-linear-gradient(180deg,var(--line) 0 8px,transparent 8px 16px);opacity:.5;}
.punch::before,.punch::after{content:'';position:absolute;left:-13px;width:28px;height:28px;border-radius:50%;
  background:#E4D8BE;box-shadow:inset 2px 2px 5px rgba(90,70,35,.45),0 1px 0 rgba(255,255,255,.5);}
.punch::before{top:360px;} .punch::after{bottom:360px;}

/* archival stamp watermark — circular seal, fills variable lower whitespace */
.wm{position:absolute;z-index:2;right:40px;bottom:168px;width:270px;height:270px;border-radius:50%;
  border:5px solid var(--acc);transform:rotate(-11deg);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  opacity:.12;font-family:'Noto Serif CJK SC',serif;color:var(--acc);pointer-events:none;}
.wm i{position:absolute;inset:14px;border:2px solid var(--acc);border-radius:50%;}
.wm b{font-size:80px;font-weight:700;letter-spacing:6px;line-height:.9;}
.wm span{font-size:24px;letter-spacing:10px;margin-top:8px;margin-left:4px;}
.wm em{position:absolute;bottom:34px;font-style:normal;font-size:15px;letter-spacing:3px;font-family:'SpaceMono',monospace;}

/* discoverability tag row (fills lower band, aids 小红书/抖音 reach) */
.htags{margin-top:auto;flex:none;padding-top:12px;display:flex;flex-wrap:nowrap;gap:10px;overflow:hidden;}
.htags span{font-size:20px;font-weight:700;color:var(--acc);
  background:color-mix(in srgb,var(--acc) 12%,transparent);
  padding:7px 14px;border-radius:8px;white-space:nowrap;}

/* ============ MASTHEAD ============ */
.mast{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;}
.mast-l{display:flex;align-items:center;gap:22px;}
.seal{
  position:relative;width:124px;height:124px;flex:none;border-radius:16px;
  border:5px solid var(--seal);color:var(--seal);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  transform:rotate(-8deg);opacity:.95;
  box-shadow:inset 0 0 0 3px rgba(195,58,38,.35), 2px 3px 0 rgba(195,58,38,.12);
  font-family:'Noto Serif CJK SC',serif;
}
.seal::before{content:'';position:absolute;inset:9px;border:1.5px solid var(--seal);border-radius:9px;opacity:.55;}
.seal b{font-size:46px;font-weight:700;letter-spacing:6px;line-height:1;margin-left:6px;}
.seal span{font-size:15px;letter-spacing:5px;margin-top:5px;margin-left:5px;}
.seal i{position:absolute;top:6px;right:9px;font-style:normal;font-size:13px;letter-spacing:0;}
.mast-title{display:flex;flex-direction:column;}
.mast-title .kicker{font-size:22px;letter-spacing:10px;color:var(--ink2);font-weight:700;}
.mast-title .no{font-family:'ArchivoBlack';font-size:70px;line-height:.92;color:var(--ink);letter-spacing:-1px;}
.mast-title .no small{font-size:30px;color:var(--seal);vertical-align:.35em;margin-right:4px;letter-spacing:0;}
.badge{
  align-self:flex-start;margin-top:10px;
  background:var(--ink);color:#F1E7D2;border-radius:999px;
  padding:13px 24px 13px 16px;font-size:22px;font-weight:800;letter-spacing:.5px;
  display:flex;align-items:center;gap:12px;white-space:nowrap;
  box-shadow:0 4px 14px rgba(0,0,0,.14);
}
.badge b{color:var(--acc-l,#EBD9A0);font-weight:800;}
.badge .chk{width:30px;height:30px;border-radius:50%;background:var(--gain);color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;}

.subrow{display:flex;align-items:center;gap:16px;margin-top:20px;}
.chip{background:var(--acc);color:#fff;font-weight:700;font-size:23px;padding:8px 20px;border-radius:8px;letter-spacing:1px;}
.chip.pillar{background:transparent;color:var(--acc);border:2.5px solid var(--acc);}
.tag{border:2px solid var(--ink);border-radius:8px;padding:8px 16px;font-size:22px;font-weight:700;}
.sample{margin-left:auto;color:var(--ink2);font-size:22px;font-weight:700;}
.rule{height:5px;background:var(--ink);margin-top:18px;position:relative;}
.rule::after{content:'';position:absolute;left:0;top:11px;height:2px;width:100%;background:var(--ink);opacity:.55;}

/* ============ HEADLINE ============ */
.head{font-family:'Noto Serif CJK SC',serif;font-weight:700;
  font-size:70px;line-height:1.15;letter-spacing:1px;margin:14px 0 6px;
  text-shadow:0 1px 0 rgba(255,255,255,.4);
}
.head em{font-style:normal;color:var(--acc);}
.head hl{font-style:normal;color:var(--seal);position:relative;white-space:nowrap;
  background:linear-gradient(180deg,transparent 62%, rgba(195,58,38,.20) 62%);
  padding:0 4px;}

/* ============ HOOK ============ */
.hook{position:relative;background:rgba(255,255,255,.5);border-left:8px solid var(--acc);
  padding:20px 26px 16px;font-size:30px;line-height:1.42;font-weight:700;color:#37332B;
  border-radius:0 12px 12px 0;margin:16px 0 12px;}
.hook::before{content:'🎣 3 秒口播钩子';position:absolute;top:-16px;left:22px;background:var(--acc);color:#fff;
  font-size:17px;letter-spacing:1px;padding:5px 13px;border-radius:7px;font-weight:800;box-shadow:0 3px 8px rgba(0,0,0,.15);}

/* ============ SECTIONS ============ */
.sec{display:flex;gap:24px;padding:13px 0;border-top:2.5px solid var(--line);}
.sec .n{font-family:'ArchivoBlack';font-size:56px;line-height:.8;color:var(--acc);flex:none;width:96px;}
.sec .n small{display:block;font-family:'Noto Sans CJK SC';font-size:19px;font-weight:800;letter-spacing:3px;color:var(--ink2);margin-top:12px;}
.sec .body{flex:1;font-size:34px;line-height:1.45;color:#2C2921;font-weight:500;}
.sec .body b{font-weight:900;color:var(--ink);}
.sec .body u{text-decoration:none;color:var(--seal);border-bottom:5px solid var(--seal);font-weight:900;padding-bottom:1px;}
.sec .foot{margin-top:9px;font-size:26px;color:var(--ink2);font-weight:600;}
.sec .bignum{flex:none;align-self:center;font-family:'Anton';font-size:96px;line-height:.85;letter-spacing:-1px;}
.bignum.gain{color:var(--gain);}
.bignum.loss{color:var(--loss);}
.bignum.neutral{color:var(--ink);font-family:'Noto Serif CJK SC',serif;font-weight:700;font-size:78px;}
/* concept stamp: 竖排概念印（理论条用词，非数字）*/
.bignum.concept{color:var(--ink);font-family:'Noto Serif CJK SC',serif;font-weight:700;font-size:60px;writing-mode:vertical-rl;letter-spacing:2px;border-left:5px solid var(--acc);padding-left:14px;margin-left:6px;}

/* section 3 ledger rows */
.ledger{display:flex;flex-direction:column;gap:15px;flex:1;justify-content:center;}
.lrow{display:flex;align-items:center;gap:18px;}
.lrow .k{font-size:31px;font-weight:700;color:#2C2921;flex:none;max-width:580px;}
.lrow .dots{flex:1;border-bottom:3px dotted var(--line);transform:translateY(-6px);}
.lrow .v{font-family:'Anton';font-size:62px;line-height:.9;white-space:nowrap;}
.lrow .v small{font-family:'Noto Sans CJK SC';font-size:27px;font-weight:800;margin-left:4px;}
.v.loss{color:var(--loss);} .v.gain{color:var(--gain);}
.v.neutral{color:var(--acc);} .v.ink{color:var(--ink);}
/* 03 as prose (theories without a clean money figure) */
.sec .s3text{align-self:center;}

/* ============ SOURCE ============ */
.src{margin-top:10px;display:flex;align-items:center;gap:14px;font-size:20px;color:var(--ink2);font-weight:600;}
.src .slabel{flex:none;display:flex;align-items:center;gap:8px;white-space:nowrap;font-family:'Noto Sans CJK SC';font-weight:800;color:var(--ink);}
.src .slabel .dot{width:14px;height:22px;background:var(--acc);flex:none;border-radius:2px;}
.src .cite{flex:1;font-family:'SpaceMono',monospace;color:#4A463D;line-height:1.3;}
.src .verify{flex:none;color:#fff;background:var(--gain);font-family:'Noto Sans CJK SC';font-weight:800;font-size:19px;white-space:nowrap;padding:5px 12px;border-radius:6px;}

/* ============ CTA ============ */
.cta{margin-top:18px;background:var(--ink);color:var(--paper);border-radius:16px;
  padding:22px 28px;display:flex;align-items:center;gap:24px;}
.cta .lft{flex:none;text-align:center;}
.cta .lft .big{font-size:31px;font-weight:900;color:#F1E7D2;line-height:1.15;}
.cta .lft .key{display:inline-block;margin-top:7px;background:var(--seal);color:#fff;font-size:23px;font-weight:900;padding:5px 16px;border-radius:8px;letter-spacing:2px;}
.cta .bar{width:3px;align-self:stretch;background:rgba(255,255,255,.18);}
.cta .rgt .t1{font-size:29px;font-weight:900;color:#fff;line-height:1.3;}
.cta .rgt .t1 b{color:var(--acc-l,#EBD9A0);}
.cta .rgt .t2{font-size:23px;color:#D8CBAE;font-weight:600;margin-top:6px;}

/* ============ FOOTER ============ */
.foot-brand{margin-top:16px;padding-top:14px;border-top:2px solid var(--line);display:flex;align-items:flex-end;justify-content:space-between;}
.foot-brand .name{font-family:'Noto Serif CJK SC',serif;font-weight:700;font-size:38px;color:var(--ink);letter-spacing:1px;}
.foot-brand .name span{color:var(--seal);}
.foot-brand .tl{font-size:20px;color:var(--ink2);font-weight:600;margin-top:4px;}
.foot-brand .follow{font-size:23px;font-weight:800;color:var(--acc);white-space:nowrap;}
`;
}

function cardHtml(c) {
  const p = PILLARS[c.pillar];
  const tags = c.tags.map(t => `<span class="tag">${t}</span>`).join('');
  const s1stat = c.s1.stat ? `<div class="bignum ${c.s1.statColor}">${c.s1.stat}</div>` : '';
  const s3cap = c.s3.cap || '值多少钱';
  const s3inner = c.s3.rows
    ? `<div class="ledger">${c.s3.rows.map(r => `
      <div class="lrow"><div class="k">${r.k}</div><div class="dots"></div>
        <div class="v ${r.color}">${r.v}<small>${r.unit}</small></div></div>`).join('')}</div>`
    : `<div class="body s3text">${c.s3.text}</div>`;
  return `<div class="card" style="--acc:${ACCENT}">
    <div class="punch"></div>
    <div class="wm"><i></i><b>实证</b><span>存 档</span><em>SPS·可查证</em></div>
    <div class="mast">
      <div class="mast-l">
        <div class="seal"><b>实证</b><span>存 档</span></div>
        <div class="mast-title">
          <div class="kicker">实证档案</div>
          <div class="no"><small>NO.</small>${c.no}</div>
        </div>
      </div>
      <div class="badge"><span class="chk">✓</span>${c.badge}</div>
    </div>
    <div class="subrow">
      <span class="chip pillar">${c.chip || ('柱' + c.pillar + ' · ' + p.name)}</span>
      ${tags}
      <span class="sample">${c.sample}</span>
    </div>
    <div class="rule"></div>

    <div class="head">${c.titleHtml}</div>

    <div class="sec">
      <div class="n">01<small>数据发现</small></div>
      <div class="body">${c.s1.body}${c.s1.foot ? `<div class="foot">${c.s1.foot}</div>` : ''}</div>
      ${s1stat}
    </div>

    <div class="sec">
      <div class="n">02<small>你在犯错</small></div>
      <div class="body">${c.s2.body}</div>
    </div>

    <div class="sec">
      <div class="n">03<small>${s3cap}</small></div>
      ${s3inner}
    </div>

    <div class="src"><span class="slabel"><span class="dot"></span>论文出处</span><span class="cite">${c.src}</span><span class="verify">可查证 ✓</span></div>

    <div class="cta">
      <div class="lft"><div class="big">关注<br>＋评论</div><div class="key">要</div></div>
      <div class="bar"></div>
      <div class="rgt"><div class="t1">免费领 <b>《精选 10 条 · 可落地版》</b></div>
        <div class="t2">照着改 → 先堵住一个正在漏钱的窟窿</div></div>
    </div>

    <div class="htags">${(c.htags||[]).map(t => `<span>${t}</span>`).join('')}</div>

    <div class="foot-brand">
      <div><div class="name">@销售<span>定价学</span></div>
        <div class="tl">全球 40 年销售管理实证 · 每条带论文出处</div></div>
      <div class="follow">关注不迷路 →</div>
    </div>
  </div>`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1520 }, deviceScaleFactor: 2 });
  for (const c of CARDS) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css()}</style></head><body>${cardHtml(c)}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const fit = await page.evaluate(() => {
      const card = document.querySelector('.card');
      return { scrollH: card.scrollHeight, clientH: card.clientHeight };
    });
    console.log(`  fit ${c.slug || c.no}: content=${fit.scrollH}px / box=${fit.clientH}px ${fit.scrollH>fit.clientH?'*** OVERFLOW ***':'ok'}`);
    const el = await page.$('.card');
    const out = path.join(__dirname, `card_${c.slug || c.no}.png`);
    await el.screenshot({ path: out });
    console.log('wrote', out);
  }
  await browser.close();
})();
