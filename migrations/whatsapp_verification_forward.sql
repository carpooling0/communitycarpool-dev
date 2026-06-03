-- ── WhatsApp — Forward Migration ───────────────────────────────────────────
-- Apply to dev first. Only apply to prod when explicitly instructed.
-- Rollback: run whatsapp_verification_rollback.sql

-- Phase 1: WhatsApp verification on submissions
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS whatsapp_number                      TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_verification_status         TEXT DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS whatsapp_verification_pin            TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_verification_pin_expires_at TIMESTAMPTZ;

-- Phase 2: WhatsApp user preference + notification config keys
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS unsubscribed_whatsapp BOOLEAN DEFAULT false;

INSERT INTO config (key, value) VALUES
  ('whatsapp_verification_enabled',           'false'),
  ('whatsapp_matches_notification_enabled',   'false'),
  ('whatsapp_interest_reminder_enabled',      'false'),
  ('whatsapp_fallback_to_email',              'true'),
  ('whatsapp_provider',                       'meta')
ON CONFLICT (key) DO NOTHING;
