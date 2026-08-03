CREATE TABLE "shipment_revisions" (
  "id" TEXT NOT NULL,
  "shipment_id" TEXT NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "status_before" TEXT,
  "status_after" TEXT,
  "snapshot_before_json" JSONB,
  "snapshot_after_json" JSONB,
  "reason_code" TEXT,
  "reason" TEXT,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shipment_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_ledger_entries" (
  "id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "shipment_id" TEXT,
  "product_id" TEXT,
  "store_id" TEXT,
  "movement_type" TEXT NOT NULL,
  "quantity_delta" DECIMAL(14,3) NOT NULL,
  "unit_cost_snapshot" INTEGER,
  "original_entry_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shipment_revisions_shipment_id_revision_number_idx" ON "shipment_revisions"("shipment_id", "revision_number");
CREATE INDEX "shipment_revisions_event_type_idx" ON "shipment_revisions"("event_type");
CREATE INDEX "shipment_revisions_created_at_idx" ON "shipment_revisions"("created_at");

CREATE INDEX "inventory_ledger_entries_source_type_source_id_idx" ON "inventory_ledger_entries"("source_type", "source_id");
CREATE INDEX "inventory_ledger_entries_shipment_id_idx" ON "inventory_ledger_entries"("shipment_id");
CREATE INDEX "inventory_ledger_entries_product_id_idx" ON "inventory_ledger_entries"("product_id");
CREATE INDEX "inventory_ledger_entries_store_id_idx" ON "inventory_ledger_entries"("store_id");
CREATE INDEX "inventory_ledger_entries_movement_type_idx" ON "inventory_ledger_entries"("movement_type");
CREATE INDEX "inventory_ledger_entries_created_at_idx" ON "inventory_ledger_entries"("created_at");

ALTER TABLE "shipment_revisions"
  ADD CONSTRAINT "shipment_revisions_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "local_demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_ledger_entries"
  ADD CONSTRAINT "inventory_ledger_entries_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "local_demands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_ledger_entries"
  ADD CONSTRAINT "inventory_ledger_entries_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_ledger_entries"
  ADD CONSTRAINT "inventory_ledger_entries_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "local_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_ledger_entries"
  ADD CONSTRAINT "inventory_ledger_entries_original_entry_id_fkey"
  FOREIGN KEY ("original_entry_id") REFERENCES "inventory_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
