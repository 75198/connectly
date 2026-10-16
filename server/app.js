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
import { issueCode, consumeCode, CODE_ERRORS, keyOf, createTicket, readTicket, useTicket } from './codes.js';
import { smtpConfigured, sendMail } from './mailer.js';
import { smsConfigured } from './sms.js';
import { parseIdentifier, identCol, FullName, BirthDate, generateUsername } from './identity.js';
import { loadUser, requireVerified, requireAuth, requireAdmin, requireModerator, csrfGuard, createSession, destroySession } from './auth.js';
import { upload, saveImage, removeImage, HttpError } from './uploads.js';
import { notify, registerSocial } from './social.js';
import { registerReels } from './reels.js';
import { registerPostExtras } from './postextras.js';
import { registerAi } from './ai.js';
import { registerLive } from './live.js';
import { registerEngagement } from './engagement.js';
import { registerSubscriptions } from './subscriptions.js';
import { newChallenge, verifyPow } from './pow.js';
import { registerMessages } from './messages.js';
import { registerRound7, saveTags, twoStepMethods, startTwoStep, loginAlert } from './round7.js';
import { registerRound8, recordActivity } from './round8.js';
import { registerNews, recordSearch } from './news.js';
import { registerPricing } from './pricing.js';
import { registerDownloads } from './download.js';
import { registerBackfill } from './backfill.js';
import { registerRound9, notifyMentions, allowedBy, isRestricted } from './round9.js';
import { hiddenWordsOf, matchesHidden } from './messages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BCRYPT_COST = config.isTest ? 4 : 12;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_COST);

// ---------- validation schemas ----------
const username = z.string().trim().regex(/^[A-Za-z0-9_]{3,20}$/, 'Username: 3-20 letters, numbers or _');
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);
const LoginSchema = z.object({ login: z.string().trim().min(1).max(200), password: z.string().min(1).max(200), country: z.string().length(2).optional() }).strict();
export const RELATIONSHIP = ['', 'Single', 'In a relationship', 'Engaged', 'Married', 'In a civil union', 'Separated', 'Divorced', 'Widowed', "It's complicated", 'Prefer not to say'];
const txt = (n) => z.string().trim().max(n);
const ProfileSchema = z.object({
  full_name: FullName.optional(),
  username: username.optional(),
  bio: txt(300).optional(),
  interests: z.array(z.string().trim().min(1).max(30)).max(15).transform((a) => [...new Set(a)]).optional(),
  relationship_status: z.enum(RELATIONSHIP).optional(),
  work_company: txt(80).optional(), work_role: txt(80).optional(), education: txt(120).optional(),
  current_place_id: z.number().int().positive().nullable().optional(),
  hometown_place_id: z.number().int().positive().nullable().optional(),
  category: txt(40).optional(),
  website: z.union([z.literal(''), z.string().trim().max(200).regex(/^https?:\/\/[^\s<>"]+\.[^\s<>"]+$/i, 'Website must start with http:// or https://')]).optional(),
  socials: z.object({ instagram: z.string().trim().max(40).regex(/^[\w.]*$/).optional(), x: z.string().trim().max(40).regex(/^\w*$/).optional(), tiktok: z.string().trim().max(40).regex(/^[\w.]*$/).optional(), youtube: z.string().trim().max(60).regex(/^@?[\w.-]*$/).optional(), linkedin: z.string().trim().max(80).regex(/^[\w-]*$/).optional() }).strict().optional(),
  public_contact: txt(120).optional(), show_contact: z.boolean().optional(),
}).strict(); // .strict(): unknown keys such as "role"/"is_admin" are rejected
const Visibility = z.enum(['public', 'friends', 'private']);
export const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
const PostCreateSchema = z.object({ body: z.string().trim().max(5000).default(''), visibility: Visibility.default('public'), feeling: z.string().trim().max(40).default(''), location_tag: z.string().trim().max(120).default(''), as_draft: z.enum(['0', '1']).default('0'), enhance: z.enum(['0', '1']).optional() }).strict();
const PostEditSchema = z.object({ body: z.string().trim().max(5000).optional(), visibility: Visibility.optional(), remove_image: z.boolean().optional(), feeling: z.string().trim().max(40).optional(), location_tag: z.string().trim().max(120).optional() }).strict();
const CommentSchema = z.object({ body: z.string().trim().min(1).max(2000), parent_id: z.number().int().positive().nullish() }).strict();
const welcomeText = (name) => `Hi ${name.split(' ')[0]},

Welcome to Connectly! Your account is ready.

Add a profile photo, find people you know, and share your first post.

${config.appUrl}

— The Connectly team

You can turn off email notifications any time in Settings > Notifications.`;
const id = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Not found'); return n; };

// ---------- SQL helpers ----------
// $1 is always the viewer id. Visibility is enforced in SQL for every post read.
const VISIBLE = `(p.author_id = $1 OR p.visibility = 'public' OR (p.visibility = 'friends' AND EXISTS (
  SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND
   ((f.requester_id = $1 AND f.addressee_id = p.author_id) OR (f.addressee_id = $1 AND f.requester_id = p.author_id)))
  OR EXISTS (SELECT 1 FROM follows f1 JOIN follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id WHERE f1.follower_id = $1 AND f1.followee_id = p.author_id)))
  AND p.hidden_at IS NULL AND p.deleted_at IS NULL AND NOT p.is_draft AND (p.scheduled_for IS NULL OR p.scheduled_for <= now() OR p.author_id = $1) AND NOT EXISTS (SELECT 1 FROM users su WHERE su.id = p.author_id AND su.suspended_at IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = $1))
  AND (p.author_id = $1 OR NOT EXISTS (SELECT 1 FROM users pu WHERE pu.id = p.author_id AND pu.is_private) OR EXISTS (SELECT 1 FROM follows pf WHERE pf.follower_id = $1 AND pf.followee_id = p.author_id))
  AND (NOT p.close_friends_only OR p.author_id = $1 OR EXISTS (SELECT 1 FROM close_friends cfp WHERE cfp.user_id = p.author_id AND cfp.friend_id = $1))`;
// author of a post/comment: the page when posted "as a page", otherwise the user
const authorJson = (alias, userAlias) => `CASE WHEN ${alias}.as_space_id IS NOT NULL THEN (SELECT json_build_object('id', s.id, 'username', s.slug, 'full_name', s.name, 'avatar_path', s.photo_path, 'space', true, 'kind', s.kind) FROM spaces s WHERE s.id = ${alias}.as_space_id)
  ELSE json_build_object('id', ${userAlias}.id, 'username', ${userAlias}.username, 'full_name', ${userAlias}.full_name, 'avatar_path', ${userAlias}.avatar_path, 'verified', ${userAlias}.verified_at IS NOT NULL) END`;
const POST_SELECT = `SELECT p.id, p.body, p.image_path, p.visibility, p.created_at, p.updated_at, p.kind, p.video_path, p.video_low_path, p.poster_path, p.video_seconds, p.feeling, p.location_tag, p.is_draft, p.deleted_at, p.pinned_at, p.scheduled_for, p.hide_like_count, p.allow_downloads, p.effect, p.remix_layout, p.music_start,
  (SELECT row_to_json(mt) FROM (SELECT t.id, t.title, t.artist, t.url, t.license FROM music_tracks t WHERE t.id = p.music_track_id) mt) AS music,
  (SELECT row_to_json(rx) FROM (SELECT o.id, o.video_path, o.poster_path, ou.username, ou.full_name FROM posts o JOIN users ou ON ou.id = o.author_id WHERE o.id = p.remix_of_id AND o.deleted_at IS NULL AND o.hidden_at IS NULL) rx) AS remix_of,
  (SELECT json_build_object('id', pl.id, 'question', pl.question, 'options', pl.options, 'closes_at', pl.closes_at, 'counts', (SELECT COALESCE(json_object_agg(v.option_idx, v.n), '{}') FROM (SELECT option_idx, count(*)::int n FROM poll_votes WHERE poll_id = pl.id GROUP BY option_idx) v), 'my_vote', (SELECT option_idx FROM poll_votes WHERE poll_id = pl.id AND user_id = $1)) FROM polls pl WHERE pl.post_id = p.id) AS poll,
  (SELECT l.reaction FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $1) AS my_reaction,
  (SELECT COALESCE(json_object_agg(x.reaction, x.n), '{}') FROM (SELECT reaction, count(*)::int AS n FROM post_likes l WHERE l.post_id = p.id GROUP BY reaction) x) AS reactions,
  EXISTS (SELECT 1 FROM saved_posts sp WHERE sp.post_id = p.id AND sp.user_id = $1) AS saved_by_me,
  (SELECT count(*)::int FROM reel_views rv WHERE rv.post_id = p.id) AS view_count,
  ${authorJson('p', 'u')} AS author, (p.author_id = $1) AS is_mine,
  (SELECT json_build_object('slug', s.slug, 'name', s.name, 'kind', s.kind) FROM spaces s WHERE s.id = p.space_id) AS space,
  CASE WHEN p.hide_like_count AND p.author_id <> $1 THEN NULL ELSE (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id) END AS like_count,
  (SELECT count(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
  (SELECT count(*)::int FROM shares sh WHERE sh.post_id = p.id) AS share_count,
  EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked_by_me
  FROM posts p JOIN users u ON u.id = p.author_id AND (u.deactivated_at IS NULL OR u.id = $1)`;
const publicUser = (u) => u && ({ id: u.id, username: u.username, full_name: u.full_name, bio: u.bio, location: u.location, hometown: u.hometown, interests: u.interests || [], relationship_status: u.relationship_status, work_company: u.work_company, work_role: u.work_role, education: u.education, category: u.category || '', website: u.website || '', socials: u.socials || {}, contact: u.show_contact ? u.public_contact || '' : '', avatar_path: u.avatar_path, cover_path: u.cover_path, verified: !!u.verified_at && config.features.verified });

async function getOwnPost(userId, postId) {
  const { rows } = await q(`${POST_SELECT} WHERE p.id = $2 AND p.author_id = $1`, [userId, postId]);
  return rows[0] || null;
}
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

async function actingPage(req) {
  const sid = req.user?.acting_space_id; if (!sid) return null;
  const { rows } = await q("SELECT 1 FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE s.id = $1 AND s.kind = 'page' AND m.user_id = $2 AND m.role IN ('owner','admin')", [sid, req.user.id]);
  return rows.length ? sid : null;
}
// LiveKit signalling/region endpoints for Go Live (only when configured).
function liveConnectSrc() {
  try { if (!(config.features.live || config.features.calls) || !config.livekitUrl) return []; const h = new URL(config.livekitUrl).host; const base = h.split('.').slice(-2).join('.'); return [`wss://${h}`, `https://${h}`, `wss://*.${base}`, `https://*.${base}`]; } catch { return []; }
}
export function round78Features() {
  const f = config.features; const out = {};
  for (const k of ['messages', 'calls', 'verified', 'hashtags', 'forYou', 'push', 'i18n', 'translate', 'creatorTools', 'events', 'polls', 'closeFriends', 'hideLikes', 'twoStep', 'music', 'arEffects', 'remix', 'challenges', 'gifts', 'games', 'watchTogether', 'memories', 'stickers', 'streaks', 'aiVision', 'news', 'backfill', 'aiVoice', 'addYours', 'collections', 'privateAccounts', 'whoCan', 'hidePresence', 'hideLists', 'restrictMute', 'hiddenWords', 'disappearing', 'dataExport', 'discoverability', 'teenSafety', 'localCurrency', 'downloads'])
    out[k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] = !!f[k];
  return out;
}
// Extra post fields from the composer (multipart strings): hashtags, schedule, poll, music, like-count visibility.
async function applyPostExtras(req, postId, body) {
  const b = req.body || {};
  const d = z.object({ scheduled_for: z.string().datetime({ offset: true }).optional(), poll: z.string().max(3000).optional(), music_track_id: z.coerce.number().int().positive().optional(), music_start: z.coerce.number().int().min(0).max(600).optional(), hide_like_count: z.enum(['0', '1']).optional(), effect: z.string().regex(/^[a-z0-9-]{1,30}$/).optional(), remix_of_id: z.coerce.number().int().positive().optional(), remix_layout: z.enum(['duet', 'stitch']).optional() })
    .parse({ remix_of_id: b.remix_of_id || undefined, remix_layout: b.remix_layout || undefined, scheduled_for: b.scheduled_for || undefined, poll: b.poll || undefined, music_track_id: b.music_track_id || undefined, music_start: b.music_start || undefined, hide_like_count: b.hide_like_count || undefined, effect: b.effect || undefined });
  if (config.features.hashtags) await saveTags(postId, body);
  if (config.features.closeFriends && (b.close_friends === '1' || b.close_friends === true)) await q('UPDATE posts SET close_friends_only = true WHERE id = $1', [postId]);
  if (body && !b.scheduled_for) await notifyMentions(body, req.user.id, 'tag', { post_id: postId });
  if (d.scheduled_for && config.features.creatorTools) {
    const t = new Date(d.scheduled_for);
    if (t <= new Date(Date.now() + 60000) || t > new Date(Date.now() + 180 * 864e5)) throw new HttpError(400, 'Pick a time in the future');
    await q('UPDATE posts SET scheduled_for = $2, created_at = $2 WHERE id = $1', [postId, t]);
  }
  if (d.poll && config.features.polls) {
    const poll = z.object({ question: z.string().trim().min(1).max(300), options: z.array(z.string().trim().min(1).max(80)).min(2).max(6), days: z.number().int().min(1).max(30).nullable().optional() }).strict().parse(JSON.parse(d.poll));
    await q("INSERT INTO polls (post_id, question, options, closes_at) VALUES ($1,$2,$3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END)", [postId, poll.question, JSON.stringify(poll.options), poll.days ?? null]);
  }
  if (d.music_track_id && config.features.music) await q('UPDATE posts SET music_track_id = (SELECT id FROM music_tracks WHERE id = $2 AND active), music_start = $3 WHERE id = $1', [postId, d.music_track_id, d.music_start || 0]);
  if (d.hide_like_count === '1' && config.features.hideLikes) await q('UPDATE posts SET hide_like_count = true WHERE id = $1', [postId]);
  if (d.remix_of_id && config.features.remix) {
    const o = await getVisiblePost(req.user.id, d.remix_of_id);
    if (!o || o.kind !== 'reel') throw new HttpError(404, 'The original reel isn’t available');
    await q('UPDATE posts SET remix_of_id = $2, remix_layout = $3 WHERE id = $1', [postId, o.id, d.remix_layout || 'duet']);
    notify((await q('SELECT author_id FROM posts WHERE id = $1', [o.id])).rows[0].author_id, req.user.id, 'remix', { post_id: postId });
  }
  if (d.effect && config.features.arEffects) await q('UPDATE posts SET effect = $2 WHERE id = $1', [postId, d.effect]);
}
export { applyPostExtras };
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:', ...(config.features.backfill ? ['https://archive.org', 'https://*.archive.org'] : [])], frameSrc: config.features.backfill ? ['https://archive.org'] : ["'none'"], mediaSrc: ["'self'", 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", ...(config.features.arEffects ? ["'wasm-unsafe-eval'"] : [])], workerSrc: ["'self'", 'blob:'], connectSrc: ["'self'", ...liveConnectSrc()], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.cookieSecure ? [] : null } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Rate limits (per client IP; trust proxy = 1 so the Codespaces/edge proxy's X-Forwarded-For is used).
  const lim = (windowMin, max, error, extra = {}) => rateLimit({ windowMs: windowMin * 60 * 1000, limit: config.isTest ? 10000 : max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error }, ...extra });
  const authLimiter = lim(15, 20, 'Too many attempts, try again in 15 minutes');
  const loginLimiter = lim(15, 10, 'Too many login attempts, try again in 15 minutes');
  // second login limiter keyed by the account identifier, so one account can't be brute-forced from many IPs
  const loginIdLimiter = lim(15, 10, 'Too many login attempts for this account, try again in 15 minutes', { keyGenerator: (req) => 'id:' + String(req.body?.login || '').trim().toLowerCase().slice(0, 200) });
  const signupLimiter = lim(60, 5, 'Too many sign-ups from your network, try again in an hour');
  const codeLimiter = lim(15, 8, 'Too many code requests, try again in 15 minutes');
  const reportLimiter = lim(60, 20, 'Too many reports, try again later');
  const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 10000 : 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Slow down a little' } });

  const api = express.Router();
  api.use(csrfGuard, loadUser);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use((req, res, next) => (req.method === 'GET' ? next() : writeLimiter(req, res, next)));

  api.use((req, res, next) => { if (req.method !== 'GET' && req.user && config.features.streaks) res.on('finish', () => { if (res.statusCode < 400 && /^\/(posts|reels|stories|comments|conversations|live)/.test(req.path)) recordActivity(req.user.id); }); next(); });
  api.get('/health', async (_req, res) => { await q('SELECT 1'); res.json({ ok: true }); });

  // ---------- auth ----------
  // Signup: the client collects identifier+password, name, DOB and terms over several screens,
  // then calls /auth/register once. Only then is a *pending* account created and a code sent.
  const Ident = z.object({ identifier: z.string().max(200), country: z.string().length(2).toUpperCase().default('NG') });
  const requireChannel = (id) => {
    if (id.type === 'phone' && !smsConfigured()) throw new HttpError(400, 'Phone sign-up is coming soon. Please use your email address for now.');
  };
  api.get('/auth/capabilities', (_req, res) => res.json({ phone_signup: smsConfigured(), email_signup: true, min_age: 13, signup_pow: config.features.signupPow, features: { reels: config.features.reels, welcome_hero: config.features.welcomeHero, ai_support: config.features.aiSupport, live: config.features.live, subscriptions: config.features.subscriptions, ...round78Features() } }));
  api.get('/auth/challenge', authLimiter, (_req, res) => res.json(newChallenge()));
  const MAX_ACCOUNTS = 10;
  const accountsFor = async (id, { verifiedOnly = true } = {}) => (await q(
    `SELECT id, username, full_name, avatar_path, email, phone, password_hash, email_verified_at, deactivated_at FROM users WHERE ${identCol(id)} = $1 ${verifiedOnly ? 'AND email_verified_at IS NOT NULL' : ''} ORDER BY id LIMIT 50`, [id.value])).rows;
  // bcrypt-compare a password against every account owned by an identifier (max 10, so bounded cost).
  const matchPassword = async (accounts, pw) => { for (const a of accounts) if (await bcrypt.compare(pw, a.password_hash)) return a; return null; };
  const target = (id, userId) => ({ key: keyOf(id), email: id.type === 'email' ? id.value : null, phone: id.type === 'phone' ? id.value : null, userId });
  const SAME = { error: 'You already have an account with these details.', code: 'SAME_DETAILS' };
  const pub = (a) => ({ id: a.id, username: a.username, full_name: a.full_name, avatar_path: a.avatar_path, deactivated: Boolean(a.deactivated_at) });

  api.post('/auth/check-identifier', authLimiter, async (req, res) => {
    const d = Ident.extend({ password: z.string().max(200).optional() }).strict().parse(req.body);
    const id = parseIdentifier(d.identifier, d.country);
    requireChannel(id);
    const accts = await accountsFor(id);
    if (accts.length >= MAX_ACCOUNTS) return res.status(409).json({ error: `This ${id.type} already has the maximum of ${MAX_ACCOUNTS} accounts.`, code: 'TOO_MANY' });
    if (d.password && await matchPassword(accts, d.password)) return res.status(409).json(SAME);
    res.json({ ok: true, type: id.type, normalized: id.value });
  });
  api.post('/auth/register', signupLimiter, async (req, res) => {
    const d = Ident.extend({ password, full_name: FullName, birth_date: BirthDate, accept_terms: z.literal(true, { errorMap: () => ({ message: 'You must agree to the Terms to continue' }) }), pow: z.object({ challenge: z.string().max(300), solution: z.string().max(20) }).strict().optional() }).strict().parse(req.body);
    const powErr = await verifyPow(d.pow);
    if (powErr) return res.status(400).json({ error: powErr, code: 'POW_REQUIRED' });
    const id = parseIdentifier(d.identifier, d.country);
    requireChannel(id);
    const accts = await accountsFor(id);
    if (accts.length >= MAX_ACCOUNTS) return res.status(409).json({ error: `This ${id.type} already has the maximum of ${MAX_ACCOUNTS} accounts.`, code: 'TOO_MANY' });
    if (await matchPassword(accts, d.password)) return res.status(409).json(SAME);
    const hash = await bcrypt.hash(d.password, BCRYPT_COST);
    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      // only one pending signup per identifier: replace an abandoned one
      await client.query(`DELETE FROM users WHERE ${identCol(id)} = $1 AND email_verified_at IS NULL`, [id.value]);
      const uname = await generateUsername(d.full_name, client);
      const { rows } = await client.query(
        `INSERT INTO users (username, full_name, email, phone, password_hash, birth_date, terms_accepted_at, is_private) VALUES ($1,$2,$3,$4,$5,$6, now(), $7) RETURNING id`,
        [uname, d.full_name, id.type === 'email' ? id.value : null, id.type === 'phone' ? id.value : null, hash, d.birth_date,
         // Teen safety: new under-18 accounts start private (existing accounts are never changed).
         !!(config.features.teenSafety && d.birth_date && new Date(d.birth_date) > new Date(Date.now() - 18 * 365.25 * 864e5))]);
      await client.query('COMMIT');
      user = rows[0];
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return res.status(409).json({ error: 'Please try again' }); throw e; } finally { client.release(); }
    try { await issueCode(target(id, user.id), 'verify_email'); }
    catch (e) { await q('DELETE FROM users WHERE id = $1', [user.id]); console.error('[signup] code delivery failed', e.message); return res.status(502).json({ error: 'We couldn’t send your code right now. Please try again in a minute.' }); }
    res.status(201).json({ ok: true, pending: true, type: id.type, sent_to: id.value });
  });
  const Code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
  const pendingFor = async (id) => (await q(`SELECT id, email, full_name FROM users WHERE ${identCol(id)} = $1 AND email_verified_at IS NULL ORDER BY id DESC LIMIT 1`, [id.value])).rows[0];
  api.post('/auth/verify', codeLimiter, async (req, res) => {
    const d = Ident.extend({ code: Code }).strict().parse(req.body);
    const id = parseIdentifier(d.identifier, d.country);
    const u = await pendingFor(id);
    if (!u) return res.status(400).json({ error: 'Code expired or not found — request a new one', reason: 'expired' });
    const r = await consumeCode(keyOf(id), 'verify_email', d.code);
    if (r !== 'ok') return res.status(400).json({ error: CODE_ERRORS[r], reason: r });
    await q('UPDATE users SET email_verified_at = now() WHERE id = $1', [u.id]);
    await createSession(res, u.id, req.get('user-agent'), req, 'signup'); // auto-login after verification
    await loginAlert(u.id, req.get('user-agent'));
    if (u.email) sendMail({ to: u.email, subject: 'Welcome to Connectly', text: welcomeText(u.full_name) }).catch((e) => console.error('[welcome]', e.message));
    res.json({ ok: true });
  });
  api.post('/auth/resend', codeLimiter, async (req, res) => {
    const d = Ident.strict().parse(req.body);
    const id = parseIdentifier(d.identifier, d.country);
    const u = await pendingFor(id);
    if (!u) return res.json({ ok: true }); // no enumeration
    requireChannel(id);
    const r = await issueCode(target(id, u.id), 'verify_email');
    if (!r.ok) return res.status(429).json({ error: `Please wait ${r.retryAfter}s before requesting another code`, retry_after: r.retryAfter });
    res.json({ ok: true });
  });
  api.post('/auth/login', loginLimiter, loginIdLimiter, async (req, res) => {
    const d = LoginSchema.parse(req.body);
    let accts;
    try { accts = await accountsFor(parseIdentifier(d.login, d.country || 'NG'), { verifiedOnly: false }); }
    catch { accts = (await q('SELECT id, password_hash, email_verified_at, deactivated_at FROM users WHERE lower(username) = lower($1)', [d.login])).rows; }
    const verified = accts.filter((a) => a.email_verified_at), pending = accts.filter((a) => !a.email_verified_at);
    const hit = await matchPassword(verified, d.password);
    if (!hit) {
      if (!accts.length) await bcrypt.compare(d.password, DUMMY_HASH);
      if (await matchPassword(pending, d.password)) return res.status(403).json({ error: 'This account isn’t verified yet. Enter the code we sent you, or request a new one.', code: 'PENDING_VERIFICATION' });
      return res.status(401).json({ error: 'Wrong email/phone or password' });
    }
    const { rows: sus } = await q('SELECT suspended_at FROM users WHERE id = $1', [hit.id]);
    if (sus[0]?.suspended_at) return res.status(403).json({ error: 'This account has been suspended for breaking the Community Standards.', code: 'SUSPENDED' });
    const reactivated = Boolean(hit.deactivated_at);
    if (reactivated) await q('UPDATE users SET deactivated_at = NULL WHERE id = $1', [hit.id]);
    const tw = await twoStepMethods(hit.id);
    if (tw) return res.json(await startTwoStep(hit.id, req.get('user-agent'), tw));
    await createSession(res, hit.id, req.get('user-agent'), req);
    await loginAlert(hit.id, req.get('user-agent'));
    res.json({ ok: true, reactivated });
  });

  // Codes for password reset / find-account go to the identifier; after the code the user picks an account.
  const resolveQuery = async (query, country) => {
    try { return parseIdentifier(query, country); } catch { /* maybe a username */ }
    const { rows } = await q('SELECT email, phone FROM users WHERE lower(username) = lower($1) AND email_verified_at IS NOT NULL', [String(query).trim().replace(/^@/, '')]);
    if (!rows[0]) return null;
    return rows[0].email ? { type: 'email', value: rows[0].email } : { type: 'phone', value: rows[0].phone };
  };
  const mask = (id) => id.type === 'email' ? id.value.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => a + '•'.repeat(Math.min(b.length, 6)) + c) : id.value.slice(0, 4) + '•••••' + id.value.slice(-2);
  const sendIdentCode = (purpose) => async (req, res) => {
    const d = z.object({ identifier: z.string().min(1).max(200), country: z.string().length(2).toUpperCase().default('NG') }).strict().parse(req.body);
    const id = await resolveQuery(d.identifier, d.country);
    if (id) {
      requireChannel(id);
      if ((await accountsFor(id)).length) {
        const r = await issueCode(target(id), purpose);
        if (!r.ok) return res.status(429).json({ error: `Please wait ${r.retryAfter}s before requesting another code`, retry_after: r.retryAfter });
      }
    }
    // Same answer whether or not accounts exist (no enumeration). Masked destination only for email/phone typed by the user.
    res.json({ ok: true, message: 'If we found an account, we’ve sent a 6-digit code to the email or phone on file.' });
  };
  api.post('/auth/forgot', codeLimiter, sendIdentCode('reset_password'));
  api.post('/auth/find', codeLimiter, sendIdentCode('find_account'));
  api.post('/auth/code-accounts', codeLimiter, async (req, res) => {
    const d = z.object({ identifier: z.string().min(1).max(200), country: z.string().length(2).toUpperCase().default('NG'), code: Code, purpose: z.enum(['reset_password', 'find_account']) }).strict().parse(req.body);
    const id = await resolveQuery(d.identifier, d.country);
    const r = id ? await consumeCode(keyOf(id), d.purpose, d.code) : 'expired';
    if (r !== 'ok') return res.status(400).json({ error: CODE_ERRORS[r], reason: r });
    const ticket = await createTicket(keyOf(id), 'pick_account');
    res.json({ ticket, sent_to: mask(id), login_identifier: id.value, accounts: (await accountsFor(id)).map(pub) });
  });
  api.post('/auth/reset', codeLimiter, async (req, res) => {
    const d = z.object({ ticket: z.string().min(10).max(100), user_id: z.number().int().positive(), password }).strict().parse(req.body);
    const t = await readTicket(d.ticket);
    if (!t) return res.status(400).json({ error: 'This reset session expired. Please request a new code.' });
    const [type, ...rest] = t.identifier.split(':'); const id = { type, value: rest.join(':') };
    const accts = await accountsFor(id);
    const u = accts.find((a) => a.id === d.user_id);
    if (!u) return res.status(403).json({ error: 'That account isn’t linked to this email or phone' });
    if (await matchPassword(accts.filter((a) => a.id !== u.id), d.password)) return res.status(409).json({ error: 'Another account on this email/phone already uses that password. Choose a different one.' });
    await q('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(d.password, BCRYPT_COST), u.id]);
    await q('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    await useTicket(d.ticket);
    res.json({ ok: true, username: u.username });
  });

  api.get('/me', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json({ ...publicUser(rows[0]), email: rows[0].email, phone: rows[0].phone, birth_date: rows[0].birth_date, email_verified: Boolean(rows[0].email_verified_at), onboarded: Boolean(rows[0].onboarded_at), email_notifications: rows[0].email_notifications, inapp_notifications: rows[0].inapp_notifications, default_post_visibility: rows[0].default_post_visibility, profile_details_visibility: rows[0].profile_details_visibility, theme_pref: rows[0].theme_pref, public_contact: rows[0].public_contact || '', show_contact: !!rows[0].show_contact, locale: rows[0].locale, text_scale: rows[0].text_scale ?? null, hide_like_counts: rows[0].hide_like_counts, two_step: !!rows[0].totp_enabled_at || rows[0].two_step_email,
      acting_as: req.user.acting_space_id ? (await q('SELECT id, slug, name, photo_path FROM spaces WHERE id = $1', [req.user.acting_space_id])).rows[0] || null : null,
      unread_notifications: (await q('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id])).rows[0].n, current_place_id: rows[0].current_place_id, hometown_place_id: rows[0].hometown_place_id, roles: req.user.roles });
  });

  // ---------- profiles ----------
  const editProfile = async (req, res) => {
    const d = ProfileSchema.parse(req.body);
    for (const [idKey, textKey] of [['current_place_id', 'location'], ['hometown_place_id', 'hometown']]) {
      if (d[idKey] === undefined) continue;
      if (d[idKey] === null) { d[textKey] = ''; continue; }
      const { rows: pl } = await q('SELECT display FROM places WHERE id = $1', [d[idKey]]);
      if (!pl[0]) return res.status(400).json({ error: 'Unknown place' });
      d[textKey] = pl[0].display;
    }
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
    const { rows } = await q('SELECT * FROM users WHERE lower(username) = lower($1) AND deactivated_at IS NULL AND suspended_at IS NULL AND email_verified_at IS NOT NULL', [req.params.username]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const u = rows[0]; const me = req.user.id;
    const rel = (await q(`SELECT
      EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2) AS i_blocked,
      EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $2 AND blocked_id = $1) AS blocked_me,
      (SELECT CASE WHEN status = 'accepted' THEN 'friends' WHEN requester_id = $1 THEN 'outgoing' ELSE 'incoming' END FROM friendships
        WHERE status IN ('pending','accepted') AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)) LIMIT 1) AS friend_status,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS following,
      (SELECT count(*) FROM follows WHERE followee_id = $2) AS follower_count,
      (SELECT count(*) FROM follows WHERE follower_id = $2) AS following_count,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS follows_me,
      (SELECT count(*) FROM friendships WHERE status = 'accepted' AND (requester_id = $2 OR addressee_id = $2)) AS friend_count`, [me, u.id])).rows[0];
    if (rel.blocked_me || (rel.i_blocked && u.id !== me)) return res.status(404).json({ error: 'User not found' });
    const { rows: c } = await q(`SELECT count(*) AS n FROM posts p WHERE p.author_id = $2 AND p.as_space_id IS NULL AND ${VISIBLE}`, [me, u.id]);
    const pu = publicUser(u);
    const canDetails = u.id === me || u.profile_details_visibility === 'public' || (u.profile_details_visibility === 'friends' && (rel.friend_status === 'friends' || (rel.following && rel.follows_me)));
    if (!canDetails) { for (const k of ['bio', 'location', 'hometown', 'relationship_status', 'work_company', 'work_role', 'education', 'website', 'contact']) pu[k] = ''; pu.socials = {}; } if (!canDetails) pu.interests = [];
    const teenBlock = config.features.teenSafety && u.birth_date && new Date(u.birth_date) > new Date(Date.now() - 18 * 365.25 * 864e5) && !rel.follows_me && !(req.user.birth_date && new Date(req.user.birth_date) > new Date(Date.now() - 18 * 365.25 * 864e5));
    const can_message = config.features.messages && u.id !== me && !teenBlock && (u.dm_privacy === 'everyone' || (u.dm_privacy === 'following' && rel.follows_me));
    const locked = u.is_private && u.id !== me && !rel.following;
    const requested = locked ? (await q('SELECT 1 FROM follow_requests WHERE requester_id = $1 AND target_id = $2', [me, u.id])).rowCount > 0 : false;
    res.json({ ...pu, can_message, is_private: !!u.is_private, locked, requested, lists_hidden: u.id !== me && (!!u.hide_follow_lists || locked), post_count: c[0].n, is_me: u.id === me, friend_status: rel.friend_status || 'none', following: rel.following, follower_count: Number(rel.follower_count), following_count: Number(rel.following_count), follows_me: rel.follows_me, friend_count: rel.friend_count, tier: config.features.subscriptions ? ((await q("SELECT tier FROM user_subscriptions WHERE user_id = $1 AND status = 'active'", [u.id])).rows[0]?.tier || 'free') : null });
  });
  api.get('/users/:username/posts', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT id FROM users WHERE lower(username) = lower($1) AND deactivated_at IS NULL', [req.params.username]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(await pagePosts(req.user.id, 'p.author_id = $2 AND p.as_space_id IS NULL', [rows[0].id], req.query.cursor, req.query.limit));
  });
  // Profile "Mentions" tab: visible posts by others that @mention this user.
  api.get('/users/:username/mentions', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT id, username FROM users WHERE lower(username) = lower($1) AND deactivated_at IS NULL', [req.params.username]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(await pagePosts(req.user.id, "p.author_id <> $2 AND p.body ~* $3", [rows[0].id, `(^|[^\\w])@${rows[0].username.replace(/[^\w.]/g, '')}([^\\w]|$)`], req.query.cursor, req.query.limit));
  });

  // ---------- posts ----------
  // Home feed is follow-based: me, people I follow and spaces I belong to. With no follows yet, show public posts to discover people.
  const FEED_SCOPE = `p.kind = 'post' AND (p.author_id = $1 OR EXISTS (SELECT 1 FROM follows ff WHERE ff.follower_id = $1 AND ff.followee_id = p.author_id)
    OR (p.space_id IS NOT NULL AND EXISTS (SELECT 1 FROM space_members sm WHERE sm.user_id = $1 AND sm.space_id = p.space_id))
    OR NOT EXISTS (SELECT 1 FROM follows f0 WHERE f0.follower_id = $1)) AND NOT EXISTS (SELECT 1 FROM mutes mu WHERE mu.user_id = $1 AND mu.target_id = p.author_id AND mu.posts)`;
  api.get('/feed', requireAuth, async (req, res) => res.json(await pagePosts(req.user.id, FEED_SCOPE, [], req.query.cursor, req.query.limit)));
  api.post('/posts', requireVerified, upload.single('image'), async (req, res) => {
    const d = PostCreateSchema.parse({ body: req.body?.body ?? '', visibility: req.body?.visibility || undefined, feeling: req.body?.feeling || undefined, location_tag: req.body?.location_tag || undefined, as_draft: req.body?.as_draft || undefined, enhance: req.body?.enhance || undefined });
    if (!d.body && !req.file) return res.status(400).json({ error: 'Write something or add a photo' });
    let spaceId = null, asSpace = await actingPage(req);
    if (req.body?.space_id) {
      const sp = (await q('SELECT s.id, s.kind, m.role FROM spaces s LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = $2 WHERE s.id = $1', [id(req.body.space_id), req.user.id])).rows[0];
      if (!sp) return res.status(404).json({ error: 'Page or group not found' });
      const admin = ['owner', 'admin'].includes(sp.role);
      if (sp.kind === 'page' && !admin) return res.status(403).json({ error: 'Only page admins can post on a page' });
      if (sp.kind !== 'page' && !sp.role) return res.status(403).json({ error: 'Join first to post here' });
      spaceId = sp.id; if (sp.kind === 'page') asSpace = sp.id;
      d.visibility = 'public';
    }
    const img = req.file ? await saveImage(req.file.buffer, 'post', { enhance: req.body?.enhance === '1' }) : null;
    const { rows } = await q('INSERT INTO posts (author_id, body, image_path, visibility, space_id, as_space_id, feeling, location_tag, is_draft) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [req.user.id, d.body, img, d.visibility, spaceId, asSpace, d.feeling, d.location_tag, d.as_draft === '1']);
    await applyPostExtras(req, rows[0].id, d.body);
    res.status(201).json(await getOwnPost(req.user.id, rows[0].id));
  });
  api.get('/posts/:id', requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found' });
    res.json(p);
  });
  const ownPost = async (req, res) => {
    const { rows } = await q(`SELECT p.id, p.author_id, p.image_path, p.video_path, p.poster_path, p.body FROM posts p WHERE p.id = $2 AND (p.author_id = $1 OR ${VISIBLE}) AND p.deleted_at IS NULL AND p.hidden_at IS NULL`, [req.user.id, id(req.params.id)]);
    if (!rows[0]) { res.status(404).json({ error: 'Post not found' }); return null; }
    if (rows[0].author_id !== req.user.id) { res.status(403).json({ error: 'You can only change your own posts' }); return null; }
    return rows[0];
  };
  api.patch('/posts/:id', requireVerified, async (req, res) => {
    const d = PostEditSchema.parse(req.body);
    const post = await ownPost(req, res); if (!post) return;
    const body = d.body ?? post.body;
    const image = d.remove_image ? null : post.image_path;
    if (!body && !image && !post.video_path) return res.status(400).json({ error: 'A post needs text or a photo' });
    await q('UPDATE posts SET body = $1, image_path = $2, visibility = COALESCE($3, visibility), feeling = COALESCE($6, feeling), location_tag = COALESCE($7, location_tag), updated_at = now() WHERE id = $4 AND author_id = $5', [body, image, d.visibility ?? null, post.id, req.user.id, d.feeling ?? null, d.location_tag ?? null]);
    if (d.remove_image) removeImage(post.image_path);
    if (config.features.hashtags && d.body !== undefined) { await q('DELETE FROM post_hashtags WHERE post_id = $1', [post.id]); await saveTags(post.id, body); }
    res.json(await getOwnPost(req.user.id, post.id));
  });
  api.delete('/posts/:id', requireAuth, async (req, res) => {
    const post = await ownPost(req, res); if (!post) return;
    await q('UPDATE posts SET deleted_at = now() WHERE id = $1 AND author_id = $2', [post.id, req.user.id]);
    res.json({ ok: true, recently_deleted: true, purge_after_days: 30 });
  });
  const likeCount = async (postId) => (await q('SELECT count(*) AS n FROM post_likes WHERE post_id = $1', [postId])).rows[0].n;
  api.put('/posts/:id/like', requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found' });
    const reaction = z.object({ reaction: z.enum(REACTIONS).default('like') }).strict().parse(req.body || {}).reaction;
    const ins = await q('INSERT INTO post_likes (post_id, user_id, reaction) VALUES ($1,$2,$3) ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction RETURNING (xmax = 0) AS inserted', [p.id, req.user.id, reaction]);
    ins.rowCount = ins.rows[0]?.inserted ? 1 : 0;
    if (ins.rowCount) { const { rows: own } = await q('SELECT author_id FROM posts WHERE id = $1', [p.id]); await notify(own[0].author_id, req.user.id, 'like', { post_id: p.id }); }
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
      ${authorJson('c', 'u')} AS author, (c.author_id = $2) AS is_mine
      FROM comments c JOIN users u ON u.id = c.author_id AND u.deactivated_at IS NULL WHERE c.post_id = $1
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $2 AND b.blocked_id = c.author_id) OR (b.blocker_id = c.author_id AND b.blocked_id = $2))
      ORDER BY c.id ASC LIMIT 500`, [p.id, req.user.id]);
    // Restricted people's comments are only visible to them (and flagged for the post owner); hidden-word matches are tucked away.
    const { rows: [own] } = await q('SELECT author_id FROM posts WHERE id = $1', [p.id]);
    const restricted = config.features.restrictMute ? new Set((await q('SELECT target_id FROM restricts WHERE user_id = $1', [own.author_id])).rows.map((r) => r.target_id)) : new Set();
    const words = config.features.hiddenWords ? await hiddenWordsOf(own.author_id) : null;
    const items = [];
    for (const c of rows) {
      const isOwner = own.author_id === req.user.id;
      if (restricted.has(c.author.id) && !c.is_mine) { if (isOwner) items.push({ ...c, restricted: true }); continue; }
      if (words && !c.is_mine && matchesHidden(c.body, words)) { if (isOwner) items.push({ ...c, hidden: true }); continue; }
      items.push(c);
    }
    res.json({ items });
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
    { const { rows: [o] } = await q('SELECT author_id FROM posts WHERE id = $1', [p.id]); if (!(await allowedBy(o.author_id, req.user.id, 'who_can_comment'))) return res.status(403).json({ error: 'Comments are limited on this post' }); }
    const asSpace = await actingPage(req);
    const { rows } = await q('INSERT INTO comments (post_id, author_id, parent_id, body, as_space_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, post_id, parent_id, body, created_at', [p.id, req.user.id, parent, d.body, asSpace]);
    const { rows: own } = await q('SELECT author_id FROM posts WHERE id = $1', [p.id]);
    if (!(await isRestricted(own[0].author_id, req.user.id))) await notify(own[0].author_id, req.user.id, parent ? 'reply' : 'comment', { post_id: p.id, comment_id: rows[0].id });
    await notifyMentions(d.body, req.user.id, 'mention', { post_id: p.id, comment_id: rows[0].id });
    if (parent) { const { rows: pc } = await q('SELECT author_id FROM comments WHERE id = $1', [parent]); if (pc[0] && pc[0].author_id !== own[0].author_id) await notify(pc[0].author_id, req.user.id, 'reply', { post_id: p.id, comment_id: rows[0].id }); }
    res.status(201).json({ ...rows[0], is_mine: true, author: { id: req.user.id, username: req.user.username, full_name: req.user.full_name } });
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

  // ---------- settings ----------
  api.patch('/me/settings', requireAuth, async (req, res) => {
    const d = z.object({ email_notifications: z.boolean().optional(), inapp_notifications: z.boolean().optional(), default_post_visibility: Visibility.optional(), profile_details_visibility: Visibility.optional(), theme_pref: z.enum(['light', 'dark', 'system']).optional() }).strict().parse(req.body);
    await q(`UPDATE users SET email_notifications = COALESCE($1, email_notifications), inapp_notifications = COALESCE($2, inapp_notifications),
      default_post_visibility = COALESCE($3, default_post_visibility), profile_details_visibility = COALESCE($4, profile_details_visibility), theme_pref = COALESCE($6, theme_pref) WHERE id = $5`,
      [d.email_notifications ?? null, d.inapp_notifications ?? null, d.default_post_visibility ?? null, d.profile_details_visibility ?? null, req.user.id, d.theme_pref ?? null]);
    res.json({ ok: true });
  });
  const checkPassword = async (req) => {
    const { password: pw } = z.object({ password: z.string().min(1).max(200) }).strict().parse(req.body);
    const { rows } = await q('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(pw, rows[0].password_hash))) throw new HttpError(403, 'Password is not correct');
  };
  // Temporary: hides the profile and posts; logging in again reactivates.
  api.post('/me/deactivate', requireAuth, async (req, res) => {
    await checkPassword(req);
    await q('UPDATE users SET deactivated_at = now() WHERE id = $1', [req.user.id]);
    await q('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    res.clearCookie('cx_session', { path: '/' });
    res.json({ ok: true });
  });
  // Permanent and immediate: deletes the account, posts, comments, likes and uploaded files.
  api.post('/me/delete', requireAuth, async (req, res) => {
    await checkPassword(req);
    const { rows: files } = await q(`SELECT avatar_path AS p FROM users WHERE id = $1 UNION ALL SELECT cover_path FROM users WHERE id = $1
      UNION ALL SELECT unnest(ARRAY[image_path, video_path, poster_path, video_low_path]) FROM posts WHERE author_id = $1 OR space_id IN (SELECT id FROM spaces WHERE owner_id = $1) UNION ALL SELECT image_path FROM stories WHERE author_id = $1
      UNION ALL SELECT photo_path FROM spaces WHERE owner_id = $1 UNION ALL SELECT ph.path FROM listing_photos ph JOIN listings l ON l.id = ph.listing_id WHERE l.seller_id = $1`, [req.user.id]);
    await q('DELETE FROM users WHERE id = $1', [req.user.id]); // cascades to sessions, posts, comments, likes, etc.
    for (const f of files) removeImage(f.p);
    res.clearCookie('cx_session', { path: '/' });
    res.json({ ok: true });
  });

  // ---------- places (offline GeoNames dataset) ----------
  api.get('/places', requireAuth, async (req, res) => {
    const term = z.string().trim().min(1).max(80).parse(req.query.q).toLowerCase();
    const [city, ...rest] = term.split(',').map((x) => x.trim());
    const hint = rest.join(' ');
    const like = city.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    let { rows } = await q(`SELECT id, name, admin1, country, display FROM places
      WHERE (lower(ascii_name) LIKE $1 OR lower(name) LIKE $1) AND ($2 = '' OR lower(admin1 || ' ' || country) LIKE '%' || $2 || '%')
      ORDER BY (lower(ascii_name) = $3 OR lower(name) = $3) DESC, population DESC LIMIT 10`, [like, hint, city]);
    if (rows.length < 5 && city.length >= 3) {
      const fuzzy = (await q(`SELECT id, name, admin1, country, display FROM places WHERE lower(ascii_name) % $1
        ORDER BY similarity(lower(ascii_name), $1) DESC, population DESC LIMIT 10`, [city])).rows;
      const seen = new Set(rows.map((r) => r.id));
      rows = rows.concat(fuzzy.filter((r) => !seen.has(r.id))).slice(0, 10);
    }
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ items: rows });
  });

  // ---------- search ----------
  api.get('/search', requireAuth, async (req, res) => {
    const { q: term, type, cursor } = z.object({ q: z.string().trim().min(1).max(100), type: z.enum(['people', 'posts', 'pages', 'groups', 'communities']).default('people'), cursor: z.string().optional(), limit: z.string().optional() }).parse(req.query);
    const like = '%' + term.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    if (!cursor && !/@|^\+?\d[\d\s-]{5,}$/.test(term)) recordSearch(req.user.id, term); // never store email/phone lookups
    if (type === 'people') {
      const { rows } = await q(`SELECT id, username, full_name, avatar_path, bio FROM users
        WHERE email_verified_at IS NOT NULL AND deactivated_at IS NULL AND ((lower(username) || ' ' || lower(full_name)) LIKE $1
          OR ($4 AND discover_by_email AND lower(email) = lower($2)) OR ($4 AND discover_by_phone AND length($5) >= 7 AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') LIKE '%' || $5))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $3 AND b.blocked_id = users.id) OR (b.blocker_id = users.id AND b.blocked_id = $3))
        ORDER BY (lower(username) = lower($2)) DESC, (lower(username) LIKE lower($2) || '%') DESC, full_name LIMIT 20`, [like, term, req.user.id, config.features.discoverability, term.replace(/\D/g, '')]);
      return res.json({ items: rows, next_cursor: null });
    }
    if (type !== 'posts') {
      const kind = { pages: 'page', groups: 'group', communities: 'community' }[type];
      const { rows } = await q(`SELECT s.id, s.kind, s.slug, s.name, s.category, s.photo_path, (SELECT count(*) FROM space_members m WHERE m.space_id = s.id) AS member_count
        FROM spaces s WHERE s.kind = $1 AND (lower(s.name) LIKE $2 OR lower(s.category) LIKE $2) ORDER BY (lower(s.name) LIKE lower($3) || '%') DESC, member_count DESC, s.name LIMIT 20`, [kind, like, term]);
      return res.json({ items: rows, next_cursor: null });
    }
    res.json(await pagePosts(req.user.id, 'lower(p.body) LIKE $2', [like], cursor, req.query.limit));
  });
  registerSocial(api, { requireAuth, requireVerified, id, pagePosts, checkPassword, BCRYPT_COST, config });
  registerReels(api, { applyPostExtras, requireAuth, requireVerified, id, pagePosts, getVisiblePost, actingPage, Visibility });
  registerAi(api, { requireAuth, id });
  registerSubscriptions(api, { requireAuth, requireAdmin, id });
  registerEngagement(api, { requireAuth, id, getVisiblePost, writeLimiter });
  registerLive(api, { requireAuth, requireVerified, requireModerator, id, notify });
  registerMessages(api, { requireAuth, requireVerified, id });
  registerRound7(api, { requireAuth, requireVerified, requireAdmin, id, pagePosts, getVisiblePost, notify, createSession, codeLimiter });
  registerRound8(api, { requireAuth, requireVerified, requireAdmin, id, pagePosts, getVisiblePost });
  registerRound9(api, { requireAuth, requireVerified, id, pagePosts, getVisiblePost });
  registerNews(api, { requireAuth });
  registerPricing(api, { requireAuth, requireAdmin });
  registerDownloads(api, { requireAuth, id });
  registerBackfill(api, { requireAuth });
  registerPostExtras(api, { requireAuth, requireVerified, id, pagePosts, getVisiblePost, getOwnPost, POST_SELECT, notify });

  // ---------- reports & moderation ----------
  const ReportSchema = z.object({ target_type: z.enum(['post', 'user']), post_id: z.number().int().positive().optional(), username: z.string().max(40).optional(), reason: z.string().trim().min(3, 'Tell us briefly what is wrong').max(500) }).strict();
  api.post('/reports', requireVerified, reportLimiter, async (req, res) => {
    if (!config.features.reports) return res.status(404).json({ error: 'Not found' });
    const d = ReportSchema.parse(req.body);
    let postId = null, userId = null;
    if (d.target_type === 'post') {
      const p = d.post_id && await getVisiblePost(req.user.id, d.post_id);
      if (!p) return res.status(404).json({ error: 'Post not found' });
      postId = p.id;
      userId = (await q('SELECT author_id FROM posts WHERE id = $1', [p.id])).rows[0].author_id;
    } else {
      const { rows } = await q('SELECT id FROM users WHERE lower(username) = lower($1) AND email_verified_at IS NOT NULL', [String(d.username || '').replace(/^@/, '')]);
      if (!rows[0]) return res.status(404).json({ error: 'User not found' });
      userId = rows[0].id;
    }
    if (userId === req.user.id) return res.status(400).json({ error: 'You can’t report yourself' });
    const dup = await q("SELECT 1 FROM reports WHERE reporter_id = $1 AND target_type = $2 AND COALESCE(post_id,0) = COALESCE($3,0) AND target_user_id = $4 AND status = 'open'", [req.user.id, d.target_type, postId, userId]);
    if (!dup.rowCount) await q('INSERT INTO reports (reporter_id, target_type, post_id, target_user_id, reason) VALUES ($1,$2,$3,$4,$5)', [req.user.id, d.target_type, postId, userId, d.reason]);
    res.status(201).json({ ok: true, message: 'Thanks. Our moderators will review this.' });
  });
  api.get('/admin/reports', requireModerator, async (req, res) => {
    const status = z.enum(['open', 'actioned', 'dismissed', 'all']).default('open').parse(req.query.status);
    const { rows } = await q(`SELECT r.id, r.target_type, r.reason, r.status, r.resolution, r.created_at, r.resolved_at, r.post_id,
        left(p.body, 200) AS post_body, p.hidden_at AS post_hidden_at,
        json_build_object('id', ru.id, 'username', ru.username) AS reporter,
        json_build_object('id', tu.id, 'username', tu.username, 'full_name', tu.full_name, 'suspended_at', tu.suspended_at) AS target_user,
        (SELECT count(*)::int FROM reports r2 WHERE r2.target_user_id = r.target_user_id) AS reports_against_user
      FROM reports r JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users tu ON tu.id = r.target_user_id LEFT JOIN posts p ON p.id = r.post_id
      WHERE ($1 = 'all' OR r.status = $1) ORDER BY r.id DESC LIMIT 200`, [status]);
    res.json({ items: rows });
  });
  const closeReports = (where, params, resolution, by) => q(`UPDATE reports SET status = 'actioned', resolution = $${params.length + 1}, handled_by = $${params.length + 2}, resolved_at = now() WHERE status = 'open' AND ${where}`, [...params, resolution, by]);
  api.post('/admin/reports/:id/dismiss', requireModerator, async (req, res) => {
    await q("UPDATE reports SET status = 'dismissed', resolution = 'dismissed', handled_by = $2, resolved_at = now() WHERE id = $1", [id(req.params.id), req.user.id]);
    res.json({ ok: true });
  });
  // Hiding/suspending never deletes anything: it sets a timestamp that can be undone.
  api.post('/admin/posts/:id/hide', requireModerator, async (req, res) => {
    const pid = id(req.params.id);
    const r = await q('UPDATE posts SET hidden_at = now(), hidden_by = $2 WHERE id = $1 AND hidden_at IS NULL', [pid, req.user.id]);
    await closeReports('post_id = $1', [pid], 'post hidden', req.user.id);
    res.json({ ok: true, changed: r.rowCount });
  });
  api.post('/admin/posts/:id/unhide', requireModerator, async (req, res) => {
    await q('UPDATE posts SET hidden_at = NULL, hidden_by = NULL WHERE id = $1', [id(req.params.id)]);
    res.json({ ok: true });
  });
  api.post('/admin/users/:id/suspend', requireModerator, async (req, res) => {
    const uid = id(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().max(300).default('') }).strict().parse(req.body || {});
    if (uid === req.user.id) return res.status(400).json({ error: 'You cannot suspend yourself' });
    const { rows } = await q("SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.name = 'admin'", [uid]);
    if (rows.length) return res.status(400).json({ error: 'Remove the admin role before suspending this account' });
    await q('UPDATE users SET suspended_at = COALESCE(suspended_at, now()), suspended_reason = $2 WHERE id = $1', [uid, reason]);
    await closeReports('target_user_id = $1', [uid], 'user suspended', req.user.id);
    res.json({ ok: true });
  });
  api.post('/admin/users/:id/unsuspend', requireModerator, async (req, res) => {
    await q("UPDATE users SET suspended_at = NULL, suspended_reason = '' WHERE id = $1", [id(req.params.id)]);
    res.json({ ok: true });
  });

  // ---------- admin ----------
  api.get('/admin/users', requireAdmin, async (_req, res) => {
    const { rows } = await q(`SELECT u.id, u.username, u.full_name, u.email, u.phone, u.created_at, u.email_verified_at IS NOT NULL AS email_verified, u.suspended_at,
      COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
      COALESCE((SELECT us.tier FROM user_subscriptions us WHERE us.user_id = u.id), 'free') AS tier
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
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: err.field === 'video' ? 'Video must be 50 MB or smaller' : 'Image must be 15 MB or smaller' });
    if (err?.name === 'MulterError') return res.status(400).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
export { pool };
