-- Additive storage-cell migration.
-- Approved after Timeweb logical backup 2026-09-02 09:16 was verified in the control panel.
-- Legacy text fields remain in place for rollback and historical snapshots.

BEGIN;

CREATE TABLE "storage_cells" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL DEFAULT 'branch-main',
    "store_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "normalized_code" TEXT NOT NULL,
    "name" TEXT,
    "zone" TEXT,
    "comment" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "archived_by_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "storage_cells_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_storage_assignments" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL DEFAULT 'branch-main',
    "product_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "cell_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" TEXT,
    CONSTRAINT "product_storage_assignments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "local_inventory_document_positions"
  ADD COLUMN "selected_cell_id" TEXT;

CREATE UNIQUE INDEX "storage_cells_branch_id_id_key"
  ON "storage_cells"("branch_id", "id");
CREATE UNIQUE INDEX "storage_cells_branch_id_store_id_id_key"
  ON "storage_cells"("branch_id", "store_id", "id");
CREATE UNIQUE INDEX "storage_cells_branch_id_store_id_normalized_code_key"
  ON "storage_cells"("branch_id", "store_id", "normalized_code");
CREATE INDEX "storage_cells_branch_id_store_id_archived_idx"
  ON "storage_cells"("branch_id", "store_id", "archived");
CREATE INDEX "storage_cells_branch_id_store_id_code_idx"
  ON "storage_cells"("branch_id", "store_id", "code");

CREATE UNIQUE INDEX "product_storage_assignments_branch_id_id_key"
  ON "product_storage_assignments"("branch_id", "id");
CREATE UNIQUE INDEX "product_storage_assignments_branch_id_product_id_store_id_key"
  ON "product_storage_assignments"("branch_id", "product_id", "store_id");
CREATE INDEX "product_storage_assignments_branch_id_store_id_cell_id_idx"
  ON "product_storage_assignments"("branch_id", "store_id", "cell_id");
CREATE INDEX "product_storage_assignments_branch_id_product_id_idx"
  ON "product_storage_assignments"("branch_id", "product_id");
CREATE INDEX "local_inventory_document_positions_branch_id_selected_cell_id_idx"
  ON "local_inventory_document_positions"("branch_id", "selected_cell_id");

ALTER TABLE "storage_cells"
  ADD CONSTRAINT "storage_cells_branch_id_store_id_fkey"
  FOREIGN KEY ("branch_id", "store_id")
  REFERENCES "local_stores"("branch_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_storage_assignments"
  ADD CONSTRAINT "product_storage_assignments_branch_id_product_id_fkey"
  FOREIGN KEY ("branch_id", "product_id")
  REFERENCES "local_products"("branch_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_storage_assignments"
  ADD CONSTRAINT "product_storage_assignments_branch_id_store_id_fkey"
  FOREIGN KEY ("branch_id", "store_id")
  REFERENCES "local_stores"("branch_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_storage_assignments"
  ADD CONSTRAINT "product_storage_assignments_branch_id_store_id_cell_id_fkey"
  FOREIGN KEY ("branch_id", "store_id", "cell_id")
  REFERENCES "storage_cells"("branch_id", "store_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Resolve a legacy LocalProduct.cell only when the target store is unambiguous:
-- either the product already has exactly one balance store, or its branch has
-- exactly one active store. Store-scoped legacy slotName remains the fallback.
CREATE TEMP TABLE "storage_cell_assignment_candidates" ON COMMIT DROP AS
WITH "balance_targets" AS (
  SELECT
    b."branch_id",
    b."product_id",
    b."store_id",
    BTRIM(b."slot_name") AS "code",
    UPPER(REGEXP_REPLACE(BTRIM(b."slot_name"), '\s+', ' ', 'g')) AS "normalized_code",
    2 AS "priority"
  FROM "local_stock_balances" b
  WHERE NULLIF(BTRIM(b."slot_name"), '') IS NOT NULL
),
"legacy_targets" AS (
  SELECT
    p."branch_id",
    p."id" AS "product_id",
    COALESCE(balance_store."store_id", active_store."store_id") AS "store_id",
    BTRIM(p."cell") AS "code",
    UPPER(REGEXP_REPLACE(BTRIM(p."cell"), '\s+', ' ', 'g')) AS "normalized_code",
    1 AS "priority"
  FROM "local_products" p
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN COUNT(DISTINCT b."store_id") = 1 THEN MIN(b."store_id") END AS "store_id"
    FROM "local_stock_balances" b
    WHERE b."branch_id" = p."branch_id"
      AND b."product_id" = p."id"
  ) balance_store ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN COUNT(*) = 1 THEN MIN(s."id") END AS "store_id"
    FROM "local_stores" s
    WHERE s."branch_id" = p."branch_id"
      AND s."archived" = FALSE
  ) active_store ON balance_store."store_id" IS NULL
  WHERE NULLIF(BTRIM(p."cell"), '') IS NOT NULL
    AND COALESCE(balance_store."store_id", active_store."store_id") IS NOT NULL
),
"ranked" AS (
  SELECT * FROM "legacy_targets"
  UNION ALL
  SELECT * FROM "balance_targets"
)
SELECT DISTINCT ON ("branch_id", "product_id", "store_id")
  "branch_id", "product_id", "store_id", "code", "normalized_code"
FROM "ranked"
ORDER BY "branch_id", "product_id", "store_id", "priority";

-- All currently referenced balance codes remain active directory entries,
-- even when an unambiguous legacy primary value wins the assignment.
INSERT INTO "storage_cells" (
  "id", "branch_id", "store_id", "code", "normalized_code", "created_by_id"
)
SELECT
  'cell_' || MD5(source."branch_id" || ':' || source."store_id" || ':' || source."normalized_code"),
  source."branch_id",
  source."store_id",
  MIN(source."code"),
  source."normalized_code",
  'migration:20260902100000'
FROM (
  SELECT
    b."branch_id",
    b."store_id",
    BTRIM(b."slot_name") AS "code",
    UPPER(REGEXP_REPLACE(BTRIM(b."slot_name"), '\s+', ' ', 'g')) AS "normalized_code"
  FROM "local_stock_balances" b
  WHERE NULLIF(BTRIM(b."slot_name"), '') IS NOT NULL
  UNION ALL
  SELECT
    candidate."branch_id",
    candidate."store_id",
    candidate."code",
    candidate."normalized_code"
  FROM "storage_cell_assignment_candidates" candidate
) source
GROUP BY source."branch_id", source."store_id", source."normalized_code"
ON CONFLICT ("branch_id", "store_id", "normalized_code") DO NOTHING;

-- Codes that exist only in historical documents are archived. They remain
-- addressable through selected_cell_id but cannot be assigned in new work.
INSERT INTO "storage_cells" (
  "id", "branch_id", "store_id", "code", "normalized_code",
  "archived", "archived_at", "created_by_id"
)
SELECT
  'cell_' || MD5(position."branch_id" || ':' || document."store_id" || ':' || UPPER(REGEXP_REPLACE(BTRIM(position."slot_name"), '\s+', ' ', 'g'))),
  position."branch_id",
  document."store_id",
  MIN(BTRIM(position."slot_name")),
  UPPER(REGEXP_REPLACE(BTRIM(position."slot_name"), '\s+', ' ', 'g')),
  TRUE,
  CURRENT_TIMESTAMP,
  'migration:20260902100000'
FROM "local_inventory_document_positions" position
JOIN "local_inventory_documents" document
  ON document."id" = position."document_id"
 AND document."branch_id" = position."branch_id"
WHERE document."store_id" IS NOT NULL
  AND NULLIF(BTRIM(position."slot_name"), '') IS NOT NULL
GROUP BY
  position."branch_id",
  document."store_id",
  UPPER(REGEXP_REPLACE(BTRIM(position."slot_name"), '\s+', ' ', 'g'))
ON CONFLICT ("branch_id", "store_id", "normalized_code") DO NOTHING;

INSERT INTO "product_storage_assignments" (
  "id", "branch_id", "product_id", "store_id", "cell_id", "assigned_by_id"
)
SELECT
  'psa_' || MD5(candidate."branch_id" || ':' || candidate."product_id" || ':' || candidate."store_id"),
  candidate."branch_id",
  candidate."product_id",
  candidate."store_id",
  cell."id",
  'migration:20260902100000'
FROM "storage_cell_assignment_candidates" candidate
JOIN "storage_cells" cell
  ON cell."branch_id" = candidate."branch_id"
 AND cell."store_id" = candidate."store_id"
 AND cell."normalized_code" = candidate."normalized_code"
ON CONFLICT ("branch_id", "product_id", "store_id") DO NOTHING;

-- Keep the legacy current-state fields synchronized during the transition.
-- The normalized assignment is authoritative; historical document snapshots
-- are intentionally left unchanged.
UPDATE "local_stock_balances" balance
SET "slot_name" = cell."code"
FROM "product_storage_assignments" assignment
JOIN "storage_cells" cell
  ON cell."branch_id" = assignment."branch_id"
 AND cell."store_id" = assignment."store_id"
 AND cell."id" = assignment."cell_id"
WHERE balance."branch_id" = assignment."branch_id"
  AND balance."product_id" = assignment."product_id"
  AND balance."store_id" = assignment."store_id"
  AND balance."slot_name" IS DISTINCT FROM cell."code";

UPDATE "local_products" product
SET "cell" = cell."code"
FROM "product_storage_assignments" assignment
JOIN "storage_cells" cell
  ON cell."branch_id" = assignment."branch_id"
 AND cell."store_id" = assignment."store_id"
 AND cell."id" = assignment."cell_id"
JOIN "local_stores" store
  ON store."branch_id" = assignment."branch_id"
 AND store."id" = assignment."store_id"
 AND store."is_main" = TRUE
WHERE product."branch_id" = assignment."branch_id"
  AND product."id" = assignment."product_id"
  AND product."cell" IS DISTINCT FROM cell."code";

UPDATE "local_inventory_document_positions" position
SET "selected_cell_id" = cell."id"
FROM "local_inventory_documents" document
JOIN "storage_cells" cell
  ON cell."branch_id" = document."branch_id"
 AND cell."store_id" = document."store_id"
WHERE document."id" = position."document_id"
  AND document."branch_id" = position."branch_id"
  AND position."selected_cell_id" IS NULL
  AND NULLIF(BTRIM(position."slot_name"), '') IS NOT NULL
  AND cell."normalized_code" = UPPER(REGEXP_REPLACE(BTRIM(position."slot_name"), '\s+', ' ', 'g'));

ALTER TABLE "local_inventory_document_positions"
  ADD CONSTRAINT "local_inventory_document_positions_branch_id_selected_cell_id_fkey"
  FOREIGN KEY ("branch_id", "selected_cell_id")
  REFERENCES "storage_cells"("branch_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
