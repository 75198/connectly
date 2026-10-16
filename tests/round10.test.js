import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp, pool, purgeScheduledDeletions } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { config } from '../server/config.js';
import { testOutbox } from '../server/mailer.js';
import { powFor } from './pow-helper.js';
import { H } from './helpers7.js';

let app, A, B, C;
const code = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function reg(name, full = 'Test ' + name) {
  const a = request.agent(app); const email = `${name}@r10.io`; const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: full, birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: code(email) }); assert.equal(r.status, 200);
  const me = (await a.get('/api/me')).body; a.id = me.id; a.username = me.username; a.email = email; return a;
}
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await migrate({ quiet: true });
  for (const k of ['friendsFeed', 'tips', 'gifts', 'liteMode', 'safetyCenter', 'antiScam', 'messages', 'closeFriends', 'reports', 'aiCreator', 'translate', 'autoTranslate', 'msgControls', 'paidVerification', 'hidePresence']) config.features[k] = true;
  app = createApp(); A = await reg('ann'); B = await reg('ben'); C = await reg('cat');
});
after(async () => { await pool.end(); });

test('friends feed: only mutuals and close friends', async () => {
  for (const [x, y] of [[A, B], [B, A], [A, C]]) await x.put(`/api/users/${y.username}/follow`).set(H);
  await B.post('/api/posts').set(H).field('body', 'from mutual ben').field('visibility', 'public');
  await C.post('/api/posts').set(H).field('body', 'from one-way cat').field('visibility', 'public');
  const items = (await A.get('/api/feed/friends')).body.items.map((p) => p.body);
  assert.ok(items.includes('from mutual ben')); assert.ok(!items.includes('from one-way cat'));
});

test('tips move coins, show in earnings; no self-tips; insufficient coins says coming soon', async () => {
  assert.equal((await A.post('/api/tips').set(H).send({ username: B.username, coins: 10 })).status, 402);
  await pool.query('INSERT INTO coin_wallets (user_id, balance) VALUES ($1, 100)', [A.id]);
  assert.equal((await A.post('/api/tips').set(H).send({ username: A.username, coins: 10 })).status, 400);
  const r = await A.post('/api/tips').set(H).send({ username: B.username, coins: 50 }); assert.equal(r.status, 200); assert.equal(r.body.balance, 50);
  const e = (await B.get('/api/me/earnings')).body; assert.equal(e.total, 50); assert.equal(e.tips, 50); assert.equal(e.top_supporters[0].username, A.username); assert.equal(e.days.length, 14);
});

test('AI creator helper needs text for improve; translate cache table exists', async () => {
  assert.ok([400, 503].includes((await A.post('/api/ai/creator').set(H).send({ action: 'improve', text: '' })).status));
  await pool.query("INSERT INTO translations (hash, target, text) VALUES ('x', 'fr', 'bonjour')");
});

test('prefs: auto-translate and lite mode saved', async () => {
  await A.patch('/api/me/prefs').set(H).send({ auto_translate: true, lite_mode: 'on' });
  const me = (await A.get('/api/me')).body; assert.equal(me.auto_translate, true); assert.equal(me.lite_mode, 'on');
});

test('impersonation of a verified name is flagged; scam reports come first and reporter is notified', async () => {
  await pool.query("UPDATE users SET verified_at = now(), full_name = 'Famous Star' WHERE id = $1", [B.id]);
  await C.patch('/api/me').set(H).send({ full_name: 'Famous  Star' });
  const { rows } = await pool.query("SELECT kind FROM safety_flags WHERE user_id = $1", [C.id]); assert.equal(rows[0]?.kind, 'impersonation');
  assert.equal((await A.post('/api/reports').set(H).send({ target_type: 'user', username: C.username, reason: 'Spam' })).status, 201);
  assert.equal((await A.post('/api/reports').set(H).send({ target_type: 'user', username: B.username, reason: 'Scam or fraud' })).status, 201);
  await pool.query("INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING", [B.id]);
  const list = (await B.get('/api/admin/reports?status=open')).body.items; assert.match(list[0].reason, /^Scam/);
  assert.equal((await B.get('/api/admin/safety-flags')).body.items.length, 1);
  await B.post(`/api/admin/reports/${list[1].id}/dismiss`).set(H);
  const n = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'report_reviewed'", [A.id]); assert.equal(n.rowCount, 1);
  assert.equal((await A.get('/api/me/reports')).body.items.length, 2);
});

test('delete account: 30-day grace, logging in cancels, purge after grace', async () => {
  const D = await reg('dan');
  assert.equal((await D.post('/api/me/delete').set(H).send({ password: 'Password123!' })).body.scheduled, true);
  assert.ok((await pool.query('SELECT delete_after FROM users WHERE id = $1', [D.id])).rows[0].delete_after);
  await request(app).post('/api/auth/login').set(H).send({ login: D.email, password: 'Password123!' });
  assert.equal((await pool.query('SELECT delete_after FROM users WHERE id = $1', [D.id])).rows[0].delete_after, null);
  const E = await reg('eve'); await E.post('/api/me/delete').set(H).send({ password: 'Password123!' });
  await pool.query("UPDATE users SET delete_after = now() - interval '1 minute' WHERE id = $1", [E.id]);
  await purgeScheduledDeletions(); assert.equal((await pool.query('SELECT 1 FROM users WHERE id = $1', [E.id])).rowCount, 0);
});

test('message controls: edit within 15 min, delete for me, read receipts off', async () => {
  await pool.query('UPDATE users SET dm_privacy = \'everyone\'').catch(() => {});
  let r = await A.post('/api/conversations').set(H).send({ usernames: [B.username] }); const cid = r.body.id; assert.ok(cid, JSON.stringify(r.body));
  r = await A.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'helo'); const mid = r.body.id; assert.ok(mid);
  r = await A.patch(`/api/messages/${mid}`).set(H).send({ body: 'hello' }); assert.equal(r.status, 200); assert.ok(r.body.edited_at);
  r = await B.patch(`/api/messages/${mid}`).set(H).send({ body: 'x' }); assert.equal(r.status, 403);
  await pool.query("UPDATE messages SET created_at = now() - interval '20 minutes' WHERE id = $1", [mid]);
  r = await A.patch(`/api/messages/${mid}`).set(H).send({ body: 'late' }); assert.equal(r.status, 403);
  r = await B.post(`/api/messages/${mid}/hide`).set(H); assert.equal(r.status, 200);
  r = await B.get(`/api/conversations/${cid}/messages`); assert.ok(!r.body.items.some((m) => m.id === mid), 'hidden for B');
  r = await A.get(`/api/conversations/${cid}/messages`); assert.ok(r.body.items.some((m) => m.id === mid && m.edited_at), 'still visible for A');
});

test('paid verification: requirements gate, flag off hides it', async () => {
  let r = await A.get('/api/me/paid-verification'); assert.equal(r.status, 200); assert.equal(r.body.payments_ready, false);
  assert.ok(r.body.checks.find((c) => c.key === 'age' && !c.ok));
  r = await A.post('/api/me/paid-verification').set(H); assert.equal(r.status, 400);
  config.features.paidVerification = false; r = await A.get('/api/me/paid-verification'); assert.equal(r.status, 404); config.features.paidVerification = true;
});
