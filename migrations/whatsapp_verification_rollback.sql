-- ── WhatsApp — Rollback Migration ──────────────────────────────────────────
-- Fully reverses whatsapp_verification_forward.sql.
-- After running this, git checkout 786e01d -- index.html \
--   "Supabse Edge Functions/submit-journey/index.ts" \
--   "Supabse Edge Functions/resend-pin/index.ts" \
--   "Supabse Edge Functions/verify-pin/index.ts" \
--   "Supabse Edge Functions/batch-send-emails/index.ts" \
--   "Supabse Edge Functions/update-match-status/index.ts" \
--   "Supabse Edge Functions/update-email-prefs/index.ts" \
--   unsubscribe.html
-- Then: rm -rf "Supabse Edge Functions/get-form-config" migrations/

-- Phase 2 rollback
ALTER TABLE users
  DROP COLUMN IF EXISTS unsubscribed_whatsapp;

-- Phase 1 rollback
ALTER TABLE submissions
  DROP COLUMN IF EXISTS whatsapp_number,
  DROP COLUMN IF EXISTS whatsapp_verification_status,
  DROP COLUMN IF EXISTS whatsapp_verification_pin,
  DROP COLUMN IF EXISTS whatsapp_verification_pin_expires_at;

DELETE FROM config
WHERE key IN (
  'whatsapp_verification_enabled',
  'whatsapp_matches_notification_enabled',
  'whatsapp_interest_reminder_enabled',
  'whatsapp_fallback_to_email',
  'whatsapp_provider'
);
