\set ON_ERROR_STOP on

-- Read-only duplicate gate. Run before the branch-aware external-key migration.
-- A value of -1 means the optional legacy/runtime-created table is absent.
CREATE OR REPLACE FUNCTION pg_temp.branch_duplicate_count(table_name text, key_columns text[])
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  group_columns text;
  non_null_predicate text;
  duplicate_groups bigint;
BEGIN
  IF to_regclass('public.' || table_name) IS NULL THEN
    RETURN -1;
  END IF;
  SELECT string_agg(format('%I', column_name), ', '),
         string_agg(format('%I IS NOT NULL', column_name), ' AND ')
    INTO group_columns, non_null_predicate
  FROM unnest(key_columns) AS column_name;
  EXECUTE format(
    'SELECT count(*) FROM (SELECT 1 FROM %I WHERE branch_id IS NOT NULL AND %s GROUP BY branch_id, %s HAVING count(*) > 1) duplicates',
    table_name,
    non_null_predicate,
    group_columns
  ) INTO duplicate_groups;
  RETURN duplicate_groups;
END;
$$;

CREATE TEMP TABLE branch_unique_precheck_result (
  table_name text NOT NULL,
  key_columns text NOT NULL,
  duplicate_groups bigint NOT NULL
);

INSERT INTO branch_unique_precheck_result(table_name, key_columns, duplicate_groups)
SELECT table_name, array_to_string(columns_list, ', '), pg_temp.branch_duplicate_count(table_name, columns_list)
FROM (VALUES
  ('payroll_period_employees', ARRAY['period_id', 'employee_login']),
  ('employee_motivation_settings', ARRAY['employee_id']),
  ('telegram_user_sessions', ARRAY['messenger_account_id']),
  ('messenger_sync_cursors', ARRAY['organization_id', 'messenger_account_id', 'scope']),
  ('notification_jobs', ARRAY['organization_id', 'idempotency_key']),
  ('communication_identities', ARRAY['organization_id', 'messenger_account_id', 'external_user_id']),
  ('conversation_entity_links', ARRAY['organization_id', 'conversation_id', 'entity_type', 'entity_id', 'relation_type']),
  ('organization_members', ARRAY['organization_id', 'user_id']),
  ('local_stores', ARRAY['moysklad_id']),
  ('local_products', ARRAY['moysklad_id']),
  ('product_mann_links', ARRAY['organization_id', 'product_id', 'mann_article_normalized']),
  ('product_mann_poman_migration_audit', ARRAY['migration_key', 'product_id']),
  ('local_counterparties', ARRAY['moysklad_id']),
  ('cash_expense_items', ARRAY['moysklad_id']),
  ('cash_expense_orders', ARRAY['moysklad_id']),
  ('local_demands', ARRAY['moysklad_id']),
  ('inventory_sessions', ARRAY['organization_id', 'number']),
  ('inventory_count_entries', ARRAY['inventory_line_id', 'sequence']),
  ('closing_documents', ARRAY['organization_id', 'type', 'number']),
  ('closing_document_number_sequences', ARRAY['organization_id', 'type', 'year']),
  ('local_demand_positions', ARRAY['moysklad_position_id']),
  ('local_inventory_documents', ARRAY['moysklad_id']),
  ('local_inventory_document_positions', ARRAY['moysklad_position_id']),
  ('local_supplier_invoices', ARRAY['moysklad_id']),
  ('local_supplier_invoice_payments', ARRAY['moysklad_id']),
  ('tbank_integrations', ARRAY['organization_id']),
  ('tbank_settlement_accounts', ARRAY['integration_id', 'account_number_hash']),
  ('supplier_invoice_tbank_payments', ARRAY['idempotency_key']),
  ('tbank_webhook_events', ARRAY['event_id']),
  ('ai_agent_settings', ARRAY['organization_id']),
  ('ai_agent_sessions', ARRAY['organization_id', 'conversation_id']),
  ('ai_agent_runs', ARRAY['idempotency_key']),
  ('ai_agent_runs', ARRAY['organization_id', 'source_message_id'])
) AS checks(table_name, columns_list);

SELECT
  table_name,
  key_columns,
  duplicate_groups,
  CASE WHEN duplicate_groups = -1 THEN 'MISSING_OPTIONAL_TABLE'
       WHEN duplicate_groups = 0 THEN 'PASS'
       ELSE 'BLOCKER_MANUAL_REVIEW'
  END AS status
FROM branch_unique_precheck_result
ORDER BY table_name, key_columns;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM branch_unique_precheck_result WHERE duplicate_groups > 0) THEN
    RAISE EXCEPTION 'Branch unique duplicate precheck failed. Use manual review; do not auto-merge production rows.';
  END IF;
END;
$$;
