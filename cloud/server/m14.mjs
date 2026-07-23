/* ============================================================
   C7 · M14 填报防伪三闸服务（v5.1 §5.1 M14 行 🔴取代）
   🔒 口径出处：5号育人器 v2.3 件三 3.5（唯一权威）：
     ① 挂账爆破：签约未回款 >30天主管黄条 / >60天老板插卡（domain.backlogCheck）；
       量增质塌（计数+50% ∧ 转化−30%，domain.surgeCollapse）→ 抽检加权 ×3
     ② 抽检生成器：每周 k 张随机；🔴 只出题、不记录问答结果、无造假标记字段
       （spot_check_cards 表结构级保证，Y-D7）；页脚『抽检为随机生成，全员同规』
     ③ 有效动作分（domain.effectiveChain）：有效线索分=min(计数, 下级计数÷个人近90天
       转化率下限带宽)，逐级下推；新人(<30天)用配方源带宽×0.60（domain.bandsFor）；
       刷量不增分→虚报数学收益归零；🔴 只供 M12/M15 内部用，原始计数原样保留（Y-D5）
   计算一律调 domain（服务层只调不重写）；抽检随机 = 确定性 PRNG（mulberry32，
   种子=weekOf+tenantId）——同周同租户重跑逐字节一致（零真实时钟、零 Math.random）。
   时钟注入（公约 C-14）：今天 = ctx.today；写入一律经 writes 双写。
   ============================================================ */
import {
  backlogCheck, surgeCollapse, effectiveChain, bandsFor,
  reportsFor, sumCounts, TALK,
} from '../domain/yuren.mjs';
import { getCoef, safeDiv, addDays, clamp } from '../domain/shared.mjs';
import { upsert } from './writes.mjs';
import { buildDomainDb } from './m12.mjs';

/* ---------- 确定性 PRNG：字符串种子 → mulberry32（零时钟零 Math.random） ---------- */
function seed32(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- ① 挂账爆破：won ∧ 未回款 → manager(>30d) / boss(>60d) ---------- */
export async function backlogBoard(db, ctx, { gc = getCoef } = {}) {
  const { rows } = await db.query(
    `select id, employee_id, deal_date::text as d, payment_amt::bigint as pay
       from deals
      where tenant_id = $1 and status = 'won' and paid_date is null and deleted_at is null
      order by deal_date`, [ctx.tenantId]);
  const manager = [], boss = [];
  for (const r of rows) {
    const level = backlogCheck({ contractDate: r.d, paidDate: null }, ctx.today, null, gc);
    if (level === 'boss') boss.push({ dealId: r.id, spId: r.employee_id, contractDate: r.d, amt: Number(r.pay) });
    else if (level === 'manager') manager.push({ dealId: r.id, spId: r.employee_id, contractDate: r.d, amt: Number(r.pay) });
  }
  return { manager, boss };                             // 主管黄条 / 老板插卡（表现层渲染）
}

/* ---------- ① 量增质塌：近30天 vs 前30天 {leads, conv=签约/线索} → 抽检加权 ×3 ---------- */
export async function surgeCheck(db, ctx, { gc = getCoef } = {}) {
  const flagWeight = gc('yuren.spotCheck').flagWeight;
  const win = async (spId, from, to) => {
    const { rows } = await db.query(
      `select coalesce(sum(leads),0)::int as l, coalesce(sum(contracts),0)::int as c
         from daily_reports
        where tenant_id = $1 and employee_id = $2 and report_date >= $3 and report_date <= $4
          and deleted_at is null`, [ctx.tenantId, spId, from, to]);
    return { leads: rows[0].l, conv: safeDiv(rows[0].c, rows[0].l) };
  };
  const { rows: sps } = await db.query(
    `select id from salespersons
      where tenant_id = $1 and is_active and (level is null or level = 'sales') and deleted_at is null
      order by id`, [ctx.tenantId]);
  const out = [];
  for (const p of sps) {
    const cur = await win(p.id, addDays(ctx.today, -29), ctx.today);
    const prev = await win(p.id, addDays(ctx.today, -59), addDays(ctx.today, -30));
    const surge = surgeCollapse(cur, prev, null, gc);   // null=证据不全不判（A-19）
    out.push({ spId: p.id, cur, prev, surge, weight: surge === true ? flagWeight : 1 });
  }
  return out;
}

/**
 * ② 每周抽检卡生成：k 张（gc yuren.spotCheck.weeklyK，clamp kRange），
 * 加权随机不放回（量增质塌者 ×3）；出题材料=上周（weekOf 前 7 天）已上报的该环节计数。
 * 🔴 确定性：mulberry32(weekOf+tenantId) —— 同周重跑 = 同一批卡（UPSERT 覆盖，行数不变）。
 * 🔴 spot_check_cards 无结果/造假字段（Y-D7，列集断言见 c7.test.mjs ⑦）。
 */
export async function genSpotChecks(db, ctx, { weekOf, gc = getCoef }) {
  const coef = gc('yuren.spotCheck');
  const k = clamp(coef.weeklyK, coef.kRange[0], coef.kRange[1]);
  const rng = mulberry32(seed32(`${weekOf}|${ctx.tenantId}`));
  const surge = await surgeCheck(db, ctx, { gc });
  const pool = surge.map(s => ({ spId: s.spId, weight: s.weight }));
  const picks = [];
  while (picks.length < k && pool.length) {             // 加权随机不放回
    const total = pool.reduce((a, p) => a + p.weight, 0);
    let r = rng() * total, idx = 0;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r < 0) { idx = i; break; } }
    picks.push(pool.splice(idx, 1)[0].spId);
  }
  const stages = ['leads', 'intents', 'samples', 'contracts'];       // YE-01
  const cards = [];
  for (let i = 0; i < picks.length; i++) {
    const spId = picks[i];
    const stage = stages[Math.floor(rng() * stages.length)];
    const { rows } = await db.query(
      `select coalesce(sum(${stage}),0)::int as n from daily_reports
        where tenant_id = $1 and employee_id = $2 and report_date >= $3 and report_date < $4
          and deleted_at is null`,
      [ctx.tenantId, spId, addDays(weekOf, -7), weekOf]);
    const card = { id: `scc_${weekOf}_${i + 1}`, week_of: weekOf, employee_id: spId,
      check_date: weekOf, stage, reported_count: rows[0].n };
    await upsert(db, ctx, 'spot_check_cards', { cols: ['tenant_id', 'id'] }, card, 'spot_check_generated');
    cards.push(card);
  }
  return { weekOf, k, cards, footer: TALK.spotFooter }; // 『抽检为随机生成，全员同规』
}

/**
 * ③ 有效动作分：逐人 近90天 Σ计数 → domain.effectiveChain（带宽=个人近90天周桶下限，
 * 新人<30天=配方源带宽×0.60——domain.bandsFor 引擎内判定）。
 * 🔴 Y-D5：只作 M12/M15 输入；daily_reports 原始计数存储/展示不变（本函数零写路径）。
 */
export async function effectiveScores(db, ctx, { gc = getCoef } = {}) {
  const ddb = await buildDomainDb(db, ctx);
  const from = addDays(ctx.today, -90);
  return ddb.salespeople.filter(p => p.isActive).map(p => {
    const raw = sumCounts(reportsFor(ddb, p.spId, from, ctx.today));
    const bands = bandsFor(ddb, p.spId, ctx.today, gc);
    return { spId: p.spId, raw, bands, effective: effectiveChain(raw, bands) };
  });
}
