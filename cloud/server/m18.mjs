/* ============================================================
   C6 · M18 人效仪表服务（v5.1 §5.1 M18 行 🔴取代）
   🔒 口径出处：3号算账器 §3.7（唯一权威）：
     - 回本进度率 = 累计毛利贡献 / 累计人力成本（含期初 hiring_cost）
       —— 人力成本 🔒 逐月走 m2.laborCostFor（公约 §4.2 宪法函数，禁止重算）
     - 🔴 止血分诊双校验（v5.1 V-06：v4.0 单条件已被取代）：
       连续 stopBleedDays(30) 天零事件 ∧ 在职计薪 → 候选；
       校验① 线索指数 < territoryStarveIdx(0.7) → starved 拦截（S-13
       "这不是他不干活，这是你没给他饭吃"）；
       校验② UER > 0 → invisible_work 提示（"他在做系统看不到的事，先谈一次"）
       —— UER 从 derived_scalars 读（m32 落表，读侧 m32.personUER），🔴 不现算
     - 扩编算钱器 = 只读沙盒（Zoltners 边际判据 + 三年×1.18）——
       🔒 计算调 2号招人器 domain.capacityChain（C1 引擎），零落库（S-D9 同律）
   判定一律调 domain.stopBleedTriage / domain.paybackProgress——服务层只组装输入。
   - 时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today
   - 🔴 本模块全部只读：无 put/patch/upsert/logEvent（建议动作插卡由推送层 C10 承接）
   ============================================================ */
import { stopBleedTriage, paybackProgress } from '../domain/suanzhang.mjs';
import { capacityChain } from '../domain/zhaoren.mjs';
import { getCoef, diffDays, monthOf } from '../domain/shared.mjs';
import { laborCostFor } from './m2.mjs';
import { personUER } from './m32.mjs';
import { requireM21 } from './m21.mjs';

/* 在职销售（M18 人口与 m21 同口径：拿线索卖货的人） */
async function activeSales(db, ctx) {
  const { rows } = await db.query(
    `select id, name, hire_date::text as hd, hiring_cost_amt::float8 as hc
       from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales') order by id`, [ctx.tenantId]);
  return rows.map(r => ({
    id: r.id, name: r.name,
    hireDate: r.hd ? r.hd.slice(0, 10) : null,
    hiringCostAmt: Number(r.hc ?? 0),
  }));
}

/* [入职月 .. 当月] 月份序列（无入职日 → 仅当月） */
function monthsSince(hireDate, today) {
  const cur = monthOf(today);
  if (!hireDate) return [cur];
  const out = [];
  let m = monthOf(hireDate);
  while (m <= cur) {
    out.push(m);
    m = m === cur ? null : nextMonth(m);
    if (m == null) break;
  }
  return out;
}
const nextMonth = m => {
  const [y, mm] = m.split('-').map(Number);
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
};

/**
 * paybackBoard —— 团队回本概览（v5.1 云端增量：按部门权限的团队回本）。
 * 逐人：回本进度率 = 累计毛利 / (期初 hiring_cost + Σ 逐月 laborCostFor)（m2 口径，🔒 宪法函数）；
 * 团队 = Σ毛利 / Σ人力（domain.paybackProgress，safeDiv 兜底：分母 0 → null "—"）。
 * 毛利已回款口径：won ∧ paid_date ≤ today，快照缺失回退品类毛利率（与 m2/m21 同法）。
 */
export async function paybackBoard(db, ctx) {
  const people = await activeSales(db, ctx);
  const { rows: ms } = await db.query(
    `select d.employee_id,
            coalesce(sum(round(d.payment_amt * coalesce(d.margin_rate_snapshot, c.gross_margin_rate))),0)::float8 as margin
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.status = 'won' and d.paid_date is not null
        and d.paid_date <= $2 and d.deleted_at is null
      group by d.employee_id`, [ctx.tenantId, ctx.today]);
  const marginBy = new Map(ms.map(r => [r.employee_id, Number(r.margin)]));
  const rows = [];
  let teamMargin = 0, teamLabor = 0;
  for (const p of people) {
    let cumLabor = p.hiringCostAmt;                     // 期初债务：hiring_cost
    for (const m of monthsSince(p.hireDate, ctx.today)) {
      cumLabor += (await laborCostFor(db, ctx, { employeeId: p.id, month: m })).laborCostAmt;
    }
    const cumMargin = marginBy.get(p.id) ?? 0;
    const progress = paybackProgress(cumMargin, cumLabor);
    teamMargin += cumMargin; teamLabor += cumLabor;
    rows.push({
      spId: p.id, name: p.name, hireDate: p.hireDate,
      cumMarginAmt: cumMargin, cumLaborAmt: cumLabor, hiringCostAmt: p.hiringCostAmt,
      progress, paidBack: progress != null && progress >= 1,
    });
  }
  return {
    rows,
    team: { cumMarginAmt: teamMargin, cumLaborAmt: teamLabor, progress: paybackProgress(teamMargin, teamLabor) },
  };
}

/**
 * stopBleed —— 止血分诊（🔴 双校验，判定唯一出口 = domain.stopBleedTriage，S-D8 同律）。
 * 候选 = 在职计薪 ∧ 零事件 ≥ stopBleedDays(30)——零事件 = 无成交录入（deal_date）
 * 且无日报（report_date）；从未有事件 → 从入职日起算。
 * 校验① 线索指数取 m21_norms 最新有效月（M21 已落表的地盘读数）；
 * 校验② UER 从 derived_scalars 读（m32.personUER）——🔴 不在本模块现算。
 * 三分支：starved（🔴拦截 S-13）/ invisible_work（🟡先谈一次）/ proceed。只读，不写库。
 * 前置 requireM21（闸①：止血→淘汰在 A-11 锁清单里；未归一化时线索指数缺失，
 * 会把"没给饭吃"误判成"不干活"——正是 S-13 要防的）。
 */
export async function stopBleed(db, ctx, { gc = getCoef } = {}) {
  await requireM21(db, ctx);                            // 🔴 闸①（A-11）
  const people = await activeSales(db, ctx);
  const { rows: lastDeal } = await db.query(
    `select employee_id, max(deal_date)::text as d from deals
      where tenant_id = $1 and deleted_at is null group by employee_id`, [ctx.tenantId]);
  const { rows: lastRep } = await db.query(
    `select employee_id, max(report_date)::text as d from daily_reports
      where tenant_id = $1 and deleted_at is null group by employee_id`, [ctx.tenantId]);
  const dBy = new Map(lastDeal.map(r => [r.employee_id, r.d.slice(0, 10)]));
  const rBy = new Map(lastRep.map(r => [r.employee_id, r.d.slice(0, 10)]));
  const { rows: idx } = await db.query(
    `select distinct on (sp_id) sp_id, lead_index::float8 as li from m21_norms
      where tenant_id = $1 and lead_index is not null
      order by sp_id, month desc`, [ctx.tenantId]);
  const idxBy = new Map(idx.map(r => [r.sp_id, Number(r.li)]));
  const out = [];
  for (const p of people) {
    const last = [dBy.get(p.id), rBy.get(p.id), p.hireDate].filter(Boolean).sort().at(-1) ?? null;
    const zeroEventDays = last == null ? null : diffDays(last, ctx.today);
    if (zeroEventDays == null) continue;                // 无任何事件锚点 → 不硬造候选
    const { uer } = await personUER(db, ctx, p.id);
    const triage = stopBleedTriage({
      zeroEventDays, isActivePaid: true,
      leadIndex: idxBy.get(p.id) ?? null, uer,
    }, gc);
    if (!triage.candidate) continue;
    out.push({
      spId: p.id, name: p.name, zeroEventDays,
      leadIndex: idxBy.get(p.id) ?? null, uer,
      verdict: triage.verdict, block: triage.block,
    });
  }
  return { candidates: out };
}

/**
 * expandSandbox —— 扩编算钱器（🔴 只读沙盒，S-D9：零写库路径，不产生 action_card）。
 * 🔒 计算 = 2号招人器 domain.capacityChain 原样（Zoltners 边际判据 marginProfit/marginCost
 * + 三年×1.18 threeYearHeads）；salesCount / managerCount 从 salespersons 派生只读覆盖
 * （与 m7.computePlan 同律：库里的编制是唯一真相）。
 * targetYear 由调用方显式传入（缺省 = ctx.today 所在年，时钟注入口径）。
 */
export async function expandSandbox(db, ctx, { inputs, targetYear, gc = getCoef }) {
  const { rows: cnt } = await db.query(
    `select coalesce(sum(case when level is null or level = 'sales' then 1 else 0 end),0)::int as s,
            coalesce(sum(case when level = 'manager' then 1 else 0 end),0)::int as m
       from salespersons where tenant_id = $1 and is_active and deleted_at is null`, [ctx.tenantId]);
  const salesCount = cnt[0].s, managerCount = cnt[0].m;
  const result = capacityChain(
    { ...inputs, salesCount, managerCount },
    { today: ctx.today, targetYear: targetYear ?? Number(ctx.today.slice(0, 4)), gc });
  return { sandbox: true, salesCount, managerCount, result };   // 🔴 只读：不落库
}
