import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDatabaseUrl() {
  for (const filename of [".env.local", ".env"]) {
    const file = path.join(root, filename);
    if (!fs.existsSync(file)) continue;
    const value = fs.readFileSync(file, "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
    if (value) return value.replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL не найден. Проверка ничего не меняет, но требует доступ к проверяемой БД.");
}

process.env.DATABASE_URL ??= loadDatabaseUrl();
const prisma = new PrismaClient();

const scalar = async (sql) => (await prisma.$queryRawUnsafe(sql))[0] ?? {};

try {
  const [branches, documents, invoices, integrity] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT id, name, short_name AS "shortName", status
      FROM branches
      ORDER BY name
    `),
    prisma.$queryRawUnsafe(`
      SELECT branch_id AS "branchId", type, COUNT(*)::int AS count
      FROM local_inventory_documents
      GROUP BY branch_id, type
      ORDER BY branch_id, type
    `),
    prisma.$queryRawUnsafe(`
      SELECT branch_id AS "branchId", COUNT(*)::int AS count
      FROM local_supplier_invoices
      GROUP BY branch_id
      ORDER BY branch_id
    `),
    scalar(`
      SELECT
        (SELECT COUNT(*)::int FROM local_inventory_documents WHERE branch_id IS NULL) AS "documentsWithoutBranch",
        (SELECT COUNT(*)::int FROM local_inventory_document_positions WHERE branch_id IS NULL) AS "positionsWithoutBranch",
        (SELECT COUNT(*)::int FROM local_supplier_invoices WHERE branch_id IS NULL) AS "invoicesWithoutBranch",
        (SELECT COUNT(*)::int FROM local_supplier_invoice_payments WHERE branch_id IS NULL) AS "paymentsWithoutBranch",
        (SELECT COUNT(*)::int
          FROM local_inventory_document_positions p
          JOIN local_inventory_documents d ON d.id = p.document_id
          WHERE p.branch_id <> d.branch_id) AS "positionsWrongDocumentBranch",
        (SELECT COUNT(*)::int
          FROM local_inventory_document_positions p
          JOIN local_products product ON product.id = p.product_id
          WHERE p.product_id IS NOT NULL AND p.branch_id <> product.branch_id) AS "positionsWrongProductBranch",
        (SELECT COUNT(*)::int
          FROM local_supplier_invoices i
          JOIN local_inventory_documents d ON d.id = i.document_id
          WHERE i.branch_id <> d.branch_id) AS "invoicesWrongDocumentBranch",
        (SELECT COUNT(*)::int
          FROM local_supplier_invoice_payments p
          JOIN local_supplier_invoices i ON i.id = p.invoice_id
          WHERE p.branch_id <> i.branch_id) AS "paymentsWrongInvoiceBranch",
        (SELECT COUNT(*)::int
          FROM local_stock_balances s
          JOIN local_products p ON p.id = s.product_id
          WHERE s.branch_id <> p.branch_id) AS "balancesWrongProductBranch",
        (SELECT COUNT(*)::int
          FROM local_stock_balances s
          JOIN local_stores w ON w.id = s.store_id
          WHERE s.branch_id <> w.branch_id) AS "balancesWrongStoreBranch"
    `),
  ]);

  const dacha = branches.filter((branch) => branch.name === "Дачная 6В" || branch.shortName === "Дачная 6В");
  const gagarina = branches.filter((branch) => branch.name === "Гагарина 116" || branch.shortName === "Гагарина 116");
  const nullRows = Object.entries(integrity)
    .filter(([key, value]) => key.endsWith("WithoutBranch") && Number(value) > 0)
    .map(([key, value]) => ({ key, count: Number(value) }));

  process.stdout.write(`${JSON.stringify({
    readOnly: true,
    branches,
    expectedBranches: { dacha, gagarina },
    documents,
    invoices,
    integrity,
    safeBackfillCandidates: nullRows.length
      ? {
          target: dacha.length === 1 ? dacha[0].id : null,
          rows: nullRows,
          action: dacha.length === 1
            ? "Не применять автоматически: сначала подтвердить, что все строки без branch_id относятся к Дачной 6В."
            : "Целевой филиал не определён однозначно; backfill запрещён.",
        }
      : { target: null, rows: [], action: "Backfill не требуется: строк без branch_id нет." },
  }, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
