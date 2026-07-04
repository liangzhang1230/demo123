/**
 * npm run demo-record（P7 终验收）：按 /script 演示脚本 10 分钟动线完整走一遍并录屏
 * （压缩节奏）。产物：scripts/shots/demo-final.webm。
 * 动线：三问看板 → 团队一屏 → 现场建档推单看联动 → 销售端 → 锁卡＋一键点亮 → 脚本页收尾。
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';

async function main() {
  mkdirSync('scripts/shots/video', { recursive: true });
  const server = await preview({ preview: { port: 4176, strictPort: true } });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: 'scripts/shots/video', size: { width: 390, height: 844 } },
  });
  const page = await ctx.newPage();
  const base = 'http://localhost:4176';
  const pause = (ms: number) => page.waitForTimeout(ms);
  const scrollBy = async (y: number) => { await page.mouse.wheel(0, y); await pause(900); };

  // 开场：重置后的首页（含加载动画）
  await page.goto(`${base}/#/`);
  await pause(1600);

  // 第 0 步 · 30 秒三问：老板看板
  await page.goto(`${base}/#/boss`);
  await pause(1800);
  await scrollBy(500); // 早报＋心跳
  await scrollBy(500); // 分诊条

  // 第 1 步 · 团队一屏（王五 47 天零业务事件）
  await scrollBy(600);
  await pause(1200);

  // 第 2 步 · 现场建档推单
  await page.goto(`${base}/#/sales/customers/new`);
  await page.waitForSelector('[data-testid=cust-name]');
  await page.fill('[data-testid=cust-name]', '静安录屏演示商行');
  await pause(400);
  await page.fill('[data-testid=cust-contact]', '吴老板');
  await page.fill('[data-testid=cust-phone]', '13800138000');
  await pause(400);
  await page.click('[data-testid=cust-submit]');
  await page.waitForSelector('[data-testid=to-intent]');
  await pause(900);
  for (const s of ['intent', 'sample', 'signed'] as const) {
    await page.click(`[data-testid=to-${s}]`);
    await pause(700);
  }
  await page.click('[data-testid=to-deal]');
  await pause(500);
  await page.fill('[data-testid=deal-amount]', '8000');
  await pause(400);
  await page.click('[data-testid=deal-confirm]');
  await pause(1100);

  // 回看板看联动
  await page.goto(`${base}/#/boss`);
  await pause(1800);
  await scrollBy(450);

  // 第 3 步 · 销售端（销冠也爱用）
  await page.goto(`${base}/#/sales`);
  await pause(1600);
  await scrollBy(600);
  await scrollBy(600);

  // 第 4 步 · 锁卡讲缺口 ＋ 一键点亮
  await page.goto(`${base}/#/sample/pack1`);
  await pause(1600);
  await scrollBy(700);
  await page.goto(`${base}/#/boss`);
  await pause(1400);
  await scrollBy(1500); // 到武器坞
  await page.click('[data-testid=unlock-toggle]');
  await pause(1300);
  await page.mouse.wheel(0, -1400); // 回看分诊条与心跳第 6 格（示例值亮起）
  await pause(1500);
  await page.mouse.wheel(0, 1400);
  await page.click('[data-testid=unlock-toggle]'); // 回锁
  await pause(1200);

  // 确认页 · 模拟过一天
  await page.goto(`${base}/#/sales/confirm`);
  await page.waitForSelector('[data-testid=confirm-submit]');
  await pause(900);
  await page.click('[data-testid=confirm-submit]');
  await pause(700);
  await page.click('[data-testid=simulate-day]');
  await pause(1400);

  // 第 5 步 · 脚本页收尾
  await page.goto(`${base}/#/script`);
  await pause(1500);
  await scrollBy(700);
  await scrollBy(700);
  await pause(800);

  await ctx.close(); // 落盘视频
  await browser.close();
  await new Promise<void>((res) => server.httpServer.close(() => res()));

  const files = readdirSync('scripts/shots/video').filter((f) => f.endsWith('.webm'));
  if (files.length === 0) throw new Error('未生成录屏文件');
  renameSync(`scripts/shots/video/${files[0]}`, 'scripts/shots/demo-final.webm');
  console.log('✓ 录屏完成：scripts/shots/demo-final.webm');
}

main().catch((e) => { console.error(e); process.exit(1); });
