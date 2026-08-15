import { Prisma } from "@prisma/client";
import type { User } from "@/lib/auth";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import {
  groupRosskoOrderParts,
  normalizeRosskoOrder,
  rosskoSourceLineKey,
  type NormalizedRosskoOrder,
} from "@/lib/rossko-receipt";
import { normalizeRosskoArticle, normalizeRosskoBrand } from "@/lib/rossko-product-import";
import {
  calculateRosskoIncomingQuantities,
  classifyRosskoDelivery,
  normalizeRosskoOrderPartStatus,
  type RosskoOrderPartState,
} from "@/lib/rossko-order-status";
import { rosskoConfig, rosskoOrders } from "@/lib/rossko";

const ROSSKO_SOURCE = "rossko";
const MAX_TRACKED_ORDERS = 50;
const MAX_ORDER_LINES = 240;

export const ROSSKO_MANUAL_CLOSE_REASONS = [
  "SUPPLIER_CANCELLED",
  "UNAVAILABLE",
  "DELIVERY_FAILED",
  "CANCELLED_IN_ROSSKO",
  "NO_LONGER_NEEDED",
  "OTHER",
] as const;

export type RosskoManualCloseReason = (typeof ROSSKO_MANUAL_CLOSE_REASONS)[number];

export const ROSSKO_MANUAL_CLOSE_REASON_LABELS: Record<RosskoManualCloseReason, string> = {
  SUPPLIER_CANCELLED: "Поставщик отменил поставку",
  UNAVAILABLE: "Товар недоступен",
  DELIVERY_FAILED: "Доставка сорвана",
  CANCELLED_IN_ROSSKO: "Заказ отменён вручную в ROSSKO",
  NO_LONGER_NEEDED: "Заказ больше не нужен",
  OTHER: "Другое",
};

type SeedLine = {
  productId: string;
  name: string;
  brand: string;
  article: string;
  orderedQty: number;
  expectedAt: string | null;
};

type StoredOrderSeed = {
  externalOrderId: string;
  createdAt: string | null;
  orderedAt: string | null;
  expectedAt: string | null;
  comment: string | null;
  lines: SeedLine[];
};

type StoredSnapshotLine = {
  sourceLineKey: string;
  partGuid: string;
  productId: string;
  name: string;
  brand: string;
  article: string;
  orderedQty: number;
  purchasePrice: number;
  sourceStatus: number | null;
  deliveryDate: string | null;
  comment: string | null;
};

type StoredOrderSnapshot = {
  orderId: string;
  syncedAt: string;
  createdAt: string | null;
  deliveryDate: string | null;
  deliveryType: string | null;
  stockAddress: string | null;
  totalPrice: number | null;
  lines: StoredSnapshotLine[];
};

export type RosskoTrackedOrderSeedInput = {
  externalOrderId?: string;
  createdAt?: string | number | null;
  orderedAt?: string | number | null;
  expectedAt?: string | number | null;
  comment?: string | null;
  lines?: Array<{
    productId?: string;
    name?: string;
    title?: string;
    offerName?: string;
    brand?: string;
    article?: string;
    partnumber?: string;
    code?: string;
    orderedQty?: number;
    count?: number;
    expectedAt?: string | number | null;
  }>;
};

export type RosskoIncomingLine = {
  sourceLineKey: string;
  partGuid: string;
  productId: string;
  localProduct: { id: string; name: string; article: string | null } | null;
  name: string;
  brand: string;
  article: string;
  orderedQty: number;
  postedReceivedQty: number;
  manualClosedQty: number;
  providerClosedQty: number;
  activeIncomingQty: number;
  closedQty: number;
  sourceStatus: number | null;
  sourceStatusLabel: string;
  state: RosskoOrderPartState;
  stateLabel: string;
  expectedDate: string | null;
  previousExpectedDate: string | null;
  delayDays: number;
  canReceive: boolean;
  canClose: boolean;
  resolution: "ACTIVE" | "AUTO_CLOSED_BY_PROVIDER_STATUS" | "CLOSED_MANUALLY" | "RECEIVED";
  resolutionLabel: string;
};

export type RosskoIncomingHistoryItem = {
  id: string;
  at: string;
  action: string;
  label: string;
  actor: string | null;
  details: string | null;
};

export type RosskoIncomingOrder = {
  externalOrderId: string;
  createdAt: string | null;
  expectedDate: string | null;
  previousExpectedDate: string | null;
  deliveryType: string | null;
  stockAddress: string | null;
  updatedAt: string | null;
  syncError: string | null;
  status: string;
  statusLabel: string;
  isDelayed: boolean;
  isClosed: boolean;
  hasProviderCancellation: boolean;
  hasManualClosure: boolean;
  hasPartialReceipt: boolean;
  readyToReceive: boolean;
  summary: {
    orderedQty: number;
    postedReceivedQty: number;
    activeIncomingQty: number;
    closedQty: number;
    receivableQty: number;
  };
  lines: RosskoIncomingLine[];
  receiptDocuments: Array<{ id: string; number: string; status: string; createdAt: string; quantity: number }>;
  history: RosskoIncomingHistoryItem[];
};

export class RosskoIncomingError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "ROSSKO_INCOMING_INVALID",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RosskoIncomingError";
  }
}

type IncomingDb = Prisma.TransactionClient;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function dateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function currentServiceDateKey() {
  const timezone = process.env.APP_TIMEZONE?.trim() || "Europe/Kaliningrad";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

function assertOrderId(value: unknown) {
  const orderId = asText(value);
  if (!/^\d+$/.test(orderId) || !Number.isSafeInteger(Number(orderId)) || Number(orderId) <= 0) {
    throw new RosskoIncomingError("Укажите корректный номер заказа ROSSKO", 400, "ROSSKO_ORDER_ID_INVALID");
  }
  return orderId;
}

function normalizeSeed(input: RosskoTrackedOrderSeedInput): StoredOrderSeed {
  const externalOrderId = assertOrderId(input.externalOrderId);
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, MAX_ORDER_LINES).flatMap((raw) => {
    const article = asText(raw.partnumber || raw.article || raw.code).replace(/[–—−]/g, "-");
    const brand = asText(raw.brand);
    const productId = asText(raw.productId);
    const orderedQty = Math.max(0, Math.floor(asNumber(raw.orderedQty ?? raw.count)));
    if (!productId && !article && !brand) return [];
    return [{
      productId,
      name: asText(raw.name || raw.title || raw.offerName) || `${brand} ${article}`.trim() || "Позиция ROSSKO",
      brand,
      article,
      orderedQty,
      expectedAt: isoDate(raw.expectedAt),
    }];
  });
  return {
    externalOrderId,
    createdAt: isoDate(input.createdAt),
    orderedAt: isoDate(input.orderedAt ?? input.createdAt),
    expectedAt: isoDate(input.expectedAt),
    comment: asText(input.comment) || null,
    lines,
  };
}

function storedSeed(metadata: unknown): StoredOrderSeed | null {
  const row = asRecord(metadata);
  const seed = asRecord(row?.seed);
  if (!seed) return null;
  try {
    return normalizeSeed(seed as RosskoTrackedOrderSeedInput);
  } catch {
    return null;
  }
}

function storedSnapshot(metadata: unknown): StoredOrderSnapshot | null {
  const row = asRecord(metadata);
  const snapshot = asRecord(row?.snapshot);
  const orderId = asText(snapshot?.orderId);
  if (!orderId) return null;
  const lines = (Array.isArray(snapshot?.lines) ? snapshot.lines : []).flatMap((value) => {
    const line = asRecord(value);
    const sourceLineKey = asText(line?.sourceLineKey);
    if (!sourceLineKey) return [];
    return [{
      sourceLineKey,
      partGuid: asText(line?.partGuid),
      productId: asText(line?.productId),
      name: asText(line?.name) || "Позиция ROSSKO",
      brand: asText(line?.brand),
      article: asText(line?.article),
      orderedQty: Math.max(0, asNumber(line?.orderedQty)),
      purchasePrice: Math.max(0, asNumber(line?.purchasePrice)),
      sourceStatus: line?.sourceStatus == null ? null : Math.floor(asNumber(line.sourceStatus)),
      deliveryDate: isoDate(line?.deliveryDate),
      comment: asText(line?.comment) || null,
    }];
  });
  return {
    orderId,
    syncedAt: isoDate(snapshot?.syncedAt) ?? new Date().toISOString(),
    createdAt: isoDate(snapshot?.createdAt),
    deliveryDate: isoDate(snapshot?.deliveryDate),
    deliveryType: asText(snapshot?.deliveryType) || null,
    stockAddress: asText(snapshot?.stockAddress) || null,
    totalPrice: snapshot?.totalPrice == null ? null : asNumber(snapshot.totalPrice),
    lines,
  };
}

function seedLineForPart(seed: StoredOrderSeed | null, part: { brand: string; article: string }, used: Set<number>) {
  if (!seed) return null;
  const normalizedBrand = normalizeRosskoBrand(part.brand);
  const normalizedArticle = normalizeRosskoArticle(part.article);
  const index = seed.lines.findIndex((line, candidate) => !used.has(candidate) && (
    (normalizeRosskoBrand(line.brand) === normalizedBrand && normalizeRosskoArticle(line.article) === normalizedArticle) ||
    (!normalizedArticle && normalizeRosskoBrand(line.brand) === normalizedBrand)
  ));
  if (index < 0) return null;
  used.add(index);
  return seed.lines[index];
}

function snapshotFromOrder(order: NormalizedRosskoOrder, seed: StoredOrderSeed | null): StoredOrderSnapshot {
  const usedSeedLines = new Set<number>();
  const lines = groupRosskoOrderParts(order.parts).map(({ part }) => {
    const sourceLineKey = part.guid
      ? rosskoSourceLineKey(order.id, part.guid)
      : `rossko:${order.id}:invalid:${normalizeRosskoBrand(part.brand)}:${normalizeRosskoArticle(part.article)}`;
    const seedLine = seedLineForPart(seed, part, usedSeedLines);
    return {
      sourceLineKey,
      partGuid: part.guid,
      productId: seedLine?.productId ?? "",
      name: part.name,
      brand: part.brand,
      article: part.article,
      orderedQty: Number.isFinite(part.orderedQty) ? part.orderedQty : seedLine?.orderedQty ?? 0,
      purchasePrice: Number.isFinite(part.price) ? part.price : 0,
      sourceStatus: part.status,
      deliveryDate: (part.deliveryDate ?? order.deliveryDate)?.toISOString() ?? seedLine?.expectedAt ?? seed?.expectedAt ?? null,
      comment: part.comment,
    } satisfies StoredSnapshotLine;
  });
  return {
    orderId: order.id,
    syncedAt: new Date().toISOString(),
    createdAt: order.createdAt?.toISOString() ?? seed?.createdAt ?? seed?.orderedAt ?? null,
    deliveryDate: order.deliveryDate?.toISOString() ?? seed?.expectedAt ?? null,
    deliveryType: order.deliveryType,
    stockAddress: order.stockAddress,
    totalPrice: order.totalPrice,
    lines,
  };
}

function snapshotFromSeed(seed: StoredOrderSeed): StoredOrderSnapshot {
  return {
    orderId: seed.externalOrderId,
    syncedAt: new Date().toISOString(),
    createdAt: seed.createdAt ?? seed.orderedAt,
    deliveryDate: seed.expectedAt,
    deliveryType: null,
    stockAddress: null,
    totalPrice: null,
    lines: seed.lines.map((line, index) => ({
      sourceLineKey: `rossko:${seed.externalOrderId}:seed:${index + 1}`,
      partGuid: "",
      productId: line.productId,
      name: line.name,
      brand: line.brand,
      article: line.article,
      orderedQty: line.orderedQty,
      purchasePrice: 0,
      sourceStatus: null,
      deliveryDate: line.expectedAt ?? seed.expectedAt,
      comment: null,
    })),
  };
}

export function extractRosskoOrderId(data: unknown): string {
  const response = asRecord(data) ?? {};
  const direct = response.OrderID ?? response.orderId ?? response.order_id;
  if (direct != null && asText(direct)) return asText(direct);
  const ids = response.OrderIDS ?? response.orderIds ?? response.order_ids;
  if (Array.isArray(ids) && ids.length) return asText(ids[0]);
  const nested = asRecord(ids);
  const nestedId = nested?.id ?? nested?.ID;
  if (Array.isArray(nestedId) && nestedId.length) return asText(nestedId[0]);
  return asText(nestedId);
}

async function trackedEvents(tx: IncomingDb, branchId: string, orderIds?: string[]) {
  return tx.branchAuditLog.findMany({
    where: {
      branchId,
      entityType: "rossko_order",
      entityId: orderIds?.length ? { in: orderIds } : { not: null },
      action: {
        in: [
          "ROSSKO_ORDER_TRACKED",
          "ROSSKO_ORDER_SYNCED",
          "ROSSKO_ORDER_SYNC_FAILED",
          "ROSSKO_ORDER_DELIVERY_DATE_CHANGED",
          "ROSSKO_ORDER_LINE_STATUS_CHANGED",
          "ROSSKO_ORDER_LINE_AUTO_CLOSED",
          "ROSSKO_ORDER_LINES_CLOSED_MANUALLY",
          "ROSSKO_RECEIPT_PREVIEWED",
        ],
      },
    },
    select: { id: true, entityId: true, action: true, metadata: true, userId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }],
  });
}

function groupEvents<T extends { entityId: string | null }>(events: T[]) {
  const byOrder = new Map<string, T[]>();
  for (const event of events) {
    if (!event.entityId) continue;
    byOrder.set(event.entityId, [...(byOrder.get(event.entityId) ?? []), event]);
  }
  return byOrder;
}

function latestSeed(events: Awaited<ReturnType<typeof trackedEvents>>): StoredOrderSeed | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].action !== "ROSSKO_ORDER_TRACKED") continue;
    const seed = storedSeed(events[index].metadata);
    if (seed) return seed;
  }
  return null;
}

function snapshots(events: Awaited<ReturnType<typeof trackedEvents>>) {
  return events.flatMap((event) => event.action === "ROSSKO_ORDER_SYNCED" ? [storedSnapshot(event.metadata)].filter(Boolean) as StoredOrderSnapshot[] : []);
}

function latestSnapshot(events: Awaited<ReturnType<typeof trackedEvents>>) {
  const rows = snapshots(events);
  return rows[rows.length - 1] ?? null;
}

function previousDifferentDeliveryDate(events: Awaited<ReturnType<typeof trackedEvents>>, current: string | null) {
  const currentKey = dateKey(current);
  const rows = snapshots(events);
  for (let index = rows.length - 2; index >= 0; index -= 1) {
    const candidate = dateKey(rows[index].deliveryDate);
    if (candidate && candidate !== currentKey) return rows[index].deliveryDate;
  }
  return null;
}

async function writeSnapshot(
  context: BranchContext,
  actor: User,
  orderId: string,
  snapshot: StoredOrderSnapshot,
) {
  const branchId = context.branchId!;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`rossko-incoming:${branchId}:${orderId}`}, 0))::text AS locked
    `);
    const events = await trackedEvents(tx, branchId, [orderId]);
    const previous = latestSnapshot(events);
    const auditRows: Prisma.BranchAuditLogCreateManyInput[] = [{
      businessGroupId: context.businessGroupId,
      branchId,
      userId: actor.login,
      action: "ROSSKO_ORDER_SYNCED",
      entityType: "rossko_order",
      entityId: orderId,
      metadata: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
    }];
    if (previous && dateKey(previous.deliveryDate) !== dateKey(snapshot.deliveryDate)) {
      auditRows.push({
        businessGroupId: context.businessGroupId,
        branchId,
        userId: actor.login,
        action: "ROSSKO_ORDER_DELIVERY_DATE_CHANGED",
        entityType: "rossko_order",
        entityId: orderId,
        metadata: { before: previous.deliveryDate, after: snapshot.deliveryDate },
      });
    }
    const previousByKey = new Map(previous?.lines.map((line) => [line.sourceLineKey, line]) ?? []);
    for (const line of snapshot.lines) {
      const before = previousByKey.get(line.sourceLineKey);
      if (before && before.sourceStatus !== line.sourceStatus) {
        auditRows.push({
          businessGroupId: context.businessGroupId,
          branchId,
          userId: actor.login,
          action: "ROSSKO_ORDER_LINE_STATUS_CHANGED",
          entityType: "rossko_order",
          entityId: orderId,
          metadata: { sourceLineKey: line.sourceLineKey, before: before.sourceStatus, after: line.sourceStatus },
        });
      }
      const currentStatus = normalizeRosskoOrderPartStatus(line.sourceStatus);
      const previousStatus = normalizeRosskoOrderPartStatus(before?.sourceStatus);
      if (currentStatus.providerClosed && (!before || !previousStatus.providerClosed)) {
        auditRows.push({
          businessGroupId: context.businessGroupId,
          branchId,
          userId: actor.login,
          action: "ROSSKO_ORDER_LINE_AUTO_CLOSED",
          entityType: "rossko_order",
          entityId: orderId,
          metadata: { sourceLineKey: line.sourceLineKey, sourceStatus: line.sourceStatus, label: currentStatus.label },
        });
      }
    }
    await tx.branchAuditLog.createMany({ data: auditRows });
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function trackRosskoOrderSeeds(input: {
  context: BranchContext;
  actor: User;
  orders: RosskoTrackedOrderSeedInput[];
}) {
  const branchId = input.context.branchId;
  if (!branchId) throw new RosskoIncomingError("Выберите активный филиал", 409, "CONCRETE_BRANCH_REQUIRED");
  const seeds = input.orders.slice(0, MAX_TRACKED_ORDERS).map(normalizeSeed);
  if (!seeds.length) throw new RosskoIncomingError("Добавьте хотя бы один заказ ROSSKO", 400, "ROSSKO_ORDER_REQUIRED");
  await prisma.$transaction(async (tx) => {
    const existing = await tx.branchAuditLog.findMany({
      where: {
        branchId,
        entityType: "rossko_order",
        entityId: { in: seeds.map((seed) => seed.externalOrderId) },
        action: "ROSSKO_ORDER_TRACKED",
      },
      select: { entityId: true },
      distinct: ["entityId"],
    });
    const existingIds = new Set(existing.map((event) => event.entityId).filter(Boolean));
    const missing = seeds.filter((seed) => !existingIds.has(seed.externalOrderId));
    if (missing.length) await tx.branchAuditLog.createMany({
      data: missing.map((seed) => ({
        businessGroupId: input.context.businessGroupId,
        branchId,
        userId: input.actor.login,
        action: "ROSSKO_ORDER_TRACKED",
        entityType: "rossko_order",
        entityId: seed.externalOrderId,
        metadata: { seed: seed as unknown as Prisma.InputJsonValue },
      })),
    });
  });
  return seeds.map((seed) => seed.externalOrderId);
}

async function recordSyncFailure(context: BranchContext, actor: User, orderId: string, message: string) {
  await prisma.branchAuditLog.create({
    data: {
      businessGroupId: context.businessGroupId,
      branchId: context.branchId,
      userId: actor.login,
      action: "ROSSKO_ORDER_SYNC_FAILED",
      entityType: "rossko_order",
      entityId: orderId,
      metadata: { message: message.slice(0, 500) },
    },
  });
}

export async function syncRosskoIncomingOrders(input: {
  context: BranchContext;
  actor: User;
  orderIds?: string[];
}) {
  const branchId = input.context.branchId;
  if (!branchId) throw new RosskoIncomingError("Выберите активный филиал", 409, "CONCRETE_BRANCH_REQUIRED");
  const knownEvents = await prisma.$transaction((tx) => trackedEvents(tx, branchId));
  const knownIds = [...new Set(knownEvents.map((event) => event.entityId).filter((value): value is string => Boolean(value)))];
  const requested = input.orderIds?.length ? input.orderIds.map(assertOrderId) : knownIds;
  const orderIds = [...new Set(requested)].slice(0, MAX_TRACKED_ORDERS);
  if (!orderIds.length) return { synced: 0, errors: {} as Record<string, string> };
  const byOrder = groupEvents(knownEvents);
  const cfg = await rosskoConfig();
  const errors: Record<string, string> = {};
  let synced = 0;
  for (let offset = 0; offset < orderIds.length; offset += 20) {
    const chunk = orderIds.slice(offset, offset + 20);
    let payload: Record<string, unknown>;
    try {
      payload = await rosskoOrders(cfg, chunk.map(Number));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось получить GetOrders";
      for (const orderId of chunk) {
        errors[orderId] = message;
        await recordSyncFailure(input.context, input.actor, orderId, message);
      }
      continue;
    }
    for (const orderId of chunk) {
      try {
        const seed = latestSeed(byOrder.get(orderId) ?? []);
        const snapshot = snapshotFromOrder(normalizeRosskoOrder(payload, orderId), seed);
        await writeSnapshot(input.context, input.actor, orderId, snapshot);
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Заказ не найден в GetOrders";
        errors[orderId] = message;
        await recordSyncFailure(input.context, input.actor, orderId, message);
      }
    }
  }
  return { synced, errors };
}

function manualClosedByLine(events: Awaited<ReturnType<typeof trackedEvents>>) {
  const result = new Map<string, number>();
  for (const event of events) {
    if (event.action !== "ROSSKO_ORDER_LINES_CLOSED_MANUALLY") continue;
    const metadata = asRecord(event.metadata);
    const lines = Array.isArray(metadata?.lines) ? metadata.lines : [];
    for (const raw of lines) {
      const line = asRecord(raw);
      const sourceLineKey = asText(line?.sourceLineKey);
      const quantity = Math.max(0, asNumber(line?.quantity));
      if (!sourceLineKey || quantity <= 0) continue;
      result.set(sourceLineKey, (result.get(sourceLineKey) ?? 0) + quantity);
    }
  }
  return result;
}

function eventHistoryLabel(event: Awaited<ReturnType<typeof trackedEvents>>[number]) {
  const metadata = asRecord(event.metadata);
  if (event.action === "ROSSKO_ORDER_TRACKED") return { label: "Заказ добавлен в отслеживание", details: null };
  if (event.action === "ROSSKO_ORDER_SYNCED") return { label: "Статусы ROSSKO обновлены", details: null };
  if (event.action === "ROSSKO_ORDER_SYNC_FAILED") return { label: "Не удалось обновить ROSSKO", details: asText(metadata?.message) || null };
  if (event.action === "ROSSKO_ORDER_DELIVERY_DATE_CHANGED") return { label: "Дата доставки изменена", details: `${dateKey(asText(metadata?.before)) ?? "—"} → ${dateKey(asText(metadata?.after)) ?? "—"}` };
  if (event.action === "ROSSKO_ORDER_LINE_STATUS_CHANGED") {
    const before = metadata?.before == null ? null : Math.floor(asNumber(metadata.before));
    const after = metadata?.after == null ? null : Math.floor(asNumber(metadata.after));
    return { label: "Статус позиции изменён", details: `${normalizeRosskoOrderPartStatus(before).label} → ${normalizeRosskoOrderPartStatus(after).label}` };
  }
  if (event.action === "ROSSKO_ORDER_LINE_AUTO_CLOSED") return { label: "Позиция закрыта автоматически", details: asText(metadata?.label) || null };
  if (event.action === "ROSSKO_ORDER_LINES_CLOSED_MANUALLY") {
    const reason = asText(metadata?.reason) as RosskoManualCloseReason;
    const quantity = (Array.isArray(metadata?.lines) ? metadata.lines : []).reduce((sum, raw) => sum + Math.max(0, asNumber(asRecord(raw)?.quantity)), 0);
    return { label: `Закрыто вручную: ${quantity} шт.`, details: ROSSKO_MANUAL_CLOSE_REASON_LABELS[reason] ?? (asText(metadata?.reason) || null) };
  }
  return { label: event.action, details: null };
}

async function buildIncomingOrders(tx: IncomingDb, context: BranchContext, syncErrors: Record<string, string> = {}) {
  const branchId = context.branchId!;
  const events = await trackedEvents(tx, branchId);
  const byOrder = groupEvents(events);
  const orderIds = [...byOrder.keys()];
  if (!orderIds.length) return [];
  const documents = await tx.localInventoryDocument.findMany({
    where: {
      branchId,
      type: "receipt",
      source: ROSSKO_SOURCE,
      externalCode: { in: orderIds },
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      externalCode: true,
      status: true,
      applicable: true,
      cancelledAt: true,
      createdAt: true,
      positions: { select: { externalCode: true, productId: true, quantity: true } },
      auditLogs: { select: { id: true, action: true, message: true, createdByName: true, createdAt: true }, orderBy: [{ createdAt: "asc" }] },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  const products = await tx.localProduct.findMany({
    where: { branchId, archived: false, entityType: "product" },
    select: { id: true, name: true, article: true, brand: true, rosskoPartNumber: true, rosskoBrand: true },
    take: 20_000,
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const productForLine = (line: StoredSnapshotLine) => {
    if (line.productId && productById.has(line.productId)) return productById.get(line.productId)!;
    const article = normalizeRosskoArticle(line.article);
    const brand = normalizeRosskoBrand(line.brand);
    const matches = products.filter((product) => (
      (normalizeRosskoArticle(product.rosskoPartNumber) === article && normalizeRosskoBrand(product.rosskoBrand) === brand) ||
      (normalizeRosskoArticle(product.article) === article && normalizeRosskoBrand(product.brand) === brand)
    ));
    return matches.length === 1 ? matches[0] : null;
  };
  const today = currentServiceDateKey();
  const result: RosskoIncomingOrder[] = [];
  for (const orderId of orderIds) {
    const orderEvents = byOrder.get(orderId) ?? [];
    const seed = latestSeed(orderEvents);
    const snapshot = latestSnapshot(orderEvents) ?? (seed ? snapshotFromSeed(seed) : null);
    if (!snapshot) continue;
    const orderDocuments = documents.filter((document) => document.externalCode === orderId);
    const postedByLine = new Map<string, number>();
    for (const document of orderDocuments) {
      const posted = document.status === "posted" && document.applicable && !document.cancelledAt;
      if (!posted) continue;
      for (const position of document.positions) {
        if (!position.externalCode) continue;
        postedByLine.set(position.externalCode, (postedByLine.get(position.externalCode) ?? 0) + position.quantity.toNumber());
      }
    }
    const manualByLine = manualClosedByLine(orderEvents);
    const previousOrderDelivery = previousDifferentDeliveryDate(orderEvents, snapshot.deliveryDate);
    const lines = snapshot.lines.map<RosskoIncomingLine>((line) => {
      const quantities = calculateRosskoIncomingQuantities({
        orderedQty: line.orderedQty,
        postedReceivedQty: postedByLine.get(line.sourceLineKey) ?? 0,
        manualClosedQty: manualByLine.get(line.sourceLineKey) ?? 0,
        sourceStatus: line.sourceStatus,
      });
      const expectedDate = line.deliveryDate ?? snapshot.deliveryDate;
      const previousExpectedDate = previousOrderDelivery;
      const delivery = classifyRosskoDelivery({
        expectedDate,
        previousExpectedDate,
        today,
        activeIncomingQty: quantities.activeIncomingQty,
        providerClosed: quantities.status.providerClosed,
      });
      let state: RosskoOrderPartState = quantities.status.state;
      let stateLabel = quantities.status.label;
      let resolution: RosskoIncomingLine["resolution"] = "ACTIVE";
      let resolutionLabel = "Учитывается как товар в пути";
      if (quantities.postedReceivedQty >= quantities.orderedQty) {
        state = "RECEIVED";
        stateLabel = "Принято";
        resolution = "RECEIVED";
        resolutionLabel = "Полностью принято на склад";
      } else if (quantities.activeIncomingQty <= 0 && quantities.manualClosedQty > 0) {
        state = "CLOSED_MANUALLY";
        stateLabel = "Закрыто вручную";
        resolution = "CLOSED_MANUALLY";
        resolutionLabel = "Остаток локально исключён из товаров в пути";
      } else if (quantities.providerClosedQty > 0) {
        resolution = "AUTO_CLOSED_BY_PROVIDER_STATUS";
        resolutionLabel = `Закрыто автоматически: ROSSKO — ${quantities.status.label.toLocaleLowerCase("ru-RU")}`;
      } else if (quantities.postedReceivedQty > 0) {
        state = "PARTIALLY_RECEIVED";
        stateLabel = "Принято частично";
      } else if (delivery.delayed) {
        state = "DELAYED";
        stateLabel = delivery.moved ? "Доставка перенесена" : "Доставка задерживается";
      }
      const localProduct = productForLine(line);
      return {
        sourceLineKey: line.sourceLineKey,
        partGuid: line.partGuid,
        productId: localProduct?.id ?? line.productId,
        localProduct: localProduct ? { id: localProduct.id, name: localProduct.name, article: localProduct.article } : null,
        name: line.name,
        brand: line.brand,
        article: line.article,
        orderedQty: quantities.orderedQty,
        postedReceivedQty: quantities.postedReceivedQty,
        manualClosedQty: quantities.manualClosedQty,
        providerClosedQty: quantities.providerClosedQty,
        activeIncomingQty: quantities.activeIncomingQty,
        closedQty: quantities.closedQty,
        sourceStatus: line.sourceStatus,
        sourceStatusLabel: quantities.status.label,
        state,
        stateLabel,
        expectedDate,
        previousExpectedDate,
        delayDays: delivery.delayDays,
        canReceive: quantities.status.receivable && quantities.activeIncomingQty > 0,
        canClose: Boolean(line.partGuid) && quantities.activeIncomingQty > 0,
        resolution,
        resolutionLabel,
      };
    });
    const summary = {
      orderedQty: lines.reduce((sum, line) => sum + line.orderedQty, 0),
      postedReceivedQty: lines.reduce((sum, line) => sum + line.postedReceivedQty, 0),
      activeIncomingQty: lines.reduce((sum, line) => sum + line.activeIncomingQty, 0),
      closedQty: lines.reduce((sum, line) => sum + line.closedQty, 0),
      receivableQty: lines.reduce((sum, line) => sum + (line.canReceive ? line.activeIncomingQty : 0), 0),
    };
    const hasPartialReceipt = summary.postedReceivedQty > 0 && summary.postedReceivedQty < summary.orderedQty;
    const hasProviderCancellation = lines.some((line) => line.providerClosedQty > 0);
    const hasManualClosure = lines.some((line) => line.manualClosedQty > 0);
    const isDelayed = lines.some((line) => line.state === "DELAYED");
    const isClosed = summary.activeIncomingQty <= 0;
    const statusLabel = (() => {
      if (summary.postedReceivedQty >= summary.orderedQty && summary.orderedQty > 0) return "Принято";
      if (hasPartialReceipt && isClosed && hasProviderCancellation) return "Принято частично · остаток отменён";
      if (hasPartialReceipt && isClosed && hasManualClosure) return "Принято частично · остаток закрыт";
      if (isDelayed) return "Доставка задерживается";
      if (hasPartialReceipt) return "Принято частично";
      if (isClosed && hasProviderCancellation) return "Закрыто ROSSKO";
      if (isClosed && hasManualClosure) return "Закрыто вручную";
      if (lines.some((line) => line.state === "AT_BRANCH")) return "На складе ROSSKO";
      return "В пути";
    })();
    const lastSync = [...orderEvents].reverse().find((event) => event.action === "ROSSKO_ORDER_SYNCED");
    const lastFailure = [...orderEvents].reverse().find((event) => event.action === "ROSSKO_ORDER_SYNC_FAILED");
    const history: RosskoIncomingHistoryItem[] = orderEvents.map((event) => {
      const presentation = eventHistoryLabel(event);
      return {
        id: event.id,
        at: event.createdAt.toISOString(),
        action: event.action,
        label: presentation.label,
        actor: event.userId,
        details: presentation.details,
      };
    });
    for (const document of orderDocuments) {
      history.push({ id: `receipt:${document.id}`, at: document.createdAt.toISOString(), action: "ROSSKO_RECEIPT_CREATED", label: `Создана приёмка ${document.name}`, actor: null, details: null });
      for (const audit of document.auditLogs) history.push({
        id: audit.id,
        at: audit.createdAt.toISOString(),
        action: audit.action,
        label: audit.action === "POSTED" || audit.action === "RECEIPT_POSTED" ? `Приёмка ${document.name} проведена` : audit.message || audit.action,
        actor: audit.createdByName,
        details: null,
      });
    }
    history.sort((left, right) => right.at.localeCompare(left.at));
    result.push({
      externalOrderId: orderId,
      createdAt: snapshot.createdAt,
      expectedDate: snapshot.deliveryDate,
      previousExpectedDate: previousOrderDelivery,
      deliveryType: snapshot.deliveryType,
      stockAddress: snapshot.stockAddress,
      updatedAt: lastSync?.createdAt.toISOString() ?? null,
      syncError: syncErrors[orderId] ?? (lastFailure && (!lastSync || lastFailure.createdAt > lastSync.createdAt) ? asText(asRecord(lastFailure.metadata)?.message) : null) ?? null,
      status: isClosed ? "closed" : isDelayed ? "delayed" : hasPartialReceipt ? "partially_received" : "active",
      statusLabel,
      isDelayed,
      isClosed,
      hasProviderCancellation,
      hasManualClosure,
      hasPartialReceipt,
      readyToReceive: summary.receivableQty > 0,
      summary,
      lines,
      receiptDocuments: orderDocuments.map((document) => ({
        id: document.id,
        number: document.name,
        status: document.status,
        createdAt: document.createdAt.toISOString(),
        quantity: document.positions.reduce((sum, position) => sum + position.quantity.toNumber(), 0),
      })),
      history: history.slice(0, 120),
    });
  }
  return result.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

export async function listRosskoIncomingOrders(input: {
  context: BranchContext;
  actor: User;
  sync?: boolean;
}) {
  const branchId = input.context.branchId;
  if (!branchId) throw new RosskoIncomingError("Выберите активный филиал", 409, "CONCRETE_BRANCH_REQUIRED");
  const syncResult = input.sync === false
    ? { synced: 0, errors: {} as Record<string, string> }
    : await syncRosskoIncomingOrders({ context: input.context, actor: input.actor });
  const orders = await prisma.$transaction((tx) => buildIncomingOrders(tx, input.context, syncResult.errors));
  const updatedAt = orders.map((order) => order.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return { orders, updatedAt, synced: syncResult.synced, syncErrors: syncResult.errors };
}

export async function closeRosskoIncomingLines(input: {
  context: BranchContext;
  actor: User;
  orderId: string;
  reason: RosskoManualCloseReason;
  comment?: string | null;
  idempotencyKey: string;
  lines: Array<{ sourceLineKey: string; quantity: number }>;
}) {
  const branchId = input.context.branchId;
  if (!branchId) throw new RosskoIncomingError("Выберите активный филиал", 409, "CONCRETE_BRANCH_REQUIRED");
  const orderId = assertOrderId(input.orderId);
  if (!ROSSKO_MANUAL_CLOSE_REASONS.includes(input.reason)) throw new RosskoIncomingError("Выберите причину закрытия", 400, "CLOSE_REASON_REQUIRED");
  const comment = asText(input.comment).slice(0, 1000);
  if (input.reason === "OTHER" && !comment) throw new RosskoIncomingError("Для причины «Другое» добавьте комментарий", 400, "CLOSE_COMMENT_REQUIRED");
  const idempotencyKey = asText(input.idempotencyKey).slice(0, 120);
  if (!idempotencyKey) throw new RosskoIncomingError("Повторите закрытие: не создан ключ операции", 400, "IDEMPOTENCY_KEY_REQUIRED");
  const requested = input.lines.map((line) => ({ sourceLineKey: asText(line.sourceLineKey), quantity: Math.floor(asNumber(line.quantity)) }));
  if (!requested.length || requested.some((line) => !line.sourceLineKey || line.quantity <= 0)) {
    throw new RosskoIncomingError("Укажите закрываемое количество хотя бы для одной позиции", 400, "CLOSE_LINES_REQUIRED");
  }
  await syncRosskoIncomingOrders({ context: input.context, actor: input.actor, orderIds: [orderId] });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`rossko-incoming:${branchId}:${orderId}`}, 0))::text AS locked
    `);
    const events = await trackedEvents(tx, branchId, [orderId]);
    const duplicate = events.find((event) => event.action === "ROSSKO_ORDER_LINES_CLOSED_MANUALLY" && asText(asRecord(event.metadata)?.idempotencyKey) === idempotencyKey);
    if (duplicate) return;
    const orders = await buildIncomingOrders(tx, input.context);
    const order = orders.find((candidate) => candidate.externalOrderId === orderId);
    if (!order) throw new RosskoIncomingError("Заказ ROSSKO не найден в активном филиале", 404, "ROSSKO_ORDER_NOT_TRACKED");
    const linesByKey = new Map(order.lines.map((line) => [line.sourceLineKey, line]));
    for (const line of requested) {
      const current = linesByKey.get(line.sourceLineKey);
      if (!current) throw new RosskoIncomingError("Позиция ROSSKO больше не найдена", 409, "ROSSKO_SOURCE_LINE_NOT_FOUND", { sourceLineKey: line.sourceLineKey });
      if (!current.canClose) {
        throw new RosskoIncomingError(
          "Сначала обновите статус ROSSKO: поставщик ещё не вернул устойчивый идентификатор позиции.",
          409,
          "ROSSKO_SOURCE_LINE_IDENTITY_REQUIRED",
          { sourceLineKey: line.sourceLineKey },
        );
      }
      if (line.quantity > current.activeIncomingQty) {
        throw new RosskoIncomingError(
          `Можно закрыть не больше ${current.activeIncomingQty} шт. для «${current.name}».`,
          409,
          "ROSSKO_OVER_CLOSE",
          { sourceLineKey: line.sourceLineKey, activeIncomingQty: current.activeIncomingQty, requestedQty: line.quantity },
        );
      }
    }
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: input.context.businessGroupId,
        branchId,
        userId: input.actor.login,
        action: "ROSSKO_ORDER_LINES_CLOSED_MANUALLY",
        entityType: "rossko_order",
        entityId: orderId,
        metadata: {
          idempotencyKey,
          reason: input.reason,
          reasonLabel: ROSSKO_MANUAL_CLOSE_REASON_LABELS[input.reason],
          comment: comment || null,
          lines: requested,
          warning: "Локальное закрытие не отменяет заказ в ROSSKO и не меняет складские остатки.",
        },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 45_000 });
  return listRosskoIncomingOrders({ context: input.context, actor: input.actor, sync: false });
}
