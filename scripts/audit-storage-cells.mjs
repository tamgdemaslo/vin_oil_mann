import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/u, "$2");
}

function loadDatabaseUrl() {
  const explicit = process.env.STORAGE_CELL_AUDIT_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim();
  if (explicit) return unquote(explicit);

  for (const filename of [".env.local", ".env"]) {
    const file = path.join(root, filename);
    if (!fs.existsSync(file)) continue;
    const value = fs.readFileSync(file, "utf8").match(/^DATABASE_URL=(.+)$/mu)?.[1];
    if (value?.trim()) return unquote(value);
  }

  throw new Error(
    "DATABASE_URL не найден. Аудит только читает данные, но требует URL локально восстановленного актуального Timeweb backup или одобренный read-only URL.",
  );
}

function assertAllowedDatabase(urlText) {
  const url = new URL(urlText);
  const host = url.hostname.toLowerCase();
  const localRestore = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!localRestore) {
    throw new Error(
      "Аудит разрешён только на локально восстановленном актуальном backup Timeweb; прямое сетевое подключение к production запрещено.",
    );
  }
  return {
    host,
    database: url.pathname.replace(/^\//u, ""),
    localRestore,
  };
}

function asNumbers(value) {
  if (Array.isArray(value)) return value.map(asNumbers);
  if (!value || typeof value !== "object") return typeof value === "bigint" ? Number(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, asNumbers(nested)]));
}

function requiredTables(rows) {
  const names = new Set(rows.map((row) => row.tableName));
  return [
    "branches",
    "local_stores",
    "local_products",
    "local_stock_balances",
    "local_inventory_documents",
    "local_inventory_document_positions",
  ].filter((name) => !names.has(name));
}

const databaseUrl = loadDatabaseUrl();
const source = assertAllowedDatabase(databaseUrl);
process.env.DATABASE_URL = databaseUrl;

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

try {
  const report = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

    const tables = await tx.$queryRawUnsafe(`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
    `);
    const missingTables = requiredTables(tables);
    if (missingTables.length) {
      throw new Error(`В проверяемой БД отсутствуют обязательные таблицы: ${missingTables.join(", ")}`);
    }

    const schemaFacts = (await tx.$queryRawUnsafe(`
      SELECT
        to_regclass('storage_cells') IS NOT NULL AS "hasStorageCellsTable",
        to_regclass('product_storage_assignments') IS NOT NULL AS "hasProductStorageAssignmentsTable",
        to_regclass('product_cells') IS NOT NULL AS "hasProductCellsTable",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name IN ('storage_cells', 'product_cells', 'product_storage_assignments')
            AND column_name = 'is_primary'
        ) AS "hasCellIsPrimaryColumn",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'local_products'
            AND column_name = 'cell'
        ) AS "hasLegacyProductCellText",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'local_stock_balances'
            AND column_name = 'slot_name'
        ) AS "hasBalanceSlotText",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'local_inventory_document_positions'
            AND column_name = 'slot_name'
        ) AS "hasDocumentCellSnapshot"
    `))[0];

    const totals = (await tx.$queryRawUnsafe(`
      WITH active_store_counts AS (
        SELECT branch_id, COUNT(*)::int AS count
        FROM local_stores
        WHERE archived = FALSE
        GROUP BY branch_id
      ),
      product_cell_state AS (
        SELECT
          p.id,
          p.branch_id,
          NULLIF(BTRIM(p.cell), '') AS product_cell,
          COALESCE(sc.count, 0) AS active_store_count,
          EXISTS (
            SELECT 1
            FROM local_stock_balances b
            WHERE b.product_id = p.id
              AND b.branch_id = p.branch_id
              AND NULLIF(BTRIM(b.slot_name), '') IS NOT NULL
          ) AS has_balance_cell
        FROM local_products p
        LEFT JOIN active_store_counts sc ON sc.branch_id = p.branch_id
      ),
      balance_cell_state AS (
        SELECT
          b.branch_id,
          b.product_id,
          b.store_id,
          NULLIF(BTRIM(b.slot_name), '') AS balance_cell,
          NULLIF(BTRIM(p.cell), '') AS product_cell
        FROM local_stock_balances b
        JOIN local_products p
          ON p.id = b.product_id
         AND p.branch_id = b.branch_id
      )
      SELECT
        (SELECT COUNT(*)::int FROM local_products) AS "totalProducts",
        (SELECT COUNT(*)::int FROM local_stores) AS "totalStores",
        (SELECT COUNT(*)::int FROM local_stores WHERE archived = FALSE) AS "activeStores",
        (SELECT COUNT(*)::int FROM product_cell_state WHERE product_cell IS NOT NULL) AS "productsWithLegacyProductCell",
        (SELECT COUNT(*)::int FROM balance_cell_state WHERE balance_cell IS NOT NULL) AS "productStoreBalancesWithCell",
        (SELECT COUNT(DISTINCT p.id)::int
          FROM local_products p
          WHERE NULLIF(BTRIM(p.cell), '') IS NOT NULL
             OR EXISTS (
               SELECT 1 FROM local_stock_balances b
               WHERE b.product_id = p.id
                 AND b.branch_id = p.branch_id
                 AND NULLIF(BTRIM(b.slot_name), '') IS NOT NULL
             )) AS "productsWithAnyCellText",
        (SELECT COUNT(*)::int
          FROM balance_cell_state
          WHERE product_cell IS NOT NULL
            AND balance_cell IS NOT NULL
            AND UPPER(product_cell) = UPPER(balance_cell)) AS "matchingProductAndBalanceTexts",
        (SELECT COUNT(*)::int
          FROM balance_cell_state
          WHERE product_cell IS NOT NULL
            AND balance_cell IS NOT NULL
            AND UPPER(product_cell) <> UPPER(balance_cell)) AS "conflictingProductStoreTexts",
        (SELECT COUNT(*)::int
          FROM product_cell_state
          WHERE product_cell IS NOT NULL
            AND has_balance_cell = FALSE
            AND active_store_count = 1) AS "safeLegacyOnlySingleStoreCandidates",
        (SELECT COUNT(*)::int
          FROM product_cell_state
          WHERE product_cell IS NOT NULL
            AND has_balance_cell = FALSE
            AND active_store_count <> 1) AS "ambiguousLegacyOnlyCandidates",
        (SELECT COUNT(*)::int
          FROM (
            SELECT branch_id, product_id, store_id
            FROM local_stock_balances
            GROUP BY branch_id, product_id, store_id
            HAVING COUNT(*) > 1
          ) duplicate_assignments) AS "duplicateProductStoreBalanceRows",
        (SELECT COUNT(*)::int
          FROM (
            SELECT branch_id, product_id
            FROM local_stock_balances
            WHERE NULLIF(BTRIM(slot_name), '') IS NOT NULL
            GROUP BY branch_id, product_id
            HAVING COUNT(DISTINCT store_id) > 1
          ) multi_store) AS "productsPlacedInMultipleStores",
        (SELECT COUNT(*)::int
          FROM local_inventory_document_positions
          WHERE NULLIF(BTRIM(slot_name), '') IS NOT NULL) AS "historicalPositionSnapshots",
        (SELECT COUNT(*)::int
          FROM local_inventory_document_positions
          WHERE raw->>'makeDefaultCell' IN ('true', '1')) AS "positionsWithLegacyMakeDefaultFlag"
    `))[0];

    const perStore = await tx.$queryRawUnsafe(`
      WITH normalized_cells AS (
        SELECT
          branch_id,
          store_id,
          UPPER(BTRIM(slot_name)) AS normalized_code,
          MIN(BTRIM(slot_name)) AS display_code,
          COUNT(DISTINCT product_id)::int AS product_count,
          COUNT(DISTINCT BTRIM(slot_name))::int AS spelling_variants
        FROM local_stock_balances
        WHERE NULLIF(BTRIM(slot_name), '') IS NOT NULL
        GROUP BY branch_id, store_id, UPPER(BTRIM(slot_name))
      )
      SELECT
        store.branch_id AS "branchId",
        branch.name AS "branchName",
        store.id AS "storeId",
        store.name AS "storeName",
        store.archived,
        COUNT(cell.normalized_code)::int AS "inferredOccupiedCells",
        COALESCE(SUM(cell.product_count), 0)::int AS "assignedProductCards",
        COUNT(*) FILTER (WHERE cell.spelling_variants > 1)::int AS "caseOrWhitespaceCollisions"
      FROM local_stores store
      LEFT JOIN branches branch ON branch.id = store.branch_id
      LEFT JOIN normalized_cells cell
        ON cell.branch_id = store.branch_id
       AND cell.store_id = store.id
      GROUP BY store.branch_id, branch.name, store.id, store.name, store.archived
      ORDER BY branch.name NULLS LAST, store.name, store.id
    `);

    const perBranchLegacy = await tx.$queryRawUnsafe(`
      SELECT
        p.branch_id AS "branchId",
        branch.name AS "branchName",
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(p.cell), '') IS NOT NULL)::int AS "productsWithLegacyProductCell",
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(p.cell), '') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM local_stock_balances b
              WHERE b.branch_id = p.branch_id
                AND b.product_id = p.id
                AND NULLIF(BTRIM(b.slot_name), '') IS NOT NULL
            )
        )::int AS "legacyProductCellWithoutStorePlacement"
      FROM local_products p
      LEFT JOIN branches branch ON branch.id = p.branch_id
      GROUP BY p.branch_id, branch.name
      ORDER BY branch.name NULLS LAST, p.branch_id
    `);

    const normalizationCollisions = await tx.$queryRawUnsafe(`
      SELECT
        b.branch_id AS "branchId",
        b.store_id AS "storeId",
        UPPER(BTRIM(b.slot_name)) AS "normalizedCode",
        ARRAY_AGG(DISTINCT BTRIM(b.slot_name) ORDER BY BTRIM(b.slot_name)) AS variants,
        COUNT(DISTINCT b.product_id)::int AS "productCount"
      FROM local_stock_balances b
      WHERE NULLIF(BTRIM(b.slot_name), '') IS NOT NULL
      GROUP BY b.branch_id, b.store_id, UPPER(BTRIM(b.slot_name))
      HAVING COUNT(DISTINCT BTRIM(b.slot_name)) > 1
      ORDER BY b.branch_id, b.store_id, UPPER(BTRIM(b.slot_name))
    `);

    const history = (await tx.$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(position.slot_name), '') IS NOT NULL)::int AS "positionsWithSnapshot",
        COUNT(DISTINCT (
          position.branch_id,
          document.store_id,
          UPPER(BTRIM(position.slot_name))
        )) FILTER (WHERE NULLIF(BTRIM(position.slot_name), '') IS NOT NULL)::int AS "distinctHistoricalBranchStoreCodes",
        COUNT(*) FILTER (
          WHERE NULLIF(BTRIM(position.slot_name), '') IS NOT NULL
            AND document.store_id IS NULL
        )::int AS "snapshotsWithoutDocumentStore"
      FROM local_inventory_document_positions position
      JOIN local_inventory_documents document ON document.id = position.document_id
    `))[0];

    return {
      schemaFacts,
      totals,
      requestedLegacyRelationMetrics: {
        primaryRelationExists: false,
        secondaryRelationExists: false,
        productsWithSeveralPrimaryRelations: 0,
        secondaryRelations: 0,
        note: "В текущей схеме нет ProductCell/isPrimary. LocalProduct.cell и LocalStockBalance.slotName — независимые текстовые источники, поэтому A–E нельзя подменять фиктивной relation-классификацией.",
      },
      perStore,
      perBranchLegacy,
      normalizationCollisions,
      history,
      migrationAssessment: {
        required: true,
        manualReviewCount: Number(totals.conflictingProductStoreTexts || 0)
          + Number(totals.ambiguousLegacyOnlyCandidates || 0),
        safeBackfillRows: Number(totals.productStoreBalancesWithCell || 0)
          + Number(totals.safeLegacyOnlySingleStoreCandidates || 0),
        rule: "LocalStockBalance.slotName имеет приоритет только внутри той же пары branchId/storeId/productId. LocalProduct.cell переносится автоматически лишь при ровно одном активном складе и отсутствии store-scoped значения. Конфликты не разрешаются по createdAt или ID.",
      },
    };
  });

  process.stdout.write(`${JSON.stringify(asNumbers({
    readOnly: true,
    source: {
      host: source.host,
      database: source.database,
      localRestore: source.localRestore,
      currentTimewebSnapshotVerified: false,
      note: "Флаг подтверждается оператором только после сверки backup ID/timestamp/hash; сам скрипт этого не предполагает.",
    },
    generatedAt: new Date().toISOString(),
    ...report,
  }), null, 2)}\n`);
} catch (error) {
  const code = error && typeof error === "object"
    ? "code" in error && error.code
      ? String(error.code)
      : "errorCode" in error && error.errorCode
        ? String(error.errorCode)
        : "AUDIT_FAILED"
    : "AUDIT_FAILED";
  const message = code === "P1001"
    ? "локально восстановленная PostgreSQL недоступна; запустите restore актуального backup Timeweb и повторите аудит"
    : error instanceof Error
      ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[database-url-redacted]")
      : "неизвестная ошибка аудита";
  console.error(`Storage cell audit NO-GO (${code}): ${message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
