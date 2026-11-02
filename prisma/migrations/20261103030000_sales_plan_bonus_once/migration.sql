BEGIN;
CREATE UNIQUE INDEX payroll_adjustments_sales_plan_bonus_once
ON payroll_adjustments (branch_id, employee_id, source_id)
WHERE source_type = 'SALES_PLAN_BONUS';
COMMIT;
