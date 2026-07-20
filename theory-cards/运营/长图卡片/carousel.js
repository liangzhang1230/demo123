const { chromium } = require('playwright');
const HANDLE = '@老良.销售定价学';
const N = 15;

// 富文本：<r>红</r> <g>绿</g>
function rt(s){ return (s||'').replace(/<r>/g,'<span class="r">').replace(/<\/r>/g,'</span>')
  .replace(/<g>/g,'<span class="g">').replace(/<\/g>/g,'</span>'); }

const S = [
  { type:'cover', eyebrow:'销售定价学 · 实证档案',
    title:'为什么你<r>拼了命</r>，<br>还是<g>穷</g>？', sub:'普通人赚钱的第二层真相' },

  { type:'statement', tag:'开篇',
    big:'不是你不够努力。<br>是你以为对的，<r>99%是错的</r>。',
    body:['常识要是对的，照做的人早都富了。','可现实是——越信常识的人，越穷。','在"怎么赚钱"上，人的直觉几乎是反着来的。'] },

  { type:'list', tag:'真相 ①', header:'你租不出<br>自己的时间',
    items:['一天8小时拼成16小时，收入最多翻倍，还熬垮身体','收入和时间绑死，天花板就是焊死的','加班，加不出富人'], bullet:'·' },

  { type:'list', header:'普通人最快的杠杆，<br>是「会卖」',
    items:['不看你是谁——能卖出去，老板就抢你','按结果发钱，没有上限','到处能用，学会永久带走','离钱最近，腰杆最硬'], bullet:'·' },

  { type:'list', tag:'别急着说"我不适合"', header:'内向嘴笨，<br>照样能卖到顶尖',
    items:['沃顿追踪340个销售：性格居中的普通人，比内向的多卖<r>24%</r>、比外向的多卖<r>32%</r>','1985年四教授总账：能不能卖，"天赋性格"排最后，"搞清楚该干啥"排第一——纯靠训练','"我不适合"，是你信了个假故事'], bullet:'·' },

  { type:'list', tag:'真相 ②', header:'会卖，<br>也可能一直<g>穷</g>',
    items:['你赚多少，不由你多能卖，由那套"分钱的规矩"定','同一个销冠，换套提成，收入差好几倍','你能赚多少，签合同那一刻就写死了——除非你看懂它、改它、换它'], bullet:'·' },

  { type:'list', tag:'5年后 · 如果你还在打工', header:'那个不改的你', dark:true,
    items:['还是那个工位，月底还在打折求签单','提成还是那几个点，多干的全白干','比你晚来的升上去了——他早看懂"跟对结构"','四十岁怕被优化，却只会"更拼"','你还在用命，替一套没为你设计的规矩买单'], bullet:'·' },

  { type:'list', tag:'5年后 · 如果你是老板', header:'那个不改的公司', dark:true,
    items:['还在"招人—走人—怪销售—再招人"里打转','销冠一个个走，留下的卡线摸鱼','利润被月底打折悄悄冲光，报表还看不见','你以为市场不好，其实是你的规矩在奖励错的行为'], bullet:'·' },

  { type:'list', tag:'对照自查', header:'锁死你收入的<br>10根杠杆（上）',
    items:['1｜你上的哪条船（行业在缩还是在涨）','2｜钱的形状（纯提成把你压平）','3｜提成有没有封顶','4｜奖金是不是拖到年底','5｜目标是不是拍脑袋、年年硬加'], bullet:'' },

  { type:'list', tag:'对照自查', header:'锁死你收入的<br>10根杠杆（下）',
    items:['6｜提拔是不是只看业绩','7｜发奖是不是只哄后进','8｜身边是高手还是混子','9｜好线索归不归你','10｜产品是不是全靠便宜才卖得动'], foot:'中得越多，你被漏掉的越多。', bullet:'' },

  { type:'list', header:'一个下午，一张纸，<br>四步',
    items:['① 写下10根杠杆的编号','② 逐根自查，中了画圈','③ 挑最痛的一根（先只动一根）','④ 今天就改一个动作'], bullet:'' },

  { type:'list', header:'改的时候，<br>你会过三道关',
    items:['一、别扭——新规矩谁都不习惯','二、怀疑——最要命，多数人死在这','三、兑现——两三周，钱开始动'], foot:'撑过第二关，你就赢了。', bullet:'' },

  { type:'quote', big:'你的天花板，<br>不在你的<g>能力</g>上，<br>在那张你从没看过的<br><r>"分钱的规矩"</r>上。' },

  { type:'cta', big:'你中了几根？',
    body:['评论区扣数字告诉我。','想看每根到底怎么改——','关注我，138条实证一条条讲。'],
    share:'转给那个"累死累活、还不涨薪"的人' },

  { type:'end', big:'实证\n档案',
    lines:['138条销售管理实证','一条一张卡，每条带论文出处，可自己查'] },
];

function chrome(i, tag, dark){
  const pg = String(i+1).padStart(2,'0');
  return `
  <div class="bind"><i style="top:16%"></i><i style="top:46%"></i><i style="top:76%"></i></div>
  <div class="top">
    <div class="eyebrow"><span class="dot"></span>销售定价学 · 实证档案</div>
    <div class="pg">${pg} / ${N}</div>
  </div>
  <div class="foot">
    <div class="handle"><b>@老良</b>.销售<span class="g">定价学</span></div>
    <div class="chop">实证</div>
  </div>`;
}

function slideHTML(s, i){
  let inner = '';
  if (s.type === 'cover'){
    inner = `<div class="body cover">
      <div class="kick"><span class="dot"></span>${s.eyebrow}</div>
      <div class="seal big"><b>实证</b><span>档案</span></div>
      <h1 class="title xl">${rt(s.title)}</h1>
      <div class="sub">${rt(s.sub)}</div>
    </div>`;
  } else if (s.type === 'statement'){
    inner = `<div class="body">
      ${s.tag?`<div class="pill">${rt(s.tag)}</div>`:''}
      <h1 class="title">${rt(s.big)}</h1>
      <div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div>
    </div>`;
  } else if (s.type === 'list'){
    inner = `<div class="body">
      ${s.tag?`<div class="pill ${s.dark?'dark':''}">${rt(s.tag)}</div>`:''}
      <h1 class="title">${rt(s.header)}</h1>
      <ul class="list">${s.items.map(x=>`<li>${s.bullet?`<span class="bul">${s.bullet}</span>`:''}<span class="it">${rt(x)}</span></li>`).join('')}</ul>
      ${s.foot?`<div class="listfoot">${rt(s.foot)}</div>`:''}
    </div>`;
  } else if (s.type === 'quote'){
    inner = `<div class="body quote"><div class="qmark">“</div><h1 class="title q">${rt(s.big)}</h1></div>`;
  } else if (s.type === 'cta'){
    inner = `<div class="body">
      <h1 class="title">${rt(s.big)}</h1>
      <div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div>
      <div class="share">${rt(s.share)}</div>
    </div>`;
  } else if (s.type === 'end'){
    inner = `<div class="body end">
      <div class="seal big end"><b>实证</b><span>档案</span></div>
      <div class="endhandle"><b>@老良</b>.销售<span class="g">定价学</span></div>
      <div class="endlines">${s.lines.map(x=>`<p>${rt(x)}</p>`).join('')}</div>
      <div class="follow">点关注 · 一条条追下去 →</div>
    </div>`;
  }
  return `<div class="cv ${s.type}">${chrome(i, s.tag, s.dark)}${inner}</div>`;
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box;}
.cv{position:relative;width:1080px;height:1440px;overflow:hidden;
  background:radial-gradient(120% 120% at 12% 6%, #F6EDD9 0%, #F1E7D2 48%, #E7DABE 100%);
  font-family:"Noto Serif CJK SC",serif;color:#23211C;}
.cv::before{content:"";position:absolute;inset:0;opacity:.045;pointer-events:none;
  background-image:repeating-linear-gradient(0deg,#000 0 1px,transparent 1px 6px);}
.bind{position:absolute;left:0;top:0;bottom:0;width:34px;background:#23211C;}
.bind i{position:absolute;left:11px;width:13px;height:13px;border-radius:50%;background:#F1E7D2;box-shadow:inset 0 1px 2px rgba(0,0,0,.5);}
.top{position:absolute;left:86px;right:64px;top:56px;display:flex;justify-content:space-between;align-items:center;
  font-family:"Noto Sans CJK SC",sans-serif;}
.eyebrow{display:flex;align-items:center;gap:14px;color:#5A554A;font-weight:700;font-size:27px;letter-spacing:4px;}
.eyebrow .dot,.kick .dot{width:12px;height:12px;background:#C33A26;border-radius:50%;display:inline-block;}
.pg{color:#8a806c;font-weight:800;font-size:26px;letter-spacing:2px;}
.foot{position:absolute;left:86px;right:64px;bottom:56px;display:flex;justify-content:space-between;align-items:flex-end;
  font-family:"Noto Sans CJK SC",sans-serif;padding-top:22px;border-top:3px solid #23211C;}
.handle{font-size:33px;font-weight:800;color:#23211C;}
.handle b{color:#23211C;} .g{color:#127A4E;} .r{color:#C33A26;}
.chop{width:66px;height:66px;border:4px solid #C33A26;border-radius:10px;color:#C33A26;font-weight:900;font-size:30px;
  display:flex;align-items:center;justify-content:center;transform:rotate(-8deg);letter-spacing:2px;}
.body{position:absolute;left:86px;right:72px;top:150px;bottom:150px;display:flex;flex-direction:column;justify-content:center;}
.pill{align-self:flex-start;background:#23211C;color:#F1E7D2;font-family:"Noto Sans CJK SC",sans-serif;font-weight:800;
  font-size:30px;letter-spacing:2px;padding:10px 22px;border-radius:10px;margin-bottom:34px;}
.pill.dark{background:#C33A26;}
.title{font-weight:900;line-height:1.22;letter-spacing:1px;font-size:80px;}
.title.xl{font-size:108px;line-height:1.14;}
.para{margin-top:40px;}
.para p{font-family:"Noto Sans CJK SC",sans-serif;font-size:43px;line-height:1.66;font-weight:600;color:#3a352c;margin-bottom:14px;}
.list{list-style:none;margin-top:44px;}
.list li{display:flex;gap:18px;align-items:flex-start;margin-bottom:30px;}
.list .bul{color:#C33A26;font-weight:900;font-size:44px;line-height:1.4;}
.list .it{font-family:"Noto Sans CJK SC",sans-serif;font-size:44px;line-height:1.46;font-weight:700;color:#2c2921;}
.listfoot{margin-top:30px;font-family:"Noto Sans CJK SC",sans-serif;font-size:40px;font-weight:800;color:#C33A26;}
.sub{margin-top:40px;font-family:"Noto Sans CJK SC",sans-serif;font-size:44px;font-weight:700;color:#5A554A;letter-spacing:2px;}
.cover .kick{display:flex;align-items:center;gap:14px;color:#5A554A;font-weight:700;font-size:30px;letter-spacing:5px;
  font-family:"Noto Sans CJK SC",sans-serif;margin-bottom:44px;}
.seal{position:absolute;border:5px solid #C33A26;border-radius:14px;color:#C33A26;display:flex;flex-direction:column;
  align-items:center;justify-content:center;transform:rotate(-9deg);}
.seal.big{right:10px;top:20px;width:160px;height:160px;}
.seal.big b{font-size:56px;font-weight:900;letter-spacing:4px;line-height:1;}
.seal.big span{font-size:22px;letter-spacing:6px;margin-top:8px;}
.quote{align-items:flex-start;}
.qmark{font-size:180px;color:#C33A26;line-height:.7;height:110px;font-family:Georgia,serif;}
.title.q{font-size:74px;line-height:1.42;}
.share{margin-top:44px;background:rgba(18,122,78,.1);border:3px solid #127A4E;border-radius:14px;padding:24px 26px;
  font-family:"Noto Sans CJK SC",sans-serif;font-size:38px;font-weight:800;color:#127A4E;line-height:1.4;}
.end{align-items:center;text-align:center;justify-content:center;}
.seal.big.end{position:static;transform:rotate(-6deg);margin:0 auto 50px;width:210px;height:210px;}
.seal.big.end b{font-size:74px;} .seal.big.end span{font-size:28px;}
.endhandle{font-family:"Noto Sans CJK SC",sans-serif;font-size:56px;font-weight:900;color:#23211C;}
.endlines{margin-top:30px;}
.endlines p{font-family:"Noto Sans CJK SC",sans-serif;font-size:38px;font-weight:600;color:#5A554A;line-height:1.6;}
.follow{margin-top:46px;background:#23211C;color:#F1E7D2;font-family:"Noto Sans CJK SC",sans-serif;font-weight:800;
  font-size:38px;padding:20px 34px;border-radius:14px;letter-spacing:2px;}
`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (let i=0;i<S.length;i++){
    const p = await b.newPage({ viewport:{ width:1080, height:1440 }, deviceScaleFactor:2 });
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${slideHTML(S[i],i)}</body></html>`, { waitUntil:'networkidle' });
    await p.waitForTimeout(120);
    const name = 'slide_'+String(i+1).padStart(2,'0')+'.png';
    await p.screenshot({ path: name });
    await p.close();
    console.log('saved', name);
  }
  await b.close();
  console.log('DONE', S.length, 'slides');
})();
