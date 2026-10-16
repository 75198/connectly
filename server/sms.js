// Pluggable phone-code delivery: WhatsApp (WA_TOKEN, WA_PHONE_NUMBER_ID, WA_AUTH_TEMPLATE) -> Telegram Gateway (TELEGRAM_GATEWAY_TOKEN)
// -> SMS: SMS_PROVIDER=termii (TERMII_API_KEY, TERMII_SENDER_ID) | africastalking (AT_API_KEY, AT_USERNAME, AT_SENDER_ID) | twilio (TWILIO_*).
// When unconfigured, phone sign-up is disabled server-side (never faked).
import { config } from './config.js';
const e = process.env;
const providers = {
  termii: {
    ok: () => Boolean(e.TERMII_API_KEY && e.TERMII_SENDER_ID),
    send: async (to, text) => {
      const r = await fetch(`${e.TERMII_BASE_URL || 'https://api.ng.termii.com'}/api/sms/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: e.TERMII_API_KEY, to: to.replace('+', ''), from: e.TERMII_SENDER_ID, sms: text, type: 'plain', channel: 'generic' }) });
      if (!r.ok) throw new Error(`Termii ${r.status}`);
    },
  },
  twilio: {
    ok: () => Boolean(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM),
    send: async (to, text) => {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: e.TWILIO_FROM, Body: text }) });
      if (!r.ok) throw new Error(`Twilio ${r.status}`);
    },
  },
  africastalking: {
    ok: () => Boolean(e.AT_API_KEY && e.AT_USERNAME),
    send: async (to, text) => {
      const r = await fetch('https://api.africastalking.com/version1/messaging', { method: 'POST', headers: { apiKey: e.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: e.AT_USERNAME, to, message: text, ...(e.AT_SENDER_ID ? { from: e.AT_SENDER_ID } : {}) }) });
      if (!r.ok) throw new Error(`AfricasTalking ${r.status}`);
    },
  },
};
// One-time-code channels, tried in this order: WhatsApp Cloud API (authentication template), Telegram Gateway, then SMS.
const otpChannels = [
  { name: 'whatsapp', ok: () => Boolean(e.WA_TOKEN && e.WA_PHONE_NUMBER_ID && e.WA_AUTH_TEMPLATE),
    send: async (to, code) => {
      const r = await fetch(`https://graph.facebook.com/v20.0/${e.WA_PHONE_NUMBER_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${e.WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'template', template: { name: e.WA_AUTH_TEMPLATE, language: { code: e.WA_TEMPLATE_LANG || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }] } }) });
      if (!r.ok) throw new Error(`WhatsApp ${r.status}`);
    } },
  { name: 'telegram', ok: () => Boolean(e.TELEGRAM_GATEWAY_TOKEN),
    send: async (to, code) => {
      const r = await fetch('https://gatewayapi.telegram.org/sendVerificationMessage', { method: 'POST', headers: { Authorization: `Bearer ${e.TELEGRAM_GATEWAY_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_number: to, code, ttl: 600 }) });
      const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(`Telegram ${r.status} ${j.error || ''}`.trim());
      if (j.result?.remaining_balance != null) await noteBalance('telegram', Number(j.result.remaining_balance), 'USD');
    } },
  { name: 'sms', ok: () => Boolean(smsProvider()?.ok()), send: async (to, code, text) => smsProvider().send(to, text || `Connectly code: ${code}`) },
];
export const testSmsOutbox = [];
// SMS_PROVIDER picks one (termii, africastalking, twilio); otherwise the first configured one is used.
const smsProvider = () => providers[e.SMS_PROVIDER] || Object.values(providers).find((p) => p.ok());
export const smsConfigured = () => config.isTest ? e.TEST_SMS === '1' : otpChannels.some((c) => c.ok());
// Phone sign-up / login / linking is on only when the feature flag is on AND a provider is configured.
export const phoneEnabled = () => Boolean(config.features.phoneAuth) && smsConfigured();
export async function sendSms(to, text, code) {
  if (config.isTest) { testSmsOutbox.push({ to, text }); return; }
  let last; for (const c of otpChannels) { if (!c.ok()) continue; try { await c.send(to, code || (text.match(/\d{6}/) || [''])[0], text); console.log(`[otp:${c.name}] to=${to.slice(0, -4)}****`); return; } catch (err) { last = err; console.warn(`[otp:${c.name}] failed, trying next`); await noteError(c.name, err).catch(() => {}); } }
  throw last || new Error('No phone code channel configured');
}

// ---- channel health: balances and failures, for admin alerts and owner emails ----
import { q } from './db.js';
const LOW = Number(e.OTP_LOW_BALANCE || 5);
async function noteBalance(channel, balance, currency) {
  await q(`INSERT INTO otp_channel_status (channel, balance, currency, low, checked_at) VALUES ($1,$2,$3,$4, now())
    ON CONFLICT (channel) DO UPDATE SET balance = $2, currency = $3, low = $4, checked_at = now()`, [channel, balance, currency, balance < LOW]);
}
async function noteError(channel, err) {
  const msg = String(err?.message || err).slice(0, 200); const empty = /402|insufficient|balance|credit/i.test(msg);
  await q(`INSERT INTO otp_channel_status (channel, last_error, last_error_at, low) VALUES ($1,$2, now(), $3)
    ON CONFLICT (channel) DO UPDATE SET last_error = $2, last_error_at = now(), low = otp_channel_status.low OR $3`, [channel, msg, empty]);
}
// Balance checks where the provider has an API for it (Telegram reports it on each send; WhatsApp is billed by Meta).
const balanceChecks = {
  termii: async () => { const r = await fetch(`${e.TERMII_BASE_URL || 'https://api.ng.termii.com'}/api/get-balance?api_key=${encodeURIComponent(e.TERMII_API_KEY)}`); const j = await r.json(); return [Number(j.balance), j.currency]; },
  africastalking: async () => { const r = await fetch(`https://api.africastalking.com/version1/user?username=${encodeURIComponent(e.AT_USERNAME)}`, { headers: { apiKey: e.AT_API_KEY, Accept: 'application/json' } }); const j = await r.json(); const [cur, amt] = String(j.UserData?.balance || '').split(' '); return [Number(amt), cur]; },
  twilio: async () => { const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Balance.json`, { headers: { Authorization: 'Basic ' + Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64') } }); const j = await r.json(); return [Number(j.balance), j.currency]; },
};
export async function checkOtpBalances(alertOwner) {
  if (!config.features.phoneAuth) return;
  for (const [name, p] of Object.entries(providers)) { if (!p.ok() || !balanceChecks[name]) continue; try { const [b, c] = await balanceChecks[name](); if (Number.isFinite(b)) await noteBalance('sms:' + name, b, c); } catch (err) { await noteError('sms:' + name, err); } }
  const { rows } = await q("SELECT channel, balance, currency, last_error FROM otp_channel_status WHERE low AND (alerted_at IS NULL OR alerted_at < now() - interval '24 hours')");
  if (!rows.length) return;
  await alertOwner('Connectly: phone code balance is low', `These phone-code channels are low on balance or failing:\n\n${rows.map((r) => `- ${r.channel}: ${r.balance != null ? `${r.balance} ${r.currency || ''}` : 'unknown balance'}${r.last_error ? ` (last error: ${r.last_error})` : ''}`).join('\n')}\n\nCodes fall back to the next channel (then email) until you top up.`);
  await q('UPDATE otp_channel_status SET alerted_at = now() WHERE channel = ANY($1)', [rows.map((r) => r.channel)]);
}
export async function otpStatus() { const { rows } = await q('SELECT channel, balance, currency, low, last_error, last_error_at, checked_at FROM otp_channel_status ORDER BY channel'); return rows; }
