-- T-Bank T-API safe draft payments for supplier invoices.

CREATE TABLE "tbank_integrations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "inn" TEXT,
  "kpp" TEXT,
  "token_encrypted" TEXT,
  "token_preview" TEXT,
  "debit_account_number_encrypted" TEXT,
  "debit_account_number_masked" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'draft_only',
  "direct_payments_enabled" BOOLEAN NOT NULL DEFAULT false,
  "max_single_payment_cents" INTEGER,
  "daily_payment_limit_cents" INTEGER,
  "allowed_supplier_inns_json" JSONB NOT NULL DEFAULT '[]',
  "webhook_url" TEXT,
  "webhook_secret_encrypted" TEXT,
  "sandbox" BOOLEAN NOT NULL DEFAULT false,
  "production_mode" BOOLEAN NOT NULL DEFAULT false,
  "api_base_url" TEXT,
  "certificate_configured" BOOLEAN NOT NULL DEFAULT false,
  "mtls_required" BOOLEAN NOT NULL DEFAULT false,
  "last_checked_at" TIMESTAMP(3),
  "last_check_status" TEXT,
  "last_check_message" TEXT,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tbank_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tbank_integrations_organization_id_key" ON "tbank_integrations"("organization_id");

CREATE TABLE "tbank_settlement_accounts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "integration_id" TEXT NOT NULL,
  "account_number_encrypted" TEXT,
  "account_number_masked" TEXT NOT NULL,
  "account_number_hash" TEXT,
  "account_name" TEXT,
  "bank_name" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "provider_account_id" TEXT,
  "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tbank_settlement_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tbank_settlement_accounts_integration_id_account_number_hash_key"
  ON "tbank_settlement_accounts"("integration_id", "account_number_hash");
CREATE INDEX "tbank_settlement_accounts_organization_id_idx" ON "tbank_settlement_accounts"("organization_id");
CREATE INDEX "tbank_settlement_accounts_integration_id_idx" ON "tbank_settlement_accounts"("integration_id");

ALTER TABLE "tbank_settlement_accounts"
  ADD CONSTRAINT "tbank_settlement_accounts_integration_id_fkey"
  FOREIGN KEY ("integration_id") REFERENCES "tbank_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "supplier_invoice_tbank_payments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "supplier_invoice_id" TEXT NOT NULL,
  "integration_id" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'tbank',
  "mode" TEXT NOT NULL DEFAULT 'draft',
  "tbank_payment_id" TEXT,
  "tbank_document_id" TEXT,
  "tbank_request_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL DEFAULT 1,
  "amount_cents" INTEGER NOT NULL,
  "from_account_number_masked" TEXT,
  "recipient_name" TEXT NOT NULL,
  "recipient_inn" TEXT NOT NULL,
  "recipient_kpp" TEXT,
  "recipient_account" TEXT NOT NULL,
  "recipient_bik" TEXT NOT NULL,
  "recipient_corr_account" TEXT,
  "recipient_bank_name" TEXT,
  "payment_purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft_created',
  "provider_status" TEXT,
  "provider_status_raw" JSONB,
  "created_by_id" TEXT NOT NULL,
  "created_by_name" TEXT,
  "confirmed_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "error_code" TEXT,
  "error_message" TEXT,
  "request_payload_encrypted" TEXT,
  "response_payload_encrypted" TEXT,
  "confirmation_url" TEXT,
  "raw" JSONB,

  CONSTRAINT "supplier_invoice_tbank_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_invoice_tbank_payments_idempotency_key_key"
  ON "supplier_invoice_tbank_payments"("idempotency_key");
CREATE INDEX "supplier_invoice_tbank_payments_organization_id_status_idx"
  ON "supplier_invoice_tbank_payments"("organization_id", "status");
CREATE INDEX "supplier_invoice_tbank_payments_supplier_invoice_id_idx"
  ON "supplier_invoice_tbank_payments"("supplier_invoice_id");
CREATE INDEX "supplier_invoice_tbank_payments_tbank_document_id_idx"
  ON "supplier_invoice_tbank_payments"("tbank_document_id");
CREATE INDEX "supplier_invoice_tbank_payments_tbank_payment_id_idx"
  ON "supplier_invoice_tbank_payments"("tbank_payment_id");

ALTER TABLE "supplier_invoice_tbank_payments"
  ADD CONSTRAINT "supplier_invoice_tbank_payments_supplier_invoice_id_fkey"
  FOREIGN KEY ("supplier_invoice_id") REFERENCES "local_supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_invoice_tbank_payments"
  ADD CONSTRAINT "supplier_invoice_tbank_payments_integration_id_fkey"
  FOREIGN KEY ("integration_id") REFERENCES "tbank_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tbank_webhook_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "event_id" TEXT,
  "supplier_invoice_tbank_payment_id" TEXT,
  "tbank_document_id" TEXT,
  "tbank_payment_id" TEXT,
  "provider_status" TEXT,
  "payload" JSONB NOT NULL,
  "received_headers" JSONB NOT NULL DEFAULT '{}',
  "source_ip" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tbank_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tbank_webhook_events_event_id_key" ON "tbank_webhook_events"("event_id");
CREATE INDEX "tbank_webhook_events_organization_id_created_at_idx" ON "tbank_webhook_events"("organization_id", "created_at");
CREATE INDEX "tbank_webhook_events_supplier_invoice_tbank_payment_id_idx" ON "tbank_webhook_events"("supplier_invoice_tbank_payment_id");
CREATE INDEX "tbank_webhook_events_tbank_document_id_idx" ON "tbank_webhook_events"("tbank_document_id");
CREATE INDEX "tbank_webhook_events_tbank_payment_id_idx" ON "tbank_webhook_events"("tbank_payment_id");

ALTER TABLE "tbank_webhook_events"
  ADD CONSTRAINT "tbank_webhook_events_supplier_invoice_tbank_payment_id_fkey"
  FOREIGN KEY ("supplier_invoice_tbank_payment_id") REFERENCES "supplier_invoice_tbank_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
