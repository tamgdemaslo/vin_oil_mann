-- Quote snapshots are immutable enough for an employee to verify exactly what
-- the customer will receive. Existing quotations remain valid as drafts.
ALTER TABLE "ai_service_quotes"
  ADD COLUMN IF NOT EXISTS "local_products_snapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "rossko_offers_snapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "optional_items" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "requires_human_approval" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "draft_shipment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_text" TEXT,
  ADD COLUMN IF NOT EXISTS "internal_summary" TEXT,
  ADD COLUMN IF NOT EXISTS "human_review_reason" TEXT;

ALTER TABLE "ai_agent_settings"
  DROP CONSTRAINT IF EXISTS "ai_agent_settings_mode_check";
ALTER TABLE "ai_agent_settings"
  ADD CONSTRAINT "ai_agent_settings_mode_check"
  CHECK ("mode" IN ('off', 'suggestions', 'auto_quote_approval', 'auto_booking_approval', 'autonomous', 'observe', 'confirm'));
ALTER TABLE "ai_agent_settings"
  ADD COLUMN IF NOT EXISTS "rossko_markup_rules_json" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ai_agent_settings"
  ALTER COLUMN "agent_name" SET DEFAULT 'Там где масло';
UPDATE "ai_agent_settings"
SET "agent_name" = 'Там где масло'
WHERE "agent_name" = 'Помощник Там где масло';

CREATE TABLE IF NOT EXISTS "ai_agent_technical_evidence" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "vehicle_key" TEXT NOT NULL,
  "vehicle_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "aggregate" TEXT NOT NULL,
  "fact_type" TEXT NOT NULL,
  "facts" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source_name" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_excerpt" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'verified',
  "catalog_version" TEXT,
  "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until" TIMESTAMPTZ(6),
  "invalidated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_technical_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_agent_technical_evidence_lookup_idx"
  ON "ai_agent_technical_evidence" ("organization_id", "vehicle_key", "aggregate", "fact_type", "verified_at");
CREATE INDEX IF NOT EXISTS "ai_agent_technical_evidence_freshness_idx"
  ON "ai_agent_technical_evidence" ("organization_id", "status", "valid_until");

CREATE TABLE IF NOT EXISTS "ai_agent_quality_feedback" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "quote_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "note" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_quality_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_agent_quality_feedback_quote_idx"
  ON "ai_agent_quality_feedback" ("organization_id", "quote_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_agent_quality_feedback_code_idx"
  ON "ai_agent_quality_feedback" ("organization_id", "code", "created_at");
