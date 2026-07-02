ALTER TABLE "local_products"
  ADD COLUMN IF NOT EXISTS "marking_configured_manually" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "marking_configured_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "marking_configured_by_login" TEXT;

CREATE INDEX IF NOT EXISTS "local_products_marking_configured_manually_idx"
  ON "local_products"("marking_configured_manually");

CREATE TABLE IF NOT EXISTS "product_marking_migration_reports" (
  "migration_name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "packaged_marked_count" INTEGER NOT NULL DEFAULT 0,
  "bulk_ready_count" INTEGER NOT NULL DEFAULT 0,
  "bulk_requires_setup_count" INTEGER NOT NULL DEFAULT 0,
  "dangerous_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_manual_count" INTEGER NOT NULL DEFAULT 0,
  "details_json" JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT "product_marking_migration_reports_pkey" PRIMARY KEY ("migration_name")
);

UPDATE "local_products" product
SET
  "marking_configured_manually" = true,
  "marking_configured_at" = COALESCE(audit.first_configured_at, product."updated_at"),
  "marking_configured_by_login" = COALESCE(audit.first_configured_by_login, product."marking_configured_by_login")
FROM (
  SELECT DISTINCT ON ("product_id")
    "product_id",
    "created_at" AS first_configured_at,
    "performed_by_login" AS first_configured_by_login
  FROM "product_marking_audit_logs"
  ORDER BY "product_id", "created_at" ASC
) audit
WHERE product."id" = audit."product_id";

CREATE TEMP TABLE "_product_marking_backfill_classified" ON COMMIT DROP AS
SELECT
  product."id",
  product."name",
  product."group_path",
  product."uom_name",
  product."marking_enabled",
  product."marking_mode",
  product."marking_status",
  product."marking_settings_json",
  product."marking_configured_manually",
  lower(replace(concat_ws(' ', product."name", product."group_path", product."package_volume"), 'ё', 'е')) AS search_text,
  lower(replace(COALESCE(product."uom_name", ''), 'ё', 'е')) AS unit_text
FROM "local_products" product
WHERE product."archived" = false;

CREATE TEMP TABLE "_product_marking_backfill_packaged" ON COMMIT DROP AS
SELECT *
FROM "_product_marking_backfill_classified"
WHERE
  search_text ~ '(масл|моторн|трансмис|смаз|oil|atf|cvt|dct|dexron|gear)'
  AND search_text ~ '(канистр|упаков|бутыл|флакон|штуч|package|bottle)'
  AND search_text !~ '(бочк|розлив|разлив|налив|bulk)'
  AND "marking_configured_manually" = false
  AND "marking_enabled" = false
  AND "marking_mode" = 'NOT_MARKED';

CREATE TEMP TABLE "_product_marking_backfill_bulk" ON COMMIT DROP AS
SELECT
  *,
  COALESCE(NULLIF("marking_settings_json"->>'activeBarrelMarkingCode', ''), '') <> '' AS has_active_code,
  COALESCE(NULLIF("marking_settings_json"->>'declaredVolumeLiters', ''), '') ~ '^[0-9]+([.,][0-9]+)?$' AS has_declared_volume,
  COALESCE(NULLIF("marking_settings_json"->>'currentVolumeLiters', ''), '') ~ '^[0-9]+([.,][0-9]+)?$' AS has_current_volume
FROM "_product_marking_backfill_classified"
WHERE
  search_text ~ '(масл|моторн|трансмис|смаз|oil|atf|cvt|dct|dexron|gear)'
  AND search_text ~ '(бочк|розлив|разлив|налив|bulk)'
  AND "marking_configured_manually" = false;

CREATE TEMP TABLE "_product_marking_backfill_skipped_manual" ON COMMIT DROP AS
SELECT *
FROM "_product_marking_backfill_classified"
WHERE
  "marking_configured_manually" = true
  AND search_text ~ '(масл|моторн|трансмис|смаз|oil|atf|cvt|dct|dexron|gear)'
  AND (
    search_text ~ '(канистр|упаков|бутыл|флакон|штуч|package|bottle)'
    OR search_text ~ '(бочк|розлив|разлив|налив|bulk)'
  );

UPDATE "local_products" product
SET
  "marking_enabled" = true,
  "marking_mode" = 'PACKAGED_MARKED_GOOD',
  "marking_status" = 'PACKAGED_READY',
  "marking_settings_json" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
FROM "_product_marking_backfill_packaged" packaged
WHERE product."id" = packaged."id";

UPDATE "local_products" product
SET
  "marking_enabled" = true,
  "marking_mode" = CASE
    WHEN bulk.has_active_code THEN 'BULK_OIL_FROM_MARKED_BARREL'
    ELSE 'REQUIRES_CHECK'
  END,
  "marking_status" = CASE
    WHEN
      bulk.has_active_code
      AND bulk.unit_text IN ('л', 'л.', 'литр', 'литра', 'литров', 'l', 'liter', 'litre')
      AND bulk.has_declared_volume
      AND bulk.has_current_volume
    THEN 'BULK_OIL_READY'
    ELSE 'REQUIRES_CHECK'
  END,
  "marking_settings_json" =
    jsonb_build_object(
      'allowRepeatedBarrelCode', true,
      'partialWithdrawalEnabled', true,
      'allowSaleWithoutActiveBarrel', true,
      'declaredVolumeLiters', null,
      'nonDrainableRemainderPercent', null,
      'activeBarrelName', '',
      'activeBarrelMarkingCode', '',
      'activeBarrelGtin', '',
      'verificationStatus', 'Требует настройки',
      'currentVolumeLiters', null
    )
    || COALESCE(product."marking_settings_json", '{}'::jsonb)
    || jsonb_build_object(
      'allowRepeatedBarrelCode', true,
      'partialWithdrawalEnabled', true,
      'allowSaleWithoutActiveBarrel', NOT bulk.has_active_code,
      'verificationStatus', CASE WHEN bulk.has_active_code THEN 'Готово' ELSE 'Требует настройки' END
    ),
  "updated_at" = CURRENT_TIMESTAMP
FROM "_product_marking_backfill_bulk" bulk
WHERE product."id" = bulk."id";

CREATE TEMP TABLE "_product_marking_backfill_dangerous" ON COMMIT DROP AS
SELECT
  product."id",
  product."name",
  product."group_path",
  product."uom_name",
  product."marking_mode",
  product."marking_status"
FROM "local_products" product
WHERE
  product."archived" = false
  AND (
    (
      product."marking_enabled" = true
      AND product."marking_mode" = 'PACKAGED_MARKED_GOOD'
      AND (
        lower(replace(COALESCE(product."uom_name", ''), 'ё', 'е')) IN ('л', 'л.', 'литр', 'литра', 'литров', 'l', 'liter', 'litre')
        OR lower(replace(concat_ws(' ', product."name", product."group_path", product."package_volume"), 'ё', 'е')) ~ '(бочк|розлив|разлив|налив|bulk)'
      )
    )
    OR (
      product."marking_enabled" = true
      AND product."marking_mode" = 'BULK_OIL_FROM_MARKED_BARREL'
      AND lower(replace(COALESCE(product."uom_name", ''), 'ё', 'е')) NOT IN ('л', 'л.', 'литр', 'литра', 'литров', 'l', 'liter', 'litre')
    )
  );

INSERT INTO "product_marking_migration_reports" (
  "migration_name",
  "packaged_marked_count",
  "bulk_ready_count",
  "bulk_requires_setup_count",
  "dangerous_count",
  "skipped_manual_count",
  "details_json"
)
VALUES (
  '20260627120000_product_marking_safe_backfill',
  (SELECT COUNT(*) FROM "_product_marking_backfill_packaged"),
  (SELECT COUNT(*) FROM "_product_marking_backfill_bulk" WHERE has_active_code AND unit_text IN ('л', 'л.', 'литр', 'литра', 'литров', 'l', 'liter', 'litre') AND has_declared_volume AND has_current_volume),
  (SELECT COUNT(*) FROM "_product_marking_backfill_bulk" WHERE NOT (has_active_code AND unit_text IN ('л', 'л.', 'литр', 'литра', 'литров', 'l', 'liter', 'litre') AND has_declared_volume AND has_current_volume)),
  (SELECT COUNT(*) FROM "_product_marking_backfill_dangerous"),
  (SELECT COUNT(*) FROM "_product_marking_backfill_skipped_manual"),
  jsonb_build_object(
    'packagedMarked', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', "id", 'name', "name", 'groupPath', "group_path")) FROM "_product_marking_backfill_packaged"), '[]'::jsonb),
    'bulkRequiresSetup', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', "id", 'name', "name", 'groupPath', "group_path")) FROM "_product_marking_backfill_bulk" WHERE NOT has_active_code), '[]'::jsonb),
    'dangerous', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', "id", 'name', "name", 'groupPath', "group_path", 'uomName', "uom_name", 'markingMode', "marking_mode", 'markingStatus', "marking_status")) FROM "_product_marking_backfill_dangerous"), '[]'::jsonb),
    'skippedManual', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', "id", 'name', "name", 'groupPath', "group_path", 'markingMode', "marking_mode")) FROM "_product_marking_backfill_skipped_manual"), '[]'::jsonb)
  )
)
ON CONFLICT ("migration_name") DO UPDATE SET
  "created_at" = CURRENT_TIMESTAMP,
  "packaged_marked_count" = EXCLUDED."packaged_marked_count",
  "bulk_ready_count" = EXCLUDED."bulk_ready_count",
  "bulk_requires_setup_count" = EXCLUDED."bulk_requires_setup_count",
  "dangerous_count" = EXCLUDED."dangerous_count",
  "skipped_manual_count" = EXCLUDED."skipped_manual_count",
  "details_json" = EXCLUDED."details_json";
