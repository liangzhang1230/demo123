/**
 * 自然日历工具 · 唯一事实源＝v1.0 §2.1 账务日与时区、§6.7 目标分解引擎
 *  - 账务日＝自然日（00:00–24:00）；目标拆解和考核均用自然日
 *  - 演示租户排班固定每周双休（施工包裁剪：点名排班配置砍掉，固定双休）
 */

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** 两个自然日的日差（a − b，整数天） */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

/** 休息日判定（演示固定每周双休：周六/周日）。死线④：休息日待办不点名、不催办；业务照常可录 */
export function isRestDay(date: string): boolean {
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  return wd === 0 || wd === 6;
}
