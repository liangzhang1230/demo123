const { chromium } = require('playwright');
function rt(s){ return (s||'').replace(/<r>/g,'<span class="r">').replace(/<\/r>/g,'</span>')
  .replace(/<g>/g,'<span class="g">').replace(/<\/g>/g,'</span>'); }

const S = [
  { type:'cover', title:'销冠是<g>养</g>出来的，<br>不是<r>挖</r>来的', sub:'哈佛10年 · 明星业绩带不走' },

  { type:'statement', tag:'开篇', big:'挖来的销冠，<br>为什么<r>3个月就废</r>？',
    body:['你花大价钱挖来的销冠，头一两个月还行，然后就废了、或者走了。',
          '你以为是招错了人、看走了眼。不是。',
          '而且——你以为对的那套招人带人的道理，99%是错的。'] },

  { type:'statement', tag:'哈佛10年', big:'明星换个地方，<br>大多会"陨落"',
    body:['哈佛格罗斯伯格教授追踪明星10年：换了公司的明星，大多"陨落"，好几年缓不过来。',
          '因为他的业绩，一半是原平台给的——团队、客户、流程、系统。你挖来的是流星，不是恒星。',
          '唯一例外：他带着团队来，或你的系统更好。绕回来，还是"系统"说了算。'] },

  { type:'statement', tag:'真相', big:'销冠是"养"出来的，<br>不是"挖"来的',
    body:['你缺的从来不是一个销冠，是一套能不断"长出"销冠的系统。',
          '这套系统五个环节，缺一个都漏人：招 · 筛 · 育 · 用 · 留。',
          '真正的护城河：换了谁来，你都能把他变成销冠、还留得住。'] },

  { type:'statement', tag:'"那我出更高价"', big:'钱也<r>买不来</r>',
    body:['钱能买来一个人，买不来他原平台的系统。而且你可能连"该招谁"都搞错了。',
          '元分析：预测能不能真开单，最强的是"成就动机"（r=.41）；智商几乎没用（r=.04）。',
          '你一直用"学历、经验、机灵"筛人——而这些，跟真成交几乎无关。'] },

  { type:'statement', tag:'5年后 · 只挖不养', big:'流水的兵，<br>铁打的只有你', dark:true,
    body:['你还在高价挖人——挖来，兴奋一个月，废掉，失望，再挖。',
          '好不容易带出感觉的，被别人用更高价挖走，还带走了你的客户。',
          '钱全喂给猎头费和试错。五年过去，你还是没有一套"离了谁都转"的系统。'] },

  { type:'sys', badge:'招', tag:'招 · 招对人', big:'别按学历、经验招人',
    body:['真正预测业绩的是"成就动机"（r=.41，全表最强）；智商对真实成交只有 r=.04，几乎没用。'],
    check:'招人第一句是"要机灵的、高学历、有经验的" → 中' },

  { type:'sys', badge:'筛', tag:'筛 · 筛得准', big:'别靠"来聊一聊"选人',
    body:['凭眼缘的非结构化面试，准头 .38，跟扔硬币差不多；结构化面试+实操，能到 .63。','"狼性PK"更坑：赛场先筛的是性格、不是能力——实力派因厌恶内斗而收着打、甚至走人。'],
    check:'几乎全靠感觉面试 / 拿PK当选人主秤 → 中' },

  { type:'sys', badge:'育', tag:'育 · 带得出', big:'你的辅导，<br>可能在帮倒忙',
    body:['超过 38% 的反馈让绩效不升反降——分水岭：反馈指向"任务"，还是指向"人"。','带人的活性成分是频率：每周被辅导的达标 76%，每季度才辅导的只有 47%。'],
    check:'总说"你怎么又垫底"（指向人）/ 攒到季度末开大会 → 中' },

  { type:'sys', badge:'用', tag:'用 · 放对位', big:'别把销冠<br>推去带团队',
    body:['顶刊QJE、4万名销售：只按业绩提的主管，手下业绩反降约 7.5%；按"会带人"提的，手下最高涨三成。','会卖 ≠ 会带，这俩接近相反。'],
    check:'把最能单打的人，放到了要成就别人的位置 → 中' },

  { type:'sys', badge:'留', tag:'留 · 留得住', big:'你用错了榜、<br>设错了底线',
    body:['排行榜：匿名的看着"护人"其实赶人走；"实名、只显名次"才是唯一同时提达标、降流失的形态。','底线：你一说"每天最少30个电话"，员工就正好只打30个——你的底线成了他的上限。'],
    check:'用匿名榜 / 把"最少做到X"写满白板 → 中', foot:'中得越多，你的团队漏人越狠。' },

  { type:'list', header:'真去改，<br>你会过三道关',
    items:['别扭——从"到处挖人"转到"沉下心搭系统"','怀疑——系统还没长出人，你又想挖一个救火（最要命）','兑现——普通人在你这也能变销冠、还留得住'], foot:'撑过第二关，你就赢了。', bullet:'num' },

  { type:'quote', big:'恒星，<br>不是<r>挖</r>来的，<br>是<g>养</g>出来的。' },

  { type:'cta', big:'你中了几个？',
    body:['评论区扣数字告诉我。','想要"招筛育用留"整套系统——','关注我，138条实证一条条讲。'],
    share:'转给你的合伙人、HR，转给还在高价挖销冠的老板' },

  { type:'statement', tag:'下一篇预告', big:'比招销冠<br>更重要一万倍的事',
    body:['是招对一个"能搭起这套系统"的销售管理者。',
          '一个会带人的管理者，能把一整队普通人变成销冠；',
          '一个只会自己冲的销冠，只能救自己一个人。下一篇讲。'] },

  { type:'end', lines:['138条销售管理实证','招·筛·育·用·留，一条一张卡，每条带论文出处'] },
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
    <h1 class="title">${rt(s.big)}</h1><div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div>
    ${s.check?`<div class="chk">自查：${rt(s.check)}</div>`:''}</div>`; }
  else if(s.type==='sys'){ inner=`<div class="body"><div class="systag"><span class="sysbadge">${s.badge}</span><span class="sysword">${rt(s.tag)}</span></div>
    <h1 class="title sysh">${rt(s.big)}</h1><div class="para">${s.body.map(x=>`<p>${rt(x)}</p>`).join('')}</div>
    ${s.check?`<div class="chk">自查：${rt(s.check)}</div>`:''}${s.foot?`<div class="listfoot">${rt(s.foot)}</div>`:''}</div>`; }
  else if(s.type==='list'){ let n=0; inner=`<div class="body">${s.tag?`<div class="pill">${rt(s.tag)}</div>`:''}
    <h1 class="title">${rt(s.header)}</h1><ul class="list">${s.items.map(x=>{n++;const b=s.bullet==='num'?`<span class="bul num">${n}</span>`:(s.bullet?`<span class="bul">${s.bullet}</span>`:'');return `<li>${b}<span class="it">${rt(x)}</span></li>`;}).join('')}</ul>
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
.systag{display:flex;align-items:center;gap:22px;margin-bottom:28px;}
.sysbadge{width:96px;height:96px;background:#C33A26;color:#F1E7D2;border-radius:18px;font-family:"Noto Serif CJK SC",serif;font-weight:900;font-size:58px;display:flex;align-items:center;justify-content:center;transform:rotate(-4deg);}
.sysword{font-family:"Noto Sans CJK SC",sans-serif;font-weight:800;font-size:34px;letter-spacing:3px;color:#5A554A;}
.title{font-weight:900;line-height:1.2;letter-spacing:1px;font-size:74px;}
.title.sysh{font-size:66px;}
.title.xl{font-size:100px;line-height:1.14;}
.para{margin-top:32px;}
.para p{font-family:"Noto Sans CJK SC",sans-serif;font-size:39px;line-height:1.6;font-weight:600;color:#3a352c;margin-bottom:18px;}
.chk{margin-top:22px;background:rgba(18,122,78,.09);border-left:8px solid #127A4E;padding:18px 22px;border-radius:8px;font-family:"Noto Sans CJK SC",sans-serif;font-size:34px;font-weight:800;color:#127A4E;line-height:1.4;}
.list{list-style:none;margin-top:40px;}
.list li{display:flex;gap:18px;align-items:flex-start;margin-bottom:28px;}
.list .bul.num{width:52px;height:52px;background:#23211C;color:#F1E7D2;border-radius:50%;font-size:30px;display:flex;align-items:center;justify-content:center;flex:none;}
.list .it{font-family:"Noto Sans CJK SC",sans-serif;font-size:42px;line-height:1.42;font-weight:700;color:#2c2921;}
.listfoot{margin-top:26px;font-family:"Noto Sans CJK SC",sans-serif;font-size:37px;font-weight:800;color:#C33A26;}
.sub{margin-top:36px;font-family:"Noto Sans CJK SC",sans-serif;font-size:42px;font-weight:700;color:#5A554A;letter-spacing:1px;}
.seal{position:absolute;border:5px solid #C33A26;border-radius:14px;color:#C33A26;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:rotate(-9deg);}
.seal.big{right:6px;top:14px;width:150px;height:150px;}
.seal.big b{font-size:52px;font-weight:900;letter-spacing:4px;line-height:1;} .seal.big span{font-size:21px;letter-spacing:6px;margin-top:8px;}
.quote{align-items:flex-start;} .qmark{font-size:170px;color:#C33A26;line-height:.7;height:100px;font-family:Georgia,serif;}
.title.q{font-size:82px;line-height:1.32;}
.share{margin-top:38px;background:rgba(18,122,78,.1);border:3px solid #127A4E;border-radius:14px;padding:24px 26px;font-family:"Noto Sans CJK SC",sans-serif;font-size:36px;font-weight:800;color:#127A4E;line-height:1.4;}
.end{align-items:center;text-align:center;justify-content:center;}
.seal.big.end{position:static;transform:rotate(-6deg);margin:0 auto 44px;width:200px;height:200px;}
.seal.big.end b{font-size:70px;} .seal.big.end span{font-size:26px;}
.endhandle{font-family:"Noto Sans CJK SC",sans-serif;font-size:54px;font-weight:900;color:#23211C;}
.endlines{margin-top:28px;} .endlines p{font-family:"Noto Sans CJK SC",sans-serif;font-size:36px;font-weight:600;color:#5A554A;line-height:1.6;}
.follow{margin-top:44px;background:#23211C;color:#F1E7D2;font-family:"Noto Sans CJK SC",sans-serif;font-weight:800;font-size:37px;padding:20px 34px;border-radius:14px;letter-spacing:2px;}`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for(let i=0;i<S.length;i++){
    const p = await b.newPage({ viewport:{ width:1080, height:1440 }, deviceScaleFactor:2 });
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${slideHTML(S[i],i)}</body></html>`, { waitUntil:'networkidle' });
    await p.waitForTimeout(100);
    await p.screenshot({ path:'zg_'+String(i+1).padStart(2,'0')+'.png' });
    await p.close();
  }
  await b.close();
  console.log('DONE',S.length,'slides');
})();
