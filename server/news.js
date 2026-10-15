// News (flag FEATURE_NEWS): headlines from free public RSS feeds. We keep only headline, a short summary line,
// source, image and a link out to the publisher; full articles are never copied. Feeds are cached server-side and
// refreshed every 15 minutes. Personalisation uses only in-app signals (interests, searches, likes, follows in Connectly).
import { regionOf } from './pricing.js';
import sharp from 'sharp';
import { q } from './db.js';
import { config } from './config.js';

const BBC = (p) => `https://feeds.bbci.co.uk/${p}/rss.xml`;
export const FEEDS = {
  bbc_world: { url: BBC('news/world'), source: 'BBC News', topic: 'world' },
  bbc_business: { url: BBC('news/business'), source: 'BBC News', topic: 'business' },
  bbc_tech: { url: BBC('news/technology'), source: 'BBC News', topic: 'technology' },
  bbc_science: { url: BBC('news/science_and_environment'), source: 'BBC News', topic: 'science' },
  bbc_health: { url: BBC('news/health'), source: 'BBC News', topic: 'health' },
  bbc_ent: { url: BBC('news/entertainment_and_arts'), source: 'BBC News', topic: 'entertainment' },
  bbc_sport: { url: 'https://feeds.bbci.co.uk/sport/rss.xml', source: 'BBC Sport', topic: 'sports' },
  aljazeera: { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera', topic: 'world' },
  guardian_world: { url: 'https://www.theguardian.com/world/rss', source: 'The Guardian', topic: 'world' },
  dw: { url: 'https://rss.dw.com/rdf/rss-en-all', source: 'DW', topic: 'world' },
  npr: { url: 'https://feeds.npr.org/1001/rss.xml', source: 'NPR', topic: 'world' },
  // Local / language editions
  bbc_africa: { url: BBC('news/world/africa'), source: 'BBC Africa', topic: 'africa', region: ['NG', 'GH', 'KE', 'ZA'] },
  premium_times: { url: 'https://www.premiumtimesng.com/feed', source: 'Premium Times', topic: 'local', region: ['NG'] },
  bbc_pidgin: { url: BBC('pidgin'), source: 'BBC Pidgin', topic: 'local', region: ['NG'] },
  bbc_yoruba: { url: BBC('yoruba'), source: 'BBC Yorùbá', topic: 'local', lang: 'yo' },
  bbc_hausa: { url: BBC('hausa'), source: 'BBC Hausa', topic: 'local', lang: 'ha' },
  bbc_igbo: { url: BBC('igbo'), source: 'BBC Igbo', topic: 'local', lang: 'ig' },
  bbc_swahili: { url: BBC('swahili'), source: 'BBC Swahili', topic: 'local', lang: 'sw' },
  bbc_arabic: { url: BBC('arabic'), source: 'BBC عربي', topic: 'local', lang: 'ar' },
  bbc_mundo: { url: BBC('mundo'), source: 'BBC Mundo', topic: 'local', lang: 'es' },
  bbc_afrique: { url: BBC('afrique'), source: 'BBC Afrique', topic: 'local', lang: 'fr' },
  bbc_brasil: { url: BBC('portuguese'), source: 'BBC Brasil', topic: 'local', lang: 'pt' },
  bbc_hindi: { url: BBC('hindi'), source: 'BBC हिंदी', topic: 'local', lang: 'hi' },
  bbc_zh: { url: BBC('zhongwen/simp'), source: 'BBC 中文', topic: 'local', lang: 'zh' },
  bbc_ru: { url: BBC('russian'), source: 'BBC Русская служба', topic: 'local', lang: 'ru' },
  bbc_id: { url: BBC('indonesia'), source: 'BBC Indonesia', topic: 'local', lang: 'id' },
  bbc_tr: { url: BBC('turkce'), source: 'BBC Türkçe', topic: 'local', lang: 'tr' },
  dw_de: { url: 'https://rss.dw.com/rdf/rss-de-all', source: 'DW Deutsch', topic: 'local', lang: 'de' },
  bbc_ja: { url: BBC('japanese'), source: 'BBC Japanese', topic: 'local', lang: 'ja' },
  bbc_ko: { url: BBC('korean'), source: 'BBC Korean', topic: 'local', lang: 'ko' },
};
const GLOBAL = ['bbc_world', 'bbc_business', 'bbc_tech', 'bbc_science', 'bbc_health', 'bbc_ent', 'bbc_sport', 'aljazeera', 'guardian_world', 'dw', 'npr'];
const cache = new Map(); // key -> { at, items }
const REFRESH = 15 * 60e3;
const ent = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? ent(m[1]) : ''; };
export function parseFeed(xml, key) {
  const f = FEEDS[key]; const out = [];
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const x = m[0]; const title = tag(x, 'title'); let link = tag(x, 'link') || (x.match(/<link[^>]+href="([^"]+)"/i) || [])[1] || '';
    if (!title || !/^https:\/\//.test(link)) continue;
    const imgs = [...x.matchAll(/<(?:media:thumbnail|media:content|enclosure)[^>]+url="([^"]+)"[^>]*>/gi)].map((r) => r[1].replace(/&amp;/g, '&')).filter((u) => /^https:\/\//.test(u) && !/\.(mp3|mp4)(\?|$)/i.test(u));
    const when = Date.parse(tag(x, 'pubDate') || tag(x, 'dc:date') || tag(x, 'published') || tag(x, 'updated')) || Date.now();
    out.push({ id: Buffer.from(link).toString('base64url').slice(-24), title: title.slice(0, 220), summary: tag(x, 'description').slice(0, 180), link, image: imgs.at(-1) || null, source: f.source, topic: f.topic, published_at: new Date(when).toISOString() });
  }
  return out.slice(0, 40);
}
async function get(url, ms = 9000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'ConnectlyNews/1.0 (+headlines only)', Accept: 'application/rss+xml, application/xml, text/xml, */*' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }
async function loadFeed(key) {
  const c = cache.get(key); if (c && Date.now() - c.at < REFRESH) return c.items;
  try {
    const items = parseFeed(await (await get(FEEDS[key].url)).text(), key);
    // Feeds without images: read the article's public og:image tag (first few only).
    await Promise.all(items.filter((i) => !i.image).slice(0, 8).map(async (i) => { try { const h = (await (await get(i.link, 5000)).text()).slice(0, 200000); i.image = (h.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || h.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i) || [])[1]?.replace(/&amp;/g, '&') || null; } catch { /* no image */ } }));
    cache.set(key, { at: Date.now(), items }); return items;
  } catch (e) { console.warn('[news] feed failed', key, e.message); return c?.items || []; }
}
export function startNewsRefresh() {
  const run = () => Promise.all(GLOBAL.map(loadFeed)).catch(() => {});
  run(); setInterval(run, REFRESH).unref();
}

const TOPIC_WORDS = { technology: ['tech', 'ai', 'coding', 'gadgets', 'gaming', 'startup', 'science'], sports: ['football', 'sport', 'soccer', 'basketball', 'fitness', 'f1', 'tennis'], entertainment: ['music', 'movies', 'film', 'art', 'fashion', 'celebrity', 'nollywood', 'tv'], business: ['business', 'finance', 'money', 'crypto', 'economy', 'jobs'], health: ['health', 'wellness', 'food', 'fitness'], science: ['science', 'space', 'climate', 'nature', 'environment'] };
async function signals(uid) {
  const { rows: [u] } = await q(`SELECT u.locale, u.location, u.interests,
      (SELECT array_agg(term) FROM (SELECT term FROM search_history WHERE user_id = u.id ORDER BY created_at DESC LIMIT 20) s) AS searches,
      (SELECT array_agg(DISTINCT h.tag) FROM post_likes l JOIN post_hashtags h ON h.post_id = l.post_id WHERE l.user_id = u.id AND l.created_at > now() - interval '60 days') AS liked_tags,
      (SELECT array_agg(DISTINCT h.tag) FROM follows f JOIN posts p ON p.author_id = f.followee_id JOIN post_hashtags h ON h.post_id = p.id WHERE f.follower_id = u.id AND p.created_at > now() - interval '30 days') AS follow_tags
    FROM users u WHERE u.id = $1`, [uid]).catch(() => ({ rows: [{}] }));
  return u || {};
}
const region = (s) => (/nigeria|lagos|abuja|ibadan|kano|port harcourt|enugu|\bng\b/i.test(s.location || '') || ['yo', 'ha', 'ig'].includes(s.locale) ? 'NG' : /ghana|accra/i.test(s.location || '') ? 'GH' : /kenya|nairobi/i.test(s.location || '') ? 'KE' : /south africa|johannesburg|cape town/i.test(s.location || '') ? 'ZA' : null);
export async function newsFor(uid, { limit = 12, topic, country } = {}) {
  const s = await signals(uid); const reg = region(s) || (['NG', 'GH', 'KE', 'ZA'].includes(country) ? country : null); // country: light hint from private detection
  const keys = [...GLOBAL, ...Object.keys(FEEDS).filter((k) => (FEEDS[k].lang && FEEDS[k].lang === s.locale) || (reg && FEEDS[k].region?.includes(reg)))];
  const all = (await Promise.all(keys.map(loadFeed))).flat();
  const words = [...(Array.isArray(s.interests) ? s.interests : []), ...(s.searches || []), ...(s.liked_tags || []), ...(s.follow_tags || [])].map((w) => String(w).toLowerCase()).filter((w) => w.length > 2).slice(0, 80);
  const topics = new Set(Object.entries(TOPIC_WORDS).filter(([, ws]) => ws.some((w) => words.some((x) => x.includes(w)))).map(([t]) => t));
  const seen = new Set(); const now = Date.now();
  const fresh = (i) => now - Date.parse(i.published_at) < 48 * 36e5; // stale news (older than 48 hours) is hidden
  const scored = all.filter((i) => fresh(i) && (!topic || i.topic === topic) && !seen.has(i.title) && seen.add(i.title)).map((i) => {
    const t = (i.title + ' ' + i.summary).toLowerCase(); const ageH = Math.max(0, (now - Date.parse(i.published_at)) / 36e5);
    let score = 10 / (ageH + 2) + (i.image ? 0.6 : 0);
    if (topics.has(i.topic)) score += 1.2; if (i.topic === 'local' || i.topic === 'africa') score += reg || s.locale !== 'en' ? 1.5 : 0;
    for (const w of words) if (t.includes(w)) score += 0.8;
    return { ...i, score };
  }).sort((a, b) => b.score - a.score);
  // Keep variety: at most 3 in a row from one source.
  const out = []; const per = {}; for (const i of scored) { if ((per[i.source] = (per[i.source] || 0) + 1) > Math.ceil(limit / 3)) continue; const { score, ...rest } = i; out.push({ ...rest, image: rest.image ? `/api/news/img?u=${encodeURIComponent(rest.image)}` : null }); if (out.length >= limit) break; }
  return out;
}

// Images are proxied (resized, cached) so publishers never see who is reading and our CSP stays strict.
const imgCache = new Map();
const ALLOWED_IMG = /^https:\/\/([a-z0-9-]+\.)*(bbci\.co\.uk|bbc\.co\.uk|aljazeera\.com|guim\.co\.uk|guardian\.co\.uk|dw\.com|npr\.org|npr\.brightspotcdn\.com|premiumtimesng\.com|wp\.com|akamaized\.net|brightspotcdn\.com)\//i;
export function registerNews(api, { requireAuth }) {
  const on = (_q, res, next) => (config.features.news ? next() : res.status(404).json({ error: 'Not found' }));
  api.get('/news', requireAuth, on, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 30);
    res.set('Cache-Control', 'private, max-age=300').json({ items: await newsFor(req.user.id, { limit, country: config.features.localCurrency ? (await regionOf(req)).country : undefined, topic: typeof req.query.topic === 'string' ? req.query.topic : undefined }) });
  });
  api.get('/news/img', on, async (req, res) => {
    const u = String(req.query.u || ''); if (!ALLOWED_IMG.test(u)) return res.status(404).end();
    let hit = imgCache.get(u);
    if (!hit) {
      try { const buf = Buffer.from(await (await get(u, 8000)).arrayBuffer()); if (buf.length > 8e6) throw new Error('big'); hit = await sharp(buf).resize(720, 720, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer(); }
      catch { return res.status(404).end(); }
      imgCache.set(u, hit); if (imgCache.size > 400) imgCache.delete(imgCache.keys().next().value);
    }
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400' }).send(hit);
  });
}
// Record a search term for personalisation (kept short; included in the data export; never shared).
export async function recordSearch(uid, term) {
  if (!config.features.news || !term || term.length < 3) return;
  await q('INSERT INTO search_history (user_id, term) VALUES ($1, $2)', [uid, term.toLowerCase().slice(0, 80)]).catch(() => {});
  await q('DELETE FROM search_history WHERE user_id = $1 AND id NOT IN (SELECT id FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50)', [uid]).catch(() => {});
}
