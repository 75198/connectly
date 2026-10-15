// Round 8 features (migration 016). Each block is behind its own FEATURE_* flag (handbook §6 and §19).
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, pool } from './db.js';
import { config } from './config.js';
import { upload, saveImage } from './uploads.js';
import { memberOf, postMessage } from './messages.js';
import { pushTo } from './push.js';

const flag = (name) => (_q, res, next) => (config.features[name] ? next() : res.status(404).json({ error: 'Not found' }));

export const GIFTS = [
  { key: 'rose', name: 'Rose', emoji: '🌹', coins: 1 }, { key: 'heart', name: 'Heart', emoji: '💖', coins: 5 }, { key: 'star', name: 'Star', emoji: '🌟', coins: 10 },
  { key: 'cake', name: 'Cake', emoji: '🎂', coins: 25 }, { key: 'trophy', name: 'Trophy', emoji: '🏆', coins: 50 }, { key: 'rocket', name: 'Rocket', emoji: '🚀', coins: 100 },
  { key: 'crown', name: 'Crown', emoji: '👑', coins: 250 }, { key: 'diamond', name: 'Diamond', emoji: '💎', coins: 500 },
];
export const STICKERS = ['wave', 'heart-beat', 'laugh', 'party', 'fire', 'clap', 'thumbs', 'star', 'cry', 'cool', 'love-eyes', 'thinking', 'sparkle', 'coffee', 'sun', 'moon'];
export const QUIZ = [
  ['What is the largest planet in our solar system?', ['Earth', 'Jupiter', 'Saturn', 'Neptune'], 1], ['Which ocean is the largest?', ['Atlantic', 'Indian', 'Pacific', 'Arctic'], 2],
  ['How many continents are there?', ['Five', 'Six', 'Seven', 'Eight'], 2], ['Which gas do plants take in?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'], 1],
  ['What is the capital of Japan?', ['Kyoto', 'Osaka', 'Tokyo', 'Nagoya'], 2], ['Which is the longest river in Africa?', ['Congo', 'Niger', 'Zambezi', 'Nile'], 3],
  ['What colour do you get mixing blue and yellow?', ['Green', 'Purple', 'Orange', 'Brown'], 0], ['How many legs does a spider have?', ['Six', 'Eight', 'Ten', 'Twelve'], 1],
  ['Which planet is called the Red Planet?', ['Venus', 'Mars', 'Mercury', 'Jupiter'], 1], ['What is the hardest natural substance?', ['Gold', 'Iron', 'Diamond', 'Quartz'], 2],
  ['Which instrument has 88 keys?', ['Guitar', 'Piano', 'Violin', 'Flute'], 1], ['What is the capital of Kenya?', ['Mombasa', 'Nairobi', 'Kisumu', 'Nakuru'], 1],
  ['Which animal is the tallest?', ['Elephant', 'Giraffe', 'Camel', 'Horse'], 1], ['What do bees make?', ['Milk', 'Silk', 'Honey', 'Wax only'], 2],
  ['Which language has the most native speakers?', ['English', 'Spanish', 'Mandarin Chinese', 'Hindi'], 2], ['What is H2O?', ['Salt', 'Water', 'Hydrogen', 'Oxygen'], 1],
  ['Which country is home to the pyramids of Giza?', ['Mexico', 'Peru', 'Egypt', 'Sudan'], 2], ['How many minutes are in an hour?', ['Sixty', 'Hundred', 'Thirty', 'Forty'], 0],
  ['Which is the smallest prime number?', ['One', 'Two', 'Three', 'Five'], 1], ['Which bird is a symbol of peace?', ['Eagle', 'Dove', 'Parrot', 'Owl'], 1],
];
export const TRUTHS = ['What’s the most embarrassing song you secretly love?', 'What’s a skill you wish you had?', 'Who was your first celebrity crush?', 'What’s the best gift you’ve ever received?', 'What’s a habit you’re trying to break?', 'What’s your most used emoji?', 'What’s the funniest thing that happened to you this year?', 'What would you do with a free day tomorrow?', 'What’s a food you can’t stand?', 'What’s your hidden talent?'];
export const DARES = ['Send the last photo in your camera roll (a safe one!).', 'Send a voice note singing your favourite chorus.', 'Use only emoji for your next three messages.', 'Change your chat theme for the next hour.', 'Send a selfie with your best silly face.', 'Tell a joke in a voice note.', 'Write a two-line poem about the person on your left in this chat.', 'Describe your day using only movie titles.', 'Send a sticker that matches your mood right now.', 'Share a song recommendation with everyone.'];

const BADGES = { first_post: 'First post', streak_3: 'On a roll', streak_7: 'Week warrior', streak_30: 'Unstoppable', creator: 'Creator', socialite: 'Socialite', early_bird: 'Early bird' };

export async function recordActivity(userId) {
  if (!config.features.streaks || !userId) return;
  try { await q("INSERT INTO activity_days (user_id, day) VALUES ($1, (now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING", [userId]); } catch { /* best effort */ }
}
export async function streakOf(userId) {
  const { rows } = await q("SELECT day FROM activity_days WHERE user_id = $1 AND day > (now() AT TIME ZONE 'UTC')::date - 400 ORDER BY day DESC", [userId]);
  const days = rows.map((r) => r.day); const today = new Date().toISOString().slice(0, 10);
  const dayMs = 864e5; let cur = 0, best = 0, run = 0, prev = null;
  for (const d of days) { const t = Date.parse(d); run = prev !== null && prev - t === dayMs ? run + 1 : 1; best = Math.max(best, run); prev = t; }
  if (days.length) { let c = 0, expect = Date.parse(today); if (days[0] !== today) expect -= dayMs; for (const d of days) { if (Date.parse(d) === expect) { c++; expect -= dayMs; } else if (Date.parse(d) < expect) break; } cur = c; }
  return { current: cur, longest: best, active_today: days[0] === today };
}
async function awardBadges(userId) {
  const s = await streakOf(userId); const add = [];
  if (s.current >= 3) add.push('streak_3'); if (s.current >= 7) add.push('streak_7'); if (s.current >= 30) add.push('streak_30');
  const { rows: [c] } = await q("SELECT (SELECT count(*) FROM posts WHERE author_id = $1 AND deleted_at IS NULL AND NOT is_draft)::int AS posts, (SELECT count(*) FROM follows WHERE followee_id = $1)::int AS followers, (SELECT count(*) FROM posts WHERE author_id = $1 AND kind = 'reel' AND deleted_at IS NULL)::int AS reels", [userId]);
  if (c.posts >= 1) add.push('first_post'); if (c.reels >= 5) add.push('creator'); if (c.followers >= 25) add.push('socialite');
  if (add.length) await q('INSERT INTO user_badges (user_id, badge) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [userId, add]);
  return s;
}

export function registerRound8(api, { requireAuth, requireVerified, requireAdmin, id, pagePosts, getVisiblePost }) {
  // ===== music + trending sounds =====
  api.get('/music', requireAuth, flag('music'), async (req, res) => {
    const term = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
    const { rows } = await q(`SELECT t.id, t.title, t.artist, t.duration_seconds, t.url, t.license, t.source_url, t.mood, (SELECT count(*)::int FROM posts p WHERE p.music_track_id = t.id AND p.deleted_at IS NULL) AS uses
      FROM music_tracks t WHERE t.active AND ($1 = '' OR lower(t.title) LIKE '%' || $1 || '%' OR lower(t.artist) LIKE '%' || $1 || '%' OR lower(t.mood) LIKE '%' || $1 || '%') ORDER BY t.title LIMIT 100`, [term]);
    res.json({ items: rows });
  });
  api.get('/music/trending', requireAuth, flag('music'), async (_req, res) => {
    const { rows } = await q(`SELECT t.id, t.title, t.artist, t.duration_seconds, t.url, t.license, t.source_url, t.mood, count(p.id)::int AS uses FROM music_tracks t
      LEFT JOIN posts p ON p.music_track_id = t.id AND p.created_at > now() - interval '14 days' AND p.deleted_at IS NULL AND p.visibility = 'public'
      WHERE t.active GROUP BY t.id ORDER BY count(p.id) DESC, t.title LIMIT 10`);
    res.json({ items: rows });
  });
  api.get('/music/:id', requireAuth, flag('music'), async (req, res) => {
    const { rows: [t] } = await q('SELECT id, title, artist, duration_seconds, url, license, source_url, mood FROM music_tracks WHERE id = $1', [id(req.params.id)]);
    if (!t) return res.status(404).json({ error: 'Sound not found' });
    res.json({ ...t, posts: await pagePosts(req.user.id, 'p.music_track_id = $2', [t.id], req.query.cursor, req.query.limit) });
  });

  // ===== remixes / duets =====
  api.get('/reels/:id/remixes', requireAuth, flag('remix'), async (req, res) => res.json(await pagePosts(req.user.id, "p.remix_of_id = $2 AND p.kind = 'reel'", [id(req.params.id)], req.query.cursor, req.query.limit)));

  // ===== challenges =====
  const CH = `SELECT c.id, c.tag, c.title, c.description, c.created_at, c.ends_at, (SELECT row_to_json(t) FROM (SELECT id, title, artist, url FROM music_tracks WHERE id = c.music_track_id) t) AS sound,
    (SELECT count(*)::int FROM post_hashtags h JOIN posts p ON p.id = h.post_id WHERE h.tag = c.tag AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND NOT p.is_draft) AS entries FROM challenges c`;
  api.get('/challenges', requireAuth, flag('challenges'), async (_req, res) => res.json({ items: (await q(`${CH} WHERE c.ends_at IS NULL OR c.ends_at > now() ORDER BY entries DESC, c.id DESC LIMIT 50`)).rows }));
  api.post('/challenges', requireVerified, flag('challenges'), async (req, res) => {
    const d = z.object({ tag: z.string().trim().regex(/^#?[\p{L}\p{N}_]{2,40}$/u, 'Use letters, numbers or _ only'), title: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default(''), music_track_id: z.number().int().positive().nullable().optional(), days: z.number().int().min(1).max(90).optional() }).strict().parse(req.body);
    const tag = d.tag.replace(/^#/, '').toLowerCase();
    const { rows } = await q(`INSERT INTO challenges (tag, title, description, music_track_id, created_by, ends_at) VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(days => $6::int) END) ON CONFLICT (tag) DO NOTHING RETURNING id`, [tag, d.title, d.description, d.music_track_id || null, req.user.id, d.days ?? null]);
    if (!rows[0]) return res.status(409).json({ error: 'That challenge already exists' });
    res.status(201).json((await q(`${CH} WHERE c.id = $1`, [rows[0].id])).rows[0]);
  });
  api.get('/challenges/:tag', requireAuth, flag('challenges'), async (req, res) => {
    const { rows: [c] } = await q(`${CH} WHERE c.tag = lower($1)`, [String(req.params.tag).replace(/^#/, '')]);
    if (!c) return res.status(404).json({ error: 'Challenge not found' });
    res.json({ ...c, posts: await pagePosts(req.user.id, 'EXISTS (SELECT 1 FROM post_hashtags h WHERE h.post_id = p.id AND h.tag = $2)', [c.tag], req.query.cursor, req.query.limit) });
  });

  // ===== coins + live gifts (no real payments) =====
  api.get('/coins', requireAuth, flag('gifts'), async (req, res) => {
    const { rows: [w] } = await q('SELECT balance FROM coin_wallets WHERE user_id = $1', [req.user.id]);
    const { rows: hist } = await q('SELECT delta, reason, created_at FROM coin_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [req.user.id]);
    res.json({ balance: w?.balance || 0, purchase: 'coming_soon', history: hist, gifts: GIFTS });
  });
  api.post('/coins/purchase', requireAuth, flag('gifts'), (_q, res) => res.status(503).json({ error: 'Buying coins is coming soon.', coming_soon: true }));
  api.post('/admin/users/:id/coins', requireAdmin, flag('gifts'), async (req, res) => {
    const uid = id(req.params.id); const { amount } = z.object({ amount: z.number().int().min(1).max(1000000) }).strict().parse(req.body);
    const { rows: [u] } = await q('SELECT id FROM users WHERE id = $1', [uid]); if (!u) return res.status(404).json({ error: 'User not found' });
    await q('INSERT INTO coin_wallets (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = coin_wallets.balance + EXCLUDED.balance, updated_at = now()', [uid, amount]);
    await q("INSERT INTO coin_ledger (user_id, delta, reason, by_user) VALUES ($1, $2, 'admin_grant', $3)", [uid, amount, req.user.id]);
    res.json({ ok: true });
  });
  api.get('/live/:id/gifts', requireAuth, flag('gifts'), async (req, res) => {
    const { rows } = await q(`SELECT g.id, g.gift, g.coins, g.created_at, json_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'avatar_path', u.avatar_path) AS sender
      FROM live_gifts g JOIN users u ON u.id = g.sender_id WHERE g.stream_id = $1 AND g.id > $2 ORDER BY g.id DESC LIMIT 30`, [id(req.params.id), Number(req.query.after) || 0]);
    res.json({ items: rows.reverse() });
  });
  api.post('/live/:id/gifts', requireVerified, flag('gifts'), async (req, res) => {
    const { gift } = z.object({ gift: z.enum(GIFTS.map((g) => g.key)) }).strict().parse(req.body);
    const g = GIFTS.find((x) => x.key === gift);
    const { rows: [s] } = await q("SELECT id, host_id FROM live_streams WHERE id = $1 AND status = 'live'", [id(req.params.id)]);
    if (!s) return res.status(404).json({ error: 'This live has ended' });
    if (s.host_id === req.user.id) return res.status(400).json({ error: 'You can’t send gifts to yourself' });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rowCount } = await c.query('UPDATE coin_wallets SET balance = balance - $2, updated_at = now() WHERE user_id = $1 AND balance >= $2', [req.user.id, g.coins]);
      if (!rowCount) { await c.query('ROLLBACK'); return res.status(402).json({ error: 'You need more coins for this gift. Buying coins is coming soon.', coming_soon: true }); }
      await c.query("INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, 'gift_sent', $3)", [req.user.id, -g.coins, `live:${s.id}`]);
      await c.query('INSERT INTO coin_wallets (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = coin_wallets.balance + EXCLUDED.balance, updated_at = now()', [s.host_id, g.coins]);
      await c.query("INSERT INTO coin_ledger (user_id, delta, reason, ref) VALUES ($1, $2, 'gift_received', $3)", [s.host_id, g.coins, `live:${s.id}`]);
      const { rows: [row] } = await c.query('INSERT INTO live_gifts (stream_id, sender_id, gift, coins) VALUES ($1,$2,$3,$4) RETURNING id', [s.id, req.user.id, g.key, g.coins]);
      await c.query('COMMIT');
      const { rows: [w] } = await q('SELECT balance FROM coin_wallets WHERE user_id = $1', [req.user.id]);
      res.status(201).json({ id: row.id, balance: w.balance });
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });

  // ===== in-chat games =====
  const gameView = (g, me) => {
    const s = g.state; const base = { id: g.id, kind: g.kind, conversation_id: g.conversation_id, created_by: g.created_by, updated_at: g.updated_at };
    if (g.kind === 'quiz') { const i = s.index; const done = i >= s.order.length; const Q = done ? null : QUIZ[s.order[i]]; return { ...base, index: i, total: s.order.length, done, question: Q && { text: Q[0], options: Q[1] }, my_answer: s.answers?.[i]?.[me] ?? null, answered: Object.keys(s.answers?.[i] || {}).map(Number), last: i > 0 ? { correct: QUIZ[s.order[i - 1]][2], answers: s.answers?.[i - 1] || {} } : null, scores: s.scores }; }
    if (g.kind === 'truth_dare') return { ...base, turn: s.turn, prompt: s.prompt, type: s.type, history: s.history.slice(-10), players: s.players };
    return { ...base, board: s.board, x: s.x, o: s.o, next: s.next, winner: s.winner, draw: s.draw };
  };
  const loadGame = async (gid, uid) => { const { rows: [g] } = await q('SELECT * FROM chat_games WHERE id = $1', [gid]); if (!g) return null; await memberOf(g.conversation_id, uid); return g; };
  api.post('/conversations/:id/games', requireVerified, flag('games'), async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const { kind } = z.object({ kind: z.enum(['quiz', 'truth_dare', 'tictactoe']) }).strict().parse(req.body);
    const { rows: mem } = await q('SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND left_at IS NULL ORDER BY joined_at', [c.id]);
    let state;
    if (kind === 'quiz') { const order = [...QUIZ.keys()].sort(() => Math.random() - 0.5).slice(0, 5); state = { order, index: 0, answers: {}, scores: Object.fromEntries(mem.map((m) => [m.user_id, 0])) }; }
    else if (kind === 'truth_dare') state = { players: mem.map((m) => m.user_id), turn: req.user.id, prompt: null, type: null, history: [] };
    else state = { board: Array(9).fill(null), x: req.user.id, o: c.is_group ? null : mem.find((m) => m.user_id !== req.user.id)?.user_id ?? null, next: 'x', winner: null, draw: false };
    const { rows: [g] } = await q('INSERT INTO chat_games (conversation_id, kind, state, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [c.id, kind, state, req.user.id]);
    const msg = await postMessage(c, req.user.id, { kind: 'game', body: { quiz: 'Quiz', truth_dare: 'Truth or dare', tictactoe: 'Tic-tac-toe' }[kind], meta: { game_id: g.id, game: kind } });
    res.status(201).json({ game: gameView(g, req.user.id), message: msg });
  });
  api.get('/games/:id', requireAuth, flag('games'), async (req, res) => { const g = await loadGame(id(req.params.id), req.user.id); if (!g) return res.status(404).json({ error: 'Game not found' }); res.json(gameView(g, req.user.id)); });
  api.post('/games/:id/move', requireAuth, flag('games'), async (req, res) => {
    const g = await loadGame(id(req.params.id), req.user.id); if (!g) return res.status(404).json({ error: 'Game not found' });
    const s = g.state; const me = req.user.id; const d = req.body || {};
    if (g.kind === 'quiz') {
      const { answer } = z.object({ answer: z.number().int().min(0).max(3) }).strict().parse(d);
      if (s.index >= s.order.length) return res.status(400).json({ error: 'This quiz is over' });
      s.answers[s.index] ||= {}; if (s.answers[s.index][me] !== undefined) return res.status(400).json({ error: 'You already answered' });
      s.answers[s.index][me] = answer; if (answer === QUIZ[s.order[s.index]][2]) s.scores[me] = (s.scores[me] || 0) + 1;
      const { rows: mem } = await q('SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = $1 AND left_at IS NULL', [g.conversation_id]);
      if (Object.keys(s.answers[s.index]).length >= Math.min(mem[0].n, 8) || d.next) s.index++;
    } else if (g.kind === 'truth_dare') {
      const { action } = z.object({ action: z.enum(['truth', 'dare', 'pass']) }).strict().parse(d);
      if (s.turn !== me) return res.status(400).json({ error: 'It’s not your turn yet' });
      if (action === 'pass') { const i = s.players.indexOf(me); s.turn = s.players[(i + 1) % s.players.length]; s.prompt = null; s.type = null; }
      else { const list = action === 'truth' ? TRUTHS : DARES; s.type = action; s.prompt = list[crypto.randomInt(list.length)]; s.history.push({ user: me, type: action, prompt: s.prompt }); }
    } else {
      const { cell } = z.object({ cell: z.number().int().min(0).max(8) }).strict().parse(d);
      if (s.winner || s.draw) return res.status(400).json({ error: 'This game is over' });
      if (!s.o && me !== s.x) s.o = me;
      const mark = me === s.x ? 'x' : me === s.o ? 'o' : null;
      if (!mark) return res.status(400).json({ error: 'Two players are already playing' });
      if (s.next !== mark) return res.status(400).json({ error: 'It’s not your turn yet' });
      if (s.board[cell]) return res.status(400).json({ error: 'That square is taken' });
      s.board[cell] = mark; s.next = mark === 'x' ? 'o' : 'x';
      for (const [a, b, c] of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]) if (s.board[a] && s.board[a] === s.board[b] && s.board[a] === s.board[c]) s.winner = s.board[a];
      if (!s.winner && s.board.every(Boolean)) s.draw = true;
    }
    const { rows: [ng] } = await q('UPDATE chat_games SET state = $2, updated_at = now() WHERE id = $1 RETURNING *', [g.id, s]);
    res.json(gameView(ng, me));
  });

  // ===== watch together (synced reel viewing in a call) =====
  api.get('/conversations/:id/watch', requireAuth, flag('watchTogether'), async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const { rows: [w] } = await q('SELECT post_id, position, playing, updated_by, updated_at, extract(epoch from now() - updated_at) AS age FROM watch_sessions WHERE conversation_id = $1', [c.id]);
    if (!w?.post_id) return res.json({ session: null });
    const p = await getVisiblePost(req.user.id, w.post_id);
    res.json({ session: p ? { ...w, position: w.playing ? w.position + Number(w.age) : w.position, post: p } : null });
  });
  api.put('/conversations/:id/watch', requireAuth, flag('watchTogether'), async (req, res) => {
    const c = await memberOf(id(req.params.id), req.user.id);
    const d = z.object({ post_id: z.number().int().positive().nullable(), position: z.number().min(0).max(36000).default(0), playing: z.boolean().default(true) }).strict().parse(req.body);
    if (d.post_id && !(await getVisiblePost(req.user.id, d.post_id))) return res.status(404).json({ error: 'Reel not found' });
    await q('INSERT INTO watch_sessions (conversation_id, post_id, position, playing, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5, now()) ON CONFLICT (conversation_id) DO UPDATE SET post_id = EXCLUDED.post_id, position = EXCLUDED.position, playing = EXCLUDED.playing, updated_by = EXCLUDED.updated_by, updated_at = now()', [c.id, d.post_id, d.position, d.playing, req.user.id]);
    res.json({ ok: true });
  });

  // ===== memories: on this day =====
  api.get('/memories', requireAuth, flag('memories'), async (req, res) => {
    const tz = /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$|^UTC$/.test(String(req.query.tz || '')) ? String(req.query.tz) : 'UTC';
    const page = await pagePosts(req.user.id, `p.author_id = $1 AND extract(month from p.created_at AT TIME ZONE $2) = extract(month from now() AT TIME ZONE $2) AND extract(day from p.created_at AT TIME ZONE $2) = extract(day from now() AT TIME ZONE $2) AND extract(year from p.created_at AT TIME ZONE $2) < extract(year from now() AT TIME ZONE $2)`, [tz], null, 30);
    res.json({ items: page.items.map((p) => ({ ...p, years_ago: new Date().getFullYear() - new Date(p.created_at).getFullYear() })) });
  });

  // ===== stickers + custom emoji =====
  api.get('/stickers', requireAuth, flag('stickers'), async (_req, res) => {
    const { rows } = await q('SELECT code, image_path FROM custom_emoji ORDER BY code');
    res.json({ stickers: STICKERS.map((s) => ({ key: s, url: `/stickers/${s}.svg` })), custom_emoji: rows, gifs: null });
  });
  api.post('/admin/custom-emoji', requireAdmin, flag('stickers'), upload.single('image'), async (req, res) => {
    const code = z.string().regex(/^[a-z0-9_]{2,30}$/, 'Use 2 or more lowercase letters, numbers or _').parse(String(req.body?.code || ''));
    if (!req.file) return res.status(400).json({ error: 'Choose an image' });
    const img = await saveImage(req.file.buffer, 'space');
    const { rows } = await q('INSERT INTO custom_emoji (code, image_path, created_by) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING RETURNING code, image_path', [code, img, req.user.id]);
    if (!rows[0]) return res.status(409).json({ error: 'That code is taken' });
    res.status(201).json(rows[0]);
  });

  // ===== streaks + badges =====
  api.get('/me/streak', requireAuth, flag('streaks'), async (req, res) => {
    await recordActivity(req.user.id);
    const s = await awardBadges(req.user.id);
    const { rows } = await q('SELECT badge, awarded_at FROM user_badges WHERE user_id = $1 ORDER BY awarded_at', [req.user.id]);
    res.json({ ...s, badges: rows.map((b) => ({ ...b, name: BADGES[b.badge] || b.badge })) });
  });
  api.get('/users/:username/badges', requireAuth, async (req, res) => {
    if (!config.features.streaks) return res.json({ items: [] });
    const { rows } = await q('SELECT b.badge, b.awarded_at FROM user_badges b JOIN users u ON u.id = b.user_id WHERE lower(u.username) = lower($1) ORDER BY b.awarded_at', [req.params.username]);
    res.json({ items: rows.map((b) => ({ ...b, name: BADGES[b.badge] || b.badge })) });
  });
}
export { BADGES };
