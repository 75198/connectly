import crypto from 'node:crypto';
import { q } from './db.js';
import { sendMail } from './mailer.js';
const SECRET = process.env.CODE_SECRET || 'connectly-code-pepper';
const TTL_MIN = 10, MAX_ATTEMPTS = 5, COOLDOWN_SEC = 60;
const hash = (userId, purpose, code) => crypto.createHmac('sha256', SECRET).update(`${userId}:${purpose}:${code}`).digest('hex');
const COPY = {
  verify_email: (c) => ['Your Connectly confirmation code', `Your Connectly confirmation code is ${c}\n\nIt expires in ${TTL_MIN} minutes. If you didn't sign up, ignore this email.`],
  reset_password: (c) => ['Your Connectly password reset code', `Your Connectly password reset code is ${c}\n\nIt expires in ${TTL_MIN} minutes. If you didn't ask for this, ignore this email.`],
};
// Returns { ok:true } or { ok:false, retryAfter } when within cooldown.
export async function issueCode(user, purpose) {
  const { rows } = await q(`SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS age FROM email_codes WHERE user_id=$1 AND purpose=$2 ORDER BY id DESC LIMIT 1`, [user.id, purpose]);
  if (rows[0] && rows[0].age < COOLDOWN_SEC) return { ok: false, retryAfter: COOLDOWN_SEC - rows[0].age };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await q(`UPDATE email_codes SET used_at = now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL`, [user.id, purpose]);
  await q(`INSERT INTO email_codes (user_id, purpose, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '${TTL_MIN} minutes')`, [user.id, purpose, hash(user.id, purpose, code)]);
  const [subject, text] = COPY[purpose](code);
  await sendMail({ to: user.email, subject, text });
  return { ok: true };
}
// Checks a code; counts attempts. Returns 'ok' | 'invalid' | 'expired' | 'locked'.
export async function consumeCode(userId, purpose, code) {
  const { rows } = await q(`SELECT id, code_hash, attempts, expires_at < now() AS expired FROM email_codes WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL ORDER BY id DESC LIMIT 1`, [userId, purpose]);
  const r = rows[0];
  if (!r || r.expired) return 'expired';
  if (r.attempts >= MAX_ATTEMPTS) return 'locked';
  const good = crypto.timingSafeEqual(Buffer.from(r.code_hash), Buffer.from(hash(userId, purpose, code)));
  if (!good) {
    const { rows: u } = await q('UPDATE email_codes SET attempts = attempts + 1 WHERE id=$1 RETURNING attempts', [r.id]);
    if (u[0].attempts >= MAX_ATTEMPTS) { await q('UPDATE email_codes SET used_at = now() WHERE id=$1', [r.id]); return 'locked'; }
    return 'invalid';
  }
  await q('UPDATE email_codes SET used_at = now() WHERE id=$1', [r.id]);
  return 'ok';
}
export const CODE_ERRORS = { invalid: 'That code is not correct', expired: 'Code expired or not found — request a new one', locked: 'Too many wrong attempts — request a new code' };
