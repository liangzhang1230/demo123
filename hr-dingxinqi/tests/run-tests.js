#!/usr/bin/env node
/* 校验装置:从发货 HTML 中原样抽取 ACT/ENGINE 代码块执行,保证"测试的=发货的" */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'hr-dingxinqi.html'), 'utf8');
function extract(tag) {
  const m = html.match(new RegExp('/\\* ===== ' + tag + '-BEGIN[\\s\\S]*?===== \\*/([\\s\\S]*?)/\\* ===== ' + tag + '-END ===== \\*/'));
  if (!m) throw new Error('未找到代码块 ' + tag);
  return m[1];
}
const secretMatch = html.match(/var ACT_SECRET='([^']+)'/);
const ACT_SECRET = secretMatch[1];

// 在干净作用域里执行抽取的代码
const sandboxSrc = extract('ACT') + '\n' + extract('ENGINE') +
  '\nmodule.exports={sha256hex,hmac256,verifyCode,normHex,computeAll,selfTest,PARAMS};';
const tmp = path.join(__dirname, '_extracted.js');
fs.writeFileSync(tmp, sandboxSrc);
const X = require(tmp);

let pass = 0, fail = 0;
const bad = [];
function report(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; bad.push(name + (detail ? ' → ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' → ' + detail : '')); }
}

console.log('== 1. 引擎黄金用例(规格书 v1.3 §8,共 ' + X.selfTest().length + ' 项) ==');
X.selfTest().forEach(t => report(t.name, t.pass, '得 ' + t.got + ' 应为 ' + t.want));

console.log('== 2. 加密互通(HTML 端 JS 实现 vs Node 官方 crypto) ==');
const fps = ['a1b2c3d4e5f6', '0123456789ab', 'ffeeddccbbaa'];
fps.forEach(fp => {
  const nodeH = crypto.createHmac('sha256', ACT_SECRET).update('D|' + fp).digest('hex');
  report('HMAC 一致 (' + fp + ')', X.hmac256(ACT_SECRET, 'D|' + fp) === nodeH);
});
// 服务端发码 → 客户端验签(全链路)
const srv = require(path.join(__dirname, '..', 'fama-server.js.exports.js'));
fps.forEach(fp => {
  const code = srv.makeDCode(ACT_SECRET, fp.toUpperCase());  // 服务端收到大写带杂质也应归一化
  report('服务端D码→客户端验签通过 (' + fp + ')', X.verifyCode(code, fp, ACT_SECRET).ok);
  report('D码在其他设备验签失败 (' + fp + ')', !X.verifyCode(code, '999999999999', ACT_SECRET).ok);
});
const g = srv.makeGCode(ACT_SECRET);
report('服务端G码→任意设备验签通过', X.verifyCode(g, 'anydevice1234', ACT_SECRET).ok);
report('篡改码验签失败', !X.verifyCode('XZ-D-00000000000000000000', fps[0], ACT_SECRET).ok);

console.log('== 汇总 ==');
console.log('通过 ' + pass + ' / 失败 ' + fail);
fs.unlinkSync(tmp);
if (fail) { console.log(bad.join('\n')); process.exit(1); }
console.log('全绿 ✓');
