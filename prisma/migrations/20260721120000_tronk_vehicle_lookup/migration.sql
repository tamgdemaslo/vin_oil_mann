CREATE TABLE IF NOT EXISTS "vehicle_lookup_cache" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "input_type" TEXT NOT NULL,
  "normalized_input_hash" TEXT NOT NULL,
  "masked_input" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "raw_response_encrypted" TEXT,
  "normalized_vehicle_json" JSONB,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "cost_cents" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  "provider_request_id" TEXT,
  "source_version" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_lookup_cache_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vehicle_lookup_cache_lookup_idx"
  ON "vehicle_lookup_cache"("organization_id", "input_type", "normalized_input_hash", "method", "expires_at");
CREATE INDEX IF NOT EXISTS "vehicle_lookup_cache_expires_at_idx" ON "vehicle_lookup_cache"("expires_at");

CREATE TABLE IF NOT EXISTS "vehicle_mann_mappings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "normalized_make" TEXT NOT NULL,
  "normalized_model" TEXT NOT NULL,
  "year_from" INTEGER,
  "year_to" INTEGER,
  "engine_code" TEXT,
  "engine_volume_cc" INTEGER,
  "power_kw" INTEGER,
  "drive_type" TEXT,
  "transmission_type" TEXT,
  "mann_application_id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "confidence" TEXT NOT NULL DEFAULT 'high',
  "confirmed_by_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_mann_mappings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vehicle_mann_mappings_vehicle_idx"
  ON "vehicle_mann_mappings"("organization_id", "normalized_make", "normalized_model");
CREATE INDEX IF NOT EXISTS "vehicle_mann_mappings_application_idx" ON "vehicle_mann_mappings"("mann_application_id");
