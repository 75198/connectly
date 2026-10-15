-- Friends/follows/notifications wiring, blocks, pages/groups/communities, marketplace,
-- sessions metadata, login history, saved logins per device, privacy defaults.
CREATE TABLE blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id), CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_id);

CREATE TABLE spaces (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('page','group','community')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX spaces_slug ON spaces (lower(slug));
CREATE INDEX spaces_search_trgm ON spaces USING gin (lower(name) gin_trgm_ops);
CREATE TABLE space_members (
  space_id BIGINT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','follower')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX space_members_user ON space_members (user_id);

ALTER TABLE posts ADD COLUMN space_id BIGINT REFERENCES spaces(id) ON DELETE CASCADE;     -- posted into a page/group/community
ALTER TABLE posts ADD COLUMN as_space_id BIGINT REFERENCES spaces(id) ON DELETE CASCADE;  -- posted as a page
CREATE INDEX posts_space ON posts (space_id, id DESC);
ALTER TABLE comments ADD COLUMN as_space_id BIGINT REFERENCES spaces(id) ON DELETE CASCADE;

ALTER TABLE notifications ADD COLUMN space_id BIGINT REFERENCES spaces(id) ON DELETE CASCADE;
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE sessions ADD COLUMN acting_space_id BIGINT REFERENCES spaces(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN approx_location TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN id BIGSERIAL UNIQUE;

CREATE TABLE login_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT NOT NULL DEFAULT 'password',
  ip TEXT, user_agent TEXT, approx_location TEXT NOT NULL DEFAULT ''
);
CREATE INDEX login_history_user ON login_history (user_id, id DESC);

-- "Save this account" on a device: httpOnly device cookie (hashed here) -> user. No passwords stored.
CREATE TABLE saved_logins (
  device_hash TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  PRIMARY KEY (device_hash, user_id)
);

ALTER TABLE users ADD COLUMN default_post_visibility TEXT NOT NULL DEFAULT 'public' CHECK (default_post_visibility IN ('public','friends','private'));
ALTER TABLE users ADD COLUMN profile_details_visibility TEXT NOT NULL DEFAULT 'public' CHECK (profile_details_visibility IN ('public','friends','private'));

ALTER TABLE email_codes DROP CONSTRAINT email_codes_purpose_check;
ALTER TABLE email_codes ADD CONSTRAINT email_codes_purpose_check CHECK (purpose IN ('verify_email','reset_password','find_account','change_identifier'));

CREATE TABLE listings (
  id BIGSERIAL PRIMARY KEY,
  seller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  place_id INT,
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listings_browse ON listings (status, id DESC);
CREATE INDEX listings_title_trgm ON listings USING gin (lower(title) gin_trgm_ops);
CREATE TABLE listing_photos (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0
);
CREATE INDEX listing_photos_listing ON listing_photos (listing_id, position);
