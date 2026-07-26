/* ============================================================
   驾驶舱（dash）+ 数据中心（data）
   驾驶舱：五板块核心结论一屏尽收 + 预警聚合分诊台 + 联动链路图
   数据中心：公司档案 / 员工档案 / 系数矩阵 / 备份迁移 / 自检徽章
   ============================================================ */
(() => {
  'use strict';
  const { h } = UI, { fmt, esc, DASH, safeDiv } = SK;

  /* ================= 驾驶舱 ================= */
  function alertsAll() {
    const out = [];
    for (const m of SK.modules) if (m.alertList) { try { out.push(...m.alertList()); } catch (e) { console.error('alerts', m.id, e); } }
    return out;
  }
  SK.registerModule({
    id: 'dash', title: '驾驶舱', icon: '🧭', order: 1,
    subnav: [],
    liveCells: () => [],
    render() {
      const dj = SK.X('dingjia'), sz = SK.X('suanzhang'), zr = SK.X('zhaoren'), yr = SK.X('yuren'), lr = SK.X('liuren');
      const alerts = alertsAll();
      const reds = alerts.filter(a => a.tone === 'r'), ambers = alerts.filter(a => a.tone === 'a');
      const kpi = (k, v, s, tone, board, sub) => `<div class="kpi" data-act="ui.nav" data-board="${board}" ${sub ? `data-sub="${sub}"` : ''}><span class="k">${k}</span><span class="v ${tone || ''}">${v}</span><span class="s">${s || ''}</span></div>`;
      const salesN = SK.activeSales().length, mgrN = SK.activeManagers().length;
      return `
      <div class="sect"><h2>经营驾驶舱</h2><span class="sub">${esc(SK.DB.company.name)} · 在职销售 ${salesN} 人 / 主管 ${mgrN} 人 · 今天 ${SK.today()} · 全部数字实时换算，点卡片进板块</span></div>
      <div class="grid g4" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
        ${kpi('今年已注定漏损', dj && dj.total != null ? fmt.wan(dj.total) : DASH, '流失总账+产能高估暴露', 'red', 'dingjia', 'dash')}
        ${kpi('该招人数（七步链）', zr ? fmt.num(zr.trueHires) + ' 人' : DASH, zr && zr.isLate ? `已晚 ${zr.lateDays} 天` : (zr && zr.latestStart ? '最晚开招 ' + zr.latestStart : ''), zr && zr.isLate ? 'red' : '', 'zhaoren', 'result')}
        ${kpi('销售提成率 r', fmt.pct(SK.rRate()), SK.DB.company.rMode === 'auto' ? '定价器实时联动' : '手工锁定', 'accent', 'dingjia', 'dash')}
        ${kpi('全链提成负担', dj && dj.burdenRate != null ? fmt.pct(dj.burdenRate) : DASH, '健康带 25–35%', dj && dj.burdenRate != null ? (dj.burdenRate > 0.35 ? 'red' : dj.burdenRate < 0.25 ? 'amber' : 'green') : '', 'dingjia', 'dash')}
        ${kpi('本月经营净贡献', sz && sz.ledger ? fmt.wan(sz.ledger.net) : DASH, sz && sz.ledger ? '净贡献率 ' + fmt.pct(sz.ledger.rate) : '', sz && sz.ledger && sz.ledger.net < 0 ? 'red' : 'green', 'suanzhang', 'ledger')}
        ${kpi('团队 labor_roi', sz ? fmt.num(sz.laborRoi, 2) : DASH, '毛利 ÷ 人力成本', sz && sz.laborRoi != null && sz.laborRoi < 1 ? 'red' : '', 'suanzhang', 'ledger')}
        ${kpi('地盘失衡率', sz ? fmt.pct(sz.imbalanceRate, 0) : DASH, '全球基准 ≈56%', sz && sz.imbalanceRate > 0.56 ? 'red' : 'amber', 'suanzhang', 'territory')}
        ${kpi('团队 UER 均值', sz && sz.uerTeamMean != null ? (sz.uerTeamMean < 0 ? '−' : '+') + fmt.wan(Math.abs(sz.uerTeamMean)) : DASH, '可观测行为之外的残差/人·月', sz && sz.uerTeamMean != null && sz.uerTeamMean < 0 ? 'red' : '', 'suanzhang', 'uer')}
        ${kpi('老板信用分 AHC', lr ? fmt.num(lr.ahc) : DASH, '及格线 60 · 员工可见', lr && lr.ahc != null ? (lr.ahc < 60 ? 'red' : lr.ahc < 80 ? 'amber' : 'green') : '', 'liuren', 'overview')}
        ${kpi('监督指数 SII', lr ? fmt.num(lr.sii) : DASH, '越低越好 · >60 红', lr && lr.sii > 60 ? 'red' : lr && lr.sii > 30 ? 'amber' : 'green', 'liuren', 'overview')}
        ${kpi('销冠流失价签', lr && lr.priceTagHeadline != null ? fmt.wan(lr.priceTagHeadline) : DASH, '月毛利×(招聘+回本)期', 'red', 'liuren', 'pricetag')}
        ${kpi('辅导剂量', yr && yr.coachingDoseActual != null ? fmt.num(yr.coachingDoseActual, 1) + ' h/人·月' : DASH, '下限 3h · 递减带 5h', yr && yr.coachingDoseActual != null && yr.coachingDoseActual < 3 ? 'red' : 'green', 'yuren', 'pace')}
      </div>

      <div class="grid g23" style="margin-top:12px">
        ${h.card('🚨 今日分诊台 <span class="sub">五板块预警聚合 · 只提示不执行</span>', alerts.length ? alerts.slice(0, 14).map(a =>
          `<div class="kv"><span class="k">${h.dot(a.tone)} ${a.text}</span><b><button class="btn sm" data-act="ui.nav" data-board="${a.board}" ${a.sub ? `data-sub="${a.sub}"` : ''}>去处理 →</button></b></div>`).join('') + (alerts.length > 14 ? h.hint(`还有 ${alerts.length - 14} 条，进各板块查看`) : '')
          : h.banner('当前没有红黄灯——把数据补充完整后，这里会实时聚合五个板块的全部预警。', 'g'),
          { right: `${h.badge(`${reds.length} 红`, reds.length ? 'r' : 'n')} ${h.badge(`${ambers.length} 黄`, ambers.length ? 'a' : 'n')}` })}
        ${h.card('🔗 实时联动链路', `
          <div class="kv"><span class="k">定价器 → 提成率 r</span><b>${fmt.pct(SK.rRate())} → 算账器提成/人力成本</b></div>
          <div class="kv"><span class="k">定价器 → 好招指数</span><b>${dj && dj.goodHireIndex != null ? fmt.num(dj.goodHireIndex, 2) : DASH} → 留人器分红四问 Q1</b></div>
          <div class="kv"><span class="k">算账器 → 真实 P90 倍数</span><b>${sz && sz.realP90Factor != null ? fmt.num(sz.realP90Factor, 2) : '冷启动 1.8'} → 定价器造假闸</b></div>
          <div class="kv"><span class="k">算账器 → M21 归一化</span><b>${sz && sz.m21rows ? sz.m21rows.length + ' 人' : DASH} → 育人器配方源资格 / 留人器该谈名单</b></div>
          <div class="kv"><span class="k">留人器 → AHC ${lr ? fmt.num(lr.ahc) : DASH}</span><b>→ 算账器闸⑪ / 育人器产权前提</b></div>
          <div class="kv"><span class="k">留人器 → M28 协议 ${SK.DB.m28Agreements.length} 份</span><b>→ 育人器配方引擎解锁</b></div>
          <div class="kv"><span class="k">育人器 → 辅导剂量</span><b>${yr && yr.coachingDoseActual != null ? fmt.num(yr.coachingDoseActual, 1) + 'h' : DASH} → 留人器分红四问 Q4</b></div>
          <div class="kv"><span class="k">招人器 → 该招 ${zr ? fmt.num(zr.trueHires) : DASH} 人</span><b>高估率 ${zr ? fmt.pct(zr.overRate, 0) : DASH} → 驾驶舱/定价器</b></div>
          ${h.hint('原五个独立工具靠「信封 JSON」异步互导；一体版改为同一数据库实时总线——任何输入变化，五板块与本页同帧换算。')}`)}
      </div>
      <div class="callout">⚠️ 系统边界：这个系统不会让一个卖不动的产品卖动。如果你的产品本身有问题——先去改产品。</div>
      <div class="print-foot">销冠操盘系统 · 一体版 · ${esc(SK.DB.company.name)} · 生成于 ${SK.today()} · 经营净贡献口径，非财务报表口径。本报告不构成税务/法律实质建议。</div>`;
    },
  });

  /* ================= 数据中心 ================= */
  const POS_OPTS = [{ v: 'sales', t: '销售' }, { v: 'manager', t: '主管' }, { v: 'executive', t: '高管' }];
  const CITY_OPTS = [{ v: 'tier1', t: '一线' }, { v: 'tier2', t: '二线' }, { v: 'tier34', t: '三四线' }];
  const COEF_EDIT = [
    ['shared.socialCostRate', '社保成本率（0–1）'], ['shared.attritionRateDefault', '默认年流失率（0–1）'],
    ['shared.ahcTrustLine', 'AHC 信用及格线（分）'], ['shared.backupNudgeDays', '备份提醒（天）'],
    ['shared.p90ColdFactor', 'P90 冷启动倍数'], ['shared.imbalanceGlobal', '地盘失衡全球基准（0–1）'],
    ['shared.longTermRate', '长期分红池占比（0–1）'],
    ['dingjia.cityBase.tier1', '定价·一线城市基数（分/月）'], ['dingjia.attainabilityRedline', '定价·可达性红线（倍）'],
    ['shared.recruitFeeDefaultAmt', '招聘直接费默认（分）'], ['shared.hiringCostDefaultAmt', '完全招聘成本默认（分）'],
    ['suanzhang.discountLeakRedline', '算账·折扣泄漏红线（0–1）'], ['suanzhang.pushShareRedline', '算账·期末冲刺占比红线（0–1)'],
    ['suanzhang.uerMinObs', '算账·UER 最小观测数'], ['suanzhang.m36Redline', '算账·卡线率红线（0–1）'],
    ['zhaoren.practiceMinCount14d', '招人·前14天练习红线（次）'], ['zhaoren.cognitiveGapRedline', '招人·认知鸿沟红线（0–1）'],
    ['yuren.newbieWindow.thresholdRate', '育人·新人阈值系数（0–1）'], ['yuren.spotCheck.weeklyK', '育人·每周抽检张数'],
    ['yuren.m40.pairWeeksMax', '育人·配对最长连续周'], ['yuren.m43.subGoalX', '育人·弃赛区子目标倍数'],
    ['liuren.rampGapShareRedline', '留人·爬坡缺口占比红线（0–1）'], ['liuren.handoverLossRate', '留人·交接折损率（0–1）'],
  ];
  function personRow(p) {
    const t = SK.today();
    const tenure = Math.floor(SK.diffDays(p.hireDate, t) / 30);
    return `<tr>
      <td><b>${esc(p.name)}</b> <span class="hint mono">${SK.maskPhone(p.phone)}</span></td>
      <td>${SK.POS_CN[p.positionType] || p.positionType}</td>
      <td>${SK.CITY_CN[p.cityTier] || ''}</td>
      <td class="num">${fmt.yuan(p.baseSalaryAmt)}/月</td>
      <td class="num">${p.hireDate}（${tenure} 个月）</td>
      <td>${p.isActive ? h.badge('在职', 'g') : h.badge('离职' + (p.leaveReason ? '·' + p.leaveReason : ''), 'n')}</td>
      <td style="white-space:nowrap">${h.btn('编辑', 'data.person-edit', { cls: 'sm', data: `data-id="${p.spId}"` })} ${p.isActive ? h.btn('离职', 'data.person-leave', { cls: 'sm', data: `data-id="${p.spId}"` }) : ''}</td>
    </tr>`;
  }
  SK.registerModule({
    id: 'data', title: '数据中心', icon: '🗄️', order: 99,
    subnav: [
      { id: 'company', label: '公司档案' }, { id: 'people', label: '员工档案' },
      { id: 'coef', label: '系数矩阵' }, { id: 'backup', label: '备份迁移' }, { id: 'selftest', label: '自检徽章' },
    ],
    liveCells: () => [],
    render(sub) {
      if (sub === 'people') return this.vPeople();
      if (sub === 'coef') return this.vCoef();
      if (sub === 'backup') return this.vBackup();
      if (sub === 'selftest') return this.vSelftest();
      return this.vCompany();
    },
    vCompany() {
      const c = SK.DB.company;
      return `
      <div class="sect"><h2>公司档案</h2><span class="sub">全系统共享输入——改一处，五个板块同帧换算</span></div>
      <div class="grid g2">
        ${h.card('基本盘', `<div class="frm">
          ${h.field('公司名称', h.input('company.name', 'str', { itype: 'text', value: c.name }))}
          ${h.field('城市线级', h.seg('company.cityTier', CITY_OPTS, c.cityTier))}
          ${h.field('成交周期档', h.select('company.cycleTier', Object.entries(SK.CYCLE_CN).map(([v, t]) => ({ v, t })), c.cycleTier), '从客户首次接触到回款的典型时长')}
          ${h.field('综合毛利率 %', h.input('company.blendedMarginRate', 'pct100', { value: Math.round(c.blendedMarginRate * 1000) / 10, step: 0.1 }), '全品类加权')}
          ${h.field('年流失率 %', h.input('company.attritionRate', 'pct100', { value: Math.round(c.attritionRate * 1000) / 10, step: 1 }), '全球销售岗基准约 35%')}
          ${h.field('招聘周期（天）', h.input('company.hiringCycleDays', 'int', { value: c.hiringCycleDays }), '发帖到到岗，行业参考 45 天')}
        </div>`)}
        ${h.card('目标与人效', `<div class="frm">
          ${h.field('规划年份', h.seg('company.targetYearMode', [{ v: 'next', t: '明年' }, { v: 'this', t: '今年' }], c.targetYearMode))}
          ${h.field('今年公司回款目标（万）', h.input('company.targetYearCollectWan', 'num', { value: c.targetYearCollectWan }), `系统按毛利率自动换算内部毛利口径（当前 ≈ ${c.targetYearGrossWan != null ? c.targetYearGrossWan : '—'} 万毛利）`)}
          ${h.field('去年人均回款（万/年·真值）', h.input('company.lastYearPerCapitaCollectWan', 'num', { value: c.lastYearPerCapitaCollectWan }), '去年总回款÷销售人数，别用配额')}
          ${h.field('达标销售月回款目标（万）', h.input('company.targetPersonalMonthlyCollectWan', 'num', { value: c.targetPersonalMonthlyCollectWan, step: 1 }), '参考：去年人均月回款×1.2')}
          ${h.field('单人全负担年成本（万）', h.input('company.fullLoadWan', 'num', { value: c.fullLoadWan }), '底薪+社保+提成全含')}
          ${h.field(`提成率 r 口径 ${h.linked()}`, h.seg('company.rMode', [{ v: 'auto', t: '定价器实时' }, { v: 'manual', t: '手工锁定' }], c.rMode), c.rMode === 'manual' ? '' : '当前 r = ' + fmt.pct(SK.rRate()))}
          ${c.rMode === 'manual' ? h.field('手工提成率 %', h.input('company.rManual', 'pct100', { value: Math.round(c.rManual * 10000) / 100, step: 0.01 })) : ''}
        </div>`)}
      </div>
      ${h.banner(`在职销售 <b>${SK.activeSales().length}</b> 人 / 主管 <b>${SK.activeManagers().length}</b> 人——由「员工档案」实时统计，定价器/招人器直接取用，无需重复填写。`, 'b')}`;
    },
    vPeople() {
      const act = SK.DB.people.filter(p => p.isActive), left = SK.DB.people.filter(p => !p.isActive);
      return `
      <div class="sect"><h2>员工档案</h2><span class="sub">全板块共用最小字段集——算账/育人/留人按 spId 关联</span>
        <span style="margin-left:auto">${h.btn('＋ 新增员工', 'data.person-edit', { cls: 'pri' })}</span></div>
      ${h.card(`在职（${act.length}）`, h.tbl(
        [{ t: '姓名' }, { t: '岗位' }, { t: '城市' }, { t: '底薪', num: 1 }, { t: '入职', num: 1 }, { t: '状态' }, { t: '' }],
        act.map(personRow)))}
      ${left.length ? h.card(`离职（${left.length}）`, h.tbl(
        [{ t: '姓名' }, { t: '岗位' }, { t: '城市' }, { t: '底薪', num: 1 }, { t: '入职', num: 1 }, { t: '状态' }, { t: '' }],
        left.map(personRow))) : ''}`;
    },
    vCoef() {
      return `
      <div class="sect"><h2>系数矩阵</h2><span class="sub">全球四十年实证基准值——数值权归你，改任一格全站即时重算；留空=恢复出厂</span></div>
      ${h.banner('🌍 全球证据给方向，你的系数定生死。双侧共用的系数（社保率、S曲线口径、流失折半）一体版天然同步——原五件套需要人工对齐的 R-04 铁律已由架构保证。', 'b')}
      ${h.card('可覆盖系数', h.tbl([{ t: '系数' }, { t: '出厂值', num: 1 }, { t: '覆盖值（留空=出厂）', num: 1 }],
        COEF_EDIT.map(([path, label]) => {
          const def = SK.getPath(SK.COEF_DEFAULT, path);
          const ov = SK.DB.coefOverrides[path];
          return `<tr><td>${label}<div class="hint mono">${path}</div></td><td class="num">${def}</td>
            <td class="num"><input type="number" step="any" style="width:110px" data-bind="coef:${path}" data-type="num" value="${ov != null ? ov : ''}"></td></tr>`;
        })))}
      ${Object.keys(SK.DB.coefOverrides).length ? h.btn('恢复全部出厂系数', 'data.coef-reset', { cls: 'danger' }) : ''}`;
    },
    vBackup() {
      const kb = SK.storageKB();
      return `
      <div class="sect"><h2>备份与迁移</h2><span class="sub">随时全量导出 · 一键恢复 · 数据永不锁定</span></div>
      <div class="grid g2">
        ${h.card('📦 全量备份', `
          <p class="hint" style="margin-bottom:8px">导出整个系统的全部数据（公司档案/员工/成交/日报/协议/系数覆盖…）为一个 JSON 文件。换电脑时导入即可完整恢复。</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${h.btn('导出全量备份 JSON', 'data.export', { cls: 'pri' })}${h.btn('导入备份文件', 'data.import')}</div>
          <input type="file" id="import-file" accept="application/json" style="display:none">
          <div class="divider"></div>
          <div class="kv"><span class="k">上次导出</span><b>${SK.DB.ui.lastExportAt || '从未'}</b></div>
          <div class="kv"><span class="k">本地存储占用</span><b>${kb != null ? kb + ' KB' : DASH}</b></div>`)}
        ${h.card('🧪 演示与重置', `
          <p class="hint" style="margin-bottom:8px">演示数据是一家 10 名销售的公司（近 7 个月完整经营流水），保证五个板块的每一个诊断都被点亮。</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${h.btn('载入演示数据', 'data.seed')}${h.btn('清空全部数据', 'data.clear', { cls: 'danger' })}</div>
          <div class="divider"></div>
          <div class="kv"><span class="k">数据实体</span><b>员工 ${SK.DB.people.length} · 成交 ${SK.DB.deals.length} · 线索 ${SK.DB.leads.length} · 日报 ${SK.DB.dailyReports.length}</b></div>
          <div class="kv"><span class="k"></span><b>折扣 ${SK.DB.discounts.length} · 发放 ${SK.DB.payouts.length} · 协议 ${SK.DB.m28Agreements.length} · 候选人 ${SK.DB.candidates.length}</b></div>`)}
      </div>
      ${h.banner('🔒 两条底线：① 数据归你——随时全量导出、永不锁定，正式版数据存在你自己的服务器上；② 每个数字经得起较真——所有判定带 📎 出处，系数可在「系数矩阵」覆盖。', 'n')}`;
    },
    vSelftest() {
      const res = SK.tests.map(t => {
        try { const r = t.fn(); return { id: t.id, name: t.name, pass: r === true || (r && r.pass), detail: r && r.got !== undefined ? `got ${JSON.stringify(r.got)} want ${JSON.stringify(r.want)}` : '' }; }
        catch (e) { return { id: t.id, name: t.name, pass: false, detail: e.message }; }
      });
      const pass = res.filter(r => r.pass).length;
      return `
      <div class="sect"><h2>对拍自检徽章</h2><span class="sub">与五件套原始黄金值逐字对拍 · 全绿=收货，有红=退回</span></div>
      ${h.card(`${pass === res.length ? '✅' : '🔴'} ${pass}/${res.length} 绿`, `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px">
        ${res.map(r => `<div class="kv" style="border:1px solid var(--line);border-radius:7px;padding:5px 9px" title="${esc(r.detail)}">
          <span class="k">${r.id} ${esc(r.name)}</span><b>${r.pass ? '✓' : '✗'}</b></div>`).join('')}
        </div>`)}
      ${h.hint('自检使用固定测试夹具与冻结时钟（TEST_TODAY），独立于你的业务数据，跑完自动还原。')}`;
    },
  });

  /* ---------- 数据中心动作 ---------- */
  Object.assign(SK.actions, {
    'data.export': () => {
      const payload = { schema: 'skab_suite_v1', exportedAt: SK.today(), db: SK.DB };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `skab_suite_${SK.today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      SK.DB.ui.lastExportAt = SK.today(); UI.commit(); UI.toast('已导出全量备份');
    },
    'data.import': () => {
      const f = document.getElementById('import-file');
      f.onchange = () => {
        const file = f.files[0]; if (!file) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const j = JSON.parse(rd.result);
            if (j.schema !== 'skab_suite_v1' || !j.db) return UI.toast('不是本系统的备份文件（schema 不符）');
            localStorage.setItem(SK.LS_KEY, JSON.stringify(j.db));
            SK.loadDB(); UI.applyTheme(); UI.commit(); UI.toast('备份已恢复');
          } catch (e) { UI.toast('导入失败：' + e.message); }
        };
        rd.readAsText(file);
      };
      f.click();
    },
    'data.seed': () => { SK.seedDemo(); UI.commit(); UI.toast('演示数据已载入——五个板块全部点亮'); },
    'data.clear': () => {
      UI.modal(`<h3>清空全部数据？</h3><p class="hint">将删除本机上本系统的全部数据（员工/成交/协议/系数覆盖…）。建议先导出备份。此操作不可撤销。</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">${h.btn('取消', 'ui.modal-close')}${h.btn('确认清空', 'data.clear-yes', { cls: 'danger' })}</div>`);
    },
    'data.clear-yes': () => { SK.emptyDB(); SK.persist(); UI.closeModal(); UI.commit(); UI.toast('已清空'); },
    'data.coef-reset': () => { SK.DB.coefOverrides = {}; UI.commit(); UI.toast('已恢复全部出厂系数'); },
    'data.person-edit': d => {
      const p = d.id ? SK.personById(d.id) : null;
      UI.modal(`<h3>${p ? '编辑员工 · ' + esc(p.name) : '新增员工'}</h3>
        <div class="frm">
          ${h.field('姓名', `<input id="pe-name" type="text" value="${p ? esc(p.name) : ''}">`)}
          ${h.field('手机（查重键）', `<input id="pe-phone" type="text" value="${p ? esc(p.phone || '') : ''}">`)}
          ${h.field('岗位', `<select id="pe-pos">${POS_OPTS.map(o => `<option value="${o.v}" ${p && p.positionType === o.v ? 'selected' : ''}>${o.t}</option>`).join('')}</select>`)}
          ${h.field('城市档', `<select id="pe-city">${CITY_OPTS.map(o => `<option value="${o.v}" ${p && p.cityTier === o.v ? 'selected' : ''}>${o.t}</option>`).join('')}</select>`)}
          ${h.field('底薪（元/月）', `<input id="pe-base" type="number" value="${p ? Math.round(p.baseSalaryAmt / 100) : 6000}">`)}
          ${h.field('入职日期', `<input id="pe-hire" type="date" value="${p ? p.hireDate : SK.today()}">`)}
          ${h.field('渠道', `<select id="pe-ch"><option value="referral">内推</option><option value="boss_zhipin">Boss直聘</option><option value="liepin">猎聘</option><option value="manual">其他</option></select>`)}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">${h.btn('取消', 'ui.modal-close')}${h.btn('保存', 'data.person-save', { cls: 'pri', data: `data-id="${p ? p.spId : ''}"` })}</div>`);
      if (p) document.getElementById('pe-ch').value = p.sourceChannel || 'manual';
    },
    'data.person-save': d => {
      const g = id => document.getElementById(id);
      const name = g('pe-name').value.trim();
      if (!name) return UI.toast('姓名必填');
      const phone = g('pe-phone').value.trim();
      // 查重：同手机号 → 在职拦截，离职放行提示
      const dup = phone && SK.DB.people.find(p => p.phone === phone && p.spId !== d.id);
      if (dup && dup.isActive) return UI.toast(`与在职员工 ${dup.name} 手机号重复，已拦截`);
      const rec = {
        name, phone, positionType: g('pe-pos').value, cityTier: g('pe-city').value,
        baseSalaryAmt: Math.round((parseFloat(g('pe-base').value) || 0) * 100),
        hireDate: g('pe-hire').value || SK.today(), sourceChannel: g('pe-ch').value,
      };
      if (d.id) Object.assign(SK.personById(d.id), rec);
      else SK.DB.people.push(Object.assign({ spId: SK.uid('sp'), level: 1, managerId: null, hireBatchId: null, hiringCostAmt: SK.getCoef('shared.hiringCostDefaultAmt'), isActive: true, leaveDate: null, leaveReason: null }, rec));
      if (dup && !dup.isActive) UI.toast(`提示：${dup.name} 曾于 ${dup.leaveDate || '?'} 离职（${dup.leaveReason || '原因未记录'}），已放行`);
      UI.closeModal(); UI.commit();
    },
    'data.person-leave': d => {
      const p = SK.personById(d.id); if (!p) return;
      UI.modal(`<h3>登记离职 · ${esc(p.name)}</h3>
        <div class="frm">
          ${h.field('离职日期', `<input id="pl-date" type="date" value="${SK.today()}">`)}
          ${h.field('原因', `<select id="pl-why"><option value="resign_other">主动离职</option><option value="probation_fail">试用未过</option><option value="cull">优化</option><option value="other">其他</option></select>`)}
        </div>
        ${h.banner('登记后：留人器将生成「余震名单」（离职传染 Top3，一周内一对一），交接损耗计入流失价签第⑥项。', 'a')}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">${h.btn('取消', 'ui.modal-close')}${h.btn('确认离职', 'data.person-leave-yes', { cls: 'danger', data: `data-id="${p.spId}"` })}</div>`);
    },
    'data.person-leave-yes': d => {
      const p = SK.personById(d.id); if (!p) return;
      p.isActive = false;
      p.leaveDate = document.getElementById('pl-date').value || SK.today();
      p.leaveReason = document.getElementById('pl-why').value;
      UI.closeModal(); UI.commit(); UI.toast(`${p.name} 已登记离职——留人器已生成余震名单`);
    },
  });
})();
