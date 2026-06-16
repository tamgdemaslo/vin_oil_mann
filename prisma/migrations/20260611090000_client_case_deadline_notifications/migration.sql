ALTER TABLE "crm_deals"
  ADD COLUMN IF NOT EXISTS "snooze_until" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "client_case_notification_log" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledged_at" TIMESTAMPTZ(6),
  "snoozed_until" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'sent',
  "error_message" TEXT,

  CONSTRAINT "client_case_notification_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_deals_snooze_until_idx" ON "crm_deals"("snooze_until");
CREATE INDEX IF NOT EXISTS "client_case_notification_log_dedupe_idx"
  ON "client_case_notification_log"("case_id", "user_id", "type", "channel", "sent_at");
CREATE INDEX IF NOT EXISTS "client_case_notification_log_user_feed_idx"
  ON "client_case_notification_log"("user_id", "acknowledged_at", "sent_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_case_notification_log_case_id_fkey'
  ) THEN
    ALTER TABLE "client_case_notification_log"
      ADD CONSTRAINT "client_case_notification_log_case_id_fkey"
      FOREIGN KEY ("case_id") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
