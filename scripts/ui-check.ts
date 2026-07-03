/**
 * npm run ui-check（P3/P4 验收辅助）：vite preview 起服务 → 无头 Chromium
 * 双端走查（375×812 手机 / 1920×1080 投屏），断言页面出现实时折算关键数，
 * 并截图存 scripts/shots/ 供人工复核。用法：tsx scripts/ui-check.ts [route=期望词,…]…
 */
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';

const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', N = '\x1b[0m';

interface PageCheck { route: string; expects: string[]; absents?: string[] }

const DEFAULT_CHECKS: PageCheck[] = [
  {
    route: '/boss',
    expects: [
      '区一 · 今日一件事', '区二 · 经营心跳', '区三 · 钱事分诊条', '区四 · 团队一屏', '区五 · 武器坞',
      '¥61.2万', '1.52', '王五', '天零业务事件', '停滞红色积压',
      '数据就绪：该演示租户已沉淀 214 笔成交 / 90 天数据', '试看申请', '筛人漏斗', '李强 · 筛选中第 38 天',
    ],
  },
  {
    route: '/manager',
    expects: ['刘敏（主管）· 华东一部', '区四 · 团队一屏（华东一部）', '主管版摘除购买位', '王丽'],
    absents: ['试看申请', '系统投入产出参照'],
  },
];

function parseArgChecks(): PageCheck[] | null {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;
  return args.map((a) => {
    const [route, rest] = a.split('=');
    return { route, expects: rest ? rest.split(',') : [] };
  });
}

async function main() {
  const checks = parseArgChecks() ?? DEFAULT_CHECKS;
  mkdirSync('scripts/shots', { recursive: true });
  const server = await preview({ preview: { port: 4173, strictPort: true } });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let failed = 0;

  for (const vp of [{ w: 375, h: 812, tag: 'mobile' }, { w: 1920, h: 1080, tag: 'screen' }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    for (const chk of checks) {
      await page.goto(`http://localhost:4173/#${chk.route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(150);
      const text = (await page.textContent('body')) ?? '';
      console.log(`\n${B}── ${chk.route} @${vp.tag} ${vp.w}px ──${N}`);
      for (const e of chk.expects) {
        const ok = text.includes(e);
        console.log(`  ${ok ? `${G}✓${N}` : `${R}✗${N}`} 含「${e}」`);
        if (!ok) failed++;
      }
      for (const a of chk.absents ?? []) {
        const ok = !text.includes(a);
        console.log(`  ${ok ? `${G}✓${N}` : `${R}✗${N}`} 不含「${a}」`);
        if (!ok) failed++;
      }
      // 横向溢出检查（移动优先适配）
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const ok = overflow <= 1;
      console.log(`  ${ok ? `${G}✓${N}` : `${R}✗${N}`} 无横向溢出（${overflow}px）`);
      if (!ok) failed++;
      await page.screenshot({ path: `scripts/shots/${chk.route.replace(/\//g, '_') || '_home'}-${vp.tag}.png`, fullPage: true });
    }
    await page.close();
  }

  await browser.close();
  await new Promise<void>((res) => server.httpServer.close(() => res()));
  if (failed > 0) {
    console.error(`\n${R}${B}✗ ui-check 未通过：${failed} 项失败${N}`);
    process.exit(1);
  }
  console.log(`\n${G}${B}✓ ui-check 双端走查全绿${N}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
