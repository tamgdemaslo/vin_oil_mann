-- Supplier invoices created from local receipt documents.

CREATE TABLE "local_supplier_invoices" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "number" TEXT,
    "invoice_date" TEXT NOT NULL,
    "due_date" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "sum_cents" INTEGER NOT NULL DEFAULT 0,
    "counterparty_name_snapshot" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_supplier_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "local_supplier_invoices_document_id_key" ON "local_supplier_invoices"("document_id");
CREATE INDEX "local_supplier_invoices_invoice_date_idx" ON "local_supplier_invoices"("invoice_date");
CREATE INDEX "local_supplier_invoices_due_date_idx" ON "local_supplier_invoices"("due_date");
CREATE INDEX "local_supplier_invoices_status_idx" ON "local_supplier_invoices"("status");
CREATE INDEX "local_supplier_invoices_counterparty_name_snapshot_idx" ON "local_supplier_invoices"("counterparty_name_snapshot");

ALTER TABLE "local_supplier_invoices" ADD CONSTRAINT "local_supplier_invoices_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "local_inventory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
