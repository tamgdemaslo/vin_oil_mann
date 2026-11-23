-- CreateTable
CREATE TABLE "shipment_posting_requests" (
    "branch_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_posting_requests_pkey" PRIMARY KEY ("branch_id","shipment_id","request_key")
);

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "business_group_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cents_per_point" INTEGER NOT NULL DEFAULT 100,
    "product_rate" INTEGER NOT NULL DEFAULT 500,
    "service_rate" INTEGER NOT NULL DEFAULT 500,
    "spend_rate" INTEGER NOT NULL DEFAULT 3000,
    "compensation_limit" INTEGER NOT NULL DEFAULT 1000,
    "group_rates" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("business_group_id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "business_group_id" TEXT NOT NULL,
    "phone_key" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "debt" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_links" (
    "counterparty_id" TEXT NOT NULL,
    "business_group_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "account_id" TEXT,
    "review" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_links_pkey" PRIMARY KEY ("counterparty_id")
);

-- CreateTable
CREATE TABLE "loyalty_operations" (
    "id" TEXT NOT NULL,
    "business_group_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "account_id" TEXT,
    "counterparty_id" TEXT,
    "shipment_id" TEXT,
    "campaign_id" TEXT,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_key" TEXT,
    "request_digest" TEXT,
    "allocation" JSONB,

    CONSTRAINT "loyalty_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_lots" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "expiration_recorded" BOOLEAN NOT NULL DEFAULT false,
    "remaining" INTEGER NOT NULL,

    CONSTRAINT "loyalty_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_sales" (
    "id" TEXT NOT NULL,
    "business_group_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "account_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "document_date" TEXT NOT NULL,
    "before_cents" INTEGER NOT NULL,
    "cash_cents" INTEGER NOT NULL,
    "spent" INTEGER NOT NULL,
    "earned" INTEGER NOT NULL,
    "cents_per_point" INTEGER NOT NULL,
    "spend_operation_id" TEXT,
    "earn_operation_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "lines" JSONB NOT NULL,

    CONSTRAINT "loyalty_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_returns" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "document_date" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before_cents" INTEGER NOT NULL,
    "cash_cents" INTEGER NOT NULL,
    "restored" INTEGER NOT NULL,
    "earned_reversed" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,

    CONSTRAINT "loyalty_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_campaigns" (
    "id" TEXT NOT NULL,
    "business_group_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "filters" JSONB NOT NULL,
    "points" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3),
    "reason" TEXT NOT NULL,

    CONSTRAINT "loyalty_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_campaign_recipients" (
    "campaign_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "account_id" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "loyalty_campaign_recipients_pkey" PRIMARY KEY ("campaign_id","counterparty_id")
);

-- CreateIndex
CREATE INDEX "loyalty_accounts_business_group_id_phone_key_idx" ON "loyalty_accounts"("business_group_id", "phone_key");

-- CreateIndex
CREATE INDEX "loyalty_links_business_group_id_branch_id_review_idx" ON "loyalty_links"("business_group_id", "branch_id", "review");

-- CreateIndex
CREATE INDEX "loyalty_operations_account_id_branch_id_created_at_idx" ON "loyalty_operations"("account_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_operations_account_id_shipment_id_kind_idx" ON "loyalty_operations"("account_id", "shipment_id", "kind");

-- CreateIndex
CREATE INDEX "loyalty_operations_campaign_id_account_id_idx" ON "loyalty_operations"("campaign_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_operations_branch_id_request_key_key" ON "loyalty_operations"("branch_id", "request_key");

-- CreateIndex
CREATE INDEX "loyalty_lots_account_id_expires_at_created_at_idx" ON "loyalty_lots"("account_id", "expires_at", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_sales_branch_id_document_date_idx" ON "loyalty_sales"("branch_id", "document_date");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_sales_shipment_id_revision_key" ON "loyalty_sales"("shipment_id", "revision");

-- CreateIndex
CREATE INDEX "loyalty_returns_branch_id_document_date_idx" ON "loyalty_returns"("branch_id", "document_date");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_returns_sale_id_request_key_key" ON "loyalty_returns"("sale_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_returns_sale_id_receipt_key" ON "loyalty_returns"("sale_id", "receipt");

-- CreateIndex
CREATE INDEX "loyalty_campaigns_branch_id_created_at_idx" ON "loyalty_campaigns"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_campaign_recipients_campaign_id_status_idx" ON "loyalty_campaign_recipients"("campaign_id", "status");

-- AddForeignKey
ALTER TABLE "loyalty_links" ADD CONSTRAINT "loyalty_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_lots" ADD CONSTRAINT "loyalty_lots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_returns" ADD CONSTRAINT "loyalty_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "loyalty_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_campaign_recipients" ADD CONSTRAINT "loyalty_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "loyalty_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

