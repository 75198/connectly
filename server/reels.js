// Reels: short vertical videos stored as posts with kind = 'reel', so visibility, blocks, likes,
// comments, reports and moderation (hide/suspend) all work exactly like normal posts.
// Uploads are probed and re-encoded with ffmpeg (H.264/AAC, max 720x1280, faststart, metadata stripped)
// so they stream small on slow networks; a WebP poster is generated for lazy loading.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import multer from 'multer';
import sharp from 'sharp';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { HttpError, removeImage } from './uploads.js';

export const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v']);
const tmpDir = path.join(os.tmpdir(), 'connectly-reels');
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const videoUpload = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => { fs.mkdirSync(tmpDir, { recursive: true }); cb(null, tmpDir); }, filename: (_r, _f, cb) => cb(null, crypto.randomBytes(12).toString('hex')) }),
  limits: { fileSize: config.maxVideoBytes, files: 2, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'video') return VIDEO_TYPES.has(file.mimetype) ? cb(null, true) : cb(new HttpError(400, 'Only MP4, MOV, WebM or 3GP videos are allowed'));
    if (file.fieldname === 'cover') return IMAGE_TYPES.has(file.mimetype) ? cb(null, true) : cb(new HttpError(400, 'Cover must be a JPEG, PNG or WebP image'));
    cb(new HttpError(400, 'Unexpected file'));
  },
});

const run = (bin, args, timeout = 180000) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});
let ffmpegOk = null;
export async function ffmpegAvailable() {
  if (ffmpegOk === null) ffmpegOk = await run(config.ffmpegPath, ['-version'], 5000).then(() => run(config.ffprobePath, ['-version'], 5000)).then(() => true, () => false);
  return ffmpegOk;
}

// Returns { seconds, width, height } or throws a 400 if the file is not a playable video.
export async function probeVideo(file) {
  let info;
  try { info = JSON.parse(await run(config.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', file], 30000)); }
  catch { throw new HttpError(400, 'File is not a valid video'); }
  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  const seconds = Number(info.format?.duration);
  if (!v || !v.width || !v.height || !Number.isFinite(seconds) || seconds <= 0) throw new HttpError(400, 'File is not a valid video');
  if (seconds > config.maxVideoSeconds + 0.5) throw new HttpError(400, `Reels can be up to ${config.maxVideoSeconds} seconds long`);
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  return { seconds, width: v.width, height: v.height, vcodec: v.codec_name, pix: v.pix_fmt, acodec: a?.codec_name || null, format: info.format?.format_name || '' };
}

// Two renditions:
//  - HQ: the original stream copied untouched (no re-encode, any resolution incl. 4K) when it is already
//    browser-safe (H.264 8-bit + AAC/no audio in MP4/MOV); otherwise a high-quality encode (CRF 19,
//    original resolution, only capped at 1080p on the short side).
//  - Data saver: 480p (short side), CRF 30, served to phones on slow networks / Data Saver.
// image_path also points at the poster so caption-less reels satisfy the existing posts CHECK (body or image).
async function processVideo(src, coverFile) {
  const meta = await probeVideo(src);
  const dir = path.join(config.uploadDir, 'reels'); fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex');
  const out = path.join(dir, name + '.mp4'); const low = path.join(dir, name + '-480.mp4'); const frame = path.join(tmpDir, name + '.jpg');
  const T = ['-t', String(config.maxVideoSeconds)];
  const copyable = meta.vcodec === 'h264' && (!meta.pix || meta.pix === 'yuv420p' || meta.pix === 'yuvj420p') && (!meta.acodec || meta.acodec === 'aac') && /mp4|mov/.test(meta.format);
  const shortCap = (n) => `scale='if(lt(iw,ih),min(${n},iw),-2)':'if(lt(iw,ih),-2,min(${n},ih))'`;
  try {
    if (copyable) await run(config.ffmpegPath, ['-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', ...T, '-c', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', out]);
    else await run(config.ffmpegPath, ['-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', ...T, '-vf', `${shortCap(1080)},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '160k', '-map_metadata', '-1', '-movflags', '+faststart', out], 300000);
    await run(config.ffmpegPath, ['-v', 'error', '-y', '-i', out, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `${shortCap(480)},fps='min(30,source_fps)',format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-profile:v', 'main', '-c:a', 'aac', '-b:a', '64k', '-ac', '2', '-map_metadata', '-1', '-movflags', '+faststart', low], 300000);
    let poster;
    if (coverFile) poster = await sharp(coverFile).rotate().resize(1080, 1920, { fit: 'inside', withoutEnlargement: true }).toColourspace('srgb').webp({ quality: 88 }).toBuffer().catch(() => null);
    if (!poster) {
      await run(config.ffmpegPath, ['-v', 'error', '-y', '-ss', String(Math.min(0.5, meta.seconds / 2)), '-i', out, '-frames:v', '1', '-q:v', '2', frame], 30000);
      poster = await sharp(frame).resize(1080, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    }
    fs.writeFileSync(path.join(dir, name + '.webp'), poster);
  } catch (e) {
    fs.rm(out, { force: true }, () => {}); fs.rm(low, { force: true }, () => {});
    if (e instanceof HttpError) throw e;
    console.error('reel processing failed', e.stderr || e.message);
    throw new HttpError(400, 'We couldn’t process that video. Try a different file.');
  } finally { fs.rm(frame, { force: true }, () => {}); }
  return { video: `/uploads/reels/${name}.mp4`, low: `/uploads/reels/${name}-480.mp4`, poster: `/uploads/reels/${name}.webp`, seconds: Math.round(meta.seconds * 10) / 10, copied: copyable };
}

export function registerReels(api, { requireAuth, requireVerified, id, pagePosts, getVisiblePost, actingPage, Visibility }) {
  const enabled = (_req, res, next) => (config.features.reels ? next() : res.status(404).json({ error: 'Not found' }));
  const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.isTest ? 10000 : 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'You’ve uploaded a lot of reels. Try again later.' } });
  const ReelSchema = z.object({ body: z.string().trim().max(2200).default(''), visibility: Visibility.default('public') }).strict();

  api.get('/reels', enabled, requireAuth, async (req, res) => res.json(await pagePosts(req.user.id, "p.kind = 'reel'", [], req.query.cursor, req.query.limit)));
  api.get('/reels/:id', enabled, requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p || p.kind !== 'reel') return res.status(404).json({ error: 'Reel not found' });
    res.json(p);
  });
  api.post('/reels', enabled, requireVerified, uploadLimiter, async (req, res, next) => {
    if (!(await ffmpegAvailable())) return res.status(503).json({ error: 'Video uploads are temporarily unavailable' });
    next();
  }, videoUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res) => {
    req.file = req.files?.video?.[0]; const cover = req.files?.cover?.[0];
    const tmp = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a video to upload' });
      const d = ReelSchema.parse({ body: req.body?.body ?? '', visibility: req.body?.visibility || undefined });
      const v = await processVideo(tmp, cover?.path);
      const asSpace = await actingPage(req);
      const { rows } = await q("INSERT INTO posts (author_id, body, visibility, as_space_id, kind, video_path, poster_path, video_seconds, video_low_path, image_path) VALUES ($1,$2,$3,$4,'reel',$5,$6,$7,$8,$6) RETURNING id",
        [req.user.id, d.body, d.visibility, asSpace, v.video, v.poster, v.seconds, v.low]);
      res.status(201).json(await getVisiblePost(req.user.id, rows[0].id));
    } finally { if (tmp) fs.rm(tmp, { force: true }, () => {}); if (cover) fs.rm(cover.path, { force: true }, () => {}); }
  });
  // One view per person per reel (the author's own views don't count).
  api.post('/reels/:id/view', enabled, requireAuth, async (req, res) => {
    const p = await getVisiblePost(req.user.id, id(req.params.id));
    if (!p || p.kind !== 'reel') return res.status(404).json({ error: 'Reel not found' });
    if (!p.is_mine) await q('INSERT INTO reel_views (post_id, viewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, req.user.id]);
    const { rows } = await q('SELECT count(*)::int AS n FROM reel_views WHERE post_id = $1', [p.id]);
    res.json({ view_count: rows[0].n });
  });
}
export { removeImage };
