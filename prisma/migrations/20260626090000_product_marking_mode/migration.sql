ALTER TABLE "local_products"
  ADD COLUMN IF NOT EXISTS "marking_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "marking_mode" TEXT NOT NULL DEFAULT 'NOT_MARKED',
  ADD COLUMN IF NOT EXISTS "marking_status" TEXT NOT NULL DEFAULT 'NOT_MARKED',
  ADD COLUMN IF NOT EXISTS "marking_settings_json" JSONB;

CREATE INDEX IF NOT EXISTS "local_products_marking_mode_idx" ON "local_products"("marking_mode");
CREATE INDEX IF NOT EXISTS "local_products_marking_status_idx" ON "local_products"("marking_status");

CREATE TABLE IF NOT EXISTS "product_marking_audit_logs" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "old_value" JSONB,
  "new_value" JSONB,
  "performed_by_login" TEXT,
  "performed_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_marking_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_marking_audit_logs_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_marking_audit_logs_product_id_created_at_idx"
  ON "product_marking_audit_logs"("product_id", "created_at");

UPDATE "local_products"
SET
  "marking_enabled" = true,
  "marking_mode" = 'REQUIRES_CHECK',
  "marking_status" = 'REQUIRES_CHECK',
  "marking_settings_json" = COALESCE(
    "marking_settings_json",
    jsonb_build_object(
      'allowRepeatedBarrelCode', false,
      'partialWithdrawalEnabled', false,
      'allowSaleWithoutActiveBarrel', true,
      'declaredVolumeLiters', null,
      'nonDrainableRemainderPercent', null,
      'activeBarrelName', '',
      'activeBarrelMarkingCode', '',
      'activeBarrelGtin', '',
      'verificationStatus', 'Требует проверки',
      'currentVolumeLiters', null
    )
  )
WHERE
  "marking_mode" = 'NOT_MARKED'
  AND (
    lower(COALESCE("name", '')) LIKE '%bardahl xts 5w-30%'
    OR lower(COALESCE("name", '')) LIKE '%bardahl xts 5w-40%'
    OR (
      lower(COALESCE("uom_name", '')) IN ('л', 'л.', 'литр', 'литра', 'литров', 'l', 'liter', 'litre')
      AND (
        lower(COALESCE("name", '')) LIKE '%розлив%'
        OR lower(COALESCE("name", '')) LIKE '%разлив%'
        OR lower(COALESCE("name", '')) LIKE '%бочк%'
        OR lower(COALESCE("name", '')) LIKE '%налив%'
        OR lower(COALESCE("name", '')) LIKE '%bulk%'
        OR lower(COALESCE("group_path", '')) LIKE '%розлив%'
        OR lower(COALESCE("group_path", '')) LIKE '%разлив%'
        OR lower(COALESCE("group_path", '')) LIKE '%бочк%'
        OR lower(COALESCE("group_path", '')) LIKE '%налив%'
        OR lower(COALESCE("group_path", '')) LIKE '%bulk%'
      )
    )
  );
