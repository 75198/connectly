import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { config } from '../server/config.js';
import { syncMusic } from '../server/music/index.js';
import { H, register } from './helpers7.js';

let app, A, B, cid;
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  for (const k of ['messages', 'calls', 'hashtags', 'music', 'remix', 'challenges', 'gifts', 'games', 'watchTogether', 'memories', 'stickers', 'streaks', 'live', 'reels']) config.features[k] = true;
  Object.assign(config, { livekitUrl: 'wss://test.livekit.cloud', livekitApiKey: 'APItestkey', livekitApiSecret: 'x'.repeat(40), dmBurstPerMinute: 1000 });
  app = createApp();
  A = await register(app, 'ana', 'r8.io'); B = await register(app, 'bo', 'r8.io');
  cid = (await A.post('/api/conversations').set(H).send({ usernames: [B.username] })).body.id;
  await pool.query("INSERT INTO roles (name) VALUES ('admin') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING", [A.id]);
});
after(() => pool.end());

test('music catalog: every track has a commercial-use licence, a source and a bundled file; posts and stories use it', async () => {
  assert.ok(await syncMusic() >= 5);
  let r = await A.get('/api/music'); assert.ok(r.body.items.length >= 5);
  const credits = fs.readFileSync('docs/CREDITS.md', 'utf8');
  for (const t of r.body.items) {
    assert.match(t.license, /^(CC0|CC BY( \d\.\d)?( us)?)$/i); assert.match(t.source_url, /^https:\/\//);
    assert.ok(fs.existsSync(`web/public${t.url}`), t.url); assert.ok(credits.includes(t.title), `${t.title} credited`);
  }
  const track = r.body.items[0];
  r = await A.post('/api/posts').set(H).field('body', 'With music #dancechallenge').field('music_track_id', String(track.id)); assert.equal(r.body.music.id, track.id);
  r = await B.get('/api/music/trending'); assert.equal(r.body.items[0].id, track.id);
  r = await B.get(`/api/music/${track.id}`); assert.equal(r.body.posts.items.length, 1);
});

test('challenges', async () => {
  let r = await A.post('/api/challenges').set(H).send({ tag: '#DanceChallenge', title: 'Dance challenge' }); assert.equal(r.status, 201); assert.equal(r.body.entries, 1);
  r = await B.get('/api/challenges'); assert.equal(r.body.items[0].tag, 'dancechallenge');
  r = await B.get('/api/challenges/dancechallenge'); assert.equal(r.body.posts.items.length, 1);
});

test('coins and live gifts: purchase is coming soon, admin grants, gifts move coins', async () => {
  let r = await B.get('/api/coins'); assert.equal(r.body.balance, 0); assert.equal(r.body.purchase, 'coming_soon');
  r = await B.post('/api/coins/purchase').set(H).send({}); assert.equal(r.status, 503);
  const { rows: [s] } = await pool.query("INSERT INTO live_streams (host_id, room, title, ends_by) VALUES ($1, 'r-test', 'Hi', now() + interval '1 hour') RETURNING id", [A.id]);
  r = await B.post(`/api/live/${s.id}/gifts`).set(H).send({ gift: 'rose' }); assert.equal(r.status, 402);
  r = await B.post(`/api/admin/users/${B.id}/coins`).set(H).send({ amount: 100 }); assert.equal(r.status, 403);
  r = await A.post(`/api/admin/users/${B.id}/coins`).set(H).send({ amount: 30 }); assert.equal(r.status, 200);
  r = await B.post(`/api/live/${s.id}/gifts`).set(H).send({ gift: 'cake' }); assert.equal(r.status, 201); assert.equal(r.body.balance, 5);
  r = await B.post(`/api/live/${s.id}/gifts`).set(H).send({ gift: 'trophy' }); assert.equal(r.status, 402);
  r = await A.get('/api/coins'); assert.equal(r.body.balance, 25);
  r = await A.get(`/api/live/${s.id}/gifts`); assert.equal(r.body.items[0].gift, 'cake');
});

test('chat games: tic-tac-toe, quiz, truth or dare', async () => {
  let r = await A.post(`/api/conversations/${cid}/games`).set(H).send({ kind: 'tictactoe' }); const g = r.body.game.id;
  for (const [who, cell] of [[A, 0], [B, 3], [A, 1], [B, 4]]) { r = await who.post(`/api/games/${g}/move`).set(H).send({ cell }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  r = await B.post(`/api/games/${g}/move`).set(H).send({ cell: 5 }); assert.equal(r.status, 400, 'not your turn');
  r = await A.post(`/api/games/${g}/move`).set(H).send({ cell: 2 }); assert.equal(r.body.winner, 'x');
  r = await A.post(`/api/conversations/${cid}/games`).set(H).send({ kind: 'quiz' }); const qz = r.body.game;
  assert.equal(qz.total, 5);
  await A.post(`/api/games/${qz.id}/move`).set(H).send({ answer: 0 }); r = await B.post(`/api/games/${qz.id}/move`).set(H).send({ answer: 1 });
  assert.equal(r.body.index, 1, 'advances when everyone answered');
  r = await A.post(`/api/conversations/${cid}/games`).set(H).send({ kind: 'truth_dare' }); const td = r.body.game.id;
  r = await A.post(`/api/games/${td}/move`).set(H).send({ action: 'truth' }); assert.ok(r.body.prompt);
  r = await B.post(`/api/games/${td}/move`).set(H).send({ action: 'dare' }); assert.equal(r.status, 400);
});

test('calls + watch together', async () => {
  let r = await A.post(`/api/conversations/${cid}/call`).set(H).send({ video: true }); assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.room, `dm-${cid}`);
  r = await A.post('/api/posts').set(H).field('body', 'not a reel');
  const { rows: [reel] } = await pool.query("INSERT INTO posts (author_id, body, kind, video_path, poster_path, image_path, video_seconds) VALUES ($1, 'reel', 'reel', '/x.mp4', '/x.webp', '/x.webp', 10) RETURNING id", [A.id]);
  r = await A.put(`/api/conversations/${cid}/watch`).set(H).send({ post_id: reel.id, position: 2, playing: false }); assert.equal(r.status, 200);
  r = await B.get(`/api/conversations/${cid}/watch`); assert.equal(r.body.session.post.id, reel.id); assert.equal(r.body.session.position, 2);
  r = await B.get(`/api/reels/${reel.id}/remixes`); assert.equal(r.status, 200);
});

test('memories: on this day from past years', async () => {
  const { rows: [p] } = await pool.query("INSERT INTO posts (author_id, body, created_at) VALUES ($1, 'Throwback', now() - interval '2 years') RETURNING id", [A.id]);
  const r = await A.get('/api/memories?tz=UTC'); assert.equal(r.body.items[0].id, p.id); assert.equal(r.body.items[0].years_ago, 2);
  assert.equal((await B.get('/api/memories')).body.items.length, 0);
});

test('stickers, custom emoji reactions on messages', async () => {
  let r = await A.get('/api/stickers'); assert.ok(r.body.stickers.length >= 10);
  for (const s of r.body.stickers) assert.ok(fs.existsSync(`web/public${s.url}`), s.url);
  r = await A.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'react to me'); const mid = r.body.id;
  r = await B.put(`/api/messages/${mid}/reaction`).set(H).send({ emoji: '🔥' }); assert.equal(r.status, 200);
  r = await B.put(`/api/messages/${mid}/reaction`).set(H).send({ emoji: 'not an emoji' }); assert.equal(r.status, 400);
  r = await A.get(`/api/conversations/${cid}/messages`); assert.equal(r.body.items.find((m) => m.id === mid).reactions[B.id], '🔥');
});

test('streaks and badges', async () => {
  await pool.query("INSERT INTO activity_days (user_id, day) SELECT $1, (now() AT TIME ZONE 'UTC')::date - g FROM generate_series(1, 7) g ON CONFLICT DO NOTHING", [A.id]);
  const r = await A.get('/api/me/streak'); assert.equal(r.body.current, 8); assert.ok(r.body.badges.some((b) => b.badge === 'streak_7')); assert.ok(r.body.badges.some((b) => b.badge === 'first_post'));
});
