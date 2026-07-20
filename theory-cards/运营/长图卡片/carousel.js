const { chromium } = require('playwright');
const N = 18;
function rt(s){ return (s||'').replace(/<r>/g,'<span class="r">').replace(/<\/r>/g,'</span>')
  .replace(/<g>/g,'<span class="g">').replace(/<\/g>/g,'</span>'); }

const S = [
  { type:'cover', title:'为什么你<r>拼了命</r>，<br>还是<g>穷</g>？', sub:'普通人赚钱的第二层真相' },

  { type:'statement', tag:'开篇', big:'不是你不够努力。<br>是你以为对的，<r>99%是错的</r>。',
    body:['你有没有算过：按你现在的赚法，这辈子到底能赚多少钱？算完那个数，大多数人会沉默——它配不上你流过的汗。',
          '常识要是对的，照做的人早都富了。可越信常识的人越穷。在"怎么赚钱"上，人的直觉几乎是反着来的。',
          '读完这篇，你会拿到一张纸：什么在给你钉天花板，今天能拧松哪颗螺丝。'] },

  { type:'statement', tag:'真相 ①', big:'你租不出<br>自己的时间',
    body:['一天8小时拼成16小时，收入最多翻一倍，还熬垮身体。收入和时间绑死，天花板就是焊死的——加班加不出富人。',
          '真正拉开几十倍差距的，不是谁更能熬，是有没有一根"杠杆"：一份能在你睡觉时替你赚钱的东西。',
          '可普通人没资本、不会写代码、没有百万粉丝，手里什么杠杆都没有。怎么办？'] },

  { type:'list', header:'普通人最快的杠杆，<br>是「会卖」',
    items:['不看你是谁——能卖出去，老板就抢你，不问学历出身','按结果发钱，不按时间：死工资有顶，提成没顶','到处能用，学会永久带走','离钱最近——全公司都在花钱，只有会卖的人往回拿钱'], bullet:'·' },

  { type:'statement', tag:'别急着说"我不适合"', big:'内向嘴笨，<br>照样卖到顶尖',
    body:['沃顿追踪340个销售：卖得最好的不是能说会道的外向人，是性格居中的普通人——比内向的多卖<r>24%</r>、比外向的多卖<r>32%</r>。',
          '闷的人不敢推，太能侃的只顾自己说、招人烦；中间那种，会说也会听，最容易成交。',
          '1985年四教授总账：能不能卖，"天赋性格"排最后，"搞清楚该干啥"排第一——纯靠训练。"我不适合"，是你信了个假故事。'] },

  { type:'statement', tag:'真相 ②', big:'会卖，<br>也可能一直<g>穷</g>',
    body:['就算练成销冠，也可能还是穷。因为你赚多少，不由你多能卖，由那套"分钱的规矩"定。',
          '同一个销冠，放进两家公司、两套提成，收入差好几倍。差的不是本事，是规矩。',
          '我干了20年销售管理、扒了全球40年上百家公司的研究，就一句话：你在一家公司能赚多少，签合同、定提成那一刻就写死了——除非你看懂它、改它、换它。'] },

  { type:'statement', tag:'5年后 · 如果你还在打工', big:'那个不改的你', dark:true,
    body:['还是那个工位，月底还在打折求客户签单。提成还是那几个点，超过那条线，多干的全白干。',
          '你更努力了，账户数字却没怎么动。比你晚来的升上去了——不是他更能干，是他早看懂"跟对结构"。',
          '四十岁，你怕被优化，却发现除了"更拼"什么都不会。你还在用命，替一套从没为你设计的规矩买单。'] },

  { type:'statement', tag:'5年后 · 如果你是老板', big:'那个不改的公司', dark:true,
    body:['你还在"招人—走人—怪销售不行—再招人"的圈里打转。销冠一个接一个走，留下的卡线摸鱼、能省则省。',
          '利润被月底的打折冲单一年年悄悄冲光，报表上还看不见这一行。',
          '你以为是市场不好、是人不行——其实是你亲手定的规矩，一直在奖励你最不想要的行为。'] },

  { type:'levers', tag:'锁死你收入的10根杠杆', items:[
    { h:'1｜你上的哪条船', d:'平庸的人在暴涨行业，能吊打顶尖的人在夕阳行业。船，比划桨重要。', c:'这行在缩、或全靠打折才卖得动 → 中' },
    { h:'2｜钱的形状', d:'纯提成是一条直线，把你压平。研究：换成"底薪+提成+季度奖+超额奖"，营收高约18%。', c:'低底薪+纯提成 → 中' } ] },

  { type:'levers', items:[
    { h:'3｜提成封顶', d:'封顶=老板明说"干过这条线再干不划算"，你自动收工。研究：砍掉最高档，最能干的人营收掉约两成。', c:'有封顶 / 超额不加价 → 中' },
    { h:'4｜发钱节奏', d:'年初一掉队就躺平，年终奖对掉队的人几乎没用。季度发，才救得回来。', c:'大头奖金拖到年底 → 中' } ] },

  { type:'levers', items:[
    { h:'5｜目标怎么定', d:'近七成销售完不成任务——还是任务调低之后。年年只加不减，逼所有人留一手。', c:'定完没人达标、年年硬加 → 中' },
    { h:'6｜提拔标准', d:'顶刊4万销售：只按业绩提的主管，手下业绩反降约7.5%；按会带人提的，手下最高涨三成。', c:'提拔只看谁签单多 → 中' } ] },

  { type:'levers', items:[
    { h:'7｜发奖设计', d:'一搞"人人有份"的奖，最靠谱的骨干反而松劲、掉约8%——他觉得"奖为混子发"。', c:'激励只围着后几名转 → 中' },
    { h:'8｜身边是谁', d:'顶刊：计时改计件，人均产量涨44%，一半是好结构吸来高手、赶走混子。身边人=你的天花板。', c:'打鸡血凑的人，不是好结构吸来的 → 中' } ] },

  { type:'levers', items:[
    { h:'9｜线索地盘', d:'好客户被老人垄断，新人只能啃骨头。起跑线差三米，你跑再快也累。', c:'线索和销冠不是一个池子 → 中' },
    { h:'10｜产品定价', d:'定价太低，你再能卖单均提成也薄，等于用血汗补老板定价的错。', c:'全靠"比别人便宜"才卖得动 → 中' } ],
    foot:'中得越多，你被漏掉的越多。' },

  { type:'list', header:'一个下午，一张纸，<br>四步',
    items:['写下10根杠杆的编号','逐根自查，中了画圈','挑最痛的一根（先只动一根）','今天就改一个动作：打工的去谈/早做打算，老板的改一个数字'], bullet:'num' },

  { type:'list', header:'改的时候，<br>你会过三道关',
    items:['别扭——新规矩谁都不习惯','怀疑——最要命，多数人死在这、退回去','兑现——两三周，钱开始动'], foot:'撑过第二关，你就赢了。', bullet:'num' },

  { type:'quote', big:'你的天花板，<br>不在你的<g>能力</g>上，<br>在那张你从没看过的<br><r>"分钱的规矩"</r>上。' },

  { type:'cta', big:'你中了几根？',
    body:['评论区扣数字告诉我。','想看每根到底怎么改——','关注我，138条实证一条条讲。'],
    share:'转给那个"累死累活、还不涨薪"的人' },

  { type:'end', lines:['138条销售管理实证','一条一张卡，每条带论文出处，可自己查'] },
];

function chrome(i){
  const pg = String(i+1).padStart(2,'0');
  return `<div class="bind"><i style="top:16%"></i><i style="top:46%"></i><i style="top:76%"></i></div>
  <div class="top"><div class="eyebrow"><span class="dot"></span>销售定价学 · 实证档案</div><div class="pg">${pg} / ${N}</div></div>
  <div class="foot"><div class="handle"><b>@老良</b>.销售<span class="g">定价学</span></div><div class="chop">实证</div></div>`;
}
function slideHTML(s, i){
  let inner='';
  if(s.type==='cover'){ inner=`<div class="body cover">
    <div class="seal big"><b>实证</b><span>档案</span></div>
    <h1 class="title xl">${rt(s.title)}</h1><div class="sub">${rt(s.sub)}</div></div>`; }
  else if(s.type==='statement'){ inner=`<div class="body">${s.tag?`<div class="pill ${s.dark?'dark':''}">${rt(s.tag)}</div>`:''}
    <h1 class="title">${rt(s.big)}</h1><div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div></div>`; }
  else if(s.type==='list'){ let n=0; inner=`<div class="body">${s.tag?`<div class="pill">${rt(s.tag)}</div>`:''}
    <h1 class="title">${rt(s.header)}</h1><ul class="list">${s.items.map(x=>{n++;const b=s.bullet==='num'?`<span class="bul num">${n}</span>`:(s.bullet?`<span class="bul">${s.bullet}</span>`:'');return `<li>${b}<span class="it">${rt(x)}</span></li>`;}).join('')}</ul>
    ${s.foot?`<div class="listfoot">${rt(s.foot)}</div>`:''}</div>`; }
  else if(s.type==='levers'){ inner=`<div class="body">${s.tag?`<div class="pill">${rt(s.tag)}</div>`:''}
    <div class="levers">${s.items.map(it=>`<div class="lev"><div class="lh">${rt(it.h)}</div><div class="ld">${rt(it.d)}</div><div class="lc">自查：${rt(it.c)}</div></div>`).join('')}</div>
    ${s.foot?`<div class="listfoot">${rt(s.foot)}</div>`:''}</div>`; }
  else if(s.type==='quote'){ inner=`<div class="body quote"><div class="qmark">“</div><h1 class="title q">${rt(s.big)}</h1></div>`; }
  else if(s.type==='cta'){ inner=`<div class="body"><h1 class="title">${rt(s.big)}</h1>
    <div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div><div class="share">${rt(s.share)}</div></div>`; }
  else if(s.type==='end'){ inner=`<div class="body end"><div class="seal big end"><b>实证</b><span>档案</span></div>
    <div class="endhandle"><b>@老良</b>.销售<span class="g">定价学</span></div>
    <div class="endlines">${s.lines.map(x=>`<p>${rt(x)}</p>`).join('')}</div>
    <div class="follow">点关注 · 一条条追下去 →</div></div>`; }
  return `<div class="cv ${s.type}">${chrome(i)}${inner}</div>`;
}

const CSS=`*{margin:0;padding:0;box-sizing:border-box;}
.cv{position:relative;width:1080px;height:1440px;overflow:hidden;
  background:radial-gradient(120% 120% at 12% 6%, #F6EDD9 0%, #F1E7D2 48%, #E7DABE 100%);
  font-family:"Noto Serif CJK SC",serif;color:#23211C;}
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
.title.xl{font-size:106px;line-height:1.14;}
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
.sub{margin-top:36px;font-family:"Noto Sans CJK SC",sans-serif;font-size:44px;font-weight:700;color:#5A554A;letter-spacing:2px;}
.seal{position:absolute;border:5px solid #C33A26;border-radius:14px;color:#C33A26;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:rotate(-9deg);}
.seal.big{right:6px;top:14px;width:150px;height:150px;}
.seal.big b{font-size:52px;font-weight:900;letter-spacing:4px;line-height:1;} .seal.big span{font-size:21px;letter-spacing:6px;margin-top:8px;}
.quote{align-items:flex-start;} .qmark{font-size:170px;color:#C33A26;line-height:.7;height:100px;font-family:Georgia,serif;}
.title.q{font-size:70px;line-height:1.42;}
.share{margin-top:40px;background:rgba(18,122,78,.1);border:3px solid #127A4E;border-radius:14px;padding:24px 26px;font-family:"Noto Sans CJK SC",sans-serif;font-size:37px;font-weight:800;color:#127A4E;line-height:1.4;}
.end{align-items:center;text-align:center;justify-content:center;}
.seal.big.end{position:static;transform:rotate(-6deg);margin:0 auto 44px;width:200px;height:200px;}
.seal.big.end b{font-size:70px;} .seal.big.end span{font-size:26px;}
.endhandle{font-family:"Noto Sans CJK SC",sans-serif;font-size:54px;font-weight:900;color:#23211C;}
.endlines{margin-top:28px;} .endlines p{font-family:"Noto Sans CJK SC",sans-serif;font-size:37px;font-weight:600;color:#5A554A;line-height:1.6;}
.follow{margin-top:44px;background:#23211C;color:#F1E7D2;font-family:"Noto Sans CJK SC",sans-serif;font-weight:800;font-size:37px;padding:20px 34px;border-radius:14px;letter-spacing:2px;}`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  let over=0;
  for(let i=0;i<S.length;i++){
    const p = await b.newPage({ viewport:{ width:1080, height:1440 }, deviceScaleFactor:2 });
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${slideHTML(S[i],i)}</body></html>`, { waitUntil:'networkidle' });
    const fit = await p.evaluate(()=>{ const b=document.querySelector('.body'); return { sh:b.scrollHeight, ch:b.clientHeight }; });
    const bad = fit.sh > fit.ch+2;
    if(bad) over++;
    console.log('slide',String(i+1).padStart(2,'0'), fit.sh+'/'+fit.ch, bad?'*** OVERFLOW ***':'ok');
    await p.screenshot({ path:'slide_'+String(i+1).padStart(2,'0')+'.png' });
    await p.close();
  }
  await b.close();
  console.log('DONE',S.length,'slides, overflow:',over);
})();
