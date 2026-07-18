#!/usr/bin/env node
/* C0+C1 统一验收：五板块 109 条对拍（25/24/22/19/19）+ C0 底座隔离
   v5.1 §2.1：109 条全绿 = L2 移植合格，一条不绿即视为改了口径 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  ['C1 定价器 25 条', 'dingjia.test.mjs'],
  ['C1 招人器 24 条', 'zhaoren.test.mjs'],
  ['C1 算账器 22 条', 'suanzhang.test.mjs'],
  ['C1 留人器 19 条', 'liuren.test.mjs'],
  ['C1 育人器 19 条', 'yuren.test.mjs'],
  ['C0 底座隔离验收', 'c0-rls.test.mjs'],
];
let bad = 0;
for (const [name, file] of suites) {
  const r = spawnSync('node', [join(here, file)], { encoding: 'utf8', timeout: 300000 });
  const passed = r.status === 0;
  if (!passed) bad++;
  console.log(`${passed ? '✅' : '❌'} ${name}${passed ? '' : '\n' + (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 10).join('\n')}`);
}
console.log(bad ? `\n❌ ${bad} 个套件未过——按 v5.1 铁律视为改了口径，禁止进入下一阶段` : '\n✅ C1 移植合格：五板块 109 条对拍全绿 + C0 底座验收通过');
process.exit(bad ? 1 : 0);
