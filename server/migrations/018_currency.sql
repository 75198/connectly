-- Local currency: admin price book (USD base) + per-country overrides; per-user region override. Additive only.
CREATE TABLE IF NOT EXISTS price_book (
  item TEXT PRIMARY KEY,
  usd_cents INT CHECK (usd_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS price_overrides (
  item TEXT NOT NULL,
  country CHAR(2) NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item, country)
);
INSERT INTO price_book (item, usd_cents) VALUES ('coins:100', 99), ('coins:550', 499), ('coins:1200', 999), ('coins:2500', 1999) ON CONFLICT (item) DO NOTHING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_override CHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency_override CHAR(3);
