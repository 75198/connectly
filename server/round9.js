// Round 9: privacy and safety (migration 017). Every default keeps existing users exactly as visible as before.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { memberOf, postMessage, hiddenWordsOf, matchesHidden } from './messages.js';
import { notify } from './social.js';

const F = config.features;
const flag = (k) => (_req, res, next) => (F[k] ? next() : res.status(404).json({ error: 'Not found' }));
const WHO = z.enum(['everyone', 'following', 'none']);
export const TEEN_SQL = "u.birth_date IS NOT NULL AND u.birth_date > (now() - interval '18 years')::date";

// "Who can" check: target allows actor? (everyone | people the target follows | no one). Targets can always act on their own content.
export async function allowedBy(targetId, actorId, column) {
  if (!F.whoCan || targetId === actorId) return true;
  const { rows: [u] } = await q(`SELECT ${column} AS v, EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS follows FROM users WHERE id = $1`, [targetId, actorId]);
  if (!u) return false;
  return u.v === 'everyone' || (u.v === 'following' && u.follows);
}
// @mentions in posts ("tag") and comments ("mention") notify only people whose setting allows it.
export async function notifyMentions(text, actorId, kind, extra) {
  const names = [...new Set((String(text || '').match(/(^|[^\w@])@([a-zA-Z0-9_.]{2,30})/g) || []).map((m) => m.replace(/^[^@]*@/, '').toLowerCase()))].slice(0, 10);
  if (!names.length) return;
  const { rows } = await q('SELECT id FROM users WHERE lower(username) = ANY($1) AND deactivated_at IS NULL', [names]);
  for (const u of rows) if (await allowedBy(u.id, actorId, kind === 'tag' ? 'who_can_tag' : 'who_can_mention')) await notify(u.id, actorId, 'mention', extra);
}
export async function isRestricted(ownerId, actorId) { if (!F.restrictMute) return false; return (await q('SELECT 1 FROM restricts WHERE user_id = $1 AND target_id = $2', [ownerId, actorId])).rowCount > 0; }

// ---- tiny ZIP writer (stored + deflate), no dependencies ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function zip(files) {
  const parts = []; const central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name); const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data); const crc = crc32(raw);
    const comp = /\.(jpe?g|png|webp|gif|mp4|webm|m4a|mov)$/i.test(f.name) ? raw : zlib.deflateRawSync(raw); const method = comp === raw ? 0 : 8;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

export function registerRound9(api, { requireAuth, requireVerified, id, pagePosts, getVisiblePost }) {
  // ---- privacy settings ----
  const PRIV = 'is_private, dm_privacy, who_can_comment, who_can_tag, who_can_mention, hide_presence, hide_follow_lists, hidden_words, hidden_words_on, discover_by_email, discover_by_phone, allow_downloads, read_receipts, (birth_date IS NOT NULL AND birth_date > (now() - interval \'18 years\')::date) AS is_teen';
  api.get('/me/privacy', requireAuth, async (req, res) => { const { rows: [u] } = await q(`SELECT ${PRIV}, (SELECT count(*)::int FROM follow_requests WHERE target_id = $1) AS pending_requests FROM users WHERE id = $1`, [req.user.id]); res.json(u); });
  api.patch('/me/privacy', requireAuth, async (req, res) => {
    const d = z.object({ is_private: z.boolean().optional(), dm_privacy: z.enum(['everyone', 'following', 'off']).optional(), who_can_comment: WHO.optional(), who_can_tag: WHO.optional(), who_can_mention: WHO.optional(),
      hide_presence: z.boolean().optional(), hide_follow_lists: z.boolean().optional(), hidden_words: z.array(z.string().trim().min(1).max(40)).max(200).optional(), hidden_words_on: z.boolean().optional(),
      discover_by_email: z.boolean().optional(), discover_by_phone: z.boolean().optional(), allow_downloads: z.boolean().optional(), read_receipts: z.boolean().optional() }).strict().parse(req.body);
    const gate = { read_receipts: 'msgControls', allow_downloads: 'downloads', is_private: 'privateAccounts', who_can_comment: 'whoCan', who_can_tag: 'whoCan', who_can_mention: 'whoCan', hide_presence: 'hidePresence', hide_follow_lists: 'hideLists', hidden_words: 'hiddenWords', hidden_words_on: 'hiddenWords', discover_by_email: 'discoverability', discover_by_phone: 'discoverability' };
    const sets = []; const vals = [req.user.id];
    for (const [k, v] of Object.entries(d)) { if (gate[k] && !F[gate[k]]) continue; vals.push(k === 'hidden_words' ? [...new Set(v.map((w) => w.toLowerCase()))] : v); sets.push(`${k} = $${vals.length}`); }
    if (sets.length) await q(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, vals);
    // Switching to public approves everyone who was waiting (like Instagram).
    if (d.is_private === false && F.privateAccounts) {
      const { rows } = await q('DELETE FROM follow_requests WHERE target_id = $1 RETURNING requester_id', [req.user.id]);
      for (const r of rows) await q('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r.requester_id, req.user.id]);
    }
    const { rows: [u] } = await q(`SELECT ${PRIV} FROM users WHERE id = $1`, [req.user.id]); res.json(u);
  });

  // ---- follow requests ----
  api.get('/me/follow-requests', requireAuth, flag('privateAccounts'), async (req, res) => {
    const { rows } = await q(`SELECT u.id, u.username, u.full_name, u.avatar_path, fr.created_at FROM follow_requests fr JOIN users u ON u.id = fr.requester_id AND u.deactivated_at IS NULL WHERE fr.target_id = $1 ORDER BY fr.created_at DESC LIMIT 500`, [req.user.id]);
    res.json({ items: rows });
  });
  api.post('/me/follow-requests/:uid', requireAuth, flag('privateAccounts'), async (req, res) => {
    const { action } = z.object({ action: z.enum(['approve', 'decline']) }).strict().parse(req.body); const uid = id(req.params.uid);
    const r = await q('DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2', [uid, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Request not found' });
    if (action === 'approve') { await q('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, req.user.id]); await notify(uid, req.user.id, 'follow_accept'); }
    res.json({ ok: true });
  });

  // ---- presence ----
  api.get('/users/:username/presence', requireAuth, async (req, res) => {
    const { rows: [u] } = await q(`SELECT u.id, u.hide_presence, (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS seen FROM users u WHERE lower(u.username) = lower($1) AND u.deactivated_at IS NULL`, [req.params.username]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    // Reciprocal, like Instagram: if either side hides activity status, neither sees the other's.
    const { rows: [me] } = await q('SELECT hide_presence FROM users WHERE id = $1', [req.user.id]);
    const blocked = (await q('SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [req.user.id, u.id])).rowCount;
    if (u.id !== req.user.id && (blocked || (F.hidePresence && (u.hide_presence || me.hide_presence)) || await isRestricted(u.id, req.user.id))) return res.json({ hidden: true });
    const online = u.seen && Date.now() - new Date(u.seen).getTime() < 6 * 60e3;
    res.json({ online: !!online, last_seen: online ? null : u.seen });
  });

  // ---- restrict + mute ----
  for (const [table, f] of [['restricts', 'restrictMute'], ['mutes', 'restrictMute']]) {
    api.put(`/users/:username/${table === 'restricts' ? 'restrict' : 'mute'}`, requireAuth, flag(f), async (req, res) => {
      const { rows: [u] } = await q('SELECT id FROM users WHERE lower(username) = lower($1)', [req.params.username]); if (!u || u.id === req.user.id) return res.status(404).json({ error: 'User not found' });
      if (table === 'mutes') { const d = z.object({ posts: z.boolean().default(true), stories: z.boolean().default(true) }).strict().parse(req.body || {}); await q('INSERT INTO mutes (user_id, target_id, posts, stories) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, target_id) DO UPDATE SET posts = $3, stories = $4', [req.user.id, u.id, d.posts, d.stories]); }
      else await q('INSERT INTO restricts (user_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, u.id]);
      res.json({ ok: true });
    });
    api.delete(`/users/:username/${table === 'restricts' ? 'restrict' : 'mute'}`, requireAuth, flag(f), async (req, res) => {
      await q(`DELETE FROM ${table} WHERE user_id = $1 AND target_id = (SELECT id FROM users WHERE lower(username) = lower($2))`, [req.user.id, req.params.username]); res.json({ ok: true });
    });
    api.get(`/me/${table === 'restricts' ? 'restricted' : 'muted'}`, requireAuth, flag(f), async (req, res) => {
      const { rows } = await q(`SELECT u.id, u.username, u.full_name, u.avatar_path FROM ${table} t JOIN users u ON u.id = t.target_id WHERE t.user_id = $1 ORDER BY t.created_at DESC`, [req.user.id]); res.json({ items: rows });
    });
  }
  api.get('/users/:username/relationship', requireAuth, async (req, res) => {
    const { rows: [r] } = await q(`SELECT EXISTS (SELECT 1 FROM restricts WHERE user_id = $1 AND target_id = u.id) AS restricted, EXISTS (SELECT 1 FROM mutes WHERE user_id = $1 AND target_id = u.id) AS muted,
      EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = $1 AND target_id = u.id) AS requested FROM users u WHERE lower(u.username) = lower($2)`, [req.user.id, req.params.username]);
    res.json(r || {});
  });

  // ---- saved collections ----
  api.get('/collections', requireAuth, flag('collections'), async (req, res) => {
    const { rows } = await q(`SELECT c.id, c.name, (SELECT count(*)::int FROM collection_items i WHERE i.collection_id = c.id) AS count,
      (SELECT p.image_path FROM collection_items i JOIN posts p ON p.id = i.post_id WHERE i.collection_id = c.id AND p.image_path IS NOT NULL ORDER BY i.created_at DESC LIMIT 1) AS cover
      FROM collections c WHERE c.user_id = $1 ORDER BY c.created_at`, [req.user.id]);
    res.json({ items: rows });
  });
  api.post('/collections', requireAuth, flag('collections'), async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1, 'Give it a name').max(60) }).strict().parse(req.body);
    const { rows: [c] } = await q('INSERT INTO collections (user_id, name) VALUES ($1, $2) RETURNING id, name', [req.user.id, name]); res.status(201).json({ ...c, count: 0 });
  });
  const ownColl = async (uid, cid) => { const { rows: [c] } = await q('SELECT id, name FROM collections WHERE id = $1 AND user_id = $2', [cid, uid]); if (!c) { const e = new Error('Collection not found'); e.status = 404; throw e; } return c; };
  api.patch('/collections/:id', requireAuth, flag('collections'), async (req, res) => { const c = await ownColl(req.user.id, id(req.params.id)); const { name } = z.object({ name: z.string().trim().min(1).max(60) }).strict().parse(req.body); await q('UPDATE collections SET name = $2 WHERE id = $1', [c.id, name]); res.json({ ok: true }); });
  api.delete('/collections/:id', requireAuth, flag('collections'), async (req, res) => { const c = await ownColl(req.user.id, id(req.params.id)); await q('DELETE FROM collections WHERE id = $1', [c.id]); res.json({ ok: true }); });
  api.put('/collections/:id/posts/:pid', requireAuth, flag('collections'), async (req, res) => {
    const c = await ownColl(req.user.id, id(req.params.id)); const p = await getVisiblePost(req.user.id, id(req.params.pid)); if (!p) return res.status(404).json({ error: 'Post not found' });
    await q('INSERT INTO collection_items (collection_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [c.id, p.id]);
    await q('INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, p.id]).catch(() => {}); // also keep it in Saved
    res.json({ ok: true });
  });
  api.delete('/collections/:id/posts/:pid', requireAuth, flag('collections'), async (req, res) => { const c = await ownColl(req.user.id, id(req.params.id)); await q('DELETE FROM collection_items WHERE collection_id = $1 AND post_id = $2', [c.id, id(req.params.pid)]); res.json({ ok: true }); });
  api.get('/collections/:id/posts', requireAuth, flag('collections'), async (req, res) => {
    const c = await ownColl(req.user.id, id(req.params.id));
    res.json({ collection: c, ...(await pagePosts(req.user.id, 'EXISTS (SELECT 1 FROM collection_items ci WHERE ci.post_id = p.id AND ci.collection_id = $2)', [c.id], req.query.cursor, req.query.limit)) });
  });

  // ---- disappearing messages + screenshot notice ----
  api.put('/conversations/:id/disappear', requireAuth, flag('disappearing'), async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const { seconds } = z.object({ seconds: z.union([z.literal(null), z.literal(3600), z.literal(86400), z.literal(604800)]) }).strict().parse(req.body);
    await q('UPDATE conversations SET disappear_seconds = $2 WHERE id = $1', [c.id, seconds]);
    const label = { 3600: '1 hour', 86400: '24 hours', 604800: '7 days' }[seconds];
    const m = await postMessage({ ...c, disappear_seconds: null }, req.user.id, { kind: 'notice', body: seconds ? `turned on disappearing messages (${label})` : 'turned off disappearing messages', meta: { notice: 'disappear', seconds } });
    res.json({ disappear_seconds: seconds, message_id: m?.id });
  });
  api.post('/conversations/:id/screenshot', requireAuth, flag('disappearing'), async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const recent = await q("SELECT 1 FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND kind = 'notice' AND meta->>'notice' = 'screenshot' AND created_at > now() - interval '30 seconds'", [c.id, req.user.id]);
    if (!recent.rowCount) await postMessage(c, req.user.id, { kind: 'notice', body: 'may have taken a screenshot', meta: { notice: 'screenshot' } });
    res.json({ ok: true });
  });

  // ---- download your data (ZIP) ----
  api.get('/me/export.zip', requireAuth, flag('dataExport'), async (req, res) => {
    const uid = req.user.id;
    const one = async (sql) => (await q(sql, [uid])).rows;
    const [profile] = await one(`SELECT id, username, full_name, email, phone, bio, location, birth_date, created_at, avatar_path, cover_path, locale, is_private, dm_privacy, who_can_comment, who_can_tag, who_can_mention, hide_presence, hide_follow_lists, hidden_words, discover_by_email, discover_by_phone FROM users WHERE id = $1`);
    const posts = await one('SELECT id, body, image_path, video_path, visibility, close_friends_only, created_at, updated_at, deleted_at FROM posts WHERE author_id = $1 ORDER BY id');
    const data = {
      'profile.json': profile, 'posts.json': posts,
      'comments.json': await one('SELECT id, post_id, body, created_at FROM comments WHERE author_id = $1 ORDER BY id'),
      'likes.json': await one('SELECT post_id, reaction, created_at FROM post_likes WHERE user_id = $1 ORDER BY created_at').catch(() => []),
      'followers.json': await one('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = $1'),
      'following.json': await one('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = $1'),
      'stories.json': await one('SELECT id, image_path, caption, created_at FROM stories WHERE author_id = $1 ORDER BY id'),
      'messages.json': await one("SELECT m.conversation_id, m.kind, m.body, m.media_path, m.created_at FROM messages m WHERE m.sender_id = $1 AND m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > now()) ORDER BY m.id"),
      'connectly_ai.json': await one('SELECT c.title, m.role, m.content, m.attachment_path, m.created_at FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id WHERE c.user_id = $1 ORDER BY m.id'),
      'search_history.json': await one('SELECT term, created_at FROM search_history WHERE user_id = $1 ORDER BY created_at DESC'),
      'saved_collections.json': await one('SELECT c.name, i.post_id, i.created_at FROM collections c JOIN collection_items i ON i.collection_id = c.id WHERE c.user_id = $1'),
      'login_devices.json': await one('SELECT created_at, last_seen_at, user_agent FROM sessions WHERE user_id = $1 ORDER BY created_at DESC').catch(() => []),
    };
    const files = [{ name: 'README.txt', data: `Your Connectly data for @${profile.username}, exported ${new Date().toISOString()}.\nJSON files hold your account, posts, comments, messages you sent, and more. The media folder has your photos and videos.\n` }];
    for (const [n, v] of Object.entries(data)) files.push({ name: n, data: JSON.stringify(v, null, 2) });
    const media = new Set(); for (const p of [...posts, ...data['stories.json'], ...data['messages.json'], profile]) for (const k of ['image_path', 'video_path', 'media_path', 'avatar_path', 'cover_path']) if (p[k]) media.add(p[k]);
    let total = 0;
    for (const m of media) {
      if (!String(m).startsWith('/uploads/')) continue; const abs = path.join(config.uploadDir, String(m).slice('/uploads/'.length)); if (!abs.startsWith(config.uploadDir)) continue;
      try { const b = fs.readFileSync(abs); total += b.length; if (total > 400 * 1024 * 1024) break; files.push({ name: 'media/' + path.basename(abs), data: b }); } catch { /* missing file */ }
    }
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="connectly-${profile.username}-data.zip"`, 'Cache-Control': 'no-store' }).send(zip(files));
  });
}

// Expire disappearing messages (only messages sent while the timer was on).
export async function sweepDisappearing() {
  await q("UPDATE messages SET deleted_at = now(), body = '', media_path = NULL, poster_path = NULL WHERE expires_at IS NOT NULL AND expires_at <= now() AND deleted_at IS NULL");
}
