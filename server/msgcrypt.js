// Encryption at rest for direct messages: AES-256-GCM with a server key (MESSAGE_KEY in .env, 32 bytes base64).
// Text is stored as "v1:<base64 iv|tag|ciphertext>"; media files are moved to a private folder as encrypted blobs and
// served only to chat members through /api/messages/:id/media. Without the flag or key, nothing changes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { q } from './db.js';

const rawKey = process.env.MESSAGE_KEY ? Buffer.from(process.env.MESSAGE_KEY, 'base64') : null;
const KEY = rawKey && rawKey.length === 32 ? rawKey : null;
export const PRIVATE_DIR = path.resolve(config.uploadDir, '..', 'msg-private');
export const encOn = () => Boolean(config.features.msgEncryption && KEY);

export function sealBuf(buf) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); }
export function openBuf(buf) { const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28)); return Buffer.concat([d.update(buf.subarray(28)), d.final()]); }
export const seal = (text) => (encOn() && text ? 'v1:' + sealBuf(Buffer.from(String(text), 'utf8')).toString('base64') : text);
export function open(text) {
  if (typeof text !== 'string' || !text.startsWith('v1:')) return text;
  if (!KEY) return ''; try { return openBuf(Buffer.from(text.slice(3), 'base64')).toString('utf8'); } catch { return ''; }
}
// Move a public /uploads file into the private folder, encrypted. Returns "enc:<name>" or the original path if off.
export function sealFile(publicPath) {
  if (!encOn() || !publicPath || !String(publicPath).startsWith('/uploads/')) return publicPath;
  const abs = path.join(config.uploadDir, publicPath.slice('/uploads/'.length)); if (!abs.startsWith(config.uploadDir)) return publicPath;
  fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  const name = crypto.randomBytes(16).toString('hex') + path.extname(abs);
  const plain = fs.readFileSync(abs); const sealed = sealBuf(plain);
  if (!openBuf(sealed).equals(plain)) throw new Error('encryption check failed'); // never lose media
  fs.writeFileSync(path.join(PRIVATE_DIR, name), sealed, { mode: 0o600 }); fs.rmSync(abs, { force: true });
  return 'enc:' + name;
}
export function readSealed(encPath) { return openBuf(fs.readFileSync(path.join(PRIVATE_DIR, path.basename(String(encPath).slice(4))))); }
// Decrypt rows for the API: text body, preview body and private media URLs.
export function openRow(m) {
  if (!m) return m; if (m.body) m.body = open(m.body);
  if (typeof m.media_path === 'string' && m.media_path.startsWith('enc:')) m.media_path = `/api/messages/${m.id}/media`;
  if (typeof m.poster_path === 'string' && m.poster_path.startsWith('enc:')) m.poster_path = `/api/messages/${m.id}/poster`;
  return m;
}
// Background job: encrypt older plaintext messages in small batches, verifying each before replacing it.
export async function encryptBacklog(limit = 200) {
  if (!encOn()) return 0;
  const { rows } = await q(`SELECT id, body, media_path, poster_path FROM messages WHERE deleted_at IS NULL AND ((body <> '' AND body NOT LIKE 'v1:%') OR media_path LIKE '/uploads/%' OR poster_path LIKE '/uploads/%') ORDER BY id LIMIT $1`, [limit]);
  let n = 0;
  for (const r of rows) {
    try {
      const body = r.body && !r.body.startsWith('v1:') ? seal(r.body) : r.body;
      if (body !== r.body && open(body) !== r.body) continue;
      const media = sealFile(r.media_path); const poster = sealFile(r.poster_path);
      await q('UPDATE messages SET body = $2, media_path = $3, poster_path = $4 WHERE id = $1', [r.id, body, media, poster]); n++;
    } catch (e) { console.error('[msg-encrypt] skipped a message:', e.message); }
  }
  return n;
}
