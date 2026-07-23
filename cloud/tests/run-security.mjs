#!/usr/bin/env node
/* ============================================================
   对抗性安全套件总控 —— 汇总跑 A/B/C/D 四套并逐套 ✓/✗ + 总统计
   运行：node tests/run-security.mjs
   - A 隔离穿透+越权攻防   sec-penetration.test.mjs
   - B 高并发+乐观锁+一致性 concurrency.test.mjs
   - C 大数据量压力         stress-scale.test.mjs
   - D 内存泄漏排查         memory-leak.test.mjs（🔴 子进程带 --expose-gc）
   🔴 铁律：如实汇报。任一套失败 → 本总控 exit 1，并打出该套的 ✗ 行与 🔴 发现行。
   ============================================================ */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  ['A 隔离穿透 + 越权攻防', 'sec-penetration.test.mjs', []],
  ['B 高并发 + 乐观锁 + 一致性', 'concurrency.test.mjs', []],
  ['C 大数据量压力 + 稳定性', 'stress-scale.test.mjs', []],
  ['D 内存泄漏排查', 'memory-leak.test.mjs', ['--expose-gc']],   // 🔴 D 必须暴露 GC
];

console.log('══════════════════════════════════════════════════════════');
console.log(' AI 销售操盘手·云端版 —— 对抗性安全/并发/压力/内存 四套总控');
console.log('══════════════════════════════════════════════════════════');

let bad = 0;
const summary = [];
for (const [name, file, nodeArgs] of suites) {
  const started = Date.now();
  const r = spawnSync('node', [...nodeArgs, join(here, file)], { encoding: 'utf8', timeout: 900000 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const out = (r.stdout || '') + (r.stderr || '');
  const passed = r.status === 0;
  if (!passed) bad++;
  // 抽取该套自身的断言统计行 / 发现行
  const tail = out.split('\n').filter(l => /^\[.\.|断言|发现|穿透|疑似泄漏|超卖|去重在并发下失效|席位不超卖/.test(l));
  const fails = out.split('\n').filter(l => l.includes('✗')).slice(0, 12);
  const findLines = out.split('\n').filter(l => /【系统行为】|【疑似泄漏】/.test(l));
  summary.push({ name, passed, secs, statLine: tail.find(l => l.startsWith('[')) || '', findLines, fails });
  console.log(`\n${passed ? '✅' : '❌'} ${name}  (${secs}s)`);
  if (!passed) {
    fails.forEach(l => console.log('   ' + l.trim()));
  }
  if (findLines.length) {
    console.log('   🔴 发现：');
    findLines.forEach(l => console.log('     ' + l.trim()));
  }
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(' 总统计');
console.log('══════════════════════════════════════════════════════════');
for (const s of summary) {
  console.log(`  ${s.passed ? '✅' : '❌'} ${s.name.padEnd(24)} ${s.secs.padStart(6)}s  ${s.statLine}`);
}
const totalFindings = summary.reduce((a, s) => a + s.findLines.length, 0);
console.log(`\n  套件 ${suites.length}｜通过 ${suites.length - bad}｜失败 ${bad}｜实证发现（系统行为/疑似泄漏）${totalFindings} 项`);
if (bad) {
  console.log('\n  ❌ 存在失败套件——按铁律如实标红，不掩盖。失败可能是「真实系统缺陷」（见上 🔴 发现），');
  console.log('     也可能是断言口径需复核；逐条以各套输出为准。');
} else {
  console.log('\n  ✅ 四套全绿。');
}
process.exit(bad ? 1 : 0);
