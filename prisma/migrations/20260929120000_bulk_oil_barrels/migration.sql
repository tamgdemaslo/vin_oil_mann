-- CreateTable
CREATE TABLE "local_bulk_oil_barrels" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "marking_code" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SEALED',
    "received_liters" DECIMAL(14,3) NOT NULL,
    "remaining_liters" DECIMAL(14,3) NOT NULL,
    "receipt_document_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_by_login" TEXT,

    CONSTRAINT "local_bulk_oil_barrels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_bulk_oil_barrel_events" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "barrel_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "volume_liters" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "document_id" TEXT,
    "created_by_login" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_bulk_oil_barrel_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_bulk_oil_barrels_branch_id_product_id_status_idx" ON "local_bulk_oil_barrels"("branch_id", "product_id", "status");

-- CreateIndex
CREATE INDEX "local_bulk_oil_barrels_branch_id_receipt_document_id_idx" ON "local_bulk_oil_barrels"("branch_id", "receipt_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "local_bulk_oil_barrels_branch_id_id_key" ON "local_bulk_oil_barrels"("branch_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "local_bulk_oil_barrels_branch_id_marking_code_key" ON "local_bulk_oil_barrels"("branch_id", "marking_code");

-- CreateIndex
CREATE INDEX "local_bulk_oil_barrel_events_branch_id_barrel_id_created_at_idx" ON "local_bulk_oil_barrel_events"("branch_id", "barrel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "local_bulk_oil_barrel_events_branch_id_operation_key_key" ON "local_bulk_oil_barrel_events"("branch_id", "operation_key");

-- AddForeignKey
ALTER TABLE "local_bulk_oil_barrels" ADD CONSTRAINT "local_bulk_oil_barrels_branch_id_product_id_fkey" FOREIGN KEY ("branch_id", "product_id") REFERENCES "local_products"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_bulk_oil_barrels" ADD CONSTRAINT "local_bulk_oil_barrels_branch_id_store_id_fkey" FOREIGN KEY ("branch_id", "store_id") REFERENCES "local_stores"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_bulk_oil_barrel_events" ADD CONSTRAINT "local_bulk_oil_barrel_events_branch_id_barrel_id_fkey" FOREIGN KEY ("branch_id", "barrel_id") REFERENCES "local_bulk_oil_barrels"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one drum can supply the product at a time; closing never deletes its code.
CREATE UNIQUE INDEX "local_bulk_oil_barrels_one_open_per_product" ON "local_bulk_oil_barrels" ("branch_id", "product_id") WHERE "status" = 'OPEN';
ALTER TABLE "local_bulk_oil_barrels" ADD CONSTRAINT "local_bulk_oil_barrels_status_check" CHECK ("status" IN ('SEALED', 'OPEN', 'CLOSED', 'CANCELLED'));
ALTER TABLE "local_bulk_oil_barrels" ADD CONSTRAINT "local_bulk_oil_barrels_volume_check" CHECK ("received_liters" > 0 AND "remaining_liters" >= 0 AND "remaining_liters" <= "received_liters");
