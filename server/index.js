import { startPricing } from './pricing.js';
import { purgeScheduledDeletions } from './app.js';
import { syncPaidBadges } from './paidverify.js';
import { encryptBacklog } from './msgcrypt.js';
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
