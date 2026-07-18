# 内核 API 契约（模块实现者必读）

一体版 = 单文件 HTML SPA。构建时 `suite/src/` 下文件按文件名排序拼接：
`00-styles.css` → `01-kernel.js`(SK) → `02-ui.js`(UI) → `05-dashboard.js` → `10-dingjia.js` → `11-suanzhang.js` → `12-zhaoren.js` → `13-yuren.js` → `14-liuren.js` → `99-boot.js`。

每个模块文件是一个 IIFE：`(() => { 'use strict'; ... })();`，**纯 JavaScript（非 TS）**，不得访问网络、不得 `new Date()`（用 `SK.today()`），不得直接 `localStorage`（用 `SK.persist()`，且几乎不用手动调——见 UI.commit）。

## 公约（与五件套原始公约一致）
- 金额一律「分」(int)。展示用 `SK.fmt.yuan/wan`。
- 除法只用 `SK.safeDiv(a,b)` → 除零/缺数返回 null → UI 显示 `SK.DASH`（'—'，从不假装知道）。
- 比率 0–1；日期 `'YYYY-MM-DD'`；系数只经 `SK.getCoef(path)`（用户可覆盖）。
- 所有建议只出「行动卡」，系统永不自动执行。判定带 📎 出处（`UI.h.src(...)`）。
- **一体版新规**：不做免费版模糊/授权锁/屏幕硬锁。原“信封导入前置锁”（如留人器闸①、育人器 M21 锁）改为：数据不足时显示引导 banner + 跳转按钮，功能不锁。

## SK（内核）常用 API
```js
SK.DB                       // 统一数据库（可直接读写；写后必须 UI.commit()）
SK.today()                  // 'YYYY-MM-DD'；SK.setTestToday(s) 测试注入，用完 setTestToday(null)
SK.safeDiv, SK.clamp, SK.roundTo, SK.round100, SK.mean, SK.median, SK.stddevP(总体), SK.stddevS(样本), SK.pearson, SK.percentileR7
SK.uid(prefix), SK.esc, SK.mulberry32
SK.ymd, SK.addDays, SK.diffDays(a,b)/*b-a*/, SK.monthOf, SK.firstDay, SK.weekdayOf/*0=周日*/, SK.dNum, SK.numDate
SK.fmt = { yuan(fen), wan(fen,dp), pct(rate,dp), num(n,dp), x(n), d(s) }   // null→'—'
SK.RAMP, SK.SEGMENT_MAP, SK.CYCLE_CN, SK.CITY_CN, SK.POS_CN
SK.newHireYearRate(cycle, m)   // 头部和口径；short,1→0.658333
SK.calcRamp80(cycle)
SK.getCoef('ns.path')          // 见 01-kernel.js COEF_DEFAULT；含 shared.* 与各板块命名空间
SK.rRate()                     // 全局提成率：定价器实时结果优先
SK.activeSales(), SK.activeManagers(), SK.personById(id), SK.catById(id), SK.maskPhone(p)
SK.X('dingjia'|'suanzhang'|'zhaoren'|'yuren'|'liuren')  // 跨模块派生（可能为 null，必须判空）
SK.summary.<id> = (db, today) => ({...})                // 模块必须注册自己的 summary（见下）
SK.registerModule({...})       // 见下
SK.actions['ns.name'] = (dataset, el, ev) => {...}
SK.tests.push({ id:'DJ-T1', name:'…', fn: () => true | {pass, got, want} })
```

## UI 常用 API
```js
UI.h.card(title, body, {right, cls})   UI.h.kv([{k,v,cls,total}])   UI.h.tbl(cols, rowsHtml[], {empty})
UI.h.badge(t, 'g|a|r|b|n|gold|acc')    UI.h.meter(ratio, tone, bands[])   UI.h.banner(t, tone)
UI.h.action(title, body, tone, btnsHtml)   UI.h.btn(label, act, {cls:'pri|sm|danger|ghost', data:'data-x="1"', disabled})
UI.h.hero(v, label, tone, small)   UI.h.src(t)   UI.h.hint(t)   UI.h.acc(summary, body, open)   UI.h.dot(tone)
UI.h.linked('联动')                // 标记“该值来自其他板块实时换算”
UI.h.field(label, controlHtml, hint)   UI.h.input(path, type, opts)   UI.h.select(path, [{v,t}], cur)
UI.h.seg(path, [{v,t}], cur)       // 分段按钮，写 DB path
UI.h.range(path, val, min, max, step)  UI.h.spark(arr, markMonth)  UI.h.ring(pct, label, tone)
UI.toast(msg)   UI.modal(html)   UI.closeModal()   UI.commit()   UI.nav(board, sub)
```
数据绑定：`data-bind="deals.0.paymentAmt"` 式 path 直接写 SK.DB；`data-type` ∈ `int|num|wan(万→分)|fen-yuan(元→分)|pct100(%→0-1)|bool|str`。`data-bind="coef:ns.path"` 写系数覆盖。change 事件自动 `UI.commit()`（持久化+全站重渲染=实时换算）。列表内元素建议用自定义 action 而非 data-bind 长 path。

## 模块注册契约
```js
SK.registerModule({
  id: 'dingjia', title: '定价', icon: '💰', order: 2,      // order: dingjia2 suanzhang3 zhaoren4 yuren5 liuren6
  subnav: [{id:'dash',label:'五张账单'}, ...],
  liveCells() { return [{k:'今年漏损', v:'≈107.0万', tone:'red', board:'dingjia', sub:'dash', tip:'…'}]; }, // 顶部全局实时条 1-2 格
  alerts() { return 3; },                                   // 红灯数（顶导航小红点）
  alertList() { return [{tone:'r'|'a', text:'…', board, sub}]; },  // 驾驶舱分诊台聚合
  render(sub) { return '<div>…</div>'; },                   // 当前子页 HTML；内部 switch(sub)
});
```
渲染是无状态全量重绘：任何 DB 变化 → UI.commit() → 所有派生量现算。**不要缓存派生值到 DB**。模块内草稿态（如未保存的表单）可挂在模块闭包变量。

## 统一 DB 结构（详见 01-kernel.js emptyDB/seedDemo，字段名以内核为准）
- `company`：cityTier cycleTier tierGrade complementLevel attributableLevel targetYearMode targetYearGrossWan lastYearPerCapitaWan targetPersonalMonthlyGrossWan attritionRate hiringCycleDays blendedMarginRate fullLoadWan rMode rManual —— **定价器/招人器输入直接绑定这些共享字段**（万元字段存「万」数值，不是分；用时 ×SK.WAN）。
- `people[]`：{spId,name,phone,cityTier,level,positionType('sales'|'manager'|'executive'),hireDate,leaveDate,leaveReason,managerId,hireBatchId,sourceChannel,baseSalaryAmt(分),hiringCostAmt(分),isActive}。销售人数=SK.activeSales().length（**不再手填**）。
- `categories[]`：{id,name,grossMarginRate,medianStayDays}
- `leads[]`：{id,employeeId,month:'YYYY-MM',assignedLeads,selfDevLeads}
- `deals[]`：{id,employeeId,categoryId,dealDate(签约日,won 才有),intentDate,paidDate(null=未回款/挂账),closeDate,status:'won'|'lost'|'open',paymentAmt(分),discountRate}
  - 算账器口径：计毛利/回款的单 = status==='won'（按 dealDate 归月）；挂账 = won 且 paidDate==null。
- `discounts[]`：{id,employeeId,discountDate,categoryId,listPriceAmt,actualPriceAmt,reason('period_end_push'|'competitive_pressure'|…)}
- `payouts[]`：{id,employeeId,payoutDate,period:'YYYY-MM',type(SE01: instant_bonus|year_end_bonus|dividend|reimburse|mentoring_share|recipe_royalty|sprint_vested|discretionary|other),amount(分),timing('immediate'|'weekend_delayed'|'scheduled'),hasCondition}
- `refunds[]`：{id,employeeId,refundDate,categoryId,amount}
- `opcosts[]`：{id,name,kind,monthlyAmt}
- `candidates[]`：{candId,name,phone,pool('resume'|'interview'|'offer'|'hired'|'reserve'),sourceChannel,expectedWan,poolEnteredDate}
- `weights`（7 维题库权重对象）、`dt`（黑暗三角 5 观测量）、`criteria`{minExperienceYears,ageRange}
- `dailyReports[]`：{drId,employeeId,date,counts:{leads,intents,samples,contracts},submittedAt}
- `prescriptions[]`：{rxId,employeeId,date,type,text,psiParts,plvPassed,ackedAt}
- `coachingAcks[]`：{ackId,spId,coachId,date,durationHrs,reportedHrs,status('confirmed'|'no_response'|'disputed')}
- `bounties[]`：{bountyId,template,amountAmt,active,createdAt}；`spotChecks[]`；`practiceLogs[]`:{spId,count14}
- `recipeSource`：{sourceIds[],setAt}|null；`pairAssignments[]`：{pairId,weekOf,coachId,learnerId,topicStage,status,consecutiveWeeks}
- `oxygen`{spId:modelId}；`insistLog[]`；`paceConfig.manualQuotaBySp`{spId:分}；`shiftConfig`{'*':[0]} 值=休息星期数组；`silentTrackOn`
- `governance`：{sii:{dailyReportOn,rollcallOn,spotChecksPerWeek,approvalLevels,monthlyViewsTotal,rxCountTotal}, ei:{objectionsRaisedQuarter,suggestionsRaised,suggestionsAdopted,cardIgnoreRate}, ahcInputs:{achievedCount,honoredCount,interceptCount,ratchetCount}, selfRating:{sii,ei,dvi,ahc}}
- `priceTag`：{spId,hireMonths,raiseMonthlyAmt(分),shortenPct}（月毛利改为从该员工近6月实际成交实时算，算不出时回退 company 人均）
- `dividend`：{poolRate,gates:{companyCollect:{enabled,pass},companyNet:{...},personalCollect:{...}}}
- `blueprint.milestones[]`；`m28Agreements[]`（字段同留人器规格）；`covenants[]`；`objections[]`；`suggestions[]`；`overrideEvents[]`；`handoverCards[]`
- `menuChoices[]`；`covenantDocs[]`（招聘信用书）；`scenarios[]`；`audit`（定价器风洞审计输入，可 null）
- `coefOverrides`{path:value}

## X 跨模块派生契约（每模块必须注册 SK.summary.<id>；消费方必须判空）
```js
SK.summary.dingjia = (db, today) => ({ ok, r, matrixT, matrixB, floatShare, goodHireIndex, burdenRate, total, results })
  // r=销售提成率(0-1)|null; matrixT/matrixB 分; total=今年漏损(分)|null; results=完整五账单对象(内部用)
SK.summary.suanzhang = (db, today) => ({
  m21Done, imbalanceRate, uerTeamMean, dvi, realP90Factor, netContributionAmt, laborRoi,
  ledger:{net,rate}|null,
  m21rows:[{spId,name,leads,selfShare,index,over,under,grossMarginAmt,unitLeadMargin,normMargin,origRank,normRank}],
  uerBySp:{spId:{resid,band}}, teamDiscountLeakRate,
  perPerson:{spId:{normRankMonths[≤6],scissors,marketGap,leadIndex,collected6m,specialPayout12m,contribGrowth,margin12[12月归一化毛利,不足为null],traj6[6],trajEarly[6]|null,uerSeries[],discountRate,complaintCount,growth3m}},
})
SK.summary.zhaoren = (db, today) => ({ trueHires, naiveHires, overRate, latestStart, isLate, lateDays, targetHeads, managerNeeded, mgrGap, tagAmt, practiceBySp:{spId:count14} })
SK.summary.yuren = (db, today) => ({ coachingDoseActual, cognitiveGapRate, redNewbies:[spId], recipeSourceIds:[] })
SK.summary.liuren = (db, today) => ({ ahc, sii, ei, m28ByMaster:{spId:[agr]}, m28CoverageRate, irrevocableAny, priceTagHeadline })
```
计算顺序无关（X 有环路保护返回 null），但请让 summary **轻量**（只算必需聚合），完整明细在 render 内自行算。

## 对拍自检
每模块推 4–8 条黄金值测试进 SK.tests（fixture 自带、`SK.setTestToday('2026-07-13')` 注入、`try/finally` 还原 `SK.setTestToday(null)`；不依赖/不污染 SK.DB——纯函数直接喂 fixture）。黄金值取各自原件规格（如定价器 T-B1 S6=16、招人器 k1=0.658333、留人器 SII=73/EI=4/AHC=41、育人器 PSI 32/96、算账器提成 27.06%）。
