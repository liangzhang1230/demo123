// ============================================================================
// 存储层：StorageAdapter（localStorage，前缀 skab_liuren_；预留 IndexedDB 切换位）
// + 实体 + 信封（skab_v1：derived + entities）+ ExternalRef（整条覆盖·只读）
// + 授权/降级（公约【11】：ECDSA 公钥验签，HTML 内只含公钥）
// ============================================================================
const PREFIX = 'skab_liuren_';
const hasLS = (() => { try { return typeof localStorage !== 'undefined'; } catch (_) { return false; } })();
const _mem = {}; // Node/自检环境无 localStorage 时的内存兜底

const StorageAdapter = {
  get(key) { try { return hasLS ? localStorage.getItem(PREFIX + key) : (_mem[key] ?? null); } catch (_) { return _mem[key] ?? null; } },
  set(key, val) { try { hasLS ? localStorage.setItem(PREFIX + key, val) : (_mem[key] = val); } catch (_) { _mem[key] = val; } },
  remove(key) { try { hasLS ? localStorage.removeItem(PREFIX + key) : delete _mem[key]; } catch (_) { delete _mem[key]; } },
  // 配额自检（C-15：占用估算 + 写入探针）
  probe() {
    let used = 0;
    try { for (const k in (hasLS ? localStorage : _mem)) if (k.startsWith(PREFIX) || !hasLS) used += (StorageAdapter.get(k.replace(PREFIX, '')) || '').length; } catch (_) {}
    let writable = true;
    try { StorageAdapter.set('__probe__', '1'); StorageAdapter.remove('__probe__'); } catch (_) { writable = false; }
    return { approxBytes: used, writable, budgetBytes: 800 * 1024 }; // 单板块建议 ≤0.8MB
  },
};

// ---- 授权（公约【11】·全程零网络请求 A-17）----
const LICENSE = {
  // 🔴 HTML 内唯一密钥材料 = 公钥（授-5）；私钥永不进文件
  publicJwk: { kty: 'EC', crv: 'P-256', x: 'MzOG2tyKl1F1vO_p7MHNf6coVU9PLZCf_1G5QD3lHws', y: '8SJHKfZ40_POfMZduHIf9scLux7a1weIDuVHYFe69ic' },
  demoCode: 'SKAB-LR-ABFHWITUMVXGC3TUEI5CFZV4STT2JOXHU6P6NCFXEDBLOIHHR2F6NAF3EIWCEYTPMFZGIIR2EJWGS5LSMVXCELBCMV4HA2LSPERDUIRSGAZDOLJRGIWTGMJCPWYIENG3FZ3IC7674CILKSNUR5T5J7ZTI3WQSWCVW4DAVULBY24YBRTR5NMPO375424C4LLO3RVPKTTHULY5QMRITCDN6GLPZSGXN23F',
};
const B32AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { const idx = B32AL.indexOf(ch); if (idx < 0) continue; val = (val << 5) | idx; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
// 纯逻辑：按日期解析 BUILD_MODE（授-2 到期只降级；防调表 seenMaxDate）——可离线单测
function resolveModeByDate(expiry, today, seenMaxDate) {
  if (seenMaxDate && today < seenMaxDate) return { mode: 'free', reason: 'clock_rollback' }; // 防调表
  if (!expiry) return { mode: 'free', reason: 'no_license' };
  if (today > expiry) return { mode: 'free', reason: 'expired' };                            // 到期只降级
  return { mode: 'full', reason: 'ok' };
}
async function verifyLicenseCode(code) {
  // 解码 → 公钥验签（crypto.subtle.verify，浏览器原生，零 CDN）
  try {
    const raw = code.replace(/^SKAB-LR-/, '').replace(/-/g, '');
    const bytes = b32decode(raw);
    const plen = (bytes[0] << 8) | bytes[1];
    const payloadBytes = bytes.slice(2, 2 + plen);
    const sig = bytes.slice(2 + plen);
    const cryptoObj = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : null;
    if (!cryptoObj) return { ok: false, reason: 'no_webcrypto' };
    const key = await cryptoObj.subtle.importKey('jwk', LICENSE.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await cryptoObj.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, payloadBytes);
    if (!ok) return { ok: false, reason: 'bad_sig' };
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return { ok: true, payload };
  } catch (e) { return { ok: false, reason: 'parse_error' }; }
}

// ============================================================================
// 数据库根对象
// ============================================================================
const DB_KEY = 'db';
let DB = null;

function saveDB() { if (DB) StorageAdapter.set(DB_KEY, JSON.stringify(DB)); }
function loadDB() {
  const raw = StorageAdapter.get(DB_KEY);
  if (raw) { try { DB = JSON.parse(raw); } catch (_) { DB = null; } }
  if (!DB) { DB = factory(); saveDB(); }
  setCoefOverride(DB.coefOverride || {});
  return DB;
}
function resetDB() { DB = factory(); setCoefOverride(DB.coefOverride || {}); saveDB(); return DB; }

// ---- 信封（公约【7】）----
function buildEnvelope(today) {
  // 🔧L-C11 双载荷：ahc(derived) + M28Agreement(entities)；导出永不锁定（授-2）
  const ind = Engine.indices(DB, today);
  return {
    schema: 'skab_v1',
    board: 'liuren',
    exportedAt: today,
    dataVersion: DB.meta.dataVersion,
    coefficientsHash: coefficientsHash(),
    derived: {
      ahc: ind.ahc.value,          // 供算账器闸⑪证据 e1（S-12）
      dvi: ind.dvi.value,          // 回流
    },
    entities: {
      M28Agreement: DB.entities.M28Agreement,     // 供算账器闸⑪证据 e2 + §3.3 产权价值分组
      Covenant: DB.entities.Covenant,
      LedgerEntry: DB.entities.LedgerEntry,
      ObjectionEntry: DB.entities.ObjectionEntry,
      SuggestionEntry: DB.entities.SuggestionEntry,
      HandoverCard: DB.entities.HandoverCard,
    },
  };
}
// ExternalRef 整条覆盖式导入（只读；永不进信封；A-20）
function importEnvelope(env, today) {
  if (!env || env.schema !== 'skab_v1' || !env.board) return { ok: false, reason: 'bad_schema' };
  const hashMismatch = env.coefficientsHash && env.coefficientsHash !== coefficientsHash();
  DB.externalRefs[env.board] = {
    board: env.board,
    exportedAt: env.exportedAt,
    dataVersion: env.dataVersion,
    coefficientsHash: env.coefficientsHash,
    derived: env.derived || {},
    entities: env.entities || {},
    importedAt: today,
  };
  saveDB();
  return { ok: true, board: env.board, hashMismatch };
}
function extRef(board) { return DB.externalRefs[board] || null; }
function staleDays(board, today) { const r = extRef(board); return r && r.exportedAt ? D.diffDays(r.exportedAt, today) : null; }

// ============================================================================
// 出厂数据（种子）—— 工程化复现件七 T1–T19 对拍
// 组件级输入直接照抄规格 3.1/3.5/3.7/3.8/3.9 的出厂算例
// ============================================================================
function factory() {
  const people = [
    { spId: 'sp_wangli', name: '王丽', phone: '13800000001', cityTier: 'tier1', level: 2, positionType: 'sales', hireDate: '2022-08-01', managerId: null, sourceChannel: 'referral', baseSalaryAmt: 6000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_wangwu', name: '王五', phone: '13800000002', cityTier: 'tier1', level: 0, positionType: 'sales', hireDate: '2026-05-20', managerId: null, sourceChannel: 'ad', baseSalaryAmt: 5000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_zhaomin', name: '赵敏', phone: '13800000003', cityTier: 'tier2', level: 1, positionType: 'sales', hireDate: '2024-01-15', managerId: null, sourceChannel: 'referral', baseSalaryAmt: 5000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_liqiang', name: '李强', phone: '13800000004', cityTier: 'tier1', level: 1, positionType: 'sales', hireDate: '2026-06-05', managerId: null, sourceChannel: 'ad', baseSalaryAmt: 5500_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_sunhao', name: '孙浩', phone: '13800000005', cityTier: 'tier2', level: 1, positionType: 'sales', hireDate: '2023-07-13', managerId: null, sourceChannel: 'referral', baseSalaryAmt: 5000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_zhouqi', name: '周琦', phone: '13800000006', cityTier: 'tier2', level: 1, positionType: 'sales', hireDate: '2024-03-01', managerId: null, sourceChannel: 'ad', baseSalaryAmt: 5000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_wuqi', name: '吴琪', phone: '13800000007', cityTier: 'tier2', level: 1, positionType: 'sales', hireDate: '2023-09-01', managerId: null, sourceChannel: 'referral', baseSalaryAmt: 5000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_zheng', name: '郑爽', phone: '13800000008', cityTier: 'tier3', level: 1, positionType: 'sales', hireDate: '2024-06-01', managerId: null, sourceChannel: 'ad', baseSalaryAmt: 4000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_feng', name: '冯波', phone: '13800000009', cityTier: 'tier2', level: 1, positionType: 'sales', hireDate: '2023-02-01', managerId: null, sourceChannel: 'referral', baseSalaryAmt: 5000_00, hiringCostAmt: 15000_00, isActive: true },
    { spId: 'sp_chen', name: '陈立', phone: '13800000010', cityTier: 'tier2', level: 2, positionType: 'manager', hireDate: '2021-05-01', managerId: null, sourceChannel: 'internal', baseSalaryAmt: 9000_00, hiringCostAmt: 15000_00, isActive: true },
  ];

  return {
    meta: { createdAt: '2026-04-01', dataVersion: 1 },
    settings: { theme: 'auto', bossOpLogEnabled: true },
    license: { code: LICENSE.demoCode, tenant: '演示租户 · 王总', board: 'liuren', expiry: '2027-12-31', verified: true, seenMaxDate: null },
    coefOverride: {},

    // 治理体检输入快照（件三 3.1/3.2 组件级；出厂对拍 T8/T9/T10/T16 源）
    governance: {
      sii: { dailyReportOn: true, rollcallOn: true, spotChecksPerWeek: 3, approvalLevels: 2, monthlyViewsTotal: 20, activeHeadcount: 10, rxCountTotal: 80 },
      ei: { objectionsRaisedQuarter: 0, suggestionsRaised: 0, suggestionsAdopted: 0, covenantConfirmRatio: 0, cardIgnoreRate: 0.82, activeHeadcount: 10, objection90dCount: 0 },
      ahcInputs: { honoredRatio: 0.61, achievedCount: 41, honoredCount: 25, irrevocableRatio: 0, interceptCount: 4, ratchetCount: 2, raiseUpCount: 3 },
      selfRating: { sii: 40, ei: 70, dvi: 80, ahc: 85 },
    },

    entities: {
      Salesperson: people,
      // 前程合约（合约双方确认比例：出厂 0%）
      Covenant: [],
      // 产权协议（出厂覆盖 0% → AHC 第二项 0；对拍 T6/T7 用其 rate/dur + 快照）
      M28Agreement: [
        { m28Id: 'm28_demo1', masterId: 'sp_wangli', kind: 'mentoring', rate: 0.05, durationMonths: 12, startTrigger: 'apprentice_ramp_done', apprenticeMonthlyNetAmt: 58000_00, baselineSnapshotAmt: null, irrevocable: true, createdAt: '2026-05-01' },
        { m28Id: 'm28_demo2', masterId: 'sp_wangli', kind: 'royalty', rate: 0.02, durationMonths: 24, startTrigger: 'recipe_live', teamMonthlyIncrementAmt: 73000_00, baselineSnapshotAmt: 120000_00, irrevocable: true, createdAt: '2026-05-01' },
      ],
      // 履约总账（双时间戳；出厂履约率 61% = 25/41）
      LedgerEntry: [],
      ObjectionEntry: [],
      SuggestionEntry: [],
      Experiment: [],
      HandoverCard: [],
      BossSelfRating: [],
      // 发放史（M37 参照点：去年同期 year_end_bonus 30000 元）
      PayoutEntry: [
        { peId: 'pe_1', employeeId: 'sp_wangli', type: 'year_end_bonus', amt: 30000_00, period: '2025-07', createdAt: '2025-07-15' },
      ],
      OverrideEvent: [],
    },

    // 价签出厂算例（T1–T4）：近6月月均毛利 10万；招聘周期 1.5月 + 批均回本 6月 = 75万
    priceTag: { spId: 'sp_wangli', monthlyGrossMarginAmt: 100000_00, hireMonths: 1.5, paybackMonths: 6, rampGapMonthsEq: 5.078, raiseMonthlyAmt: 3000_00, shortenPct: 0.37, hiresPerYear: 2.267 },

    // 分红配置（M17：三重闸 + 池比例）
    dividend: {
      period: 'quarter', poolRate: 0.10, netBeforeDividendAmt: 800000_00,
      gateCompanyCollect: { enabled: true, pass: true }, gateCompanyNet: { enabled: true, pass: true }, gatePersonalCollect: { enabled: true, pass: true },
    },

    blueprint: { milestones: [{ id: 'bp1', name: '开新品类', done: false }, { id: 'bp2', name: '带出 2 名满产新人', done: false }] },

    // ExternalRef 只读缓存（出厂预置 = 已导入四方信封，功能点亮）
    externalRefs: {
      suanzhang: {
        board: 'suanzhang', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02',
        derived: { dvi: 54, imbalanceRate: 0.56, m11ManagerLift: null, uerTeamMean: 0.31 },
        entities: {},
        perPerson: {
          // 归一化排名 / 剪刀差 / 市价差 / 线索指数 / 滚6月回款(分) / 特殊发放笔数
          sp_wangli: { normRankMonths: [1,1,1,1,1,1], scissors: 0.12, marketGap: 0.05, leadIndex: 1.7, collected6m: 1800000_00, specialPayout12m: 3, contribGrowth: 0.267 },
          sp_zhaomin: { normRankMonths: [2,2,2,2,2,2], scissors: 0.34, marketGap: 0.08, leadIndex: 1.1, collected6m: 900000_00, specialPayout12m: 0 },
          sp_sunhao: { normRankMonths: [4,3,5,4,4,5], scissors: -0.05, marketGap: -0.02, leadIndex: 0.9, collected6m: 520000_00, specialPayout12m: 0 },
          sp_zhouqi: { normRankMonths: [6,6,7,6,6,6], scissors: 0.02, marketGap: 0.10, leadIndex: 0.8, collected6m: 410000_00, specialPayout12m: 0 },
          sp_wuqi: { normRankMonths: [3,4,3,3,4,3], scissors: 0.31, marketGap: -0.06, leadIndex: 1.0, collected6m: 700000_00, specialPayout12m: 0 },
        },
        m21Done: true, netContributionAmt: 800000_00,
      },
      dingjia: {
        board: 'dingjia', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02',
        derived: { goodHireIndex: 1.05, r: 0.18, irrevocable: true, matrixTAmt: 40000_00 }, entities: {},
      },
      zhaoren: {
        board: 'zhaoren', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02',
        derived: { batchPaybackMonths: 6, rampCycle: 'regular' }, entities: {},
      },
      yuren: {
        board: 'yuren', exportedAt: '2026-07-01', dataVersion: 1, coefficientsHash: null, importedAt: '2026-07-02',
        derived: { coachingDoseActual: 3.4 }, entities: {},
      },
    },

    // 悬赏（闸③ 演示用；静默认可通道默认未启）
    silentTrackOn: false,
    ui: { backupLastExportAt: '2026-07-01' },
  };
}
