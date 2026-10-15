-- Onboarding rework: full legal name (no display name), email OR phone identity, DOB, terms, onboarding state.
ALTER TABLE users RENAME COLUMN display_name TO full_name;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN phone TEXT;            -- E.164, e.g. +2348012345678
ALTER TABLE users ADD COLUMN birth_date DATE;       -- private, never returned to other users
ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
ALTER TABLE users ADD CONSTRAINT users_identity CHECK (email IS NOT NULL OR phone IS NOT NULL);
CREATE UNIQUE INDEX users_phone ON users (phone) WHERE phone IS NOT NULL;
UPDATE users SET onboarded_at = now(), terms_accepted_at = COALESCE(terms_accepted_at, now());
