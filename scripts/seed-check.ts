/** npm run seed-check：生成种子 → 全量断言 → 全绿 exit 0，任一失败 exit 1 */
import { generateSeed } from '../src/seed/generator';
import { runSeedChecks } from '../src/seed/assertions';

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const N = '\x1b[0m';

try {
  const t0 = Date.now();
  const data = generateSeed();
  const { results, folded } = runSeedChecks(data);

  let group = '';
  let failed = 0;
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      console.log(`\n${B}── ${group} ──${N}`);
    }
    const mark = r.pass ? `${G}✓${N}` : `${R}✗${N}`;
    const detail = r.pass ? r.actual : `期望 ${r.expected}，实得 ${r.actual}`;
    console.log(`  ${mark} ${r.name} ＝ ${detail}`);
    if (!r.pass) failed++;
  }

  console.log(`\n${B}事件流规模${N}：${folded.eventCount} 条事件 / ${data.customers.length} 客户 / 90 天（${data.openDate} → ${data.anchorDate}）`);
  console.log(`生成+校验耗时 ${Date.now() - t0}ms`);

  if (failed > 0) {
    console.error(`\n${R}${B}✗ seed-check 未通过：${failed} 项失败${N}`);
    process.exit(1);
  }
  console.log(`\n${G}${B}✓ seed-check 全绿：${results.length} 项断言全部通过${N}`);
} catch (err) {
  console.error(`${R}${B}✗ 种子生成失败（守恒断言或配额不闭合，拒绝启动）${N}`);
  console.error(err);
  process.exit(1);
}
