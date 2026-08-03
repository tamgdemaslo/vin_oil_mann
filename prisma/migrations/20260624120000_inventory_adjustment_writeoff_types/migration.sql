ALTER TABLE "local_inventory_documents"
  ADD COLUMN IF NOT EXISTS "adjustment_type" TEXT,
  ADD COLUMN IF NOT EXISTS "adjustment_method" TEXT,
  ADD COLUMN IF NOT EXISTS "adjustment_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "affects_management_profit" BOOLEAN NOT NULL DEFAULT true;

UPDATE "local_inventory_documents"
SET "adjustment_type" = 'expense',
    "adjustment_method" = 'WRITE_OFF_QUANTITY'
WHERE "type" = 'writeoff'
  AND "adjustment_type" IS NULL;

CREATE INDEX IF NOT EXISTS "local_inventory_documents_adjustment_type_idx"
  ON "local_inventory_documents"("adjustment_type");

CREATE INDEX IF NOT EXISTS "local_inventory_documents_affects_management_profit_idx"
  ON "local_inventory_documents"("affects_management_profit");
