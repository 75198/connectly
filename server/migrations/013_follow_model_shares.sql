-- Round 6: Follow model replaces friend requests. Additive only: friendships stay untouched;
-- accepted friendships become follows in both directions, pending requests become a follow from the requester.
INSERT INTO follows (follower_id, followee_id, created_at)
  SELECT requester_id, addressee_id, COALESCE(responded_at, created_at) FROM friendships WHERE status IN ('accepted', 'pending') AND requester_id <> addressee_id
  ON CONFLICT DO NOTHING;
INSERT INTO follows (follower_id, followee_id, created_at)
  SELECT addressee_id, requester_id, COALESCE(responded_at, created_at) FROM friendships WHERE status = 'accepted' AND requester_id <> addressee_id
  ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS follows_follower_time ON follows (follower_id, created_at);
CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee_id);
-- Reshare/share tracking (existing shares table, new optional channel column).
ALTER TABLE shares ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'reshare';
CREATE INDEX IF NOT EXISTS shares_post ON shares (post_id, created_at DESC);
