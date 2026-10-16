// Paid verification ("Get verified"): requirements check, ID + selfie upload (kept private, deleted after review),
// admin review, and badge sync with the subscription. Payment is "Coming soon" until store in-app purchase is set up.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import multer from 'multer';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { regionOf, priceFor } from './pricing.js';
import { notify } from './social.js';

const PRIVATE_DIR = path.resolve(config.uploadDir, '..', 'verify-private'); // outside the public /uploads folder
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_r, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)) });
const on = (_req, res, next) => (config.features.paidVerification ? next() : res.status(404).json({ error: 'Not found' }));
export const PAID_BASE = { usd_cents: 999 };

async function requirements(uid) {
  const { rows: [u] } = await q(`SELECT avatar_path, bio, full_name, created_at, totp_enabled_at, suspended_at, verified_at, verified_kind, paid_approved_at, paid_verified_until,
    (SELECT count(*)::int FROM reports r WHERE r.target_user_id = users.id AND r.status = 'closed' AND r.resolution IS DISTINCT FROM 'dismissed' AND r.resolved_at > now() - interval '90 days') AS violations
    FROM users WHERE id = $1`, [uid]);
  const checks = [
    { key: 'profile', label: 'Complete profile with a photo and bio', ok: !!u.avatar_path && !!(u.bio || '').trim() },
    { key: 'age', label: 'Account is at least 30 days old', ok: Date.now() - new Date(u.created_at).getTime() >= 30 * 864e5 },
    { key: 'twofa', label: 'Two-step login is on', ok: !!u.totp_enabled_at },
    { key: 'clean', label: 'No recent rule violations', ok: !u.suspended_at && u.violations === 0 },
  ];
  return { u, checks };
}

export async function syncPaidBadges() {
  if (!config.features.paidVerification) return;
  await q(`UPDATE users SET verified_at = now(), verified_kind = 'paid' WHERE paid_approved_at IS NOT NULL AND paid_verified_until > now() AND verified_at IS NULL`);
  // Badge is removed when the subscription lapses (only paid badges; notable badges are untouched).
  await q(`UPDATE users SET verified_at = NULL, verified_kind = NULL WHERE verified_kind = 'paid' AND (paid_verified_until IS NULL OR paid_verified_until < now())`);
}

export function registerPaidVerification(api, { requireAuth, requireAdmin, id }) {
  api.get('/me/paid-verification', requireAuth, on, async (req, res) => {
    const { u, checks } = await requirements(req.user.id);
    const { rows: [r] } = await q("SELECT id, status, created_at, decided_at FROM verification_requests WHERE user_id = $1 AND kind = 'paid' ORDER BY id DESC LIMIT 1", [req.user.id]);
    const price = await priceFor('paid_verification', PAID_BASE, await regionOf(req)).catch(() => ({ amount: 9.99, currency: 'USD', exact: true }));
    res.json({ checks, request: r || null, price, active: u.verified_kind === 'paid' && !!u.verified_at, notable: !!u.verified_at && u.verified_kind !== 'paid',
      approved: !!u.paid_approved_at, until: u.paid_verified_until, payments_ready: false });
  });
  api.post('/me/paid-verification', requireAuth, on, up.fields([{ name: 'id_doc', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]), async (req, res) => {
    const { checks } = await requirements(req.user.id);
    if (checks.some((c) => !c.ok)) return res.status(400).json({ error: 'Please meet all the requirements first.' });
    const doc = req.files?.id_doc?.[0]; const selfie = req.files?.selfie?.[0];
    if (!doc || !selfie) return res.status(400).json({ error: 'Add a photo of your ID and a selfie.' });
    if ((await q("SELECT 1 FROM verification_requests WHERE user_id = $1 AND kind = 'paid' AND status = 'pending'", [req.user.id])).rowCount) return res.status(409).json({ error: 'Your request is already being reviewed' });
    fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
    const save = async (f) => { const name = crypto.randomBytes(16).toString('hex') + '.jpg'; await sharp(f.buffer).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(PRIVATE_DIR, name)); return name; };
    const [a, b] = [await save(doc), await save(selfie)];
    await q("INSERT INTO verification_requests (user_id, category, reason, kind, id_doc_file, selfie_file) VALUES ($1, 'Paid', 'Paid verification', 'paid', $2, $3)", [req.user.id, a, b]);
    res.status(201).json({ ok: true });
  });
  // Admin queue
  api.get('/admin/paid-verification', requireAuth, requireAdmin, on, async (_req, res) => {
    const { rows } = await q(`SELECT r.id, r.created_at, json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path, 'created_at', u.created_at) AS user
      FROM verification_requests r JOIN users u ON u.id = r.user_id WHERE r.kind = 'paid' AND r.status = 'pending' ORDER BY r.id LIMIT 100`);
    res.json({ items: rows });
  });
  api.get('/admin/paid-verification/:id/:which', requireAuth, requireAdmin, on, async (req, res) => {
    const col = req.params.which === 'selfie' ? 'selfie_file' : 'id_doc_file';
    const { rows: [r] } = await q(`SELECT ${col} AS f FROM verification_requests WHERE id = $1 AND kind = 'paid' AND status = 'pending'`, [id(req.params.id)]);
    if (!r?.f) return res.status(404).end();
    res.set('Cache-Control', 'no-store'); res.sendFile(path.join(PRIVATE_DIR, path.basename(r.f)));
  });
  api.post('/admin/paid-verification/:id', requireAuth, requireAdmin, on, async (req, res) => {
    const { decision } = z.object({ decision: z.enum(['approve', 'reject']) }).strict().parse(req.body);
    const { rows: [r] } = await q("UPDATE verification_requests SET status = $2, decided_at = now(), decided_by = $3 WHERE id = $1 AND kind = 'paid' AND status = 'pending' RETURNING user_id, id_doc_file, selfie_file", [id(req.params.id), decision === 'approve' ? 'approved' : 'rejected', req.user.id]);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    for (const f of [r.id_doc_file, r.selfie_file]) if (f) fs.rm(path.join(PRIVATE_DIR, path.basename(f)), { force: true }, () => {}); // ID images are deleted after review
    await q('UPDATE verification_requests SET id_doc_file = NULL, selfie_file = NULL WHERE id = $1', [id(req.params.id)]);
    if (decision === 'approve') await q('UPDATE users SET paid_approved_at = now() WHERE id = $1', [r.user_id]);
    notify(r.user_id, req.user.id, decision === 'approve' ? 'verified_approved' : 'verified_rejected');
    await syncPaidBadges(); res.json({ ok: true });
  });
}
