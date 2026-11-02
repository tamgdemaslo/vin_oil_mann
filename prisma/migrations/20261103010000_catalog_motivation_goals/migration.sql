BEGIN;
ALTER TABLE payroll_goals ADD COLUMN target_id TEXT, ADD COLUMN target_name TEXT;
COMMIT;
