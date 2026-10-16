// Anti-scam helpers (client side; server never trusts these). Link risk: blocklist + heuristics. Message risk: money/OTP/crypto asks.
const BLOCK = ['grabify.link', 'iplogger.org', 'iplogger.com', '2no.co', 'blasze.com', 'bit-ly.co', 'free-robux', 'steamcommunlty', 'discord-nitro', 'airdrop-claim', 'wallet-connect', 'metamask-verify', 'paypal-secure', 'apple-id-verify'];
const SHORT = ['bit.ly', 'tinyurl.com', 't.co', 'cutt.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'tiny.cc', 'ow.ly', 's.id', 'rebrand.ly'];
const BAD_TLD = /\.(zip|mov|top|xyz|click|country|gq|tk|ml|cf|ga|work|rest|cam|loan|men|kim|buzz)$/i;
const BRANDS = ['paypal', 'apple', 'icloud', 'google', 'facebook', 'instagram', 'whatsapp', 'binance', 'coinbase', 'metamask', 'opay', 'palmpay', 'moniepoint', 'gtbank', 'firstbank', 'zenith', 'kuda', 'connectly', 'netflix', 'amazon', 'microsoft'];
export type Risk = { level: 'ok' | 'warn' | 'block'; why: string };
export function linkRisk(raw: string): Risk {
  let u: URL; try { u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); } catch { return { level: 'warn', why: 'This link looks broken.' }; }
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  if (h === location.hostname) return { level: 'ok', why: '' };
  if (BLOCK.some((b) => h.includes(b))) return { level: 'block', why: 'This link is on our list of known scam or tracking sites.' };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes('xn--')) return { level: 'warn', why: 'This link hides its real address, a common trick in scams.' };
  if (u.username || raw.includes('@') && !raw.startsWith('mailto:')) return { level: 'warn', why: 'This link hides where it really goes.' };
  const brand = BRANDS.find((b) => h.includes(b) && !new RegExp(`(^|\\.)${b}\\.(com|net|org|co|app|ng|co\\.uk)$`).test(h));
  if (brand) return { level: 'warn', why: `This link uses the name “${brand}” but isn’t their real website.` };
  if (SHORT.includes(h)) return { level: 'warn', why: 'Shortened links hide where they go.' };
  if (BAD_TLD.test(h)) return { level: 'warn', why: 'This kind of web address is often used for scams.' };
  if (u.protocol === 'http:') return { level: 'warn', why: 'This link isn’t secure (no https).' };
  return { level: 'ok', why: '' };
}
const ASK = /\b(otp|one[- ]time (pass)?code|verification code|pin code|your pin|password|bank (details|account)|account number|bvn|nin\b|card number|cvv|send (me )?money|transfer (me|the)|western union|gift ?cards?|crypto|bitcoin|btc|usdt|ethereum|wallet address|seed phrase|recovery phrase|invest(ment)?|forex|double your (money|investment)|guaranteed (profit|returns)|wire (me|the money)|cash ?app|pay (a )?fee to (claim|release)|you (have )?won|lottery|giveaway winner)\b/i;
export const scamAsk = (text: string) => ASK.test(text);
export const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;
