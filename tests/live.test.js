import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { config } from '../server/config.js';
import { powFor } from './pow-helper.js';

const H = { 'X-Connectly-CSRF': '1' };
let app, host, fan, stranger, mod;
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function register(name) {
  const a = request.agent(app); const email = `${name}@live.io`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: `${name} Live`, birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  r = await a.patch('/api/me').set(H).send({ username: name }); assert.equal(r.status, 200);
  return a;
}
const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  config.features.live = true;
  Object.assign(config, { livekitUrl: 'wss://test.livekit.cloud', livekitApiKey: 'APItestkey', livekitApiSecret: 'x'.repeat(40), liveMaxViewers: 1, liveMonthlyMinutes: 4500 });
  app = createApp();
  host = await register('hana'); fan = await register('fred'); stranger = await register('sam'); mod = await register('mona');
  assert.equal((await fan.put('/api/users/hana/follow').set(H)).status < 300, true);
  assert.equal((await mod.put('/api/users/hana/follow').set(H)).status < 300, true);
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'mona' AND r.name IN ('admin','moderator') ON CONFLICT DO NOTHING");
});
after(() => pool.end());

test('flag off hides the API; not configured gives a friendly 503', async () => {
  config.features.live = false;
  assert.equal((await host.post('/api/live').set(H).send({})).status, 404);
  config.features.live = true;
  assert.equal((await request(app).get('/api/auth/capabilities')).body.features.live, true);
  const k = config.livekitApiSecret; config.livekitApiSecret = '';
  const r = await host.post('/api/live').set(H).send({});
  assert.equal(r.status, 503); assert.equal(r.body.code, 'LIVE_NOT_CONFIGURED');
  assert.equal((await host.get('/api/live/status')).body.configured, false);
  config.livekitApiSecret = k;
});

let sid;
test('go live: host gets publish token, followers notified, live row visible to followers only', async () => {
  const r = await host.post('/api/live').set(H).send({ title: 'Cooking jollof' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  sid = r.body.stream.id; assert.equal(r.body.url, 'wss://test.livekit.cloud');
  const g = jwt(r.body.token); assert.equal(g.video.canPublish, true); assert.equal(g.video.room.startsWith('cx-live-'), true); assert.equal(g.sub, `u${r.body.stream.host.id}`);
  assert.ok(!JSON.stringify(r.body).includes('x'.repeat(40)));
  assert.equal((await host.post('/api/live').set(H).send({})).status, 409);
  const n = await fan.get('/api/notifications'); const ln = n.body.items.find((x) => x.type === 'live');
  assert.ok(ln); assert.equal(Number(ln.live_stream_id), sid);
  assert.equal((await fan.get('/api/live')).body.items.length, 1);
  assert.equal((await stranger.get('/api/live')).body.items.length, 0);
  assert.equal((await stranger.post(`/api/live/${sid}/join`).set(H)).status, 404);
});

test('viewers: subscribe-only token, viewer cap, comments, reactions, heartbeat', async () => {
  const j = await fan.post(`/api/live/${sid}/join`).set(H);
  assert.equal(j.status, 200); assert.equal(jwt(j.body.token).video.canPublish, false); assert.equal(j.body.stream.viewer_count, 1);
  const full = await mod.post(`/api/live/${sid}/join`).set(H);
  assert.equal(full.status, 429); assert.equal(full.body.limit, 'viewers');
  assert.equal((await fan.post(`/api/live/${sid}/comments`).set(H).send({ body: 'Looks tasty!' })).status, 201);
  assert.equal((await fan.post(`/api/live/${sid}/reactions`).set(H).send({ reaction: '🔥' })).status, 201);
  assert.equal((await fan.post(`/api/live/${sid}/reactions`).set(H).send({ reaction: '💩' })).status, 400);
  const ev = await host.get(`/api/live/${sid}/events`);
  assert.equal(ev.body.viewer_count, 1); assert.equal(ev.body.comments[0].body, 'Looks tasty!'); assert.equal(ev.body.reactions[0].reaction, '🔥');
  const after = await host.get(`/api/live/${sid}/events?after_comment=${ev.body.comments[0].id}`); assert.equal(after.body.comments.length, 0);
  const hb = await host.post(`/api/live/${sid}/heartbeat`).set(H); assert.equal(hb.body.status, 'live');
  assert.equal((await fan.post(`/api/live/${sid}/leave`).set(H)).status, 200);
  assert.equal((await host.get(`/api/live/${sid}`)).body.viewer_count, 0);
});

test('report a live goes to the moderation queue; admin can end it', async () => {
  const r = await fan.post(`/api/live/${sid}/report`).set(H).send({ reason: 'Spam stream' });
  assert.equal(r.status, 201);
  const rep = await mod.get('/api/admin/reports'); assert.ok(rep.body.items.some((x) => x.reason.includes(`[Live #${sid}]`)));
  assert.equal((await fan.post(`/api/admin/live/${sid}/end`).set(H)).status, 403);
  assert.equal((await mod.post(`/api/admin/live/${sid}/end`).set(H)).status, 200);
  const s = await host.get(`/api/live/${sid}`); assert.equal(s.body.status, 'ended'); assert.equal(s.body.end_reason, 'moderator');
  assert.equal((await fan.post(`/api/live/${sid}/comments`).set(H).send({ body: 'hi' })).status, 410);
});

test('time limit auto-ends and monthly budget blocks new lives', async () => {
  const r = await host.post('/api/live').set(H).send({}); assert.equal(r.status, 201);
  await pool.query("UPDATE live_streams SET ends_by = now() - interval '1 second' WHERE id = $1", [r.body.stream.id]);
  assert.equal((await host.get(`/api/live/${r.body.stream.id}`)).body.end_reason, 'time_limit');
  await pool.query('UPDATE live_participants SET seconds = 4500 * 60 WHERE stream_id = $1', [r.body.stream.id]);
  const m = await host.post('/api/live').set(H).send({}); assert.equal(m.status, 429); assert.equal(m.body.limit, 'monthly');
  assert.equal((await host.get('/api/live/status')).body.month_remaining, 0);
});
