import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { q, pool } from './db.js';
import { config } from './config.js';
import { issueCode, consumeCode, CODE_ERRORS } from './codes.js';
import { smtpConfigured } from './mailer.js';
import { smsConfigured } from './sms.js';
import { parseIdentifier, identCol, FullName, BirthDate, generateUsername } from './identity.js';
import { loadUser, requireVerified, requireAuth, requireAdmin, csrfGuard, createSession, destroySession } from './auth.js';
import { upload, saveImage, removeImage, HttpError } from './uploads.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BCRYPT_COST = config.isTest ? 4 : 12;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_COST);

// ---------- validation schemas ----------
const username = z.string().trim().regex(/^[A-Za-z0-9_]{3,20}$/, 'Username: 3-20 letters, numbers or _');
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);
const LoginSchema = z.object({ login: z.string().trim().min(1).max(200), password: z.string().min(1).max(200), country: z.string().length(2).optional() }).strict();
const ProfileSchema = z.object({
  full_name: FullName.optional(),
  username: username.optional(),
  bio: z.string().trim().max(300).optional(),
  location: z.string().trim().max(80).optional(),
}).strict(); // .strict(): unknown keys such as "role"/"is_admin" are rejected
const Visibility = z.enum(['public', 'friends', 'private']);
const PostCreateSchema = z.object({ body: z.string().trim().max(5000).default(''), visibility: Visibility.default('public') }).strict();
const PostEditSchema = z.object({ body: z.string().trim().max(5000).optional(), visibility: Visibility.optional(), remove_image: z.boolean().optional() }).strict();
const CommentSchema = z.object({ body: z.string().trim().min(1).max(2000), parent_id: z.number().int().positive().nullish() }).strict();
const id = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Not found'); return n; };

// ---------- SQL helpers ----------
// $1 is always the viewer id. Visibility is enforced in SQL for every post read.
const VISIBLE = `(p.author_id = $1 OR p.visibility = 'public' OR (p.visibility = 'friends' AND EXISTS (
  SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND
   ((f.requester_id = $1 AND f.addressee_id = p.author_id) OR (f.addressee_id = $1 AND f.requester_id = p.author_id)))))`;
const POST_SELECT = `SELECT p.id, p.body, p.image_path, p.visibility, p.created_at, p.updated_at,
  json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path) AS author,
  (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT count(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
  EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked_by_me
  FROM posts p JOIN users u ON u.id = p.author_id`;
const publicUser = (u) => u && ({ id: u.id, username: u.username, full_name: u.full_name, bio: u.bio, location: u.location, avatar_path: u.avatar_path, cover_path: u.cover_path, created_at: u.created_at });

async function getVisiblePost(viewerId, postId) {
  const { rows } = await q(`${POST_SELECT} WHERE p.id = $2 AND ${VISIBLE}`, [viewerId, postId]);
  return rows[0] || null;
}
async function pagePosts(viewerId, extraWhere, extraParams, cursor, limit) {
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const params = [viewerId, ...extraParams];
  let where = `${VISIBLE}${extraWhere ? ' AND ' + extraWhere : ''}`;
  if (cursor) { params.push(id(cursor)); where += ` AND p.id < $${params.length}`; }
  params.push(lim + 1);
  const { rows } = await q(`${POST_SELECT} WHERE ${where} ORDER BY p.id DESC LIMIT $${params.length}`, params);
  const more = rows.length > lim;
  const items = rows.slice(0, lim);
  return { items, next_cursor: more ? String(items[items.length - 1].id) : null };
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.cookieSecure ? [] : null } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 10000 : 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts, try again in 15 minutes' } });
  const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 10000 : 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Slow down a little' } });

  const api = express.Router();
  api.use(csrfGuard, loadUser);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use((req, res, next) => (req.method === 'GET' ? next() : writeLimiter(req, res, next)));

  api.get('/health', async (_req, res) => { await q('SELECT 1'); res.json({ ok: true }); });

  // ---------- auth ----------
  // Signup: the client collects identifier+password, name, DOB and terms over several screens,
  // then calls /auth/register once. Only then is a *pending* account created and a code sent.
  const Ident = z.object({ identifier: z.string().max(200), country: z.string().length(2).toUpperCase().default('NG') });
  const requireChannel = (id) => {
    if (id.type === 'phone' && !smsConfigured()) throw new HttpError(400, 'Phone sign-up is coming soon. Please use your email address for now.');
  };
  api.get('/auth/capabilities', (_req, res) => res.json({ phone_signup: smsConfigured(), email_signup: true, min_age: 13 }));
  api.post('/auth/check-identifier', authLimiter, async (req, res) => {
    const d = Ident.strict().parse(req.body);
    const id = parseIdentifier(d.identifier, d.country);
    requireChannel(id);
    const { rows } = await q(`SELECT 1 FROM users WHERE ${identCol(id)} = $1 AND email_verified_at IS NOT NULL`, [id.value]);
    if (rows.length) return res.status(409).json({ error: id.type === 'email' ? 'An account with this email already exists. Try logging in.' : 'An account with this phone number already exists. Try logging in.', type: id.type });
    res.json({ ok: true, type: id.type, normalized: id.value });
  });
  api.post('/auth/register', authLimiter, async (req, res) => {
    const d = Ident.extend({ password, full_name: FullName, birth_date: BirthDate, accept_terms: z.literal(true, { errorMap: () => ({ message: 'You must agree to the Terms to continue' }) }) }).strict().parse(req.body);
    const id = parseIdentifier(d.identifier, d.country);
    requireChannel(id);
    const hash = await bcrypt.hash(d.password, BCRYPT_COST);
    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      const { rows: ex } = await client.query(`SELECT id, email_verified_at FROM users WHERE ${identCol(id)} = $1 FOR UPDATE`, [id.value]);
      if (ex[0]?.email_verified_at) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'An account with this email or phone already exists. Try logging in.' }); }
      if (ex[0]) await client.query('DELETE FROM users WHERE id = $1', [ex[0].id]); // replace an abandoned pending signup
      const uname = await generateUsername(d.full_name, client);
      const { rows } = await client.query(
        `INSERT INTO users (username, full_name, email, phone, password_hash, birth_date, terms_accepted_at) VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING id, email, phone`,
        [uname, d.full_name, id.type === 'email' ? id.value : null, id.type === 'phone' ? id.value : null, hash, d.birth_date]);
      await client.query('COMMIT');
      user = rows[0];
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return res.status(409).json({ error: 'That account already exists' }); throw e; } finally { client.release(); }
    try { await issueCode(user, 'verify_email'); }
    catch (e) { await q('DELETE FROM users WHERE id = $1', [user.id]); console.error('[signup] code delivery failed', e.message); return res.status(502).json({ error: 'We couldn’t send your code right now. Please try again in a minute.' }); }
    res.status(201).json({ ok: true, pending: true, type: id.type, sent_to: id.value });
  });
  const Code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
  const pendingUser = async (d) => {
    const id = parseIdentifier(d.identifier, d.country);
    const { rows } = await q(`SELECT id, email, phone, email_verified_at FROM users WHERE ${identCol(id)} = $1`, [id.value]);
    return rows[0];
  };
  api.post('/auth/verify', authLimiter, async (req, res) => {
    const d = Ident.extend({ code: Code }).strict().parse(req.body);
    const u = await pendingUser(d);
    if (!u || u.email_verified_at) return res.status(400).json({ error: 'Code expired or not found — request a new one', reason: 'expired' });
    const r = await consumeCode(u.id, 'verify_email', d.code);
    if (r !== 'ok') return res.status(400).json({ error: CODE_ERRORS[r], reason: r });
    await q('UPDATE users SET email_verified_at = now() WHERE id = $1', [u.id]);
    await createSession(res, u.id, req.get('user-agent')); // auto-login after verification
    res.json({ ok: true });
  });
  api.post('/auth/resend', authLimiter, async (req, res) => {
    const d = Ident.strict().parse(req.body);
    const u = await pendingUser(d);
    if (!u || u.email_verified_at) return res.json({ ok: true }); // no enumeration
    if (!u.email) requireChannel({ type: 'phone' });
    const r = await issueCode(u, 'verify_email');
    if (!r.ok) return res.status(429).json({ error: `Please wait ${r.retryAfter}s before requesting another code`, retry_after: r.retryAfter });
    res.json({ ok: true });
  });
  api.post('/auth/login', authLimiter, async (req, res) => {
    const d = LoginSchema.parse(req.body);
    let where = 'lower(username) = lower($1)'; let val = d.login;
    try { const id = parseIdentifier(d.login, d.country || 'NG'); where = `${identCol(id)} = $1`; val = id.value; } catch { /* treat as username */ }
    const { rows } = await q(`SELECT id, password_hash, email_verified_at FROM users WHERE ${where} LIMIT 1`, [val]);
    const ok = rows[0] ? await bcrypt.compare(d.password, rows[0].password_hash) : (await bcrypt.compare(d.password, DUMMY_HASH), false);
    if (!ok) return res.status(401).json({ error: 'Wrong email/phone or password' });
    if (!rows[0].email_verified_at) return res.status(403).json({ error: 'This account isn’t verified yet. Enter the code we sent you, or request a new one.', code: 'PENDING_VERIFICATION' });
    await createSession(res, rows[0].id, req.get('user-agent'));
    res.json({ ok: true });
  });
  api.post('/auth/logout', async (req, res) => { await destroySession(req, res); res.json({ ok: true }); });
  api.post('/auth/forgot', authLimiter, async (req, res) => {
    const d = Ident.strict().parse(req.body);
    const id = parseIdentifier(d.identifier, d.country);
    requireChannel(id);
    const { rows } = await q(`SELECT id, email, phone FROM users WHERE ${identCol(id)} = $1 AND email_verified_at IS NOT NULL`, [id.value]);
    if (rows[0]) {
      const r = await issueCode(rows[0], 'reset_password');
      if (!r.ok) return res.status(429).json({ error: `Please wait ${r.retryAfter}s before requesting another code`, retry_after: r.retryAfter });
    }
    res.json({ ok: true, message: 'If an account exists, we’ve sent a 6-digit code.' });
  });
  api.post('/auth/reset', authLimiter, async (req, res) => {
    const d = Ident.extend({ code: Code, password }).strict().parse(req.body);
    const u = await pendingUser(d);
    const r = u?.email_verified_at ? await consumeCode(u.id, 'reset_password', d.code) : 'expired';
    if (r !== 'ok') return res.status(400).json({ error: CODE_ERRORS[r], reason: r });
    await q('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(d.password, BCRYPT_COST), u.id]);
    await q('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    res.json({ ok: true });
  });

  api.get('/me', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json({ ...publicUser(rows[0]), email: rows[0].email, phone: rows[0].phone, birth_date: rows[0].birth_date, email_verified: Boolean(rows[0].email_verified_at), onboarded: Boolean(rows[0].onboarded_at), roles: req.user.roles });
  });

  // ---------- profiles ----------
  const editProfile = async (req, res) => {
    const d = ProfileSchema.parse(req.body);
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(d)) { vals.push(v); sets.push(`${k} = $${vals.length}`); } // keys whitelisted by zod
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.user.id);
    try {
      const { rows } = await q(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
      res.json(publicUser(rows[0]));
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That username is taken' }); throw e; }
  };
  api.patch('/me', requireAuth, editProfile);
  api.patch('/users/:username', requireAuth, async (req, res, next) => {
    if (req.params.username.toLowerCase() !== req.user.username.toLowerCase()) return res.status(403).json({ error: 'You can only edit your own profile' });
    return editProfile(req, res, next);
  });
  for (const kind of ['avatar', 'cover']) {
    api.post(`/me/${kind}`, requireAuth, upload.single('image'), async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
      const p = await saveImage(req.file.buffer, kind);
      const { rows } = await q(`UPDATE users u SET ${kind}_path = $1, updated_at = now() FROM users old WHERE u.id = $2 AND old.id = u.id RETURNING old.${kind}_path AS prev`, [p, req.user.id]);
      removeImage(rows[0]?.prev);
      res.json({ [`${kind}_path`]: p });
    });
  }
  api.get('/users/:username', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT * FROM users WHERE lower(username) = lower($1)', [req.params.username]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const { rows: c } = await q(`SELECT count(*) AS n FROM posts p WHERE p.author_id = $2 AND ${VISIBLE}`, [req.user.id, rows[0].id]);
    res.json({ ...publicUser(rows[0]), post_count: c[0].n, is_me: rows[0].id === req.user.id });
  });
  api.get('/users/:username/posts', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT id FROM users WHERE lower(username) = lower($1)', [req.params.username]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(await pagePosts(req.user.id, 'p.author_id = $2', [rows[0].id], req.query.cursor, req.query.limit));
  });

  // ---------- posts ----------
  api.get('/feed', requireAuth, async (req, res) => res.json(await pagePosts(req.user.id, null, [], req.query.cursor, req.query.limit)));
  api.post('/posts', requireVerified, upload.single('image'), async (req, res) => {
    const d = PostCreateSchema.parse({ body: req.body?.body ?? '', visibility: req.body?.visibility || undefined });
    if (!d.body && !req.file) return res.status(400).json({ error: 'Write something or add a photo' });
    const img = req.file ? await saveImage(req.file.buffer, 'post') : null;
    const { rows } = await q('INSERT INTO posts (author_id, body, image_path, visibility) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.id, d.body, img, d.visibility]);
    res.status(201).json(await getVisiblePost(req.user.id, rows[0].id));
  });
  api.get('/posts/:id', requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found' });
    res.json(p);
  });
  const ownPost = async (req, res) => {
    const { rows } = await q(`SELECT p.id, p.author_id, p.image_path, p.body FROM posts p WHERE p.id = $2 AND ${VISIBLE}`, [req.user.id, id(req.params.id)]);
    if (!rows[0]) { res.status(404).json({ error: 'Post not found' }); return null; }
    if (rows[0].author_id !== req.user.id) { res.status(403).json({ error: 'You can only change your own posts' }); return null; }
    return rows[0];
  };
  api.patch('/posts/:id', requireVerified, async (req, res) => {
    const d = PostEditSchema.parse(req.body);
    const post = await ownPost(req, res); if (!post) return;
    const body = d.body ?? post.body;
    const image = d.remove_image ? null : post.image_path;
    if (!body && !image) return res.status(400).json({ error: 'A post needs text or a photo' });
    await q('UPDATE posts SET body = $1, image_path = $2, visibility = COALESCE($3, visibility), updated_at = now() WHERE id = $4 AND author_id = $5', [body, image, d.visibility ?? null, post.id, req.user.id]);
    if (d.remove_image) removeImage(post.image_path);
    res.json(await getVisiblePost(req.user.id, post.id));
  });
  api.delete('/posts/:id', requireAuth, async (req, res) => {
    const post = await ownPost(req, res); if (!post) return;
    await q('DELETE FROM posts WHERE id = $1 AND author_id = $2', [post.id, req.user.id]);
    removeImage(post.image_path);
    res.json({ ok: true });
  });
  const likeCount = async (postId) => (await q('SELECT count(*) AS n FROM post_likes WHERE post_id = $1', [postId])).rows[0].n;
  api.put('/posts/:id/like', requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found' });
    await q('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, req.user.id]);
    res.json({ liked_by_me: true, like_count: await likeCount(p.id) });
  });
  api.delete('/posts/:id/like', requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found' });
    await q('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [p.id, req.user.id]);
    res.json({ liked_by_me: false, like_count: await likeCount(p.id) });
  });

  // ---------- comments ----------
  api.get('/posts/:id/comments', requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found' });
    const { rows } = await q(`SELECT c.id, c.post_id, c.parent_id, c.body, c.created_at,
      json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path) AS author
      FROM comments c JOIN users u ON u.id = c.author_id WHERE c.post_id = $1 ORDER BY c.id ASC LIMIT 500`, [p.id]);
    res.json({ items: rows });
  });
  api.post('/posts/:id/comments', requireVerified, async (req, res) => {
    const d = CommentSchema.parse(req.body);
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found' });
    let parent = null;
    if (d.parent_id) {
      const { rows } = await q('SELECT id, parent_id FROM comments WHERE id = $1 AND post_id = $2', [d.parent_id, p.id]);
      if (!rows[0]) return res.status(400).json({ error: 'Parent comment not found on this post' });
      parent = rows[0].parent_id || rows[0].id; // replies are one level deep
    }
    const { rows } = await q('INSERT INTO comments (post_id, author_id, parent_id, body) VALUES ($1,$2,$3,$4) RETURNING id, post_id, parent_id, body, created_at', [p.id, req.user.id, parent, d.body]);
    res.status(201).json({ ...rows[0], author: { id: req.user.id, username: req.user.username, full_name: req.user.full_name } });
  });
  api.delete('/comments/:id', requireAuth, async (req, res) => {
    const { rows } = await q(`SELECT c.id, c.author_id, p.author_id AS post_author FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = $2 AND ${VISIBLE}`, [req.user.id, id(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Comment not found' });
    if (rows[0].author_id !== req.user.id && rows[0].post_author !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
    await q('DELETE FROM comments WHERE id = $1', [rows[0].id]);
    res.json({ ok: true });
  });

  // ---------- onboarding ----------
  api.post('/me/onboarding-complete', requireAuth, async (req, res) => { await q('UPDATE users SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1', [req.user.id]); res.json({ ok: true }); });
  // Converts coordinates to "City, Country" server-side; the coordinates themselves are never stored.
  api.post('/me/location', requireAuth, async (req, res) => {
    const d = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict().parse(req.body);
    let place = '';
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${d.lat}&lon=${d.lon}`, { headers: { 'User-Agent': 'Connectly/0.1 (social app)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(6000) });
      const j = await r.json(); const a = j.address || {};
      place = [a.city || a.town || a.village || a.county || a.state, a.country].filter(Boolean).join(', ').slice(0, 80);
    } catch { /* fall through */ }
    if (!place) return res.status(502).json({ error: 'Couldn’t work out your city right now. You can add it later in your profile.' });
    await q('UPDATE users SET location = $1, updated_at = now() WHERE id = $2', [place, req.user.id]);
    res.json({ location: place });
  });
  // Contact matching: client sends SHA-256 hashes of normalised emails/E.164 phones. Nothing is stored.
  api.post('/contacts/match', requireAuth, async (req, res) => {
    const { hashes } = z.object({ hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(2000) }).strict().parse(req.body);
    if (!hashes.length) return res.json({ items: [] });
    const { rows } = await q(`SELECT id, username, full_name, avatar_path FROM users
      WHERE id <> $1 AND email_verified_at IS NOT NULL AND (
        (email IS NOT NULL AND encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = ANY($2)) OR
        (phone IS NOT NULL AND encode(sha256(convert_to(phone, 'UTF8')), 'hex') = ANY($2))) LIMIT 100`, [req.user.id, hashes]);
    res.json({ items: rows });
  });

  // ---------- search ----------
  api.get('/search', requireAuth, async (req, res) => {
    const { q: term, type, cursor } = z.object({ q: z.string().trim().min(1).max(100), type: z.enum(['people', 'posts']).default('people'), cursor: z.string().optional(), limit: z.string().optional() }).parse(req.query);
    const like = '%' + term.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    if (type === 'people') {
      const { rows } = await q(`SELECT id, username, full_name, avatar_path, bio FROM users
        WHERE email_verified_at IS NOT NULL AND (lower(username) || ' ' || lower(full_name)) LIKE $1
        ORDER BY (lower(username) = lower($2)) DESC, (lower(username) LIKE lower($2) || '%') DESC, full_name LIMIT 20`, [like, term]);
      return res.json({ items: rows, next_cursor: null });
    }
    res.json(await pagePosts(req.user.id, 'lower(p.body) LIKE $2', [like], cursor, req.query.limit));
  });

  // ---------- admin ----------
  api.get('/admin/users', requireAdmin, async (_req, res) => {
    const { rows } = await q(`SELECT u.id, u.username, u.full_name, u.email, u.phone, u.created_at, u.email_verified_at IS NOT NULL AS email_verified,
      COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id GROUP BY u.id ORDER BY u.id LIMIT 500`);
    res.json({ items: rows });
  });
  api.get('/admin/status', requireAdmin, async (_req, res) => {
    res.json({ smtp_configured: smtpConfigured, sms_configured: smsConfigured(), note: smtpConfigured ? 'Emails are sent via SMTP.' : 'SMTP is not configured: confirmation and reset codes are only written to the server log (/tmp/app.log).' });
  });
  api.post('/admin/users/:id/roles', requireAdmin, async (req, res) => {
    const { role } = z.object({ role: z.enum(['admin', 'moderator']) }).strict().parse(req.body);
    const r = await q('INSERT INTO user_roles (user_id, role_id, granted_by) SELECT $1, id, $3 FROM roles WHERE name = $2 ON CONFLICT DO NOTHING', [id(req.params.id), role, req.user.id]);
    res.json({ ok: true, changed: r.rowCount });
  });
  api.delete('/admin/users/:id/roles/:role', requireAdmin, async (req, res) => {
    const uid = id(req.params.id);
    if (uid === req.user.id && req.params.role === 'admin') return res.status(400).json({ error: 'You cannot remove your own admin role' });
    await q('DELETE FROM user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM roles WHERE name = $2)', [uid, req.params.role]);
    res.json({ ok: true });
  });

  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', immutable: true, fallthrough: false, dotfiles: 'deny' }));
  const dist = path.join(root, 'web', 'dist');
  if (fs.existsSync(dist)) {
    // Serve pre-compressed brotli/gzip copies of hashed assets (built by scripts/precompress.js).
    app.use('/assets', (req, res, next) => {
      const ae = req.get('accept-encoding') || '';
      const file = path.join(dist, 'assets', path.basename(req.path));
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : null;
      for (const [enc, ext] of [['br', '.br'], ['gzip', '.gz']]) {
        if (type && ae.includes(enc) && fs.existsSync(file + ext)) {
          res.set({ 'Content-Encoding': enc, 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable', Vary: 'Accept-Encoding' });
          return res.sendFile(file + ext);
        }
      }
      next();
    });
    app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '365d', immutable: true }));
    app.use(express.static(dist, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image must be 5 MB or smaller' });
    if (err?.name === 'MulterError') return res.status(400).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
export { pool };
