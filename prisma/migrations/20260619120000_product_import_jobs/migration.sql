CREATE TABLE "product_import_jobs" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "conflict_rows" INTEGER NOT NULL DEFAULT 0,
    "options_json" JSONB,
    "created_by_login" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "rollback_at" TIMESTAMP(3),

    CONSTRAINT "product_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_import_rows" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "matched_product_id" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source_json" JSONB,
    "before_json" JSONB,
    "after_json" JSONB,
    "changed_fields_json" JSONB,
    "error_message" TEXT,

    CONSTRAINT "product_import_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_import_jobs_created_at_idx" ON "product_import_jobs"("created_at");
CREATE INDEX "product_import_jobs_status_idx" ON "product_import_jobs"("status");
CREATE INDEX "product_import_rows_job_id_idx" ON "product_import_rows"("job_id");
CREATE INDEX "product_import_rows_matched_product_id_idx" ON "product_import_rows"("matched_product_id");
CREATE INDEX "product_import_rows_status_idx" ON "product_import_rows"("status");

ALTER TABLE "product_import_rows"
ADD CONSTRAINT "product_import_rows_job_id_fkey"
FOREIGN KEY ("job_id") REFERENCES "product_import_jobs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
