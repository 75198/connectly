import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';

let app;
const H = { 'X-Connectly-CSRF': '1' };
const agent = () => { const a = request.agent(app); return a; };
const post = (a, url) => a.post(url).set(H);
async function register(name) {
  const a = agent();
  const r = await post(a, '/api/auth/register').send({ username: name, display_name: name.toUpperCase(), email: `${name}@t.io`, password: 'Password123!' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return a;
}
let png;
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  app = createApp();
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3355ff' } }).png().toBuffer();
});
after(() => pool.end());

let A, B, C;
test('registration validates and enforces unique username/email', async () => {
  A = await register('alice'); B = await register('bob'); C = await register('carol');
  let r = await post(agent(), '/api/auth/register').send({ username: 'ALICE', display_name: 'x', email: 'z@t.io', password: 'Password123!' });
  assert.equal(r.status, 409);
  r = await post(agent(), '/api/auth/register').send({ username: 'zed', display_name: 'x', email: 'alice@t.io', password: 'Password123!' });
  assert.equal(r.status, 409);
  r = await post(agent(), '/api/auth/register').send({ username: 'a b', display_name: 'x', email: 'bad', password: 'short' });
  assert.equal(r.status, 400);
});

test('CSRF header required for writes', async () => {
  const r = await request(app).post('/api/auth/login').send({ login: 'alice', password: 'Password123!' });
  assert.equal(r.status, 403);
  const r2 = await request(app).post('/api/auth/login').set(H).set('Origin', 'https://evil.example').send({ login: 'alice', password: 'Password123!' });
  assert.equal(r2.status, 403);
});

test('login, session cookie flags, me, logout', async () => {
  const a = agent();
  let r = await post(a, '/api/auth/login').send({ login: 'alice', password: 'wrong-password' });
  assert.equal(r.status, 401);
  r = await post(a, '/api/auth/login').send({ login: 'alice@t.io', password: 'Password123!' });
  assert.equal(r.status, 200);
  const cookie = r.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  r = await a.get('/api/me'); assert.equal(r.status, 200); assert.equal(r.body.username, 'alice'); assert.equal(r.body.password_hash, undefined);
  r = await post(a, '/api/auth/logout'); assert.equal(r.status, 200);
  r = await a.get('/api/me'); assert.equal(r.status, 401);
  r = await request(app).get('/api/feed'); assert.equal(r.status, 401);
});

test('password reset token flow', async () => {
  let r = await post(agent(), '/api/auth/forgot').send({ email: 'carol@t.io' });
  assert.equal(r.status, 200);
  r = await post(agent(), '/api/auth/forgot').send({ email: 'nobody@t.io' });
  assert.equal(r.status, 200); // no account enumeration
  const { rows } = await pool.query("SELECT reset_url FROM password_resets ORDER BY id DESC LIMIT 1");
  const token = new URL(rows[0].reset_url).searchParams.get('token');
  r = await post(agent(), '/api/auth/reset').send({ token: 'x'.repeat(40), password: 'NewPassword1!' });
  assert.equal(r.status, 400);
  r = await post(agent(), '/api/auth/reset').send({ token, password: 'NewPassword1!' });
  assert.equal(r.status, 200);
  r = await post(agent(), '/api/auth/reset').send({ token, password: 'Another123!' });
  assert.equal(r.status, 400, 'token single use');
  r = await (await C.get('/api/me')); assert.equal(r.status, 401, 'old sessions revoked');
  C = agent();
  r = await post(C, '/api/auth/login').send({ login: 'carol', password: 'NewPassword1!' });
  assert.equal(r.status, 200);
});

test('profile edit own only; cannot self-grant admin', async () => {
  let r = await A.patch('/api/me').set(H).send({ bio: 'Hello there', location: 'Lagos', display_name: 'Alice A' });
  assert.equal(r.status, 200); assert.equal(r.body.bio, 'Hello there');
  r = await B.get('/api/users/alice'); assert.equal(r.body.location, 'Lagos'); assert.equal(r.body.email, undefined);
  r = await A.patch('/api/users/bob').set(H).send({ bio: 'hacked' });
  assert.equal(r.status, 403);
  r = await B.get('/api/users/bob'); assert.notEqual(r.body.bio, 'hacked');
  r = await A.patch('/api/me').set(H).send({ roles: ['admin'] }); assert.equal(r.status, 400);
  r = await A.patch('/api/me').set(H).send({ is_admin: true, bio: 'x' }); assert.equal(r.status, 400);
  r = await post(A, '/api/admin/users/1/roles').send({ role: 'admin' }); assert.equal(r.status, 403);
  r = await A.get('/api/admin/users'); assert.equal(r.status, 403);
  r = await A.get('/api/me'); assert.deepEqual(r.body.roles, []);
});

test('admin can grant roles and see reset links', async () => {
  const { rows } = await pool.query("SELECT id FROM users WHERE username='carol'");
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name='admin'", [rows[0].id]);
  let r = await C.get('/api/admin/users'); assert.equal(r.status, 200); assert.ok(r.body.items.length >= 3);
  r = await C.get('/api/admin/password-resets'); assert.equal(r.status, 200);
  r = await post(C, '/api/admin/users/2/roles').send({ role: 'moderator' }); assert.equal(r.status, 200);
  r = await C.delete(`/api/admin/users/${rows[0].id}/roles/admin`).set(H); assert.equal(r.status, 400);
});

test('avatar / cover upload with validation', async () => {
  let r = await post(A, '/api/me/avatar').attach('image', png, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(r.status, 200); assert.match(r.body.avatar_path, /^\/uploads\/avatar\/[a-f0-9]+\.webp$/);
  const img = await request(app).get(r.body.avatar_path); assert.equal(img.status, 200);
  assert.equal((await sharp(img.body).metadata()).width, 400);
  r = await post(A, '/api/me/cover').attach('image', png, { filename: 'c.png', contentType: 'image/png' }); assert.equal(r.status, 200);
  r = await post(A, '/api/me/avatar').attach('image', Buffer.from('<?php echo 1; ?>'), { filename: 'x.png', contentType: 'image/png' });
  assert.equal(r.status, 400, 'fake image rejected');
  r = await post(A, '/api/me/avatar').attach('image', Buffer.from('hi'), { filename: 'x.txt', contentType: 'text/plain' });
  assert.equal(r.status, 400);
  r = await post(A, '/api/me/avatar').attach('image', Buffer.alloc(5 * 1024 * 1024 + 10), { filename: 'big.png', contentType: 'image/png' });
  assert.equal(r.status, 413);
});

let pub, priv, fr, photo;
test('post CRUD + photo post', async () => {
  let r = await post(A, '/api/posts').field('body', 'Hello public world').field('visibility', 'public');
  assert.equal(r.status, 201); pub = r.body; assert.equal(pub.author.username, 'alice'); assert.equal(pub.like_count, 0);
  r = await post(A, '/api/posts').field('body', 'Secret diary').field('visibility', 'private'); priv = r.body;
  r = await post(A, '/api/posts').field('body', 'Friends only').field('visibility', 'friends'); fr = r.body;
  r = await post(A, '/api/posts').field('body', '').field('visibility', 'public').attach('image', png, { filename: 'p.png', contentType: 'image/png' });
  assert.equal(r.status, 201); photo = r.body; assert.match(photo.image_path, /\/uploads\/post\//);
  r = await post(A, '/api/posts').field('body', ''); assert.equal(r.status, 400);
  r = await post(A, '/api/posts').field('body', 'x').field('visibility', 'everyone'); assert.equal(r.status, 400);
  r = await A.patch(`/api/posts/${pub.id}`).set(H).send({ body: 'Hello edited world' });
  assert.equal(r.status, 200); assert.equal(r.body.body, 'Hello edited world');
  const tmp = (await post(A, '/api/posts').field('body', 'temp')).body;
  r = await A.delete(`/api/posts/${tmp.id}`).set(H); assert.equal(r.status, 200);
  r = await A.get(`/api/posts/${tmp.id}`); assert.equal(r.status, 404);
});

test('cannot edit or delete other users posts', async () => {
  let r = await B.patch(`/api/posts/${pub.id}`).set(H).send({ body: 'pwned' }); assert.equal(r.status, 403);
  r = await B.delete(`/api/posts/${pub.id}`).set(H); assert.equal(r.status, 403);
  r = await B.patch(`/api/posts/${priv.id}`).set(H).send({ body: 'pwned' }); assert.equal(r.status, 404, 'private post invisible');
  r = await A.get(`/api/posts/${pub.id}`); assert.equal(r.body.body, 'Hello edited world');
});

test('visibility restrictions in feed, profile and direct access', async () => {
  let r = await B.get('/api/feed'); const ids = r.body.items.map((p) => p.id);
  assert.ok(ids.includes(pub.id)); assert.ok(!ids.includes(priv.id)); assert.ok(!ids.includes(fr.id));
  r = await B.get(`/api/posts/${priv.id}`); assert.equal(r.status, 404);
  r = await B.get(`/api/posts/${fr.id}`); assert.equal(r.status, 404);
  r = await B.get('/api/users/alice/posts'); assert.ok(!r.body.items.some((p) => p.id === priv.id || p.id === fr.id));
  r = await B.get(`/api/posts/${priv.id}/comments`); assert.equal(r.status, 404);
  r = await B.put(`/api/posts/${priv.id}/like`).set(H); assert.equal(r.status, 404);
  // accepted friendship unlocks friends-only (not private)
  await pool.query("INSERT INTO friendships (requester_id, addressee_id, status) SELECT a.id, b.id, 'accepted' FROM users a, users b WHERE a.username='bob' AND b.username='alice'");
  r = await B.get(`/api/posts/${fr.id}`); assert.equal(r.status, 200);
  r = await B.get(`/api/posts/${priv.id}`); assert.equal(r.status, 404);
  r = await C.get(`/api/posts/${fr.id}`); assert.equal(r.status, 404);
  r = await A.get('/api/feed'); const mine = r.body.items.map((p) => p.id);
  assert.ok(mine.includes(priv.id) && mine.includes(fr.id), 'author sees own posts');
});

test('likes are idempotent with accurate counts', async () => {
  let r = await B.put(`/api/posts/${pub.id}/like`).set(H); assert.deepEqual(r.body, { liked_by_me: true, like_count: 1 });
  r = await B.put(`/api/posts/${pub.id}/like`).set(H); assert.equal(r.body.like_count, 1);
  r = await C.put(`/api/posts/${pub.id}/like`).set(H); assert.equal(r.body.like_count, 2);
  r = await B.delete(`/api/posts/${pub.id}/like`).set(H); assert.deepEqual(r.body, { liked_by_me: false, like_count: 1 });
  r = await B.delete(`/api/posts/${pub.id}/like`).set(H); assert.equal(r.body.like_count, 1);
  r = await C.get(`/api/posts/${pub.id}`); assert.equal(r.body.liked_by_me, true); assert.equal(r.body.like_count, 1);
});

test('comments and replies', async () => {
  let r = await post(B, `/api/posts/${pub.id}/comments`).send({ body: 'Nice post!' }); assert.equal(r.status, 201);
  const c1 = r.body;
  r = await post(A, `/api/posts/${pub.id}/comments`).send({ body: 'Thanks Bob', parent_id: c1.id }); assert.equal(r.body.parent_id, c1.id);
  const reply = r.body;
  r = await post(C, `/api/posts/${pub.id}/comments`).send({ body: 'Reply to reply', parent_id: reply.id }); assert.equal(r.body.parent_id, c1.id, 'flattened to one level');
  r = await post(B, `/api/posts/${pub.id}/comments`).send({ body: '' }); assert.equal(r.status, 400);
  r = await post(B, `/api/posts/${photo.id}/comments`).send({ body: 'x', parent_id: c1.id }); assert.equal(r.status, 400, 'parent from other post');
  r = await B.get(`/api/posts/${pub.id}/comments`); assert.equal(r.body.items.length, 3);
  r = await C.delete(`/api/comments/${c1.id}`).set(H); assert.equal(r.status, 403);
  r = await A.get(`/api/posts/${pub.id}`); assert.equal(r.body.comment_count, 3);
  r = await A.delete(`/api/comments/${c1.id}`).set(H); assert.equal(r.status, 200, 'post owner can moderate');
  r = await A.get(`/api/posts/${pub.id}`); assert.equal(r.body.comment_count, 0, 'replies cascade');
});

test('cursor pagination has no duplicates or gaps', async () => {
  for (let i = 0; i < 12; i++) await post(B, '/api/posts').field('body', `bulk ${i}`);
  const seen = []; let cursor = null; let pages = 0;
  do {
    const r = await C.get(`/api/feed?limit=5${cursor ? `&cursor=${cursor}` : ''}`);
    seen.push(...r.body.items.map((p) => p.id)); cursor = r.body.next_cursor; pages++;
  } while (cursor && pages < 20);
  assert.equal(new Set(seen).size, seen.length);
  const { rows } = await pool.query("SELECT count(*)::int n FROM posts WHERE visibility='public'");
  assert.equal(seen.length, rows[0].n);
});

test('security headers present', async () => {
  const r = await request(app).get('/api/health');
  assert.equal(r.status, 200);
  assert.ok(r.headers['content-security-policy']); assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
