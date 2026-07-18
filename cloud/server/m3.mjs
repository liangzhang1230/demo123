/* ============================================================
   C4 · M3 招聘漏斗五池服务（v5.1 §5.1 M3 行 🔴取代）
   🔒 口径出处：2号招人器 §3.4 F4 五池（唯一权威）：
     - ZE-01 五池流转只前进一格或流失；面试多轮池内 rounds+1；跳池拒
     - 闸⑦ 查重三条：候选人表内 phone 重复→拦截（姓+*、前三后二）；
       与在职员工重复→拦截；与离职员工重复→放行+黄条（曾于{年月}在职，原因{枚举}）
     - 流失必选枚举：硬淘汰(ZE-02)→rejected；可回头(ZE-03)且发生在
       约面/面试/Offer→自动入 reserve（简历池流失不入池）
     - 停滞三色阈值 = getCoef('zhaoren.funnelStallDays')（按池 [黄,橙,红]）
     - Z-D1 / T23：候选人转 hired → Employee 建档回链；darkTriad 明细编码与
       joltType 立即销毁——仅保留 dark_triad_score 数值供 F12 匿名统计
   云端增量（v5.1）：招聘者角色权限；姓名脱敏按角色（非本人建档显姓+*）；
     「待推进」按红>橙>黄排序；source_channel 改写 reserve_pool（ZE-04 系统自动打）
   - 🔒 判定一律调 domain 纯函数（dedupPhone / maskName / maskPhone / hireCandidate），禁止重算
   - 时钟注入（公约 C-14）：零真实时钟调用；业务日期一律 ctx.today
   - 写路径唯一：writes.put / writes.patch（表行 + 事件双写）
   ============================================================ */
import { dedupPhone, maskName, hireCandidate as hireCandidatePure } from '../domain/zhaoren.mjs';
import { getCoef, diffDays } from '../domain/shared.mjs';
import { put, patch } from './writes.mjs';

/* ZE-01 漏斗顺序（reserve / rejected 为流出态，不在前进链上） */
export const POOL_ORDER = ['resume', 'interview_invite', 'interview', 'offer', 'hired'];
/* ZE-02 硬淘汰 / ZE-03 可回头（枚举逐字照件二） */
export const DROP_HARD = new Set(['resume_mismatch', 'interview_failed', 'background_mismatch', 'quit_job_hunting']);
export const DROP_SOFT = new Set(['offer_rejected_salary', 'offer_rejected_other', 'interview_noshow', 'timing_mismatch', 'salary_gap']);
const SOFT_RESERVE_FROM = new Set(['interview_invite', 'interview', 'offer']);   // 约面/面试/Offer 流失才入蓄水池

async function getCand(db, ctx, candId) {
  const { rows } = await db.query(
    `select * from candidates where tenant_id = $1 and id = $2 and deleted_at is null`,
    [ctx.tenantId, candId]);
  if (!rows.length) throw new Error(`候选人 ${candId} 不存在`);
  return rows[0];
}

/**
 * 建档：写入前跑闸⑦查重三条（🔒 domain.dedupPhone 三态，禁止重算）。
 *   规则一 候选人表内 phone 重复 → 拒（报错含脱敏 姓+* / 前三后二）
 *   规则二 与在职 salesperson 重复 → 拒
 *   规则三 与离职 salesperson 重复 → 放行 + warn（曾于{年月}在职，原因{枚举}）
 * createdDate：可选回填实体 createdDate（缺省走 DB now()）——市价 180 天窗取数列。
 */
export async function createCandidate(db, ctx, {
  id, name, phone, positionName = null, expectedSalaryAmt = null,
  sourceChannel, recruiterName = null, createdDate = null,
}) {
  const { rows: cands } = await db.query(
    `select name, phone from candidates where tenant_id = $1 and phone = $2 and deleted_at is null`,
    [ctx.tenantId, phone]);
  const { rows: emps } = await db.query(
    `select phone, is_active, leave_date::text as leave_date, leave_reason
       from salespersons where tenant_id = $1 and phone = $2 and deleted_at is null`,
    [ctx.tenantId, phone]);
  const verdict = dedupPhone(phone, {
    candidates: cands,
    employees: emps.map(e => ({ phone: e.phone, isActive: e.is_active, leaveDate: e.leave_date, leaveReason: e.leave_reason })),
  });
  if (verdict.verdict === 'block') {
    throw new Error(`查重拦截（闸⑦${verdict.reason === 'candidate' ? '规则一·候选人表内重复' : '规则二·与在职员工重复'}）：${verdict.tip}`);
  }
  const row = {
    id, name, phone, position_name: positionName, expected_salary_amt: expectedSalaryAmt,
    source_channel: sourceChannel, pool: 'resume', pool_entered_date: ctx.today,
    recruiter_name: recruiterName,
  };
  if (createdDate) row.created_at = createdDate;
  await put(db, ctx, 'candidates', row, 'candidate_created');
  return { id, pool: 'resume', warn: verdict.warn ? verdict.tip : null };
}

/**
 * 五池流转：只前进一格（ZE-01 顺序校验，跳池/回退一律拒）或流失（传 dropReason）。
 *   - 硬淘汰(ZE-02) → rejected
 *   - 可回头(ZE-03) 且发生在约面/面试/Offer → 自动入 reserve，
 *     source_channel 改写 reserve_pool（ZE-04 🔴 系统自动打）；简历池流失不入池 → rejected
 *   - 转 hired 无此路径：唯一入口 hireCandidate（Z-D1 明细销毁必经）
 */
export async function movePool(db, ctx, { candId, to = null, dropReason = null }) {
  const cand = await getCand(db, ctx, candId);
  const from = cand.pool;
  if (dropReason != null) {                                     // —— 流失分支 ——
    if (!POOL_ORDER.slice(0, 4).includes(from)) throw new Error(`当前池 ${from} 非漏斗在途池，不可登记流失`);
    let toPool;
    if (DROP_HARD.has(dropReason)) toPool = 'rejected';
    else if (DROP_SOFT.has(dropReason)) toPool = SOFT_RESERVE_FROM.has(from) ? 'reserve' : 'rejected';
    else throw new Error(`流失原因必须为 ZE-02/ZE-03 枚举（收到 ${dropReason}）`);
    const changes = { pool: toPool, drop_reason: dropReason, pool_entered_date: ctx.today };
    if (toPool === 'reserve') changes.source_channel = 'reserve_pool';
    await patch(db, ctx, 'candidates', 'id', candId, changes, 'candidate_dropped');
    return { candId, from, to: toPool, dropReason, autoReserve: toPool === 'reserve' };
  }
  const fromIdx = POOL_ORDER.indexOf(from);                     // —— 前进分支 ——
  if (fromIdx < 0 || from === 'hired') throw new Error(`当前池 ${from} 不可前进`);
  const toIdx = POOL_ORDER.indexOf(to);
  if (toIdx !== fromIdx + 1) throw new Error(`ZE-01 顺序校验：${from} → ${to} 非前进一格，拒绝（五池只前进一格或流失）`);
  if (to === 'hired') throw new Error('转 hired 走 hireCandidate（Employee 建档回链 + Z-D1 明细销毁），movePool 无此路径');
  await patch(db, ctx, 'candidates', 'id', candId,
    { pool: to, pool_entered_date: ctx.today }, 'candidate_pool_moved');
  return { candId, from, to };
}

/* F11 保留的七个评分维（darkTriad 明细类键一律销毁；dark_triad_score 数值列不动） */
const SCORE_DIMS = ['achievement', 'cognitive', 'integrity', 'situational', 'charisma', 'experience', 'adaptive'];

/**
 * 转 hired（T23 / Z-D1）：仅 offer 池可入。
 *   ① salespersons 建档（🔒 domain.hireCandidate 白名单重建，回链 sourceChannel）
 *   ② interview_score_packs 明细销毁：jolt_type → null，scores 只留七维——
 *      仅保留 dark_triad_score 数值供 F12 匿名统计
 *   ③ candidates 回链：pool=hired / employee_id
 *   ④ hire_batches member_ids 回填（无批次行则建）
 * form = { stamp, name, phone, hireDate, hiringCostAmt, startBaseSalaryAmt,
 *          batchId, mentorManagerName, cityTier? }（2号件二 Employee 弹窗必填）
 */
export async function hireCandidate(db, ctx, { candId, form }) {
  const cand = await getCand(db, ctx, candId);
  if (cand.pool !== 'offer') throw new Error(`ZE-01：只有 offer 池可转 hired（当前 ${cand.pool}）`);
  const { rows: packs } = await db.query(
    `select * from interview_score_packs where tenant_id = $1 and cand_id = $2 and deleted_at is null
      order by created_at desc limit 1`, [ctx.tenantId, candId]);
  const pack = packs[0] ?? null;
  // 🔒 domain 纯函数：Z-D1 明细销毁 = 白名单重建（darkTriadDetail / joltType 无拷贝路径）
  const pure = hireCandidatePure(
    { sourceChannel: cand.source_channel },
    pack ? { packId: pack.id, candId, scores: pack.scores, darkTriadScore: pack.dark_triad_score, scoredDate: pack.scored_date } : {},
    form);
  const emp = pure.employee;
  await put(db, ctx, 'salespersons', {
    id: emp.spId, name: emp.name, phone: emp.phone ?? null,
    hire_date: emp.hireDate, hiring_cost_amt: emp.hiringCostAmt ?? null,
    base_salary_amt: emp.baseSalaryAmt ?? null, hire_batch_id: emp.hireBatchId ?? null,
    manager_id: emp.managerId ?? null, source_channel: emp.sourceChannel ?? null,
    city_tier: emp.cityTier ?? null, level: 'sales', is_active: true,
  }, 'salesperson_created');
  if (pack) {
    const kept = {};
    for (const d of SCORE_DIMS) if (pure.scorePackAfter.scores?.[d] != null) kept[d] = pure.scorePackAfter.scores[d];
    await patch(db, ctx, 'interview_score_packs', 'id', pack.id,
      { scores: kept, jolt_type: null }, 'score_pack_sealed');
  }
  await patch(db, ctx, 'candidates', 'id', candId, {
    pool: 'hired', pool_entered_date: form.hireDate ?? ctx.today,
    employee_id: emp.spId, score_pack_id: pack ? pack.id : (cand.score_pack_id ?? null),
  }, 'candidate_hired');
  if (emp.hireBatchId) {
    const { rows: b } = await db.query(
      `select member_ids from hire_batches where tenant_id = $1 and id = $2 and deleted_at is null`,
      [ctx.tenantId, emp.hireBatchId]);
    if (b.length) {
      const ids = Array.isArray(b[0].member_ids) ? b[0].member_ids : JSON.parse(b[0].member_ids || '[]');
      if (!ids.includes(emp.spId)) {
        await patch(db, ctx, 'hire_batches', 'id', emp.hireBatchId,
          { member_ids: [...ids, emp.spId] }, 'hire_batch_member_added');
      }
    } else {
      await put(db, ctx, 'hire_batches',
        { id: emp.hireBatchId, label: emp.hireBatchId, member_ids: [emp.spId] }, 'hire_batch_created');
    }
  }
  return { candId, employeeId: emp.spId, packSealed: !!pack };
}

/* ---------- 停滞三色（funnelStallDays 按池 [黄,橙,红]，超红线仍红） ---------- */
const STALL_KEY = { resume: 'resume', interview_invite: 'invite', interview: 'interview', offer: 'offer' };
export function stallLightOf(pool, days, gc = getCoef) {
  const th = gc('zhaoren.funnelStallDays')[STALL_KEY[pool]];
  if (!th || days == null) return null;
  const [y, o, r] = th;
  return days >= r ? 'red' : days >= o ? 'orange' : days >= y ? 'yellow' : 'green';
}

/* 姓名脱敏按角色（v5.1 M3 云端增量）：招聘者视角，非本人建档 → 姓+*（🔒 domain.maskName） */
const displayName = (row, ctx) =>
  (ctx.role === 'recruiter' && row.recruiter_name !== (ctx.recruiterName ?? null))
    ? maskName(row.name) : row.name;

/** 在途四池逐人停滞灯（days = 入池日 → ctx.today） */
export async function stallLights(db, ctx, { gc = getCoef } = {}) {
  const { rows } = await db.query(
    `select id, name, pool, pool_entered_date::text as entered, recruiter_name
       from candidates
      where tenant_id = $1 and pool in ('resume','interview_invite','interview','offer')
        and deleted_at is null`, [ctx.tenantId]);
  return rows.map(r => {
    const days = r.entered ? diffDays(r.entered.slice(0, 10), ctx.today) : null;
    return {
      candId: r.id, name: displayName(r, ctx), pool: r.pool,
      recruiterName: r.recruiter_name, stallDays: days,
      light: days == null ? null : stallLightOf(r.pool, days, gc),
    };
  });
}

/** 「待推进」：仅停滞者，红>橙>黄，同灯按停滞天数降序（v5.1 M3 云端增量） */
const LIGHT_RANK = { red: 0, orange: 1, yellow: 2 };
export async function pendingList(db, ctx, opts = {}) {
  const all = await stallLights(db, ctx, opts);
  return all
    .filter(x => LIGHT_RANK[x.light] != null)
    .sort((a, b) => (LIGHT_RANK[a.light] - LIGHT_RANK[b.light]) || (b.stallDays - a.stallDays));
}
