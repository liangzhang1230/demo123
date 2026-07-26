/* ============================================================
   注册邮箱验证码（AUTH_EMAIL_VERIFY=1 启用；需 SMTP 已配置）
   - requestCode：生成 6 位码 → 库存 sha256 → 发信；60 秒内不重发（防轰炸）
   - verifyCode：校验（大小写无关不适用——纯数字）；错 5 次作废；用后即删
   - 库不存明文码；邮件正文只含码，无任何业务数据（A-C07 同魂）
   ============================================================ */
import { randomInt, createHash } from 'node:crypto';
import { sendMail, smtpConfigured } from './mailer.mjs';
import { normEmail, validEmail } from './auth.mjs';

const sha256 = t => createHash('sha256').update(t).digest('hex');
const q = async (db, sql, p = []) => (await db.query(sql, p)).rows;
const CODE_TTL_MS = Number(process.env.EMAIL_CODE_TTL_MS || 10 * 60 * 1000);
const RESEND_GAP_MS = 60 * 1000;

export function emailVerifyEnabled() {
  return process.env.AUTH_EMAIL_VERIFY === '1';
}

export async function requestCode(db, rawEmail) {
  const email = normEmail(rawEmail);
  if (!validEmail(email)) { const e = new Error('邮箱格式不对'); e.httpStatus = 400; e.httpCode = 'BAD_EMAIL'; throw e; }
  if (!smtpConfigured()) { const e = new Error('邮件服务未配置'); e.httpStatus = 503; e.httpCode = 'SMTP_OFF'; throw e; }
  const existing = await q(db, `select sent_at from email_codes where email = $1`, [email]);
  if (existing.length && (Date.now() - new Date(existing[0].sent_at).getTime()) < RESEND_GAP_MS) {
    const e = new Error('验证码刚发过，请 1 分钟后再试'); e.httpStatus = 429; e.httpCode = 'CODE_TOO_SOON'; throw e;
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await q(db,
    `insert into email_codes(email, code_hash, expires_at, attempts, sent_at)
       values ($1, $2, now() + ($3::bigint * interval '1 millisecond'), 0, now())
     on conflict (email) do update set code_hash = excluded.code_hash,
       expires_at = excluded.expires_at, attempts = 0, sent_at = now()`,
    [email, sha256(code), String(CODE_TTL_MS)]);
  await sendMail({
    to: email,
    subject: '销冠操盘系统 · 注册验证码',
    text: `你的验证码是 ${code}，${Math.round(CODE_TTL_MS / 60000)} 分钟内有效。若非本人操作请忽略本邮件。`,
  });
  return { sent: true };
}

/** 校验通过即消费（删除）；返回 true/false。错 5 次作废。 */
export async function verifyCode(db, rawEmail, code) {
  const email = normEmail(rawEmail);
  const rows = await q(db,
    `select code_hash, attempts, (expires_at > now()) as alive from email_codes where email = $1`, [email]);
  if (!rows.length || !rows[0].alive) return false;
  if (rows[0].attempts >= 5) { await q(db, `delete from email_codes where email = $1`, [email]); return false; }
  if (rows[0].code_hash !== sha256(String(code || ''))) {
    await q(db, `update email_codes set attempts = attempts + 1 where email = $1`, [email]);
    return false;
  }
  await q(db, `delete from email_codes where email = $1`, [email]);
  return true;
}
