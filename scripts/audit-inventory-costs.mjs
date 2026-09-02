#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const filename of [".env.local", ".env"]) {
    const file = path.join(root, filename);
    if (!fs.existsSync(file)) continue;
    const value = fs.readFileSync(file, "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
    if (value) return value;
  }
  throw new Error("DATABASE_URL не найден");
}

if (process.argv.includes("--apply")) {
  throw new Error("Этот инструмент только read-only. Apply/backfill требует отдельного согласования и отдельного скрипта.");
}

process.env.DATABASE_URL ??= databaseUrl();
const prisma = new PrismaClient();

try {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const rows = await tx.$queryRawUnsafe(`
      WITH balance AS (
        SELECT branch_id,
               count(*) FILTER (WHERE quantity > 0) AS positive_balances,
               count(*) FILTER (WHERE quantity > 0 AND buy_price_cents IS NULL) AS positive_missing_cost,
               count(*) FILTER (WHERE quantity > 0 AND buy_price_cents = 0) AS positive_zero_cost,
               sum(round(quantity * buy_price_cents)) FILTER (WHERE quantity > 0 AND buy_price_cents > 0) AS known_stock_value_cents
        FROM local_stock_balances GROUP BY branch_id
      ), sale AS (
        SELECT d.branch_id,
               count(*) FILTER (WHERE lower(p.assortment_type) <> 'service') AS product_lines,
               count(*) FILTER (
                 WHERE lower(p.assortment_type) <> 'service'
                   AND (
                     p.buy_price_cents_per_unit IS NULL
                     OR (lower(p.assortment_type) = 'nonstock_product' AND p.buy_price_cents_per_unit < 0)
                     OR (lower(p.assortment_type) <> 'nonstock_product' AND p.buy_price_cents_per_unit <= 0)
                   )
               ) AS product_missing_cost,
               count(*) FILTER (WHERE lower(p.assortment_type) = 'service' AND COALESCE(p.buy_price_cents_per_unit, 0) <> 0) AS services_with_nonzero_cost
        FROM local_demands d
        JOIN local_demand_positions p ON p.demand_id = d.id AND p.branch_id = d.branch_id
        WHERE d.applicable = true GROUP BY d.branch_id
      ), ledger AS (
        SELECT branch_id,
               count(*) AS entries,
               count(*) FILTER (WHERE product_id IS NOT NULL AND unit_cost_snapshot IS NULL) AS missing_unit_cost,
               count(*) FILTER (WHERE product_id IS NOT NULL AND total_cost_snapshot IS NULL) AS missing_total_cost,
               count(*) FILTER (WHERE movement_type = 'RECEIPT_POST') AS receipt_entries,
               count(*) FILTER (WHERE movement_type = 'WRITEOFF_POST') AS writeoff_entries
        FROM inventory_ledger_entries GROUP BY branch_id
      )
      SELECT b.id AS branch_id,
             COALESCE(balance.positive_balances, 0)::int AS positive_balances,
             COALESCE(balance.positive_missing_cost, 0)::int AS positive_missing_cost,
             COALESCE(balance.positive_zero_cost, 0)::int AS positive_zero_cost,
             COALESCE(balance.known_stock_value_cents, 0)::bigint AS known_stock_value_cents,
             COALESCE(sale.product_lines, 0)::int AS posted_product_lines,
             COALESCE(sale.product_missing_cost, 0)::int AS posted_product_missing_cost,
             COALESCE(sale.services_with_nonzero_cost, 0)::int AS services_with_nonzero_cost,
             COALESCE(ledger.entries, 0)::int AS ledger_entries,
             COALESCE(ledger.missing_unit_cost, 0)::int AS ledger_missing_unit_cost,
             COALESCE(ledger.missing_total_cost, 0)::int AS ledger_missing_total_cost,
             COALESCE(ledger.receipt_entries, 0)::int AS receipt_ledger_entries,
             COALESCE(ledger.writeoff_entries, 0)::int AS writeoff_ledger_entries
      FROM branches b
      LEFT JOIN balance ON balance.branch_id = b.id
      LEFT JOIN sale ON sale.branch_id = b.id
      LEFT JOIN ledger ON ledger.branch_id = b.id
      ORDER BY b.created_at, b.id
    `);
    return rows;
  });
  process.stdout.write(`${JSON.stringify({ mode: "read-only", calculatedAt: new Date().toISOString(), branches: result }, (_, value) => typeof value === "bigint" ? Number(value) : value, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
