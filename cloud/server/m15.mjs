/* ============================================================
   C7 · M15 新人筛选服务（v5.1 §5.1 M15 行 🔴取代）
   🔒 口径出处：5号育人器 v2.3 件三 3.6（唯一权威）：
     - 7 天窗口（newbieWindow：N=7 可调 1–15）；阈值 = 首N天基准×80%；
       日红线 <60%；连红 3 工作日 → 建议淘汰（休息日不计，Y-D8——排班经 m1，
       全系统唯一一份，禁止另写）；达标用有效动作分（M14③）
     - 🔴 兜底默认「留」（DEFAULT_CULL_VERDICT，Y-D6）
     - 🔴 汰前三道拦截（任一命中 → 拦截 + 话术 Y-11 三连）：
         ①线索指数 < 0.7（m21_norms.lead_index——"你没给他饭吃"）
         ②前14天练习 < 50（practice_logs——"你还没给他机会"）
         ③CoachingAck confirmed = 0（"你在淘汰一个没人教过的人"）
     - 🔴 建议只出 action_card(kind='eliminate')，永不写员工状态（公约 A-05 /
       v5.1 A-C04：写员工状态的入口唯一且仅由老板点击触发——本模块零 salespersons 写路径）
   计算一律调 domain（newbieBoard / cullInterceptors，服务层只组装输入）。
   前置：cullCheck 过 requireM21（闸①：淘汰在 A-11 锁清单里，且线索指数本就来自 m21_norms）。
   时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today。
   ============================================================ */
import {
  newbieBoard as domainNewbieBoard, cullInterceptors, TALK, DEFAULT_CULL_VERDICT,
} from '../domain/yuren.mjs';
import { getCoef, addDays, diffDays } from '../domain/shared.mjs';
import { logEvent } from './writes.mjs';
import { requireM21 } from './m21.mjs';
import { buildDomainDb, latestM21Month } from './m12.mjs';
import { insertCard } from './cardbus.mjs';

/**
 * 新人筛选看板：司龄 ≤30 天者 7 天窗红绿灯（阈值=首N天基准×0.80、日红线 0.60、
 * 连红 3 工作日 → suggestCull）。一切口径在 domain.newbieBoard（含休息日排除、
 * 有效动作分达标、兜底「留」）；服务层只把 SQL 组装成 domain-db（排班解析复用 m1）。
 */
export async function newbieBoard(db, ctx, { gc = getCoef } = {}) {
  const ddb = await buildDomainDb(db, ctx);
  return domainNewbieBoard(ddb, ctx.today, gc);
}

/* ---------- action_card 插卡：C10 收口到 cardBus.insertCard（唯一插卡入口）；
   建议载体 = action_card(kind='eliminate') 预警级，事件类型保持 eliminate_card_created ---------- */
async function insertEliminateCard(db, ctx, payload) {
  const r = await insertCard(db, ctx, {
    kind: 'eliminate', level: 'alert', targetId: payload.spId, payload,
    eventType: 'eliminate_card_created',
  });
  return r.cardId;
}

/**
 * 🔴 汰前三道拦截（cullCheck）：三证据齐查 → domain.cullInterceptors →
 *   任一命中 → 拦截（verdict 恒兜底 keep）+ 话术码 Y-11（命中项逐条渲染）；
 *   全过 → 建议可出，但只生成 action_card(kind='eliminate') —— 永不写员工状态。
 */
export async function cullCheck(db, ctx, { spId, gc = getCoef }) {
  await requireM21(db, ctx);                            // 🔴 闸①：淘汰在 A-11 锁清单里
  const month = await latestM21Month(db, ctx);
  const { rows: mi } = await db.query(
    `select lead_index::float8 as li, leads from m21_norms
      where tenant_id = $1 and sp_id = $2 and month = $3`, [ctx.tenantId, spId, month]);
  const leadsIndex = mi.length && mi[0].li != null ? Number(mi[0].li) : null;
  const monthLeads = mi.length ? mi[0].leads : null;

  const { rows: sp } = await db.query(
    `select hire_date::text as hd from salespersons where tenant_id = $1 and id = $2 and deleted_at is null`,
    [ctx.tenantId, spId]);
  if (!sp.length) return { ok: false, err: 'salesperson 不存在' };
  const hireDate = sp[0].hd;
  const tenure = hireDate ? diffDays(hireDate, ctx.today) : null;
  const { rows: pr } = hireDate ? await db.query(
    `select count(*)::int as n from practice_logs
      where tenant_id = $1 and employee_id = $2 and deleted_at is null
        and practice_date >= $3 and practice_date <= $4`,
    [ctx.tenantId, spId, hireDate, addDays(hireDate, 13)]) : { rows: [{ n: null }] };
  const practice14 = pr[0].n;

  const { rows: ak } = await db.query(
    `select count(*)::int as n from coaching_acks
      where tenant_id = $1 and employee_id = $2 and employee_ack_status = 'confirmed' and deleted_at is null`,
    [ctx.tenantId, spId]);
  const ackConfirmedCount = ak[0].n;

  const evidence = { leadsIndex, practice14, ackConfirmedCount };
  const blocks = cullInterceptors(evidence, null, gc);  // C1 引擎：no_leads/no_practice/no_coaching
  if (blocks.length) {
    const talks = [];                                   // Y-11 三连（命中项逐条）
    if (blocks.includes('no_leads')) talks.push(TALK.y11[0](monthLeads ?? '—'));
    if (blocks.includes('no_practice')) talks.push(TALK.y11[1](practice14 ?? '—'));
    if (blocks.includes('no_coaching')) talks.push(TALK.y11[2](tenure ?? '—'));
    await logEvent(db, ctx, 'cull_intercepted', spId, { spId, blocks, evidence });
    return { ok: true, blocked: true, verdict: DEFAULT_CULL_VERDICT, blocks, evidence,
      talk: 'Y-11', talks };
  }
  /* 三条件都满足 → 建议可出：只出 eliminate 卡（pending，待老板点击），零员工状态写路径 */
  const cardId = await insertEliminateCard(db, ctx, { spId, evidence, source: 'm15_cull_check' });
  return { ok: true, blocked: false, verdict: DEFAULT_CULL_VERDICT, blocks: [], evidence, cardId };
}
