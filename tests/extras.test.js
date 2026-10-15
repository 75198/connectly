import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { purgeExpired } from '../server/postextras.js';
import { powFor } from './pow-helper.js';

let app, png;
const H = { 'X-Connectly-CSRF': '1' };
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function register(name) {
  const a = request.agent(app); const email = `${name}@x.io`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: 'Extra Tester', birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  r = await a.patch('/api/me').set(H).send({ username: name }); assert.equal(r.status, 200);
  return a;
}
let A, B;
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  app = createApp();
  png = await sharp({ create: { width: 90, height: 160, channels: 3, background: '#1199aa' } }).png().toBuffer();
  A = await register('xena'); B = await register('xavi');
});
after(() => pool.end());
const feedIds = async (a) => (await a.get('/api/feed')).body.items.map((p) => p.id);

test('composer options: feeling + location tag, and drafts stay out of the feed', async () => {
  let r = await A.post('/api/posts').set(H).field('body', 'Sunny day').field('feeling', 'happy').field('location_tag', 'Lekki, Lagos');
  assert.equal(r.status, 201); assert.equal(r.body.feeling, 'happy'); assert.equal(r.body.location_tag, 'Lekki, Lagos');
  const pid = r.body.id;
  r = await A.post('/api/posts').set(H).field('body', 'Later').field('as_draft', '1'); assert.equal(r.body.is_draft, true);
  const did = r.body.id;
  assert.deepEqual(await feedIds(B), [pid]);
  r = await A.get('/api/me/drafts'); assert.deepEqual(r.body.items.map((p) => p.id), [did]);
  r = await B.get(`/api/posts/${did}`); assert.equal(r.status, 404);
  r = await A.patch(`/api/posts/${did}`).set(H).send({ body: 'Later, edited' }); assert.equal(r.status, 200); assert.equal(r.body.body, 'Later, edited');
  r = await A.post(`/api/posts/${did}/publish`).set(H); assert.equal(r.body.is_draft, false);
  assert.deepEqual(await feedIds(B), [did, pid]);
  // move a published post to drafts
  r = await A.post(`/api/posts/${pid}/draft`).set(H); assert.equal(r.body.is_draft, true);
  assert.deepEqual(await feedIds(B), [did]);
  r = await B.post(`/api/posts/${did}/draft`).set(H); assert.equal(r.status, 404, 'cannot draft others posts');
});

test('delete goes to Recently deleted, can be restored, purged after 30 days', async () => {
  const p = (await A.post('/api/posts').set(H).field('body', 'oops')).body;
  let r = await A.delete(`/api/posts/${p.id}`).set(H); assert.equal(r.body.recently_deleted, true);
  assert.ok(!(await feedIds(B)).includes(p.id));
  r = await A.get('/api/me/deleted'); assert.deepEqual(r.body.items.map((x) => x.id), [p.id]);
  r = await B.post(`/api/posts/${p.id}/restore`).set(H); assert.equal(r.status, 404);
  r = await A.post(`/api/posts/${p.id}/restore`).set(H); assert.equal(r.status, 200);
  assert.ok((await feedIds(B)).includes(p.id));
  await A.delete(`/api/posts/${p.id}`).set(H);
  const keep = (await A.post('/api/posts').set(H).field('body', 'recent delete')).body; await A.delete(`/api/posts/${keep.id}`).set(H);
  await pool.query("UPDATE posts SET deleted_at = now() - interval '31 days' WHERE id = $1", [p.id]);
  const res = await purgeExpired(); assert.equal(res.posts, 1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM posts WHERE id = $1', [p.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM posts WHERE id = $1', [keep.id])).rows[0].n, 1, 'recent deletes are kept');
  r = await A.delete(`/api/posts/${keep.id}/permanent`).set(H); assert.equal(r.status, 200);
});

test('reactions, saved posts, theme preference, stories', async () => {
  const p = (await A.post('/api/posts').set(H).field('body', 'react to me')).body;
  let r = await B.put(`/api/posts/${p.id}/like`).set(H).send({ reaction: 'love' }); assert.equal(r.body.like_count, 1);
  r = await B.put(`/api/posts/${p.id}/like`).set(H).send({ reaction: 'haha' }); assert.equal(r.body.like_count, 1);
  r = await B.get(`/api/posts/${p.id}`); assert.equal(r.body.my_reaction, 'haha'); assert.deepEqual(r.body.reactions, { haha: 1 });
  r = await B.put(`/api/posts/${p.id}/like`).set(H).send({ reaction: 'evil' }); assert.equal(r.status, 400);
  r = await B.put(`/api/posts/${p.id}/save`).set(H); assert.equal(r.body.saved_by_me, true);
  r = await B.get('/api/me/saved'); assert.deepEqual(r.body.items.map((x) => x.id), [p.id]);
  r = await B.delete(`/api/posts/${p.id}/save`).set(H); r = await B.get('/api/me/saved'); assert.equal(r.body.items.length, 0);
  r = await A.patch('/api/me/settings').set(H).send({ theme_pref: 'dark' }); assert.equal(r.status, 200);
  r = await A.get('/api/me'); assert.equal(r.body.theme_pref, 'dark');
  r = await A.patch('/api/me/settings').set(H).send({ theme_pref: 'purple' }); assert.equal(r.status, 400);
  r = await A.post('/api/stories').set(H).field('caption', 'hello').attach('image', png, 's.png'); assert.equal(r.status, 201);
  r = await A.get('/api/stories'); assert.equal(r.body.items[0].items.length, 1);
  r = await B.get('/api/stories'); assert.equal(r.body.items.length, 0, 'not friends / not following');
  await B.put('/api/users/xena/follow').set(H);
  r = await B.get('/api/stories'); assert.equal(r.body.items.length, 1);
  await pool.query("UPDATE stories SET expires_at = now() - interval '2 hours'");
  r = await B.get('/api/stories'); assert.equal(r.body.items.length, 0);
  assert.equal((await purgeExpired()).stories, 1);
});

test('photos keep high resolution (up to 4096px) and optional enhance works', async () => {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#557788' } }).jpeg({ quality: 95 }).toBuffer();
  let r = await A.post('/api/posts').set(H).field('body', 'big').attach('image', big, 'big.jpg'); assert.equal(r.status, 201);
  const fsx = await import('node:fs'); const pathx = await import('node:path'); const { config } = await import('../server/config.js');
  const m = await sharp(fsx.readFileSync(pathx.join(config.uploadDir, r.body.image_path.slice(9)))).metadata();
  assert.equal(m.width, 3000); assert.equal(m.format, 'webp');
  r = await A.post('/api/posts').set(H).field('body', 'enh').field('enhance', '1').attach('image', big, 'big.jpg'); assert.equal(r.status, 201);
});
