const { chromium } = require('playwright');
function rt(s){ return (s||'').replace(/<r>/g,'<span class="r">').replace(/<\/r>/g,'</span>')
  .replace(/<g>/g,'<span class="g">').replace(/<\/g>/g,'</span>'); }

const S = [
  { type:'cover', title:'创业死掉的，<br>90%不是<r>产品</r>，<br>是<g>卖不动</g>', sub:'483家倒闭公司的尸检报告' },

  { type:'statement', tag:'开篇', big:'不是你不够拼。<br>是你以为对的，<r>99%是错的</r>。',
    body:['产品做了一版又一版，起早贪黑，就是不赚钱、没人买。',
          '你以为是产品不够好，于是继续打磨——打磨到钱和劲都耗光，生意还是没起来。',
          '不是你不够努力，是你把力气全使在了错的地方。'] },

  { type:'statement', tag:'真相 ①', big:'创业最常见的死法，<br>不是产品烂',
    body:['一家机构解剖了483家倒闭的创业公司，看它们死于什么。结果反常识：',
          '"产品不好"，只占 <r>17%</r>——排倒数。',
          '真正的头号死因：没人真需要 <r>42%</r>、钱烧光 <r>29%</r>、定价错 <r>18%</r>。'] },

  { type:'quote', big:'"卖不动，<br>而不是产品烂，<br>才是创业失败<br>最常见的原因。"',
    who:'——彼得·蒂尔（硅谷教父）' },

  { type:'statement', tag:'真相 ②', big:'决定生死的，<br>是「会卖 + 定价」',
    body:['决定你活不活的，从来不是产品做多好，是你能不能把它卖出去、还定对价。',
          '做出来 ≠ 卖得掉。"做得好"和"有人愿意持续掏钱买"，中间隔着一条大河。',
          '可"会卖"和"定价"，恰恰是大多数创业者最不愿面对、花时间最少的事。'] },

  { type:'statement', tag:'别急着说"我不会卖"', big:'"我是做产品的"<br>不是借口',
    body:['"我脸皮薄、不会卖、张不开嘴"——这跟"我不适合"一样，是个假故事。',
          '沃顿追踪340个销售：卖得最好的不是能说会道的外向人，是性格居中的普通人，比内向的多卖<r>24%</r>、比外向的多卖<r>32%</r>。',
          '会卖不是天赋，是练出来的手艺。你缺的不是天赋，是"把卖当回事"。'] },

  { type:'statement', tag:'5年后 · 只顾埋头做产品', big:'那个想不通的你', dark:true,
    body:['产品迭代到第二十版，越做越精，可还是没什么人买，账上钱一点点见底。',
          '你把积蓄搭进去、又借了一圈，还在说"再改改就好了"。',
          '比你晚开始的人，产品没你好却先赚到钱——因为他们早去搞"怎么卖、卖多少钱"了。最后你关了门，还想不明白：我产品明明很好啊。'] },

  { type:'levers', tag:'一张纸 · 测你的生意漏在哪', items:[
    { h:'1｜真痛点还是假痛点', d:'有没有人，愿意在东西还没做好之前，就先掏钱？', c:'没人愿意先付钱 → 中' },
    { h:'2｜先卖再做？', d:'先收钱再交付，才算验证。闷头做完才发现没人要，是赌命。', c:'做完才发现没人要 → 中' } ] },

  { type:'levers', items:[
    { h:'3｜有稳定获客的渠道吗', d:'蒂尔：一个渠道跑通就能活，一个都通不了就完。', c:'说不出你的稳定渠道 → 中' },
    { h:'4｜定价拍脑袋还是算过', d:'定太低不是走量，是慢性自杀——每单都在流血。', c:'定价靠拍脑袋 / 全靠低价 → 中' } ] },

  { type:'levers', items:[
    { h:'5｜时间花在做还是卖', d:'决定生死的，恰恰是你花时间最少的"卖"。', c:'80%时间做产品、很少去卖 → 中' },
    { h:'6｜一个客户赚的够本吗', d:'一个客户赚的钱，够不够cover获取他的成本？算不清，钱烧光只是时间问题。', c:'算不清这笔账 → 中' } ] },

  { type:'levers', items:[
    { h:'7｜有回头客吗', d:'有复购才有未来。每单都从零获客，是最贵的活法。', c:'全靠一次性买卖 → 中' },
    { h:'8｜卖价值还是拼便宜', d:'只能靠"比别人便宜"活着，利润薄如纸。', c:'全靠低价才卖得动 → 中' } ] },

  { type:'levers', items:[
    { h:'9｜一个人硬扛吗', d:'你不擅长卖，团队里也没人擅长——短板没人补。', c:'卖这块没人扛 → 中' },
    { h:'10｜有别人抢不走的点吗', d:'跟一堆人卖一模一样的东西，就是红海肉搏。', c:'没有差异化 → 中' } ],
    foot:'中得越多，你的生意漏得越狠。' },

  { type:'list', header:'真去改，<br>你会过三道关',
    items:['别扭——从"打磨产品"转到"逼自己去卖"','怀疑——卖了几次没成，想缩回去改产品（最要命）','兑现——有人真掏钱、还复购，你就摸到活下去的绳子'], foot:'撑过第二关，你就赢了。', bullet:'num' },

  { type:'quote', big:'你不缺一个好产品。<br>你缺的，是把它<br><g>卖出去</g>、<r>定对价</r>的本事。' },

  { type:'cta', big:'你中了几个？',
    body:['评论区扣数字告诉我。','想学会卖和定价这门手艺——','关注我，138条实证一条条讲。'],
    share:'转给那个"起早贪黑创业、还没赚到钱"的朋友' },

  { type:'end', lines:['138条销售+定价实证','一条一张卡，每条带论文出处，可自己查'] },
];
const N = S.length;

function chrome(i){
  const pg = String(i+1).padStart(2,'0');
  return `<div class="bind"><i style="top:16%"></i><i style="top:46%"></i><i style="top:76%"></i></div>
  <div class="top"><div class="eyebrow"><span class="dot"></span>销售定价学 · 实证档案</div><div class="pg">${pg} / ${N}</div></div>
  <div class="foot"><div class="handle"><b>@老良</b>.销售<span class="g">定价学</span></div><div class="chop">实证</div></div>`;
}
function slideHTML(s, i){
  let inner='';
  if(s.type==='cover'){ inner=`<div class="body cover"><div class="seal big"><b>实证</b><span>档案</span></div>
    <h1 class="title xl">${rt(s.title)}</h1><div class="sub">${rt(s.sub)}</div></div>`; }
  else if(s.type==='statement'){ inner=`<div class="body">${s.tag?`<div class="pill ${s.dark?'dark':''}">${rt(s.tag)}</div>`:''}
    <h1 class="title">${rt(s.big)}</h1><div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div></div>`; }
  else if(s.type==='list'){ let n=0; inner=`<div class="body">${s.tag?`<div class="pill">${rt(s.tag)}</div>`:''}
    <h1 class="title">${rt(s.header)}</h1><ul class="list">${s.items.map(x=>{n++;const b=s.bullet==='num'?`<span class="bul num">${n}</span>`:(s.bullet?`<span class="bul">${s.bullet}</span>`:'');return `<li>${b}<span class="it">${rt(x)}</span></li>`;}).join('')}</ul>
    ${s.foot?`<div class="listfoot">${rt(s.foot)}</div>`:''}</div>`; }
  else if(s.type==='levers'){ inner=`<div class="body">${s.tag?`<div class="pill">${rt(s.tag)}</div>`:''}
    <div class="levers">${s.items.map(it=>`<div class="lev"><div class="lh">${rt(it.h)}</div><div class="ld">${rt(it.d)}</div><div class="lc">自查：${rt(it.c)}</div></div>`).join('')}</div>
    ${s.foot?`<div class="listfoot">${rt(s.foot)}</div>`:''}</div>`; }
  else if(s.type==='quote'){ inner=`<div class="body quote"><div class="qmark">“</div><h1 class="title q">${rt(s.big)}</h1>${s.who?`<div class="who">${rt(s.who)}</div>`:''}</div>`; }
  else if(s.type==='cta'){ inner=`<div class="body"><h1 class="title">${rt(s.big)}</h1>
    <div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div><div class="share">${rt(s.share)}</div></div>`; }
  else if(s.type==='end'){ inner=`<div class="body end"><div class="seal big end"><b>实证</b><span>档案</span></div>
    <div class="endhandle"><b>@老良</b>.销售<span class="g">定价学</span></div>
    <div class="endlines">${s.lines.map(x=>`<p>${rt(x)}</p>`).join('')}</div>
    <div class="follow">点关注 · 一条条追下去 →</div></div>`; }
  return `<div class="cv ${s.type}">${chrome(i)}${inner}</div>`;
}
const CSS=`*{margin:0;padding:0;box-sizing:border-box;}
.cv{position:relative;width:1080px;height:1440px;overflow:hidden;background:radial-gradient(120% 120% at 12% 6%, #F6EDD9 0%, #F1E7D2 48%, #E7DABE 100%);font-family:"Noto Serif CJK SC",serif;color:#23211C;}
.cv::before{content:"";position:absolute;inset:0;opacity:.045;pointer-events:none;background-image:repeating-linear-gradient(0deg,#000 0 1px,transparent 1px 6px);}
.bind{position:absolute;left:0;top:0;bottom:0;width:34px;background:#23211C;}
.bind i{position:absolute;left:11px;width:13px;height:13px;border-radius:50%;background:#F1E7D2;box-shadow:inset 0 1px 2px rgba(0,0,0,.5);}
.top{position:absolute;left:86px;right:64px;top:52px;display:flex;justify-content:space-between;align-items:center;font-family:"Noto Sans CJK SC",sans-serif;}
.eyebrow{display:flex;align-items:center;gap:14px;color:#5A554A;font-weight:700;font-size:27px;letter-spacing:4px;}
.eyebrow .dot{width:12px;height:12px;background:#C33A26;border-radius:50%;display:inline-block;}
.pg{color:#8a806c;font-weight:800;font-size:26px;letter-spacing:2px;}
.foot{position:absolute;left:86px;right:64px;bottom:50px;display:flex;justify-content:space-between;align-items:flex-end;font-family:"Noto Sans CJK SC",sans-serif;padding-top:20px;border-top:3px solid #23211C;}
.handle{font-size:32px;font-weight:800;color:#23211C;} .g{color:#127A4E;} .r{color:#C33A26;}
.chop{width:62px;height:62px;border:4px solid #C33A26;border-radius:10px;color:#C33A26;font-weight:900;font-size:28px;display:flex;align-items:center;justify-content:center;transform:rotate(-8deg);letter-spacing:2px;}
.body{position:absolute;left:86px;right:72px;top:128px;bottom:132px;display:flex;flex-direction:column;justify-content:center;}
.pill{align-self:flex-start;background:#23211C;color:#F1E7D2;font-family:"Noto Sans CJK SC",sans-serif;font-weight:800;font-size:29px;letter-spacing:2px;padding:10px 22px;border-radius:10px;margin-bottom:30px;}
.pill.dark{background:#C33A26;}
.title{font-weight:900;line-height:1.2;letter-spacing:1px;font-size:74px;}
.title.xl{font-size:92px;line-height:1.16;}
.para{margin-top:34px;}
.para p{font-family:"Noto Sans CJK SC",sans-serif;font-size:40px;line-height:1.62;font-weight:600;color:#3a352c;margin-bottom:20px;}
.list{list-style:none;margin-top:40px;}
.list li{display:flex;gap:18px;align-items:flex-start;margin-bottom:28px;}
.list .bul{color:#C33A26;font-weight:900;font-size:42px;line-height:1.35;flex:none;}
.list .bul.num{width:52px;height:52px;background:#23211C;color:#F1E7D2;border-radius:50%;font-size:30px;display:flex;align-items:center;justify-content:center;}
.list .it{font-family:"Noto Sans CJK SC",sans-serif;font-size:42px;line-height:1.42;font-weight:700;color:#2c2921;}
.listfoot{margin-top:28px;font-family:"Noto Sans CJK SC",sans-serif;font-size:38px;font-weight:800;color:#C33A26;}
.levers{display:flex;flex-direction:column;gap:40px;}
.lev .lh{font-weight:900;font-size:50px;color:#23211C;letter-spacing:1px;margin-bottom:10px;}
.lev .ld{font-family:"Noto Sans CJK SC",sans-serif;font-size:37px;line-height:1.5;font-weight:600;color:#3a352c;}
.lev .lc{font-family:"Noto Sans CJK SC",sans-serif;font-size:33px;font-weight:800;color:#127A4E;margin-top:10px;}
.sub{margin-top:36px;font-family:"Noto Sans CJK SC",sans-serif;font-size:42px;font-weight:700;color:#5A554A;letter-spacing:1px;}
.seal{position:absolute;border:5px solid #C33A26;border-radius:14px;color:#C33A26;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:rotate(-9deg);}
.seal.big{right:6px;top:14px;width:150px;height:150px;}
.seal.big b{font-size:52px;font-weight:900;letter-spacing:4px;line-height:1;} .seal.big span{font-size:21px;letter-spacing:6px;margin-top:8px;}
.quote{align-items:flex-start;} .qmark{font-size:170px;color:#C33A26;line-height:.7;height:100px;font-family:Georgia,serif;}
.title.q{font-size:66px;line-height:1.4;}
.who{margin-top:30px;font-family:"Noto Sans CJK SC",sans-serif;font-size:36px;font-weight:800;color:#5A554A;}
.share{margin-top:40px;background:rgba(18,122,78,.1);border:3px solid #127A4E;border-radius:14px;padding:24px 26px;font-family:"Noto Sans CJK SC",sans-serif;font-size:37px;font-weight:800;color:#127A4E;line-height:1.4;}
.end{align-items:center;text-align:center;justify-content:center;}
.seal.big.end{position:static;transform:rotate(-6deg);margin:0 auto 44px;width:200px;height:200px;}
.seal.big.end b{font-size:70px;} .seal.big.end span{font-size:26px;}
.endhandle{font-family:"Noto Sans CJK SC",sans-serif;font-size:54px;font-weight:900;color:#23211C;}
.endlines{margin-top:28px;} .endlines p{font-family:"Noto Sans CJK SC",sans-serif;font-size:37px;font-weight:600;color:#5A554A;line-height:1.6;}
.follow{margin-top:44px;background:#23211C;color:#F1E7D2;font-family:"Noto Sans CJK SC",sans-serif;font-weight:800;font-size:37px;padding:20px 34px;border-radius:14px;letter-spacing:2px;}`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for(let i=0;i<S.length;i++){
    const p = await b.newPage({ viewport:{ width:1080, height:1440 }, deviceScaleFactor:2 });
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${slideHTML(S[i],i)}</body></html>`, { waitUntil:'networkidle' });
    await p.waitForTimeout(100);
    await p.screenshot({ path:'cy_'+String(i+1).padStart(2,'0')+'.png' });
    await p.close();
  }
  await b.close();
  console.log('DONE',S.length,'slides');
})();
