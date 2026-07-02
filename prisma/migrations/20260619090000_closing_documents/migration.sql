CREATE TABLE "closing_documents" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "shipment_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'issued',
  "document_date" TEXT NOT NULL,
  "completion_date" TEXT NOT NULL,
  "seller_snapshot" JSONB NOT NULL,
  "buyer_snapshot" JSONB NOT NULL,
  "vehicle_snapshot" JSONB NOT NULL,
  "positions_snapshot" JSONB NOT NULL,
  "totals_snapshot" JSONB NOT NULL,
  "vat_snapshot" JSONB NOT NULL,
  "acceptance_text" TEXT NOT NULL,
  "customer_remarks" TEXT,
  "transfer_snapshot" JSONB,
  "performer_signatory_snapshot" JSONB,
  "customer_signatory_snapshot" JSONB,
  "source_hash" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMP(3),
  "cancelled_by_id" TEXT,
  "cancelled_by_name" TEXT,
  "cancel_reason" TEXT,

  CONSTRAINT "closing_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "closing_document_number_sequences" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "closing_document_number_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "closing_documents_organization_id_type_number_key"
  ON "closing_documents"("organization_id", "type", "number");

CREATE INDEX "closing_documents_shipment_id_idx"
  ON "closing_documents"("shipment_id");

CREATE INDEX "closing_documents_organization_id_type_document_date_idx"
  ON "closing_documents"("organization_id", "type", "document_date");

CREATE INDEX "closing_documents_status_idx"
  ON "closing_documents"("status");

CREATE UNIQUE INDEX "closing_document_number_sequences_organization_id_type_year_key"
  ON "closing_document_number_sequences"("organization_id", "type", "year");

ALTER TABLE "closing_documents"
  ADD CONSTRAINT "closing_documents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "closing_documents"
  ADD CONSTRAINT "closing_documents_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "local_demands"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
