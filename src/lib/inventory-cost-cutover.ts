import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { lineCostCents } from "@/lib/inventory-costing";
import { lockInventoryCostKeys } from "@/lib/inventory-costing-db";
import {
  INVENTORY_COST_CUTOVER_BACKUP,
  INVENTORY_COST_CUTOVER_CONFIRMATION,
  INVENTORY_COST_CUTOVER_ID,
  type InventoryCostCutoverCandidate,
  type InventoryCostCutoverPlan,
  type InventoryCostCutoverStatus,
} from "@/lib/inventory-cost-cutover-contract";

const EPSILON = 0.0001;

type TransactionClient = Prisma.TransactionClient;

type TimelineEvent = {
  at: Date;
  rank: number;
  id: string;
  revision: number;
  delta: number;
  unitCost: number | null;
  kind: "receipt" | "writeoff" | "sale" | "inventory";
};

function key(branchId: string, storeId: string, productId: string) {
  return `${branchId}\u0000${storeId}\u0000${productId}`;
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function planHash(candidates: InventoryCostCutoverCandidate[]) {
  const stable = candidates.map((row) => ({
    balanceId: row.balanceId,
    branchId: row.branchId,
    storeId: row.storeId,
    productId: row.productId,
    currentQuantity: row.currentQuantity,
    currentAverageCostCents: row.currentAverageCostCents,
    suggestedAverageCostCents: row.suggestedAverageCostCents,
    status: row.status,
    reason: row.reason,
    events: row.events,
  }));
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

async function buildPlan(tx: TransactionClient): Promise<InventoryCostCutoverPlan> {
  const candidates = await tx.localStockBalance.findMany({
    where: {
      quantity: { gt: 0 },
      OR: [{ buyPriceCents: null }, { buyPriceCents: { lte: 0 } }],
    },
    include: {
      product: { select: { name: true, buyPriceCents: true } },
      store: { select: { name: true } },
    },
    orderBy: [{ branchId: "asc" }, { storeId: "asc" }, { productId: "asc" }],
  });
  const branchNames = new Map(
    (await tx.branch.findMany({
      where: { id: { in: [...new Set(candidates.map((row) => row.branchId))] } },
      select: { id: true, name: true },
    })).map((row) => [row.id, row.name]),
  );
  const candidateKeys = new Set(candidates.map((row) => key(row.branchId, row.storeId, row.productId)));
  const events = new Map([...candidateKeys].map((eventKey) => [eventKey, [] as TimelineEvent[]]));
  const productIds = [...new Set(candidates.map((row) => row.productId))];

  if (productIds.length > 0) {
    const [receiptLines, writeoffLines, saleLines, inventoryEntries] = await Promise.all([
      tx.localInventoryDocumentPosition.findMany({
        where: {
          productId: { in: productIds },
          document: { is: { type: "receipt", applicable: true, isDeleted: false, status: { not: "cancelled" } } },
        },
        include: { document: { select: { branchId: true, storeId: true, momentAt: true, raw: true } } },
      }),
      tx.localInventoryDocumentPosition.findMany({
        where: {
          productId: { in: productIds },
          document: { is: { type: "writeoff", applicable: true, isDeleted: false, status: { not: "cancelled" } } },
        },
        include: { document: { select: { branchId: true, storeId: true, momentAt: true, raw: true } } },
      }),
      tx.localDemandPosition.findMany({
        where: {
          productId: { in: productIds },
          assortmentType: { not: "service" },
          demand: { is: { applicable: true } },
        },
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
      events.get(eventKey)?.push({
        at: line.document.momentAt,
        rank: 10,
        id: line.id,
        revision: 1,
        delta: line.quantity.toNumber(),
        unitCost: line.priceCentsPerUnit,
        kind: "receipt",
      });
    }
    for (const line of writeoffLines) {
      if (!line.productId || !line.document.storeId || asRecord(line.document.raw).inventorySessionId) continue;
      const eventKey = key(line.document.branchId, line.document.storeId, line.productId);
      if (!candidateKeys.has(eventKey)) continue;
      events.get(eventKey)?.push({
        at: line.document.momentAt,
        rank: 40,
        id: line.id,
        revision: 1,
        delta: -line.quantity.toNumber(),
        unitCost: null,
        kind: "writeoff",
      });
    }
    for (const line of saleLines) {
      if (!line.productId || !line.demand.storeId) continue;
      const eventKey = key(line.demand.branchId, line.demand.storeId, line.productId);
      if (!candidateKeys.has(eventKey)) continue;
      events.get(eventKey)?.push({
        at: line.demand.momentAt,
        rank: 30,
        id: line.id,
        revision: 1,
        delta: -line.quantity.toNumber(),
        unitCost: null,
        kind: "sale",
      });
    }
    for (const entry of inventoryEntries) {
      if (!entry.productId || !entry.storeId) continue;
      const eventKey = key(entry.branchId, entry.storeId, entry.productId);
      if (!candidateKeys.has(eventKey)) continue;
      events.get(eventKey)?.push({
        at: entry.createdAt,
        rank: 20,
        id: entry.id,
        revision: entry.revision,
        delta: entry.quantityDelta.toNumber(),
        unitCost: entry.unitCostSnapshot,
        kind: "inventory",
      });
    }
  }

  const rows = candidates.map<InventoryCostCutoverCandidate>((candidate) => {
    const timeline = (events.get(key(candidate.branchId, candidate.storeId, candidate.productId)) ?? [])
      .sort((a, b) => a.at.getTime() - b.at.getTime()
        || a.rank - b.rank
        || a.id.localeCompare(b.id)
        || a.revision - b.revision);
    let quantity = 0;
    let averageCost: number | null = null;
    let reason: string | null = null;

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
          : Math.round((quantity * averageCost! + event.delta * event.unitCost) / (quantity + event.delta));
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
    const status: InventoryCostCutoverStatus = !reason
      ? "RECONSTRUCTABLE"
      : ["opening_cost_required", "outflow_before_known_opening"].includes(reason)
        ? "OPENING_COST_REQUIRED"
        : reason === "quantity_reconciliation_failed"
          ? "AMBIGUOUS_HISTORY"
          : "MISSING_COST";

    return {
      balanceId: candidate.id,
      branchId: candidate.branchId,
      branchName: branchNames.get(candidate.branchId) ?? candidate.branchId,
      storeId: candidate.storeId,
      storeName: candidate.store.name,
      productId: candidate.productId,
      productName: candidate.product.name,
      currentQuantity,
      replayQuantity: Number(quantity.toFixed(3)),
      currentAverageCostCents: candidate.buyPriceCents,
      lastPurchasePriceCents: candidate.product.buyPriceCents,
      suggestedAverageCostCents: reason ? null : averageCost,
      status,
      reason,
      events: timeline.length,
    };
  });

  return {
    cutoverId: INVENTORY_COST_CUTOVER_ID,
    mode: "dry-run",
    writes: false,
    calculatedAt: new Date().toISOString(),
    planHash: planHash(rows),
    summary: {
      total: rows.length,
      reconstructable: rows.filter((row) => row.status === "RECONSTRUCTABLE").length,
      openingCostRequired: rows.filter((row) => row.status === "OPENING_COST_REQUIRED").length,
      ambiguousHistory: rows.filter((row) => row.status === "AMBIGUOUS_HISTORY").length,
      missingCost: rows.filter((row) => row.status === "MISSING_COST").length,
    },
    candidates: rows,
  };
}

export async function getInventoryCostCutoverPlan(prisma: PrismaClient): Promise<InventoryCostCutoverPlan> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return buildPlan(tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function applyInventoryCostCutover(input: {
  prisma: PrismaClient;
  actor: { login: string; name: string };
  expectedPlanHash: string;
  confirmation: string;
  backupReference: string;
}) {
  if (input.confirmation !== INVENTORY_COST_CUTOVER_CONFIRMATION) {
    throw new Error("Неверная фраза подтверждения cutover");
  }
  if (input.backupReference !== INVENTORY_COST_CUTOVER_BACKUP) {
    throw new Error("Не подтверждена обязательная резервная копия Timeweb");
  }

  return input.prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${INVENTORY_COST_CUTOVER_ID}, 0))::text AS locked
    `);
    const firstPlan = await buildPlan(tx);
    const lockGroups = new Map<string, { branchId: string; storeId: string; productIds: string[] }>();
    for (const candidate of firstPlan.candidates) {
      const groupKey = `${candidate.branchId}\u0000${candidate.storeId}`;
      const group = lockGroups.get(groupKey) ?? {
        branchId: candidate.branchId,
        storeId: candidate.storeId,
        productIds: [],
      };
      group.productIds.push(candidate.productId);
      lockGroups.set(groupKey, group);
    }
    for (const group of [...lockGroups.values()].sort((a, b) =>
      `${a.branchId}:${a.storeId}`.localeCompare(`${b.branchId}:${b.storeId}`))) {
      await lockInventoryCostKeys(tx, group);
    }

    const plan = await buildPlan(tx);
    if (plan.planHash !== input.expectedPlanHash) {
      throw new Error("План изменился после dry-run; применение остановлено, требуется повторная проверка");
    }

    const reconstructable = plan.candidates.filter((row) =>
      row.status === "RECONSTRUCTABLE" && row.suggestedAverageCostCents != null && row.suggestedAverageCostCents > 0);
    const applied: Array<{ balanceId: string; productName: string; averageCostCents: number }> = [];
    const now = new Date();

    for (const candidate of reconstructable) {
      const averageCostCents = candidate.suggestedAverageCostCents!;
      const updated = await tx.localStockBalance.updateMany({
        where: {
          branchId: candidate.branchId,
          id: candidate.balanceId,
          quantity: { gt: 0 },
          OR: [{ buyPriceCents: null }, { buyPriceCents: { lte: 0 } }],
        },
        data: { buyPriceCents: averageCostCents, syncedAt: now },
      });
      if (updated.count !== 1) throw new Error(`Остаток ${candidate.balanceId} изменился во время cutover`);

      await tx.inventoryLedgerEntry.create({
        data: {
          id: `${INVENTORY_COST_CUTOVER_ID}:${candidate.balanceId}`,
          branchId: candidate.branchId,
          sourceType: "INVENTORY_COST_CUTOVER",
          sourceId: INVENTORY_COST_CUTOVER_ID,
          productId: candidate.productId,
          storeId: candidate.storeId,
          movementType: "OPENING_COST_RECONSTRUCTED",
          quantityDelta: new Prisma.Decimal(0),
          unitCostSnapshot: averageCostCents,
          totalCostSnapshot: 0,
          analyticsImpact: false,
          createdById: input.actor.login,
          createdByName: input.actor.name,
          raw: {
            cutoverId: INVENTORY_COST_CUTOVER_ID,
            backupReference: input.backupReference,
            planHash: plan.planHash,
            costSource: "RECONSTRUCTED",
            costStatus: "RECONSTRUCTED",
            balanceBefore: {
              quantity: candidate.currentQuantity,
              averageCostCents: candidate.currentAverageCostCents,
            },
            balanceAfter: {
              quantity: candidate.currentQuantity,
              averageCostCents,
            },
            replayQuantity: candidate.replayQuantity,
            historyEvents: candidate.events,
            stockValueAfterCents: lineCostCents(candidate.currentQuantity, averageCostCents),
          },
        },
      });
      applied.push({ balanceId: candidate.balanceId, productName: candidate.productName, averageCostCents });
    }

    return {
      ok: true as const,
      cutoverId: INVENTORY_COST_CUTOVER_ID,
      backupReference: input.backupReference,
      planHash: plan.planHash,
      appliedCount: applied.length,
      applied,
      unresolvedCount: plan.summary.total - applied.length,
      unresolved: plan.candidates.filter((row) => row.status !== "RECONSTRUCTABLE"),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15_000, timeout: 120_000 });
}
