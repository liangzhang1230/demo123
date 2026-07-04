/**
 * npm run e2e-check（P5 验收 · 浏览器现场剧本）：真实 Chromium 中
 * 建档 → 查重拦截复现 → 推进到成交（录回款）→ 回看板断言数字联动 → 确认页 → 模拟过一天。
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', N = '\x1b[0m';
let failed = 0;
function t(name: string, pass: boolean, detail?: string) {
  console.log(`  ${pass ? `${G}✓${N}` : `${R}✗${N}`} ${name}${detail ? ` ＝ ${detail}` : ''}`);
  if (!pass) failed++;
}

async function main() {
  const server = await preview({ preview: { port: 4174, strictPort: true } });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const base = 'http://localhost:4174';

  console.log(`${B}── 浏览器现场剧本（375px） ──${N}`);

  // 基线：/boss 月回款
  await page.goto(`${base}/#/boss`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900); // 开屏加载动画＋种子折算
  const bodyBefore = (await page.textContent('body')) ?? '';
  t('基线 /boss 月回款 ¥61.2万', bodyBefore.includes('¥61.2万'));

  // 建档
  await page.goto(`${base}/#/sales/customers/new`);
  await page.waitForSelector('[data-testid=cust-name]');
  await page.fill('[data-testid=cust-name]', '杨浦端到端便利店');
  await page.fill('[data-testid=cust-contact]', '钱老板');
  await page.fill('[data-testid=cust-phone]', '13911112222');
  await page.click('[data-testid=cust-submit]');
  await page.waitForSelector('[data-testid=cust-stage]');
  t('建档成功 → 客户卡状态＝线索', ((await page.textContent('[data-testid=cust-stage]')) ?? '').includes('线索'));
  const custUrl = page.url();

  // 查重拦截
  await page.goto(`${base}/#/sales/customers/new`);
  await page.waitForSelector('[data-testid=cust-name]');
  await page.fill('[data-testid=cust-name]', '重复号测试');
  await page.fill('[data-testid=cust-contact]', '李四');
  await page.fill('[data-testid=cust-phone]', '+86 139-1111-2222');
  await page.click('[data-testid=cust-submit]');
  await page.waitForSelector('[data-testid=dup-block]');
  const dupText = (await page.textContent('[data-testid=dup-block]')) ?? '';
  t('重复建档硬拦截＋脱敏归属', dupText.includes('王*') && dupText.includes('139****2222'), dupText.replace(/\s+/g, ' ').slice(0, 60));

  // 推进：线索→意向→样品→签约→成交（¥8,000）
  await page.goto(custUrl);
  await page.waitForSelector('[data-testid=to-intent]');
  for (const s of ['intent', 'sample', 'signed'] as const) {
    await page.click(`[data-testid=to-${s}]`);
    await page.waitForTimeout(400);
  }
  t('推进到签约未回款', ((await page.textContent('[data-testid=cust-stage]')) ?? '').includes('签约未回款'));
  await page.click('[data-testid=to-deal]');
  await page.fill('[data-testid=deal-amount]', '8000');
  await page.click('[data-testid=deal-confirm]');
  await page.waitForTimeout(700);
  t('成交完成（状态＝成交）', ((await page.textContent('[data-testid=cust-stage]')) ?? '').includes('成交'));

  // 看板联动
  await page.goto(`${base}/#/boss`);
  await page.waitForTimeout(700);
  const bodyAfter = (await page.textContent('body')) ?? '';
  t('联动① 公司月回款 → ¥62.0万', bodyAfter.includes('¥62.0万'));
  t('联动② 本月成交 78 单（新客 66 ＋ 复购 12）', bodyAfter.includes('新客 66'));
  await page.goto(`${base}/#/sales`);
  await page.waitForTimeout(700);
  const salesBody = (await page.textContent('body')) ?? '';
  t('联动③ 王丽本月回款 ¥108,000', salesBody.includes('¥108,000'));
  t('联动④ 今日线索 1（单日过程量）', salesBody.includes('今日线索'));

  // 确认页 → 提交确认 → 模拟过一天
  await page.goto(`${base}/#/sales/confirm`);
  await page.waitForSelector('[data-testid=confirm-submit]');
  await page.click('[data-testid=confirm-submit]');
  await page.waitForTimeout(400);
  t('提交确认成功', ((await page.textContent('[data-testid=confirm-submit]')) ?? '').includes('已确认'));
  await page.click('[data-testid=simulate-day]');
  await page.waitForTimeout(700);
  const confirmBody = (await page.textContent('body')) ?? '';
  t('模拟过一天 → 2026-06-30', confirmBody.includes('2026-06-30'));

  // 刷新持久化（localStorage）
  await page.reload();
  await page.waitForTimeout(700);
  t('刷新后仍为 6-30（localStorage 持久）', ((await page.textContent('body')) ?? '').includes('2026-06-30'));

  // —— P6 · 一键点亮全家桶（点亮/回锁瞬时切换，示例角标常驻）——
  console.log(`\n${B}── P6 · 货架与一键点亮 ──${N}`);
  await page.goto(`${base}/#/boss`);
  await page.waitForTimeout(700);
  let body = (await page.textContent('body')) ?? '';
  t('初始锁态：现金前瞻显 — ＋价值语', body.includes('开通增长操盘包，这里每天预告未来 30 天回款'));
  await page.click('[data-testid=unlock-toggle]');
  await page.waitForTimeout(150);
  body = (await page.textContent('body')) ?? '';
  t('点亮：心跳第 6 格示例值 ¥17.0万', body.includes('¥17.0万'));
  t('点亮：分诊条在漏 ¥8,900 / 卡点 ¥49.6万（示例）', body.includes('¥8,900') && body.includes('¥49.6万'));
  t('点亮：示例数据角标常驻', body.includes('示例数据'));
  t('点亮：活卡交作业行', body.includes('今日作业'));
  await page.click('[data-testid=unlock-toggle]');
  await page.waitForTimeout(150);
  body = (await page.textContent('body')) ?? '';
  t('回锁：恢复 —＋锁标', body.includes('开通增长操盘包，这里每天预告未来 30 天回款'));
  // 锁卡点开 → 静态样例长页
  await page.goto(`${base}/#/sample/pack1`);
  await page.waitForTimeout(700);
  body = (await page.textContent('body')) ?? '';
  t('样例长页：王五止血 ¥8,900＋示例角标', body.includes('¥8,900') && body.includes('示例数据'));

  // —— P7 · 防误触锁定 ＋ 一键重置浮钮 ——
  console.log(`\n${B}── P7 · 防误触锁定与一键重置 ──${N}`);
  await page.goto(`${base}/#/boss`);
  await page.waitForSelector('[data-testid=lock-btn]');
  await page.click('[data-testid=lock-btn]');
  await page.waitForSelector('[data-testid=unlock-hold]');
  t('锁定后出现长按解锁条', true);
  // 锁定态下点击被遮罩拦截：尝试点身份切换不应导航
  await page.mouse.click(187, 400);
  await page.waitForTimeout(400);
  t('锁定态页面点击被拦截（仍在 /boss）', page.url().includes('/boss'));
  await page.dispatchEvent('[data-testid=unlock-hold]', 'mousedown');
  await page.waitForSelector('[data-testid=lock-btn]', { timeout: 3000 }); // 满 1 秒自动解锁、遮罩卸载
  t('长按 1 秒解锁成功', true);
  // 一键重置：数据回到种子态（6-29 · ¥61.2万）
  await page.click('[data-testid=reset-btn]');
  await page.waitForSelector('[data-testid=reset-confirm]');
  await page.click('[data-testid=reset-confirm]');
  await page.waitForTimeout(1200);
  const homeBody = (await page.textContent('body')) ?? '';
  t('重置后回到首页且日期回到 2026-06-29', homeBody.includes('2026-06-29'));
  t('重置后关键数复原（种子重生成）', homeBody.includes('¥612,000') || homeBody.includes('61.2'));

  // —— P10 · 周期切换 ＋ 部门筛选 ＋ 全格下钻 ——
  console.log(`\n${B}── P10 · 周期切换/部门筛选/下钻 ──${N}`);
  await page.goto(`${base}/#/boss`);
  await page.waitForSelector('[data-testid=period-day]');
  await page.click('[data-testid=period-day]');
  await page.waitForTimeout(300);
  body = (await page.textContent('body')) ?? '';
  t('切「日」→ KPI 变今日口径', body.includes('今日回款') && body.includes('今日净利'));
  await page.click('[data-testid=period-week]');
  await page.waitForTimeout(300);
  body = (await page.textContent('body')) ?? '';
  t('切「周」→ 本周口径＋周不设目标', body.includes('本周回款') && body.includes('周不设独立目标'));
  await page.click('[data-testid=period-year]');
  await page.waitForTimeout(300);
  t('切「年」→ 本年口径', ((await page.textContent('body')) ?? '').includes('本年回款'));
  await page.click('[data-testid=period-month]');
  await page.waitForTimeout(300);
  t('切回「月」→ 本月口径', ((await page.textContent('body')) ?? '').includes('本月回款'));
  await page.click('[data-testid=dept-chip-d1]');
  await page.waitForTimeout(300);
  body = (await page.textContent('body')) ?? '';
  t('部门筛选一部 → 全板按部门裁剪', body.includes('区四 · 团队一屏（华东一部）') && body.includes('已按 华东一部 裁剪全板数据'));
  await page.click('[data-testid=dept-chip-all]');
  await page.waitForTimeout(300);
  t('切回全公司 → 部门对比可见', ((await page.textContent('body')) ?? '').includes('部门对比'));
  // 下钻：点击回款 KPI → 出成员明细面板
  await page.click('text=本月回款');
  await page.waitForTimeout(400);
  body = (await page.textContent('body')) ?? '';
  t('KPI 下钻面板打开（回款成员明细）', body.includes('回款下钻') && body.includes('近 14 天逐日回款'));
  await page.click('text=关闭 ✕');
  await page.waitForTimeout(200);

  await browser.close();
  await new Promise<void>((res) => server.httpServer.close(() => res()));
  if (failed > 0) {
    console.error(`\n${R}${B}✗ e2e-check 未通过：${failed} 项失败${N}`);
    process.exit(1);
  }
  console.log(`\n${G}${B}✓ e2e-check 全绿：浏览器现场剧本闭环${N}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
