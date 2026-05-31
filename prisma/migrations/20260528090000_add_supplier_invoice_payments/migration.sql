-- Supplier invoice payments and finance metadata.

ALTER TABLE "local_supplier_invoices"
  ADD COLUMN IF NOT EXISTS "paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'receipt',
  ADD COLUMN IF NOT EXISTS "comment" TEXT,
  ADD COLUMN IF NOT EXISTS "attachment_url" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by" TEXT;

CREATE INDEX IF NOT EXISTS "local_supplier_invoices_source_idx" ON "local_supplier_invoices"("source");

CREATE TABLE IF NOT EXISTS "local_supplier_invoice_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "payment_date" TEXT NOT NULL,
    "payment_type" TEXT NOT NULL,
    "cash_expense_order_id" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT,
    "raw" JSONB,

    CONSTRAINT "local_supplier_invoice_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "local_supplier_invoice_payments_invoice_id_idx" ON "local_supplier_invoice_payments"("invoice_id");
CREATE INDEX IF NOT EXISTS "local_supplier_invoice_payments_payment_date_idx" ON "local_supplier_invoice_payments"("payment_date");
CREATE INDEX IF NOT EXISTS "local_supplier_invoice_payments_payment_type_idx" ON "local_supplier_invoice_payments"("payment_type");
CREATE INDEX IF NOT EXISTS "local_supplier_invoice_payments_cash_expense_order_id_idx" ON "local_supplier_invoice_payments"("cash_expense_order_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_supplier_invoice_payments_invoice_id_fkey'
  ) THEN
    ALTER TABLE "local_supplier_invoice_payments"
      ADD CONSTRAINT "local_supplier_invoice_payments_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "local_supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_supplier_invoice_payments_cash_expense_order_id_fkey'
  ) THEN
    ALTER TABLE "local_supplier_invoice_payments"
      ADD CONSTRAINT "local_supplier_invoice_payments_cash_expense_order_id_fkey"
      FOREIGN KEY ("cash_expense_order_id") REFERENCES "cash_expense_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "local_supplier_invoices"
SET "paid_amount_cents" = "sum_cents"
WHERE "status" = 'paid' AND "paid_amount_cents" = 0;
