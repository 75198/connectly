-- Phone-code channel health (balance / last error) for admin alerts. Additive only.
CREATE TABLE IF NOT EXISTS otp_channel_status (channel TEXT PRIMARY KEY, balance NUMERIC, currency TEXT, low BOOLEAN NOT NULL DEFAULT false, last_error TEXT, last_error_at TIMESTAMPTZ, checked_at TIMESTAMPTZ, alerted_at TIMESTAMPTZ);
