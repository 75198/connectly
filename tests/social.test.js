import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { powFor } from './pow-helper.js';

let app, png;
const H = { 'X-Connectly-CSRF': '1' };
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
const post = (a, url) => a.post(url).set(H);
async function register(name, email = `${name}@s.io`, pw = 'Password123!') {
  const a = request.agent(app);
  const pow = await powFor(a);
  let r = await post(a, '/api/auth/register').send({ identifier: email, password: pw, full_name: `${name[0].toUpperCase()}${name.slice(1)} Social`, birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await post(a, '/api/auth/verify').send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  r = await a.patch('/api/me').set(H).send({ username: name }); assert.equal(r.status, 200);
  return a;
}
let A, B, C;
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  app = createApp();
  png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#22aa77' } }).png().toBuffer();
  A = await register('ann'); B = await register('ben'); C = await register('cal');
});
after(() => pool.end());

test('friend requests: send, accept, notifications + emails, remove', async () => {
  testOutbox.length = 0;
  let r = await post(A, '/api/friends/ben'); assert.equal(r.body.friend_status, 'outgoing');
  assert.ok(testOutbox.some((m) => m.to === 'ben@s.io' && /friend request/.test(m.subject)), 'email for friend request');
  r = await B.get('/api/friends?type=incoming'); assert.deepEqual(r.body.items.map((u) => u.username), ['ann']);
  r = await B.get('/api/notifications'); assert.equal(r.body.items[0].type, 'friend_request'); assert.equal(r.body.items[0].actor.username, 'ann');
  r = await B.get('/api/me'); assert.equal(r.body.unread_notifications, 1);
  r = await post(B, '/api/notifications/read').send({ all: true }); r = await B.get('/api/me'); assert.equal(r.body.unread_notifications, 0);
  r = await post(B, '/api/friends/ann/accept'); assert.equal(r.body.friend_status, 'friends');
  assert.ok(testOutbox.some((m) => m.to === 'ann@s.io' && /accepted/.test(m.subject)), 'email for accept');
  r = await A.get('/api/users/ben'); assert.equal(r.body.friend_status, 'friends'); assert.equal(r.body.friend_count, 1);
  r = await A.delete('/api/friends/ben').set(H); assert.equal(r.body.friend_status, 'none');
  // reject + cancel
  await post(C, '/api/friends/ann'); r = await post(A, '/api/friends/cal/reject'); assert.equal(r.body.friend_status, 'none');
  await post(C, '/api/friends/ann'); r = await C.delete('/api/friends/ann').set(H); r = await A.get('/api/friends?type=incoming'); assert.equal(r.body.items.length, 0);
  // email notifications off => no email, in-app still
  await B.patch('/api/me/settings').set(H).send({ email_notifications: false }); testOutbox.length = 0;
  await post(C, '/api/friends/ben'); assert.ok(!testOutbox.some((m) => m.to === 'ben@s.io'));
  r = await B.get('/api/friends?type=incoming'); assert.equal(r.body.items.length, 1);
});

test('follow / unfollow', async () => {
  let r = await A.put('/api/users/ben/follow').set(H); assert.equal(r.body.following, true);
  r = await C.get('/api/users/ben'); assert.equal(r.body.follower_count, 1);
  r = await A.delete('/api/users/ben/follow').set(H); r = await A.get('/api/users/ben'); assert.equal(r.body.following, false);
});

test('blocking hides both users from each other', async () => {
  const p = (await post(C, '/api/posts').field('body', 'cal public post')).body;
  let r = await A.put('/api/users/cal/block').set(H); assert.equal(r.body.blocked, true);
  r = await A.get('/api/users/cal'); assert.equal(r.status, 404);
  r = await C.get('/api/users/ann'); assert.equal(r.status, 404, 'hidden the other way too');
  r = await A.get(`/api/posts/${p.id}`); assert.equal(r.status, 404);
  r = await A.get('/api/search?q=cal&type=people'); assert.equal(r.body.items.length, 0);
  r = await post(C, '/api/friends/ann'); assert.equal(r.status, 404, 'cannot friend a blocker');
  r = await A.get('/api/me/blocked'); assert.equal(r.body.items[0].username, 'cal');
  r = await A.delete(`/api/me/blocked/${r.body.items[0].id}`).set(H); r = await A.get('/api/users/cal'); assert.equal(r.status, 200);
});

test('likes and comments create in-app notifications', async () => {
  const p = (await post(A, '/api/posts').field('body', 'notify me')).body;
  await B.put(`/api/posts/${p.id}/like`).set(H);
  await post(B, `/api/posts/${p.id}/comments`).send({ body: 'hey' });
  const r = await A.get('/api/notifications'); const types = r.body.items.map((n) => n.type);
  assert.ok(types.includes('like') && types.includes('comment'));
});

let page;
test('pages, groups, communities: create, view, follow/join, post, search, act as page', async () => {
  let r = await post(A, '/api/spaces').field('kind', 'page').field('name', 'Ann Bakery').field('category', 'Local business').field('description', 'Fresh bread daily').attach('photo', png, { filename: 'p.png', contentType: 'image/png' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); page = r.body; assert.equal(page.slug, 'ann-bakery'); assert.equal(page.my_role, 'owner');
  r = await post(A, '/api/spaces').field('kind', 'group').field('name', 'Lagos Runners').field('category', 'Sports'); const group = r.body;
  r = await post(A, '/api/spaces').field('kind', 'community').field('name', 'Ann Bakery').field('category', 'Food & drink'); assert.notEqual(r.body.slug, 'ann-bakery', 'unique slug');
  r = await post(A, '/api/spaces').field('kind', 'page').field('name', 'X').field('category', 'Business'); assert.equal(r.status, 400);
  r = await B.put('/api/spaces/ann-bakery/membership').set(H); assert.equal(r.body.my_role, 'follower'); assert.equal(r.body.member_count, 2);
  r = await post(B, '/api/posts').field('body', 'not allowed').field('space_id', String(page.id)); assert.equal(r.status, 403, 'only admins post on a page');
  r = await post(B, '/api/posts').field('body', 'hi group').field('space_id', String(group.id)); assert.equal(r.status, 403, 'join first');
  await B.put(`/api/spaces/${group.slug}/membership`).set(H);
  r = await post(B, '/api/posts').field('body', 'hi group').field('space_id', String(group.id)); assert.equal(r.status, 201); assert.equal(r.body.space.slug, group.slug);
  r = await B.get(`/api/spaces/${group.slug}/posts`); assert.equal(r.body.items[0].body, 'hi group');
  r = await post(A, '/api/posts').field('body', 'Bread is ready').field('space_id', String(page.id)); assert.equal(r.body.author.space, true); assert.equal(r.body.author.full_name, 'Ann Bakery');
  // act as page: posts/comments appear as page
  r = await post(B, '/api/me/acting').send({ space_id: page.id }); assert.equal(r.status, 403);
  r = await post(A, '/api/me/acting').send({ space_id: page.id }); assert.equal(r.status, 200);
  r = await A.get('/api/me'); assert.equal(r.body.acting_as.slug, 'ann-bakery');
  r = await post(A, '/api/posts').field('body', 'as page'); assert.equal(r.body.author.full_name, 'Ann Bakery'); assert.equal(r.body.is_mine, true);
  const asPagePost = r.body;
  r = await post(A, `/api/posts/${asPagePost.id}/comments`).send({ body: 'page comment' }); 
  r = await B.get(`/api/posts/${asPagePost.id}/comments`); assert.equal(r.body.items[0].author.full_name, 'Ann Bakery'); assert.equal(r.body.items[0].is_mine, false);
  r = await A.get('/api/users/ann/posts'); assert.ok(!r.body.items.some((p) => p.id === asPagePost.id), 'page posts not on personal profile');
  await post(A, '/api/me/acting').send({ space_id: null });
  r = await post(A, '/api/posts').field('body', 'as me'); assert.equal(r.body.author.username, 'ann');
  r = await B.get('/api/search?q=bakery&type=pages'); assert.equal(r.body.items[0].slug, 'ann-bakery');
  r = await B.get('/api/search?q=runners&type=groups'); assert.equal(r.body.items.length, 1);
  r = await B.get('/api/search?q=bakery&type=communities'); assert.equal(r.body.items.length, 1);
  r = await B.get('/api/me/spaces'); assert.equal(r.body.items.length, 2);
  r = await B.delete('/api/spaces/ann-bakery').set(H); assert.equal(r.status, 403);
  r = await A.delete(`/api/spaces/${group.slug}/membership`).set(H); assert.equal(r.status, 400, 'owner cannot leave');
});

test('marketplace: create, browse with filters, view, mark sold, delete', async () => {
  await pool.query("INSERT INTO places (id, name, ascii_name, admin1, country, country_code, population, display) VALUES (2337639,'Ikeja','Ikeja','Lagos','Nigeria','NG',313196,'Ikeja, Lagos, Nigeria') ON CONFLICT DO NOTHING");
  let r = await post(A, '/api/listings').field('title', 'iPhone 12').field('price', '250000').field('currency', 'NGN').field('category', 'Phones & tablets').field('description', 'Clean, 128GB').field('place_id', '2337639')
    .attach('photos', png, { filename: 'a.png', contentType: 'image/png' }).attach('photos', png, { filename: 'b.png', contentType: 'image/png' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); const l = r.body; assert.equal(l.photos.length, 2); assert.equal(l.location, 'Ikeja, Lagos, Nigeria');
  r = await post(A, '/api/listings').field('title', 'No photo').field('price', '1').field('currency', 'NGN').field('category', 'Other'); assert.equal(r.status, 400);
  r = await post(A, '/api/listings').field('title', 'Bad cat').field('price', '1').field('currency', 'NGN').field('category', 'Weapons').attach('photos', png, { filename: 'a.png', contentType: 'image/png' }); assert.equal(r.status, 400);
  await post(B, '/api/listings').field('title', 'Office chair').field('price', '30000').field('currency', 'NGN').field('category', 'Home & garden').attach('photos', png, { filename: 'a.png', contentType: 'image/png' });
  r = await C.get('/api/listings?q=iphone'); assert.deepEqual(r.body.items.map((x) => x.title), ['iPhone 12']);
  r = await C.get('/api/listings?max=50000'); assert.deepEqual(r.body.items.map((x) => x.title), ['Office chair']);
  r = await C.get('/api/listings?category=Phones%20%26%20tablets&location=lagos'); assert.equal(r.body.items.length, 1);
  r = await C.get('/api/listings?sort=price_asc'); assert.equal(r.body.items[0].title, 'Office chair');
  r = await C.get(`/api/listings/${l.id}`); assert.equal(r.body.seller.username, 'ann'); assert.equal(r.body.is_mine, false);
  r = await C.patch(`/api/listings/${l.id}`).set(H).send({ status: 'sold' }); assert.equal(r.status, 403);
  r = await A.patch(`/api/listings/${l.id}`).set(H).send({ status: 'sold' }); assert.equal(r.body.status, 'sold');
  r = await C.get('/api/listings?q=iphone'); assert.equal(r.body.items.length, 0, 'sold hidden from browse');
  r = await A.get('/api/listings?mine=1'); assert.equal(r.body.items.length, 1);
  r = await C.delete(`/api/listings/${l.id}`).set(H); assert.equal(r.status, 403);
  r = await A.delete(`/api/listings/${l.id}`).set(H); assert.equal(r.status, 200);
  r = await request(app).get(l.photos[0]); assert.equal(r.status, 404, 'photos removed');
});

test('change password needs current; revokes other sessions', async () => {
  const other = request.agent(app); await post(other, '/api/auth/login').send({ login: 'ben', password: 'Password123!' });
  let r = await post(B, '/api/me/security-code').send({ password: 'wrong', action: 'password' }); assert.equal(r.status, 403);
  r = await post(B, '/api/me/password').send({ current_password: 'Password123!', new_password: 'BenNew12345!' }); assert.equal(r.status, 400, 'code required');
  r = await post(B, '/api/me/security-code').send({ password: 'Password123!', action: 'password' }); assert.equal(r.status, 200);
  const mail = [...testOutbox].reverse().find((m) => m.to === 'ben@s.io' && /security code/.test(m.subject)); assert.match(mail.text, /trying to change your Connectly password from .* at .*UTC/); assert.match(mail.text, /secure your account/);
  r = await post(B, '/api/me/password').send({ current_password: 'Password123!', new_password: 'BenNew12345!', code: lastCode('ben@s.io') === '000000' ? '111111' : '000000' }); assert.equal(r.status, 400);
  r = await post(B, '/api/me/password').send({ current_password: 'wrong', new_password: 'BenNew12345!', code: lastCode('ben@s.io') }); assert.equal(r.status, 403);
  r = await post(B, '/api/me/password').send({ current_password: 'Password123!', new_password: 'BenNew12345!', code: lastCode('ben@s.io') }); assert.equal(r.status, 200);
  assert.ok(testOutbox.some((m) => m.to === 'ben@s.io' && /password was changed/.test(m.subject)), 'alert email');
  r = await other.get('/api/me'); assert.equal(r.status, 401); r = await B.get('/api/me'); assert.equal(r.status, 200);
});

test('change email verified with a code sent to the new address', async () => {
  let r = await post(C, '/api/me/identifier/start').send({ identifier: 'cal.new@s.io', password: 'bad', sec_code: '123456' }); assert.equal(r.status, 403);
  r = await post(C, '/api/me/identifier/start').send({ identifier: 'cal.new@s.io', password: 'Password123!' }); assert.equal(r.status, 400, 'security code required');
  r = await post(C, '/api/me/security-code').send({ password: 'Password123!', action: 'email' }); assert.equal(r.status, 200);
  r = await post(C, '/api/me/identifier/start').send({ identifier: 'cal.new@s.io', password: 'Password123!', sec_code: lastCode('cal@s.io') }); assert.equal(r.status, 200);
  r = await post(C, '/api/me/identifier/confirm').send({ identifier: 'cal.new@s.io', code: '000000' === lastCode('cal.new@s.io') ? '111111' : '000000' }); assert.equal(r.status, 400);
  r = await post(C, '/api/me/identifier/confirm').send({ identifier: 'cal.new@s.io', code: lastCode('cal.new@s.io') }); assert.equal(r.status, 200);
  r = await C.get('/api/me'); assert.equal(r.body.email, 'cal.new@s.io');
  assert.ok(testOutbox.some((m) => m.to === 'cal@s.io' && /email address was changed/.test(m.subject)), 'alert to old email');
  r = await post(C, '/api/me/identifier/start').send({ identifier: '08031234567', password: 'Password123!' }); assert.equal(r.status, 400, 'phone needs SMS');
});

test('sessions, logout others, login history, activity log', async () => {
  const other = request.agent(app); await post(other, '/api/auth/login').send({ login: 'ann', password: 'Password123!' });
  let r = await A.get('/api/me/sessions'); assert.ok(r.body.items.length >= 2); assert.equal(r.body.items[0].current, true);
  r = await post(A, '/api/me/sessions/logout-others'); assert.ok(r.body.ended >= 1);
  r = await other.get('/api/me'); assert.equal(r.status, 401);
  r = await A.get('/api/me/logins'); assert.ok(r.body.items.length >= 2); assert.ok(r.body.items.some((x) => x.method === 'signup'));
  r = await A.get('/api/me/activity?type=posts'); assert.ok(r.body.items.length >= 1);
  r = await B.get('/api/me/activity?type=likes'); assert.equal(r.body.items.length, 1);
  r = await B.get('/api/me/activity?type=comments'); assert.equal(r.body.items.length, 1);
});

test('save account and sign out, one-tap login, remove saved account', async () => {
  const dev = request.agent(app);
  await post(dev, '/api/auth/login').send({ login: 'ann', password: 'Password123!' });
  let r = await post(dev, '/api/auth/logout').send({ save: true }); assert.equal(r.body.saved, true);
  const devCookie = r.headers['set-cookie'].find((c) => c.startsWith('cx_device=')); assert.match(devCookie, /HttpOnly/);
  r = await dev.get('/api/me'); assert.equal(r.status, 401);
  r = await dev.get('/api/auth/saved'); assert.deepEqual(r.body.items.map((u) => u.username), ['ann']); assert.equal(r.body.items[0].password_hash, undefined);
  r = await post(request.agent(app), '/api/auth/saved/login').send({ user_id: r.body.items[0].id }); assert.equal(r.status, 401, 'other device cannot use it');
  const annId = (await dev.get('/api/auth/saved')).body.items[0].id;
  r = await post(dev, '/api/auth/saved/login').send({ user_id: annId }); assert.equal(r.status, 200);
  r = await dev.get('/api/me'); assert.equal(r.body.username, 'ann');
  r = await A.get('/api/me/sessions'); assert.equal(r.body.saved_devices.length, 1);
  await post(dev, '/api/auth/logout').send({});
  r = await dev.delete(`/api/auth/saved/${annId}`).set(H); r = await dev.get('/api/auth/saved'); assert.equal(r.body.items.length, 0);
  r = await post(dev, '/api/auth/saved/login').send({ user_id: annId }); assert.equal(r.status, 401, 'revoked');
});

test('privacy defaults: profile details visible to friends only', async () => {
  await A.patch('/api/me').set(H).send({ bio: 'secret bio', work_company: 'Acme' });
  await A.patch('/api/me/settings').set(H).send({ profile_details_visibility: 'friends', default_post_visibility: 'friends' });
  let r = await C.get('/api/users/ann'); assert.equal(r.body.bio, ''); assert.equal(r.body.work_company, '');
  r = await A.get('/api/me'); assert.equal(r.body.default_post_visibility, 'friends');
  await post(C, '/api/friends/ann'); await post(A, '/api/friends/cal/accept');
  r = await C.get('/api/users/ann'); assert.equal(r.body.bio, 'secret bio');
  r = await C.get('/api/users/ann'); assert.equal(r.body.created_at, undefined, 'join date hidden');
});
