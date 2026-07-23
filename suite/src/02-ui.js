/* ============================================================
   UI 外壳 — 组件库 / 顶部导航 / 全局实时指标条 / 路由 / 数据绑定
   交互公约：
   - 点击 [data-act="ns.name"] → SK.actions['ns.name'](dataset, el, ev)
   - 表单 [data-bind="path"] + data-type(int|num|wan|pct100|str|bool|fen-yuan)
     change → 写 DB → SK.commit()（持久化+全量重渲染，全站实时换算）
   - input 事件只刷 [data-out]（滑杆实时回显），不打断输入焦点
   ============================================================ */
(() => {
  'use strict';
  const { esc, fmt, DASH } = SK;

  /* ---------- 组件库 ---------- */
  const h = {
    card: (title, body, opts = {}) => `<div class="card ${opts.cls || ''}">${title ? `<h3>${title}${opts.right ? `<span class="right">${opts.right}</span>` : ''}</h3>` : ''}${body}</div>`,
    kv: rows => rows.map(r => `<div class="kv ${r.total ? 'total' : ''}"><span class="k">${r.k}</span><b class="${r.cls || ''}">${r.v}</b></div>`).join(''),
    tbl: (cols, rows, opts = {}) => `<div class="tbl-wrap"><table class="tbl">${opts.noHead ? '' : `<thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.t}</th>`).join('')}</tr></thead>`}<tbody>${rows.length ? rows.join('') : `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--ink3)">${opts.empty || '暂无数据'}</td></tr>`}</tbody></table></div>`,
    badge: (t, tone = 'n', plain = false) => `<span class="badge ${tone} ${plain ? 'plain' : ''}">${t}</span>`,
    meter: (ratio, tone = '', bands = []) => `<div class="meter"><i class="${tone}" style="width:${Math.round(SK.clamp(ratio == null ? 0 : ratio, 0, 1) * 100)}%"></i>${bands.map(b => `<span class="band" style="left:${b * 100}%"></span>`).join('')}</div>`,
    banner: (t, tone = 'n') => `<div class="banner ${tone}">${t}</div>`,
    action: (title, body, tone = '', btns = '') => `<div class="action-card ${tone}"><h4>${title}</h4><div>${body}</div>${btns ? `<div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap">${btns}</div>` : ''}</div>`,
    btn: (label, act, opts = {}) => `<button class="btn ${opts.cls || ''}" data-act="${act}" ${opts.data || ''} ${opts.disabled ? 'disabled' : ''} ${opts.title ? `title="${esc(opts.title)}"` : ''}>${label}</button>`,
    hero: (v, label, tone = '', small = false) => `<div><div class="hero ${small ? 'sm' : ''} ${tone}">${v}</div><div class="hint">${label}</div></div>`,
    src: t => `<div class="src">${t}</div>`,
    hint: t => `<div class="hint">${t}</div>`,
    acc: (sum, body, open = false) => `<details class="acc" ${open ? 'open' : ''}><summary>${sum}</summary><div class="acc-body">${body}</div></details>`,
    dot: tone => `<span class="dot ${tone}"></span>`,
    linked: (t = '联动') => `<span class="linked" title="该值由其他板块实时换算">${t}</span>`,
    field: (label, control, hint = '') => `<div class="field"><label>${label}</label>${control}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`,
    input: (path, type, opts = {}) => `<input type="${opts.itype || 'number'}" data-bind="${path}" data-type="${type}" value="${opts.value != null ? esc(opts.value) : ''}" ${opts.step ? `step="${opts.step}"` : ''} ${opts.min != null ? `min="${opts.min}"` : ''} ${opts.max != null ? `max="${opts.max}"` : ''} ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''} ${opts.attrs || ''}>`,
    select: (path, options, cur, opts = {}) => `<select data-bind="${path}" data-type="${opts.type || 'str'}" ${opts.attrs || ''}>${options.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(cur) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`,
    seg: (path, options, cur, type = 'str') => `<div class="seg">${options.map(o => `<button data-act="ui.seg" data-path="${path}" data-val="${esc(o.v)}" data-vtype="${type}" class="${String(o.v) === String(cur) ? 'on' : ''}">${esc(o.t)}</button>`).join('')}</div>`,
    range: (path, val, min, max, step, outFmt = 'raw') => `<div style="display:flex;align-items:center;gap:8px"><input type="range" data-bind="${path}" data-type="num" min="${min}" max="${max}" step="${step}" value="${val}" style="flex:1"><b data-out="${path}" data-outfmt="${outFmt}" style="min-width:44px;text-align:right">${val}</b></div>`,
    spark(arr, mark = null) {
      if (!arr || !arr.length) return '';
      const W = 220, H = 46, max = Math.max(...arr, 1);
      const pts = arr.map((v, i) => `${(i / (arr.length - 1) * (W - 8) + 4).toFixed(1)},${(H - 6 - v / max * (H - 14)).toFixed(1)}`).join(' ');
      const markX = mark != null ? (mark - 1) / (arr.length - 1) * (W - 8) + 4 : null;
      return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${markX != null ? `<line x1="${markX}" y1="4" x2="${markX}" y2="${H - 4}" stroke="var(--amber)" stroke-dasharray="3 3"/>` : ''}<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/></svg>`;
    },
    ring(pct, label, tone = 'accent') {
      const p = SK.clamp(pct == null ? 0 : pct, 0, 100);
      const col = tone === 'r' ? 'var(--red-hero)' : tone === 'g' ? 'var(--green)' : tone === 'a' ? 'var(--amber)' : 'var(--accent)';
      return `<div style="display:flex;align-items:center;gap:10px"><div style="width:62px;height:62px;border-radius:50%;background:conic-gradient(${col} ${p * 3.6}deg,var(--panel2) 0);display:flex;align-items:center;justify-content:center"><div style="width:46px;height:46px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center;font-weight:750;font-size:14px">${pct == null ? DASH : Math.round(pct)}</div></div><div class="hint">${label}</div></div>`;
    },
  };

  /* ---------- toast / modal ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  SK._setToast(toast);
  function modal(html) { const r = document.getElementById('modal-root'); r.innerHTML = `<div class="modal">${html}</div>`; r.classList.add('open'); }
  function closeModal() { const r = document.getElementById('modal-root'); r.classList.remove('open'); r.innerHTML = ''; }

  /* ---------- 路由 ---------- */
  const route = { board: 'dash', sub: null };
  function parseHash() {
    const m = location.hash.replace(/^#\/?/, '').split('/');
    route.board = m[0] || 'dash'; route.sub = m[1] || null;
  }
  function nav(board, sub) { moreOpen = false; location.hash = '#/' + board + (sub ? '/' + sub : ''); }

  /* ---------- 数据绑定 ---------- */
  function setPath(obj, path, val) {
    const ks = path.split('.'); let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }
  function castVal(raw, type) {
    switch (type) {
      case 'int': return Math.round(parseFloat(raw)) || 0;
      case 'num': { const v = parseFloat(raw); return isFinite(v) ? v : 0; }
      case 'wan': { const v = parseFloat(raw); return isFinite(v) ? Math.round(v * SK.WAN) : 0; }        // 万元 → 分
      case 'fen-yuan': { const v = parseFloat(raw); return isFinite(v) ? Math.round(v * 100) : 0; }      // 元 → 分
      case 'pct100': { const v = parseFloat(raw); return isFinite(v) ? v / 100 : 0; }                    // % → 0–1
      case 'bool': return raw === true || raw === 'true' || raw === 'on';
      default: return raw;
    }
  }
  function bindTarget(el) {
    const path = el.dataset.bind;
    if (path.startsWith('coef:')) return { obj: SK.DB.coefOverrides, key: path.slice(5), coef: true };
    return { obj: SK.DB, key: path };
  }
  function handleBind(el) {
    const t = bindTarget(el);
    let raw = el.type === 'checkbox' ? el.checked : el.value;
    const val = castVal(raw, el.dataset.type || 'str');
    if (t.coef) {
      if (raw === '' || raw == null) delete t.obj[t.key]; else t.obj[t.key] = val;
    } else setPath(t.obj, t.key, val);
    commit();
  }

  /* ---------- 渲染 ---------- */
  function boardById(id) { return SK.modules.find(m => m.id === id); }
  function renderTopnav() {
    const el = document.getElementById('topnav');
    el.innerHTML = `
      <div class="brand"><div class="logo">销</div><span>销冠操盘系统 <small>一体版 v1.0</small></span></div>
      ${SK.modules.map(m => {
        const alerts = m.alerts ? m.alerts() : 0;
        const on = route.board === m.id;
        const hasDrop = m.id === 'dingjia' && m.subnav && m.subnav.length;   // 仅定价板块带下拉快速跳转
        const tab = `<button class="nav-tab ${on ? 'on' : ''}" data-act="ui.nav" data-board="${m.id}">${m.icon} ${m.title}${hasDrop ? ' <span class="nav-caret">▾</span>' : ''}${alerts > 0 ? '<span class="dotwarn"></span>' : ''}</button>`;
        if (!hasDrop) return tab;
        const menu = m.subnav.map(s => `<button class="nav-menu-item ${on && route.sub === s.id ? 'on' : ''}" data-act="ui.nav" data-board="${m.id}" data-sub="${s.id}">${s.label}</button>`).join('');
        return `<div class="nav-drop">${tab}<div class="nav-menu" role="menu">${menu}</div></div>`;
      }).join('')}
      <div class="sp"></div>
      <button class="icon-btn" data-act="ui.palette" title="命令面板 ⌘K">⌘K</button>
      <button class="icon-btn" data-act="ui.print" title="打印当前页">🖨</button>
      <button class="icon-btn" data-act="ui.theme" title="主题">🌓</button>`;
  }
  function renderLivebar() {
    const el = document.getElementById('livebar');
    const cells = [];
    for (const m of SK.modules) if (m.liveCells) { try { cells.push(...m.liveCells()); } catch (e) { console.error('liveCells', m.id, e); } }
    el.innerHTML = cells.map(c => `<div class="lv-cell" data-act="ui.nav" data-board="${c.board}" ${c.sub ? `data-sub="${c.sub}"` : ''} title="${esc(c.tip || '')}"><span class="k">${c.k}</span><span class="v ${c.tone || ''}">${c.v}</span></div>`).join('');
  }
  function renderSubnav() {
    const el = document.getElementById('subnav');
    const m = boardById(route.board);
    if (!m || !m.subnav || !m.subnav.length) { el.innerHTML = ''; return; }
    if (!route.sub || !m.subnav.some(s => s.id === route.sub)) route.sub = m.subnav[0].id;
    el.innerHTML = m.subnav.map(s => `<button class="sub-tab ${route.sub === s.id ? 'on' : ''}" data-act="ui.nav" data-board="${m.id}" data-sub="${s.id}">${s.label}</button>`).join('');
  }
  /* ---------- 手机 / 平板：底部标签栏 + 「更多」抽屉 ---------- */
  const BN_PRIMARY = 4;                                   // 底部常驻前 4 个板块，其余进「更多」
  let moreOpen = false;
  function renderBottomnav() {
    const el = document.getElementById('bottomnav'); if (!el) return;
    const prim = SK.modules.slice(0, BN_PRIMARY), rest = SK.modules.slice(BN_PRIMARY);
    const btn = m => {
      const a = m.alerts ? m.alerts() : 0;
      return `<button class="bn-tab ${route.board === m.id ? 'on' : ''}" data-act="ui.nav" data-board="${m.id}">
        <span class="bn-ic">${m.icon}${a > 0 ? '<i class="bn-dot"></i>' : ''}</span><span class="bn-lb">${m.title}</span></button>`;
    };
    const restA = rest.reduce((s, m) => s + (m.alerts ? m.alerts() : 0), 0);
    const curRest = rest.some(m => m.id === route.board);
    el.innerHTML = prim.map(btn).join('') +
      `<button class="bn-tab ${moreOpen || curRest ? 'on' : ''}" data-act="ui.more">
        <span class="bn-ic">☰${restA > 0 ? '<i class="bn-dot"></i>' : ''}</span><span class="bn-lb">更多</span></button>`;
  }
  function renderMoresheet() {
    const el = document.getElementById('moresheet'); if (!el) return;
    el.className = moreOpen ? 'open' : '';
    if (!moreOpen) { el.innerHTML = ''; return; }
    const rest = SK.modules.slice(BN_PRIMARY);
    el.innerHTML = `<div class="ms-scrim" data-act="ui.more-close"></div>
      <div class="ms-panel" role="dialog" aria-label="更多板块">
        <div class="ms-grab"></div>
        <div class="ms-head">更多板块</div>
        <div class="ms-grid">${rest.map(m => {
          const a = m.alerts ? m.alerts() : 0;
          return `<button class="ms-item ${route.board === m.id ? 'on' : ''}" data-act="ui.nav" data-board="${m.id}">
            <span class="ms-ic">${m.icon}</span><span class="ms-lb">${m.title}</span>${a > 0 ? '<i class="bn-dot"></i>' : ''}</button>`;
        }).join('')}</div>
      </div>`;
  }
  let renderScheduled = false;
  function render() {
    SK.xReset();
    parseHash();
    const m = boardById(route.board) || SK.modules[0];
    route.board = m.id;
    renderTopnav(); renderSubnav(); renderLivebar(); renderBottomnav(); renderMoresheet();
    const view = document.getElementById('view');
    try { view.innerHTML = m.render(route.sub); }
    catch (e) { console.error(e); view.innerHTML = h.banner('渲染出错：' + esc(e.message), 'r'); }
    document.getElementById('backup-note').innerHTML = backupNote();
    window.scrollTo(0, 0);
  }
  function commit() {
    SK.persist();
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled = false; render(); });
  }
  function backupNote() {
    const last = SK.DB.ui.lastExportAt, nd = SK.getCoef('shared.backupNudgeDays');
    if (!last) return `💾 建议定期在「数据中心」导出备份 · 本地存储占用 ${SK.storageKB() || 0} KB · 数据不出你的电脑`;
    const d = SK.diffDays(last, SK.today());
    return d > nd ? `💾 你已 ${d} 天没备份数据了——硬盘损坏/换电脑前请到「数据中心」导出备份` : `💾 上次备份 ${last} · 本地存储 ${SK.storageKB() || 0} KB · 数据不出你的电脑`;
  }

  /* ---------- 主题 ---------- */
  function applyTheme() {
    const t = SK.DB.ui.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  /* ---------- 命令面板 ---------- */
  let palItems = [], palSel = 0;
  function paletteItems() {
    const items = [];
    for (const m of SK.modules) {
      items.push({ t: `${m.icon} ${m.title}`, s: '板块', run: () => nav(m.id) });
      (m.subnav || []).forEach(s => items.push({ t: `${m.icon} ${m.title} · ${s.label}`, s: '页面', run: () => nav(m.id, s.id) }));
    }
    items.push({ t: '🌓 切换主题', s: '操作', run: () => SK.actions['ui.theme']() });
    items.push({ t: '📦 导出全量备份', s: '操作', run: () => SK.actions['data.export']() });
    items.push({ t: '🧪 载入演示数据', s: '操作', run: () => SK.actions['data.seed']() });
    return items;
  }
  function openPalette() {
    const p = document.getElementById('palette');
    p.classList.add('open');
    p.innerHTML = `<div class="pal"><input id="pal-q" placeholder="搜索页面 / 操作…"><div class="pal-list" id="pal-list"></div></div>`;
    palSel = 0; filterPal('');
    const q = document.getElementById('pal-q'); q.focus();
    q.addEventListener('input', () => { palSel = 0; filterPal(q.value); });
  }
  function filterPal(qs) {
    palItems = paletteItems().filter(it => !qs || it.t.toLowerCase().includes(qs.toLowerCase()));
    document.getElementById('pal-list').innerHTML = palItems.map((it, i) =>
      `<div class="pal-it ${i === palSel ? 'sel' : ''}" data-pal="${i}">${it.t}<small>${it.s}</small></div>`).join('');
  }
  function closePalette() { const p = document.getElementById('palette'); p.classList.remove('open'); p.innerHTML = ''; }

  /* ---------- 核心动作 ---------- */
  Object.assign(SK.actions, {
    'ui.nav': d => nav(d.board, d.sub || null),
    'ui.more': () => { moreOpen = !moreOpen; renderMoresheet(); renderBottomnav(); },
    'ui.more-close': () => { moreOpen = false; renderMoresheet(); renderBottomnav(); },
    'ui.theme': () => {
      const seq = ['auto', 'light', 'dark'];
      SK.DB.ui.theme = seq[(seq.indexOf(SK.DB.ui.theme || 'auto') + 1) % 3];
      applyTheme(); commit(); toast('主题：' + SK.DB.ui.theme);
    },
    'ui.print': () => window.print(),
    'ui.palette': () => openPalette(),
    'ui.seg': d => {
      const val = d.vtype === 'num' ? parseFloat(d.val) : d.vtype === 'bool' ? d.val === 'true' : d.val;
      if (d.path.startsWith('coef:')) SK.DB.coefOverrides[d.path.slice(5)] = val;
      else setPath(SK.DB, d.path, val);
      commit();
    },
    'ui.modal-close': () => closeModal(),
    'ui.toast-ac': () => toast('已生成 action_card（系统永不自动执行 · 由你点击后才动）'),
  });

  /* ---------- 全局事件 ---------- */
  function wire() {
    document.addEventListener('click', ev => {
      const pal = ev.target.closest('[data-pal]');
      if (pal) { const it = palItems[+pal.dataset.pal]; closePalette(); it && it.run(); return; }
      if (ev.target.id === 'palette') { closePalette(); return; }
      if (ev.target.id === 'modal-root') { closeModal(); return; }
      const el = ev.target.closest('[data-act]');
      if (!el) return;
      const fn = SK.actions[el.dataset.act];
      if (fn) fn(el.dataset, el, ev); else console.warn('未注册动作', el.dataset.act);
    });
    document.addEventListener('change', ev => {
      const el = ev.target.closest('[data-bind]');
      if (el) handleBind(el);
    });
    document.addEventListener('input', ev => {
      const el = ev.target.closest('[data-bind]');
      if (!el) return;
      // 滑杆实时回显（不落库不重渲染）
      const out = document.querySelector(`[data-out="${el.dataset.bind}"]`);
      if (out) {
        const v = parseFloat(el.value);
        out.textContent = out.dataset.outfmt === 'pct' ? Math.round(v) + '%' : el.value;
      }
      const live = SK.actions['ui.live-input'];   // 模块可注册细粒度实时响应
      if (live) live({ path: el.dataset.bind, value: el.value }, el, ev);
    });
    document.addEventListener('keydown', ev => {
      const p = document.getElementById('palette');
      if (p.classList.contains('open')) {
        if (ev.key === 'Escape') return closePalette();
        if (ev.key === 'ArrowDown') { palSel = Math.min(palSel + 1, palItems.length - 1); filterPal(document.getElementById('pal-q').value); ev.preventDefault(); return; }
        if (ev.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); filterPal(document.getElementById('pal-q').value); ev.preventDefault(); return; }
        if (ev.key === 'Enter') { const it = palItems[palSel]; closePalette(); it && it.run(); return; }
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openPalette(); return; }
      if (ev.key === 'Escape') closeModal();
    });
    window.addEventListener('hashchange', render);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    SK.loadDB();
    applyTheme();
    parseHash();
    wire();
    render();
    // 控制台自检（不阻塞 UI）
    setTimeout(() => {
      try {
        const res = SK.tests.map(t => { try { const r = t.fn(); return { id: t.id, pass: r === true || (r && r.pass) }; } catch (e) { return { id: t.id, pass: false, err: e.message }; } });
        const bad = res.filter(r => !r.pass);
        console.log(`[销冠操盘系统] 自检 ${res.length - bad.length}/${res.length} 绿`, bad.length ? bad : '');
        window.__SUITE_SELFTEST__ = res;
      } catch (e) { console.error(e); }
    }, 50);
  }

  window.UI = { h, toast, modal, closeModal, nav, route, render, commit, boot, applyTheme };
})();
