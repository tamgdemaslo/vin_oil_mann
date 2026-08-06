import { Prisma } from "@prisma/client";
import type { User } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const INVENTORY_CATEGORIES = [
  "Моторное масло",
  "Трансмиссионное масло",
  "Масляные фильтры",
  "Воздушные фильтры",
  "Салонные фильтры",
  "Топливные фильтры",
  "Прочее",
] as const;

const COUNTABLE_STATUSES = ["COUNTING", "RECOUNT_REQUIRED"];
const STOCK_TRACKED_TYPES = new Set(["product", "variant", "bundle"]);
const ZERO = new Prisma.Decimal(0);

type InventoryResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };
type Tx = Prisma.TransactionClient;

type ScopeInput = {
  type?: string;
  categories?: string[];
  groups?: string[];
  brands?: string[];
  cells?: string[];
  productIds?: string[];
};

type InventoryOptionsInput = {
  includeZeroStock?: boolean;
  includeArchivedWithStock?: boolean;
  includeUncategorized?: boolean;
  includeWithoutCell?: boolean;
  excludeDisabledStockTracking?: boolean;
};

export type CreateInventorySessionInput = {
  organizationId?: string;
  warehouseId?: string;
  startedAt?: string;
  responsibleId?: string;
  comment?: string;
  countMode?: string;
  warehouseMode?: string;
  scope?: ScopeInput;
  options?: InventoryOptionsInput;
};

export type InventorySessionFilters = {
  organizationId?: string;
  warehouseId?: string;
  status?: string;
  category?: string;
  discrepancy?: string;
  onlyWithDiscrepancies?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

type ScopeRow = {
  productId: string;
  warehouseId: string;
  cellId: string | null;
  batchId: string | null;
  unitId: string | null;
  snapshotQuantity: Prisma.Decimal;
  snapshotReservedQuantity: Prisma.Decimal;
  snapshotAvailableQuantity: Prisma.Decimal;
  unitCostSnapshotCents: number | null;
  stockVersion: number;
  productName: string;
};

export async function assertNoActiveInventoryLocks(
  client: Tx | typeof prisma,
  input: {
    warehouseId: string | null | undefined;
    productIds: Array<string | null | undefined>;
    organizationId?: string | null;
    allowSessionId?: string | null;
  }
) {
  const warehouseId = cleanText(input.warehouseId);
  const productIds = [...new Set(input.productIds.map((id) => cleanText(id)).filter((id): id is string => Boolean(id)))];
  if (!warehouseId || productIds.length === 0) return;
  const lock = await client.inventoryLock.findFirst({
    where: {
      warehouseId,
      productId: { in: productIds },
      organizationId: input.organizationId ? input.organizationId : undefined,
      releasedAt: null,
      inventorySessionId: input.allowSessionId ? { not: input.allowSessionId } : undefined,
    },
    include: { session: true, product: { select: { name: true } } },
  });
  if (lock) {
    const productName = lock.product?.name ? ` «${lock.product.name}»` : "";
    throw new Error(`Товар${productName} участвует в активной инвентаризации ${lock.session.number}`);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeScope(input?: ScopeInput) {
  const rawType = String(input?.type ?? "WAREHOUSE").trim().toUpperCase();
  const type = ["WAREHOUSE", "CATEGORIES", "GROUPS", "BRANDS", "CELLS", "PRODUCTS"].includes(rawType)
    ? rawType
    : "WAREHOUSE";
  return {
    type,
    categories: stringArray(input?.categories),
    groups: stringArray(input?.groups),
    brands: stringArray(input?.brands),
    cells: stringArray(input?.cells),
    productIds: stringArray(input?.productIds),
  };
}

function normalizeOptions(input?: InventoryOptionsInput) {
  return {
    includeZeroStock: input?.includeZeroStock === true,
    includeArchivedWithStock: input?.includeArchivedWithStock !== false,
    includeUncategorized: input?.includeUncategorized === true,
    includeWithoutCell: input?.includeWithoutCell === true,
    excludeDisabledStockTracking: input?.excludeDisabledStockTracking !== false,
  };
}

function normalizeCountMode(value: unknown) {
  return value === "QUICK" ? "QUICK" : "BLIND";
}

function normalizeWarehouseMode(value: unknown) {
  return value === "LIVE" ? "LIVE" : "LOCKED";
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return value.toNumber();
}

function decimalFromInput(value: unknown): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return new Prisma.Decimal(n.toFixed(3));
}

function costForDifference(quantity: Prisma.Decimal | null, unitCostCents: number | null | undefined) {
  if (!quantity || unitCostCents == null) return 0;
  return Math.round(Math.abs(quantity.toNumber()) * unitCostCents);
}

function stockTracked(entityType: string | null | undefined) {
  return STOCK_TRACKED_TYPES.has(entityType || "");
}

function categoryForProduct(product: { groupPath?: string | null; name?: string | null }) {
  const source = `${product.groupPath ?? ""} ${product.name ?? ""}`.toLowerCase();
  if (!source.trim()) return "";
  for (const category of INVENTORY_CATEGORIES) {
    if (category === "Прочее") continue;
    if (source.includes(category.toLowerCase())) return category;
  }
  if (source.includes("фильтр") && source.includes("масл")) return "Масляные фильтры";
  if (source.includes("фильтр") && source.includes("возд")) return "Воздушные фильтры";
  if (source.includes("фильтр") && source.includes("салон")) return "Салонные фильтры";
  if (source.includes("фильтр") && source.includes("топлив")) return "Топливные фильтры";
  if (source.includes("трансмис")) return "Трансмиссионное масло";
  if (source.includes("масло")) return "Моторное масло";
  return "Прочее";
}

function cellFor(product: { cell?: string | null }, balance?: { slotName?: string | null } | null) {
  return cleanText(balance?.slotName) ?? cleanText(product.cell);
}

function productMatchesScope(
  product: {
    id: string;
    groupPath?: string | null;
    brand?: string | null;
    cell?: string | null;
    name?: string | null;
  },
  balance: { slotName?: string | null } | null,
  scope: ReturnType<typeof normalizeScope>,
  options: ReturnType<typeof normalizeOptions>
) {
  const category = categoryForProduct(product);
  const cell = cellFor(product, balance);
  if (scope.type === "WAREHOUSE") return true;
  if (scope.type === "CATEGORIES") {
    if (!category) return options.includeUncategorized && scope.categories.includes("__uncategorized");
    return scope.categories.includes(category);
  }
  if (scope.type === "GROUPS") {
    const group = product.groupPath ?? "";
    return scope.groups.some((item) => group === item || group.includes(item));
  }
  if (scope.type === "BRANDS") return scope.brands.includes(product.brand ?? "");
  if (scope.type === "CELLS") {
    if (!cell) return options.includeWithoutCell && scope.cells.includes("__without_cell");
    return scope.cells.includes(cell);
  }
  if (scope.type === "PRODUCTS") {
    return scope.productIds.includes(product.id) || (!!product.id && scope.productIds.includes(product.id));
  }
  return true;
}

async function nextInventoryNumber(tx: Tx, organizationId: string, date = new Date()) {
  const year = date.getFullYear();
  const from = new Date(year, 0, 1);
  const to = new Date(year + 1, 0, 1);
  const count = await tx.inventorySession.count({
    where: {
      organizationId,
      createdAt: { gte: from, lt: to },
    },
  });
  return `ИНВ-${year}-${String(count + 1).padStart(4, "0")}`;
}

async function writeAudit(
  tx: Tx,
  input: {
    sessionId: string;
    lineId?: string | null;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
    user?: User;
    source?: string;
  }
) {
  await tx.inventoryAuditLog.create({
    data: {
      inventorySessionId: input.sessionId,
      inventoryLineId: input.lineId ?? null,
      action: input.action,
      oldValueJson: input.oldValue === undefined ? Prisma.JsonNull : toJson(input.oldValue),
      newValueJson: input.newValue === undefined ? Prisma.JsonNull : toJson(input.newValue),
      userId: input.user?.login ?? null,
      userName: input.user?.name ?? null,
      source: input.source ?? "UI",
    },
  });
}

async function ensureOrganizationWarehouse(organizationId: string, warehouseId: string) {
  const [organization, warehouse] = await Promise.all([
    prisma.localOrganization.findUnique({ where: { id: organizationId } }),
    prisma.localStore.findUnique({ where: { id: warehouseId } }),
  ]);
  if (!organization || organization.archivedAt) return { ok: false as const, error: "Организация не найдена или архивирована" };
  if (!warehouse || warehouse.archived) return { ok: false as const, error: "Склад не найден или архивирован" };
  if (warehouse.organizationId && warehouse.organizationId !== organization.id) {
    return { ok: false as const, error: "Склад относится к другой организации" };
  }
  return { ok: true as const, organization, warehouse };
}

async function buildScopeRows(
  client: Tx | typeof prisma,
  input: {
    organizationId: string;
    warehouseId: string;
    scope: ReturnType<typeof normalizeScope>;
    options: ReturnType<typeof normalizeOptions>;
  }
): Promise<ScopeRow[]> {
  const balances = await client.localStockBalance.findMany({
    where: { storeId: input.warehouseId },
    include: { product: true },
    orderBy: [{ product: { name: "asc" } }],
  });

  const rows: ScopeRow[] = [];
  const seenProducts = new Set<string>();
  for (const balance of balances) {
    const product = balance.product;
    if (!stockTracked(product.entityType)) continue;
    const hasStock = !balance.quantity.equals(ZERO) || !balance.reserve.equals(ZERO);
    if (product.archived && !hasStock && !input.options.includeArchivedWithStock) continue;
    if (!hasStock && !input.options.includeZeroStock) continue;
    if (!productMatchesScope(product, balance, input.scope, input.options)) continue;
    const cellId = cellFor(product, balance);
    rows.push({
      productId: product.id,
      warehouseId: input.warehouseId,
      cellId,
      batchId: null,
      unitId: product.uomName ?? null,
      snapshotQuantity: balance.quantity,
      snapshotReservedQuantity: balance.reserve,
      snapshotAvailableQuantity: balance.available,
      unitCostSnapshotCents: balance.buyPriceCents ?? product.buyPriceCents,
      stockVersion: Math.round(balance.syncedAt.getTime() / 1000),
      productName: product.name,
    });
    seenProducts.add(product.id);
  }

  if (input.options.includeZeroStock) {
    const products = await client.localProduct.findMany({
      where: {
        archived: false,
        entityType: { in: [...STOCK_TRACKED_TYPES] },
        id: { notIn: [...seenProducts] },
      },
      orderBy: [{ name: "asc" }],
      take: 5000,
    });
    for (const product of products) {
      if (!productMatchesScope(product, null, input.scope, input.options)) continue;
      rows.push({
        productId: product.id,
        warehouseId: input.warehouseId,
        cellId: cleanText(product.cell),
        batchId: null,
        unitId: product.uomName ?? null,
        snapshotQuantity: ZERO,
        snapshotReservedQuantity: ZERO,
        snapshotAvailableQuantity: ZERO,
        unitCostSnapshotCents: product.buyPriceCents,
        stockVersion: 0,
        productName: product.name,
      });
    }
  }

  return rows;
}

function mapSession(row: Prisma.InventorySessionGetPayload<{
  include: { organization: true; warehouse: true; _count: { select: { lines: true } } };
}>) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    countMode: row.countMode,
    warehouseMode: row.warehouseMode,
    scopeType: row.scopeType,
    scope: row.scopeJson,
    options: row.optionsJson,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    responsibleId: row.responsibleId ?? "",
    createdByName: row.createdByName ?? "",
    comment: row.comment ?? "",
    totalLines: row.totalLines || row._count.lines,
    countedLines: row.countedLines,
    matchingLines: row.matchingLines,
    shortageLines: row.shortageLines,
    surplusLines: row.surplusLines,
    recountRequiredLines: row.recountRequiredLines,
    totalShortageCostCents: row.totalShortageCostCents,
    totalSurplusCostCents: row.totalSurplusCostCents,
    managementExpenseCents: row.managementExpenseCents,
    technicalAdjustmentCents: row.technicalAdjustmentCents,
    snapshotAt: row.snapshotAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    countingCompletedAt: row.countingCompletedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    postedAt: row.postedAt?.toISOString() ?? null,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapLine(row: Prisma.InventoryLineGetPayload<{
  include: { product: true; countEntries: { orderBy: { sequence: "asc" } } };
}>) {
  const product = row.product;
  return {
    id: row.id,
    inventorySessionId: row.inventorySessionId,
    productId: row.productId,
    name: product?.name ?? "Товар удалён",
    article: product?.article ?? "",
    code: product?.code ?? "",
    ean: product?.barcodeEan13 ?? product?.barcodeEan8 ?? product?.barcodeCode128 ?? "",
    brand: product?.brand ?? "",
    category: product ? categoryForProduct(product) : "",
    groupPath: product?.groupPath ?? "",
    imageHref: product?.imageHref ?? "",
    cellId: row.cellId ?? "",
    batchId: row.batchId ?? "",
    unitId: row.unitId ?? product?.uomName ?? "шт",
    snapshotQuantity: decimalToNumber(row.snapshotQuantity),
    snapshotReservedQuantity: decimalToNumber(row.snapshotReservedQuantity),
    snapshotAvailableQuantity: decimalToNumber(row.snapshotAvailableQuantity),
    expectedQuantityAtCount: decimalToNumber(row.expectedQuantityAtCount),
    firstCountQuantity: row.firstCountQuantity == null ? null : decimalToNumber(row.firstCountQuantity),
    secondCountQuantity: row.secondCountQuantity == null ? null : decimalToNumber(row.secondCountQuantity),
    finalQuantity: row.finalQuantity == null ? null : decimalToNumber(row.finalQuantity),
    differenceQuantity: row.differenceQuantity == null ? null : decimalToNumber(row.differenceQuantity),
    unitCostSnapshotCents: row.unitCostSnapshotCents,
    differenceCostCents: row.differenceCostCents,
    countedAt: row.countedAt?.toISOString() ?? null,
    countedById: row.countedById ?? "",
    recountedAt: row.recountedAt?.toISOString() ?? null,
    recountedById: row.recountedById ?? "",
    status: row.status,
    proposedAction: row.proposedAction ?? "",
    finalAction: row.finalAction ?? "",
    reasonCode: row.reasonCode ?? "",
    comment: row.comment ?? "",
    requiresRecount: row.requiresRecount,
    affectsManagementProfit: row.affectsManagementProfit,
    isUnexpected: row.isUnexpected,
    exclusionReason: row.exclusionReason ?? "",
    stockVersion: row.stockVersion,
    countEntries: row.countEntries.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      quantity: decimalToNumber(entry.quantity),
      counterId: entry.counterId ?? "",
      countedAt: entry.countedAt.toISOString(),
      comment: entry.comment ?? "",
      source: entry.source,
    })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function recalculateSessionSummary(tx: Tx, sessionId: string) {
  const lines = await tx.inventoryLine.findMany({ where: { inventorySessionId: sessionId } });
  let countedLines = 0;
  let matchingLines = 0;
  let shortageLines = 0;
  let surplusLines = 0;
  let recountRequiredLines = 0;
  let totalShortageCostCents = 0;
  let totalSurplusCostCents = 0;
  let managementExpenseCents = 0;
  let technicalAdjustmentCents = 0;

  for (const line of lines) {
    if (line.status === "EXCLUDED") continue;
    if (line.finalQuantity != null) countedLines += 1;
    if (line.requiresRecount) recountRequiredLines += 1;
    const diff = line.differenceQuantity?.toNumber() ?? null;
    const cost = Math.abs(line.differenceCostCents ?? 0);
    if (diff === 0) matchingLines += 1;
    if (diff != null && diff < 0) {
      shortageLines += 1;
      totalShortageCostCents += cost;
      if (line.affectsManagementProfit) managementExpenseCents += cost;
      else technicalAdjustmentCents += cost;
    }
    if (diff != null && diff > 0) {
      surplusLines += 1;
      totalSurplusCostCents += cost;
      if (!line.affectsManagementProfit) technicalAdjustmentCents += cost;
    }
  }

  await tx.inventorySession.update({
    where: { id: sessionId },
    data: {
      totalLines: lines.length,
      countedLines,
      matchingLines,
      shortageLines,
      surplusLines,
      recountRequiredLines,
      totalShortageCostCents,
      totalSurplusCostCents,
      managementExpenseCents,
      technicalAdjustmentCents,
      version: { increment: 1 },
    },
  });
}

async function movementsDeltaDuringCount(tx: Tx, line: { productId: string | null; warehouseId: string; cellId: string | null }, from: Date | null, to: Date) {
  if (!from || !line.productId) return ZERO;
  const rows = await tx.inventoryLedgerEntry.findMany({
    where: {
      productId: line.productId,
      storeId: line.warehouseId,
      createdAt: { gt: from, lte: to },
      sourceType: { not: "INVENTORY_SESSION" },
      OR: [{ cellId: line.cellId }, { cellId: null }],
    },
    select: { quantityDelta: true },
  });
  return rows.reduce((sum, row) => sum.plus(row.quantityDelta), ZERO);
}

function countOutcome(input: {
  quantity: Prisma.Decimal;
  expected: Prisma.Decimal;
  firstQuantity?: Prisma.Decimal | null;
  sequence: number;
  reserve: Prisma.Decimal;
  unitCostCents: number | null;
}) {
  const difference = input.quantity.minus(input.expected);
  const differenceAbs = Math.abs(difference.toNumber());
  const expectedAbs = Math.abs(input.expected.toNumber());
  const percentDiff = expectedAbs > 0 ? differenceAbs / expectedAbs : differenceAbs > 0 ? 1 : 0;
  const cost = costForDifference(difference, input.unitCostCents);
  const needsRecountByRules =
    input.sequence === 1 &&
    (differenceAbs > 5 || percentDiff > 0.2 || cost > 50_000 || input.expected.lt(0) || (input.reserve.gt(0) && !difference.equals(ZERO)));
  const secondDiffers = input.sequence > 1 && input.firstQuantity != null && !input.firstQuantity.equals(input.quantity);
  const status = difference.equals(ZERO)
    ? "COUNTED"
    : secondDiffers
      ? "PROBLEM"
      : needsRecountByRules
        ? "RECOUNT_REQUIRED"
        : input.quantity.equals(ZERO)
          ? "ZERO_CONFIRMED"
          : "COUNTED";
  const proposedAction = difference.lt(0)
    ? "SHORTAGE_EXPENSE"
    : difference.gt(0)
      ? "SURPLUS_RECEIPT"
      : "NO_ACTION";

  return {
    difference,
    cost,
    requiresRecount: needsRecountByRules,
    status,
    proposedAction,
  };
}

export async function listInventorySessions(params: InventorySessionFilters = {}) {
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const where: Prisma.InventorySessionWhereInput = {};
  if (params.organizationId) where.organizationId = params.organizationId;
  if (params.warehouseId) where.warehouseId = params.warehouseId;
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.onlyWithDiscrepancies) {
    where.OR = [{ shortageLines: { gt: 0 } }, { surplusLines: { gt: 0 } }];
  }
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {
      gte: params.dateFrom ? new Date(params.dateFrom) : undefined,
      lte: params.dateTo ? new Date(params.dateTo) : undefined,
    };
  }

  const [sessions, total, statusCounts, recentDifferences] = await Promise.all([
    prisma.inventorySession.findMany({
      where,
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.inventorySession.count({ where }),
    prisma.inventorySession.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.inventoryLine.findMany({
      where: { differenceQuantity: { not: null }, NOT: { differenceQuantity: 0 } },
      include: { product: true, session: { include: { warehouse: true } }, countEntries: { orderBy: { sequence: "asc" } } },
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
    }),
  ]);

  const summaryRows = await prisma.inventorySession.aggregate({
    where,
    _sum: {
      shortageLines: true,
      surplusLines: true,
      totalShortageCostCents: true,
      totalSurplusCostCents: true,
      technicalAdjustmentCents: true,
      managementExpenseCents: true,
    },
  });

  return {
    sessions: sessions.map(mapSession),
    total,
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])),
    summary: {
      shortageLines: summaryRows._sum.shortageLines ?? 0,
      surplusLines: summaryRows._sum.surplusLines ?? 0,
      totalShortageCostCents: summaryRows._sum.totalShortageCostCents ?? 0,
      totalSurplusCostCents: summaryRows._sum.totalSurplusCostCents ?? 0,
      discrepancyCostCents: (summaryRows._sum.totalShortageCostCents ?? 0) + (summaryRows._sum.totalSurplusCostCents ?? 0),
      technicalAdjustmentCents: summaryRows._sum.technicalAdjustmentCents ?? 0,
      managementExpenseCents: summaryRows._sum.managementExpenseCents ?? 0,
    },
    recentDifferences: recentDifferences.map(mapLine),
  };
}

export async function createInventorySession(input: CreateInventorySessionInput, user: User): Promise<InventoryResult<{ session: ReturnType<typeof mapSession> }>> {
  const organizationId = cleanText(input.organizationId);
  const warehouseId = cleanText(input.warehouseId);
  if (!organizationId) return { ok: false, error: "Выберите организацию" };
  if (!warehouseId) return { ok: false, error: "Выберите склад" };
  const ownership = await ensureOrganizationWarehouse(organizationId, warehouseId);
  if (!ownership.ok) return { ok: false, error: ownership.error };

  const scope = normalizeScope(input.scope);
  const options = normalizeOptions(input.options);
  if (scope.type !== "WAREHOUSE") {
    const values = scope.type === "CATEGORIES" ? scope.categories
      : scope.type === "GROUPS" ? scope.groups
      : scope.type === "BRANDS" ? scope.brands
      : scope.type === "CELLS" ? scope.cells
      : scope.productIds;
    if (values.length === 0) return { ok: false, error: "Выберите область инвентаризации" };
  }

  const session = await prisma.$transaction(async (tx) => {
    const number = await nextInventoryNumber(tx, organizationId);
    const created = await tx.inventorySession.create({
      data: {
        organizationId,
        warehouseId,
        number,
        status: "DRAFT",
        countMode: normalizeCountMode(input.countMode),
        warehouseMode: normalizeWarehouseMode(input.warehouseMode),
        scopeType: scope.type,
        scopeJson: toJson(scope),
        optionsJson: toJson(options),
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        responsibleId: cleanText(input.responsibleId) ?? user.login,
        comment: cleanText(input.comment),
        createdById: user.login,
        createdByName: user.name,
      },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, { sessionId: created.id, action: "CREATE", newValue: { scope, options }, user });
    return created;
  });

  return { ok: true, data: { session: mapSession(session) } };
}

export async function getInventorySession(id: string) {
  const session = await prisma.inventorySession.findUnique({
    where: { id },
    include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
  });
  if (!session) return null;
  return mapSession(session);
}

export async function updateInventorySession(id: string, body: Partial<CreateInventorySessionInput>, user: User) {
  const current = await prisma.inventorySession.findUnique({ where: { id } });
  if (!current) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
  if (current.status === "POSTED" || current.status === "REVERSED") {
    return { ok: false as const, error: "Проведённую инвентаризацию нельзя редактировать" };
  }
  const scope = body.scope ? normalizeScope(body.scope) : null;
  const options = body.options ? normalizeOptions(body.options) : null;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.inventorySession.update({
      where: { id },
      data: {
        countMode: body.countMode == null ? undefined : normalizeCountMode(body.countMode),
        warehouseMode: body.warehouseMode == null ? undefined : normalizeWarehouseMode(body.warehouseMode),
        scopeType: scope?.type,
        scopeJson: scope ? toJson(scope) : undefined,
        optionsJson: options ? toJson(options) : undefined,
        responsibleId: body.responsibleId === undefined ? undefined : cleanText(body.responsibleId),
        comment: body.comment === undefined ? undefined : cleanText(body.comment),
        version: { increment: 1 },
      },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, { sessionId: id, action: "UPDATE_SETTINGS", oldValue: current, newValue: body, user });
    return row;
  });
  return { ok: true as const, data: { session: mapSession(updated) } };
}

export async function previewInventoryScope(sessionId: string): Promise<InventoryResult<{ total: number; rows: ScopeRow[] }>> {
  const session = await prisma.inventorySession.findUnique({ where: { id: sessionId } });
  if (!session) return { ok: false, error: "Инвентаризация не найдена", status: 404 };
  const rows = await buildScopeRows(prisma, {
    organizationId: session.organizationId,
    warehouseId: session.warehouseId,
    scope: normalizeScope(asRecord(session.scopeJson)),
    options: normalizeOptions(asRecord(session.optionsJson)),
  });
  return { ok: true, data: { total: rows.length, rows: rows.slice(0, 100) } };
}

export async function startInventorySession(sessionId: string, user: User): Promise<InventoryResult<{ session: ReturnType<typeof mapSession> }>> {
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({
      where: { id: sessionId },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (session.status !== "DRAFT") return { ok: false as const, error: "Начать можно только черновик" };

    const scope = normalizeScope(asRecord(session.scopeJson));
    const options = normalizeOptions(asRecord(session.optionsJson));
    const rows = await buildScopeRows(tx, {
      organizationId: session.organizationId,
      warehouseId: session.warehouseId,
      scope,
      options,
    });
    if (rows.length === 0) return { ok: false as const, error: "В выбранной области нет складских товаров" };

    const activeLocks = await tx.inventoryLock.findMany({
      where: {
        organizationId: session.organizationId,
        warehouseId: session.warehouseId,
        releasedAt: null,
        inventorySessionId: { not: session.id },
        productId: { in: rows.map((row) => row.productId) },
      },
      include: { session: true },
      take: 1,
    });
    if (activeLocks[0]) {
      return {
        ok: false as const,
        error: `Товар участвует в активной инвентаризации ${activeLocks[0].session.number}`,
      };
    }

    const now = new Date();
    await tx.inventoryLine.createMany({
      data: rows.map((row) => ({
        inventorySessionId: session.id,
        productId: row.productId,
        warehouseId: row.warehouseId,
        cellId: row.cellId,
        batchId: row.batchId,
        unitId: row.unitId,
        snapshotQuantity: row.snapshotQuantity,
        snapshotReservedQuantity: row.snapshotReservedQuantity,
        snapshotAvailableQuantity: row.snapshotAvailableQuantity,
        expectedQuantityAtCount: row.snapshotQuantity,
        unitCostSnapshotCents: row.unitCostSnapshotCents,
        stockVersion: row.stockVersion,
      })),
    });

    if (session.warehouseMode === "LOCKED") {
      await tx.inventoryLock.createMany({
        data: rows.map((row) => ({
          organizationId: session.organizationId,
          warehouseId: session.warehouseId,
          productId: row.productId,
          cellId: row.cellId,
          batchId: row.batchId,
          inventorySessionId: session.id,
        })),
      });
    }

    const updated = await tx.inventorySession.update({
      where: { id: session.id },
      data: {
        status: "COUNTING",
        snapshotAt: now,
        startedAt: now,
        totalLines: rows.length,
        version: { increment: 1 },
      },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, {
      sessionId: session.id,
      action: "START",
      newValue: { totalLines: rows.length, scope, options, locked: session.warehouseMode === "LOCKED" },
      user,
    });
    return { ok: true as const, data: { session: mapSession(updated) } };
  });
  return result;
}

export async function setInventoryCountingPaused(sessionId: string, paused: boolean, user: User) {
  const current = await prisma.inventorySession.findUnique({ where: { id: sessionId } });
  if (!current) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
  if (!["COUNTING", "PAUSED", "RECOUNT_REQUIRED"].includes(current.status)) {
    return { ok: false as const, error: "Статус инвентаризации не позволяет изменить паузу" };
  }
  const nextStatus = paused ? "PAUSED" : current.recountRequiredLines > 0 ? "RECOUNT_REQUIRED" : "COUNTING";
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.inventorySession.update({
      where: { id: sessionId },
      data: { status: nextStatus, version: { increment: 1 } },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, { sessionId, action: paused ? "PAUSE" : "RESUME", user });
    return row;
  });
  return { ok: true as const, data: { session: mapSession(updated) } };
}

export async function listInventoryLines(sessionId: string, params: { search?: string; status?: string; cell?: string; limit?: number; offset?: number } = {}) {
  const search = cleanText(params.search)?.toLowerCase();
  const where: Prisma.InventoryLineWhereInput = { inventorySessionId: sessionId };
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.cell) where.cellId = params.cell;
  if (search) {
    where.product = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { article: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcodeEan13: { contains: search, mode: "insensitive" } },
        { barcodeEan8: { contains: search, mode: "insensitive" } },
        { barcodeCode128: { contains: search, mode: "insensitive" } },
        { oem: { contains: search, mode: "insensitive" } },
      ],
    };
  }
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 300);
  const offset = Math.max(params.offset ?? 0, 0);
  const [lines, total] = await Promise.all([
    prisma.inventoryLine.findMany({
      where,
      include: { product: true, countEntries: { orderBy: { sequence: "asc" } } },
      orderBy: [{ cellId: "asc" }, { product: { name: "asc" } }],
      take: limit,
      skip: offset,
    }),
    prisma.inventoryLine.count({ where }),
  ]);
  return { lines: lines.map(mapLine), total };
}

export async function countInventoryLine(
  sessionId: string,
  lineId: string,
  body: { quantity?: unknown; confirmZero?: boolean; comment?: string; source?: string },
  user: User
): Promise<InventoryResult<{ line: ReturnType<typeof mapLine> }>> {
  const quantity = body.confirmZero ? ZERO : decimalFromInput(body.quantity);
  if (quantity == null) return { ok: false, error: "Введите фактическое количество или подтвердите ноль" };
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (!COUNTABLE_STATUSES.includes(session.status)) {
      return { ok: false as const, error: "Подсчёт сейчас недоступен" };
    }
    const line = await tx.inventoryLine.findFirst({ where: { id: lineId, inventorySessionId: sessionId } });
    if (!line) return { ok: false as const, error: "Строка инвентаризации не найдена", status: 404 };
    if (line.status === "EXCLUDED") return { ok: false as const, error: "Исключённую строку нельзя считать" };

    const entryCount = await tx.inventoryCountEntry.count({ where: { inventoryLineId: line.id } });
    const sequence = entryCount + 1;
    const countedAt = new Date();
    const movementDelta = session.warehouseMode === "LIVE"
      ? await movementsDeltaDuringCount(tx, line, session.snapshotAt, countedAt)
      : ZERO;
    const expected = line.snapshotQuantity.plus(movementDelta);
    const outcome = countOutcome({
      quantity,
      expected,
      firstQuantity: line.firstCountQuantity,
      sequence,
      reserve: line.snapshotReservedQuantity,
      unitCostCents: line.unitCostSnapshotCents,
    });

    await tx.inventoryCountEntry.create({
      data: {
        inventoryLineId: line.id,
        sequence,
        quantity,
        counterId: user.login,
        countedAt,
        comment: cleanText(body.comment),
        source: cleanText(body.source) ?? "MANUAL",
      },
    });

    const updated = await tx.inventoryLine.update({
      where: { id: line.id },
      data: {
        expectedQuantityAtCount: expected,
        firstCountQuantity: sequence === 1 ? quantity : undefined,
        secondCountQuantity: sequence > 1 ? quantity : undefined,
        finalQuantity: quantity,
        differenceQuantity: outcome.difference,
        differenceCostCents: outcome.cost,
        countedAt: sequence === 1 ? countedAt : line.countedAt,
        countedById: sequence === 1 ? user.login : line.countedById,
        recountedAt: sequence > 1 ? countedAt : line.recountedAt,
        recountedById: sequence > 1 ? user.login : line.recountedById,
        status: body.confirmZero ? "ZERO_CONFIRMED" : outcome.status,
        proposedAction: outcome.proposedAction,
        finalAction: line.finalAction ?? outcome.proposedAction,
        requiresRecount: outcome.requiresRecount && sequence === 1,
        comment: cleanText(body.comment) ?? line.comment,
        stockVersion: { increment: 1 },
      },
      include: { product: true, countEntries: { orderBy: { sequence: "asc" } } },
    });
    await recalculateSessionSummary(tx, sessionId);
    const nextSessionStatus = outcome.requiresRecount && sequence === 1 ? "RECOUNT_REQUIRED" : session.status === "RECOUNT_REQUIRED" ? "COUNTING" : session.status;
    await tx.inventorySession.update({ where: { id: sessionId }, data: { status: nextSessionStatus } });
    await writeAudit(tx, {
      sessionId,
      lineId: line.id,
      action: sequence === 1 ? "COUNT" : "RECOUNT",
      oldValue: { finalQuantity: line.finalQuantity, status: line.status },
      newValue: { quantity: quantity.toNumber(), expected: expected.toNumber(), difference: outcome.difference.toNumber(), status: updated.status },
      user,
      source: cleanText(body.source) ?? "MANUAL",
    });
    return { ok: true as const, data: { line: mapLine(updated) } };
  });
  return result;
}

function readImportRows(body: unknown) {
  if (Array.isArray(body)) return body;
  const record = asRecord(body);
  const rows = record.rows;
  return Array.isArray(rows) ? rows : [];
}

function importProductId(row: Record<string, unknown>) {
  return cleanText(row.productId)
    ?? cleanText(row["internal product ID"])
    ?? cleanText(row.internalProductId)
    ?? cleanText(row.id);
}

function importQuantityValue(row: Record<string, unknown>) {
  if (row.actual !== undefined) return row.actual;
  if (row["Фактически"] !== undefined) return row["Фактически"];
  if (row.fact !== undefined) return row.fact;
  if (row.quantity !== undefined) return row.quantity;
  return undefined;
}

function isBlankImportQuantity(value: unknown) {
  return value == null || String(value).trim() === "";
}

export async function validateInventoryImport(sessionId: string, body: unknown) {
  const rows = readImportRows(body);
  const productIds = rows
    .map((row) => importProductId(asRecord(row)))
    .filter((id): id is string => Boolean(id));
  const lines = productIds.length > 0
    ? await prisma.inventoryLine.findMany({
        where: { inventorySessionId: sessionId, productId: { in: productIds } },
        include: { product: true, countEntries: { orderBy: { sequence: "asc" } } },
      })
    : [];
  const lineByProduct = new Map(lines.map((line) => [line.productId, line]));
  const seen = new Set<string>();
  const errors: { row: number; productId?: string; error: string }[] = [];
  const preview: Array<{ row: number; lineId: string; productId: string; productName: string; quantity: number | null; comment: string; skipped: boolean }> = [];

  rows.forEach((rawRow, index) => {
    const row = asRecord(rawRow);
    const productId = importProductId(row);
    const quantityRaw = importQuantityValue(row);
    const comment = cleanText(row.comment) ?? cleanText(row["комментарий"]) ?? "";
    if (!productId) {
      errors.push({ row: index + 1, error: "Нет internal product ID" });
      return;
    }
    if (seen.has(productId)) {
      errors.push({ row: index + 1, productId, error: "Дубликат internal product ID" });
      return;
    }
    seen.add(productId);
    const line = lineByProduct.get(productId);
    if (!line) {
      errors.push({ row: index + 1, productId, error: "Товар не найден в выбранной инвентаризации" });
      return;
    }
    if (isBlankImportQuantity(quantityRaw)) {
      preview.push({ row: index + 1, lineId: line.id, productId, productName: line.product?.name ?? "", quantity: null, comment, skipped: true });
      return;
    }
    const quantity = decimalFromInput(quantityRaw);
    if (quantity == null) {
      errors.push({ row: index + 1, productId, error: "Фактическое количество должно быть неотрицательным числом" });
      return;
    }
    preview.push({ row: index + 1, lineId: line.id, productId, productName: line.product?.name ?? "", quantity: quantity.toNumber(), comment, skipped: false });
  });

  return {
    ok: errors.length === 0,
    rows: rows.length,
    importableRows: preview.filter((row) => !row.skipped).length,
    skippedBlankRows: preview.filter((row) => row.skipped).length,
    errors,
    preview,
  };
}

export async function executeInventoryImport(sessionId: string, body: unknown, user: User): Promise<InventoryResult<{
  importedRows: number;
  skippedBlankRows: number;
  errors: { row: number; productId?: string; error: string }[];
}>> {
  const validation = await validateInventoryImport(sessionId, body);
  if (!validation.ok) {
    return { ok: false, error: "Импорт содержит ошибки", status: 400 };
  }
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (!COUNTABLE_STATUSES.includes(session.status)) {
      return { ok: false as const, error: "Импорт результатов доступен только во время подсчёта" };
    }

    let importedRows = 0;
    for (const item of validation.preview) {
      if (item.skipped || item.quantity == null) continue;
      const line = await tx.inventoryLine.findFirst({ where: { id: item.lineId, inventorySessionId: sessionId } });
      if (!line) {
        return { ok: false as const, error: `Строка импорта ${item.row} больше не найдена`, status: 409 };
      }
      if (line.status === "EXCLUDED") continue;
      const quantity = new Prisma.Decimal(item.quantity);
      const entryCount = await tx.inventoryCountEntry.count({ where: { inventoryLineId: line.id } });
      const sequence = entryCount + 1;
      const countedAt = new Date();
      const movementDelta = session.warehouseMode === "LIVE"
        ? await movementsDeltaDuringCount(tx, line, session.snapshotAt, countedAt)
        : ZERO;
      const expected = line.snapshotQuantity.plus(movementDelta);
      const outcome = countOutcome({
        quantity,
        expected,
        firstQuantity: line.firstCountQuantity,
        sequence,
        reserve: line.snapshotReservedQuantity,
        unitCostCents: line.unitCostSnapshotCents,
      });

      await tx.inventoryCountEntry.create({
        data: {
          inventoryLineId: line.id,
          sequence,
          quantity,
          counterId: user.login,
          countedAt,
          comment: item.comment || null,
          source: "EXCEL",
        },
      });
      await tx.inventoryLine.update({
        where: { id: line.id },
        data: {
          expectedQuantityAtCount: expected,
          firstCountQuantity: sequence === 1 ? quantity : undefined,
          secondCountQuantity: sequence > 1 ? quantity : undefined,
          finalQuantity: quantity,
          differenceQuantity: outcome.difference,
          differenceCostCents: outcome.cost,
          countedAt: sequence === 1 ? countedAt : line.countedAt,
          countedById: sequence === 1 ? user.login : line.countedById,
          recountedAt: sequence > 1 ? countedAt : line.recountedAt,
          recountedById: sequence > 1 ? user.login : line.recountedById,
          status: quantity.equals(ZERO) ? "ZERO_CONFIRMED" : outcome.status,
          proposedAction: outcome.proposedAction,
          finalAction: line.finalAction ?? outcome.proposedAction,
          requiresRecount: outcome.requiresRecount && sequence === 1,
          comment: item.comment || line.comment,
          stockVersion: { increment: 1 },
        },
      });
      await writeAudit(tx, {
        sessionId,
        lineId: line.id,
        action: sequence === 1 ? "IMPORT_COUNT" : "IMPORT_RECOUNT",
        oldValue: { finalQuantity: line.finalQuantity, status: line.status },
        newValue: { quantity: quantity.toNumber(), expected: expected.toNumber(), difference: outcome.difference.toNumber() },
        user,
        source: "EXCEL",
      });
      importedRows += 1;
    }
    await recalculateSessionSummary(tx, sessionId);
    return {
      ok: true as const,
      data: {
        importedRows,
        skippedBlankRows: validation.skippedBlankRows,
        errors: [],
      },
    };
  });
  return result;
}

export async function completeInventoryCounting(sessionId: string, user: User) {
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (!["COUNTING", "RECOUNT_REQUIRED"].includes(session.status)) {
      return { ok: false as const, error: "Завершить можно только активный подсчёт" };
    }
    const problems = await tx.inventoryLine.findMany({
      where: {
        inventorySessionId: sessionId,
        status: { not: "EXCLUDED" },
        OR: [
          { finalQuantity: null },
          { AND: [{ requiresRecount: true }, { secondCountQuantity: null }] },
        ],
      },
      include: { product: true },
      take: 20,
    });
    if (problems.length > 0) {
      return {
        ok: false as const,
        error: `Есть незавершённые позиции: ${problems.map((line) => line.product?.name ?? line.id).join(", ")}`,
      };
    }
    await recalculateSessionSummary(tx, sessionId);
    const row = await tx.inventorySession.update({
      where: { id: sessionId },
      data: { status: "REVIEW", countingCompletedAt: new Date(), reviewedAt: new Date(), version: { increment: 1 } },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, { sessionId, action: "COMPLETE_COUNTING", user });
    return { ok: true as const, data: { session: mapSession(row) } };
  });
  return result;
}

export async function getInventoryReconciliation(sessionId: string) {
  const session = await getInventorySession(sessionId);
  if (!session) return null;
  const lines = await prisma.inventoryLine.findMany({
    where: { inventorySessionId: sessionId },
    include: { product: true, countEntries: { orderBy: { sequence: "asc" } } },
    orderBy: [{ differenceQuantity: "asc" }, { product: { name: "asc" } }],
  });
  const movements = await prisma.inventoryLedgerEntry.findMany({
    where: { sourceType: "INVENTORY_SESSION", sourceId: sessionId },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  return {
    session,
    lines: lines.map(mapLine),
    movements: movements.map((entry) => ({
      id: entry.id,
      movementType: entry.movementType,
      productId: entry.productId,
      storeId: entry.storeId,
      cellId: entry.cellId,
      quantityDelta: decimalToNumber(entry.quantityDelta),
      unitCostSnapshot: entry.unitCostSnapshot,
      totalCostSnapshot: entry.totalCostSnapshot,
      analyticsImpact: entry.analyticsImpact,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

export async function updateInventoryLineResolution(
  sessionId: string,
  lineId: string,
  body: { finalAction?: string; reasonCode?: string; comment?: string; affectsManagementProfit?: boolean; exclude?: boolean; exclusionReason?: string },
  user: User
) {
  const allowedActions = new Set([
    "NO_ACTION",
    "SHORTAGE_EXPENSE",
    "SHORTAGE_TECHNICAL",
    "SURPLUS_RECEIPT",
    "SURPLUS_TECHNICAL",
    "CELL_TRANSFER",
    "RECOUNT",
    "SKIP",
  ]);
  const current = await prisma.inventoryLine.findFirst({ where: { id: lineId, inventorySessionId: sessionId } });
  if (!current) return { ok: false as const, error: "Строка инвентаризации не найдена", status: 404 };
  const action = cleanText(body.finalAction) ?? current.finalAction ?? current.proposedAction ?? "NO_ACTION";
  if (!allowedActions.has(action)) return { ok: false as const, error: "Неизвестное действие по расхождению" };
  if (body.exclude && !cleanText(body.exclusionReason)) return { ok: false as const, error: "Укажите причину исключения строки" };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.inventoryLine.update({
      where: { id: lineId },
      data: body.exclude
        ? {
            status: "EXCLUDED",
            exclusionReason: cleanText(body.exclusionReason),
            finalAction: "SKIP",
            affectsManagementProfit: false,
          }
        : {
            finalAction: action,
            reasonCode: cleanText(body.reasonCode) ?? current.reasonCode,
            comment: body.comment === undefined ? undefined : cleanText(body.comment),
            affectsManagementProfit: body.affectsManagementProfit ?? (action === "SHORTAGE_EXPENSE"),
            requiresRecount: action === "RECOUNT",
            status: action === "RECOUNT" ? "RECOUNT_REQUIRED" : current.status,
          },
      include: { product: true, countEntries: { orderBy: { sequence: "asc" } } },
    });
    await recalculateSessionSummary(tx, sessionId);
    await writeAudit(tx, { sessionId, lineId, action: "RESOLUTION", oldValue: current, newValue: body, user });
    return row;
  });
  return { ok: true as const, data: { line: mapLine(updated) } };
}

export async function submitInventoryReview(sessionId: string, user: User) {
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (session.status !== "REVIEW") return { ok: false as const, error: "Передать можно только документ на сверке" };
    const unresolved = await tx.inventoryLine.count({
      where: {
        inventorySessionId: sessionId,
        status: { not: "EXCLUDED" },
        differenceQuantity: { not: 0 },
        finalAction: null,
      },
    });
    if (unresolved > 0) return { ok: false as const, error: "Выберите действие для всех расхождений" };
    const missingReasons = await tx.inventoryLine.count({
      where: {
        inventorySessionId: sessionId,
        status: { not: "EXCLUDED" },
        differenceQuantity: { not: 0 },
        finalAction: { notIn: ["NO_ACTION", "SKIP"] },
        reasonCode: null,
      },
    });
    if (missingReasons > 0) return { ok: false as const, error: "Укажите причины для всех расхождений" };
    const row = await tx.inventorySession.update({
      where: { id: sessionId },
      data: { status: "AWAITING_APPROVAL", reviewedAt: new Date(), version: { increment: 1 } },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, { sessionId, action: "SUBMIT_REVIEW", user });
    return { ok: true as const, data: { session: mapSession(row) } };
  });
  return result;
}

export async function approveInventorySession(sessionId: string, user: User) {
  if (user.role !== "owner") return { ok: false as const, error: "Подтвердить инвентаризацию может только владелец" };
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (session.status !== "AWAITING_APPROVAL" && session.status !== "REVIEW") {
      return { ok: false as const, error: "Документ ещё не готов к подтверждению" };
    }
    const row = await tx.inventorySession.update({
      where: { id: sessionId },
      data: { status: "AWAITING_APPROVAL", approvedAt: new Date(), approvedById: user.login, version: { increment: 1 } },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, { sessionId, action: "APPROVE", user });
    return { ok: true as const, data: { session: mapSession(row) } };
  });
  return result;
}

async function createResultDocument(
  tx: Tx,
  session: Prisma.InventorySessionGetPayload<{ include: { warehouse: true } }>,
  type: "receipt" | "writeoff",
  title: string,
  lines: Prisma.InventoryLineGetPayload<{ include: { product: true } }>[],
  affectsManagementProfit: boolean
) {
  if (lines.length === 0) return null;
  const now = new Date();
  const documentDate = now.toISOString().slice(0, 10);
  const sumCents = lines.reduce((sum, line) => sum + Math.abs(line.differenceCostCents ?? 0), 0);
  const document = await tx.localInventoryDocument.create({
    data: {
      type,
      name: `${session.number} ${title}`,
      momentAt: now,
      documentDate,
      status: "posted",
      applicable: true,
      sumCents,
      description: `Создано по результатам инвентаризации ${session.number}`,
      adjustmentType: affectsManagementProfit ? "expense" : "technical",
      adjustmentReason: title,
      affectsManagementProfit,
      storeId: session.warehouseId,
      storeNameSnapshot: session.warehouse.name,
      createdByLogin: session.createdById,
      createdByName: session.createdByName,
      raw: toJson({ inventorySessionId: session.id, source: "inventory" }),
      positions: {
        create: lines.map((line) => ({
          productId: line.productId,
          productName: line.product?.name ?? "Товар",
          quantity: line.differenceQuantity?.abs() ?? ZERO,
          priceCentsPerUnit: line.unitCostSnapshotCents ?? 0,
          slotName: line.cellId,
          raw: toJson({ inventoryLineId: line.id, finalAction: line.finalAction }),
        })),
      },
    },
  });
  return document;
}

function ledgerMovementForAction(action: string | null, diff: Prisma.Decimal | null) {
  if (!diff || diff.equals(ZERO) || action === "NO_ACTION" || action === "SKIP") return null;
  if (action === "SHORTAGE_TECHNICAL") return "INVENTORY_TECHNICAL_DECREASE";
  if (action === "SURPLUS_TECHNICAL") return "INVENTORY_TECHNICAL_INCREASE";
  if (action === "CELL_TRANSFER") return "INVENTORY_CELL_TRANSFER";
  if (diff.lt(0)) return "INVENTORY_SHORTAGE";
  if (diff.gt(0)) return "INVENTORY_SURPLUS";
  return null;
}

export async function postInventorySession(sessionId: string, body: { idempotencyKey?: string }, user: User) {
  if (user.role !== "owner") return { ok: false as const, error: "Провести инвентаризацию может только владелец" };
  const idempotencyKey = cleanText(body.idempotencyKey) ?? `post:${sessionId}`;
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({
      where: { id: sessionId },
      include: { warehouse: true, organization: true },
    });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (session.status === "POSTED") return { ok: true as const, data: { alreadyPosted: true } };
    if (session.lastPostIdempotencyKey === idempotencyKey && session.postedAt) {
      return { ok: true as const, data: { alreadyPosted: true } };
    }
    if (!["AWAITING_APPROVAL", "REVIEW"].includes(session.status) || !session.approvedAt) {
      return { ok: false as const, error: "Перед проведением завершите сверку и подтверждение владельцем" };
    }
    const lines = await tx.inventoryLine.findMany({
      where: { inventorySessionId: sessionId, status: { not: "EXCLUDED" } },
      include: { product: true },
    });
    const unfinished = lines.find((line) => line.finalQuantity == null || (line.differenceQuantity != null && !line.differenceQuantity.equals(ZERO) && !line.finalAction));
    if (unfinished) return { ok: false as const, error: "Не все строки готовы к проведению" };
    const missingReason = lines.find((line) => line.differenceQuantity != null && !line.differenceQuantity.equals(ZERO) && !line.reasonCode && line.finalAction !== "NO_ACTION" && line.finalAction !== "SKIP");
    if (missingReason) return { ok: false as const, error: "Для всех расхождений нужна причина" };

    for (const line of lines) {
      const movementType = ledgerMovementForAction(line.finalAction, line.differenceQuantity);
      if (!movementType || !line.productId || !line.differenceQuantity) continue;
      if (line.differenceQuantity.gt(0) && (line.unitCostSnapshotCents == null || line.unitCostSnapshotCents <= 0)) {
        return { ok: false as const, error: `Укажите себестоимость излишка: ${line.product?.name ?? line.id}` };
      }
      const current = await tx.localStockBalance.findUnique({
        where: { productId_storeId: { productId: line.productId, storeId: session.warehouseId } },
      });
      const currentQuantity = current?.quantity ?? ZERO;
      const currentReserve = current?.reserve ?? ZERO;
      const nextQuantity = currentQuantity.plus(line.differenceQuantity);
      if (nextQuantity.lt(currentReserve)) {
        return { ok: false as const, error: `Фактический остаток станет меньше резерва: ${line.product?.name ?? line.id}` };
      }
    }

    const shortageExpense = lines.filter((line) => line.finalAction === "SHORTAGE_EXPENSE");
    const shortageTechnical = lines.filter((line) => line.finalAction === "SHORTAGE_TECHNICAL");
    const surplusReceipt = lines.filter((line) => line.finalAction === "SURPLUS_RECEIPT");
    const surplusTechnical = lines.filter((line) => line.finalAction === "SURPLUS_TECHNICAL");
    const docs = {
      shortageExpense: await createResultDocument(tx, session, "writeoff", "Списание недостачи", shortageExpense, true),
      shortageTechnical: await createResultDocument(tx, session, "writeoff", "Техническая корректировка недостачи", shortageTechnical, false),
      surplusReceipt: await createResultDocument(tx, session, "receipt", "Оприходование излишка", surplusReceipt, false),
      surplusTechnical: await createResultDocument(tx, session, "receipt", "Техническая корректировка излишка", surplusTechnical, false),
    };

    for (const line of lines) {
      const movementType = ledgerMovementForAction(line.finalAction, line.differenceQuantity);
      if (!movementType || !line.productId || !line.differenceQuantity) continue;
      const analyticsImpact = line.affectsManagementProfit && line.finalAction === "SHORTAGE_EXPENSE";
      const totalCostSnapshot = costForDifference(line.differenceQuantity, line.unitCostSnapshotCents);
      const ledger = await tx.inventoryLedgerEntry.create({
        data: {
          sourceType: "INVENTORY_SESSION",
          sourceId: session.id,
          organizationId: session.organizationId,
          productId: line.productId,
          storeId: session.warehouseId,
          cellId: line.cellId,
          batchId: line.batchId,
          movementType,
          quantityDelta: line.differenceQuantity,
          unitCostSnapshot: line.unitCostSnapshotCents,
          totalCostSnapshot,
          analyticsImpact,
          createdById: user.login,
          createdByName: user.name,
          raw: toJson({ inventoryLineId: line.id, finalAction: line.finalAction, reasonCode: line.reasonCode }),
        },
      });
      const current = await tx.localStockBalance.findUnique({
        where: { productId_storeId: { productId: line.productId, storeId: session.warehouseId } },
      });
      const nextQuantity = (current?.quantity ?? ZERO).plus(line.differenceQuantity);
      const reserve = current?.reserve ?? ZERO;
      if (current) {
        await tx.localStockBalance.update({
          where: { id: current.id },
          data: {
            quantity: nextQuantity,
            available: nextQuantity.minus(reserve),
            buyPriceCents: line.differenceQuantity.gt(0) ? line.unitCostSnapshotCents ?? current.buyPriceCents : current.buyPriceCents,
            slotName: line.cellId ?? current.slotName,
            syncedAt: new Date(),
          },
        });
      } else {
        await tx.localStockBalance.create({
          data: {
            productId: line.productId,
            storeId: session.warehouseId,
            quantity: nextQuantity,
            reserve: ZERO,
            available: nextQuantity,
            buyPriceCents: line.unitCostSnapshotCents,
            slotName: line.cellId,
            syncedAt: new Date(),
          },
        });
      }
      const documentId =
        line.finalAction === "SHORTAGE_EXPENSE" ? docs.shortageExpense?.id
          : line.finalAction === "SHORTAGE_TECHNICAL" ? docs.shortageTechnical?.id
          : line.finalAction === "SURPLUS_RECEIPT" ? docs.surplusReceipt?.id
          : line.finalAction === "SURPLUS_TECHNICAL" ? docs.surplusTechnical?.id
          : null;
      await tx.inventoryMovementLink.create({
        data: {
          inventorySessionId: session.id,
          inventoryLineId: line.id,
          ledgerEntryId: ledger.id,
          documentType: documentId ? "LOCAL_INVENTORY_DOCUMENT" : null,
          documentId: documentId ?? null,
        },
      });
    }

    await tx.inventoryLock.updateMany({
      where: { inventorySessionId: session.id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    await recalculateSessionSummary(tx, session.id);
    await tx.inventorySession.update({
      where: { id: session.id },
      data: { status: "POSTED", postedAt: new Date(), lastPostIdempotencyKey: idempotencyKey, version: { increment: 1 } },
    });
    await writeAudit(tx, { sessionId: session.id, action: "POST", newValue: { idempotencyKey }, user });
    return { ok: true as const, data: { alreadyPosted: false } };
  });
  return result;
}

export async function reverseInventorySession(sessionId: string, body: { reason?: string; idempotencyKey?: string }, user: User) {
  if (user.role !== "owner") return { ok: false as const, error: "Обратную операцию может создать только владелец" };
  const reason = cleanText(body.reason);
  if (!reason) return { ok: false as const, error: "Укажите причину обратной операции" };
  const idempotencyKey = cleanText(body.idempotencyKey) ?? `reverse:${sessionId}`;
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (session.status === "REVERSED") return { ok: true as const, data: { alreadyReversed: true } };
    if (session.status !== "POSTED") return { ok: false as const, error: "Обратную операцию можно создать только для проведённого документа" };
    if (session.lastReverseIdempotencyKey === idempotencyKey && session.reversedAt) {
      return { ok: true as const, data: { alreadyReversed: true } };
    }
    const entries = await tx.inventoryLedgerEntry.findMany({
      where: { sourceType: "INVENTORY_SESSION", sourceId: session.id, movementType: { not: "INVENTORY_REVERSAL" } },
    });
    for (const entry of entries) {
      if (!entry.productId || !entry.storeId) continue;
      const reverseDelta = entry.quantityDelta.neg();
      const reverseEntry = await tx.inventoryLedgerEntry.create({
        data: {
          sourceType: "INVENTORY_SESSION",
          sourceId: session.id,
          organizationId: entry.organizationId,
          productId: entry.productId,
          storeId: entry.storeId,
          cellId: entry.cellId,
          batchId: entry.batchId,
          movementType: "INVENTORY_REVERSAL",
          quantityDelta: reverseDelta,
          unitCostSnapshot: entry.unitCostSnapshot,
          totalCostSnapshot: entry.totalCostSnapshot,
          analyticsImpact: entry.analyticsImpact,
          originalEntryId: entry.id,
          createdById: user.login,
          createdByName: user.name,
          raw: toJson({ reason, reversedInventoryEntryId: entry.id }),
        },
      });
      const current = await tx.localStockBalance.findUnique({
        where: { productId_storeId: { productId: entry.productId, storeId: entry.storeId } },
      });
      const nextQuantity = (current?.quantity ?? ZERO).plus(reverseDelta);
      const reserve = current?.reserve ?? ZERO;
      if (current) {
        await tx.localStockBalance.update({
          where: { id: current.id },
          data: { quantity: nextQuantity, available: nextQuantity.minus(reserve), syncedAt: new Date() },
        });
      } else {
        await tx.localStockBalance.create({
          data: {
            productId: entry.productId,
            storeId: entry.storeId,
            quantity: nextQuantity,
            reserve: ZERO,
            available: nextQuantity,
            buyPriceCents: entry.unitCostSnapshot,
            slotName: entry.cellId,
            syncedAt: new Date(),
          },
        });
      }
      await tx.inventoryMovementLink.create({
        data: {
          inventorySessionId: session.id,
          ledgerEntryId: reverseEntry.id,
          documentType: "INVENTORY_REVERSAL",
          documentId: session.id,
        },
      });
    }
    await tx.inventorySession.update({
      where: { id: session.id },
      data: { status: "REVERSED", reversedAt: new Date(), reverseReason: reason, lastReverseIdempotencyKey: idempotencyKey, version: { increment: 1 } },
    });
    await writeAudit(tx, { sessionId: session.id, action: "REVERSE", newValue: { reason, idempotencyKey }, user });
    return { ok: true as const, data: { alreadyReversed: false } };
  });
  return result;
}

export async function cancelInventorySession(sessionId: string, body: { reason?: string }, user: User) {
  const reason = cleanText(body.reason);
  if (!reason) return { ok: false as const, error: "Укажите причину отмены" };
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (session.status === "POSTED" || session.status === "REVERSED") {
      return { ok: false as const, error: "Проведённый документ отменяется только обратной операцией" };
    }
    await tx.inventoryLock.updateMany({
      where: { inventorySessionId: session.id, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    const row = await tx.inventorySession.update({
      where: { id: session.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } },
      include: { organization: true, warehouse: true, _count: { select: { lines: true } } },
    });
    await writeAudit(tx, { sessionId: session.id, action: "CANCEL", newValue: { reason }, user });
    return { ok: true as const, data: { session: mapSession(row) } };
  });
  return result;
}

export async function addInventoryProduct(
  sessionId: string,
  body: { productId?: string; ean?: string; name?: string; category?: string; code?: string; quantity?: unknown; cellId?: string },
  user: User
) {
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findUnique({ where: { id: sessionId } });
    if (!session) return { ok: false as const, error: "Инвентаризация не найдена", status: 404 };
    if (!COUNTABLE_STATUSES.includes(session.status)) return { ok: false as const, error: "Добавлять товар можно только во время подсчёта" };
    const productId = cleanText(body.productId);
    const ean = cleanText(body.ean);
    let product = productId
      ? await tx.localProduct.findFirst({ where: { OR: [{ id: productId }, { id: productId }] } })
      : null;
    if (!product && ean) {
      product = await tx.localProduct.findFirst({
        where: { OR: [{ barcodeEan13: ean }, { barcodeEan8: ean }, { barcodeCode128: ean }, { code: ean }] },
      });
    }
    if (!product) {
      const name = cleanText(body.name);
      if (!name) return { ok: false as const, error: "Товар не найден. Укажите название для черновика товара" };
      product = await tx.localProduct.create({
        data: {
          name,
          entityType: "product",
          groupPath: cleanText(body.category),
          code: cleanText(body.code) ?? ean,
          barcodeEan13: ean,
          uomName: "шт",
          searchText: [name, body.category, body.code, ean].filter(Boolean).join(" "),
          raw: toJson({ createdFromInventorySessionId: session.id }),
        },
      });
    }
    if (!stockTracked(product.entityType)) return { ok: false as const, error: "Услуги не добавляются в инвентаризацию" };
    const existing = await tx.inventoryLine.findFirst({
      where: { inventorySessionId: session.id, productId: product.id, cellId: cleanText(body.cellId) ?? cleanText(product.cell) },
    });
    if (existing) return { ok: false as const, error: "Товар уже есть в текущей инвентаризации" };
    const balance = await tx.localStockBalance.findUnique({
      where: { productId_storeId: { productId: product.id, storeId: session.warehouseId } },
    });
    const line = await tx.inventoryLine.create({
      data: {
        inventorySessionId: session.id,
        productId: product.id,
        warehouseId: session.warehouseId,
        cellId: cleanText(body.cellId) ?? cleanText(balance?.slotName) ?? cleanText(product.cell),
        unitId: product.uomName,
        snapshotQuantity: balance?.quantity ?? ZERO,
        snapshotReservedQuantity: balance?.reserve ?? ZERO,
        snapshotAvailableQuantity: balance?.available ?? ZERO,
        expectedQuantityAtCount: balance?.quantity ?? ZERO,
        unitCostSnapshotCents: balance?.buyPriceCents ?? product.buyPriceCents,
        stockVersion: balance ? Math.round(balance.syncedAt.getTime() / 1000) : 0,
        isUnexpected: true,
      },
      include: { product: true, countEntries: { orderBy: { sequence: "asc" } } },
    });
    await recalculateSessionSummary(tx, session.id);
    await writeAudit(tx, { sessionId: session.id, lineId: line.id, action: "ADD_PRODUCT", newValue: { productId: product.id }, user });
    return { ok: true as const, data: { line: mapLine(line) } };
  });
  if (result.ok && body.quantity !== undefined) {
    await countInventoryLine(sessionId, result.data.line.id, { quantity: body.quantity, source: "MANUAL" }, user);
  }
  return result;
}

export async function scanInventoryBarcode(sessionId: string, body: { barcode?: string; mode?: string }, user: User) {
  const barcode = cleanText(body.barcode);
  if (!barcode) return { ok: false as const, error: "Введите или отсканируйте штрихкод" };
  const products = await prisma.localProduct.findMany({
    where: { OR: [{ barcodeEan13: barcode }, { barcodeEan8: barcode }, { barcodeCode128: barcode }, { code: barcode }] },
    take: 10,
  });
  if (products.length === 0) return { ok: true as const, data: { status: "NOT_FOUND", barcode } };
  if (products.length > 1) {
    return { ok: true as const, data: { status: "CONFLICT", products: products.map((product) => ({ id: product.id, name: product.name, article: product.article })) } };
  }
  const product = products[0];
  const line = await prisma.inventoryLine.findFirst({
    where: { inventorySessionId: sessionId, productId: product.id },
    include: { product: true, countEntries: { orderBy: { sequence: "asc" } } },
  });
  if (!line) {
    return { ok: true as const, data: { status: "OUT_OF_SCOPE", product: { id: product.id, name: product.name, category: categoryForProduct(product) } } };
  }
  if (body.mode === "INCREMENT") {
    const next = new Prisma.Decimal((line.finalQuantity?.toNumber() ?? 0) + 1);
    const counted = await countInventoryLine(sessionId, line.id, { quantity: next.toString(), source: "BARCODE" }, user);
    if (!counted.ok) return counted;
    return { ok: true as const, data: { status: "COUNTED", line: counted.data.line } };
  }
  return { ok: true as const, data: { status: "FOUND", line: mapLine(line) } };
}

export async function movementsDuringInventory(sessionId: string) {
  const session = await prisma.inventorySession.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  const rows = await prisma.inventoryLedgerEntry.findMany({
    where: {
      storeId: session.warehouseId,
      createdAt: { gte: session.snapshotAt ?? session.createdAt, lte: session.countingCompletedAt ?? new Date() },
      sourceType: { not: "INVENTORY_SESSION" },
    },
    include: { product: true },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return {
    movements: rows.map((entry) => ({
      id: entry.id,
      productName: entry.product?.name ?? "",
      movementType: entry.movementType,
      quantityDelta: decimalToNumber(entry.quantityDelta),
      cellId: entry.cellId ?? "",
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}
