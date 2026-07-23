/* 测试辅助:与 fama-server.js 相同的发码算法(供 tests 交叉验证;发码逻辑变更时两处同步) */
'use strict';
const crypto = require('crypto');
const normHex = s => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const hmacHex = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex');
exports.makeDCode = (secret, deviceCode) => 'XZ-D-' + hmacHex(secret, 'D|' + normHex(deviceCode)).slice(0, 20);
exports.makeGCode = (secret) => {
  const nonce = crypto.randomBytes(4).toString('hex');
  return 'XZ-G-' + nonce + '-' + hmacHex(secret, 'G|' + nonce).slice(0, 16);
};
