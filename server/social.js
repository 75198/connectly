// Friends, follows, blocks, notifications, pages/groups/communities, marketplace, account & security settings.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q } from './db.js';
import { sendMail } from './mailer.js';
import { HttpError, upload, uploadMany, saveImage, removeImage } from './uploads.js';
import { createSession, destroySession, COOKIE, sha256, randomToken } from './auth.js';
import { issueCode, consumeCode, CODE_ERRORS } from './codes.js';
import { parseIdentifier, identCol } from './identity.js';
import { smsConfigured } from './sms.js';
import { config } from './config.js';

const EMAIL_TYPES = { friend_request: (a) => [`${a} sent you a friend request`, `${a} wants to be friends on Connectly.`], friend_accept: (a) => [`${a} accepted your friend request`, `You and ${a} are now friends on Connectly.`] };
// Creates an in-app notification (if enabled) and sends email for friend events (if enabled). Never throws.
export async function notify(userId, actorId, type, extra = {}) {
  try {
    if (!userId || userId === actorId) return;
    const { rows } = await q(`SELECT u.email, u.email_notifications, u.inapp_notifications, a.full_name AS actor_name FROM users u, users a WHERE u.id = $1 AND a.id = $2
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = u.id))`, [userId, actorId]);
    const u = rows[0]; if (!u) return;
    if (u.inapp_notifications) await q('INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, space_id, live_stream_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [userId, actorId, type, extra.post_id || null, extra.comment_id || null, extra.space_id || null, extra.live_stream_id || null]);
    if (EMAIL_TYPES[type] && u.email && u.email_notifications) {
      const [subject, line] = EMAIL_TYPES[type](u.actor_name);
      await sendMail({ to: u.email, subject, text: `${line}\n\nOpen Connectly: ${config.appUrl}/friends\n\nYou can turn off email notifications in Privacy and settings > Notifications.` });
    }
  } catch (e) { console.error('[notify]', e.message); }
}

const slugify = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
export const SPACE_CATEGORIES = ['Business', 'Brand or product', 'Community', 'Education', 'Entertainment', 'Faith', 'Food & drink', 'Health & fitness', 'Local business', 'Music', 'News & media', 'Non-profit', 'Public figure', 'Sports', 'Technology', 'Travel', 'Other'];
export const LISTING_CATEGORIES = ['Vehicles', 'Property for rent', 'Property for sale', 'Electronics', 'Phones & tablets', 'Home & garden', 'Fashion', 'Baby & kids', 'Health & beauty', 'Hobbies', 'Sports & outdoors', 'Pets', 'Jobs', 'Services', 'Other'];
export const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'XOF'];
const DEVICE_COOKIE = 'cx_device';
const deviceCookieOpts = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/', maxAge: 365 * 864e5 });

export function registerSocial(api, { requireAuth, requireVerified, id, pagePosts, BCRYPT_COST }) {
  const userBy = async (username, meId) => {
    const { rows } = await q(`SELECT id, username, full_name, email FROM users WHERE lower(username) = lower($1) AND email_verified_at IS NOT NULL AND deactivated_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $2 AND b.blocked_id = users.id) OR (b.blocker_id = users.id AND b.blocked_id = $2))`, [username, meId]);
    if (!rows[0]) throw new HttpError(404, 'User not found');
    if (rows[0].id === meId) throw new HttpError(400, 'That’s you');
    return rows[0];
  };
  const pairSql = `((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`;

  // ---------- friends ----------
  api.post('/friends/:username', requireVerified, async (req, res) => {
    const u = await userBy(req.params.username, req.user.id);
    const { rows } = await q(`SELECT requester_id, status FROM friendships WHERE ${pairSql}`, [req.user.id, u.id]);
    const f = rows[0];
    if (f?.status === 'accepted') return res.json({ friend_status: 'friends' });
    if (f?.status === 'pending' && f.requester_id === u.id) { // they already asked me: accept
      await q(`UPDATE friendships SET status = 'accepted', responded_at = now() WHERE requester_id = $1 AND addressee_id = $2`, [u.id, req.user.id]);
      await notify(u.id, req.user.id, 'friend_accept'); return res.json({ friend_status: 'friends' });
    }
    if (f?.status === 'pending') return res.json({ friend_status: 'outgoing' });
    await q(`DELETE FROM friendships WHERE ${pairSql}`, [req.user.id, u.id]);
    await q(`INSERT INTO friendships (requester_id, addressee_id) VALUES ($1,$2)`, [req.user.id, u.id]);
    await notify(u.id, req.user.id, 'friend_request');
    res.json({ friend_status: 'outgoing' });
  });
  api.post('/friends/:username/accept', requireAuth, async (req, res) => {
    const u = await userBy(req.params.username, req.user.id);
    const r = await q(`UPDATE friendships SET status = 'accepted', responded_at = now() WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [u.id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'No pending request from this person' });
    await notify(u.id, req.user.id, 'friend_accept');
    res.json({ friend_status: 'friends' });
  });
  api.post('/friends/:username/reject', requireAuth, async (req, res) => {
    const u = await userBy(req.params.username, req.user.id);
    const r = await q(`DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [u.id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'No pending request from this person' });
    res.json({ friend_status: 'none' });
  });
  // cancel my outgoing request, or unfriend
  api.delete('/friends/:username', requireAuth, async (req, res) => {
    const u = await userBy(req.params.username, req.user.id);
    await q(`DELETE FROM friendships WHERE ${pairSql}`, [req.user.id, u.id]);
    res.json({ friend_status: 'none' });
  });
  api.get('/friends', requireAuth, async (req, res) => {
    const type = z.enum(['friends', 'incoming', 'outgoing']).default('friends').parse(req.query.type);
    const cond = { friends: `f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)`, incoming: `f.status = 'pending' AND f.addressee_id = $1`, outgoing: `f.status = 'pending' AND f.requester_id = $1` }[type];
    const { rows } = await q(`SELECT u.id, u.username, u.full_name, u.avatar_path FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
      WHERE ${cond} AND u.deactivated_at IS NULL ORDER BY f.created_at DESC LIMIT 500`, [req.user.id]);
    res.json({ items: rows });
  });

  // ---------- follows ----------
  api.put('/users/:username/follow', requireVerified, async (req, res) => {
    const u = await userBy(req.params.username, req.user.id);
    const r = await q('INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, u.id]);
    if (r.rowCount) await notify(u.id, req.user.id, 'follow');
    res.json({ following: true });
  });
  api.delete('/users/:username/follow', requireAuth, async (req, res) => {
    const u = await userBy(req.params.username, req.user.id);
    await q('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [req.user.id, u.id]);
    res.json({ following: false });
  });

  // ---------- blocks ----------
  api.put('/users/:username/block', requireAuth, async (req, res) => {
    const u = await userBy(req.params.username, req.user.id);
    await q('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, u.id]);
    await q(`DELETE FROM friendships WHERE ${pairSql}`, [req.user.id, u.id]);
    await q('DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)', [req.user.id, u.id]);
    res.json({ blocked: true });
  });
  api.delete('/me/blocked/:userId', requireAuth, async (req, res) => {
    await q('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, id(req.params.userId)]);
    res.json({ blocked: false });
  });
  api.get('/me/blocked', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT u.id, u.username, u.full_name, u.avatar_path, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC', [req.user.id]);
    res.json({ items: rows });
  });

  // ---------- notifications ----------
  api.get('/notifications', requireAuth, async (req, res) => {
    const before = req.query.cursor ? id(req.query.cursor) : null;
    const { rows } = await q(`SELECT n.id, n.type, n.post_id, n.created_at, n.read_at,
      json_build_object('username', a.username, 'full_name', a.full_name, 'avatar_path', a.avatar_path) AS actor,
      (SELECT left(body, 80) FROM posts WHERE id = n.post_id) AS post_snippet,
      (SELECT json_build_object('slug', slug, 'name', name, 'kind', kind) FROM spaces WHERE id = n.space_id) AS space, n.live_stream_id
      FROM notifications n JOIN users a ON a.id = n.actor_id AND a.deactivated_at IS NULL
      WHERE n.user_id = $1 AND ($2::bigint IS NULL OR n.id < $2) ORDER BY n.id DESC LIMIT 30`, [req.user.id, before]);
    res.json({ items: rows, next_cursor: rows.length === 30 ? String(rows[29].id) : null });
  });
  api.post('/notifications/read', requireAuth, async (req, res) => {
    const d = z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), all: z.boolean().optional() }).strict().parse(req.body);
    if (d.all) await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    else if (d.ids?.length) await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL', [req.user.id, d.ids]);
    res.json({ ok: true });
  });

  // ---------- pages / groups / communities ----------
  const spaceBy = async (slug, meId) => {
    const { rows } = await q(`SELECT s.*, (SELECT count(*) FROM space_members m WHERE m.space_id = s.id) AS member_count,
      (SELECT role FROM space_members m WHERE m.space_id = s.id AND m.user_id = $2) AS my_role,
      json_build_object('username', o.username, 'full_name', o.full_name) AS owner
      FROM spaces s JOIN users o ON o.id = s.owner_id WHERE lower(s.slug) = lower($1)`, [slug, meId]);
    if (!rows[0]) throw new HttpError(404, 'Not found');
    return rows[0];
  };
  const SpaceSchema = z.object({ kind: z.enum(['page', 'group', 'community']), name: z.string().trim().min(2).max(80), category: z.enum(SPACE_CATEGORIES), description: z.string().trim().max(1000).default('') }).strict();
  api.post('/spaces', requireVerified, upload.single('photo'), async (req, res) => {
    const d = SpaceSchema.parse({ kind: req.body?.kind, name: req.body?.name, category: req.body?.category, description: req.body?.description ?? '' });
    const { rows: n } = await q('SELECT count(*)::int AS n FROM spaces WHERE owner_id = $1', [req.user.id]);
    if (n[0].n >= 50) return res.status(400).json({ error: 'You’ve reached the limit of 50 pages and groups' });
    const photo = req.file ? await saveImage(req.file.buffer, 'space') : null;
    let slug = slugify(d.name);
    for (let i = 0; (await q('SELECT 1 FROM spaces WHERE lower(slug) = $1', [slug])).rows.length; i++) slug = `${slugify(d.name).slice(0, 34)}-${Math.floor(Math.random() * 10 ** (3 + Math.min(i, 3)))}`;
    const { rows } = await q('INSERT INTO spaces (kind, slug, name, category, description, photo_path, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, slug', [d.kind, slug, d.name, d.category, d.description, photo, req.user.id]);
    await q("INSERT INTO space_members (space_id, user_id, role) VALUES ($1,$2,'owner')", [rows[0].id, req.user.id]);
    res.status(201).json(await spaceBy(rows[0].slug, req.user.id));
  });
  api.get('/spaces/categories', requireAuth, (_req, res) => res.json({ items: SPACE_CATEGORIES }));
  api.get('/spaces/:slug', requireAuth, async (req, res) => res.json(await spaceBy(req.params.slug, req.user.id)));
  api.get('/spaces/:slug/posts', requireAuth, async (req, res) => {
    const s = await spaceBy(req.params.slug, req.user.id);
    res.json(await pagePosts(req.user.id, 'p.space_id = $2', [s.id], req.query.cursor, req.query.limit));
  });
  api.put('/spaces/:slug/membership', requireVerified, async (req, res) => {
    const s = await spaceBy(req.params.slug, req.user.id);
    if (!s.my_role) {
      await q('INSERT INTO space_members (space_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [s.id, req.user.id, s.kind === 'page' ? 'follower' : 'member']);
      await notify(s.owner_id, req.user.id, s.kind === 'page' ? 'page_follow' : 'group_join', { space_id: s.id });
    }
    res.json(await spaceBy(s.slug, req.user.id));
  });
  api.delete('/spaces/:slug/membership', requireAuth, async (req, res) => {
    const s = await spaceBy(req.params.slug, req.user.id);
    if (s.my_role === 'owner') return res.status(400).json({ error: 'Owners can’t leave. Delete it instead.' });
    await q('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [s.id, req.user.id]);
    res.json(await spaceBy(s.slug, req.user.id));
  });
  api.delete('/spaces/:slug', requireAuth, async (req, res) => {
    const s = await spaceBy(req.params.slug, req.user.id);
    if (s.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete this' });
    const { rows: files } = await q('SELECT image_path AS p FROM posts WHERE space_id = $1 OR as_space_id = $1', [s.id]);
    await q('DELETE FROM spaces WHERE id = $1', [s.id]);
    removeImage(s.photo_path); for (const f of files) removeImage(f.p);
    res.json({ ok: true });
  });
  api.get('/me/spaces', requireAuth, async (req, res) => {
    const kind = z.enum(['page', 'group', 'community']).optional().parse(req.query.kind);
    const { rows } = await q(`SELECT s.id, s.kind, s.slug, s.name, s.category, s.photo_path, m.role FROM space_members m JOIN spaces s ON s.id = m.space_id
      WHERE m.user_id = $1 AND ($2::text IS NULL OR s.kind = $2) ORDER BY (m.role = 'owner') DESC, s.name`, [req.user.id, kind ?? null]);
    res.json({ items: rows });
  });
  // Act as one of your pages (posts/comments then appear as the page), or as yourself (space_id null).
  api.post('/me/acting', requireAuth, async (req, res) => {
    const { space_id } = z.object({ space_id: z.number().int().positive().nullable() }).strict().parse(req.body);
    if (space_id) {
      const { rows } = await q("SELECT s.id, s.slug, s.name, s.photo_path FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE s.id = $1 AND s.kind = 'page' AND m.user_id = $2 AND m.role IN ('owner','admin')", [space_id, req.user.id]);
      if (!rows[0]) return res.status(403).json({ error: 'You can only act as pages you manage' });
    }
    await q('UPDATE sessions SET acting_space_id = $1 WHERE id = $2', [space_id, req.user.session_id]);
    res.json({ ok: true });
  });

  // ---------- marketplace ----------
  const ListingSchema = z.object({
    title: z.string().trim().min(3).max(100), price: z.coerce.number().min(0).max(1e12), currency: z.enum(CURRENCIES),
    category: z.enum(LISTING_CATEGORIES), description: z.string().trim().max(3000).default(''), place_id: z.coerce.number().int().positive().optional(),
  }).strict();
  const LISTING_SELECT = `SELECT l.id, l.title, l.price::float AS price, l.currency, l.category, l.description, l.location, l.status, l.created_at, (l.seller_id = $1) AS is_mine,
    json_build_object('username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path) AS seller,
    COALESCE((SELECT json_agg(ph.path ORDER BY ph.position) FROM listing_photos ph WHERE ph.listing_id = l.id), '[]') AS photos
    FROM listings l JOIN users u ON u.id = l.seller_id AND u.deactivated_at IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = l.seller_id) OR (b.blocker_id = l.seller_id AND b.blocked_id = $1))`;
  api.get('/listings/meta', requireAuth, (_req, res) => res.json({ categories: LISTING_CATEGORIES, currencies: CURRENCIES }));
  api.post('/listings', requireVerified, uploadMany.array('photos', 6), async (req, res) => {
    const d = ListingSchema.parse({ ...req.body });
    if (!req.files?.length) return res.status(400).json({ error: 'Add at least one photo' });
    let location = '';
    if (d.place_id) { const { rows } = await q('SELECT display FROM places WHERE id = $1', [d.place_id]); if (!rows[0]) return res.status(400).json({ error: 'Unknown place' }); location = rows[0].display; }
    const photos = []; for (const f of req.files) photos.push(await saveImage(f.buffer, 'listing'));
    const { rows } = await q('INSERT INTO listings (seller_id, title, price, currency, category, description, place_id, location) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [req.user.id, d.title, d.price, d.currency, d.category, d.description, d.place_id || null, location]);
    for (const [i, p] of photos.entries()) await q('INSERT INTO listing_photos (listing_id, path, position) VALUES ($1,$2,$3)', [rows[0].id, p, i]);
    res.status(201).json((await q(`${LISTING_SELECT} AND l.id = $2`, [req.user.id, rows[0].id])).rows[0]);
  });
  api.get('/listings', requireAuth, async (req, res) => {
    const f = z.object({ q: z.string().trim().max(100).optional(), category: z.enum(LISTING_CATEGORIES).optional(), min: z.coerce.number().min(0).optional(), max: z.coerce.number().min(0).optional(),
      currency: z.enum(CURRENCIES).optional(), location: z.string().trim().max(80).optional(), mine: z.enum(['1']).optional(), cursor: z.string().optional(), sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest') }).parse(req.query);
    const params = [req.user.id]; const where = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
    if (f.mine) add('l.seller_id = ?', req.user.id); else where.push("l.status = 'active'");
    if (f.q) add('(lower(l.title) LIKE ? OR lower(l.description) LIKE ?)', `%${f.q.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    if (f.category) add('l.category = ?', f.category);
    if (f.currency) add('l.currency = ?', f.currency);
    if (f.min !== undefined) add('l.price >= ?', f.min);
    if (f.max !== undefined) add('l.price <= ?', f.max);
    if (f.location) add('lower(l.location) LIKE ?', `%${f.location.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    if (f.cursor && f.sort === 'newest') add('l.id < ?', id(f.cursor));
    const order = { newest: 'l.id DESC', price_asc: 'l.price ASC, l.id DESC', price_desc: 'l.price DESC, l.id DESC' }[f.sort];
    const { rows } = await q(`${LISTING_SELECT} ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 21`, params);
    const more = rows.length > 20 && f.sort === 'newest';
    res.json({ items: rows.slice(0, 20), next_cursor: more ? String(rows[19].id) : null });
  });
  api.get('/listings/:id', requireAuth, async (req, res) => {
    const { rows } = await q(`${LISTING_SELECT} AND l.id = $2`, [req.user.id, id(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'Listing not found' });
    res.json(rows[0]);
  });
  const ownListing = async (req) => {
    const { rows } = await q('SELECT id, seller_id FROM listings WHERE id = $1', [id(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, 'Listing not found');
    if (rows[0].seller_id !== req.user.id) throw new HttpError(403, 'You can only change your own listings');
    return rows[0];
  };
  api.patch('/listings/:id', requireAuth, async (req, res) => {
    const { status } = z.object({ status: z.enum(['active', 'sold']) }).strict().parse(req.body);
    const l = await ownListing(req);
    await q('UPDATE listings SET status = $1, updated_at = now() WHERE id = $2', [status, l.id]);
    res.json((await q(`${LISTING_SELECT} AND l.id = $2`, [req.user.id, l.id])).rows[0]);
  });
  api.delete('/listings/:id', requireAuth, async (req, res) => {
    const l = await ownListing(req);
    const { rows } = await q('SELECT path FROM listing_photos WHERE listing_id = $1', [l.id]);
    await q('DELETE FROM listings WHERE id = $1', [l.id]);
    for (const r of rows) removeImage(r.path);
    res.json({ ok: true });
  });

  // ---------- account & security ----------
  api.post('/me/password', requireAuth, async (req, res) => {
    const d = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(8, 'Password must be at least 8 characters').max(200) }).strict().parse(req.body);
    const { rows } = await q('SELECT password_hash, email, phone FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(d.current_password, rows[0].password_hash))) return res.status(403).json({ error: 'Current password is not correct' });
    const { rows: sib } = await q('SELECT password_hash FROM users WHERE id <> $1 AND email_verified_at IS NOT NULL AND ((email IS NOT NULL AND lower(email) = lower($2)) OR (phone IS NOT NULL AND phone = $3))', [req.user.id, rows[0].email || '', rows[0].phone || '']);
    for (const s of sib) if (await bcrypt.compare(d.new_password, s.password_hash)) return res.status(409).json({ error: 'Another account on your email/phone uses that password. Choose a different one.' });
    await q('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(d.new_password, BCRYPT_COST), req.user.id]);
    await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.user.session_id]);
    await q('DELETE FROM saved_logins WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  });
  // change email / phone: code goes to the NEW address; confirmed only with that code
  const changeKey = (uid, idf) => `change:${uid}:${idf.type}:${idf.value}`;
  api.post('/me/identifier/start', requireAuth, async (req, res) => {
    const d = z.object({ identifier: z.string().min(1).max(200), country: z.string().length(2).toUpperCase().default('NG'), password: z.string().min(1).max(200) }).strict().parse(req.body);
    const { rows } = await q('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(d.password, rows[0].password_hash))) return res.status(403).json({ error: 'Password is not correct' });
    const idf = parseIdentifier(d.identifier, d.country);
    if (idf.type === 'phone' && !smsConfigured()) return res.status(400).json({ error: 'Adding a phone number is coming soon (SMS isn’t set up yet).' });
    const { rows: n } = await q(`SELECT count(*)::int AS n FROM users WHERE ${identCol(idf)} = $1 AND email_verified_at IS NOT NULL`, [idf.value]);
    if (n[0].n >= 10) return res.status(409).json({ error: 'That address already has the maximum number of accounts' });
    const r = await issueCode({ key: changeKey(req.user.id, idf), email: idf.type === 'email' ? idf.value : null, phone: idf.type === 'phone' ? idf.value : null, userId: req.user.id }, 'change_identifier');
    if (!r.ok) return res.status(429).json({ error: `Please wait ${r.retryAfter}s before requesting another code` });
    res.json({ ok: true, type: idf.type, sent_to: idf.value });
  });
  api.post('/me/identifier/confirm', requireAuth, async (req, res) => {
    const d = z.object({ identifier: z.string().min(1).max(200), country: z.string().length(2).toUpperCase().default('NG'), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).strict().parse(req.body);
    const idf = parseIdentifier(d.identifier, d.country);
    const r = await consumeCode(changeKey(req.user.id, idf), 'change_identifier', d.code);
    if (r !== 'ok') return res.status(400).json({ error: CODE_ERRORS[r], reason: r });
    await q(`UPDATE users SET ${idf.type === 'email' ? 'email' : 'phone'} = $1, updated_at = now() WHERE id = $2`, [idf.value, req.user.id]);
    res.json({ ok: true });
  });
  api.get('/me/activity', requireAuth, async (req, res) => {
    const type = z.enum(['posts', 'comments', 'likes']).default('posts').parse(req.query.type);
    const before = req.query.cursor ? id(req.query.cursor) : null;
    const sql = {
      posts: `SELECT p.id, p.id AS post_id, left(p.body, 140) AS text, p.created_at, p.visibility FROM posts p WHERE p.author_id = $1 AND ($2::bigint IS NULL OR p.id < $2) ORDER BY p.id DESC LIMIT 30`,
      comments: `SELECT c.id, c.post_id, left(c.body, 140) AS text, c.created_at FROM comments c WHERE c.author_id = $1 AND ($2::bigint IS NULL OR c.id < $2) ORDER BY c.id DESC LIMIT 30`,
      likes: `SELECT p.id, p.id AS post_id, left(p.body, 140) AS text, l.created_at FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE l.user_id = $1 AND ($2::bigint IS NULL OR p.id < $2) ORDER BY p.id DESC LIMIT 30`,
    }[type];
    const { rows } = await q(sql, [req.user.id, before]);
    res.json({ items: rows, next_cursor: rows.length === 30 ? String(rows[29].id) : null });
  });
  api.get('/me/sessions', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT id, user_agent, approx_location, created_at, last_seen_at, (id = $2) AS current FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY (id = $2) DESC, last_seen_at DESC', [req.user.id, req.user.session_id]);
    const { rows: saved } = await q('SELECT left(device_hash, 16) AS id, user_agent, created_at, last_used_at, expires_at FROM saved_logins WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC', [req.user.id]);
    res.json({ items: rows, saved_devices: saved });
  });
  api.delete('/me/sessions/:id', requireAuth, async (req, res) => {
    await q('DELETE FROM sessions WHERE user_id = $1 AND id = $2 AND id <> $3', [req.user.id, id(req.params.id), req.user.session_id]);
    res.json({ ok: true });
  });
  api.post('/me/sessions/logout-others', requireAuth, async (req, res) => {
    const r = await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.user.session_id]);
    // also forget this account on every other device's "saved logins" (this device's entry is kept)
    const dev = req.cookies?.[DEVICE_COOKIE];
    const s = await q('DELETE FROM saved_logins WHERE user_id = $1 AND device_hash <> $2', [req.user.id, dev ? sha256(dev) : '']);
    res.json({ ok: true, ended: r.rowCount, saved_removed: s.rowCount });
  });
  api.delete('/me/saved-devices/:id', requireAuth, async (req, res) => {
    const prefix = z.string().regex(/^[a-f0-9]{16}$/).parse(req.params.id);
    await q('DELETE FROM saved_logins WHERE user_id = $1 AND left(device_hash, 16) = $2', [req.user.id, prefix]);
    res.json({ ok: true });
  });
  api.get('/me/logins', requireAuth, async (req, res) => {
    const { rows } = await q('SELECT id, created_at, method, user_agent, approx_location FROM login_history WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [req.user.id]);
    res.json({ items: rows });
  });

  // ---------- sign out / saved logins on this device ----------
  api.post('/auth/logout', async (req, res) => {
    const { save } = z.object({ save: z.boolean().optional() }).strict().parse(req.body || {});
    if (save && req.user) {
      let dev = req.cookies?.[DEVICE_COOKIE];
      if (!dev || !/^[A-Za-z0-9_-]{40,}$/.test(dev)) { dev = randomToken(); }
      res.cookie(DEVICE_COOKIE, dev, deviceCookieOpts());
      await q(`INSERT INTO saved_logins (device_hash, user_id, user_agent, expires_at) VALUES ($1,$2,$3, now() + make_interval(days => ${config.savedLoginDays})) ON CONFLICT (device_hash, user_id) DO UPDATE SET created_at = now(), expires_at = now() + make_interval(days => ${config.savedLoginDays})`, [sha256(dev), req.user.id, (req.get('user-agent') || '').slice(0, 300)]);
    }
    await destroySession(req, res);
    res.json({ ok: true, saved: Boolean(save && req.user) });
  });
  const deviceHash = (req) => { const d = req.cookies?.[DEVICE_COOKIE]; return d ? sha256(d) : null; };
  api.get('/auth/saved', async (req, res) => {
    const h = deviceHash(req); if (!h) return res.json({ items: [] });
    const { rows } = await q(`SELECT u.id, u.username, u.full_name, u.avatar_path FROM saved_logins s JOIN users u ON u.id = s.user_id
      WHERE s.device_hash = $1 AND s.expires_at > now() AND u.email_verified_at IS NOT NULL AND u.suspended_at IS NULL ORDER BY s.last_used_at DESC NULLS LAST, s.created_at DESC LIMIT 10`, [h]);
    res.json({ items: rows });
  });
  api.post('/auth/saved/login', async (req, res) => {
    const { user_id } = z.object({ user_id: z.number().int().positive() }).strict().parse(req.body);
    const h = deviceHash(req);
    const { rows } = h ? await q('SELECT u.id, u.deactivated_at FROM saved_logins s JOIN users u ON u.id = s.user_id WHERE s.device_hash = $1 AND s.user_id = $2 AND s.expires_at > now() AND u.email_verified_at IS NOT NULL AND u.suspended_at IS NULL', [h, user_id]) : { rows: [] };
    if (!rows[0]) return res.status(401).json({ error: 'This saved login is no longer valid. Please log in with your password.' });
    if (rows[0].deactivated_at) await q('UPDATE users SET deactivated_at = NULL WHERE id = $1', [user_id]);
    await q('UPDATE saved_logins SET last_used_at = now(), expires_at = now() + make_interval(days => $3) WHERE device_hash = $1 AND user_id = $2', [h, user_id, config.savedLoginDays]);
    await createSession(res, user_id, req.get('user-agent'), req, 'saved_login');
    res.json({ ok: true });
  });
  api.delete('/auth/saved/:userId', async (req, res) => {
    const h = deviceHash(req);
    if (h) await q('DELETE FROM saved_logins WHERE device_hash = $1 AND user_id = $2', [h, id(req.params.userId)]);
    res.json({ ok: true });
  });
}
