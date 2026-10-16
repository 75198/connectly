// Direct messages (round 7, FEATURE_MESSAGES): 1:1 and group chats, photos/videos (standard or HD), voice notes,
// read receipts, typing, chat themes/wallpapers, LiveKit calls (FEATURE_CALLS). No daily caps: only a per-minute burst limit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { HttpError } from './uploads.js';
import { pushTo } from './push.js';
import { mintToken, liveConfigured } from './live.js';

export const CHAT_THEMES = ['default', 'ocean', 'sunset', 'forest', 'lavender', 'midnight', 'rose', 'mono'];
const tmpDir = path.join(os.tmpdir(), 'cx-chat');
const IMG = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
const VID = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp']);
const AUD = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'video/webm']);
const media = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => { fs.mkdirSync(tmpDir, { recursive: true }); cb(null, tmpDir); }, filename: (_r, _f, cb) => cb(null, crypto.randomBytes(12).toString('hex')) }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => (IMG.has(f.mimetype) || VID.has(f.mimetype) || AUD.has(f.mimetype) ? cb(null, true) : cb(new HttpError(400, 'This file type isn’t supported'))),
});
const run = (bin, args, ms = 300000) => new Promise((ok, no) => execFile(bin, args, { timeout: ms, maxBuffer: 8 << 20 }, (e, out) => (e ? no(e) : ok(out))));
const outPath = (ext) => { const dir = path.join(config.uploadDir, 'chat'); fs.mkdirSync(dir, { recursive: true }); const n = crypto.randomBytes(16).toString('hex') + ext; return [path.join(dir, n), `/uploads/chat/${n}`]; };

// Standard: up to 1600 px WebP q82. HD: original resolution up to 4096 px at q95. Metadata stripped either way.
export async function saveChatImage(buf, hd) {
  let out;
  try {
    const m = await sharp(buf).metadata(); if (!m.width || m.width * m.height > 60e6) throw new Error('dims');
    const max = hd ? 4096 : 1600;
    out = await sharp(buf, { animated: false }).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).toColourspace('srgb').webp({ quality: hd ? 95 : 82, effort: 4 }).toBuffer();
  } catch { throw new HttpError(400, 'File is not a valid image'); }
  const [file, pub] = outPath('.webp'); fs.writeFileSync(file, out); return pub;
}
async function saveChatVideo(src, hd) {
  const [file, pub] = outPath('.mp4'); const [pfile, ppub] = outPath('.webp');
  let info; try { info = JSON.parse(await run(config.ffprobePath, ['-v', 'error', '-show_entries', 'format=format_name:stream=codec_type,codec_name,pix_fmt', '-of', 'json', src], 30000)); } catch { throw new HttpError(400, 'That video couldn’t be read'); }
  const v = info.streams?.find((s) => s.codec_type === 'video'); if (!v) throw new HttpError(400, 'That video couldn’t be read');
  const a = info.streams?.find((s) => s.codec_type === 'audio');
  const safe = v.codec_name === 'h264' && (!v.pix_fmt || v.pix_fmt === 'yuv420p') && (!a || a.codec_name === 'aac') && /mp4|mov/.test(info.format?.format_name || '');
  if (hd && safe) await run(config.ffmpegPath, ['-y', '-i', src, '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', file]);
  else await run(config.ffmpegPath, ['-y', '-i', src, '-vf', hd ? 'scale=w=min(iw\\,3840):h=-2' : "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', hd ? '18' : '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', hd ? '160k' : '96k', '-map_metadata', '-1', '-movflags', '+faststart', file]);
  try { await run(config.ffmpegPath, ['-y', '-ss', '0.3', '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', pfile.replace('.webp', '.jpg')]); fs.writeFileSync(pfile, await sharp(pfile.replace('.webp', '.jpg')).webp({ quality: 80 }).toBuffer()); fs.rmSync(pfile.replace('.webp', '.jpg'), { force: true }); return [pub, ppub]; } catch { return [pub, null]; }
}
async function saveVoice(src, mime) {
  const [file, pub] = outPath('.m4a');
  try { await run(config.ffmpegPath, ['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', '64k', '-map_metadata', '-1', '-movflags', '+faststart', file], 60000); return pub; }
  catch {
    if (config.isTest) { const [f2, p2] = outPath(mime.includes('ogg') ? '.ogg' : '.webm'); fs.copyFileSync(src, f2); return p2; }
    throw new HttpError(400, 'That voice note couldn’t be processed');
  }
}

export async function memberOf(convId, userId) {
  const { rows } = await q('SELECT c.*, m.theme AS my_theme, m.wallpaper_path AS my_wallpaper FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL WHERE c.id = $1', [convId, userId]);
  if (!rows[0]) throw new HttpError(404, 'Chat not found');
  return rows[0];
}
// Anti-scam: accounts younger than 7 days can only start a few new chats a day with people who don't follow them.
const strangerHits = new Map();
async function strangerLimit(uid, ids) {
  const { rows: [u] } = await q("SELECT created_at > now() - interval '7 days' AS young FROM users WHERE id = $1", [uid]); if (!u?.young) return false;
  const { rows: st } = await q('SELECT u.id FROM unnest($2::bigint[]) AS u(id) WHERE NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = $1) AND NOT EXISTS (SELECT 1 FROM conversations c JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1 JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = u.id)', [uid, ids]);
  if (!st.length) return false;
  const day = new Date().toISOString().slice(0, 10), k = `${uid}:${day}`, n = (strangerHits.get(k) || 0) + st.length;
  if (n > 10) return true; strangerHits.set(k, n); if (strangerHits.size > 5000) strangerHits.clear(); return false;
}
// Activity status is reciprocal: if you hide yours, you can't see others'. Also never shown for the feature off.
async function maskPresence(uid, convs) {
  const { rows: [me] } = await q('SELECT hide_presence FROM users WHERE id = $1', [uid]);
  const off = !config.features.hidePresence || !config.features.msgControls || me?.hide_presence;
  for (const c of convs) for (const m of c.members || []) if (off || m.id === uid) delete m.active_at;
}
const MEMBERS = `(SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path, 'verified', u.verified_at IS NOT NULL, 'new_account', u.created_at > now() - interval '30 days', 'last_read_id', CASE WHEN cm.accepted_at IS NOT NULL AND u.read_receipts THEN cm.last_read_id ELSE 0 END, 'active_at', CASE WHEN NOT COALESCE(u.hide_presence, false) THEN (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) END, 'accepted', cm.accepted_at IS NOT NULL,
  'typing', cm.accepted_at IS NOT NULL AND cm.typing_at > now() - interval '6 seconds') ORDER BY u.id) FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = c.id AND cm.left_at IS NULL) AS members`;
export const MSG_SELECT = `SELECT m.id, m.conversation_id, m.sender_id, m.kind, CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, CASE WHEN m.deleted_at IS NULL THEN m.media_path END AS media_path, m.poster_path, m.media_hd, m.meta, m.created_at, m.expires_at, m.edited_at, m.deleted_at IS NOT NULL AS deleted,
  (SELECT COALESCE(json_object_agg(r.user_id, r.emoji), '{}') FROM message_reactions r WHERE r.message_id = m.id) AS reactions FROM messages m`;

export async function postMessage(conv, senderId, { kind = 'text', body = '', media_path = null, poster_path = null, media_hd = false, meta = {} }) {
  const { rows: [m] } = await q(`INSERT INTO messages (conversation_id, sender_id, kind, body, media_path, poster_path, media_hd, meta, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
    (SELECT CASE WHEN ${config.features.disappearing ? 'true' : 'false'} AND c.disappear_seconds IS NOT NULL AND $3 <> 'notice' THEN now() + c.disappear_seconds * interval '1 second' END FROM conversations c WHERE c.id = $1)) RETURNING id`, [conv.id, senderId, kind, body, media_path, poster_path, media_hd, meta]);
  await q('UPDATE conversations SET last_message_at = now() WHERE id = $1', [conv.id]);
  await q('UPDATE conversation_members SET last_read_id = GREATEST(last_read_id, $2), typing_at = NULL, accepted_at = COALESCE(accepted_at, now()) WHERE conversation_id = $1 AND user_id = $3', [conv.id, m.id, senderId]);
  const { rows: [s] } = await q('SELECT full_name FROM users WHERE id = $1', [senderId]);
  const { rows: others } = await q('SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 AND left_at IS NULL', [conv.id, senderId]);
  const preview = { text: body.slice(0, 120), image: 'Sent a photo', video: 'Sent a video', voice: 'Sent a voice note', call: 'Started a call', game: 'Started a game', sticker: 'Sent a sticker' }[kind] || 'New message';
  for (const o of others) pushTo(o.user_id, { title: conv.is_group ? `${s.full_name} in ${conv.title || 'your group'}` : s.full_name, body: preview, url: `/messages/${conv.id}`, tag: `chat-${conv.id}` });
  return (await q(`${MSG_SELECT} WHERE m.id = $1`, [m.id])).rows[0];
}

export function registerMessages(api, { requireAuth, requireVerified, id }) {
  const on = (_q, res, next) => (config.features.messages ? next() : res.status(404).json({ error: 'Not found' }));
  // Anti-spam: per-minute burst only (no daily caps).
  const burst = async (req, res, next) => {
    const { rows: [r] } = await q("SELECT count(*)::int AS n FROM messages WHERE sender_id = $1 AND created_at > now() - interval '1 minute'", [req.user.id]);
    if (r.n >= (config.isTest ? (config.dmBurstPerMinute) : config.dmBurstPerMinute)) return res.status(429).json({ error: 'You’re sending messages very quickly. Wait a moment and try again.' });
    next();
  };
  const blockedWith = async (a, ids) => (await q('SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = ANY($2)) OR (blocked_id = $1 AND blocker_id = ANY($2)) LIMIT 1', [a, ids])).rowCount > 0;

  api.get('/conversations', requireAuth, on, async (req, res) => {
    const { rows } = await q(`SELECT c.id, c.is_group, c.title, c.last_message_at, ${MEMBERS},
        (SELECT row_to_json(x) FROM (SELECT lm.id, lm.sender_id, lm.kind, CASE WHEN lm.deleted_at IS NULL THEN left(lm.body, 120) ELSE '' END AS body, lm.created_at FROM messages lm WHERE lm.conversation_id = c.id ORDER BY lm.id DESC LIMIT 1) x) AS last_message,
        (SELECT count(*)::int FROM messages um WHERE um.conversation_id = c.id AND um.id > me.last_read_id AND um.sender_id <> $1) AS unread, (me.accepted_at IS NULL) AS is_request
      FROM conversations c JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1 AND me.left_at IS NULL
      WHERE EXISTS (SELECT 1 FROM messages mm WHERE mm.conversation_id = c.id) OR c.created_by = $1 ORDER BY c.last_message_at DESC LIMIT 200`, [req.user.id]);
    await maskPresence(req.user.id, rows);
    res.json({ items: rows });
  });
  api.get('/conversations/unread', requireAuth, on, async (req, res) => {
    const { rows: [r] } = await q(`SELECT count(DISTINCT c.id)::int AS n FROM conversations c JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1 AND me.left_at IS NULL
      WHERE EXISTS (SELECT 1 FROM messages um WHERE um.conversation_id = c.id AND um.id > me.last_read_id AND um.sender_id <> $1)`, [req.user.id]);
    res.json({ unread: r.n });
  });
  api.post('/conversations', requireVerified, on, async (req, res) => {
    const d = z.object({ usernames: z.array(z.string().trim().min(1).max(40)).min(1).max(255), title: z.string().trim().max(80).default('') }).strict().parse(req.body);
    const { rows: users } = await q('SELECT id FROM users WHERE lower(username) = ANY($1) AND email_verified_at IS NOT NULL AND suspended_at IS NULL AND deactivated_at IS NULL AND id <> $2', [d.usernames.map((u) => u.replace(/^@/, '').toLowerCase()), req.user.id]);
    if (!users.length) return res.status(404).json({ error: 'We couldn’t find those people' });
    const ids = users.map((u) => u.id);
    if (await blockedWith(req.user.id, ids)) return res.status(403).json({ error: 'You can’t message this person' });
    const { rows: closed } = await q(`SELECT u.id FROM users u WHERE u.id = ANY($1) AND (u.dm_privacy = 'off' OR (u.dm_privacy = 'following' AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = $2)))`, [ids, req.user.id]);
    if (closed.length) return res.status(403).json({ error: ids.length === 1 ? 'This person isn’t accepting messages' : 'Some of these people aren’t accepting messages' });
    if (config.features.teenSafety && await teenBlocked(req.user.id, ids)) return res.status(403).json({ error: ids.length === 1 ? 'This person can’t get messages from you' : 'Some of these people can’t get messages from you' });
    if (config.features.antiScam && await strangerLimit(req.user.id, ids)) return res.status(429).json({ error: 'You’ve started a lot of chats with people who don’t follow you. Try again tomorrow.' });
    if (ids.length === 1 && !d.title) {
      const key = [req.user.id, ids[0]].sort((a, b) => a - b).join(':');
      const { rows: ex } = await q('SELECT id FROM conversations WHERE direct_key = $1', [key]);
      let cid = ex[0]?.id;
      if (!cid) cid = (await q('INSERT INTO conversations (is_group, created_by, direct_key) VALUES (false, $1, $2) ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key RETURNING id', [req.user.id, key])).rows[0].id;
      await q('INSERT INTO conversation_members (conversation_id, user_id, accepted_at) VALUES ($1, $2, now()) ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL, accepted_at = COALESCE(conversation_members.accepted_at, now())', [cid, req.user.id]);
      await q(`INSERT INTO conversation_members (conversation_id, user_id, accepted_at) VALUES ($1, $2, CASE WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $3) AND NOT EXISTS (SELECT 1 FROM restricts WHERE user_id = $2 AND target_id = $3) THEN now() END) ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL`, [cid, ids[0], req.user.id]);
      return res.status(201).json({ id: cid });
    }
    const { rows: [c] } = await q('INSERT INTO conversations (is_group, title, created_by) VALUES (true, $1, $2) RETURNING id', [d.title, req.user.id]);
    await q("INSERT INTO conversation_members (conversation_id, user_id, role, accepted_at) VALUES ($1, $2, 'admin', now())", [c.id, req.user.id]);
    await q('INSERT INTO conversation_members (conversation_id, user_id, accepted_at) SELECT $1, x, CASE WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = x AND followee_id = $3) AND NOT EXISTS (SELECT 1 FROM restricts WHERE user_id = x AND target_id = $3) THEN now() END FROM unnest($2::bigint[]) x', [c.id, ids, req.user.id]);
    res.status(201).json({ id: c.id });
  });
  api.get('/conversations/:id', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const { rows: [full] } = await q(`SELECT c.id, c.is_group, c.title, c.created_by, ${MEMBERS} FROM conversations c WHERE c.id = $1`, [c.id]);
    await maskPresence(req.user.id, [full]);
    const { rows: [pref] } = await q('SELECT theme, wallpaper_path FROM chat_prefs WHERE user_id = $1', [req.user.id]);
    res.json({ ...full, theme: c.my_theme || pref?.theme || 'default', wallpaper_path: c.my_wallpaper || pref?.wallpaper_path || null, chat_theme: { theme: c.my_theme, wallpaper_path: c.my_wallpaper }, all_chats_theme: pref || null, me: req.user.id });
  });
  api.patch('/conversations/:id', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    if (!c.is_group) return res.status(400).json({ error: 'Only group chats have a name' });
    const d = z.object({ title: z.string().trim().max(80).optional(), add: z.array(z.string().max(40)).max(255).optional() }).strict().parse(req.body);
    if (d.title !== undefined) await q('UPDATE conversations SET title = $2 WHERE id = $1', [c.id, d.title]);
    if (d.add?.length) {
      const { rows } = await q('SELECT id FROM users WHERE lower(username) = ANY($1) AND email_verified_at IS NOT NULL AND suspended_at IS NULL', [d.add.map((u) => u.replace(/^@/, '').toLowerCase())]);
      if (rows.length && await blockedWith(req.user.id, rows.map((r) => r.id))) return res.status(403).json({ error: 'You can’t add this person' });
      await q('INSERT INTO conversation_members (conversation_id, user_id, accepted_at) SELECT $1, x, CASE WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = x AND followee_id = $3) AND NOT EXISTS (SELECT 1 FROM restricts WHERE user_id = x AND target_id = $3) THEN now() END FROM unnest($2::bigint[]) x ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL', [c.id, rows.map((r) => r.id), req.user.id]);
    }
    res.json({ ok: true });
  });
  api.post('/conversations/:id/request', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const { action } = z.object({ action: z.enum(['accept', 'delete', 'block']) }).strict().parse(req.body);
    if (action === 'accept') await q('UPDATE conversation_members SET accepted_at = COALESCE(accepted_at, now()) WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id]);
    else {
      if (action === 'block') {
        const { rows: [s] } = await q('SELECT created_by FROM conversations WHERE id = $1', [c.id]);
        const target = c.is_group ? s.created_by : (await q('SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2 LIMIT 1', [c.id, req.user.id])).rows[0]?.user_id;
        if (target && target !== req.user.id) await q('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, target]);
      }
      await q('UPDATE conversation_members SET left_at = now() WHERE conversation_id = $1 AND user_id = $2 AND accepted_at IS NULL', [c.id, req.user.id]);
    }
    res.json({ ok: true });
  });
  api.get('/me/dm-privacy', requireAuth, async (req, res) => res.json({ dm_privacy: (await q('SELECT dm_privacy FROM users WHERE id = $1', [req.user.id])).rows[0].dm_privacy }));
  api.put('/me/dm-privacy', requireAuth, async (req, res) => {
    const { dm_privacy } = z.object({ dm_privacy: z.enum(['everyone', 'following', 'off']) }).strict().parse(req.body);
    await q('UPDATE users SET dm_privacy = $2 WHERE id = $1', [req.user.id, dm_privacy]); res.json({ dm_privacy });
  });
  api.post('/conversations/:id/leave', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    if (!c.is_group) return res.status(400).json({ error: 'You can’t leave a one-to-one chat' });
    await q('UPDATE conversation_members SET left_at = now() WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id]); res.json({ ok: true });
  });
  api.get('/conversations/:id/messages', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const after = Number(req.query.after) || 0, before = Number(req.query.before) || 0;
    const { rows } = after
      ? await q(`${MSG_SELECT} WHERE m.conversation_id = $1 AND m.id > $2 AND (m.expires_at IS NULL OR m.expires_at > now()) AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $3) ORDER BY m.id ASC LIMIT 200`, [c.id, after, req.user.id])
      : await q(`SELECT * FROM (${MSG_SELECT} WHERE m.conversation_id = $1 AND (m.expires_at IS NULL OR m.expires_at > now()) AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = $3) ${before ? 'AND m.id < $2' : 'AND $2::bigint = 0'} ORDER BY m.id DESC LIMIT 50) x ORDER BY id ASC`, [c.id, before, req.user.id]);
    const { rows: st0 } = await q("SELECT cm.user_id, cm.last_read_id, cm.accepted_at IS NOT NULL AS accepted, cm.typing_at > now() - interval '6 seconds' AS typing, u.read_receipts FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = $1 AND cm.left_at IS NULL", [c.id]);
    // Read receipts are reciprocal: turn yours off and you can't see others' either.
    const myRR = st0.find((s) => s.user_id === req.user.id)?.read_receipts !== false;
    const st = config.features.msgControls ? st0.filter((s) => s.user_id === req.user.id || (myRR && s.read_receipts !== false)) : st0;
    if (config.features.hiddenWords) await filterHidden(req.user.id, rows);
    res.json({ items: rows, disappear_seconds: c.disappear_seconds ?? null, reads: Object.fromEntries(st.filter((s) => s.accepted || s.user_id === req.user.id).map((s) => [s.user_id, s.last_read_id])), is_request: !st.find((s) => s.user_id === req.user.id)?.accepted, typing: st.filter((s) => s.typing && s.accepted && s.user_id !== req.user.id).map((s) => s.user_id) });
  });
  api.post('/conversations/:id/messages', requireVerified, on, burst, media.single('file'), async (req, res) => {
    const f = req.file;
    try {
      const c = await memberOf(id(req.params.id), req.user.id);
      if (!c.is_group) { const { rows } = await q('SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [c.id, req.user.id]); if (rows.length && await blockedWith(req.user.id, rows.map((r) => r.user_id))) return res.status(403).json({ error: 'You can’t message this person' }); }
      const d = z.object({ body: z.string().trim().max(5000).default(''), hd: z.enum(['0', '1']).default('0'), voice: z.enum(['0', '1']).default('0'), sticker: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(), duration: z.coerce.number().min(0).max(3600).optional() }).strict().parse({ body: req.body?.body || undefined, hd: req.body?.hd || undefined, voice: req.body?.voice || undefined, sticker: req.body?.sticker || undefined, duration: req.body?.duration || undefined });
      if (d.sticker) { if (!config.features.stickers) return res.status(404).json({ error: 'Not found' }); return res.status(201).json(await postMessage(c, req.user.id, { kind: 'sticker', meta: { sticker: d.sticker } })); }
      if (!f) { if (!d.body) return res.status(400).json({ error: 'Write a message' }); return res.status(201).json(await postMessage(c, req.user.id, { body: d.body })); }
      const hd = d.hd === '1';
      if (d.voice === '1' || (AUD.has(f.mimetype) && f.mimetype !== 'video/webm')) {
        if (f.size > 20 * 1024 * 1024) return res.status(413).json({ error: 'That voice note is too long' });
        return res.status(201).json(await postMessage(c, req.user.id, { kind: 'voice', media_path: await saveVoice(f.path, f.mimetype), meta: { duration: d.duration || 0 } }));
      }
      if (IMG.has(f.mimetype)) return res.status(201).json(await postMessage(c, req.user.id, { kind: 'image', body: d.body, media_path: await saveChatImage(fs.readFileSync(f.path), hd), media_hd: hd }));
      const [vp, poster] = await saveChatVideo(f.path, hd).catch((e) => { throw e instanceof HttpError ? e : new HttpError(503, 'Video sending isn’t available right now'); });
      return res.status(201).json(await postMessage(c, req.user.id, { kind: 'video', body: d.body, media_path: vp, poster_path: poster, media_hd: hd }));
    } finally { if (f) fs.rm(f.path, { force: true }, () => {}); }
  });
  api.delete('/messages/:id', requireAuth, on, async (req, res) => {
    const { rowCount } = await q('UPDATE messages SET deleted_at = now() WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL', [id(req.params.id), req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Message not found' }); res.json({ ok: true });
  });
  // Delete for me only (others still see it).
  api.post('/messages/:id/hide', requireAuth, on, async (req, res) => {
    if (!config.features.msgControls) return res.status(404).json({ error: 'Not found' });
    const { rows: [m] } = await q('SELECT conversation_id FROM messages WHERE id = $1', [id(req.params.id)]); if (!m) return res.status(404).json({ error: 'Message not found' });
    await memberOf(m.conversation_id, req.user.id);
    await q('INSERT INTO message_hidden (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id(req.params.id), req.user.id]); res.json({ ok: true });
  });
  // Edit your own text message within 15 minutes; shows "Edited".
  api.patch('/messages/:id', requireAuth, on, async (req, res) => {
    if (!config.features.msgControls) return res.status(404).json({ error: 'Not found' });
    const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    const { rows } = await q(`UPDATE messages SET body = $3, edited_at = now() WHERE id = $1 AND sender_id = $2 AND kind = 'text' AND deleted_at IS NULL AND created_at > now() - interval '15 minutes' RETURNING id, body, edited_at`, [id(req.params.id), req.user.id, body]);
    if (!rows[0]) return res.status(403).json({ error: 'You can only edit your own messages for a short time after sending.' }); res.json(rows[0]);
  });
  api.put('/messages/:id/reaction', requireAuth, on, async (req, res) => {
    const { emoji } = z.object({ emoji: z.string().min(1).max(40).refine((e) => /^:[a-z0-9_]{2,30}:$/.test(e) || [...new Intl.Segmenter().segment(e)].length === 1, 'Choose one emoji') }).strict().parse(req.body);
    const { rows: [m] } = await q('SELECT conversation_id FROM messages WHERE id = $1', [id(req.params.id)]); if (!m) return res.status(404).json({ error: 'Message not found' });
    await memberOf(m.conversation_id, req.user.id);
    await q('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()', [id(req.params.id), req.user.id, emoji]);
    res.json({ ok: true });
  });
  api.post('/conversations/:id/read', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const { last_id } = z.object({ last_id: z.number().int().min(0) }).strict().parse(req.body);
    await q('UPDATE conversation_members SET last_read_id = GREATEST(last_read_id, LEAST($3, (SELECT COALESCE(max(id),0) FROM messages WHERE conversation_id = $1))) WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id, last_id]);
    res.json({ ok: true });
  });
  api.post('/conversations/:id/typing', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    await q('UPDATE conversation_members SET typing_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id, req.body?.typing !== false]);
    res.json({ ok: true });
  });
  // Themes: per chat (scope=chat) or for all chats (scope=all). theme null resets.
  api.put('/conversations/:id/theme', requireAuth, on, async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const d = z.object({ theme: z.enum(CHAT_THEMES).nullable(), scope: z.enum(['chat', 'all']), clear_wallpaper: z.boolean().optional() }).strict().parse(req.body);
    if (d.scope === 'chat') await q(`UPDATE conversation_members SET theme = $3${d.clear_wallpaper ? ', wallpaper_path = NULL' : ''} WHERE conversation_id = $1 AND user_id = $2`, [c.id, req.user.id, d.theme]);
    else await q(`INSERT INTO chat_prefs (user_id, theme) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET theme = EXCLUDED.theme${d.clear_wallpaper ? ', wallpaper_path = NULL' : ''}, updated_at = now()`, [req.user.id, d.theme]);
    res.json({ ok: true });
  });
  api.post('/conversations/:id/wallpaper', requireAuth, on, media.single('image'), async (req, res) => {
    const f = req.file;
    try {
      const c = await memberOf(id(req.params.id), req.user.id);
      if (!f || !IMG.has(f.mimetype)) return res.status(400).json({ error: 'Choose a photo' });
      const pub = await saveChatImage(fs.readFileSync(f.path), false);
      if (req.body?.scope === 'all') await q('INSERT INTO chat_prefs (user_id, wallpaper_path) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET wallpaper_path = EXCLUDED.wallpaper_path, updated_at = now()', [req.user.id, pub]);
      else await q('UPDATE conversation_members SET wallpaper_path = $3 WHERE conversation_id = $1 AND user_id = $2', [c.id, req.user.id, pub]);
      res.json({ wallpaper_path: pub });
    } finally { if (f) fs.rm(f.path, { force: true }, () => {}); }
  });
  // Voice/video calls via LiveKit. Room per chat; every member can publish.
  api.post('/conversations/:id/call', requireVerified, on, async (req, res) => {
    if (!config.features.calls) return res.status(404).json({ error: 'Not found' });
    if (!liveConfigured()) return res.status(503).json({ error: 'Calls aren’t available right now', code: 'LIVE_NOT_CONFIGURED' });
    const c = await memberOf(id(req.params.id), req.user.id);
    const { video = false, join = false } = z.object({ video: z.boolean().optional(), join: z.boolean().optional() }).strict().parse(req.body || {});
    const room = `dm-${c.id}`;
    const token = await mintToken({ room, identity: `u${req.user.id}`, name: req.user.full_name, canPublish: true, canPublishData: true, ttlSeconds: 4 * 3600 });
    if (!join) await postMessage(c, req.user.id, { kind: 'call', meta: { video } });
    res.json({ url: config.livekitUrl, token, room });
  });
}

// Teen safety: adults can't start chats with under-18s who don't follow them.
const TEEN = "u.birth_date IS NOT NULL AND u.birth_date > (now() - interval '18 years')::date";
export async function teenBlocked(senderId, ids) {
  const { rows: [me] } = await q(`SELECT (${TEEN}) AS teen FROM users u WHERE u.id = $1`, [senderId]);
  if (me?.teen) return false;
  const { rows } = await q(`SELECT 1 FROM users u WHERE u.id = ANY($1) AND ${TEEN} AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = $2) LIMIT 1`, [ids, senderId]);
  return rows.length > 0;
}
// Hidden words: messages from others that match the reader's list are marked so the app can tuck them away.
export const DEFAULT_HIDDEN = ['idiot', 'stupid', 'loser', 'kill yourself', 'kys', 'ugly', 'slut', 'whore', 'retard'];
export async function hiddenWordsOf(uid) {
  const { rows: [u] } = await q('SELECT hidden_words, hidden_words_on FROM users WHERE id = $1', [uid]);
  return u?.hidden_words_on ? [...DEFAULT_HIDDEN, ...(u.hidden_words || [])].map((w) => w.toLowerCase()).filter(Boolean) : null;
}
export const matchesHidden = (text, words) => { const t = ` ${String(text || '').toLowerCase()} `; return words.some((w) => (/^[\p{L}\p{N}]+$/u.test(w) ? new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u').test(t) : t.includes(w))); };
async function filterHidden(uid, rows) {
  const words = await hiddenWordsOf(uid); if (!words) return;
  for (const m of rows) if (m.sender_id !== uid && m.body && matchesHidden(m.body, words)) m.filtered = true;
}
