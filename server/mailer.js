// Pluggable mailer. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (e.g. Brevo: smtp-relay.brevo.com:587).
// If SMTP is not configured, messages are logged server-side instead (dev / not-yet-configured mode).
import nodemailer from 'nodemailer';
import { config } from './config.js';
const e = process.env;
export const smtpConfigured = Boolean(e.SMTP_HOST && e.SMTP_FROM);
const transport = smtpConfigured ? nodemailer.createTransport({
  host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 587), secure: Number(e.SMTP_PORT) === 465,
  auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
}) : null;
export const testOutbox = []; // populated only in NODE_ENV=test
export async function sendMail({ to, subject, text }) {
  if (config.isTest) { testOutbox.push({ to, subject, text }); return; }
  if (!transport) { console.log(`[mail:NOT-CONFIGURED] to=${to} subject="${subject}"\n${text}`); return; }
  await transport.sendMail({ from: e.SMTP_FROM, to, subject, text });
}
