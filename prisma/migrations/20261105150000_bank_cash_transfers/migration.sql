CREATE UNIQUE INDEX "cash_shifts_branch_id_id_key" ON "cash_shifts" ("branch_id", "id");

CREATE TABLE "bank_cash_transfers" (
  "branch_id" TEXT NOT NULL,
  "account_number_hash" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "shift_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" > 0),
  "bank_date" TEXT NOT NULL,
  "cash_date" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("branch_id", "account_number_hash", "operation_id"),
  CONSTRAINT "bank_cash_transfers_branch_id_shift_id_fkey" FOREIGN KEY ("branch_id", "shift_id")
    REFERENCES "cash_shifts" ("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "bank_cash_transfers_branch_id_shift_id_idx" ON "bank_cash_transfers" ("branch_id", "shift_id");
CREATE INDEX "bank_cash_transfers_branch_id_cash_date_idx" ON "bank_cash_transfers" ("branch_id", "cash_date");
CREATE UNIQUE INDEX "bank_cash_transfers_bank_operation_key" ON "bank_cash_transfers" ("account_number_hash", "operation_id");
