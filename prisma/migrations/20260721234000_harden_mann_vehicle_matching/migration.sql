ALTER TABLE "vehicle_mann_mappings"
  ADD COLUMN IF NOT EXISTS "normalized_generation" TEXT,
  ADD COLUMN IF NOT EXISTS "body_codes_json" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "engine_family" TEXT,
  ADD COLUMN IF NOT EXISTS "power_hp" INTEGER,
  ADD COLUMN IF NOT EXISTS "fuel_type" TEXT;

CREATE TABLE IF NOT EXISTS "vehicle_model_aliases" (
  "id" TEXT NOT NULL,
  "normalized_make" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "canonical_base_model" TEXT NOT NULL,
  "canonical_generation" TEXT,
  "body_codes_json" JSONB NOT NULL DEFAULT '[]',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "confirmed_by_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_model_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_model_aliases_make_source_key"
  ON "vehicle_model_aliases"("normalized_make", "source_name");
CREATE INDEX IF NOT EXISTS "vehicle_model_aliases_make_base_idx"
  ON "vehicle_model_aliases"("normalized_make", "canonical_base_model");
