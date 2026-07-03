/**
 * 管理端决策看板 · 视图模型（P3）。
 * 死线①「看板不产口径」：本文件零计算、零判定、零阈值——只做「取数（domain 引擎）→ 排版装配 → 三级裁剪」。
 * 老板＝全公司全区；主管＝本部门裁剪＋摘除武器坞购买位与系统投入产出参照（看板章 §2）。
 * 未购包一律上锁显 —（货架诚实法则，死线④）：演示租户四包＋智库全部未购。
 */
import type { SeedData } from '../../domain/types';
import {
  convRates, dayDiff, foldEvents, groupLaborRoi, laborCostInMonth, type Folded,
} from '../../domain/engine';
import {
  absRate, fmtWan, gradeOf, isCompleteMonth, momRate, paceRate, rankWithTies, type Grade,
} from '../../domain/metrics';
import { computeStall, type StallResult } from '../../domain/stallBoard';
import { arbitrate, type ArbiterCandidate, type ArbiterResult } from '../../domain/arbiter';

export type BoardScope =
  | { role: 'boss' }
  | { role: 'manager'; deptId: string; managerId: string };

export interface HeartbeatCell {
  label: string;
  /** 展示值（已按显示精度格式化）；锁格＝null */
  value: string | null;
  sub: string;
  /** 环比（完整月才有，§6.5）；null＝不显示 */
  mom: number | null;
  grade: Grade | null;
  locked?: { valueLine: string };
}

export interface TeamRow {
  id: string;
  name: string;
  deptName: string;
  isManager: boolean;
  laborRoi: number | null;
  companyRank: number;
  deptRank: number;
  stall: { red: number; orange: number; yellow: number };
  /** 距末次业务事件天数（读引擎 lastEventDate 派生显示位） */
  idleDays: number | null;
  /** 新人筛选窗（第二部分 §7）：筛选中 · 第 X 天 角标 */
  screeningDay: number | null;
  monthRevenue: number;
  stocks: { lead: number; intent: number; sample: number; signed: number };
}

export interface LockCard {
  key: string;
  name: string;
  tagline: string;
  /** 锁卡三要素②数据就绪徽标——读侧事实陈述，绝不预演结论数字 */
  readyBadge: string;
  /** 人物故事线钩子（第二件·2） */
  hook: string;
}

export interface BoardModel {
  scopeTitle: string;
  viewerName: string;
  isBoss: boolean;
  anchorDate: string;
  openDay: number; // 开通第 N 天
  arbiter: ArbiterResult;
  stall: StallResult;
  heartbeat: HeartbeatCell[];
  team: TeamRow[];
  lockCards: LockCard[] | null; // 主管摘除购买位整排 → null
  screening: { name: string; day: number; windowDays: number; roi: number | null } | null;
  monthYm: string;
  monthRevenue: number;
  monthTarget: number;
  pace: number | null;
}

const SCREEN_WINDOW_DAYS = 90; // 新人筛选转正窗口默认 90 天（§7.2）

export function buildBoardModel(data: SeedData, scope: BoardScope): BoardModel {
  const folded: Folded = foldEvents(data.events, data.people, data.categories, data.anchorDate, data.openDate);
  const anchor = data.anchorDate;
  const ym = anchor.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const elapsed = Number(anchor.slice(8, 10));

  const isBoss = scope.role === 'boss';
  const deptOf = new Map(data.departments.map((d) => [d.id, d]));
  const allMembers = data.people.filter((p) => p.role !== 'boss');
  const members = isBoss ? allMembers : allMembers.filter((p) => p.deptId === scope.deptId);
  const memberIds = members.map((p) => p.id);

  // ---- 停滞（范围裁剪） ----
  const scopedPoolStates = folded.poolStates.filter((s) => memberIds.includes(s.ownerId));
  const stall = computeStall(scopedPoolStates, anchor);

  // ---- 区一 · 今日一件事（演示租户可用信号源：⑦ 停滞红色积压；①–⑥⑧⑨ 无待办/未购 → 不产候选） ----
  const candidates: ArbiterCandidate[] = [];
  if (stall.total.red > 0) {
    const topOwners = Object.entries(stall.perOwner)
      .map(([id, c]) => ({ id, red: c.red }))
      .filter((o) => o.red > 0)
      .sort((a, b) => b.red - a.red)
      .slice(0, 3)
      .map((o) => `${data.people.find((p) => p.id === o.id)?.name ?? o.id} ${o.red} 家`);
    candidates.push({
      slot: 7,
      layer: 'diagnosis',
      title: `停滞红色积压：${stall.total.red} 家客户濒死`,
      detail: `在管 ${stall.managedCnt} 家中 ${stall.total.red} 家红色停滞（${topOwners.join('、')}）——今天先救这批单`,
      href: '#team',
    });
  }
  const arbiter = arbitrate(candidates);

  // ---- 区二 · 经营心跳（固定 6 数） ----
  const monthOf = (id: string, whichYm: string) => folded.perOwnerMonthly[id]?.[whichYm];
  const sumMonth = (whichYm: string, pick: (m: NonNullable<ReturnType<typeof monthOf>>) => number) =>
    memberIds.reduce((a, id) => {
      const mm = monthOf(id, whichYm);
      return a + (mm ? pick(mm) : 0);
    }, 0);
  const monthRevenue = sumMonth(ym, (mm) => mm.revenue);
  const monthGross = sumMonth(ym, (mm) => mm.grossProfit);
  const monthLabor = members.reduce((a, p) => a + laborCostInMonth(p, ym, data.openDate, anchor), 0);
  const monthNet = monthGross - monthLabor;
  const monthFirstDeals = sumMonth(ym, (mm) => mm.firstDeals);
  const monthRepeats = sumMonth(ym, (mm) => mm.repeatOrders);
  const group = groupLaborRoi(folded, memberIds);
  const monthTarget = isBoss
    ? data.targets.companyMonthlyRevenue
    : data.targets.deptMonthlyRevenue[scope.deptId] ?? 0;
  const pace = paceRate(monthRevenue, monthTarget, elapsed, daysInMonth);
  const abs = absRate(monthRevenue, monthTarget);
  const paceGrade = gradeOf(pace);

  // 环比：固定仅完整自然月（§6.5）——锚点当月未结束时不计（显示层隐藏环比、只留白话）
  const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const monthComplete = isCompleteMonth(ym, anchor);
  const revMom = monthComplete ? momRate(sumMonth(prevYm, (mm) => mm.revenue), monthRevenue) : null;
  const prevNet =
    sumMonth(prevYm, (mm) => mm.grossProfit) -
    members.reduce((a, p) => a + laborCostInMonth(p, prevYm, data.openDate, anchor), 0);
  const netMom = monthComplete ? momRate(prevNet, monthNet) : null;

  const cr = convRates(folded.poolFlow);
  void cr; // 转化率供下钻位（本板不展示明细，防区块蔓延）

  // ---- 区四 · 团队一屏 ----
  const monthRevRank = rankWithTies(
    allMembers.map((p) => ({ id: p.id, value: monthOf(p.id, ym)?.revenue ?? 0 })),
  );
  const companyRankOf = new Map(monthRevRank.map((r) => [r.id, r.rank]));
  const deptRankOf = new Map<string, number>();
  for (const d of data.departments) {
    const rs = rankWithTies(
      allMembers.filter((p) => p.deptId === d.id).map((p) => ({ id: p.id, value: monthOf(p.id, ym)?.revenue ?? 0 })),
    );
    for (const r of rs) deptRankOf.set(r.id, r.rank);
  }

  const team: TeamRow[] = members.map((p) => {
    const oa = folded.perOwner[p.id];
    const idle = oa?.lastEventDate ? dayDiff(oa.lastEventDate, anchor) : null;
    const screeningDay =
      p.hireDate && dayDiff(p.hireDate, anchor) + 1 <= SCREEN_WINDOW_DAYS ? dayDiff(p.hireDate, anchor) + 1 : null;
    return {
      id: p.id,
      name: p.name,
      deptName: p.deptId ? deptOf.get(p.deptId)?.name ?? '' : '',
      isManager: p.role === 'manager',
      laborRoi: folded.perOwnerRoi[p.id] ?? null,
      companyRank: companyRankOf.get(p.id) ?? 0,
      deptRank: deptRankOf.get(p.id) ?? 0,
      stall: stall.perOwner[p.id] ?? { red: 0, orange: 0, yellow: 0 },
      idleDays: idle,
      screeningDay,
      monthRevenue: monthOf(p.id, ym)?.revenue ?? 0,
      stocks: {
        lead: oa?.stocks.lead ?? 0,
        intent: oa?.stocks.intent ?? 0,
        sample: oa?.stocks.sample ?? 0,
        signed: oa?.stocks.signed ?? 0,
      },
    };
  });
  // 默认排序＝紧急度分诊（红告警前置；包①既有排序未购，以停滞红/橙计数前置近似，尾序按全员排名）
  team.sort((a, b) => b.stall.red - a.stall.red || b.stall.orange - a.stall.orange || a.companyRank - b.companyRank);

  // ---- 区五 · 武器坞（锁卡三要素：价值主张复用各包一句话定位；数据就绪徽标＝读侧事实陈述） ----
  const openDay = dayDiff(data.openDate, anchor) + 1;
  const lockCards: LockCard[] | null = isBoss
    ? [
        {
          key: 'pkg1',
          name: '操盘包① · 人效操盘包',
          tagline: '这些人值不值、该招该汰该扩——用一根 labor_roi 轴，把招、用、汰、扩四件最贵的事全部翻译成钱。',
          readyBadge: `已沉淀 ${allMembers.length} 名销售 × ${openDay} 天成本与产出数据——开通即出结论`,
          hook: '王五 47 天零业务事件、月薪照付——每月净烧多少钱在漏？李强第几天回本、正常吗？',
        },
        {
          key: 'pkg2',
          name: '操盘包② · 增长操盘包',
          tagline: '下一笔钱在哪、现金什么时候回——卡点算漏钱、金矿唤老客、前瞻排现金。',
          readyBadge: `已沉淀 ${data.customers.length} 家客户全漏斗事件 ${folded.eventCount} 条——开通即出结论`,
          hook: '样品→签约本月 11.0%、上月 27.0%——这一跳卡着多少钱？赵敏这种「差一推的人」推哪里？',
        },
        {
          key: 'pkg3',
          name: '操盘包③ · 销冠 DNA 克隆引擎',
          tagline: '把销冠的成功打法从他脑子里解码成可复制、可带教、留得住的组织资产。',
          readyBadge: `已沉淀 ${folded.totalDealCnt} 笔成交的行为节奏指纹——开通即出结论`,
          hook: '王丽凭什么全员第 1？她走了怎么办？',
        },
        {
          key: 'pkg4',
          name: '操盘包④ · 经营黑匣子',
          tagline: '别的系统只有「现在」，这里给你「来时的路」——每次拍板前后发生了什么，点开就能看。',
          readyBadge: `已沉淀 ${openDay} 天日终轨迹 ＋ 昨日定版快照——开通即出结论`,
          hook: '上月你拍板上调 B 品类价格——那次拍板之后呢？',
        },
        {
          key: 'zhiku',
          name: '经营智库包',
          tagline: '定薪建议＋全套经营分析——每个用人决定都有据可依。',
          readyBadge: `已沉淀 ${openDay} 天经营数据——开通即出分析`,
          hook: '给王丽加薪加多少不亏？给李强定薪定多少合理？',
        },
      ]
    : null;

  // ---- 底部固定条 · 筛人漏斗小块（仅老板；直读既有派生） ----
  const screeningPerson = isBoss
    ? members.find((p) => p.hireDate && dayDiff(p.hireDate, anchor) + 1 <= SCREEN_WINDOW_DAYS)
    : null;
  const screening = screeningPerson
    ? {
        name: screeningPerson.name,
        day: dayDiff(screeningPerson.hireDate!, anchor) + 1,
        windowDays: SCREEN_WINDOW_DAYS,
        roi: folded.perOwnerRoi[screeningPerson.id] ?? null,
      }
    : null;

  const heartbeat: HeartbeatCell[] = [
    {
      label: '本月净利',
      value: fmtWan(monthNet),
      sub: '扣完人力成本，真赚到手的钱',
      mom: netMom,
      grade: null,
    },
    {
      label: '本月回款',
      value: fmtWan(monthRevenue),
      sub: `现金进账 ${fmtWan(monthRevenue)}`,
      mom: revMom,
      grade: null,
    },
    {
      label: isBoss ? '团队 labor_roi' : '本部门 labor_roi',
      value: group.roi == null ? null : group.roi.toFixed(2),
      sub: group.roi == null ? '—（未设成本）' : `每付 1 元工资赚回 ${group.roi.toFixed(2)} 元`,
      mom: null,
      grade: null,
    },
    {
      label: '本月成交',
      value: String(monthFirstDeals + monthRepeats),
      sub: `新客 ${monthFirstDeals} ＋ 复购 ${monthRepeats}`,
      mom: null,
      grade: null,
    },
    {
      label: '目标进度',
      value: pace == null ? null : `${(pace * 100).toFixed(1)}%`,
      sub:
        pace == null
          ? '—（未设目标）'
          : `进度 ${(pace * 100).toFixed(1)}%，${pace >= 1 ? '跑在日历前面' : '落后于日历'}（绝对达标 ${abs == null ? '—' : `${(abs * 100).toFixed(1)}%`}）`,
      mom: null,
      grade: paceGrade,
    },
    {
      label: '30 天现金前瞻',
      value: null,
      sub: '',
      mom: null,
      grade: null,
      locked: { valueLine: '开通增长操盘包，这里预排未来 30 天回款' },
    },
  ];

  return {
    scopeTitle: isBoss ? data.tenant.name : deptOf.get(scope.deptId)?.name ?? '',
    viewerName: isBoss ? data.tenant.bossName : data.people.find((p) => p.id === scope.managerId)?.name ?? '',
    isBoss,
    anchorDate: anchor,
    openDay,
    arbiter,
    stall,
    heartbeat,
    team,
    lockCards,
    screening,
    monthYm: ym,
    monthRevenue,
    monthTarget,
    pace,
  };
}
