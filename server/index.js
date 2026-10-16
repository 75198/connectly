import { startPricing } from './pricing.js';
import { purgeScheduledDeletions } from './app.js';
import { syncPaidBadges } from './paidverify.js';
import { encryptBacklog } from './msgcrypt.js';
import { checkOtpBalances } from './sms.js';
import { q } from './db.js';
import { sendMail } from './mailer.js';
// Owner alerts go to OWNER_EMAIL, or to every admin if it isn't set.
const alertOwner = async (subject, text) => { const to = process.env.OWNER_EMAIL ? [process.env.OWNER_EMAIL] : (await q("SELECT u.email FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin' AND u.email IS NOT NULL")).rows.map((r) => r.email); for (const t of to) await sendMail({ to: t, subject, text }).catch(() => {}); };
setInterval(() => checkOtpBalances(alertOwner).catch((e) => console.error('[otp-balance]', e.message)), 3600e3).unref();
import { createApp } from './app.js';
import { config } from './config.js';
import { startPurgeJob } from './postextras.js';
createApp().listen(config.port, '0.0.0.0', () => console.log(`Connectly listening on :${config.port}`));
startPurgeJob(); setInterval(() => purgeScheduledDeletions().catch(() => {}), 3600e3).unref(); setInterval(() => syncPaidBadges().catch(() => {}), 600e3).unref();
setInterval(() => encryptBacklog().catch((e) => console.error('[msg-encrypt]', e.message)), 60e3).unref(); // encrypt older messages gradually // hourly: purge posts deleted > 30 days ago and expired stories
import { sendEventReminders } from './round7.js';
import { notify } from './social.js';
import { syncMusic } from './music/index.js';
import { startAiWarmup } from './ai.js';
setInterval(() => sendEventReminders(notify).catch((e) => console.error('event reminders failed', e.message)), 5 * 60 * 1000).unref();
if (config.features.music) syncMusic().then((n) => console.log('music tracks synced:', n)).catch((e) => console.error('music sync failed', e.message));
if (config.features.aiSupport) startAiWarmup(); // keeps the Groq connection warm so first words arrive fast
import { sweepDisappearing } from './round9.js';
if (config.features.disappearing) setInterval(() => sweepDisappearing().catch((e) => console.error('disappearing sweep failed', e.message)), 60 * 1000).unref();
import { startNewsRefresh } from './news.js';
if (config.features.news) startNewsRefresh(); startPricing(); // RSS headlines cached in memory, refreshed every 20 minutes
