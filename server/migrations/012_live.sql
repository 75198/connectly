-- Round 6: Go Live (LiveKit). Additive only: new tables + nullable link columns.
CREATE TABLE IF NOT EXISTS live_streams (
  id BIGSERIAL PRIMARY KEY,
  host_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_by TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  ended_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  peak_viewers INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS live_streams_live_idx ON live_streams (status, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_per_host ON live_streams (host_id) WHERE status = 'live';
CREATE TABLE IF NOT EXISTS live_participants (
  stream_id BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_host BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  seconds INT NOT NULL DEFAULT 0,
  PRIMARY KEY (stream_id, user_id)
);
CREATE INDEX IF NOT EXISTS live_participants_joined_idx ON live_participants (joined_at);
CREATE TABLE IF NOT EXISTS live_comments (
  id BIGSERIAL PRIMARY KEY,
  stream_id BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_comments_stream_idx ON live_comments (stream_id, id);
CREATE TABLE IF NOT EXISTS live_reactions (
  id BIGSERIAL PRIMARY KEY,
  stream_id BIGINT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_reactions_stream_idx ON live_reactions (stream_id, id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS live_stream_id BIGINT REFERENCES live_streams(id) ON DELETE CASCADE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS live_stream_id BIGINT REFERENCES live_streams(id) ON DELETE SET NULL;
