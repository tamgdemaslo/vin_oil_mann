-- The branch backfill changes the distribution of branch_id from NULL to a
-- real value for nearly every legacy row. Refresh planner statistics after the
-- new composite indexes exist so production does not retain the pre-backfill
-- estimates observed during the Selectel rehearsal.
ANALYZE "local_products";
ANALYZE "local_demands";
ANALYZE "local_stock_balances";
ANALYZE "messenger_messages";
ANALYZE "crm_deals";
