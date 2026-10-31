CREATE TABLE "shared_product_kits" (
  "id" TEXT NOT NULL,
  "business_group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "targets" JSONB NOT NULL DEFAULT '{}',
  "legacy_ids" JSONB NOT NULL DEFAULT '[]',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shared_product_kits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shared_product_kits_group_fkey" FOREIGN KEY ("business_group_id") REFERENCES "business_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shared_product_kits_name_check" CHECK (length(trim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "shared_product_kits_items_check" CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") BETWEEN 1 AND 100),
  CONSTRAINT "shared_product_kits_targets_check" CHECK (jsonb_typeof("targets") = 'object'),
  CONSTRAINT "shared_product_kits_legacy_ids_check" CHECK (jsonb_typeof("legacy_ids") = 'array'),
  CONSTRAINT "shared_product_kits_version_check" CHECK ("version" > 0)
);
CREATE INDEX "shared_product_kits_business_group_id_archived_name_idx" ON "shared_product_kits"("business_group_id", "archived", "name");
-- Deliberately no destructive rewrite of legacy kits, products or balances.
-- Backfill is a separately reviewed, fingerprinted maintenance operation.
