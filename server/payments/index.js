// Pluggable payment providers. No real payments are taken yet: every checkout says "Coming soon".
// Planned:
//  - app_store   : Apple App Store in-app purchases (StoreKit) for the iOS app; server verifies receipts / App Store Server Notifications.
//  - google_play : Google Play Billing for the Android app; server verifies purchase tokens / Real-time developer notifications.
//  - web         : optional web card processor for the browser (e.g. Paystack or Stripe), only if enabled.
// A provider is "configured" when its credentials are in .env; createCheckout/verify are intentionally unimplemented.
import { config } from '../config.js';

const notYet = async () => { const e = new Error('Upgrades are coming soon.'); e.status = 503; throw e; };
export const providers = {
  app_store: { id: 'app_store', name: 'App Store', platform: 'ios', configured: () => !!(config.appStoreIssuerId && config.appStoreKeyId && config.appStoreBundleId), createCheckout: notYet, verify: notYet },
  google_play: { id: 'google_play', name: 'Google Play', platform: 'android', configured: () => !!(config.googlePlayPackage && config.googlePlayServiceAccount), createCheckout: notYet, verify: notYet },
  web: { id: 'web', name: 'Card (web)', platform: 'web', configured: () => !!(config.webPaymentsEnabled && config.webPaymentsSecret), createCheckout: notYet, verify: notYet },
};
// Checkout stays disabled until a provider is both configured AND explicitly switched on (PAYMENTS_LIVE=1).
export function activeProvider(platform = 'web') {
  if (!config.paymentsLive) return null;
  const p = Object.values(providers).find((x) => x.platform === platform);
  return p && p.configured() ? p : null;
}
export function providerSummary() { return Object.values(providers).map((p) => ({ id: p.id, name: p.name, platform: p.platform, configured: p.configured() })); }
