CREATE TABLE IF NOT EXISTS payroll_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'closed',
  closed_by_login TEXT NOT NULL,
  closed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_accrued_cents INTEGER NOT NULL,
  total_paid_cents INTEGER NOT NULL,
  total_remaining_cents INTEGER NOT NULL,
  employees_count INTEGER NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payroll_periods_org_range_unique UNIQUE (organization_id, date_from, date_to)
);

CREATE INDEX IF NOT EXISTS payroll_periods_org_status_idx ON payroll_periods (organization_id, status);
CREATE INDEX IF NOT EXISTS payroll_periods_closed_at_idx ON payroll_periods (closed_at);

CREATE TABLE IF NOT EXISTS payroll_period_employees (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  employee_login TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  employee_role TEXT NOT NULL,
  shift_total_cents INTEGER NOT NULL,
  piecework_cents INTEGER NOT NULL,
  adjustments_cents INTEGER NOT NULL,
  paid_out_cents INTEGER NOT NULL,
  remaining_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  shifts_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'closed',
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payroll_period_employees_period_login_unique UNIQUE (period_id, employee_login)
);

CREATE INDEX IF NOT EXISTS payroll_period_employees_login_idx ON payroll_period_employees (employee_login);
CREATE INDEX IF NOT EXISTS payroll_period_employees_period_idx ON payroll_period_employees (period_id);

CREATE TABLE IF NOT EXISTS payroll_accrual_lines (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  employee_login TEXT NOT NULL,
  line_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  reversal_of_line_id TEXT,
  date TEXT,
  title TEXT NOT NULL,
  quantity NUMERIC(12, 3),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  snapshot_json JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS payroll_accrual_lines_period_employee_idx ON payroll_accrual_lines (period_id, employee_login);
CREATE INDEX IF NOT EXISTS payroll_accrual_lines_source_idx ON payroll_accrual_lines (source_type, source_id);
CREATE INDEX IF NOT EXISTS payroll_accrual_lines_reversal_idx ON payroll_accrual_lines (reversal_of_line_id);
