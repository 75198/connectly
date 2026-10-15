// Seeds demo accounts (alice, bob) and one admin. Idempotent.
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, q } from './db.js';
import { migrate } from './migrate.js';
await migrate({ quiet: true });
async function upsert(username, display, email, pw) {
  const { rows } = await q('SELECT id FROM users WHERE lower(username)=lower($1)', [username]);
  if (rows[0]) return { id: rows[0].id, created: false };
  const r = await q('INSERT INTO users (username, display_name, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING id', [username, display, email, await bcrypt.hash(pw, 12)]);
  return { id: r.rows[0].id, created: true };
}
await upsert('alice', 'Alice Adeyemi', 'alice@example.com', 'Connectly123!');
await upsert('bob', 'Bob Okafor', 'bob@example.com', 'Connectly123!');
const credFile = process.env.ADMIN_CREDENTIALS_FILE || 'ADMIN_CREDENTIALS.txt';
let adminPw = process.env.ADMIN_PASSWORD;
const exists = (await q("SELECT 1 FROM users WHERE username='admin'")).rows.length;
if (!exists && !adminPw) adminPw = crypto.randomBytes(12).toString('base64url') + 'A1!';
const admin = await upsert('admin', 'Connectly Admin', 'admin@connectly.local', adminPw || 'unused');
if (admin.created) {
  fs.writeFileSync(credFile, `Connectly admin login\nusername: admin\npassword: ${adminPw}\n`, { mode: 0o600 });
  console.log('admin created; credentials written to', credFile);
}
await q("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name='admin' ON CONFLICT DO NOTHING", [admin.id]);
await q("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE username IN ('alice','bob','admin')");
console.log('seed complete');
await pool.end();
