// ============================================================================
// UI 层：路由 / 组件 / 老板端八屏 + 销售端钱途页 + 系数自检页
// 状态→渲染单向；事件委托（data-act）；innerHTML 前一律 esc()
// ============================================================================
const UI = (() => {
  const S = { route: 'overview', today: null, modal: null };
  const app = () => document.getElementById('app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- 小组件 ----
  const badge = (band, txt) => `<span class="badge badge--${band || 'neutral'}"><span class="badge-dot"></span>${esc(txt)}</span>`;
  const bandWord = (b) => ({ success: '🟢 健康', warning: '🟡 注意', danger: '🔴 危险', gold: '金' }[b] || '—');
  const computedTag = (t) => `<span class="computed-tag" data-tip="${esc(t || '这个分数由系统计算，老板改不了')}">🔒 计算得出</span>`;
  const asOf = (date, board, today) => {
    if (!date) return '';
    const stale = today && D.diffDays(date, today) > getCoef('envelopeStaleDays');
    return `<span class="asof ${stale ? 'stale' : ''}">（数据截至 ${esc(date)}${board ? ' · ' + esc(board) : ''}${stale ? ' 🟡 可能过期' : ''}）</span>`;
  };
  const meter = (pct, band) => `<div class="meter"><div class="meter-fill s-${band || 'info'}" style="width:${Math.max(0, Math.min(100, pct || 0))}%"></div></div>`;
  const ring = (val, band) => {
    const v = val == null ? 0 : val; const col = `var(--${band === 'success' ? 'success' : band === 'warning' ? 'warning' : band === 'danger' ? 'danger' : band === 'gold' ? 'gold' : 'info'})`;
    return `<div class="ring" style="background:conic-gradient(${col} ${v}%, var(--surface-2) 0)"><span class="ring-num" style="color:${col}">${val == null ? '—' : val}</span></div>`;
  };
  const dash = (v) => v == null ? `<span class="dash" data-tip="样本不足 / 未导入">—</span>` : v;
  const cite = (t) => `<span class="cite">${esc(t)}</span>`;
  const actionCard = (sev, title, body, btns, citeTxt) =>
    `<div class="action-card sev-${sev}"><div class="ac-title">${esc(title)}</div><div class="ac-body">${body}</div>${btns ? `<div class="btn-row">${btns}</div>` : ''}${citeTxt ? cite(citeTxt) : ''}</div>`;

  // ---- 顶栏 + 侧栏 ----
  function chrome(body) {
    const lic = DB.license || {};
    const st = StorageAdapter.probe();
    const stale = D.diffDays(DB.ui.backupLastExportAt, S.today);
    const backupNudge = stale > getCoef('backupNudgeDays')
      ? `<div class="top-strip top-strip--gold no-print">🟡 你已 ${stale} 天没备份数据了——导出一份信封 JSON，只要 10 秒。 <button class="btn btn--sm" data-act="export">导出信封</button> <button class="btn btn--sm" data-act="migrate">换电脑迁移说明</button></div>` : '';
    const nav = NAV.map(g => `<div class="nav-group"><div class="nav-group-label">${g.label}</div>${g.items.map(it =>
      `<button class="nav-item ${S.route === it.id ? 'active' : ''}" data-act="nav" data-route="${it.id}"><span class="ico">${it.ico}</span>${esc(it.name)}${it.lock ? '<span class="lock">🔒</span>' : ''}</button>`).join('')}</div>`).join('');
    return `
    ${backupNudge}
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><span class="logo">🛡️</span>销冠留人器<span class="sub">信用层</span></div>
        <div class="topbar-spacer"></div>
        <span class="lic no-print">授权：<b>${esc(lic.tenant || '—')}</b> · ${DB.__mode === 'free' ? '免费版' : '完整版'}</span>
        <button class="btn btn--sm no-print" data-act="theme">🌓 主题</button>
        <button class="btn btn--sm no-print" data-act="print">🖨️ 打印</button>
      </header>
      <aside class="sidebar no-print">${nav}
        <div class="nav-group"><div class="nav-group-label">存储</div>
          <div style="padding:0 12px;font-size:var(--fs-2xs);color:var(--text-faint)">占用 ${(st.approxBytes/1024).toFixed(0)}KB / 800KB<br>预算全系统 ≤4MB</div>
        </div>
      </aside>
      <main class="main">${body}</main>
    </div>`;
  }

  const NAV = [
    { label: '诊断', items: [
      { id: 'overview', name: '治理体检', ico: '🩺' },
      { id: 'gates', name: '十二道闸', ico: '🚦' },
    ] },
    { label: '留存引擎', items: [
      { id: 'pricetag', name: '流失价签', ico: '🏷️' },
      { id: 'retention', name: '该谈·预检·离职', ico: '🧭' },
      { id: 'm28', name: '产权 M28', ico: '📜' },
    ] },
    { label: '激励', items: [
      { id: 'dividend', name: '蓝图与分红', ico: '🎯' },
      { id: 'sales', name: '钱途页（销售端）', ico: '🌱' },
    ] },
    { label: '系统', items: [
      { id: 'system', name: '信封与实验室', ico: '📦' },
      { id: 'selftest', name: '系数与自检', ico: '✅' },
    ] },
  ];

  // ---- 边界声明（A-23，五板块同句）----
  const BORDER = `<div class="banner banner--info" style="margin-top:24px"><span class="b-ico">ℹ️</span><div><strong>系统边界</strong><p>这个系统不会让一个卖不动的产品卖动。如果你的产品本身有问题——先去改产品。</p></div></div>`;

  // ========================================================================
  // 屏1 地盘前置锁（闸①）：算账器未导入 → 全锁
  // ========================================================================
  function lockScreen() {
    return `<div class="stack"><h1 class="section-title">留人功能已锁定</h1>
      <div class="card"><div class="banner banner--warning"><span class="b-ico">🔒</span><div><strong>闸① 地盘前置</strong>
      <p>${esc(SCRIPTS.L05())}</p></div></div>
      <div class="btn-row" style="margin-top:16px"><button class="btn btn--primary" data-act="importPick">导入算账器数据包</button></div></div>${BORDER}</div>`;
  }

  // ========================================================================
  // 屏2 治理体检（Hero：四指数 + 自评偏差 + 修复清单按 ROI）
  // ========================================================================
  function screenOverview() {
    const ind = Engine.indices(DB, S.today);
    const dev = Engine.deviation(DB, S.today);
    const cards = [
      ['监督 SII', ind.sii, '越低越好'], ['授权 EI', ind.ei, '越高越好'],
      ['可见 DVI', ind.dvi, '算账器口径'], ['信用 AHC', ind.ahc, '全员可见 · 老板改不了'],
    ].map(([label, m, hint]) => `
      <div class="card">
        <div class="kpi-label">${esc(label)}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin:4px 0">
          <div class="kpi-value">${m.value == null ? '<span class="dash">—</span>' : m.value}</div>
          ${m.value == null ? '' : badge(m.band, bandWord(m.band))}
        </div>
        <div class="kpi-foot">${esc(hint)} ${m.source ? asOf(m.asOf, m.source, S.today) : ''}</div>
        ${label.includes('AHC') ? '<div style="margin-top:8px">' + computedTag() + '</div>' : ''}
        ${m.value == null ? '<div class="kpi-foot">— 需导入算账器数据</div>' : meter(m.value, m.band)}
      </div>`).join('');

    // 自评-实评偏差
    const devRows = dev.rows.map(r => `<div class="kv"><span class="k">${esc(r.label)}</span><span class="v">自评 ${r.self} · 实测 ${r.actual} · 偏差 <b style="color:var(--${r.gap > 40 ? 'danger' : r.gap > 20 ? 'warning' : 'success'})">${r.gap}</b></span></div>`).join('');

    // 修复清单（ROI 排序，行动卡；结论由判定函数出）
    const fixes = buildFixList(ind);

    return `<div class="stack">
      <div><h1 class="section-title">治理体检 · 四指数</h1>
        <div class="section-desc">${esc(SCRIPTS.L01({ sii: ind.sii.value, ei: ind.ei.value, ahc: ind.ahc.value }))}</div></div>
      <div class="kpi-grid">${cards}</div>

      <div class="grid grid-2">
        <div class="card"><div class="card-head"><div><div class="card-title">自评 vs 实测偏差</div><div class="card-sub">先猜后看 · 30 秒</div></div>
          <div class="hero-num" style="color:var(--${dev.gap > 40 ? 'danger' : 'warning'})">${dash(dev.gap)}</div></div>
          ${devRows}${cite('世界管理调查（Bloom & Van Reenen, QJE）：管理者自评与客观评分几乎零相关。')}
          <div class="btn-row" style="margin-top:12px"><button class="btn btn--sm" data-act="selfrate">重新自评</button></div>
        </div>
        <div class="card"><div class="card-title">修复清单 · 按 ROI</div><div class="card-sub" style="margin-bottom:12px">每条为行动卡，永不自动执行——由你点击</div>
          <div class="stack">${fixes}</div>
        </div>
      </div>
      ${BORDER}
    </div>`;
  }
  function buildFixList(ind) {
    const items = [];
    if (ind.ei.value < 30) items.push(['danger', '开启异议与建议双通道', '授权分 EI 过低 → 没人敢说话。开双通道，让异议进得来。', 'Doucouliagos et al. 2020 元回归：分红需与授权组合才有效。']);
    if (ind.sii.value > 60) items.push(['warning', '关闭事事审批', '监督分 SII 偏高 → 你在为不信任付双份钱。', 'Org Sci 2016：高压监督挤出骨干努力。']);
    if (ind.ahc.value < 60) items.push(['danger', '兑现欠着的承诺 + 给 M28 加 irrevocable', '信用分 AHC 过低 → 销冠不信你，配方是他唯一筹码。', 'Hart 2016 诺奖：控制权决定专用投入。']);
    if (!items.length) items.push(['success', '四指数健康', '当前无高优先级修复项。保持。', '']);
    return items.map(([sev, t, b, c]) => actionCard(sev, t, esc(b), '', c)).join('');
  }

  // ========================================================================
  // 屏3 流失价签（权威 6 项）+ 错价榜
  // ========================================================================
  function screenPriceTag() {
    const pt = Engine.priceTag(DB, S.today);
    const rows = pt.items.map(it => `<tr><td>${esc(it.name)}</td><td class="num mono">${it.amt == null ? '<span class="dash">—</span>' : Money.wan(it.amt)}</td><td class="muted tiny">${esc(it.scope)}</td></tr>`).join('');
    return `<div class="stack">
      <div><h1 class="section-title">流失价签 · 权威 6 项口径</h1>
        <div class="section-desc">定价器卡C / 招人器 F15 为简版（各 3 项）；本 6 项为全系统权威口径。第⑤⑥项互不重叠、不得双计同一笔。</div></div>
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><div><div class="card-title">${esc(pt.name)} · 若今天离职</div>
          <div class="card-sub">≈近6月月均毛利 ×（招聘周期 + 批均回本）</div></div>
          <div><div class="hero-num" style="color:var(--danger)">${Money.wan(pt.headline)}</div><div class="tiny muted right">权威估算总额</div></div></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>构成项</th><th class="num">金额</th><th>口径</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="tiny muted" style="margin-top:8px">六项为诊断口径，与总额估算法互为参照。</div>
        </div>
        <div class="card"><div class="card-title">关键比值</div>
          <div class="kv"><span class="k">爬坡缺口占比</span><span class="v"><b style="color:var(--${pt.hitGate5 ? 'danger' : 'success'})">${Rate.pct(pt.rampGapShare)}</b> ${pt.hitGate5 ? badge('danger', '触闸⑤') : ''}</span></div>
          <div class="kv"><span class="k">加薪 vs 价签</span><span class="v">${Num.x(pt.raiseVsTag)}</span></div>
          <div class="kv"><span class="k">缩短爬坡 37% 年化收益</span><span class="v">${Money.wan(pt.shortenGainAnnual)}</span></div>
          ${pt.hitGate5 ? actionCard('danger', '你该修的是爬坡，不是留人', '爬坡缺口占了流失成本的大头（>45%）。加薪留人是把钱浇在漏桶上。', '', 'HBR/RAIN：接手他人管道成交率低 30–50%。') : ''}
        </div>
      </div>
      ${BORDER}
    </div>`;
  }

  // ========================================================================
  // 屏4 十二道闸
  // ========================================================================
  function screenGates() {
    const rc = Engine.rankingConfig();
    const pt = Engine.priceTag(DB, S.today);
    const ind = Engine.indices(DB, S.today);
    const gate = (n, name, status, body) => `<div class="card"><div class="card-head"><div class="card-title">闸${n} ${esc(name)}</div>${badge(status.band, status.txt)}</div>${body || ''}</div>`;
    return `<div class="stack">
      <h1 class="section-title">留人十二道闸（11A + 1B，零 D）</h1>
      <div class="grid grid-2">
        ${gate('①', '地盘前置', { band: 'success', txt: '已解锁' }, '<p class="muted tiny">算账器 M21 归一化已导入，排名/淘汰/配方/提拔已具备前提。</p>')}
        ${gate('②', '排行榜合法性', { band: 'success', txt: '合法' }, `<p class="muted tiny">唯一合法配置：实名 · 只显名次 · 不显金额/配额 · 源＝M21 归一化。</p><div class="pill-row" style="margin-top:8px">${badge('neutral', '实名')}${badge('neutral', '仅名次')}${badge('neutral', '无金额')}${badge('neutral', '无配额')}</div>`)}
        ${gate('③', '挤出对冲', { band: DB.silentTrackOn ? 'success' : 'warning', txt: DB.silentTrackOn ? '通道已启' : '通道未启' }, `<p class="muted tiny">悬赏可对结果，但不许只有钱。结果类悬赏需先启用静默认可通道。</p><div class="btn-row" style="margin-top:8px"><button class="btn btn--sm" data-act="bountyDemo" data-t="record_break">试挂：破纪录赏</button><button class="btn btn--sm" data-act="bountyDemo" data-t="first_deal">试挂：首单赏（豁免）</button>${DB.silentTrackOn ? '' : '<button class="btn btn--sm btn--primary" data-act="enableSilent">一键启用静默认可通道</button>'}</div>`)}
        ${gate('⑤', '爬坡优先', { band: pt.hitGate5 ? 'danger' : 'success', txt: pt.hitGate5 ? '缺口过大' : '正常' }, `<p class="muted tiny">爬坡缺口占比 ${Rate.pct(pt.rampGapShare)}（红线 45%）。</p>`)}
        ${gate('⑥', '棘轮硬闸', { band: DB.governance.ahcInputs.ratchetCount > 0 ? 'warning' : 'success', txt: `棘轮 ${DB.governance.ahcInputs.ratchetCount} 次` }, '<p class="muted tiny">按去年业绩上调配额＝把努力当把柄。触发→[生成反棘轮条款]（irrevocable + AHC 加分）。</p>')}
        ${gate('⑦', '反敲竹杠', { band: ind.ahc.value < getCoef('ahcTrustLine') ? 'danger' : 'success', txt: `AHC ${ind.ahc.value}` }, `<p class="muted tiny">交出物无 M28 协议 / AHC<60 → 红。${ind.ahc.value < 60 ? esc(SCRIPTS.L07({ n: 2, m: 2, ahc: ind.ahc.value, k: 16 })) : ''}</p>`)}
        ${gate('⑧', '分红四问', { band: 'info', txt: '见分红页' }, '<p class="muted tiny">前置＝M17 三重闸已过；本闸只体检、永不清零池。</p>')}
        ${gate('⑨', '黑暗三角崩塌', { band: 'neutral', txt: '窗口 [10,18]' }, '<p class="muted tiny">高标记 ∧ 在职 10–18 月 ∧ 近 3 月环比 <−40% → 🟡「预期中的崩塌」，只输出不建议挽留。</p>')}
        ${gate('⑩', '双目标隔离', { band: 'success', txt: 'CI 断言' }, '<p class="muted tiny">蓝图进度与考核函数零依赖。</p>')}
        ${gate('⑪', '只供氧', { band: 'success', txt: 'CI 断言' }, '<p class="muted tiny">钱途页零排名/零对比/零员工红灯。</p>')}
        ${gate('⑫', '履约准入', { band: 'success', txt: '枚举锁死' }, '<p class="muted tiny">仅 bounty/challenge/contract/dividend/带教/使用费 入账。</p>')}
      </div>${BORDER}</div>`;
  }

  // ========================================================================
  // 屏5 产权 M28（含 irrevocable 拦截演示）
  // ========================================================================
  function screenM28() {
    const rows = DB.entities.M28Agreement.map(a => {
      const val = Engine.m28Value(a);
      return `<tr><td>${esc(masterName(a.masterId))}</td><td>${a.kind === 'mentoring' ? '带教分成' : '配方使用费'}</td>
        <td class="num mono">${Rate.pct(a.rate)}</td><td class="num">${a.durationMonths} 月</td>
        <td class="num mono">${Money.wan(val)}</td><td>${a.irrevocable ? badge('gold', '🔒 irrevocable') : badge('neutral', '可改')}</td>
        <td><button class="btn btn--sm btn--danger" data-act="tryDown" data-id="${esc(a.m28Id)}">尝试下调</button></td></tr>`;
    }).join('');
    const ovr = DB.entities.OverrideEvent.slice(-5).map(o => `<div class="kv"><span class="k">${esc(o.at)} · ${esc(o.action)}</span><span class="v">🔴 已拦截 · 全员可见</span></div>`).join('') || '<p class="muted tiny">暂无拦截记录。</p>';
    return `<div class="stack">
      <div><h1 class="section-title">产权 M28 · 配方产权与带教对价</h1>
        <div class="section-desc">带教分成＝徒弟月净贡献 ×5%×12月；配方使用费＝团队净贡献增量 ×2%×24月。irrevocable 下调在代码层无成功路径——尝试即留痕 + AHC 扣分 + 全员可见。</div></div>
      <div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>师傅</th><th>类型</th><th class="num">费率</th><th class="num">时长</th><th class="num">对价</th><th>状态</th><th>拦截演示</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="grid grid-2">
        <div class="card"><div class="card-title">拦截记录（G3 留痕 · 全员可见）</div>${ovr}
          ${cite('第四定理（Hart，诺奖 2016）：你不给他控制权，他就不会投入你测不到的努力。')}</div>
        <div class="card"><div class="card-title">带教 vs 一次性对比</div>
          <div class="kv"><span class="k">带教分成（5%×12月）</span><span class="v">${Money.wan(Engine.m28Value(DB.entities.M28Agreement.find(a=>a.kind==='mentoring')))}</span></div>
          <div class="kv"><span class="k">一次性奖金</span><span class="v">${Money.cny(getCoef('m28').oneOffAmt)}</span></div>
          <div class="kv"><span class="k">倍数</span><span class="v"><b>${Num.x(Engine.m28Value(DB.entities.M28Agreement.find(a=>a.kind==='mentoring'))/getCoef('m28').oneOffAmt)}</b></span></div>
        </div>
      </div>${BORDER}</div>`;
  }
  function masterName(id) { const s = DB.entities.Salesperson.find(x => x.spId === id); return s ? s.name : id; }

  // ========================================================================
  // 屏6 该谈名单 + 依赖度 + 发放预检 + 离职登记
  // ========================================================================
  function screenRetention() {
    const talks = Engine.talkList(DB, S.today);
    const dep = Engine.dependency(DB, S.today);
    const talkRows = talks.map(t => `<tr><td>${esc(t.name)}</td><td>${t.triggers.map(g => badge(g.src === 'second_place' ? 'gold' : 'warning', g.label)).join(' ')}</td><td class="muted tiny">${t.triggers.map(g => esc(g.detail)).join('；')}</td></tr>`).join('') || `<tr><td colspan="3" class="muted tiny">当前无触发。</td></tr>`;
    const bangyan = talks.find(t => t.triggers.some(g => g.src === 'second_place'));
    return `<div class="stack">
      <h1 class="section-title">留存运营 · 该谈 / 预检 / 离职</h1>
      <div class="grid grid-2">
        <div class="card"><div class="card-title">该谈名单 · 五触发源</div><div class="card-sub" style="margin-bottom:10px">系统永不指导「谈什么」，只告诉你「该谈谁」。</div>
          <div class="table-wrap"><table class="table"><thead><tr><th>员工</th><th>触发</th><th>理由</th></tr></thead><tbody>${talkRows}</tbody></table></div>
          ${bangyan ? actionCard('warning', `榜眼预警：${bangyan.name}`, esc(SCRIPTS.L09({ name: bangyan.name, m: 3, r: 2, sc: Rate.pct(bangyan.pp.scissors) })), '<button class="btn btn--sm">生成单独承诺（前程合约）</button>', 'Ahearne 2025 JM：中上段是流失与被挖高危带。') : ''}
        </div>
        <div class="card"><div class="card-head"><div class="card-title">依赖度雷达</div>${dep.value == null ? '' : badge(dep.band, bandWord(dep.band))}</div>
          <div class="hero-num" style="color:var(--${dep.band || 'info'})">${dep.value == null ? '—' : Rate.pct(dep.value)}</div>
          <div class="kpi-foot">Top1（${esc(dep.topName || '—')}）回款占比（滚 6 月，归一化后）${asOf(dep.asOf, 'suanzhang', S.today)}</div>
          ${dep.selfMade ? `<div class="banner banner--warning" style="margin-top:10px"><span class="b-ico">⚠️</span><div>依赖度一部分是你自己造出来的——Top1 线索指数 >1.5。</div></div>` : ''}
          <div class="tiny muted" style="margin-top:10px">传承预案四行：配方在库 / 蓄水池储备 / 徒弟名单 / M28 有无。</div>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="card"><div class="card-title">发放预检（M37 参照点账本）</div><div class="card-sub" style="margin-bottom:10px">发钱前预检：拟发 vs 历史/趋势参照点。</div>
          ${precheckPanel()}
        </div>
        <div class="card"><div class="card-title">离职登记向导（M38）</div><div class="card-sub" style="margin-bottom:10px">两步：原因 → 在途单逐单录入 → 余震名单 + 交接卡。</div>
          <div class="btn-row"><button class="btn btn--primary" data-act="leaveWizard">启动离职登记</button></div>
          <div class="tiny muted" style="margin-top:10px">📎 中国连锁企业 RCT：指定名单一对一周聊，流失率降 1.7pp。</div>
        </div>
      </div>${BORDER}</div>`;
  }
  function precheckPanel() {
    const spOpts = DB.entities.Salesperson.filter(s => s.isActive).map(s => `<option value="${s.spId}">${esc(s.name)}</option>`).join('');
    return `<label class="field"><span class="field-label">员工</span><select id="pc-sp">${spOpts}</select></label>
      <label class="field"><span class="field-label">拟发金额（元）</span><input id="pc-amt" type="number" placeholder="如 30000" value="30000"></label>
      <div class="btn-row"><button class="btn btn--primary" data-act="runPrecheck">预检</button></div>
      <div id="pc-out" style="margin-top:12px"></div>`;
  }

  // ========================================================================
  // 屏7 蓝图 + 分红（三重闸→四问 串联）+ 履约总账
  // ========================================================================
  function screenDividend() {
    const div = Engine.computeDividend(DB, S.today);
    const ind = Engine.indices(DB, S.today);
    const gateRows = div.gates.map(g => `<div class="kv"><span class="k">${esc(g.label)} ${g.enabled ? '' : '<span class="tiny faint">(未启用)</span>'}</span><span class="v">${g.enabled ? (g.pass ? badge('success', '达') : badge('danger', '未达')) : '—'}</span></div>`).join('');
    let fourHtml;
    if (!div.threeGatePass) {
      fourHtml = `<div class="banner banner--danger"><span class="b-ico">🔴</span><div><strong>未达发放资格，未体检</strong><p>三重闸任一不达 → 池 = 0，流程终止，四问零调用。</p></div></div>`;
    } else {
      const qs = div.four.map(q => `<div class="kv"><span class="k">${esc(q.q)}</span><span class="v">${q.pass == null ? '—（未采集）' : q.pass ? badge('success', '过') : badge('danger', '否')} <span class="tiny muted">${q.val == null ? '' : q.val}</span></span></div>`).join('');
      fourHtml = `${qs}<div class="banner banner--${div.verdict} " style="margin-top:10px"><span class="b-ico">${div.verdict === 'danger' ? '🔴' : div.verdict === 'warning' ? '🟡' : '🟢'}</span><div>${div.fourFailCount} 条不达。${div.verdict === 'danger' ? esc(SCRIPTS.L08({ period: '季度', rate: Rate.pct(DB.dividend.poolRate), n: div.fourFailCount })) : '体检通过。'}</div></div>
      ${div.verdict !== 'ok' ? '<div class="btn-row" style="margin-top:8px"><button class="btn btn--danger btn--sm" data-act="forceDividend">我知道风险，仍要启用（留痕，计入 AHC 扣分）</button></div>' : ''}
      <div class="tiny muted" style="margin-top:8px">🔴 体检永不清零池——只警告，数值权归老板。</div>`;
    }
    return `<div class="stack">
      <h1 class="section-title">蓝图与分红 · 创业三级梯</h1>
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><div class="card-title">① 三重闸 · 发不发（资格门）</div><div class="hero-num sm" style="color:var(--${div.threeGatePass ? 'success' : 'danger'})">${div.threeGatePass ? '✓' : '池 0'}</div></div>
          ${gateRows}<div class="tiny muted" style="margin-top:6px">老板设、独立启停、不达池=0、不重分。数值权归老板。</div></div>
        <div class="card"><div class="card-head"><div class="card-title">② 分红四问 · 该不该发（体检）</div>${div.threeGatePass ? `<div class="hero-num sm" style="color:var(--${div.verdict})">${div.pool != null ? Money.wan(div.pool) : '—'}</div>` : ''}</div>
          ${fourHtml}</div>
      </div>
      <div class="grid grid-2">
        <div class="card"><div class="card-title">经营蓝图（与考核隔离）</div>
          ${DB.blueprint.milestones.map(m => `<div class="kv"><span class="k">${esc(m.name)}</span><span class="v">${m.done ? badge('success', '已达') : badge('neutral', '进行中')}</span></div>`).join('')}
          <div class="tiny muted" style="margin-top:6px">蓝图进度不被任何考核函数调用（闸⑩）。</div></div>
        <div class="card"><div class="card-title">履约总账（双时间戳 · 全员可见）</div>
          <div class="kv"><span class="k">履约率（滚 12 月）</span><span class="v"><b>${Rate.pct(DB.governance.ahcInputs.honoredRatio)}</b></span></div>
          <div class="kv"><span class="k">已达成 / 已履约</span><span class="v">${DB.governance.ahcInputs.achievedCount} / ${DB.governance.ahcInputs.honoredCount}</span></div>
          <div class="tiny muted" style="margin-top:6px">赏在明处，催在暗处：未兑现黄脸仅老板自见。</div></div>
      </div>${BORDER}</div>`;
  }

  // ========================================================================
  // 销售端钱途页（七栏 · 只供氧：零排名/零对比/零员工红灯）
  // ========================================================================
  function screenSales() {
    const ind = Engine.indices(DB, S.today);
    const ahc = ind.ahc;
    const a = DB.governance.ahcInputs;
    return `<div class="stack">
      <div class="banner banner--info no-print"><span class="b-ico">🌱</span><div><strong>销售端预览 · 钱途页</strong><p>只供氧：零排名、零对比、零员工红灯。唯一"红"是⑤栏——老板的信用（放老板的血）。</p></div></div>
      <h1 class="section-title">你的钱途</h1>
      <div class="kpi-grid">
        <div class="card"><div class="kpi-label">① 现在</div><div class="kpi-value sm">${Money.cny(DB.entities.Salesperson[0].baseSalaryAmt)}<span class="kpi-unit">底薪/月</span></div><div class="kpi-foot">本人回款可见（唯一利润豁免）</div></div>
        <div class="card"><div class="kpi-label">② 下一步</div><div class="kpi-value sm">有效档</div><div class="kpi-foot">达标即进阶</div></div>
        <div class="card"><div class="kpi-label">③ 台阶</div><div class="kpi-value sm">专家 / 主管</div><div class="kpi-foot">双轨可选</div></div>
        <div class="card"><div class="kpi-label">④ 产权</div><div class="kpi-value sm">带教 5%×12月</div><div class="kpi-foot">配方使用费 2%×24月</div></div>
      </div>
      <div class="card" style="border:2px solid var(--${ahc.band})">
        <div class="card-head"><div><div class="card-title">⑤ 老板的信用（AHC）</div><div class="card-sub">ⓘ 这个分数由系统计算，老板改不了</div></div>
          ${ring(ahc.value, ahc.band)}</div>
        <div class="grid grid-2" style="margin-top:8px">
          <div class="kv"><span class="k">履约率（40 分项）</span><span class="v">${Rate.pct(a.honoredRatio)}</span></div>
          <div class="kv"><span class="k">irrevocable 覆盖（25 分项）</span><span class="v">${Rate.pct(a.irrevocableRatio)}</span></div>
          <div class="kv"><span class="k">拦截下调（20 分项）</span><span class="v">${a.interceptCount} 次（全部被系统拦截）</span></div>
          <div class="kv"><span class="k">棘轮触发（15 分项）</span><span class="v">${a.ratchetCount} 次</span></div>
        </div>
        <div class="tiny muted" style="margin-top:8px">${esc(ahc.value >= 80 ? SCRIPTS.L14full({ ahc: ahc.value, a: a.achievedCount, b: a.honoredCount }) : '信用不能买，只能攒。')}</div>
      </div>
      <div class="grid grid-2">
        <div class="card"><div class="kpi-label">⑥ 战绩</div><div class="kpi-foot">你的里程碑与灯塔纪录（自动 + 老板手填，修改留痕全员可见）。</div></div>
        <div class="card"><div class="kpi-label">⑦ 灯塔 + 双入口</div>
          <div class="btn-row" style="margin-top:8px"><button class="btn btn--sm">我有异议</button><button class="btn btn--sm">我有个建议（可匿名）</button></div>
          <div class="tiny muted" style="margin-top:6px">提出异议永不进考核路径。</div></div>
      </div>
    </div>`;
  }

  // ========================================================================
  // 屏8 信封与实验室
  // ========================================================================
  function screenSystem() {
    const refs = ['suanzhang', 'dingjia', 'zhaoren', 'yuren'].map(b => {
      const r = extRef(b); const nm = { suanzhang: '算账器', dingjia: '定价器', zhaoren: '招人器', yuren: '育人器' }[b];
      return `<div class="kv"><span class="k">${nm}（${b}）</span><span class="v">${r ? '已导入 ' + asOf(r.exportedAt, null, S.today) : '<span class="dash">未导入</span>'}</span></div>`;
    }).join('');
    const experiments = ['损失框架', '实名匿名', '高强度练习', '任务导向处方', 'M28产权vs一次性', '线索重划', 'JOLT', '季度配速'];
    return `<div class="stack">
      <h1 class="section-title">数据信封与系数实验室</h1>
      <div class="grid grid-2">
        <div class="card"><div class="card-title">数据信封（board = liuren）</div><div class="card-sub" style="margin-bottom:10px">导出双载荷：ahc（derived）+ M28Agreement（entities）。🔴 导出功能永不锁定。</div>
          <div class="btn-row"><button class="btn btn--primary" data-act="export">导出信封 JSON</button><button class="btn" data-act="importPick">导入他方信封</button></div>
          <div class="hr"></div><div class="card-sub" style="margin-bottom:6px">已导入的他方信封（只读 · 整条覆盖）：</div>${refs}
        </div>
        <div class="card"><div class="card-title">系数实验室 M31（8 预置 · 分层随机）</div>
          <div class="pill-row" style="margin-top:8px">${experiments.map(e => badge('neutral', e)).join('')}</div>
          <div class="tiny muted" style="margin-top:10px">🔴 老板不能手选分组；分层随机以 M21 归一化历史为键。样本<10 结果标"仅供参考"。</div>
          <div class="btn-row" style="margin-top:10px"><button class="btn btn--sm" data-act="exportAnon">导出匿名实验包（占位 · 不联网）</button></div>
        </div>
      </div>
      <div class="card"><div class="card-title">授权与降级（公约【11】）</div>
        <div class="grid grid-2">
          <div><div class="kv"><span class="k">授权客户</span><span class="v">${esc(DB.license.tenant)}</span></div>
          <div class="kv"><span class="k">板块</span><span class="v">liuren</span></div>
          <div class="kv"><span class="k">到期</span><span class="v">${esc(DB.license.expiry)}</span></div>
          <div class="kv"><span class="k">当前模式</span><span class="v">${DB.__mode === 'free' ? badge('warning', '免费版（已降级）') : badge('success', '完整版')}</span></div></div>
          <div><label class="field"><span class="field-label">粘贴续期码（离线校验 · ECDSA 公钥验签）</span><input id="lic-code" placeholder="SKAB-LR-..."></label>
          <div class="btn-row"><button class="btn btn--primary" data-act="applyLicense">应用</button></div>
          <div class="tiny muted" style="margin-top:8px">🔒 HTML 内只含公钥；到期只降级不锁数据；导出永不锁定；不做设备指纹（A-17/授-3）。</div></div>
        </div>
      </div>
      <div class="card"><div class="card-title">危险操作</div><div class="btn-row"><button class="btn btn--danger" data-act="reset">重置为出厂数据</button></div></div>
      ${BORDER}</div>`;
  }

  // ========================================================================
  // 系数与自检
  // ========================================================================
  function screenSelfTest() {
    const r = runSelfTest();
    const tcards = r.tcases.map(t => `<div class="tcase ${t.pass ? 'pass' : 'fail'}"><span class="t-mark">${t.pass ? '✓' : '✗'}</span><div><span class="t-id">${t.id}</span> ${esc(t.title)}<div class="t-detail">got: ${esc(t.got)} · want: ${esc(t.want)}</div></div></div>`).join('');
    const acards = r.asserts.map(a => `<div class="tcase ${a.pass ? 'pass' : 'fail'}"><span class="t-mark">${a.pass ? '✓' : '✗'}</span><div><span class="t-id">${esc(a.id)}</span> ${esc(a.title)}<div class="t-detail">${esc(a.detail)}</div></div></div>`).join('');
    const allGreen = r.passCount === r.total && r.assertPass === r.assertTotal;
    return `<div class="stack">
      <h1 class="section-title">系数与自检</h1>
      <div class="card selftest-hero">
        ${ring(Math.round(r.passCount / r.total * 100), allGreen ? 'success' : 'danger')}
        <div><div class="hero-num" style="color:var(--${allGreen ? 'success' : 'danger'})">${r.passCount}/${r.total}</div>
        <div class="kpi-label">件七对拍徽章（三绿＝收货）</div>
        <div class="kpi-foot">红线断言 ${r.assertPass}/${r.assertTotal} · 时钟注入 TEST_TODAY = ${esc(r.today)}（C-14/R-11）</div></div>
      </div>
      <div><h2 class="card-title" style="margin-bottom:10px">件七 · 验收用例集（T1–T19）</h2><div class="badge-grid">${tcards}</div></div>
      <div><h2 class="card-title" style="margin:16px 0 10px">件六 · 红线断言（可运行子集）</h2><div class="badge-grid">${acards}</div></div>
      <div class="card"><div class="card-title">系数总表（结构权系统 / 数值权老板）</div>
        <div class="tiny muted" style="margin-top:6px">全部系数经 getCoef 取用；数值权归老板（可覆盖）。此处为只读速览，编辑入口在各功能页。</div>
        <div class="grid grid-3" style="margin-top:10px">
          <div class="kv"><span class="k">AHC 信任线</span><span class="v">${getCoef('ahcTrustLine')}</span></div>
          <div class="kv"><span class="k">爬坡缺口红线</span><span class="v">${Rate.pct(getCoef('rampGapShareRedline'))}</span></div>
          <div class="kv"><span class="k">接手劣化(慢性)</span><span class="v">${Rate.pct(getCoef('pipelineDecayInPriceTag'))}</span></div>
          <div class="kv"><span class="k">交接折损(急性)</span><span class="v">${Rate.pct(getCoef('handoverLossRate'))}</span></div>
          <div class="kv"><span class="k">信封过期阈值</span><span class="v">${getCoef('envelopeStaleDays')} 天</span></div>
          <div class="kv"><span class="k">备份提醒阈值</span><span class="v">${getCoef('backupNudgeDays')} 天</span></div>
        </div>
      </div>
    </div>`;
  }

  // ---- 路由 ----
  const ROUTES = { overview: screenOverview, pricetag: screenPriceTag, gates: screenGates, m28: screenM28, retention: screenRetention, dividend: screenDividend, sales: screenSales, system: screenSystem, selftest: screenSelfTest };
  function render() {
    document.documentElement.dataset.theme = DB.settings.theme === 'auto' ? '' : DB.settings.theme;
    // 闸① 全锁：算账器未导入 → 除系统/自检外全部锁屏
    if (Engine.boardLocked(DB) && !['system', 'selftest'].includes(S.route)) {
      app().innerHTML = chrome(lockScreen()); return;
    }
    const view = (ROUTES[S.route] || screenOverview)();
    app().innerHTML = chrome(view) + (S.modal || '');
  }

  return { S, render, esc, badge, ring, toast, openModal, closeModal, actions: null };

  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
  function openModal(html) { S.modal = `<div class="modal-backdrop" data-act="closeModalBg"><div class="modal">${html}</div></div>`; render(); }
  function closeModal() { S.modal = null; render(); }
})();
