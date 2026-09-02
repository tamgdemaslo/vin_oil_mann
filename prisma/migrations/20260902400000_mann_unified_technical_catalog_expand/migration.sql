-- Expand-only foundation for the unified MANN technical catalog.
-- This migration creates empty canonical/audit tables. It intentionally does
-- not backfill data, change runtime reads, or activate any technical revision.

BEGIN;

CREATE TABLE "mann_vehicle_variants" (
  "variant_key" TEXT NOT NULL,
  "make" TEXT NOT NULL,
  "make_normalized" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "model_normalized" TEXT NOT NULL,
  "generation" TEXT,
  "body_codes_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "model_years" TEXT,
  "year_from" INTEGER,
  "year_to" INTEGER,
  "vehicle_text" TEXT,
  "engine_code" TEXT,
  "engine_code_normalized" TEXT,
  "engine_codes_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "engine_volume_cc" INTEGER,
  "power_kw" INTEGER,
  "power_hp" INTEGER,
  "fuel_type" TEXT,
  "drive_type" TEXT,
  "transmission_type" TEXT,
  "condition_text" TEXT,
  "canonical_payload_hash" TEXT NOT NULL,
  "source_hashes_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mann_vehicle_variants_pkey" PRIMARY KEY ("variant_key"),
  CONSTRAINT "mann_vehicle_variants_variant_key_check"
    CHECK ("variant_key" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mann_vehicle_variants_payload_hash_check"
    CHECK ("canonical_payload_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mann_vehicle_variants_year_range_check"
    CHECK ("year_from" IS NULL OR "year_to" IS NULL OR "year_from" <= "year_to"),
  CONSTRAINT "mann_vehicle_variants_engine_volume_check"
    CHECK ("engine_volume_cc" IS NULL OR "engine_volume_cc" > 0),
  CONSTRAINT "mann_vehicle_variants_power_kw_check"
    CHECK ("power_kw" IS NULL OR "power_kw" > 0),
  CONSTRAINT "mann_vehicle_variants_power_hp_check"
    CHECK ("power_hp" IS NULL OR "power_hp" > 0),
  CONSTRAINT "mann_vehicle_variants_seen_range_check"
    CHECK ("first_seen_at" <= "last_seen_at")
);

CREATE INDEX "mann_vehicle_variants_make_model_idx"
  ON "mann_vehicle_variants" ("make_normalized", "model_normalized");
CREATE INDEX "mann_vehicle_variants_engine_code_idx"
  ON "mann_vehicle_variants" ("engine_code_normalized");
CREATE INDEX "mann_vehicle_variants_year_range_idx"
  ON "mann_vehicle_variants" ("year_from", "year_to");

CREATE TABLE "mann_technical_materialization_runs" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "mode" TEXT NOT NULL DEFAULT 'DRY_RUN',
  "matcher_version" TEXT NOT NULL,
  "capacity_parser_version" TEXT NOT NULL,
  "git_commit" TEXT NOT NULL,
  "verification_set_version" TEXT,
  "source_snapshot_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source_counts_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "gates_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "approval_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "independent_human_signoff" BOOLEAN NOT NULL DEFAULT FALSE,
  "production_apply_authorized" BOOLEAN NOT NULL DEFAULT FALSE,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mann_technical_materialization_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mann_tech_runs_status_check"
    CHECK ("status" IN ('PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'SUPERSEDED')),
  CONSTRAINT "mann_tech_runs_mode_check"
    CHECK ("mode" IN ('DRY_RUN', 'STAGING', 'MATERIALIZED')),
  CONSTRAINT "mann_tech_runs_git_commit_check"
    CHECK ("git_commit" ~ '^[a-f0-9]{40}$'),
  CONSTRAINT "mann_tech_runs_approval_consistency_check"
    CHECK (NOT "production_apply_authorized" OR "independent_human_signoff"),
  CONSTRAINT "mann_tech_runs_materialized_approval_check"
    CHECK ("mode" <> 'MATERIALIZED' OR ("production_apply_authorized" AND "independent_human_signoff")),
  CONSTRAINT "mann_tech_runs_time_range_check"
    CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "started_at" <= "completed_at")
);

CREATE INDEX "mann_tech_runs_status_created_idx"
  ON "mann_technical_materialization_runs" ("status", "created_at");
CREATE INDEX "mann_tech_runs_mode_created_idx"
  ON "mann_technical_materialization_runs" ("mode", "created_at");

CREATE TABLE "mann_technical_association_revisions" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "vehicle_variant_key" TEXT NOT NULL,
  "source_requirement_id" TEXT NOT NULL,
  "system_code" TEXT NOT NULL,
  "component_model" TEXT,
  "applicability_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "verified_fields_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "technical_data_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "field_confidence_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "evidence_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "provenance_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "match_class" TEXT NOT NULL,
  "match_score" INTEGER NOT NULL,
  "semantic_fingerprint" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'STAGED',
  "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "apply_eligible" BOOLEAN NOT NULL DEFAULT FALSE,
  "supersedes_revision_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mann_technical_association_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mann_tech_revision_run_fingerprint_key" UNIQUE ("run_id", "semantic_fingerprint"),
  CONSTRAINT "mann_tech_revision_supersedes_key" UNIQUE ("supersedes_revision_id"),
  CONSTRAINT "mann_tech_revision_fingerprint_check"
    CHECK ("semantic_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mann_tech_revision_state_check"
    CHECK ("state" IN ('STAGED', 'ACTIVE', 'REVIEW', 'REJECTED', 'SUPERSEDED')),
  CONSTRAINT "mann_tech_revision_verification_check"
    CHECK ("verification_status" IN ('UNVERIFIED', 'PRIMARY_SOURCE_VERIFIED_FIELDS', 'HUMAN_CONFIRMED')),
  CONSTRAINT "mann_tech_revision_score_check"
    CHECK ("match_score" BETWEEN 0 AND 100),
  CONSTRAINT "mann_tech_revision_active_eligibility_check"
    CHECK (
      "state" <> 'ACTIVE'
      OR (
        "apply_eligible"
        AND "verification_status" IN ('PRIMARY_SOURCE_VERIFIED_FIELDS', 'HUMAN_CONFIRMED')
      )
    ),
  CONSTRAINT "mann_tech_revision_no_self_supersession_check"
    CHECK ("supersedes_revision_id" IS NULL OR "supersedes_revision_id" <> "id"),
  CONSTRAINT "mann_tech_revision_run_fkey"
    FOREIGN KEY ("run_id") REFERENCES "mann_technical_materialization_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mann_tech_revision_vehicle_fkey"
    FOREIGN KEY ("vehicle_variant_key") REFERENCES "mann_vehicle_variants"("variant_key")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mann_tech_revision_supersedes_fkey"
    FOREIGN KEY ("supersedes_revision_id") REFERENCES "mann_technical_association_revisions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "mann_tech_revision_vehicle_state_system_idx"
  ON "mann_technical_association_revisions" ("vehicle_variant_key", "state", "system_code");
CREATE INDEX "mann_tech_revision_requirement_created_idx"
  ON "mann_technical_association_revisions" ("source_requirement_id", "created_at");
CREATE INDEX "mann_tech_revision_fingerprint_created_idx"
  ON "mann_technical_association_revisions" ("semantic_fingerprint", "created_at");

CREATE TABLE "mann_technical_review_decisions" (
  "id" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "actor_type" TEXT NOT NULL,
  "actor_id" TEXT,
  "reason" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "correction_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mann_technical_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mann_tech_review_decision_check"
    CHECK ("decision" IN ('CONFIRM', 'REJECT', 'SPLIT_CONDITION', 'CATALOG_GAP', 'SOURCE_GAP')),
  CONSTRAINT "mann_tech_review_actor_type_check"
    CHECK ("actor_type" IN ('HUMAN', 'SYSTEM_IMPORT')),
  CONSTRAINT "mann_tech_review_revision_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "mann_technical_association_revisions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "mann_tech_review_revision_created_idx"
  ON "mann_technical_review_decisions" ("revision_id", "created_at");
CREATE INDEX "mann_tech_review_decision_created_idx"
  ON "mann_technical_review_decisions" ("decision", "created_at");

COMMIT;
