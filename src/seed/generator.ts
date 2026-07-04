/**
 * 种子生成器：按月度流量配额把 90 天事件流「演」出来。
 * 产物只有三类事件：建档 / 状态流转（含流失原因）/ 成交单（首购随流转、复购独立）。
 * 任何汇总数字都不落库——由 fold.ts 对事件流实时折算（铁律 2）。
 * 生成末尾内置漏斗守恒断言：新增 − 转出 − 流失 ≠ 存量 即抛错拒绝启动（铁律：跑不平拒绝启动）。
 */
import type { Customer, LossReason, SeedData, SeedEvent, Stage } from '../domain/types';
import { ALLOWED_TRANSITIONS, LOSS_REASONS } from '../domain/types';
import {
  ANCHOR_DATE, BOUNTY, CATEGORIES, CONTACT_SURNAMES, CONTACT_TITLES, DEAL_MATRIX, DEPARTMENTS,
  JUNE_LOSS_REASONS, LEAD_MATRIX, LIQIANG_HIRE, LOSS_PLAN, MONTHS, NAME_DISTRICTS, NAME_PREFIXES,
  NAME_SUFFIXES, OPEN_DATE, PEOPLE, REPEAT_MATRIX, REVENUE_MATRIX, RNG_SEED, SEED_VERSION,
  TARGETS, TENANT, TRANSITION_PLAN, WANGWU_LAST_ACTIVE,
} from './plan';
import { mulberry32, pickWeighted, randInt, type Rng } from './rng';
import { foldEvents } from './fold';

interface LiveCustomer {
  id: string;
  ownerId: string;
  stage: Stage;
  /** 当前阶段进入日（绝对日序 1..90） */
  stageDay: number;
  createdDay: number;
  dealDay: number | null;
  repeatCount: number;
}

interface OrderSlot {
  ownerId: string;
  mi: number;
  event: SeedEvent; // amount 待二次填充
}

const SCRIPTED_OWNERS = new Set(['wangwu', 'liqiang']);

function dayAbs(mi: number, day: number): number {
  let base = 0;
  for (let i = 0; i < mi; i++) base += MONTHS[i].calendarDays;
  return base + day;
}
function dateOf(mi: number, day: number): string {
  return `${MONTHS[mi].ym}-${String(day).padStart(2, '0')}`;
}
function miDayOfAbs(abs: number): [number, number] {
  let rest = abs;
  for (let mi = 0; mi < MONTHS.length; mi++) {
    if (rest <= MONTHS[mi].calendarDays) return [mi, rest];
    rest -= MONTHS[mi].calendarDays;
  }
  throw new Error(`绝对日序越界: ${abs}`);
}

export function generateSeed(): SeedData {
  const rng = mulberry32(RNG_SEED);
  const customers: Customer[] = [];
  const events: SeedEvent[] = [];
  const live = new Map<string, LiveCustomer>();
  const orderSlots: OrderSlot[] = [];
  let custSeq = 0;
  let emitSeq = 0;

  const wangwuLastAbs = dayAbs(1, 13); // 2026-05-13
  const liqiangHireAbs = dayAbs(1, 23); // 2026-05-23

  // ---- 素材 ----
  const usedNames = new Set<string>();
  const usedPhones = new Set<string>();
  function makeName(): string {
    for (let i = 0; i < 50; i++) {
      const n =
        NAME_DISTRICTS[randInt(rng, 0, NAME_DISTRICTS.length - 1)] +
        NAME_PREFIXES[randInt(rng, 0, NAME_PREFIXES.length - 1)] +
        NAME_SUFFIXES[randInt(rng, 0, NAME_SUFFIXES.length - 1)];
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
    const n = `客户${custSeq + 1}号商行`;
    usedNames.add(n);
    return n;
  }
  function makePhone(): string {
    // 手机号硬钥匙，全局唯一
    const p = `13${String(800000000 + custSeq * 1237)}`;
    if (usedPhones.has(p)) throw new Error('手机号硬钥匙冲突');
    usedPhones.add(p);
    return p;
  }

  function emit(e: Omit<SeedEvent, 'id' | 'seq' | 'time'>): SeedEvent {
    const ev: SeedEvent = { ...e, id: `e${++emitSeq}`, seq: emitSeq, time: '09:00' };
    events.push(ev);
    return ev;
  }

  // ---- 建档 ----
  function createCustomer(ownerId: string, mi: number, day: number): LiveCustomer {
    custSeq++;
    const id = `c${String(custSeq).padStart(4, '0')}`;
    const cust: Customer = {
      id,
      name: makeName(),
      phone: makePhone(),
      contact:
        CONTACT_SURNAMES[randInt(rng, 0, CONTACT_SURNAMES.length - 1)] +
        CONTACT_TITLES[randInt(rng, 0, CONTACT_TITLES.length - 1)],
      ownerId,
      level: (['A', 'B', 'C', 'C', 'C', 'B', 'D'] as const)[randInt(rng, 0, 6)],
    };
    customers.push(cust);
    const lc: LiveCustomer = {
      id, ownerId, stage: 'lead', stageDay: dayAbs(mi, day), createdDay: dayAbs(mi, day),
      dealDay: null, repeatCount: 0,
    };
    live.set(id, lc);
    emit({ date: dateOf(mi, day), type: 'customer_created', customerId: id, ownerId });
    return lc;
  }

  /** 建档日窗口：王五 4 月 1-28 / 5 月 1-12；李强 5 月 23-31 / 6 月 8-27；
   * 其余 4/5 月早段偏置；6 月建档后移（P8：存量线索入池贴近现实，早段仅留当月转出所需） */
  function createDay(ownerId: string, mi: number): number {
    const last = MONTHS[mi].lastEventDay;
    if (ownerId === 'wangwu') return mi === 0 ? randInt(rng, 1, 28) : randInt(rng, 1, 12);
    if (ownerId === 'liqiang') return mi === 1 ? randInt(rng, 23, 31) : randInt(rng, 8, Math.min(27, last));
    if (mi === 2) {
      const r = rng();
      if (r < 0.06) return randInt(rng, 1, 6);
      if (r < 0.21) return randInt(rng, 7, 14);
      return randInt(rng, 15, 27);
    }
    // 早段偏置（留出同月后续流转空间）
    const cap = Math.max(3, last - 3);
    return 1 + Math.floor(Math.pow(rng(), 1.3) * cap);
  }

  /**
   * 喂池流转的当月落日上限：4 月漏斗链最挤（样品进 105 出 97），
   * 按 意向≤20 / 样品≤24 / 签约≤28 阶梯排期，保证同月链式转出有时间窗；
   * 其余月份统一月末前 2 天。成交/流失可用整月。
   */
  function feedCapDay(mi: number, to: Stage): number {
    const last = MONTHS[mi].lastEventDay;
    if (to === 'deal' || to === 'lost') return last;
    if (mi === 0) return to === 'intent' ? 20 : to === 'sample' ? 24 : 28;
    return last - 2;
  }

  /** 流转日：晚于当前阶段进入日、不超过阶梯上限；偏向紧随其后。
   * P8：6 月签约/样品入池日程后移（FIFO 幸存者＝晚入池 → 期末停留天数收敛） */
  function transitionDay(c: LiveCustomer, mi: number, to: Stage): number | null {
    const last = feedCapDay(mi, to);
    const monthStartAbs = dayAbs(mi, 1);
    const minAbs = Math.max(c.stageDay + 1, monthStartAbs);
    const maxAbs = dayAbs(mi, last);
    if (minAbs > maxAbs) return null;
    if (mi === 2 && (to === 'signed' || to === 'sample')) {
      const minDay = Math.max(1, minAbs - dayAbs(2, 0));
      let day: number;
      if (to === 'signed') {
        const r = rng();
        day = r < 0.16 ? randInt(rng, 12, 14) : r < 0.34 ? randInt(rng, 15, 18) : r < 0.6 ? randInt(rng, 19, 22) : randInt(rng, 23, last);
      } else {
        const r = rng();
        day = r < 0.25 ? randInt(rng, 2, 9) : randInt(rng, 10, last);
      }
      if (day < minDay) {
        if (minDay > last) return null;
        day = randInt(rng, minDay, last);
      }
      return day;
    }
    const span = maxAbs - minAbs;
    const abs = minAbs + Math.floor(Math.pow(rng(), 1.6) * (span + 1) * 0.999);
    return miDayOfAbs(abs)[1];
  }

  function doTransition(c: LiveCustomer, to: Stage, mi: number, lossReason?: () => LossReason): boolean {
    if (!ALLOWED_TRANSITIONS[c.stage].includes(to)) throw new Error(`非法流转 ${c.stage}→${to}`);
    const day = transitionDay(c, mi, to);
    if (day == null) return false;
    const from = c.stage;
    emit({
      date: dateOf(mi, day), type: 'stage_changed', customerId: c.id, ownerId: c.ownerId,
      from, to, ...(to === 'lost' ? { lossReason: lossReason!() } : {}),
    });
    c.stage = to;
    c.stageDay = dayAbs(mi, day);
    if (to === 'deal') {
      c.dealDay = c.stageDay;
      // 转成交回款必填（R1-05）：成交单随流转同日落单，金额二次闭合填充
      const slot = emit({
        date: dateOf(mi, day), type: 'order_created', customerId: c.id, ownerId: c.ownerId,
        amount: 0, categoryCode: CATEGORIES[randInt(rng, 0, CATEGORIES.length - 1)].code, isRepeat: false,
      });
      orderSlots.push({ ownerId: c.ownerId, mi, event: slot });
    }
    return true;
  }

  // ---- 配额簿 ----
  const transQuota = TRANSITION_PLAN.map((t) => ({ ...t, remaining: [...t.byMonth] as number[] }));
  const lossQuota = LOSS_PLAN.map((l) => ({ ...l, remaining: [...l.byMonth] as number[] }));
  const dealQuota: Record<string, number[]> = Object.fromEntries(
    Object.entries(DEAL_MATRIX).map(([k, v]) => [k, [...v]]),
  );
  const juneLossBag: LossReason[] = [];
  for (const [reason, n] of JUNE_LOSS_REASONS) for (let i = 0; i < n; i++) juneLossBag.push(reason);

  function takeQuota(from: Stage, to: Stage, mi: number, n = 1) {
    const q = transQuota.find((t) => t.from === from && t.to === to)!;
    if (q.remaining[mi] < n) throw new Error(`配额不足 ${from}→${to} @${MONTHS[mi].ym}`);
    q.remaining[mi] -= n;
  }

  function pickLossReason(mi: number): LossReason {
    if (mi === 2) {
      const i = randInt(rng, 0, juneLossBag.length - 1);
      return juneLossBag.splice(i, 1)[0];
    }
    return LOSS_REASONS[randInt(rng, 0, LOSS_REASONS.length - 1)];
  }

  /** owner 抽取权重（人设塑形） */
  function ownerWeight(ownerId: string, from: Stage, to: Stage, mi: number): number {
    let w = 1;
    if (to === 'sample') {
      if (ownerId === 'zhaomin') w = mi === 0 ? 0.3 : 5; // 赵敏样品集中在 5/6 月（进多出少）
      if (ownerId === 'wangli') w = mi === 0 ? 3 : 1;
    }
    if (from === 'sample' && to !== 'lost') {
      if (ownerId === 'wangli') w = 6; // 销冠通过率最高
      if (ownerId === 'zhaomin') w = 0.16; // 量大质弱（通过率≈9%）
    }
    if (to === 'signed') {
      // 向签约池喂给后续有成交配额的 owner
      const need = (dealQuota[ownerId] ?? [0, 0, 0]).slice(mi).reduce((a, b) => a + b, 0);
      w *= 1 + 0.35 * need;
    }
    return w;
  }

  function eligible(c: LiveCustomer, from: Stage, mi: number, to: Stage): boolean {
    if (c.stage !== from) return false;
    if (SCRIPTED_OWNERS.has(c.ownerId)) return false; // 王五/李强全剧本化
    if (c.stageDay >= dayAbs(mi, feedCapDay(mi, to))) return false;
    if (to === 'deal' && (dealQuota[c.ownerId] ?? [0, 0, 0])[mi] <= 0) return false;
    return true;
  }

  /** P8 FIFO：先按 owner 权重选人（保留人物塑形），组内取最老客户（老客户优先转出） */
  function runTransition(from: Stage, to: Stage, mi: number, count: number) {
    for (let k = 0; k < count; k++) {
      const byOwner = new Map<string, LiveCustomer[]>();
      for (const c of live.values()) {
        if (!eligible(c, from, mi, to)) continue;
        if (!byOwner.has(c.ownerId)) byOwner.set(c.ownerId, []);
        byOwner.get(c.ownerId)!.push(c);
      }
      for (const list of byOwner.values()) list.sort((a, b) => a.stageDay - b.stageDay);
      let done = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const entries = [...byOwner.entries()].filter(([, list]) => list.length > 0);
        if (entries.length === 0) break;
        const weights = entries.map(
          ([o, list]) => ownerWeight(o, from, to, mi) * list.length * (to === 'deal' ? dealQuota[o][mi] : 1),
        );
        const idx = pickWeighted(rng, weights);
        const [, list] = entries[idx < 0 ? 0 : idx];
        const c = list[0];
        if (doTransition(c, to, mi)) {
          if (to === 'deal') dealQuota[c.ownerId][mi]--;
          takeQuota(from, to, mi, 1);
          done = true;
          break;
        }
        list.shift(); // 排期失败的最老候选移出，试次老
      }
      if (!done) throw new Error(`无可用客户 ${from}→${to} @${MONTHS[mi].ym}（第${k + 1}/${count}笔）`);
    }
  }

  function runLoss(pool: Stage, mi: number, count: number) {
    for (let k = 0; k < count; k++) {
      const cands: LiveCustomer[] = [];
      for (const c of live.values()) if (eligible(c, pool, mi, 'lost')) cands.push(c);
      // P8 强 FIFO：几乎严格最老客户先流失（留下的存量更「新」，停滞形态收敛）
      cands.sort((a, b) => a.stageDay - b.stageDay);
      let done = false;
      for (let attempt = 0; attempt < 40 && cands.length > 0; attempt++) {
        const i = Math.floor(Math.pow(rng(), 3) * Math.min(cands.length, 4));
        const c = cands[i];
        if (doTransition(c, 'lost', mi, () => pickLossReason(mi))) {
          const q = lossQuota.find((l) => l.pool === pool)!;
          q.remaining[mi]--;
          done = true;
          break;
        }
        cands.splice(i, 1);
      }
      if (!done) throw new Error(`无可流失客户 ${pool} @${MONTHS[mi].ym}`);
    }
  }

  // ---- 王五剧本（4 月/5 月上旬，末次事件 5-13；此后 47 天零业务事件）----
  // P8 残留形态设计：期末余 6 条线索（5 月建档 → 48-59 天，濒死）＋ 11 条意向
  // （4-20 起入池 → 47-70 天，预警带 [45,75)，不越 75 天濒死线）——「有火可救」而非满屏红。
  function scriptWangwu(mi: number) {
    const mine = () => [...live.values()].filter((c) => c.ownerId === 'wangwu');
    const capDay = (c: LiveCustomer, maxAbs: number, minAbsFloor?: number): number | null => {
      const minAbs = Math.max(c.stageDay + 1, minAbsFloor ?? 0);
      if (minAbs > maxAbs) return null;
      return randInt(rng, minAbs, maxAbs);
    };
    const doOn = (c: LiveCustomer, to: Stage, maxAbs: number, reason?: LossReason, minAbsFloor?: number) => {
      const abs = capDay(c, maxAbs, minAbsFloor);
      if (abs == null) throw new Error('王五剧本排期失败');
      const [m, d] = miDayOfAbs(abs);
      emit({
        date: dateOf(m, d), type: 'stage_changed', customerId: c.id, ownerId: 'wangwu',
        from: c.stage, to, ...(to === 'lost' ? { lossReason: reason } : {}),
      });
      c.stage = to;
      c.stageDay = abs;
    };
    if (mi === 0) {
      const maxAbs = dayAbs(0, 30);
      const intentFloor = dayAbs(0, 20); // 意向入池 ≥ 4-20：期末 ≤70 天，稳落预警带
      const leads = mine().filter((c) => c.stage === 'lead').sort((a, b) => a.stageDay - b.stageDay);
      for (let i = 0; i < 8; i++) { doOn(leads[i], 'intent', maxAbs, undefined, intentFloor); takeQuota('lead', 'intent', 0); }
      const leads2 = mine().filter((c) => c.stage === 'lead').sort((a, b) => a.stageDay - b.stageDay);
      for (let i = 0; i < 4; i++) {
        doOn(leads2[i], 'lost', maxAbs, pickLossReason(0));
        lossQuota.find((l) => l.pool === 'lead')!.remaining[0]--;
      }
      const intents = mine().filter((c) => c.stage === 'intent');
      for (let i = 0; i < 2; i++) {
        doOn(intents[i], 'lost', maxAbs, pickLossReason(0));
        lossQuota.find((l) => l.pool === 'intent')!.remaining[0]--;
      }
    }
    if (mi === 1) {
      const maxAbs = wangwuLastAbs; // 一切事件 ≤ 5-13
      const leads = mine().filter((c) => c.stage === 'lead' && c.stageDay < maxAbs).sort((a, b) => a.stageDay - b.stageDay);
      for (let i = 0; i < 7; i++) { doOn(leads[i], 'intent', maxAbs); takeQuota('lead', 'intent', 1); }
      const leads2 = mine().filter((c) => c.stage === 'lead' && c.stageDay < maxAbs).sort((a, b) => a.stageDay - b.stageDay);
      for (let i = 0; i < 4; i++) {
        doOn(leads2[i], 'lost', maxAbs, pickLossReason(1));
        lossQuota.find((l) => l.pool === 'lead')!.remaining[1]--;
      }
      const intents = mine().filter((c) => c.stage === 'intent' && c.stageDay < maxAbs).sort((a, b) => a.stageDay - b.stageDay);
      for (let i = 0; i < 2; i++) {
        doOn(intents[i], 'lost', maxAbs, pickLossReason(1));
        lossQuota.find((l) => l.pool === 'intent')!.remaining[1]--;
      }
      // 末次业务事件强制落在 5-13：由此起算「连续 47 天零业务事件」（含 6-29 当天）
      const lastLc = mine()
        .filter((c) => c.stage === 'lead' && c.stageDay < maxAbs)
        .sort((a, b) => a.stageDay - b.stageDay)[0];
      const [lm, ld] = miDayOfAbs(maxAbs);
      emit({
        date: dateOf(lm, ld), type: 'stage_changed', customerId: lastLc.id, ownerId: 'wangwu',
        from: 'lead', to: 'lost', lossReason: pickLossReason(1),
      });
      lastLc.stage = 'lost';
      lastLc.stageDay = maxAbs;
      lossQuota.find((l) => l.pool === 'lead')!.remaining[1]--;
    }
  }

  // ---- 李强剧本（6 月：6 转意向、2 直签约→成交、2 直成交，共 4 单） ----
  function scriptLiqiang() {
    const mi = 2;
    const mine = () => [...live.values()].filter((c) => c.ownerId === 'liqiang');
    const leads = mine().filter((c) => c.stage === 'lead').sort((a, b) => a.stageDay - b.stageDay);
    let cursor = 0;
    for (let i = 0; i < 6; i++) {
      const c = leads[cursor++];
      const day = randInt(rng, Math.max(1, c.stageDay - dayAbs(2, 0) + 1), 28);
      emit({ date: dateOf(2, day), type: 'stage_changed', customerId: c.id, ownerId: 'liqiang', from: 'lead', to: 'intent' });
      c.stage = 'intent'; c.stageDay = dayAbs(2, day);
      takeQuota('lead', 'intent', 2);
    }
    // 2 × 线索→签约未回款→成交
    for (let i = 0; i < 2; i++) {
      const c = leads[cursor++];
      const startDay = Math.max(2, c.stageDay - dayAbs(2, 0) + 1);
      const qDay = randInt(rng, Math.min(startDay, 24), 24);
      emit({ date: dateOf(2, qDay), type: 'stage_changed', customerId: c.id, ownerId: 'liqiang', from: 'lead', to: 'signed' });
      c.stage = 'signed'; c.stageDay = dayAbs(2, qDay);
      takeQuota('lead', 'signed', 2);
      const dDay = randInt(rng, qDay + 1, 29);
      emit({ date: dateOf(2, dDay), type: 'stage_changed', customerId: c.id, ownerId: 'liqiang', from: 'signed', to: 'deal' });
      c.stage = 'deal'; c.stageDay = dayAbs(2, dDay); c.dealDay = c.stageDay;
      const slot = emit({
        date: dateOf(2, dDay), type: 'order_created', customerId: c.id, ownerId: 'liqiang',
        amount: 0, categoryCode: CATEGORIES[randInt(rng, 0, 2)].code, isRepeat: false,
      });
      orderSlots.push({ ownerId: 'liqiang', mi, event: slot });
      takeQuota('signed', 'deal', 2);
      dealQuota['liqiang'][2]--;
    }
    // 2 × 直成交
    for (let i = 0; i < 2; i++) {
      const c = leads[cursor++];
      const dDay = randInt(rng, Math.max(3, c.stageDay - dayAbs(2, 0) + 1), 29);
      emit({ date: dateOf(2, dDay), type: 'stage_changed', customerId: c.id, ownerId: 'liqiang', from: 'lead', to: 'deal' });
      c.stage = 'deal'; c.stageDay = dayAbs(2, dDay); c.dealDay = c.stageDay;
      const slot = emit({
        date: dateOf(2, dDay), type: 'order_created', customerId: c.id, ownerId: 'liqiang',
        amount: 0, categoryCode: CATEGORIES[randInt(rng, 0, 2)].code, isRepeat: false,
      });
      orderSlots.push({ ownerId: 'liqiang', mi, event: slot });
      takeQuota('lead', 'deal', 2);
      dealQuota['liqiang'][2]--;
    }
  }

  // ---- 复购（不产状态事件，只落成交单） ----
  const repeatCustomersByOwner = new Map<string, LiveCustomer[]>();
  function runRepeats(mi: number) {
    for (const [ownerId, spec] of Object.entries(REPEAT_MATRIX)) {
      const n = spec.byMonth[mi];
      const isLastMonthWithRepeat = spec.byMonth.slice(mi + 1).every((x) => x === 0);
      for (let k = 0; k < n; k++) {
        const isFinalSlot = isLastMonthWithRepeat && k === n - 1;
        const prior = repeatCustomersByOwner.get(ownerId) ?? [];
        let target: LiveCustomer | undefined;
        if (spec.reuseLast && isFinalSlot && prior.length > 0) {
          target = prior[0]; // 复用既有复购客户 → 27 家去重闭合
        } else {
          const cands = [...live.values()].filter(
            (c) => c.ownerId === ownerId && c.stage === 'deal' && c.dealDay != null &&
              c.repeatCount === 0 && c.dealDay + 4 <= dayAbs(mi, MONTHS[mi].lastEventDay),
          ).sort((a, b) => a.dealDay! - b.dealDay!);
          if (cands.length === 0) throw new Error(`复购无候选 ${ownerId} @${MONTHS[mi].ym}`);
          target = cands[Math.floor(Math.pow(rng(), 2) * Math.min(3, cands.length))];
          prior.push(target);
          repeatCustomersByOwner.set(ownerId, prior);
        }
        const minAbs = Math.max(target.dealDay! + 4, dayAbs(mi, 1));
        const abs = randInt(rng, Math.min(minAbs, dayAbs(mi, MONTHS[mi].lastEventDay)), dayAbs(mi, MONTHS[mi].lastEventDay));
        const [m, d] = miDayOfAbs(abs);
        target.repeatCount++;
        const slot = emit({
          date: dateOf(m, d), type: 'order_created', customerId: target.id, ownerId,
          amount: 0, categoryCode: CATEGORIES[randInt(rng, 0, 2)].code, isRepeat: true,
        });
        orderSlots.push({ ownerId, mi, event: slot });
      }
    }
  }

  // ================= 月循环 =================
  for (let mi = 0; mi < MONTHS.length; mi++) {
    // 1. 建档
    for (const [ownerId, byMonth] of Object.entries(LEAD_MATRIX)) {
      for (let k = 0; k < byMonth[mi]; k++) createCustomer(ownerId, mi, createDay(ownerId, mi));
    }
    // 2. 剧本
    if (mi <= 1) scriptWangwu(mi);
    if (mi === 2) scriptLiqiang();
    // 3. 一般流转（按喂池顺序）
    // sample→deal 受 owner 成交配额约束，须先于 sample→signed 抽取，避免样品池被抽干后无候选
    const order: [Stage, Stage][] = [
      ['lead', 'intent'],
      ['intent', 'sample'], ['lead', 'sample'],
      ['sample', 'deal'],
      ['sample', 'signed'], ['intent', 'signed'], ['lead', 'signed'],
      ['signed', 'deal'], ['intent', 'deal'], ['lead', 'deal'],
    ];
    for (const [from, to] of order) {
      const q = transQuota.find((t) => t.from === from && t.to === to)!;
      runTransition(from, to, mi, q.remaining[mi]);
    }
    // 4. 流失
    for (const l of lossQuota) runLoss(l.pool, mi, l.remaining[mi]);
    // 5. 复购
    runRepeats(mi);
  }

  // 配额清零校验
  for (const q of transQuota) if (q.remaining.some((x) => x !== 0)) throw new Error(`流转配额未清零 ${q.from}→${q.to}: ${q.remaining}`);
  for (const q of lossQuota) if (q.remaining.some((x) => x !== 0)) throw new Error(`流失配额未清零 ${q.pool}: ${q.remaining}`);
  for (const [o, arr] of Object.entries(dealQuota)) if (arr.some((x) => x !== 0)) throw new Error(`成交配额未清零 ${o}: ${arr}`);
  if (juneLossBag.length !== 0) throw new Error('6 月流失原因袋未耗尽');

  // ================= 金额二次闭合填充 =================
  // 每 owner×月 的单笔金额伪随机拆分，桶内合计精确等于 REVENUE_MATRIX（事件仅存单笔）
  for (const [ownerId, revByMonth] of Object.entries(REVENUE_MATRIX)) {
    for (let mi = 0; mi < 3; mi++) {
      const slots = orderSlots.filter((s) => s.ownerId === ownerId && s.mi === mi);
      const target = revByMonth[mi];
      if (target === 0 && slots.length === 0) continue;
      if (target === 0 || slots.length === 0) throw new Error(`回款桶不匹配 ${ownerId} @${MONTHS[mi].ym}: ¥${target} / ${slots.length} 单`);
      const weights = slots.map(() => 0.55 + rng() * 0.9);
      const wSum = weights.reduce((a, b) => a + b, 0);
      let allocated = 0;
      slots.forEach((s, i) => {
        if (i === slots.length - 1) {
          s.event.amount = target - allocated;
        } else {
          let amt = Math.round((target * weights[i]) / wSum / 10) * 10;
          amt = Math.max(1500, Math.min(19800, amt));
          s.event.amount = amt;
          allocated += amt;
        }
      });
      const lastAmt = slots[slots.length - 1].event.amount!;
      if (lastAmt < 800 || lastAmt > 19800) {
        // 尾单越界：向桶内其余单摊回差额（保持合计不变）
        const fix = lastAmt < 800 ? 800 : 19800;
        let diff = lastAmt - fix; // 需要摊出去的量（可正可负）
        slots[slots.length - 1].event.amount = fix;
        for (let i = 0; i < slots.length - 1 && diff !== 0; i++) {
          const cur = slots[i].event.amount!;
          const room = diff > 0 ? 19800 - cur : 1500 - cur; // 可加/可减空间
          const delta = diff > 0 ? Math.min(diff, Math.floor(room / 10) * 10) : Math.max(diff, Math.ceil(room / 10) * 10);
          slots[i].event.amount = cur + delta;
          diff -= delta;
        }
        if (diff !== 0) throw new Error(`回款桶无法闭合 ${ownerId} @${MONTHS[mi].ym}`);
      }
      const sum = slots.reduce((a, s) => a + s.event.amount!, 0);
      if (sum !== target) throw new Error(`回款桶合计不符 ${ownerId} @${MONTHS[mi].ym}: ${sum} ≠ ${target}`);
    }
  }
  for (const s of orderSlots) if (!s.event.amount || s.event.amount <= 0) throw new Error('存在零额成交单（转成交回款必填 R1-05）');

  // ================= 排序 + 时间戳 =================
  events.sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1));
  const dayCounter = new Map<string, number>();
  events.forEach((e, i) => {
    e.seq = i + 1;
    const k = dayCounter.get(e.date) ?? 0;
    dayCounter.set(e.date, k + 1);
    const minutes = 9 * 60 + ((k * 7) % 540);
    e.time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });

  // ================= 漏斗守恒断言（跑不平拒绝启动） =================
  const folded = foldEvents(events, PEOPLE, CATEGORIES, ANCHOR_DATE, OPEN_DATE);
  for (const pool of ['lead', 'intent', 'sample', 'signed'] as const) {
    const f = folded.poolFlow[pool];
    const balance = f.entered - f.exited - f.lost;
    if (balance !== folded.stocks[pool]) {
      throw new Error(`漏斗守恒断言失败 [${pool}]：新增${f.entered} − 转出${f.exited} − 流失${f.lost} ＝ ${balance} ≠ 存量${folded.stocks[pool]}`);
    }
  }
  if (folded.poolFlow.deal.entered !== folded.stocks.deal) throw new Error('成交池守恒失败');
  if (folded.poolFlow.lostTotal !== folded.stocks.lost) throw new Error('流失池守恒失败');

  const yesterday = '2026-06-28';
  const foldedYesterday = foldEvents(
    events.filter((e) => e.date <= yesterday), PEOPLE, CATEGORIES, yesterday, OPEN_DATE,
  );

  return {
    version: SEED_VERSION,
    generatedAt: new Date().toISOString(),
    anchorDate: ANCHOR_DATE,
    openDate: OPEN_DATE,
    tenant: TENANT,
    departments: DEPARTMENTS,
    people: PEOPLE,
    customers,
    events,
    categories: CATEGORIES,
    targets: TARGETS,
    bounty: BOUNTY,
    yesterdaySnapshot: {
      date: yesterday,
      stocks: foldedYesterday.stocks,
      monthRevenue: foldedYesterday.monthRevenue,
      cumRevenue: foldedYesterday.cumRevenue,
      perOwnerRevenue: Object.fromEntries(
        Object.entries(foldedYesterday.perOwner).map(([k, v]) => [k, v.revenue]),
      ),
      perOwnerStocks: Object.fromEntries(
        Object.entries(foldedYesterday.perOwner).map(([k, v]) => [k, v.stocks]),
      ),
    },
  };
}
