import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { testSmsOutbox } from '../server/sms.js';
import { powFor } from './pow-helper.js';
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email)?.text.match(/\b(\d{6})\b/)[1];

let app;
const H = { 'X-Connectly-CSRF': '1' };
const agent = () => { const a = request.agent(app); return a; };
const post = (a, url) => a.post(url).set(H);
const DOB = '1995-05-05';
const signup = async (a, email, extra = {}) => { const pow = await powFor(a); const r = await post(a, '/api/auth/register').send({ identifier: email, password: 'Password123!', full_name: 'Test Person', birth_date: DOB, accept_terms: true, pow, ...extra }); return r; };
async function register(name) {
  const a = agent();
  const email = `${name}@t.io`;
  const r = await signup(a, email, { full_name: name[0].toUpperCase() + name.slice(1) + ' Tester' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const v = await post(a, '/api/auth/verify').send({ identifier: email, code: lastCode(email) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const u = await a.patch('/api/me').set(H).send({ username: name });
  assert.equal(u.status, 200, JSON.stringify(u.body));
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
test('signup steps: identifier check, name, age, terms, uniqueness', async () => {
  A = await register('alice'); B = await register('bob'); C = await register('carol');
  let r = await post(agent(), '/api/auth/check-identifier').send({ identifier: 'ALICE@t.io', password: 'Password123!' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'SAME_DETAILS');
  r = await post(agent(), '/api/auth/check-identifier').send({ identifier: 'ALICE@t.io', password: 'Different123!' }); assert.equal(r.status, 200, 'same email, different password allowed');
  assert.ok(testOutbox.some((m) => m.to === 'alice@t.io' && m.subject === 'Welcome to Connectly'), 'welcome email after verification');
  r = await post(agent(), '/api/auth/check-identifier').send({ identifier: 'new@t.io' }); assert.equal(r.body.type, 'email');
  r = await post(agent(), '/api/auth/check-identifier').send({ identifier: 'not-an-email@' }); assert.equal(r.status, 400);
  r = await post(agent(), '/api/auth/check-identifier').send({ identifier: '0803 123 4567', country: 'NG' });
  assert.equal(r.status, 400); assert.match(r.body.error, /Phone sign-up is coming soon/);
  r = await signup(agent(), 'p@t.io', { identifier: '+2348031234567' }); assert.equal(r.status, 400, 'phone disabled server-side without SMS');
  r = await signup(agent(), 'alice@t.io'); assert.equal(r.status, 409); assert.equal(r.body.code, 'SAME_DETAILS');
  r = await signup(agent(), 'n1@t.io', { full_name: 'R2D2 Robot' }); assert.equal(r.status, 400);
  r = await signup(agent(), 'n1@t.io', { full_name: "Mary-Jane O'Neil" }); assert.equal(r.status, 201);
  const young = new Date(); young.setUTCFullYear(young.getUTCFullYear() - 12);
  r = await signup(agent(), 'kid@t.io', { birth_date: young.toISOString().slice(0, 10) }); assert.equal(r.status, 400); assert.match(r.body.error, /at least 13/);
  r = await signup(agent(), 'bad@t.io', { birth_date: '2001-02-30' }); assert.equal(r.status, 400);
  r = await signup(agent(), 'nt@t.io', { accept_terms: false }); assert.equal(r.status, 400);
  r = await signup(agent(), 'pw@t.io', { password: 'short' }); assert.equal(r.status, 400);
  r = await signup(agent(), 'x@t.io', { display_name: 'nope' }); assert.equal(r.status, 400, 'no display_name field');
  r = await A.get('/api/me'); assert.equal(r.body.full_name, 'Alice Tester'); assert.equal(r.body.display_name, undefined);
  r = await B.get('/api/users/alice'); assert.equal(r.body.birth_date, undefined, 'DOB private');
  r = await A.patch('/api/me').set(H).send({ username: 'bob' }); assert.equal(r.status, 409);
});

test('auto-generated usernames are unique', async () => {
  const a1 = agent(), a2 = agent();
  await signup(a1, 'jm1@t.io', { full_name: 'Jimoh Mojeed' });
  await post(a1, '/api/auth/verify').send({ identifier: 'jm1@t.io', code: lastCode('jm1@t.io') });
  await signup(a2, 'jm2@t.io', { full_name: 'Jimoh Mojeed' });
  await post(a2, '/api/auth/verify').send({ identifier: 'jm2@t.io', code: lastCode('jm2@t.io') });
  const u1 = (await a1.get('/api/me')).body.username, u2 = (await a2.get('/api/me')).body.username;
  assert.equal(u1, 'jimohmojeed'); assert.match(u2, /^jimohmojeed\d+$/);
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

test('verification code: pending cannot log in, attempts, resend cooldown, expiry, auto-login', async () => {
  const a = agent();
  let r = await signup(a, 'dave@t.io', { full_name: 'Dave Pending' }); assert.equal(r.status, 201); assert.equal(r.body.pending, true);
  r = await a.get('/api/me'); assert.equal(r.status, 401, 'no session before verification');
  r = await post(agent(), '/api/auth/login').send({ login: 'dave@t.io', password: 'Password123!' });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'PENDING_VERIFICATION');
  const code = lastCode('dave@t.io');
  const { rows } = await pool.query("SELECT code_hash FROM email_codes ORDER BY id DESC LIMIT 1");
  assert.notEqual(rows[0].code_hash, code, 'code stored hashed');
  r = await post(a, '/api/auth/resend').send({ identifier: 'dave@t.io' }); assert.equal(r.status, 429, 'cooldown');
  const wrong = code === '000000' ? '111111' : '000000';
  r = await post(a, '/api/auth/verify').send({ identifier: 'dave@t.io', code: 'abc' }); assert.equal(r.status, 400);
  r = await post(a, '/api/auth/verify').send({ identifier: 'dave@t.io', code: wrong }); assert.equal(r.body.reason, 'invalid');
  r = await a.get('/api/me'); assert.equal(r.status, 401, 'wrong code => still not signed in');
  r = await post(a, '/api/auth/verify').send({ identifier: 'dave@t.io', code }); assert.equal(r.status, 200);
  r = await a.get('/api/me'); assert.equal(r.status, 200, 'auto-login'); assert.equal(r.body.onboarded, false);
  r = await post(a, '/api/posts').field('body', 'hi'); assert.equal(r.status, 201);
  r = await post(a, '/api/me/onboarding-complete'); r = await a.get('/api/me'); assert.equal(r.body.onboarded, true);
  // lockout after 5 wrong attempts
  const e = agent();
  await signup(e, 'erin@t.io', { full_name: 'Erin Locked' });
  const ecode = lastCode('erin@t.io'); const bad = ecode === '999999' ? '888888' : '999999';
  for (let i = 0; i < 4; i++) { r = await post(e, '/api/auth/verify').send({ identifier: 'erin@t.io', code: bad }); assert.equal(r.body.reason, 'invalid'); }
  r = await post(e, '/api/auth/verify').send({ identifier: 'erin@t.io', code: bad }); assert.equal(r.body.reason, 'locked');
  r = await post(e, '/api/auth/verify').send({ identifier: 'erin@t.io', code: ecode }); assert.equal(r.status, 400, 'locked code no longer works');
  await pool.query("UPDATE email_codes SET created_at = now() - interval '2 minutes'");
  r = await post(e, '/api/auth/resend').send({ identifier: 'erin@t.io' }); assert.equal(r.status, 200);
  r = await post(e, '/api/auth/verify').send({ identifier: 'erin@t.io', code: lastCode('erin@t.io') }); assert.equal(r.status, 200);
  // expiry
  const f = agent();
  await signup(f, 'fay@t.io', { full_name: 'Fay Expired' });
  await pool.query("UPDATE email_codes SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email='fay@t.io')");
  r = await post(f, '/api/auth/verify').send({ identifier: 'fay@t.io', code: lastCode('fay@t.io') }); assert.equal(r.body.reason, 'expired');
  // abandoned pending signup can be restarted
  r = await signup(agent(), 'fay@t.io', { full_name: 'Fay Again' }); assert.equal(r.status, 201);
});

test('multiple accounts per email: login picks the account whose password matches', async () => {
  const a2 = agent();
  let r = await signup(a2, 'alice@t.io', { password: 'SecondAcct123!', full_name: 'Alice Business' }); assert.equal(r.status, 201);
  r = await post(a2, '/api/auth/verify').send({ identifier: 'alice@t.io', code: lastCode('alice@t.io') }); assert.equal(r.status, 200);
  const second = (await a2.get('/api/me')).body; assert.equal(second.full_name, 'Alice Business');
  const l1 = agent(); r = await post(l1, '/api/auth/login').send({ login: 'alice@t.io', password: 'Password123!' }); assert.equal(r.status, 200);
  assert.equal((await l1.get('/api/me')).body.username, 'alice');
  const l2 = agent(); r = await post(l2, '/api/auth/login').send({ login: 'ALICE@t.io', password: 'SecondAcct123!' }); assert.equal(r.status, 200);
  assert.equal((await l2.get('/api/me')).body.id, second.id);
  r = await post(agent(), '/api/auth/login').send({ login: 'alice@t.io', password: 'Nope12345!' }); assert.equal(r.status, 401);
});

test('password reset with code then pick account', async () => {
  let r = await post(agent(), '/api/auth/forgot').send({ identifier: 'alice@t.io' }); assert.equal(r.status, 200);
  r = await post(agent(), '/api/auth/forgot').send({ identifier: 'nobody@t.io' }); assert.equal(r.status, 200, 'no enumeration');
  const code = lastCode('alice@t.io'); const wrong = code === '123456' ? '654321' : '123456';
  r = await post(agent(), '/api/auth/code-accounts').send({ identifier: 'alice@t.io', code: wrong, purpose: 'reset_password' }); assert.equal(r.status, 400);
  r = await post(agent(), '/api/auth/code-accounts').send({ identifier: 'alice@t.io', code, purpose: 'reset_password' });
  assert.equal(r.status, 200); assert.equal(r.body.accounts.length, 2); assert.equal(r.body.accounts[0].password_hash, undefined);
  const { ticket } = r.body; const biz = r.body.accounts.find((x) => x.full_name === 'Alice Business');
  r = await post(agent(), '/api/auth/reset').send({ ticket, user_id: 2, password: 'Hacked1234!' }); assert.equal(r.status, 403, 'cannot reset an account not on this email');
  r = await post(agent(), '/api/auth/reset').send({ ticket, user_id: biz.id, password: 'Password123!' }); assert.equal(r.status, 409, 'cannot collide with sibling password');
  r = await post(agent(), '/api/auth/reset').send({ ticket, user_id: biz.id, password: 'BizNew12345!' }); assert.equal(r.status, 200);
  r = await post(agent(), '/api/auth/reset').send({ ticket, user_id: biz.id, password: 'Again12345!' }); assert.equal(r.status, 400, 'ticket single use');
  const l = agent(); r = await post(l, '/api/auth/login').send({ login: 'alice@t.io', password: 'BizNew12345!' }); assert.equal(r.status, 200);
  assert.equal((await l.get('/api/me')).body.id, biz.id);
  // carol: old sessions revoked after reset
  await post(agent(), '/api/auth/forgot').send({ identifier: 'carol@t.io' });
  r = await post(agent(), '/api/auth/code-accounts').send({ identifier: 'carol@t.io', code: lastCode('carol@t.io'), purpose: 'reset_password' });
  r = await post(agent(), '/api/auth/reset').send({ ticket: r.body.ticket, user_id: r.body.accounts[0].id, password: 'NewPassword1!' }); assert.equal(r.status, 200);
  r = await C.get('/api/me'); assert.equal(r.status, 401, 'old sessions revoked');
  C = agent(); r = await post(C, '/api/auth/login').send({ login: 'carol', password: 'NewPassword1!' }); assert.equal(r.status, 200);
});

test('find account by username sends code to email on file, lists accounts only after code', async () => {
  let r = await post(agent(), '/api/auth/find').send({ identifier: '@alice' }); assert.equal(r.status, 200); assert.equal(r.body.accounts, undefined);
  r = await post(agent(), '/api/auth/find').send({ identifier: 'ghost_user' }); assert.equal(r.status, 200, 'same response for unknown');
  r = await post(agent(), '/api/auth/code-accounts').send({ identifier: 'alice', code: lastCode('alice@t.io'), purpose: 'find_account' });
  assert.equal(r.status, 200); assert.equal(r.body.accounts.length, 2); assert.match(r.body.sent_to, /^a•+@t\.io$/);
});

test('profile edit own only; cannot self-grant admin', async () => {
  let r;
  await pool.query("INSERT INTO places (id, name, ascii_name, admin1, country, country_code, population, display) VALUES (2337639,'Ikeja','Ikeja','Lagos','Nigeria','NG',313196,'Ikeja, Lagos, Nigeria'), (5308655,'Phoenix','Phoenix','Arizona','United States','US',1600000,'Phoenix, Arizona, United States'), (2332459,'Lagos','Lagos','Lagos','Nigeria','NG',9000000,'Lagos, Nigeria')");
  let pl = await A.get('/api/places?q=ikej'); assert.equal(pl.body.items[0].display, 'Ikeja, Lagos, Nigeria');
  pl = await A.get('/api/places?q=Phoenix'); assert.equal(pl.body.items[0].display, 'Phoenix, Arizona, United States');
  r = await A.patch('/api/me').set(H).send({ bio: 'Hello there', current_place_id: 2337639, hometown_place_id: 2332459, full_name: 'Alice Adeyemi',
    interests: ['Music', 'Tech', 'Music'], relationship_status: 'Married', work_company: 'Acme', work_role: 'Designer', education: 'UNILAG' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.bio, 'Hello there'); assert.equal(r.body.location, 'Ikeja, Lagos, Nigeria'); assert.equal(r.body.hometown, 'Lagos, Nigeria');
  assert.deepEqual(r.body.interests, ['Music', 'Tech']);
  r = await A.patch('/api/me').set(H).send({ relationship_status: 'Whatever' }); assert.equal(r.status, 400);
  r = await A.patch('/api/me').set(H).send({ current_place_id: 999999999 }); assert.equal(r.status, 400);
  r = await A.patch('/api/me').set(H).send({ location: 'Lagos' }); assert.equal(r.status, 400, 'location only via place picker');
  r = await B.get('/api/users/alice'); assert.equal(r.body.location, 'Ikeja, Lagos, Nigeria'); assert.equal(r.body.work_company, 'Acme'); assert.equal(r.body.email, undefined);
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
  r = await C.get('/api/admin/status'); assert.equal(r.status, 200); assert.equal(typeof r.body.smtp_configured, 'boolean');
  r = await post(C, '/api/admin/users/2/roles').send({ role: 'moderator' }); assert.equal(r.status, 200);
  r = await C.delete(`/api/admin/users/${rows[0].id}/roles/admin`).set(H); assert.equal(r.status, 400);
});

test('avatar / cover upload with validation', async () => {
  let r = await post(A, '/api/me/avatar').attach('image', png, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(r.status, 200); assert.match(r.body.avatar_path, /^\/uploads\/avatar\/[a-f0-9]+\.webp$/);
  const img = await request(app).get(r.body.avatar_path); assert.equal(img.status, 200);
  assert.equal((await sharp(img.body).metadata()).width, 800);
  r = await post(A, '/api/me/cover').attach('image', png, { filename: 'c.png', contentType: 'image/png' }); assert.equal(r.status, 200);
  r = await post(A, '/api/me/avatar').attach('image', Buffer.from('<?php echo 1; ?>'), { filename: 'x.png', contentType: 'image/png' });
  assert.equal(r.status, 400, 'fake image rejected');
  r = await post(A, '/api/me/avatar').attach('image', Buffer.from('hi'), { filename: 'x.txt', contentType: 'text/plain' });
  assert.equal(r.status, 400);
  r = await post(A, '/api/me/avatar').attach('image', Buffer.alloc(15 * 1024 * 1024 + 10), { filename: 'big.png', contentType: 'image/png' });
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
  const { rows } = await pool.query("SELECT count(*)::int n FROM posts WHERE visibility='public' AND deleted_at IS NULL");
  assert.equal(seen.length, rows[0].n);
});

test('search people and posts respects visibility', async () => {
  let r = await B.get('/api/search?q=ali&type=people'); assert.equal(r.status, 200); assert.equal(r.body.items[0].username, 'alice');
  r = await B.get('/api/search?q=fay&type=people'); assert.equal(r.body.items.length, 0, 'unverified users hidden');
  r = await B.get('/api/search?q=%25&type=people'); assert.equal(r.body.items.length, 0, 'wildcards escaped');
  r = await C.get('/api/search?q=diary&type=posts'); assert.equal(r.body.items.length, 0, 'private post not searchable by others');
  r = await A.get('/api/search?q=diary&type=posts'); assert.equal(r.body.items.length, 1);
  r = await C.get('/api/search?q=edited&type=posts'); assert.equal(r.body.items[0].id, pub.id);
  r = await C.get('/api/search?q=&type=posts'); assert.equal(r.status, 400);
});

test('phone signup works end-to-end when an SMS provider is configured', async () => {
  process.env.TEST_SMS = '1';
  try {
    const a = agent();
    let r = await signup(a, '', { identifier: '0803 123 4567', country: 'NG', full_name: 'Phone User' });
    assert.equal(r.status, 201); assert.equal(r.body.sent_to, '+2348031234567');
    const code = testSmsOutbox.at(-1).text.match(/\d{6}/)[0]; assert.equal(testSmsOutbox.at(-1).to, '+2348031234567');
    r = await post(a, '/api/auth/verify').send({ identifier: '+2348031234567', code }); assert.equal(r.status, 200);
    r = await post(agent(), '/api/auth/login').send({ login: '08031234567', password: 'Password123!', country: 'NG' }); assert.equal(r.status, 200, 'login with local phone format');
  } finally { delete process.env.TEST_SMS; }
});

test('contacts matching by hash only', async () => {
  const crypto = await import('node:crypto');
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
  let r = await post(A, '/api/contacts/match').send({ hashes: [h('bob@t.io'), h('nobody@x.io')] });
  assert.equal(r.status, 200); assert.deepEqual(r.body.items.map((u) => u.username), ['bob']);
  r = await post(A, '/api/contacts/match').send({ hashes: ['bob@t.io'] }); assert.equal(r.status, 400, 'raw values rejected');
  const { rows } = await pool.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name LIKE '%contact%'");
  assert.equal(rows[0].n, 0, 'no contact storage');
});

test('notification settings', async () => {
  let r = await B.get('/api/me'); assert.equal(r.body.email_notifications, true);
  r = await B.patch('/api/me/settings').set(H).send({ email_notifications: false }); assert.equal(r.status, 200);
  r = await B.get('/api/me'); assert.equal(r.body.email_notifications, false); assert.equal(r.body.inapp_notifications, true);
  r = await B.patch('/api/me/settings').set(H).send({ email_notifications: true });
});

test('deactivate hides account, login reactivates; delete removes everything', async () => {
  const d = await register('dana');
  const p = (await post(d, '/api/posts').field('body', 'dana post').attach('image', png, { filename: 'p.png', contentType: 'image/png' })).body;
  await post(d, '/api/me/avatar').attach('image', png, { filename: 'a.png', contentType: 'image/png' });
  let r = await post(d, '/api/me/deactivate').send({ password: 'wrong' }); assert.equal(r.status, 403);
  r = await post(d, '/api/me/deactivate').send({ password: 'Password123!' }); assert.equal(r.status, 200);
  r = await d.get('/api/me'); assert.equal(r.status, 401, 'signed out');
  r = await B.get('/api/users/dana'); assert.equal(r.status, 404, 'profile hidden');
  r = await B.get(`/api/posts/${p.id}`); assert.equal(r.status, 404, 'posts hidden');
  r = await B.get('/api/search?q=dana&type=people'); assert.equal(r.body.items.length, 0);
  const d2 = agent(); r = await post(d2, '/api/auth/login').send({ login: 'dana', password: 'Password123!' }); assert.equal(r.body.reactivated, true);
  r = await B.get('/api/users/dana'); assert.equal(r.status, 200, 'visible again');
  const me = (await d2.get('/api/me')).body;
  r = await post(d2, '/api/me/delete').send({ password: 'Password123!' }); assert.equal(r.status, 200);
  r = await B.get('/api/users/dana'); assert.equal(r.status, 404);
  const { rows } = await pool.query('SELECT (SELECT count(*)::int FROM users WHERE id=$1) u, (SELECT count(*)::int FROM posts WHERE author_id=$1) p', [me.id]);
  assert.deepEqual(rows[0], { u: 0, p: 0 });
  await new Promise((res) => setTimeout(res, 100));
  r = await request(app).get(p.image_path); assert.equal(r.status, 404, 'uploaded file removed');
  r = await request(app).get(me.avatar_path); assert.equal(r.status, 404, 'avatar removed');
});

test('security headers present', async () => {
  const r = await request(app).get('/api/health');
  assert.equal(r.status, 200);
  assert.ok(r.headers['content-security-policy']); assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
