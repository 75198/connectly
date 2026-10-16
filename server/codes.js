import crypto from 'node:crypto';
import { q } from './db.js';
import { sendMail } from './mailer.js';
import { sendSms } from './sms.js';
const SECRET = process.env.CODE_SECRET || 'connectly-code-pepper';
const TTL_MIN = 10, MAX_ATTEMPTS = 5, COOLDOWN_SEC = 60;
// Codes are keyed by identifier ("email:x@y.com" / "phone:+234...") because one email/phone can own several accounts.
const hash = (key, purpose, code) => crypto.createHmac('sha256', SECRET).update(`${key}:${purpose}:${code}`).digest('hex');
const COPY = {
  verify_email: (c) => ['Your Connectly confirmation code', `Your Connectly confirmation code is ${c}\n\nIt expires in ${TTL_MIN} minutes. If you didn't sign up, ignore this email.`],
  reset_password: (c) => ['Your Connectly password reset code', `Your Connectly password reset code is ${c}\n\nIt expires in ${TTL_MIN} minutes. If you didn't ask for this, ignore this email.`],
  change_identifier: (c) => ['Confirm your new Connectly email', `Your Connectly confirmation code is ${c}\n\nEnter it to confirm this as your new address. It expires in ${TTL_MIN} minutes. If you didn't ask for this, ignore this email.`],
  security_change: (c, x = {}) => [`Your Connectly security code: ${c}`, `Someone is trying to change your Connectly ${x.what || 'account details'} from ${x.device || 'an unknown device'}${x.place ? ` in ${x.place}` : ''} at ${x.time || 'just now'}.\n\nCode: ${c}\n\nIt expires in ${TTL_MIN} minutes. Never share this code with anyone, including people who say they work for Connectly.\n\nIf this wasn't you, secure your account now: ${x.secureUrl || ''}`],
  login_code: (c) => ['Your Connectly login code', `Your Connectly login code is ${c}. It expires in ${TTL_MIN} minutes. Never share it with anyone.`],
  find_account: (c) => ['Your Connectly account code', `Use ${c} to see the Connectly accounts linked to this address.\n\nIt expires in ${TTL_MIN} minutes. If you didn't ask for this, ignore this email.`],
};
export const keyOf = (id) => `${id.type}:${id.value}`;
// target: { key, email?, phone?, userId? }. Returns { ok:true } or { ok:false, retryAfter }.
export async function issueCode(target, purpose, ctx) {
  const { rows } = await q(`SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS age FROM email_codes WHERE identifier=$1 AND purpose=$2 ORDER BY id DESC LIMIT 1`, [target.key, purpose]);
  if (rows[0] && rows[0].age < COOLDOWN_SEC) return { ok: false, retryAfter: COOLDOWN_SEC - rows[0].age };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await q(`UPDATE email_codes SET used_at = now() WHERE identifier=$1 AND purpose=$2 AND used_at IS NULL`, [target.key, purpose]);
  await q(`INSERT INTO email_codes (identifier, user_id, purpose, code_hash, expires_at) VALUES ($1,$2,$3,$4, now() + interval '${TTL_MIN} minutes')`, [target.key, target.userId || null, purpose, hash(target.key, purpose, code)]);
  const [subject, text] = COPY[purpose](code, ctx);
  if (target.email) await sendMail({ to: target.email, subject, text });
  else {
    try { await sendSms(target.phone, `Connectly code: ${code} (expires in ${TTL_MIN} min). Never share it.`, code); }
    catch (err) { // every phone channel failed: fall back to the account's email, if it has one
      const { rows: [u] } = target.userId ? await q('SELECT email FROM users WHERE id = $1', [target.userId]) : { rows: [] };
      if (!u?.email) throw err;
      await sendMail({ to: u.email, subject, text }); return { ok: true, via: 'email' };
    }
  }
  return { ok: true };
}
// Returns 'ok' | 'invalid' | 'expired' | 'locked'.
export async function consumeCode(key, purpose, code) {
  const { rows } = await q(`SELECT id, code_hash, attempts, expires_at < now() AS expired FROM email_codes WHERE identifier=$1 AND purpose=$2 AND used_at IS NULL ORDER BY id DESC LIMIT 1`, [key, purpose]);
  const r = rows[0];
  if (!r || r.expired) return 'expired';
  if (r.attempts >= MAX_ATTEMPTS) return 'locked';
  const good = crypto.timingSafeEqual(Buffer.from(r.code_hash), Buffer.from(hash(key, purpose, code)));
  if (!good) {
    const { rows: u } = await q('UPDATE email_codes SET attempts = attempts + 1 WHERE id=$1 RETURNING attempts', [r.id]);
    if (u[0].attempts >= MAX_ATTEMPTS) { await q('UPDATE email_codes SET used_at = now() WHERE id=$1', [r.id]); return 'locked'; }
    return 'invalid';
  }
  await q('UPDATE email_codes SET used_at = now() WHERE id=$1', [r.id]);
  return 'ok';
}
export async function createTicket(key, purpose) {
  const t = crypto.randomBytes(24).toString('base64url');
  await q(`INSERT INTO identity_tickets (token_hash, identifier, purpose, expires_at) VALUES ($1,$2,$3, now() + interval '15 minutes')`, [crypto.createHash('sha256').update(t).digest('hex'), key, purpose]);
  return t;
}
export async function readTicket(t) {
  const { rows } = await q(`SELECT identifier, purpose FROM identity_tickets WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`, [crypto.createHash('sha256').update(String(t)).digest('hex')]);
  return rows[0] || null;
}
export async function useTicket(t) { await q('UPDATE identity_tickets SET used_at = now() WHERE token_hash=$1', [crypto.createHash('sha256').update(String(t)).digest('hex')]); }
export const CODE_ERRORS = { invalid: 'That code is not correct', expired: 'Code expired or not found — request a new one', locked: 'Too many wrong attempts — request a new code' };
