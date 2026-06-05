-- Local cash shifts and withdrawals. This makes the app database the source of truth
-- for cashbox open/close state instead of the workspace JSON file.

CREATE TABLE "cash_shifts" (
  "id" TEXT NOT NULL,
  "service_date" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "opened_at" TIMESTAMP(3) NOT NULL,
  "opened_by" TEXT NOT NULL,
  "opened_by_name" TEXT,
  "opened_by_role" TEXT,
  "opening_cash_cents" INTEGER NOT NULL DEFAULT 0,
  "closed_at" TIMESTAMP(3),
  "closed_by" TEXT,
  "closed_by_name" TEXT,
  "closed_by_role" TEXT,
  "cash_orders_total_cents" INTEGER,
  "card_orders_total_cents" INTEGER,
  "withdrawals_total_cents" INTEGER,
  "cash_expenses_total_cents" INTEGER,
  "expected_cash_cents" INTEGER,
  "actual_cash_cents" INTEGER,
  "discrepancy_cents" INTEGER,
  "discrepancy_comment" TEXT,
  "source" TEXT NOT NULL DEFAULT 'local',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_withdrawals" (
  "id" TEXT NOT NULL,
  "shift_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "comment" TEXT,
  "created_by" TEXT NOT NULL,
  "created_by_name" TEXT,
  "created_by_role" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'local',

  CONSTRAINT "cash_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_shifts_service_date_key" ON "cash_shifts"("service_date");
CREATE UNIQUE INDEX "cash_shifts_single_open_idx" ON "cash_shifts"("status") WHERE "status" = 'open';
CREATE INDEX "cash_shifts_status_idx" ON "cash_shifts"("status");
CREATE INDEX "cash_shifts_opened_at_idx" ON "cash_shifts"("opened_at");
CREATE INDEX "cash_shifts_closed_at_idx" ON "cash_shifts"("closed_at");
CREATE INDEX "cash_withdrawals_shift_id_idx" ON "cash_withdrawals"("shift_id");
CREATE INDEX "cash_withdrawals_created_at_idx" ON "cash_withdrawals"("created_at");

ALTER TABLE "cash_withdrawals"
  ADD CONSTRAINT "cash_withdrawals_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "cash_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
