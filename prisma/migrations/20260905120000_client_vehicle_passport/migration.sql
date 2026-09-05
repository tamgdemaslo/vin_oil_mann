-- Expand the persistent client vehicle into a source-aware vehicle passport.
-- Existing rows remain valid and are marked LEGACY until reviewed.

BEGIN;

ALTER TABLE "client_vehicles"
  ADD COLUMN "make_canonical" TEXT,
  ADD COLUMN "model_canonical" TEXT,
  ADD COLUMN "generation_canonical" TEXT,
  ADD COLUMN "model_year_from" INTEGER,
  ADD COLUMN "model_year_to" INTEGER,
  ADD COLUMN "frame_number" TEXT,
  ADD COLUMN "body_name" TEXT,
  ADD COLUMN "body_code" TEXT,
  ADD COLUMN "body_type" TEXT,
  ADD COLUMN "engine_name" TEXT,
  ADD COLUMN "engine_code" TEXT,
  ADD COLUMN "engine_series" TEXT,
  ADD COLUMN "engine_volume_cc" INTEGER,
  ADD COLUMN "power_hp" INTEGER,
  ADD COLUMN "power_kw" INTEGER,
  ADD COLUMN "fuel_type" TEXT,
  ADD COLUMN "transmission_type" TEXT,
  ADD COLUMN "transmission_name" TEXT,
  ADD COLUMN "drive_type" TEXT,
  ADD COLUMN "steering_position" TEXT,
  ADD COLUMN "market" TEXT,
  ADD COLUMN "country_of_origin" TEXT,
  ADD COLUMN "mileage" INTEGER,
  ADD COLUMN "mileage_recorded_at" TIMESTAMPTZ(6),
  ADD COLUMN "owners_count" INTEGER,
  ADD COLUMN "mann_variant_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "field_sources_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "source_snapshot_json" JSONB,
  ADD COLUMN "confidence" TEXT NOT NULL DEFAULT 'LOW',
  ADD COLUMN "verification_status" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "last_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_verified_by" TEXT;

ALTER TABLE "client_vehicles"
  ADD CONSTRAINT "client_vehicles_model_year_range_check"
    CHECK ("model_year_from" IS NULL OR "model_year_to" IS NULL OR "model_year_from" <= "model_year_to"),
  ADD CONSTRAINT "client_vehicles_year_check"
    CHECK ("year" IS NULL OR "year" BETWEEN 1886 AND 2200),
  ADD CONSTRAINT "client_vehicles_engine_volume_check"
    CHECK ("engine_volume_cc" IS NULL OR "engine_volume_cc" > 0),
  ADD CONSTRAINT "client_vehicles_power_hp_check"
    CHECK ("power_hp" IS NULL OR "power_hp" > 0),
  ADD CONSTRAINT "client_vehicles_power_kw_check"
    CHECK ("power_kw" IS NULL OR "power_kw" > 0),
  ADD CONSTRAINT "client_vehicles_mileage_check"
    CHECK ("mileage" IS NULL OR "mileage" >= 0),
  ADD CONSTRAINT "client_vehicles_owners_count_check"
    CHECK ("owners_count" IS NULL OR "owners_count" >= 0),
  ADD CONSTRAINT "client_vehicles_confidence_check"
    CHECK ("confidence" IN ('LOW', 'MEDIUM', 'HIGH')),
  ADD CONSTRAINT "client_vehicles_verification_status_check"
    CHECK ("verification_status" IN ('LEGACY', 'AUTO_FILLED', 'CONFIRMED', 'NEEDS_REVIEW'));

CREATE INDEX "client_vehicles_branch_id_frame_number_idx"
  ON "client_vehicles"("branch_id", "frame_number");
CREATE INDEX "client_vehicles_branch_id_make_canonical_model_canonical_idx"
  ON "client_vehicles"("branch_id", "make_canonical", "model_canonical");

CREATE TABLE "client_vehicle_revisions" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "vehicle_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "verification_status" TEXT NOT NULL,
  "changed_fields_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "snapshot_json" JSONB NOT NULL,
  "actor_login" TEXT,
  "actor_name" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "client_vehicle_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_vehicle_revisions_branch_id_id_key" UNIQUE ("branch_id", "id"),
  CONSTRAINT "client_vehicle_revisions_status_check"
    CHECK ("verification_status" IN ('LEGACY', 'AUTO_FILLED', 'CONFIRMED', 'NEEDS_REVIEW')),
  CONSTRAINT "client_vehicle_revisions_vehicle_fkey"
    FOREIGN KEY ("branch_id", "vehicle_id") REFERENCES "client_vehicles"("branch_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "client_vehicle_revisions_branch_id_vehicle_id_created_at_idx"
  ON "client_vehicle_revisions"("branch_id", "vehicle_id", "created_at");

COMMIT;
