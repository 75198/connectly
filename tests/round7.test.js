import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { config } from '../server/config.js';
import { testOutbox } from '../server/mailer.js';
import { sentPushes } from '../server/push.js';
import { totpAt } from '../server/totp.js';
import { extractTags } from '../server/round7.js';
import { H, register, lastCode } from './helpers7.js';

let app, A, B, C;
const png = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3366ff' } }).png().toBuffer();
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  for (const k of ['messages', 'verified', 'hashtags', 'forYou', 'push', 'i18n', 'translate', 'creatorTools', 'events', 'polls', 'closeFriends', 'hideLikes', 'twoStep', 'loginAlerts', 'stickers']) config.features[k] = true;
  config.dmBurstPerMinute = 1000;
  app = createApp();
  A = await register(app, 'amy'); B = await register(app, 'ben'); C = await register(app, 'cal');
});
after(() => pool.end());

test('hashtag extraction', () => {
  assert.deepEqual(extractTags('Hello #World and #café #123 a#b #world'), ['world', 'café']);
});

test('direct messages: 1:1, text, photo standard vs HD, read receipts, typing, burst limit', async () => {
  await B.put(`/api/users/${A.username}/follow`).set(H).send({});
  let r = await A.post('/api/conversations').set(H).send({ usernames: [B.username] }); assert.equal(r.status, 201);
  const cid = r.body.id;
  r = await A.post('/api/conversations').set(H).send({ usernames: [B.username] }); assert.equal(r.body.id, cid, 'same 1:1 reused');
  r = await A.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'Hi Ben'); assert.equal(r.status, 201); const m1 = r.body.id;
  const img = await png();
  r = await A.post(`/api/conversations/${cid}/messages`).set(H).field('hd', '0').attach('file', img, 'a.png'); assert.equal(r.status, 201); assert.equal(r.body.media_hd, false);
  const std = await sharp(`${config.uploadDir}/${r.body.media_path.slice('/uploads/'.length)}`).metadata(); assert.equal(std.width, 1600);
  r = await A.post(`/api/conversations/${cid}/messages`).set(H).field('hd', '1').attach('file', img, 'a.png'); assert.equal(r.body.media_hd, true);
  const hd = await sharp(`${config.uploadDir}/${r.body.media_path.slice('/uploads/'.length)}`).metadata(); assert.equal(hd.width, 3000);
  r = await B.get('/api/conversations'); assert.equal(r.body.items[0].unread, 3);
  assert.ok(sentPushes.some((p) => p.userId === B.id && p.url === `/messages/${cid}`));
  await B.post(`/api/conversations/${cid}/typing`).set(H).send({ typing: true });
  r = await A.get(`/api/conversations/${cid}/messages`); assert.deepEqual(r.body.typing, [B.id]);
  await B.post(`/api/conversations/${cid}/read`).set(H).send({ last_id: m1 + 100 });
  r = await A.get(`/api/conversations/${cid}/messages`); assert.ok(r.body.reads[B.id] >= m1);
  r = await C.get(`/api/conversations/${cid}/messages`); assert.equal(r.status, 404, 'non-members cannot read');
  r = await A.post(`/api/conversations/${cid}/messages`).set(H).field('sticker', 'wave'); assert.equal(r.status, 201); assert.equal(r.body.kind, 'sticker');
  config.dmBurstPerMinute = 3;
  r = await A.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'too fast'); assert.equal(r.status, 429);
  assert.doesNotMatch(r.body.error, /\d/, 'no numbers shown');
  config.dmBurstPerMinute = 1000;
  r = await A.put(`/api/conversations/${cid}/theme`).set(H).send({ theme: 'ocean', scope: 'chat' }); assert.equal(r.status, 200);
  r = await A.put(`/api/conversations/${cid}/theme`).set(H).send({ theme: 'sunset', scope: 'all' });
  r = await A.get(`/api/conversations/${cid}`); assert.equal(r.body.theme, 'ocean');
  r = await A.post(`/api/conversations/${cid}/wallpaper`).set(H).field('scope', 'chat').attach('image', img, 'w.png'); assert.ok(r.body.wallpaper_path);
});

test('group chat + leave', async () => {
  let r = await A.post('/api/conversations').set(H).send({ usernames: [B.username, C.username], title: 'Crew' }); assert.equal(r.status, 201);
  const g = r.body.id;
  r = await C.post(`/api/conversations/${g}/messages`).set(H).field('body', 'hey all'); assert.equal(r.status, 201);
  r = await C.post(`/api/conversations/${g}/leave`).set(H).send({}); assert.equal(r.status, 200);
  r = await C.get(`/api/conversations/${g}/messages`); assert.equal(r.status, 404);
});

test('verified badge request + admin approval', async () => {
  let r = await A.post('/api/me/verification').set(H).send({ category: 'Creator', reason: 'I make cooking videos every week.' }); assert.equal(r.status, 201);
  r = await A.post('/api/me/verification').set(H).send({ category: 'Creator', reason: 'I make cooking videos every week.' }); assert.equal(r.status, 409);
  r = await B.get('/api/admin/verification'); assert.equal(r.status, 403);
  await pool.query("INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING", [B.id]);
  r = await B.get('/api/admin/verification'); const req = r.body.items[0];
  r = await B.post(`/api/admin/verification/${req.id}`).set(H).send({ decision: 'approve' }); assert.equal(r.status, 200);
  r = await A.post('/api/posts').set(H).field('body', 'Verified now #Cooking #food'); assert.equal(r.body.author.verified, true);
  r = await C.get(`/api/users/${A.username}`); assert.equal(r.body.verified, true);
});

test('hashtags, trending, for-you feed', async () => {
  await B.post('/api/posts').set(H).field('body', 'More #cooking tips');
  let r = await C.get('/api/hashtags/cooking/posts'); assert.equal(r.body.items.length, 2);
  r = await C.get('/api/trending'); assert.equal(r.body.items[0].tag, 'cooking'); assert.equal(r.body.items[0].posts, 2);
  r = await C.get('/api/feed/for-you'); assert.equal(r.status, 200); assert.ok(r.body.items.length >= 2);
});

test('creator tools: scheduled, pinned, insights; hide like counts', async () => {
  const at = new Date(Date.now() + 3600e3).toISOString();
  let r = await A.post('/api/posts').set(H).field('body', 'Future post').field('scheduled_for', at); assert.equal(r.status, 201); const sid = r.body.id;
  r = await B.get(`/api/posts/${sid}`); assert.equal(r.status, 404, 'scheduled posts hidden from others');
  r = await A.get('/api/me/scheduled'); assert.equal(r.body.items.length, 1);
  r = await A.post('/api/posts').set(H).field('body', 'Pin me').field('hide_like_count', '1'); const pid = r.body.id;
  await B.put(`/api/posts/${pid}/like`).set(H).send({ reaction: 'love' });
  r = await B.get(`/api/posts/${pid}`); assert.equal(r.body.like_count, null, 'like count hidden from others');
  r = await A.get(`/api/posts/${pid}`); assert.equal(Number(r.body.like_count), 1);
  r = await A.put(`/api/posts/${pid}/pin`).set(H).send({}); assert.equal(r.status, 200);
  r = await C.get(`/api/users/${A.username}/pinned`); assert.equal(r.body.items[0].id, pid);
  await B.post('/api/impressions').set(H).send({ ids: [pid] }); await C.post('/api/impressions').set(H).send({ ids: [pid] });
  r = await A.get(`/api/posts/${pid}/insights`); assert.equal(r.body.reach, 2); assert.equal(r.body.reactions, 1);
  r = await B.get(`/api/posts/${pid}/insights`); assert.equal(r.status, 404);
  r = await A.patch('/api/me/prefs').set(H).send({ hide_like_counts: true, locale: 'ar' }); assert.equal(r.body.locale, 'ar'); assert.equal(r.body.hide_like_counts, true);
});

test('polls and events with reminders', async () => {
  let r = await A.post('/api/posts').set(H).field('body', 'Which?').field('poll', JSON.stringify({ question: 'Tea or coffee?', options: ['Tea', 'Coffee'] }));
  const poll = r.body.poll; assert.equal(poll.options.length, 2);
  r = await B.put(`/api/polls/${poll.id}/vote`).set(H).send({ option: 1 }); assert.equal(r.body.poll.counts['1'], 1); assert.equal(r.body.poll.my_vote, 1);
  r = await A.post('/api/events').set(H).send({ title: 'Picnic', starts_at: new Date(Date.now() + 30 * 60e3).toISOString(), location: 'Park' }); assert.equal(r.status, 201); const eid = r.body.id;
  r = await B.put(`/api/events/${eid}/rsvp`).set(H).send({ status: 'going' }); assert.equal(r.body.going, 2);
  const { sendEventReminders } = await import('../server/round7.js'); const { notify } = await import('../server/social.js');
  assert.equal(await sendEventReminders(notify), 1);
  assert.ok(sentPushes.some((p) => p.userId === B.id && p.url === `/events/${eid}`));
  assert.equal(await sendEventReminders(notify), 0, 'reminders sent once');
});

test('close friends stories', async () => {
  await A.post('/api/follows').catch(() => {});
  await B.put(`/api/users/${A.username}/follow`).set(H).send({}); await C.put(`/api/users/${A.username}/follow`).set(H).send({});
  await A.put(`/api/me/close-friends/${B.username}`).set(H).send({});
  const img = await png();
  let r = await A.post('/api/stories').set(H).field('audience', 'close_friends').attach('image', img, 's.png'); assert.equal(r.status, 201);
  r = await B.get('/api/stories'); assert.ok(r.body.items.some((g) => g.author.id === A.id));
  r = await C.get('/api/stories'); assert.ok(!r.body.items.some((g) => g.author.id === A.id));
});

test('two-step login with TOTP and email code, plus new-device alert', async () => {
  let r = await C.post('/api/me/two-step/totp/setup').set(H).send({}); const secret = r.body.secret; assert.match(r.body.qr, /^data:image\/png/);
  r = await C.post('/api/me/two-step/totp/enable').set(H).send({ code: totpAt(secret) }); assert.equal(r.status, 200);
  r = await C.put('/api/me/two-step/email').set(H).send({ enabled: true }); assert.equal(r.status, 200);
  const D = request.agent(app);
  r = await D.post('/api/auth/login').set(H).set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Firefox/120.0').send({ login: C.email, password: 'Password123!' });
  assert.equal(r.body.two_step, true); assert.deepEqual(r.body.methods.sort(), ['email', 'totp']);
  assert.equal((await D.get('/api/me')).status, 401, 'not signed in yet');
  let x = await D.post('/api/auth/login/two-step').set(H).send({ ticket: r.body.ticket, method: 'totp', code: '000000' }); assert.equal(x.status, 400);
  x = await D.post('/api/auth/login/two-step').set(H).set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Firefox/120.0').send({ ticket: r.body.ticket, method: 'email', code: lastCode(C.email) }); assert.equal(x.status, 200, JSON.stringify(x.body));
  assert.equal((await D.get('/api/me')).status, 200);
  assert.ok(testOutbox.some((m) => m.to === C.email && /new device/i.test(m.text)), 'new-device alert');
  const E = request.agent(app);
  r = await E.post('/api/auth/login').set(H).send({ login: C.email, password: 'Password123!' });
  x = await E.post('/api/auth/login/two-step').set(H).send({ ticket: r.body.ticket, method: 'totp', code: totpAt(secret) }); assert.equal(x.status, 200);
});

test('translate uses Connectly AI and needs the flag', async () => {
  config.groqApiKey = '';
  let r = await A.post('/api/translate').set(H).send({ text: 'Hello', target: 'fr' }); assert.equal(r.status, 503);
  config.features.translate = false;
  r = await A.post('/api/translate').set(H).send({ text: 'Hello', target: 'fr' }); assert.equal(r.status, 404);
  config.features.translate = true;
});

test('flags off hide round 7 APIs', async () => {
  config.features.messages = false; config.features.events = false;
  assert.equal((await A.get('/api/conversations')).status, 404);
  assert.equal((await A.get('/api/events')).status, 404);
  config.features.messages = true; config.features.events = true;
  const caps = (await A.get('/api/auth/capabilities')).body.features; assert.equal(caps.messages, true); assert.equal(caps.for_you, true);
});

test('message requests: hidden receipts until accepted, accept / delete / block, privacy off', async () => {
  const X = await register(app, 'xia'); const Y = await register(app, 'yan');
  let r = await X.get(`/api/users/${Y.username}`); assert.equal(r.body.can_message, true);
  r = await X.post('/api/conversations').set(H).send({ usernames: [Y.username] }); const cid = r.body.id;
  const m = (await X.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'hi')).body;
  r = await Y.get('/api/conversations'); assert.equal(r.body.items.find((c) => c.id === cid).is_request, true);
  r = await Y.get(`/api/conversations/${cid}/messages`); assert.equal(r.body.is_request, true);
  await Y.post(`/api/conversations/${cid}/read`).set(H).send({ last_id: m.id });
  r = await X.get(`/api/conversations/${cid}/messages`); assert.equal(r.body.reads[Y.id], undefined, 'receipt hidden');
  await X.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'still can send');
  r = await Y.post(`/api/conversations/${cid}/request`).set(H).send({ action: 'accept' }); assert.equal(r.status, 200);
  r = await X.get(`/api/conversations/${cid}/messages`); assert.ok(r.body.reads[Y.id] >= m.id, 'receipt visible after accept');
  const Z = await register(app, 'zed');
  r = await Z.post('/api/conversations').set(H).send({ usernames: [Y.username] }); const c2 = r.body.id;
  await Z.post(`/api/conversations/${c2}/messages`).set(H).field('body', 'spam');
  r = await Y.post(`/api/conversations/${c2}/request`).set(H).send({ action: 'block' }); assert.equal(r.status, 200);
  r = await Z.post(`/api/conversations/${c2}/messages`).set(H).field('body', 'again'); assert.equal(r.status, 403);
  await Y.put('/api/me/dm-privacy').set(H).send({ dm_privacy: 'off' });
  r = await X.get(`/api/users/${Y.username}`); assert.equal(r.body.can_message, false);
  const W = await register(app, 'wil');
  r = await W.post('/api/conversations').set(H).send({ usernames: [Y.username] }); assert.equal(r.status, 403);
});
