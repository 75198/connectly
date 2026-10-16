-- Round 10: translation cache, auto-translate + lite mode prefs, coin tips. Additive only.
CREATE TABLE IF NOT EXISTS translations (hash TEXT NOT NULL, target TEXT NOT NULL, text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (hash, target));
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_translate BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lite_mode TEXT NOT NULL DEFAULT 'auto' CHECK (lite_mode IN ('auto', 'on', 'off'));
CREATE TABLE IF NOT EXISTS tips (
  id BIGSERIAL PRIMARY KEY,
  from_user BIGINT REFERENCES users(id) ON DELETE SET NULL,
  to_user BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT REFERENCES posts(id) ON DELETE SET NULL,
  coins INT NOT NULL CHECK (coins > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tips_to_idx ON tips (to_user, created_at DESC);
-- Safety: account deletion with a 30-day grace period (log in again to cancel).
ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_after TIMESTAMPTZ;
-- Anti-scam: automatic flags for admins (impersonation of verified accounts, etc.).
CREATE TABLE IF NOT EXISTS safety_flags (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS safety_flags_open_uq ON safety_flags (user_id, kind) WHERE resolved_at IS NULL;
-- Messages: edit (15 min), delete for me, read-receipts setting.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS message_hidden (message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (message_id, user_id));
ALTER TABLE users ADD COLUMN IF NOT EXISTS read_receipts BOOLEAN NOT NULL DEFAULT true;
