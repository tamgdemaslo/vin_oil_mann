-- Run only in a disposable database before the catalog-goal migration.
CREATE TABLE payroll_goals (id TEXT PRIMARY KEY, metric TEXT, target_value INTEGER);
INSERT INTO payroll_goals VALUES ('legacy-goal', 'SERVICES', 10);
