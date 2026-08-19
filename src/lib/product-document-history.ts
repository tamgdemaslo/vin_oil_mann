import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const PRODUCT_HISTORY_FILTERS = [
  "all",
  "incoming",
  "outgoing",
  "inventory",
  "shipment",
  "receipt",
  "writeoff",
  "adjustment",
  "transfer",
] as const;

export type ProductHistoryFilter = (typeof PRODUCT_HISTORY_FILTERS)[number];
export type ProductHistoryDirection = "in" | "out" | "none";

export type ProductHistoryActor = {
  id: string | null;
  name: string;
};

export type ProductDocumentHistoryItem = {
  id: string;
  documentType: "shipment" | "receipt" | "writeoff" | "adjustment" | "inventory" | "transfer" | "other";
  documentTypeLabel: string;
  documentId: string;
  documentNumber: string;
  documentDate: string;
  status: string;
  quantity: number;
  quantityDirection: ProductHistoryDirection;
  unit: string;
  storeId: string | null;
  storeName: string | null;
  counterpartyType: "client" | "supplier" | null;
  counterpartyName: string | null;
  vehicleDisplayName: string | null;
  clientDisplayName: string | null;
  createdBy: ProductHistoryActor | null;
  postedBy: ProductHistoryActor | null;
  href: string | null;
  description: string | null;
  inventory: {
    accountedQuantity: number;
    actualQuantity: number | null;
    adjustmentQuantity: number | null;
  } | null;
  routeLabel: string | null;
};

export type ProductDocumentHistoryResponse = {
  product: {
    id: string;
    branchId: string;
    branchName: string | null;
    unit: string;
  };
  items: ProductDocumentHistoryItem[];
  nextCursor: string | null;
  summary: {
    currentQuantity: number;
    currentAvailable: number;
    currentReserve: number;
    incomingQuantity30Days: number;
    outgoingQuantity30Days: number;
    documentCount30Days: number;
  };
  stores: Array<{ id: string; name: string; isMain: boolean }>;
};

type HistoryCursor = {
  at: string;
  source: number;
  id: string;
};

type RankedHistoryItem = ProductDocumentHistoryItem & {
  _source: number;
  _sortId: string;
};

type AppliedMovementSummaryRow = {
  incoming_quantity: Prisma.Decimal | number | null;
  outgoing_quantity: Prisma.Decimal | number | null;
  document_count: bigint | number | null;
};

type HistoryBranchContext = {
  mode: "branch" | "all";
  branchId: string | null;
  allowedBranchIds: string[];
};

export type GetProductDocumentHistoryInput = {
  productId: string;
  branchContext: HistoryBranchContext;
  filters?: {
    type?: ProductHistoryFilter;
    dateFrom?: Date | null;
    dateTo?: Date | null;
    storeId?: string | null;
    query?: string | null;
  };
  cursor?: string | null;
  limit?: number;
};

const SOURCE_RANK = {
  transfer: 4,
  inventory: 3,
  stockDocument: 2,
  shipment: 1,
} as const;

function decimal(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actor(id: string | null | undefined, name: string | null | undefined): ProductHistoryActor | null {
  const resolvedName = clean(name) ?? clean(id);
  return resolvedName ? { id: clean(id), name: resolvedName } : null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function valuesFromAttributes(value: unknown): Array<{ name: string; value: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const row = jsonRecord(entry);
      const name = clean(row.name) ?? clean(row.key) ?? clean(row.title);
      const next = clean(row.value) ?? clean(row.text);
      return name && next ? [{ name, value: next }] : [];
    });
  }
  const row = jsonRecord(value);
  return Object.entries(row).flatMap(([name, next]) => {
    const direct = clean(next);
    if (direct) return [{ name, value: direct }];
    const nested = jsonRecord(next);
    const nestedValue = clean(nested.value) ?? clean(nested.text);
    return nestedValue ? [{ name, value: nestedValue }] : [];
  });
}

function vehicleFromAttributes(value: unknown): string | null {
  const attributes = valuesFromAttributes(value);
  const find = (pattern: RegExp) => attributes.find((entry) => pattern.test(entry.name))?.value ?? null;
  const model = find(/модель.*авто|автомобил|vehicle.*model|^model$/i);
  const year = find(/год.*авто|vehicle.*year|^year$/i);
  const plate = find(/гос.*номер|license.*plate|^plate$/i);
  const vin = find(/^vin|vin.*авто/i);
  const shortVin = vin ? `${vin.slice(0, 4)}…${vin.slice(-4)}` : null;
  const title = [model, year].filter(Boolean).join(" ");
  return [title || null, plate, shortVin].filter(Boolean).join(" · ") || null;
}

function parseCursor(value?: string | null): HistoryCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<HistoryCursor>;
    if (!clean(parsed.at) || !clean(parsed.id) || !Number.isInteger(parsed.source)) return null;
    const at = new Date(parsed.at!);
    if (Number.isNaN(at.getTime())) return null;
    return { at: at.toISOString(), source: parsed.source!, id: parsed.id! };
  } catch {
    return null;
  }
}

function encodeCursor(item: RankedHistoryItem): string {
  return Buffer.from(JSON.stringify({
    at: item.documentDate,
    source: item._source,
    id: item._sortId,
  } satisfies HistoryCursor)).toString("base64url");
}

function temporalCursorWhere(field: "momentAt" | "createdAt", source: number, cursor: HistoryCursor | null) {
  if (!cursor) return null;
  const at = new Date(cursor.at);
  if (source > cursor.source) return { [field]: { lt: at } };
  if (source < cursor.source) return { [field]: { lte: at } };
  return {
    OR: [
      { [field]: { lt: at } },
      { [field]: at, id: { lt: cursor.id } },
    ],
  };
}

function dateWindowWhere(field: "momentAt" | "createdAt", dateFrom: Date, dateTo: Date | null) {
  return {
    [field]: {
      gte: dateFrom,
      ...(dateTo ? { lte: dateTo } : {}),
    },
  };
}

function laterDate(left: Date | null | undefined, right: Date): Date {
  if (!left || Number.isNaN(left.getTime())) return right;
  return left > right ? left : right;
}

function normalizedStockStatus(status: string, applicable: boolean): string {
  const value = status.trim().toLowerCase();
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (value === "draft" || !applicable) return "draft";
  return "posted";
}

function stockDocumentPresentation(type: string, adjustmentType: string | null) {
  if (type === "receipt" && adjustmentType) {
    return { documentType: "adjustment" as const, label: "Корректировка", direction: "in" as const };
  }
  if (type === "receipt") return { documentType: "receipt" as const, label: "Приёмка", direction: "in" as const };
  if (type === "writeoff" && adjustmentType === "technical") {
    return { documentType: "adjustment" as const, label: "Корректировка", direction: "out" as const };
  }
  if (type === "writeoff") return { documentType: "writeoff" as const, label: "Списание", direction: "out" as const };
  return { documentType: "other" as const, label: "Складской документ", direction: "none" as const };
}

export function effectiveHistoryDirection(
  status: string,
  intendedDirection: Exclude<ProductHistoryDirection, "none">
): ProductHistoryDirection {
  return status === "posted" ? intendedDirection : "none";
}

function inventoryStatus(value: string): string {
  const status = value.trim().toUpperCase();
  if (status === "POSTED") return "posted";
  if (status === "CANCELLED") return "cancelled";
  if (status === "REVERSED") return "reversed";
  return "draft";
}

function transferStatus(value: string, isOutgoing: boolean): string {
  const status = value.trim().toLowerCase();
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "received") return "posted";
  if (status === "shipped") return isOutgoing ? "posted" : "in_transit";
  return "draft";
}

function includesSource(type: ProductHistoryFilter, source: keyof typeof SOURCE_RANK) {
  if (type === "all") return true;
  if (source === "shipment") return type === "outgoing" || type === "shipment";
  if (source === "inventory") return type === "incoming" || type === "outgoing" || type === "inventory";
  if (source === "transfer") return type === "incoming" || type === "outgoing" || type === "transfer";
  return type === "incoming" || type === "outgoing" || type === "receipt" || type === "writeoff" || type === "adjustment";
}

function compareHistory(left: RankedHistoryItem, right: RankedHistoryItem) {
  const byDate = right.documentDate.localeCompare(left.documentDate);
  if (byDate) return byDate;
  const bySource = right._source - left._source;
  if (bySource) return bySource;
  return right._sortId.localeCompare(left._sortId);
}

async function getAppliedMovementSummary(input: {
  branchId: string;
  productId: string;
  storeId: string | null;
  dateFrom: Date;
}) {
  const shipmentStoreFilter = input.storeId
    ? Prisma.sql`AND document.store_id = ${input.storeId}`
    : Prisma.sql``;
  const stockStoreFilter = input.storeId
    ? Prisma.sql`AND document.store_id = ${input.storeId}`
    : Prisma.sql``;
  const inventoryStoreFilter = input.storeId
    ? Prisma.sql`AND document.warehouse_id = ${input.storeId}`
    : Prisma.sql``;
  const transferMovements = input.storeId
    ? Prisma.sql``
    : Prisma.sql`
        UNION ALL

        SELECT
          transfer.id AS document_id,
          -SUM(item.quantity)::numeric AS quantity_delta
        FROM branch_stock_transfers AS transfer
        INNER JOIN branch_stock_transfer_items AS item
          ON item.transfer_id = transfer.id
        WHERE transfer.source_branch_id = ${input.branchId}
          AND item.product_id = ${input.productId}
          AND LOWER(transfer.status) IN ('shipped', 'received')
          AND COALESCE(transfer.shipped_at, transfer.created_at) >= ${input.dateFrom}
        GROUP BY transfer.id

        UNION ALL

        SELECT
          transfer.id AS document_id,
          SUM(item.quantity)::numeric AS quantity_delta
        FROM branch_stock_transfers AS transfer
        INNER JOIN branch_stock_transfer_items AS item
          ON item.transfer_id = transfer.id
        WHERE transfer.destination_branch_id = ${input.branchId}
          AND item.product_id = ${input.productId}
          AND LOWER(transfer.status) = 'received'
          AND COALESCE(transfer.received_at, transfer.created_at) >= ${input.dateFrom}
        GROUP BY transfer.id
      `;

  const rows = await prisma.$queryRaw<AppliedMovementSummaryRow[]>(Prisma.sql`
    WITH applied_movements AS (
      SELECT
        document.id AS document_id,
        -SUM(position.quantity)::numeric AS quantity_delta
      FROM local_demands AS document
      INNER JOIN local_demand_positions AS position
        ON position.demand_id = document.id
        AND position.branch_id = document.branch_id
      WHERE document.branch_id = ${input.branchId}
        AND position.product_id = ${input.productId}
        AND document.applicable = TRUE
        AND document.moment_at >= ${input.dateFrom}
        ${shipmentStoreFilter}
      GROUP BY document.id

      UNION ALL

      SELECT
        document.id AS document_id,
        CASE
          WHEN document.type = 'receipt' THEN SUM(position.quantity)::numeric
          WHEN document.type = 'writeoff' THEN -SUM(position.quantity)::numeric
          ELSE 0::numeric
        END AS quantity_delta
      FROM local_inventory_documents AS document
      INNER JOIN local_inventory_document_positions AS position
        ON position.document_id = document.id
        AND position.branch_id = document.branch_id
      WHERE document.branch_id = ${input.branchId}
        AND position.product_id = ${input.productId}
        AND document.is_deleted = FALSE
        AND document.applicable = TRUE
        AND document.cancelled_at IS NULL
        AND LOWER(document.status) NOT IN ('draft', 'cancelled', 'canceled')
        AND document.moment_at >= ${input.dateFrom}
        ${stockStoreFilter}
      GROUP BY document.id, document.type

      UNION ALL

      SELECT
        document.id AS document_id,
        SUM(COALESCE(line.difference_quantity, 0))::numeric AS quantity_delta
      FROM inventory_sessions AS document
      INNER JOIN inventory_lines AS line
        ON line.inventory_session_id = document.id
        AND line.branch_id = document.branch_id
      WHERE document.branch_id = ${input.branchId}
        AND line.product_id = ${input.productId}
        AND UPPER(document.status) = 'POSTED'
        AND COALESCE(document.posted_at, document.created_at) >= ${input.dateFrom}
        ${inventoryStoreFilter}
      GROUP BY document.id

      ${transferMovements}
    )
    SELECT
      COALESCE(SUM(CASE WHEN quantity_delta > 0 THEN quantity_delta ELSE 0 END), 0)::numeric AS incoming_quantity,
      COALESCE(SUM(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END), 0)::numeric AS outgoing_quantity,
      COUNT(*) FILTER (WHERE quantity_delta <> 0)::bigint AS document_count
    FROM applied_movements
  `);
  const row = rows[0];
  return {
    incomingQuantity: decimal(row?.incoming_quantity),
    outgoingQuantity: decimal(row?.outgoing_quantity),
    documentCount: Number(row?.document_count ?? 0),
  };
}

export async function getProductDocumentHistory(
  input: GetProductDocumentHistoryInput
): Promise<ProductDocumentHistoryResponse | null> {
  const productId = input.productId.trim();
  const allowedBranchIds = input.branchContext.allowedBranchIds.filter(Boolean);
  if (!productId || !allowedBranchIds.length) return null;

  const product = await prisma.localProduct.findFirst({
    where: {
      id: productId,
      branchId: input.branchContext.mode === "branch" && input.branchContext.branchId
        ? input.branchContext.branchId
        : { in: allowedBranchIds },
    },
    select: {
      id: true,
      branchId: true,
      uomName: true,
      createdAt: true,
      stockBalances: {
        select: { storeId: true, quantity: true, available: true, reserve: true },
      },
    },
  });
  if (!product) return null;

  const branchId = product.branchId;
  const type = input.filters?.type ?? "all";
  const storeId = clean(input.filters?.storeId);
  const query = clean(input.filters?.query);
  const dateFrom = laterDate(input.filters?.dateFrom, product.createdAt);
  const dateTo = input.filters?.dateTo && !Number.isNaN(input.filters.dateTo.getTime()) ? input.filters.dateTo : null;
  const cursor = parseCursor(input.cursor);
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 30)));
  const take = limit + 1;
  const unit = clean(product.uomName) ?? "шт";
  const summaryDateFrom = laterDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), product.createdAt);

  const shipmentAnd: Prisma.LocalDemandWhereInput[] = [
    dateWindowWhere("momentAt", dateFrom, dateTo),
  ];
  const shipmentCursor = temporalCursorWhere("momentAt", SOURCE_RANK.shipment, cursor);
  if (shipmentCursor) shipmentAnd.push(shipmentCursor);
  if (storeId) shipmentAnd.push({ storeId });
  if (query) shipmentAnd.push({ name: { contains: query, mode: "insensitive" } });

  const stockAnd: Prisma.LocalInventoryDocumentWhereInput[] = [
    dateWindowWhere("momentAt", dateFrom, dateTo),
  ];
  const stockCursor = temporalCursorWhere("momentAt", SOURCE_RANK.stockDocument, cursor);
  if (stockCursor) stockAnd.push(stockCursor);
  if (storeId) stockAnd.push({ storeId });
  if (query) stockAnd.push({ name: { contains: query, mode: "insensitive" } });
  if (type === "incoming" || type === "receipt") stockAnd.push({ type: "receipt" });
  if (type === "outgoing" || type === "writeoff") stockAnd.push({ type: "writeoff" });
  if (type === "adjustment") stockAnd.push({ adjustmentType: { not: null } });

  const inventoryAnd: Prisma.InventorySessionWhereInput[] = [
    dateWindowWhere("createdAt", dateFrom, dateTo),
  ];
  const inventoryCursor = temporalCursorWhere("createdAt", SOURCE_RANK.inventory, cursor);
  if (inventoryCursor) inventoryAnd.push(inventoryCursor);
  if (storeId) inventoryAnd.push({ warehouseId: storeId });
  if (query) inventoryAnd.push({ number: { contains: query, mode: "insensitive" } });
  if (type === "incoming") inventoryAnd.push({ lines: { some: { branchId, productId, differenceQuantity: { gt: 0 } } } });
  if (type === "outgoing") inventoryAnd.push({ lines: { some: { branchId, productId, differenceQuantity: { lt: 0 } } } });

  const transferAnd: Prisma.BranchStockTransferWhereInput[] = [
    dateWindowWhere("createdAt", dateFrom, dateTo),
  ];
  const transferCursor = temporalCursorWhere("createdAt", SOURCE_RANK.transfer, cursor);
  if (transferCursor) transferAnd.push(transferCursor);
  if (query) transferAnd.push({ id: { contains: query, mode: "insensitive" } });
  if (type === "incoming") transferAnd.push({ destinationBranchId: branchId });
  if (type === "outgoing") transferAnd.push({ sourceBranchId: branchId });

  const [shipments, stockDocuments, inventorySessions, transfers, stores, branch, appliedMovementSummary] = await Promise.all([
    includesSource(type, "shipment")
      ? prisma.localDemand.findMany({
          where: {
            branchId,
            positions: { some: { branchId, productId } },
            AND: shipmentAnd,
          },
          include: {
            positions: { where: { branchId, productId }, select: { quantity: true } },
            store: { select: { id: true, name: true } },
            counterparty: { select: { id: true, name: true, displayName: true } },
            revisions: {
              orderBy: { createdAt: "asc" },
              select: { eventType: true, createdById: true, createdByName: true },
            },
          },
          orderBy: [{ momentAt: "desc" }, { id: "desc" }],
          take,
        })
      : Promise.resolve([]),
    includesSource(type, "stockDocument")
      ? prisma.localInventoryDocument.findMany({
          where: {
            branchId,
            isDeleted: false,
            positions: { some: { branchId, productId } },
            AND: stockAnd,
          },
          include: {
            positions: { where: { branchId, productId }, select: { quantity: true } },
            store: { select: { id: true, name: true } },
            counterparty: { select: { id: true, name: true, displayName: true } },
            auditLogs: {
              orderBy: { createdAt: "desc" },
              take: 12,
              select: { action: true, createdById: true, createdByName: true },
            },
          },
          orderBy: [{ momentAt: "desc" }, { id: "desc" }],
          take,
        })
      : Promise.resolve([]),
    includesSource(type, "inventory")
      ? prisma.inventorySession.findMany({
          where: {
            branchId,
            lines: { some: { branchId, productId } },
            AND: inventoryAnd,
          },
          include: {
            warehouse: { select: { id: true, name: true } },
            lines: {
              where: { branchId, productId },
              select: {
                snapshotQuantity: true,
                expectedQuantityAtCount: true,
                finalQuantity: true,
                differenceQuantity: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
        })
      : Promise.resolve([]),
    includesSource(type, "transfer") && !storeId
      ? prisma.branchStockTransfer.findMany({
          where: {
            OR: [{ sourceBranchId: branchId }, { destinationBranchId: branchId }],
            items: { some: { productId } },
            AND: transferAnd,
          },
          include: {
            sourceBranch: { select: { id: true, name: true } },
            destinationBranch: { select: { id: true, name: true } },
            items: { where: { productId }, select: { quantity: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
        })
      : Promise.resolve([]),
    prisma.localStore.findMany({
      where: { branchId, archived: false },
      select: { id: true, name: true, isMain: true },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    }),
    prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }),
    getAppliedMovementSummary({ branchId, productId, storeId, dateFrom: summaryDateFrom }),
  ]);

  const ranked: RankedHistoryItem[] = [];

  for (const demand of shipments) {
    const createdRevision = demand.revisions.find((revision) => revision.eventType === "CREATED");
    const postedRevision = [...demand.revisions].reverse().find((revision) => revision.eventType === "POSTED" || revision.eventType === "REPOSTED");
    const status = demand.applicable ? "posted" : "draft";
    const counterpartyName = clean(demand.counterparty?.displayName) ?? clean(demand.counterparty?.name) ?? clean(demand.agentNameSnapshot);
    ranked.push({
      id: `shipment:${demand.id}`,
      documentType: "shipment",
      documentTypeLabel: "Отгрузка",
      documentId: demand.id,
      documentNumber: demand.name,
      documentDate: demand.momentAt.toISOString(),
      status,
      quantity: demand.positions.reduce((sum, position) => sum + decimal(position.quantity), 0),
      quantityDirection: effectiveHistoryDirection(status, "out"),
      unit,
      storeId: demand.store?.id ?? demand.storeId,
      storeName: clean(demand.store?.name) ?? clean(demand.storeNameSnapshot),
      counterpartyType: "client",
      counterpartyName,
      vehicleDisplayName: vehicleFromAttributes(demand.attributes),
      clientDisplayName: counterpartyName,
      createdBy: actor(createdRevision?.createdById, createdRevision?.createdByName),
      postedBy: status === "posted"
        ? actor(
            postedRevision?.createdById ?? createdRevision?.createdById,
            postedRevision?.createdByName ?? createdRevision?.createdByName
          )
        : null,
      href: `/shipment/${encodeURIComponent(demand.id)}`,
      description: clean(demand.description),
      inventory: null,
      routeLabel: null,
      _source: SOURCE_RANK.shipment,
      _sortId: demand.id,
    });
  }

  for (const document of stockDocuments) {
    const presentation = stockDocumentPresentation(document.type, document.adjustmentType);
    if (type === "adjustment" && presentation.documentType !== "adjustment") continue;
    const status = normalizedStockStatus(document.status, document.applicable);
    const postAudit = document.auditLogs.find((entry) => entry.action === "post" || entry.action === "create_posted");
    const counterpartyName = clean(document.counterparty?.displayName) ?? clean(document.counterparty?.name) ?? clean(document.counterpartyNameSnapshot);
    const href = document.type === "receipt"
      ? `/inventory/receipts?document=${encodeURIComponent(document.id)}&open=edit`
      : document.type === "writeoff"
        ? `/inventory/writeoffs?document=${encodeURIComponent(document.id)}&open=edit`
        : null;
    ranked.push({
      id: `stock:${document.id}`,
      documentType: presentation.documentType,
      documentTypeLabel: presentation.label,
      documentId: document.id,
      documentNumber: document.name,
      documentDate: document.momentAt.toISOString(),
      status,
      quantity: document.positions.reduce((sum, position) => sum + decimal(position.quantity), 0),
      quantityDirection: presentation.direction === "none" ? "none" : effectiveHistoryDirection(status, presentation.direction),
      unit,
      storeId: document.store?.id ?? document.storeId,
      storeName: clean(document.store?.name) ?? clean(document.storeNameSnapshot),
      counterpartyType: document.type === "receipt" ? "supplier" : null,
      counterpartyName,
      vehicleDisplayName: null,
      clientDisplayName: null,
      createdBy: actor(document.createdByLogin, document.createdByName),
      postedBy: actor(postAudit?.createdById, postAudit?.createdByName),
      href,
      description: clean(document.adjustmentReason) ?? clean(document.description),
      inventory: null,
      routeLabel: null,
      _source: SOURCE_RANK.stockDocument,
      _sortId: document.id,
    });
  }

  for (const session of inventorySessions) {
    const status = inventoryStatus(session.status);
    const accountedQuantity = session.lines.reduce((sum, line) => sum + decimal(line.expectedQuantityAtCount || line.snapshotQuantity), 0);
    const actualLines = session.lines.filter((line) => line.finalQuantity != null);
    const actualQuantity = actualLines.length
      ? actualLines.reduce((sum, line) => sum + decimal(line.finalQuantity), 0)
      : null;
    const adjustmentLines = session.lines.filter((line) => line.differenceQuantity != null);
    const adjustmentQuantity = adjustmentLines.length
      ? adjustmentLines.reduce((sum, line) => sum + decimal(line.differenceQuantity), 0)
      : null;
    if (type === "incoming" && (adjustmentQuantity == null || adjustmentQuantity <= 0)) continue;
    if (type === "outgoing" && (adjustmentQuantity == null || adjustmentQuantity >= 0)) continue;
    const intendedDirection = adjustmentQuantity != null && adjustmentQuantity < 0 ? "out" : "in";
    ranked.push({
      id: `inventory:${session.id}`,
      documentType: "inventory",
      documentTypeLabel: "Инвентаризация",
      documentId: session.id,
      documentNumber: session.number,
      documentDate: session.createdAt.toISOString(),
      status,
      quantity: Math.abs(adjustmentQuantity ?? actualQuantity ?? accountedQuantity),
      quantityDirection: adjustmentQuantity == null || adjustmentQuantity === 0
        ? "none"
        : effectiveHistoryDirection(status, intendedDirection),
      unit,
      storeId: session.warehouse.id,
      storeName: session.warehouse.name,
      counterpartyType: null,
      counterpartyName: null,
      vehicleDisplayName: null,
      clientDisplayName: null,
      createdBy: actor(session.createdById, session.createdByName),
      postedBy: actor(session.approvedById, session.approvedById),
      href: `/warehouse/inventory/${encodeURIComponent(session.id)}`,
      description: clean(session.comment),
      inventory: { accountedQuantity, actualQuantity, adjustmentQuantity },
      routeLabel: null,
      _source: SOURCE_RANK.inventory,
      _sortId: session.id,
    });
  }

  for (const transfer of transfers) {
    const isOutgoing = transfer.sourceBranchId === branchId;
    const status = transferStatus(transfer.status, isOutgoing);
    const movementApplied = status === "posted";
    const intendedDirection = isOutgoing ? "out" : "in";
    ranked.push({
      id: `transfer:${transfer.id}`,
      documentType: "transfer",
      documentTypeLabel: "Перемещение между филиалами",
      documentId: transfer.id,
      documentNumber: transfer.id,
      documentDate: transfer.createdAt.toISOString(),
      status,
      quantity: transfer.items.reduce((sum, position) => sum + decimal(position.quantity), 0),
      quantityDirection: movementApplied ? intendedDirection : "none",
      unit,
      storeId: null,
      storeName: null,
      counterpartyType: null,
      counterpartyName: null,
      vehicleDisplayName: null,
      clientDisplayName: null,
      createdBy: actor(transfer.createdById, transfer.createdById),
      postedBy: actor(transfer.approvedById, transfer.approvedById),
      href: null,
      description: null,
      inventory: null,
      routeLabel: `${transfer.sourceBranch.name} → ${transfer.destinationBranch.name}`,
      _source: SOURCE_RANK.transfer,
      _sortId: transfer.id,
    });
  }

  ranked.sort(compareHistory);
  const page = ranked.slice(0, limit);
  const visibleBalances = storeId
    ? product.stockBalances.filter((balance) => balance.storeId === storeId)
    : product.stockBalances;

  return {
    product: { id: product.id, branchId, branchName: branch?.name ?? null, unit },
    items: page.map((rankedItem) => {
      const { _source, _sortId, ...item } = rankedItem;
      void _source;
      void _sortId;
      return item;
    }),
    nextCursor: ranked.length > limit && page.length ? encodeCursor(page[page.length - 1]!) : null,
    summary: {
      currentQuantity: visibleBalances.reduce((sum, balance) => sum + decimal(balance.quantity), 0),
      currentAvailable: visibleBalances.reduce((sum, balance) => sum + decimal(balance.available), 0),
      currentReserve: visibleBalances.reduce((sum, balance) => sum + decimal(balance.reserve), 0),
      incomingQuantity30Days: appliedMovementSummary.incomingQuantity,
      outgoingQuantity30Days: appliedMovementSummary.outgoingQuantity,
      documentCount30Days: appliedMovementSummary.documentCount,
    },
    stores,
  };
}
