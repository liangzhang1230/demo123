/* ============================================================
   C8 · M28 产权机器服务（v5.1 §5.2 M28 行 🟢补建 · irrevocable）
   🔒 口径出处：4号留人器 §3.5 M28 产权四件（唯一权威）：
     署名权永久；带教分成=徒弟月净贡献×5%×12月；使用费=团队净贡献增量×2%×24月
     （基准=上线前3月快照🔴不可改）；irrevocable 代码拦截（只允许上调延长）。
     对拍 T6/T7/T12：5.8万×5%×12=3.48万（vs 一次性500 → 69.6倍）；7.3万×2%×24=3.5万。
   🔴 L-D1（本板块最高红线①）：rate/duration 下调在代码层无成功路径——
     ① 服务层：本模块对 m28_agreements 零 patch/UPDATE 调用（机检 c8 ⓪）；
     ② DB 层：schema-c2 G2 触发器拒绝 rate/duration 下调、irrevocable 撤销、快照改动、DELETE
     （双保险）。[尝试下调] → 🔒 domain.tryDowngradeM28 返回变更指令 events → 服务层应用：
     override_events 留痕（全员可见）+ boss_op_logs try_downgrade（🔴 P-2：count 为真源，
     红线留痕不受 BossOpLog 开关约束——m29.logBossOp 内建该边界）+ m29.computeIndices
     重算 AHC 落表（AHC 下降 = 20×min(拦截/10,1) 分项恶化）。
   - 时钟注入（公约 C-14）：零真实时钟调用；写入一律经 writes 双写
   ============================================================ */
import { tryDowngradeM28 as domainTryDowngrade, m28Value } from '../domain/liuren.mjs';
import { getCoef, safeDiv } from '../domain/shared.mjs';
import { put } from './writes.mjs';
import { computeIndices, logBossOp } from './m29.mjs';

/** 签订 M28 协议（落库 + 事件；irrevocable 强制 true——列默认 + 触发器不可撤销） */
export async function createM28(db, ctx, {
  id, masterId, kind, rate, durationMonths, startTrigger, baselineSnapshotAmt = null,
}) {
  await put(db, ctx, 'm28_agreements',
    { id, master_id: masterId, kind, rate, duration_months: durationMonths,
      start_trigger: startTrigger, baseline_snapshot_amt: baselineSnapshotAmt, irrevocable: true },
    'm28_signed');
  return { ok: true, id };
}

/** 协议列表（domain 形状） */
export async function listM28(db, ctx, { masterId = null } = {}) {
  const { rows } = await db.query(
    `select id, master_id, kind, rate::float8 as rate, duration_months,
            start_trigger, baseline_snapshot_amt::bigint as snap, irrevocable, created_at
       from m28_agreements
      where tenant_id = $1 and deleted_at is null ${masterId ? 'and master_id = $2' : ''}
      order by id`, masterId ? [ctx.tenantId, masterId] : [ctx.tenantId]);
  return rows.map(r => ({
    m28Id: r.id, masterId: r.master_id, kind: r.kind, rate: Number(r.rate),
    durationMonths: Number(r.duration_months), startTrigger: r.start_trigger,
    baselineSnapshotAmt: r.snap == null ? null : Number(r.snap),
    irrevocable: r.irrevocable, createdAt: r.created_at,
  }));
}

/* 当前 AHC 读侧（derived_scalars 最新行；缺 → null） */
async function currentAhc(db, ctx) {
  const { rows } = await db.query(
    `select value_num::float8 as v from derived_scalars
      where tenant_id = $1 and scope = 'tenant' and key = 'ahc'
      order by period desc, computed_at desc limit 1`, [ctx.tenantId]);
  return rows.length && rows[0].v != null ? Number(rows[0].v) : null;
}

/**
 * 🔴 [尝试下调]（L-D1 / T12）：调 domain.tryDowngradeM28 → 应用 events：
 *   append OverrideEvent → override_events B 形留痕（visible_to_all=true 全员可见）
 *   inc interceptCount   → boss_op_logs try_downgrade（P-2：行 count 为 AHC 真源）
 *   → m29.computeIndices 重算 AHC 落表。
 * 🔴 m28_agreements 行零改动（本函数无任何该表写语句；C2 触发器双保险）。
 * 返回 { ok: false, ahcBefore, ahcAfter }。
 */
export async function tryDowngrade(db, ctx, { m28Id, note = null, gc = getCoef } = {}) {
  const agreements = await listM28(db, ctx);
  const verdict = domainTryDowngrade(agreements, m28Id, ctx.today, note);
  if (verdict.reason === 'not_found') return { ok: false, reason: 'not_found' };

  let ahcBefore = await currentAhc(db, ctx);
  if (ahcBefore == null) ahcBefore = (await computeIndices(db, ctx, { gc })).ahc.value;

  for (const e of verdict.events) {
    if (e.op === 'append' && e.entity === 'OverrideEvent') {
      const { rows } = await db.query(
        `select count(*)::int as n from override_events where tenant_id = $1`, [ctx.tenantId]);
      await put(db, ctx, 'override_events',
        { id: `ov_m28_${rows[0].n + 1}`, action: 'try_downgrade', m28_id: e.record.m28Id,
          event_date: e.record.at, note: e.record.note, visible_to_all: true },
        'm28_downgrade_intercepted');
    } else if (e.op === 'inc') {
      /* interceptCount +1 的物理落点 = boss_op_logs try_downgrade（P-2 count 为真源） */
      await logBossOp(db, ctx, { action: 'try_downgrade', targetId: m28Id });
    }
  }
  const after = await computeIndices(db, ctx, { gc });
  return {
    ok: false, reason: verdict.reason, downgraded: false, logged: true,
    ahcBefore, ahcAfter: after.ahc.value,
  };
}

/**
 * 产权看板（协议列表 + 对价 + 69.6 倍对比）。
 * 月度净贡献额（徒弟月净贡献 / 团队月增量）为老板输入或上层组装（C8 起步版：
 * monthlyAmtById 显式传入；缺 → 对价"—"，不硬造）。
 */
export async function m28Board(db, ctx, { monthlyAmtById = {}, gc = getCoef } = {}) {
  const list = await listM28(db, ctx);
  const oneOffAmt = gc('liuren.m28').oneOffAmt;
  const rows = list.map(a => {
    const monthly = monthlyAmtById[a.m28Id] ?? null;
    const valueAmt = monthly == null ? null : m28Value(
      a.kind === 'mentoring'
        ? { ...a, apprenticeMonthlyNetAmt: monthly }
        : { ...a, teamMonthlyIncrementAmt: monthly });
    return { ...a, monthlyAmt: monthly, valueAmt,
      vsOneOff: valueAmt == null ? null : safeDiv(valueAmt, oneOffAmt) };   // 69.6 倍口径
  });
  return { rows, oneOffAmt };
}
