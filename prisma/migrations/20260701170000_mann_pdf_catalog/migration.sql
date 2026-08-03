CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "product_mann_links" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "product_id" TEXT NOT NULL,
  "mann_article" TEXT NOT NULL,
  "mann_article_normalized" TEXT NOT NULL,
  "link_type" TEXT NOT NULL DEFAULT 'manual',
  "confidence" INTEGER NOT NULL DEFAULT 100,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_mann_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mann_pdf_import_batches" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'imported',
  "source_file" TEXT,
  "applications_source_file" TEXT,
  "filters_source_file" TEXT,
  "applications_source_hash" TEXT,
  "filters_source_hash" TEXT,
  "summary_json" JSONB,
  "stats_json" JSONB NOT NULL DEFAULT '{}',
  "errors_json" JSONB NOT NULL DEFAULT '[]',
  "imported_by_id" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mann_pdf_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mann_pdf_application_raw" (
  "id" TEXT NOT NULL,
  "import_batch_id" TEXT,
  "source_pdf" TEXT,
  "source_file" TEXT,
  "source_hash" TEXT,
  "source_row_hash" TEXT NOT NULL,
  "row_type" TEXT,
  "make" TEXT,
  "model" TEXT,
  "model_years" TEXT,
  "vehicle_text" TEXT,
  "effective_vehicle_text" TEXT,
  "detail" TEXT,
  "engine_code" TEXT,
  "kw" TEXT,
  "hp" TEXT,
  "vehicle_years" TEXT,
  "condition" TEXT,
  "air_filter" TEXT,
  "air_filter_note" TEXT,
  "oil_filter" TEXT,
  "oil_filter_note" TEXT,
  "fuel_filter" TEXT,
  "fuel_filter_note" TEXT,
  "cabin_or_other_filter" TEXT,
  "cabin_or_other_type" TEXT,
  "cabin_filter" TEXT,
  "other_filter" TEXT,
  "other_filter_type" TEXT,
  "pdf_page" INTEGER,
  "catalog_page" INTEGER,
  "raw_cells_json" JSONB,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mann_pdf_application_raw_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mann_filter_applications" (
  "id" TEXT NOT NULL,
  "import_batch_id" TEXT,
  "make" TEXT NOT NULL,
  "make_normalized" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "model_normalized" TEXT NOT NULL,
  "model_years" TEXT,
  "vehicle_text" TEXT,
  "effective_vehicle_text" TEXT,
  "vehicle_variant_key" TEXT NOT NULL,
  "detail" TEXT,
  "engine_code" TEXT,
  "engine_code_normalized" TEXT,
  "kw" TEXT,
  "hp" TEXT,
  "vehicle_years" TEXT,
  "vehicle_year_from" INTEGER,
  "vehicle_year_to" INTEGER,
  "condition" TEXT,
  "filter_type" TEXT NOT NULL,
  "filter_subtype" TEXT,
  "mann_article" TEXT NOT NULL,
  "mann_article_normalized" TEXT NOT NULL,
  "filter_note" TEXT,
  "pdf_page" INTEGER,
  "catalog_page" INTEGER,
  "source_file" TEXT,
  "source_hash" TEXT,
  "source_row_hash" TEXT NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mann_filter_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_mann_links_organization_id_product_id_mann_article_n_key" ON "product_mann_links"("organization_id", "product_id", "mann_article_normalized");
CREATE INDEX "product_mann_links_organization_id_mann_article_normalized_idx" ON "product_mann_links"("organization_id", "mann_article_normalized");
CREATE INDEX "product_mann_links_product_id_idx" ON "product_mann_links"("product_id");
CREATE INDEX "product_mann_links_link_type_idx" ON "product_mann_links"("link_type");

CREATE INDEX "mann_pdf_import_batches_status_idx" ON "mann_pdf_import_batches"("status");
CREATE INDEX "mann_pdf_import_batches_imported_at_idx" ON "mann_pdf_import_batches"("imported_at");

CREATE UNIQUE INDEX "mann_pdf_application_raw_source_row_hash_key" ON "mann_pdf_application_raw"("source_row_hash");
CREATE INDEX "mann_pdf_application_raw_make_idx" ON "mann_pdf_application_raw"("make");
CREATE INDEX "mann_pdf_application_raw_model_idx" ON "mann_pdf_application_raw"("model");
CREATE INDEX "mann_pdf_application_raw_source_hash_idx" ON "mann_pdf_application_raw"("source_hash");
CREATE INDEX "mann_pdf_application_raw_import_batch_id_idx" ON "mann_pdf_application_raw"("import_batch_id");

CREATE UNIQUE INDEX "mann_filter_applications_source_row_hash_key" ON "mann_filter_applications"("source_row_hash");
CREATE INDEX "mann_filter_applications_make_normalized_idx" ON "mann_filter_applications"("make_normalized");
CREATE INDEX "mann_filter_applications_model_normalized_idx" ON "mann_filter_applications"("model_normalized");
CREATE INDEX "mann_filter_applications_make_normalized_model_normalized_idx" ON "mann_filter_applications"("make_normalized", "model_normalized");
CREATE INDEX "mann_filter_applications_vehicle_variant_key_idx" ON "mann_filter_applications"("vehicle_variant_key");
CREATE INDEX "mann_filter_applications_mann_article_normalized_idx" ON "mann_filter_applications"("mann_article_normalized");
CREATE INDEX "mann_filter_applications_filter_type_idx" ON "mann_filter_applications"("filter_type");
CREATE INDEX "mann_filter_applications_engine_code_normalized_idx" ON "mann_filter_applications"("engine_code_normalized");
CREATE INDEX "mann_filter_applications_vehicle_year_from_vehicle_year_to_idx" ON "mann_filter_applications"("vehicle_year_from", "vehicle_year_to");
CREATE INDEX "mann_filter_applications_import_batch_id_idx" ON "mann_filter_applications"("import_batch_id");
CREATE INDEX "mann_filter_applications_vehicle_text_trgm_idx" ON "mann_filter_applications" USING GIN ("vehicle_text" gin_trgm_ops);
CREATE INDEX "mann_filter_applications_effective_vehicle_text_trgm_idx" ON "mann_filter_applications" USING GIN ("effective_vehicle_text" gin_trgm_ops);

ALTER TABLE "product_mann_links" ADD CONSTRAINT "product_mann_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mann_pdf_application_raw" ADD CONSTRAINT "mann_pdf_application_raw_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "mann_pdf_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mann_filter_applications" ADD CONSTRAINT "mann_filter_applications_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "mann_pdf_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
