-- Preserve the checksum of the already-applied
-- 20260703120000_client_auto_notifications migration. These statements were
-- historically appended to that file after deployment; they now live in an
-- idempotent forward migration.
ALTER TABLE IF EXISTS messenger_messages
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE messenger_messages
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;
