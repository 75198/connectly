-- 007: bot protection, session expiry, moderation. ADDITIVE ONLY: new columns are nullable or have
-- defaults, new tables/indexes only. No existing row is deleted or rewritten except giving existing
-- saved logins an expiry 60 days from now (they keep working until then, and slide on use).
CREATE TABLE IF NOT EXISTS pow_used (
  nonce TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE saved_logins ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 days');
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at DESC);
