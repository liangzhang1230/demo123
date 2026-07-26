/* ============================================================
   零依赖 SMTP 客户端（发验证码专用，非通用邮件库）
   - 生产：SMTP_HOST/SMTP_PORT(默认465)/SMTP_USER/SMTP_PASS/SMTP_FROM
     465 = 隐式 TLS（QQ企业邮/163/阿里企业邮均支持）
   - 测试：SMTP_TLS=0 时走明文 TCP（仅供本地 mock 服务器，生产禁用）
   - 协议面最小实现：EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT
   ============================================================ */
import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect } from 'node:net';

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

function openSocket(host, port, useTls) {
  return new Promise((resolve, reject) => {
    const sock = useTls
      ? tlsConnect({ host, port, servername: host }, () => resolve(sock))
      : netConnect({ host, port }, () => resolve(sock));
    sock.once('error', reject);
    sock.setTimeout(15000, () => { sock.destroy(); reject(new Error('SMTP 连接超时')); });
  });
}

/* 逐命令对话：send(cmd) → 等一行以数字状态码开头的响应 */
function dialogue(sock) {
  let buf = '';
  const waiters = [];
  sock.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      /* 多行响应（250-xxx）继续吞，直到 "250 " 空格分隔的终行 */
      if (/^\d{3}-/.test(line)) continue;
      const w = waiters.shift();
      if (w) w.resolve(line);
    }
  });
  return {
    expect: (want) => new Promise((resolve, reject) => {
      waiters.push({ resolve: line => {
        if (line.startsWith(String(want))) resolve(line);
        else reject(new Error(`SMTP 期望 ${want}，得到：${line.slice(0, 120)}`));
      } });
    }),
    send: cmd => sock.write(cmd + '\r\n'),
  };
}

/**
 * 发一封纯文本邮件。所有参数走 env；失败抛错（调用方决定是否吞）。
 * 🔴 主题/正文只放验证码与提示，永不放业务数据。
 */
export async function sendMail({ to, subject, text }) {
  if (!smtpConfigured()) throw new Error('SMTP 未配置（SMTP_HOST/USER/PASS/FROM）');
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const useTls = process.env.SMTP_TLS !== '0';
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS, from = process.env.SMTP_FROM;

  const sock = await openSocket(host, port, useTls);
  const d = dialogue(sock);
  try {
    await d.expect(220);
    d.send(`EHLO suite-cloud`);        await d.expect(250);
    d.send(`AUTH LOGIN`);              await d.expect(334);
    d.send(Buffer.from(user).toString('base64'));  await d.expect(334);
    d.send(Buffer.from(pass).toString('base64'));  await d.expect(235);
    d.send(`MAIL FROM:<${from}>`);     await d.expect(250);
    d.send(`RCPT TO:<${to}>`);         await d.expect(250);
    d.send(`DATA`);                    await d.expect(354);
    const headers = [
      `From: =?UTF-8?B?${Buffer.from('销冠操盘系统').toString('base64')}?= <${from}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
    ].join('\r\n');
    const body = Buffer.from(text).toString('base64').replace(/(.{76})/g, '$1\r\n');
    d.send(headers + '\r\n\r\n' + body + '\r\n.');
    await d.expect(250);
    d.send('QUIT');
  } finally {
    sock.end(); sock.destroy();
  }
  return { ok: true };
}
