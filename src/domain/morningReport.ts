/**
 * 早报样卡派生（P5）· 口径来源＝v1.0 §4.7 R1-17（定版→早报点名）＋ 演示施工包（样卡 ≤150 字）
 *  - 一切数字由已定版日（closedDate）的事件流实时折算，样卡文本只做装配（算话分离）
 *  - 点名＝定版时仍未确认的应确认账号（应确认＝当日有单据/活动的账号；休息日不点名、不计分母）
 *  - 正式版文本由 AI 销售操盘手按真实数据每日生成——演示版用固定骨架回填真实数字（回退层同款）
 */
import type { SeedData } from './types';
import { STALL_THRESHOLDS_GENERAL, currentStagesOf, stallLevelOf, type StallPool } from './stallSales';
import { dayDiff } from './calendar';

export interface ConfirmRecordLike {
  date: string;
  ownerId: string;
}

export interface MorningReport {
  closedDate: string; // 已定版的「昨日」
  leadNew: number;
  dealCnt: number; // 首购＋复购单数
  revenue: number;
  lostCnt: number;
  unconfirmed: string[]; // 点名（人名）；休息日恒空
  stallRed: number; // 今晨（新锚点日）红色停滞客户数（全团队）
  text: string; // 样卡文本 ≤150 字
}

export function deriveMorningReport(
  data: SeedData,
  closedDate: string,
  confirms: ConfirmRecordLike[],
  isRestDay: (d: string) => boolean,
): MorningReport {
  let leadNew = 0;
  let dealCnt = 0;
  let revenue = 0;
  let lostCnt = 0;
  const activeOwners = new Set<string>();
  for (const e of data.events) {
    if (e.date !== closedDate) continue;
    activeOwners.add(e.ownerId);
    if (e.type === 'customer_created') leadNew++;
    else if (e.type === 'stage_changed' && e.to === 'lost') lostCnt++;
    else if (e.type === 'order_created') {
      dealCnt++;
      revenue += e.amount ?? 0;
    }
  }

  const confirmed = new Set(confirms.filter((c) => c.date === closedDate).map((c) => c.ownerId));
  const unconfirmed = isRestDay(closedDate)
    ? []
    : data.people
        .filter((p) => p.role === 'sales' && activeOwners.has(p.id) && !confirmed.has(p.id))
        .map((p) => p.name);

  // 今晨红色停滞（新锚点日＝closedDate 次日；受监控四池 ≥2.5 倍阈值）
  const today = data.anchorDate;
  const stages = currentStagesOf(data.events, today);
  let stallRed = 0;
  for (const info of stages.values()) {
    const pool = info.stage as StallPool;
    if (!(pool in STALL_THRESHOLDS_GENERAL)) continue;
    if (stallLevelOf(dayDiff(today, info.enteredDate), STALL_THRESHOLDS_GENERAL[pool]) === 'red') stallRed++;
  }

  const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
  const wan = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : `${v.toLocaleString('zh-CN')}`);
  const naming = unconfirmed.length > 0 ? `未确认点名：${unconfirmed.join('、')}` : '应确认账号全部已确认';
  const text =
    `${md(closedDate)}已定版：团队新增线索 ${leadNew} 家，成交 ${dealCnt} 单、回款 ¥${wan(revenue)}，流失 ${lostCnt} 家；` +
    `${naming}。今晨红色停滞 ${stallRed} 家——先救这批单。`;

  return { closedDate, leadNew, dealCnt, revenue, lostCnt, unconfirmed, stallRed, text };
}
