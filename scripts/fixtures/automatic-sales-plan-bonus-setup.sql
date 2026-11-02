-- Only for an empty disposable PostgreSQL database.
CREATE TABLE users (id TEXT PRIMARY KEY, login TEXT, status TEXT);
CREATE TABLE branch_memberships (branch_id TEXT, user_id TEXT, role_id TEXT, status TEXT);
CREATE TABLE branch_sales_plans (id TEXT PRIMARY KEY, branch_id TEXT, version INT, month TEXT, row_key TEXT, completion_bonus_cents INT);
CREATE TABLE payroll_periods (id TEXT PRIMARY KEY, branch_id TEXT, date_from TEXT, date_to TEXT, status TEXT);
CREATE TABLE payroll_adjustments (
 id TEXT PRIMARY KEY, branch_id TEXT, organization_id TEXT, employee_id TEXT,
 period_from TEXT, period_to TEXT, operation_date TEXT, type TEXT, amount_cents INT,
 reason_code TEXT, comment TEXT, source_type TEXT, source_id TEXT, status TEXT, created_by_id TEXT,
 payroll_period_id TEXT, reversed_by_id TEXT, reversal_of_id TEXT, reversed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE change_logs (
 id TEXT PRIMARY KEY, branch_id TEXT, entity_type TEXT, entity_id TEXT, action TEXT,
 old_value JSONB, new_value JSONB, performed_by_login TEXT, created_at TIMESTAMPTZ DEFAULT now());
INSERT INTO users VALUES ('u1','maksim','active'),('u2','vadim','active'),('u3','dismissed','active'),('u4','audit-fails','active');
INSERT INTO branch_memberships VALUES
 ('branch-test','u1','master','active'),('branch-test','u2','master','active'),('branch-test','u3','master','disabled'),('branch-test','u4','master','active'),('branch-other','u1','master','active');
INSERT INTO branch_sales_plans VALUES ('p1','branch-test',1,'2026-11','product:AIR_FILTER',500000),('p2','branch-other',1,'2026-11','product:AIR_FILTER',500000),('p3','branch-test',1,'2026-11','service:OIL:-:-:-',500000),('p4','branch-test',1,'2026-12','product:AIR_FILTER',500000),('p5','branch-test',1,'2026-10','product:AIR_FILTER',500000);
