// Pluggable SMS provider. Configure SMS_PROVIDER=termii (TERMII_API_KEY, TERMII_SENDER_ID)
// or SMS_PROVIDER=twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
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
};
export const testSmsOutbox = [];
const provider = providers[e.SMS_PROVIDER];
export const smsConfigured = () => config.isTest ? e.TEST_SMS === '1' : Boolean(provider?.ok());
export async function sendSms(to, text) {
  if (config.isTest) { testSmsOutbox.push({ to, text }); return; }
  if (!smsConfigured()) throw new Error('SMS not configured');
  await provider.send(to, text);
  console.log(`[sms:sent] to=${to.slice(0, -4)}****`);
}
