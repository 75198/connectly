// Drafts, Recently deleted (30-day soft delete), saved posts and 24h stories.
import { z } from 'zod';
import { q } from './db.js';
import { upload, saveImage, removeImage } from './uploads.js';

export const DELETED_RETENTION_DAYS = 30;

// Permanently removes posts that have been in Recently deleted for more than 30 days, and expired stories.
// Only rows the owner already deleted (or stories past their 24h life) are touched.
export async function purgeExpired() {
  const { rows } = await q(`DELETE FROM posts WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '${DELETED_RETENTION_DAYS} days' RETURNING image_path, video_path, poster_path, video_low_path`);
  for (const r of rows) { removeImage(r.image_path); removeImage(r.video_path); removeImage(r.poster_path); removeImage(r.video_low_path); }
  const st = await q("DELETE FROM stories WHERE expires_at < now() - interval '1 hour' RETURNING image_path");
  for (const r of st.rows) removeImage(r.image_path);
  return { posts: rows.length, stories: st.rowCount };
}
export function startPurgeJob(everyMs = 60 * 60 * 1000) {
  const run = () => purgeExpired().then((r) => { if (r.posts || r.stories) console.log('purged', r); }).catch((e) => console.error('purge failed', e.message));
  setTimeout(run, 30 * 1000).unref();
  return setInterval(run, everyMs).unref();
}

export function registerPostExtras(api, { requireAuth, requireVerified, id, getVisiblePost, getOwnPost, POST_SELECT }) {
  const mine = async (req, res, where) => {
    const { rows } = await q(`SELECT id, image_path, video_path, poster_path, video_low_path FROM posts WHERE id = $1 AND author_id = $2 AND hidden_at IS NULL AND ${where}`, [id(req.params.id), req.user.id]);
    if (!rows[0]) { res.status(404).json({ error: 'Post not found' }); return null; }
    return rows[0];
  };
  const listOwn = (where) => async (req, res) => {
    const { rows } = await q(`${POST_SELECT} WHERE p.author_id = $1 AND ${where} ORDER BY COALESCE(p.deleted_at, p.updated_at) DESC LIMIT 100`, [req.user.id]);
    res.json({ items: rows, retention_days: DELETED_RETENTION_DAYS });
  };
  // drafts
  api.get('/me/drafts', requireAuth, listOwn('p.is_draft AND p.deleted_at IS NULL'));
  api.post('/posts/:id/draft', requireAuth, async (req, res) => {
    const p = await mine(req, res, 'deleted_at IS NULL'); if (!p) return;
    await q('UPDATE posts SET is_draft = true, updated_at = now() WHERE id = $1', [p.id]);
    res.json(await getOwnPost(req.user.id, p.id));
  });
  api.post('/posts/:id/publish', requireVerified, async (req, res) => {
    const p = await mine(req, res, 'is_draft AND deleted_at IS NULL'); if (!p) return;
    await q('UPDATE posts SET is_draft = false, created_at = now(), updated_at = now() WHERE id = $1', [p.id]);
    res.json(await getOwnPost(req.user.id, p.id));
  });
  // recently deleted
  api.get('/me/deleted', requireAuth, listOwn(`p.deleted_at IS NOT NULL AND p.deleted_at > now() - interval '${DELETED_RETENTION_DAYS} days'`));
  api.post('/posts/:id/restore', requireAuth, async (req, res) => {
    const p = await mine(req, res, `deleted_at IS NOT NULL AND deleted_at > now() - interval '${DELETED_RETENTION_DAYS} days'`); if (!p) return;
    await q('UPDATE posts SET deleted_at = NULL WHERE id = $1', [p.id]);
    res.json(await getOwnPost(req.user.id, p.id));
  });
  // "Delete forever" only from Drafts or Recently deleted (published posts go to Recently deleted first)
  api.delete('/posts/:id/permanent', requireAuth, async (req, res) => {
    const p = await mine(req, res, '(is_draft OR deleted_at IS NOT NULL)'); if (!p) return;
    await q('DELETE FROM posts WHERE id = $1 AND author_id = $2', [p.id, req.user.id]);
    removeImage(p.image_path); removeImage(p.video_path); removeImage(p.poster_path); removeImage(p.video_low_path);
    res.json({ ok: true });
  });
  // saved posts
  api.put('/posts/:id/save', requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id)); if (!p) return res.status(404).json({ error: 'Post not found' });
    await q('INSERT INTO saved_posts (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, p.id]);
    res.json({ saved_by_me: true });
  });
  api.delete('/posts/:id/save', requireAuth, async (req, res) => {
    await q('DELETE FROM saved_posts WHERE user_id = $1 AND post_id = $2', [req.user.id, id(req.params.id)]);
    res.json({ saved_by_me: false });
  });
  api.get('/me/saved', requireAuth, async (req, res) => {
    const { rows } = await q(`${POST_SELECT} JOIN saved_posts sv ON sv.post_id = p.id AND sv.user_id = $1 WHERE ${'p.hidden_at IS NULL AND p.deleted_at IS NULL AND NOT p.is_draft'} ORDER BY sv.created_at DESC LIMIT 100`, [req.user.id]);
    // re-check visibility per post (friends-only posts can change)
    const items = []; for (const r of rows) if (await getVisiblePost(req.user.id, r.id)) items.push(r);
    res.json({ items, next_cursor: null });
  });
  // stories: photo + caption, visible 24h to the author, their friends and people who follow them
  api.get('/stories', requireAuth, async (req, res) => {
    const { rows } = await q(`SELECT s.id, s.image_path, s.caption, s.created_at, s.expires_at,
        json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path) AS author
      FROM stories s JOIN users u ON u.id = s.author_id AND u.deactivated_at IS NULL AND u.suspended_at IS NULL
      WHERE s.expires_at > now() AND (s.author_id = $1
        OR EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND ((f.requester_id = $1 AND f.addressee_id = s.author_id) OR (f.addressee_id = $1 AND f.requester_id = s.author_id)))
        OR EXISTS (SELECT 1 FROM follows fo WHERE fo.follower_id = $1 AND fo.followee_id = s.author_id))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = s.author_id) OR (b.blocker_id = s.author_id AND b.blocked_id = $1))
      ORDER BY (s.author_id = $1) DESC, s.created_at ASC LIMIT 300`, [req.user.id]);
    const groups = new Map();
    for (const r of rows) { const k = r.author.id; if (!groups.has(k)) groups.set(k, { author: r.author, items: [] }); groups.get(k).items.push({ id: r.id, image_path: r.image_path, caption: r.caption, created_at: r.created_at, expires_at: r.expires_at }); }
    res.json({ items: [...groups.values()] });
  });
  api.post('/stories', requireVerified, upload.single('image'), async (req, res) => {
    const d = z.object({ caption: z.string().trim().max(200).default(''), enhance: z.enum(['0', '1']).optional() }).strict().parse({ caption: req.body?.caption || undefined, enhance: req.body?.enhance || undefined });
    if (!req.file) return res.status(400).json({ error: 'Choose a photo for your story' });
    const img = await saveImage(req.file.buffer, 'story', { enhance: d.enhance === '1' });
    const { rows } = await q('INSERT INTO stories (author_id, image_path, caption) VALUES ($1,$2,$3) RETURNING id, image_path, caption, created_at, expires_at', [req.user.id, img, d.caption]);
    res.status(201).json(rows[0]);
  });
  api.delete('/stories/:id', requireAuth, async (req, res) => {
    const { rows } = await q('DELETE FROM stories WHERE id = $1 AND author_id = $2 RETURNING image_path', [id(req.params.id), req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Story not found' });
    removeImage(rows[0].image_path); res.json({ ok: true });
  });
}
