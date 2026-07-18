// 授权码签发器（作者本地离线运行；公约【11】C-13：私钥永不离开作者电脑）
// 用法：node license-signer.mjs "王总" yuren 2027-07-18
// 生产发布前：node license-signer.mjs --gen-keys 重新生成密钥对，
//   把新公钥 JWK 替换进 HTML 的 LICENSE_PUBKEY_JWK，私钥文件离线保存、绝不入库。
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { generateKeyPairSync, createPrivateKey, sign } from 'crypto';

const here = dirname(fileURLToPath(import.meta.url));
const keyFile = join(here, 'demo-keys.json');

if (process.argv[2] === '--gen-keys') {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const out = { pub: publicKey.export({ format: 'jwk' }), priv: privateKey.export({ format: 'jwk' }) };
  writeFileSync(keyFile, JSON.stringify(out, null, 2));
  console.log('新密钥对已写入 demo-keys.json。');
  console.log('把下面的公钥 JWK 替换进 HTML 的 LICENSE_PUBKEY_JWK：');
  console.log(JSON.stringify(out.pub));
  process.exit(0);
}

const [tenant, board, expiry] = process.argv.slice(2);
if (!tenant || !board || !/^\d{4}-\d{2}-\d{2}$/.test(expiry || '')) {
  console.error('用法：node license-signer.mjs <客户名> <board:dingjia|zhaoren|suanzhang|liuren|yuren> <YYYY-MM-DD>');
  process.exit(1);
}
if (!existsSync(keyFile)) { console.error('缺少密钥文件，先运行 --gen-keys'); process.exit(1); }
const keys = JSON.parse(readFileSync(keyFile, 'utf8'));
const priv = createPrivateKey({ key: keys.priv, format: 'jwk' });
const payload = Buffer.from(JSON.stringify({ tenant, board, expiry }));
const sig = sign(null, payload, { key: priv, dsaEncoding: 'ieee-p1363' });
const b64u = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log('SKAB-' + b64u(payload) + '.' + b64u(sig));
