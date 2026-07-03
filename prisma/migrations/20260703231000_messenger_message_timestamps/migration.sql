ALTER TABLE IF EXISTS messenger_messages
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE messenger_messages
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE created_at IS NULL
   OR updated_at IS NULL;

ALTER TABLE IF EXISTS messenger_messages
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;
