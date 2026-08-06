-- Forward-only cleanup for the retired inventory provider.
-- This migration is deliberately blocked unless a Timeweb backup and the owner's
-- maintenance approval are both represented by an explicit session setting.

DO $$
BEGIN
  IF current_setting('app.inventory_integration_decommission', true)
       IS DISTINCT FROM 'approved-with-verified-timeweb-backup' THEN
    RAISE EXCEPTION 'migration_approval_required';
  END IF;
END $$;

-- Integration-only snapshots and cursors. No business entities are removed.
DROP TABLE IF EXISTS "moysklad_demand_position_sync";
DROP TABLE IF EXISTS "moysklad_demand_sync";
DROP TABLE IF EXISTS "moysklad_analytics_sync_state";
DROP TABLE IF EXISTS "local_inventory_sync_state";

-- Provider-specific identifiers and links. Generic external_code/source fields
-- are intentionally retained because they may be used by other providers.
ALTER TABLE IF EXISTS "local_organizations"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href";

ALTER TABLE IF EXISTS "local_stores"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href";

ALTER TABLE IF EXISTS "local_products"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href";

ALTER TABLE IF EXISTS "local_counterparties"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href";

ALTER TABLE IF EXISTS "cash_expense_items"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href";

ALTER TABLE IF EXISTS "cash_expense_orders"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href",
  DROP COLUMN IF EXISTS "moysklad_meta_href",
  DROP COLUMN IF EXISTS "moysklad_cashout_href",
  DROP COLUMN IF EXISTS "moysklad_expense_item_href",
  DROP COLUMN IF EXISTS "moysklad_counterparty_href";

ALTER TABLE IF EXISTS "local_demands"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href",
  DROP COLUMN IF EXISTS "agent_moysklad_id",
  DROP COLUMN IF EXISTS "store_moysklad_id";

ALTER TABLE IF EXISTS "local_demand_positions"
  DROP COLUMN IF EXISTS "moysklad_position_id",
  DROP COLUMN IF EXISTS "assortment_moysklad_id";

ALTER TABLE IF EXISTS "local_inventory_documents"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href",
  DROP COLUMN IF EXISTS "moysklad_meta_href";

ALTER TABLE IF EXISTS "local_inventory_document_positions"
  DROP COLUMN IF EXISTS "moysklad_position_id",
  DROP COLUMN IF EXISTS "moysklad_href",
  DROP COLUMN IF EXISTS "moysklad_meta_href";

ALTER TABLE IF EXISTS "local_supplier_invoices"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href",
  DROP COLUMN IF EXISTS "moysklad_meta_href";

ALTER TABLE IF EXISTS "local_supplier_invoice_payments"
  DROP COLUMN IF EXISTS "moysklad_id",
  DROP COLUMN IF EXISTS "moysklad_href",
  DROP COLUMN IF EXISTS "moysklad_meta_href";

ALTER TABLE IF EXISTS "diagnostics"
  DROP COLUMN IF EXISTS "shipment_moysklad_id",
  DROP COLUMN IF EXISTS "agent_moysklad_id";

ALTER TABLE IF EXISTS "crm_deals"
  DROP COLUMN IF EXISTS "moysklad_counterparty_id",
  DROP COLUMN IF EXISTS "moysklad_counterparty_href";
