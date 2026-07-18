// 红线扫描：两个新工具引用的每个编号必须真实存在于主控文档 §4 台账；
// 停用号不得出现；§5.7 禁用词命中数必须为 0；工具不得使用 localStorage/sessionStorage。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const doc = readFileSync(fileURLToPath(new URL('../00_主控文档_v1.1.md', import.meta.url)), 'utf8');
const sec4 = doc.split('## 4 ·')[1].split('## 5 ·')[0];
const VALID = new Map(); // 编号 → 一句话
for (const line of sec4.split('\n')) {
  const m = line.match(/^\|\s*(底\d{3})\s*\|(.*)\|\s*(.*?)\s*\|\s*$/);
  if (m) VALID.set(m[1], m[2].trim());
}
if (VALID.size !== 127) { console.error('台账抽取 ' + VALID.size + ' ≠ 127'); process.exit(1); }

const STOPPED = ['底108', '底111', '底112'];
const BANNED = ['赋能','抓手','闭环','底层逻辑','方法论','心智','颗粒度','打法','组合拳','三天开单','月入十万','销冠神话'];
const TOOLS = ['30天替代选项排班表.html', '出单卡点诊断器.html'];

let errs = [];
for (const f of TOOLS) {
  const html = readFileSync(fileURLToPath(new URL('../03_工具/' + f, import.meta.url)), 'utf8');
  const refs = [...html.matchAll(/底\d{3}/g)].map(m => m[0]);
  for (const id of new Set(refs)) {
    if (STOPPED.includes(id)) errs.push(`${f}: 引用了停用号 ${id}`);
    else if (!VALID.has(id)) errs.push(`${f}: 引用了台账中不存在的编号 ${id}`);
  }
  for (const w of BANNED) if (html.includes(w)) errs.push(`${f}: 命中禁用词「${w}」`);
  if (/研究表明|科学证明/.test(html)) errs.push(`${f}: 出现无主语引用`);
  if (/localStorage|sessionStorage/.test(html)) errs.push(`${f}: 使用了 localStorage/sessionStorage（§5.6 禁止）`);
  if (/<script[^>]+src=|<link[^>]+href=|https?:\/\/cdn|@import/.test(html)) errs.push(`${f}: 疑似外部依赖`);
  console.log(`${f}: 引用编号 ${new Set(refs).size} 个（${[...new Set(refs)].sort().join(' ')}）`);
}
console.log(errs.length ? '❌\n' + errs.join('\n') : '✅ 红线扫描通过：编号全部真实、无停用号、禁用词 0 命中、无存储、无外部依赖');
process.exit(errs.length ? 1 : 0);
