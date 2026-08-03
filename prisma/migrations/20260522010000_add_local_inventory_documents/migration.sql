-- Local inventory documents for receipts, write-offs and future stock adjustments.

CREATE TABLE "local_inventory_documents" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "moment_at" TIMESTAMP(3) NOT NULL,
    "document_date" TEXT NOT NULL,
    "applicable" BOOLEAN NOT NULL DEFAULT true,
    "sum_cents" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "counterparty_id" TEXT,
    "counterparty_name_snapshot" TEXT,
    "store_id" TEXT,
    "store_name_snapshot" TEXT,
    "created_by_login" TEXT,
    "created_by_name" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_inventory_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_inventory_document_positions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "price_cents_per_unit" INTEGER NOT NULL DEFAULT 0,
    "slot_name" TEXT,
    "raw" JSONB,

    CONSTRAINT "local_inventory_document_positions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "local_inventory_documents_type_idx" ON "local_inventory_documents"("type");
CREATE INDEX "local_inventory_documents_document_date_idx" ON "local_inventory_documents"("document_date");
CREATE INDEX "local_inventory_documents_moment_at_idx" ON "local_inventory_documents"("moment_at");
CREATE INDEX "local_inventory_documents_applicable_idx" ON "local_inventory_documents"("applicable");
CREATE INDEX "local_inventory_documents_counterparty_id_idx" ON "local_inventory_documents"("counterparty_id");
CREATE INDEX "local_inventory_documents_store_id_idx" ON "local_inventory_documents"("store_id");

CREATE INDEX "local_inventory_document_positions_document_id_idx" ON "local_inventory_document_positions"("document_id");
CREATE INDEX "local_inventory_document_positions_product_id_idx" ON "local_inventory_document_positions"("product_id");

ALTER TABLE "local_inventory_documents" ADD CONSTRAINT "local_inventory_documents_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "local_counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_inventory_documents" ADD CONSTRAINT "local_inventory_documents_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "local_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_inventory_document_positions" ADD CONSTRAINT "local_inventory_document_positions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "local_inventory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_inventory_document_positions" ADD CONSTRAINT "local_inventory_document_positions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
