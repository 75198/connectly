// Loads the GeoNames cities500 dataset (CC-BY 4.0, https://www.geonames.org) into the places table.
// Usage: node scripts/load-places.js [dataDir]   (expects cities500.txt, admin1CodesASCII.txt, countryInfo.txt)
// Skips if the table is already populated.
import fs from 'node:fs'; import path from 'node:path'; import readline from 'node:readline';
import { pool } from '../server/db.js';
const dir = process.argv[2] || 'data/geonames';
const { rows } = await pool.query('SELECT count(*)::int n FROM places');
if (rows[0].n > 0) { console.log(`places already loaded (${rows[0].n})`); await pool.end(); process.exit(0); }
const countries = new Map();
for (const l of fs.readFileSync(path.join(dir, 'countryInfo.txt'), 'utf8').split('\n')) { if (!l || l[0] === '#') continue; const c = l.split('\t'); countries.set(c[0], c[4]); }
const admin1 = new Map();
for (const l of fs.readFileSync(path.join(dir, 'admin1CodesASCII.txt'), 'utf8').split('\n')) { if (!l) continue; const c = l.split('\t'); admin1.set(c[0], c[1]); }
// GeoNames calls Lagos State "Lagos"; strip " State" suffixes etc. are kept as-is for accuracy.
const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, 'cities500.txt')) });
let batch = []; let total = 0;
const flush = async () => {
  if (!batch.length) return;
  const vals = []; const ph = batch.map((r, i) => { vals.push(...r); const o = i * 8; return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`; });
  await pool.query(`INSERT INTO places (id, name, ascii_name, admin1, country, country_code, population, display) VALUES ${ph.join(',')} ON CONFLICT DO NOTHING`, vals);
  total += batch.length; batch = [];
};
for await (const line of rl) {
  const c = line.split('\t'); if (c.length < 15) continue;
  const [gid, name, ascii] = c; const cc = c[8]; const a1 = admin1.get(`${cc}.${c[10]}`) || ''; const country = countries.get(cc) || cc;
  const display = [name, a1 && a1 !== name ? a1 : null, country].filter(Boolean).join(', ');
  batch.push([Number(gid), name, ascii || name, a1, country, cc, Number(c[14]) || 0, display]);
  if (batch.length >= 2000) await flush();
}
await flush();
await pool.query('ANALYZE places');
console.log(`loaded ${total} places`);
await pool.end();
