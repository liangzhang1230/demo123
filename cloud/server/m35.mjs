/* ============================================================
   C9 · M35 淘汰误杀检测器服务（v5.1 §5.2 M35 行 · 扣扳机前的最后核查）
   🔒 口径出处：3号算账器 §3.11（唯一权威）：
     - 触发：老板点 [拟淘汰] → 🔴 强制预检 action_card（永不自动执行）
     - 前置：M21 硬闸门（requireM21——M35 在闸① A-11 锁清单里，未归一化 → 本功能锁定）
     - 双数校验：jump = 原始排名 − 归一化排名 ≥ ceil(团队人数 × 30%) → 🔴 误杀警报 S-17
       （注入其线索量倒数排名、单位线索产出排名）—— 判定唯一出口 = domain.m35Misfire
     - 绝对线校验：EliminationConfig.basis = relative_rank → 🔴 警告 S-18（建议切绝对生存线）
     - 输出按钮：[换地盘观察一季] [切换绝对线] [仍坚持淘汰（留痕）]
   🔴 v5.1 §12 C9 验收判据 / 3号 S-D10：[仍坚持淘汰] 仅写留痕
     （override_events B 形 action='insist_eliminate' + 事件双写），
     无任何员工状态变更——本模块对 salespersons 零写路径（机检 c9 ⓪/④）。
   时钟注入（公约 C-14）：今天 = ctx.today，零真实时钟调用；写入一律经 writes 双写。
   ============================================================ */
import { m35Misfire } from '../domain/suanzhang.mjs';
import { getCoef, monthOf } from '../domain/shared.mjs';
import { requireM21, m21Done, prevMonth } from './m21.mjs';
import { put } from './writes.mjs';

/* 归一榜所在月：requireM21 同判据（本月已跑用本月，否则用上月） */
async function normsMonth(db, ctx) {
  const cur = monthOf(ctx.today);
  return (await m21Done(db, ctx, { month: cur })) ? cur : prevMonth(cur);
}

/**
 * 🔴 precheck —— [拟淘汰] 强制预检（纯读，零写库；永不自动执行任何淘汰）。
 * 返回：{ misfire, jump, threshold, s17, s18, options }；
 *   s17 = 误杀警报变量（原始倒数第 r0 / 归一第 r1 / 线索量倒数第 lr（n 条）/ 单位线索产出第 ur）
 *   s18 = basis=relative_rank 时的绝对线警告变量（GE/微软案例卡由表现层渲染）
 */
export async function precheck(db, ctx, { spId, gc = getCoef }) {
  await requireM21(db, ctx);                       // 🔴 闸①：M35 在 A-11 锁清单里
  const month = await normsMonth(db, ctx);
  const { rows } = await db.query(
    `select n.sp_id, n.leads, n.unit_lead_margin::float8 as unit, n.orig_rank, n.norm_rank, s.name
       from m21_norms n
       left join salespersons s on s.tenant_id = n.tenant_id and s.id = n.sp_id and s.deleted_at is null
      where n.tenant_id = $1 and n.month = $2`, [ctx.tenantId, month]);
  const me = rows.find(r => r.sp_id === spId);
  if (!me) return { found: false, spId, month };
  const n = rows.length;
  /* 🔒 双数校验唯一出口：domain.m35Misfire（jump ≥ ceil(n×30%) → 警报） */
  const mis = m35Misfire(me.orig_rank, me.norm_rank, n, gc);
  /* S-17 注入变量：线索量倒数排名 / 单位线索产出排名（同榜同月） */
  const leadsBottomRank = rows.filter(r => (r.leads ?? 0) < (me.leads ?? 0)).length + 1;
  const unitRank = rows.filter(r => (r.unit ?? -Infinity) > (me.unit ?? -Infinity)).length + 1;
  const s17 = mis.misfire ? {
    name: me.name, origRankFromBottom: n - me.orig_rank + 1, normRank: me.norm_rank,
    leadsBottomRank, leadsCount: me.leads, unitRank,
  } : null;
  /* 绝对线校验：EliminationConfig（单例）basis=relative_rank → S-18 */
  const { rows: ec } = await db.query(
    `select basis, survival_months, survival_line_amt::bigint as line
       from elimination_configs where tenant_id = $1 and deleted_at is null order by id limit 1`,
    [ctx.tenantId]);
  const cfg = ec.length ? ec[0] : null;
  const s18 = cfg && cfg.basis === 'relative_rank' ? {
    basis: cfg.basis, adviceBasis: 'absolute_line',
    survivalMonths: Number(cfg.survival_months),
    survivalLineAmt: cfg.line == null ? null : Number(cfg.line),   // null → 默认该员工月 laborCost
  } : null;
  return {
    found: true, spId, month, teamN: n,
    origRank: me.orig_rank, normRank: me.norm_rank,
    jump: mis.jump, threshold: mis.threshold, misfire: mis.misfire,
    s17, s18,
    options: [                                     // 🔴 三选项：永不自动执行，全部等老板点
      { key: 'observe_new_territory', label: '换地盘观察一季' },
      { key: 'switch_absolute_line', label: '切换绝对生存线' },
      { key: 'insist_eliminate', label: '仍坚持淘汰（留痕）' },
    ],
  };
}

/**
 * 🔴 insistEliminate —— [仍坚持淘汰]：仅写留痕（S-D10 / v5.1 C9 验收判据）。
 *   override_events B 形 action='insist_eliminate'（全员可见）+ 事件双写，此外零写——
 *   salespersons 无任何状态变更（不改 is_active / leave_date / 任何列；
 *   本模块对 salespersons 零写语句，机检 c9 ⓪；行级前后快照断言 c9 ④）。
 */
export async function insistEliminate(db, ctx, { spId, note = null }) {
  await requireM21(db, ctx);                       // 淘汰动作同在闸①锁清单
  const { rows } = await db.query(
    `select count(*)::int as n from override_events where tenant_id = $1`, [ctx.tenantId]);
  const id = `ov_m35_${rows[0].n + 1}`;
  await put(db, ctx, 'override_events',
    { id, action: 'insist_eliminate', sp_id: spId, event_date: ctx.today,
      note, visible_to_all: true },
    'elimination_insisted');
  return { ok: true, logged: true, id, spId, changed: false };     // changed 恒 false：仅留痕
}
