-- Round 6: subscription tiers (Free, Connectly Pro, Connectly Premium). Additive: new tables only.
-- Prices are placeholders (admin-editable); no payments are taken until a provider is configured.
CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY CHECK (code IN ('free', 'pro', 'premium')),
  name TEXT NOT NULL,
  price_minor INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  billing_interval TEXT NOT NULL DEFAULT 'month',
  ai_hourly INT NOT NULL,
  perks JSONB NOT NULL DEFAULT '{}',
  sort INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO plans (code, name, price_minor, ai_hourly, perks, sort) VALUES
  ('free', 'Free', 0, 30, '{"badge": false, "reel_seconds": 60, "story_extras": false}', 0),
  ('pro', 'Connectly Pro', 150000, 100, '{"badge": "pro", "reel_seconds": 90, "story_extras": true}', 1),
  ('premium', 'Connectly Premium', 350000, 300, '{"badge": "premium", "reel_seconds": 180, "story_extras": true}', 2)
ON CONFLICT (code) DO NOTHING;
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free' REFERENCES plans(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due')),
  provider TEXT,
  provider_ref TEXT,
  current_period_end TIMESTAMPTZ,
  set_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  from_tier TEXT,
  to_tier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
