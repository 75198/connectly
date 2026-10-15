import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
export async function migrate({ quiet = false } = {}) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      if (!quiet) console.log('applied migration', f);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
