CREATE TABLE "fluid_catalog_import_batches" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'imported',
  "source_name" TEXT NOT NULL,
  "source_url" TEXT,
  "source_file" TEXT,
  "source_hash" TEXT NOT NULL,
  "summary_json" JSONB,
  "stats_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "errors_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "imported_by_id" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fluid_catalog_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fluid_source_rows" (
  "id" TEXT NOT NULL,
  "import_batch_id" TEXT,
  "source_url" TEXT NOT NULL,
  "page_path" TEXT,
  "page_title" TEXT,
  "make_raw" TEXT,
  "make_normalized" TEXT,
  "model_raw" TEXT,
  "model_normalized" TEXT,
  "generation_raw" TEXT,
  "table_index" INTEGER NOT NULL,
  "row_index" INTEGER NOT NULL,
  "table_kind" TEXT,
  "application_raw" TEXT,
  "system_name_raw" TEXT,
  "raw_cells_json" JSONB NOT NULL,
  "parsed_row_json" JSONB NOT NULL,
  "source_fetched_at" TIMESTAMPTZ(6),
  "source_page_hash" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fluid_source_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_fluid_requirements" (
  "id" TEXT NOT NULL,
  "import_batch_id" TEXT,
  "source_row_id" TEXT NOT NULL,
  "source_table_key" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "make" TEXT NOT NULL,
  "make_normalized" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "model_normalized" TEXT NOT NULL,
  "generation" TEXT,
  "generation_number" INTEGER,
  "body_codes_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "year_from" INTEGER,
  "year_to" INTEGER,
  "engine_code_normalized" TEXT,
  "engine_codes_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "engine_volume_cc" INTEGER,
  "power_kw" INTEGER,
  "power_hp" INTEGER,
  "fuel_type" TEXT,
  "drive_type" TEXT,
  "transmission_type" TEXT,
  "component_model" TEXT,
  "system_code" TEXT NOT NULL,
  "system_name_raw" TEXT NOT NULL,
  "fill_volume_text" TEXT,
  "fill_volume_min_liters" DOUBLE PRECISION,
  "fill_volume_max_liters" DOUBLE PRECISION,
  "service_volume_liters" DOUBLE PRECISION,
  "total_volume_liters" DOUBLE PRECISION,
  "capacities_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "specification_text" TEXT,
  "specifications_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "viscosity_grades_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "recommendation_text" TEXT,
  "replacement_interval_text" TEXT,
  "replacement_km_min" INTEGER,
  "replacement_km_max" INTEGER,
  "replacement_months" INTEGER,
  "control_interval_text" TEXT,
  "analog_text" TEXT,
  "context_confidence" TEXT NOT NULL DEFAULT 'page',
  "raw_requirement_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_fluid_requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mann_fluid_requirement_links" (
  "id" TEXT NOT NULL,
  "requirement_id" TEXT NOT NULL,
  "mann_variant_key" TEXT NOT NULL,
  "mann_make" TEXT NOT NULL,
  "mann_model" TEXT NOT NULL,
  "mann_vehicle_text" TEXT,
  "mann_engine_code" TEXT,
  "match_score" INTEGER NOT NULL,
  "confidence" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'review_required',
  "match_method" TEXT NOT NULL,
  "evidence_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "confirmed_by_id" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mann_fluid_requirement_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fluid_catalog_import_batches_source_name_imported_at_idx"
  ON "fluid_catalog_import_batches"("source_name", "imported_at");
CREATE INDEX "fluid_catalog_import_batches_source_hash_idx"
  ON "fluid_catalog_import_batches"("source_hash");
CREATE INDEX "fluid_catalog_import_batches_status_idx"
  ON "fluid_catalog_import_batches"("status");

CREATE INDEX "fluid_source_rows_import_batch_id_idx"
  ON "fluid_source_rows"("import_batch_id");
CREATE INDEX "fluid_source_rows_make_normalized_model_normalized_idx"
  ON "fluid_source_rows"("make_normalized", "model_normalized");
CREATE INDEX "fluid_source_rows_source_page_hash_idx"
  ON "fluid_source_rows"("source_page_hash");

CREATE INDEX "vehicle_fluid_requirements_import_batch_id_idx"
  ON "vehicle_fluid_requirements"("import_batch_id");
CREATE INDEX "vehicle_fluid_requirements_source_row_id_idx"
  ON "vehicle_fluid_requirements"("source_row_id");
CREATE INDEX "vehicle_fluid_requirements_make_normalized_model_normalized_idx"
  ON "vehicle_fluid_requirements"("make_normalized", "model_normalized");
CREATE INDEX "vehicle_fluid_requirements_engine_code_normalized_idx"
  ON "vehicle_fluid_requirements"("engine_code_normalized");
CREATE INDEX "vehicle_fluid_requirements_system_code_idx"
  ON "vehicle_fluid_requirements"("system_code");
CREATE INDEX "vehicle_fluid_requirements_year_from_year_to_idx"
  ON "vehicle_fluid_requirements"("year_from", "year_to");

CREATE UNIQUE INDEX "mann_fluid_requirement_links_requirement_id_mann_variant_key_key"
  ON "mann_fluid_requirement_links"("requirement_id", "mann_variant_key");
CREATE INDEX "mann_fluid_requirement_links_mann_variant_key_status_idx"
  ON "mann_fluid_requirement_links"("mann_variant_key", "status");
CREATE INDEX "mann_fluid_requirement_links_status_confidence_idx"
  ON "mann_fluid_requirement_links"("status", "confidence");
CREATE INDEX "mann_fluid_requirement_links_requirement_id_idx"
  ON "mann_fluid_requirement_links"("requirement_id");

ALTER TABLE "fluid_source_rows"
  ADD CONSTRAINT "fluid_source_rows_import_batch_id_fkey"
  FOREIGN KEY ("import_batch_id") REFERENCES "fluid_catalog_import_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vehicle_fluid_requirements"
  ADD CONSTRAINT "vehicle_fluid_requirements_import_batch_id_fkey"
  FOREIGN KEY ("import_batch_id") REFERENCES "fluid_catalog_import_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vehicle_fluid_requirements"
  ADD CONSTRAINT "vehicle_fluid_requirements_source_row_id_fkey"
  FOREIGN KEY ("source_row_id") REFERENCES "fluid_source_rows"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mann_fluid_requirement_links"
  ADD CONSTRAINT "mann_fluid_requirement_links_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "vehicle_fluid_requirements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
