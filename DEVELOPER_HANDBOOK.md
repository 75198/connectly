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
| `FEATURE_WELCOME_HERO` | 1 | Animated video landing screen at `/` for logged-out visitors (off: `/` goes straight to Log in) |
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
- System prompt (`SYSTEM_PROMPT`): Connectly help only, never reveals other users' data, cannot take account actions, points serious issues to Report.
- Client `web/src/pages/Assistant.tsx` at `/assistant` (full screen): bubbles, typing dots, suggested questions, new chat, history panel, light/dark via theme variables.
- Tests: `tests/ai.test.js` uses a local mock Groq server.

## 14. Go Live (round 6, migration 012)
- Video runs on LiveKit Cloud (SFU). `server/live.js` mints short-lived JWTs with `livekit-server-sdk` from `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env` (never sent to the browser; only the per-room token is). The host gets `canPublish`, viewers get subscribe-only tokens. Without these vars, endpoints return 503 `LIVE_NOT_CONFIGURED`.
- Tables: `live_streams` (one live per host, `ends_by` = start + `LIVE_MAX_MINUTES`), `live_participants` (presence + counted seconds), `live_comments`, `live_reactions`; nullable `notifications.live_stream_id` and `reports.live_stream_id`.
- Who can watch: the host's friends and followers (blocks, suspensions and deactivations respected), the same audience as stories. Going live sends a `live` notification to them.
- Free-tier guard rails: 60 min per live, 20 concurrent viewers (`LIVE_MAX_VIEWERS`), and a monthly participant-minute budget (`LIVE_MONTHLY_MINUTES`, default 4500 of LiveKit's 5000) counted from 15 s heartbeats. All return 429 with friendly text. `sweepLive()` ends lives past their limit or whose host has gone silent for 90 s.
- Endpoints: `GET /live/status`, `GET /live`, `POST /live`, `GET /live/:id`, `POST /live/:id/join|heartbeat|leave|end|comments|reactions|report`, `GET /live/:id/events` (polled every 2 s). Moderation: `GET /admin/live`, `POST /admin/live/:id/end` (also closes the LiveKit room). Reports land in the normal queue as a user report tagged `[Live #id]`.
- Client: `pages/Live.tsx` (GoLive: camera preview, front/back switch, mic mute, camera off, timer, End; WatchLive: video, LIVE badge, viewer count, comments, floating reactions, Report). It publishes with simulcast (180p/360p/720p) plus `adaptiveStream`/`dynacast`, so slow networks get a lower layer. `components/LiveRow.tsx` holds the Home row, story rings and admin panel and does not import livekit-client (that stays in the lazy Live chunk).
