-- Composite lookup/order indexes for the branch-scoped hot paths verified by
-- the Selectel production-copy rehearsal.
CREATE INDEX IF NOT EXISTS "local_products_branch_id_archived_updated_at_idx"
  ON "local_products"("branch_id", "archived", "updated_at");

CREATE INDEX IF NOT EXISTS "local_demands_branch_id_moment_at_idx"
  ON "local_demands"("branch_id", "moment_at");

CREATE INDEX IF NOT EXISTS "messenger_messages_branch_id_created_at_idx"
  ON "messenger_messages"("branch_id", "created_at");
