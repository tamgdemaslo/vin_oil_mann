-- Catalog-card copy between branches. This migration intentionally does not
-- touch stock balances, stores, cells, documents, or inventory movements.
ALTER TABLE "local_products"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "source_product_id" TEXT,
  ADD COLUMN "source_branch_id" TEXT,
  ADD COLUMN "copy_batch_id" TEXT,
  ADD COLUMN "copied_at" TIMESTAMP(3),
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "price_needs_setup" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "local_products_branch_id_origin_idx" ON "local_products"("branch_id", "origin");
CREATE INDEX "local_products_branch_id_source_product_id_idx" ON "local_products"("branch_id", "source_product_id");
CREATE INDEX "local_products_branch_id_copy_batch_id_idx" ON "local_products"("branch_id", "copy_batch_id");
CREATE INDEX "local_products_branch_id_price_needs_setup_idx" ON "local_products"("branch_id", "price_needs_setup");

CREATE TABLE "branch_product_copy_batches" (
  "id" TEXT NOT NULL,
  "business_group_id" TEXT NOT NULL,
  "source_branch_id" TEXT NOT NULL,
  "target_branch_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "options_json" JSONB NOT NULL DEFAULT '{}',
  "total_selected" INTEGER NOT NULL DEFAULT 0,
  "total_created" INTEGER NOT NULL DEFAULT 0,
  "total_updated" INTEGER NOT NULL DEFAULT 0,
  "total_skipped" INTEGER NOT NULL DEFAULT 0,
  "total_failed" INTEGER NOT NULL DEFAULT 0,
  "total_price_needs_setup" INTEGER NOT NULL DEFAULT 0,
  "total_suppliers_unmapped" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "branch_product_copy_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_product_copy_batches_idempotency_key_key"
  ON "branch_product_copy_batches"("idempotency_key");
CREATE INDEX "branch_product_copy_batches_business_group_id_created_at_idx"
  ON "branch_product_copy_batches"("business_group_id", "created_at");
CREATE INDEX "branch_product_copy_batches_source_branch_id_created_at_idx"
  ON "branch_product_copy_batches"("source_branch_id", "created_at");
CREATE INDEX "branch_product_copy_batches_target_branch_id_created_at_idx"
  ON "branch_product_copy_batches"("target_branch_id", "created_at");
CREATE INDEX "branch_product_copy_batches_status_idx"
  ON "branch_product_copy_batches"("status");

CREATE TABLE "branch_product_copy_items" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "source_product_id" TEXT NOT NULL,
  "target_product_id" TEXT,
  "matching_method" TEXT,
  "action" TEXT NOT NULL DEFAULT 'PENDING',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "copied_fields_json" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "branch_product_copy_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_product_copy_items_batch_id_source_product_id_key"
  ON "branch_product_copy_items"("batch_id", "source_product_id");
CREATE INDEX "branch_product_copy_items_target_product_id_idx"
  ON "branch_product_copy_items"("target_product_id");
CREATE INDEX "branch_product_copy_items_status_idx"
  ON "branch_product_copy_items"("status");

ALTER TABLE "branch_product_copy_items"
  ADD CONSTRAINT "branch_product_copy_items_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "branch_product_copy_batches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
