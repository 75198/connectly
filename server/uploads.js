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

export const uploadMany = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 6 },
  fileFilter: (_req, file, cb) => ALLOWED.has(file.mimetype) ? cb(null, true) : cb(new HttpError(400, 'Only JPEG, PNG, WebP or GIF images are allowed')),
});

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// High quality: original resolution up to 4096px (posts), WebP q90, EXIF orientation applied,
// colours converted to sRGB (so wide-gamut phone photos look right everywhere), all other metadata (GPS) dropped.
const PRESETS = {
  avatar: (s) => s.resize(800, 800, { fit: 'cover' }),
  cover: (s) => s.resize(2400, 800, { fit: 'cover' }),
  post: (s) => s.resize(4096, 4096, { fit: 'inside', withoutEnlargement: true }),
  listing: (s) => s.resize(2560, 2560, { fit: 'inside', withoutEnlargement: true }),
  space: (s) => s.resize(800, 800, { fit: 'cover' }),
  story: (s) => s.resize(1440, 2560, { fit: 'inside', withoutEnlargement: true }),
};
export const IMAGE_QUALITY = 90;

// Re-encodes the image (drops EXIF/GPS metadata and any non-image payload). Returns public path.
// enhance: gentle auto-enhance (slight sharpen, contrast and saturation), only when the user asks for it.
export async function saveImage(buffer, kind, { enhance = false } = {}) {
  let img;
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > 60e6) throw new Error('bad dims');
    let p = PRESETS[kind](sharp(buffer, { animated: false }).rotate()).toColourspace('srgb');
    if (enhance) p = p.modulate({ brightness: 1.03, saturation: 1.1 }).linear(1.06, -6).sharpen({ sigma: 0.8 });
    img = await p.webp({ quality: IMAGE_QUALITY, smartSubsample: true, effort: 4 }).toBuffer();
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
