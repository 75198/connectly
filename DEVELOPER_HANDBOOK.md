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
| Files | Images re-encoded by sharp | `uploads/` (gitignored) |
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
