-- One email/phone may own several accounts (distinct passwords), codes keyed by identifier,
-- deactivation, notification prefs, richer profile, offline places dataset.
DROP INDEX users_email_lower;
DROP INDEX users_phone;
CREATE INDEX users_email_lower ON users (lower(email));
CREATE INDEX users_phone ON users (phone) WHERE phone IS NOT NULL;
ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN inapp_notifications BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN interests TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN relationship_status TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN work_company TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN work_role TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN education TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN current_place_id INT;
ALTER TABLE users ADD COLUMN hometown TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN hometown_place_id INT;

DELETE FROM email_codes;
ALTER TABLE email_codes ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE email_codes ADD COLUMN identifier TEXT NOT NULL;
ALTER TABLE email_codes DROP CONSTRAINT email_codes_purpose_check;
ALTER TABLE email_codes ADD CONSTRAINT email_codes_purpose_check CHECK (purpose IN ('verify_email','reset_password','find_account'));
DROP INDEX email_codes_lookup;
CREATE INDEX email_codes_lookup ON email_codes (identifier, purpose, created_at DESC);

-- short-lived proof that someone received a code for an identifier (used to pick an account)
CREATE TABLE identity_tickets (
  token_hash TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

-- GeoNames cities500 (CC-BY 4.0), loaded by scripts/load-places.js
CREATE TABLE places (
  id INT PRIMARY KEY,
  name TEXT NOT NULL,
  ascii_name TEXT NOT NULL,
  admin1 TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL,
  country_code TEXT NOT NULL,
  population BIGINT NOT NULL DEFAULT 0,
  display TEXT NOT NULL
);
CREATE INDEX places_prefix ON places (lower(ascii_name) text_pattern_ops);
CREATE INDEX places_name_prefix ON places (lower(name) text_pattern_ops);
CREATE INDEX places_trgm ON places USING gin (lower(ascii_name) gin_trgm_ops);
