import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import request from 'supertest';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { config } from '../server/config.js';
import { powFor } from './pow-helper.js';

const H = { 'X-Connectly-CSRF': '1' };
let app, A, B, C;
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function register(name) {
  const a = request.agent(app); const email = `${name}@fol.io`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: `${name} Test`, birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  r = await a.patch('/api/me').set(H).send({ username: name }); assert.equal(r.status, 200);
  return a;
}

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  app = createApp();
  A = await register('amy'); B = await register('ben'); C = await register('cat');
});
after(() => pool.end());

test('migration 013 turns friendships into follows additively (both directions for accepted)', async () => {
  const ids = Object.fromEntries((await pool.query('SELECT username, id FROM users')).rows.map((r) => [r.username, r.id]));
  await pool.query("INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted'), ($3, $1, 'pending')", [ids.amy, ids.ben, ids.cat]);
  const before = (await pool.query('SELECT count(*)::int n FROM friendships')).rows[0].n;
  await pool.query(fs.readFileSync('server/migrations/013_follow_model_shares.sql', 'utf8'));
  const f = (await pool.query('SELECT follower_id, followee_id FROM follows')).rows.map((r) => `${r.follower_id}>${r.followee_id}`);
  assert.ok(f.includes(`${ids.amy}>${ids.ben}`) && f.includes(`${ids.ben}>${ids.amy}`) && f.includes(`${ids.cat}>${ids.amy}`));
  assert.ok(!f.includes(`${ids.amy}>${ids.cat}`));
  assert.equal((await pool.query('SELECT count(*)::int n FROM friendships')).rows[0].n, before);
  await pool.query(fs.readFileSync('server/migrations/013_follow_model_shares.sql', 'utf8')); // idempotent
});

test('one-tap follow/unfollow with counts and lists; mutual follows count as friends audience', async () => {
  let r = await B.put('/api/users/cat/follow').set(H); assert.equal(r.status, 200); assert.equal(r.body.follower_count, 1);
  const p = await C.get('/api/users/cat'); assert.equal(p.body.follower_count, 1); assert.equal(p.body.following_count, 1);
  r = await C.get('/api/users/cat/followers'); assert.deepEqual(r.body.items.map((x) => x.username), ['ben']);
  r = await A.get('/api/users/amy/following'); assert.deepEqual(r.body.items.map((x) => x.username), ['ben']);
  const post = await C.post('/api/posts').set(H).field('body', 'friends only').field('visibility', 'friends');
  assert.equal(post.status, 201, JSON.stringify(post.body));
  assert.equal((await B.get(`/api/posts/${post.body.id}`)).status, 404); // one-way follow: no access
  await C.put('/api/users/ben/follow').set(H);
  assert.equal((await B.get(`/api/posts/${post.body.id}`)).status, 200); // mutual follow: access
  r = await B.delete('/api/users/cat/follow').set(H); assert.equal(r.body.following, false);
  assert.equal((await B.get(`/api/posts/${post.body.id}`)).status, 404);
});

test('home feed is follow-based', async () => {
  const x = await C.post('/api/posts').set(H).field('body', 'public by cat').field('visibility', 'public');
  const feedB = await B.get('/api/feed'); // ben follows amy only
  assert.ok(!feedB.body.items.some((p) => p.id === x.body.id));
  const f = await B.put('/api/users/cat/follow').set(H); assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.ok((await B.get('/api/feed')).body.items.some((p) => p.id === x.body.id));
});

test('daily follow safety limit with friendly message', async () => {
  config.followDailyLimit = 1;
  const r = await A.put('/api/users/cat/follow').set(H);
  assert.equal(r.status, 429); assert.equal(r.body.error, 'You’ve followed a lot of people today. Take a rest and try again tomorrow.');
  config.followDailyLimit = 500;
});

test('who reacted / commented / shared lists, and share tracking', async () => {
  const p = await A.post('/api/posts').set(H).field('body', 'hello world').field('visibility', 'public');
  const pid = p.body.id;
  await B.put(`/api/posts/${pid}/like`).set(H).send({ reaction: 'love' });
  await C.put(`/api/posts/${pid}/like`).set(H).send({ reaction: 'haha' });
  await B.post(`/api/posts/${pid}/comments`).set(H).send({ body: 'nice' });
  await B.post(`/api/posts/${pid}/comments`).set(H).send({ body: 'again' });
  let r = await A.get(`/api/posts/${pid}/reactions`);
  assert.deepEqual(r.body.items.map((x) => [x.user.username, x.reaction]).sort(), [['ben', 'love'], ['cat', 'haha']]);
  r = await A.get(`/api/posts/${pid}/commenters`); assert.equal(r.body.items[0].user.username, 'ben'); assert.equal(r.body.items[0].comments, 2);
  r = await C.post(`/api/posts/${pid}/share`).set(H).send({ channel: 'whatsapp' }); assert.equal(r.status, 201); assert.equal(r.body.share_count, 1);
  r = await C.post(`/api/posts/${pid}/share`).set(H).send({ channel: 'whatsapp' }); assert.equal(r.body.share_count, 1); // no double count
  assert.equal((await C.post(`/api/posts/${pid}/share`).set(H).send({ channel: 'bogus' })).status, 400);
  r = await A.get(`/api/posts/${pid}/shares`); assert.equal(r.body.items[0].user.username, 'cat'); assert.deepEqual(r.body.items[0].channels, ['whatsapp']);
  assert.equal((await A.get(`/api/posts/${pid}`)).body.share_count, 1);
  // block hides the person from the lists
  await A.put('/api/users/cat/block').set(H);
  assert.equal((await A.get(`/api/posts/${pid}/reactions`)).body.items.length, 1);
});
