-- Organization management: legal requisites, defaults, archive state and store context.

ALTER TABLE "local_organizations"
  ADD COLUMN IF NOT EXISTS "entity_type" TEXT NOT NULL DEFAULT 'legal_entity',
  ADD COLUMN IF NOT EXISTS "full_legal_name" TEXT,
  ADD COLUMN IF NOT EXISTS "inn" TEXT,
  ADD COLUMN IF NOT EXISTS "kpp" TEXT,
  ADD COLUMN IF NOT EXISTS "ogrn" TEXT,
  ADD COLUMN IF NOT EXISTS "ogrnip" TEXT,
  ADD COLUMN IF NOT EXISTS "legal_address" TEXT,
  ADD COLUMN IF NOT EXISTS "actual_address" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "website" TEXT,
  ADD COLUMN IF NOT EXISTS "tax_system" TEXT,
  ADD COLUMN IF NOT EXISTS "vat_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "default_vat_rate" INTEGER,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'RUB',
  ADD COLUMN IF NOT EXISTS "bank_name" TEXT,
  ADD COLUMN IF NOT EXISTS "bik" TEXT,
  ADD COLUMN IF NOT EXISTS "checking_account" TEXT,
  ADD COLUMN IF NOT EXISTS "correspondent_account" TEXT,
  ADD COLUMN IF NOT EXISTS "signatory_name" TEXT,
  ADD COLUMN IF NOT EXISTS "signatory_position" TEXT,
  ADD COLUMN IF NOT EXISTS "signatory_authority" TEXT,
  ADD COLUMN IF NOT EXISTS "shipment_prefix" TEXT,
  ADD COLUMN IF NOT EXISTS "work_order_prefix" TEXT,
  ADD COLUMN IF NOT EXISTS "act_prefix" TEXT,
  ADD COLUMN IF NOT EXISTS "upd_prefix" TEXT,
  ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

ALTER TABLE "local_stores"
  ADD COLUMN IF NOT EXISTS "organization_id" TEXT;

CREATE INDEX IF NOT EXISTS "local_organizations_inn_idx" ON "local_organizations"("inn");
CREATE INDEX IF NOT EXISTS "local_organizations_is_default_idx" ON "local_organizations"("is_default");
CREATE INDEX IF NOT EXISTS "local_stores_organization_id_idx" ON "local_stores"("organization_id");

CREATE TABLE IF NOT EXISTS "organization_members" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "permissions_json" JSONB,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_organization_id_user_id_key"
  ON "organization_members"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "organization_members_user_id_idx" ON "organization_members"("user_id");
CREATE INDEX IF NOT EXISTS "organization_members_is_default_idx" ON "organization_members"("is_default");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_organization_id_fkey'
  ) THEN
    ALTER TABLE "organization_members"
      ADD CONSTRAINT "organization_members_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_stores_organization_id_fkey'
  ) THEN
    ALTER TABLE "local_stores"
      ADD CONSTRAINT "local_stores_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "local_organizations_one_default_active_idx"
  ON "local_organizations"("is_default")
  WHERE "is_default" = true AND "is_active" = true;

UPDATE "local_organizations"
SET
  "name" = 'ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ',
  "entity_type" = 'ip',
  "full_legal_name" = CASE
    WHEN NULLIF("full_legal_name", '') IS NULL OR lower(trim("full_legal_name")) = lower('Эко Платформа')
      THEN 'Индивидуальный предприниматель Елисеенко Илья Сергеевич'
    ELSE "full_legal_name"
  END,
  "kpp" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE lower(trim("name")) = lower('Эко Платформа');

UPDATE "local_organizations"
SET "archived_at" = COALESCE("archived_at", CURRENT_TIMESTAMP)
WHERE "is_active" = false;

WITH single_active AS (
  SELECT "id"
  FROM "local_organizations"
  WHERE "is_active" = true
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
)
UPDATE "local_organizations"
SET "is_default" = true
WHERE
  "id" IN (SELECT "id" FROM single_active)
  AND NOT EXISTS (
    SELECT 1 FROM "local_organizations" WHERE "is_default" = true AND "is_active" = true
  );

WITH active_organizations AS (
  SELECT "id"
  FROM "local_organizations"
  WHERE "is_active" = true
),
single_active AS (
  SELECT "id"
  FROM active_organizations
  WHERE (SELECT count(*) FROM active_organizations) = 1
)
UPDATE "local_stores"
SET "organization_id" = (SELECT "id" FROM single_active)
WHERE "organization_id" IS NULL AND EXISTS (SELECT 1 FROM single_active);
