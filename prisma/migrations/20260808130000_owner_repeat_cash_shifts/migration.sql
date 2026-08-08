-- Owners may reopen a cash shift after closing one on the same service date.
-- Apply only after a verified Timeweb PostgreSQL backup and explicit owner approval.

DO $$
BEGIN
  IF current_setting('app.owner_repeat_cash_shifts', true)
       IS DISTINCT FROM 'approved-with-verified-timeweb-backup' THEN
    RAISE EXCEPTION 'migration_approval_required';
  END IF;
END $$;

DROP INDEX IF EXISTS "cash_shifts_branch_id_service_date_key";

CREATE INDEX "cash_shifts_branch_id_service_date_idx"
  ON "cash_shifts"("branch_id", "service_date");

-- Non-owners retain the one-shift-per-service-date database guarantee.
-- The existing cash_shifts_branch_single_open_idx still prevents two open
-- shifts in the same branch, including shifts opened by an owner.
CREATE UNIQUE INDEX "cash_shifts_non_owner_service_date_key"
  ON "cash_shifts"("branch_id", "service_date")
  WHERE COALESCE("opened_by_role", '') <> 'owner';
