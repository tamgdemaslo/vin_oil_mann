-- Diagnostic module (отгрузки — диагностический лист)

CREATE TYPE "DiagnosticStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED');

CREATE TYPE "DiagnosticBlock" AS ENUM ('AGGREGATE_FLUID', 'SERVICE_FLUID', 'VISUAL', 'SURVEY');

CREATE TYPE "DiagnosticPositionStatus" AS ENUM ('NOT_CHECKED', 'GREEN', 'YELLOW', 'RED', 'SKIPPED');

CREATE TABLE "diagnostics" (
    "id" TEXT NOT NULL,
    "shipment_moysklad_id" TEXT,
    "shipment_draft_id" TEXT,
    "agent_moysklad_id" TEXT,
    "vin" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "license_plate" TEXT,
    "mileage" INTEGER,
    "mechanic_login" TEXT,
    "status" "DiagnosticStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "client_report_sent_at" TIMESTAMP(3),
    "client_report_token" TEXT NOT NULL,
    "client_wants_reminder" BOOLEAN NOT NULL DEFAULT true,
    "summary_green" INTEGER NOT NULL DEFAULT 0,
    "summary_yellow" INTEGER NOT NULL DEFAULT 0,
    "summary_red" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnostics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diagnostics_client_report_token_key" ON "diagnostics"("client_report_token");

CREATE INDEX "diagnostics_vin_idx" ON "diagnostics"("vin");

CREATE INDEX "diagnostics_agent_moysklad_id_idx" ON "diagnostics"("agent_moysklad_id");

CREATE INDEX "diagnostics_shipment_moysklad_id_idx" ON "diagnostics"("shipment_moysklad_id");

CREATE TABLE "diagnostic_positions" (
    "id" TEXT NOT NULL,
    "diagnostic_id" TEXT NOT NULL,
    "block" "DiagnosticBlock" NOT NULL,
    "node" TEXT NOT NULL,
    "status" "DiagnosticPositionStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "tags" TEXT[],
    "measurement_value" DECIMAL(10,2),
    "measurement_unit" TEXT,
    "recommendation" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnostic_positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diagnostic_positions_diagnostic_id_node_key" ON "diagnostic_positions"("diagnostic_id", "node");

CREATE INDEX "diagnostic_positions_diagnostic_id_idx" ON "diagnostic_positions"("diagnostic_id");

CREATE TABLE "diagnostic_photos" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnostic_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "diagnostic_photos_position_id_idx" ON "diagnostic_photos"("position_id");

CREATE TABLE "diagnostic_offers" (
    "id" TEXT NOT NULL,
    "diagnostic_id" TEXT NOT NULL,
    "related_position_id" TEXT,
    "offer_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variants" JSONB NOT NULL,
    "selected_variant_index" INTEGER,
    "added_to_shipment" BOOLEAN NOT NULL DEFAULT false,
    "next_visit_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnostic_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "diagnostic_offers_diagnostic_id_idx" ON "diagnostic_offers"("diagnostic_id");

ALTER TABLE "diagnostic_positions" ADD CONSTRAINT "diagnostic_positions_diagnostic_id_fkey" FOREIGN KEY ("diagnostic_id") REFERENCES "diagnostics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diagnostic_photos" ADD CONSTRAINT "diagnostic_photos_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "diagnostic_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diagnostic_offers" ADD CONSTRAINT "diagnostic_offers_diagnostic_id_fkey" FOREIGN KEY ("diagnostic_id") REFERENCES "diagnostics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
