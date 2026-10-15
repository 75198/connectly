import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import sharp from 'sharp';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { config } from '../server/config.js';
import { testOutbox } from '../server/mailer.js';
import { powFor } from './pow-helper.js';
import { H } from './helpers7.js';
import { sweepDisappearing } from '../server/round9.js';
import { parseFeed } from '../server/news.js';

let app, A, B, C, png, mock, lastBody = null, lastPath = '';
const code = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function reg(name, birth = '1990-01-01') {
  const a = request.agent(app); const email = `${name}@r9.io`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: 'Test ' + name, birth_date: birth, accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: code(email) }); assert.equal(r.status, 200);
  const me = (await a.get('/api/me')).body; a.username = me.username; a.id = me.id; a.email = email; return a;
}
const lines = (t) => t.trim().split('\n').map((l) => JSON.parse(l));
const raw = (r) => r.buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d)); });

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  for (const k of ['messages', 'closeFriends', 'privateAccounts', 'whoCan', 'hidePresence', 'hideLists', 'restrictMute', 'hiddenWords', 'disappearing', 'dataExport', 'discoverability', 'teenSafety', 'collections', 'addYours', 'aiSupport', 'aiVision', 'aiVoice', 'news']) config.features[k] = true;
  mock = http.createServer((req, res) => {
    let b = []; req.on('data', (c) => b.push(c)); req.on('end', () => {
      lastPath = req.url; const body = Buffer.concat(b);
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-20b' }, { id: 'meta-llama/llama-4-scout-17b-16e-instruct' }, { id: 'whisper-large-v3-turbo' }] })); }
      if (req.url.endsWith('/audio/transcriptions')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ text: 'How do I go live?' })); }
      lastBody = JSON.parse(body.toString());
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Sure! ' } }] })}\n\n`); res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  Object.assign(config, { groqApiKey: 'test-key', groqBaseUrl: `http://127.0.0.1:${mock.address().port}`, groqVisionModel: '', aiUserHourly: 100, aiDailyCap: 100, dmBurstPerMinute: 1000 });
  app = createApp();
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#1199aa' } }).png().toBuffer();
  A = await reg('ada'); B = await reg('ben'); C = await reg('cal');
});
after(() => { mock.close(); return pool.end(); });

test('defaults keep existing visibility: public account, everyone can comment, lists visible, not discoverable by email', async () => {
  const p = (await A.get('/api/me/privacy')).body;
  assert.equal(p.is_private, false); assert.equal(p.who_can_comment, 'everyone'); assert.equal(p.hide_follow_lists, false); assert.equal(p.discover_by_email, false);
  const post = (await A.post('/api/posts').set(H).field('body', 'hello world')).body;
  assert.equal((await B.get(`/api/posts/${post.id}`)).status, 200);
  assert.equal((await B.get(`/api/search?q=${encodeURIComponent(A.email)}`)).body.items.length, 0);
});

test('private account: follow becomes a request; only approved followers see posts; going public approves', async () => {
  await A.patch('/api/me/privacy').set(H).send({ is_private: true });
  const post = (await A.post('/api/posts').set(H).field('body', 'private hello')).body;
  assert.equal((await B.get(`/api/posts/${post.id}`)).status, 404);
  let r = await B.put(`/api/users/${A.username}/follow`).set(H); assert.equal(r.body.requested, true);
  assert.equal((await B.get(`/api/users/${A.username}`)).body.locked, true);
  assert.equal((await B.get(`/api/users/${A.username}/followers`)).body.hidden, true);
  r = await A.get('/api/me/follow-requests'); assert.equal(r.body.items[0].username, B.username);
  await A.post(`/api/me/follow-requests/${B.id}`).set(H).send({ action: 'approve' });
  assert.equal((await B.get(`/api/posts/${post.id}`)).status, 200);
  await C.put(`/api/users/${A.username}/follow`).set(H);
  await A.patch('/api/me/privacy').set(H).send({ is_private: false });
  assert.equal((await C.get(`/api/users/${A.username}`)).body.following, true);
});

test('who can comment, hide lists, presence', async () => {
  const post = (await A.post('/api/posts').set(H).field('body', 'comments limited')).body;
  await A.patch('/api/me/privacy').set(H).send({ who_can_comment: 'none', hide_follow_lists: true, hide_presence: true });
  assert.equal((await B.post(`/api/posts/${post.id}/comments`).set(H).send({ body: 'hi' })).status, 403);
  assert.equal((await A.post(`/api/posts/${post.id}/comments`).set(H).send({ body: 'mine' })).status, 201);
  assert.equal((await B.get(`/api/users/${A.username}/following`)).body.hidden, true);
  assert.equal((await A.get(`/api/users/${A.username}/following`)).body.hidden, undefined);
  assert.equal((await B.get(`/api/users/${A.username}/presence`)).body.hidden, true);
  assert.equal((await A.get(`/api/users/${B.username}/presence`)).body.hidden, true); // reciprocal
  await A.patch('/api/me/privacy').set(H).send({ who_can_comment: 'everyone', hide_follow_lists: false, hide_presence: false });
  assert.equal(typeof (await A.get(`/api/users/${B.username}/presence`)).body.online, 'boolean');
});

test('restrict hides comments from others, mute removes from feed, hidden words filter', async () => {
  const post = (await A.post('/api/posts').set(H).field('body', 'restrict test')).body;
  await A.put(`/api/users/${B.username}/restrict`).set(H);
  await B.post(`/api/posts/${post.id}/comments`).set(H).send({ body: 'from ben' });
  await A.patch('/api/me/privacy').set(H).send({ hidden_words: ['spoiler'], hidden_words_on: true });
  await C.post(`/api/posts/${post.id}/comments`).set(H).send({ body: 'big SPOILER here' });
  await C.post(`/api/posts/${post.id}/comments`).set(H).send({ body: 'nice' });
  const asC = (await C.get(`/api/posts/${post.id}/comments`)).body.items.map((c) => c.body);
  assert.deepEqual(asC, ['big SPOILER here', 'nice']); // own hidden comment still visible to its author
  const asB = (await B.get(`/api/posts/${post.id}/comments`)).body.items.map((c) => c.body);
  assert.deepEqual(asB, ['from ben', 'nice']);
  const asA = (await A.get(`/api/posts/${post.id}/comments`)).body.items;
  assert.ok(asA.find((c) => c.restricted) && asA.find((c) => c.hidden));
  await C.put(`/api/users/${A.username}/follow`).set(H);
  await C.put(`/api/users/${A.username}/mute`).set(H).send({});
  assert.ok(!(await C.get('/api/feed')).body.items.some((p) => p.author.id === A.id));
  await C.delete(`/api/users/${A.username}/mute`).set(H);
  assert.ok((await C.get('/api/feed')).body.items.some((p) => p.author.id === A.id));
});

test('disappearing messages expire and screenshot notice is posted; hidden words in DMs', async () => {
  await B.put(`/api/users/${A.username}/follow`).set(H); await A.delete(`/api/users/${B.username}/restrict`).set(H);
  const cid = (await A.post('/api/conversations').set(H).send({ usernames: [B.username] })).body.id;
  await A.put(`/api/conversations/${cid}/disappear`).set(H).send({ seconds: 3600 });
  const m = (await A.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'poof')).body;
  assert.ok(m.expires_at);
  await B.post(`/api/conversations/${cid}/messages`).set(H).field('body', 'a spoiler for you');
  let r = await A.get(`/api/conversations/${cid}/messages`);
  assert.equal(r.body.disappear_seconds, 3600); assert.ok(r.body.items.find((x) => x.body === 'a spoiler for you').filtered);
  await pool.query("UPDATE messages SET expires_at = now() - interval '1 second' WHERE id = $1", [m.id]);
  await sweepDisappearing();
  r = await B.get(`/api/conversations/${cid}/messages`); assert.ok(!r.body.items.some((x) => x.body === 'poof'));
  await B.post(`/api/conversations/${cid}/screenshot`).set(H);
  r = await A.get(`/api/conversations/${cid}/messages`); assert.ok(r.body.items.some((x) => x.kind === 'notice' && /screenshot/.test(x.body)));
});

test('teen safety: new under-18 accounts are private; adults they do not follow cannot message them', async () => {
  const teen = await reg('tia', new Date(Date.now() - 15 * 365.25 * 864e5).toISOString().slice(0, 10));
  assert.equal((await teen.get('/api/me/privacy')).body.is_private, true);
  assert.equal((await A.post('/api/conversations').set(H).send({ usernames: [teen.username] })).status, 403);
  assert.equal((await A.get(`/api/users/${teen.username}`)).body.can_message, false);
  await teen.put(`/api/users/${A.username}/follow`).set(H);
  assert.equal((await A.post('/api/conversations').set(H).send({ usernames: [teen.username] })).status, 201);
  const { rows } = await pool.query('SELECT is_private FROM users WHERE id = $1', [A.id]); assert.equal(rows[0].is_private, false); // adults untouched
});

test('discoverability, collections, close-friends posts, add yours', async () => {
  await A.patch('/api/me/privacy').set(H).send({ discover_by_email: true });
  assert.equal((await B.get(`/api/search?q=${encodeURIComponent(A.email)}`)).body.items[0].username, A.username);
  const post = (await A.post('/api/posts').set(H).field('body', 'save me')).body;
  const col = (await B.post('/api/collections').set(H).send({ name: 'Recipes' })).body;
  await B.put(`/api/collections/${col.id}/posts/${post.id}`).set(H);
  assert.equal((await B.get(`/api/collections/${col.id}/posts`)).body.items[0].id, post.id);
  assert.equal((await B.get('/api/collections')).body.items[0].count, 1);
  const cf = (await A.post('/api/posts').set(H).field('body', 'only besties').field('close_friends', '1')).body;
  assert.equal((await C.get(`/api/posts/${cf.id}`)).status, 404);
  await A.put(`/api/close-friends/${C.id}`).set(H).catch(() => {});
  await pool.query('INSERT INTO close_friends (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [A.id, C.id]);
  assert.equal((await C.get(`/api/posts/${cf.id}`)).status, 200);
  const s = (await A.post('/api/stories').set(H).field('caption', 'go').field('add_yours', 'Your pet').attach('image', png, 's.png')).body;
  await B.post('/api/stories').set(H).field('add_yours_of', String(s.id)).attach('image', png, 's.png');
  const g = (await B.get('/api/stories')).body.items.flatMap((x) => x.items);
  assert.ok(g.every((x) => x.add_yours === 'Your pet')); assert.equal(g[0].add_yours_count, 1);
});

test('data export is a ZIP with my data', async () => {
  const r = await raw(A.get('/api/me/export.zip'));
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /zip/);
  const buf = Buffer.from(r.body, 'binary'); assert.equal(r.body.slice(0, 2), 'PK');
  assert.ok(r.body.includes('profile.json') && r.body.includes('posts.json'));
  assert.ok(!r.body.includes('password_hash')); void buf;
});

test('Connectly AI: voice note is transcribed by Whisper; photos go to the vision model; status reports both', async () => {
  const st = (await A.get('/api/ai/status')).body; assert.equal(st.voice, true); assert.equal(st.vision, true);
  let r = await raw(A.post('/api/ai/chat').set(H).field('lang', 'en').attach('audio', Buffer.from('fake-audio-bytes'), { filename: 'v.webm', contentType: 'audio/webm' }));
  let ev = lines(r.body); assert.equal(ev.find((e) => e.transcript).transcript, 'How do I go live?');
  assert.ok(ev.at(-1).done); assert.equal(typeof ev.at(-1).ttft_ms, 'number');
  assert.equal(lastBody.messages.at(-1).content, 'How do I go live?');
  r = await raw(A.post('/api/ai/chat').set(H).field('message', 'What is this?').attach('image', png, { filename: 'p.png', contentType: 'image/png' }));
  ev = lines(r.body); assert.ok(ev.at(-1).done);
  assert.equal(lastBody.model, 'meta-llama/llama-4-scout-17b-16e-instruct'); assert.match(lastBody.messages.at(-1).content[1].image_url.url, /^data:image\/jpeg;base64,/);
  const conv = (await A.get(`/api/ai/conversations/${ev[0].conversation_id || ev.find((e) => e.conversation_id).conversation_id}`)).body;
  assert.match(conv.messages.find((m) => m.attachment_kind === 'image').attachment_path, /^\/uploads\/ai\/.+\.webp$/);
  config.features.aiVision = false;
  assert.equal((await A.post('/api/ai/chat').set(H).field('message', 'x').attach('image', png, { filename: 'p.png', contentType: 'image/png' })).status, 404);
  config.features.aiVision = true;
});

test('news: RSS parsing keeps only headline, short summary, source, image and link', () => {
  const xml = `<rss><channel><item><title><![CDATA[Big story &amp; more]]></title><link>https://www.bbc.co.uk/news/x</link><description>${'Long text '.repeat(100)}</description><pubDate>Thu, 15 Oct 2026 10:00:00 GMT</pubDate><media:thumbnail width="240" url="https://ichef.bbci.co.uk/a.jpg"/></item><item><title>No link</title></item></channel></rss>`;
  const items = parseFeed(xml, 'bbc_world');
  assert.equal(items.length, 1); assert.equal(items[0].title, 'Big story & more'); assert.equal(items[0].source, 'BBC News');
  assert.ok(items[0].summary.length <= 180); assert.equal(items[0].image, 'https://ichef.bbci.co.uk/a.jpg');
});

test('backfill: open-licence clips and films are credited; suggested accounts are public only', async () => {
  config.features.backfill = true;
  await C.patch('/api/me/privacy').set(H).send({ is_private: true });
  const fresh = await reg('newbie');
  const r = (await fresh.get('/api/backfill')).body;
  assert.ok(r.clips.length >= 6 && r.clips.every((c) => c.license && c.credit && c.source_url && c.video.startsWith('/backfill/')));
  assert.ok(r.films.every((f) => f.embed.startsWith('https://archive.org/embed/') && f.license));
  assert.ok(r.suggested.length >= 1 && !r.suggested.some((u) => u.username === C.username));
  assert.ok((await fresh.get('/api/feed')).body.items.length > 0); // cold start: public posts
});
