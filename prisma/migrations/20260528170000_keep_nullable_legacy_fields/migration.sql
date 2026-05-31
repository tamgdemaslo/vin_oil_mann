-- Keep MoySklad legacy metadata nullable and non-blocking after the local DB cutover.
-- These fields are for audit, comparison, manual recovery and rollback support only.

ALTER TABLE "cash_expense_orders"
  ADD COLUMN "moysklad_id" TEXT,
  ADD COLUMN "moysklad_href" TEXT,
  ADD COLUMN "moysklad_meta_href" TEXT,
  ADD COLUMN "external_code" TEXT,
  ADD COLUMN "synced_at" TIMESTAMP(3),
  ADD COLUMN "sync_status" TEXT,
  ADD COLUMN "sync_error" TEXT;

ALTER TABLE "local_inventory_documents"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN "moysklad_id" TEXT,
  ADD COLUMN "moysklad_href" TEXT,
  ADD COLUMN "moysklad_meta_href" TEXT,
  ADD COLUMN "external_code" TEXT,
  ADD COLUMN "synced_at" TIMESTAMP(3),
  ADD COLUMN "sync_status" TEXT,
  ADD COLUMN "sync_error" TEXT;

ALTER TABLE "local_inventory_document_positions"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN "moysklad_position_id" TEXT,
  ADD COLUMN "moysklad_href" TEXT,
  ADD COLUMN "moysklad_meta_href" TEXT,
  ADD COLUMN "external_code" TEXT,
  ADD COLUMN "synced_at" TIMESTAMP(3),
  ADD COLUMN "sync_status" TEXT,
  ADD COLUMN "sync_error" TEXT;

ALTER TABLE "local_supplier_invoices"
  ADD COLUMN "moysklad_id" TEXT,
  ADD COLUMN "moysklad_href" TEXT,
  ADD COLUMN "moysklad_meta_href" TEXT,
  ADD COLUMN "external_code" TEXT,
  ADD COLUMN "synced_at" TIMESTAMP(3),
  ADD COLUMN "sync_status" TEXT,
  ADD COLUMN "sync_error" TEXT;

ALTER TABLE "local_supplier_invoice_payments"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN "moysklad_id" TEXT,
  ADD COLUMN "moysklad_href" TEXT,
  ADD COLUMN "moysklad_meta_href" TEXT,
  ADD COLUMN "external_code" TEXT,
  ADD COLUMN "synced_at" TIMESTAMP(3),
  ADD COLUMN "sync_status" TEXT,
  ADD COLUMN "sync_error" TEXT;

CREATE UNIQUE INDEX "cash_expense_orders_moysklad_id_key" ON "cash_expense_orders"("moysklad_id");
CREATE INDEX "cash_expense_orders_external_code_idx" ON "cash_expense_orders"("external_code");
CREATE INDEX "cash_expense_orders_synced_at_idx" ON "cash_expense_orders"("synced_at");
CREATE INDEX "cash_expense_orders_sync_status_idx" ON "cash_expense_orders"("sync_status");

CREATE UNIQUE INDEX "local_inventory_documents_moysklad_id_key" ON "local_inventory_documents"("moysklad_id");
CREATE INDEX "local_inventory_documents_source_idx" ON "local_inventory_documents"("source");
CREATE INDEX "local_inventory_documents_external_code_idx" ON "local_inventory_documents"("external_code");
CREATE INDEX "local_inventory_documents_synced_at_idx" ON "local_inventory_documents"("synced_at");
CREATE INDEX "local_inventory_documents_sync_status_idx" ON "local_inventory_documents"("sync_status");

CREATE UNIQUE INDEX "local_inventory_document_positions_moysklad_position_id_key" ON "local_inventory_document_positions"("moysklad_position_id");
CREATE INDEX "local_inventory_document_positions_source_idx" ON "local_inventory_document_positions"("source");
CREATE INDEX "local_inventory_document_positions_external_code_idx" ON "local_inventory_document_positions"("external_code");
CREATE INDEX "local_inventory_document_positions_synced_at_idx" ON "local_inventory_document_positions"("synced_at");
CREATE INDEX "local_inventory_document_positions_sync_status_idx" ON "local_inventory_document_positions"("sync_status");

CREATE UNIQUE INDEX "local_supplier_invoices_moysklad_id_key" ON "local_supplier_invoices"("moysklad_id");
CREATE INDEX "local_supplier_invoices_external_code_idx" ON "local_supplier_invoices"("external_code");
CREATE INDEX "local_supplier_invoices_synced_at_idx" ON "local_supplier_invoices"("synced_at");
CREATE INDEX "local_supplier_invoices_sync_status_idx" ON "local_supplier_invoices"("sync_status");

CREATE UNIQUE INDEX "local_supplier_invoice_payments_moysklad_id_key" ON "local_supplier_invoice_payments"("moysklad_id");
CREATE INDEX "local_supplier_invoice_payments_source_idx" ON "local_supplier_invoice_payments"("source");
CREATE INDEX "local_supplier_invoice_payments_external_code_idx" ON "local_supplier_invoice_payments"("external_code");
CREATE INDEX "local_supplier_invoice_payments_synced_at_idx" ON "local_supplier_invoice_payments"("synced_at");
CREATE INDEX "local_supplier_invoice_payments_sync_status_idx" ON "local_supplier_invoice_payments"("sync_status");
