/**
 * 业务操作层（P5）：建档查重 / 六态流转 / 成交录回款 / 复购单 / 每日确认 / 模拟过一天。
 * 全部为纯函数：入参 SeedData → 返回新 SeedData（事件追加，绝不改写历史事件——
 * R1-10 归属日期永久封存）。展示数字仍由事件流实时折算（铁律 2）。
 * 口径对应：查重两把硬钥匙之手机号（第三部分 §5）、流转矩阵与二次确认（§4.3）、
 * 转成交回款必填 R1-05、流失原因必选 R1-07、确认页 §4.7、定版机制 R1-17。
 */
import type { Customer, LossReason, SeedData, SeedEvent, Stage } from './types';
import { ALLOWED_TRANSITIONS, LOSS_REASONS } from './types';
import { addDays, maskName, maskPhone } from './engine';
import { foldEvents } from '../seed/fold';

/** 归一化：清空格、横杠、+86（第三部分 §5） */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/^\+?86/, '');
}

export interface DupInfo {
  /** 按权限脱敏的归属 ＋ 客户状态 ＋ 最后动态时间（§5 拦截页展示） */
  ownerMasked: string;
  phoneMasked: string;
  stageLabel: string;
  lastActive: string;
  customerName: string;
}

const STAGE_LABEL: Record<Stage, string> = {
  lead: '线索', intent: '意向', sample: '样品', signed: '签约未回款', deal: '成交', lost: '流失',
};

/** 客户当前状态与最后动态（由事件流直读） */
export function currentStageOf(data: SeedData, customerId: string): { stage: Stage; lastDate: string } {
  let stage: Stage = 'lead';
  let lastDate = '';
  for (const e of data.events) {
    if (e.customerId !== customerId) continue;
    if (e.type === 'customer_created') { stage = 'lead'; lastDate = e.date; }
    else if (e.type === 'stage_changed') { stage = e.to as Stage; lastDate = e.date; }
    else if (e.type === 'order_created') { lastDate = e.date; }
  }
  return { stage, lastDate };
}

/**
 * 写时查重（硬钥匙②：任一联系人手机号归一化完全一致 → 硬拦截）。
 * 比对范围＝本租户全部客户、除「流失」外全部状态（已流失手机号移出查重、允许重新建档）。
 */
export function findDuplicate(data: SeedData, phone: string): DupInfo | null {
  const key = normalizePhone(phone);
  for (const c of data.customers) {
    if (normalizePhone(c.phone) !== key) continue;
    const { stage, lastDate } = currentStageOf(data, c.id);
    if (stage === 'lost') continue; // 流失＝释放回池
    const owner = data.people.find((p) => p.id === c.ownerId);
    return {
      ownerMasked: maskName(owner?.name ?? '未知'),
      phoneMasked: maskPhone(c.phone),
      stageLabel: STAGE_LABEL[stage],
      lastActive: lastDate,
      customerName: c.name,
    };
  }
  return null;
}

let opCounter = 0;
function nextEvent(data: SeedData, e: Omit<SeedEvent, 'id' | 'seq' | 'time'>): SeedEvent {
  const seq = (data.events[data.events.length - 1]?.seq ?? 0) + 1;
  opCounter++;
  const minutes = (10 * 60 + (opCounter * 3) % 480) | 0;
  return {
    ...e, id: `u${seq}`, seq,
    time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  };
}

function withMutation(data: SeedData, patch: Partial<SeedData>): SeedData {
  return { ...data, ...patch, mutated: true };
}

export class DuplicateError extends Error {
  dup: DupInfo;
  constructor(dup: DupInfo) {
    super(`重复建档拦截：该手机号已归属 ${dup.ownerMasked}`);
    this.dup = dup;
  }
}

export interface NewCustomerInput {
  name: string;
  phone: string;
  contact: string;
  ownerId: string;
  level: 'A' | 'B' | 'C' | 'D';
}

/** 建档（＋首条联系人，一体）：写时查重硬拦截；成功即产生 customer_created 事件（当日线索新增） */
export function createCustomer(data: SeedData, input: NewCustomerInput): { data: SeedData; customerId: string } {
  if (!input.name.trim()) throw new Error('客户名称必填');
  if (!input.contact.trim()) throw new Error('联系人必填');
  const phone = normalizePhone(input.phone);
  if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确（11 位）');
  const dup = findDuplicate(data, phone);
  if (dup) throw new DuplicateError(dup);
  const id = `c${String(data.customers.length + 1).padStart(4, '0')}u`;
  const customer: Customer = {
    id, name: input.name.trim(), phone, contact: input.contact.trim(),
    ownerId: input.ownerId, level: input.level,
  };
  const ev = nextEvent(data, {
    date: data.anchorDate, type: 'customer_created', customerId: id, ownerId: input.ownerId,
  });
  return {
    data: withMutation(data, { customers: [...data.customers, customer], events: [...data.events, ev] }),
    customerId: id,
  };
}

export interface TransitionInput {
  to: Stage;
  lossReason?: LossReason;
  /** 转成交回款必填（R1-05） */
  amount?: number;
  categoryCode?: string;
}

/** 六态流转（§4.3 矩阵照抄；允许跳级前进，中间不补计；成交必录回款、流失必选原因） */
export function transitionStage(data: SeedData, customerId: string, input: TransitionInput): SeedData {
  const c = data.customers.find((x) => x.id === customerId);
  if (!c) throw new Error('客户不存在');
  const { stage: from } = currentStageOf(data, customerId);
  if (!ALLOWED_TRANSITIONS[from].includes(input.to)) {
    throw new Error(`流转矩阵禁止：${STAGE_LABEL[from]} → ${STAGE_LABEL[input.to]}`);
  }
  const events: SeedEvent[] = [...data.events];
  if (input.to === 'lost') {
    if (!input.lossReason || !LOSS_REASONS.includes(input.lossReason)) {
      throw new Error('流失原因必选（R1-07）');
    }
    events.push(nextEvent({ ...data, events }, {
      date: data.anchorDate, type: 'stage_changed', customerId, ownerId: c.ownerId,
      from, to: 'lost', lossReason: input.lossReason,
    }));
  } else if (input.to === 'deal') {
    if (!input.amount || input.amount <= 0) throw new Error('转成交回款必填（R1-05），不录不允许完成转化');
    if (!input.categoryCode) throw new Error('成交单产品/品类必填（R1-18）');
    events.push(nextEvent({ ...data, events }, {
      date: data.anchorDate, type: 'stage_changed', customerId, ownerId: c.ownerId, from, to: 'deal',
    }));
    events.push(nextEvent({ ...data, events }, {
      date: data.anchorDate, type: 'order_created', customerId, ownerId: c.ownerId,
      amount: input.amount, categoryCode: input.categoryCode, isRepeat: false,
    }));
  } else {
    events.push(nextEvent({ ...data, events }, {
      date: data.anchorDate, type: 'stage_changed', customerId, ownerId: c.ownerId, from, to: input.to,
    }));
  }
  return withMutation(data, { events });
}

/** 复购单（R1-19：已成交客户新增复购单，不产状态事件、不计漏斗指标，全额进经营口径） */
export function addRepeatOrder(data: SeedData, customerId: string, amount: number, categoryCode: string): SeedData {
  const c = data.customers.find((x) => x.id === customerId);
  if (!c) throw new Error('客户不存在');
  const { stage } = currentStageOf(data, customerId);
  if (stage !== 'deal') throw new Error('仅已成交客户可新增复购单');
  if (!amount || amount <= 0) throw new Error('复购回款金额必填');
  const ev = nextEvent(data, {
    date: data.anchorDate, type: 'order_created', customerId, ownerId: c.ownerId,
    amount, categoryCode, isRepeat: true,
  });
  return withMutation(data, { events: [...data.events, ev] });
}

/** 每日确认（§4.7：当日日界前可重复确认；confirm_status per owner per day） */
export function confirmToday(data: SeedData, ownerId: string): SeedData {
  const day = data.anchorDate;
  const confirmations = { ...(data.confirmations ?? {}) };
  const set = new Set(confirmations[day] ?? []);
  set.add(ownerId);
  confirmations[day] = [...set];
  return withMutation(data, { confirmations });
}

/**
 * 「模拟过一天」（演示专属按钮，对应 R1-17 定版机制）：
 * 当日 24:00 自动定版快照（无论是否确认）→ 昨日快照归档 → 模拟时钟 +1 天。
 * 停滞天数随 asOf 自然 +1、早报样卡与环比随新锚点重算——全部由折算层自动发生。
 */
export function simulateDayPass(data: SeedData): SeedData {
  const day = data.anchorDate;
  const folded = foldEvents(data.events.filter((e) => e.date <= day), data.people, data.categories, day, data.openDate);
  return withMutation(data, {
    anchorDate: addDays(day, 1),
    yesterdaySnapshot: {
      date: day,
      stocks: folded.stocks,
      monthRevenue: folded.monthRevenue,
      cumRevenue: folded.cumRevenue,
      perOwnerRevenue: Object.fromEntries(Object.entries(folded.perOwner).map(([k, v]) => [k, v.revenue])),
      perOwnerStocks: Object.fromEntries(Object.entries(folded.perOwner).map(([k, v]) => [k, v.stocks])),
    },
  });
}
