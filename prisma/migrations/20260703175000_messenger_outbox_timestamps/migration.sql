ALTER TABLE IF EXISTS messenger_outbox
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE messenger_outbox
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;
