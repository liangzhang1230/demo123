#!/usr/bin/env node
/* 运营四件套验收：
   ① 仅白名单注册（平台开户白名单 / 成员白名单 命中才放行，其余 403）
   ② 密码重置（老板重成员密码：临时密码+强制改密+旧会话撤销+首登改密链路；平台重置；权限）
   ③ 整库备份（GET /platform/backup gzip）→ 真实 loadDataDir 还原 → 数据完好
   ④ 邮箱验证码（mock SMTP 收码 → 注册须带正确码；错码/过期/防轰炸） */
import { createServer as netServer } from 'node:net';
import { openDb } from '../api/db.mjs';
import { buildServer } from '../api/server.mjs';

let failures = 0;
const ok = (c, n, e = '') => { if (c) console.log(`  ✓ ${n}`); else { failures++; console.log(`  ✗ ${n} ${e}`); } };
const PASS = 'opsPw8888';

/* ---- mock SMTP（明文，最小对话）：捕获 DATA 正文里的 6 位码 ---- */
let lastMail = null;
const smtp = netServer(sock => {
  let stage = 'init', dataBuf = '', authStep = 0;
  sock.write('220 mock ESMTP\r\n');
  sock.on('data', d => {
    for (const line of d.toString('utf8').split('\r\n')) {
      if (stage === 'data') {                              // data 阶段保留空行（头/体分隔），不可 skip
        if (line === '.') { stage = 'done'; sock.write('250 OK queued\r\n');
          const b64 = dataBuf.split('\r\n\r\n')[1] || ''; const txt = Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString('utf8');
          const m = txt.match(/\b(\d{6})\b/); lastMail = { text: txt, code: m ? m[1] : null }; dataBuf = ''; }
        else dataBuf += line + '\r\n';
        continue;
      }
      if (line === '') continue;
      if (authStep === 1) { authStep = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }  // 收到用户名 → 要密码
      if (authStep === 2) { authStep = 0; sock.write('235 auth ok\r\n'); continue; }        // 收到密码 → 认证成功
      const u = line.toUpperCase();
      if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250 ok\r\n');
      else if (u.startsWith('AUTH LOGIN')) { authStep = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (u.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
      else if (u.startsWith('RCPT TO')) sock.write('250 ok\r\n');
      else if (u === 'DATA') { stage = 'data'; sock.write('354 go\r\n'); }
      else if (u.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    }
  });
});
await new Promise(r => smtp.listen(0, '127.0.0.1', r));
const smtpPort = smtp.address().port;

const db = await openDb();
const server = buildServer(db, { devAuth: false, log: false, authRate: { limit: 500, windowMs: 60_000 } });
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { }
  return { status: res.status, body: json, res };
}
const sql = async (s, p = []) => (await db.query(s, p)).rows;
const reg = (email, extra = {}) => call('POST', '/v1/auth/register', { body: { email, password: PASS, ...extra } });
const login = (email, password = PASS) => call('POST', '/v1/auth/login', { body: { email, password } });

/* 平台管理员（直插 platform_admins） */
const boss = (await reg('boss@ops.cn')).body;
await call('POST', '/v1/tenants', { token: boss.token, body: { name: 'OPS公司' } });
const tenantA = (await call('GET', '/v1/me', { token: boss.token })).body.memberships[0].tenant_id;
const plat = (await reg('plat@ops.cn')).body;
await sql(`insert into platform_admins(user_id) values ($1)`, [plat.userId]);

/* ── ① 仅白名单注册 ── */
console.log('— ① 仅白名单可注册 —');
{
  process.env.AUTH_WHITELIST_ONLY = '1';
  const blocked = await reg('stranger@ops.cn');
  ok(blocked.status === 403 && blocked.body.error.code === 'NOT_INVITED', '陌生邮箱注册 → 403 NOT_INVITED');
  await call('POST', '/v1/whitelist', { token: boss.token, body: { contact: 'emp@ops.cn', role: 'sales' } });
  const viaMember = await reg('emp@ops.cn');
  ok(viaMember.status === 201 && viaMember.body.joinedTenant, '成员白名单邮箱 → 放行且自动入位');
  await call('POST', '/v1/platform/signup-allow', { token: plat.token, body: { email: 'newboss@ops.cn', note: '签约客户' } });
  const viaPlat = await reg('newboss@ops.cn');
  ok(viaPlat.status === 201, '平台开户白名单邮箱 → 放行（新老板通道）');
  const used = await sql(`select used_by from platform_signup_allow where email = 'newboss@ops.cn'`);
  ok(used[0].used_by === viaPlat.body.userId, '开户白名单标记已用');
  delete process.env.AUTH_WHITELIST_ONLY;
  const open = await reg('open@ops.cn');
  ok(open.status === 201, '关闭开关后 → 恢复开放注册');
}

/* ── ② 密码重置 ── */
console.log('— ② 密码重置与强制改密 —');
{
  const emp = await login('emp@ops.cn');
  ok(emp.status === 200, 'emp 原密码可登录');
  const reset = await call('POST', `/v1/members/${emp.body.userId}/reset-password`, { token: boss.token, body: {} });
  ok(reset.status === 200 && /^[A-Z0-9]{8}$/.test(reset.body.tempPassword), '老板重置 → 返回 8 位临时密码');
  const oldTok = await call('GET', '/v1/me', { token: emp.body.token });
  ok(oldTok.status === 401, '重置后 emp 旧会话失效（被撤销）');
  const oldPw = await login('emp@ops.cn', PASS);
  ok(oldPw.status === 401, '重置后原密码登录失败');
  const tempLogin = await login('emp@ops.cn', reset.body.tempPassword);
  ok(tempLogin.status === 200, '临时密码可登录');
  const sess = await call('GET', '/v1/auth/session', { token: tempLogin.body.token });
  ok(sess.body.mustChangePassword === true, 'session 标记 mustChangePassword=true');
  const weak = await call('POST', '/v1/auth/change-password', { token: tempLogin.body.token, body: { oldPassword: reset.body.tempPassword, newPassword: 'weak' } });
  ok(weak.status === 400, '新密码太弱 → 400');
  const chg = await call('POST', '/v1/auth/change-password', { token: tempLogin.body.token, body: { oldPassword: reset.body.tempPassword, newPassword: 'newGood99' } });
  ok(chg.status === 200, '首登改密成功');
  const afterChg = await call('GET', '/v1/me', { token: tempLogin.body.token });
  ok(afterChg.status === 401, '改密后旧会话亦失效（需重登）');
  const relog = await login('emp@ops.cn', 'newGood99');
  const sess2 = await call('GET', '/v1/auth/session', { token: relog.body.token });
  ok(relog.status === 200 && sess2.body.mustChangePassword === false, '新密码登录且强制改密标记已清');
  const bySales = await call('POST', `/v1/members/${boss.userId}/reset-password`, { token: relog.body.token, body: {} });
  ok(bySales.status === 403, '非老板重置他人密码 → 403');
  const self = await call('POST', `/v1/members/${boss.userId}/reset-password`, { token: boss.token, body: {} });
  ok(self.status === 400 && self.body.error.code === 'USE_CHANGE', '老板重置自己 → 400（引导用改密）');
  const platReset = await call('POST', `/v1/platform/accounts/${boss.userId}/reset-password`, { token: plat.token, body: {} });
  ok(platReset.status === 200 && platReset.body.tempPassword, '平台重置老板密码（忘密兜底）→ 临时密码');
  const bossTemp = (await login('boss@ops.cn', platReset.body.tempPassword)).body.token;
  await call('POST', '/v1/auth/change-password', { token: bossTemp, body: { oldPassword: platReset.body.tempPassword, newPassword: PASS } });
  boss.token = (await login('boss@ops.cn', PASS)).body.token;   // 🔴 刷新失效令牌（重置已撤销旧会话）
}

/* ── ③ 备份 → 还原 ── */
console.log('— ③ 整库备份与还原 —');
{
  const denied = await call('GET', '/v1/platform/backup', { token: boss.token });
  ok(denied.status === 403, '非平台身份下载备份 → 403');
  const res = await fetch(base + '/v1/platform/backup', { headers: { authorization: `Bearer ${plat.token}` } });
  ok(res.status === 200 && /gzip/.test(res.headers.get('content-type')), '平台下载备份 → 200 gzip');
  const blob = await res.blob();
  ok(blob.size > 1000, `备份体积合理（${blob.size}B）`);
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const restored = new PGlite({ loadDataDir: blob, extensions: { pgcrypto } });
  const t = await restored.query(`select name from tenants where id = $1`, [tenantA]);
  ok(t.rows.length === 1 && t.rows[0].name === 'OPS公司', '还原库中租户数据完好');
  const acc = await restored.query(`select count(*)::int n from accounts`);
  ok(acc.rows[0].n >= 4, `还原库中账号完好（${acc.rows[0].n} 个）`);
  await restored.close();
}

/* ── ④ 邮箱验证码（mock SMTP） ── */
console.log('— ④ 邮箱验证码 —');
{
  process.env.AUTH_EMAIL_VERIFY = '1';
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(smtpPort);
  process.env.SMTP_TLS = '0'; process.env.SMTP_USER = 'u'; process.env.SMTP_PASS = 'p';
  process.env.SMTP_FROM = 'noreply@ops.cn';
  const noCode = await reg('code@ops.cn');
  ok(noCode.status === 400 && noCode.body.error.code === 'BAD_CODE', '启用后无码注册 → 400');
  const req1 = await call('POST', '/v1/auth/email-code', { body: { email: 'code@ops.cn' } });
  ok(req1.status === 200 && lastMail && /^\d{6}$/.test(lastMail.code || ''), `验证码已发信（收到 ${lastMail?.code}）`);
  const badCode = await reg('code@ops.cn', { code: '000000' });
  ok(badCode.status === 400, '错码注册 → 400');
  const good = await reg('code@ops.cn', { code: lastMail.code });
  ok(good.status === 201, '正确码 → 注册成功');
  const resend = await call('POST', '/v1/auth/email-code', { body: { email: 'code2@ops.cn' } });
  const tooSoon = await call('POST', '/v1/auth/email-code', { body: { email: 'code2@ops.cn' } });
  ok(resend.status === 200 && tooSoon.status === 429, '60 秒内重发 → 429（防轰炸）');
  const used = await reg('code@ops.cn', { code: lastMail.code });
  ok(used.status !== 201, '同一码不可复用（已消费 / 邮箱已注册）');
  delete process.env.AUTH_EMAIL_VERIFY; delete process.env.SMTP_HOST;
}

server.close(); smtp.close();
console.log(failures ? `\n❌ ${failures} 条未过` : '\n✅ 运营四件套验收全绿');
process.exit(failures ? 1 : 0);
