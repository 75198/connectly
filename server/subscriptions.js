// Subscription tiers (round 6, migration 014, flag FEATURE_SUBSCRIPTIONS).
// Users never see numeric limits: plan responses to users omit ai_hourly; limits only surface as friendly notices.
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { regionOf, priceFor } from './pricing.js';
import { activeProvider, providerSummary } from './payments/index.js';

export const TIERS = ['free', 'pro', 'premium'];

export async function tierOf(userId) {
  if (!config.features.subscriptions) return 'free';
  const { rows } = await q("SELECT tier FROM user_subscriptions WHERE user_id = $1 AND status IN ('active', 'past_due')", [userId]);
  return rows[0]?.tier || 'free';
}
// Connectly AI hourly allowance for a user (falls back to AI_USER_HOURLY when subscriptions are off).
export async function aiHourlyFor(userId) {
  if (!config.features.subscriptions) return config.aiUserHourly;
  const { rows } = await q('SELECT p.ai_hourly FROM plans p WHERE p.code = $1', [await tierOf(userId)]);
  return rows[0]?.ai_hourly ?? config.aiUserHourly;
}
const publicPlan = (p) => ({ code: p.code, name: p.name, price_minor: p.price_minor, currency: p.currency, billing_interval: p.billing_interval, perks: p.perks });

export function registerSubscriptions(api, { requireAuth, requireAdmin, id }) {
  const on = (_req, res, next) => (config.features.subscriptions ? next() : res.status(404).json({ error: 'Not found' }));
  const checkoutEnabled = () => !!activeProvider();

  api.get('/subscriptions/plans', requireAuth, on, async (req, res) => {
    const { rows } = await q('SELECT * FROM plans ORDER BY sort');
    if (!config.features.localCurrency) return res.json({ items: rows.map(publicPlan), checkout_enabled: checkoutEnabled() });
    const region = await regionOf(req); const { rows: book } = await q("SELECT item, usd_cents FROM price_book WHERE item LIKE 'plan:%'");
    const items = await Promise.all(rows.map(async (p) => { const b = book.find((x) => x.item === `plan:${p.code}`);
      return { ...publicPlan(p), local: p.price_minor === 0 && !b?.usd_cents ? null : await priceFor(`plan:${p.code}`, b?.usd_cents != null ? b : { minor: p.price_minor, currency: p.currency }, region) }; }));
    res.json({ items, region, checkout_enabled: checkoutEnabled() });
  });
  api.get('/me/subscription', requireAuth, on, async (req, res) => {
    const { rows } = await q("SELECT tier, status, current_period_end, updated_at FROM user_subscriptions WHERE user_id = $1", [req.user.id]);
    const s = rows[0] || { tier: 'free', status: 'active', current_period_end: null };
    const { rows: [p] } = await q('SELECT * FROM plans WHERE code = $1', [s.tier]);
    res.json({ ...s, plan: publicPlan(p), checkout_enabled: checkoutEnabled() });
  });
  api.post('/subscriptions/checkout', requireAuth, on, async (req, res) => {
    const { plan, platform } = z.object({ plan: z.enum(['pro', 'premium']), platform: z.enum(['web', 'ios', 'android']).default('web') }).strict().parse(req.body);
    const prov = activeProvider(platform);
    if (!prov) return res.status(503).json({ error: 'Upgrades are coming soon.', coming_soon: true });
    const { rows: [p] } = await q('SELECT * FROM plans WHERE code = $1', [plan]);
    res.json(await prov.createCheckout({ user: req.user, plan: p, appUrl: config.appUrl }));
  });

  // ---- admin ----
  api.get('/admin/plans', requireAdmin, on, async (_req, res) => res.json({ items: (await q('SELECT * FROM plans ORDER BY sort')).rows, providers: providerSummary(), checkout_enabled: checkoutEnabled() }));
  api.put('/admin/plans/:code', requireAdmin, on, async (req, res) => {
    const code = z.enum(TIERS).parse(req.params.code);
    const d = z.object({ name: z.string().trim().min(1).max(40).optional(), price_minor: z.number().int().min(0).max(100000000).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), ai_hourly: z.number().int().min(0).max(10000).optional() }).strict().parse(req.body);
    const { rows } = await q(`UPDATE plans SET name = COALESCE($2, name), price_minor = COALESCE($3, price_minor), currency = COALESCE($4, currency), ai_hourly = COALESCE($5, ai_hourly), updated_at = now() WHERE code = $1 RETURNING *`,
      [code, d.name ?? null, d.price_minor ?? null, d.currency ?? null, d.ai_hourly ?? null]);
    res.json(rows[0]);
  });
  api.put('/admin/users/:id/subscription', requireAdmin, on, async (req, res) => {
    const uid = id(req.params.id);
    const { tier } = z.object({ tier: z.enum(TIERS) }).strict().parse(req.body);
    const { rows: [u] } = await q('SELECT id FROM users WHERE id = $1', [uid]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const from = await tierOf(uid);
    await q(`INSERT INTO user_subscriptions (user_id, tier, status, provider, set_by) VALUES ($1, $2, 'active', 'admin', $3)
      ON CONFLICT (user_id) DO UPDATE SET tier = $2, status = 'active', provider = 'admin', set_by = $3, updated_at = now()`, [uid, tier, req.user.id]);
    await q('INSERT INTO subscription_events (user_id, actor_id, event, from_tier, to_tier) VALUES ($1, $2, $3, $4, $5)', [uid, req.user.id, 'admin_set', from, tier]);
    res.json({ ok: true, tier });
  });
}
