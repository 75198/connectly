// Web push (round 7, FEATURE_PUSH). VAPID keys live only in .env. Never throws.
import webpush from 'web-push';
import { q } from './db.js';
import { config } from './config.js';

export const pushConfigured = () => !!(config.features.push && config.vapidPublic && config.vapidPrivate);
let ready = false;
function init() {
  if (ready || !pushConfigured()) return ready;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate); ready = true; return ready;
}
export const sentPushes = []; // test only
// payload: { title, body, url, tag }
export async function pushTo(userId, payload) {
  try {
    if (config.isTest) { sentPushes.push({ userId, ...payload }); }
    if (!init()) return;
    const { rows } = await q('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
    await Promise.all(rows.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 })
      .catch((e) => { if (e.statusCode === 404 || e.statusCode === 410) return q('DELETE FROM push_subscriptions WHERE id = $1', [s.id]); })));
  } catch (e) { console.error('[push]', e.message); }
}
