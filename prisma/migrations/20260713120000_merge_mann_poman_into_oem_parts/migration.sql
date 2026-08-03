-- Merge the deprecated manual MANN/POMAN field into OEM Parts and keep an audit trail.

CREATE TABLE IF NOT EXISTS "product_mann_poman_migration_audit" (
  "id" TEXT NOT NULL,
  "migration_key" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "old_mann_name" TEXT,
  "old_oem_parts" TEXT,
  "new_oem_parts" TEXT,
  "migrated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_mann_poman_migration_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_mann_poman_migration_audit_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_mann_poman_migration_audit_migration_key_product_id_key"
  ON "product_mann_poman_migration_audit"("migration_key", "product_id");

CREATE INDEX IF NOT EXISTS "product_mann_poman_migration_audit_product_id_idx"
  ON "product_mann_poman_migration_audit"("product_id");

CREATE OR REPLACE FUNCTION "_tgm_cross_ref_display"("value" TEXT, "compact_codes" BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  "result" TEXT;
BEGIN
  "result" := btrim(coalesce("value", ''));
  IF "result" = '' THEN
    RETURN '';
  END IF;

  "result" := replace(replace(replace("result", '–', '-'), '—', '-'), '−', '-');
  "result" := regexp_replace("result", '[[:space:]]+', ' ', 'g');

  IF "compact_codes" AND "result" ~ '[0-9]' THEN
    "result" := regexp_replace("result", '[[:space:]-]+', '', 'g');
  END IF;

  RETURN upper("result");
END;
$$;

CREATE OR REPLACE FUNCTION "_tgm_cross_ref_key"("value" TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower("_tgm_cross_ref_display"("value", true)), '[^0-9a-zа-яё]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION "_tgm_cross_ref_parts"(
  "value" TEXT,
  "split_spaces" BOOLEAN,
  "compact_codes" BOOLEAN
)
RETURNS TABLE("ord" INTEGER, "display" TEXT, "key" TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  "chunk" TEXT;
  "token" TEXT;
  "words" TEXT[];
  "word_count" INTEGER;
  "split_chunk" BOOLEAN;
  "rest_numeric" BOOLEAN;
  "next_ord" INTEGER := 0;
  "display_value" TEXT;
  "key_value" TEXT;
BEGIN
  FOR "chunk" IN
    SELECT btrim("item")
    FROM regexp_split_to_table(coalesce("value", ''), '[,;' || chr(10) || chr(13) || chr(9) || ']+') AS "item"
  LOOP
    IF "chunk" = '' THEN
      CONTINUE;
    END IF;

    "words" := regexp_split_to_array("chunk", '[[:space:]]+');
    SELECT count(*) INTO "word_count" FROM unnest("words") AS "word" WHERE btrim("word") <> '';
    "split_chunk" := false;

    IF "split_spaces" AND "word_count" > 1 THEN
      SELECT bool_and("word" ~ '^[0-9./-]+$')
      INTO "rest_numeric"
      FROM unnest("words"[2:array_length("words", 1)]) AS "word";

      IF NOT (("words"[1] ~ '^[A-Za-zА-Яа-яЁё]$') AND coalesce("rest_numeric", false)) THEN
        SELECT bool_and(length("_tgm_cross_ref_key"("word")) >= 3)
        INTO "split_chunk"
        FROM unnest("words") AS "word"
        WHERE btrim("word") <> '';
      END IF;
    END IF;

    IF "split_chunk" THEN
      FOR "token" IN SELECT btrim("word") FROM unnest("words") AS "word" WHERE btrim("word") <> ''
      LOOP
        "display_value" := "_tgm_cross_ref_display"("token", "compact_codes");
        "key_value" := "_tgm_cross_ref_key"("display_value");
        IF length("key_value") >= 2 THEN
          "ord" := "next_ord";
          "display" := "display_value";
          "key" := "key_value";
          "next_ord" := "next_ord" + 1;
          RETURN NEXT;
        END IF;
      END LOOP;
    ELSE
      "display_value" := "_tgm_cross_ref_display"("chunk", "compact_codes");
      "key_value" := "_tgm_cross_ref_key"("display_value");
      IF length("key_value") >= 2 THEN
        "ord" := "next_ord";
        "display" := "display_value";
        "key" := "key_value";
        "next_ord" := "next_ord" + 1;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END;
$$;

WITH "source" AS (
  SELECT
    "id",
    "mann_name" AS "old_mann_name",
    "oem_parts" AS "old_oem_parts"
  FROM "local_products"
  WHERE nullif(btrim(coalesce("mann_name", '')), '') IS NOT NULL
),
"merged" AS (
  SELECT
    "source"."id",
    string_agg("deduped"."display", '; ' ORDER BY "deduped"."first_ord") || ';' AS "new_oem_parts"
  FROM "source"
  CROSS JOIN LATERAL (
    SELECT
      "parts"."key",
      min("parts"."ord") AS "first_ord",
      (array_agg("parts"."display" ORDER BY "parts"."ord"))[1] AS "display"
    FROM (
      SELECT "ord", "display", "key"
      FROM "_tgm_cross_ref_parts"("source"."old_oem_parts", true, false)
      UNION ALL
      SELECT 10000 + "ord", "display", "key"
      FROM "_tgm_cross_ref_parts"("source"."old_mann_name", true, true)
    ) AS "parts"
    GROUP BY "parts"."key"
  ) AS "deduped"
  GROUP BY "source"."id"
),
"audit_insert" AS (
  INSERT INTO "product_mann_poman_migration_audit" (
    "id",
    "migration_key",
    "product_id",
    "old_mann_name",
    "old_oem_parts",
    "new_oem_parts",
    "migrated_at"
  )
  SELECT
    'mann-poman-oemparts-20260713-' || "source"."id",
    'mann-poman-oemparts-20260713',
    "source"."id",
    "source"."old_mann_name",
    "source"."old_oem_parts",
    "merged"."new_oem_parts",
    CURRENT_TIMESTAMP
  FROM "source"
  JOIN "merged" ON "merged"."id" = "source"."id"
  ON CONFLICT ("migration_key", "product_id") DO NOTHING
  RETURNING "product_id"
)
UPDATE "local_products" AS "product"
SET
  "oem_parts" = "merged"."new_oem_parts",
  "updated_at" = CASE
    WHEN coalesce("product"."oem_parts", '') IS DISTINCT FROM coalesce("merged"."new_oem_parts", '') THEN CURRENT_TIMESTAMP
    ELSE "product"."updated_at"
  END
FROM "merged"
WHERE "product"."id" = "merged"."id";

UPDATE "local_products"
SET "search_text" = lower(concat_ws(' ',
  "name",
  "brand",
  "group_path",
  "entity_type",
  "article",
  "code",
  "external_code",
  "barcode_ean13",
  "barcode_ean8",
  "barcode_code128",
  "oem",
  "oem_parts",
  "oem_atf",
  "rossko_part_number",
  "rossko_brand",
  "sae",
  "api_spec",
  "acea",
  "acea_extra",
  "ilsac",
  "atf",
  "package_volume",
  "uom_name",
  "description",
  "supplier_name",
  "tnved_code",
  "rossko_min",
  "supplier_attribute",
  "cell",
  "mann_characteristic_name",
  "currency_name"
));

DROP FUNCTION IF EXISTS "_tgm_cross_ref_parts"(TEXT, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS "_tgm_cross_ref_key"(TEXT);
DROP FUNCTION IF EXISTS "_tgm_cross_ref_display"(TEXT, BOOLEAN);
