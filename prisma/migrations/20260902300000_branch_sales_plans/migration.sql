-- Stage 3: versioned monthly branch plans for canonical sales analytics rows.
-- Facts remain immutable; every plan mutation is additionally written to
-- branch_audit_logs by the application.

CREATE TABLE IF NOT EXISTS "branch_sales_plans" (
  "id" TEXT NOT NULL,
  "business_group_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "row_key" TEXT NOT NULL,
  "metric_code" TEXT NOT NULL,
  "aggregate_type" TEXT,
  "procedure" TEXT,
  "configuration" TEXT,
  "target_count" DECIMAL(14, 3) NOT NULL,
  "target_revenue_cents" INTEGER,
  "target_gross_profit_cents" INTEGER,
  "target_attach_rate_basis_points" INTEGER,
  "expected_revenue_per_unit_cents" INTEGER,
  "expected_gross_profit_per_unit_cents" INTEGER,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "branch_sales_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_sales_plans_branch_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "branch_sales_plans_metric_fkey"
    FOREIGN KEY ("metric_code") REFERENCES "sales_analytics_metrics"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_sales_plans_month_check"
    CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "branch_sales_plans_target_count_check"
    CHECK ("target_count" >= 0),
  CONSTRAINT "branch_sales_plans_branch_month_row_unique"
    UNIQUE ("branch_id", "month", "row_key")
);

CREATE INDEX IF NOT EXISTS "branch_sales_plans_group_month_idx"
  ON "branch_sales_plans" ("business_group_id", "month");
CREATE INDEX IF NOT EXISTS "branch_sales_plans_branch_month_metric_idx"
  ON "branch_sales_plans" ("branch_id", "month", "metric_code");
