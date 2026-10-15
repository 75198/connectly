# Connectly — Milestone 1

An original social network: Node 20 + Express 5 + PostgreSQL REST API (`/api`) and a React + Vite + TypeScript web client (`web/`). The API is client-agnostic, so iOS/Android apps can reuse it later.

* Branding (name, logo, colours): `web/src/brand.ts` and `web/public/logo.svg`
* Schema/migrations: `server/migrations/*.sql` (applied automatically on `npm start`)
* Tests: `npm test` (needs a Postgres `connectly_test` database or `TEST_DATABASE_URL`)
* Codespace start/restart: `bash scripts/codespace-start.sh`

## Security
bcrypt (cost 12) passwords; opaque session tokens stored hashed in Postgres, sent as an `HttpOnly; Secure; SameSite=Strict` cookie; CSRF header + Origin check on every write; helmet (CSP etc.); rate limits on auth (20 per 15 min) and writes; zod validation with strict schemas; ownership checks and visibility filtering done in SQL; uploads limited to 5 MB images and re-encoded to WebP with sharp (EXIF stripped).

## Needs configuration (not in Milestone 1)
* **Email delivery**: signup confirmation and password-reset use 6-digit codes (HMAC-hashed, 10-min expiry, 5 attempts, 60s resend cooldown). Set SMTP_HOST/PORT/USER/PASS/FROM (e.g. Brevo) in `.env`; until then codes are only printed in the server log (`/tmp/app.log`, lines starting `[mail:NOT-CONFIGURED]`).
