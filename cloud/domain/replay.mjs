/* ============================================================
   C2 · 事件流折算器（纯函数）—— "任一汇总数可由事件流复算" 的复算侧
   v5.1 §1.2：事件流 = 不可变追加日志，一切汇总数可由事件流复算（一人三账的物理基础）
   - fold(events)：events = event_stream 行（按 event_id 升序），只读、零副作用、零 IO
   - 毛利口径（公约 §4.5 margin_based）：毛利 = round(回款 × 品类毛利率)，
     品类毛利率从 category_created 事件流内累积（先建品类、后算成交，重放顺序即真相）
   - 本模块零真实时钟调用（公约 C-14）
   ============================================================ */

const payloadOf = ev =>
  typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {});

/**
 * fold(events) → 汇总量（全部可与 SQL 聚合逐项对账）：
 *   dealCount            成交单数（deal_created）
 *   totalPaymentAmt      累计回款（分）
 *   totalGrossMarginAmt  累计毛利（分）= Σ round(paymentAmt × 品类毛利率)，毛利率自 category_created 累积
 *   payoutTotalAmt       系统外发放累计（分，含 reimburse——报销只进成本口径由宪法函数区分，这里是发放流水总额）
 *   refundTotalAmt       退款累计（分）
 *   discountTotalAmt     折扣泄漏累计（分）
 *   dailyReportCount     日报份数
 *   activeHeadcount      在职人数（salesperson_created − salesperson_left）
 *   practiceLogCount     练习记录数
 *   candidateCount       候选人数
 *   m28Count             产权协议数
 *   ledgerHonoredCount   履约总账已兑现笔数（append 时已 honored + 事后 ledger_honored 回填）
 */
export function fold(events) {
  const categoryRate = new Map();          // categoryId → grossMarginRate（category_created 累积）
  const agg = {
    dealCount: 0,
    totalPaymentAmt: 0,
    totalGrossMarginAmt: 0,
    payoutTotalAmt: 0,
    refundTotalAmt: 0,
    discountTotalAmt: 0,
    dailyReportCount: 0,
    activeHeadcount: 0,
    practiceLogCount: 0,
    candidateCount: 0,
    m28Count: 0,
    ledgerHonoredCount: 0,
  };
  for (const ev of events || []) {
    const p = payloadOf(ev);
    switch (ev.type) {
      case 'category_created':
        categoryRate.set(p.categoryId, Number(p.grossMarginRate));
        break;
      case 'deal_created': {
        agg.dealCount += 1;
        const pay = Number(p.paymentAmt) || 0;
        agg.totalPaymentAmt += pay;
        const rate = categoryRate.get(p.categoryId);
        if (rate != null) agg.totalGrossMarginAmt += Math.round(pay * rate);
        break;
      }
      case 'payout_created':
        agg.payoutTotalAmt += Number(p.amountAmt) || 0;
        break;
      case 'refund_created':
        agg.refundTotalAmt += Number(p.amountAmt) || 0;
        break;
      case 'discount_created':
        agg.discountTotalAmt += Number(p.discountAmt) || 0;
        break;
      case 'daily_report_submitted':
        agg.dailyReportCount += 1;
        break;
      case 'salesperson_created':
        if (p.isActive !== false && !p.leaveDate) agg.activeHeadcount += 1;
        break;
      case 'salesperson_left':
        agg.activeHeadcount -= 1;
        break;
      case 'practice_logged':
        agg.practiceLogCount += 1;
        break;
      case 'candidate_created':
        agg.candidateCount += 1;
        break;
      case 'm28_signed':
        agg.m28Count += 1;
        break;
      case 'ledger_entry_appended':
        if (p.honoredAt) agg.ledgerHonoredCount += 1;
        break;
      case 'ledger_honored':                // honored_at 回填（append-only 的唯一例外）
        agg.ledgerHonoredCount += 1;
        break;
      default:
        break;                             // 未知事件静默跳过（向前兼容，公约【7】通用规则②同旨）
    }
  }
  return agg;
}
