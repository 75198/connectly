-- Allow the 'security_change' code purpose (password/email/phone changes need an emailed code).
ALTER TABLE email_codes DROP CONSTRAINT IF EXISTS email_codes_purpose_check;
ALTER TABLE email_codes ADD CONSTRAINT email_codes_purpose_check CHECK (purpose IN ('verify_email','reset_password','find_account','change_identifier','security_change','login_code'));
