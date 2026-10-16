// Save to gallery: watermarked HD copy of a public photo/reel ("Connectly" + @creator, like TikTok).
// Never for private accounts, friends-only/close-friends/only-me posts, posts with downloads turned off, or posts with licensed music.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';

const flag = (_req, res, next) => (config.features.downloads ? next() : res.status(404).json({ error: 'Not found' }));
const FREE_MUSIC = /^(cc0|public domain|cc by(?!-n[cd])|pixabay|royalty[- ]free)/i;
const abs = (p) => { if (!p?.startsWith('/uploads/')) return null; const a = path.join(config.uploadDir, p.slice(9)); return a.startsWith(config.uploadDir) && fs.existsSync(a) ? a : null; };
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function downloadInfo(postId) {
  const { rows: [p] } = await q(`SELECT p.id, p.kind, p.visibility, p.close_friends_only, p.image_path, p.video_path, p.allow_downloads, p.deleted_at, p.hidden_at, p.is_draft,
      u.username, u.is_private, u.allow_downloads AS user_allows, u.deactivated_at, m.license AS music_license
    FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN music_tracks m ON m.id = p.music_track_id WHERE p.id = $1`, [postId]);
  if (!p || p.deleted_at || p.hidden_at || p.is_draft || p.deactivated_at) return { ok: false, reason: 'This post isn’t available.' };
  if (p.visibility !== 'public' || p.close_friends_only || p.is_private) return { ok: false, reason: 'Only public posts can be saved.' };
  if (!(p.allow_downloads ?? p.user_allows)) return { ok: false, reason: 'The creator turned off downloads for this post.' };
  if (p.music_license && !FREE_MUSIC.test(p.music_license)) return { ok: false, reason: 'This post has licensed music, so it can’t be saved.' };
  const file = abs(p.video_path) || abs(p.image_path);
  if (!file) return { ok: false, reason: 'There’s no photo or video to save.' };
  return { ok: true, p, file, video: !!abs(p.video_path) };
}

function badge(w, name) { // SVG watermark: logo mark + "Connectly" + @name, scaled to the media width
  const s = Math.max(14, Math.round(w / 28)), pad = Math.round(s * 0.6), h = Math.round(s * 3.2), tw = Math.round(s * 0.62 * Math.max(9, name.length + 1)) + pad * 2 + s * 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${h}"><g font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" fill="#fff" fill-opacity=".92" style="paint-order:stroke" stroke="#000" stroke-opacity=".35" stroke-width="${Math.max(1, s / 10)}">
    <rect x="${pad}" y="${pad}" width="${s * 1.5}" height="${s * 1.5}" rx="${s * 0.4}" fill="#0F766E" stroke="none" fill-opacity=".9"/><text x="${pad + s * 0.36}" y="${pad + s * 1.17}" font-size="${s * 1.1}" stroke="none">C</text>
    <text x="${pad + s * 2}" y="${pad + s * 1.15}" font-size="${s}">Connectly</text><text x="${pad}" y="${pad + s * 2.6}" font-size="${s * 0.85}">@${esc(name)}</text></g></svg>`);
}
const run = (args) => new Promise((ok, bad) => { const c = spawn(config.ffmpegPath, args, { stdio: 'ignore' }); c.on('error', bad); c.on('close', (code) => (code === 0 ? ok() : bad(new Error('ffmpeg ' + code)))); });

export function registerDownloads(api, { requireAuth, id }) {
  api.get('/posts/:id/download', requireAuth, flag, async (req, res) => {
    const info = await downloadInfo(id(req.params.id)); if (!info.ok) return res.status(403).json({ error: info.reason });
    const { p, file, video } = info; const name = `connectly-${p.username}-${p.id}`;
    res.set('Cache-Control', 'private, no-store');
    if (!video) {
      const img = sharp(file).rotate(); const meta = await img.metadata(); const w = meta.width || 1080;
      const out = await img.composite([{ input: badge(w, p.username), gravity: 'southwest' }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      return res.type('image/jpeg').set('Content-Disposition', `attachment; filename="${name}.jpg"`).send(out);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxdl-'));
    try {
      const mark = path.join(tmp, 'mark.png'), out = path.join(tmp, 'out.mp4');
      await sharp(badge(720, p.username)).png().toFile(mark);
      // Watermark top-left; stream copy audio; keep source resolution (reels are stored at HD already).
      await run(['-y', '-i', file, '-i', mark, '-filter_complex', '[1][0]scale2ref=w=iw*0.42:h=ow/mdar[m][v];[v][m]overlay=24:24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'copy', '-movflags', '+faststart', out]);
      res.type('video/mp4').set('Content-Disposition', `attachment; filename="${name}.mp4"`);
      fs.createReadStream(out).on('close', () => fs.rmSync(tmp, { recursive: true, force: true })).pipe(res);
    } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); res.status(500).json({ error: 'Couldn’t prepare the video. Please try again.' }); }
  });
  api.get('/posts/:id/download-check', requireAuth, flag, async (req, res) => { const i = await downloadInfo(id(req.params.id)); res.json({ ok: i.ok, reason: i.reason || null }); });
  api.patch('/posts/:id/downloads', requireAuth, flag, async (req, res) => {
    const { allow } = z.object({ allow: z.boolean().nullable() }).strict().parse(req.body);
    const { rowCount } = await q('UPDATE posts SET allow_downloads = $3 WHERE id = $1 AND author_id = $2', [id(req.params.id), req.user.id, allow]);
    if (!rowCount) return res.status(404).json({ error: 'Post not found' }); res.json({ ok: true });
  });
}
