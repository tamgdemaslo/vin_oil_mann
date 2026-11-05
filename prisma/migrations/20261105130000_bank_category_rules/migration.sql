ALTER TABLE "bank_operation_classifications"
  ADD COLUMN "hidden_from_review" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "bank_operation_category_rules" (
  "branch_id" TEXT NOT NULL,
  "merchant_key" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  CONSTRAINT "bank_operation_category_rules_pkey" PRIMARY KEY ("branch_id", "merchant_key"),
  CONSTRAINT "bank_operation_category_rules_category_fkey"
    FOREIGN KEY ("branch_id", "category_id")
    REFERENCES "bank_operation_categories" ("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
