-- Run only in a disposable database before the completion-bonus migration.
CREATE TABLE branch_sales_plans (id TEXT PRIMARY KEY, target_count NUMERIC);
INSERT INTO branch_sales_plans VALUES ('existing-plan', 30);
