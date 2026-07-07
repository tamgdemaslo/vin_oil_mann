ALTER TABLE "crm_deals"
  ADD COLUMN IF NOT EXISTS "organization_id" TEXT,
  ADD COLUMN IF NOT EXISTS "conversation_id" TEXT,
  ADD COLUMN IF NOT EXISTS "appointment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "shipment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "precheck_id" TEXT,
  ADD COLUMN IF NOT EXISTS "diagnostic_id" TEXT,
  ADD COLUMN IF NOT EXISTS "procurement_id" TEXT,
  ADD COLUMN IF NOT EXISTS "case_status" TEXT NOT NULL DEFAULT 'calculation_needed',
  ADD COLUMN IF NOT EXISTS "case_type" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "case_key" TEXT,
  ADD COLUMN IF NOT EXISTS "next_action_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_client_message_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_outbound_message_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);

UPDATE "crm_deals" d
SET
  "next_action_at" = COALESCE(d."next_action_at", d."next_contact_at"),
  "case_status" = CASE
    WHEN d."status" <> 'open' THEN 'closed'
    WHEN lower(s."name") LIKE '%расч%отправ%' THEN 'calculation_sent'
    WHEN lower(s."name") LIKE '%проверить%ответ%' THEN 'check_response'
    WHEN lower(s."name") LIKE '%ответил%' THEN 'client_replied'
    WHEN lower(s."name") LIKE '%запчаст%' OR lower(s."name") LIKE '%расходник%' THEN 'waiting_parts'
    WHEN lower(s."name") LIKE '%закры%' THEN 'closed'
    ELSE 'calculation_needed'
  END,
  "case_type" = CASE
    WHEN COALESCE(d."source", '') ILIKE '%messenger%' THEN 'message'
    WHEN d."moysklad_demand_id" IS NOT NULL THEN 'shipment'
    WHEN COALESCE(d."notes", '') ILIKE '%diagnostic%' OR COALESCE(d."notes", '') ILIKE '%диагност%' THEN 'diagnostic'
    ELSE COALESCE(NULLIF(d."case_type", ''), 'manual')
  END,
  "last_outbound_message_at" = CASE
    WHEN d."last_outbound_message_at" IS NULL AND lower(s."name") LIKE '%расч%отправ%' THEN COALESCE(d."next_contact_at" - INTERVAL '24 hours', d."updated_at")
    ELSE d."last_outbound_message_at"
  END,
  "closed_at" = CASE
    WHEN d."closed_at" IS NULL AND d."status" <> 'open' THEN d."updated_at"
    ELSE d."closed_at"
  END
FROM "crm_stages" s
WHERE s."id" = d."stage_id";

CREATE UNIQUE INDEX IF NOT EXISTS "crm_deals_case_key_key" ON "crm_deals"("case_key");
CREATE INDEX IF NOT EXISTS "crm_deals_conversation_id_idx" ON "crm_deals"("conversation_id");
CREATE INDEX IF NOT EXISTS "crm_deals_appointment_id_idx" ON "crm_deals"("appointment_id");
CREATE INDEX IF NOT EXISTS "crm_deals_shipment_id_idx" ON "crm_deals"("shipment_id");
CREATE INDEX IF NOT EXISTS "crm_deals_precheck_id_idx" ON "crm_deals"("precheck_id");
CREATE INDEX IF NOT EXISTS "crm_deals_diagnostic_id_idx" ON "crm_deals"("diagnostic_id");
CREATE INDEX IF NOT EXISTS "crm_deals_procurement_id_idx" ON "crm_deals"("procurement_id");
CREATE INDEX IF NOT EXISTS "crm_deals_case_status_idx" ON "crm_deals"("case_status");
CREATE INDEX IF NOT EXISTS "crm_deals_case_type_idx" ON "crm_deals"("case_type");
CREATE INDEX IF NOT EXISTS "crm_deals_priority_idx" ON "crm_deals"("priority");
CREATE INDEX IF NOT EXISTS "crm_deals_next_action_at_idx" ON "crm_deals"("next_action_at");

CREATE TABLE IF NOT EXISTS "client_case_events" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "actor_login" TEXT,
  "event_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_case_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_case_events_case_time_idx" ON "client_case_events"("case_id", "created_at");
CREATE INDEX IF NOT EXISTS "client_case_events_type_idx" ON "client_case_events"("event_type");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_case_events_case_id_fkey'
  ) THEN
    ALTER TABLE "client_case_events"
      ADD CONSTRAINT "client_case_events_case_id_fkey"
      FOREIGN KEY ("case_id") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
