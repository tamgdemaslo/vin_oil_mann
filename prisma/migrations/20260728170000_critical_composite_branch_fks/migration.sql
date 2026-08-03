-- Prove that existing relations do not cross branches before replacing FKs.
DO $$
DECLARE
  edge record;
  mismatch boolean;
BEGIN
  FOR edge IN SELECT * FROM (VALUES
    ('payroll_period_employees','period_id','payroll_periods'), ('payroll_accrual_lines','period_id','payroll_periods'),
    ('local_demands','counterparty_id','local_counterparties'), ('local_demands','store_id','local_stores'),
    ('shipment_revisions','shipment_id','local_demands'), ('inventory_ledger_entries','shipment_id','local_demands'),
    ('inventory_ledger_entries','product_id','local_products'), ('inventory_ledger_entries','store_id','local_stores'),
    ('local_demand_positions','demand_id','local_demands'), ('local_demand_positions','product_id','local_products'),
    ('telegram_user_sessions','messenger_account_id','messenger_accounts'),
    ('messenger_conversations','connection_id','messenger_connections'), ('messenger_conversations','messenger_account_id','messenger_accounts'),
    ('messenger_messages','conversation_id','messenger_conversations'), ('messenger_messages','messenger_account_id','messenger_accounts'),
    ('messenger_outbox','conversation_id','messenger_conversations'), ('messenger_outbox','message_id','messenger_messages'),
    ('messenger_outbox','connection_id','messenger_connections'), ('messenger_outbox','messenger_account_id','messenger_accounts'),
    ('messenger_attachments','message_id','messenger_messages'), ('messenger_media_jobs','attachment_id','messenger_attachments'),
    ('messenger_delivery_events','message_id','messenger_messages'), ('messenger_sync_cursors','messenger_account_id','messenger_accounts'),
    ('diagnostic_positions','diagnostic_id','diagnostics'), ('diagnostic_photos','position_id','diagnostic_positions'),
    ('diagnostic_offers','diagnostic_id','diagnostics'), ('diagnostic_map_sessions','demand_id','local_demands'),
    ('diagnostic_map_items','session_id','diagnostic_map_sessions'), ('diagnostic_map_photos','item_id','diagnostic_map_items'),
    ('diagnostic_map_vehicle_photos','session_id','diagnostic_map_sessions'),
    ('inventory_sessions','warehouse_id','local_stores'), ('inventory_lines','inventory_session_id','inventory_sessions'),
    ('inventory_lines','product_id','local_products'), ('inventory_lines','warehouse_id','local_stores'),
    ('inventory_count_entries','inventory_line_id','inventory_lines'), ('inventory_attachments','inventory_line_id','inventory_lines')
  ) AS edges(child_table, child_column, parent_table)
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I c JOIN %I p ON p.id = c.%I WHERE c.%I IS NOT NULL AND c.branch_id <> p.branch_id)',
      edge.child_table, edge.parent_table, edge.child_column, edge.child_column
    ) INTO mismatch;
    IF mismatch THEN
      RAISE EXCEPTION 'Cross-branch relation precheck failed: %.% -> %', edge.child_table, edge.child_column, edge.parent_table;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payroll_periods_branch_id_id_key ON payroll_periods(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS local_counterparties_branch_id_id_key ON local_counterparties(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS local_stores_branch_id_id_key ON local_stores(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS local_products_branch_id_id_key ON local_products(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS local_demands_branch_id_id_key ON local_demands(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messenger_connections_branch_id_id_key ON messenger_connections(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messenger_accounts_branch_id_id_key ON messenger_accounts(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messenger_conversations_branch_id_id_key ON messenger_conversations(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messenger_messages_branch_id_id_key ON messenger_messages(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS messenger_attachments_branch_id_id_key ON messenger_attachments(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostics_branch_id_id_key ON diagnostics(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_positions_branch_id_id_key ON diagnostic_positions(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_map_sessions_branch_id_id_key ON diagnostic_map_sessions(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_map_items_branch_id_id_key ON diagnostic_map_items(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_sessions_branch_id_id_key ON inventory_sessions(branch_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_lines_branch_id_id_key ON inventory_lines(branch_id, id);

-- Drop prior single-column FKs on the protected child columns, regardless of
-- whether they came from Prisma or the historical runtime bootstrap.
DO $$
DECLARE
  target record;
  constraint_row record;
  attribute_number smallint;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('payroll_period_employees','period_id'), ('payroll_accrual_lines','period_id'),
    ('local_demands','counterparty_id'), ('local_demands','store_id'), ('shipment_revisions','shipment_id'),
    ('inventory_ledger_entries','shipment_id'), ('inventory_ledger_entries','product_id'), ('inventory_ledger_entries','store_id'),
    ('local_demand_positions','demand_id'), ('local_demand_positions','product_id'),
    ('telegram_user_sessions','messenger_account_id'), ('messenger_conversations','connection_id'), ('messenger_conversations','messenger_account_id'),
    ('messenger_messages','conversation_id'), ('messenger_messages','messenger_account_id'),
    ('messenger_outbox','conversation_id'), ('messenger_outbox','message_id'), ('messenger_outbox','connection_id'), ('messenger_outbox','messenger_account_id'),
    ('messenger_attachments','message_id'), ('messenger_media_jobs','attachment_id'), ('messenger_delivery_events','message_id'),
    ('messenger_sync_cursors','messenger_account_id'), ('diagnostic_positions','diagnostic_id'), ('diagnostic_photos','position_id'),
    ('diagnostic_offers','diagnostic_id'), ('diagnostic_map_sessions','demand_id'), ('diagnostic_map_items','session_id'),
    ('diagnostic_map_photos','item_id'), ('diagnostic_map_vehicle_photos','session_id'),
    ('inventory_sessions','warehouse_id'), ('inventory_lines','inventory_session_id'), ('inventory_lines','product_id'),
    ('inventory_lines','warehouse_id'), ('inventory_count_entries','inventory_line_id'), ('inventory_attachments','inventory_line_id')
  ) AS targets(table_name, column_name)
  LOOP
    SELECT attnum INTO attribute_number FROM pg_attribute
      WHERE attrelid = to_regclass('public.' || target.table_name) AND attname = target.column_name;
    FOR constraint_row IN SELECT conname FROM pg_constraint
      WHERE conrelid = to_regclass('public.' || target.table_name) AND contype = 'f' AND conkey @> ARRAY[attribute_number]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.table_name, constraint_row.conname);
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE payroll_period_employees ADD CONSTRAINT payroll_period_employees_branch_period_fk FOREIGN KEY (branch_id, period_id) REFERENCES payroll_periods(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE payroll_accrual_lines ADD CONSTRAINT payroll_accrual_lines_branch_period_fk FOREIGN KEY (branch_id, period_id) REFERENCES payroll_periods(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE local_demands ADD CONSTRAINT local_demands_branch_counterparty_fk FOREIGN KEY (branch_id, counterparty_id) REFERENCES local_counterparties(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE local_demands ADD CONSTRAINT local_demands_branch_store_fk FOREIGN KEY (branch_id, store_id) REFERENCES local_stores(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE shipment_revisions ADD CONSTRAINT shipment_revisions_branch_shipment_fk FOREIGN KEY (branch_id, shipment_id) REFERENCES local_demands(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE inventory_ledger_entries ADD CONSTRAINT inventory_ledger_branch_shipment_fk FOREIGN KEY (branch_id, shipment_id) REFERENCES local_demands(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE inventory_ledger_entries ADD CONSTRAINT inventory_ledger_branch_product_fk FOREIGN KEY (branch_id, product_id) REFERENCES local_products(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE inventory_ledger_entries ADD CONSTRAINT inventory_ledger_branch_store_fk FOREIGN KEY (branch_id, store_id) REFERENCES local_stores(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE local_demand_positions ADD CONSTRAINT local_demand_positions_branch_demand_fk FOREIGN KEY (branch_id, demand_id) REFERENCES local_demands(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE local_demand_positions ADD CONSTRAINT local_demand_positions_branch_product_fk FOREIGN KEY (branch_id, product_id) REFERENCES local_products(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE telegram_user_sessions ADD CONSTRAINT telegram_sessions_branch_account_fk FOREIGN KEY (branch_id, messenger_account_id) REFERENCES messenger_accounts(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE messenger_conversations ADD CONSTRAINT messenger_conversations_branch_connection_fk FOREIGN KEY (branch_id, connection_id) REFERENCES messenger_connections(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE messenger_conversations ADD CONSTRAINT messenger_conversations_branch_account_fk FOREIGN KEY (branch_id, messenger_account_id) REFERENCES messenger_accounts(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE messenger_messages ADD CONSTRAINT messenger_messages_branch_conversation_fk FOREIGN KEY (branch_id, conversation_id) REFERENCES messenger_conversations(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE messenger_messages ADD CONSTRAINT messenger_messages_branch_account_fk FOREIGN KEY (branch_id, messenger_account_id) REFERENCES messenger_accounts(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE messenger_outbox ADD CONSTRAINT messenger_outbox_branch_conversation_fk FOREIGN KEY (branch_id, conversation_id) REFERENCES messenger_conversations(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE messenger_outbox ADD CONSTRAINT messenger_outbox_branch_message_fk FOREIGN KEY (branch_id, message_id) REFERENCES messenger_messages(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE messenger_outbox ADD CONSTRAINT messenger_outbox_branch_connection_fk FOREIGN KEY (branch_id, connection_id) REFERENCES messenger_connections(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE messenger_outbox ADD CONSTRAINT messenger_outbox_branch_account_fk FOREIGN KEY (branch_id, messenger_account_id) REFERENCES messenger_accounts(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE messenger_attachments ADD CONSTRAINT messenger_attachments_branch_message_fk FOREIGN KEY (branch_id, message_id) REFERENCES messenger_messages(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE messenger_media_jobs ADD CONSTRAINT messenger_media_jobs_branch_attachment_fk FOREIGN KEY (branch_id, attachment_id) REFERENCES messenger_attachments(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE messenger_delivery_events ADD CONSTRAINT messenger_delivery_events_branch_message_fk FOREIGN KEY (branch_id, message_id) REFERENCES messenger_messages(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE messenger_sync_cursors ADD CONSTRAINT messenger_sync_cursors_branch_account_fk FOREIGN KEY (branch_id, messenger_account_id) REFERENCES messenger_accounts(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE diagnostic_positions ADD CONSTRAINT diagnostic_positions_branch_diagnostic_fk FOREIGN KEY (branch_id, diagnostic_id) REFERENCES diagnostics(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE diagnostic_photos ADD CONSTRAINT diagnostic_photos_branch_position_fk FOREIGN KEY (branch_id, position_id) REFERENCES diagnostic_positions(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE diagnostic_offers ADD CONSTRAINT diagnostic_offers_branch_diagnostic_fk FOREIGN KEY (branch_id, diagnostic_id) REFERENCES diagnostics(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE diagnostic_map_sessions ADD CONSTRAINT diagnostic_map_sessions_branch_demand_fk FOREIGN KEY (branch_id, demand_id) REFERENCES local_demands(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE diagnostic_map_items ADD CONSTRAINT diagnostic_map_items_branch_session_fk FOREIGN KEY (branch_id, session_id) REFERENCES diagnostic_map_sessions(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE diagnostic_map_photos ADD CONSTRAINT diagnostic_map_photos_branch_item_fk FOREIGN KEY (branch_id, item_id) REFERENCES diagnostic_map_items(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE diagnostic_map_vehicle_photos ADD CONSTRAINT diagnostic_map_vehicle_photos_branch_session_fk FOREIGN KEY (branch_id, session_id) REFERENCES diagnostic_map_sessions(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE inventory_sessions ADD CONSTRAINT inventory_sessions_branch_warehouse_fk FOREIGN KEY (branch_id, warehouse_id) REFERENCES local_stores(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE inventory_lines ADD CONSTRAINT inventory_lines_branch_session_fk FOREIGN KEY (branch_id, inventory_session_id) REFERENCES inventory_sessions(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE inventory_lines ADD CONSTRAINT inventory_lines_branch_product_fk FOREIGN KEY (branch_id, product_id) REFERENCES local_products(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE inventory_lines ADD CONSTRAINT inventory_lines_branch_warehouse_fk FOREIGN KEY (branch_id, warehouse_id) REFERENCES local_stores(branch_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE inventory_count_entries ADD CONSTRAINT inventory_count_entries_branch_line_fk FOREIGN KEY (branch_id, inventory_line_id) REFERENCES inventory_lines(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE inventory_attachments ADD CONSTRAINT inventory_attachments_branch_line_fk FOREIGN KEY (branch_id, inventory_line_id) REFERENCES inventory_lines(branch_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
