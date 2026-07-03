/**
 * 业务操作写时守卫（P5）· 唯一事实源＝v1.0 第二部分 §4.3 状态机 ＋ 第三部分 §5 查重 ＋ R1-05/R1-07
 *  - 查重＝写时守卫：比对范围＝本租户全部客户、除「流失」外全部状态（流失手机号释放、允许重新建档）；
 *    撞键即硬拦截，拦截页展示＝按权限脱敏的归属 ＋ 客户状态 ＋ 最后动态时间（§5）
 *  - 状态流转矩阵照抄 §4.3（允许跳级前进、禁止一切后退；成交/流失为终态；跳级不补计中间阶段）
 *  - 转成交回款必填（R1-05）；品类必选（成交单字段 R1-18，驱动品类快照毛利率）；
 *    成交类型系统自动判定（is_repeat：下单当刻该客户此前有无成交单），不可手选
 *  - 转流失必选流失原因枚举（R1-07）
 *  - 本文件只做「校验 ＋ 构造事件」，纯函数、不落库、不改入参——一切汇总仍由事件流实时折算（铁律 2）
 */
import type { Customer, LossReason, SeedData, SeedEvent, Stage } from './types';
import { ALLOWED_TRANSITIONS, LOSS_REASONS, STAGE_LABEL } from './types';

export interface CustomerState {
  stage: Stage;
  enteredDate: string;
  /** 最后动态时间（该客户最近一条事件日，拦截页展示用） */
  lastEventDate: string;
}

/** 由事件流派生单客户当前状态（≤ asOf；无事件＝未建档 → null） */
export function customerStateOf(events: SeedEvent[], customerId: string, asOf: string): CustomerState | null {
  let st: CustomerState | null = null;
  for (const e of events) {
    if (e.customerId !== customerId || e.date > asOf) continue;
    if (e.type === 'customer_created') {
      st = { stage: 'lead', enteredDate: e.date, lastEventDate: e.date };
    } else if (st) {
      if (e.type === 'stage_changed') {
        st.stage = e.to as Stage;
        st.enteredDate = e.date;
      }
      if (e.date > st.lastEventDate) st.lastEventDate = e.date;
    }
  }
  return st;
}

// ---------- 查重（§5 两把硬钥匙之手机号；演示版无 external_userid 通道） ----------

export interface PhoneConflict {
  customer: Customer;
  stage: Stage;
  lastEventDate: string;
}

const PHONE_RE = /^1\d{10}$/;

export function isValidPhone(phone: string): boolean {
  return PHONE_RE.test(phone);
}

/**
 * 写时查重：撞键返回冲突详情（调用方硬拦截并按脱敏展示），未撞键返回 null。
 * 已流失客户的手机号移出查重范围、允许他人重新建档（§5）。
 */
export function findPhoneConflict(data: SeedData, phone: string): PhoneConflict | null {
  for (const c of data.customers) {
    if (c.phone !== phone) continue;
    const st = customerStateOf(data.events, c.id, data.anchorDate);
    if (!st) continue;
    if (st.stage === 'lost') continue; // 流失＝释放回池
    return { customer: c, stage: st.stage, lastEventDate: st.lastEventDate };
  }
  return null;
}

// ---------- 事件构造（校验通过才产事件；失败抛 Error，由 UI 展示） ----------

export interface Clock {
  date: string; // 账务日＝自然日（演示＝anchorDate）
  time: string; // HH:mm
}

function nextSeq(data: SeedData): number {
  let max = 0;
  for (const e of data.events) if (e.seq > max) max = e.seq;
  return max + 1;
}

export interface CreateCustomerInput {
  name: string;
  contact: string;
  phone: string;
  level: Customer['level'];
  ownerId: string;
}

export interface CreateCustomerResult {
  customer: Customer;
  event: SeedEvent;
}

/** 建档＝原子事务：写档案 ＋ 产 customer_created 事件（线索新增计 create_time 当日，R1-05 计数表） */
export function buildCreateCustomer(data: SeedData, input: CreateCustomerInput, clock: Clock): CreateCustomerResult {
  const name = input.name.trim();
  const contact = input.contact.trim();
  const phone = input.phone.trim();
  if (!name) throw new Error('客户名称必填');
  if (!contact) throw new Error('联系人必填（姓名/职务）');
  if (!isValidPhone(phone)) throw new Error('手机号须为 1 开头的 11 位数字（硬钥匙）');
  const conflict = findPhoneConflict(data, phone);
  if (conflict) throw new Error('手机号撞键，禁止重复建档');
  const seq = nextSeq(data);
  const customer: Customer = {
    id: `uc${String(seq).padStart(4, '0')}`,
    name,
    phone,
    contact,
    ownerId: input.ownerId,
    level: input.level,
  };
  const event: SeedEvent = {
    id: `u${seq}`,
    seq,
    date: clock.date,
    time: clock.time,
    type: 'customer_created',
    customerId: customer.id,
    ownerId: input.ownerId,
  };
  return { customer, event };
}

export interface AdvanceOptions {
  /** 转流失必选（R1-07） */
  lossReason?: LossReason;
  /** 转成交必填（R1-05）：回款金额 ＞ 0 */
  amount?: number;
  /** 转成交必选（R1-18）：品类（驱动随单冻结的品类快照毛利率） */
  categoryCode?: string;
}

/**
 * 六态流转（§4.3 矩阵校验）。普通推进产 1 条 stage_changed；
 * 转成交产 stage_changed ＋ order_created 两条（首购单，is_repeat 自动判定）；
 * 转流失要求 lossReason。
 */
export function buildStageChange(
  data: SeedData,
  customerId: string,
  to: Stage,
  clock: Clock,
  opts: AdvanceOptions = {},
): SeedEvent[] {
  const cust = data.customers.find((c) => c.id === customerId);
  if (!cust) throw new Error('客户不存在');
  const st = customerStateOf(data.events, customerId, data.anchorDate);
  if (!st) throw new Error('客户尚未建档');
  const from = st.stage;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`状态机禁止：${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}（§4.3 流转矩阵）`);
  }
  const seq = nextSeq(data);
  const base = {
    date: clock.date,
    time: clock.time,
    customerId,
    ownerId: cust.ownerId,
  };
  if (to === 'lost') {
    if (!opts.lossReason || !LOSS_REASONS.includes(opts.lossReason)) {
      throw new Error('转流失必选流失原因（R1-07 枚举）');
    }
    return [{ ...base, id: `u${seq}`, seq, type: 'stage_changed', from, to, lossReason: opts.lossReason }];
  }
  if (to === 'deal') {
    if (!opts.amount || opts.amount <= 0) throw new Error('转成交回款必填（R1-05），金额须 ＞ 0');
    const cat = data.categories.find((c) => c.code === opts.categoryCode);
    if (!cat) throw new Error('成交单品类必选（R1-18）');
    const isRepeat = hasDeal(data.events, customerId, data.anchorDate);
    return [
      { ...base, id: `u${seq}`, seq, type: 'stage_changed', from, to },
      {
        ...base,
        id: `u${seq + 1}`,
        seq: seq + 1,
        type: 'order_created',
        amount: Math.round(opts.amount),
        categoryCode: cat.code,
        isRepeat,
      },
    ];
  }
  return [{ ...base, id: `u${seq}`, seq, type: 'stage_changed', from, to }];
}

/** 该客户此前是否已有成交单（is_repeat 判定：下单当刻，§4.2 单据级判定） */
export function hasDeal(events: SeedEvent[], customerId: string, asOf: string): boolean {
  return events.some((e) => e.type === 'order_created' && e.customerId === customerId && e.date <= asOf);
}

/** 复购录单（成交态客户：复购走成交单、状态不变，§4.3 矩阵成交行） */
export function buildRepeatOrder(
  data: SeedData,
  customerId: string,
  amount: number,
  categoryCode: string,
  clock: Clock,
): SeedEvent {
  const cust = data.customers.find((c) => c.id === customerId);
  if (!cust) throw new Error('客户不存在');
  const st = customerStateOf(data.events, customerId, data.anchorDate);
  if (st?.stage !== 'deal') throw new Error('仅成交态客户可录复购单（复购走成交单，状态不变）');
  if (!amount || amount <= 0) throw new Error('回款必填（R1-05），金额须 ＞ 0');
  const cat = data.categories.find((c) => c.code === categoryCode);
  if (!cat) throw new Error('成交单品类必选（R1-18）');
  const seq = nextSeq(data);
  return {
    id: `u${seq}`,
    seq,
    date: clock.date,
    time: clock.time,
    type: 'order_created',
    customerId,
    ownerId: cust.ownerId,
    amount: Math.round(amount),
    categoryCode: cat.code,
    isRepeat: true, // 此前必有成交单（成交态由首购单产生）
  };
}
