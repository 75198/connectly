import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { config } from './config.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => ALLOWED.has(file.mimetype) ? cb(null, true) : cb(new HttpError(400, 'Only JPEG, PNG, WebP or GIF images are allowed')),
});

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const PRESETS = {
  avatar: (s) => s.resize(400, 400, { fit: 'cover' }),
  cover: (s) => s.resize(1500, 500, { fit: 'cover' }),
  post: (s) => s.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }),
};

// Re-encodes the image (drops EXIF/GPS metadata and any non-image payload). Returns public path.
export async function saveImage(buffer, kind) {
  let img;
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > 40e6) throw new Error('bad dims');
    img = await PRESETS[kind](sharp(buffer, { animated: false }).rotate()).webp({ quality: 82 }).toBuffer();
  } catch { throw new HttpError(400, 'File is not a valid image'); }
  const dir = path.join(config.uploadDir, kind);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + '.webp';
  fs.writeFileSync(path.join(dir, name), img);
  return `/uploads/${kind}/${name}`;
}

export function removeImage(publicPath) {
  if (!publicPath?.startsWith('/uploads/')) return;
  const p = path.join(config.uploadDir, publicPath.slice('/uploads/'.length));
  if (p.startsWith(config.uploadDir)) fs.rm(p, { force: true }, () => {});
}
