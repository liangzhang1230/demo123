import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const doc = readFileSync('' + fileURLToPath(new URL('../00_主控文档_v1.1.md', import.meta.url)) + '', 'utf8');
const html = readFileSync('' + fileURLToPath(new URL('../主控台.html', import.meta.url)) + '', 'utf8');

// —— 从主控文档 §4 抽取台账（只取第 4 节，避免混入别处的编号引用）——
const sec4 = doc.split('## 4 ·')[1].split('## 5 ·')[0];
const docMap = new Map();
for (const line of sec4.split('\n')) {
  const m = line.match(/^\|\s*(底\d{3})\s*\|(.*)\|\s*(.*?)\s*\|\s*$/);
  if (!m) continue;
  const text = m[2].trim();
  const usedRaw = m[3].trim();
  const used = usedRaw === '—' ? 0 : usedRaw === '谈判包' ? 1 : usedRaw === '体检包' ? 2 : usedRaw === '谈判包＋体检包' ? 3 : NaN;
  docMap.set(m[1], { text, used, usedRaw });
}

// —— 从 HTML 抽取内嵌数据 ——
const htmlMap = new Map();
for (const m of html.matchAll(/\["(底\d{3})","((?:[^"\\]|\\.)*)",([0-3])\]/g)) {
  htmlMap.set(m[1], { text: m[2].replace(/\\"/g, String.fromCharCode(34)), used: +m[3] });
}

let errs = [];
if (docMap.size !== 127) errs.push(`文档抽取条数 ${docMap.size} ≠ 127`);
if (htmlMap.size !== 127) errs.push(`HTML 抽取条数 ${htmlMap.size} ≠ 127`);
for (const [id, d] of docMap) {
  const h = htmlMap.get(id);
  if (!h) { errs.push(`${id} 在 HTML 中缺失`); continue; }
  if (Number.isNaN(d.used)) errs.push(`${id} 文档“已用于”字段无法识别: ${d.usedRaw}`);
  else if (h.used !== d.used) errs.push(`${id} 用途不一致: 文档=${d.usedRaw} HTML=${h.used}`);
  if (h.text !== d.text) errs.push(`${id} 一句话不一致:\n  文档: ${JSON.stringify(d.text)}\n  HTML: ${JSON.stringify(h.text)}`);
}
for (const id of htmlMap.keys()) if (!docMap.has(id)) errs.push(`${id} 是 HTML 多出的编号（文档没有）`);

// 停用号
for (const s of ['底108', '底111', '底112']) {
  if (docMap.has(s) || htmlMap.has(s)) errs.push(`停用号 ${s} 出现在台账`);
}

console.log(errs.length ? '❌ 逐字比对发现差异:\n' + errs.join('\n') : `✅ 逐字比对通过：127 条编号、一句话、用途标记与主控文档完全一致；停用号未混入`);
process.exit(errs.length ? 1 : 0);
