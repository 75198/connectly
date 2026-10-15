import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { config } from '../server/config.js';
import { powFor } from './pow-helper.js';

let app, okVid, longVid;
const H = { 'X-Connectly-CSRF': '1' };
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function register(name) {
  const a = request.agent(app); const email = `${name}@reels.io`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: 'Reel Tester', birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  r = await a.patch('/api/me').set(H).send({ username: name }); assert.equal(r.status, 200);
  return a;
}
const mk = (file, seconds) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=180x320:rate=10:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=duration=${seconds}`, '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', file]);
let A, B;
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  app = createApp();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cxr-'));
  okVid = path.join(d, 'ok.mp4'); longVid = path.join(d, 'long.mp4');
  mk(okVid, 2); mk(longVid, 62);
  A = await register('rita'); B = await register('rob');
});
after(() => pool.end());

test('capabilities expose feature flags', async () => {
  const r = await request(app).get('/api/auth/capabilities');
  assert.equal(r.body.features.reels, true); assert.equal(r.body.features.welcome_hero, true);
});

test('upload a reel: transcoded, poster generated, appears in reels feed but not home feed', async () => {
  let r = await A.post('/api/reels').set(H).field('body', 'My first reel').attach('video', okVid, { contentType: 'video/mp4' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kind, 'reel'); assert.match(r.body.video_path, /^\/uploads\/reels\/[0-9a-f]{32}\.mp4$/); assert.match(r.body.poster_path, /\.webp$/);
  assert.ok(r.body.video_seconds > 1 && r.body.video_seconds < 3);
  assert.ok(fs.existsSync(path.join(config.uploadDir, r.body.video_path.slice(9))));
  const v = await A.get(r.body.video_path); assert.equal(v.status, 200);
  const rid = r.body.id;
  r = await B.get('/api/reels'); assert.deepEqual(r.body.items.map((x) => x.id), [rid]);
  r = await B.get('/api/feed'); assert.equal(r.body.items.length, 0);
  // views: one per viewer, author's own views ignored
  r = await A.post(`/api/reels/${rid}/view`).set(H); assert.equal(r.body.view_count, 0);
  r = await B.post(`/api/reels/${rid}/view`).set(H); assert.equal(r.body.view_count, 1);
  r = await B.post(`/api/reels/${rid}/view`).set(H); assert.equal(r.body.view_count, 1);
  // likes, comments, reports reuse the post endpoints
  r = await B.put(`/api/posts/${rid}/like`).set(H); assert.equal(r.body.like_count, 1);
  r = await B.post(`/api/posts/${rid}/comments`).set(H).send({ body: 'Nice!' }); assert.equal(r.status, 201);
  r = await B.post('/api/reports').set(H).send({ target_type: 'post', post_id: rid, reason: 'testing report' }); assert.equal(r.status, 201);
  r = await B.get(`/api/reels/${rid}`); assert.equal(r.body.view_count, 1); assert.equal(r.body.comment_count, 1);
  // moderation hide removes it from the reels feed
  await pool.query('UPDATE posts SET hidden_at = now() WHERE id = $1', [rid]);
  r = await B.get('/api/reels'); assert.equal(r.body.items.length, 0);
  await pool.query('UPDATE posts SET hidden_at = NULL WHERE id = $1', [rid]);
});

test('rejects long, non-video and wrong-type uploads', async () => {
  let r = await A.post('/api/reels').set(H).attach('video', longVid, { contentType: 'video/mp4' });
  assert.equal(r.status, 400); assert.match(r.body.error, /60 seconds/);
  r = await A.post('/api/reels').set(H).attach('video', Buffer.from('not a video at all'), { filename: 'x.mp4', contentType: 'video/mp4' });
  assert.equal(r.status, 400); assert.match(r.body.error, /not a valid video/);
  r = await A.post('/api/reels').set(H).attach('video', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
  assert.equal(r.status, 400);
  r = await A.post('/api/reels').set(H).field('body', 'no file'); assert.equal(r.status, 400);
  r = await request(app).get('/api/reels'); assert.equal(r.status, 401);
});

test('feature flag off hides reels API', async () => {
  config.features.reels = false;
  try { const r = await A.get('/api/reels'); assert.equal(r.status, 404); } finally { config.features.reels = true; }
});
