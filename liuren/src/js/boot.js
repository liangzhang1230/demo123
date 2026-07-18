// ============================================================================
// 启动装配：加载 DB → 解析授权（离线 ECDSA 验签）→ 首屏渲染 → 事件委托
// UI 层唯一取真实时钟处（公约 C-14）：UI.S.today
// ============================================================================
function boot() {
  loadDB();
  UI.S.today = D.realToday();

  // 授权解析（授-2 到期只降级；授-3 防调表 seenMaxDate）
  const lic = DB.license || {};
  const seen = lic.seenMaxDate;
  if (!seen || UI.S.today > seen) { DB.license.seenMaxDate = UI.S.today; saveDB(); }
  const res = resolveModeByDate(lic.expiry, UI.S.today, DB.license.seenMaxDate);
  DB.__mode = res.mode;
  // 异步验签（不阻塞首屏；失败即无效 → free）
  if (lic.code) verifyLicenseCode(lic.code).then(v => {
    if (v.ok && v.payload) {
      DB.license.tenant = v.payload.tenant; DB.license.expiry = v.payload.expiry; DB.license.board = v.payload.board;
      DB.license.verified = true;
      DB.__mode = resolveModeByDate(v.payload.expiry, UI.S.today, DB.license.seenMaxDate).mode;
    } else { DB.license.verified = false; }
    UI.render();
  });

  UI.render();
  wireEvents();
}

function wireEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') UI.closeModal(); });
}

function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  const H = handlers[act];
  if (H) { e.preventDefault(); H(t); }
}

const handlers = {
  nav: (t) => { UI.S.route = t.dataset.route; UI.S.modal = null; UI.render(); window.scrollTo(0, 0); },
  theme: () => { const cur = DB.settings.theme; DB.settings.theme = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto'; saveDB(); UI.render(); UI.toast('主题：' + DB.settings.theme); },
  print: () => window.print(),
  closeModalBg: (t) => { if (t.classList.contains('modal-backdrop')) UI.closeModal(); },
  closeModal: () => UI.closeModal(),

  export: () => {
    const env = buildEnvelope(UI.S.today);
    downloadJSON(env, `skab_liuren_${UI.S.today}.json`);
    DB.ui.backupLastExportAt = UI.S.today; saveDB(); UI.render();
    UI.toast('已导出信封（含 ahc + M28Agreement 双载荷）');
  },
  exportAnon: () => UI.toast('匿名实验包已生成（占位 · 全程不联网）'),
  migrate: () => UI.openModal(`<div class="modal-head"><h3>换电脑迁移</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <ol style="padding-left:18px;line-height:2"><li>在旧电脑点「导出信封 JSON」，得到一个文件。</li><li>把文件拷到新电脑（U 盘/网盘均可）。</li><li>在新电脑打开本 HTML → 信封页「导入他方信封」选该文件。</li></ol>
    <p class="tiny muted">「数据不出你电脑」的另一面是「数据只在你电脑」——丢数据的责任由系统主动防，所以每 ${getCoef('backupNudgeDays')} 天提醒你备份一次。</p>`),

  importPick: () => pickFile((obj) => {
    const r = importEnvelope(obj, UI.S.today);
    if (!r.ok) { UI.toast('导入失败：schema 不符'); return; }
    UI.toast(`已导入 ${r.board}${r.hashMismatch ? '（系数指纹不一致，建议同步）' : ''}`);
    UI.render();
  }),

  selfrate: () => {
    const s = DB.governance.selfRating;
    UI.openModal(`<div class="modal-head"><h3>自评四滑杆（先猜后看）</h3><button class="x-btn" data-act="closeModal">×</button></div>
      ${['sii', 'ei', 'dvi', 'ahc'].map(k => `<label class="field"><span class="field-label">${({ sii: '监督 SII', ei: '授权 EI', dvi: '可见 DVI', ahc: '信用 AHC' })[k]}：<b id="sr-${k}-v">${s[k]}</b></span><input type="range" min="0" max="100" value="${s[k]}" id="sr-${k}" oninput="document.getElementById('sr-${k}-v').textContent=this.value"></label>`).join('')}
      <div class="btn-row"><button class="btn btn--primary" data-act="saveSelfrate">保存并看实测</button></div>`);
  },
  saveSelfrate: () => {
    ['sii', 'ei', 'dvi', 'ahc'].forEach(k => { const el = document.getElementById('sr-' + k); if (el) DB.governance.selfRating[k] = +el.value; });
    saveDB(); UI.closeModal(); UI.toast('已保存自评');
  },

  bountyDemo: (t) => {
    const tr = t.dataset.t;
    const chk = Engine.bountySaveCheck(tr, DB.silentTrackOn);
    if (chk.ok) { UI.toast(`🟢 「${tr}」放行保存${chk.reason === 'exempt' ? '（豁免）' : ''}`); return; }
    UI.openModal(`<div class="modal-head"><h3>闸③ 拦截保存</h3><button class="x-btn" data-act="closeModal">×</button></div>
      <div class="banner banner--danger"><span class="b-ico">🔴</span><div>${UI.esc(SCRIPTS.L15({ templateName: tr }))}</div></div>
      <div class="btn-row" style="margin-top:14px"><button class="btn btn--primary" data-act="enableSilent">一键启用静默认可通道</button><button class="btn" data-act="closeModal">改用行为类悬赏</button></div>`);
  },
  enableSilent: () => { DB.silentTrackOn = true; saveDB(); UI.closeModal(); UI.render(); UI.toast('已启用静默认可通道（连续 6 月达标 → 灯塔 + 合约资格池）'); },

  tryDown: (t) => {
    const r = Engine.tryDowngradeM28(DB, t.dataset.id, UI.S.today, '界面尝试下调');
    saveDB(); UI.render();
    UI.toast('🔴 下调在代码层无成功路径——已留痕 + AHC 扣分 + 全员可见');
  },

  runPrecheck: () => {
    const sp = document.getElementById('pc-sp').value;
    const amt = Math.round((+document.getElementById('pc-amt').value || 0) * 100);
    const pc = Engine.precheck(DB, sp, amt, UI.S.today);
    const out = document.getElementById('pc-out'); if (!out) return;
    if (pc.hist == null) { out.innerHTML = `<div class="banner banner--info"><span class="b-ico">ℹ️</span><div>—（首年无参照）仅出提示。</div></div>`; return; }
    const map = { below_history: ['danger', SCRIPTS.L10a({ amt: Money.cny(amt), hist: Money.cny(pc.hist) })], below_trend: ['warning', SCRIPTS.L10b({ amt: Money.cny(amt), hist: Money.cny(pc.hist), trend: Money.cny(pc.trend), g: Rate.pct(pc.growth) })], ok: ['success', SCRIPTS.L10c({ amt: Money.cny(amt), trend: Money.cny(pc.trend) })] };
    const [band, msg] = map[pc.verdict];
    out.innerHTML = `<div class="banner banner--${band}"><span class="b-ico">${band === 'danger' ? '🔴' : band === 'warning' ? '🟡' : '🟢'}</span><div>${UI.esc(msg)}</div></div>
      <div class="tiny muted" style="margin-top:8px">${UI.esc(SCRIPTS.L10d())}</div>`;
  },

  forceDividend: () => { DB.entities.OverrideEvent.push({ id: makeId('ovr'), at: UI.S.today, action: 'force_dividend_risk_ack', visibleToAll: true }); DB.governance.ahcInputs.interceptCount += 0; saveDB(); UI.toast('已留痕：我知道风险仍要启用（计入 AHC）'); },

  leaveWizard: () => {
    const spOpts = DB.entities.Salesperson.filter(s => s.isActive).map(s => `<option value="${s.spId}">${UI.esc(s.name)}</option>`).join('');
    UI.openModal(`<div class="modal-head"><h3>离职登记向导（M38）</h3><button class="x-btn" data-act="closeModal">×</button></div>
      <label class="field"><span class="field-label">离职员工</span><select id="lw-sp">${spOpts}</select></label>
      <label class="field"><span class="field-label">在途单账面合计（万元，演示一次录入）</span><input id="lw-sum" type="number" value="96"></label>
      <label class="field"><span class="field-label">在途单笔数</span><input id="lw-n" type="number" value="11"></label>
      <div class="btn-row"><button class="btn btn--primary" data-act="runLeave">生成余震名单 + 交接卡</button></div>
      <div id="lw-out" style="margin-top:12px"></div>`);
  },
  runLeave: () => {
    const sp = document.getElementById('lw-sp').value;
    const n = Math.max(1, +document.getElementById('lw-n').value || 1);
    const sum = Math.round((+document.getElementById('lw-sum').value || 0) * 1e6);
    const cards = []; for (let i = 0; i < n; i++) cards.push({ amountAmt: Math.round(sum / n) });
    cards[0].amountAmt += sum - cards.reduce((s, c) => s + c.amountAmt, 0);
    const hs = Engine.handoverSummary(cards);
    const after = Engine.aftershockRank(DB, sp, UI.S.today);
    const list = after.map(a => `${UI.esc(a.name)}（${a.score}分：${a.sig.join('/') || '—'}）`).join('；');
    const out = document.getElementById('lw-out');
    out.innerHTML = `<div class="banner banner--warning"><span class="b-ico">⚠️</span><div>${UI.esc(SCRIPTS.L11({ leaver: masterNameSafe(sp), list }))}</div></div>
      <div class="banner banner--danger" style="margin-top:8px"><span class="b-ico">🔴</span><div>${UI.esc(SCRIPTS.L12({ n, sum: Money.wan(sum), loss: Money.wan(hs.loss), save: Money.wan(hs.save) }))}</div></div>
      <div class="tiny muted" style="margin-top:8px">已生成 ${hs.count} 张交接卡（可打印，指派接手人）；损耗回填该离职者价签第六项。</div>`;
  },

  applyLicense: async (t) => {
    const code = (document.getElementById('lic-code') || {}).value;
    if (!code) { UI.toast('请粘贴续期码'); return; }
    const v = await verifyLicenseCode(code.trim());
    if (!v.ok) { UI.toast('续期码无效：' + v.reason); return; }
    DB.license = { code: code.trim(), tenant: v.payload.tenant, board: v.payload.board, expiry: v.payload.expiry, verified: true, seenMaxDate: DB.license.seenMaxDate };
    DB.__mode = resolveModeByDate(v.payload.expiry, UI.S.today, DB.license.seenMaxDate).mode;
    saveDB(); UI.render(); UI.toast('续期成功：' + v.payload.tenant);
  },

  reset: () => UI.openModal(`<div class="modal-head"><h3>确认重置</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <p>将清空当前数据并恢复出厂种子。此操作不可撤销。</p>
    <div class="btn-row" style="margin-top:14px"><button class="btn btn--danger" data-act="resetGo">确认重置</button><button class="btn" data-act="closeModal">取消</button></div>`),
  resetGo: () => { resetDB(); UI.closeModal(); UI.render(); UI.toast('已重置为出厂数据'); },
};

// ============================================================================
// 录入/编辑处理器（数值权归老板 · 一切改动即时重算）
// ============================================================================
const gv = (id) => document.getElementById(id);
const num = (id) => +(gv(id) || {}).value || 0;
const fen = (id) => Math.round(num(id) * 100);      // 元 → 分
const wanFen = (id) => Math.round(num(id) * 1e6);   // 万 → 分
const chk = (id) => !!(gv(id) || {}).checked;
const spOptions = (sel) => DB.entities.Salesperson.map(s => `<option value="${s.spId}" ${sel === s.spId ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('');
const recomputeCovConfirm = () => { const c = DB.entities.Covenant; DB.governance.ei.covenantConfirmRatio = c.length ? c.filter(x => x.bothConfirmed).length / c.length : 0; };

Object.assign(handlers, {
  // ---- 治理体检输入 ----
  editGov: () => {
    const g = DB.governance;
    UI.openModal(`<div class="modal-head"><h3>编辑体检输入</h3><button class="x-btn" data-act="closeModal">×</button></div>
      <h4 style="margin:6px 0;color:var(--text-strong)">监督 SII</h4>
      <label class="field"><span class="field-label">在职人数</span><input id="g-head" type="number" value="${g.sii.activeHeadcount}"></label>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="g-daily" ${g.sii.dailyReportOn ? 'checked' : ''} style="width:auto"> 日报必填</label>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="g-roll" ${g.sii.rollcallOn ? 'checked' : ''} style="width:auto"> 点名开启</label>
      <div class="grid grid-2"><label class="field"><span class="field-label">抽检张/周</span><input id="g-spot" type="number" value="${g.sii.spotChecksPerWeek}"></label>
      <label class="field"><span class="field-label">审批层级</span><input id="g-appr" type="number" value="${g.sii.approvalLevels}"></label>
      <label class="field"><span class="field-label">月总查看次数</span><input id="g-view" type="number" value="${g.sii.monthlyViewsTotal}"></label>
      <label class="field"><span class="field-label">处方次数(总)</span><input id="g-rx" type="number" value="${g.sii.rxCountTotal}"></label></div>
      <h4 style="margin:6px 0;color:var(--text-strong)">授权 EI</h4>
      <div class="grid grid-2"><label class="field"><span class="field-label">异议提出(季)</span><input id="g-obj" type="number" value="${g.ei.objectionsRaisedQuarter}"></label>
      <label class="field"><span class="field-label">建议提出</span><input id="g-sug" type="number" value="${g.ei.suggestionsRaised}"></label>
      <label class="field"><span class="field-label">建议采纳</span><input id="g-sugA" type="number" value="${g.ei.suggestionsAdopted}"></label>
      <label class="field"><span class="field-label">行动卡忽略率(0–1)</span><input id="g-ignore" type="number" step="0.01" value="${g.ei.cardIgnoreRate}"></label></div>
      <h4 style="margin:6px 0;color:var(--text-strong)">信用 AHC（irrevocable 覆盖由前程合约自动算）</h4>
      <div class="grid grid-2"><label class="field"><span class="field-label">已达成笔数</span><input id="g-ach" type="number" value="${g.ahcInputs.achievedCount}"></label>
      <label class="field"><span class="field-label">已履约笔数</span><input id="g-hon" type="number" value="${g.ahcInputs.honoredCount}"></label>
      <label class="field"><span class="field-label">拦截下调次数</span><input id="g-int" type="number" value="${g.ahcInputs.interceptCount}"></label>
      <label class="field"><span class="field-label">棘轮触发次数</span><input id="g-rat" type="number" value="${g.ahcInputs.ratchetCount}"></label></div>
      <div class="btn-row"><button class="btn btn--primary" data-act="saveGov">保存并重算</button></div>`);
  },
  saveGov: () => {
    const g = DB.governance;
    g.sii.activeHeadcount = g.ei.activeHeadcount = num('g-head');
    g.sii.dailyReportOn = chk('g-daily'); g.sii.rollcallOn = chk('g-roll');
    g.sii.spotChecksPerWeek = num('g-spot'); g.sii.approvalLevels = num('g-appr');
    g.sii.monthlyViewsTotal = num('g-view'); g.sii.rxCountTotal = num('g-rx');
    g.ei.objectionsRaisedQuarter = num('g-obj'); g.ei.suggestionsRaised = num('g-sug');
    g.ei.suggestionsAdopted = num('g-sugA'); g.ei.cardIgnoreRate = num('g-ignore');
    g.ahcInputs.achievedCount = num('g-ach'); g.ahcInputs.honoredCount = num('g-hon');
    g.ahcInputs.honoredRatio = g.ahcInputs.achievedCount > 0 ? g.ahcInputs.honoredCount / g.ahcInputs.achievedCount : 0;
    g.ahcInputs.interceptCount = num('g-int'); g.ahcInputs.ratchetCount = num('g-rat');
    saveDB(); UI.closeModal(); UI.render(); UI.toast('体检输入已更新，四指数已重算');
  },

  // ---- 价签输入 ----
  editPriceTag: () => {
    const p = DB.priceTag;
    UI.openModal(`<div class="modal-head"><h3>编辑价签输入</h3><button class="x-btn" data-act="closeModal">×</button></div>
      <label class="field"><span class="field-label">对象员工</span><select id="pt-sp">${spOptions(p.spId)}</select></label>
      <div class="grid grid-2">
      <label class="field"><span class="field-label">近6月月均毛利（万）</span><input id="pt-gm" type="number" step="0.1" value="${Money.wanNum(p.monthlyGrossMarginAmt)}"></label>
      <label class="field"><span class="field-label">招聘周期（月）</span><input id="pt-hire" type="number" step="0.1" value="${p.hireMonths}"></label>
      <label class="field"><span class="field-label">批均回本（月）</span><input id="pt-pay" type="number" step="0.1" value="${p.paybackMonths}"></label>
      <label class="field"><span class="field-label">爬坡缺口月当量</span><input id="pt-ramp" type="number" step="0.001" value="${p.rampGapMonthsEq}"></label>
      <label class="field"><span class="field-label">拟加薪（元/月）</span><input id="pt-raise" type="number" value="${Money.yuan(p.raiseMonthlyAmt)}"></label>
      <label class="field"><span class="field-label">缩短爬坡比例（0–1）</span><input id="pt-short" type="number" step="0.01" value="${p.shortenPct}"></label>
      <label class="field"><span class="field-label">年招聘量</span><input id="pt-hpy" type="number" step="0.001" value="${p.hiresPerYear}"></label></div>
      <div class="btn-row"><button class="btn btn--primary" data-act="savePriceTag">保存并重算</button></div>`);
  },
  savePriceTag: () => {
    const p = DB.priceTag;
    p.spId = gv('pt-sp').value; p.monthlyGrossMarginAmt = wanFen('pt-gm');
    p.hireMonths = num('pt-hire'); p.paybackMonths = num('pt-pay'); p.rampGapMonthsEq = num('pt-ramp');
    p.raiseMonthlyAmt = fen('pt-raise'); p.shortenPct = num('pt-short'); p.hiresPerYear = num('pt-hpy');
    saveDB(); UI.closeModal(); UI.render(); UI.toast('价签已重算');
  },

  // ---- M28 协议 ----
  addM28: () => UI.openModal(`<div class="modal-head"><h3>新建 M28 协议</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <label class="field"><span class="field-label">师傅</span><select id="m-sp">${spOptions()}</select></label>
    <label class="field"><span class="field-label">类型</span><select id="m-kind"><option value="mentoring">带教分成（默认 5%×12月）</option><option value="royalty">配方使用费（默认 2%×24月）</option></select></label>
    <div class="grid grid-2"><label class="field"><span class="field-label">费率（0–1）</span><input id="m-rate" type="number" step="0.01" placeholder="0.05"></label>
    <label class="field"><span class="field-label">时长（月）</span><input id="m-dur" type="number" placeholder="12"></label>
    <label class="field"><span class="field-label">徒弟月净贡献 / 团队月增量（万）</span><input id="m-amt" type="number" step="0.1" placeholder="5.8"></label>
    <label class="field"><span class="field-label">基准快照（万·使用费用）</span><input id="m-base" type="number" step="0.1" placeholder="选填"></label></div>
    <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="m-irr" checked style="width:auto"> irrevocable（只可上调延长；下调无成功路径）</label>
    <div class="btn-row"><button class="btn btn--primary" data-act="saveM28">保存</button></div>`),
  saveM28: () => {
    const kind = gv('m-kind').value;
    const a = { m28Id: makeId('m28'), masterId: gv('m-sp').value, kind, rate: num('m-rate') || (kind === 'mentoring' ? 0.05 : 0.02), durationMonths: num('m-dur') || (kind === 'mentoring' ? 12 : 24), startTrigger: kind === 'mentoring' ? 'apprentice_ramp_done' : 'recipe_live', baselineSnapshotAmt: gv('m-base').value ? wanFen('m-base') : null, irrevocable: chk('m-irr'), createdAt: UI.S.today };
    if (kind === 'mentoring') a.apprenticeMonthlyNetAmt = wanFen('m-amt'); else a.teamMonthlyIncrementAmt = wanFen('m-amt');
    DB.entities.M28Agreement.push(a); saveDB(); UI.closeModal(); UI.render(); UI.toast('协议已创建');
  },

  // ---- 前程合约 ----
  addCovenant: (t) => { const sp = t.dataset.sp; UI.openModal(`<div class="modal-head"><h3>新建前程合约</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <label class="field"><span class="field-label">员工</span><select id="c-sp">${spOptions(sp)}</select></label>
    <label class="field"><span class="field-label">承诺模板</span><select id="c-tpl"><option>连续达标→晋升有效档</option><option>连续达标→专家台阶（天花板>地板）</option><option>带出满产新人→带教分成</option><option>关键客户录入→配方使用费</option><option>单独战役→年度分红资格池</option><option value="irr">产权协议（irrevocable 强制）</option></select></label>
    <label class="field"><span class="field-label">时长（月）</span><input id="c-dur" type="number" placeholder="12"></label>
    <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="c-both" style="width:auto"> 双方已确认</label>
    <div class="tiny muted" style="margin-bottom:8px">🔴 无自由文本条件栏；主管不可见。</div>
    <div class="btn-row"><button class="btn btn--primary" data-act="saveCovenant">保存</button></div>`); },
  saveCovenant: () => {
    const tplSel = gv('c-tpl'); const isIrr = tplSel.value === 'irr';
    DB.entities.Covenant.push({ covId: makeId('cov'), employeeId: gv('c-sp').value, lines: [], promiseText: tplSel.options[tplSel.selectedIndex].text, bothConfirmed: chk('c-both'), irrevocable: isIrr, durationMonths: num('c-dur') || 12, createdAt: UI.S.today });
    recomputeCovConfirm(); saveDB(); UI.closeModal(); UI.render(); UI.toast('前程合约已创建（irrevocable 覆盖计入 AHC）');
  },
  confirmCovenant: (t) => { const c = DB.entities.Covenant.find(x => x.covId === t.dataset.id); if (c) { c.bothConfirmed = true; recomputeCovConfirm(); saveDB(); UI.render(); UI.toast('已确认双方'); } },

  // ---- M30 双通道 ----
  raiseObjection: () => UI.openModal(`<div class="modal-head"><h3>我有异议</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <label class="field"><span class="field-label">提出人（异议不可匿名）</span><select id="o-sp">${spOptions()}</select></label>
    <label class="field"><span class="field-label">针对的负面判定</span><select id="o-reason"><option value="bad_debt">坏账标记</option><option value="stop_bleed">止血候选</option><option value="cull_suggest">汰评估</option><option value="rank_bottom">排行末位</option><option value="other">其他</option></select></label>
    <label class="field"><span class="field-label">说明（选填）</span><textarea id="o-note" rows="2"></textarea></label>
    <div class="btn-row"><button class="btn btn--primary" data-act="saveObjection">提交（永不进考核路径）</button></div>`),
  saveObjection: () => { DB.entities.ObjectionEntry.push({ objId: makeId('obj'), employeeId: gv('o-sp').value, createdAt: UI.S.today, targetType: 'other', reason: gv('o-reason').value, note: gv('o-note').value || null, status: 'pending', markActive: true, resolvedAt: null }); DB.governance.ei.objectionsRaisedQuarter += 1; DB.governance.ei.objection90dCount += 1; saveDB(); UI.closeModal(); UI.render(); UI.toast('异议已提交（EI 分母 +1）'); },
  raiseSuggestion: () => UI.openModal(`<div class="modal-head"><h3>我有个建议</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" id="s-anon" style="width:auto"> 匿名提交（仍计 EI 分母）</label>
    <label class="field"><span class="field-label">提出人</span><select id="s-sp">${spOptions()}</select></label>
    <label class="field"><span class="field-label">类别</span><select id="s-cat"><option value="lead_allocation">线索分配</option><option value="comp_plan">薪酬方案</option><option value="product">产品问题</option><option value="process">流程审批</option><option value="training">培训带教</option><option value="other">其他</option></select></label>
    <label class="field"><span class="field-label">内容</span><textarea id="s-content" rows="3"></textarea></label>
    <div class="btn-row"><button class="btn btn--primary" data-act="saveSuggestion">提交</button></div>`),
  saveSuggestion: () => { DB.entities.SuggestionEntry.push({ sugId: makeId('sug'), employeeId: chk('s-anon') ? null : gv('s-sp').value, createdAt: UI.S.today, category: gv('s-cat').value, content: gv('s-content').value || '（空）', status: 'pending', resolvedAt: null }); DB.governance.ei.suggestionsRaised += 1; saveDB(); UI.closeModal(); UI.render(); UI.toast('建议已提交（EI 分母 +1）'); },
  resolveObj: (t) => { const o = DB.entities.ObjectionEntry.find(x => x.objId === t.dataset.id); if (o) { o.status = t.dataset.r; o.resolvedAt = UI.S.today; saveDB(); UI.render(); UI.toast('已处理异议'); } },
  resolveSug: (t) => { const s = DB.entities.SuggestionEntry.find(x => x.sugId === t.dataset.id); if (s) { s.status = t.dataset.r; s.resolvedAt = UI.S.today; if (t.dataset.r === 'adopted') DB.governance.ei.suggestionsAdopted += 1; saveDB(); UI.render(); UI.toast('已处理建议'); } },

  // ---- 分红配置 ----
  editDividend: () => { const d = DB.dividend; const g = (k) => d[k];
    UI.openModal(`<div class="modal-head"><h3>编辑三重闸与池</h3><button class="x-btn" data-act="closeModal">×</button></div>
      ${['gateCompanyCollect|公司回款', 'gateCompanyNet|公司净贡献', 'gatePersonalCollect|个人回款'].map(x => { const [k, lbl] = x.split('|'); return `<div class="grid grid-2" style="align-items:center"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="d-${k}-en" ${d[k].enabled ? 'checked' : ''} style="width:auto"> 启用「${lbl}」闸</label><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="d-${k}-ps" ${d[k].pass ? 'checked' : ''} style="width:auto"> 已达标</label></div>`; }).join('')}
      <div class="grid grid-2" style="margin-top:8px"><label class="field"><span class="field-label">池比例（0–1）</span><input id="d-rate" type="number" step="0.01" value="${d.poolRate}"></label>
      <label class="field"><span class="field-label">分红前净贡献（万）</span><input id="d-net" type="number" step="0.1" value="${Money.wanNum(d.netBeforeDividendAmt)}"></label></div>
      <div class="btn-row"><button class="btn btn--primary" data-act="saveDividend">保存并重算</button></div>`); },
  saveDividend: () => { const d = DB.dividend; ['gateCompanyCollect', 'gateCompanyNet', 'gatePersonalCollect'].forEach(k => { d[k].enabled = chk(`d-${k}-en`); d[k].pass = chk(`d-${k}-ps`); }); d.poolRate = num('d-rate'); d.netBeforeDividendAmt = wanFen('d-net'); saveDB(); UI.closeModal(); UI.render(); UI.toast('分红配置已更新'); },

  // ---- 蓝图里程碑 ----
  addMilestone: () => UI.openModal(`<div class="modal-head"><h3>添加里程碑</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <label class="field"><span class="field-label">里程碑名称</span><input id="bp-name" placeholder="如：开出华东新品类"></label>
    <div class="btn-row"><button class="btn btn--primary" data-act="saveMilestone">添加</button></div>`),
  saveMilestone: () => { const n = (gv('bp-name').value || '').trim(); if (!n) { UI.toast('请填写名称'); return; } DB.blueprint.milestones.push({ id: makeId('bp'), name: n, done: false }); saveDB(); UI.closeModal(); UI.render(); UI.toast('里程碑已添加'); },
  toggleMilestone: (t) => { const m = DB.blueprint.milestones.find(x => x.id === t.dataset.id); if (m) { m.done = !m.done; saveDB(); UI.render(); } },

  // ---- 员工 CRUD ----
  addPerson: () => personModal(null),
  editPerson: (t) => personModal(DB.entities.Salesperson.find(s => s.spId === t.dataset.id)),
  savePerson: () => {
    const id = gv('p-id').value; const nm = (gv('p-name').value || '').trim();
    if (!nm) { UI.toast('请填写姓名'); return; }
    const rec = { name: nm, phone: gv('p-phone').value || '', cityTier: gv('p-tier').value, positionType: gv('p-pos').value, level: num('p-level'), hireDate: gv('p-hire').value || UI.S.today, baseSalaryAmt: fen('p-base'), hiringCostAmt: gv('p-cost').value ? fen('p-cost') : getCoef('hiringCostDefaultAmt') };
    if (id) { Object.assign(DB.entities.Salesperson.find(s => s.spId === id), rec); }
    else { DB.entities.Salesperson.push({ spId: makeId('sp'), managerId: null, hireBatchId: null, sourceChannel: 'manual', leaveDate: null, leaveReason: null, isActive: true, ...rec }); }
    saveDB(); UI.closeModal(); UI.render(); UI.toast(id ? '已保存' : '员工已新增');
  },
  togglePerson: (t) => { const s = DB.entities.Salesperson.find(x => x.spId === t.dataset.id); if (s) { s.isActive = !s.isActive; s.leaveDate = s.isActive ? null : UI.S.today; saveDB(); UI.render(); } },

  // ---- 系数 ----
  saveCoef: () => { const ov = { ...(DB.coefOverride || {}) }; document.querySelectorAll('[data-coef]').forEach(inp => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) ov[inp.dataset.coef] = v; }); DB.coefOverride = ov; setCoefOverride(ov); saveDB(); UI.render(); UI.toast('系数已保存（判定即时生效）'); },
  resetCoef: () => { DB.coefOverride = {}; setCoefOverride({}); saveDB(); UI.render(); UI.toast('已恢复出厂系数'); },
});

function personModal(p) {
  p = p || {};
  const opt = (v, cur, txt) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${txt}</option>`;
  UI.openModal(`<div class="modal-head"><h3>${p.spId ? '编辑' : '新增'}员工</h3><button class="x-btn" data-act="closeModal">×</button></div>
    <input type="hidden" id="p-id" value="${p.spId || ''}">
    <div class="grid grid-2">
    <label class="field"><span class="field-label">姓名</span><input id="p-name" value="${UI.esc(p.name || '')}"></label>
    <label class="field"><span class="field-label">手机（查重键）</span><input id="p-phone" value="${UI.esc(p.phone || '')}"></label>
    <label class="field"><span class="field-label">城市档</span><select id="p-tier">${opt('tier1', p.cityTier, '一线')}${opt('tier2', p.cityTier, '二线')}${opt('tier3', p.cityTier, '三线')}${opt('tier34', p.cityTier, '三四线')}</select></label>
    <label class="field"><span class="field-label">岗位</span><select id="p-pos">${opt('sales', p.positionType, '销售')}${opt('manager', p.positionType, '主管')}${opt('executive', p.positionType, '高管')}</select></label>
    <label class="field"><span class="field-label">层级（0–3）</span><input id="p-level" type="number" value="${p.level != null ? p.level : 1}"></label>
    <label class="field"><span class="field-label">入职日</span><input id="p-hire" type="date" value="${p.hireDate || ''}"></label>
    <label class="field"><span class="field-label">底薪（元/月）</span><input id="p-base" type="number" value="${p.baseSalaryAmt != null ? Money.yuan(p.baseSalaryAmt) : ''}"></label>
    <label class="field"><span class="field-label">招聘成本（元，选填）</span><input id="p-cost" type="number" value="${p.hiringCostAmt != null ? Money.yuan(p.hiringCostAmt) : ''}"></label></div>
    <div class="btn-row"><button class="btn btn--primary" data-act="savePerson">保存</button></div>`);
}

function masterNameSafe(id) { const s = DB.entities.Salesperson.find(x => x.spId === id); return s ? s.name : id; }

// ---- 文件工具（file:// 可用；A-17 无网络）----
function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pickFile(cb) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { try { cb(JSON.parse(fr.result)); } catch (_) { UI.toast('文件解析失败'); } }; fr.readAsText(f); };
  inp.click();
}

// 启动
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
