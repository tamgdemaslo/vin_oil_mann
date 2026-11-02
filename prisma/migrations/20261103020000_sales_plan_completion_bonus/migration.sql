BEGIN;
ALTER TABLE branch_sales_plans ADD COLUMN completion_bonus_cents INTEGER CHECK (completion_bonus_cents >= 0);
COMMIT;
