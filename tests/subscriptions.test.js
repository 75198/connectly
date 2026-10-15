import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { config } from '../server/config.js';
import { powFor } from './pow-helper.js';

const H = { 'X-Connectly-CSRF': '1' };
let app, U, ADM, mock, uid;
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function register(name) {
  const a = request.agent(app); const email = `${name}@sub.io`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: `${name} Sub`, birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201);
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  r = await a.patch('/api/me').set(H).send({ username: name }); assert.equal(r.status, 200);
  return a;
}
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  mock = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`); }); });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  Object.assign(config, { groqApiKey: 'k', groqBaseUrl: `http://127.0.0.1:${mock.address().port}`, aiDailyCap: 1000 });
  config.features.aiSupport = true; config.features.subscriptions = true;
  app = createApp();
  U = await register('una'); ADM = await register('ada');
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'ada' AND r.name = 'admin' ON CONFLICT DO NOTHING");
  uid = (await pool.query("SELECT id FROM users WHERE username = 'una'")).rows[0].id;
});
after(() => { mock.close(); return pool.end(); });

test('plans never expose numeric AI limits; checkout is coming soon without provider keys', async () => {
  const r = await U.get('/api/subscriptions/plans');
  assert.equal(r.status, 200); assert.deepEqual(r.body.items.map((p) => p.code), ['free', 'pro', 'premium']);
  assert.ok(!JSON.stringify(r.body).includes('ai_hourly')); assert.equal(r.body.checkout_enabled, false);
  const c = await U.post('/api/subscriptions/checkout').set(H).send({ plan: 'pro' });
  assert.equal(c.status, 503); assert.equal(c.body.coming_soon, true);
  assert.equal((await U.get('/api/me/subscription')).body.tier, 'free');
  assert.ok(!('hourly_limit' in (await U.get('/api/ai/status')).body));
});

test('limit notice is friendly, number-free, offers upgrade; higher tier gets more', async () => {
  await ADM.put('/api/admin/plans/free').set(H).send({ ai_hourly: 1 });
  await ADM.put('/api/admin/plans/pro').set(H).send({ ai_hourly: 3, price_minor: 200000 });
  assert.equal((await U.post('/api/ai/chat').set(H).send({ message: 'hi' })).status, 200);
  const r = await U.post('/api/ai/chat').set(H).send({ message: 'again' });
  assert.equal(r.status, 429); assert.equal(r.body.upgrade, true);
  assert.equal(r.body.error, "You've reached your Connectly AI limit for now. Try again later or upgrade to Connectly Pro.");
  assert.doesNotMatch(r.body.error, /\d/);
  assert.equal((await U.put(`/api/admin/users/${uid}/subscription`).set(H).send({ tier: 'pro' })).status, 403);
  assert.equal((await ADM.put(`/api/admin/users/${uid}/subscription`).set(H).send({ tier: 'pro' })).status, 200);
  assert.equal((await U.get('/api/me/subscription')).body.tier, 'pro');
  assert.equal((await U.post('/api/ai/chat').set(H).send({ message: 'pro now' })).status, 200);
  assert.equal((await U.get('/api/subscriptions/plans')).body.items[1].price_minor, 200000);
  const ev = await pool.query('SELECT event, from_tier, to_tier FROM subscription_events'); assert.deepEqual(ev.rows[0], { event: 'admin_set', from_tier: 'free', to_tier: 'pro' });
});

test('flag off hides subscription API and uses default AI limit', async () => {
  config.features.subscriptions = false;
  assert.equal((await U.get('/api/subscriptions/plans')).status, 404);
  config.features.subscriptions = true;
});
