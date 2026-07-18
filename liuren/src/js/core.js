// ============================================================================
// 宪法层（公约【2】【3】【4】）—— 唯一源，全系统 import，禁止重复实现
// 全部为纯函数；含日期计算的函数一律显式传入 today（公约 C-14 时钟注入铁律）
// ============================================================================

// ---- 【3】兜底铁律：safeDiv（除号唯一合法出口）----
function safeDiv(a, b) {
  return (b === 0 || b == null || a == null) ? null : a / b;
}
// null ≠ 0：证据缺失显 "—"，绝不退化为 0（A-19）
const DASH = '—';

// ---- 【2】全局数据类型 · 展示层格式化（运算层永不中途舍入）----
// 金额一律以「分」(int) 存储与运算；展示才转元。
const Money = {
  yuan: (fen) => (fen == null ? null : fen / 100),
  // ¥12,480（默认整数元，千分位）
  cny: (fen) => (fen == null ? DASH : '¥' + Math.round(fen / 100).toLocaleString('en-US')),
  // 3.5 万（保留 1 位）；元→万 = fen/1e6
  wan: (fen, dp = 1) => (fen == null ? DASH : (fen / 1e6).toFixed(dp) + ' 万'),
  wanNum: (fen) => (fen == null ? null : fen / 1e6),
};
const Rate = {
  // 35.0%（×100 保留 1 位）
  pct: (r, dp = 1) => (r == null ? DASH : (r * 100).toFixed(dp) + '%'),
  signPct: (r, dp = 1) => (r == null ? DASH : (r >= 0 ? '+' : '') + (r * 100).toFixed(dp) + '%'),
};
const Num = {
  x: (n, dp = 1) => (n == null ? DASH : n.toFixed(dp) + ' 倍'),
  int: (n) => (n == null ? DASH : Math.round(n).toLocaleString('en-US')),
};

// ---- 日期（YYYY-MM-DD；比较左闭右闭）----
const D = {
  parse: (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  iso: (dt) => dt.toISOString().slice(0, 10),
  diffDays: (a, b) => Math.round((D.parse(b) - D.parse(a)) / 86400000), // b - a（天）
  addDays: (s, n) => D.iso(new Date(D.parse(s).getTime() + n * 86400000)),
  monthKey: (s) => String(s).slice(0, 7),
  // UI 层唯一取真实时钟处（计算层禁止 new Date()）
  realToday: () => new Date().toISOString().slice(0, 10),
};

// ---- ID：{缩写}_{毫秒}_{4位随机}（仅 UI 录入用，不进纯计算）----
function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================================
// 【4.7】全系统唯一 S 曲线（🔧C-04 头部和，四板块共用）
// ============================================================================
const RAMP = {
  short:     [0, 12, 25, 42, 60, 73, 85, 93, 100, 100, 100, 100], // 满产 9 月
  regular:   [0, 5, 12, 22, 35, 48, 60, 72, 82, 90, 96, 100],     // 满产 12 月
  midLong:   [0, 0, 5, 12, 20, 30, 42, 53, 63, 72, 80, 87],       // 满产 15 月
  long:      [0, 0, 0, 5, 10, 18, 27, 36, 45, 54, 62, 70],        // 满产 18 月
  ultraLong: [0, 0, 0, 0, 5, 10, 16, 23, 30, 37, 44, 50],         // 满产 24 月
};
const SEGMENT_MAP = { short: 'smb', regular: 'smb', midLong: 'mid', long: 'ent', ultraLong: 'strategic' };

// 🔴🔧C-04：入职月 m 的【当年】贡献率 = 在职 tenure 的【头部和】= Σ 曲线前 (13−m) 段 ÷ 12 ÷ 100
function newHireYearRate(cycle, m) {
  const c = RAMP[cycle];
  if (!c || m < 1) return null;
  const take = 13 - m;
  let s = 0;
  for (let i = 0; i < take && i < c.length; i++) s += c[i];
  return s / 12 / 100;
}
// 咬合基准（自我验证常量）：
//   基准① newHireYearRate('short',1) = 65.8%（790/1200）
//   基准② newHireYearRate('short',5) = 32.5%（390/1200）← C-04 专用回归哨兵（旧式会算成 59.25%）

// ============================================================================
// 【4.1–4.5】双口径宪法：金额只出自 totalIncome / laborCost / netContribution
// 数据以「一笔一条」的 PayoutEntry 数组传入（type + amt 分）
// ============================================================================
const INCOME_BONUS = new Set(['instant_bonus', 'year_end_bonus', 'dividend',
  'mentoring_share', 'recipe_royalty', 'sprint_vested', 'discretionary']);

// 4.1 员工视角"我拿到多少"（报销永不计入；VSA vested 前不计入）
function totalIncome(baseAmt, commissionAmt, payouts) {
  let bonus = 0;
  for (const p of (payouts || [])) if (INCOME_BONUS.has(p.type)) bonus += p.amt;
  return baseAmt + commissionAmt + bonus;
}
// 4.2 老板视角"我花了多少"（报销只进成本）
function laborCost(baseAmt, commissionAmt, socialCostRate, payouts) {
  let bonus = 0, reimburse = 0;
  for (const p of (payouts || [])) {
    if (INCOME_BONUS.has(p.type)) bonus += p.amt;
    else if (p.type === 'reimburse') reimburse += p.amt;
  }
  return baseAmt + Math.round(baseAmt * socialCostRate) + commissionAmt + bonus + reimburse;
}
// 4.5 提成口径（护城河）：margin_based，永不可换；禁止统一毛利折算系数
function commission(collectedAmt, categoryMarginRate, r) {
  return Math.round(collectedAmt * categoryMarginRate * r);
}

// 4.6 回算引擎核心（定价器心脏，公约级公式）——留人器守护线/闸引用
function recalcEngine(T, longTermRate, B, G) {
  // 边界守卫
  if (B >= T * (1 - longTermRate)) return { blocked: '底薪已吃穿现金目标（B ≥ T×(1−长期占比)）', r: null };
  if (G <= 0) return { blocked: '毛利口径 G ≤ 0', r: null };
  const gap = T * (1 - longTermRate) - B;      // 提成缺口
  const r = safeDiv(gap, G);                     // 毛利口径
  const longMonthly = T * longTermRate;          // → 分红池
  return { gap, r, longMonthly, blocked: null };
}
// 好招指数 = min(拟定B÷预警档B, 拟定T÷预警线T)
function goodHireIndex(planB, warnB, planT, warnT) {
  const a = safeDiv(planB, warnB), b = safeDiv(planT, warnT);
  if (a == null || b == null) return null;
  return Math.min(a, b);
}
function goodHireBand(idx) {
  if (idx == null) return null;
  if (idx < 1.0) return { band: 'danger', label: '🔴 招不起' };
  if (idx < 1.2) return { band: 'warning', label: '🟡 勉强' };
  if (idx < 1.4) return { band: 'success', label: '🟢 好招' };
  return { band: 'gold', label: '金 · 极好招' };
}
