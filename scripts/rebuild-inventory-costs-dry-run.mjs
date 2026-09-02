#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EPSILON = 0.0001;

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
  throw new Error("Apply отключён: исторический backfill требует отдельного согласования, свежего backup и audit trail.");
}

function key(branchId, storeId, productId) {
  return `${branchId}\u0000${storeId}\u0000${productId}`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

process.env.DATABASE_URL ??= databaseUrl();
const prisma = new PrismaClient();

try {
  const report = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const postedHistory = await tx.$queryRawUnsafe(`
      SELECT d.branch_id AS "branchId",
             count(*) FILTER (WHERE lower(p.assortment_type) <> 'service')::int AS "productLines",
             count(*) FILTER (
               WHERE lower(p.assortment_type) <> 'service'
                 AND p.buy_price_cents_per_unit IS NOT NULL
                 AND (
                   (lower(p.assortment_type) = 'nonstock_product' AND p.buy_price_cents_per_unit >= 0)
                   OR (lower(p.assortment_type) <> 'nonstock_product' AND p.buy_price_cents_per_unit > 0)
                 )
             )::int AS "confirmedSnapshots",
             count(*) FILTER (
               WHERE lower(p.assortment_type) <> 'service'
                 AND (
                   p.buy_price_cents_per_unit IS NULL
                   OR (lower(p.assortment_type) = 'nonstock_product' AND p.buy_price_cents_per_unit < 0)
                   OR (lower(p.assortment_type) <> 'nonstock_product' AND p.buy_price_cents_per_unit <= 0)
                 )
             )::int AS "missingSnapshots",
             count(*) FILTER (WHERE lower(p.assortment_type) = 'service')::int AS "serviceLines"
      FROM local_demands d
      JOIN local_demand_positions p ON p.demand_id = d.id AND p.branch_id = d.branch_id
      WHERE d.applicable = true
      GROUP BY d.branch_id
      ORDER BY d.branch_id
    `);
    const confirmedSnapshotCount = postedHistory.reduce((sum, row) => sum + Number(row.confirmedSnapshots ?? 0), 0);
    const candidates = await tx.localStockBalance.findMany({
      where: { quantity: { gt: 0 }, OR: [{ buyPriceCents: null }, { buyPriceCents: { lte: 0 } }] },
      include: { product: { select: { name: true } }, store: { select: { name: true } } },
      orderBy: [{ branchId: "asc" }, { storeId: "asc" }, { productId: "asc" }],
    });
    const candidateKeys = new Set(candidates.map((row) => key(row.branchId, row.storeId, row.productId)));
    const events = new Map([...candidateKeys].map((eventKey) => [eventKey, []]));
    const productIds = [...new Set(candidates.map((row) => row.productId))];
    if (productIds.length === 0) return {
      postedHistory,
      candidates: [],
      summary: {
        total: 0,
        classifications: {
          CONFIRMED_SNAPSHOT: confirmedSnapshotCount,
          RECONSTRUCTABLE: 0,
          OPENING_COST_REQUIRED: 0,
          AMBIGUOUS_HISTORY: 0,
          MISSING_COST: 0,
        },
      },
    };

    const [receiptLines, writeoffLines, saleLines, inventoryEntries] = await Promise.all([
      tx.localInventoryDocumentPosition.findMany({
        where: { productId: { in: productIds }, document: { is: { type: "receipt", applicable: true, isDeleted: false, status: { not: "cancelled" } } } },
        include: { document: { select: { branchId: true, storeId: true, momentAt: true, raw: true } } },
      }),
      tx.localInventoryDocumentPosition.findMany({
        where: { productId: { in: productIds }, document: { is: { type: "writeoff", applicable: true, isDeleted: false, status: { not: "cancelled" } } } },
        include: { document: { select: { branchId: true, storeId: true, momentAt: true, raw: true } } },
      }),
      tx.localDemandPosition.findMany({
        where: { productId: { in: productIds }, assortmentType: { not: "service" }, demand: { is: { applicable: true } } },
        include: { demand: { select: { branchId: true, storeId: true, momentAt: true } } },
      }),
      tx.inventoryLedgerEntry.findMany({
        where: {
          productId: { in: productIds },
          sourceType: "INVENTORY_SESSION",
          movementType: { not: "INVENTORY_REVERSAL" },
          reversalEntries: { none: {} },
        },
      }),
    ]);

    for (const line of receiptLines) {
      if (!line.productId || !line.document.storeId || asRecord(line.document.raw).inventorySessionId) continue;
      const eventKey = key(line.document.branchId, line.document.storeId, line.productId);
      if (!candidateKeys.has(eventKey)) continue;
      events.get(eventKey).push({ at: line.document.momentAt, rank: 10, id: line.id, revision: 1, delta: line.quantity.toNumber(), unitCost: line.priceCentsPerUnit, kind: "receipt" });
    }
    for (const line of writeoffLines) {
      if (!line.productId || !line.document.storeId || asRecord(line.document.raw).inventorySessionId) continue;
      const eventKey = key(line.document.branchId, line.document.storeId, line.productId);
      if (!candidateKeys.has(eventKey)) continue;
      events.get(eventKey).push({ at: line.document.momentAt, rank: 40, id: line.id, revision: 1, delta: -line.quantity.toNumber(), unitCost: null, kind: "writeoff" });
    }
    for (const line of saleLines) {
      if (!line.productId || !line.demand.storeId) continue;
      const eventKey = key(line.demand.branchId, line.demand.storeId, line.productId);
      if (!candidateKeys.has(eventKey)) continue;
      events.get(eventKey).push({ at: line.demand.momentAt, rank: 30, id: line.id, revision: 1, delta: -line.quantity.toNumber(), unitCost: null, kind: "sale" });
    }
    for (const entry of inventoryEntries) {
      if (!entry.productId || !entry.storeId) continue;
      const eventKey = key(entry.branchId, entry.storeId, entry.productId);
      if (!candidateKeys.has(eventKey)) continue;
      events.get(eventKey).push({ at: entry.createdAt, rank: 20, id: entry.id, revision: entry.revision, delta: entry.quantityDelta.toNumber(), unitCost: entry.unitCostSnapshot, kind: "inventory" });
    }

    const rows = candidates.map((candidate) => {
      const timeline = events.get(key(candidate.branchId, candidate.storeId, candidate.productId))
        .sort((a, b) => a.at.getTime() - b.at.getTime()
          || a.rank - b.rank
          || a.id.localeCompare(b.id)
          || a.revision - b.revision);
      let quantity = 0;
      let averageCost = null;
      let reason = null;
      for (const event of timeline) {
        if (event.delta > EPSILON) {
          if (event.unitCost == null || event.unitCost <= 0) {
            reason = `${event.kind}_without_cost`;
            break;
          }
          if (quantity > EPSILON && averageCost == null) {
            reason = "opening_cost_required";
            break;
          }
          averageCost = quantity <= EPSILON
            ? event.unitCost
            : Math.round((quantity * averageCost + event.delta * event.unitCost) / (quantity + event.delta));
          quantity += event.delta;
        } else {
          if (quantity + event.delta < -EPSILON) {
            reason = "outflow_before_known_opening";
            break;
          }
          quantity += event.delta;
        }
      }
      const currentQuantity = candidate.quantity.toNumber();
      if (!reason && Math.abs(quantity - currentQuantity) > 0.001) reason = "quantity_reconciliation_failed";
      if (!reason && (averageCost == null || averageCost <= 0)) reason = "cost_not_reconstructable";
      const status = !reason
        ? "RECONSTRUCTABLE"
        : ["opening_cost_required", "outflow_before_known_opening"].includes(reason)
          ? "OPENING_COST_REQUIRED"
          : reason === "quantity_reconciliation_failed"
            ? "AMBIGUOUS_HISTORY"
            : "MISSING_COST";
      return {
        branchId: candidate.branchId,
        storeId: candidate.storeId,
        storeName: candidate.store.name,
        productId: candidate.productId,
        productName: candidate.product.name,
        currentQuantity,
        replayQuantity: Number(quantity.toFixed(3)),
        currentAverageCostCents: candidate.buyPriceCents,
        suggestedAverageCostCents: reason ? null : averageCost,
        status,
        reason,
        events: timeline.length,
      };
    });
    return {
      postedHistory,
      candidates: rows,
      summary: {
        total: rows.length,
        classifications: {
          CONFIRMED_SNAPSHOT: confirmedSnapshotCount,
          RECONSTRUCTABLE: rows.filter((row) => row.status === "RECONSTRUCTABLE").length,
          OPENING_COST_REQUIRED: rows.filter((row) => row.status === "OPENING_COST_REQUIRED").length,
          AMBIGUOUS_HISTORY: rows.filter((row) => row.status === "AMBIGUOUS_HISTORY").length,
          MISSING_COST: rows.filter((row) => row.status === "MISSING_COST").length,
        },
      },
    };
  });
  process.stdout.write(`${JSON.stringify({ mode: "dry-run", writes: false, calculatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
