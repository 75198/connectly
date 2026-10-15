// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) with no external dependency.
import crypto from 'node:crypto';
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() { const b = crypto.randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5), 2)]; return out; }
function decode(s) { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totpAt(secret, t = Date.now()) {
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', decode(secret)).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
export function verifyTotp(secret, code, t = Date.now()) {
  const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(totpAt(secret, t + w * 30000)), Buffer.from(c)));
}
