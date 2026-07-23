/* ============================================================
   C8 · M37 参照点账本 + M38 离职余震与交接损耗（v5.1 §5.2 M37/M38 行 🟢补建）
   🔒 口径出处：4号留人器 §3.8 / §3.9（唯一权威）：
     M37：历史参照点=去年同名目实收（year_end_bonus/dividend）；趋势参照点=
       roundTo(历史×(1+贡献增长率), refRound=10000分=百元)；贡献增长率=剪刀差模块·
       近3月vs前3月（🔒 m9.scissorsBoard.contribGrowth，null→退化为历史参照点）；
       三态 LE-08：拟发<历史→🔴below_history｜历史≤拟发<趋势→🟡below_trend｜≥趋势→🟢ok。
       对拍 T13：历史3.0万/增长26.7%→趋势3.8万；28000🔴/30000🟡/38000🟢。
       🔴 L-D11：预检纯读——本模块零 payout_entries 写路径（发放确认走正常录入）。
     M38：离职登记 → ①余震名单（三信号 剪刀差>0/市价差>0/同辖区或批次 各1分，
       Top3 → action_card(kind='talk')×3"一周内每人一次一对一" L-11）；
       ②在途单逐单录入 HandoverCard → 交接损耗=Σ×40%、可救=损耗×50%（L-12）；
       损耗回填价签第⑥项 = 读侧自动（m16.priceTagFor 直读 handover_cards）。
       对拍 T14：11单96万→38.4万/19.2万/11张。
       🔴 L-D12：handover_cards 无删除路径（schema-c2 G4 触发器）。
   计算一律调 domain：payoutPrecheck / aftershockRank / handoverSummary。
   - action_cards 无 created_by 列（C0 底座表）——同 calibrate.mjs 先例，
     本地双写事务（表行+事件同一事务）落卡，语义与 writes 一致
   - 时钟注入（公约 C-14）：零真实时钟调用；今天 = ctx.today
   ============================================================ */
import {
  payoutPrecheck as domainPrecheck, aftershockRank as domainAftershock, handoverSummary as domainHandover,
} from '../domain/liuren.mjs';
import { getCoef } from '../domain/shared.mjs';
import { put, patch } from './writes.mjs';
import { scissorsBoard } from './m9.mjs';

/* ---------- M37 发放预检（选员工 + 拟发金额 → 三态；纯读 L-D11） ---------- */
export async function payoutPrecheckFor(db, ctx, { spId, plannedAmt, gc = getCoef }) {
  const { rows: pes } = await db.query(
    `select id, employee_id, type, amount_amt::bigint as amt, to_char(payout_date, 'YYYY-MM') as period
       from payout_entries where tenant_id = $1 and deleted_at is null`, [ctx.tenantId]);
  const sb = await scissorsBoard(db, ctx, { gc });                    // 贡献增长率唯一出处（闸①在内）
  const row = sb.rows.find(r => r.spId === spId);
  const ddb = {
    entities: {
      PayoutEntry: pes.map(p => ({ employeeId: p.employee_id, type: p.type,
        amt: Number(p.amt), period: p.period })),
    },
    externalRefs: { suanzhang: { perPerson: { [spId]: { contribGrowth: row ? row.contribGrowth : null } } } },
  };
  const r = domainPrecheck(ddb, spId, plannedAmt, ctx.today, gc);
  return { spId, ...r,
    note: r.hist == null ? '—（首年无参照）' : null,
    ironRule: '公开"规则"（怎么算的公式），永不公开"数字"（别人拿多少）——L-10d' };
}

/* ---------- action_cards 本地双写（calibrate.mjs 同法：该表无 created_by/updated_by 列） ---------- */
async function insertCard(db, ctx, { kind, targetId, payload, eventType }) {
  let cardId = null;
  await db.transaction(async tx => {
    const r = await tx.query(
      `insert into action_cards(tenant_id, kind, state, target_id, payload)
       values ($1,$2,'pending',$3,$4) returning card_id`,
      [ctx.tenantId, kind, targetId, JSON.stringify(payload)]);
    cardId = Number(r.rows[0].card_id);
    await tx.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, eventType, ctx.actorId, String(cardId), JSON.stringify({ cardId, kind, targetId, ...payload })]);
  });
  return cardId;
}

/* 余震名单组装：三信号计分（剪刀差>0 / 市价差>0 / 同辖区或同批次）→ domain Top3 */
async function aftershockFor(db, ctx, leaverId, gc) {
  const sb = await scissorsBoard(db, ctx, { gc });
  const { rows: sps } = await db.query(
    `select id, name, city_tier, hire_batch_id, is_active from salespersons
      where tenant_id = $1 and deleted_at is null order by id`, [ctx.tenantId]);
  const perPerson = {};
  for (const r of sb.rows) perPerson[r.spId] = { scissors: r.scissors, marketGap: r.marketGapAmt };
  const ddb = {
    entities: {
      Salesperson: sps.map(s => ({ spId: s.id, name: s.name, cityTier: s.city_tier,
        hireBatchId: s.hire_batch_id, isActive: s.is_active })),
    },
    externalRefs: { suanzhang: { perPerson } },
  };
  return domainAftershock(ddb, leaverId);
}

/**
 * M38 离职登记向导第一步：salespersons 离职标记（patch 双写）→ 余震 Top3 →
 * action_card(kind='talk') ×3（"一周内每人一次一对一"，aftershockTalkDays=7）。
 * 第二步（在途单）由 addHandoverCard 逐单录入；跳过 → 损耗"—（未录在途单）"（读侧自然为 null）。
 */
export async function offboard(db, ctx, { spId, leaveDate, leaveReason, gc = getCoef }) {
  await patch(db, ctx, 'salespersons', 'id', spId,
    { is_active: false, leave_date: leaveDate, leave_reason: leaveReason }, 'salesperson_offboarded');
  const top3 = await aftershockFor(db, ctx, spId, gc);
  const cardIds = [];
  for (const r of top3) {
    cardIds.push(await insertCard(db, ctx, {
      kind: 'talk', targetId: r.spId,
      payload: { source: 'aftershock', leaverId: spId, signals: r.sig, score: r.score,
        withinDays: gc('liuren.aftershockTalkDays'), talk: 'L-11' },
      eventType: 'talk_card_created',
    }));
  }
  return { ok: true, spId, leaveDate, leaveReason, aftershock: top3, cardIds };
}

/** 在途单交接卡录入（第二步逐单；L-D12 无删除路径——只可 patch receiver/标记完成） */
export async function addHandoverCard(db, ctx, {
  id, leaverId, clientName, stage, amountAmt, lastAction = null, receiverId = null,
}) {
  await put(db, ctx, 'handover_cards',
    { id, leaver_id: leaverId, client_name: clientName, stage,
      amount_amt: amountAmt, last_action: lastAction, receiver_id: receiverId },
    'handover_card_added');
  return { ok: true, id };
}

/** 指派接手人（交接卡可打印，指派 receiver——唯一合法变更路径） */
export async function assignReceiver(db, ctx, { hcId, receiverId }) {
  await patch(db, ctx, 'handover_cards', 'id', hcId,
    { receiver_id: receiverId }, 'handover_receiver_assigned');
  return { ok: true, hcId, receiverId };
}

/** 交接损耗汇总（Σ×40%，可救×50%——L-12）；未录在途单 → count=0（渲染"—（未录在途单）"） */
export async function handoverSummaryFor(db, ctx, { leaverId, gc = getCoef }) {
  const { rows } = await db.query(
    `select id, client_name, stage, amount_amt::bigint as amount_amt, receiver_id from handover_cards
      where tenant_id = $1 and leaver_id = $2 and deleted_at is null order by id`, [ctx.tenantId, leaverId]);
  const cards = rows.map(r => ({ amountAmt: Number(r.amount_amt) }));
  const s = domainHandover(cards, gc);
  return { leaverId, ...s, cards: rows.map(r => ({ hcId: r.id, clientName: r.client_name,
    stage: r.stage, amountAmt: Number(r.amount_amt), receiverId: r.receiver_id })) };
}
