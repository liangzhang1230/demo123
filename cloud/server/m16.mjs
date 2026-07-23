/* ============================================================
   C8 · M16 销冠留存引擎服务（v5.1 §5.1 M16 行 🔴取代）
   🔒 口径出处：4号留人器 §3.7（唯一权威）：
     16.1 价签权威 6 项（≈近6月月均毛利×(招聘周期月数+批均回本月数)；爬坡缺口
       月当量一律公约 §4.7 曲线实算 regular=5.78——D-C1-1 裁决；⑤35% 慢性与
       ⑥40% 急性互不重叠不双计）
     16.2 守护线（totalIncome<矩阵T 连续≥2月；🔒 收入 = m2.incomeFor → 公约 §4.1）
     16.3 该谈名单五触发源中的 周年/剪刀差/榜眼 三源（③余震档由 M38 接管见 m37_38；
       ②年关档需春节日历表——云端暂无该数据源，P-C8 注记，接入后点亮）
     16.5 灯塔（自动模式 = totalIncome 纪录；🔴 只供氧——纪录不是排名）
     16.8 依赖度雷达（Top1回款÷公司总回款 滚6月；地盘校正 leadIndex>1.5）
   计算一律调 domain（C1 引擎，服务层只组装不重写）：priceTag6 / talkList /
     dependencyRadar。剪刀差从 m9.scissorsBoard 读（闸① requireM21 在 m9 内），
     归一名次从 m21_norms 读，特殊发放从 payout_entries 读。
   🔴 三处 v4.0 旧值作废（v5.1 V-05）：价签 6 项 / 该谈五触发源 / 钱途页七栏
     （七栏 bundle 见 bundles.mjs——A-08/A-09 的物理落点）。
   口径注记（P-C8 云端起步版）：价签的 招聘周期月数/批均回本月数 无逐租户实测源时
     回退冷启动参考 1.5月+6月（件二 priceTagFactors 注记），opts 可覆盖；
     月均毛利窗口不足 6 月 → 按在职月数回退（"不足回退"），零成交 → null"—"。
   - 时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today
   ============================================================ */
import { priceTag6, talkList as domainTalkList, dependencyRadar as domainRadar } from '../domain/liuren.mjs';
import { getCoef, monthOf } from '../domain/shared.mjs';
import { incomeFor, planVersionAt } from './m2.mjs';
import { scissorsBoard } from './m9.mjs';
import { prevMonth } from './m21.mjs';

/* 冷启动参考（件二 priceTagFactors："1.5月+6月"）；hireMonths=45天/30 */
export const PAYBACK_MONTHS_COLDSTART = 6;

const lastNMonths = (month, n) => {
  const out = [month];
  for (let i = 1; i < n; i++) out.unshift(prevMonth(out[0]));
  return out;
};

/* 月度回款（won ∧ paid_date 该月；分组一把取） */
async function collectedByMonth(db, ctx, months, employeeId = null) {
  const ph = months.map((_, i) => '$' + (i + 2)).join(',');
  const args = [ctx.tenantId, ...months];
  let extra = '';
  if (employeeId != null) { args.push(employeeId); extra = `and employee_id = $${args.length}`; }
  const { rows } = await db.query(
    `select employee_id, to_char(paid_date, 'YYYY-MM') as month,
            coalesce(sum(payment_amt), 0)::bigint as amt
       from deals
      where tenant_id = $1 and status = 'won' and paid_date is not null
        and to_char(paid_date, 'YYYY-MM') in (${ph}) and deleted_at is null ${extra}
      group by employee_id, to_char(paid_date, 'YYYY-MM')`, args);
  return rows;
}

/* ---------- 16.1 价签（权威 6 项）：月毛利 = 近6月已回款毛利月均（不足回退在职月数） ---------- */
export async function avgMonthlyGrossMargin(db, ctx, spId) {
  const months = lastNMonths(monthOf(ctx.today), 6);
  const { rows } = await db.query(
    `select coalesce(sum(round(d.payment_amt * coalesce(d.margin_rate_snapshot, c.gross_margin_rate))), 0)::float8 as m
       from deals d
       left join categories c on c.tenant_id = d.tenant_id and c.id = d.category_id and c.deleted_at is null
      where d.tenant_id = $1 and d.employee_id = $2 and d.status = 'won' and d.paid_date is not null
        and to_char(d.paid_date, 'YYYY-MM') >= $3 and to_char(d.paid_date, 'YYYY-MM') <= $4
        and d.deleted_at is null`,
    [ctx.tenantId, spId, months[0], months[months.length - 1]]);
  const total = Number(rows[0].m);
  if (total === 0) return { gm: null, monthsUsed: 0 };
  const { rows: sp } = await db.query(
    `select hire_date::text as hd from salespersons where tenant_id = $1 and id = $2 and deleted_at is null`,
    [ctx.tenantId, spId]);
  let monthsUsed = 6;
  if (sp.length && sp[0].hd) {
    const hm = sp[0].hd.slice(0, 7);
    const inWindow = months.filter(m => m >= hm).length;              // 在职月数回退（"不足回退"）
    monthsUsed = Math.max(1, Math.min(6, inWindow || 6));
  }
  return { gm: Math.round(total / monthsUsed), monthsUsed };
}

/**
 * priceTagFor：组装 domain 形状 → 🔒 priceTag6（曲线实算 5.78 口径；⑥项从
 * handover_cards 读侧回填——M38 落库后自动出现，未录 → "—"）。
 */
export async function priceTagFor(db, ctx, {
  spId, hireMonths = null, paybackMonths = PAYBACK_MONTHS_COLDSTART,
  raiseMonthlyAmt = 0, shortenPct = 0, hiresPerYear = 0, cycleTier = 'regular', gc = getCoef,
} = {}) {
  const { gm, monthsUsed } = await avgMonthlyGrossMargin(db, ctx, spId);
  const { rows: sp } = await db.query(
    `select id, name, hiring_cost_amt::bigint as hc from salespersons
      where tenant_id = $1 and id = $2 and deleted_at is null`, [ctx.tenantId, spId]);
  const { rows: hc } = await db.query(
    `select id, leaver_id, client_name, stage, amount_amt::bigint as amount_amt from handover_cards
      where tenant_id = $1 and leaver_id = $2 and deleted_at is null order by id`, [ctx.tenantId, spId]);
  const ddb = {
    priceTag: {
      spId, monthlyGrossMarginAmt: gm,
      hireMonths: hireMonths ?? gc('hiringCycleDaysDefault') / 30,    // 45天/30 = 1.5 月
      paybackMonths, raiseMonthlyAmt, shortenPct, hiresPerYear,
    },
    company: { cycleTier },
    entities: {
      Salesperson: sp.map(r => ({ spId: r.id, name: r.name,
        hiringCostAmt: r.hc == null ? null : Number(r.hc) })),
      HandoverCard: hc.map(r => ({ leaverId: r.leaver_id, amountAmt: Number(r.amount_amt) })),
    },
  };
  const pt = priceTag6(ddb, ctx.today, gc);
  return pt == null ? null : { ...pt, monthsUsed };
}

/* ---------- 16.2 守护线：totalIncome < 矩阵T 连续 ≥2 个完整月 → 插卡候选 ---------- */
export async function guardLine(db, ctx, { months: guardMonths = 2 } = {}) {
  const plan = await planVersionAt(db, ctx, ctx.today);
  const matrixTAmt = plan && plan.matrix_t_amt != null ? Number(plan.matrix_t_amt) : null;
  if (matrixTAmt == null)
    return { matrixTAmt: null, months: [], people: [], count: null, note: '—（无当期方案版本 T）' };
  const cur = monthOf(ctx.today);
  const months = lastNMonths(prevMonth(cur), guardMonths);            // 近 N 个完整月（当月不完整不计）
  const { rows: emps } = await db.query(
    `select id, name from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales') order by id`, [ctx.tenantId]);
  const people = [];
  for (const e of emps) {
    const incomes = [];
    for (const m of months) incomes.push((await incomeFor(db, ctx, { employeeId: e.id, month: m })).incomeAmt);
    if (incomes.every(v => v != null && v < matrixTAmt))
      people.push({ spId: e.id, name: e.name, incomes });
  }
  /* 跌破占比 >40% → "不是人的问题，是 G 定错了" → 跳定价器（16.2 第二句） */
  const share = emps.length ? people.length / emps.length : null;
  return { matrixTAmt, months, people, count: people.length,
    breachShare: share, gRedefineHint: share != null && share > 0.40 };
}

/* ---------- 16.3 该谈名单（周年/剪刀差/榜眼 三源；余震档→M38；年关档 P-C8 待日历源） ---------- */
export async function talkListNow(db, ctx, { gc = getCoef } = {}) {
  const sb = await scissorsBoard(db, ctx, { gc });                    // 🔴 闸① requireM21 在 m9 内
  const { rows: sps } = await db.query(
    `select id, name, hire_date::text as hd from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales') order by id`, [ctx.tenantId]);
  const { rows: ranks } = await db.query(
    `select sp_id, month, norm_rank from m21_norms
      where tenant_id = $1 and month <= $2 order by month`, [ctx.tenantId, monthOf(ctx.today)]);
  const { rows: specials } = await db.query(
    `select employee_id, count(*)::int as n from payout_entries
      where tenant_id = $1 and deleted_at is null
        and type in ('instant_bonus','dividend','discretionary')
        and payout_date > ($2::date - interval '365 days') and payout_date <= $2
      group by employee_id`, [ctx.tenantId, ctx.today]);
  const perPerson = {};
  for (const r of sb.rows) perPerson[r.spId] = {
    scissors: r.scissors, marketGap: r.marketGapAmt,
    normRankMonths: [], specialPayout12m: 0,
  };
  for (const r of ranks) {
    if (!perPerson[r.sp_id]) perPerson[r.sp_id] = { scissors: null, marketGap: null, normRankMonths: [], specialPayout12m: 0 };
    perPerson[r.sp_id].normRankMonths.push(r.norm_rank == null ? null : Number(r.norm_rank));
  }
  for (const r of specials) if (perPerson[r.employee_id]) perPerson[r.employee_id].specialPayout12m = Number(r.n);
  const ddb = {
    entities: { Salesperson: sps.map(s => ({ spId: s.id, name: s.name, hireDate: s.hd, isActive: true })) },
    externalRefs: { suanzhang: { perPerson, exportedAt: ctx.today } },
  };
  return domainTalkList(ddb, ctx.today, gc);                          // 🔴 永不指导谈什么
}

/* ---------- 16.8 依赖度雷达（Top1 回款集中度 滚6月 + 地盘校正） ---------- */
export async function dependencyRadarNow(db, ctx, { gc = getCoef } = {}) {
  const months = lastNMonths(monthOf(ctx.today), 6);
  const collected = await collectedByMonth(db, ctx, months);
  const bySp = new Map();
  for (const r of collected) bySp.set(r.employee_id, (bySp.get(r.employee_id) ?? 0) + Number(r.amt));
  const { rows: sps } = await db.query(
    `select id, name from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales') order by id`, [ctx.tenantId]);
  const latest = await db.query(
    `select distinct on (sp_id) sp_id, lead_index::float8 as li from m21_norms
      where tenant_id = $1 order by sp_id, month desc`, [ctx.tenantId]);
  const liBySp = new Map(latest.rows.map(r => [r.sp_id, r.li == null ? null : Number(r.li)]));
  const perPerson = {};
  for (const s of sps) perPerson[s.id] = { collected6m: bySp.get(s.id) ?? 0, leadIndex: liBySp.get(s.id) ?? null };
  const ddb = {
    entities: { Salesperson: sps.map(s => ({ spId: s.id, name: s.name })) },
    externalRefs: { suanzhang: { perPerson, exportedAt: ctx.today } },
  };
  return domainRadar(ddb, gc);
}

/* ---------- 16.5 灯塔（自动模式 = totalIncome 纪录；只供氧——纪录不是排名） ---------- */
export async function lighthouse(db, ctx, { windowMonths = 6 } = {}) {
  const months = lastNMonths(monthOf(ctx.today), windowMonths);
  const { rows: sps } = await db.query(
    `select id, name from salespersons
      where tenant_id = $1 and is_active and deleted_at is null
        and (level is null or level = 'sales') order by id`, [ctx.tenantId]);
  let record = null;
  const personalBest = {};
  for (const s of sps) {
    for (const m of months) {
      const inc = (await incomeFor(db, ctx, { employeeId: s.id, month: m })).incomeAmt;
      if (inc == null) continue;
      if (!personalBest[s.id] || inc > personalBest[s.id].amt) personalBest[s.id] = { month: m, amt: inc };
      if (!record || inc > record.amt) record = { holderName: s.name, holderId: s.id, month: m, amt: inc };
    }
  }
  return { mode: 'auto', metric: 'totalIncome', record, personalBest, asOf: ctx.today };
}
