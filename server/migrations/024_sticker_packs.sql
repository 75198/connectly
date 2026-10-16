-- Personal sticker packs, sharing by link, stickers in comments, pack reports. Additive only.
CREATE TABLE IF NOT EXISTS sticker_packs (id BIGSERIAL PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, is_public BOOLEAN NOT NULL DEFAULT false,
  share_token TEXT NOT NULL UNIQUE, hidden_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS stickers (id BIGSERIAL PRIMARY KEY, pack_id BIGINT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE, image_path TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS stickers_pack_idx ON stickers (pack_id, id);
CREATE TABLE IF NOT EXISTS user_sticker_packs (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_id BIGINT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, pack_id));
CREATE TABLE IF NOT EXISTS sticker_pack_reports (pack_id BIGINT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE, reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ, PRIMARY KEY (pack_id, reporter_id));
ALTER TABLE comments ADD COLUMN IF NOT EXISTS sticker_id BIGINT REFERENCES stickers(id) ON DELETE SET NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS sticker_key TEXT;
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_body_check;
ALTER TABLE comments ADD CONSTRAINT comments_body_check CHECK (length(body) > 0 OR sticker_id IS NOT NULL OR sticker_key IS NOT NULL);
