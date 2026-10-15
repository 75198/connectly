-- 010: data-saver video rendition for reels. ADDITIVE ONLY (nullable column; existing reels keep
-- playing their single rendition).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_low_path TEXT;
