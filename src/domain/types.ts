/**
 * 域类型 · 唯一事实源＝《规格说明 v1.0》第二部分 §4.3 客户漏斗状态机（六态）
 * 状态枚举：线索 → 意向 → 样品 → 签约未回款 → 成交，外加 流失。
 * 允许跳级前进（含线索直接→成交，单列「直成交」）；跳级只产生目标阶段事件，中间不补计。
 */

export type Stage = 'lead' | 'intent' | 'sample' | 'signed' | 'deal' | 'lost';

export const FUNNEL_STAGES: Stage[] = ['lead', 'intent', 'sample', 'signed', 'deal', 'lost'];

export const STAGE_LABEL: Record<Stage, string> = {
  lead: '线索',
  intent: '意向',
  sample: '样品',
  signed: '签约未回款',
  deal: '成交',
  lost: '流失',
};

/** v1.0 §4.3 状态流转矩阵（当前 → 目标，仅列「允许」项）。成交/流失为终态（复购走成交单，状态不变）。 */
export const ALLOWED_TRANSITIONS: Record<Stage, Stage[]> = {
  lead: ['intent', 'sample', 'signed', 'deal', 'lost'],
  intent: ['sample', 'signed', 'deal', 'lost'],
  sample: ['signed', 'deal', 'lost'],
  signed: ['deal', 'lost'],
  deal: [],
  lost: [],
};

/** v1.0 R1-07 流失原因枚举（必选） */
export const LOSS_REASONS = [
  '价格偏高',
  '选择竞品',
  '需求取消',
  '联系不上',
  '服务不满意',
  '客户停业',
  '其他',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export interface Department {
  id: string;
  name: string;
  managerId: string;
}

export interface Person {
  id: string;
  name: string;
  role: 'boss' | 'manager' | 'sales';
  deptId: string | null;
  /** 月固定项（底薪＋社保）月额，¥/月 —— 人力成本逐日累计模型：月固定项日摊＝月额÷当月自然天数 */
  monthlyCost: number;
  /** 入职日（早于开通日者按开通日起算成本）；招培一次性仅入职日≥开通日时计入 */
  hireDate: string | null;
  onboardingCost: number;
}

export interface Category {
  code: string;
  name: string;
  /** 预置品类毛利率（成交单随单冻结口径的演示简化：全局预置） */
  marginRate: number;
}

/** 客户档案仅存身份与归属；一切阶段/汇总状态由事件流实时计算（铁律 2） */
export interface Customer {
  id: string;
  name: string;
  phone: string; // 手机号硬钥匙（建档查重用）
  contact: string;
  ownerId: string;
  level: 'A' | 'B' | 'C' | 'D';
}

export type SeedEventType = 'customer_created' | 'stage_changed' | 'order_created';

export interface SeedEvent {
  id: string;
  seq: number;
  date: string; // YYYY-MM-DD（账务日＝自然日）
  time: string; // HH:mm
  type: SeedEventType;
  customerId: string;
  ownerId: string;
  /** stage_changed */
  from?: Stage;
  to?: Stage;
  lossReason?: LossReason;
  /** order_created（成交单；isRepeat=1 复购单不产状态事件） */
  amount?: number;
  categoryCode?: string;
  isRepeat?: boolean;
}

export interface Targets {
  /** 月度回款目标（¥）：公司/部门/个人 */
  companyMonthlyRevenue: number;
  deptMonthlyRevenue: Record<string, number>;
  personMonthlyRevenue: Record<string, number>;
  /** 单日三过程量目标来源：月度目标÷当月自然天数＝单日目标（目标分解引擎） */
  personMonthlyProcess: Record<string, { lead: number; intent: number; sample: number }>;
}

export interface SeedData {
  version: string;
  generatedAt: string;
  /** 演示模拟时钟「今天」（由 P5「模拟过一天」推进） */
  anchorDate: string;
  /** 租户开通日（人力成本仅计开通日及以后） */
  openDate: string;
  tenant: { name: string; bossName: string };
  departments: Department[];
  people: Person[];
  customers: Customer[];
  events: SeedEvent[];
  categories: Category[];
  targets: Targets;
  /** 悬赏令（静态一条，系统只做录入＋置顶显示） */
  bounty: string;
  /** 昨日定版快照（单份，由事件流在生成时折算而来，非手写汇总） */
  yesterdaySnapshot: YesterdaySnapshot;
}

export interface YesterdaySnapshot {
  date: string;
  stocks: Record<Stage, number>;
  monthRevenue: number;
  cumRevenue: number;
  perOwnerRevenue: Record<string, number>;
  perOwnerStocks: Record<string, Record<Stage, number>>;
}
