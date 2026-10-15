// Who reacted / commented / shared a post or reel (round 6), plus share tracking.
// Every list first checks the viewer can see the post (getVisiblePost), and hides blocked/deactivated people.
import { z } from 'zod';
import { q } from './db.js';

const PERSON = `json_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name, 'avatar_path', x.avatar_path) AS user,
  EXISTS (SELECT 1 FROM follows m WHERE m.follower_id = $2 AND m.followee_id = x.id) AS following, (x.id = $2) AS is_me`;
const OK_USER = `x.deactivated_at IS NULL AND x.suspended_at IS NULL AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $2 AND b.blocked_id = x.id) OR (b.blocker_id = x.id AND b.blocked_id = $2))`;
export const SHARE_CHANNELS = ['reshare', 'native', 'copy_link', 'whatsapp', 'x', 'facebook', 'email'];

export function registerEngagement(api, { requireAuth, id, getVisiblePost, writeLimiter }) {
  const post = async (req, res) => { const p = await getVisiblePost(req.user.id, id(req.params.id)); if (!p) res.status(404).json({ error: 'Post not found' }); return p; };

  api.get('/posts/:id/reactions', requireAuth, async (req, res) => {
    const p = await post(req, res); if (!p) return;
    const { rows } = await q(`SELECT l.reaction, l.created_at, ${PERSON} FROM post_likes l JOIN users x ON x.id = l.user_id
      WHERE l.post_id = $1 AND ${OK_USER} ORDER BY l.created_at DESC LIMIT 500`, [p.id, req.user.id]);
    res.json({ items: rows, counts: p.reactions || {} });
  });
  api.get('/posts/:id/commenters', requireAuth, async (req, res) => {
    const p = await post(req, res); if (!p) return;
    const { rows } = await q(`SELECT count(*)::int AS comments, max(c.created_at) AS created_at, ${PERSON} FROM comments c JOIN users x ON x.id = c.author_id
      WHERE c.post_id = $1 AND ${OK_USER} GROUP BY x.id ORDER BY max(c.created_at) DESC LIMIT 500`, [p.id, req.user.id]);
    res.json({ items: rows });
  });
  api.get('/posts/:id/shares', requireAuth, async (req, res) => {
    const p = await post(req, res); if (!p) return;
    const { rows } = await q(`SELECT count(*)::int AS shares, max(s.created_at) AS created_at, array_agg(DISTINCT s.channel) AS channels, ${PERSON} FROM shares s JOIN users x ON x.id = s.user_id
      WHERE s.post_id = $1 AND ${OK_USER} GROUP BY x.id ORDER BY max(s.created_at) DESC LIMIT 500`, [p.id, req.user.id]);
    res.json({ items: rows });
  });
  // Record a share/reshare (called by the share sheet). Re-shares to the same channel within 10 minutes are not double-counted.
  api.post('/posts/:id/share', requireAuth, writeLimiter, async (req, res) => {
    const { channel } = z.object({ channel: z.enum(SHARE_CHANNELS).default('reshare') }).strict().parse(req.body || {});
    const p = await post(req, res); if (!p) return;
    const dup = await q("SELECT 1 FROM shares WHERE post_id = $1 AND user_id = $2 AND channel = $3 AND created_at > now() - interval '10 minutes'", [p.id, req.user.id, channel]);
    if (!dup.rowCount) await q('INSERT INTO shares (post_id, user_id, channel) VALUES ($1, $2, $3)', [p.id, req.user.id, channel]);
    const { rows: [c] } = await q('SELECT count(*)::int AS n FROM shares WHERE post_id = $1', [p.id]);
    res.status(201).json({ ok: true, share_count: c.n });
  });
}
