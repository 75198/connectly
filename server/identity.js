import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { z } from 'zod';
import { HttpError } from './uploads.js';
import { q } from './db.js';

const emailSchema = z.string().email().max(200);
// Returns { type: 'email'|'phone', value } (email lowercased, phone in E.164) or throws 400.
export function parseIdentifier(raw, country = 'US') {
  const s = String(raw || '').trim();
  if (!s) throw new HttpError(400, 'Enter your email or phone number');
  if (s.includes('@')) {
    const v = s.toLowerCase();
    if (!emailSchema.safeParse(v).success) throw new HttpError(400, 'That email address doesn’t look right');
    return { type: 'email', value: v };
  }
  if (!/^[+\d][\d\s().-]{4,}$/.test(s)) throw new HttpError(400, 'Enter a valid email or phone number');
  const p = parsePhoneNumberFromString(s, /^[A-Z]{2}$/.test(country) ? country : 'US');
  if (!p || !p.isValid()) throw new HttpError(400, 'That phone number doesn’t look right for the selected country');
  return { type: 'phone', value: p.number };
}
export const identCol = (id) => (id.type === 'email' ? 'lower(email)' : 'phone');

// Letters (any script), spaces, hyphens, apostrophes; 2-80 chars.
export const FullName = z.string().trim().transform((s) => s.replace(/\s+/g, ' '))
  .pipe(z.string().min(2, 'Enter your full name').max(80).regex(/^[\p{L}\p{M}][\p{L}\p{M}' ’-]*[\p{L}\p{M}]$/u, 'Names can only contain letters, spaces, hyphens and apostrophes'));

export const MIN_AGE = 13;
export function ageOn(dobStr, now = new Date()) {
  const d = new Date(dobStr + 'T00:00:00Z');
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
export const BirthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth')
  .refine((s) => { const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().startsWith(s); }, 'Enter a real date')
  .refine((s) => ageOn(s) <= 120, 'Enter a real date of birth')
  .refine((s) => ageOn(s) >= MIN_AGE, `You must be at least ${MIN_AGE} years old to use Connectly`);

// Auto-generate a unique username from the full name, e.g. "Ada Lovelace" -> adalovelace, adalovelace27
export async function generateUsername(fullName, client = { query: q }) {
  let base = fullName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 15);
  if (base.length < 3) base = (base + 'user').slice(0, 15);
  for (let i = 0; i < 20; i++) {
    const cand = i === 0 ? base : `${base}${Math.floor(Math.random() * (i < 10 ? 1000 : 100000))}`;
    const { rows } = await client.query('SELECT 1 FROM users WHERE lower(username) = $1', [cand]);
    if (!rows.length) return cand;
  }
  return `${base}${Date.now().toString(36)}`;
}
