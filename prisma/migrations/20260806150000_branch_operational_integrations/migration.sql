-- Forward-only cutover for AQSI, working Telegram user session and ROSSKO.
-- Apply only after a verified Timeweb PostgreSQL backup and explicit owner approval.

DO $$
BEGIN
  IF current_setting('app.branch_integration_db_cutover', true)
       IS DISTINCT FROM 'approved-with-verified-timeweb-backup' THEN
    RAISE EXCEPTION 'migration_approval_required';
  END IF;
END $$;

CREATE TABLE "branch_integration_migrations" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'server_env',
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "last_error_code" TEXT,
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  "migrated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_integration_migrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_integration_migrations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "branch_integration_migrations_branch_id_provider_key"
  ON "branch_integration_migrations"("branch_id", "provider");
CREATE INDEX "branch_integration_migrations_branch_id_status_idx"
  ON "branch_integration_migrations"("branch_id", "status");

CREATE TABLE "aqsi_cash_registers" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "business_group_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "credentials_encrypted" JSONB NOT NULL,
  "settings_json" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'not_tested',
  "last_success_at" TIMESTAMPTZ(6),
  "last_error_at" TIMESTAMPTZ(6),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aqsi_cash_registers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aqsi_cash_registers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "aqsi_cash_registers_branch_id_id_key" ON "aqsi_cash_registers"("branch_id", "id");
CREATE UNIQUE INDEX "aqsi_cash_registers_branch_id_name_key" ON "aqsi_cash_registers"("branch_id", "name");
CREATE UNIQUE INDEX "aqsi_cash_registers_one_default_per_branch_idx"
  ON "aqsi_cash_registers"("branch_id") WHERE "is_default" = true AND "enabled" = true;
CREATE INDEX "aqsi_cash_registers_branch_id_enabled_is_default_idx" ON "aqsi_cash_registers"("branch_id", "enabled", "is_default");
CREATE INDEX "aqsi_cash_registers_organization_id_status_idx" ON "aqsi_cash_registers"("organization_id", "status");

ALTER TABLE "cash_shifts" ADD COLUMN "aqsi_register_id" TEXT;
CREATE INDEX "cash_shifts_branch_id_aqsi_register_id_status_idx" ON "cash_shifts"("branch_id", "aqsi_register_id", "status");
ALTER TABLE "cash_shifts"
  ADD CONSTRAINT "cash_shifts_branch_id_aqsi_register_id_fkey"
  FOREIGN KEY ("branch_id", "aqsi_register_id") REFERENCES "aqsi_cash_registers"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "aqsi_fiscalization_records" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "register_id" TEXT NOT NULL,
  "document_type" TEXT NOT NULL DEFAULT 'local_demand',
  "document_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6),
  "last_attempt_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "external_order_id" TEXT,
  "external_uid" TEXT,
  "external_receipt_number" TEXT,
  "safe_response_json" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aqsi_fiscalization_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aqsi_fiscalization_records_register_fkey" FOREIGN KEY ("branch_id", "register_id") REFERENCES "aqsi_cash_registers"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "aqsi_fiscalization_records_branch_id_idempotency_key_key"
  ON "aqsi_fiscalization_records"("branch_id", "idempotency_key");
CREATE INDEX "aqsi_fiscalization_records_branch_id_status_next_attempt_at_idx"
  ON "aqsi_fiscalization_records"("branch_id", "status", "next_attempt_at");
CREATE INDEX "aqsi_fiscalization_records_branch_id_document_type_document_id_idx"
  ON "aqsi_fiscalization_records"("branch_id", "document_type", "document_id");
CREATE INDEX "aqsi_fiscalization_records_register_id_status_idx"
  ON "aqsi_fiscalization_records"("register_id", "status");

-- Only one connected or pending working Telegram account may exist per branch.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "messenger_accounts"
    WHERE "channel" = 'telegram'
      AND "mode" = 'user_session'
      AND "status" IN ('waiting_code', 'waiting_qr', 'waiting_password', 'connected', 'needs_auth')
    GROUP BY "branch_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'telegram_user_branch_invariant_violation';
  END IF;
END $$;

CREATE UNIQUE INDEX "messenger_accounts_one_working_telegram_per_branch_idx"
  ON "messenger_accounts"("branch_id")
  WHERE "channel" = 'telegram'
    AND "mode" = 'user_session'
    AND "status" IN ('waiting_code', 'waiting_qr', 'waiting_password', 'connected', 'needs_auth');
