/* ============================================================
   云端协同（可选）— 对接自有云端 API（cloud/api，Step 1–2 已验收）
   - 认证：POST /v1/auth/{register,login,logout}（邮箱+密码，Bearer 令牌）
   - 数据：GET/PUT /v1/state —— 整库 doc + 乐观锁 version（schema push_state 语义）
   - 租户：POST /v1/tenants（建）/ /v1/invites（邀请码）/ /v1/join（凭码加入）
   - 云配置存独立 localStorage key（不进同步文档，避免把本机凭证同步给全租户）
   - 不配置云端 = 纯离线单机版，行为与原来完全一致
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { esc } = SK;
  const CFG_KEY = 'skab_suite_cloud';

  let C = { url: '', token: null, email: null, userId: null, tenantId: null, tenantName: null, role: null, version: null, lastSyncAt: null, autoSync: true };
  try { Object.assign(C, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(C)); } catch (e) {} };
  const connected = () => !!(C.url && C.token);
  const inTenant = () => connected() && !!C.tenantId;
  /* 🔴 云端 Web 模式：页面经 http(s) 由服务器托管 = SaaS 部署 → 强制登录；
     以 file:// 直接打开 = 离线单机版 → 不设闸，行为不变。API 同源(origin)自动带出。 */
  const webMode = location.protocol === 'http:' || location.protocol === 'https:';
  if (webMode && !C.url) { C.url = location.origin; saveCfg(); }

  /* ---------- REST 客户端（原生 API：错误体 {error:{code,message}}） ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(C.url.replace(/\/$/, '') + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        C.token ? { Authorization: 'Bearer ' + C.token } : {}),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const code = data && data.error && data.error.code || '';
      const msg = data && data.error && data.error.message || ('HTTP ' + res.status);
      if (res.status === 401 && C.token && code !== 'BAD_CREDENTIALS') {   // 会话过期：清令牌，回登录页
        C.token = null; saveCfg(); UI.commit();
      }
      const err = new Error(msg); err.status = res.status; err.code = code; throw err;
    }
    return data;
  }

  /* ---------- 同步 ---------- */
  let pushTimer = null, syncing = false, lastError = null;
  async function loadIdentity() {
    const d = await api('/v1/me');
    const me = d.memberships && d.memberships[0];
    if (me && me.tenant_id) { C.tenantId = me.tenant_id; C.tenantName = me.tenant_name; C.role = me.role; C.userId = me.user_id; }
    else { C.tenantId = null; C.tenantName = null; C.role = null; }
    saveCfg();
  }
  async function pullNow() {
    const st = await api('/v1/state');
    const remoteEmpty = !st.doc || Object.keys(st.doc).length === 0;
    if (remoteEmpty) {                       // 云端还是空的：把本地作为首版推上去
      C.version = Number(st.version); saveCfg();
      return pushNow();
    }
    localStorage.setItem(SK.LS_KEY, JSON.stringify(st.doc));
    SK.loadDB();
    C.version = Number(st.version); C.lastSyncAt = new Date().toISOString(); lastError = null; saveCfg();
    UI.applyTheme(); UI.commit();
    /* 🔴 拉取即最新：commit 触发的去抖自动推送要取消——刚从云端拉下来的 doc
       原样推回只会白烧版本号（并放大多端环回）。 */
    clearTimeout(pushTimer); pushTimer = null;
  }
  async function pushNow() {
    if (!inTenant()) return;
    if (syncing) return; syncing = true;
    try {
      const d = await api('/v1/state', { method: 'PUT', body: { doc: SK.DB, version: C.version || 1 } });
      C.version = Number(d.version); C.lastSyncAt = new Date().toISOString(); lastError = null; saveCfg();
      UI.toast('已同步到云端 · 版本 ' + C.version);
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT') { conflictModal(); }
      else if (e.code === 'TENANT_SUSPENDED') { lastError = '订阅已停机（数据可导出，恢复订阅后可继续写入）'; UI.toast('⚠ ' + lastError); }
      else { lastError = e.message; UI.toast('云同步失败：' + e.message); }
    } finally { syncing = false; UI.render(); }
  }
  function conflictModal() {
    UI.modal(`<h3>⚠️ 云端有更新的版本</h3>
      <p class="hint">其他设备/同事在你之后改过数据。选择保留哪份（另一份会被覆盖，覆盖前建议先导出备份）：</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        ${h.btn('拉取云端，放弃本地改动', 'cloud.conflict-pull', { cls: 'pri' })}
        ${h.btn('强制用本地覆盖云端', 'cloud.conflict-push', { cls: 'danger' })}
        ${h.btn('先导出本地备份', 'data.export')}
      </div>`);
  }
  // 钩住本地持久化：任何 UI.commit → 落库后 3 秒去抖自动推送
  const rawPersist = SK.persist.bind(SK);
  SK.persist = function () {
    const ok = rawPersist();
    if (ok && inTenant() && C.autoSync) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => pushNow(), 3000);
    }
    return ok;
  };

  /* ---------- 动作 ---------- */
  const g = id => document.getElementById(id);
  Object.assign(SK.actions, {
    'cloud.save-cfg': () => {
      C.url = g('cl-url').value.trim();
      saveCfg(); UI.commit(); UI.toast('已保存服务器配置');
    },
    'cloud.signup': async () => {
      try {
        const d = await api('/v1/auth/register', { method: 'POST', body: { email: g('cl-email').value.trim(), password: g('cl-pass').value } });
        C.token = d.token; C.email = d.email; C.userId = d.userId;
        saveCfg();
        await loadIdentity();
        UI.commit(); UI.toast('注册成功，已自动登录');
      } catch (e) { UI.toast('注册失败：' + e.message); }
    },
    'cloud.login': async () => {
      try {
        const d = await api('/v1/auth/login', { method: 'POST', body: { email: g('cl-email').value.trim(), password: g('cl-pass').value } });
        C.token = d.token; C.email = d.email; C.userId = d.userId;
        saveCfg();
        const sess = await api('/v1/auth/session');       // 取强制改密标记
        C.mustChange = sess.mustChangePassword === true; saveCfg();
        if (C.mustChange) { UI.commit(); UI.toast('首次登录，请先设置你自己的密码'); return; }
        await loadIdentity();
        if (inTenant()) await pullNow();
        UI.commit(); UI.toast('已登录' + (C.tenantName ? ' · ' + C.tenantName : ''));
      } catch (e) { UI.toast('登录失败：' + e.message); }
    },
    'cloud.logout': async () => {
      clearTimeout(pushTimer);
      try { if (connected()) await api('/v1/auth/logout', { method: 'POST', body: {} }); } catch (e) {}
      Object.assign(C, { token: null, email: null, userId: null, tenantId: null, tenantName: null, role: null, version: null, mustChange: false });
      teamCache = null; cardsCache = null;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      saveCfg(); UI.commit(); UI.toast('已退出（本地数据保留）');
    },
    'cloud.create-tenant': async () => {
      try {
        await api('/v1/tenants', { method: 'POST', body: { name: g('cl-tname').value.trim() || '我的公司', email: C.email } });
        teamCache = null; cardsCache = null;
        await loadIdentity(); await pullNow();
        UI.toast('租户已创建，你是老板（boss）——本地数据已作为首版推送云端');
      } catch (e) { UI.toast('创建失败：' + e.message); }
    },
    'cloud.join-tenant': async () => {
      try {
        await api('/v1/join', { method: 'POST', body: { code: g('cl-code').value.trim(), email: C.email } });
        teamCache = null; cardsCache = null;
        await loadIdentity(); await pullNow();
        UI.toast('已加入 ' + (C.tenantName || '租户') + '——云端数据已拉取到本机');
      } catch (e) { UI.toast('加入失败：' + e.message); }
    },
    'cloud.invite': async d => {
      try {
        const r = await api('/v1/invites', { method: 'POST', body: { role: d.role || 'sales' } });
        UI.modal(`<h3>邀请码（7 天有效 · 一次性）</h3>
          <div class="hero" style="letter-spacing:.1em">${esc(r.code)}</div>
          <p class="hint">发给同事：TA 在自己电脑打开本系统 → 云端协同 → 注册登录 → 凭码加入。角色：${d.role === 'boss' ? '老板' : '销售'}。</p>
          <div style="display:flex;justify-content:flex-end;margin-top:12px">${h.btn('关闭', 'ui.modal-close')}</div>`);
      } catch (e) { UI.toast('生成失败：' + e.message); }
    },
    'cloud.cards-refresh': async () => {
      try {
        cardsLoading = true; UI.render();
        const [cd, bf] = await Promise.all([api('/v1/cards/today'), api('/v1/brief')]);
        cardsCache = { todos: cd.todos, alerts: cd.alerts, brief: bf.brief, at: new Date().toISOString(), error: null };
      } catch (e) {
        cardsCache = { todos: [], alerts: { shown: [], folded: [] }, brief: null, error: e.message };
      } finally { cardsLoading = false; UI.render(); }
    },
    'cloud.card-next': async d => {
      try {
        await api('/v1/cards/' + d.id + '/transition', { method: 'POST', body: { toState: d.to } });
        UI.toast('卡片已流转 → ' + (STATE_CN[d.to] || d.to));
        SK.actions['cloud.cards-refresh']();
      } catch (e) { UI.toast('流转失败：' + e.message); }
    },
    'cloud.team-refresh': async () => {
      try {
        teamLoading = true; UI.render();
        const [mem, sub, wl] = await Promise.all([
          api('/v1/members'), api('/v1/subscription'),
          isMgmt() ? api('/v1/whitelist') : Promise.resolve({ whitelist: [] }),
        ]);
        teamCache = { members: mem.members, sub: sub.subscription, seats: sub.seats,
          whitelist: wl.whitelist, at: new Date().toISOString(), error: null };
      } catch (e) {
        teamCache = { members: null, error: e.status === 403 ? '成员列表仅管理层可见' : e.message };
      } finally { teamLoading = false; UI.render(); }
    },
    'cloud.wl-add': async () => {
      const contact = (g('wl-contact') || {}).value || '', role = (g('wl-role') || {}).value || 'sales';
      if (!contact.trim()) { UI.toast('先填邮箱或手机号'); return; }
      try {
        await api('/v1/whitelist', { method: 'POST', body: { contact, role } });
        UI.toast('已加入白名单——对方注册/登录即自动入位');
        SK.actions['cloud.team-refresh']();
      } catch (e) { UI.toast('添加失败：' + e.message); }
    },
    'cloud.wl-del': async d => {
      try {
        await api('/v1/whitelist/' + encodeURIComponent(d.contact), { method: 'DELETE' });
        UI.toast('已移出白名单');
        SK.actions['cloud.team-refresh']();
      } catch (e) { UI.toast('删除失败：' + e.message); }
    },
    'cloud.member-off': async d => {
      try {
        await api('/v1/members/' + d.uid + '/deactivate', { method: 'POST', body: {} });
        UI.toast('已停用：档案与业绩留在公司，席位已释放');
        SK.actions['cloud.team-refresh']();
      } catch (e) { UI.toast('停用失败：' + e.message); }
    },
    'cloud.member-on': async d => {
      try {
        await api('/v1/members/' + d.uid + '/reactivate', { method: 'POST', body: {} });
        UI.toast('已复职：新席位已占用');
        SK.actions['cloud.team-refresh']();
      } catch (e) { UI.toast('复职失败：' + e.message); }
    },
    'cloud.member-reset': async d => {
      try {
        const r = await api('/v1/members/' + d.uid + '/reset-password', { method: 'POST', body: {} });
        UI.modal(`<h3>临时密码已生成</h3>
          <p class="hint">把下面这串临时密码线下告诉该成员，TA 首次登录后系统会强制改成自己的密码。</p>
          <div class="hero" style="letter-spacing:.15em;font-family:ui-monospace,monospace">${esc(r.tempPassword)}</div>
          <div style="display:flex;justify-content:flex-end;margin-top:12px">${h.btn('知道了', 'ui.modal-close', { cls: 'pri' })}</div>`);
      } catch (e) { UI.toast('重置失败：' + e.message); }
    },
    'cloud.change-pw': async () => {
      const oldP = (g('cpw-old') || {}).value || '', newP = (g('cpw-new') || {}).value || '', newP2 = (g('cpw-new2') || {}).value || '';
      if (newP !== newP2) { UI.toast('两次新密码不一致'); return; }
      try {
        await api('/v1/auth/change-password', { method: 'POST', body: { oldPassword: oldP, newPassword: newP } });
        C.token = null; C.mustChange = false; saveCfg();
        UI.toast('密码已修改，请用新密码重新登录'); UI.commit();
      } catch (e) { UI.toast('修改失败：' + e.message); }
    },
    'cloud.push': () => pushNow(),
    'cloud.pull': async () => { try { await pullNow(); UI.toast('已拉取云端最新版本 ' + C.version); } catch (e) { UI.toast('拉取失败：' + e.message); } },
    'cloud.autosync': () => { C.autoSync = !C.autoSync; saveCfg(); UI.commit(); },
    'cloud.conflict-pull': async () => { UI.closeModal(); try { await pullNow(); UI.toast('已用云端版本覆盖本地'); } catch (e) { UI.toast('拉取失败：' + e.message); } },
    'cloud.conflict-push': async () => {
      UI.closeModal();
      try {
        const st = await api('/v1/state');                 // 取云端当前版本号，用本地 doc 覆盖
        C.version = Number(st.version); saveCfg();
        await pushNow();
      } catch (e) { UI.toast('覆盖失败：' + e.message); }
    },
  });

  /* ---------- 视图 ---------- */
  const ROLE_CN = { boss: '老板', exec: '高管', manager: '主管', recruiter: '招聘', sales: '销售' };
  const BOARD_CN = { dingjia: '定价', zhaoren: '招人', suanzhang: '算账', liuren: '留人', yuren: '育人' };
  let teamCache = null, teamLoading = false;             // 成员/席位/订阅缓存（进租户视图首渲自动拉一次）
  let cardsCache = null, cardsLoading = false, pollTimer = null;   // 今日卡/早报 + 30s 轮询
  const isMgmt = () => ['boss', 'exec', 'manager'].includes(C.role);
  const KIND_CN = { stopbleed: '止血', retain: '留任', talk: '该谈', salary_review: '薪酬复核', eliminate: '汰换评估', coaching: '带教', honor: '履约', spotcheck: '抽检', expand: '扩编', newhire_judge: '新人判定' };
  const STATE_CN = { pending: '待处理', assigned: '已认领', doing: '进行中', done: '已完成', filled: '已归档' };
  const NEXT_STATE = { pending: ['assigned', '认领'], assigned: ['doing', '开工'], doing: ['done', '完成'], done: ['filled', '归档'] };
  function ensurePolling() {                             // 仅云端板块 + 已入租户时静默轮询
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (!inTenant() || !location.hash.startsWith('#/cloud')) return;
      if (!cardsLoading) SK.actions['cloud.cards-refresh']();
    }, 30000);
  }
  function cardRowHtml(c) {
    const nx = NEXT_STATE[c.state];
    const title = (c.payload && (c.payload.title || c.payload.reason)) || c.targetId || '';
    return `<tr>
      <td><span class="badge ${c.payload && c.payload.level === 'alert' ? 'r' : 'acc'} plain">${KIND_CN[c.kind] || c.kind}</span></td>
      <td>${esc(String(title).slice(0, 40))}</td>
      <td class="hint">${STATE_CN[c.state] || c.state}</td>
      <td>${isMgmt() && nx ? `<button class="btn sm" data-act="cloud.card-next" data-id="${c.cardId}" data-to="${nx[0]}">${nx[1]}</button>` : ''}</td></tr>`;
  }
  function cardsCardHtml() {
    if (!cardsCache && !cardsLoading) SK.actions['cloud.cards-refresh']();   // 首渲自动加载
    ensurePolling();
    const cc = cardsCache || { todos: [], alerts: { shown: [], folded: [] }, brief: null };
    const rows = [...(cc.alerts && cc.alerts.shown || []), ...(cc.todos || [])].map(cardRowHtml).join('');
    const folded = cc.alerts && cc.alerts.folded && cc.alerts.folded.length || 0;
    const b = cc.brief, bs = b && b.sections || {};
    const briefBits = b ? [
      bs.missing ? `未填日报 ${bs.missing.length} 人` : '',
      bs.cards ? `今日卡 ${bs.cards.todoCount} 张` : '',
      bs.fourLights ? `⚠ ${bs.fourLights.hint}` : '',
      bs.guard ? `守护线候选 ${bs.guard.count} 人` : '',
    ].filter(Boolean) : [];
    return h.card('📌 今日一件事 <span class="sub">云端插卡 · 30 秒自动刷新</span>', `
      ${cardsLoading && !cardsCache ? '<p class="hint">加载中…</p>' : ''}
      ${cc.error ? h.banner(esc(cc.error), 'n') : ''}
      ${rows ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>类型</th><th>事项</th><th>状态</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>${folded ? `<p class="hint">另有 ${folded} 张预警折叠（每日限 3 张展示）</p>` : ''}`
        : (cardsCache && !cc.error ? '<p class="hint">今天没有待办插卡 ✓</p>' : '')}
      ${b === null && cardsCache && !cc.error ? '<p class="hint">☀️ 今日休息日——零推送（早报静默）</p>' : ''}
      ${briefBits.length ? `<div style="margin-top:8px;padding:9px 12px;background:var(--panel);border-radius:9px;font-size:12.5px">📰 <b>今日早报</b> · ${b.date}：${briefBits.map(esc).join(' · ')}</div>` : ''}
      <div style="margin-top:9px">${h.btn(cardsLoading ? '刷新中…' : '刷新', 'cloud.cards-refresh', { cls: 'sm' })}</div>`);
  }
  function teamCardHtml() {
    if (isMgmt() && !teamCache && !teamLoading) SK.actions['cloud.team-refresh']();   // 首渲自动加载
    const seats = teamCache && teamCache.seats, sub = teamCache && teamCache.sub;
    const boards = (sub && sub.boards_enabled || []).map(b => `<span class="badge acc plain">${BOARD_CN[b] || b}</span>`).join(' ');
    const isBoss = C.role === 'boss';
    const memRows = (teamCache && teamCache.members || []).map(m =>
      `<tr><td>${esc(m.email || m.user_id.slice(0, 8) + '…')}</td>
        <td>${ROLE_CN[m.role] || esc(m.role)}</td>
        <td>${m.is_active ? '在职' : '<span style="color:var(--ink3)">停用</span>'}</td>
        <td class="hint">${String(m.joined_at || '').slice(0, 10)}</td>
        <td>${isBoss && m.user_id !== C.userId
          ? (m.is_active
            ? `<button class="btn sm ghost" data-act="cloud.member-reset" data-uid="${m.user_id}">重置密码</button> <button class="btn sm ghost" data-act="cloud.member-off" data-uid="${m.user_id}">停用</button>`
            : `<button class="btn sm" data-act="cloud.member-on" data-uid="${m.user_id}">复职</button>`)
          : ''}</td></tr>`).join('');
    const wlRows = (teamCache && teamCache.whitelist || []).map(w =>
      `<tr><td class="mono">${esc(w.contact)}</td>
        <td>${w.kind === 'phone' ? '手机' : '邮箱'}</td>
        <td>${ROLE_CN[w.role] || esc(w.role)}</td>
        <td>${w.used_by ? '<span style="color:var(--green)">已入位</span>' : '<span class="hint">待注册</span>'}</td>
        <td>${isBoss && !w.used_by ? `<button class="btn sm ghost" data-act="cloud.wl-del" data-contact="${esc(w.contact)}">移除</button>` : ''}</td></tr>`).join('');
    return h.card('👥 成员与席位', `
      ${teamLoading ? '<p class="hint">加载中…</p>' : ''}
      ${teamCache && teamCache.error ? h.banner(esc(teamCache.error), 'n') : ''}
      ${seats ? h.kv([
        { k: '席位', v: `<b>${seats.used} / ${seats.quota}</b>` },
        { k: '订阅状态', v: sub && sub.status === 'active' ? '<span style="color:var(--green)">正常</span>' : esc(sub && sub.status || '—') },
        { k: '板块授权', v: boards || '—' },
      ]) : ''}
      ${memRows ? `<div class="tbl-wrap" style="margin-top:8px"><table class="tbl">
        <thead><tr><th>成员</th><th>角色</th><th>状态</th><th>加入</th><th></th></tr></thead>
        <tbody>${memRows}</tbody></table></div>` : ''}
      ${isMgmt() ? `<div style="margin-top:12px"><b style="font-size:12.8px">📋 注册白名单</b>
        <span class="hint">（预登记邮箱/手机号+角色，对方注册或登录即自动入位，免邀请码；换人=停用旧人+登记新人）</span></div>
      ${wlRows ? `<div class="tbl-wrap" style="margin-top:6px"><table class="tbl">
        <thead><tr><th>联系方式</th><th>类型</th><th>预设角色</th><th>状态</th><th></th></tr></thead>
        <tbody>${wlRows}</tbody></table></div>` : '<p class="hint" style="margin-top:4px">还没有白名单条目</p>'}
      ${isBoss ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <input id="wl-contact" type="text" placeholder="邮箱 或 11 位手机号" style="flex:1 1 160px;min-width:140px">
        <select id="wl-role"><option value="sales">销售</option><option value="manager">主管</option><option value="recruiter">招聘</option><option value="exec">高管</option><option value="boss">老板</option></select>
        ${h.btn('加入白名单', 'cloud.wl-add', { cls: 'sm pri' })}</div>
        <p class="hint" style="margin-top:5px">手机号可先登记（短信验证上线后即用手机号注册）；邮箱现在就生效。</p>` : ''}` : ''}
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${isMgmt() ? h.btn(teamLoading ? '刷新中…' : '刷新', 'cloud.team-refresh', { cls: 'sm' }) : ''}
        ${isBoss ? h.btn('邀请码(兜底)', 'cloud.invite', { cls: 'sm ghost', data: 'data-role="sales"' }) : ''}
      </div>
      <p class="hint" style="margin-top:8px">停用成员：档案与业绩留在公司（审计不灭），席位释放给新人；复职需席位配额内。</p>`);
  }
  /* ---------- 登录闸（Salesforce 式：未登录纯白页只显示登录框，隐藏整个应用） ---------- */
  function renderAuthGate() {
    const brand = `<div class="ag-brand"><div class="ag-logo">销</div><div class="ag-name">销冠操盘系统</div></div>`;
    if (!connected()) {                                  // ① 未登录 → 登录/注册
      return `<div class="authgate"><div class="ag-card">${brand}
        <div class="ag-title">登录 / 注册</div>
        <div class="frm">
          ${h.field('邮箱', `<input id="cl-email" type="email" autocomplete="username" placeholder="you@company.com" value="${esc(C.email || '')}">`)}
          ${h.field('密码', `<input id="cl-pass" type="password" autocomplete="current-password" placeholder="≥8 位，含字母和数字">`)}
        </div>
        <div class="ag-actions">${h.btn('登 录', 'cloud.login', { cls: 'pri ag-btn' })}${h.btn('注册新账号', 'cloud.signup', { cls: 'ag-btn ghost' })}</div>
        <p class="ag-foot">连错 5 次密码将临时锁定 15 分钟</p>
      </div></div>`;
    }
    if (C.mustChange) {                                  // ② 临时密码首登 → 强制改密
      return `<div class="authgate"><div class="ag-card">${brand}
        <div class="ag-title">🔐 首次登录 · 设置密码</div>
        <p class="ag-sub">管理员给你的是一次性临时密码，请改成你自己的密码。</p>
        <div class="frm">
          ${h.field('临时密码', `<input id="cpw-old" type="password" placeholder="临时密码">`)}
          ${h.field('新密码（≥8 位，含字母和数字）', `<input id="cpw-new" type="password">`)}
          ${h.field('再输一次新密码', `<input id="cpw-new2" type="password">`)}
        </div>
        <div class="ag-actions">${h.btn('设置新密码并进入', 'cloud.change-pw', { cls: 'pri ag-btn' })}</div>
      </div></div>`;
    }
    return `<div class="authgate"><div class="ag-card ag-wide">${brand}
      <div class="ag-title">开通你的团队</div>
      <p class="ag-sub">当前登录：${esc(C.email || '')} · <button class="btn sm ghost" data-act="cloud.logout">退出</button></p>
      <div class="ag-two">
        <div class="ag-col"><div class="ag-col-h">我是老板 · 创建团队</div>
          ${h.field('公司 / 团队名', `<input id="cl-tname" type="text" placeholder="如：王总的公司">`)}
          ${h.btn('创建团队', 'cloud.create-tenant', { cls: 'pri ag-btn' })}</div>
        <div class="ag-col"><div class="ag-col-h">我被邀请 · 加入团队</div>
          ${h.field('邀请码', `<input id="cl-code" type="text" placeholder="12 位邀请码" style="letter-spacing:.08em">`)}
          ${h.btn('凭码加入', 'cloud.join-tenant', { cls: 'ag-btn' })}</div>
      </div>
    </div></div>`;
  }
  SK.authGate = {
    required: () => webMode && !(connected() && inTenant() && !C.mustChange),
    render: renderAuthGate,
  };

  SK.registerModule({
    id: 'cloud', title: '云端', icon: '☁️', order: 98,
    subnav: [],
    liveCells: () => [],
    alerts: () => (inTenant() && lastError ? 1 : 0),
    alertList: () => (inTenant() && lastError ? [{ tone: 'a', text: '云同步失败：' + lastError, board: 'cloud' }] : []),
    render() {
      const step = (n, t, on) => `<span class="badge ${on ? 'acc' : 'n'} plain">${n} ${t}</span>`;
      const head = `
      <div class="sect"><h2>云端协同</h2><span class="sub">可选——不配置就是纯离线单机版 · 多租户隔离由数据库 RLS 保证（cloud/tests 全套隔离与攻防测试）</span></div>
      <div style="display:flex;gap:6px;margin-bottom:10px">${step('①', '连服务器', C.url)} ${step('②', '登录', connected())} ${step('③', '入租户', inTenant())} ${step('④', '自动同步', inTenant() && C.autoSync)}</div>`;
      if (connected() && C.mustChange) {                   // 强制改密闸：临时密码首登必须先改
        return head + h.card('🔐 首次登录 · 设置你的密码', `
          <p class="hint" style="margin-bottom:8px">管理员给你的是一次性临时密码，请设置成你自己的密码后再使用。</p>
          <div class="frm">
            ${h.field('临时密码（管理员给你的）', `<input id="cpw-old" type="password" placeholder="临时密码">`)}
            ${h.field('新密码（≥8 位，含字母和数字）', `<input id="cpw-new" type="password">`)}
            ${h.field('再输一次新密码', `<input id="cpw-new2" type="password">`)}
          </div>
          <div style="margin-top:10px">${h.btn('设置新密码', 'cloud.change-pw', { cls: 'pri' })}</div>`);
      }
      if (!C.url || !connected()) {
        return head + `<div class="grid g2">
        ${h.card('① 服务器配置', `
          ${h.field('云端 API 地址', `<input id="cl-url" type="text" placeholder="https://api.你的域名 或 http://127.0.0.1:8787" value="${esc(C.url)}">`, '部署见仓库 cloud/api（node api/index.mjs 即起）；数据隔离由数据库 RLS 保证')}
          <div style="margin-top:10px">${h.btn('保存配置', 'cloud.save-cfg', { cls: 'pri' })}</div>`)}
        ${h.card('② 登录 / 注册', C.url ? `
          ${h.field('邮箱', `<input id="cl-email" type="email" placeholder="you@company.com" value="${esc(C.email || '')}">`)}
          <div style="height:8px"></div>
          ${h.field('密码', `<input id="cl-pass" type="password" placeholder="≥8 位，含字母和数字">`)}
          <div style="margin-top:10px;display:flex;gap:8px">${h.btn('登录', 'cloud.login', { cls: 'pri' })}${h.btn('注册新账号', 'cloud.signup')}</div>` : h.banner('先完成 ① 服务器配置', 'n'))}
        </div>
        ${h.banner('云端版：数据存服务器，老板与同事多端协同、实时同步；注册即登录，连错 5 次密码将临时锁定 15 分钟。', 'b')}`;
      }
      if (!inTenant()) {
        return head + `<div class="grid g2">
        ${h.card('创建新租户（我是老板）', `
          ${h.field('公司/团队名', `<input id="cl-tname" type="text" placeholder="如：王总的公司" value="${esc(SK.DB.company.name)}">`)}
          <p class="hint" style="margin:8px 0">创建后：本机当前数据将作为首版推上云端；你可生成邀请码拉同事加入。</p>
          ${h.btn('创建租户', 'cloud.create-tenant', { cls: 'pri' })}`)}
        ${h.card('加入已有租户（我被邀请）', `
          ${h.field('邀请码', `<input id="cl-code" type="text" placeholder="12 位邀请码" style="letter-spacing:.08em">`)}
          <p class="hint" style="margin:8px 0">加入后：云端租户数据会拉取到本机（覆盖本机现有数据，如有需要请先到数据中心导出备份）。</p>
          ${h.btn('凭码加入', 'cloud.join-tenant')}`)}
        </div>
        ${h.banner(`当前登录：${esc(C.email || '')} · <button class="btn sm" data-act="cloud.logout">退出登录</button>`, 'n')}`;
      }
      return head + `<div class="grid g2">
        ${h.card(`✅ ${esc(C.tenantName || '')} <span class="sub">${ROLE_CN[C.role] || esc(C.role || '')} · ${esc(C.email || '')}</span>`, h.kv([
          { k: '同步状态', v: lastError ? `<span style="color:var(--amber)">上次失败：${esc(lastError)}</span>` : (syncing ? '同步中…' : '正常') },
          { k: '云端版本', v: String(C.version || SK.DASH) },
          { k: '最近同步', v: C.lastSyncAt ? C.lastSyncAt.replace('T', ' ').slice(0, 19) : SK.DASH },
          { k: '自动同步（改动后 3 秒推送）', v: `<button class="btn sm ${C.autoSync ? 'pri' : ''}" data-act="cloud.autosync">${C.autoSync ? '已开启' : '已关闭'}</button>` },
        ]) + `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          ${h.btn('立即推送', 'cloud.push', { cls: 'pri' })}${h.btn('拉取云端', 'cloud.pull')}${h.btn('退出登录', 'cloud.logout')}</div>`)}
        ${teamCardHtml()}
        ${cardsCardHtml()}
      </div>
      ${h.banner('v1 说明：同租户成员共享整库读写（销售端页面自我约束展示）；细粒度行级角色权限（销售只能写自己的日报/回执）在 v2 拆表时由 RLS 落库。', 'a')}
      ${h.banner('冲突策略：推送带乐观锁版本号，云端更新时会弹窗让你选保留哪份——不会静默覆盖。多设备同时编辑建议错峰，或以老板机为主录入端。', 'n')}`;
    },
  });
})();
