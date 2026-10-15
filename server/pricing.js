// Local currency. Country is detected privately: user override > our own offline IP-to-country table
// (DB-IP Lite, CC BY 4.0, downloaded to server/data; user IPs never leave the server) > browser timezone > locale region.
// Rates: open.er-api.com (free, no key), cached once a day. Prices: admin USD base + per-country overrides, rounded to friendly points.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';

const F = config.features;
const flag = (_req, res, next) => (F.localCurrency ? next() : res.status(404).json({ error: 'Not found' }));
const DATA = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'data');

export const CURRENCY_OF = { NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR', EG: 'EGP', MA: 'MAD', TZ: 'TZS', UG: 'UGX', RW: 'RWF', ET: 'ETB', CM: 'XAF', SN: 'XOF', CI: 'XOF', BJ: 'XOF', TG: 'XOF', ML: 'XOF', BF: 'XOF', NE: 'XOF', DZ: 'DZD', TN: 'TND', ZM: 'ZMW', ZW: 'USD', MW: 'MWK', MZ: 'MZN', AO: 'AOA', BW: 'BWP', NA: 'NAD', SL: 'SLE', LR: 'LRD', GM: 'GMD', CD: 'CDF', SD: 'SDG', SO: 'SOS',
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', JM: 'JMD', TT: 'TTD',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', HR: 'EUR', CY: 'EUR', MT: 'EUR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', UA: 'UAH', TR: 'TRY', RU: 'RUB', IL: 'ILS',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', JO: 'JOD', LB: 'LBP', IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR',
  CN: 'CNY', HK: 'HKD', TW: 'TWD', JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', ID: 'IDR', TH: 'THB', VN: 'VND', PH: 'PHP', AU: 'AUD', NZ: 'NZD' };
const TZ_COUNTRY = { 'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kampala': 'UG', 'Africa/Kigali': 'RW', 'Africa/Addis_Ababa': 'ET', 'Africa/Douala': 'CM', 'Africa/Dakar': 'SN', 'Africa/Abidjan': 'CI', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Lusaka': 'ZM', 'Africa/Harare': 'ZW',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Lisbon': 'PT', 'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Warsaw': 'PL', 'Europe/Istanbul': 'TR', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Kolkata': 'IN', 'Asia/Karachi': 'PK', 'Asia/Tokyo': 'JP', 'Asia/Shanghai': 'CN', 'Asia/Singapore': 'SG', 'Australia/Sydney': 'AU',
  'America/Toronto': 'CA', 'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX' };

// ---- offline IP -> country (in-memory sorted ranges) ----
let v4s = null, v4e = null, v4c = null, v6s = null, v6e = null, v6c = null;
const ip4 = (s) => s.split('.').reduce((a, b) => a * 256 + Number(b), 0);
function ip6hi(s) { // first 64 bits as BigInt
  let [h, t = ''] = s.split('::'); const a = h ? h.split(':') : [], b = t ? t.split(':') : [];
  const full = s.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return full.slice(0, 4).reduce((x, p) => (x << 16n) + BigInt(parseInt(p || '0', 16)), 0n);
}
export function loadIpDb(csvText) {
  const a4 = [], a6 = [];
  for (const line of csvText.split('\n')) {
    const [start, end, cc] = line.replace(/"/g, '').split(','); if (!start || !end || !cc || cc.length !== 2 || cc === 'ZZ') continue;
    if (start.includes(':')) a6.push([ip6hi(start), ip6hi(end), cc]); else a4.push([ip4(start), ip4(end), cc]);
  }
  v4s = Float64Array.from(a4, (x) => x[0]); v4e = Float64Array.from(a4, (x) => x[1]); v4c = a4.map((x) => x[2]);
  v6s = a6.map((x) => x[0]); v6e = a6.map((x) => x[1]); v6c = a6.map((x) => x[2]);
  return a4.length + a6.length;
}
const bsearch = (arr, v) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
export function countryOfIp(ip) {
  if (!ip || !v4s) return null; ip = ip.replace(/^::ffff:/, '');
  try {
    if (ip.includes(':')) { const v = ip6hi(ip), i = bsearch(v6s, v); return i >= 0 && v <= v6e[i] ? v6c[i] : null; }
    const v = ip4(ip), i = bsearch(v4s, v); return i >= 0 && v <= v4e[i] ? v4c[i] : null;
  } catch { return null; }
}
async function ensureIpDb() {
  fs.mkdirSync(DATA, { recursive: true }); const file = path.join(DATA, 'dbip-country-lite.csv.gz');
  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 35 * 864e5;
  if (!fresh && config.env !== 'test') {
    for (const back of [0, 1]) { // this month, else last month (published early in the month)
      const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back);
      const url = `https://download.db-ip.com/free/dbip-country-lite-${d.toISOString().slice(0, 7)}.csv.gz`;
      try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); break; } } catch { /* retry later */ }
    }
  }
  if (fs.existsSync(file)) { try { const n = loadIpDb(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); console.log(`ip-country: ${n} ranges loaded`); } catch (e) { console.warn('ip-country load failed', e.message); } }
}

// ---- exchange rates (USD base), cached daily ----
let rates = { USD: 1 }, ratesAt = 0;
export function setRates(r) { rates = { ...r, USD: 1 }; ratesAt = Date.now(); }
async function refreshRates() {
  const file = path.join(DATA, 'rates.json');
  try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (Date.now() - c.at < 864e5) { rates = c.rates; ratesAt = c.at; return; } } catch { /* none */ }
  if (config.env === 'test') return;
  try { const r = await (await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(15000) })).json();
    if (r.result === 'success') { setRates(r.rates); fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ at: ratesAt, rates })); } } catch { /* keep old */ }
}
export function startPricing() { if (!F.localCurrency) return; ensureIpDb(); refreshRates(); setInterval(refreshRates, 6 * 3600e3).unref(); setInterval(ensureIpDb, 7 * 864e5).unref(); }

const digitsOf = (cur) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; } catch { return 2; } };
export function friendly(amount, cur) { // major units -> friendly price point
  if (amount <= 0) return 0; const d = digitsOf(cur);
  if (amount < 100 && d > 0) return Math.max(0.99, Math.ceil(amount) - 0.01); // 4.99, 49.99
  if (amount < 100) return Math.ceil(amount);
  const mag = 10 ** (Math.floor(Math.log10(amount)) - 1), step = mag >= 10 ? mag / 2 : mag; // 2-3 significant digits
  const r = Math.round(amount / step) * step; return d > 0 && r < 1000 ? r - 0.01 : r;
}
export const convert = (amount, from, to) => (rates[from] && rates[to] ? (amount / rates[from]) * rates[to] : null);

export async function regionOf(req) {
  const u = req.user; const hint = { tz: String(req.query?.tz || req.get?.('x-client-tz') || ''), locale: String(req.query?.locale || req.get?.('accept-language') || '') };
  let country = u?.country_override || null, source = country ? 'manual' : null;
  if (!country) { country = countryOfIp(req.ip); if (country) source = 'network'; }
  if (!country && TZ_COUNTRY[hint.tz]) { country = TZ_COUNTRY[hint.tz]; source = 'timezone'; }
  if (!country) { const m = hint.locale.match(/^[a-z]{2,3}[-_]([A-Z]{2})/); if (m) { country = m[1]; source = 'language'; } }
  country ||= 'US'; source ||= 'default';
  const currency = u?.currency_override || CURRENCY_OF[country] || 'USD';
  return { country, currency, source, currency_manual: !!u?.currency_override };
}

// Price an item for a region. base = { usd_cents } or legacy { minor, currency } (legacy prices stay exact in their own currency).
export async function priceFor(item, base, region) {
  const { rows: [o] } = await q('SELECT currency, amount_minor FROM price_overrides WHERE item = $1 AND country = $2', [item, region.country]);
  if (o && (!region.currency_manual || o.currency.trim() === region.currency)) return { amount: Number(o.amount_minor) / 10 ** digitsOf(o.currency), currency: o.currency.trim(), exact: true };
  let amt, from;
  if (base.usd_cents != null) { amt = base.usd_cents / 100; from = 'USD'; } else { amt = base.minor / 100; from = base.currency; }
  if (from === region.currency) return { amount: amt, currency: from, exact: true };
  const c = convert(amt, from, region.currency);
  if (c == null) return { amount: amt, currency: from, exact: true };
  return { amount: friendly(c, region.currency), currency: region.currency, exact: false };
}

export function registerPricing(api, { requireAuth, requireAdmin }) {
  api.get('/pricing/context', flag, async (req, res) => {
    const r = await regionOf(req); res.json({ ...r, rates_updated: ratesAt ? new Date(ratesAt).toISOString() : null, rates });
  });
  api.patch('/me/region', requireAuth, flag, async (req, res) => {
    const d = z.object({ country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional() }).strict().parse(req.body);
    if (d.country !== undefined) await q('UPDATE users SET country_override = $2 WHERE id = $1', [req.user.id, d.country]);
    if (d.currency !== undefined) await q('UPDATE users SET currency_override = $2 WHERE id = $1', [req.user.id, d.currency]);
    const { rows: [u] } = await q('SELECT country_override, currency_override FROM users WHERE id = $1', [req.user.id]);
    res.json(await regionOf({ ...req, user: { ...req.user, ...u } }));
  });
  api.get('/coins/packs', requireAuth, flag, async (req, res) => {
    const region = await regionOf(req); const { rows } = await q("SELECT item, usd_cents FROM price_book WHERE item LIKE 'coins:%' AND usd_cents IS NOT NULL ORDER BY usd_cents");
    res.json({ region, packs: await Promise.all(rows.map(async (p) => ({ item: p.item, coins: Number(p.item.split(':')[1]), price: await priceFor(p.item, p, region) }))) });
  });
  // admin: USD base prices + per-country overrides
  api.get('/admin/prices', requireAdmin, flag, async (_req, res) => {
    const { rows: book } = await q('SELECT item, usd_cents FROM price_book ORDER BY item');
    const { rows: plans } = await q("SELECT code, price_minor, currency FROM plans WHERE code <> 'free' ORDER BY sort");
    const { rows: overrides } = await q('SELECT item, country, currency, amount_minor::float AS amount_minor FROM price_overrides ORDER BY item, country');
    res.json({ book, plans, overrides });
  });
  api.put('/admin/prices/:item', requireAdmin, flag, async (req, res) => {
    const item = String(req.params.item); if (!/^(plan:(pro|premium)|coins:\d{1,6})$/.test(item)) return res.status(400).json({ error: 'Unknown item' });
    const d = z.object({ usd_cents: z.number().int().min(0).max(1e8).nullable() }).strict().parse(req.body);
    await q('INSERT INTO price_book (item, usd_cents) VALUES ($1,$2) ON CONFLICT (item) DO UPDATE SET usd_cents = EXCLUDED.usd_cents, updated_at = now()', [item, d.usd_cents]); res.json({ ok: true });
  });
  api.put('/admin/prices/:item/:country', requireAdmin, flag, async (req, res) => {
    const d = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), amount_minor: z.number().int().min(0).max(1e12) }).strict().parse(req.body);
    const country = String(req.params.country).toUpperCase(); if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'Country code needed' });
    await q('INSERT INTO price_overrides (item, country, currency, amount_minor) VALUES ($1,$2,$3,$4) ON CONFLICT (item, country) DO UPDATE SET currency = EXCLUDED.currency, amount_minor = EXCLUDED.amount_minor, updated_at = now()', [req.params.item, country, d.currency, d.amount_minor]);
    res.json({ ok: true });
  });
  api.delete('/admin/prices/:item/:country', requireAdmin, flag, async (req, res) => { await q('DELETE FROM price_overrides WHERE item = $1 AND country = $2', [req.params.item, String(req.params.country).toUpperCase()]); res.json({ ok: true }); });
}
