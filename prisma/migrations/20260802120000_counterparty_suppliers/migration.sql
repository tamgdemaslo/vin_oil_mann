-- Make suppliers first-class counterparties without losing existing free-form values.
ALTER TABLE "local_counterparties"
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN IF NOT EXISTS "display_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "legal_form" TEXT,
  ADD COLUMN IF NOT EXISTS "full_name" TEXT,
  ADD COLUMN IF NOT EXISTS "actual_address" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_person" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_details_json" JSONB,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- Existing records are clients unless explicitly created by this migration.
UPDATE "local_counterparties"
SET "category" = 'INDIVIDUAL'
WHERE "category" IS NULL OR btrim("category") = '';

UPDATE "local_counterparties"
SET "display_name" = "name"
WHERE btrim("display_name") = '';

UPDATE "local_counterparties"
SET "status" = CASE WHEN "archived" THEN 'ARCHIVED' ELSE 'ACTIVE' END
WHERE "status" IS NULL OR btrim("status") = '' OR "status" = 'ACTIVE';

ALTER TABLE "local_products"
  ADD COLUMN IF NOT EXISTS "supplier_counterparty_id" TEXT;

-- Only exact normalized legacy values within the same branch are consolidated.
-- Similar spellings are deliberately kept separate for a later human review.
WITH legacy_supplier_groups AS (
  SELECT
    p."branch_id",
    lower(regexp_replace(translate(btrim(p."supplier_name"), '«»“”„‟', '""""""'), '[[:space:]]+', ' ', 'g')) AS normalized_name,
    min(btrim(p."supplier_name")) AS display_name
  FROM "local_products" p
  WHERE p."supplier_name" IS NOT NULL AND btrim(p."supplier_name") <> ''
  GROUP BY p."branch_id", lower(regexp_replace(translate(btrim(p."supplier_name"), '«»“”„‟', '""""""'), '[[:space:]]+', ' ', 'g'))
)
INSERT INTO "local_counterparties" (
  "id", "branch_id", "name", "display_name", "category", "company_type", "counterparty_type_name", "legal_title", "search_text", "status", "synced_at", "created_at", "updated_at"
)
SELECT
  'legacy-supplier-' || md5(g."branch_id" || ':' || g.normalized_name),
  g."branch_id",
  g.display_name,
  g.display_name,
  'SUPPLIER',
  'supplier',
  'Поставщик',
  g.display_name,
  g.display_name || ' ' || g.normalized_name,
  'ACTIVE',
  now(), now(), now()
FROM legacy_supplier_groups g
ON CONFLICT ("id") DO NOTHING;

WITH product_suppliers AS (
  SELECT
    p."id" AS product_id,
    p."branch_id",
    lower(regexp_replace(translate(btrim(p."supplier_name"), '«»“”„‟', '""""""'), '[[:space:]]+', ' ', 'g')) AS normalized_name
  FROM "local_products" p
  WHERE p."supplier_name" IS NOT NULL AND btrim(p."supplier_name") <> ''
)
UPDATE "local_products" p
SET "supplier_counterparty_id" = c."id"
FROM product_suppliers s
JOIN "local_counterparties" c
  ON c."branch_id" = s."branch_id"
  AND c."category" = 'SUPPLIER'
  AND c."id" = 'legacy-supplier-' || md5(s."branch_id" || ':' || s.normalized_name)
WHERE p."id" = s.product_id;

CREATE INDEX IF NOT EXISTS "local_counterparties_branch_id_category_idx"
  ON "local_counterparties" ("branch_id", "category");
CREATE INDEX IF NOT EXISTS "local_counterparties_branch_id_name_idx"
  ON "local_counterparties" ("branch_id", "name");
CREATE INDEX IF NOT EXISTS "local_counterparties_branch_id_inn_idx"
  ON "local_counterparties" ("branch_id", "inn");
CREATE INDEX IF NOT EXISTS "local_products_branch_id_supplier_counterparty_id_idx"
  ON "local_products" ("branch_id", "supplier_counterparty_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_products_supplier_counterparty_branch_fkey'
  ) THEN
    ALTER TABLE "local_products"
      ADD CONSTRAINT "local_products_supplier_counterparty_branch_fkey"
      FOREIGN KEY ("branch_id", "supplier_counterparty_id")
      REFERENCES "local_counterparties" ("branch_id", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
