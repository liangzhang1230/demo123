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
