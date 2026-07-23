/* ============================================================
   C13 · 双向迁移（v5.1 §2.2 / §12 C13 行；公约【7】skab_v1）
   🔴 双向可迁移是承诺，不是可选项（§2.2）：
     - importEnvelopes：单机版 1–5 个信封上传 → entities 按公约实体白名单落真表、
       derived（连同整包）落 external_refs(tenant, board) 整条覆盖（A-20）→ 事件
     - exportAll：随时导出 5 个信封（每 board 一个）→ 可回落单机版；
       🔴 到期/停机仍可调（A-C05 / 授-2）：本函数只读 + logEvent，
       不经 writes 业务写锁、不经 billing.requireBoard（停机豁免名单，机检见测试⓪）
   规则（公约【7】通用规则逐条落地）：
     ① 导入只认 skab_v1；未知实体/未知 derived 键静默跳过（向前兼容）
     ② dataVersion 不匹配不报错拒收（v1 原样收）
     ③ 同 board 重复导入 = 整条覆盖：上次导入行先软删（deleted_at）再 upsert；
        来源不加 source_board 列——用事件 payload（envelope_imported.inserted）记录，
        既是覆盖依据也是"任一汇总可由事件流复算"的迁移侧留痕
     ④ append-only/irrevocable 表（menu_choices/covenant_docs/ledger_entries/
        m28_agreements）不软删不覆盖：只补插缺失 id（公约不可变红线 > 覆盖语义）
   - 迁移工具 = 行级事件双写的唯一豁免（整包一事件，payload 含全部落表 id，可复算）
   - 时钟注入（公约 C-14）：零真实时钟调用；exportedAt = ctx.today；imported_at = DB now()
   ============================================================ */
import { buildEnvelope, validateEnvelope, COEFFICIENTS } from '../domain/shared.mjs';
import { exportEnvelope as zhaorenExportEnvelope } from '../domain/zhaoren.mjs';
import { exportEnvelope as yurenExportEnvelope, ENTITY_WHITELIST } from '../domain/yuren.mjs';
import { buildSuanzhangEnvelope } from '../domain/suanzhang.mjs';
import { logEvent } from './writes.mjs';

export { ENTITY_WHITELIST };                          // 公约实体白名单（唯一源 = domain/yuren）

/* ---------- 公约实体 → 真表映射（表名 snake_case 复数，C2 建表口径） ---------- */
export const ENTITY_TABLE = {
  Salesperson: 'salespersons', CompPlanScenario: 'comp_plan_scenarios', TeamStructure: 'team_structures',
  CovenantDoc: 'covenant_docs', Covenant: 'covenants', Deal: 'deals', Category: 'categories',
  PayoutEntry: 'payout_entries', RefundEntry: 'refund_entries', DiscountEntry: 'discount_entries',
  LeadAssignment: 'lead_assignments', DailyReport: 'daily_reports', CoachingAck: 'coaching_acks',
  CoachTask: 'coach_tasks', Prescription: 'prescriptions', Bounty: 'bounties',
  HiringCriteria: 'hiring_criteria', Candidate: 'candidates', InterviewScorePack: 'interview_score_packs',
  PracticeLog: 'practice_logs', HireBatch: 'hire_batches', ManagerChangeEvent: 'manager_change_events',
  LedgerEntry: 'ledger_entries', ObjectionEntry: 'objection_entries', SuggestionEntry: 'suggestion_entries',
  M28Agreement: 'm28_agreements', MenuChoice: 'menu_choices', OverrideEvent: 'override_events',
  Experiment: 'experiments', HandoverCard: 'handover_cards', CallMetrics: 'call_metrics',
  /* M21Norm：派生视图（可重算），不落真表——留在 external_refs.entities 供消费侧只读（A-11 由 runM21 重建） */
};

/* append-only / irrevocable：不软删、不覆盖，只补插缺失 id（触发器为第二道保险） */
export const APPEND_ONLY_TABLES = new Set(['menu_choices', 'covenant_docs', 'ledger_entries', 'm28_agreements']);

/* 云端增量审计列（v5.1 §3.1）：永不进信封、导入时由本层注入 */
const AUDIT_COLS = new Set(['tenant_id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at']);

const camel = s => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = s => s.replace(/([A-Z])/g, '_$1').toLowerCase();
const param = v => (v !== null && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
const dateStr = v => (v instanceof Date) ? v.toISOString().slice(0, 10) : v;

/* 系数表指纹（FNV-1a，公约【7】：导入侧不一致只提示不阻断） */
export function coefficientsHash(obj = COEFFICIENTS) {
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* ---------- 单机域形 → 云端表形适配（其余实体 = 键名 camel→snake 直映 + 列交集） ---------- */
const ADAPT = {
  DailyReport: r => ({
    id: r.id, employeeId: r.employeeId, reportDate: r.reportDate ?? r.date,
    leads: r.leads ?? r.counts?.leads ?? 0, intents: r.intents ?? r.counts?.intents ?? 0,
    samples: r.samples ?? r.counts?.samples ?? 0, contracts: r.contracts ?? r.counts?.contracts ?? 0,
  }),
  CoachingAck: r => ({
    id: r.id, coachTaskId: r.coachTaskId ?? null, managerId: r.managerId ?? r.coachId ?? null,
    employeeId: r.employeeId ?? r.spId,
    employeeAckStatus: r.employeeAckStatus ?? r.status ?? 'no_response',
    durationMin: r.durationMin ?? (r.durationHrs != null ? Math.round(r.durationHrs * 60) : null),
    managerReportedAt: r.managerReportedAt ?? r.date ?? null, employeeAckAt: r.employeeAckAt ?? null,
  }),
  M28Agreement: r => ({ ...r, masterId: r.masterId ?? r.spId }),
};

/* 表列缓存（information_schema 一次/表） */
async function tableCols(db, table, cache) {
  if (cache.has(table)) return cache.get(table);
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`, [table]);
  const cols = new Set(rows.map(r => r.column_name));
  cache.set(table, cols);
  return cols;
}

/* ============================================================
   importEnvelopes(db, ctx, {envelopes[]})：单机 1–5 信封 → 落库
   ============================================================ */
export async function importEnvelopes(db, ctx, { envelopes }) {
  if (!Array.isArray(envelopes) || envelopes.length < 1 || envelopes.length > 5)
    throw new Error(`一次导入 1–5 个信封（得到 ${Array.isArray(envelopes) ? envelopes.length : typeof envelopes}）`);
  /* board 各异——先整批校验再落任何一行（半批落库 = 覆盖依据被污染） */
  const boards = envelopes.map(e => e && e.board).filter(Boolean);
  if (new Set(boards).size !== boards.length)
    throw new Error(`同一批内 board 重复：${boards.join(',')}（board 须各异）`);
  const cache = new Map();
  const results = [];

  for (const env of envelopes) {
    const v = validateEnvelope(env);
    if (!v.ok) { results.push({ board: env && env.board, ok: false, reason: v.reason }); continue; }

    /* ③ 整条覆盖：上一次该 board 导入的行先软删（append-only 表除外） */
    const { rows: prevEv } = await db.query(
      `select payload from event_stream
        where tenant_id = $1 and type = 'envelope_imported' and target_id = $2
        order by event_id desc limit 1`, [ctx.tenantId, env.board]);
    if (prevEv.length) {
      const prev = typeof prevEv[0].payload === 'string' ? JSON.parse(prevEv[0].payload) : prevEv[0].payload;
      const knownTables = new Set(Object.values(ENTITY_TABLE));
      for (const [table, ids] of Object.entries(prev.inserted || {})) {
        if (!knownTables.has(table) || APPEND_ONLY_TABLES.has(table) || !ids.length) continue;
        await db.query(
          `update ${table} set deleted_at = now(), updated_by = $3, updated_at = now()
            where tenant_id = $1 and id = any($2::text[]) and deleted_at is null`,
          [ctx.tenantId, `{${ids.join(',')}}`, ctx.actorId]);
      }
    }

    /* ① entities 按白名单落真表；未知实体静默跳过 */
    const inserted = {};
    const skippedEntities = [];
    const rowErrors = [];
    for (const [name, list] of Object.entries(env.entities || {})) {
      const table = ENTITY_WHITELIST.includes(name) ? ENTITY_TABLE[name] : undefined;
      if (!table || !Array.isArray(list)) { skippedEntities.push(name); continue; }
      const cols = await tableCols(db, table, cache);
      const ids = [];
      for (let i = 0; i < list.length; i++) {
        const adapted = ADAPT[name] ? ADAPT[name](list[i]) : list[i];
        const row = { ...adapted };
        if (row.id == null) row.id = `im_${name}_${i + 1}`;          // 确定性 id：重复导入同位覆盖
        const entry = {};
        for (const [k, val] of Object.entries(row)) {
          const c = snake(k);
          if (cols.has(c) && !AUDIT_COLS.has(c)) entry[c] = dateStr(val);
        }
        if (entry.id == null) { rowErrors.push({ table, i, err: 'no id column' }); continue; }
        const names = Object.keys(entry);
        const sets = names.filter(c => c !== 'id')
          .map(c => `${c} = excluded.${c}`);
        const conflict = APPEND_ONLY_TABLES.has(table)
          ? 'on conflict (tenant_id, id) do nothing'
          : `on conflict (tenant_id, id) do update set ${[...sets,
            'deleted_at = null', `updated_by = '${ctx.actorId}'`, 'updated_at = now()'].join(', ')}`;
        const sql = `insert into ${table}(tenant_id, created_by, ${names.join(',')})
          values ($1, $2, ${names.map((_, j) => '$' + (j + 3)).join(',')}) ${conflict}`;
        try {
          await db.query(sql, [ctx.tenantId, ctx.actorId, ...names.map(c => param(entry[c]))]);
          ids.push(entry.id);
        } catch (e) {
          rowErrors.push({ table, id: entry.id, err: String(e.message).slice(0, 120) });
        }
      }
      inserted[table] = ids;
    }

    /* derived（连同整包）落 external_refs(tenant, board) —— 🔴 (tenant,board) 唯一 = 整条覆盖 */
    await db.query(
      `insert into external_refs(tenant_id, board, exported_at, data_version, coefficients_hash,
                                 derived, entities, imported_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7, now(), $8)
       on conflict (tenant_id, board) do update set
         exported_at = excluded.exported_at, data_version = excluded.data_version,
         coefficients_hash = excluded.coefficients_hash, derived = excluded.derived,
         entities = excluded.entities, imported_at = now(), deleted_at = null,
         updated_by = $8, updated_at = now()`,
      [ctx.tenantId, env.board, env.exportedAt ?? null, env.dataVersion ?? 1,
        env.coefficientsHash ?? null, JSON.stringify(env.derived || {}),
        JSON.stringify(env.entities || {}), ctx.actorId]);

    /* 事件（整包一事件；payload = 覆盖依据 + 留痕） */
    await logEvent(db, ctx, 'envelope_imported', env.board, {
      board: env.board, exportedAt: env.exportedAt ?? null, dataVersion: env.dataVersion ?? 1,
      coefficientsHash: env.coefficientsHash ?? null,
      coefficientsHashMatch: env.coefficientsHash ? env.coefficientsHash === coefficientsHash() : null,
      inserted, skippedEntities, rowErrors,
    });
    results.push({
      board: env.board, ok: true, skippedEntities, rowErrors,
      inserted: Object.fromEntries(Object.entries(inserted).map(([t, ids]) => [t, ids.length])),
    });
  }
  return { ok: results.every(r => r.ok), results };
}

/* ============================================================
   exportAll(db, ctx)：云端 → 5 个 skab_v1 信封（可回落单机版）
   🔴 只读 + logEvent：到期/停机仍可调（A-C05/授-2；billing 停机豁免名单）
   ============================================================ */
async function tableRows(db, ctx, table) {
  const { rows } = await db.query(
    `select * from ${table} where tenant_id = $1 and deleted_at is null order by id`, [ctx.tenantId]);
  return rows.map(r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (AUDIT_COLS.has(k)) continue;
      out[camel(k)] = dateStr(v);
    }
    return out;
  });
}

async function latestScalar(db, ctx, key) {
  const { rows } = await db.query(
    `select value_num::float8 as v from derived_scalars
      where tenant_id = $1 and scope = 'tenant' and key = $2
      order by period desc, computed_at desc limit 1`, [ctx.tenantId, key]);
  return rows.length && rows[0].v != null ? Number(rows[0].v) : null;
}

export async function exportAll(db, ctx) {
  const today = ctx.today;
  const hash = coefficientsHash();
  const T = t => tableRows(db, ctx, t);

  /* —— dingjia：现行方案三值（互锁表 #9：r/矩阵T）+ 场景/信用书/菜单锁定 —— */
  const { rows: pv } = await db.query(
    `select r_rate::float8 as r, matrix_t_amt::bigint as t from comp_plan_versions
      where tenant_id = $1 order by version desc limit 1`, [ctx.tenantId]);
  const dingjia = buildEnvelope({
    board: 'dingjia', exportedAt: today, coefficientsHash: hash,
    derived: {
      rRate: pv.length ? Number(pv[0].r) : null,
      matrixTAmt: pv.length && pv[0].t != null ? Number(pv[0].t) : null,
    },
    entities: {
      CompPlanScenario: await T('comp_plan_scenarios'),
      CovenantDoc: await T('covenant_docs'),
      MenuChoice: await T('menu_choices'),
    },
  });

  /* —— zhaoren（domain.exportEnvelope 口径）：人事档案 + 招聘链四实体（互锁表 #13/#14） —— */
  const zhaoren = zhaorenExportEnvelope({
    today, coefficientsHash: hash, derived: {},
    entities: {
      Salesperson: await T('salespersons'),
      Candidate: await T('candidates'),
      InterviewScorePack: await T('interview_score_packs'),
      PracticeLog: await T('practice_logs'),
      HireBatch: await T('hire_batches'),
    },
  });

  /* —— suanzhang：Deal/Category + derived 四项（互锁表 #1–#4；缺 → null 不硬造） —— */
  const suanzhang = buildSuanzhangEnvelope(today, {
    realP90Factor: await latestScalar(db, ctx, 'realP90Factor'),
    dvi: await latestScalar(db, ctx, 'dvi'),
    imbalanceRate: await latestScalar(db, ctx, 'imbalanceRate'),
    uerTeamMean: await latestScalar(db, ctx, 'uerTeamMean'),
  }, {
    Deal: await T('deals'),
    Category: await T('categories'),
  }, hash);

  /* —— liuren：ahc + M28Agreement 双载荷（🔧L-C11；互锁表 #15–#17）——
     ahc/dvi 取 derived_scalars 最新行（唯一写点 = m29.computeIndices，domain.indices 同口径） —— */
  const liuren = buildEnvelope({
    board: 'liuren', exportedAt: today, coefficientsHash: hash,
    derived: { ahc: await latestScalar(db, ctx, 'ahc'), dvi: await latestScalar(db, ctx, 'dvi') },
    entities: {
      M28Agreement: await T('m28_agreements'),
      Covenant: await T('covenants'),
      LedgerEntry: await T('ledger_entries'),
      ObjectionEntry: await T('objection_entries'),
      SuggestionEntry: await T('suggestion_entries'),
      HandoverCard: await T('handover_cards'),
    },
  });

  /* —— yuren（domain.exportEnvelope 口径）：辅导剂量 derived（互锁表 #18/#19）——
     喂以从真表组装的 db 形状（coachingAcks/dailyReports 折为域形） —— */
  const sps = await T('salespersons');
  const acks = await T('coaching_acks');
  const reps = await T('daily_reports');
  const yuren = yurenExportEnvelope({
    salespeople: sps.map(p => ({ spId: p.id, name: p.name, hireDate: p.hireDate, isActive: p.isActive })),
    coachingAcks: acks.map(a => ({
      id: a.id, spId: a.employeeId, coachTaskId: a.coachTaskId, managerId: a.managerId,
      status: a.employeeAckStatus, date: a.managerReportedAt ? String(a.managerReportedAt).slice(0, 10) : null,
      durationHrs: a.durationMin == null ? null : Number(a.durationMin) / 60,
    })),
    dailyReports: reps.map(r => ({
      id: r.id, employeeId: r.employeeId, date: r.reportDate,
      counts: { leads: r.leads, intents: r.intents, samples: r.samples, contracts: r.contracts },
    })),
    coachTasks: await T('coach_tasks'),
    prescriptions: await T('prescriptions'),
    bounties: await T('bounties'),
  }, today, hash);

  const envelopes = [dingjia, zhaoren, suanzhang, liuren, yuren];
  await logEvent(db, ctx, 'envelopes_exported', null, {
    exportedAt: today, coefficientsHash: hash,
    boards: envelopes.map(e => e.board),
    entityCounts: Object.fromEntries(envelopes.map(e =>
      [e.board, Object.fromEntries(Object.entries(e.entities).map(([k, v]) => [k, v.length]))])),
  });
  return { exportedAt: today, coefficientsHash: hash, envelopes };
}
