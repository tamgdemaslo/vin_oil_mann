-- Safe receipt editing, soft deletion and audit trail for local inventory documents.

ALTER TABLE "local_inventory_documents"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_by_name" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelled_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelled_by_name" TEXT,
  ADD COLUMN IF NOT EXISTS "correction_of_id" TEXT;

UPDATE "local_inventory_documents"
SET "status" = CASE
  WHEN "applicable" = false THEN 'draft'
  ELSE 'posted'
END
WHERE "status" IS NULL OR "status" = 'posted';

CREATE INDEX IF NOT EXISTS "local_inventory_documents_status_idx" ON "local_inventory_documents"("status");
CREATE INDEX IF NOT EXISTS "local_inventory_documents_is_deleted_idx" ON "local_inventory_documents"("is_deleted");
CREATE INDEX IF NOT EXISTS "local_inventory_documents_correction_of_id_idx" ON "local_inventory_documents"("correction_of_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_inventory_documents_correction_of_id_fkey'
  ) THEN
    ALTER TABLE "local_inventory_documents"
      ADD CONSTRAINT "local_inventory_documents_correction_of_id_fkey"
      FOREIGN KEY ("correction_of_id") REFERENCES "local_inventory_documents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "local_inventory_document_audit_logs" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status_before" TEXT,
  "status_after" TEXT,
  "message" TEXT,
  "old_value" JSONB,
  "new_value" JSONB,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "local_inventory_document_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "local_inventory_document_audit_logs_document_id_idx" ON "local_inventory_document_audit_logs"("document_id");
CREATE INDEX IF NOT EXISTS "local_inventory_document_audit_logs_action_idx" ON "local_inventory_document_audit_logs"("action");
CREATE INDEX IF NOT EXISTS "local_inventory_document_audit_logs_created_at_idx" ON "local_inventory_document_audit_logs"("created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_inventory_document_audit_logs_document_id_fkey'
  ) THEN
    ALTER TABLE "local_inventory_document_audit_logs"
      ADD CONSTRAINT "local_inventory_document_audit_logs_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "local_inventory_documents"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
