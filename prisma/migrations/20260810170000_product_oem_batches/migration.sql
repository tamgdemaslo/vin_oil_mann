CREATE TABLE "product_oem_batches" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL DEFAULT 'branch-main',
    "created_by_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CATALOG',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "processed_items" INTEGER NOT NULL DEFAULT 0,
    "completed_items" INTEGER NOT NULL DEFAULT 0,
    "no_results_items" INTEGER NOT NULL DEFAULT 0,
    "error_items" INTEGER NOT NULL DEFAULT 0,
    "skipped_items" INTEGER NOT NULL DEFAULT 0,
    "current_product_id" TEXT,
    "current_product_name" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_oem_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_oem_batch_items" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL DEFAULT 'branch-main',
    "batch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "found_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_oem_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_oem_batches_branch_id_id_key" ON "product_oem_batches"("branch_id", "id");
CREATE INDEX "product_oem_batches_branch_id_status_created_at_idx" ON "product_oem_batches"("branch_id", "status", "created_at");
CREATE INDEX "product_oem_batches_branch_id_created_at_idx" ON "product_oem_batches"("branch_id", "created_at");
CREATE UNIQUE INDEX "product_oem_batch_items_branch_id_id_key" ON "product_oem_batch_items"("branch_id", "id");
CREATE UNIQUE INDEX "product_oem_batch_items_batch_id_product_id_key" ON "product_oem_batch_items"("batch_id", "product_id");
CREATE INDEX "product_oem_batch_items_branch_id_status_created_at_idx" ON "product_oem_batch_items"("branch_id", "status", "created_at");
CREATE INDEX "product_oem_batch_items_batch_id_status_idx" ON "product_oem_batch_items"("batch_id", "status");
CREATE INDEX "product_oem_batch_items_branch_id_product_id_idx" ON "product_oem_batch_items"("branch_id", "product_id");

ALTER TABLE "product_oem_batch_items"
ADD CONSTRAINT "product_oem_batch_items_branch_id_batch_id_fkey"
FOREIGN KEY ("branch_id", "batch_id") REFERENCES "product_oem_batches"("branch_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_oem_batch_items"
ADD CONSTRAINT "product_oem_batch_items_branch_id_product_id_fkey"
FOREIGN KEY ("branch_id", "product_id") REFERENCES "local_products"("branch_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
