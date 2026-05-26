-- Runtime-local shipment creation: organizations, demand attributes and local stock costs.

CREATE TABLE IF NOT EXISTS "local_organizations" (
    "id" TEXT NOT NULL,
    "moysklad_id" TEXT,
    "moysklad_href" TEXT,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "local_organizations_moysklad_id_key" ON "local_organizations"("moysklad_id");
CREATE INDEX IF NOT EXISTS "local_organizations_name_idx" ON "local_organizations"("name");
CREATE INDEX IF NOT EXISTS "local_organizations_is_active_idx" ON "local_organizations"("is_active");

ALTER TABLE "local_stores"
  ADD COLUMN IF NOT EXISTS "is_main" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "local_products"
  ADD COLUMN IF NOT EXISTS "params" TEXT;

ALTER TABLE "local_stock_balances"
  ADD COLUMN IF NOT EXISTS "buy_price_cents" INTEGER;

ALTER TABLE "local_demands"
  ADD COLUMN IF NOT EXISTS "organization_id" TEXT;

CREATE INDEX IF NOT EXISTS "local_demands_organization_id_idx" ON "local_demands"("organization_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_demands_organization_id_fkey'
  ) THEN
    ALTER TABLE "local_demands"
      ADD CONSTRAINT "local_demands_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "local_demand_positions"
  ADD COLUMN IF NOT EXISTS "vat" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vat_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "demand_attribute_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'string',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_attribute_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "demand_attribute_definitions_name_key" ON "demand_attribute_definitions"("name");
CREATE INDEX IF NOT EXISTS "demand_attribute_definitions_order_idx" ON "demand_attribute_definitions"("order");

INSERT INTO "demand_attribute_definitions" ("id", "name", "type", "required", "order", "is_system", "created_at", "updated_at")
VALUES
  ('vin-number', 'vin номер', 'string', false, 10, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vehicle-model', 'модель авто', 'string', false, 20, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vehicle-year', 'год', 'string', false, 30, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('license-plate', 'гос. номер', 'string', false, 40, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mileage', 'пробег', 'string', false, 50, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('oil-volume', 'Объем', 'string', true, 60, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('motor-oil', 'Моторное масло', 'string', true, 70, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('eco-user', 'Эко пользователь', 'string', false, 1000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET
  "type" = EXCLUDED."type",
  "required" = EXCLUDED."required",
  "order" = EXCLUDED."order",
  "is_system" = EXCLUDED."is_system",
  "updated_at" = CURRENT_TIMESTAMP;
