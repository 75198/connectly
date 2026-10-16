import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { config } from '../server/config.js';
import { testOutbox } from '../server/mailer.js';
import { powFor } from './pow-helper.js';
import { H } from './helpers7.js';
import { friendly, loadIpDb, countryOfIp, setRates } from '../server/pricing.js';

let app, A;
const code = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function reg(name) {
  const a = request.agent(app); const email = `${name}@cur.io`; const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: 'Test ' + name, birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: code(email) }); assert.equal(r.status, 200);
  const me = (await a.get('/api/me')).body; a.id = me.id; return a;
}
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await migrate({ quiet: true });
  config.features.localCurrency = true; config.features.subscriptions = true; config.features.gifts = true;
  setRates({ NGN: 1500, GBP: 0.8, EUR: 0.9, KES: 130 });
  loadIpDb('"1.0.0.0","1.0.0.255","AU"\n"41.58.0.0","41.58.255.255","NG"\n"2c0f:f5c0::","2c0f:f5c0:ffff:ffff:ffff:ffff:ffff:ffff","NG"\n');
  app = createApp(); A = await reg('ada');
});
after(async () => { await pool.end(); });

test('offline IP lookup and friendly rounding', () => {
  assert.equal(countryOfIp('41.58.10.20'), 'NG'); assert.equal(countryOfIp('::ffff:1.0.0.7'), 'AU'); assert.equal(countryOfIp('2c0f:f5c0:1::1'), 'NG'); assert.equal(countryOfIp('9.9.9.9'), null); assert.equal(countryOfIp('127.0.0.1'), null);
  assert.equal(friendly(4.2, 'USD'), 4.99); assert.equal(friendly(1484, 'NGN'), 1500); assert.equal(friendly(14850, 'NGN'), 15000); assert.equal(friendly(0.4, 'GBP'), 0.99);
});

test('region: timezone hint, manual override; plans keep legacy price in their own currency and convert elsewhere', async () => {
  let r = (await A.get('/api/pricing/context?tz=Africa/Lagos')).body; assert.equal(r.country, 'NG'); assert.equal(r.currency, 'NGN'); assert.equal(r.source, 'timezone');
  let p = (await A.get('/api/subscriptions/plans?tz=Africa/Lagos')).body.items.find((x) => x.code === 'pro');
  assert.deepEqual(p.local, { amount: 1500, currency: 'NGN', exact: true }); // unchanged for existing NG users
  assert.equal((await A.patch('/api/me/region').set(H).send({ country: 'GB' })).body.currency, 'GBP');
  p = (await A.get('/api/subscriptions/plans').set('x-client-tz', 'Africa/Lagos')).body.items.find((x) => x.code === 'pro');
  assert.equal(p.local.currency, 'GBP'); assert.equal(p.local.exact, false); assert.equal(p.local.amount, 0.99);
  assert.equal((await A.patch('/api/me/region').set(H).send({ currency: 'EUR' })).body.currency, 'EUR');
  await A.patch('/api/me/region').set(H).send({ country: null, currency: null });
});

test('admin: USD base + per-country override; coin packs priced locally', async () => {
  assert.equal((await A.put('/api/admin/prices/plan:pro').set(H).send({ usd_cents: 499 })).status, 403);
  await pool.query("INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING", [A.id]);
  assert.equal((await A.put('/api/admin/prices/plan:pro').set(H).send({ usd_cents: 499 })).status, 200);
  assert.equal((await A.put('/api/admin/prices/plan:pro/KE').set(H).send({ currency: 'KES', amount_minor: 45000 })).status, 200);
  let p = (await A.get('/api/subscriptions/plans?tz=Africa/Lagos')).body.items.find((x) => x.code === 'pro');
  assert.deepEqual(p.local, { amount: 7500, currency: 'NGN', exact: false });
  p = (await A.get('/api/subscriptions/plans?tz=Africa/Nairobi')).body.items.find((x) => x.code === 'pro');
  assert.deepEqual(p.local, { amount: 450, currency: 'KES', exact: true });
  const packs = (await A.get('/api/coins/packs?tz=Europe/London')).body.packs;
  assert.equal(packs[0].coins, 100); assert.equal(packs[0].price.currency, 'GBP');
  assert.ok((await A.get('/api/admin/prices')).body.overrides.length === 1);
  assert.equal((await A.delete('/api/admin/prices/plan:pro/KE').set(H)).status, 200);
});

test('save to gallery: watermarked public photo; blocked for friends-only, opted-out, private and licensed music', async () => {
  const fs = await import('node:fs'); const path = await import('node:path'); const sharp = (await import('sharp')).default;
  config.features.downloads = true;
  fs.mkdirSync(config.uploadDir, { recursive: true }); await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a7' } }).jpeg().toFile(path.join(config.uploadDir, 'dl-test.jpg'));
  const mk = async (vis) => (await pool.query("INSERT INTO posts (author_id, body, image_path, visibility) VALUES ($1, 'hi', '/uploads/dl-test.jpg', $2) RETURNING id", [A.id, vis])).rows[0].id;
  const pub = await mk('public'), fr = await mk('friends');
  const B = await reg('bea');
  let r = await B.get(`/api/posts/${pub}/download`).buffer(true); assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/jpeg');
  const m = await sharp(r.body).metadata(); assert.equal(m.width, 800); // original size kept
  assert.equal((await B.get(`/api/posts/${fr}/download`)).status, 403);
  assert.equal((await A.patch(`/api/posts/${pub}/downloads`).set(H).send({ allow: false })).status, 200);
  assert.match((await B.get(`/api/posts/${pub}/download`)).body.error, /turned off/);
  await A.patch(`/api/posts/${pub}/downloads`).set(H).send({ allow: null });
  await A.patch('/api/me/privacy').set(H).send({ allow_downloads: false }); assert.equal((await B.get(`/api/posts/${pub}/download`)).status, 403);
  await A.patch('/api/me/privacy').set(H).send({ allow_downloads: true }); assert.equal((await B.get(`/api/posts/${pub}/download-check`)).body.ok, true);
  const { rows: [t] } = await pool.query("INSERT INTO music_tracks (external_id, title, artist, duration_seconds, url, license, source_url) VALUES ('t-hit', 'Hit', 'Label', 30, '/x.mp3', 'All rights reserved', 'https://x') RETURNING id");
  await pool.query('UPDATE posts SET music_track_id = $1 WHERE id = $2', [t.id, pub]);
  assert.match((await B.get(`/api/posts/${pub}/download`)).body.error, /licensed music/);
  await pool.query('UPDATE users SET is_private = true WHERE id = $1', [A.id]); await pool.query('UPDATE posts SET music_track_id = NULL WHERE id = $1', [pub]);
  assert.equal((await B.get(`/api/posts/${pub}/download`)).status, 403);
});
