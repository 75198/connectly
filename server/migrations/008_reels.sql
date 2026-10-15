-- 008: Reels (short vertical videos). ADDITIVE ONLY: new nullable columns / columns with defaults
-- that match existing behaviour (every existing post stays kind = 'post'), plus one new table.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'post';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_path TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS poster_path TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_seconds REAL;
CREATE TABLE IF NOT EXISTS reel_views (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS posts_reels ON posts (id DESC) WHERE kind = 'reel';
