/* ============================================================
   C2 · 确定性演示种子（v5.1 §12 C2 行）
   - export async seedTenant(db, tenantId, actorId, today)：db = PGlite 实例
   - 🔴 每笔业务写入 = event_stream append + 表行插入【双写】
     （event type 如 'deal_created' / 'daily_report_submitted'，payload 含完整行数据·小驼峰）
     —— 这是 "任一汇总数可由事件流复算" 的物理基础（domain/replay.mjs fold 消费同一批事件）
   - 确定性：mulberry32(42)；today 显式传参；本模块零真实时钟调用（公约 C-14 时钟注入）
   - 规模：1 租户 / 10 销售 + 1 主管 + 1 新人（赵一…陈十人物）/ 近 7 月业务流水 / 日报 30 天
   ============================================================ */
import { addDays } from '../domain/shared.mjs';

/* ---------- 确定性随机（种子 42，逐次调用序列固定） ---------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 纯字符串日期/月份工具（零真实时钟调用） ---------- */
const pad2 = n => String(n).padStart(2, '0');
function monthShift(ym, k) {                      // 'YYYY-MM' + k 月
  let [y, m] = ym.split('-').map(Number);
  m += k;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${pad2(m)}`;
}
const dayOf = (ym, d) => `${ym}-${pad2(d)}`;

/* ---------- 主入口 ---------- */
export async function seedTenant(db, tenantId, actorId, today) {
  const rng = mulberry32(42);
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // 闭区间
  let seq = 0;
  const uid = prefix => `${prefix}_${1721180000000 + (++seq)}_${pad2(int(10, 99))}${pad2(int(10, 99))}`;

  const stats = {};
  const bump = k => { stats[k] = (stats[k] || 0) + 1; };

  /* 双写核心：表行插入 + event_stream append（payload = 完整行数据·小驼峰） */
  async function insertRow(table, row) {
    const cols = Object.keys(row);
    const sql = `insert into ${table}(${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`;
    await db.query(sql, cols.map(k => {
      const v = row[k];
      return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
    }));
  }
  async function emit(type, targetId, payload) {
    await db.query(
      `insert into event_stream(tenant_id, type, actor_id, target_id, payload) values ($1,$2,$3,$4,$5)`,
      [tenantId, type, actorId, targetId, JSON.stringify(payload)]);
  }
  async function put(table, evType, row, payload) {
    await insertRow(table, { tenant_id: tenantId, created_by: actorId, updated_by: actorId, ...row });
    await emit(evType, row.id || row.board || row.path || null, payload);
    bump(table);
  }

  const thisMonth = today.slice(0, 7);
  const months = [-6, -5, -4, -3, -2, -1, 0].map(k => monthShift(thisMonth, k)); // 近 7 月（含当月）

  /* ========== 1) 人员：10 销售 + 1 主管 + 1 新人（公约 Salesperson 最小字段集） ========== */
  const mgrId = uid('sp');
  const manager = {
    id: mgrId, name: '蒋带队', phone: '13800000000', cityTier: 'tier1', level: 'manager',
    positionType: 'pure_sales', hireDate: dayOf(monthShift(thisMonth, -30), 5), leaveDate: null, leaveReason: null,
    managerId: null, hireBatchId: null, sourceChannel: 'referral',
    baseSalaryAmt: 1000000, hiringCostAmt: 1500000, isActive: true,
  };
  const salesNames = ['赵一', '钱二', '孙三', '李四', '周五', '吴六', '郑七', '王八', '冯九', '陈十'];
  const salespersons = [manager];
  for (let i = 0; i < salesNames.length; i++) {
    salespersons.push({
      id: uid('sp'), name: salesNames[i], phone: `1390000${pad2(i)}00`, cityTier: 'tier1', level: 'sales',
      positionType: 'pure_sales',
      hireDate: dayOf(monthShift(thisMonth, -(24 - i)), int(1, 28)), leaveDate: null, leaveReason: null,
      managerId: mgrId, hireBatchId: null, sourceChannel: i % 3 === 0 ? 'referral' : 'boss_zhipin',
      baseSalaryAmt: 750000, hiringCostAmt: 1500000, isActive: true,
    });
  }
  /* 新人（入职 21 天，进批次 vintage） */
  const batchId = uid('hb');
  const newbie = {
    id: uid('sp'), name: '沈小新', phone: '13911111100', cityTier: 'tier1', level: 'sales',
    positionType: 'pure_sales', hireDate: addDays(today, -21), leaveDate: null, leaveReason: null,
    managerId: mgrId, hireBatchId: batchId, sourceChannel: 'reserve_pool',
    baseSalaryAmt: 750000, hiringCostAmt: 1500000, isActive: true,
  };
  salespersons.push(newbie);

  for (const p of salespersons) {
    await put('salespersons', 'salesperson_created', {
      id: p.id, name: p.name, phone: p.phone, city_tier: p.cityTier, level: p.level,
      position_type: p.positionType, hire_date: p.hireDate, leave_date: p.leaveDate, leave_reason: p.leaveReason,
      manager_id: p.managerId, hire_batch_id: p.hireBatchId, source_channel: p.sourceChannel,
      base_salary_amt: p.baseSalaryAmt, hiring_cost_amt: p.hiringCostAmt, is_active: p.isActive,
    }, { spId: p.id, ...p });
  }
  const sales10 = salespersons.filter(p => p.level === 'sales' && p.id !== newbie.id);
  const reporters = [...sales10, newbie];                            // 日报填报者 11 人

  await put('hire_batches', 'hire_batch_created',
    { id: batchId, label: monthShift(thisMonth, 0) + '-B1', member_ids: [newbie.id] },
    { batchId, label: monthShift(thisMonth, 0) + '-B1', memberIds: [newbie.id] });

  /* ========== 2) 品类（毛利率快照源；replay 由 category_created 事件累积毛利率） ========== */
  const catDefs = [
    ['软件订阅', 0.60], ['硬件设备', 0.30], ['实施服务', 0.45], ['耗材配件', 0.18],
  ];
  const cats = [];
  for (const [name, rate] of catDefs) {
    const id = uid('cat');
    cats.push({ id, name, rate });
    await put('categories', 'category_created',
      { id, name, gross_margin_rate: rate },
      { categoryId: id, name, grossMarginRate: rate });
  }

  /* ========== 3) 近 7 月 Deal（回款一律「分」，整百元 → 毛利乘积无舍入歧义） ========== */
  for (const ym of months) {
    for (const p of sales10) {
      const n = int(2, 4);
      for (let k = 0; k < n; k++) {
        const cat = pick(cats);
        const won = rng() < 0.9;
        const dealDate = dayOf(ym, int(3, 26));
        const paymentAmt = won ? int(20, 99) * 10000 : 0;           // 2,000–9,900 元（分）
        const row = {
          id: uid('deal'), employee_id: p.id, deal_date: dealDate, entry_date: addDays(dealDate, int(0, 4)),
          payment_amt: paymentAmt, category_id: cat.id,
          lead_source_type: pick(['ad', 'organic', 'referral', 'self_dev']),
          status: won ? 'won' : 'open', paid_date: won ? dealDate : null,
          margin_rate_snapshot: won ? cat.rate : null, note: null,
        };
        await put('deals', 'deal_created', row, {
          dealId: row.id, employeeId: p.id, dealDate, entryDate: row.entry_date, paymentAmt,
          categoryId: cat.id, leadSourceType: row.lead_source_type, status: row.status,
          paidDate: row.paid_date, marginRateSnapshot: row.margin_rate_snapshot,
        });
      }
    }
  }
  /* 新人当月两单小单 */
  for (let k = 0; k < 2; k++) {
    const cat = cats[0];
    const dealDate = addDays(today, -int(1, 10));
    const paymentAmt = int(5, 15) * 10000;
    const row = {
      id: uid('deal'), employee_id: newbie.id, deal_date: dealDate, entry_date: dealDate,
      payment_amt: paymentAmt, category_id: cat.id, lead_source_type: 'ad',
      status: 'won', paid_date: dealDate, margin_rate_snapshot: cat.rate, note: null,
    };
    await put('deals', 'deal_created', row, {
      dealId: row.id, employeeId: newbie.id, dealDate, entryDate: dealDate, paymentAmt,
      categoryId: cat.id, leadSourceType: 'ad', status: 'won', paidDate: dealDate, marginRateSnapshot: cat.rate,
    });
  }

  /* ========== 4) 近 7 月 LeadAssignment（M21 输入；month 键 'YYYY-MM'） ========== */
  for (const ym of months) {
    for (const p of sales10) {
      const row = {
        id: uid('la'), employee_id: p.id, month: ym,
        assigned_leads: int(20, 80), self_dev_leads: int(0, 8), source_type: 'ad',
      };
      await put('lead_assignments', 'lead_assignment_created', row, {
        laId: row.id, employeeId: p.id, month: ym,
        assignedLeads: row.assigned_leads, selfDevLeads: row.self_dev_leads, sourceType: 'ad',
      });
    }
  }
  {
    const row = { id: uid('la'), employee_id: newbie.id, month: thisMonth, assigned_leads: int(10, 20), self_dev_leads: 0, source_type: 'ad' };
    await put('lead_assignments', 'lead_assignment_created', row,
      { laId: row.id, employeeId: newbie.id, month: thisMonth, assignedLeads: row.assigned_leads, selfDevLeads: 0, sourceType: 'ad' });
  }

  /* ========== 5) 近 7 月 发放 / 退款 / 折扣（SE-01 / SE-02 / SE-04 枚举逐字） ========== */
  const payoutTypes = ['instant_bonus', 'reimburse', 'year_end_bonus', 'discretionary', 'mentoring_share', 'dividend'];
  for (const ym of months) {
    for (let k = 0; k < 4; k++) {
      const p = pick(sales10);
      const type = payoutTypes[(months.indexOf(ym) + k) % payoutTypes.length];
      const row = {
        id: uid('po'), employee_id: p.id, payout_date: dayOf(ym, int(5, 28)), type,
        amount_amt: int(5, 50) * 10000,
        timing: type === 'discretionary' ? 'immediate' : null,
        has_condition: type === 'discretionary' ? false : null,
        period_months: type === 'dividend' ? 3 : null, note: null,
      };
      await put('payout_entries', 'payout_created', row, {
        payoutId: row.id, employeeId: p.id, payoutDate: row.payout_date, type,
        amountAmt: row.amount_amt, timing: row.timing, hasCondition: row.has_condition, periodMonths: row.period_months,
      });
    }
    for (let k = 0; k < 2; k++) {
      const p = pick(sales10); const cat = pick(cats);
      const row = { id: uid('rf'), employee_id: p.id, refund_date: dayOf(ym, int(5, 28)), category_id: cat.id, amount_amt: int(5, 30) * 10000, note: null };
      await put('refund_entries', 'refund_created', row,
        { refundId: row.id, employeeId: p.id, refundDate: row.refund_date, categoryId: cat.id, amountAmt: row.amount_amt });
    }
    const reasons = ['competitive_pressure', 'volume_deal', 'period_end_push', 'customer_relationship', 'strategic_entry', 'authorized_promo', 'other'];
    for (let k = 0; k < 5; k++) {
      const p = pick(sales10); const cat = pick(cats);
      const list = int(30, 90) * 10000, cut = int(1, 8) * 10000;
      const row = {
        id: uid('dc'), discount_date: dayOf(ym, int(3, 27)), employee_id: p.id, deal_id: null,
        category_id: cat.id, list_price_amt: list, actual_price_amt: list - cut, discount_amt: cut,
        reason: reasons[(months.indexOf(ym) * 5 + k) % reasons.length],
      };
      await put('discount_entries', 'discount_created', row, {
        discountId: row.id, discountDate: row.discount_date, employeeId: p.id, dealId: null,
        categoryId: cat.id, listPriceAmt: list, actualPriceAmt: list - cut, discountAmt: cut, reason: row.reason,
      });
    }
  }

  /* ========== 6) 经营成本三项（按天摊） ========== */
  for (const [name, kind, amt] of [['办公室房租', 'rent', 3000000], ['市场投放', 'marketing', 2000000], ['行政后勤', 'admin', 800000]]) {
    const row = { id: uid('oc'), name, kind, monthly_amt: amt };
    await put('op_cost_items', 'op_cost_item_created', row, { ocId: row.id, name, kind, monthlyAmt: amt });
  }

  /* ========== 7) 日报 30 天 × 11 人（YE-01 四计数；一键提交） ========== */
  for (let d = 30; d >= 1; d--) {
    const date = addDays(today, -d);
    for (const p of reporters) {
      const leads = int(5, 15);
      const intents = int(0, Math.min(8, leads));
      const row = {
        id: uid('dr'), employee_id: p.id, report_date: date,
        leads, intents, samples: int(0, 4), contracts: int(0, 2), submitted_at: date,
      };
      await put('daily_reports', 'daily_report_submitted', row, {
        drId: row.id, employeeId: p.id, date,
        counts: { leads: row.leads, intents: row.intents, samples: row.samples, contracts: row.contracts },
        submittedAt: date,
      });
    }
  }

  /* ========== 8) 带教任务 + 回执（回执剂量分子只取 confirmed） ========== */
  const stages = ['opening', 'discovery', 'objection', 'closing'];
  for (let k = 0; k < 20; k++) {
    const p = k < 6 ? newbie : pick(sales10);
    const createdDate = addDays(today, -int(3, 40));
    const taskRow = {
      id: uid('ct'), employee_id: p.id, manager_id: mgrId, stage: stages[k % 4],
      manager_reported_at: createdDate, rebound_due: addDays(createdDate, 14),
      rebound_result: k % 5 === 0 ? 'rebound' : null,
    };
    await put('coach_tasks', 'coach_task_created', taskRow, {
      ctId: taskRow.id, employeeId: p.id, managerId: mgrId, stage: taskRow.stage,
      createdAt: createdDate, reboundDue: taskRow.rebound_due, reboundResult: taskRow.rebound_result,
    });
    const ackStatus = k < 16 ? 'confirmed' : (k < 18 ? 'disputed' : 'no_response');
    const ackRow = {
      id: uid('ack'), coach_task_id: taskRow.id, manager_id: mgrId, employee_id: p.id,
      manager_reported_at: createdDate, duration_min: int(30, 90),
      employee_ack_at: ackStatus === 'no_response' ? null : addDays(createdDate, 1),
      employee_ack_status: ackStatus,
    };
    await put('coaching_acks', 'coaching_ack_created', ackRow, {
      ackId: ackRow.id, coachTaskId: taskRow.id, managerId: mgrId, employeeId: p.id,
      managerReportedAt: createdDate, durationMin: ackRow.duration_min,
      employeeAckAt: ackRow.employee_ack_at, employeeAckStatus: ackStatus,
    });
  }

  /* ========== 9) M28 × 2（irrevocable=true；下调在库层无成功路径） ========== */
  const m28s = [
    { master: sales10[0], kind: 'mentoring', rate: 0.05, dur: 12, trig: 'apprentice_ramp_done', base: null },
    { master: sales10[1], kind: 'royalty', rate: 0.02, dur: 24, trig: 'recipe_live', base: 5000000 },
  ];
  for (const m of m28s) {
    const row = {
      id: uid('m28'), master_id: m.master.id, kind: m.kind, rate: m.rate, duration_months: m.dur,
      start_trigger: m.trig, baseline_snapshot_amt: m.base, irrevocable: true,
    };
    await put('m28_agreements', 'm28_signed', row, {
      m28Id: row.id, masterId: m.master.id, kind: m.kind, rate: m.rate, durationMonths: m.dur,
      startTrigger: m.trig, baselineSnapshotAmt: m.base, irrevocable: true,
    });
  }

  /* ========== 10) 前程合约 × 2 ========== */
  for (const p of [sales10[2], sales10[3]]) {
    const lines = [{ metricId: 'norm_rank', cmp: '<=', value: 3, durationMonths: 6 }];
    const row = {
      id: uid('cov'), employee_id: p.id, lines, promise_text: 'expert_track_review',
      both_confirmed: true, irrevocable: true,
    };
    await put('covenants', 'covenant_signed', row, {
      covId: row.id, employeeId: p.id, lines, promiseText: 'expert_track_review', bothConfirmed: true, irrevocable: true,
    });
  }

  /* ========== 11) 候选人 × 4（phone 查重硬钥匙） ========== */
  const candDefs = [
    ['林候甲', 'resume', 'boss_zhipin'], ['何候乙', 'interview', 'referral'],
    ['吕候丙', 'offer', 'liepin'], ['施候丁', 'reserve', 'zhilian'],
  ];
  for (let i = 0; i < candDefs.length; i++) {
    const [name, pool, ch] = candDefs[i];
    const row = {
      id: uid('cand'), name, phone: `1380013${pad2(80 + i)}0`, position_name: '销售顾问',
      expected_salary_amt: int(80, 160) * 10000, source_channel: ch, pool,
      pool_entered_date: addDays(today, -int(3, 60)), interview_rounds: pool === 'interview' ? 1 : 0,
      drop_reason: null, last_touch_date: addDays(today, -int(0, 20)), recruiter_name: '蒋带队',
      score_pack_id: null, employee_id: null,
    };
    await put('candidates', 'candidate_created', row, {
      candId: row.id, name, phone: row.phone, positionName: row.position_name,
      expectedSalaryAmt: row.expected_salary_amt, sourceChannel: ch, pool,
      poolEnteredDate: row.pool_entered_date, interviewRounds: row.interview_rounds,
    });
  }

  /* ========== 12) 新人练习记录（前 14 天 55 次，2号 闸⑪ 口径的合格样本） ========== */
  for (let k = 0; k < 55; k++) {
    const row = {
      id: uid('pl'), employee_id: newbie.id, practice_date: addDays(newbie.hireDate, Math.floor(k / 4)),
      scenario: ['opening', 'discovery', 'objection', 'closing', 'jolt'][k % 5],
      score: int(55, 95), duration_sec: int(120, 420), reviewer: k % 3 === 0 ? 'manager' : 'self',
    };
    await put('practice_logs', 'practice_logged', row, {
      logId: row.id, employeeId: newbie.id, practiceDate: row.practice_date,
      scenario: row.scenario, score: row.score, durationSec: row.duration_sec, reviewer: row.reviewer,
    });
  }

  /* ========== 13) 不可变三件套的种子样本（信用书 / 菜单选择 / 履约总账） ========== */
  {
    const row = {
      id: uid('cvd'), code: `SK-${today.slice(2).replaceAll('-', '')}-A3F9`, candidate_name: '吕候丙',
      scenario_id: null, issued_date: today,
      snapshot: { levelType: 'sales', tierGrade: 'effective', baseSalaryAmt: 750000, thresholdTAmt: 3000000, commissionRate: 0.195 },
    };
    await put('covenant_docs', 'covenant_doc_issued', row,
      { covenantId: row.id, code: row.code, candidateName: row.candidate_name, issuedDate: today, snapshot: row.snapshot });
  }
  {
    const row = {
      id: uid('mc'), salesperson_name: sales10[0].name,
      menu_snapshot: { low: { quotaAmt: 8000000, bonusAmt: 227000 }, mid: { quotaAmt: 10000000, bonusAmt: 300000 }, high: { quotaAmt: 12000000, bonusAmt: 441000 } },
      chosen_tier: 'high', chosen_date: today, irrevocable: true,
    };
    await put('menu_choices', 'menu_choice_locked', row,
      { choiceId: row.id, salespersonName: row.salesperson_name, menuSnapshot: row.menu_snapshot, chosenTier: 'high', chosenDate: today, irrevocable: true });
  }
  const ledgerDefs = [
    { p: sales10[0], category: 'mentoring_share', achieved: addDays(today, -40), honored: addDays(today, -35) },
    { p: sales10[1], category: 'bounty', achieved: addDays(today, -20), honored: addDays(today, -18) },
    { p: sales10[2], category: 'dividend', achieved: addDays(today, -5), honored: null },   // 待兑现（供 honored_at 回填例外验收）
  ];
  for (const L of ledgerDefs) {
    const row = {
      id: uid('lg'), employee_id: L.p.id, category: L.category,
      promise_text: `${L.category} 按约发放`, achieved_at: L.achieved, honored_at: L.honored,
    };
    await put('ledger_entries', 'ledger_entry_appended', row, {
      ledgerId: row.id, employeeId: L.p.id, category: L.category,
      promiseText: row.promise_text, achievedAt: L.achieved, honoredAt: L.honored,
    });
  }

  stats.eventTotal = Number((await db.query(
    `select count(*)::int as n from event_stream where tenant_id = $1`, [tenantId])).rows[0].n);
  return stats;
}
