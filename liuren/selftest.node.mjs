// 无头对拍：在 Node 里运行引擎与件七/件六自检，CI 友好（零浏览器依赖）。
// 用法：node liuren/selftest.node.mjs   （退出码 0 = 全绿）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const base = join(dirname(fileURLToPath(import.meta.url)), 'src', 'js');
const mods = ['core.js', 'coefficients.js', 'storage.js', 'engine.js', 'scripts.js', 'selftest.js'];
const src = mods.map(m => readFileSync(join(base, m), 'utf8')).join('\n');
const api = new Function(`"use strict";\n${src}\n; return { runSelfTest };`)();

const r = api.runSelfTest();
let ok = true;
console.log('=== 件七 对拍 (T1–T19) ===');
for (const t of r.tcases) { console.log(`${t.pass ? '✅' : '❌'} ${t.id}  ${t.title}`); if (!t.pass) { ok = false; console.log(`     got:${t.got} want:${t.want}`); } }
console.log(`对拍 ${r.passCount}/${r.total}\n=== 件六 红线断言 ===`);
for (const a of r.asserts) { console.log(`${a.pass ? '✅' : '❌'} ${a.id}  ${a.title}`); if (!a.pass) ok = false; }
console.log(`断言 ${r.assertPass}/${r.assertTotal}`);
console.log(ok ? '\n🟢 ALL GREEN — 收货' : '\n🔴 FAILURES');
process.exit(ok ? 0 : 1);
