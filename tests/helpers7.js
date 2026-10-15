import assert from 'node:assert/strict';
import request from 'supertest';
import { testOutbox } from '../server/mailer.js';
import { powFor } from './pow-helper.js';
export const H = { 'X-Connectly-CSRF': '1' };
export const lastCode = (email) => [...testOutbox].reverse().find((m) => m.to === email && /\d{6}/.test(m.text))?.text.match(/\b(\d{6})\b/)[1];
export async function register(app, name, domain = 'r7.io') {
  const a = request.agent(app); const email = `${name}@${domain}`;
  const pow = await powFor(a);
  let r = await a.post('/api/auth/register').set(H).send({ identifier: email, password: 'Password123!', full_name: 'Test Person', birth_date: '1990-01-01', accept_terms: true, pow });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await a.post('/api/auth/verify').set(H).send({ identifier: email, code: lastCode(email) }); assert.equal(r.status, 200);
  const me = (await a.get('/api/me')).body;
  a.email = email; a.username = me.username; a.id = me.id;
  return a;
}
