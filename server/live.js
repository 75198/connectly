// Go Live (round 6, migration 012, flag FEATURE_LIVE). Video goes through LiveKit (SFU, simulcast);
// this server only mints short-lived access tokens and keeps the social layer (who can watch, comments,
// reactions, notifications, reports, moderation, usage caps) in Postgres.
// Free-tier guard rails: LIVE_MAX_MINUTES per stream, LIVE_MAX_VIEWERS per stream and a monthly
// participant-minute budget (LIVE_MONTHLY_MINUTES, default 4500 of LiveKit's 5000 free).
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { q } from './db.js';
import { config } from './config.js';

export const LIVE_REACTIONS = ['❤️', '👍', '😂', '😮', '👏', '🔥'];
const MONTH_LIMIT_MSG = 'Live video has reached its free monthly limit. Please try again next month.';
export const liveConfigured = () => !!(config.livekitUrl && config.livekitApiKey && config.livekitApiSecret);

export async function mintToken({ room, identity, name, canPublish, ttlSeconds, canPublishData = false }) {
  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, { identity, name, ttl: Math.max(60, Math.floor(ttlSeconds)) });
  at.addGrant({ roomJoin: true, room, canPublish, canSubscribe: true, canPublishData });
  return at.toJwt();
}
async function closeRoom(room) {
  if (!liveConfigured() || config.isTest) return;
  try { await new RoomServiceClient(config.livekitUrl.replace(/^wss:/, 'https:'), config.livekitApiKey, config.livekitApiSecret).deleteRoom(room); } catch { /* room may already be gone */ }
}
export async function monthlyMinutes() {
  const { rows: [r] } = await q("SELECT COALESCE(sum(seconds), 0)::bigint AS s FROM live_participants WHERE joined_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
  return Number(r.s) / 60;
}
async function endStream(id, reason, by = null) {
  const { rows } = await q("UPDATE live_streams SET status = 'ended', ended_at = now(), end_reason = $2, ended_by = $3 WHERE id = $1 AND status = 'live' RETURNING room", [id, reason, by]);
  await q('UPDATE live_participants SET left_at = COALESCE(left_at, now()) WHERE stream_id = $1', [id]);
  if (rows[0]) await closeRoom(rows[0].room);
  return !!rows[0];
}
// End streams that ran past their time limit or whose host vanished (no heartbeat for 90 s).
export async function sweepLive() {
  const { rows } = await q(`SELECT s.id, CASE WHEN s.ends_by <= now() THEN 'time_limit' ELSE 'host_left' END AS why FROM live_streams s
    WHERE s.status = 'live' AND (s.ends_by <= now() OR NOT EXISTS (SELECT 1 FROM live_participants p WHERE p.stream_id = s.id AND p.is_host AND p.last_seen > now() - interval '90 seconds'))`);
  for (const r of rows) await endStream(r.id, r.why);
}

const CAN_SEE = `(s.host_id = $1 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = s.host_id)
  OR EXISTS (SELECT 1 FROM friendships fr WHERE fr.status = 'accepted' AND ((fr.requester_id = $1 AND fr.addressee_id = s.host_id) OR (fr.addressee_id = $1 AND fr.requester_id = s.host_id))))
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = s.host_id) OR (b.blocker_id = s.host_id AND b.blocked_id = $1))
  AND h.suspended_at IS NULL AND h.deactivated_at IS NULL`;
const SELECT = `SELECT s.id, s.title, s.status, s.started_at, s.ends_by, s.ended_at, s.end_reason, s.peak_viewers,
  json_build_object('id', h.id, 'username', h.username, 'full_name', h.full_name, 'avatar_path', h.avatar_path) AS host,
  (SELECT count(*) FROM live_participants p WHERE p.stream_id = s.id AND NOT p.is_host AND p.left_at IS NULL AND p.last_seen > now() - interval '40 seconds')::int AS viewer_count,
  (s.host_id = $1) AS is_mine FROM live_streams s JOIN users h ON h.id = s.host_id`;

export function registerLive(api, { requireAuth, requireVerified, requireModerator, id, notify }) {
  const lim = (min, max, error) => rateLimit({ windowMs: min * 60000, limit: config.isTest ? 10000 : max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error }, keyGenerator: (req) => `u${req.user?.id}` });
  const startLimiter = lim(60, 6, 'You have started a lot of lives this hour. Try again later.');
  const commentLimiter = lim(1, 20, 'Slow down a little');
  const reactLimiter = lim(1, 60, 'Slow down a little');
  const on = (_req, res, next) => (config.features.live ? next() : res.status(404).json({ error: 'Not found' }));
  const needLk = (_req, res, next) => (liveConfigured() ? next() : res.status(503).json({ error: 'Live video isn’t set up yet. Please try again later.', code: 'LIVE_NOT_CONFIGURED' }));
  const visible = async (uid, sid) => (await q(`${SELECT} WHERE s.id = $2 AND ${CAN_SEE}`, [uid, sid])).rows[0];
  const ttl = (s) => (new Date(s.ends_by) - Date.now()) / 1000 + 120;
  const tokenFor = async (s, user, host) => ({ url: config.livekitUrl, token: await mintToken({ room: s.room, identity: `u${user.id}`, name: user.full_name, canPublish: host, ttlSeconds: ttl(s) }) });

  api.get('/live/status', requireAuth, on, async (_req, res) => {
    const used = await monthlyMinutes();
    res.json({ configured: liveConfigured(), available: used < config.liveMonthlyMinutes, reactions: LIVE_REACTIONS });
  });

  api.get('/live', requireAuth, on, async (req, res) => {
    await sweepLive();
    const { rows } = await q(`${SELECT} WHERE s.status = 'live' AND ${CAN_SEE} ORDER BY s.started_at DESC LIMIT 20`, [req.user.id]);
    res.json({ items: rows });
  });

  api.post('/live', requireVerified, on, needLk, startLimiter, async (req, res) => {
    const { title } = z.object({ title: z.string().trim().max(120).default('') }).strict().parse(req.body || {});
    await sweepLive();
    if (await monthlyMinutes() >= config.liveMonthlyMinutes - config.liveMaxMinutes / 4) return res.status(429).json({ error: MONTH_LIMIT_MSG, limit: 'monthly' });
    const room = `cx-live-${crypto.randomBytes(9).toString('hex')}`;
    let s;
    try {
      s = (await q(`INSERT INTO live_streams (host_id, title, room, ends_by) VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING *`, [req.user.id, title, room, config.liveMaxMinutes])).rows[0];
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'You are already live. End that stream first.' }); throw e; }
    await q('INSERT INTO live_participants (stream_id, user_id, is_host) VALUES ($1, $2, true)', [s.id, req.user.id]);
    const { rows: fans } = await q(`SELECT follower_id AS uid FROM follows WHERE followee_id = $1 UNION
      SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END FROM friendships WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1) LIMIT 2000`, [req.user.id]);
    for (const f of fans) await notify(f.uid, req.user.id, 'live', { live_stream_id: s.id });
    res.status(201).json({ stream: await visible(req.user.id, s.id), ...(await tokenFor(s, req.user, true)) });
  });

  api.get('/live/:id', requireAuth, on, async (req, res) => {
    await sweepLive();
    const s = await visible(req.user.id, id(req.params.id));
    if (!s) return res.status(404).json({ error: 'This live video isn’t available' });
    res.json(s);
  });

  api.post('/live/:id/join', requireAuth, on, needLk, async (req, res) => {
    await sweepLive();
    const sid = id(req.params.id);
    const s = await visible(req.user.id, sid);
    if (!s) return res.status(404).json({ error: 'This live video isn’t available' });
    if (s.status !== 'live') return res.status(410).json({ error: 'This live video has ended' });
    const raw = (await q('SELECT room, ends_by FROM live_streams WHERE id = $1', [sid])).rows[0];
    if (s.is_mine) return res.json({ stream: s, ...(await tokenFor(raw, req.user, true)) });
    const already = (await q('SELECT 1 FROM live_participants WHERE stream_id = $1 AND user_id = $2 AND left_at IS NULL AND last_seen > now() - interval \'40 seconds\'', [sid, req.user.id])).rowCount;
    if (!already && s.viewer_count >= config.liveMaxViewers) return res.status(429).json({ error: 'This live is full right now. Try again in a bit.', limit: 'viewers' });
    if (await monthlyMinutes() >= config.liveMonthlyMinutes) return res.status(429).json({ error: MONTH_LIMIT_MSG, limit: 'monthly' });
    await q(`INSERT INTO live_participants (stream_id, user_id) VALUES ($1, $2)
      ON CONFLICT (stream_id, user_id) DO UPDATE SET left_at = NULL, last_seen = now()`, [sid, req.user.id]);
    await q(`UPDATE live_streams SET peak_viewers = GREATEST(peak_viewers, (SELECT count(*) FROM live_participants p WHERE p.stream_id = $1 AND NOT p.is_host AND p.left_at IS NULL AND p.last_seen > now() - interval '40 seconds')) WHERE id = $1`, [sid]);
    res.json({ stream: { ...s, viewer_count: s.viewer_count + (already ? 0 : 1) }, ...(await tokenFor(raw, req.user, false)) });
  });

  // Every ~15 s from host and viewers: keeps presence fresh and counts participant-seconds for the budget.
  api.post('/live/:id/heartbeat', requireAuth, on, async (req, res) => {
    const sid = id(req.params.id);
    await q(`UPDATE live_participants SET seconds = seconds + LEAST(30, GREATEST(0, EXTRACT(EPOCH FROM now() - last_seen)))::int, last_seen = now()
      WHERE stream_id = $1 AND user_id = $2 AND left_at IS NULL`, [sid, req.user.id]);
    await sweepLive();
    const s = await visible(req.user.id, sid);
    if (!s) return res.status(404).json({ error: 'Not found' });
    res.json({ status: s.status, viewer_count: s.viewer_count, ends_by: s.ends_by });
  });

  api.post('/live/:id/leave', requireAuth, on, async (req, res) => {
    const sid = id(req.params.id);
    await q(`UPDATE live_participants SET seconds = seconds + LEAST(30, GREATEST(0, EXTRACT(EPOCH FROM now() - last_seen)))::int, last_seen = now(), left_at = now()
      WHERE stream_id = $1 AND user_id = $2 AND left_at IS NULL AND NOT is_host`, [sid, req.user.id]);
    res.json({ ok: true });
  });

  api.post('/live/:id/end', requireAuth, on, async (req, res) => {
    const sid = id(req.params.id);
    const { rows } = await q("SELECT id FROM live_streams WHERE id = $1 AND host_id = $2", [sid, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await q('UPDATE live_participants SET seconds = seconds + LEAST(30, GREATEST(0, EXTRACT(EPOCH FROM now() - last_seen)))::int, last_seen = now() WHERE stream_id = $1 AND is_host AND left_at IS NULL', [sid]);
    await endStream(sid, 'host_ended', req.user.id);
    res.json({ ok: true });
  });

  // Live comments + reactions, polled every ~2 s (cheap, works through any proxy, moderated server-side).
  api.get('/live/:id/events', requireAuth, on, async (req, res) => {
    const sid = id(req.params.id);
    const s = await visible(req.user.id, sid);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const ac = Number(req.query.after_comment) || 0, ar = Number(req.query.after_reaction) || 0;
    const { rows: comments } = await q(`SELECT c.id, c.body, c.created_at, json_build_object('username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path) AS author
      FROM live_comments c JOIN users u ON u.id = c.user_id WHERE c.stream_id = $1 AND c.id > $2
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $3 AND b.blocked_id = c.user_id) OR (b.blocker_id = c.user_id AND b.blocked_id = $3))
      ORDER BY c.id DESC LIMIT 50`, [sid, ac, req.user.id]);
    const { rows: reactions } = await q('SELECT id, reaction FROM live_reactions WHERE stream_id = $1 AND id > $2 ORDER BY id DESC LIMIT 40', [sid, ar]);
    res.json({ status: s.status, viewer_count: s.viewer_count, comments: comments.reverse(), reactions: reactions.reverse() });
  });

  const active = async (req, res) => {
    const s = await visible(req.user.id, id(req.params.id));
    if (!s) { res.status(404).json({ error: 'Not found' }); return null; }
    if (s.status !== 'live') { res.status(410).json({ error: 'This live video has ended' }); return null; }
    return s;
  };
  api.post('/live/:id/comments', requireVerified, on, commentLimiter, async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1, 'Write a comment').max(300) }).strict().parse(req.body);
    const s = await active(req, res); if (!s) return;
    const { rows: [c] } = await q('INSERT INTO live_comments (stream_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at', [s.id, req.user.id, body]);
    res.status(201).json({ ...c, author: { username: req.user.username, full_name: req.user.full_name, avatar_path: req.user.avatar_path } });
  });
  api.post('/live/:id/reactions', requireAuth, on, reactLimiter, async (req, res) => {
    const { reaction } = z.object({ reaction: z.enum(LIVE_REACTIONS) }).strict().parse(req.body);
    const s = await active(req, res); if (!s) return;
    await q('INSERT INTO live_reactions (stream_id, user_id, reaction) VALUES ($1, $2, $3)', [s.id, req.user.id, reaction]);
    res.status(201).json({ ok: true });
  });

  // Report a live: goes into the normal moderation queue as a report on the host, linked to the stream.
  api.post('/live/:id/report', requireVerified, on, lim(60, 20, 'Too many reports. Try again later.'), async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(3, 'Tell us briefly what is wrong').max(500) }).strict().parse(req.body);
    const s = await visible(req.user.id, id(req.params.id));
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.is_mine) return res.status(400).json({ error: 'You can’t report yourself' });
    const dup = await q("SELECT 1 FROM reports WHERE reporter_id = $1 AND live_stream_id = $2 AND status = 'open'", [req.user.id, s.id]);
    if (!dup.rowCount) await q("INSERT INTO reports (reporter_id, target_type, target_user_id, reason, live_stream_id) VALUES ($1, 'user', $2, $3, $4)", [req.user.id, s.host.id, `[Live #${s.id}] ${reason}`, s.id]);
    res.status(201).json({ ok: true, message: 'Thanks. Our moderators will review this live.' });
  });

  api.get('/admin/live', requireModerator, on, async (req, res) => {
    await sweepLive();
    const { rows } = await q(`${SELECT} WHERE s.status = 'live' ORDER BY s.started_at DESC LIMIT 50`, [req.user.id]);
    res.json({ items: rows, month_minutes_used: Math.round(await monthlyMinutes()), month_budget: config.liveMonthlyMinutes });
  });
  api.post('/admin/live/:id/end', requireModerator, on, async (req, res) => {
    const ok = await endStream(id(req.params.id), 'moderator', req.user.id);
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'No such live stream' });
  });
}
