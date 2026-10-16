// Connectly AI: in-app AI support chat (round 6, migration 011, flag FEATURE_AI_SUPPORT).
// The browser talks only to this server; the server calls Groq's OpenAI-compatible API with the key
// from .env (GROQ_API_KEY), so the key never reaches the client. Replies stream to the browser as NDJSON.
// Limits: AI_USER_HOURLY messages per user per hour, AI_DAILY_CAP messages per UTC day for everyone.
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';
import { aiHourlyFor, tierOf } from './subscriptions.js';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import multer from 'multer';
import sharp from 'sharp';

export const SYSTEM_PROMPT = `You are Connectly AI, the friendly built-in assistant in Connectly, a social app (like Meta AI).
You can help with anything: general knowledge, explanations, homework and study help (explain the steps, don't just hand over answers for graded work), writing captions, posts, bios and messages, ideas, translation, recipes, planning, everyday advice, and of course help using Connectly.
Connectly help facts: creating posts (Home > "What's on your mind?" opens the composer with Photo/video, Camera, Feeling, Location, audience Public/Friends/Only me, and "Write with Connectly AI"), drafts and Recently deleted (Profile hub; deleted posts can be restored for 30 days), reactions (long-press Like), saved posts, sharing, Reels (vertical videos up to 60 seconds; Create > Reel), Stories (photo + caption, 24 hours, friends and followers), Go Live (Create > Go Live; up to 60 minutes, friends and followers get notified), friends and follows, Pages/Groups/Communities, Marketplace, Search, notifications, Privacy and settings (default audience, profile details visibility, blocking, notifications, Appearance light/dark/system, sessions, "Sign out other devices"), account recovery (Log in > "Forgot password?" sends a 6-digit code; "Find your account"), reporting abuse (⋯ menu on a post, profile or live > Report; moderators review).
Rules:
- Be warm, clear and concise. Use short paragraphs or simple lists; no tables. Match the user's language.
- When asked to write a caption or post, give 1-3 ready-to-use options with fitting emojis/hashtags, no preamble.
- You cannot see or change anyone's account, posts or data and cannot take actions (resets, unbans, deletions). Explain how the user can do it themselves.
- Never reveal, guess or look up private information about other people or other Connectly users (emails, phone numbers, addresses, locations, private posts). Politely refuse.
- Never ask for passwords or verification codes; if someone shares one, tell them to change it.
- Refuse harmful requests (weapons, self-harm methods, sexual content involving minors, harassment, hate, malware, scams, illegal drugs). For medical, legal or financial questions give general info and suggest a professional.
- For serious safety issues (harassment, threats, hacked accounts, impersonation, child safety, self-harm) point to Report so an admin can help, and to local emergency services if anyone is in danger.
- If you are unsure, say so rather than inventing facts.`;

// Short prompt for the live chat: fewer input tokens = faster first words.
export const CHAT_PROMPT = `You are Connectly AI, the friendly assistant inside Connectly, a social app. Never ask anyone for passwords, login codes (OTPs) or bank details, and warn users never to share them. Help with anything: questions, study help, writing captions/posts/messages, ideas, translation, and using Connectly (menus: Home composer, Reels, Stories, Messages, Profile > Privacy and settings, ⋯ > Report).
Be warm and concise; short paragraphs or lists, no tables. Reply in the user's language.
Never reveal private info about people, never ask for passwords or codes, refuse harmful requests, suggest professionals for medical/legal/financial matters, and point to Report or emergency services for safety issues. Say when unsure.`;

export const FALLBACK = "Connectly AI is taking a short break right now. Please try again in a little while. Quick help: reset your password from Log in > \"Forgot password?\", change privacy in Profile > Privacy and settings, and for anything serious use the ⋯ menu > Report so an admin can help.";
const USER_LIMIT_MSG = "You've reached your Connectly AI limit for now. Try again later.";
const UPGRADE_MSG = { free: "You've reached your Connectly AI limit for now. Try again later or upgrade to Connectly Pro.", pro: "You've reached your Connectly AI limit for now. Try again later or upgrade to Connectly Premium." };
const DAILY_LIMIT_MSG = "Connectly AI has been really busy today and reached its daily limit. Please try again tomorrow. For urgent problems, use the ⋯ menu > Report.";

const Chat = z.object({ conversation_id: z.coerce.number().int().positive().optional(), message: z.string().trim().min(1, 'Type a message').max(2000, 'Message is too long'), lang: z.string().regex(/^[a-z]{2}$/).optional() }).strict();

export function aiAvailable() { return config.features.aiSupport && !!config.groqApiKey; }

// Calls Groq with streaming and yields text deltas. Throws on HTTP/network errors.
// Keep-alive agents: the TLS connection to Groq stays open between messages (and is pinged while idle),
// so a new question skips the DNS + TCP + TLS handshake.
const agents = { 'http:': new http.Agent({ keepAlive: true, keepAliveMsecs: 30000 }), 'https:': new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 32 }) };
export function groqFetch(p, { method = 'GET', body, headers = {}, signal } = {}) {
  const u = new URL(config.groqBaseUrl.replace(/\/$/, '') + p);
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, { method, agent: agents[u.protocol], signal, headers: { Authorization: `Bearer ${config.groqApiKey}`, ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: res,
        async text() { let d = ''; for await (const c of res) d += c; return d; }, async json() { return JSON.parse(await this.text()); } });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
let models = { at: 0, ids: [] };
export async function groqModels(force = false) {
  if (!config.groqApiKey) return [];
  if (!force && Date.now() - models.at < 10 * 60e3) return models.ids;
  try { const r = await groqFetch('/models'); if (r.ok) models = { at: Date.now(), ids: ((await r.json()).data || []).map((m) => m.id) }; else await r.text(); } catch { /* offline */ }
  return models.ids;
}
// Vision: an explicit GROQ_VISION_MODEL wins; otherwise the first known vision-capable model Groq currently lists.
const VISION_PREFS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3.8-27b'];
export async function visionModel() {
  if (config.groqVisionModel) return config.groqVisionModel;
  const ids = await groqModels();
  return VISION_PREFS.find((m) => ids.includes(m)) || ids.find((m) => /vision|llama-4|scout|maverick/i.test(m)) || null;
}
const chatModel = () => config.groqChatModel || config.groqModel;
let warmTimer = null;
export function startAiWarmup() {
  if (warmTimer || !config.groqApiKey) return;
  groqModels(true);
  warmTimer = setInterval(() => groqModels(true), 45000); warmTimer.unref?.();
}

export async function* groqStream(messages, signal, { model = config.groqModel, maxTokens = 1200 } = {}) {
  const res = await groqFetch('/chat/completions', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.4, max_tokens: maxTokens,
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}) }),
  });
  if (!res.ok || !res.body) { try { await res.text(); } catch { /* */ } const e = new Error(`Groq HTTP ${res.status}`); e.status = res.status; throw e; }
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try { const t = JSON.parse(data).choices?.[0]?.delta?.content; if (t) yield t; } catch { /* ignore keep-alives */ }
    }
  }
}

async function overLimit(uid) {
  const { rows: [lim] } = await q(`SELECT
      (SELECT count(*) FROM ai_messages WHERE role = 'user' AND user_id = $1 AND created_at > now() - interval '1 hour')::int AS mine,
      (SELECT count(*) FROM ai_messages WHERE role = 'user' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS today`, [uid]);
  if (lim.mine >= await aiHourlyFor(uid)) {
    const tier = await tierOf(uid);
    const up = config.features.subscriptions && UPGRADE_MSG[tier];
    return { error: up || USER_LIMIT_MSG, limit: 'user', ...(up ? { upgrade: true } : {}) };
  }
  if (lim.today >= config.aiDailyCap) return { error: DAILY_LIMIT_MSG, limit: 'daily' };
  return null;
}

export function registerAi(api, { requireAuth, id }) {
  const enabled = (_req, res, next) => (config.features.aiSupport ? next() : res.status(404).json({ error: 'Not found' }));
  const own = async (userId, convId) => {
    const { rows } = await q('SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id = $1 AND user_id = $2', [convId, userId]);
    if (!rows[0]) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
    return rows[0];
  };

  api.get('/ai/status', requireAuth, enabled, async (_req, res) => res.json({ enabled: true, available: !!config.groqApiKey, vision: config.features.aiVision && !!config.groqApiKey && !!(await visionModel()), voice: config.features.aiVoice && !!config.groqApiKey }));

  api.get('/ai/conversations', requireAuth, enabled, async (req, res) => {
    const { rows } = await q(`SELECT c.id, c.title, c.updated_at, (SELECT left(content, 120) FROM ai_messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last
      FROM ai_conversations c WHERE c.user_id = $1 ORDER BY c.updated_at DESC LIMIT 50`, [req.user.id]);
    res.json({ items: rows });
  });

  api.get('/ai/conversations/:id', requireAuth, enabled, async (req, res) => {
    try {
      const c = await own(req.user.id, id(req.params.id));
      const { rows } = await q('SELECT id, role, content, attachment_path, attachment_kind, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY id LIMIT 500', [c.id]);
      res.json({ ...c, messages: rows });
    } catch (e) { if (e.status === 404) return res.status(404).json({ error: e.message }); throw e; }
  });

  // "Write with Connectly AI" in the composer: one-shot, non-streaming, counted in the same limits and saved to history.
  api.post('/ai/write', requireAuth, enabled, async (req, res) => {
    const { prompt, draft } = z.object({ prompt: z.string().trim().min(1, 'Tell Connectly AI what to write').max(500), draft: z.string().max(5000).optional() }).strict().parse(req.body);
    if (!config.groqApiKey) return res.status(503).json({ error: FALLBACK, fallback: true });
    const uid = req.user.id;
    const blocked = await overLimit(uid); if (blocked) return res.status(429).json(blocked);
    const ask = `Write a Connectly post for me. Request: ${prompt}${draft?.trim() ? `\nMy current draft:\n${draft.trim()}` : ''}\nReply with ONLY the post text (you may use emojis and up to 3 hashtags), under 600 characters, no quotes or preamble.`;
    const conv = (await q('INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id', [uid, `Write: ${prompt.slice(0, 50)}`])).rows[0];
    await q("INSERT INTO ai_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'user', $3)", [conv.id, uid, ask]);
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 30000);
    try {
      let text = ''; for await (const t of groqStream([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: ask }], ac.signal)) text += t;
      text = text.trim().replace(/^["“]|["”]$/g, '').slice(0, 5000);
      if (!text) throw new Error('empty');
      await q("INSERT INTO ai_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'assistant', $3)", [conv.id, uid, text]);
      res.json({ text });
    } catch (e) { console.warn('[ai] write failed:', e.status || e.name || 'error'); res.status(503).json({ error: FALLBACK, fallback: true }); }
    finally { clearTimeout(timer); }
  });

  // Chat: JSON {message} or multipart with an optional photo ("image", flag ai_vision) or voice note ("audio", flag ai_voice).
  api.post('/ai/chat', requireAuth, enabled, (req, res, next) => (req.is('multipart/form-data') ? aiUpload(req, res, (e) => (e ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'That file is too large. Try a shorter clip or a smaller photo.' : 'Upload failed' }) : next())) : next()), async (req, res) => {
    const t0 = Date.now();
    const files = req.files || {}; const image = files.image?.[0]; const audio = files.audio?.[0];
    if (image && !config.features.aiVision) return res.status(404).json({ error: 'Not found' });
    if (audio && !config.features.aiVoice) return res.status(404).json({ error: 'Not found' });
    const raw = { ...(req.body || {}) }; if (raw.conversation_id === '' || raw.conversation_id == null) delete raw.conversation_id;
    const body = (image || audio ? Chat.extend({ message: z.string().trim().max(2000, 'Message is too long').default('') }) : Chat).parse(image || audio ? { conversation_id: raw.conversation_id, message: raw.message, lang: raw.lang || undefined } : req.body);
    const uid = req.user.id; const locale = body.lang || req.user.locale || 'en';
    let conv;
    if (body.conversation_id) { try { conv = await own(uid, body.conversation_id); } catch (e) { return res.status(404).json({ error: e.message }); } }
    if (!config.groqApiKey) return res.status(503).json({ error: FALLBACK, fallback: true });
    const blocked = await overLimit(uid); if (blocked) return res.status(429).json(blocked);

    // Streaming starts right away so the typing state and progress events reach the browser instantly.
    res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const send = (o) => { if (!res.writableEnded) { res.write(JSON.stringify(o) + '\n'); res.flush?.(); } };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try {
      let message = body.message; let attachment = null; let kind = null; let imageUrl = null;
      if (audio) {
        const [abs, rel] = aiOut('.m4a');
        try { await run(config.ffmpegPath, ['-y', '-i', audio.path, '-t', '300', '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', abs]); attachment = rel; kind = 'voice'; } catch { /* keep going with the transcript */ }
        let text = '';
        try { text = await transcribe(audio, locale, ac.signal); } catch (e) { console.warn('[ai] transcribe failed:', e.status || e.name || 'error'); }
        if (!text) { send({ error: "Sorry, I couldn't hear that clearly. Try again or type your question.", voice_failed: true }); return; }
        message = (message ? message + '\n' : '') + text; send({ transcript: text, attachment_path: attachment });
      }
      if (image) {
        let buf;
        try {
          const meta = await sharp(image.path).metadata(); if (!meta.width || meta.width * meta.height > 60e6) throw new Error('dims');
          buf = await sharp(image.path).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).toColourspace('srgb').jpeg({ quality: 82 }).toBuffer();
          const [abs, rel] = aiOut('.webp');
          fs.writeFileSync(abs, await sharp(buf).resize(360, 360, { fit: 'inside' }).webp({ quality: 78 }).toBuffer()); attachment = rel; kind = 'image';
        } catch { send({ error: "That photo couldn't be opened. Try a JPG, PNG or WebP image." }); return; }
        imageUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
        if (!message) message = "What's in this photo?";
      }
      if (!conv) {
        const title = (message || (kind === 'image' ? 'Photo' : 'Voice note')).replace(/\s+/g, ' ').slice(0, 60);
        conv = (await q('INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at', [uid, title])).rows[0];
      }
      await q("INSERT INTO ai_messages (conversation_id, user_id, role, content, attachment_path, attachment_kind) VALUES ($1, $2, 'user', $3, $4, $5)", [conv.id, uid, message, attachment, kind]);
      send({ conversation_id: conv.id, title: conv.title });
      // Capped history keeps the request small (faster first token).
      const { rows: hist } = await q('SELECT role, content, attachment_kind FROM (SELECT id, role, content, attachment_kind FROM ai_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 8) h ORDER BY id', [conv.id]);
      const firstName = String(req.user.full_name || '').split(' ')[0].slice(0, 40);
      const msgs = hist.map((m) => ({ role: m.role, content: (m.attachment_kind === 'image' ? '[shared a photo] ' : '') + m.content.slice(0, 2000) }));
      let model = chatModel();
      if (imageUrl) {
        const vm = await visionModel();
        if (vm) { model = vm; msgs[msgs.length - 1] = { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: imageUrl } }] }; }
        else msgs[msgs.length - 1].content = `[The user attached a photo, but photo understanding is not available right now. Say so briefly and kindly, then help with their text if possible.] ${message}`;
      }
      const lang = locale !== 'en' ? ` Their app language code is ${locale}; reply in the language they write or speak in.` : '';
      const messages = [{ role: 'system', content: CHAT_PROMPT + (firstName ? `\nThe user's first name is ${firstName}.` : '') + lang }, ...msgs];
      let text = ''; let ttft = 0;
      const stream = async (m, list) => { for await (const t of groqStream(list, ac.signal, { model: m, maxTokens: 900 })) { if (!ttft) ttft = Date.now() - t0; text += t; send({ t }); } };
      try { await stream(model, messages); }
      catch (e) {
        if (!imageUrl || text || ac.signal.aborted) throw e;
        // The vision model failed: answer without the photo instead of erroring out.
        messages[messages.length - 1] = { role: 'user', content: `[The user attached a photo, but photo understanding is not available right now. Say so briefly and kindly, then help with their text if possible.] ${message}` };
        await stream(chatModel(), messages);
      }
      if (!text.trim()) throw new Error('empty reply');
      const { rows: [m] } = await q("INSERT INTO ai_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'assistant', $3) RETURNING id", [conv.id, uid, text]);
      await q('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conv.id]);
      if (config.aiLogTtft) console.log(`[ai] ttft_ms=${ttft} model=${model}`);
      send({ done: true, id: m.id, ttft_ms: ttft });
    } catch (e) {
      console.warn('[ai] upstream failed:', e.status || e.name || 'error'); // never log the key or the request
      send({ error: e.status === 429 ? DAILY_LIMIT_MSG.replace('reached its daily limit', 'is very busy right now').replace('tomorrow', 'in a few minutes') : FALLBACK, fallback: true });
    } finally { clearTimeout(timer); for (const f of [image, audio]) if (f) fs.rm(f.path, { force: true }, () => {}); res.end(); }
  });
}

const tmpDir = path.join(config.uploadDir, 'tmp');
const aiUpload = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => { fs.mkdirSync(tmpDir, { recursive: true }); cb(null, tmpDir); }, filename: (_r, _f, cb) => cb(null, crypto.randomBytes(12).toString('hex')) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 2 },
  fileFilter: (_r, f, cb) => cb(null, f.fieldname === 'image' ? /^image\//.test(f.mimetype) : f.fieldname === 'audio' ? /^(audio|video)\//.test(f.mimetype) : false),
}).fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }]);
function aiOut(ext) { const dir = path.join(config.uploadDir, 'ai'); fs.mkdirSync(dir, { recursive: true }); const n = crypto.randomBytes(16).toString('hex') + ext; return [path.join(dir, n), `/uploads/ai/${n}`]; }
function run(cmd, args) { return new Promise((ok, bad) => { const p = spawn(cmd, args, { stdio: 'ignore' }); p.on('error', bad); p.on('close', (c) => (c === 0 ? ok() : bad(new Error('ffmpeg ' + c)))); }); }
// Whisper supports most app languages; for the ones it doesn't (Igbo) we let it auto-detect.
const WHISPER_LANGS = new Set(['en', 'es', 'fr', 'pt', 'ar', 'hi', 'zh', 'ru', 'id', 'tr', 'de', 'ja', 'ko', 'sw', 'yo', 'ha']);
async function transcribe(file, locale, signal) {
  const b = '----cx' + crypto.randomBytes(8).toString('hex');
  const part = (name, val) => `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${val}\r\n`;
  const ext = /ogg/.test(file.mimetype) ? 'ogg' : /mp4|m4a|aac/.test(file.mimetype) ? 'm4a' : /mpeg|mp3/.test(file.mimetype) ? 'mp3' : /wav/.test(file.mimetype) ? 'wav' : 'webm';
  const body = Buffer.concat([Buffer.from(part('model', config.groqWhisperModel) + part('response_format', 'json') + (WHISPER_LANGS.has(locale) ? part('language', locale) : '')
    + `--${b}\r\nContent-Disposition: form-data; name="file"; filename="voice.${ext}"\r\nContent-Type: ${file.mimetype}\r\n\r\n`), fs.readFileSync(file.path), Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await groqFetch('/audio/transcriptions', { method: 'POST', signal, body, headers: { 'Content-Type': `multipart/form-data; boundary=${b}` } });
  if (!r.ok) { await r.text(); const e = new Error('whisper'); e.status = r.status; throw e; }
  return String((await r.json()).text || '').trim().slice(0, 2000);
}
