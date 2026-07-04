/**
 * npm run release-check（P8 发布自检）：模拟启动脚本环境——
 * 用 node 零依赖静态服务器起 demo-release/dist（端口 5188），375px 手机视口
 * 完整重跑《演示脚本》动线断言；另验 dist-offline/index.html 单文件版 file:// 直开。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', N = '\x1b[0m';
let failed = 0;
function t(name: string, pass: boolean, detail?: string) {
  console.log(`  ${pass ? `${G}✓${N}` : `${R}✗${N}`} ${name}${detail ? ` ＝ ${detail}` : ''}`);
  if (!pass) failed++;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon',
};

async function main() {
  const root = resolve('demo-release/dist');
  if (!existsSync(join(root, 'index.html'))) throw new Error('demo-release/dist 不存在，先 npm run release');

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0].split('#')[0];
    let file = join(root, path === '/' ? 'index.html' : path.slice(1));
    if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(5188, r));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const base = 'http://localhost:5188';
  const body = async () => (await page.textContent('body')) ?? '';
  const go = async (r: string) => { await page.goto(`${base}/#${r}`); await page.waitForTimeout(900); };

  console.log(`${B}── 发布包自检 · 演示脚本动线（375px @5188） ──${N}`);

  // Step 0 · 30 秒三问
  await go('/boss');
  let text = await body();
  t('三问看板：心跳 ¥61.2万 / 1.52 / 五区齐', text.includes('¥61.2万') && text.includes('1.52') && text.includes('区五 · 武器坞'));
  t('停滞收敛后仍有火：区一有待办/诊断置顶', text.includes('待办') || text.includes('诊断'));
  // Step 1 · 团队一屏
  t('团队一屏：王五 47 天零业务事件', text.includes('47 天零业务事件'));
  // Step 2 · 现场建档推单
  await go('/sales/customers/new');
  await page.fill('[data-testid=cust-name]', '发布自检商行');
  await page.fill('[data-testid=cust-contact]', '孙老板');
  await page.fill('[data-testid=cust-phone]', '13700137000');
  await page.click('[data-testid=cust-submit]');
  await page.waitForSelector('[data-testid=to-intent]');
  for (const s of ['intent', 'sample', 'signed'] as const) {
    await page.click(`[data-testid=to-${s}]`);
    await page.waitForTimeout(300);
  }
  await page.click('[data-testid=to-deal]');
  await page.fill('[data-testid=deal-amount]', '8000');
  await page.click('[data-testid=deal-confirm]');
  await page.waitForTimeout(600);
  t('建档→成交闭环', ((await page.textContent('[data-testid=cust-stage]')) ?? '').includes('成交'));
  await go('/boss');
  text = await body();
  t('看板联动：月回款 → ¥62.0万', text.includes('¥62.0万'));
  // Step 3 · 销售端
  await go('/sales');
  text = await body();
  t('销售端：悬赏＋排名＋今日线索 1', text.includes('悬赏令') && text.includes('全员总排名') && text.includes('今日线索'));
  // Step 4 · 锁卡＋一键点亮
  await go('/sample/pack1');
  text = await body();
  t('样例长页：¥8,900＋示例数据角标', text.includes('¥8,900') && text.includes('示例数据'));
  await go('/boss');
  await page.click('[data-testid=unlock-toggle]');
  await page.waitForTimeout(300);
  text = await body();
  t('一键点亮：¥17.0万＋¥49.6万（示例）', text.includes('¥17.0万') && text.includes('¥49.6万'));
  await page.click('[data-testid=unlock-toggle]');
  await page.waitForTimeout(300);
  t('一键回锁：恢复锁态价值语', (await body()).includes('开通增长操盘包，这里每天预告未来 30 天回款'));
  // Step 5 · 脚本页 ＋ 重置收尾
  await go('/script');
  t('脚本页：10 分钟动线＋提词', (await body()).includes('提词'));
  await page.click('[data-testid=reset-btn]');
  await page.waitForSelector('[data-testid=reset-confirm]');
  await page.click('[data-testid=reset-confirm]');
  await page.waitForTimeout(1500);
  t('一键重置：回种子态 2026-06-29', (await body()).includes('2026-06-29'));

  // 单文件应急版 file:// 直开
  console.log(`\n${B}── 单文件应急版（file:// 零服务器） ──${N}`);
  const offlinePage = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await offlinePage.goto(`file://${resolve('demo-release/dist-offline/index.html')}`);
  await offlinePage.waitForTimeout(1200);
  const offText = (await offlinePage.textContent('body')) ?? '';
  t('file:// 直开首页（三身份入口）', offText.includes('三个免密演示身份'));
  await offlinePage.goto(`file://${resolve('demo-release/dist-offline/index.html')}#/boss`);
  await offlinePage.waitForTimeout(900);
  t('file:// hash 路由跳转 /boss', ((await offlinePage.textContent('body')) ?? '').includes('区二 · 经营心跳'));

  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  if (failed > 0) {
    console.error(`\n${R}${B}✗ release-check 未通过：${failed} 项失败${N}`);
    process.exit(1);
  }
  console.log(`\n${G}${B}✓ release-check 全绿：发布包可交付${N}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
