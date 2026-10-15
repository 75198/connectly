import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';

export const COOKIE = 'cx_session';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

// Privacy: we no longer send user IPs to any third-party geolocation service. Login history keeps
// time, method and device; approx_location stays '' for new logins (old values are kept as-is).
export async function approxLocation() { return ''; }
export async function createSession(res, userId, ua, req = null, method = 'password') {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  const ip = req?.ip || null;
  await q('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)', [sha256(token), userId, expires, (ua || '').slice(0, 300), ip]);
  await q('INSERT INTO login_history (user_id, method, ip, user_agent) VALUES ($1,$2,$3,$4)', [userId, method, ip, (ua || '').slice(0, 300)]);
  setSessionCookie(res, token, expires);
}
const setSessionCookie = (res, token, expires) => res.cookie(COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', expires, path: '/' });

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
      `SELECT u.id, u.username, u.full_name, u.email, u.email_verified_at, u.locale, u.birth_date, u.country_override, u.currency_override, s.id AS session_id, s.acting_space_id, (s.last_seen_at < now() - interval '5 minutes') AS stale,
              COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.suspended_at IS NULL
        GROUP BY u.id, s.token_hash`, [sha256(t)]);
    req.user = rows[0] || null;
    // Sliding expiry: at most every 5 minutes, push expiry to now + sessionDays and refresh the cookie.
    if (req.user?.stale) {
      const expires = new Date(Date.now() + config.sessionDays * 864e5);
      q('UPDATE sessions SET last_seen_at = now(), expires_at = GREATEST(expires_at, $2) WHERE id = $1', [req.user.session_id, expires]).catch(() => {});
      setSessionCookie(_res, t, expires);
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}
export function requireVerified(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.email_verified_at) return res.status(403).json({ error: 'Please verify your email first', code: 'EMAIL_UNVERIFIED' });
  next();
}
export function requireModerator(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.roles.some((r) => r === 'admin' || r === 'moderator')) return res.status(403).json({ error: 'Moderators only' });
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
    // Behind the Codespaces proxy Host is rewritten, so also accept the configured public APP_URL host.
    const allowed = new Set([req.get('x-forwarded-host'), req.get('host'), new URL(config.appUrl).host].filter(Boolean));
    try { if (!allowed.has(new URL(origin).host)) return res.status(403).json({ error: 'CSRF origin mismatch' }); }
    catch { return res.status(403).json({ error: 'CSRF origin invalid' }); }
  }
  next();
}
