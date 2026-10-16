import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.MESSAGE_KEY = crypto.randomBytes(32).toString('base64');
const { config } = await import('../server/config.js');
const { pool } = await import('../server/app.js');
const { migrate } = await import('../server/migrate.js');
const m = await import('../server/msgcrypt.js');
before(async () => { await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await migrate({ quiet: true }); });
after(async () => { await pool.end(); });

test('message text is sealed with AES-256-GCM and round-trips; off means plaintext', async () => {
  config.features.msgEncryption = false; assert.equal(m.seal('hi'), 'hi');
  config.features.msgEncryption = true; const s = m.seal('hello world');
  assert.ok(s.startsWith('v1:')); assert.ok(!s.includes('hello')); assert.equal(m.open(s), 'hello world');
  assert.equal(m.open('plain old'), 'plain old', 'legacy rows still readable');
  const t = Buffer.from(s.slice(3), 'base64'); t[t.length - 1] ^= 1; assert.equal(m.open('v1:' + t.toString('base64')), '', 'tampering detected');
});

test('backlog job encrypts existing plaintext messages safely', async () => {
  config.features.msgEncryption = true;
  const { rows: [u] } = await pool.query("INSERT INTO users (username, full_name, email, password_hash, birth_date, email_verified_at) VALUES ('enc1','Enc One','enc1@x.io','x','1990-01-01', now()) RETURNING id");
  const { rows: [c] } = await pool.query('INSERT INTO conversations (is_group, created_by) VALUES (false, $1) RETURNING id', [u.id]);
  await pool.query("INSERT INTO messages (conversation_id, sender_id, kind, body) VALUES ($1,$2,'text','old secret')", [c.id, u.id]);
  const n = await m.encryptBacklog(); assert.equal(n, 1);
  const { rows: [r] } = await pool.query('SELECT body FROM messages WHERE conversation_id = $1', [c.id]);
  assert.ok(r.body.startsWith('v1:')); assert.equal(m.open(r.body), 'old secret');
  assert.equal(await m.encryptBacklog(), 0, 'idempotent');
});
