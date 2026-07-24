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
        await loadIdentity();
        if (inTenant()) await pullNow();
        UI.commit(); UI.toast('已登录' + (C.tenantName ? ' · ' + C.tenantName : ''));
      } catch (e) { UI.toast('登录失败：' + e.message); }
    },
    'cloud.logout': async () => {
      clearTimeout(pushTimer);
      try { if (connected()) await api('/v1/auth/logout', { method: 'POST', body: {} }); } catch (e) {}
      Object.assign(C, { token: null, email: null, userId: null, tenantId: null, tenantName: null, role: null, version: null });
      saveCfg(); UI.commit(); UI.toast('已退出（本地数据保留）');
    },
    'cloud.create-tenant': async () => {
      try {
        await api('/v1/tenants', { method: 'POST', body: { name: g('cl-tname').value.trim() || '我的公司', email: C.email } });
        await loadIdentity(); await pullNow();
        UI.toast('租户已创建，你是老板（boss）——本地数据已作为首版推送云端');
      } catch (e) { UI.toast('创建失败：' + e.message); }
    },
    'cloud.join-tenant': async () => {
      try {
        await api('/v1/join', { method: 'POST', body: { code: g('cl-code').value.trim(), email: C.email } });
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
        ${h.banner('说明：云端版数据存服务器（老板/同事多端协同）；不配置则数据只在本机。注册即登录；连错 5 次密码锁 15 分钟。注意：claude.ai 托管的 Artifact 版禁止外联，云端协同请用下载版单文件或自部署网页。', 'b')}`;
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
        ${h.card('👥 邀请同事', `
          <p class="hint" style="margin-bottom:8px">邀请码 7 天有效、一次性。同事登录后凭码加入，即与你共享同一租户数据（实时总线照常，改动互相同步）。</p>
          ${C.role === 'boss' ? `<div style="display:flex;gap:8px">${h.btn('生成销售邀请码', 'cloud.invite', { cls: 'pri', data: 'data-role="sales"' })}${h.btn('生成老板邀请码', 'cloud.invite', { data: 'data-role="boss"' })}</div>` : h.banner('只有老板角色能生成邀请码', 'n')}
          ${h.banner('v1 说明：同租户成员共享整库读写（销售端页面自我约束展示）；细粒度行级角色权限（销售只能写自己的日报/回执）在 v2 拆表时由 RLS 落库。', 'a')}`)}
      </div>
      ${h.banner('冲突策略：推送带乐观锁版本号，云端更新时会弹窗让你选保留哪份——不会静默覆盖。多设备同时编辑建议错峰，或以老板机为主录入端。', 'n')}`;
    },
  });
})();
