-- Round 9: privacy + Connectly AI image/voice. Additive only; every default keeps existing users' current visibility.
-- AI attachments (image questions, voice notes)
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS attachment_path TEXT;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS attachment_kind TEXT;
-- Private accounts + follow requests (default public = today's behaviour)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS follow_requests (
  requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id));
CREATE INDEX IF NOT EXISTS follow_requests_target ON follow_requests (target_id, created_at DESC);
-- "Who can" controls (everyone = today's behaviour)
ALTER TABLE users ADD COLUMN IF NOT EXISTS who_can_comment TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE users ADD COLUMN IF NOT EXISTS who_can_tag TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE users ADD COLUMN IF NOT EXISTS who_can_mention TEXT NOT NULL DEFAULT 'everyone';
-- Presence
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_presence BOOLEAN NOT NULL DEFAULT false;
-- Lists
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_follow_lists BOOLEAN NOT NULL DEFAULT false;
-- Hidden words
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_words TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_words_on BOOLEAN NOT NULL DEFAULT false;
-- Discoverability by exact email / phone (off = today's behaviour: search never matched email or phone)
ALTER TABLE users ADD COLUMN IF NOT EXISTS discover_by_email BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discover_by_phone BOOLEAN NOT NULL DEFAULT false;
-- Restrict + mute
CREATE TABLE IF NOT EXISTS restricts (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, target_id));
CREATE TABLE IF NOT EXISTS mutes (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  posts BOOLEAN NOT NULL DEFAULT true, stories BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, target_id));
-- Close-friends posts + collections
ALTER TABLE posts ADD COLUMN IF NOT EXISTS close_friends_only BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS collections (
  id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS collections_user ON collections (user_id);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (collection_id, post_id));
-- "Add yours" story sticker
ALTER TABLE stories ADD COLUMN IF NOT EXISTS add_yours TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS add_yours_of INT REFERENCES stories(id) ON DELETE SET NULL;
-- Disappearing messages
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS disappear_seconds INT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS messages_expires ON messages (expires_at) WHERE expires_at IS NOT NULL;
-- Text size (per account; NULL = default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS text_scale REAL;
-- In-app search history (used only to personalise News; capped; included in the data export)
CREATE TABLE IF NOT EXISTS search_history (
  id BIGSERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS search_history_user ON search_history (user_id, created_at DESC);
