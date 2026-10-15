import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import request from 'supertest';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { powFor } from './pow-helper.js';
import { approxLocation } from '../server/auth.js';
import { leadingZeroBits } from '../server/pow.js';

let app;
const H = { 'X-Connectly-CSRF': '1' };
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
const post = (a, url) => a.post(url).set(H);
const base = (email) => ({ identifier: email, password: 'Password123!', full_name: 'Safe Tester', birth_date: '1990-01-01', accept_terms: true });
async function register(name) {
  const a = request.agent(app); const email = `${name}@safe.io`;
  const pow = await powFor(a);
  let r = await post(a, '/api/auth/register').send({ ...base(email), pow }); assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await post(a, '/api/auth/verify').send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  r = await a.patch('/api/me').set(H).send({ username: name }); assert.equal(r.status, 200);
  return a;
}
const uid = async (u) => (await pool.query('SELECT id FROM users WHERE username = $1', [u])).rows[0].id;
let MOD, U1, U2;
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  app = createApp();
  MOD = await register('modmin'); U1 = await register('userone'); U2 = await register('usertwo');
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'admin'", [await uid('modmin')]);
});
after(() => pool.end());

test('signup requires a valid, single-use proof-of-work', async () => {
  const a = request.agent(app);
  let r = await post(a, '/api/auth/register').send(base('nopow@safe.io')); assert.equal(r.status, 400); assert.equal(r.body.code, 'POW_REQUIRED');
  const c = (await a.get('/api/auth/challenge')).body;
  assert.ok(c.challenge && c.bits >= 1);
  r = await post(a, '/api/auth/register').send({ ...base('bad@safe.io'), pow: { challenge: c.challenge.replace(/.$/, 'x'), solution: '0' } }); assert.equal(r.status, 400);
  const pow = await powFor(a);
  r = await post(a, '/api/auth/register').send({ ...base('ok1@safe.io'), pow }); assert.equal(r.status, 201);
  r = await post(a, '/api/auth/register').send({ ...base('ok2@safe.io'), pow }); assert.equal(r.status, 400, 'replay rejected'); assert.match(r.body.error, /already used/);
  assert.equal(leadingZeroBits(Buffer.from([0, 0x10])), 11);
});

test('no third-party IP geolocation', async () => {
  assert.equal(await approxLocation('8.8.8.8'), '');
  assert.ok(!fs.readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8').includes('ipapi'));
});

test('sessions slide to 60 days; sign out other devices also forgets saved logins elsewhere', async () => {
  const other = request.agent(app);
  let r = await post(other, '/api/auth/login').send({ login: 'userone@safe.io', password: 'Password123!' }); assert.equal(r.status, 200);
  const exp = (await pool.query('SELECT max(expires_at) AS e FROM sessions WHERE user_id = $1', [await uid('userone')])).rows[0].e;
  assert.ok(new Date(exp) - Date.now() > 59 * 864e5, '60-day session');
  // simulate an old session close to expiry; activity extends it
  await pool.query("UPDATE sessions SET expires_at = now() + interval '1 day', last_seen_at = now() - interval '1 hour' WHERE user_id = $1", [await uid('userone')]);
  r = await U1.get('/api/me'); assert.equal(r.status, 200);
  await new Promise((s) => setTimeout(s, 100));
  const min = (await pool.query('SELECT min(expires_at) AS e FROM sessions WHERE user_id = $1 AND last_seen_at > now() - interval \'1 minute\'', [await uid('userone')])).rows[0].e;
  assert.ok(new Date(min) - Date.now() > 59 * 864e5, 'sliding renewal');
  // the other device saves its login, then U1 signs out other devices
  r = await post(other, '/api/auth/logout').send({ save: true }); assert.equal(r.body.saved, true);
  r = await other.get('/api/auth/saved'); assert.equal(r.body.items.length, 1);
  r = await post(other, '/api/auth/saved/login').send({ user_id: await uid('userone') }); assert.equal(r.status, 200);
  r = await post(U1, '/api/me/sessions/logout-others').send({}); assert.equal(r.body.ended, 1); assert.equal(r.body.saved_removed, 1);
  r = await other.get('/api/me'); assert.equal(r.status, 401);
  r = await other.get('/api/auth/saved'); assert.equal(r.body.items.length, 0);
  r = await U1.get('/api/me'); assert.equal(r.status, 200, 'current device stays signed in');
});

test('expired saved logins stop working', async () => {
  const dev = request.agent(app);
  await post(dev, '/api/auth/login').send({ login: 'usertwo@safe.io', password: 'Password123!' });
  await post(dev, '/api/auth/logout').send({ save: true });
  await pool.query("UPDATE saved_logins SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [await uid('usertwo')]);
  let r = await dev.get('/api/auth/saved'); assert.equal(r.body.items.length, 0);
  r = await post(dev, '/api/auth/saved/login').send({ user_id: await uid('usertwo') }); assert.equal(r.status, 401);
});

test('report post/user and moderation queue: hide post, suspend user, all reversible', async () => {
  let r = await post(U2, '/api/posts').send({ body: 'spammy post' }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const pid = r.body.id;
  r = await post(U1, '/api/reports').send({ target_type: 'post', post_id: pid, reason: 'This is spam' }); assert.equal(r.status, 201);
  r = await post(U1, '/api/reports').send({ target_type: 'user', username: 'usertwo', reason: 'Spam account' }); assert.equal(r.status, 201);
  r = await post(U1, '/api/reports').send({ target_type: 'user', username: 'userone', reason: 'myself' }); assert.equal(r.status, 400);
  r = await U1.get('/api/admin/reports'); assert.equal(r.status, 403, 'regular users cannot see queue');
  r = await MOD.get('/api/admin/reports'); assert.equal(r.status, 200); assert.equal(r.body.items.length, 2);
  assert.equal(r.body.items.find((x) => x.target_type === 'post').post_body, 'spammy post');
  r = await post(MOD, `/api/admin/posts/${pid}/hide`).send({}); assert.equal(r.body.changed, 1);
  r = await U1.get(`/api/posts/${pid}`); assert.equal(r.status, 404, 'hidden post not visible');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM posts WHERE id = $1', [pid])).rows[0].n, 1, 'post kept in DB');
  r = await post(MOD, `/api/admin/posts/${pid}/unhide`).send({}); r = await U1.get(`/api/posts/${pid}`); assert.equal(r.status, 200);
  const u2 = await uid('usertwo');
  r = await post(MOD, `/api/admin/users/${await uid('modmin')}/suspend`).send({}); assert.equal(r.status, 400);
  r = await post(MOD, `/api/admin/users/${u2}/suspend`).send({ reason: 'spam' }); assert.equal(r.status, 200);
  r = await U2.get('/api/me'); assert.equal(r.status, 401, 'suspended user signed out');
  r = await post(request.agent(app), '/api/auth/login').send({ login: 'usertwo@safe.io', password: 'Password123!' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'SUSPENDED');
  r = await U1.get('/api/users/usertwo'); assert.equal(r.status, 404);
  r = await MOD.get('/api/admin/reports'); assert.equal(r.body.items.length, 0, 'reports closed');
  r = await MOD.get('/api/admin/reports?status=all'); assert.ok(r.body.items.every((x) => x.status === 'actioned'));
  r = await post(MOD, `/api/admin/users/${u2}/unsuspend`).send({});
  r = await U2.get('/api/me'); assert.equal(r.status, 200, 'old session works again after unsuspend');
});

test('migrations are versioned and additive (007+ never drop/delete/truncate/rename)', () => {
  const dir = new URL('../server/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  files.forEach((f, i) => assert.match(f, new RegExp(`^${String(i + 1).padStart(3, '0')}_[a-z0-9_]+\\.sql$`), `numbered in order: ${f}`));
  for (const f of files.filter((f) => Number(f.slice(0, 3)) >= 7)) {
    const sql = fs.readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\b(DROP\s+(TABLE|COLUMN|SCHEMA)|TRUNCATE|DELETE\s+FROM|RENAME\s+(TO|COLUMN)|ALTER\s+COLUMN\s+\w+\s+TYPE)\b/i, `${f} must be additive`);
    assert.doesNotMatch(sql, /ADD\s+COLUMN(?!\s+IF\s+NOT\s+EXISTS)[^;]*NOT\s+NULL(?![^;]*DEFAULT)/i, `${f}: NOT NULL columns need a DEFAULT`);
  }
});

test('browser proof-of-work worker produces solutions the server accepts', async () => {
  const { transform } = await import('esbuild');
  const src = fs.readFileSync(new URL('../web/src/lib/pow.worker.ts', import.meta.url), 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  let out; const fakeSelf = { postMessage: (m) => { out = m; } };
  new Function('self', code.replace(/^export\s*\{\s*\};?/m, ''))(fakeSelf);
  const c = (await request(app).get('/api/auth/challenge')).body;
  fakeSelf.onmessage({ data: c });
  const { verifyPow } = await import('../server/pow.js');
  assert.equal(await verifyPow(out), null);
});
