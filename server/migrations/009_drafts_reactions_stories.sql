-- 009: drafts, soft delete (Recently deleted, 30 days), feeling/location tags, reactions, saved posts,
-- stories (24h) and per-account theme. ADDITIVE ONLY: defaults keep every existing post published,
-- not deleted, and every existing like a plain 'like'.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS feeling TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_tag TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS posts_deleted ON posts (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_drafts ON posts (author_id) WHERE is_draft;
ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS reaction TEXT NOT NULL DEFAULT 'like';
CREATE TABLE IF NOT EXISTS saved_posts (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS stories (
  id BIGSERIAL PRIMARY KEY,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS stories_live ON stories (expires_at, author_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_pref TEXT NOT NULL DEFAULT 'system';
