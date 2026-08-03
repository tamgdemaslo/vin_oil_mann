CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  employee_id TEXT NOT NULL,
  payroll_period_id TEXT,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  operation_date TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason_code TEXT,
  comment TEXT,
  source_type TEXT,
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by_id TEXT NOT NULL,
  reversed_by_id TEXT,
  reversal_of_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS payroll_adjustments_org_employee_idx ON payroll_adjustments (organization_id, employee_id);
CREATE INDEX IF NOT EXISTS payroll_adjustments_org_period_idx ON payroll_adjustments (organization_id, period_from, period_to);
CREATE INDEX IF NOT EXISTS payroll_adjustments_status_idx ON payroll_adjustments (status);
CREATE INDEX IF NOT EXISTS payroll_adjustments_source_idx ON payroll_adjustments (source_type, source_id);
CREATE INDEX IF NOT EXISTS payroll_adjustments_reversal_idx ON payroll_adjustments (reversal_of_id);

CREATE TABLE IF NOT EXISTS payroll_payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  employee_id TEXT NOT NULL,
  payroll_period_id TEXT,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  operation_date TEXT NOT NULL,
  operation_type TEXT NOT NULL DEFAULT 'SALARY',
  amount_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  cash_order_id TEXT,
  bank_operation_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  comment TEXT,
  created_by_id TEXT NOT NULL,
  reversed_by_id TEXT,
  reversal_of_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS payroll_payments_org_employee_idx ON payroll_payments (organization_id, employee_id);
CREATE INDEX IF NOT EXISTS payroll_payments_org_period_idx ON payroll_payments (organization_id, period_from, period_to);
CREATE INDEX IF NOT EXISTS payroll_payments_cash_order_idx ON payroll_payments (cash_order_id);
CREATE INDEX IF NOT EXISTS payroll_payments_status_idx ON payroll_payments (status);
CREATE INDEX IF NOT EXISTS payroll_payments_reversal_idx ON payroll_payments (reversal_of_id);

ALTER TABLE cash_expense_orders ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE cash_expense_orders ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE cash_expense_orders ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE cash_expense_orders ADD COLUMN IF NOT EXISTS payroll_period_id TEXT;
ALTER TABLE cash_expense_orders ADD COLUMN IF NOT EXISTS payroll_period_from TEXT;
ALTER TABLE cash_expense_orders ADD COLUMN IF NOT EXISTS payroll_period_to TEXT;

CREATE INDEX IF NOT EXISTS cash_expense_orders_source_link_idx ON cash_expense_orders (source_type, source_id);
CREATE INDEX IF NOT EXISTS cash_expense_orders_employee_idx ON cash_expense_orders (employee_id);
CREATE INDEX IF NOT EXISTS cash_expense_orders_payroll_period_idx ON cash_expense_orders (payroll_period_id);
