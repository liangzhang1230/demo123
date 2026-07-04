/**
 * 种子生成蓝图 · 依据《演示版施工包 · 第二件》仿真租户设计
 *
 * 重要口径说明（铁律 2）：本文件是「事件生成配方」——它规定 90 天里发生哪些事件，
 * 而不是任何展示汇总值。所有看板数字一律由生成出的事件流实时折算（见 fold.ts），
 * seed-check 用折算结果对拍《第二件·3》关键数（82/9/11%/¥6,800/¥61.2万/1.52）。
 *
 * 时间轴：开通日 2026-04-01，演示「今天」＝ 2026-06-29（开通第 90 天，含首尾）。
 * 月序 mi：0＝2026-04（30 天）、1＝2026-05（31 天）、2＝2026-06（事件截至 29 日）。
 */
import type { Stage, LossReason } from '../domain/types';

export const OPEN_DATE = '2026-04-01';
export const ANCHOR_DATE = '2026-06-29';
export const SEED_VERSION = 'p8-huadongxinghui-v2';
export const RNG_SEED = 20260629;

export const MONTHS = [
  { ym: '2026-04', calendarDays: 30, lastEventDay: 30 },
  { ym: '2026-05', calendarDays: 31, lastEventDay: 31 },
  { ym: '2026-06', calendarDays: 30, lastEventDay: 29 },
] as const;

export const TENANT = { name: '华东星辉商贸', bossName: '陈总' };

export const DEPARTMENTS = [
  { id: 'd1', name: '华东一部', managerId: 'liumin' },
  { id: 'd2', name: '华东二部', managerId: 'zhaogang' },
];

/**
 * 人物设定（第二件·2）：
 * 王丽＝销冠（labor_roi 2.1、回款全员第 1、样品→签约通过率最高）
 * 李强＝入职 38 天新人（2026-05-23 入职，单量达标、亏损爬坡）
 * 王五＝连续 47 天零业务事件（末次事件 2026-05-13）、月薪照付（月固定项 ¥8,900）
 * 赵敏＝量大质弱（线索全员第 2、样品→签约≈9%）
 * 月固定项合计（老员工 9 人）¥56,900/月 —— 使团队 labor_roi 折算落在 1.52（2 位小数）
 */
export const PEOPLE = [
  { id: 'chenzong', name: '陈总', role: 'boss' as const, deptId: null, monthlyCost: 0, hireDate: null, onboardingCost: 0 },
  { id: 'liumin', name: '刘敏', role: 'manager' as const, deptId: 'd1', monthlyCost: 6000, hireDate: null, onboardingCost: 0 },
  { id: 'wangli', name: '王丽', role: 'sales' as const, deptId: 'd1', monthlyCost: 8200, hireDate: null, onboardingCost: 0 },
  { id: 'liqiang', name: '李强', role: 'sales' as const, deptId: 'd1', monthlyCost: 5800, hireDate: '2026-05-23', onboardingCost: 3000 },
  { id: 'zhangtao', name: '张涛', role: 'sales' as const, deptId: 'd1', monthlyCost: 5700, hireDate: null, onboardingCost: 0 },
  { id: 'chenjing', name: '陈静', role: 'sales' as const, deptId: 'd1', monthlyCost: 5500, hireDate: null, onboardingCost: 0 },
  { id: 'zhaogang', name: '赵刚', role: 'manager' as const, deptId: 'd2', monthlyCost: 6000, hireDate: null, onboardingCost: 0 },
  { id: 'wangwu', name: '王五', role: 'sales' as const, deptId: 'd2', monthlyCost: 8900, hireDate: null, onboardingCost: 0 },
  { id: 'zhaomin', name: '赵敏', role: 'sales' as const, deptId: 'd2', monthlyCost: 5800, hireDate: null, onboardingCost: 0 },
  { id: 'sunlei', name: '孙磊', role: 'sales' as const, deptId: 'd2', monthlyCost: 5500, hireDate: null, onboardingCost: 0 },
  { id: 'zhoufang', name: '周芳', role: 'sales' as const, deptId: 'd2', monthlyCost: 5300, hireDate: null, onboardingCost: 0 },
];

/** 王五活动窗（末次事件 5-13 → 连续 47 天零业务事件，含 6-29 当天共 47 天）；李强 5-23 入职 */
export const WANGWU_LAST_ACTIVE = '2026-05-13';
export const LIQIANG_HIRE = '2026-05-23';

/**
 * 建档（线索新增）owner × 月 矩阵。列合计 260/230/237，总计 727。
 * 727 ＝ 期末六池存量之和（210+96+73+42+214+92），守恒所требует的建档总量。
 * 张涛线索第 1（112）、赵敏第 2（105）——「量大质弱」人设。
 */
export const LEAD_MATRIX: Record<string, [number, number, number]> = {
  wangli: [32, 28, 28], // 88
  liqiang: [0, 10, 36], // 46
  wangwu: [22, 8, 0], // 30
  liumin: [22, 19, 19], // 60
  zhangtao: [40, 36, 36], // 112
  chenjing: [30, 26, 26], // 82
  zhaogang: [21, 19, 18], // 58
  zhaomin: [38, 34, 33], // 105
  sunlei: [28, 24, 24], // 76
  zhoufang: [27, 26, 17], // 70
};

/**
 * 月度流转配额（逐池守恒解，满足期末存量 210/96/73/42/214/92）：
 * 样品池：进入 105/63/82（本月 82）、前向转出 97/17/9（本月 9 → 11.0%，上月 17/63 → 27.0%）
 */
/**
 * P8 停滞收敛调优：签约池入池后移（intent/lead→signed 向 6 月集中），
 * 配合生成器 FIFO 消耗（老客户优先转出/流失），使期末存量的「入池时间」贴近现实节奏。
 * 各流转对总量与样品池月度进出（82/9、63/17）零改动——关键数与守恒不受影响。
 */
export const TRANSITION_PLAN: { from: Stage; to: Stage; byMonth: [number, number, number] }[] = [
  { from: 'lead', to: 'intent', byMonth: [160, 115, 115] }, // 390
  { from: 'intent', to: 'sample', byMonth: [90, 55, 50] }, // 195
  { from: 'lead', to: 'sample', byMonth: [15, 8, 32] }, // 55
  { from: 'sample', to: 'signed', byMonth: [74, 12, 9] }, // 95（样品池月度转出＝关键数，不动）
  { from: 'intent', to: 'signed', byMonth: [5, 5, 35] }, // 45
  { from: 'lead', to: 'signed', byMonth: [2, 2, 11] }, // 15
  { from: 'signed', to: 'deal', byMonth: [40, 23, 45] }, // 108
  { from: 'sample', to: 'deal', byMonth: [23, 5, 0] }, // 28
  { from: 'intent', to: 'deal', byMonth: [15, 19, 12] }, // 46
  { from: 'lead', to: 'deal', byMonth: [12, 12, 8] }, // 32（直成交单列）
];

/** 各池流失配额（合计 92；6 月合计 42，对应「本月流失 42 家」） */
export const LOSS_PLAN: { pool: Stage; byMonth: [number, number, number] }[] = [
  { pool: 'lead', byMonth: [10, 7, 8] }, // 25
  { pool: 'intent', byMonth: [3, 2, 3] }, // 8
  { pool: 'sample', byMonth: [4, 20, 30] }, // 54
  { pool: 'signed', byMonth: [3, 1, 1] }, // 5
];

/** 6 月流失原因分布（首要流失因＝价格偏高 18 家/42.9%，对齐 v1.0 示例）；4/5 月随机 */
export const JUNE_LOSS_REASONS: [LossReason, number][] = [
  ['价格偏高', 18],
  ['选择竞品', 8],
  ['需求取消', 6],
  ['联系不上', 5],
  ['服务不满意', 3],
  ['客户停业', 2],
];

/**
 * 首购成交单 owner × 月 配额（列合计 90/59/65，总 214）。
 * 王丽 35 单全员第一；李强 4 单全部在 6 月（新人爬坡）；王五 0。
 */
export const DEAL_MATRIX: Record<string, [number, number, number]> = {
  wangli: [14, 9, 12], // 35
  liqiang: [0, 0, 4], // 4
  wangwu: [0, 0, 0],
  liumin: [11, 7, 8], // 26
  zhangtao: [13, 8, 9], // 30
  chenjing: [11, 7, 8], // 26
  zhaogang: [11, 7, 8], // 26
  zhaomin: [10, 7, 7], // 24
  sunlei: [10, 7, 5], // 22
  zhoufang: [10, 7, 4], // 21
};

/**
 * 复购单 owner × 月 配额（列合计 8/12/12，共 32 单）。
 * reuseLast＝该 owner 最后一笔复购落在既有复购客户上 → 复购客户去重后恰 27 家。
 */
export const REPEAT_MATRIX: Record<string, { byMonth: [number, number, number]; reuseLast: boolean }> = {
  wangli: { byMonth: [2, 2, 2], reuseLast: true },
  liumin: { byMonth: [1, 2, 1], reuseLast: true },
  zhangtao: { byMonth: [1, 1, 2], reuseLast: true },
  chenjing: { byMonth: [1, 1, 2], reuseLast: true },
  zhaogang: { byMonth: [1, 1, 2], reuseLast: true },
  zhaomin: { byMonth: [1, 1, 1], reuseLast: false },
  sunlei: { byMonth: [1, 2, 1], reuseLast: false },
  zhoufang: { byMonth: [0, 2, 1], reuseLast: false },
};

/**
 * 回款 owner × 月 目标额（¥）。列合计 465,000 / 378,200 / 612,000（本月 ¥61.2 万），
 * 总计 1,455,200 ＝ 214 × ¥6,800（平均客单闭合）。王丽累计 ¥243,200 → labor_roi 2.10。
 * 单笔金额由生成器在配额内伪随机拆分并精确闭合（事件里只有单笔，不落任何汇总）。
 */
export const REVENUE_MATRIX: Record<string, [number, number, number]> = {
  wangli: [90000, 53200, 100000], // 243,200
  liqiang: [0, 0, 24000], // 24,000
  wangwu: [0, 0, 0],
  liumin: [55000, 48000, 72000], // 175,000
  zhangtao: [60000, 52000, 78000], // 190,000
  chenjing: [53000, 46000, 69000], // 168,000
  zhaogang: [54000, 46000, 70000], // 170,000
  zhaomin: [55000, 48000, 72000], // 175,000
  sunlei: [50000, 44000, 66000], // 160,000
  zhoufang: [48000, 41000, 61000], // 150,000
};

/** 预置品类（毛利率 31%，与「品类成本按预置毛利率 31% 反推自洽」对齐） */
export const CATEGORIES = [
  { code: 'A', name: 'A品类·饮料', marginRate: 0.31 },
  { code: 'B', name: 'B品类·休闲食品', marginRate: 0.31 },
  { code: 'C', name: 'C品类·日化', marginRate: 0.31 },
];

/** 目标（种子预置，演示无目标设置界面）：月度回款目标 ¥55 万 */
export const TARGETS = {
  companyMonthlyRevenue: 550000,
  deptMonthlyRevenue: { d1: 300000, d2: 250000 } as Record<string, number>,
  personMonthlyRevenue: {
    wangli: 80000,
    liqiang: 30000,
    wangwu: 40000,
    liumin: 55000,
    zhangtao: 55000,
    chenjing: 55000,
    zhaogang: 55000,
    zhaomin: 55000,
    sunlei: 55000,
    zhoufang: 55000,
  } as Record<string, number>,
  personMonthlyProcess: Object.fromEntries(
    ['liumin', 'wangli', 'liqiang', 'zhangtao', 'chenjing', 'zhaogang', 'wangwu', 'zhaomin', 'sunlei', 'zhoufang'].map(
      (id) => [id, { lead: 24, intent: 12, sample: 8 }],
    ),
  ) as Record<string, { lead: number; intent: number; sample: number }>,
};

export const BOUNTY = '本周签约破 5 单，周五加鸡腿——陈总';

/** 客户名/联系人素材 */
export const NAME_DISTRICTS = ['浦东', '虹口', '静安', '闵行', '杨浦', '徐汇', '嘉定', '松江', '青浦', '奉贤', '昆山', '太仓', '吴江', '常熟', '江宁', '鼓楼', '萧山', '余杭', '柯桥', '慈溪'];
export const NAME_PREFIXES = ['永辉', '佳惠', '鑫源', '百汇', '天成', '宏达', '润泽', '嘉美', '广盛', '恒信', '三江', '丰泰', '华联', '兴旺', '金穗', '银河', '东盛', '立丰', '九州', '中兴'];
export const NAME_SUFFIXES = ['超市', '便利店', '商行', '食品店', '批发部', '连锁店', '副食店', '烟酒行', '百货', '贸易栈'];
export const CONTACT_SURNAMES = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗', '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹'];
export const CONTACT_TITLES = ['老板', '经理', '店长', '采购'];
