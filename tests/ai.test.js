import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { createApp, pool } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testOutbox } from '../server/mailer.js';
import { config } from '../server/config.js';
import { powFor } from './pow-helper.js';

const H = { 'X-Connectly-CSRF': '1' };
let app, A, B, mock, mockMode = 'ok', lastBody = null, lastAuth = null;
const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
async function register(name) {
  const a = request.agent(app); const email = `${name}@ai.io`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: 'Ada Tester', birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  return a;
}
const lines = (text) => text.trim().split('\n').map((l) => JSON.parse(l));
const chat = (agent, json) => agent.post('/api/ai/chat').set(H).send(json).buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d)); });

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      lastBody = JSON.parse(b); lastAuth = req.headers.authorization;
      if (mockMode === 'down') { res.writeHead(500); return res.end('boom'); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of ['Hi! ', 'Tap ', '"What\'s on your mind?"']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  Object.assign(config, { groqApiKey: 'test-key', groqBaseUrl: `http://127.0.0.1:${mock.address().port}`, aiUserHourly: 3, aiDailyCap: 5 });
  config.features.aiSupport = true;
  app = createApp();
  A = await register('ada'); B = await register('bea');
});
after(() => { mock.close(); return pool.end(); });

test('flag off hides the API; capabilities expose the flag', async () => {
  config.features.aiSupport = false;
  assert.equal((await A.get('/api/ai/status')).status, 404);
  assert.equal((await request(app).get('/api/auth/capabilities')).body.features.ai_support, false);
  config.features.aiSupport = true;
  assert.equal((await request(app).get('/api/auth/capabilities')).body.features.ai_support, true);
  assert.equal((await request(app).get('/api/ai/status')).status, 401);
});

test('chat streams via the server proxy, saves history, key never sent to the browser', async () => {
  const r = await chat(A, { message: 'How do I post?' });
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /ndjson/);
  const ev = lines(r.body);
  assert.ok(ev[0].conversation_id);
  assert.equal(ev.filter((e) => e.t).map((e) => e.t).join(''), 'Hi! Tap "What\'s on your mind?"');
  assert.ok(ev.at(-1).done);
  assert.ok(!r.body.includes('test-key'));
  assert.equal(lastAuth, 'Bearer test-key');
  assert.equal(lastBody.messages[0].role, 'system'); assert.match(lastBody.messages[0].content, /Connectly AI/);
  assert.equal(lastBody.messages.at(-1).content, 'How do I post?'); assert.equal(lastBody.stream, true);
  const list = await A.get('/api/ai/conversations'); assert.equal(list.body.items.length, 1); assert.equal(list.body.items[0].title, 'How do I post?');
  const conv = await A.get(`/api/ai/conversations/${ev[0].conversation_id}`);
  assert.deepEqual(conv.body.messages.map((m) => m.role), ['user', 'assistant']);
  // follow-up keeps context
  const r2 = await chat(A, { conversation_id: ev[0].conversation_id, message: 'And reels?' });
  assert.equal(lines(r2.body)[0].conversation_id, ev[0].conversation_id);
  assert.equal(lastBody.messages.length, 4);
  // other users can't read or append to it
  assert.equal((await B.get(`/api/ai/conversations/${ev[0].conversation_id}`)).status, 404);
  assert.equal((await B.post('/api/ai/chat').set(H).send({ conversation_id: ev[0].conversation_id, message: 'hi' })).status, 404);
  assert.equal((await B.get('/api/ai/conversations')).body.items.length, 0);
});

test('validation', async () => {
  assert.equal((await A.post('/api/ai/chat').set(H).send({ message: '' })).status, 400);
  assert.equal((await A.post('/api/ai/chat').set(H).send({ message: 'x'.repeat(2001) })).status, 400);
  assert.equal((await A.post('/api/ai/chat').set(H).send({ message: 'hi', extra: 1 })).status, 400);
});

test('graceful fallback when Groq is down or key missing', async () => {
  mockMode = 'down';
  const ev = lines((await chat(B, { message: 'help' })).body);
  assert.ok(ev.at(-1).error && ev.at(-1).fallback);
  mockMode = 'ok';
  config.groqApiKey = '';
  const r = await B.post('/api/ai/chat').set(H).send({ message: 'help' });
  assert.equal(r.status, 503); assert.ok(r.body.fallback); assert.match(r.body.error, /try again/);
  assert.equal((await B.get('/api/ai/status')).body.available, false);
  config.groqApiKey = 'test-key';
});

test('per-user hourly limit and global daily cap', async () => {
  // A has 2 messages; limit 3
  assert.equal((await chat(A, { message: 'third' })).status, 200);
  const r = await A.post('/api/ai/chat').set(H).send({ message: 'fourth' });
  assert.equal(r.status, 429); assert.equal(r.body.limit, 'user'); assert.match(r.body.error, /try again/);
  // daily total now 3 (A) + 1 (B, down) = 4; cap 5
  assert.equal((await chat(B, { message: 'one' })).status, 200);
  const d = await B.post('/api/ai/chat').set(H).send({ message: 'two' });
  assert.equal(d.status, 429); assert.equal(d.body.limit, 'daily');
});

test('write with Connectly AI returns post text and counts toward limits', async () => {
  config.aiUserHourly = 100; config.aiDailyCap = 100;
  const r = await B.post('/api/ai/write').set(H).send({ prompt: 'beach day caption' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.text, 'Hi! Tap "What\'s on your mind?');
  assert.match(lastBody.messages[0].content, /general|anything/i); assert.match(lastBody.messages.at(-1).content, /beach day caption/);
  assert.equal((await B.post('/api/ai/write').set(H).send({ prompt: '' })).status, 400);
  config.aiUserHourly = 0;
  assert.equal((await B.post('/api/ai/write').set(H).send({ prompt: 'x' })).status, 429);
  config.aiUserHourly = 100;
});
