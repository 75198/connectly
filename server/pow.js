// Free, self-hosted bot check for signup: proof-of-work (like Hashcash / mCaptcha / Altcha).
// The server hands out an HMAC-signed challenge; the browser finds a counter such that
// SHA-256(challenge + ':' + counter) starts with `bits` zero bits (~0.5-2 s on a phone at 18 bits).
// Bots must spend CPU per signup; each challenge is single-use (pow_used table) and expires in 10 min.
import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';

const TTL_MS = 10 * 60 * 1000;
const sign = (s) => crypto.createHmac('sha256', config.codeSecret).update('pow:' + s).digest('base64url');

export function newChallenge() {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const body = `${nonce}.${Date.now() + TTL_MS}.${config.powBits}`;
  return { challenge: `${body}.${sign(body)}`, bits: config.powBits };
}
export function leadingZeroBits(buf) {
  let n = 0;
  for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; }
  return n;
}
export function solve(challenge, bits) { // used by tests and as reference implementation
  for (let i = 0; ; i++) if (leadingZeroBits(crypto.createHash('sha256').update(`${challenge}:${i}`).digest()) >= bits) return String(i);
}
// Returns null if OK, or an error message.
export async function verifyPow(pow) {
  if (!config.features.signupPow) return null;
  if (!pow || typeof pow.challenge !== 'string' || typeof pow.solution !== 'string' || pow.solution.length > 20) return 'Please complete the security check';
  const parts = pow.challenge.split('.');
  if (parts.length !== 4) return 'Security check is invalid. Please try again.';
  const [nonce, exp, bits, sig] = parts;
  const body = `${nonce}.${exp}.${bits}`;
  const good = Buffer.from(sign(body)); const given = Buffer.from(sig);
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return 'Security check is invalid. Please try again.';
  if (Number(exp) < Date.now()) return 'Security check expired. Please try again.';
  const hash = crypto.createHash('sha256').update(`${pow.challenge}:${pow.solution}`).digest();
  if (leadingZeroBits(hash) < Number(bits)) return 'Security check failed. Please try again.';
  const ins = await q('INSERT INTO pow_used (nonce) VALUES ($1) ON CONFLICT DO NOTHING', [nonce]);
  if (!ins.rowCount) return 'Security check was already used. Please try again.';
  q("DELETE FROM pow_used WHERE created_at < now() - interval '1 day'").catch(() => {}); // housekeeping of spent challenge ids only
  return null;
}
