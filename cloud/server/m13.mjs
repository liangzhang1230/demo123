/* ============================================================
   C7 · M13 悬赏服务（v5.1 §5.1 M13 行 🔴取代 · ✅D-1 已裁决：允许保存 + 强制对冲）
   🔒 口径出处（三处逐字同源，R-04 同改）：5号育人器 §3.4 M13 + 闸⑧（Y-C05）｜
     4号留人器 闸③（L-C07）｜公约 §6.1 A-12 细则：
     - 三态（domain.bountyGate，表单校验层）：
         isExempt(first_deal/hire)                     → 🟢 无条件放行（无内在动机可挤出）
         isResultTrigger(record_break/sprint/backlog_clear) ∧ 静默认可通道未启 → 🔴 拦截保存
           + 话术 Y-13 + [一键启用静默认可通道]（拦的不是悬赏，是"只有钱这一条路"）
         其余（行为类 / 通道已启）                       → 🟢 放行
     - 边界：同时活动 ≤ 3；达成判定纯事件流；🔴 不进提成/排名/七级（Y-D2，机检 c7 ②）
   - 🔴 静默认可通道为云端必建件，且先于悬赏表单（v5.1 §5.1 M13 行）：
     saveBounty 的闸⑧判定依赖本模块 silentTrackOn 读侧——通道开关先建，表单后建。
   - 通道开关落点说明：tenants 表属 C0 底座（不得为业务加列，L-3）、pace_configs 无
     布尔位；按 C7 任务指定落 derived_scalars(scope='tenant', key='silentTrackOn')——
     它本质是"租户级标量 + asOf"，derived_scalars 正是该形状（value_num 1/0，
     period=切换月，读侧取最新一行）。
   时钟注入（公约 C-14）：零真实时钟调用；写入一律经 writes 双写。
   ============================================================ */
import { bountyGate, isResultTrigger, isExempt, TALK } from '../domain/yuren.mjs';
import { monthOf } from '../domain/shared.mjs';
import { put, upsert } from './writes.mjs';

const TEMPLATES = ['first_deal', 'record_break', 'sprint', 'backlog_clear', 'hire'];  // YE-04 锁死

/** 静默认可通道读侧：最新一行 value_num=1 即已启用（无行 → 未启用） */
export async function silentTrackOn(db, ctx) {
  const { rows } = await db.query(
    `select value_num::float8 as v from derived_scalars
      where tenant_id = $1 and scope = 'tenant' and key = 'silentTrackOn'
      order by period desc, computed_at desc limit 1`, [ctx.tenantId]);
  return rows.length > 0 && Number(rows[0].v) === 1;
}

/**
 * 启用/停用静默认可通道（连续6月达标→灯塔+合约资格池；不发奖/不播报/不排名——Y-10）。
 * UPSERT 覆盖式（同月重切换=覆盖）+ 事件 silent_track_toggled。
 */
export async function silentTrackEnable(db, ctx, { on = true } = {}) {
  await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'tenant', target_id: null, key: 'silentTrackOn', period: monthOf(ctx.today),
      value_num: on ? 1 : 0, value_json: { on, toggledAt: ctx.today } },
    'silent_track_toggled', { touch: ['computed_at'] });
  return { ok: true, on };
}

/**
 * 🔴 保存悬赏（闸⑧三态在表单校验层——拦截即保存路径不存在，Y-D16）：
 *   结果类 ∧ 通道未启 → 拒 + 话术码 Y-13 + showEnable（[一键启用静默认可通道]）；
 *   豁免/已启/行为类 → 放行；同时活动 ≤ 3；落 bounties + 事件 bounty_created。
 */
export async function saveBounty(db, ctx, { trigger, template = null, amountAmt = null, params = {} }) {
  const on = await silentTrackOn(db, ctx);
  const gate = bountyGate(trigger, on);                 // C1 引擎三态（与 4号闸③同输入同结果）
  if (!gate.allow)
    return { ok: false, state: gate.state, talk: gate.talk /* 'Y-13' */,
      y13: TALK.y13(TALK.bountyNames[trigger] || trigger), showEnable: true,
      isResult: isResultTrigger(trigger) };
  const { rows } = await db.query(
    `select count(*)::int as n from bounties where tenant_id = $1 and active and deleted_at is null`,
    [ctx.tenantId]);
  if (rows[0].n >= 3) return { ok: false, err: '同时活动的悬赏 ≤ 3', activeCount: rows[0].n };
  const { rows: cnt } = await db.query(
    `select count(*)::int as n from bounties where tenant_id = $1`, [ctx.tenantId]);
  const id = `bt_${cnt[0].n + 1}`;
  await put(db, ctx, 'bounties',
    { id, trigger, template: template ?? (TEMPLATES.includes(trigger) ? trigger : null),
      params, amount_amt: amountAmt, active: true, achieved_events: [] },
    'bounty_created');
  return { ok: true, id, state: gate.state, exempt: isExempt(trigger) };
}
