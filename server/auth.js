import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';

export const COOKIE = 'cx_session';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

export async function createSession(res, userId, ua) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  await q('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1,$2,$3,$4)', [sha256(token), userId, expires, (ua || '').slice(0, 300)]);
  res.cookie(COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', expires, path: '/' });
}

export async function destroySession(req, res) {
  const t = req.cookies?.[COOKIE];
  if (t) await q('DELETE FROM sessions WHERE token_hash=$1', [sha256(t)]);
  res.clearCookie(COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
}

// Loads req.user (or null) from the session cookie.
export async function loadUser(req, _res, next) {
  req.user = null;
  const t = req.cookies?.[COOKIE];
  if (t) {
    const { rows } = await q(
      `SELECT u.id, u.username, u.display_name, u.email,
              COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
        GROUP BY u.id`, [sha256(t)]);
    req.user = rows[0] || null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.roles.includes('admin')) return res.status(403).json({ error: 'Admins only' });
  next();
}

// CSRF defence in depth (on top of SameSite=Strict cookies): every state-changing
// request must carry the custom header X-Connectly-CSRF: 1 (cannot be set cross-site
// without a CORS preflight, which we never allow) and, if present, a same-origin Origin.
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-connectly-csrf') !== '1') return res.status(403).json({ error: 'CSRF check failed' });
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('x-forwarded-host') || req.get('host');
    try { if (new URL(origin).host !== host) return res.status(403).json({ error: 'CSRF origin mismatch' }); }
    catch { return res.status(403).json({ error: 'CSRF origin invalid' }); }
  }
  next();
}
