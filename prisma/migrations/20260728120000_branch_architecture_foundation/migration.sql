-- Branch architecture foundation.
-- This migration only creates Branch 1 and backfills existing operational rows.
-- Branch 2 must be created through the application after the verification runbook passes.

CREATE TABLE IF NOT EXISTS "business_groups" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_groups_slug_key" ON "business_groups"("slug");
CREATE INDEX IF NOT EXISTS "business_groups_status_idx" ON "business_groups"("status");

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "login" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "auth_role" TEXT NOT NULL DEFAULT 'admin',
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_active_branch_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_login_key" ON "users"("login");
CREATE INDEX IF NOT EXISTS "users_status_idx" ON "users"("status");

CREATE TABLE IF NOT EXISTS "branches" (
  "id" TEXT NOT NULL,
  "business_group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "short_name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "address" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Kaliningrad',
  "phone" TEXT,
  "email" TEXT,
  "telegram_username" TEXT,
  "legal_entity_name" TEXT,
  "legal_entity_type" TEXT,
  "inn" TEXT,
  "ogrn" TEXT,
  "bank_details_json" JSONB,
  "opening_date" DATE,
  "legacy_organization_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branches_business_group_id_fkey" FOREIGN KEY ("business_group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "branches_legacy_organization_id_key" ON "branches"("legacy_organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "branches_business_group_id_slug_key" ON "branches"("business_group_id", "slug");
CREATE INDEX IF NOT EXISTS "branches_business_group_id_status_idx" ON "branches"("business_group_id", "status");

CREATE TABLE IF NOT EXISTS "branch_memberships" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "is_default_branch" BOOLEAN NOT NULL DEFAULT false,
  "position" TEXT,
  "employment_start" DATE,
  "pay_settings_json" JSONB,
  "schedule_json" JSONB,
  "permissions_json" JSONB,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_memberships_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "branch_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "branch_memberships_branch_id_user_id_key" ON "branch_memberships"("branch_id", "user_id");
CREATE INDEX IF NOT EXISTS "branch_memberships_user_id_status_idx" ON "branch_memberships"("user_id", "status");
CREATE INDEX IF NOT EXISTS "branch_memberships_branch_id_status_idx" ON "branch_memberships"("branch_id", "status");

CREATE TABLE IF NOT EXISTS "business_group_memberships" (
  "id" TEXT NOT NULL,
  "business_group_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_group_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_group_memberships_business_group_id_fkey" FOREIGN KEY ("business_group_id") REFERENCES "business_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_group_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_group_memberships_business_group_id_user_id_key" ON "business_group_memberships"("business_group_id", "user_id");
CREATE INDEX IF NOT EXISTS "business_group_memberships_user_id_status_idx" ON "business_group_memberships"("user_id", "status");

CREATE TABLE IF NOT EXISTS "branch_legal_entities" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "inn" TEXT,
  "kpp" TEXT,
  "ogrn" TEXT,
  "ogrnip" TEXT,
  "legal_address" TEXT,
  "bank_details_json" JSONB,
  "document_settings_json" JSONB,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_legal_entities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_legal_entities_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "branch_legal_entities_branch_id_inn_key" ON "branch_legal_entities"("branch_id", "inn");
CREATE INDEX IF NOT EXISTS "branch_legal_entities_branch_id_is_primary_idx" ON "branch_legal_entities"("branch_id", "is_primary");

CREATE TABLE IF NOT EXISTS "branch_communication_settings" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "primary_phone" TEXT NOT NULL,
  "secondary_phone" TEXT,
  "whatsapp" TEXT,
  "telegram" TEXT,
  "email" TEXT,
  "callback_settings_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_communication_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_communication_settings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "branch_communication_settings_branch_id_key" ON "branch_communication_settings"("branch_id");

CREATE TABLE IF NOT EXISTS "branch_telegram_integrations" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "phone_number_masked" TEXT,
  "session_encrypted" TEXT,
  "status" TEXT NOT NULL DEFAULT 'disconnected',
  "telegram_user_id" TEXT,
  "telegram_username" TEXT,
  "connected_at" TIMESTAMP(3),
  "last_sync_at" TIMESTAMP(3),
  "error_code" TEXT,
  "settings_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_telegram_integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_telegram_integrations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "branch_telegram_integrations_branch_id_key" ON "branch_telegram_integrations"("branch_id");
CREATE INDEX IF NOT EXISTS "branch_telegram_integrations_status_idx" ON "branch_telegram_integrations"("status");

CREATE TABLE IF NOT EXISTS "branch_audit_logs" (
  "id" TEXT NOT NULL,
  "business_group_id" TEXT,
  "branch_id" TEXT,
  "user_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "branch_audit_logs_business_group_id_created_at_idx" ON "branch_audit_logs"("business_group_id", "created_at");
CREATE INDEX IF NOT EXISTS "branch_audit_logs_branch_id_created_at_idx" ON "branch_audit_logs"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "branch_audit_logs_user_id_created_at_idx" ON "branch_audit_logs"("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "branch_stock_transfers" (
  "id" TEXT NOT NULL,
  "source_branch_id" TEXT NOT NULL,
  "destination_branch_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by_id" TEXT NOT NULL,
  "approved_by_id" TEXT,
  "shipped_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_stock_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_stock_transfers_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_stock_transfers_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_stock_transfers_different_branches_check" CHECK ("source_branch_id" <> "destination_branch_id")
);

CREATE INDEX IF NOT EXISTS "branch_stock_transfers_source_branch_id_status_idx" ON "branch_stock_transfers"("source_branch_id", "status");
CREATE INDEX IF NOT EXISTS "branch_stock_transfers_destination_branch_id_status_idx" ON "branch_stock_transfers"("destination_branch_id", "status");

CREATE TABLE IF NOT EXISTS "branch_stock_transfer_items" (
  "id" TEXT NOT NULL,
  "transfer_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "branch_stock_transfer_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "branch_stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "branch_stock_transfer_items_positive_quantity_check" CHECK ("quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "branch_stock_transfer_items_transfer_id_idx" ON "branch_stock_transfer_items"("transfer_id");

INSERT INTO "business_groups" ("id", "name", "slug", "status", "updated_at")
VALUES ('group-main', 'Там, где масло.', 'tam-gde-maslo', 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "branches" (
  "id", "business_group_id", "name", "short_name", "slug", "status", "timezone", "updated_at"
)
VALUES (
  'branch-main', 'group-main', 'Текущая точка', 'Текущая точка', 'tekushchaya-tochka', 'active', 'Europe/Kaliningrad', CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

DO $$
DECLARE
  source_org RECORD;
BEGIN
  IF to_regclass('public.local_organizations') IS NOT NULL THEN
    SELECT * INTO source_org
    FROM "local_organizations"
    WHERE "is_active" = true
    ORDER BY "is_default" DESC NULLS LAST, "created_at" ASC
    LIMIT 1;

    IF source_org.id IS NOT NULL THEN
      UPDATE "branches"
      SET
        "name" = COALESCE(NULLIF(source_org.name, ''), "name"),
        "short_name" = COALESCE(NULLIF(source_org.name, ''), "short_name"),
        "address" = COALESCE(source_org.actual_address, source_org.legal_address),
        "phone" = source_org.phone,
        "email" = source_org.email,
        "legal_entity_name" = source_org.full_legal_name,
        "legal_entity_type" = source_org.entity_type,
        "inn" = source_org.inn,
        "ogrn" = COALESCE(source_org.ogrn, source_org.ogrnip),
        "legacy_organization_id" = source_org.id,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = 'branch-main';
    END IF;
  END IF;
END $$;

INSERT INTO "users" ("id", "login", "name", "auth_role", "status", "updated_at") VALUES
  ('user-ilya', 'ilya', 'Илья', 'owner', 'active', CURRENT_TIMESTAMP),
  ('user-denis', 'denis', 'Денис', 'owner', 'active', CURRENT_TIMESTAMP),
  ('user-vadim', 'vadim', 'Вадим', 'admin', 'active', CURRENT_TIMESTAMP),
  ('user-maksim', 'maksim', 'Максим', 'master', 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("login") DO NOTHING;

INSERT INTO "business_group_memberships" ("id", "business_group_id", "user_id", "role", "status", "updated_at")
SELECT 'group-member-' || "login", 'group-main', "id", 'group_owner', 'active', CURRENT_TIMESTAMP
FROM "users"
WHERE "login" IN ('ilya', 'denis')
ON CONFLICT ("business_group_id", "user_id") DO NOTHING;

INSERT INTO "branch_memberships" ("id", "branch_id", "user_id", "role_id", "status", "is_default_branch", "updated_at")
SELECT
  'branch-member-' || "login",
  'branch-main',
  "id",
  CASE "auth_role" WHEN 'owner' THEN 'branch_owner' WHEN 'master' THEN 'master' ELSE 'administrator' END,
  'active',
  true,
  CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("branch_id", "user_id") DO NOTHING;

-- Backfill the new isolation key on every operational table migrated in this phase.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'shifts', 'shift_rates', 'piecework_rules', 'bonus_penalties',
    'payroll_adjustments', 'payroll_payments', 'change_logs', 'scheduled_working_days',
    'payroll_goals', 'payroll_achievement_definitions', 'payroll_achievement_awards',
    'employee_recognitions', 'payroll_team_goals', 'employee_motivation_settings',
    'payroll_periods', 'payroll_period_employees', 'payroll_accrual_lines',
    'vehicle_lookup_cache', 'vehicle_mann_mappings', 'crm_stages', 'crm_deals',
    'client_case_events', 'client_case_notification_log', 'diagnostics', 'diagnostic_positions',
    'diagnostic_photos', 'diagnostic_offers', 'diagnostic_map_sessions', 'diagnostic_map_items',
    'diagnostic_map_photos', 'diagnostic_map_vehicle_photos', 'diagnostic_map_recommendation_actions',
    'local_stores', 'local_products', 'local_stock_balances', 'local_counterparties',
    'cash_shifts', 'cash_withdrawals', 'cash_expense_items', 'cash_expense_orders',
    'local_demands', 'shipment_revisions', 'ai_agent_settings', 'ai_agent_sessions',
    'ai_service_quotes', 'ai_agent_technical_evidence', 'ai_agent_quality_feedback',
    'ai_agent_runs', 'ai_agent_run_events', 'ai_agent_tool_calls', 'ai_agent_decisions',
    'ai_agent_handoffs', 'ai_agent_slot_holds', 'ai_assistant_threads', 'ai_assistant_messages',
    'ai_assistant_runs', 'ai_assistant_tool_calls', 'ai_assistant_sources', 'ai_assistant_quotes',
    'ai_assistant_labor_pricing_rules', 'vehicle_service_complexity_rules',
    'messenger_connections', 'messenger_accounts', 'telegram_user_sessions',
    'messenger_conversations', 'messenger_messages', 'messenger_outbox',
    'messenger_webhook_events', 'messenger_templates', 'messenger_link_tokens',
    'messenger_channel_settings', 'integration_credentials', 'integration_onboarding_sessions',
    'messenger_attachments', 'messenger_media_jobs', 'messenger_delivery_events',
    'messenger_sync_cursors', 'communication_identities', 'conversation_entity_links',
    'integration_audit_logs',
    'product_mann_links', 'product_marking_audit_logs', 'local_product_photos',
    'inventory_ledger_entries', 'inventory_sessions', 'inventory_lines',
    'inventory_count_entries', 'inventory_attachments', 'inventory_movement_links',
    'inventory_assignments', 'inventory_locks', 'inventory_schedules', 'inventory_audit_logs',
    'local_inventory_documents', 'local_inventory_document_audit_logs',
    'local_inventory_document_positions', 'local_supplier_invoices',
    'local_supplier_invoice_payments', 'local_inventory_sync_state',
    'moysklad_demand_sync', 'moysklad_demand_position_sync', 'moysklad_analytics_sync_state',
    'customer_analytics_settings', 'vin_lookup_cache', 'webhook_subscriptions',
    'communication_consents', 'notification_templates', 'notification_rules',
    'notification_jobs', 'notification_logs', 'client_notification_preferences',
    'organization_members', 'product_mann_poman_migration_audit', 'product_import_jobs',
    'product_import_rows', 'closing_documents', 'closing_document_number_sequences',
    'local_demand_positions', 'demand_attribute_definitions', 'tbank_integrations',
    'tbank_settlement_accounts', 'supplier_invoice_tbank_payments', 'tbank_webhook_events'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS branch_id TEXT NOT NULL DEFAULT %L',
        table_name,
        'branch-main'
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (branch_id)',
        table_name || '_branch_id_idx',
        table_name
      );
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = table_name || '_branch_id_fkey'
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE',
          table_name,
          table_name || '_branch_id_fkey'
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Generalized branch integration credential metadata. Existing encrypted
-- messenger credentials remain encrypted and are assigned to Branch 1.
DO $$
BEGIN
  IF to_regclass('public.integration_credentials') IS NOT NULL THEN
    ALTER TABLE "integration_credentials"
      ADD COLUMN IF NOT EXISTS "business_group_id" TEXT NOT NULL DEFAULT 'group-main',
      ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS "last_validated_at" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "last_error_code" TEXT;
    CREATE INDEX IF NOT EXISTS "integration_credentials_business_group_status_idx"
      ON "integration_credentials"("business_group_id", "status");
    CREATE INDEX IF NOT EXISTS "integration_credentials_branch_channel_key_status_idx"
      ON "integration_credentials"("branch_id", "channel", "key", "status");
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'integration_credentials_business_group_id_fkey'
    ) THEN
      ALTER TABLE "integration_credentials"
        ADD CONSTRAINT "integration_credentials_business_group_id_fkey"
        FOREIGN KEY ("business_group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

-- Singleton/cache keys become branch-local instead of globally unique.
DO $$
DECLARE
  table_name TEXT;
  key_column TEXT;
BEGIN
  FOR table_name, key_column IN
    SELECT * FROM (VALUES
      ('moysklad_analytics_sync_state', 'id'),
      ('customer_analytics_settings', 'id'),
      ('vin_lookup_cache', 'vin'),
      ('local_inventory_sync_state', 'id')
    ) AS singleton_keys(table_name, key_column)
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
        table_name,
        table_name || '_pkey'
      );
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (branch_id, %I)',
        table_name,
        table_name || '_pkey',
        key_column
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.demand_attribute_definitions') IS NOT NULL THEN
    DROP INDEX IF EXISTS "demand_attribute_definitions_name_key";
    CREATE UNIQUE INDEX IF NOT EXISTS "demand_attribute_definitions_branch_id_name_key"
      ON "demand_attribute_definitions"("branch_id", "name");
  END IF;
END $$;

-- Legacy messenger rows used one global organization key. Normalize them to
-- Branch 1's legal-organization id, then derive branch_id on every future raw
-- SQL write (the messenger gateway intentionally uses raw SQL extensively).
CREATE OR REPLACE FUNCTION set_branch_from_organization_id()
RETURNS trigger AS $$
DECLARE
  resolved_branch_id TEXT;
  resolved_organization_id TEXT;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.organization_id = 'default' THEN
    SELECT b.id, COALESCE(b.legacy_organization_id, b.id)
    INTO resolved_branch_id, resolved_organization_id
    FROM branches b
    WHERE b.id = NEW.branch_id
    LIMIT 1;
  END IF;

  IF resolved_branch_id IS NOT NULL THEN
    NEW.organization_id := resolved_organization_id;
    NEW.branch_id := resolved_branch_id;
    RETURN NEW;
  END IF;

  SELECT b.id INTO resolved_branch_id
  FROM branches b
  WHERE b.legacy_organization_id = NEW.organization_id OR b.id = NEW.organization_id
  ORDER BY CASE WHEN b.legacy_organization_id = NEW.organization_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF resolved_branch_id IS NULL THEN
    RAISE EXCEPTION 'Unknown branch organization id: %', NEW.organization_id;
  END IF;
  NEW.branch_id := resolved_branch_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
  main_organization_id TEXT;
BEGIN
  SELECT legacy_organization_id INTO main_organization_id FROM branches WHERE id = 'branch-main';
  FOREACH table_name IN ARRAY ARRAY[
    'messenger_connections', 'messenger_accounts', 'telegram_user_sessions',
    'messenger_conversations', 'messenger_messages', 'messenger_outbox',
    'messenger_webhook_events', 'messenger_templates', 'messenger_link_tokens',
    'messenger_channel_settings', 'integration_credentials', 'integration_onboarding_sessions',
    'messenger_attachments', 'messenger_media_jobs', 'messenger_delivery_events',
    'messenger_sync_cursors', 'communication_identities', 'conversation_entity_links',
    'integration_audit_logs', 'webhook_subscriptions', 'communication_consents',
    'notification_templates', 'notification_rules', 'notification_jobs',
    'notification_logs', 'client_notification_preferences', 'organization_members',
    'tbank_integrations', 'tbank_settlement_accounts', 'supplier_invoice_tbank_payments',
    'tbank_webhook_events'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL AND main_organization_id IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET organization_id = %L, branch_id = %L', table_name, main_organization_id, 'branch-main');
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_branch_from_org_trigger', table_name);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organization_id ON %I FOR EACH ROW EXECUTE FUNCTION set_branch_from_organization_id()',
        table_name || '_branch_from_org_trigger',
        table_name
      );
    END IF;
  END LOOP;
END $$;

-- Replace global business keys with branch-aware equivalents.
DROP INDEX IF EXISTS "messenger_connections_channel_externalChatId_key";
DROP INDEX IF EXISTS "messenger_connections_channel_external_chat_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_connections_branch_channel_external_uidx"
  ON "messenger_connections"("branch_id", "channel", "external_chat_id");

DROP INDEX IF EXISTS "messenger_conversations_channel_externalConversationId_key";
DROP INDEX IF EXISTS "messenger_conversations_channel_external_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_conversations_branch_channel_external_uidx"
  ON "messenger_conversations"("branch_id", "channel", "external_conversation_id");

DROP INDEX IF EXISTS "messenger_messages_channel_externalMessageId_key";
DROP INDEX IF EXISTS "messenger_messages_channel_external_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_messages_branch_channel_external_uidx"
  ON "messenger_messages"("branch_id", "channel", "external_message_id")
  WHERE "external_message_id" IS NOT NULL;

DROP INDEX IF EXISTS "messenger_outbox_organizationId_idempotencyKey_key";
DROP INDEX IF EXISTS "messenger_outbox_organization_id_idempotency_key";
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_outbox_branch_org_idempotency_uidx"
  ON "messenger_outbox"("branch_id", "organization_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

DROP INDEX IF EXISTS "messenger_webhook_events_channel_externalUpdateId_key";
DROP INDEX IF EXISTS "messenger_webhook_events_channel_external_update_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_webhook_events_branch_channel_update_uidx"
  ON "messenger_webhook_events"("branch_id", "channel", "external_update_id");

DROP INDEX IF EXISTS "messenger_templates_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_templates_branch_key_uidx"
  ON "messenger_templates"("branch_id", "key");

DROP INDEX IF EXISTS "messenger_channel_settings_channel_key";
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_channel_settings_branch_channel_uidx"
  ON "messenger_channel_settings"("branch_id", "channel");

DROP INDEX IF EXISTS "shifts_userLogin_shiftDate_key";
DROP INDEX IF EXISTS "shifts_user_login_shift_date_key";
CREATE UNIQUE INDEX IF NOT EXISTS "shifts_branch_id_userLogin_shiftDate_key" ON "shifts"("branch_id", "userLogin", "shiftDate");

DROP INDEX IF EXISTS "piecework_rules_targetType_targetId_role_key";
DROP INDEX IF EXISTS "piecework_rules_target_type_target_id_role_key";
CREATE UNIQUE INDEX IF NOT EXISTS "piecework_rules_branch_id_target_type_target_id_role_key" ON "piecework_rules"("branch_id", "target_type", "target_id", "role");

DROP INDEX IF EXISTS "scheduled_working_days_userLogin_date_key";
DROP INDEX IF EXISTS "scheduled_working_days_user_login_date_key";
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_working_days_branch_id_user_login_date_key" ON "scheduled_working_days"("branch_id", "user_login", "date");

DROP INDEX IF EXISTS "crm_stages_sortOrder_key";
DROP INDEX IF EXISTS "crm_stages_sort_order_key";
CREATE UNIQUE INDEX IF NOT EXISTS "crm_stages_branch_id_sort_order_key" ON "crm_stages"("branch_id", "sort_order");

DROP INDEX IF EXISTS "crm_deals_case_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "crm_deals_branch_id_case_key_key" ON "crm_deals"("branch_id", "case_key");

CREATE UNIQUE INDEX IF NOT EXISTS "local_stock_balances_branch_id_product_id_store_id_key" ON "local_stock_balances"("branch_id", "product_id", "store_id");

DROP INDEX IF EXISTS "cash_shifts_service_date_key";
DROP INDEX IF EXISTS "cash_shifts_single_open_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "cash_shifts_branch_id_service_date_key" ON "cash_shifts"("branch_id", "service_date");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_shifts_branch_single_open_idx" ON "cash_shifts"("branch_id") WHERE "status" = 'open';

DROP INDEX IF EXISTS "cash_expense_items_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "cash_expense_items_branch_id_name_key" ON "cash_expense_items"("branch_id", "name");

DROP INDEX IF EXISTS "cash_expense_orders_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "cash_expense_orders_branch_id_number_key" ON "cash_expense_orders"("branch_id", "number");

-- Shipment names are display/document labels, not stable identities. The
-- canonical Selectel baseline contains legitimate repeated names belonging to
-- distinct MoySklad ids, so this must remain a lookup index rather than a
-- uniqueness constraint.
CREATE INDEX IF NOT EXISTS "local_demands_branch_id_name_idx" ON "local_demands"("branch_id", "name");
CREATE INDEX IF NOT EXISTS "local_products_branch_id_archived_idx" ON "local_products"("branch_id", "archived");
CREATE INDEX IF NOT EXISTS "local_products_branch_id_article_idx" ON "local_products"("branch_id", "article");
CREATE INDEX IF NOT EXISTS "local_counterparties_branch_id_normalized_phone_idx" ON "local_counterparties"("branch_id", "normalized_phone");
CREATE INDEX IF NOT EXISTS "local_demands_branch_id_document_date_idx" ON "local_demands"("branch_id", "document_date");

-- Guard against an application accidentally writing an unknown branch id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_last_active_branch_id_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_last_active_branch_id_fkey"
      FOREIGN KEY ("last_active_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
