-- Local inventory mirror: first step toward running products, stock, counterparties and shipments from our DB.

CREATE TABLE "local_stores" (
    "id" TEXT NOT NULL,
    "moysklad_id" TEXT,
    "moysklad_href" TEXT,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_stores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_products" (
    "id" TEXT NOT NULL,
    "moysklad_id" TEXT,
    "moysklad_href" TEXT,
    "entity_type" TEXT NOT NULL DEFAULT 'product',
    "name" TEXT NOT NULL,
    "article" TEXT,
    "code" TEXT,
    "sale_price_cents" INTEGER NOT NULL DEFAULT 0,
    "buy_price_cents" INTEGER,
    "currency_name" TEXT,
    "image_href" TEXT,
    "attributes" JSONB,
    "search_text" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_stock_balances" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserve" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "available" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "slot_name" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_stock_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_counterparties" (
    "id" TEXT NOT NULL,
    "moysklad_id" TEXT,
    "moysklad_href" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "normalized_phone" TEXT,
    "phones_raw" JSONB,
    "company_type" TEXT,
    "legal_title" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_counterparties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_demands" (
    "id" TEXT NOT NULL,
    "moysklad_id" TEXT,
    "moysklad_href" TEXT,
    "name" TEXT NOT NULL,
    "moment_at" TIMESTAMP(3) NOT NULL,
    "document_date" TEXT NOT NULL,
    "applicable" BOOLEAN NOT NULL DEFAULT false,
    "sum_cents" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "counterparty_id" TEXT,
    "agent_moysklad_id" TEXT,
    "agent_name_snapshot" TEXT,
    "store_id" TEXT,
    "store_moysklad_id" TEXT,
    "store_name_snapshot" TEXT,
    "organization_name" TEXT,
    "attributes" JSONB,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_demands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_demand_positions" (
    "id" TEXT NOT NULL,
    "demand_id" TEXT NOT NULL,
    "moysklad_position_id" TEXT,
    "product_id" TEXT,
    "assortment_moysklad_id" TEXT,
    "assortment_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "price_cents_per_unit" INTEGER NOT NULL DEFAULT 0,
    "discount" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "buy_price_cents_per_unit" INTEGER,
    "slot_name" TEXT,
    "raw" JSONB,

    CONSTRAINT "local_demand_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "local_inventory_sync_state" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "products_synced" INTEGER NOT NULL DEFAULT 0,
    "services_synced" INTEGER NOT NULL DEFAULT 0,
    "counterparties_synced" INTEGER NOT NULL DEFAULT 0,
    "stores_synced" INTEGER NOT NULL DEFAULT 0,
    "stock_rows_synced" INTEGER NOT NULL DEFAULT 0,
    "demands_synced" INTEGER NOT NULL DEFAULT 0,
    "sync_running" BOOLEAN NOT NULL DEFAULT false,
    "sync_mode" TEXT,
    "sync_phase" TEXT,
    "sync_started_at" TIMESTAMP(3),
    "sync_finished_at" TIMESTAMP(3),
    "sync_message" TEXT,

    CONSTRAINT "local_inventory_sync_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "local_stores_moysklad_id_key" ON "local_stores"("moysklad_id");
CREATE INDEX "local_stores_name_idx" ON "local_stores"("name");

CREATE UNIQUE INDEX "local_products_moysklad_id_key" ON "local_products"("moysklad_id");
CREATE INDEX "local_products_entity_type_idx" ON "local_products"("entity_type");
CREATE INDEX "local_products_name_idx" ON "local_products"("name");
CREATE INDEX "local_products_article_idx" ON "local_products"("article");

CREATE UNIQUE INDEX "local_stock_balances_product_id_store_id_key" ON "local_stock_balances"("product_id", "store_id");
CREATE INDEX "local_stock_balances_product_id_idx" ON "local_stock_balances"("product_id");
CREATE INDEX "local_stock_balances_store_id_idx" ON "local_stock_balances"("store_id");

CREATE UNIQUE INDEX "local_counterparties_moysklad_id_key" ON "local_counterparties"("moysklad_id");
CREATE INDEX "local_counterparties_name_idx" ON "local_counterparties"("name");
CREATE INDEX "local_counterparties_normalized_phone_idx" ON "local_counterparties"("normalized_phone");

CREATE UNIQUE INDEX "local_demands_moysklad_id_key" ON "local_demands"("moysklad_id");
CREATE INDEX "local_demands_document_date_idx" ON "local_demands"("document_date");
CREATE INDEX "local_demands_moment_at_idx" ON "local_demands"("moment_at");
CREATE INDEX "local_demands_applicable_idx" ON "local_demands"("applicable");
CREATE INDEX "local_demands_counterparty_id_idx" ON "local_demands"("counterparty_id");
CREATE INDEX "local_demands_agent_moysklad_id_idx" ON "local_demands"("agent_moysklad_id");
CREATE INDEX "local_demands_store_id_idx" ON "local_demands"("store_id");

CREATE UNIQUE INDEX "local_demand_positions_moysklad_position_id_key" ON "local_demand_positions"("moysklad_position_id");
CREATE INDEX "local_demand_positions_demand_id_idx" ON "local_demand_positions"("demand_id");
CREATE INDEX "local_demand_positions_product_id_idx" ON "local_demand_positions"("product_id");
CREATE INDEX "local_demand_positions_assortment_type_assortment_moysklad_id_idx" ON "local_demand_positions"("assortment_type", "assortment_moysklad_id");

ALTER TABLE "local_stock_balances" ADD CONSTRAINT "local_stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_stock_balances" ADD CONSTRAINT "local_stock_balances_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "local_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_demands" ADD CONSTRAINT "local_demands_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "local_counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_demands" ADD CONSTRAINT "local_demands_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "local_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_demand_positions" ADD CONSTRAINT "local_demand_positions_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "local_demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_demand_positions" ADD CONSTRAINT "local_demand_positions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
