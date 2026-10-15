// Connectly AI: in-app AI support chat (round 6, migration 011, flag FEATURE_AI_SUPPORT).
// The browser talks only to this server; the server calls Groq's OpenAI-compatible API with the key
// from .env (GROQ_API_KEY), so the key never reaches the client. Replies stream to the browser as NDJSON.
// Limits: AI_USER_HOURLY messages per user per hour, AI_DAILY_CAP messages per UTC day for everyone.
import { z } from 'zod';
import { q } from './db.js';
import { config } from './config.js';

export const SYSTEM_PROMPT = `You are Connectly AI, the friendly in-app support helper for Connectly, a social app.
You help people use Connectly: creating posts (Home > "What's on your mind?" opens the composer with Photo/video, Camera, Feeling, Location and audience Public/Friends/Only me), drafts and Recently deleted (Profile hub; deleted posts can be restored for 30 days), reactions (long-press Like), saved posts, sharing, Reels (vertical videos up to 60 seconds; Create menu > Reel, or the Reels icon on Home), Stories (photo + caption, visible 24 hours to friends and followers), friends and follows, Pages/Groups/Communities, Marketplace, Search, notifications, privacy and settings (Profile > Privacy and settings: default post audience, profile details visibility, blocking, notifications, Appearance light/dark/system theme, sessions and "Sign out other devices"), account recovery (Log in screen > "Forgot password?" sends a 6-digit code to your email or phone; "Find your account" if you forgot the identifier), and reporting abuse (the ⋯ menu on a post or profile > Report; moderators review reports).
Rules:
- Be warm, concise and practical. Use short steps. Plain text or simple lists; no tables.
- You cannot see or change anyone's account, posts or data, and you cannot take actions (no password resets, unbans, deletions, verifications). Say so kindly and explain how the user can do it themselves.
- Never reveal, guess or look up information about other users (emails, phone numbers, locations, who viewed what, private posts). Politely refuse.
- Never ask for passwords or verification codes. If someone shares one, tell them to change it.
- For serious issues (harassment, threats, hacked accounts, impersonation, child safety, self-harm) tell them to use Report so an admin/moderator can help, and to contact local emergency services if anyone is in danger.
- If a question is unrelated to Connectly, answer briefly if harmless, then steer back to Connectly help.
- If unsure how a feature works, say so rather than inventing details.`;

export const FALLBACK = "Connectly AI is taking a short break right now. Please try again in a little while. Quick help: reset your password from Log in > \"Forgot password?\", change privacy in Profile > Privacy and settings, and for anything serious use the ⋯ menu > Report so an admin can help.";
const USER_LIMIT_MSG = "You've sent a lot of messages this hour 🙂 Please take a breather and try again a bit later.";
const DAILY_LIMIT_MSG = "Connectly AI has been really busy today and reached its daily limit. Please try again tomorrow. For urgent problems, use the ⋯ menu > Report.";

const Chat = z.object({ conversation_id: z.coerce.number().int().positive().optional(), message: z.string().trim().min(1, 'Type a message').max(2000, 'Message is too long (2000 characters max)') }).strict();

export function aiAvailable() { return config.features.aiSupport && !!config.groqApiKey; }

// Calls Groq with streaming and yields text deltas. Throws on HTTP/network errors.
export async function* groqStream(messages, signal) {
  const res = await fetch(`${config.groqBaseUrl}/chat/completions`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.groqModel, messages, stream: true, temperature: 0.4, max_tokens: 700,
      ...(config.groqModel.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}) }),
  });
  if (!res.ok || !res.body) { const e = new Error(`Groq HTTP ${res.status}`); e.status = res.status; throw e; }
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

export function registerAi(api, { requireAuth, id }) {
  const enabled = (_req, res, next) => (config.features.aiSupport ? next() : res.status(404).json({ error: 'Not found' }));
  const own = async (userId, convId) => {
    const { rows } = await q('SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id = $1 AND user_id = $2', [convId, userId]);
    if (!rows[0]) { const e = new Error('Conversation not found'); e.status = 404; throw e; }
    return rows[0];
  };

  api.get('/ai/status', requireAuth, enabled, (_req, res) => res.json({ enabled: true, available: !!config.groqApiKey, hourly_limit: config.aiUserHourly }));

  api.get('/ai/conversations', requireAuth, enabled, async (req, res) => {
    const { rows } = await q(`SELECT c.id, c.title, c.updated_at, (SELECT left(content, 120) FROM ai_messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last
      FROM ai_conversations c WHERE c.user_id = $1 ORDER BY c.updated_at DESC LIMIT 50`, [req.user.id]);
    res.json({ items: rows });
  });

  api.get('/ai/conversations/:id', requireAuth, enabled, async (req, res) => {
    try {
      const c = await own(req.user.id, id(req.params.id));
      const { rows } = await q('SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY id LIMIT 500', [c.id]);
      res.json({ ...c, messages: rows });
    } catch (e) { if (e.status === 404) return res.status(404).json({ error: e.message }); throw e; }
  });

  api.post('/ai/chat', requireAuth, enabled, async (req, res) => {
    const body = Chat.parse(req.body);
    const uid = req.user.id;
    let conv;
    if (body.conversation_id) { try { conv = await own(uid, body.conversation_id); } catch (e) { return res.status(404).json({ error: e.message }); } }
    if (!config.groqApiKey) return res.status(503).json({ error: FALLBACK, fallback: true });
    const { rows: [lim] } = await q(`SELECT
        (SELECT count(*) FROM ai_messages WHERE role = 'user' AND user_id = $1 AND created_at > now() - interval '1 hour')::int AS mine,
        (SELECT count(*) FROM ai_messages WHERE role = 'user' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS today`, [uid]);
    if (lim.mine >= config.aiUserHourly) return res.status(429).json({ error: USER_LIMIT_MSG, limit: 'user' });
    if (lim.today >= config.aiDailyCap) return res.status(429).json({ error: DAILY_LIMIT_MSG, limit: 'daily' });

    if (!conv) {
      const title = body.message.replace(/\s+/g, ' ').slice(0, 60);
      conv = (await q('INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at', [uid, title])).rows[0];
    }
    await q("INSERT INTO ai_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'user', $3)", [conv.id, uid, body.message]);
    const { rows: hist } = await q('SELECT role, content FROM (SELECT id, role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 12) h ORDER BY id', [conv.id]);
    const firstName = String(req.user.full_name || '').split(' ')[0].slice(0, 40);
    const messages = [{ role: 'system', content: SYSTEM_PROMPT + (firstName ? `\nThe user's first name is ${firstName}.` : '') }, ...hist.map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))];

    res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const send = (o) => { res.write(JSON.stringify(o) + '\n'); res.flush?.(); };
    send({ conversation_id: conv.id, title: conv.title });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    let text = '';
    try {
      for await (const t of groqStream(messages, ac.signal)) { text += t; send({ t }); }
      if (!text.trim()) throw new Error('empty reply');
      const { rows: [m] } = await q("INSERT INTO ai_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'assistant', $3) RETURNING id", [conv.id, uid, text]);
      await q('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conv.id]);
      send({ done: true, id: m.id });
    } catch (e) {
      console.warn('[ai] upstream failed:', e.status || e.name || 'error'); // never log the key or the request
      send({ error: e.status === 429 ? DAILY_LIMIT_MSG.replace('reached its daily limit', 'is very busy right now').replace('tomorrow', 'in a few minutes') : FALLBACK, fallback: true });
    } finally { clearTimeout(timer); res.end(); }
  });
}
