-- Paid verification (subscription). Additive only. Admin-granted "notable" verification keeps verified_kind NULL/'notable'.
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'notable';
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS id_doc_file TEXT;
ALTER TABLE verification_requests ADD COLUMN IF NOT EXISTS selfie_file TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_kind TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_approved_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_verified_until TIMESTAMPTZ;
