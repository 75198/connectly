-- Save to gallery: per-post setting (NULL = follow the owner's default) and a per-account default. Additive only.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS allow_downloads BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_downloads BOOLEAN NOT NULL DEFAULT true;
