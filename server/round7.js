// Round 7 features (migration 015). Each block is behind its own FEATURE_* flag (see handbook §6 and §18).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { sendMail } from './mailer.js';
import { pushTo, pushConfigured } from './push.js';
import { newSecret, verifyTotp } from './totp.js';
import { sha256 } from './auth.js';

export const LOCALES = ['en', 'es', 'fr', 'pt', 'ar', 'hi', 'zh', 'ru', 'id', 'tr', 'de', 'ja', 'ko', 'sw', 'yo', 'ha', 'ig'];
export const LOCALE_NAMES = { en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese', ar: 'Arabic', hi: 'Hindi', zh: 'Chinese (Simplified)', ru: 'Russian', id: 'Indonesian', tr: 'Turkish', de: 'German', ja: 'Japanese', ko: 'Korean', sw: 'Swahili', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo' };
const flag = (name) => (_q, res, next) => (config.features[name] ? next() : res.status(404).json({ error: 'Not found' }));

// ---- hashtags ----
export function extractTags(text) {
  const out = new Set(); for (const m of String(text || '').matchAll(/(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{1,50})/gu)) if (!/^\d+$/.test(m[2])) out.add(m[2].toLowerCase());
  return [...out].slice(0, 30);
}
export async function saveTags(postId, body) {
  const tags = extractTags(body);
  await q('INSERT INTO post_hashtags (post_id, tag) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [postId, tags]);
  return tags;
}

// ---- device recognition for new-login alerts ----
function deviceLabel(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
export async function loginAlert(userId, ua) {
  try {
    const label = deviceLabel(ua || ''); const h = sha256(`${userId}:${label}`);
    const { rows: known } = await q('SELECT device_hash FROM known_devices WHERE user_id = $1', [userId]);
    await q('INSERT INTO known_devices (user_id, device_hash, label) VALUES ($1,$2,$3) ON CONFLICT (user_id, device_hash) DO UPDATE SET last_seen = now()', [userId, h, label]);
    if (!config.features.loginAlerts || !known.length || known.some((k) => k.device_hash === h)) return false;
    const { rows: [u] } = await q('SELECT email, full_name FROM users WHERE id = $1', [userId]);
    if (u?.email) await sendMail({ to: u.email, subject: 'New login to your Connectly account', text: `Hi ${u.full_name.split(' ')[0]},\n\nYour Connectly account was just used to log in from a new device: ${label}, at ${new Date().toUTCString()}.\n\nIf this was you, you don’t need to do anything.\nIf it wasn’t, change your password now and turn on two-step login: ${config.appUrl}/settings/security\n\n— The Connectly team` });
    pushTo(userId, { title: 'New login', body: `Your account was used on ${label}.`, url: '/settings/security', tag: 'login' });
    return true;
  } catch (e) { console.error('[loginAlert]', e.message); return false; }
}

// ---- two-step login ----
export async function twoStepMethods(userId) {
  if (!config.features.twoStep) return null;
  const { rows: [u] } = await q('SELECT totp_enabled_at, two_step_email, email FROM users WHERE id = $1', [userId]);
  const m = []; if (u.totp_enabled_at) m.push('totp'); if (u.two_step_email && u.email) m.push('email');
  return m.length ? { methods: m, email: u.email } : null;
}
const maskEmail = (e) => e.replace(/^(.)(.*)(@.*)$/, (_a, f, mid, d) => f + '•'.repeat(Math.min(6, mid.length)) + d);
const codeHash = (t, c) => crypto.createHmac('sha256', config.codeSecret).update(`login2:${t}:${c}`).digest('hex');
async function sendLoginCode(ticket, email) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await q('UPDATE login_challenges SET email_code_hash = $2, email_sent_at = now() WHERE token_hash = $1', [sha256(ticket), codeHash(ticket, code)]);
  await sendMail({ to: email, subject: 'Your Connectly login code', text: `Your Connectly login code is ${code}\n\nEnter it to finish logging in. It expires in 10 minutes. If this wasn’t you, change your password now.` });
}
export async function startTwoStep(userId, ua, tw) {
  const t = crypto.randomBytes(24).toString('base64url');
  await q("INSERT INTO login_challenges (token_hash, user_id, user_agent, expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')", [sha256(t), userId, (ua || '').slice(0, 300)]);
  if (tw.methods.includes('email')) await sendLoginCode(t, tw.email);
  return { two_step: true, ticket: t, methods: tw.methods, email_hint: tw.methods.includes('email') ? maskEmail(tw.email) : null };
}

const checkPassword = async (userId, pw) => { const { rows: [u] } = await q('SELECT password_hash FROM users WHERE id = $1', [userId]); return !!pw && bcrypt.compare(pw, u.password_hash); };
export function registerRound7(api, { requireAuth, requireVerified, requireAdmin, id, pagePosts, getVisiblePost, notify, createSession, codeLimiter }) {
  // ===== verified badge =====
  api.get('/me/verification', requireAuth, flag('verified'), async (req, res) => {
    const { rows: [u] } = await q('SELECT verified_at FROM users WHERE id = $1', [req.user.id]);
    const { rows: [r] } = await q("SELECT id, category, reason, status, created_at, decided_at FROM verification_requests WHERE user_id = $1 AND kind = 'notable' ORDER BY id DESC LIMIT 1", [req.user.id]);
    res.json({ verified: !!u.verified_at, request: r || null });
  });
  api.post('/me/verification', requireVerified, flag('verified'), async (req, res) => {
    const d = z.object({ category: z.enum(['Public figure', 'Creator', 'Business or brand', 'Journalist', 'Organisation', 'Other']), reason: z.string().trim().min(10, 'Tell us a little more about why').max(1000) }).strict().parse(req.body);
    const { rows: [u] } = await q('SELECT verified_at FROM users WHERE id = $1', [req.user.id]);
    if (u.verified_at) return res.status(400).json({ error: 'You’re already verified' });
    if ((await q("SELECT 1 FROM verification_requests WHERE user_id = $1 AND kind = 'notable' AND status = 'pending'", [req.user.id])).rowCount) return res.status(409).json({ error: 'Your request is already being reviewed' });
    await q('INSERT INTO verification_requests (user_id, category, reason) VALUES ($1,$2,$3)', [req.user.id, d.category, d.reason]);
    res.status(201).json({ ok: true, message: 'Thanks. We’ll review your request.' });
  });
  api.get('/admin/verification', requireAdmin, flag('verified'), async (req, res) => {
    const { rows } = await q(`SELECT r.id, r.category, r.reason, r.status, r.created_at, json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path,
      'followers', (SELECT count(*)::int FROM follows f WHERE f.followee_id = u.id)) AS user FROM verification_requests r JOIN users u ON u.id = r.user_id WHERE r.kind = 'notable' AND r.status = $1 ORDER BY r.id LIMIT 200`, [req.query.status === 'all' ? 'pending' : String(req.query.status || 'pending')]);
    res.json({ items: rows });
  });
  api.post('/admin/verification/:id', requireAdmin, flag('verified'), async (req, res) => {
    const { decision } = z.object({ decision: z.enum(['approve', 'reject']) }).strict().parse(req.body);
    const { rows: [r] } = await q("UPDATE verification_requests SET status = $2, decided_at = now(), decided_by = $3 WHERE id = $1 AND status = 'pending' RETURNING user_id", [id(req.params.id), decision === 'approve' ? 'approved' : 'rejected', req.user.id]);
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (decision === 'approve') await q("UPDATE users SET verified_at = COALESCE(verified_at, now()), verified_kind = 'notable' WHERE id = $1", [r.user_id]);
    notify(r.user_id, req.user.id, decision === 'approve' ? 'verified_approved' : 'verified_rejected');
    res.json({ ok: true });
  });
  api.post('/admin/users/:id/verified', requireAdmin, flag('verified'), async (req, res) => {
    const { verified } = z.object({ verified: z.boolean() }).strict().parse(req.body);
    await q(`UPDATE users SET verified_at = ${verified ? 'COALESCE(verified_at, now())' : 'NULL'}, verified_kind = ${verified ? "'notable'" : 'NULL'} WHERE id = $1`, [id(req.params.id)]); res.json({ ok: true });
  });

  // ===== hashtags + trending =====
  api.get('/hashtags/:tag/posts', requireAuth, flag('hashtags'), async (req, res) => {
    const tag = z.string().regex(/^[\p{L}\p{N}_]{1,50}$/u).parse(String(req.params.tag).toLowerCase());
    res.json(await pagePosts(req.user.id, 'EXISTS (SELECT 1 FROM post_hashtags h WHERE h.post_id = p.id AND h.tag = $2)', [tag], req.query.cursor, req.query.limit));
  });
  api.get('/trending', requireAuth, flag('hashtags'), async (_req, res) => {
    const { rows } = await q(`SELECT h.tag, count(*)::int AS posts FROM post_hashtags h JOIN posts p ON p.id = h.post_id
      WHERE h.created_at > now() - interval '7 days' AND p.visibility = 'public' AND p.hidden_at IS NULL AND p.deleted_at IS NULL AND NOT p.is_draft AND (p.scheduled_for IS NULL OR p.scheduled_for <= now())
      GROUP BY h.tag ORDER BY count(*) DESC, max(h.created_at) DESC LIMIT 15`);
    res.json({ items: rows.map((r) => ({ tag: r.tag, posts: r.posts })) });
  });

  // ===== For You ranked feed =====
  api.get('/feed/for-you', requireAuth, flag('forYou'), async (req, res) => {
    const off = Math.max(0, Number(req.query.cursor) || 0), lim = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
    const ranked = `p.kind = 'post' AND p.created_at > now() - interval '21 days' AND p.id IN (SELECT r.id FROM (
        SELECT p2.id, ((SELECT count(*) FROM post_likes l WHERE l.post_id = p2.id) + 2 * (SELECT count(*) FROM comments c WHERE c.post_id = p2.id) + 3 * (SELECT count(*) FROM shares s WHERE s.post_id = p2.id) + 1)::float
          * (CASE WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = p2.author_id) THEN 1.6 ELSE 1 END)
          * (CASE WHEN EXISTS (SELECT 1 FROM post_hashtags h JOIN post_hashtags h2 ON h2.tag = h.tag JOIN post_likes l2 ON l2.post_id = h2.post_id AND l2.user_id = $1 WHERE h.post_id = p2.id) THEN 1.4 ELSE 1 END)
          / power(EXTRACT(EPOCH FROM (now() - p2.created_at)) / 3600 + 2, 1.4) AS score
        FROM posts p2 WHERE p2.kind = 'post' AND p2.created_at > now() - interval '21 days' AND p2.author_id <> $1 AND NOT EXISTS (SELECT 1 FROM mutes mu WHERE mu.user_id = $1 AND mu.target_id = p2.author_id AND mu.posts)) r ORDER BY r.score DESC, r.id DESC OFFSET $2 LIMIT $3)`;
    const page = await pagePosts(req.user.id, ranked, [off, lim + 1], null, 50);
    // preserve ranking order
    const { rows: order } = await q(`SELECT r.id FROM (SELECT p2.id, ((SELECT count(*) FROM post_likes l WHERE l.post_id = p2.id) + 2 * (SELECT count(*) FROM comments c WHERE c.post_id = p2.id) + 3 * (SELECT count(*) FROM shares s WHERE s.post_id = p2.id) + 1)::float
          * (CASE WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = p2.author_id) THEN 1.6 ELSE 1 END) / power(EXTRACT(EPOCH FROM (now() - p2.created_at)) / 3600 + 2, 1.4) AS score FROM posts p2 WHERE p2.id = ANY($2)) r ORDER BY r.score DESC, r.id DESC`, [req.user.id, page.items.map((p) => p.id)]);
    const pos = new Map(order.map((o, i) => [o.id, i])); const items = page.items.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    const more = items.length > lim;
    res.json({ items: items.slice(0, lim), next_cursor: more || page.items.length >= lim ? String(off + lim) : null });
  });

  // ===== web push =====
  api.get('/push/key', requireAuth, flag('push'), (_q, res) => res.json({ key: pushConfigured() ? config.vapidPublic : null }));
  api.post('/push/subscribe', requireAuth, flag('push'), async (req, res) => {
    const d = z.object({ endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Invalid endpoint'), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }).strict(), expirationTime: z.any().optional() }).strict().parse(req.body);
    await q('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth', [req.user.id, d.endpoint, d.keys.p256dh, d.keys.auth]);
    res.status(201).json({ ok: true });
  });
  api.post('/push/unsubscribe', requireAuth, flag('push'), async (req, res) => { await q('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.user.id, String(req.body?.endpoint || '')]); res.json({ ok: true }); });
  api.post('/push/test', requireAuth, flag('push'), async (req, res) => { await pushTo(req.user.id, { title: 'Connectly', body: 'Notifications are on.', url: '/notifications', tag: 'test' }); res.json({ ok: true }); });

  // ===== preferences: language + hide like counts =====
  api.get('/me/prefs', requireAuth, async (req, res) => {
    const { rows: [u] } = await q('SELECT locale, hide_like_counts, text_scale, auto_translate, lite_mode FROM users WHERE id = $1', [req.user.id]); res.json(u);
  });
  api.patch('/me/prefs', requireAuth, async (req, res) => {
    const d = z.object({ locale: z.enum(LOCALES).nullable().optional(), hide_like_counts: z.boolean().optional(), text_scale: z.number().min(0.8).max(1.5).nullable().optional(), auto_translate: z.boolean().optional(), lite_mode: z.enum(['auto', 'on', 'off']).optional() }).strict().parse(req.body);
    if (d.auto_translate !== undefined) await q('UPDATE users SET auto_translate = $2 WHERE id = $1', [req.user.id, d.auto_translate]);
    if (d.lite_mode !== undefined) await q('UPDATE users SET lite_mode = $2 WHERE id = $1', [req.user.id, d.lite_mode]);
    if (d.text_scale !== undefined) await q('UPDATE users SET text_scale = $2 WHERE id = $1', [req.user.id, d.text_scale]);
    if (d.locale !== undefined) await q('UPDATE users SET locale = $2 WHERE id = $1', [req.user.id, d.locale]);
    if (d.hide_like_counts !== undefined && config.features.hideLikes) await q('UPDATE users SET hide_like_counts = $2 WHERE id = $1', [req.user.id, d.hide_like_counts]);
    const { rows: [u] } = await q('SELECT locale, hide_like_counts, text_scale FROM users WHERE id = $1', [req.user.id]); res.json(u);
  });
  api.put('/posts/:id/hide-likes', requireAuth, flag('hideLikes'), async (req, res) => {
    const { hidden } = z.object({ hidden: z.boolean() }).strict().parse(req.body);
    const { rowCount } = await q('UPDATE posts SET hide_like_count = $3 WHERE id = $1 AND author_id = $2', [id(req.params.id), req.user.id, hidden]);
    if (!rowCount) return res.status(404).json({ error: 'Post not found' }); res.json({ ok: true });
  });

  // ===== translate (Connectly AI) =====
  const translateHits = new Map();
  api.post('/translate', requireAuth, flag('translate'), async (req, res) => {
    const d = z.object({ text: z.string().trim().min(1).max(4000), target: z.enum(LOCALES) }).strict().parse(req.body);
    const hash = (await import('node:crypto')).createHash('sha256').update(d.text).digest('hex');
    const { rows: [hit] } = await q('SELECT text FROM translations WHERE hash = $1 AND target = $2', [hash, d.target]);
    if (hit) return res.json({ text: hit.text === '<<SAME>>' ? d.text : hit.text, target: d.target, same: hit.text === '<<SAME>>', cached: true });
    const now = Date.now(), k = req.user.id, arr = (translateHits.get(k) || []).filter((t) => now - t < 60000);
    if (arr.length >= 60) return res.status(429).json({ error: 'Translating a lot right now. Try again in a moment.' });
    arr.push(now); translateHits.set(k, arr);
    if (!config.groqApiKey) return res.status(503).json({ error: 'Translation isn’t available right now' });
    try {
      const r = await fetch(`${config.groqBaseUrl}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.groqModel, temperature: 0.2, max_tokens: 1500, stream: false, ...(config.groqModel.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
          messages: [{ role: 'system', content: `You are a translator. Translate the user's text into ${LOCALE_NAMES[d.target]}. Keep emoji, @mentions, #hashtags and links unchanged. Reply with the translation only, no notes. If the text is already in ${LOCALE_NAMES[d.target]} (or has no words to translate), reply exactly <<SAME>>.` }, { role: 'user', content: d.text }] }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json(); const t = j.choices?.[0]?.message?.content?.trim();
      if (!t) throw new Error('empty');
      const same = t.includes('<<SAME>>');
      await q('INSERT INTO translations (hash, target, text) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [hash, d.target, same ? '<<SAME>>' : t]);
      res.json({ text: same ? d.text : t, target: d.target, same });
    } catch { res.status(502).json({ error: 'Translation isn’t available right now. Try again later.' }); }
  });

  // ===== creator tools: insights, scheduled, pinned =====
  api.post('/impressions', requireAuth, flag('creatorTools'), async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(50) }).strict().parse(req.body);
    if (ids.length) await q('INSERT INTO post_impressions (post_id, user_id) SELECT p.id, $1 FROM posts p WHERE p.id = ANY($2) AND p.author_id <> $1 ON CONFLICT DO NOTHING', [req.user.id, ids]);
    res.json({ ok: true });
  });
  const insightsFor = async (postId) => (await q(`SELECT
      (SELECT count(*)::int FROM post_impressions WHERE post_id = $1) AS reach,
      (SELECT count(*)::int FROM post_likes WHERE post_id = $1) AS reactions,
      (SELECT COALESCE(json_object_agg(reaction, n), '{}') FROM (SELECT reaction, count(*)::int n FROM post_likes WHERE post_id = $1 GROUP BY reaction) x) AS by_reaction,
      (SELECT count(*)::int FROM comments WHERE post_id = $1) AS comments,
      (SELECT count(*)::int FROM shares WHERE post_id = $1) AS shares,
      (SELECT count(*)::int FROM saved_posts WHERE post_id = $1) AS saves,
      (SELECT count(*)::int FROM reel_views WHERE post_id = $1) AS views,
      (SELECT count(*)::int FROM post_impressions i WHERE i.post_id = $1 AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = i.user_id AND f.followee_id = (SELECT author_id FROM posts WHERE id = $1))) AS non_followers`, [postId])).rows[0];
  api.get('/posts/:id/insights', requireAuth, flag('creatorTools'), async (req, res) => {
    const { rows: [p] } = await q('SELECT id, created_at FROM posts WHERE id = $1 AND author_id = $2', [id(req.params.id), req.user.id]);
    if (!p) return res.status(404).json({ error: 'Post not found' });
    const i = await insightsFor(p.id); const eng = i.reactions + i.comments + i.shares + i.saves;
    res.json({ ...i, engagement_rate: i.reach ? Math.round((eng / i.reach) * 1000) / 10 : 0 });
  });
  api.get('/me/insights', requireAuth, flag('creatorTools'), async (req, res) => {
    const { rows: [s] } = await q(`SELECT (SELECT count(*)::int FROM post_impressions i JOIN posts p ON p.id = i.post_id WHERE p.author_id = $1 AND i.seen_at > now() - interval '28 days') AS reach_28d,
      (SELECT count(*)::int FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.author_id = $1 AND l.created_at > now() - interval '28 days') AS reactions_28d,
      (SELECT count(*)::int FROM comments c JOIN posts p ON p.id = c.post_id WHERE p.author_id = $1 AND c.created_at > now() - interval '28 days') AS comments_28d,
      (SELECT count(*)::int FROM follows f WHERE f.followee_id = $1 AND f.created_at > now() - interval '28 days') AS new_followers_28d`, [req.user.id]);
    const { rows: top } = await q(`SELECT p.id, left(p.body, 80) AS body, p.image_path, p.poster_path, p.created_at, (SELECT count(*)::int FROM post_impressions i WHERE i.post_id = p.id) AS reach,
      (SELECT count(*)::int FROM post_likes l WHERE l.post_id = p.id) AS reactions FROM posts p WHERE p.author_id = $1 AND p.deleted_at IS NULL AND NOT p.is_draft ORDER BY reach DESC, reactions DESC, p.id DESC LIMIT 5`, [req.user.id]);
    res.json({ ...s, top });
  });
  api.get('/me/scheduled', requireAuth, flag('creatorTools'), async (req, res) => {
    const { rows } = await q("SELECT id, body, image_path, scheduled_for, visibility FROM posts WHERE author_id = $1 AND scheduled_for > now() AND deleted_at IS NULL AND NOT is_draft ORDER BY scheduled_for", [req.user.id]);
    res.json({ items: rows });
  });
  api.post('/posts/:id/schedule', requireAuth, flag('creatorTools'), async (req, res) => {
    const { at } = z.object({ at: z.string().datetime({ offset: true }).nullable() }).strict().parse(req.body);
    if (at && new Date(at) <= new Date(Date.now() + 60000)) return res.status(400).json({ error: 'Pick a time in the future' });
    if (at && new Date(at) > new Date(Date.now() + 180 * 864e5)) return res.status(400).json({ error: 'Pick a date closer to today' });
    const { rows } = await q('UPDATE posts SET scheduled_for = $3, created_at = CASE WHEN $3::timestamptz IS NULL THEN now() ELSE COALESCE($3::timestamptz, created_at) END WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL RETURNING id', [id(req.params.id), req.user.id, at]);
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' }); res.json({ ok: true });
  });
  api.put('/posts/:id/pin', requireAuth, flag('creatorTools'), async (req, res) => {
    const pid = id(req.params.id);
    const { rows: [n] } = await q('SELECT count(*)::int AS n FROM posts WHERE author_id = $1 AND pinned_at IS NOT NULL AND deleted_at IS NULL AND id <> $2', [req.user.id, pid]);
    if (n.n >= 3) return res.status(400).json({ error: 'Unpin another post first' });
    const { rowCount } = await q('UPDATE posts SET pinned_at = now() WHERE id = $1 AND author_id = $2 AND as_space_id IS NULL AND deleted_at IS NULL', [pid, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Post not found' }); res.json({ ok: true });
  });
  api.delete('/posts/:id/pin', requireAuth, flag('creatorTools'), async (req, res) => { await q('UPDATE posts SET pinned_at = NULL WHERE id = $1 AND author_id = $2', [id(req.params.id), req.user.id]); res.json({ ok: true }); });
  api.get('/users/:username/pinned', requireAuth, async (req, res) => {
    if (!config.features.creatorTools) return res.json({ items: [] });
    const { rows: [u] } = await q('SELECT id FROM users WHERE lower(username) = lower($1)', [req.params.username]);
    if (!u) return res.json({ items: [] });
    const page = await pagePosts(req.user.id, 'p.author_id = $2 AND p.pinned_at IS NOT NULL AND p.as_space_id IS NULL', [u.id], null, 3);
    res.json({ items: page.items });
  });

  // ===== polls =====
  api.put('/polls/:id/vote', requireAuth, flag('polls'), async (req, res) => {
    const { option } = z.object({ option: z.number().int().min(0).max(9) }).strict().parse(req.body);
    const { rows: [p] } = await q('SELECT id, post_id, options, closes_at FROM polls WHERE id = $1', [id(req.params.id)]);
    if (!p || !(await getVisiblePost(req.user.id, p.post_id))) return res.status(404).json({ error: 'Poll not found' });
    if (p.closes_at && new Date(p.closes_at) < new Date()) return res.status(400).json({ error: 'This poll has ended' });
    if (option >= p.options.length) return res.status(400).json({ error: 'Choose an option' });
    await q('INSERT INTO poll_votes (poll_id, user_id, option_idx) VALUES ($1,$2,$3) ON CONFLICT (poll_id, user_id) DO UPDATE SET option_idx = EXCLUDED.option_idx, created_at = now()', [p.id, req.user.id, option]);
    res.json(await getVisiblePost(req.user.id, p.post_id));
  });

  // ===== events =====
  const EVENT_SELECT = `SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.location, e.visibility, e.cancelled_at, e.created_at, (e.creator_id = $1) AS is_mine,
    json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path, 'verified', u.verified_at IS NOT NULL) AS host,
    (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going, (SELECT count(*)::int FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') AS interested,
    (SELECT r.status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $1) AS my_rsvp FROM events e JOIN users u ON u.id = e.creator_id`;
  const EVENT_VISIBLE = `(e.creator_id = $1 OR e.visibility = 'public' OR (e.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = e.creator_id)))
    AND u.suspended_at IS NULL AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = e.creator_id) OR (b.blocker_id = e.creator_id AND b.blocked_id = $1))`;
  const EventSchema = z.object({ title: z.string().trim().min(2, 'Give your event a name').max(120), description: z.string().trim().max(3000).default(''), starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }).nullable().optional(), location: z.string().trim().max(200).default(''), visibility: z.enum(['public', 'followers', 'private']).default('public') }).strict();
  api.get('/events', requireAuth, flag('events'), async (req, res) => {
    const mine = req.query.filter === 'mine';
    const { rows } = await q(`${EVENT_SELECT} WHERE ${EVENT_VISIBLE} AND e.cancelled_at IS NULL AND COALESCE(e.ends_at, e.starts_at + interval '3 hours') > now() ${mine ? "AND (e.creator_id = $1 OR EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $1 AND r.status IN ('going','interested')))" : ''} ORDER BY e.starts_at LIMIT 100`, [req.user.id]);
    res.json({ items: rows });
  });
  api.post('/events', requireVerified, flag('events'), async (req, res) => {
    const d = EventSchema.parse(req.body);
    if (new Date(d.starts_at) < new Date(Date.now() - 60000)) return res.status(400).json({ error: 'Pick a start time in the future' });
    if (d.ends_at && new Date(d.ends_at) <= new Date(d.starts_at)) return res.status(400).json({ error: 'The end time must be after the start' });
    const { rows: [e] } = await q('INSERT INTO events (creator_id, title, description, starts_at, ends_at, location, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.user.id, d.title, d.description, d.starts_at, d.ends_at || null, d.location, d.visibility]);
    await q("INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,'going')", [e.id, req.user.id]);
    res.status(201).json((await q(`${EVENT_SELECT} WHERE e.id = $2`, [req.user.id, e.id])).rows[0]);
  });
  api.get('/events/:id', requireAuth, flag('events'), async (req, res) => {
    const { rows: [e] } = await q(`${EVENT_SELECT} WHERE e.id = $2 AND ${EVENT_VISIBLE}`, [req.user.id, id(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const { rows: guests } = await q("SELECT u.id, u.username, u.full_name, u.avatar_path FROM event_rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id = $1 AND r.status = 'going' ORDER BY r.updated_at LIMIT 12", [e.id]);
    res.json({ ...e, guests });
  });
  api.put('/events/:id/rsvp', requireAuth, flag('events'), async (req, res) => {
    const { status } = z.object({ status: z.enum(['going', 'interested', 'not_going']) }).strict().parse(req.body);
    const { rows: [e] } = await q(`SELECT e.id, e.creator_id FROM events e JOIN users u ON u.id = e.creator_id WHERE e.id = $2 AND e.cancelled_at IS NULL AND ${EVENT_VISIBLE}`, [req.user.id, id(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    await q('INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,$3) ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()', [e.id, req.user.id, status]);
    if (status === 'going') notify(e.creator_id, req.user.id, 'event_going');
    res.json((await q(`${EVENT_SELECT} WHERE e.id = $2`, [req.user.id, e.id])).rows[0]);
  });
  api.post('/events/:id/cancel', requireAuth, flag('events'), async (req, res) => {
    const { rowCount } = await q('UPDATE events SET cancelled_at = now() WHERE id = $1 AND creator_id = $2 AND cancelled_at IS NULL', [id(req.params.id), req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Event not found' }); res.json({ ok: true });
  });

  // ===== close friends =====
  api.get('/me/close-friends', requireAuth, flag('closeFriends'), async (req, res) => {
    const { rows } = await q('SELECT u.id, u.username, u.full_name, u.avatar_path FROM close_friends c JOIN users u ON u.id = c.friend_id WHERE c.user_id = $1 ORDER BY u.full_name', [req.user.id]);
    res.json({ items: rows });
  });
  api.put('/me/close-friends/:username', requireAuth, flag('closeFriends'), async (req, res) => {
    const { rows: [u] } = await q('SELECT id FROM users WHERE lower(username) = lower($1) AND id <> $2', [req.params.username, req.user.id]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    await q('INSERT INTO close_friends (user_id, friend_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, u.id]); res.json({ ok: true });
  });
  api.delete('/me/close-friends/:username', requireAuth, flag('closeFriends'), async (req, res) => {
    await q('DELETE FROM close_friends WHERE user_id = $1 AND friend_id = (SELECT id FROM users WHERE lower(username) = lower($2))', [req.user.id, req.params.username]); res.json({ ok: true });
  });

  // ===== two-step login =====
  api.get('/me/two-step', requireAuth, flag('twoStep'), async (req, res) => {
    const { rows: [u] } = await q('SELECT totp_enabled_at, two_step_email, email FROM users WHERE id = $1', [req.user.id]);
    const { rows: devices } = await q('SELECT label, first_seen, last_seen FROM known_devices WHERE user_id = $1 ORDER BY last_seen DESC LIMIT 20', [req.user.id]);
    res.json({ totp: !!u.totp_enabled_at, email: u.two_step_email, has_email: !!u.email, login_alerts: config.features.loginAlerts, devices });
  });
  api.post('/me/two-step/totp/setup', requireAuth, flag('twoStep'), async (req, res) => {
    const { rows: [u] } = await q('SELECT totp_enabled_at, username FROM users WHERE id = $1', [req.user.id]);
    if (u.totp_enabled_at) return res.status(400).json({ error: 'Authenticator app is already on' });
    const secret = newSecret(); await q('UPDATE users SET totp_secret = $2 WHERE id = $1', [req.user.id, secret]);
    const uri = `otpauth://totp/Connectly:${encodeURIComponent(u.username)}?secret=${secret}&issuer=Connectly&digits=6&period=30`;
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) });
  });
  api.post('/me/two-step/totp/enable', requireAuth, flag('twoStep'), async (req, res) => {
    const { code } = z.object({ code: z.string().max(10) }).strict().parse(req.body);
    const { rows: [u] } = await q('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
    if (!u.totp_secret || !verifyTotp(u.totp_secret, code)) return res.status(400).json({ error: 'That code is not correct' });
    await q('UPDATE users SET totp_enabled_at = now() WHERE id = $1', [req.user.id]); res.json({ ok: true });
  });
  api.post('/me/two-step/totp/disable', requireAuth, flag('twoStep'), async (req, res) => {
    const { password } = z.object({ password: z.string().max(200) }).strict().parse(req.body);
    if (!(await checkPassword(req.user.id, password))) return res.status(400).json({ error: 'Wrong password' });
    await q('UPDATE users SET totp_enabled_at = NULL, totp_secret = NULL WHERE id = $1', [req.user.id]); res.json({ ok: true });
  });
  api.put('/me/two-step/email', requireAuth, flag('twoStep'), async (req, res) => {
    const { enabled, password } = z.object({ enabled: z.boolean(), password: z.string().max(200).optional() }).strict().parse(req.body);
    if (!enabled && !(await checkPassword(req.user.id, password || ''))) return res.status(400).json({ error: 'Wrong password' });
    const { rows: [u] } = await q('SELECT email FROM users WHERE id = $1', [req.user.id]);
    if (enabled && !u.email) return res.status(400).json({ error: 'Add an email address first' });
    await q('UPDATE users SET two_step_email = $2 WHERE id = $1', [req.user.id, enabled]); res.json({ ok: true });
  });
  api.post('/auth/login/two-step', codeLimiter, async (req, res) => {
    const d = z.object({ ticket: z.string().max(100), method: z.enum(['totp', 'email']), code: z.string().max(10) }).strict().parse(req.body);
    const { rows: [c] } = await q('SELECT user_id, attempts, email_code_hash FROM login_challenges WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha256(d.ticket)]);
    if (!c) return res.status(400).json({ error: 'This login has expired. Log in again.' });
    if (c.attempts >= 6) return res.status(429).json({ error: 'Too many wrong codes. Log in again.' });
    const tw = await twoStepMethods(c.user_id);
    if (!tw || !tw.methods.includes(d.method)) return res.status(400).json({ error: 'Choose another way to confirm' });
    let ok = false;
    if (d.method === 'totp') { const { rows: [u] } = await q('SELECT totp_secret FROM users WHERE id = $1', [c.user_id]); ok = verifyTotp(u.totp_secret, d.code); }
    else { const want = codeHash(d.ticket, d.code.trim()); ok = !!c.email_code_hash && crypto.timingSafeEqual(Buffer.from(c.email_code_hash), Buffer.from(want)); }
    if (!ok) { await q('UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = $1', [sha256(d.ticket)]); return res.status(400).json({ error: 'That code is not correct' }); }
    await q('UPDATE login_challenges SET used_at = now() WHERE token_hash = $1', [sha256(d.ticket)]);
    await createSession(res, c.user_id, req.get('user-agent'), req, 'two_step');
    await loginAlert(c.user_id, req.get('user-agent'));
    res.json({ ok: true });
  });
  api.post('/auth/login/two-step/resend', codeLimiter, async (req, res) => {
    const { ticket } = z.object({ ticket: z.string().max(100) }).strict().parse(req.body);
    const { rows: [c] } = await q("SELECT user_id, email_sent_at > now() - interval '60 seconds' AS recent FROM login_challenges WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()", [sha256(ticket)]);
    const tw = c && await twoStepMethods(c.user_id);
    if (!tw?.methods.includes('email')) return res.status(400).json({ error: 'This login has expired. Log in again.' });
    if (c.recent) return res.status(429).json({ error: 'We just sent a code. Check your email, or try again in a minute.' });
    await sendLoginCode(ticket, tw.email);
    res.json({ ok: true });
  });
}

// Event reminders: one hour before start, notify everyone going/interested (in-app, push and email). Runs every 5 min.
export async function sendEventReminders(notify) {
  if (!config.features.events) return 0;
  const { rows } = await q("UPDATE events SET reminded_at = now() WHERE reminded_at IS NULL AND cancelled_at IS NULL AND starts_at BETWEEN now() AND now() + interval '1 hour' RETURNING id, title, creator_id, starts_at");
  for (const e of rows) {
    const { rows: rs } = await q("SELECT r.user_id, u.email, u.email_notifications FROM event_rsvps r JOIN users u ON u.id = r.user_id WHERE r.event_id = $1 AND r.status IN ('going','interested')", [e.id]);
    for (const r of rs) {
      if (r.user_id !== e.creator_id) await notify(r.user_id, e.creator_id, 'event_reminder');
      pushTo(r.user_id, { title: 'Starting soon', body: `${e.title} starts within the hour.`, url: `/events/${e.id}`, tag: `event-${e.id}` });
      if (r.email && r.email_notifications) sendMail({ to: r.email, subject: `Reminder: ${e.title}`, text: `${e.title} starts soon (${new Date(e.starts_at).toUTCString()}).\n\nSee the event: ${config.appUrl}/events/${e.id}\n\nYou can turn off email notifications in Privacy and settings > Notifications.` }).catch(() => {});
    }
  }
  return rows.length;
}
// Publishes scheduled posts' hashtags / notifications lazily: scheduled posts become visible through the VISIBLE clause automatically.
