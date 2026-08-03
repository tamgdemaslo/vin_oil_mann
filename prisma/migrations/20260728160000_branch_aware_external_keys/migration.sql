-- Fail closed before changing any unique key. Null-containing keys are skipped
-- to match PostgreSQL's ordinary UNIQUE semantics.
DO $$
DECLARE
  item record;
  group_columns text;
  non_null_predicate text;
  duplicates_exist boolean;
BEGIN
  FOR item IN SELECT * FROM (VALUES
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
  ) AS checks(table_name, key_columns)
  LOOP
    IF to_regclass('public.' || item.table_name) IS NULL THEN CONTINUE; END IF;
    SELECT string_agg(format('%I', column_name), ', '),
           string_agg(format('%I IS NOT NULL', column_name), ' AND ')
      INTO group_columns, non_null_predicate
    FROM unnest(item.key_columns) AS column_name;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I WHERE branch_id IS NOT NULL AND %s GROUP BY branch_id, %s HAVING count(*) > 1)',
      item.table_name, non_null_predicate, group_columns
    ) INTO duplicates_exist;
    IF duplicates_exist THEN
      RAISE EXCEPTION 'Duplicate precheck failed for %. Manual review required.', item.table_name;
    END IF;
  END LOOP;
END $$;

ALTER TABLE payroll_period_employees DROP CONSTRAINT IF EXISTS payroll_period_employees_period_login_unique;
ALTER TABLE employee_motivation_settings DROP CONSTRAINT IF EXISTS employee_motivation_settings_org_employee_unique;
DROP INDEX IF EXISTS telegram_user_sessions_account_uidx;
DROP INDEX IF EXISTS messenger_sync_cursors_organization_id_messenger_account_id_scope_key;
DROP INDEX IF EXISTS notification_jobs_org_idempotency_uidx;
DROP INDEX IF EXISTS communication_identities_organization_id_messenger_account_id_external_user_id_key;
DROP INDEX IF EXISTS conversation_entity_links_organization_id_conversation_id_entity_type_entity_id_relation_type_key;
DROP INDEX IF EXISTS organization_members_organization_id_user_id_key;
DROP INDEX IF EXISTS local_stores_moysklad_id_key;
DROP INDEX IF EXISTS local_products_moysklad_id_key;
DROP INDEX IF EXISTS product_mann_poman_migration_audit_migration_key_product_id_key;
DROP INDEX IF EXISTS local_counterparties_moysklad_id_key;
DROP INDEX IF EXISTS cash_expense_items_moysklad_id_key;
DROP INDEX IF EXISTS cash_expense_orders_moysklad_id_key;
DROP INDEX IF EXISTS local_demands_moysklad_id_key;
DROP INDEX IF EXISTS inventory_sessions_organization_id_number_key;
DROP INDEX IF EXISTS inventory_count_entries_inventory_line_id_sequence_key;
DROP INDEX IF EXISTS closing_documents_organization_id_type_number_key;
DROP INDEX IF EXISTS closing_document_number_sequences_organization_id_type_year_key;
DROP INDEX IF EXISTS local_demand_positions_moysklad_position_id_key;
DROP INDEX IF EXISTS local_inventory_documents_moysklad_id_key;
DROP INDEX IF EXISTS local_inventory_document_positions_moysklad_position_id_key;
DROP INDEX IF EXISTS local_supplier_invoices_moysklad_id_key;
DROP INDEX IF EXISTS local_supplier_invoice_payments_moysklad_id_key;
DROP INDEX IF EXISTS tbank_integrations_organization_id_key;
DROP INDEX IF EXISTS tbank_settlement_accounts_integration_id_account_number_hash_key;
DROP INDEX IF EXISTS supplier_invoice_tbank_payments_idempotency_key_key;
DROP INDEX IF EXISTS tbank_webhook_events_event_id_key;
DROP INDEX IF EXISTS ai_agent_settings_organization_id_key;
DROP INDEX IF EXISTS ai_agent_sessions_organization_id_conversation_id_key;
DROP INDEX IF EXISTS ai_agent_runs_idempotency_key_key;
DROP INDEX IF EXISTS ai_agent_runs_organization_id_source_message_id_key;
DROP INDEX IF EXISTS notification_settings_org_uidx;

CREATE UNIQUE INDEX payroll_period_employees_branch_period_employee_key ON payroll_period_employees(branch_id, period_id, employee_login);
CREATE UNIQUE INDEX employee_motivation_settings_branch_employee_key ON employee_motivation_settings(branch_id, employee_id);
CREATE UNIQUE INDEX telegram_user_sessions_branch_account_key ON telegram_user_sessions(branch_id, messenger_account_id);
CREATE UNIQUE INDEX messenger_sync_cursors_branch_org_account_scope_key ON messenger_sync_cursors(branch_id, organization_id, messenger_account_id, scope);
CREATE UNIQUE INDEX notification_jobs_branch_org_idempotency_key ON notification_jobs(branch_id, organization_id, idempotency_key);
CREATE UNIQUE INDEX communication_identities_branch_org_account_user_key ON communication_identities(branch_id, organization_id, messenger_account_id, external_user_id);
CREATE UNIQUE INDEX conversation_entity_links_branch_entity_key ON conversation_entity_links(branch_id, organization_id, conversation_id, entity_type, entity_id, relation_type);
CREATE UNIQUE INDEX organization_members_branch_org_user_key ON organization_members(branch_id, organization_id, user_id);
CREATE UNIQUE INDEX local_stores_branch_moysklad_key ON local_stores(branch_id, moysklad_id);
CREATE UNIQUE INDEX local_products_branch_moysklad_key ON local_products(branch_id, moysklad_id);
-- Product article/code/barcodes are searchable provider attributes, not
-- stable identities. Selectel legitimately contains different MoySklad
-- products sharing these values.
CREATE INDEX local_products_branch_id_code_idx ON local_products(branch_id, code);
CREATE INDEX local_products_branch_id_barcode_ean13_idx ON local_products(branch_id, barcode_ean13);
CREATE INDEX local_products_branch_id_barcode_ean8_idx ON local_products(branch_id, barcode_ean8);
CREATE INDEX local_products_branch_id_barcode_code128_idx ON local_products(branch_id, barcode_code128);
CREATE UNIQUE INDEX product_mann_poman_audit_branch_migration_product_key ON product_mann_poman_migration_audit(branch_id, migration_key, product_id);
CREATE UNIQUE INDEX local_counterparties_branch_moysklad_key ON local_counterparties(branch_id, moysklad_id);
-- A phone can belong to several distinct counterparties in MoySklad. The
-- lookup index was created by the foundation migration; never use it as row
-- identity.
CREATE UNIQUE INDEX cash_expense_items_branch_moysklad_key ON cash_expense_items(branch_id, moysklad_id);
CREATE UNIQUE INDEX cash_expense_orders_branch_moysklad_key ON cash_expense_orders(branch_id, moysklad_id);
CREATE UNIQUE INDEX local_demands_branch_moysklad_key ON local_demands(branch_id, moysklad_id);
CREATE UNIQUE INDEX inventory_sessions_branch_org_number_key ON inventory_sessions(branch_id, organization_id, number);
CREATE UNIQUE INDEX inventory_count_entries_branch_line_sequence_key ON inventory_count_entries(branch_id, inventory_line_id, sequence);
CREATE UNIQUE INDEX closing_documents_branch_org_type_number_key ON closing_documents(branch_id, organization_id, type, number);
CREATE UNIQUE INDEX closing_document_sequences_branch_org_type_year_key ON closing_document_number_sequences(branch_id, organization_id, type, year);
CREATE UNIQUE INDEX local_demand_positions_branch_moysklad_key ON local_demand_positions(branch_id, moysklad_position_id);
CREATE UNIQUE INDEX local_inventory_documents_branch_moysklad_key ON local_inventory_documents(branch_id, moysklad_id);
CREATE UNIQUE INDEX local_inventory_document_positions_branch_moysklad_key ON local_inventory_document_positions(branch_id, moysklad_position_id);
CREATE UNIQUE INDEX local_supplier_invoices_branch_moysklad_key ON local_supplier_invoices(branch_id, moysklad_id);
CREATE UNIQUE INDEX local_supplier_invoice_payments_branch_moysklad_key ON local_supplier_invoice_payments(branch_id, moysklad_id);
CREATE UNIQUE INDEX tbank_integrations_branch_org_key ON tbank_integrations(branch_id, organization_id);
CREATE UNIQUE INDEX tbank_settlement_accounts_branch_integration_hash_key ON tbank_settlement_accounts(branch_id, integration_id, account_number_hash);
CREATE UNIQUE INDEX supplier_invoice_tbank_payments_branch_idempotency_key ON supplier_invoice_tbank_payments(branch_id, idempotency_key);
CREATE UNIQUE INDEX tbank_webhook_events_branch_event_key ON tbank_webhook_events(branch_id, event_id);
CREATE UNIQUE INDEX ai_agent_settings_branch_org_key ON ai_agent_settings(branch_id, organization_id);
CREATE UNIQUE INDEX ai_agent_sessions_branch_org_conversation_key ON ai_agent_sessions(branch_id, organization_id, conversation_id);
CREATE UNIQUE INDEX ai_agent_runs_branch_idempotency_key ON ai_agent_runs(branch_id, idempotency_key);
CREATE UNIQUE INDEX ai_agent_runs_branch_org_source_message_key ON ai_agent_runs(branch_id, organization_id, source_message_id);
CREATE UNIQUE INDEX notification_settings_branch_org_key ON notification_settings(branch_id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_positions_branch_diagnostic_node_key ON diagnostic_positions(branch_id, diagnostic_id, node);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_map_items_branch_session_item_key ON diagnostic_map_items(branch_id, session_id, item_code);
CREATE UNIQUE INDEX IF NOT EXISTS product_mann_links_branch_org_product_article_key ON product_mann_links(branch_id, organization_id, product_id, mann_article_normalized);
