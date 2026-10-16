// Round 10: coin tips + creator earnings, Connectly AI creator helper.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { q, pool } from './db.js';
import { config } from './config.js';
import { notify } from './social.js';
import { groqStream } from './ai.js';

const F = config.features;
const flag = (k) => (_req, res, next) => (F[k] ? next() : res.status(404).json({ error: 'Not found' }));

export function registerRound10(api, { requireAuth, requireModerator, id }) {

  // ---- anti-scam: admin review of automatic flags ----
  api.get('/admin/safety-flags', requireModerator, flag('antiScam'), async (_req, res) => {
    const { rows } = await q(`SELECT f.id, f.kind, f.detail, f.created_at, u.username, u.full_name, u.avatar_path FROM safety_flags f JOIN users u ON u.id = f.user_id WHERE f.resolved_at IS NULL ORDER BY f.id DESC LIMIT 100`);
    res.json({ items: rows });
  });
  api.post('/admin/safety-flags/:id/resolve', requireModerator, flag('antiScam'), async (req, res) => { await q('UPDATE safety_flags SET resolved_at = now() WHERE id = $1', [id(req.params.id)]); res.json({ ok: true }); });

  // ---- Lite mode: lower-res copy of an uploaded image (480px webp), cached on disk ----
  api.get('/img/lite', requireAuth, flag('liteMode'), async (req, res) => {
    const p = String(req.query.p || ''); if (!/^\/uploads\/[\w./-]+\.(jpe?g|png|webp|gif|avif)$/i.test(p) || p.includes('..')) return res.status(400).json({ error: 'Bad image' });
    const src = path.join(config.uploadDir, p.slice(9)); if (!src.startsWith(config.uploadDir) || !fs.existsSync(src)) return res.status(404).json({ error: 'Not found' });
    const dir = path.join(config.uploadDir, '.lite'); fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, crypto.createHash('sha1').update(p).digest('hex') + '.webp');
    if (!fs.existsSync(out)) await sharp(src).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 55 }).toFile(out);
    res.set('Cache-Control', 'private, max-age=604800').type('image/webp').sendFile(out);
  });

  // ---- tips (coins only; real-money buy/cash-out stay "Coming soon") ----
  api.post('/tips', requireAuth, flag('tips'), async (req, res) => {
    const d = z.object({ username: z.string().min(1).max(40).optional(), post_id: z.number().int().positive().optional(), coins: z.number().int().min(1).max(100000) }).strict().parse(req.body);
    let to = null, postId = null;
    if (d.post_id) { const { rows: [p] } = await q("SELECT author_id FROM posts WHERE id = $1 AND visibility = 'public' AND deleted_at IS NULL AND hidden_at IS NULL", [d.post_id]); if (!p) return res.status(404).json({ error: 'Post not found' }); to = p.author_id; postId = d.post_id; }
    else if (d.username) { const { rows: [u] } = await q('SELECT id FROM users WHERE lower(username) = lower($1) AND deactivated_at IS NULL', [d.username]); if (!u) return res.status(404).json({ error: 'User not found' }); to = u.id; }
    else return res.status(400).json({ error: 'Choose who to tip' });
    if (to === req.user.id) return res.status(400).json({ error: 'You can’t tip yourself' });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rowCount } = await c.query('UPDATE coin_wallets SET balance = balance - $2, updated_at = now() WHERE user_id = $1 AND balance >= $2', [req.user.id, d.coins]);
      if (!rowCount) { await c.query('ROLLBACK'); return res.status(402).json({ error: 'You need more coins for this tip. Buying coins is coming soon.', coming_soon: true }); }
      const ref = postId ? `post:${postId}` : `user:${to}`;
      await c.query("INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, 'tip_sent', $3)", [req.user.id, -d.coins, ref]);
      await c.query('INSERT INTO coin_wallets (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = coin_wallets.balance + EXCLUDED.balance, updated_at = now()', [to, d.coins]);
      await c.query("INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, 'tip_received', $3)", [to, d.coins, ref]);
      await c.query('INSERT INTO tips (from_user, to_user, post_id, coins) VALUES ($1, $2, $3, $4)', [req.user.id, to, postId, d.coins]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    try { await notify(to, req.user.id, 'tip', postId ? { post_id: postId } : {}); } catch { /* notification type may be unknown to old clients */ }
    const { rows: [w] } = await q('SELECT balance FROM coin_wallets WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true, balance: w?.balance ?? 0 });
  });
  api.get('/me/earnings', requireAuth, flag('tips'), async (req, res) => {
    const uid = req.user.id;
    const { rows: [t] } = await q(`SELECT
        COALESCE((SELECT sum(delta) FROM coin_ledger WHERE user_id = $1 AND reason IN ('tip_received', 'gift_received')), 0)::int AS total,
        COALESCE((SELECT sum(delta) FROM coin_ledger WHERE user_id = $1 AND reason IN ('tip_received', 'gift_received') AND created_at > now() - interval '30 days'), 0)::int AS month,
        COALESCE((SELECT sum(delta) FROM coin_ledger WHERE user_id = $1 AND reason = 'tip_received'), 0)::int AS tips,
        COALESCE((SELECT sum(delta) FROM coin_ledger WHERE user_id = $1 AND reason = 'gift_received'), 0)::int AS gifts,
        COALESCE((SELECT balance FROM coin_wallets WHERE user_id = $1), 0)::int AS balance`, [uid]);
    const { rows: top } = await q(`SELECT u.username, u.full_name, u.avatar_path, sum(t.coins)::int AS coins FROM tips t JOIN users u ON u.id = t.from_user WHERE t.to_user = $1 GROUP BY u.id ORDER BY coins DESC LIMIT 5`, [uid]);
    const { rows: recent } = await q(`SELECT l.delta, l.reason, l.ref, l.created_at FROM coin_ledger l WHERE l.user_id = $1 AND l.reason IN ('tip_received', 'gift_received') ORDER BY l.id DESC LIMIT 20`, [uid]);
    const { rows: days } = await q(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE((SELECT sum(delta) FROM coin_ledger WHERE user_id = $1 AND reason IN ('tip_received', 'gift_received') AND created_at::date = d), 0)::int AS coins
      FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`, [uid]);
    res.json({ ...t, top_supporters: top, recent, days, cashout: 'coming_soon' });
  });

  // ---- Connectly AI creator helper ----
  const hits = new Map();
  api.post('/ai/creator', requireAuth, flag('aiCreator'), async (req, res) => {
    const d = z.object({ action: z.enum(['caption', 'improve', 'hashtags', 'ideas']), text: z.string().max(2000).default(''), topic: z.string().max(200).default(''), lang: z.string().max(10).default('en') }).strict().parse(req.body);
    if (!config.groqApiKey) return res.status(503).json({ error: 'Connectly AI isn’t available right now.' });
    const now = Date.now(), arr = (hits.get(req.user.id) || []).filter((t) => now - t < 3600e3);
    if (arr.length >= 60) return res.status(429).json({ error: 'You’ve used the creator helper a lot. Try again later.' }); arr.push(now); hits.set(req.user.id, arr);
    const ask = {
      caption: `Write one short, engaging social media caption (max 2 sentences, may use 1-2 emoji) for this post. Draft or topic: "${d.text || d.topic || 'a photo I am sharing'}". Reply with the caption only.`,
      improve: `Improve this social media caption: fix grammar, make it clearer and more engaging, keep the meaning, voice, emoji, @mentions and #hashtags. Caption: "${d.text}". Reply with the improved caption only.`,
      hashtags: `Suggest 6 relevant, popular hashtags for this post: "${d.text || d.topic}". Reply with the hashtags only, space-separated, each starting with #.`,
      ideas: `Give 5 short, specific post ideas for a creator${d.topic ? ` interested in ${d.topic}` : ''}. One per line, no numbering, no extra text.`,
    }[d.action];
    if ((d.action === 'improve' || d.action === 'hashtags') && !(d.text || d.topic).trim()) return res.status(400).json({ error: 'Write something first.' });
    let out = '';
    try { for await (const t of groqStream([{ role: 'system', content: `You are Connectly AI, a helpful creator assistant. Reply in the language with code "${d.lang}" unless the user's text is clearly in another language. Never add quotes around the answer.` }, { role: 'user', content: ask }], AbortSignal.timeout(20000), { model: config.groqChatModel || config.groqModel, maxTokens: 300 })) out += t; }
    catch { return res.status(502).json({ error: 'Connectly AI is busy. Try again in a moment.' }); }
    out = out.trim().replace(/^["“]|["”]$/g, '');
    if (d.action === 'hashtags') return res.json({ hashtags: [...new Set((out.match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 8) });
    if (d.action === 'ideas') return res.json({ ideas: out.split('\n').map((s) => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 5) });
    res.json({ text: out });
  });
}
