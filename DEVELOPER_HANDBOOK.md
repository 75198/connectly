# Connectly Developer Handbook

This repo is **public**. Never commit secrets, `.env`, passwords, database dumps, uploads or screenshots that show real user data.

## 1. Architecture
| Layer | What | Where |
|---|---|---|
| Web client | React 18 + Vite + TypeScript SPA | `web/src` (pages, components, `api.ts`, `lib/pow*.ts`) |
| API | Node 20, Express 5, Zod validation | `server/app.js` (auth, posts, admin, moderation), `server/social.js` (friends, spaces, market, sessions, saved logins) |
| Auth | httpOnly `cx_session` cookie (SameSite=Strict), SHA-256 token hash in `sessions`; CSRF header `X-Connectly-CSRF: 1` | `server/auth.js` |
| Bot check | Self-hosted proof-of-work on signup (no third-party CAPTCHA) | `server/pow.js`, `web/src/lib/pow.worker.ts` |
| DB | PostgreSQL 15, plain SQL migrations | `server/migrations/NNN_name.sql`, runner `server/migrate.js` |
| Files | Images re-encoded by sharp; reel videos re-encoded by ffmpeg | `uploads/` (gitignored), `uploads/reels/` |
| Reels | Posts with `kind = 'reel'` (video_path, poster_path, video_seconds) + `reel_views` | `server/reels.js`, `web/src/pages/Reels.tsx` |
| Email/SMS | SMTP via nodemailer (optional); SMS not configured | `server/mailer.js`, `server/sms.js` |

Every post read goes through the SQL `VISIBLE` clause in `server/app.js` (visibility, blocks, hidden posts, suspended authors). Add new read paths through it.

## 2. Run locally
```bash
npm ci
createdb connectly && createdb connectly_test       # or set DATABASE_URL / TEST_DATABASE_URL
cp .env.example .env && chmod 600 .env              # fill CODE_SECRET with: openssl rand -hex 32
npm run migrate && npm run build && npm start       # http://localhost:3000
npm run dev:api & npm run dev:web                   # dev mode with hot reload
npm test                                            # drops & recreates the TEST database only
```
CI (`ci/github-actions-ci.yml`, to be enabled as `.github/workflows/ci.yml`) runs typecheck, build and all tests on every push and pull request against a throwaway Postgres 15.

## 3. Deploy / restart (GitHub Codespace)
```bash
C=expert-space-winner-v6rqw4jgxqpxfxp6
gh codespace ssh -c $C -- 'cd /workspaces/connectly && git pull -q && npm ci && CODESPACE_NAME='$C' bash scripts/codespace-start.sh'
gh codespace ports visibility 3000:public -c $C
```
`scripts/codespace-start.sh` is safe to run repeatedly. It:
1. starts Postgres from **`/workspaces/.connectly-pgdata`** (persistent volume, outside the repo, survives rebuilds; the old `~/pgdata` was copied there once and kept untouched);
2. keeps the Postgres superuser password in `/workspaces/.connectly-state/` (mode 700);
3. forces `chmod 600` on `.env` and `ADMIN_CREDENTIALS.txt` and refuses to start otherwise;
4. builds, takes a **local safety dump** (`scripts/backup-local.sh`, newest 10 kept in `/workspaces/.connectly-state/backups`), runs migrations, seeds roles, starts the server.

Codespaces stops after 4 h idle and is deleted 30 days after stopping. It is a dev environment, not real hosting. Plan a move to an always-on host + managed Postgres.

## 4. Migrations: versioned and additive
- Files are `server/migrations/NNN_short_name.sql`, numbered with no gaps. Each runs once inside a transaction and is recorded in `schema_migrations`. **Never edit a migration that has already run in production**; add a new one.
- From 007 on, migrations must be **additive**: `CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` (nullable, or `NOT NULL DEFAULT ...`). No `DROP`, `TRUNCATE`, `DELETE`, `RENAME` or column type changes. A test in `tests/safety.test.js` enforces this.
- To retire something, stop using it in code first. Remove it only later, with an explicit, backed-up, approved plan.
- Existing accounts must keep working: new required behaviour gets defaults that match the old behaviour. Example: existing saved logins got `expires_at = now() + 60 days`.

## 5. Adding features safely
1. Branch, then write the migration (additive) and the code + tests. `npm test && npm run build` must pass, and CI must be green.
2. Put risky features behind a **feature flag** (next section) that defaults to off until verified.
3. Take an off-server backup (section 7), deploy, then check `/api/health` plus row counts before and after.
4. Validate all input with Zod `.strict()`. Enforce permissions on the server. Rate-limit new write endpoints.

## 6. Feature flags
Flags live in `server/config.js` → `config.features` and are read from env vars `FEATURE_<NAME>=0|1` in `.env` (restart to apply).
| Flag | Default | Effect |
|---|---|---|
| `FEATURE_SIGNUP_POW` | 1 | Require the proof-of-work bot check on `/api/auth/register` |
| `FEATURE_REPORTS` | 1 | Enable `POST /api/reports` |
| `FEATURE_REELS` | 1 | Reels API (`/api/reels*`) and the Reels entries in the Home header, sidebar and Create menu |
| `FEATURE_AI_SUPPORT` | 0 | Connectly AI AI support chat (`/api/ai/*`, `/assistant`, entries in Profile hub and Search) |
| `FEATURE_LIVE` | 0 | Go Live video (`/api/live*`, `/live/new`, `/live/:id`, Create menu chip, Home live row, story rings) |
| `FEATURE_SUBSCRIPTIONS` | 0 | Free / Connectly Pro / Connectly Premium tiers, Settings › Subscription and Upgrade, admin plan + tier controls |
| `FEATURE_WELCOME_HERO` | 1 | Animated video landing screen at `/` for logged-out visitors (off: `/` goes straight to Log in) |
| Round 7 flags (default 0) | 0 | `FEATURE_MESSAGES` (DMs + message requests), `FEATURE_CALLS` (WebRTC voice/video), `FEATURE_VERIFIED`, `FEATURE_HASHTAGS`, `FEATURE_FOR_YOU`, `FEATURE_PUSH` (needs `VAPID_*` in the server `.env` only), `FEATURE_I18N`, `FEATURE_TRANSLATE`, `FEATURE_CREATOR_TOOLS`, `FEATURE_EVENTS`, `FEATURE_POLLS`, `FEATURE_CLOSE_FRIENDS`, `FEATURE_HIDE_LIKES`, `FEATURE_TWO_STEP`, `FEATURE_LOGIN_ALERTS` |
| Round 8 flags (default 0) | 0 | `FEATURE_MUSIC`, `FEATURE_AR_EFFECTS`, `FEATURE_REMIX` (duets), `FEATURE_CHALLENGES`, `FEATURE_GIFTS` (coins, no real payments), `FEATURE_GAMES`, `FEATURE_WATCH_TOGETHER`, `FEATURE_MEMORIES`, `FEATURE_STICKERS`, `FEATURE_STREAKS` |
| Round 9 privacy flags (default 0) | 0 | `FEATURE_PRIVATE_ACCOUNTS`, `FEATURE_WHO_CAN`, `FEATURE_HIDE_PRESENCE`, `FEATURE_HIDE_LISTS`, `FEATURE_RESTRICT_MUTE`, `FEATURE_HIDDEN_WORDS`, `FEATURE_DISAPPEARING`, `FEATURE_DATA_EXPORT`, `FEATURE_DISCOVERABILITY`, `FEATURE_TEEN_SAFETY`, `FEATURE_ADD_YOURS`, `FEATURE_COLLECTIONS` |
| AI, content, money (default 0) | 0 | `FEATURE_AI_VISION`, `FEATURE_AI_VOICE`, `FEATURE_NEWS`, `FEATURE_BACKFILL`, `FEATURE_LOCAL_CURRENCY` |
Flags the client needs are exposed read-only in `GET /api/auth/capabilities` → `features`.
Other tunables: `POW_BITS` (default 17, about 1-3 s in a phone browser; raise it if bots get through).

## 7. Backups & restore
- **Off-server (the real backup):** from your machine run `CODESPACE=<name> PASSFILE=<passphrase file> bash scripts/backup-offsite.sh <dest>`. It pulls a `pg_dump -Fc` and an uploads tarball, encrypts them with GnuPG AES256, and verifies checksums after decryption. Keep the passphrase outside the repo. The codespace cannot push backups off-server on its own without storing credentials, so schedule this script on your own machine (cron) or run it before every deploy.
- **In-codespace safety net:** an automatic dump before every start (see above). It is lost if the codespace is deleted.
- **Restore** (to a NEW database first, never over production blindly):
```bash
gpg -d connectly-db.dump.gpg > db.dump && sha256sum -c SHA256SUMS.plain
createdb connectly_restore && pg_restore --no-owner -d connectly_restore db.dump
# compare row counts, then point DATABASE_URL at it (or rename databases) during a maintenance window
```

## 8. Security rules
- No secrets in git. `.env`, `ADMIN_CREDENTIALS.txt`, `uploads/`, `data/`, dumps and real-user screenshots are gitignored. `.env` must be mode 600.
- Never delete, reset or alter real user data in migrations or scripts. Moderation **hides** posts (`posts.hidden_at`) and **suspends** users (`users.suspended_at`). Both can be undone, and nothing is deleted.
- Sessions: 60-day sliding expiry (renewed on activity). "Sign out other devices" ends every other session and forgets this account on other devices' saved logins. Saved logins expire after 60 days without use. Suspended users' sessions stop working immediately.
- Rate limits per IP: login 10/15 min (plus 10/15 min per account), signup 5/hour, code send/verify/reset 8/15 min, reports 20/hour, other writes 60/min.
- Privacy: user IPs are not sent to any third party (the old ipapi.co lookup was removed). Login history keeps time, method and device.
- Passwords: bcrypt cost 12. Codes are HMAC'd with `CODE_SECRET`. Responses never reveal whether an account exists.
- Moderation endpoints require the `admin` or `moderator` role. Admins cannot be suspended until their admin role is removed.

## 9. Reels (round 5)
- A reel is a row in `posts` with `kind = 'reel'` (migration `008_reels.sql`, additive). Because it is a post, the `VISIBLE` clause, blocks, likes, comments, reports and moderation (hide/suspend) all apply unchanged. The Home feed shows only `kind = 'post'`; reels have their own feed (`GET /api/reels`).
- Upload `POST /api/reels` (multipart field `video`, optional `body`, `visibility`): MP4/MOV/WebM/3GP only, max **50 MB** and **60 s**. Files are written to a temp dir (not RAM), probed with `ffprobe`, re-encoded with `ffmpeg` (H.264 main, CRF 28, max 720x1280, max 30 fps, AAC 96k, `+faststart`, metadata stripped), and a 540x960 WebP poster is made. Rate limit: 20 uploads/hour per IP.
- ffmpeg is a free Debian package. `scripts/codespace-start.sh` installs it if missing; without it uploads return 503 and viewing still works. Override binaries with `FFMPEG_PATH` / `FFPROBE_PATH`.
- Views: `POST /api/reels/:id/view` after ~2 s of playback; one per viewer, the author's own views are not counted.
- Client: full-screen vertical scroll-snap feed at `/reels` (`/reels/:id` opens a specific reel, used for share links). Only the visible reel plays; neighbours get `preload="metadata"` (none on Data Saver), everything else loads nothing. Autoplay is muted; tap to unmute. Entry points: Home header icon, Reels card at the top of the Home feed, desktop sidebar, and the Create page menu. The bottom nav order (Home, Search, Create, Marketplace, Profile) is unchanged.

## 10. Branding, landing and welcome (round 5)
- Logo: `web/public/logo.svg` (original). Icons `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` are generated from it with sharp. The service worker cache name was bumped to `cx-static-v2` so phones pick up the new icons.
- Logged-out `/` shows the animated hero (`web/src/pages/Hero.tsx`) with a ~200 KB looping, muted stock video. Users with reduced motion or Data Saver get the still poster. Media licences are listed in `docs/CREDITS.md`.
- Signup and onboarding screens stay full white with the logo at the top, with no step counters and no placeholder examples. The brand touch is a logo pop-in and an animated accent line.
- After onboarding finishes, a one-time "Welcome, <first name>" screen (`web/src/pages/Welcome.tsx`, triggered with sessionStorage `cx-show-welcome`) shows highlights, then opens the Home feed.
- Mobile screenshots: `python3 scripts/round5_screens.py http://localhost:3000 a.mp4 b.mp4` → `screenshots/round5/` (gitignored).

## 11. Posts: composer, drafts, Recently deleted, reactions, saved, stories (round 5b, migration 009)
- Composer (`components/Composer.tsx`): Home shows a "What's on your mind?" card that opens a sheet with Photo/video, Camera, Feeling, Location and audience (Public / Friends / Only me). Uploads use XHR (`uploadForm` in `api.ts`) to show `Posting… NN%`, then a success toast (`toast()` + `<Toaster/>` in `App.tsx`). Errors show inline and as a red toast. Choosing a video posts it as a reel.
- Columns on `posts`: `is_draft`, `deleted_at`, `feeling`, `location_tag` (all with defaults that keep existing posts published). The `VISIBLE` SQL clause now also excludes drafts and deleted posts, so every read path hides them.
- ⋯ menu on your own posts: Edit post, Save as draft (`POST /posts/:id/draft`), Save post, and Delete. Delete opens a confirmation ("Are you sure you want to delete this post?") that offers Edit or Move to Drafts instead.
- `DELETE /posts/:id` is now a **soft delete** (`deleted_at`). Recently deleted (`GET /me/deleted`, `POST /posts/:id/restore`) keeps posts for 30 days. `startPurgeJob()` in `server/index.js` runs hourly (first run 30 s after start). It permanently removes posts deleted more than 30 days ago (and their files) plus stories that expired more than an hour ago. Drafts: `GET /me/drafts`, `POST /posts/:id/publish`. "Delete forever" (`DELETE /posts/:id/permanent`) only works on drafts and on posts already in Recently deleted. The UI for these lives at `/me/drafts`, `/me/deleted` and `/me/saved`, linked from the Profile hub.
- Reactions: `post_likes.reaction` (like/love/haha/wow/sad/angry, default `like`). `PUT /posts/:id/like {reaction}`. Long-press or ☺ opens the reaction bar.
- Saved posts: `saved_posts` table, `PUT|DELETE /posts/:id/save`, `GET /me/saved`. The share sheet offers native share, Copy link, WhatsApp, X, Facebook and Email (links only, no SDKs).
- Stories: `stories` table, photo + caption, visible for 24 h to you, your friends and your followers (blocks respected). `GET/POST /stories`, `DELETE /stories/:id`.
- Timestamps: `postTime()` shows Just now, 5m, 3h, Today 10:24 PM, Yesterday 9:10 AM, then the date, all in the viewer's local time. Edited posts show "Edited".
- Theme: `users.theme_pref` (light / dark / system, default system), set in Privacy and settings → Appearance and in Edit profile. It is stored on the device and on the account. Dark mode uses a true black background.
- Pull-to-refresh on Home, skeleton loaders, page fade-ins, a tiny `haptic()` (navigator.vibrate) on reactions and posting, safe-area padding, and an installable PWA (manifest `id`, shortcuts, standalone display, service worker cache `cx-static-v3`).

## 12. Media quality, camera and editor (round 5b, migration 010)
- Photos: original resolution up to 4096 px (posts), 2560 px (listings), 1440x2560 (stories) and 800 px (avatars). Encoded as WebP q90 in sRGB with EXIF orientation applied; GPS and other metadata are dropped. The upload limit is 15 MB. Optional `enhance=1` (posts and stories) applies a gentle sharpen, contrast and saturation boost.
- Reels produce two renditions. HQ keeps the original stream untouched (any resolution, including 4K) when it is already browser-safe H.264 8-bit with AAC or no audio in MP4/MOV. Otherwise it is re-encoded at CRF 19 with the original resolution, capped at 1080p on the short side. Data saver is 480p CRF 30 (`posts.video_low_path`). The client uses the 480p file when Data Saver is on or the connection is 2G/3G. An optional `cover` image (picked in the editor) becomes the poster. `posts.image_path` also points at the poster so caption-less reels satisfy the existing `posts` CHECK constraint.
- `components/MediaStudio.tsx` is fully client-side. It includes:
  - a camera (getUserMedia, front/rear switch, torch where supported, photo, or video up to 60 s via MediaRecorder);
  - an editor with crop ratios, rotate, zoom, 10 filters, adjustments (brightness, contrast, saturation, warmth, sharpen, fade), auto-enhance, text, emoji stickers and drawing. Export is a 95% JPEG up to 4096 px, with the pixel maths in `applyAdjust` so it works without canvas `filter` support;
  - an original SVG avatar maker.
  It is used by the composer, stories, the reel cover and the profile photo.
- Screenshots: `python3 scripts/round5b_screens.py http://localhost:3055 a.jpg b.jpg c.jpg` (light and dark) → `screenshots/round5/`.

## 13. Connectly AI: AI support chat (round 6, migration 011)
- Server proxy `server/ai.js`: `POST /api/ai/chat {conversation_id?, message}` calls Groq's OpenAI-compatible API (`GROQ_BASE_URL`, default `https://api.groq.com/openai/v1`; `GROQ_MODEL`, default `openai/gpt-oss-20b`) with `GROQ_API_KEY` from `.env`. The key is only ever on the server; it is never logged or sent to the browser. Replies stream back as NDJSON lines: `{conversation_id,title}`, then `{t}` deltas, then `{done,id}` or `{error,fallback:true}`.
- History: new tables `ai_conversations` and `ai_messages` (additive). `GET /api/ai/conversations`, `GET /api/ai/conversations/:id` (own chats only), `GET /api/ai/status`. The last 12 messages are sent as context.
- Limits (counted from `ai_messages`, so they survive restarts): `AI_USER_HOURLY` (default 30) per user per hour, `AI_DAILY_CAP` (default 900) for everyone per UTC day to stay inside the Groq free tier. Both return 429 with a friendly "try later" message.
- Fallback: no key gives 503 with a canned help message; Groq errors or timeouts (45 s) stream a friendly `{error}`. The UI shows it as a bubble.
- Scope (`SYSTEM_PROMPT`): a general assistant like Meta AI (knowledge, captions and posts, ideas, translation, homework help, advice) plus Connectly help. Safety rules: refuses harmful requests, never reveals other people's private data, cannot take account actions, points serious issues to Report.
- `POST /api/ai/write {prompt, draft?}` (one-shot, same limits, saved to history) powers "Write with Connectly AI" in the composer.
- Entry points: Home top bar ✦ button, Profile hub, Search (an "Ask Connectly AI" card on Discover, plus an "Ask Connectly AI “query”" row while typing that opens `/assistant?q=` and sends it), and the composer.
- Go Live needs the LiveKit host in CSP `connect-src`; `liveConnectSrc()` in `server/app.js` adds it when `FEATURE_LIVE=1`.
- Client `web/src/pages/Assistant.tsx` at `/assistant` (full screen): bubbles, typing dots, suggested questions, new chat, history panel, light/dark via theme variables.
- Tests: `tests/ai.test.js` uses a local mock Groq server.

## 14. Go Live (round 6, migration 012)
- Video runs on LiveKit Cloud (SFU). `server/live.js` mints short-lived JWTs with `livekit-server-sdk` from `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env` (never sent to the browser; only the per-room token is). The host gets `canPublish`, viewers get subscribe-only tokens. Without these vars, endpoints return 503 `LIVE_NOT_CONFIGURED`.
- Tables: `live_streams` (one live per host, `ends_by` = start + `LIVE_MAX_MINUTES`), `live_participants` (presence + counted seconds), `live_comments`, `live_reactions`; nullable `notifications.live_stream_id` and `reports.live_stream_id`.
- Who can watch: the host's friends and followers (blocks, suspensions and deactivations respected), the same audience as stories. Going live sends a `live` notification to them.
- Free-tier guard rails: 60 min per live, 20 concurrent viewers (`LIVE_MAX_VIEWERS`), and a monthly participant-minute budget (`LIVE_MONTHLY_MINUTES`, default 4500 of LiveKit's 5000) counted from 15 s heartbeats. All return 429 with friendly text. `sweepLive()` ends lives past their limit or whose host has gone silent for 90 s.
- Endpoints: `GET /live/status`, `GET /live`, `POST /live`, `GET /live/:id`, `POST /live/:id/join|heartbeat|leave|end|comments|reactions|report`, `GET /live/:id/events` (polled every 2 s). Moderation: `GET /admin/live`, `POST /admin/live/:id/end` (also closes the LiveKit room). Reports land in the normal queue as a user report tagged `[Live #id]`.
- Client: `pages/Live.tsx` (GoLive: camera preview, front/back switch, mic mute, camera off, timer, End; WatchLive: video, LIVE badge, viewer count, comments, floating reactions, Report). It publishes with simulcast (180p/360p/720p) plus `adaptiveStream`/`dynacast`, so slow networks get a lower layer. `components/LiveRow.tsx` holds the Home row, story rings and admin panel and does not import livekit-client (that stays in the lazy Live chunk).

## 15. Pre-permission screens (round 6)
- `web/src/lib/permission.tsx`: `askPermission(kind)` shows a branded sheet (logo, "Allow Connectly to use your camera", one-line reason, Allow / Not now) before any camera, microphone, location, contacts or notification prompt. The browser prompt fires only after Allow. If the Permissions API already says `denied`, or the API throws `NotAllowedError`, `showPermissionDenied(kind)` shows steps for turning it back on in iPhone and Android settings. Already-granted permissions skip the sheet.
- Used by the onboarding steps (notifications, location, contacts), `MediaStudio` (camera) and Go Live (camera + mic). Any new permission request must go through `askPermission`.
- PWA manifest `name` / `short_name` and the page `<title>` are all "Connectly".

## 16. Follow model, engagement lists, messaging limits (round 6, migration 013)
- **Follows replace friend requests.** One tap: `PUT|DELETE /users/:username/follow` (returns `follower_count`). Lists: `GET /users/:username/followers|following`. The profile shows Followers and Following counts, and the UI is at `/u/:username/followers|following` (`/friends` shows your own). `friendships` is kept untouched and the old `/friends*` endpoints still work, but the UI no longer uses them.
- Migration 013 copied relationships additively: accepted friendships became follows in both directions, and pending requests became a follow from the requester (`ON CONFLICT DO NOTHING`).
- The "Friends" audience now means accepted friendship OR mutual follow. Existing friends keep access, and a one-way follower does not gain access to friends-only posts.
- Home feed: your posts, people you follow, and spaces you belong to. If you follow nobody yet, it shows public posts for discovery.
- Safety limit: `FOLLOW_DAILY_LIMIT` (default 500 new follows per rolling 24 h) returns 429 "You’ve followed a lot of people today. Take a rest and try again tomorrow."
- `server/engagement.js`: `GET /posts/:id/reactions|commenters|shares` (visibility-checked, blocked people hidden). `POST /posts/:id/share {channel}` tracks shares in the existing `shares` table (new `channel` column), and posts expose `share_count`. Tapping the counts on posts and reels opens `components/Engagement.tsx`.
- Messaging: there are no user-to-user DMs yet. Comments and live comments have no daily caps, only burst limits (60 writes/min per IP, 20 live comments/min). Future messaging must use per-minute burst limits only. Connectly AI keeps its per-tier hourly and global daily limits.

## 17. Subscriptions (round 6, migration 014)
- Tables: `plans` (free/pro/premium; placeholder `price_minor` + `currency` editable by admins; `ai_hourly`; `perks` JSON: badge, reel_seconds, story_extras), `user_subscriptions` (tier per user, default free), `subscription_events` (audit).
- **Never show numeric limits or remaining counts to users.** User-facing plan APIs omit `ai_hourly`. Hitting the Connectly AI limit returns a friendly 429 ("You've reached your Connectly AI limit for now. Try again later or upgrade to Connectly Pro.") with `upgrade: true`, and the chat shows an Upgrade button. The Live UI also shows no numbers ("Ending soon", "This live is full right now").
- Screens: Settings › Subscription (`/settings/subscription`), Upgrade (`/settings/plans`), and a profile PRO/PREMIUM badge. Admin: a plan editor (name, price, currency, AI per hour) and a tier dropdown per user (`PUT /admin/users/:id/subscription`).
- Payments are pluggable (`server/payments/index.js`). The planned providers are **App Store** and **Google Play** in-app purchases for the store apps, plus an optional web card processor. Nothing charges yet: checkout returns 503 "Upgrades are coming soon." until a provider's credentials are set **and** `PAYMENTS_LIVE=1`.
- Perks hooks: `perks.reel_seconds` and `story_extras` are stored for the upcoming longer-reels and story features. Today only the badge and the AI allowance are enforced.

## 18. Rounds 7 and 8 (migrations 015, 016)
- Round 7: DMs with message requests (people you don't follow land in Requests), WebRTC calls (free public STUN only, so some strict networks can't connect), verified badge with an admin queue, hashtags, the For You feed, web push (VAPID keys live only in the server `.env`), core-string translations (not every screen yet), creator insights and scheduling, events, polls, close friends, two-step login and new-device alerts, and sounds.
- Round 8: music on stories and reels (bundled royalty-free tracks), AR face effects (MediaPipe, self-hosted in `web/public/mediapipe`), duets and remix, challenges, live gifts using coins (coins can only be granted by admins today; buying them says "Coming soon"), chat games, watch together, memories ("On this day"), stickers, and streaks with badges.
- 015 and 016 use ON DELETE CASCADE / SET NULL on every user reference, so deleting an account never fails.

## 19. Round 9 privacy (migration 017)
- Private accounts (follows become requests; going public approves pending ones), who can comment/tag/mention, hide online status (reciprocal), hide follower lists, restrict and mute, hidden words (a default list plus your own), disappearing messages, close-friends-only posts, Add Yours stickers, collections, a ZIP data export, email/phone discoverability, and teen safety (new under-18 accounts start private; adults they don't follow can't message them).
- **Defaults never change what existing users already show.** Every new column defaults to the old behaviour; only new teen signups start private.
- Screenshots can't be reliably detected on the web, and the app says so plainly.

## 20. Connectly AI: vision, voice and speed
- Photos: sent to a Groq vision model chosen from Groq's live model list (`GROQ_VISION_MODEL` to pin one). The Llama 4 vision models aren't on Groq's list right now; if no vision model is available the reply says so instead of failing. A 360px thumbnail is kept in the chat history.
- Voice: the mic records and auto-stops when you go quiet, then transcribes with Groq Whisper (`whisper-large-v3-turbo`) through our server; the clip is kept in history. Speak uses the browser's own speech in the user's language. Hands-free mode chains the two.
- Speed: keep-alive connections, a warm ping every 45s, a short prompt, and history capped at 8 messages. `ttft_ms` is in the final stream event; set `AI_LOG_TTFT=1` to log it. `GROQ_CHAT_MODEL` picks the chat model.

## 21. News, starter content and freshness
- News: public RSS only (BBC incl. language services, BBC Pidgin/Africa, Al Jazeera, Guardian, DW, NPR, Premium Times). Reuters and AP offer no free RSS. We show headline, source, image (through our resizing proxy, so publishers never see readers) and a link out; never full articles. Cached on the server and refreshed every 15 minutes; anything older than 48 hours is hidden. Personalised only from in-app signals (interests, searches, liked/followed hashtags, language, profile location, detected country). No cross-app tracking.
- Starter content (`FEATURE_BACKFILL`): so Home and Reels are never empty, they mix in news, public-domain/CC films from the Internet Archive and bundled CC BY Blender clips (with licence and source shown), suggested public accounts, and popular public posts. Never Friends-only, Only-me or private-account content.
- Freshness: content loads fresh when the app opens or is reopened after 10+ minutes (Home and Reels). While open, nothing reorders by itself; a "New posts" pill only notifies, and new items come in on tap or pull-to-refresh. Infinite scroll at the bottom. Starter films and clips you've seen on a device go to the back of the line.

## 22. Local currency (migration 018, `FEATURE_LOCAL_CURRENCY`)
- Country detection is private: manual choice > our own offline IP-to-country table (DB-IP Lite, CC BY 4.0, downloaded monthly into `server/data/`, which is git-ignored) > device time zone > device language. **User IPs are never sent to any third party.**
- Settings › Country and currency lets people pick a country and/or currency by hand.
- Admin › Local prices: a USD base per item (`plan:pro`, `plan:premium`, `coins:<n>`) plus per-country overrides in that country's currency. A plan without a USD base keeps its existing price in its own currency (so existing Nigerian prices are unchanged) and is converted for everyone else.
- Rates: open.er-api.com (free, no key), cached daily in `server/data/rates.json`. Converted prices are rounded to friendly points (4.99, 1,500, 15,000) and marked "≈"; formatting uses `Intl.NumberFormat`.
- Marketplace keeps the seller's price and currency and adds an approximate conversion.
- **Store apps:** in the App Store and Google Play builds, Apple and Google set and charge local prices; these server prices are for the web only.

## 23. Save to gallery (migration 019, `FEATURE_DOWNLOADS`)
- ⋯ › Save to gallery on posts, a Save button in the photo viewer and on Reels. The server makes an HD copy with a small Connectly mark and @creator (sharp for photos, ffmpeg for video). On iPhone the share sheet opens (Save Image / Save Video); elsewhere the file downloads.
- Never for private accounts, friends-only, close-friends or only-me posts, or music that isn't openly licensed. Owners can turn downloads off per post (⋯ menu) or for their whole account (Privacy › Downloads; on by default).

## 24. Profile redesign (migration 020)
- Full-bleed cover with parallax, glass top bar (back, search, ⋯), gradient-ring avatar, a rounded sheet, name with verified badge and category, compact stats, bio with See more, and big Follow/Message (or Edit/Share) buttons. Sticky pill tabs (All, Photos, Reels, Mentions) and an At a glance card.
- New optional fields: `category`, `website`, `socials` (Instagram, X, TikTok, YouTube, LinkedIn usernames), and `public_contact`, shown only if `show_contact` is on. All are empty or hidden by default. Details visibility rules still apply.

## 25. Quality checks
- `npm run test:e2e` (set `E2E_BASE` to a local server seeded with `SEED_DEMO=1`) visits every route at 320, 375, 390 and 430 px. It fails if anything scrolls sideways, a card renders blank, the page is blank, or there are console or page errors. Never run it against production.
- Live AI speed (Oct 2026, server to Groq, short prompt): time to first token is about 270 ms on `openai/gpt-oss-20b` (the current chat model) and about 390 ms on `gpt-oss-120b`. Groq doesn't list the Llama chat models right now.

## 26. Round 10 (migration 021)
- **Translation** (`FEATURE_AUTO_TRANSLATE`, with `FEATURE_TRANSLATE`): "See translation" on posts, comments and DMs. Settings › Language › Always translate does it automatically. Groq translates and results are cached in `translations` (sha256 of the text plus the target language). Text already in your language is detected and remembered, so the button disappears.
- **Friends feed** (`FEATURE_FRIENDS_FEED`): a Home tab, `GET /feed/friends`, showing only close friends and mutual follows. No news, films, suggestions or Reels banner.
- **AI creator helper** (`FEATURE_AI_CREATOR`): in the composer's "Write with Connectly AI" panel there are Caption, Improve, Hashtags (tap to add) and Ideas buttons, plus Enhance photo, which turns on the editor's existing auto-enhance. Calls `POST /ai/creator`.
- **Tips and earnings** (`FEATURE_TIPS`): coin tips on posts (⋯ menu) and profiles (🪙 button). `/me/earnings` shows totals, the last 30 days, a 14-day chart and top supporters. Gifts were already open to every creator who goes live. Buying coins and cashing out stay "Coming soon".
- **Store rules:** in the iOS and Android apps, coins *must* be sold through Apple and Google in-app purchase (they take a 15–30% cut). Paying creators out needs a payout provider plus identity and tax checks. Don't add web checkout links inside the store apps.
- **Lite mode** (`FEATURE_LITE_MODE`): Settings › Lite mode (Automatic / Always on / Off). Automatic means Data Saver is on, the connection is 2G/3G, or the device has very little memory. It shows 480px photos (`/api/img/lite`, cached in `uploads/.lite`), doesn't autoplay reels, turns off animations and blur, and loads smaller pages.
- **Safety Center** (`FEATURE_SAFETY_CENTER`): Settings › Safety Center gathers every control in plain language. Deleting an account now has a 30-day grace period (logging in cancels it; an hourly job purges accounts after that). Reporting is one tap with reasons, and reporters get a notification when their report is reviewed or acted on. "Your reports" shows their status. /privacy and /terms are marked as templates that need a lawyer's review.
- **Anti-scam** (`FEATURE_ANTI_SCAM`):
  - Links in posts, comments and DMs are checked (a blocklist plus heuristics: lookalike brands, shorteners, IP or punycode hosts, risky domain endings, http) and risky ones show a warning first.
  - DMs show a "Possible scam" banner when a new account asks about money, codes, passwords, crypto or investments.
  - New unverified accounts copying a verified person's name are flagged in Admin › Safety flags.
  - Accounts younger than 7 days can only start a few new chats a day with people who don't follow them.
  - "Scam or fraud" reports go to the top of the admin list.
  - Code screens and the AI say Connectly never asks for codes.
  - Photo-copy detection isn't done yet.

### 26.x Message controls (FEATURE_MSG_CONTROLS)
- Edit own text message within 15 minutes: `PATCH /api/messages/:id` sets `edited_at`; bubbles show "Edited".
- Delete for me: `POST /api/messages/:id/hide` (table `message_hidden`). Unsend for everyone stays `DELETE /api/messages/:id`.
- Read receipts: `users.read_receipts` (Privacy › Messages). Reciprocal: off hides your "Seen" and others' from you.
- Chat list shows a green dot / "Active Xm ago" from `sessions.last_seen_at`, hidden when either side hides activity status.

### 26.y Global defaults
- Phone country defaults come from the device (timezone/locale) with US fallback; server defaults are US. Currency comes from `/pricing/context` (USD fallback). Starter search ideas, sample text and the AI suggestions are location-neutral; news only localises lightly by region/language. Default language is "English (International)".

### 26.z Paid verification (FEATURE_PAID_VERIFICATION)
- Settings › Get verified (`pages/GetVerified.tsx`, `server/paidverify.js`, migration 022). Monthly price is localised via `priceFor('paid_verification', { usd_cents: 999 })` (admin price overrides apply).
- Requirements: photo + bio, account ≥ 30 days, two-step login on, no suspension or upheld reports in 90 days, ID + selfie upload. Images are stored in `verify-private/` (outside public uploads, never backed up to git) and deleted after review.
- Admin › Paid verification queue approves/rejects (sets `paid_approved_at`). The badge turns on only while `paid_verified_until > now()`; `syncPaidBadges()` (every 10 min) adds it and removes it when the subscription lapses. Payment is "Coming soon": Apple/Google require in-app purchase for paid verification in mobile apps.
- Benefits: badge (reuses `verified_at`, so impersonation protection applies), paid-verified users rank higher in people search, their reports are sorted first for admins. Notable (admin-granted) verification is separate (`verified_kind = 'notable'`) and never lapses.

### 26.s Security changes need a code
- `POST /api/me/security-code {password, action}` emails a 6-digit code to the account's current email (device, country, UTC time, "secure my account" link). `/me/password` needs `code`; `/me/identifier/start` needs `sec_code`. Wrong-password lockout per user, max 5 codes/hour, 5 attempts per code. After a change: other sessions are signed out and an alert email goes out (to the old address for email changes).

### 26.p Phone sign-up / login (FEATURE_PHONE_AUTH, off)
- Works only with the flag AND a delivery channel. `server/sms.js` tries WhatsApp Cloud API auth template → Telegram Gateway → SMS (Termii / Africa's Talking / Twilio). `/auth/otp/start` + `/auth/otp/verify` (account picker when a number has several accounts; two-step accounts must use password login). Linking a phone uses Settings › Phone (security code + code to the phone).

### 26.k Sticker packs (FEATURE_STICKER_PACKS)
- `server/stickerpacks.js`, migration 024, `components/StickerPacks.tsx`. Personal packs, maker (crop/shape/border/text on canvas; no automatic background removal), PNG/WebP import, share link `/stickers/add/<token>`, saving packs, stickers in DMs (`sticker_id`) and comments (`sticker_id` / `sticker_key`). Reports: 3 open reports auto-hide a pack; Admin › Reported sticker packs.

### 26.e Message encryption at rest (FEATURE_MSG_ENCRYPTION + MESSAGE_KEY)
- `server/msgcrypt.js`: AES-256-GCM, text stored as `v1:<base64>`; new media is moved to `msg-private/` encrypted and served via `/api/messages/:id/media|poster` to members only (Range supported). `encryptBacklog()` runs every minute and converts old rows one by one, verifying decryption first. Legacy plaintext stays readable.
- MESSAGE_KEY must be stored safely outside the codespace: without it, encrypted messages in backups can't be read.
- 500 errors are logged without row values; HTTPS_ONLY=1 redirects http and sends HSTS.
- Planned (not built): opt-in end-to-end encrypted chats (see the round 10 report).
