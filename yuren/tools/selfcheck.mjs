// 对拍执行器：抽出 HTML 内联脚本，在无 DOM 环境跑件七 19 条对拍 + 件六断言 + 授权验签联测
// 用法：node yuren/tools/selfcheck.mjs [yuren/销冠育人器.html]
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { webcrypto, createPrivateKey, sign } from 'crypto';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.argv[2] || join(here, '..', '销冠育人器.html'), 'utf8');
const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error('未找到内联脚本'); process.exit(1); }

const store = new Map();
const ctx = {
  console, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  TextDecoder, crypto: webcrypto, URL, Blob: class {}, alert: () => {}, confirm: () => true,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    key: i => [...store.keys()][i], get length() { return store.size; },
  },
  location: { hash: '' }, window: undefined,
};
ctx.globalThis = ctx;
ctx.__SRC__ = html;   // 源码自扫描断言的输入 = 完整交付物
vm.createContext(ctx);
vm.runInContext(m[1], ctx);

const tests = vm.runInContext('runSelfTests()', ctx);
const asserts = vm.runInContext('runAssertions()', ctx);
let fail = 0;
for (const t of tests) {
  if (!t.pass) fail++;
  console.log(`${t.pass ? '🟢' : '🔴'} ${t.id}  ${t.name}  ${t.detail || ''}`);
}
console.log('—— 对拍 ' + tests.filter(t => t.pass).length + '/' + tests.length + ' ——');
for (const a of asserts) {
  if (!a.pass) fail++;
  console.log(`${a.pass ? '🟢' : '🔴'} ${a.id}  ${a.name}`);
}
console.log('—— 断言 ' + asserts.filter(a => a.pass).length + '/' + asserts.length + ' ——');

// 授权联测：用演示私钥签一张码，走 HTML 内公钥验签（生产环境请更换密钥对）
const keys = JSON.parse(readFileSync(join(here, 'demo-keys.json'), 'utf8'));
const priv = createPrivateKey({ key: keys.priv, format: 'jwk' });
const payload = Buffer.from(JSON.stringify({ tenant: '演示客户', board: 'yuren', expiry: '2027-12-31' }));
const sig = sign(null, payload, { key: priv, dsaEncoding: 'ieee-p1363' });
const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const code = 'SKAB-' + b64u(payload) + '.' + b64u(sig);
const licOk = await vm.runInContext(`verifyLicense(${JSON.stringify(code)}, '2026-07-18')`, ctx);
const licBad = await vm.runInContext(`verifyLicense('SKAB-xxxx.yyyy', '2026-07-18')`, ctx);
const licExp = await vm.runInContext(`verifyLicense(${JSON.stringify(code)}, '2028-01-01')`, ctx);
console.log((licOk.ok ? '🟢' : '🔴') + ' LIC-1 合法码验签通过 tenant=' + (licOk.payload || {}).tenant);
console.log((!licBad.ok ? '🟢' : '🔴') + ' LIC-2 伪造码拒绝');
console.log((!licExp.ok && licExp.expired ? '🟢' : '🔴') + ' LIC-3 过期码降级（expired 标记）');
if (!licOk.ok || licBad.ok || !licExp.expired) fail++;
console.log('演示授权码（board=yuren，2027-12-31 到期）:\n' + code);
process.exit(fail ? 1 : 0);
