/* ============================================================
   C7 · M40–M44 育人节奏台服务（v5.1 §5.2 M40/M41/M42/M43/M44 行 🟢补建）
   🔒 口径出处：5号育人器 v2.3 件三 3.10–3.13（唯一权威）：
     - M40 配对（Sandvik QJE 2020 +15%）：教练池=归一化排名前3 ∩ 闸④资格全过 ∩
       闸③M28已签（🔴 未签 → 席位冻结"待签产权"）；学员池=(20%,80%]；
       排队序=近3月归一化净贡献增幅升序；同对 >3 周 → 第4周强制轮换；session 走 CoachingAck
     - M41 动量：连败/赢率窗（deals 事件流）→ 负动量分 0.6/0.4；触发=连败≥3 或 分≥0.60；
       干预全部 action_card 永不自动（Y-D10）；动量期处方拦加压词（savePrescription momentumMode）
     - M42 深板凳：落后者=归一后1/3；轨迹距离=Σ|月度归一化毛利差|（m21_norms.norm_margin
       月度序列，同司龄段对齐）；匹配空 →"—" 绝不硬凑（Y-D11）
     - M43 分层节奏：完成度=周期回款÷个人配额（配额：手工优先 → 回退定价器版本 T）；
       四区 YE-07；弃赛区子目标=roundTo(剩余工作日×日均×1.1, 百元)——只影响推送节奏，
       不写配额/提成任何字段（Y-D12：本模块零 pace/quota 写路径）
     - M44a 资历忽视：老手(司龄>2年)人均 confirmed 剂量 ÷ 全队人均 <0.5 → 🟡 Y-09
   计算一律调 domain（m40Pairing/pairAllowed/momentum/m42Match/paceZone/subGoalAmt/
     m44aRatio），服务层只组装输入。前置：M40/M42 过 requireM21（排名输入）。
   时钟注入（公约 C-14）：零真实时钟调用；写入一律经 writes 双写。
   ============================================================ */
import {
  m40Pairing, momentum, m42Match, paceZone, subGoalAmt, m44aRatio, rxDiagnose, TALK,
} from '../domain/yuren.mjs';
import { getCoef, safeDiv, addDays, diffDays, monthOf, firstDay, mean } from '../domain/shared.mjs';
import { put, patch } from './writes.mjs';
import { requireM21 } from './m21.mjs';
import { buildDomainDb, latestM21Month, recipeGateFor } from './m12.mjs';
import { planVersionAt } from './m2.mjs';
import { loadShift, isWorkday as m1IsWorkday } from './m1.mjs';

/* ---------- 月份键工具（'YYYY-MM' ± k 月） ---------- */
export function monthAdd(m, k) {
  const [y, mm] = m.split('-').map(Number);
  const t = y * 12 + (mm - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

async function activeSales(db, ctx) {
  const { rows } = await db.query(
    `select id, name, hire_date::text as hd from salespersons
      where tenant_id = $1 and is_active and (level is null or level = 'sales') and deleted_at is null
      order by id`, [ctx.tenantId]);
  return rows;
}

/* ============================================================
   M40 结构化配对：生成写 pair_assignments（旧 active 对 → rotated）+ 事件
   ============================================================ */
export async function runM40Pairing(db, ctx, { weekOf, gc = getCoef }) {
  await requireM21(db, ctx);                            // 教练=归一前3：排名输入过闸①
  const month = await latestM21Month(db, ctx);
  const coef = gc('yuren.m40');
  const sps = await activeSales(db, ctx);
  const { rows: mrows } = await db.query(
    `select sp_id, norm_rank, norm_margin::float8 as nm from m21_norms
      where tenant_id = $1 and month = $2`, [ctx.tenantId, month]);
  const rankBy = new Map(mrows.map(r => [r.sp_id, r.norm_rank]));
  const nmBy = new Map(mrows.map(r => [r.sp_id, r.nm]));
  const { rows: prev3 } = await db.query(
    `select sp_id, norm_margin::float8 as nm from m21_norms
      where tenant_id = $1 and month = $2`, [ctx.tenantId, monthAdd(month, -3)]);
  const nm3By = new Map(prev3.map(r => [r.sp_id, r.nm]));
  /* 近3月归一化净贡献增幅（3月前无数据 → null，排队序末尾——不硬造） */
  const people = sps
    .filter(p => rankBy.has(p.id))
    .map(p => {
      const nm = nmBy.get(p.id), nm0 = nm3By.get(p.id);
      return { spId: p.id, rankNorm: rankBy.get(p.id),
        growth3m: (nm != null && nm0 != null && nm0 !== 0) ? (nm - nm0) / Math.abs(nm0) : null };
    })
    .sort((a, b) => a.rankNorm - b.rankNorm);
  /* 闸④资格（教练候选=前 coachTopN 才需判） */
  const gate4PassIds = [];
  for (const p of people.filter(x => x.rankNorm <= coef.coachTopN)) {
    const r = await recipeGateFor(db, ctx, p.spId, { month, gc });
    if (!r.check.locked && r.check.qualified) gate4PassIds.push(p.spId);
  }
  const { rows: m28 } = await db.query(
    `select distinct master_id from m28_agreements where tenant_id = $1 and deleted_at is null`,
    [ctx.tenantId]);
  const m28SignedIds = m28.map(r => r.master_id);
  /* 上周 active 对 → prevWeeks（连续周数；读在改状态之前） */
  const { rows: act } = await db.query(
    `select id, coach_id, learner_id, consecutive_weeks from pair_assignments
      where tenant_id = $1 and status = 'active' and deleted_at is null and week_of < $2`,
    [ctx.tenantId, weekOf]);
  const prevWeeks = {};
  for (const a of act) prevWeeks[`${a.coach_id}|${a.learner_id}`] = a.consecutive_weeks;

  const res = m40Pairing({ people, gate4PassIds, m28SignedIds, prevWeeks }, coef, gc);

  /* 旧对全部 rotated（本周重新生成；同对延续者以新行承接连续周数） */
  for (const a of act)
    await patch(db, ctx, 'pair_assignments', 'id', a.id, { status: 'rotated' }, 'pair_rotated');

  const ddb = await buildDomainDb(db, ctx);             // 话题卡=学员偏差最大环节（M12 量×质）
  const pairs = [];
  for (const pr of res.pairs) {
    const cw = (prevWeeks[`${pr.coachId}|${pr.learnerId}`] || 0) + 1;
    const diag = rxDiagnose(ddb, pr.learnerId, ctx.today, gc);
    const topicStage = diag && !diag.none ? diag.top.type : null;
    const id = `pair_${weekOf}_${pr.coachId}_${pr.learnerId}`;
    await put(db, ctx, 'pair_assignments',
      { id, week_of: weekOf, coach_id: pr.coachId, learner_id: pr.learnerId,
        topic_stage: topicStage, status: 'active', consecutive_weeks: cw },
      'pair_assigned');
    pairs.push({ id, coachId: pr.coachId, learnerId: pr.learnerId, topicStage, consecutiveWeeks: cw });
  }
  return { weekOf, month, pairs, queued: res.queued, frozenCoachIds: res.frozenCoachIds,
    talk: res.frozenCoachIds.length ? 'Y-05' : null };  // 冻结席位提示（待签产权）
}

/* ============================================================
   M41 动量连败干预：deals 事件流 → 连败数 / 赢率窗（近30 vs 前30）→ domain.momentum
   干预全部 action_card 描述（永不自动执行）；处方端加压词拦截=savePrescription momentumMode
   ============================================================ */
export async function momentumBoard(db, ctx, { gc = getCoef } = {}) {
  const coef = gc('yuren.m41');
  const sps = await activeSales(db, ctx);
  const out = [];
  for (const p of sps) {
    const { rows: closed } = await db.query(
      `select status, deal_date::text as d, payment_amt::bigint as pay from deals
        where tenant_id = $1 and employee_id = $2 and status in ('won','lost') and deleted_at is null
        order by deal_date desc, id desc`, [ctx.tenantId, p.id]);
    let lossStreak = 0;
    for (const dRow of closed) { if (dRow.status === 'lost') lossStreak++; else break; }
    const rateIn = (from, to) => {
      const w = closed.filter(x => x.d >= from && x.d <= to);
      return w.length ? w.filter(x => x.status === 'won').length / w.length : null;
    };
    const curWinRate = rateIn(addDays(ctx.today, -(coef.winRateWindowDays - 1)), ctx.today);
    const prevWinRate = rateIn(addDays(ctx.today, -(2 * coef.winRateWindowDays - 1)),
      addDays(ctx.today, -coef.winRateWindowDays));
    const m = momentum(closed.length ? lossStreak : null, prevWinRate, curWinRate, coef, gc);
    let smallDeals = [];
    if (m.triggered) {                                  // ① 高把握小单处方：≤ aov×0.5 的在库单
      const won90 = closed.filter(x => x.status === 'won' && x.d >= addDays(ctx.today, -90));
      const aov = won90.length ? mean(won90.map(x => Number(x.pay))) : null;
      if (aov != null) {
        const { rows: open } = await db.query(
          `select id, payment_amt::bigint as pay from deals
            where tenant_id = $1 and employee_id = $2 and status = 'open' and deleted_at is null`,
          [ctx.tenantId, p.id]);
        smallDeals = open.filter(o => Number(o.pay) <= aov * coef.smallDealAovX).map(o => o.id);
      }
    }
    out.push({ spId: p.id, lossStreak, prevWinRate, curWinRate, ...m,
      cards: m.triggered ? ['small_deal_rx', 'ride_along_ack', 'plv_momentum_mode'] : [],
      smallDeals, talk: m.triggered ? 'Y-06' : null });
  }
  return out;
}

/* ============================================================
   M42 深板凳榜样匹配：轨迹 = m21_norms 月度 norm_margin（trajMonths=6，同司龄段对齐）
   ============================================================ */
export async function roleModelFor(db, ctx, { spId, gc = getCoef }) {
  await requireM21(db, ctx);
  const month = await latestM21Month(db, ctx);
  const coef = gc('yuren.m42');
  const sps = await activeSales(db, ctx);
  const { rows: cur } = await db.query(
    `select sp_id, norm_rank from m21_norms where tenant_id = $1 and month = $2`, [ctx.tenantId, month]);
  const rankBy = new Map(cur.map(r => [r.sp_id, r.norm_rank]));
  const n = cur.length;
  const rank = rankBy.get(spId);
  const laggard = rank != null && rank > n * (1 - coef.laggardBand);   // 后 1/3
  if (!laggard) return { spId, laggard: false, match: null, display: '—' };

  const months = [];                                    // 近 trajMonths 个月（含当月）
  for (let k = coef.trajMonths - 1; k >= 0; k--) months.push(monthAdd(month, -k));
  const ph = arr => arr.map((_, i) => `$${i + 2}`).join(',');
  const { rows: hist } = await db.query(
    `select sp_id, month, norm_margin::float8 as nm from m21_norms
      where tenant_id = $1 and month in (${ph(months)})`, [ctx.tenantId, ...months]);
  const nmAt = new Map(hist.map(r => [`${r.sp_id}|${r.month}`, r.nm]));
  const lagTraj = months.map(m => nmAt.get(`${spId}|${m}`) ?? null);

  const hireMonthOf = id => { const p = sps.find(x => x.id === id); return p && p.hd ? monthOf(p.hd) : null; };
  const lagHm = hireMonthOf(spId);
  const candidates = [];
  for (const p of sps) {
    if (p.id === spId) continue;
    const r = rankBy.get(p.id);
    const nowBandOk = r != null && r <= Math.ceil(n * (1 - coef.laggardBand));  // 现在 ≥ 中 1/3
    const candHm = hireMonthOf(p.id);
    if (lagHm == null || candHm == null) continue;
    const shift = (Number(candHm.slice(0, 4)) * 12 + Number(candHm.slice(5)))    // 同司龄段对齐：
                - (Number(lagHm.slice(0, 4)) * 12 + Number(lagHm.slice(5)));     // 平移 hire 月差
    const shifted = months.map(m => monthAdd(m, shift));
    const { rows: ch } = await db.query(
      `select month, norm_margin::float8 as nm from m21_norms
        where tenant_id = $1 and sp_id = $2 and month in (${shifted.map((_, i) => `$${i + 3}`).join(',')})`,
      [ctx.tenantId, p.id, ...shifted]);
    const cnm = new Map(ch.map(r => [r.month, r.nm]));
    candidates.push({ spId: p.id, nowBandOk,
      traj: months.map(m => cnm.get(monthAdd(m, shift)) ?? null) });
  }
  const best = m42Match(lagTraj, candidates);           // 空 → null（"—" 绝不硬凑）
  return { spId, laggard: true, lagTraj, match: best,
    display: best ? best.spId : '—', talk: best ? 'Y-07' : null };
}

/* ============================================================
   M43 分层节奏台：completion = 周期回款 ÷ 个人配额（手工优先 → 定价器版本 T）
   ============================================================ */
async function manualQuota(db, ctx, spId) {
  /* 手工配额通道：derived_scalars(scope='person', key='quotaManual') 最新期——
     pace_configs（C2 件二单例形状）只声明 period_type/quota_source，无逐人金额列，
     且 L-3 禁止为云端加业务列；逐人手工值故落"租户级标量表"（与 silentTrackOn 同理） */
  const { rows } = await db.query(
    `select value_num::float8 as v from derived_scalars
      where tenant_id = $1 and scope = 'person' and target_id = $2 and key = 'quotaManual'
      order by period desc, computed_at desc limit 1`, [ctx.tenantId, spId]);
  return rows.length && rows[0].v != null ? Number(rows[0].v) : null;
}

export async function paceBoard(db, ctx, { gc = getCoef } = {}) {
  const { rows: pc } = await db.query(
    `select period_type from pace_configs where tenant_id = $1 and deleted_at is null
      order by created_at desc limit 1`, [ctx.tenantId]);
  const periodType = pc.length ? pc[0].period_type : 'month';
  const cur = monthOf(ctx.today);
  const [y, mm] = cur.split('-').map(Number);
  const qStart = periodType === 'quarter' ? firstDay(y, mm - ((mm - 1) % 3)) : firstDay(y, mm);
  const monthEnd = addDays(firstDay(mm === 12 ? y + 1 : y, mm === 12 ? 1 : mm + 1), -1);
  const plan = await planVersionAt(db, ctx, ctx.today); // 回退：定价器现行版本矩阵 T（月配额口径）
  const fallbackT = plan && plan.matrix_t_amt != null ? Number(plan.matrix_t_amt) : null;
  const shift = await loadShift(db, ctx.tenantId);
  const sps = await activeSales(db, ctx);
  const out = [];
  for (const p of sps) {
    const quota = (await manualQuota(db, ctx, p.id)) ?? fallbackT;   // 手工优先
    const { rows: paid } = await db.query(
      `select coalesce(sum(payment_amt),0)::bigint as amt from deals
        where tenant_id = $1 and employee_id = $2 and status = 'won' and deleted_at is null
          and paid_date >= $3 and paid_date <= $4`, [ctx.tenantId, p.id, qStart, ctx.today]);
    const completion = safeDiv(Number(paid[0].amt), quota);
    const { rows: open } = await db.query(
      `select coalesce(max(payment_amt),0)::bigint as amt from deals
        where tenant_id = $1 and employee_id = $2 and status = 'open' and deleted_at is null`,
      [ctx.tenantId, p.id]);
    const zone = paceZone(completion,
      { inFlightBigDealAmt: Number(open[0].amt) || null, monthQuotaAmt: quota }, null, gc);
    let subGoal = null;
    if (zone === 'quit_risk') {                         // 子目标只影响推送节奏（Y-D12 零写路径）
      let remain = 0;
      for (let d = addDays(ctx.today, 1); d <= monthEnd; d = addDays(d, 1))
        if (m1IsWorkday(shift, p.id, d)) remain++;
      const from90 = addDays(ctx.today, -89);
      const { rows: hist } = await db.query(
        `select coalesce(sum(payment_amt),0)::bigint as amt from deals
          where tenant_id = $1 and employee_id = $2 and status = 'won' and deleted_at is null
            and paid_date >= $3 and paid_date <= $4`, [ctx.tenantId, p.id, from90, ctx.today]);
      let wd90 = 0;
      for (let d = from90; d <= ctx.today; d = addDays(d, 1)) if (m1IsWorkday(shift, p.id, d)) wd90++;
      subGoal = subGoalAmt(remain, safeDiv(Number(hist[0].amt), wd90), null, gc);
    }
    out.push({ spId: p.id, quota, quotaSrc: (await manualQuota(db, ctx, p.id)) != null ? 'manual' : (fallbackT != null ? 'dingjia_T' : null),
      completion, zone, zoneName: zone == null ? '—' : TALK.zoneNames[zone],
      subGoalAmt: subGoal, talk: zone === 'quit_risk' ? 'Y-08' : null });
  }
  return { periodType, rows: out };
}

/* ============================================================
   M44a 资历忽视：老手(司龄>tenureYears=2)人均 confirmed 剂量 ÷ 全队人均（近90天折月）
   ============================================================ */
export async function m44aBoard(db, ctx, { gc = getCoef } = {}) {
  const coef = gc('yuren.m44');
  const sps = await activeSales(db, ctx);
  const from = addDays(ctx.today, -90);
  const dose = async spId => {
    const { rows } = await db.query(
      `select coalesce(sum(duration_min),0)::int as m from coaching_acks
        where tenant_id = $1 and employee_id = $2 and employee_ack_status = 'confirmed'
          and deleted_at is null and manager_reported_at is not null
          and manager_reported_at::date >= $3`, [ctx.tenantId, spId, from]);
    return (rows[0].m / 60) * (30 / 90);                // 时长(h) 折人均月
  };
  const vets = sps.filter(p => p.hd && diffDays(p.hd, ctx.today) > coef.tenureYears * 365);
  const all = await Promise.all(sps.map(p => dose(p.id)));
  const vet = await Promise.all(vets.map(p => dose(p.id)));
  const teamAvg = all.length ? mean(all) : null;
  const vetAvg = vet.length ? mean(vet) : null;
  const ratio = m44aRatio(vetAvg, teamAvg);
  return { veteranCount: vets.length, vetAvgDoseHrs: vetAvg, teamAvgDoseHrs: teamAvg,
    ratio, flagged: ratio != null && ratio < coef.neglectRatioLt,
    talk: ratio != null && ratio < coef.neglectRatioLt ? 'Y-09' : null };
}
