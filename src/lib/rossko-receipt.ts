import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { User } from "@/lib/auth";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import {
  createLocalStockDocument,
  quickCreateSupplier,
  supplierCounterpartyIdentityWhere,
  type StockDocumentSourceMetadata,
} from "@/lib/local-inventory-admin";
import {
  normalizeRosskoArticle,
  normalizeRosskoBrand,
  recommendedRosskoRetailCents,
  resolveOrCreateRosskoLocalProduct,
} from "@/lib/rossko-product-import";
import { rosskoConfig, rosskoOrders } from "@/lib/rossko";
import {
  calculateRosskoIncomingQuantities,
  normalizeRosskoOrderPartStatus,
} from "@/lib/rossko-order-status";

const MAX_RECEIPT_LINES = 240;
const ROSSKO_SOURCE = "rossko";

export type NormalizedRosskoOrderPart = {
  guid: string;
  article: string;
  normalizedArticle: string;
  brand: string;
  normalizedBrand: string;
  name: string;
  orderedQty: number;
  price: number;
  deliveryDays: number | null;
  deliveryDate: Date | null;
  status: number | null;
  comment: string | null;
  raw: unknown;
};

export type NormalizedRosskoOrder = {
  id: string;
  createdAt: Date | null;
  deliveryDate: Date | null;
  deliveryType: string | null;
  totalPrice: number | null;
  paymentStatus: string | null;
  stockAddress: string | null;
  parts: NormalizedRosskoOrderPart[];
};

export type RosskoReceiptLineAction =
  | "MATCHED_EXISTING"
  | "CREATE_PRODUCT"
  | "FULLY_RECEIVED"
  | "PROVIDER_CLOSED"
  | "CLOSED_MANUALLY"
  | "AMBIGUOUS_PRODUCT"
  | "AMBIGUOUS_SOURCE_LINE"
  | "SOURCE_STATUS_WARNING"
  | "INVALID_LINE";

export type RosskoReceiptPreviewLine = {
  sourceLineKey: string;
  partGuid: string;
  article: string;
  brand: string;
  name: string;
  orderedQty: number;
  alreadyReceivedQty: number;
  manualClosedQty: number;
  providerClosedQty: number;
  remainingQty: number;
  receiveQty: number;
  purchasePrice: number;
  rosskoStatus: number | null;
  rosskoStatusLabel: string;
  product: {
    id: string;
    name: string;
    article: string;
    matchType: string;
  } | null;
  action: RosskoReceiptLineAction;
  warnings: string[];
  priceDeviation: { previousPrice: number; currentPrice: number } | null;
};

export type RosskoReceiptPreview = {
  order: {
    id: string;
    createdAt: string | null;
    deliveryDate: string | null;
    deliveryType: string | null;
    totalPrice: number | null;
    stockAddress: string | null;
  };
  supplier: { id: string | null; name: string; willCreate: boolean };
  store: { id: string; name: string };
  stores: Array<{ id: string; name: string; isMain: boolean }>;
  summary: {
    sourceLines: number;
    readyLines: number;
    alreadyFullyReceivedLines: number;
    unmatchedLines: number;
    ambiguousLines: number;
    orderedQty: number;
    alreadyReceivedQty: number;
    manualClosedQty: number;
    providerClosedQty: number;
    closedQty: number;
    remainingQty: number;
  };
  lines: RosskoReceiptPreviewLine[];
};

export type RosskoReceiptDraftDecision = {
  sourceLineKey?: string;
  receiveQty?: number;
  selectedProductId?: string | null;
  createProduct?: boolean;
};

export class RosskoReceiptError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "ROSSKO_RECEIPT_INVALID",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RosskoReceiptError";
  }
}

type ReceiptDb = Prisma.TransactionClient;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function valueAt(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const found = Object.entries(row).find(([candidate]) => candidate.toLocaleLowerCase("ru-RU") === key.toLocaleLowerCase("ru-RU"));
  return found?.[1];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function textAt(row: Record<string, unknown>, key: string): string {
  return text(valueAt(row, key));
}

function numeric(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function numericAt(row: Record<string, unknown>, key: string): number | null {
  return numeric(valueAt(row, key));
}

function collection(value: unknown, itemKey: string): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => collection(item, itemKey));
  const row = record(value);
  if (!row) return [];
  const nested = valueAt(row, itemKey);
  if (nested !== undefined && nested !== value) return collection(nested, itemKey);
  return [row];
}

function collectRecords(root: unknown, limit = 1200): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  while (queue.length && result.length < limit) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const row = record(current);
    if (!row) continue;
    result.push(row);
    for (const nested of Object.values(row)) if (nested && typeof nested === "object") queue.push(nested);
  }
  return result;
}

function parseRosskoDate(value: unknown): Date | null {
  const source = text(value);
  if (!source) return null;
  const ru = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(.*)$/);
  const normalized = ru ? `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}${ru[4]}` : source;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = record(value);
  if (row) return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url").slice(0, 24);
}

function orderPartRecords(order: Record<string, unknown>): Record<string, unknown>[] {
  return collection(valueAt(order, "parts"), "part");
}

export function rosskoSourceLineKey(orderId: string, partGuid: string): string {
  return `rossko:${orderId}:${partGuid}`;
}

export function normalizeRosskoOrder(payload: unknown, requestedOrderId: string): NormalizedRosskoOrder {
  const orderId = requestedOrderId.trim();
  const candidates = collectRecords(payload)
    .filter((row) => textAt(row, "id") === orderId && valueAt(row, "parts") !== undefined)
    .sort((left, right) => orderPartRecords(right).length - orderPartRecords(left).length);
  const order = candidates[0];
  if (!order) throw new RosskoReceiptError(`Заказ ROSSKO №${orderId} не найден`, 404, "ROSSKO_ORDER_NOT_FOUND");

  const sourceParts = orderPartRecords(order);
  if (sourceParts.length > MAX_RECEIPT_LINES) {
    throw new RosskoReceiptError(
      `В заказе ROSSKO больше ${MAX_RECEIPT_LINES} позиций. Разделите приёмку перед импортом.`,
      409,
      "ROSSKO_ORDER_TOO_LARGE",
    );
  }
  const orderDeliveryDate = parseRosskoDate(valueAt(order, "delivery_date"));
  const detail = record(valueAt(order, "detail"));
  const parts = sourceParts.map<NormalizedRosskoOrderPart>((part) => {
    const article = textAt(part, "partnumber").replace(/[–—−]/g, "-");
    const brand = textAt(part, "brand");
    const price = numericAt(part, "price");
    const quantity = numericAt(part, "count");
    const delivery = numericAt(part, "delivery");
    const status = numericAt(part, "status");
    return {
      guid: textAt(part, "guid"),
      article,
      normalizedArticle: normalizeRosskoArticle(article),
      brand,
      normalizedBrand: normalizeRosskoBrand(brand),
      name: textAt(part, "name") || `${brand} ${article}`.trim(),
      orderedQty: quantity == null ? Number.NaN : quantity,
      price: price == null ? Number.NaN : price,
      deliveryDays: delivery == null ? null : delivery,
      deliveryDate: parseRosskoDate(valueAt(part, "delivery_date")) ?? orderDeliveryDate,
      status: status == null || !Number.isInteger(status) ? null : status,
      comment: textAt(part, "comment") || null,
      raw: part,
    };
  });

  return {
    id: textAt(order, "id"),
    createdAt: parseRosskoDate(valueAt(order, "created_date")),
    deliveryDate: orderDeliveryDate,
    deliveryType: detail ? textAt(detail, "delivery_type") || null : null,
    totalPrice: numericAt(order, "total_price"),
    paymentStatus: textAt(order, "payment_status") || null,
    stockAddress: textAt(order, "stock_address") || null,
    parts,
  };
}

export function rosskoStatusPresentation(status: number | null) {
  const normalized = normalizeRosskoOrderPartStatus(status);
  return { label: normalized.label, warning: normalized.warning };
}

type SourcePartGroup = { part: NormalizedRosskoOrderPart; ambiguous: boolean; duplicateCount: number };

export function groupRosskoOrderParts(parts: NormalizedRosskoOrderPart[]): SourcePartGroup[] {
  const byGuid = new Map<string, NormalizedRosskoOrderPart[]>();
  const missingGuid: SourcePartGroup[] = [];
  for (const part of parts) {
    if (!part.guid) {
      missingGuid.push({ part, ambiguous: false, duplicateCount: 1 });
      continue;
    }
    byGuid.set(part.guid, [...(byGuid.get(part.guid) ?? []), part]);
  }
  return [
    ...[...byGuid.values()].map((duplicates) => ({
      part: duplicates[0],
      duplicateCount: duplicates.length,
      ambiguous: new Set(duplicates.map((part) => stableJson(part.raw))).size > 1,
    })),
    ...missingGuid,
  ];
}

function rawProvider(raw: unknown): string {
  const row = record(raw);
  if (!row) return "";
  return [row.sourceProvider, row.provider, row.integrationProvider, row.source]
    .map((value) => text(value).toLocaleLowerCase("ru-RU"))
    .find((value) => value === ROSSKO_SOURCE || value.includes("rossko")) ?? "";
}

function legacyRosskoSupplierName(value: string): boolean {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[«»“”„‟"'\s._-]+/g, "");
  return normalized === "rossko" || normalized.includes("гринлайт") || normalized.includes("greenlight");
}

async function findRosskoSupplierCounterparty(tx: ReceiptDb, branchId: string) {
  const [suppliers, mappedProducts] = await Promise.all([
    tx.localCounterparty.findMany({
      where: { branchId, archived: false, AND: [supplierCounterpartyIdentityWhere()] },
      select: { id: true, name: true, displayName: true, raw: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 2_000,
    }),
    tx.localProduct.findMany({
      where: {
        branchId,
        archived: false,
        supplierCounterpartyId: { not: null },
        OR: [{ rosskoPartNumber: { not: null } }, { rosskoBrand: { not: null } }],
      },
      select: { supplierCounterpartyId: true },
      distinct: ["supplierCounterpartyId"],
      take: 50,
    }),
  ]);
  const display = (row: (typeof suppliers)[number]) => ({ id: row.id, name: row.displayName || row.name, raw: row.raw });
  const explicit = suppliers.filter((supplier) => rawProvider(supplier.raw) === ROSSKO_SOURCE);
  if (explicit.length === 1) return display(explicit[0]);
  if (explicit.length > 1) throw new RosskoReceiptError("Для филиала найдено несколько поставщиков с mapping ROSSKO", 409, "AMBIGUOUS_ROSSKO_SUPPLIER");

  const mappedIds = new Set(mappedProducts.map((product) => product.supplierCounterpartyId).filter((id): id is string => Boolean(id)));
  const fromImporter = suppliers.filter((supplier) => mappedIds.has(supplier.id));
  if (fromImporter.length === 1) return display(fromImporter[0]);
  if (fromImporter.length > 1) throw new RosskoReceiptError("ROSSKO importer использует несколько поставщиков в этом филиале", 409, "AMBIGUOUS_ROSSKO_SUPPLIER");

  const legacy = suppliers.filter((supplier) => legacyRosskoSupplierName(`${supplier.name} ${supplier.displayName}`));
  if (legacy.length === 1) return display(legacy[0]);
  if (legacy.length > 1) throw new RosskoReceiptError("Найдено несколько legacy-поставщиков ROSSKO", 409, "AMBIGUOUS_ROSSKO_SUPPLIER");
  return null;
}

export async function resolveRosskoSupplierCounterparty(tx: ReceiptDb, branchId: string, createIfMissing: boolean) {
  await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`rossko-supplier:${branchId}`}, 0))::text AS locked
  `);
  const existing = await findRosskoSupplierCounterparty(tx, branchId);
  if (existing) {
    if (rawProvider(existing.raw) !== ROSSKO_SOURCE && createIfMissing) {
      await tx.localCounterparty.update({
        where: { id: existing.id },
        data: { raw: { ...(record(existing.raw) ?? {}), sourceProvider: ROSSKO_SOURCE } },
      });
    }
    return { id: existing.id, name: existing.name };
  }
  if (!createIfMissing) return null;
  const created = await quickCreateSupplier(
    { name: "ROSSKO", legalForm: "OTHER", comment: "Поставщик интеграции ROSSKO" },
    branchId,
    { transaction: tx, rawMetadata: { sourceProvider: ROSSKO_SOURCE } },
  );
  if (!created.ok) throw new RosskoReceiptError(created.error, 409, "ROSSKO_SUPPLIER_CREATE_FAILED");
  return { id: created.counterparty.id, name: created.counterparty.displayName || "ROSSKO" };
}

type ProductMatchRow = {
  id: string;
  name: string;
  article: string | null;
  brand: string | null;
  rosskoPartNumber: string | null;
  rosskoBrand: string | null;
  raw: Prisma.JsonValue | null;
};

function productMatch(part: NormalizedRosskoOrderPart, products: ProductMatchRow[]) {
  const sourceMapped = products.filter((product) => {
    const raw = record(product.raw);
    return rawProvider(product.raw) === ROSSKO_SOURCE && (
      text(raw?.rosskoPartGuid) === part.guid ||
      (normalizeRosskoArticle(product.rosskoPartNumber) === part.normalizedArticle && normalizeRosskoBrand(product.rosskoBrand) === part.normalizedBrand)
    );
  });
  const rosskoFields = products.filter((product) =>
    normalizeRosskoArticle(product.rosskoPartNumber) === part.normalizedArticle &&
    normalizeRosskoBrand(product.rosskoBrand) === part.normalizedBrand
  );
  const catalogFields = products.filter((product) =>
    normalizeRosskoArticle(product.article) === part.normalizedArticle &&
    normalizeRosskoBrand(product.brand) === part.normalizedBrand
  );
  const stages = [
    { rows: sourceMapped, matchType: "rossko_source_mapping" },
    { rows: rosskoFields, matchType: "rossko_brand_article" },
    { rows: catalogFields, matchType: "normalized_brand_article" },
  ];
  for (const stage of stages) {
    const unique = [...new Map(stage.rows.map((product) => [product.id, product])).values()];
    if (unique.length > 1) return { product: null, ambiguous: true, matchType: stage.matchType };
    if (unique.length === 1) return { product: unique[0], ambiguous: false, matchType: stage.matchType };
  }
  return { product: null, ambiguous: false, matchType: "none" };
}

function validSourcePart(part: NormalizedRosskoOrderPart) {
  return Boolean(
    part.guid &&
    part.normalizedArticle &&
    part.normalizedBrand &&
    part.name &&
    Number.isInteger(part.orderedQty) &&
    part.orderedQty > 0 &&
    Number.isFinite(part.price) &&
    part.price >= 0
  );
}

async function loadReceiptHistory(tx: ReceiptDb, branchId: string, orderId: string, sourceLineKeys: string[]) {
  if (!sourceLineKeys.length) return [];
  return tx.localInventoryDocumentPosition.findMany({
    where: {
      branchId,
      source: ROSSKO_SOURCE,
      externalCode: { in: sourceLineKeys },
      document: {
        branchId,
        type: "receipt",
        source: ROSSKO_SOURCE,
        externalCode: orderId,
        isDeleted: false,
        cancelledAt: null,
        status: { not: "cancelled" },
      },
    },
    select: {
      externalCode: true,
      quantity: true,
      priceCentsPerUnit: true,
      raw: true,
      document: { select: { status: true, applicable: true, cancelledAt: true, isDeleted: true, createdAt: true } },
    },
  });
}

async function loadManualClosedQuantityByLine(tx: ReceiptDb, branchId: string, orderId: string) {
  const events = await tx.branchAuditLog.findMany({
    where: {
      branchId,
      entityType: "rossko_order",
      entityId: orderId,
      action: "ROSSKO_ORDER_LINES_CLOSED_MANUALLY",
    },
    select: { metadata: true },
    orderBy: [{ createdAt: "asc" }],
  });
  const result = new Map<string, number>();
  for (const event of events) {
    const metadata = record(event.metadata);
    const lines = Array.isArray(metadata?.lines) ? metadata.lines : [];
    for (const rawLine of lines) {
      const line = record(rawLine);
      const sourceLineKey = text(line?.sourceLineKey);
      const quantity = numeric(line?.quantity) ?? 0;
      if (!sourceLineKey || quantity <= 0) continue;
      result.set(sourceLineKey, (result.get(sourceLineKey) ?? 0) + quantity);
    }
  }
  return result;
}

async function buildReceiptPreview(tx: ReceiptDb, context: BranchContext, order: NormalizedRosskoOrder, selectedStoreId?: string) {
  const branchId = context.branchId!;
  const groups = groupRosskoOrderParts(order.parts);
  const sourceLineKeys = groups.map(({ part }) => part.guid
    ? rosskoSourceLineKey(order.id, part.guid)
    : `rossko:${order.id}:invalid:${shortHash(stableJson(part.raw))}`);
  const [stores, supplier, products, history, manualClosedByLine] = await Promise.all([
    tx.localStore.findMany({
      where: { branchId, archived: false },
      select: { id: true, name: true, isMain: true },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    }),
    findRosskoSupplierCounterparty(tx, branchId),
    tx.localProduct.findMany({
      where: { branchId, archived: false, entityType: "product" },
      select: { id: true, name: true, article: true, brand: true, rosskoPartNumber: true, rosskoBrand: true, raw: true },
      take: 20_000,
    }),
    loadReceiptHistory(tx, branchId, order.id, sourceLineKeys),
    loadManualClosedQuantityByLine(tx, branchId, order.id),
  ]);
  if (!stores.length) throw new RosskoReceiptError("В активном филиале нет доступного склада", 409, "LOCAL_STORE_REQUIRED");
  const store = selectedStoreId ? stores.find((candidate) => candidate.id === selectedStoreId) : stores[0];
  if (!store) throw new RosskoReceiptError("Склад не найден в активном филиале", 403, "FOREIGN_STORE");

  const lines = groups.map<RosskoReceiptPreviewLine>(({ part, ambiguous, duplicateCount }, index) => {
    const sourceLineKey = sourceLineKeys[index];
    const relevantHistory = history
      .filter((position) => position.externalCode === sourceLineKey)
      .sort((left, right) => right.document.createdAt.getTime() - left.document.createdAt.getTime());
    const alreadyReceivedQty = relevantHistory.reduce((sum, position) => {
      const posted = position.document.status === "posted" && position.document.applicable && !position.document.cancelledAt && !position.document.isDeleted;
      return posted ? sum + position.quantity.toNumber() : sum;
    }, 0);
    const quantities = calculateRosskoIncomingQuantities({
      orderedQty: Number.isFinite(part.orderedQty) ? part.orderedQty : 0,
      postedReceivedQty: alreadyReceivedQty,
      manualClosedQty: manualClosedByLine.get(sourceLineKey) ?? 0,
      sourceStatus: part.status,
    });
    const { orderedQty, manualClosedQty, providerClosedQty, activeIncomingQty: remainingQty } = quantities;
    const latestPrice = relevantHistory[0]?.priceCentsPerUnit == null ? null : relevantHistory[0].priceCentsPerUnit / 100;
    const priceDeviation = latestPrice != null && Number.isFinite(part.price) && Math.abs(latestPrice - part.price) > 0.00001
      ? { previousPrice: latestPrice, currentPrice: part.price }
      : null;
    const match = productMatch(part, products);
    const status = quantities.status;
    const warnings: string[] = [];
    if (duplicateCount > 1 && !ambiguous) warnings.push("ROSSKO вернул строку повторно; одинаковые копии объединены.");
    if (ambiguous) warnings.push("ROSSKO вернул разные строки с одинаковым GUID. Автоматическая приёмка отключена.");
    if (providerClosedQty > 0) warnings.push(`Закрыто автоматически: ROSSKO — ${status.label.toLocaleLowerCase("ru-RU")}.`);
    else if (manualClosedQty > 0) warnings.push(`Локально закрыто ${manualClosedQty} шт. Оставшееся количество больше не учитывается как товар в пути.`);
    else if (status.warning) warnings.push(`Статус ROSSKO: ${status.label}. Позиция требует проверки.`);
    if (priceDeviation) warnings.push(`Цена ROSSKO изменилась: было ${priceDeviation.previousPrice} ₽ → сейчас ${priceDeviation.currentPrice} ₽.`);

    let action: RosskoReceiptLineAction;
    if (!validSourcePart(part)) action = "INVALID_LINE";
    else if (ambiguous) action = "AMBIGUOUS_SOURCE_LINE";
    else if (alreadyReceivedQty >= orderedQty) action = "FULLY_RECEIVED";
    else if (providerClosedQty > 0 && remainingQty <= 0) action = "PROVIDER_CLOSED";
    else if (manualClosedQty > 0 && remainingQty <= 0) action = "CLOSED_MANUALLY";
    else if (match.ambiguous) action = "AMBIGUOUS_PRODUCT";
    else if (status.warning) action = "SOURCE_STATUS_WARNING";
    else if (!match.product) action = "CREATE_PRODUCT";
    else action = "MATCHED_EXISTING";

    const defaultReceiveQty = ["INVALID_LINE", "AMBIGUOUS_SOURCE_LINE", "AMBIGUOUS_PRODUCT", "SOURCE_STATUS_WARNING", "FULLY_RECEIVED"].includes(action)
      ? 0
      : remainingQty;
    return {
      sourceLineKey,
      partGuid: part.guid,
      article: part.article,
      brand: part.brand,
      name: part.name,
      orderedQty,
      alreadyReceivedQty,
      manualClosedQty,
      providerClosedQty,
      remainingQty,
      receiveQty: defaultReceiveQty,
      purchasePrice: Number.isFinite(part.price) ? part.price : 0,
      rosskoStatus: part.status,
      rosskoStatusLabel: status.label,
      product: match.product ? {
        id: match.product.id,
        name: match.product.name,
        article: match.product.article ?? part.article,
        matchType: match.matchType,
      } : null,
      action,
      warnings,
      priceDeviation,
    };
  });

  return {
    order: {
      id: order.id,
      createdAt: order.createdAt?.toISOString() ?? null,
      deliveryDate: order.deliveryDate?.toISOString() ?? null,
      deliveryType: order.deliveryType,
      totalPrice: order.totalPrice,
      stockAddress: order.stockAddress,
    },
    supplier: { id: supplier?.id ?? null, name: supplier?.name ?? "ROSSKO", willCreate: !supplier },
    store: { id: store.id, name: store.name },
    stores,
    summary: {
      sourceLines: lines.length,
      readyLines: lines.filter((line) => ["MATCHED_EXISTING", "CREATE_PRODUCT"].includes(line.action) && line.remainingQty > 0).length,
      alreadyFullyReceivedLines: lines.filter((line) => line.action === "FULLY_RECEIVED").length,
      unmatchedLines: lines.filter((line) => line.action === "CREATE_PRODUCT").length,
      ambiguousLines: lines.filter((line) => line.action === "AMBIGUOUS_PRODUCT" || line.action === "AMBIGUOUS_SOURCE_LINE").length,
      orderedQty: lines.reduce((sum, line) => sum + line.orderedQty, 0),
      alreadyReceivedQty: lines.reduce((sum, line) => sum + line.alreadyReceivedQty, 0),
      manualClosedQty: lines.reduce((sum, line) => sum + line.manualClosedQty, 0),
      providerClosedQty: lines.reduce((sum, line) => sum + line.providerClosedQty, 0),
      closedQty: lines.reduce((sum, line) => sum + line.manualClosedQty + line.providerClosedQty, 0),
      remainingQty: lines.reduce((sum, line) => sum + line.remainingQty, 0),
    },
    lines,
  } satisfies RosskoReceiptPreview;
}

async function loadNormalizedOrder(orderId: string) {
  const cfg = await rosskoConfig();
  return normalizeRosskoOrder(await rosskoOrders(cfg, [Number(orderId)]), orderId);
}

function assertOrderId(value: string) {
  const orderId = value.trim();
  const numericId = Number(orderId);
  if (!/^\d+$/.test(orderId) || !Number.isSafeInteger(numericId) || numericId <= 0) {
    throw new RosskoReceiptError("Укажите корректный номер заказа ROSSKO", 400, "ROSSKO_ORDER_ID_INVALID");
  }
  return orderId;
}

async function writePreviewAudit(tx: ReceiptDb, context: BranchContext, preview: RosskoReceiptPreview) {
  const branchId = context.branchId!;
  const events: Prisma.BranchAuditLogCreateManyInput[] = [{
    businessGroupId: context.businessGroupId,
    branchId,
    userId: context.userId,
    action: "ROSSKO_RECEIPT_PREVIEWED",
    entityType: "rossko_order",
    entityId: preview.order.id,
    metadata: { sourceLines: preview.summary.sourceLines, remainingQty: preview.summary.remainingQty },
  }];
  const matched = preview.lines.filter((line) => line.product);
  if (matched.length) events.push({
    businessGroupId: context.businessGroupId,
    branchId,
    userId: context.userId,
    action: "ROSSKO_PRODUCT_MATCHED",
    entityType: "rossko_order",
    entityId: preview.order.id,
    metadata: { matchedCount: matched.length, productIds: matched.map((line) => line.product!.id) },
  });
  const deviations = preview.lines.filter((line) => line.priceDeviation);
  if (deviations.length) events.push({
    businessGroupId: context.businessGroupId,
    branchId,
    userId: context.userId,
    action: "ROSSKO_RECEIPT_PRICE_DEVIATION",
    entityType: "rossko_order",
    entityId: preview.order.id,
    metadata: { lines: deviations.map((line) => ({ sourceLineKey: line.sourceLineKey, ...line.priceDeviation })) },
  });
  const statusWarnings = preview.lines.filter((line) => rosskoStatusPresentation(line.rosskoStatus).warning);
  if (statusWarnings.length) events.push({
    businessGroupId: context.businessGroupId,
    branchId,
    userId: context.userId,
    action: "ROSSKO_RECEIPT_SOURCE_STATUS_WARNING",
    entityType: "rossko_order",
    entityId: preview.order.id,
    metadata: { lines: statusWarnings.map((line) => ({ sourceLineKey: line.sourceLineKey, status: line.rosskoStatus })) },
  });
  await tx.branchAuditLog.createMany({ data: events });
}

export async function previewRosskoReceipt(input: { context: BranchContext; actor: User; orderId: string; storeId?: string }) {
  const orderId = assertOrderId(input.orderId);
  if (!input.context.branchId) throw new RosskoReceiptError("Выберите активный филиал", 409, "CONCRETE_BRANCH_REQUIRED");
  const order = await loadNormalizedOrder(orderId);
  return prisma.$transaction(async (tx) => {
    const preview = await buildReceiptPreview(tx, input.context, order, input.storeId?.trim());
    await writePreviewAudit(tx, input.context, preview);
    return preview;
  }, { maxWait: 10_000, timeout: 30_000 });
}

function draftFingerprint(storeId: string, decisions: RosskoReceiptDraftDecision[]) {
  const canonical = decisions
    .map((line) => ({
      sourceLineKey: text(line.sourceLineKey),
      receiveQty: Number(line.receiveQty) || 0,
      selectedProductId: text(line.selectedProductId) || null,
      createProduct: line.createProduct === true,
    }))
    .filter((line) => line.receiveQty > 0)
    .sort((left, right) => left.sourceLineKey.localeCompare(right.sourceLineKey));
  return shortHash(stableJson({ storeId, lines: canonical }));
}

async function pendingDraftQuantityByLine(tx: ReceiptDb, branchId: string, orderId: string, sourceLineKeys: string[]) {
  const positions = await tx.localInventoryDocumentPosition.findMany({
    where: {
      branchId,
      source: ROSSKO_SOURCE,
      externalCode: { in: sourceLineKeys },
      document: {
        branchId,
        type: "receipt",
        source: ROSSKO_SOURCE,
        externalCode: orderId,
        status: "draft",
        applicable: false,
        isDeleted: false,
        cancelledAt: null,
      },
    },
    select: { externalCode: true, quantity: true },
  });
  const result = new Map<string, number>();
  for (const position of positions) {
    if (!position.externalCode) continue;
    result.set(position.externalCode, (result.get(position.externalCode) ?? 0) + position.quantity.toNumber());
  }
  return result;
}

function draftResult(document: {
  id: string;
  name: string;
  sumCents: number;
  storeId: string | null;
  storeNameSnapshot: string | null;
  positions: Array<{ quantity: Prisma.Decimal }>;
}, idempotent: boolean) {
  return {
    documentId: document.id,
    documentNumber: document.name,
    positionsCount: document.positions.length,
    totalQuantity: document.positions.reduce((sum, position) => sum + position.quantity.toNumber(), 0),
    totalSum: document.sumCents / 100,
    store: { id: document.storeId ?? "", name: document.storeNameSnapshot ?? "" },
    idempotent,
  };
}

export async function createRosskoReceiptDraft(input: {
  context: BranchContext;
  actor: User;
  orderId: string;
  storeId?: string;
  lines?: RosskoReceiptDraftDecision[];
}) {
  const orderId = assertOrderId(input.orderId);
  const branchId = input.context.branchId;
  if (!branchId) throw new RosskoReceiptError("Выберите активный филиал", 409, "CONCRETE_BRANCH_REQUIRED");
  const storeId = text(input.storeId);
  if (!storeId) throw new RosskoReceiptError("Выберите склад", 400, "LOCAL_STORE_REQUIRED");
  const decisions = Array.isArray(input.lines) ? input.lines : [];
  if (decisions.length > MAX_RECEIPT_LINES) {
    throw new RosskoReceiptError(`За один раз можно принять не больше ${MAX_RECEIPT_LINES} позиций`, 400, "TOO_MANY_RECEIPT_LINES");
  }
  for (const decision of decisions) {
    if (!text(decision.sourceLineKey)) {
      throw new RosskoReceiptError("Для каждой позиции требуется sourceLineKey", 400, "SOURCE_LINE_KEY_REQUIRED");
    }
    const receiveQty = Number(decision.receiveQty);
    if (!Number.isInteger(receiveQty) || receiveQty <= 0) {
      throw new RosskoReceiptError("Количество ROSSKO должно быть положительным целым числом", 400, "INVALID_RECEIVE_QTY");
    }
  }
  const fingerprint = draftFingerprint(storeId, decisions);
  const idempotencyKey = `rossko-receipt-draft:${branchId}:${orderId}:${fingerprint}`;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`rossko-receipt:${branchId}:${orderId}`}, 0))::text AS locked
    `);
    const drafts = await tx.localInventoryDocument.findMany({
      where: {
        branchId,
        type: "receipt",
        source: ROSSKO_SOURCE,
        externalCode: orderId,
        status: "draft",
        applicable: false,
        isDeleted: false,
      },
      include: { positions: true },
      orderBy: [{ createdAt: "desc" }],
    });
    const existing = drafts.find((document) => text(record(document.raw)?.idempotencyKey) === idempotencyKey);
    if (existing) return draftResult(existing, true);

    const order = await loadNormalizedOrder(orderId);
    const preview = await buildReceiptPreview(tx, input.context, order, storeId);
    const previewByKey = new Map(preview.lines.map((line) => [line.sourceLineKey, line]));
    const duplicateDecisions = decisions.map((line) => text(line.sourceLineKey)).filter(Boolean);
    if (new Set(duplicateDecisions).size !== duplicateDecisions.length) {
      throw new RosskoReceiptError("Одна source-позиция передана несколько раз", 409, "DUPLICATE_SOURCE_LINE_DECISION");
    }
    const requested = decisions.map((decision) => ({
      decision,
      line: previewByKey.get(text(decision.sourceLineKey)) ?? null,
      receiveQty: Number(decision.receiveQty),
    }));
    if (!requested.length) {
      const fullyReceived = preview.lines.length > 0 && preview.lines.every((line) => line.remainingQty <= 0);
      throw new RosskoReceiptError(
        fullyReceived ? "Заказ полностью принят." : "Укажите фактически принятое количество хотя бы для одной позиции",
        409,
        fullyReceived ? "ORDER_FULLY_RECEIVED" : "EMPTY_RECEIPT_DRAFT",
      );
    }

    const pending = await pendingDraftQuantityByLine(tx, branchId, orderId, requested.map(({ decision }) => text(decision.sourceLineKey)));
    for (const item of requested) {
      if (!item.line) throw new RosskoReceiptError("Позиция больше не найдена в заказе ROSSKO", 409, "SOURCE_LINE_NOT_FOUND");
      if (item.line.action === "INVALID_LINE" || item.line.action === "AMBIGUOUS_SOURCE_LINE") {
        throw new RosskoReceiptError("Нельзя автоматически принять неоднозначную source-позицию ROSSKO", 409, item.line.action);
      }
      if (["PROVIDER_CLOSED", "CLOSED_MANUALLY"].includes(item.line.action) || !normalizeRosskoOrderPartStatus(item.line.rosskoStatus).receivable) {
        throw new RosskoReceiptError(
          `Позиция со статусом «${item.line.rosskoStatusLabel}» не может попасть в приёмку. Обновите статус ROSSKO или закройте её локально.`,
          409,
          "ROSSKO_LINE_NOT_RECEIVABLE",
          { sourceLineKey: item.line.sourceLineKey, sourceStatus: item.line.rosskoStatus },
        );
      }
      const openDraftQty = pending.get(item.line.sourceLineKey) ?? 0;
      const availableToDraft = Math.max(0, item.line.remainingQty - openDraftQty);
      if (item.receiveQty > availableToDraft) {
        throw new RosskoReceiptError(
          `По этой позиции осталось принять ${availableToDraft} шт. Вы указали ${item.receiveQty}.`,
          409,
          "OVER_RECEIPT",
          { sourceLineKey: item.line.sourceLineKey, remainingQty: availableToDraft, requestedQty: item.receiveQty },
        );
      }
    }

    const supplier = await resolveRosskoSupplierCounterparty(tx, branchId, true);
    if (!supplier) throw new RosskoReceiptError("Не удалось определить поставщика ROSSKO", 409, "ROSSKO_SUPPLIER_REQUIRED");
    const selectedIds = [...new Set(requested.map(({ decision }) => text(decision.selectedProductId)).filter(Boolean))];
    const selectedProducts = selectedIds.length ? await tx.localProduct.findMany({
      where: { branchId, id: { in: selectedIds }, archived: false, entityType: "product" },
      select: { id: true, name: true },
    }) : [];
    const selectedById = new Map(selectedProducts.map((product) => [product.id, product]));
    const normalizedParts = new Map(groupRosskoOrderParts(order.parts).map(({ part }) => [
      part.guid ? rosskoSourceLineKey(order.id, part.guid) : `rossko:${order.id}:invalid:${shortHash(stableJson(part.raw))}`,
      part,
    ]));
    const documentPositions: Array<{ productId: string; quantity: number; price: number }> = [];
    const sourcePositions: StockDocumentSourceMetadata["positions"] = [];
    const createdProductIds: string[] = [];
    const matchedProductIds: string[] = [];

    for (const { decision, line, receiveQty } of requested) {
      const sourceLine = line!;
      const part = normalizedParts.get(sourceLine.sourceLineKey)!;
      const selectedId = text(decision.selectedProductId);
      let productId = selectedId || sourceLine.product?.id || "";
      if (selectedId) {
        if (!selectedById.has(selectedId)) throw new RosskoReceiptError("Выбранный товар не найден в активном филиале", 403, "FOREIGN_PRODUCT");
        matchedProductIds.push(selectedId);
      } else if (sourceLine.action === "AMBIGUOUS_PRODUCT") {
        throw new RosskoReceiptError("Для неоднозначной позиции выберите товар из каталога", 409, "AMBIGUOUS_PRODUCT");
      } else if (!productId) {
        if (decision.createProduct !== true) throw new RosskoReceiptError("Подтвердите создание отсутствующего товара", 409, "PRODUCT_DECISION_REQUIRED");
        const resolved = await resolveOrCreateRosskoLocalProduct({
          context: input.context,
          actor: input.actor,
          orderId,
          sourceLineKey: sourceLine.sourceLineKey,
          partGuid: part.guid,
          brand: part.brand,
          article: part.article,
          name: part.name,
          category: null,
          purchasePriceCents: Math.round(part.price * 100),
          retailPriceCents: recommendedRosskoRetailCents(Math.round(part.price * 100)),
          supplierCounterpartyId: supplier.id,
          transaction: tx,
        });
        productId = resolved.product.id;
        (resolved.created ? createdProductIds : matchedProductIds).push(productId);
      } else {
        matchedProductIds.push(productId);
      }

      documentPositions.push({ productId, quantity: receiveQty, price: part.price });
      sourcePositions.push({
        source: ROSSKO_SOURCE,
        externalCode: sourceLine.sourceLineKey,
        raw: {
          sourceProvider: ROSSKO_SOURCE,
          provider: ROSSKO_SOURCE,
          sourceOrderId: orderId,
          orderId,
          partGuid: part.guid,
          sourceLineKey: sourceLine.sourceLineKey,
          article: part.article,
          partNumber: part.article,
          brand: part.brand,
          orderedQty: part.orderedQty,
          alreadyReceivedAtImport: sourceLine.alreadyReceivedQty,
          remainingAtImport: sourceLine.remainingQty,
          sourcePrice: part.price,
          originalPrice: part.price,
          rosskoStatus: part.status,
          rosskoComment: part.comment,
        },
      });
    }

    const importedAt = new Date().toISOString();
    const created = await createLocalStockDocument({
      type: "receipt",
      applicable: false,
      storeId,
      counterpartyId: supplier.id,
      description: `Черновик приёмки из заказа ROSSKO №${orderId}. Остатки не увеличены.`,
      positions: documentPositions,
    }, input.actor, {
      transaction: tx,
      sourceMetadata: {
        source: ROSSKO_SOURCE,
        externalCode: orderId,
        raw: {
          sourceProvider: ROSSKO_SOURCE,
          sourceOrderId: orderId,
          sourceOrderCreatedAt: order.createdAt?.toISOString() ?? null,
          sourceStockAddress: order.stockAddress,
          idempotencyKey,
          importedAt,
          importedBy: input.actor.login,
        },
        positions: sourcePositions,
      },
    });
    if (!created.ok) throw new RosskoReceiptError(created.error ?? "Не удалось создать черновик приёмки", 409, "RECEIPT_DRAFT_CREATE_FAILED");

    const document = await tx.localInventoryDocument.findFirst({
      where: { branchId, id: created.document.id },
      include: { positions: true },
    });
    if (!document) throw new RosskoReceiptError("Созданный черновик не найден", 500, "RECEIPT_DRAFT_MISSING");
    const partial = requested.filter(({ line, receiveQty }) => receiveQty < line!.remainingQty);
    const deviations = requested.filter(({ line }) => line!.priceDeviation);
    const statusWarnings = requested.filter(({ line }) => rosskoStatusPresentation(line!.rosskoStatus).warning);
    const documentAudits: Prisma.LocalInventoryDocumentAuditLogCreateManyInput[] = [{
      branchId,
      documentId: document.id,
      action: "ROSSKO_RECEIPT_DRAFT_CREATED",
      statusAfter: "draft",
      message: "Черновик приёмки создан из заказа ROSSKO. Остатки не изменены.",
      newValue: { orderId, idempotencyKey, positionsCount: document.positions.length },
      createdById: input.actor.login,
      createdByName: input.actor.name,
    }];
    if (partial.length) documentAudits.push({
      branchId,
      documentId: document.id,
      action: "ROSSKO_RECEIPT_PARTIAL",
      statusAfter: "draft",
      message: "Создана частичная приёмка ROSSKO.",
      newValue: partial.map(({ line, receiveQty }) => ({
        sourceLineKey: line!.sourceLineKey,
        ordered: line!.orderedQty,
        alreadyReceived: line!.alreadyReceivedQty,
        remaining: line!.remainingQty,
        receivedNow: receiveQty,
      })),
      createdById: input.actor.login,
      createdByName: input.actor.name,
    });
    if (deviations.length) documentAudits.push({
      branchId,
      documentId: document.id,
      action: "ROSSKO_RECEIPT_PRICE_DEVIATION",
      statusAfter: "draft",
      message: "Цена ROSSKO отличается от последнего сохранённого snapshot.",
      newValue: deviations.map(({ line }) => ({ sourceLineKey: line!.sourceLineKey, ...line!.priceDeviation })),
      createdById: input.actor.login,
      createdByName: input.actor.name,
    });
    if (statusWarnings.length) documentAudits.push({
      branchId,
      documentId: document.id,
      action: "ROSSKO_RECEIPT_SOURCE_STATUS_WARNING",
      statusAfter: "draft",
      message: "Пользователь подтвердил фактическое получение строки со статусом-предупреждением ROSSKO.",
      newValue: statusWarnings.map(({ line, receiveQty }) => ({ sourceLineKey: line!.sourceLineKey, status: line!.rosskoStatus, receivedNow: receiveQty })),
      createdById: input.actor.login,
      createdByName: input.actor.name,
    });
    await tx.localInventoryDocumentAuditLog.createMany({ data: documentAudits });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: input.context.businessGroupId,
        branchId,
        userId: input.context.userId,
        action: "ROSSKO_RECEIPT_DRAFT_CREATED",
        entityType: "local_inventory_document",
        entityId: document.id,
        metadata: {
          orderId,
          idempotencyKey,
          createdProductIds,
          matchedProductIds: [...new Set(matchedProductIds)],
          positionsCount: document.positions.length,
          totalQuantity: document.positions.reduce((sum, position) => sum + position.quantity.toNumber(), 0),
        },
      },
    });
    return draftResult(document, false);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 120_000,
  });
}
