ALTER TABLE "crm_deals"
  ADD COLUMN "client_type" TEXT,
  ADD COLUMN "next_action" TEXT,
  ADD COLUMN "supplies_note" TEXT,
  ADD COLUMN "supplies_supplier" TEXT,
  ADD COLUMN "supplies_expected_at" TIMESTAMP(3),
  ADD COLUMN "close_reason" TEXT;

CREATE INDEX "crm_deals_client_type_idx" ON "crm_deals"("client_type");
CREATE INDEX "crm_deals_next_contact_at_idx" ON "crm_deals"("next_contact_at");
