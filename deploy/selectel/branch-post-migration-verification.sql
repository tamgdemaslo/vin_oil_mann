-- Read-only verification for an isolated Selectel rehearsal database.
-- Run only after scripts/branch-migration-preflight.mjs passes.
BEGIN TRANSACTION READ ONLY;

SELECT 'business_groups' AS check_name, count(*)::bigint AS value FROM business_groups
UNION ALL
SELECT 'branches', count(*)::bigint FROM branches
UNION ALL
SELECT 'branch_main', count(*)::bigint FROM branches WHERE id = 'branch-main'
UNION ALL
SELECT 'active_group_owners', count(*)::bigint FROM business_group_memberships WHERE role = 'group_owner' AND status = 'active'
UNION ALL
SELECT 'active_branch_memberships', count(*)::bigint FROM branch_memberships WHERE status = 'active';

CREATE TEMP TABLE branch_verification_results (
  table_name text NOT NULL,
  null_branch_ids bigint NOT NULL,
  non_main_rows bigint NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  target record;
  null_count bigint;
  non_main_count bigint;
BEGIN
  FOR target IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'branch_id'
    ORDER BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE branch_id IS NULL', target.table_schema, target.table_name)
      INTO null_count;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE branch_id <> %L', target.table_schema, target.table_name, 'branch-main')
      INTO non_main_count;
    INSERT INTO branch_verification_results VALUES (target.table_name, null_count, non_main_count);
  END LOOP;
END $$;

SELECT * FROM branch_verification_results ORDER BY table_name;

SELECT 'messenger_message_conversation' AS relation_name, count(*) AS violations
FROM messenger_messages child
JOIN messenger_conversations parent ON parent.id = child.conversation_id
WHERE child.branch_id <> parent.branch_id
UNION ALL
SELECT 'diagnostic_position_diagnostic', count(*)
FROM diagnostic_positions child
JOIN diagnostics parent ON parent.id = child.diagnostic_id
WHERE child.branch_id <> parent.branch_id
UNION ALL
SELECT 'stock_balance_product', count(*)
FROM local_stock_balances child
JOIN local_products parent ON parent.id = child.product_id
WHERE child.branch_id <> parent.branch_id
UNION ALL
SELECT 'stock_balance_store', count(*)
FROM local_stock_balances child
JOIN local_stores parent ON parent.id = child.store_id
WHERE child.branch_id <> parent.branch_id
UNION ALL
SELECT 'demand_position_demand', count(*)
FROM local_demand_positions child
JOIN local_demands parent ON parent.id = child.demand_id
WHERE child.branch_id <> parent.branch_id;

ROLLBACK;
