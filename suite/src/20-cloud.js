/* ============================================================
   云端协同（可选）— Supabase 兼容后端（官方云 / 自托管 / 国内云同一份代码）
   - 认证：GoTrue REST（/auth/v1）；数据：PostgREST RPC（/rest/v1/rpc/*）
   - 同步模型：整库 doc + 乐观锁 version（见 saas/schema.sql push_state）
   - 云配置存独立 localStorage key（不进同步文档，避免把本机凭证同步给全租户）
   - 不配置云端 = 纯离线单机版，行为与原来完全一致
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { esc, fmt } = SK;
  const CFG_KEY = 'skab_suite_cloud';

  let C = { url: '', anonKey: '', access_token: null, refresh_token: null, email: null, userId: null, tenantId: null, tenantName: null, role: null, version: null, lastSyncAt: null, autoSync: true };
  try { Object.assign(C, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(C)); } catch (e) {} };
  const connected = () => !!(C.url && C.anonKey && C.access_token);
  const inTenant = () => connected() && !!C.tenantId;

  /* ---------- REST 客户端 ---------- */
  async function api(path, opts = {}, retry = true) {
    const res = await fetch(C.url.replace(/\/$/, '') + path, {
      method: opts.method || 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', apikey: C.anonKey },
        C.access_token ? { Authorization: 'Bearer ' + C.access_token } : {}, opts.headers || {}),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && retry && C.refresh_token) {
      const ok = await refreshToken();
      if (ok) return api(path, opts, false);
    }
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = data && (data.message || data.error_description || data.msg || data.hint) || ('HTTP ' + res.status);
      const err = new Error(msg); err.status = res.status; err.data = data; throw err;
    }
    return data;
  }
  async function refreshToken() {
    try {
      const d = await api('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: C.refresh_token } }, false);
      if (d && d.access_token) { C.access_token = d.access_token; C.refresh_token = d.refresh_token || C.refresh_token; saveCfg(); return true; }
    } catch (e) {}
    C.access_token = null; saveCfg(); return false;
  }
  const rpc = (fn, args) => api('/rest/v1/rpc/' + fn, { body: args || {} });

  /* ---------- 同步 ---------- */
  let pushTimer = null, syncing = false, lastError = null;
  async function loadIdentity() {
    const rows = await rpc('whoami');
    const me = Array.isArray(rows) ? rows[0] : rows;
    if (me && me.tenant_id) { C.tenantId = me.tenant_id; C.tenantName = me.tenant_name; C.role = me.role; C.userId = me.user_id; }
    else { C.tenantId = null; C.tenantName = null; C.role = null; }
    saveCfg();
  }
  async function pullNow(force) {
    const rows = await rpc('pull_state');
    const st = Array.isArray(rows) ? rows[0] : rows;
    if (!st) throw new Error('云端无状态（未入租户？）');
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
      const v = await rpc('push_state', { new_doc: SK.DB, expected_version: C.version || 1 });
      C.version = Number(v); C.lastSyncAt = new Date().toISOString(); lastError = null; saveCfg();
      UI.toast('已同步到云端 · 版本 ' + C.version);
    } catch (e) {
      if (/version conflict/i.test(e.message)) { conflictModal(); }
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
      C.url = g('cl-url').value.trim(); C.anonKey = g('cl-key').value.trim();
      saveCfg(); UI.commit(); UI.toast('已保存服务器配置');
    },
    'cloud.signup': async () => {
      try {
        await api('/auth/v1/signup', { body: { email: g('cl-email').value.trim(), password: g('cl-pass').value } });
        UI.toast('注册成功——若服务端开了邮箱验证，请先去邮箱确认，再登录');
      } catch (e) { UI.toast('注册失败：' + e.message); }
    },
    'cloud.login': async () => {
      try {
        const d = await api('/auth/v1/token?grant_type=password', { body: { email: g('cl-email').value.trim(), password: g('cl-pass').value } });
        C.access_token = d.access_token; C.refresh_token = d.refresh_token;
        C.email = (d.user && d.user.email) || g('cl-email').value.trim();
        saveCfg();
        await loadIdentity();
        if (inTenant()) await pullNow();
        UI.commit(); UI.toast('已登录' + (C.tenantName ? ' · ' + C.tenantName : ''));
      } catch (e) { UI.toast('登录失败：' + e.message); }
    },
    'cloud.logout': () => {
      clearTimeout(pushTimer);
      Object.assign(C, { access_token: null, refresh_token: null, email: null, userId: null, tenantId: null, tenantName: null, role: null, version: null });
      saveCfg(); UI.commit(); UI.toast('已退出（本地数据保留）');
    },
    'cloud.create-tenant': async () => {
      try {
        await rpc('create_tenant', { tenant_name: g('cl-tname').value.trim() || '我的公司', boss_email: C.email });
        await loadIdentity(); await pullNow();
        UI.toast('租户已创建，你是老板（boss）——本地数据已作为首版推送云端');
      } catch (e) { UI.toast('创建失败：' + e.message); }
    },
    'cloud.join-tenant': async () => {
      try {
        await rpc('join_tenant', { invite_code: g('cl-code').value.trim(), member_email: C.email });
        await loadIdentity(); await pullNow();
        UI.toast('已加入 ' + (C.tenantName || '租户') + '——云端数据已拉取到本机');
      } catch (e) { UI.toast('加入失败：' + e.message); }
    },
    'cloud.invite': async d => {
      try {
        const code = await rpc('make_invite', { invite_role: d.role || 'sales' });
        UI.modal(`<h3>邀请码（7 天有效 · 一次性）</h3>
          <div class="hero" style="letter-spacing:.1em">${esc(code)}</div>
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
        const rows = await rpc('pull_state'); const st = Array.isArray(rows) ? rows[0] : rows;
        C.version = Number(st.version); saveCfg();
        await pushNow();
      } catch (e) { UI.toast('覆盖失败：' + e.message); }
    },
  });

  /* ---------- 视图 ---------- */
  SK.registerModule({
    id: 'cloud', title: '云端', icon: '☁️', order: 98,
    subnav: [],
    liveCells: () => [],
    alerts: () => (inTenant() && lastError ? 1 : 0),
    alertList: () => (inTenant() && lastError ? [{ tone: 'a', text: '云同步失败：' + lastError, board: 'cloud' }] : []),
    render() {
      const step = (n, t, on) => `<span class="badge ${on ? 'acc' : 'n'} plain">${n} ${t}</span>`;
      const head = `
      <div class="sect"><h2>云端协同</h2><span class="sub">可选——不配置就是纯离线单机版 · 多租户隔离由数据库 RLS 保证（saas/tests 26 条隔离测试）</span></div>
      <div style="display:flex;gap:6px;margin-bottom:10px">${step('①', '连服务器', C.url)} ${step('②', '登录', connected())} ${step('③', '入租户', inTenant())} ${step('④', '自动同步', inTenant() && C.autoSync)}</div>`;
      if (!C.url || !C.anonKey || !connected()) {
        return head + `<div class="grid g2">
        ${h.card('① 服务器配置', `
          ${h.field('Supabase URL', `<input id="cl-url" type="text" placeholder="https://xxxx.supabase.co 或 https://你的域名" value="${esc(C.url)}">`, '官方云 / 自托管 / 国内服务器均可，schema 见仓库 saas/schema.sql')}
          <div style="height:8px"></div>
          ${h.field('anon key（公开密钥）', `<input id="cl-key" type="text" placeholder="eyJhbGciOi…" value="${esc(C.anonKey)}">`, '项目设置 → API → anon public。它只配合 RLS 使用，可放前端')}
          <div style="margin-top:10px">${h.btn('保存配置', 'cloud.save-cfg', { cls: 'pri' })}</div>`)}
        ${h.card('② 登录 / 注册', C.url && C.anonKey ? `
          ${h.field('邮箱', `<input id="cl-email" type="email" placeholder="you@company.com" value="${esc(C.email || '')}">`)}
          <div style="height:8px"></div>
          ${h.field('密码', `<input id="cl-pass" type="password" placeholder="≥6 位">`)}
          <div style="margin-top:10px;display:flex;gap:8px">${h.btn('登录', 'cloud.login', { cls: 'pri' })}${h.btn('注册新账号', 'cloud.signup')}</div>` : h.banner('先完成 ① 服务器配置', 'n'))}
        </div>
        ${h.banner('部署指南见仓库 <b>saas/README.md</b>：官方云 5 分钟起步；卖国内客户建议国内服务器自托管（同一份 schema 与前端，零改动迁移）。注意：claude.ai 托管的 Artifact 版禁止外联，云端协同请用下载版单文件或自部署网页。', 'b')}`;
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
        ${h.card(`✅ ${esc(C.tenantName || '')} <span class="sub">${C.role === 'boss' ? '老板' : '销售'} · ${esc(C.email || '')}</span>`, h.kv([
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
