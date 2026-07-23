/* ============================================================
   C8 · M29 治理体检四指数服务（v5.1 §5.2 M29 行 🟢补建）
   🔒 口径出处：4号留人器 §3.1（唯一权威）——SII/EI/DVI/AHC 四公式与出厂对拍；
     §3.2 自评偏差器；件二 BossOpLog（🔴 采集的是老板自己的操作，设置页明示且可关，
     关闭 → 该项按中位数计入并标注"该项未采集"——L-D10）。
   计算唯一出口 = domain.indices / domain.selfRatingDeviation（C1 引擎，服务层只组装不重写；
   四拆解 points 仅为渲染数据，总分唯一源 = domain.indices）。
   云端数据源组装（本模块唯一原创内容，v5.1 云端增量列）：
     SII：日报必填=1（云端 M1 为必建件，恒开）｜点名开启=shift_configs 有行｜
          抽检张/周=近28天 spot_check_cards÷4｜审批层级=0（P-3：云端无审批数据源，
          该分项按 0 计并注明——同 m12 P-1 客诉先例）｜月总查看=boss_op_logs
          view_detail 当月计数｜处方=prescriptions 当月计数
     EI ：异议提出（季）=objection_entries 近90天｜建议采纳/提出=suggestion_entries｜
          合约确认比=covenants.both_confirmed｜卡片忽略率=boss_op_logs
          card_ignore/(card_ignore+card_adopt) 滚12月（分母 0 → 0 并注明）
     DVI：derived_scalars(tenant,'dvi') 最新行直读（dayRoll 落表）；缺 → null"—"
     AHC：履约率=ledger_entries honored/achieved 滚12月（分母 0 → AHC=null"—（尚无记录）"）｜
          irrevocable 覆盖=covenants｜拦截/棘轮=boss_op_logs try_downgrade/ratchet_hit
          事件计数——🔴 P-2 现行口径：boss_op_logs 行 count 为真源（不是内存计数器）
   🔴 BossOpLog 开关边界（红线优先级裁定）：开关只作用于"采集类"动作
     （view_detail / card_ignore / card_adopt）——try_downgrade / ratchet_hit 为
     L-D1 红线留痕（尝试即留痕+全员可见），不受开关约束，永远实测。
   🔴 老板零编辑（L-D2 写侧）：derived_scalars 的 'ahc' 键唯一写点 = 本模块
     computeIndices；无任何函数接受外部 ahc 值参数（机检见 c8.test.mjs ①）。
   - 时钟注入（公约 C-14）：零真实时钟调用；boss_op_logs.ts 落业务日 ctx.today
   - 写入一律经 writes 双写（upsert/put + 事件）
   ============================================================ */
import { indices as domainIndices, selfRatingDeviation } from '../domain/liuren.mjs';
import { getCoef, safeDiv, addDays, monthOf } from '../domain/shared.mjs';
import { put, upsert } from './writes.mjs';

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const cnt = async (db, sql, params) => Number((await one(db, sql, params)).n);

/* ---------- BossOpLog 开关（L-D10：设置页明示、可关） ---------- */
export async function bossOpLogOn(db, ctx) {
  const r = await one(db,
    `select value_num::float8 as v from derived_scalars
      where tenant_id = $1 and scope = 'tenant' and key = 'bossOpLogOn'
      order by period desc, computed_at desc limit 1`, [ctx.tenantId]);
  return r == null || Number(r.v) === 1;               // 默认开启（明示可关）
}

export async function setBossOpLog(db, ctx, { on = true } = {}) {
  await upsert(db, ctx, 'derived_scalars', { constraint: 'derived_scalars_uniq' },
    { scope: 'tenant', target_id: null, key: 'bossOpLogOn', period: monthOf(ctx.today),
      value_num: on ? 1 : 0, value_json: { on, toggledAt: ctx.today } },
    'boss_op_log_toggled', { touch: ['computed_at'] });
  return { ok: true, on };
}

/** 采集类动作（开关约束）与红线留痕类动作（不受开关约束）的边界 */
const OPTIONAL_ACTIONS = new Set(['view_detail', 'card_ignore', 'card_adopt']);

/**
 * 记一条老板操作：采集类在开关关闭时不落（{logged:false}）；
 * 红线留痕类（try_downgrade/ratchet_hit/honor_confirm）恒落（force 语义内建）。
 * 🔴 ts 落业务日 ctx.today（C-14 时钟注入——滚动窗口以业务日为准）。
 */
export async function logBossOp(db, ctx, { action, targetId = null }) {
  if (OPTIONAL_ACTIONS.has(action) && !(await bossOpLogOn(db, ctx)))
    return { logged: false, reason: 'boss_op_log_off' };
  const n = await cnt(db, `select count(*)::int as n from boss_op_logs where tenant_id = $1`, [ctx.tenantId]);
  await put(db, ctx, 'boss_op_logs',
    { id: `bo_${n + 1}`, ts: ctx.today, action, target_id: targetId }, 'boss_op_logged');
  return { logged: true, id: `bo_${n + 1}` };
}

/* ---------- 数据源组装（云端增量；口径注记见文件头） ---------- */
async function assembleGovernance(db, ctx, gc) {
  const t = ctx.tenantId, today = ctx.today;
  const month = monthOf(today);
  const d90 = addDays(today, -90), d365 = addDays(today, -365), d28 = addDays(today, -28);
  const notes = [];

  const h = await cnt(db, `select count(*)::int as n from salespersons
    where tenant_id = $1 and is_active and deleted_at is null and (level is null or level = 'sales')`, [t]);

  /* --- SII --- */
  const rollcall = await cnt(db, `select count(*)::int as n from shift_configs
    where tenant_id = $1 and deleted_at is null`, [t]);
  const spot28 = await cnt(db, `select count(*)::int as n from spot_check_cards
    where tenant_id = $1 and deleted_at is null and week_of > $2 and week_of <= $3`, [t, d28, today]);
  let views = await cnt(db, `select count(*)::int as n from boss_op_logs
    where tenant_id = $1 and deleted_at is null and action = 'view_detail'
      and to_char(ts, 'YYYY-MM') = $2`, [t, month]);
  const rx = await cnt(db, `select count(*)::int as n from prescriptions
    where tenant_id = $1 and deleted_at is null and to_char(rx_date, 'YYYY-MM') = $2`, [t, month]);
  notes.push('approval_levels_no_datasource(P-3)：审批层级云端无数据源，该分项按 0 计');

  /* --- EI --- */
  const objQ = await cnt(db, `select count(*)::int as n from objection_entries
    where tenant_id = $1 and deleted_at is null and created_at::date > $2`, [t, d90]);
  const sug = await one(db, `select count(*)::int as raised,
      count(*) filter (where status = 'adopted')::int as adopted
    from suggestion_entries where tenant_id = $1 and deleted_at is null`, [t]);
  const cov = await one(db, `select count(*)::int as total,
      count(*) filter (where both_confirmed)::int as confirmed,
      count(*) filter (where irrevocable)::int as irr
    from covenants where tenant_id = $1 and deleted_at is null`, [t]);
  const cardOps = await one(db, `select
      count(*) filter (where action = 'card_ignore')::int as ig,
      count(*) filter (where action = 'card_adopt')::int as ad
    from boss_op_logs where tenant_id = $1 and deleted_at is null and ts::date > $2`, [t, d365]);
  let ignoreRate = safeDiv(Number(cardOps.ig), Number(cardOps.ig) + Number(cardOps.ad));
  if (ignoreRate == null) { ignoreRate = 0; notes.push('尚无卡片处理记录：忽略率按 0 计（A-19 例外：授权通道未被使用）'); }

  /* --- AHC（P-2：boss_op_logs count 为真源；红线留痕不受开关约束） --- */
  const led = await one(db, `select count(*)::int as achieved,
      count(*) filter (where honored_at is not null)::int as honored
    from ledger_entries where tenant_id = $1 and deleted_at is null
      and achieved_at > $2 and achieved_at <= $3`, [t, d365, today]);
  const achieved = Number(led.achieved), honored = Number(led.honored);
  const honoredRatio = achieved > 0 ? honored / achieved : null;
  const intercepts = await cnt(db, `select count(*)::int as n from boss_op_logs
    where tenant_id = $1 and deleted_at is null and action = 'try_downgrade' and ts::date > $2`, [t, d365]);
  const ratchets = await cnt(db, `select count(*)::int as n from boss_op_logs
    where tenant_id = $1 and deleted_at is null and action = 'ratchet_hit' and ts::date > $2`, [t, d365]);

  /* --- DVI（derived_scalars 直读；dayRoll 落表） --- */
  const dviRow = await one(db, `select value_num::float8 as v, computed_at from derived_scalars
    where tenant_id = $1 and scope = 'tenant' and key = 'dvi'
    order by period desc, computed_at desc limit 1`, [t]);
  const dvi = dviRow && dviRow.v != null ? Number(dviRow.v) : null;

  /* --- 开关关闭 → 采集类分项按中位数计入 + 标注（L-D10；红线留痕类不动） --- */
  const opLogOn = await bossOpLogOn(db, ctx);
  if (!opLogOn) {
    const cS = gc('liuren.sii');
    views = (h * cS.viewPerCapMonth) / 2;              // → 该分项恰为 0.5（中位数）
    ignoreRate = 0.5;
    notes.push('BossOpLog 已关闭：月总查看/卡片忽略率 按中位数计入（该项未采集）；'
      + 'try_downgrade/ratchet_hit 为红线留痕（L-D1）不受开关约束，仍为实测');
  }

  return {
    opLogOn, notes, headcount: h,
    ddb: {
      governance: {
        sii: { dailyReportOn: true, rollcallOn: rollcall > 0, spotChecksPerWeek: spot28 / 4,
          approvalLevels: 0, monthlyViewsTotal: views, activeHeadcount: h, rxCountTotal: rx },
        ei: { objectionsRaisedQuarter: objQ, suggestionsRaised: Number(sug.raised),
          suggestionsAdopted: Number(sug.adopted),
          covenantConfirmRatio: safeDiv(Number(cov.confirmed), Number(cov.total)) ?? 0,
          cardIgnoreRate: ignoreRate, activeHeadcount: h },
        ahcInputs: { honoredRatio: honoredRatio ?? 0, achievedCount: achieved, honoredCount: honored,
          irrevocableRatio: 0, interceptCount: intercepts, ratchetCount: ratchets },
      },
      entities: {
        Covenant: Array.from({ length: Number(cov.total) }, (_, i) => ({ irrevocable: i < Number(cov.irr) })),
      },
      externalRefs: dviRow ? { suanzhang: { derived: { dvi }, exportedAt: dviRow.computed_at } } : null,
    },
    raw: { views, rx, spot28, rollcall, objQ, sug, cov, cardOps, achieved, honored, honoredRatio, intercepts, ratchets, dvi },
  };
}

/**
 * 🔴 computeIndices —— 四指数唯一计算与落表入口（无任何外部指数值参数）。
 * domain.indices 出总分（唯一口径源）→ 四行 derived_scalars(tenant, sii/ei/dvi/ahc)
 * UPSERT 覆盖式落表，带 computed_at（公约 A-21）。AHC 履约分母 0 → null"—（尚无记录）"。
 */
export async function computeIndices(db, ctx, { gc = getCoef } = {}) {
  const g = await assembleGovernance(db, ctx, gc);
  const ind = domainIndices(g.ddb, ctx.today, gc);
  const cA = gc('liuren.ahc'), wA = cA.w, r = g.raw;

  /* AHC 四拆解（渲染数据；总分唯一源 = domain.indices） */
  const four = r.honoredRatio == null ? null : [
    { item: '① 履约率（滚12月）', weight: wA[0], value: r.honoredRatio,
      points: wA[0] * r.honoredRatio, honored: r.honored, achieved: r.achieved },
    { item: '② irrevocable 覆盖', weight: wA[1],
      value: safeDiv(Number(r.cov.irr), Number(r.cov.total)) ?? 0,
      points: wA[1] * (safeDiv(Number(r.cov.irr), Number(r.cov.total)) ?? 0) },
    { item: '③ 拦截下调次数', weight: wA[2], count: r.intercepts,
      points: wA[2] * (1 - Math.min(r.intercepts / cA.interceptCap, 1)) },
    { item: '④ 棘轮触发次数', weight: wA[3], count: r.ratchets,
      points: wA[3] * (1 - Math.min(r.ratchets / cA.ratchetCap, 1)) },
  ];
  const ahcValue = r.honoredRatio == null ? null : ind.ahc.value;   // 分母 0 → "—（尚无记录）"
  const ahcNotes = r.honoredRatio == null ? [...g.notes, '履约总账尚无达成记录 → AHC "—（尚无记录）"'] : g.notes;

  /* 🔴 四行落表写点全部显式字面量（L-D2 写侧机检：ahc 键写形全 server 仅此函数一处） */
  const month = monthOf(ctx.today);
  const w = (row, valueJson) => upsert(db, ctx, 'derived_scalars',
    { constraint: 'derived_scalars_uniq' },
    { scope: 'tenant', target_id: null, period: month, ...row, value_json: valueJson },
    'derived_scalar_written', { touch: ['computed_at'] });
  await w({ key: 'sii', value_num: ind.sii.value },
    { band: ind.sii.band, inputs: g.ddb.governance.sii, notes: g.notes, opLogOn: g.opLogOn });
  await w({ key: 'ei', value_num: ind.ei.value },
    { band: ind.ei.band, inputs: g.ddb.governance.ei, notes: g.notes, opLogOn: g.opLogOn });
  await w({ key: 'dvi', value_num: ind.dvi.value },
    { band: ind.dvi.band, source: ind.dvi.value == null ? '—（需算账器数据）' : 'dayRoll' });
  await w({ key: 'ahc', value_num: ahcValue },
    { band: ahcValue == null ? null : ind.ahc.band, four, notes: ahcNotes,
      interceptCount: r.intercepts, ratchetCount: r.ratchets, opLogOn: g.opLogOn });

  return {
    asOf: ctx.today, period: month, bossOpLogOn: g.opLogOn, notes: ahcNotes,
    sii: { value: ind.sii.value, band: ind.sii.band },
    ei: { value: ind.ei.value, band: ind.ei.band },
    dvi: { value: ind.dvi.value, band: ind.dvi.band },
    ahc: { value: ahcValue, band: ahcValue == null ? null : ind.ahc.band, four,
      interceptCount: r.intercepts, ratchetCount: r.ratchets },
  };
}

/** 四指数读侧（derived_scalars 最新行；render 用——不触发重算） */
export async function readIndices(db, ctx) {
  const out = {};
  for (const key of ['sii', 'ei', 'dvi', 'ahc']) {
    const r = await one(db, `select value_num::float8 as v, value_json, computed_at
        from derived_scalars
       where tenant_id = $1 and scope = 'tenant' and key = '${key}'
       order by period desc, computed_at desc limit 1`, [ctx.tenantId]);
    out[key] = r ? { value: r.v == null ? null : Number(r.v),
      json: typeof r.value_json === 'string' ? JSON.parse(r.value_json) : r.value_json,
      computedAt: r.computed_at } : { value: null, json: null, computedAt: null };
  }
  return out;
}

/** AHC 拦截记录（全员可见；钱途页第⑤栏数据源） */
export async function interceptRecords(db, ctx) {
  const { rows } = await db.query(
    `select ts::date::text as at, target_id from boss_op_logs
      where tenant_id = $1 and deleted_at is null and action = 'try_downgrade'
      order by ts desc, id desc`, [ctx.tenantId]);
  return rows.map(r => ({ at: r.at, targetId: r.target_id }));
}

/* ---------- M29.5 自评偏差器（四滑杆先猜后看，30 秒） ---------- */
export async function submitSelfRating(db, ctx, { ratings }) {
  const n = await cnt(db, `select count(*)::int as n from boss_self_ratings where tenant_id = $1`, [ctx.tenantId]);
  await put(db, ctx, 'boss_self_ratings',
    { id: `bsr_${n + 1}`, rated_at: ctx.today,
      sii: ratings.sii, ei: ratings.ei, dvi: ratings.dvi, ahc: ratings.ahc }, 'boss_self_rated');
  return { ok: true, id: `bsr_${n + 1}` };
}

/** 自评 vs 实测（实测 = derived_scalars 存量读侧；DVI 缺 → 三项均值，domain 持有该口径） */
export async function selfDeviation(db, ctx) {
  const r = await one(db, `select sii, ei, dvi, ahc, rated_at::text as rated_at from boss_self_ratings
      where tenant_id = $1 and deleted_at is null
      order by rated_at desc, created_at desc limit 1`, [ctx.tenantId]);
  if (!r) return { rows: [], gap: null, note: '尚无自评记录' };
  const ind = await readIndices(db, ctx);
  const dev = selfRatingDeviation(
    { sii: r.sii, ei: r.ei, dvi: r.dvi, ahc: r.ahc },
    { sii: ind.sii.value, ei: ind.ei.value, dvi: ind.dvi.value, ahc: ind.ahc.value });
  return { ...dev, ratedAt: r.rated_at };
}
