/**
 * 展示脱敏 · 唯一事实源＝v1.0 第三部分 §5 拦截页（按权限脱敏的归属）＋ 指标字典榜单脱敏拍板⑤
 *  - 手机号：保留前 3 后 4，中间 4 位掩码（138****5678）
 *  - 人名：保留姓氏首字，其余掩码（王丽 → 王＊；欧阳锋 → 欧＊＊）
 *  - 纯展示函数，不落库、不参与任何计算
 */

export function maskPhone(phone: string): string {
  if (phone.length < 8) return phone.replace(/./g, '＊');
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function maskName(name: string): string {
  if (name.length <= 1) return name;
  return name[0] + '＊'.repeat(name.length - 1);
}
