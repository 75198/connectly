// Personal sticker packs: create from photos (client does crop/cutout + text), import PNG/WebP files, share by link, save others' packs, report public packs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import multer from 'multer';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { HttpError, removeImage } from './uploads.js';

const on = (_req, res, next) => (config.features.stickerPacks ? next() : res.status(404).json({ error: 'Not found' }));
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 30 },
  fileFilter: (_r, f, cb) => (/^image\/(png|webp|jpeg)$/.test(f.mimetype) ? cb(null, true) : cb(new HttpError(400, 'Stickers must be PNG, WebP or JPEG images'))) });
const MAX_PER_PACK = 120, MAX_PACKS = 50;
const PACK_COLS = `p.id, p.name, p.is_public, p.share_token, p.owner_id, (SELECT json_agg(json_build_object('id', s.id, 'url', s.image_path) ORDER BY s.id) FROM stickers s WHERE s.pack_id = p.id) AS stickers`;

async function saveSticker(buf) {
  const dir = path.join(config.uploadDir, 'stickers'); fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.webp';
  await sharp(buf, { animated: false }).rotate().resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85, alphaQuality: 90 }).toFile(path.join(dir, name));
  return `/uploads/stickers/${name}`;
}
// Can this user send this sticker? Owner, or saved the pack; pack not hidden by moderators.
export async function usableSticker(uid, stickerId) {
  const { rows: [s] } = await q(`SELECT s.id, s.image_path FROM stickers s JOIN sticker_packs p ON p.id = s.pack_id WHERE s.id = $1 AND p.hidden_at IS NULL
    AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM user_sticker_packs u WHERE u.pack_id = p.id AND u.user_id = $2))`, [stickerId, uid]);
  return s || null;
}

export function registerStickerPacks(api, { requireAuth, requireAdmin, id }) {
  api.get('/sticker-packs/mine', requireAuth, on, async (req, res) => {
    const { rows } = await q(`SELECT ${PACK_COLS}, (p.owner_id = $1) AS mine FROM sticker_packs p WHERE p.hidden_at IS NULL AND (p.owner_id = $1 OR EXISTS (SELECT 1 FROM user_sticker_packs u WHERE u.pack_id = p.id AND u.user_id = $1)) ORDER BY (p.owner_id = $1) DESC, p.id DESC`, [req.user.id]);
    res.json({ items: rows.map((r) => ({ ...r, share_token: r.mine ? r.share_token : undefined, stickers: r.stickers || [] })) });
  });
  api.post('/sticker-packs', requireAuth, on, async (req, res) => {
    const d = z.object({ name: z.string().trim().min(1).max(40), is_public: z.boolean().default(false) }).strict().parse(req.body);
    const { rows: [n] } = await q('SELECT count(*)::int AS n FROM sticker_packs WHERE owner_id = $1', [req.user.id]);
    if (n.n >= MAX_PACKS) return res.status(400).json({ error: 'You have a lot of packs already. Delete one to make a new one.' });
    const { rows: [p] } = await q('INSERT INTO sticker_packs (owner_id, name, is_public, share_token) VALUES ($1,$2,$3,$4) RETURNING id, name, is_public, share_token', [req.user.id, d.name, d.is_public, crypto.randomBytes(9).toString('base64url')]);
    res.status(201).json({ ...p, stickers: [], mine: true });
  });
  api.patch('/sticker-packs/:id', requireAuth, on, async (req, res) => {
    const d = z.object({ name: z.string().trim().min(1).max(40).optional(), is_public: z.boolean().optional() }).strict().parse(req.body);
    const { rows } = await q('UPDATE sticker_packs SET name = COALESCE($3, name), is_public = COALESCE($4, is_public) WHERE id = $1 AND owner_id = $2 RETURNING id', [id(req.params.id), req.user.id, d.name ?? null, d.is_public ?? null]);
    if (!rows[0]) return res.status(404).json({ error: 'Pack not found' }); res.json({ ok: true });
  });
  api.delete('/sticker-packs/:id', requireAuth, on, async (req, res) => {
    const { rows } = await q('SELECT s.image_path FROM stickers s JOIN sticker_packs p ON p.id = s.pack_id WHERE p.id = $1 AND p.owner_id = $2', [id(req.params.id), req.user.id]);
    const r = await q('DELETE FROM sticker_packs WHERE id = $1 AND owner_id = $2', [id(req.params.id), req.user.id]);
    if (!r.rowCount) { await q('DELETE FROM user_sticker_packs WHERE pack_id = $1 AND user_id = $2', [id(req.params.id), req.user.id]); return res.json({ ok: true, removed: true }); }
    rows.forEach((s) => removeImage(s.image_path)); res.json({ ok: true });
  });
  api.post('/sticker-packs/:id/stickers', requireAuth, on, up.array('files', 30), async (req, res) => {
    const { rows: [p] } = await q('SELECT id, (SELECT count(*)::int FROM stickers s WHERE s.pack_id = sticker_packs.id) AS n FROM sticker_packs WHERE id = $1 AND owner_id = $2', [id(req.params.id), req.user.id]);
    if (!p) return res.status(404).json({ error: 'Pack not found' });
    const files = (req.files || []).slice(0, Math.max(0, MAX_PER_PACK - p.n)); if (!files.length) return res.status(400).json({ error: req.files?.length ? 'This pack is full. Start a new pack.' : 'Choose at least one image' });
    const out = []; for (const f of files) { try { const url = await saveSticker(f.buffer); const { rows: [s] } = await q('INSERT INTO stickers (pack_id, image_path) VALUES ($1,$2) RETURNING id', [p.id, url]); out.push({ id: s.id, url }); } catch { /* skip unreadable image */ } }
    if (!out.length) return res.status(400).json({ error: 'We couldn’t read those images' });
    res.status(201).json({ items: out, skipped: (req.files?.length || 0) - out.length });
  });
  api.delete('/stickers/:id', requireAuth, on, async (req, res) => {
    const { rows: [s] } = await q('DELETE FROM stickers s USING sticker_packs p WHERE s.id = $1 AND p.id = s.pack_id AND p.owner_id = $2 RETURNING s.image_path', [id(req.params.id), req.user.id]);
    if (!s) return res.status(404).json({ error: 'Sticker not found' }); removeImage(s.image_path); res.json({ ok: true });
  });
  // Shared link: /stickers/add/<token>
  api.get('/sticker-packs/share/:token', requireAuth, on, async (req, res) => {
    const { rows: [p] } = await q(`SELECT ${PACK_COLS}, u.username AS owner_username, (p.owner_id = $2) AS mine, EXISTS (SELECT 1 FROM user_sticker_packs x WHERE x.pack_id = p.id AND x.user_id = $2) AS saved
      FROM sticker_packs p JOIN users u ON u.id = p.owner_id WHERE p.share_token = $1 AND p.hidden_at IS NULL`, [String(req.params.token).slice(0, 40), req.user.id]);
    if (!p) return res.status(404).json({ error: 'This sticker pack isn’t available' });
    res.json({ ...p, share_token: undefined, stickers: p.stickers || [] });
  });
  api.post('/sticker-packs/share/:token/save', requireAuth, on, async (req, res) => {
    const { rows: [p] } = await q('SELECT id FROM sticker_packs WHERE share_token = $1 AND hidden_at IS NULL', [String(req.params.token).slice(0, 40)]);
    if (!p) return res.status(404).json({ error: 'This sticker pack isn’t available' });
    await q('INSERT INTO user_sticker_packs (user_id, pack_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, p.id]); res.json({ ok: true });
  });
  api.post('/sticker-packs/:id/report', requireAuth, on, async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(2).max(300) }).strict().parse(req.body);
    const { rows: [p] } = await q('SELECT id, owner_id FROM sticker_packs WHERE id = $1', [id(req.params.id)]); if (!p) return res.status(404).json({ error: 'Pack not found' });
    if (p.owner_id === req.user.id) return res.status(400).json({ error: 'You can’t report your own pack' });
    await q('INSERT INTO sticker_pack_reports (pack_id, reporter_id, reason) VALUES ($1,$2,$3) ON CONFLICT (pack_id, reporter_id) DO UPDATE SET reason = $3, resolved_at = NULL', [p.id, req.user.id, reason]);
    // Several open reports hide the pack until a moderator looks.
    await q('UPDATE sticker_packs SET hidden_at = now() WHERE id = $1 AND hidden_at IS NULL AND (SELECT count(*) FROM sticker_pack_reports r WHERE r.pack_id = $1 AND r.resolved_at IS NULL) >= 3', [p.id]);
    res.json({ ok: true });
  });
  api.get('/admin/sticker-packs', requireAuth, requireAdmin, on, async (_req, res) => {
    const { rows } = await q(`SELECT ${PACK_COLS}, p.hidden_at, u.username AS owner_username, (SELECT json_agg(r.reason) FROM sticker_pack_reports r WHERE r.pack_id = p.id AND r.resolved_at IS NULL) AS reasons
      FROM sticker_packs p JOIN users u ON u.id = p.owner_id WHERE EXISTS (SELECT 1 FROM sticker_pack_reports r WHERE r.pack_id = p.id AND r.resolved_at IS NULL) ORDER BY p.id DESC LIMIT 100`);
    res.json({ items: rows });
  });
  api.post('/admin/sticker-packs/:id', requireAuth, requireAdmin, on, async (req, res) => {
    const { action } = z.object({ action: z.enum(['hide', 'restore']) }).strict().parse(req.body);
    await q(`UPDATE sticker_packs SET hidden_at = ${action === 'hide' ? 'COALESCE(hidden_at, now())' : 'NULL'} WHERE id = $1`, [id(req.params.id)]);
    await q('UPDATE sticker_pack_reports SET resolved_at = now() WHERE pack_id = $1 AND resolved_at IS NULL', [id(req.params.id)]); res.json({ ok: true });
  });
}
