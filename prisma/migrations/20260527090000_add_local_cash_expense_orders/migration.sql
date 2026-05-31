-- Local cash expense orders: platform-owned source of truth for cashbox расходники.

CREATE TABLE IF NOT EXISTS "cash_expense_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'local',
    "moysklad_id" TEXT,
    "moysklad_href" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_expense_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_expense_items_name_key" ON "cash_expense_items"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_expense_items_moysklad_id_key" ON "cash_expense_items"("moysklad_id");
CREATE INDEX IF NOT EXISTS "cash_expense_items_is_active_idx" ON "cash_expense_items"("is_active");
CREATE INDEX IF NOT EXISTS "cash_expense_items_source_idx" ON "cash_expense_items"("source");

CREATE TABLE IF NOT EXISTS "cash_expense_orders" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "warehouse_id" TEXT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "expense_date" TEXT NOT NULL,
    "expense_item_id" TEXT,
    "expense_item_name" TEXT NOT NULL,
    "counterparty_id" TEXT,
    "counterparty_name" TEXT NOT NULL,
    "article" TEXT,
    "payment_purpose" TEXT,
    "payment_type" TEXT NOT NULL DEFAULT 'cash',
    "attachment_url" TEXT,
    "comment" TEXT,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT,
    "created_by_role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "posted_by_name" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'local',
    "moysklad_cashout_href" TEXT,
    "moysklad_expense_item_href" TEXT,
    "moysklad_counterparty_href" TEXT,

    CONSTRAINT "cash_expense_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_expense_orders_number_key" ON "cash_expense_orders"("number");
CREATE INDEX IF NOT EXISTS "cash_expense_orders_shift_id_idx" ON "cash_expense_orders"("shift_id");
CREATE INDEX IF NOT EXISTS "cash_expense_orders_status_idx" ON "cash_expense_orders"("status");
CREATE INDEX IF NOT EXISTS "cash_expense_orders_expense_date_idx" ON "cash_expense_orders"("expense_date");
CREATE INDEX IF NOT EXISTS "cash_expense_orders_expense_item_id_idx" ON "cash_expense_orders"("expense_item_id");
CREATE INDEX IF NOT EXISTS "cash_expense_orders_counterparty_id_idx" ON "cash_expense_orders"("counterparty_id");
CREATE INDEX IF NOT EXISTS "cash_expense_orders_payment_type_idx" ON "cash_expense_orders"("payment_type");
CREATE INDEX IF NOT EXISTS "cash_expense_orders_source_idx" ON "cash_expense_orders"("source");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_expense_orders_organization_id_fkey'
  ) THEN
    ALTER TABLE "cash_expense_orders"
      ADD CONSTRAINT "cash_expense_orders_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_expense_orders_warehouse_id_fkey'
  ) THEN
    ALTER TABLE "cash_expense_orders"
      ADD CONSTRAINT "cash_expense_orders_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "local_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_expense_orders_expense_item_id_fkey'
  ) THEN
    ALTER TABLE "cash_expense_orders"
      ADD CONSTRAINT "cash_expense_orders_expense_item_id_fkey"
      FOREIGN KEY ("expense_item_id") REFERENCES "cash_expense_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_expense_orders_counterparty_id_fkey'
  ) THEN
    ALTER TABLE "cash_expense_orders"
      ADD CONSTRAINT "cash_expense_orders_counterparty_id_fkey"
      FOREIGN KEY ("counterparty_id") REFERENCES "local_counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
