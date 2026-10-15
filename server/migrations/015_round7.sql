-- 015 (round 7): direct messages, verified badge, hashtags, creator tools, push, i18n, events, polls,
-- close friends, hide like counts, two-step login. Additive only: new tables and nullable/defaulted columns.
CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY, is_group BOOLEAN NOT NULL DEFAULT false, title TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  direct_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), left_at TIMESTAMPTZ,
  last_read_id BIGINT NOT NULL DEFAULT 0, typing_at TIMESTAMPTZ, theme TEXT, wallpaper_path TEXT, accepted_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id));
CREATE INDEX IF NOT EXISTS conversation_members_user ON conversation_members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY, conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'text', body TEXT NOT NULL DEFAULT '', media_path TEXT, poster_path TEXT, media_hd BOOLEAN NOT NULL DEFAULT false,
  meta JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS chat_prefs (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, theme TEXT, wallpaper_path TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dm_privacy TEXT NOT NULL DEFAULT 'everyone';
CREATE TABLE IF NOT EXISTS verification_requests (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ, decided_by BIGINT REFERENCES users(id) ON DELETE SET NULL);

CREATE TABLE IF NOT EXISTS post_hashtags (post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, tag TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (post_id, tag));
CREATE INDEX IF NOT EXISTS post_hashtags_tag ON post_hashtags(tag, created_at DESC);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hide_like_count BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS post_impressions (post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (post_id, user_id));

CREATE TABLE IF NOT EXISTS push_subscriptions (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_like_counts BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY, creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ, location TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'public',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reminded_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS event_rsvps (event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (event_id, user_id));
CREATE TABLE IF NOT EXISTS polls (id BIGSERIAL PRIMARY KEY, post_id BIGINT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE, question TEXT NOT NULL, options JSONB NOT NULL, closes_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS poll_votes (poll_id BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, option_idx INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (poll_id, user_id));

CREATE TABLE IF NOT EXISTS close_friends (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, friend_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, friend_id));
ALTER TABLE stories ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_step_email BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS known_devices (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_hash TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, device_hash));
CREATE TABLE IF NOT EXISTS login_challenges (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, user_agent TEXT NOT NULL DEFAULT '', expires_at TIMESTAMPTZ NOT NULL, attempts INT NOT NULL DEFAULT 0, used_at TIMESTAMPTZ, email_code_hash TEXT, email_sent_at TIMESTAMPTZ);
