-- New diagnostic map module. Legacy diagnostics tables remain untouched.

CREATE TYPE "DiagnosticMapSessionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED');

CREATE TYPE "DiagnosticMapItemStatus" AS ENUM (
  'UNCHECKED',
  'NORMAL',
  'ATTENTION',
  'REPLACE',
  'NO_ACCESS',
  'BY_MILEAGE',
  'BY_CLIENT',
  'SKIPPED',
  'NOT_APPLICABLE'
);

CREATE TYPE "DiagnosticMapCheckMethod" AS ENUM (
  'INSPECTION',
  'CLIENT_WORDS',
  'MILEAGE',
  'NO_ACCESS',
  'SKIPPED'
);

CREATE TYPE "DiagnosticMapApplicability" AS ENUM ('APPLICABLE', 'NOT_APPLICABLE', 'HIDDEN');

CREATE TYPE "DiagnosticMapActionKind" AS ENUM (
  'ADD_TO_SHIPMENT',
  'CREATE_CRM_TASK',
  'NEXT_VISIT',
  'SHOW_IN_REPORT'
);

CREATE TABLE "diagnostic_map_sessions" (
  "id" TEXT NOT NULL,
  "demand_id" TEXT,
  "client_id" TEXT,
  "client_name" TEXT,
  "client_phone" TEXT,
  "vin" TEXT,
  "brand" TEXT,
  "model" TEXT,
  "year" INTEGER,
  "license_plate" TEXT,
  "mileage" INTEGER,
  "vehicle_hints" JSONB,
  "master_login" TEXT,
  "master_name" TEXT,
  "status" "DiagnosticMapSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "public_token" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "report_sent_at" TIMESTAMP(3),
  "client_wants_reminder" BOOLEAN NOT NULL DEFAULT true,
  "total_count" INTEGER NOT NULL DEFAULT 0,
  "normal_count" INTEGER NOT NULL DEFAULT 0,
  "attention_count" INTEGER NOT NULL DEFAULT 0,
  "replace_count" INTEGER NOT NULL DEFAULT 0,
  "indirect_count" INTEGER NOT NULL DEFAULT 0,
  "no_access_count" INTEGER NOT NULL DEFAULT 0,
  "by_mileage_count" INTEGER NOT NULL DEFAULT 0,
  "by_client_count" INTEGER NOT NULL DEFAULT 0,
  "with_photo_count" INTEGER NOT NULL DEFAULT 0,
  "without_photo_count" INTEGER NOT NULL DEFAULT 0,
  "now_recommendation_count" INTEGER NOT NULL DEFAULT 0,
  "next_visit_recommendation_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "diagnostic_map_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "diagnostic_map_items" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "block_code" TEXT NOT NULL,
  "block_title" TEXT NOT NULL,
  "block_order" INTEGER NOT NULL,
  "item_code" TEXT NOT NULL,
  "item_title" TEXT NOT NULL,
  "item_order" INTEGER NOT NULL,
  "catalog_snapshot" JSONB NOT NULL,
  "applicability" "DiagnosticMapApplicability" NOT NULL DEFAULT 'APPLICABLE',
  "status" "DiagnosticMapItemStatus" NOT NULL DEFAULT 'UNCHECKED',
  "check_method" "DiagnosticMapCheckMethod" NOT NULL DEFAULT 'INSPECTION',
  "value" TEXT,
  "comment" TEXT,
  "recommendation" TEXT,
  "next_visit" BOOLEAN NOT NULL DEFAULT false,
  "show_in_report" BOOLEAN NOT NULL DEFAULT true,
  "selected_notes" TEXT[],
  "selected_recommendations" TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "diagnostic_map_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "diagnostic_map_photos" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "caption" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "diagnostic_map_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "diagnostic_map_recommendation_actions" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "kind" "DiagnosticMapActionKind" NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "local_demand_position_id" TEXT,
  "crm_deal_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "diagnostic_map_recommendation_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diagnostic_map_sessions_public_token_key" ON "diagnostic_map_sessions"("public_token");
CREATE INDEX "diagnostic_map_sessions_demand_id_idx" ON "diagnostic_map_sessions"("demand_id");
CREATE INDEX "diagnostic_map_sessions_client_id_idx" ON "diagnostic_map_sessions"("client_id");
CREATE INDEX "diagnostic_map_sessions_vin_idx" ON "diagnostic_map_sessions"("vin");
CREATE INDEX "diagnostic_map_sessions_status_idx" ON "diagnostic_map_sessions"("status");

CREATE UNIQUE INDEX "diagnostic_map_items_session_id_item_code_key" ON "diagnostic_map_items"("session_id", "item_code");
CREATE INDEX "diagnostic_map_items_session_id_idx" ON "diagnostic_map_items"("session_id");
CREATE INDEX "diagnostic_map_items_status_idx" ON "diagnostic_map_items"("status");

CREATE INDEX "diagnostic_map_photos_item_id_idx" ON "diagnostic_map_photos"("item_id");
CREATE INDEX "diagnostic_map_recommendation_actions_item_id_idx" ON "diagnostic_map_recommendation_actions"("item_id");
CREATE INDEX "diagnostic_map_recommendation_actions_kind_idx" ON "diagnostic_map_recommendation_actions"("kind");

ALTER TABLE "diagnostic_map_sessions"
  ADD CONSTRAINT "diagnostic_map_sessions_demand_id_fkey"
  FOREIGN KEY ("demand_id") REFERENCES "local_demands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "diagnostic_map_items"
  ADD CONSTRAINT "diagnostic_map_items_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "diagnostic_map_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diagnostic_map_photos"
  ADD CONSTRAINT "diagnostic_map_photos_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "diagnostic_map_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diagnostic_map_recommendation_actions"
  ADD CONSTRAINT "diagnostic_map_recommendation_actions_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "diagnostic_map_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
