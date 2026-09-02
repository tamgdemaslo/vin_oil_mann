import { Prisma, type LocalCounterparty } from "@prisma/client";
import {
  ensureAnonymousRetailCounterparty,
  isAnonymousRetailCounterparty,
} from "@/lib/anonymous-retail-counterparty";
import { type CreateDemandBody } from "@/lib/demand-create-payload";
import { ensureDemandAttributeMetadata } from "@/lib/demand-attributes";
import { invalidateDemandListCache } from "@/lib/demand-list-cache";
import { syncActiveDiagnosticVehiclesForShipment } from "@/lib/diagnostic-vehicle-sync";
import { prisma } from "@/lib/db";
import { getBranchContext } from "@/lib/branch-context";
import { invalidateCounterpartyRows, invalidateWarehouseReadCaches, supplierCounterpartyIdentityWhere } from "@/lib/local-inventory-admin";
import { parseServiceDateTime, toServiceDateInput } from "@/lib/date-time";
import { extractLocalEntityId } from "@/lib/piecework-rules";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { assertNoActiveInventoryLocks } from "@/lib/warehouse-inventory";
import type { User } from "@/lib/auth";
import type {
  DemandDetailAttribute,
  DemandDetailPayload,
  DemandDetailPosition,
} from "@/lib/demand-detail-load";
import {
  calculateAverageAfterValuedRemoval,
  calculateWeightedAverageCostCents,
  isServiceCostType,
  lineCostCents as inventoryLineCostCents,
  requireBalanceAverageCost,
  resolveBalanceCost,
  roundMoneyCents,
} from "@/lib/inventory-costing";
import { lockInventoryCostKeys } from "@/lib/inventory-costing-db";
import { sameExactProductIdentity } from "@/lib/product-identity";
import {
  assertNonstockProductPostingCost,
  isNonstockProductType,
  NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
  NONSTOCK_PRODUCT_COST_SOURCE,
  NONSTOCK_PRODUCT_LINE_KIND,
  NONSTOCK_PRODUCT_PAYROLL_GROUP_NAMES,
  normalizeNonstockProductInput,
  type NonstockProductInput,
  type NormalizedNonstockProduct,
} from "@/lib/one-off-product";
import { normalizeOneOffServiceInput, type OneOffServiceInput } from "@/lib/one-off-service";
import { invalidateSalesPerformanceAnalytics } from "@/lib/sales-performance-analytics";
import {
  classifySalesAnalyticsLine,
  salesAnalyticsMappingKey,
  type SalesAnalyticsMappingValue,
  type SalesAnalyticsMatchMethod,
  type SalesAnalyticsMetricDefinition,
  type SalesAnalyticsSourceType,
  type SalesAnalyticsUnit,
} from "@/lib/sales-analytics-taxonomy";

type LocalEntityMeta = {
  href: string;
  type: string;
  mediaType: string;
};

type UpdateDemandBody = {
  organization?: { meta: LocalEntityMeta };
  agent?: { meta: LocalEntityMeta };
  store?: { meta: LocalEntityMeta };
  name?: string;
  description?: string;
  moment?: string;
  applicable?: boolean;
  attributes?: unknown[];
  positions?: {
    id?: string;
    name?: string;
    comment?: string;
    quantity: number;
    price: number;
    discount?: number;
    assortment?: { meta: LocalEntityMeta };
    lineKind?: "catalog" | "one_off_service" | "nonstock_product";
    oneOffProduct?: NonstockProductInput;
    oneOffService?: OneOffServiceInput;
    copyMeta?: unknown;
  }[];
};

type ShipmentActor = Pick<User, "login" | "name" | "role">;

async function resolveDemandBranchScope(branchId?: string, organizationId?: string) {
  let branch = branchId
    ? await prisma.branch.findFirst({ where: { id: branchId, status: "active" } })
    : null;

  if (!branch && organizationId) {
    branch = await prisma.branch.findFirst({
      where: {
        status: "active",
        OR: [{ id: organizationId }, { legacyOrganizationId: organizationId }],
      },
    });
  }

  if (!branch) {
    const context = await getBranchContext();
    if (context?.branchId) {
      branch = await prisma.branch.findFirst({
        where: { id: context.branchId, status: "active" },
      });
    }
  }

  if (!branch?.legacyOrganizationId) {
    throw new Error("Активный филиал или его юридическое лицо не настроены");
  }

  if (organizationId && organizationId !== branch.legacyOrganizationId && organizationId !== branch.id) {
    throw new Error("Организация не относится к активному филиалу");
  }

  return { branchId: branch.id, organizationId: branch.legacyOrganizationId };
}

export type ReopenDemandBody = {
  reasonCode?: string;
  comment?: string;
  idempotencyKey?: string;
  expectedUpdatedAt?: string;
};

export type CreateDemandFromRecordBody = {
  recordId?: string | number | null;
  recordDateTime?: string | null;
  recordSource?: string | null;
  sourceLabel?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  clientExternalId?: string | number | null;
  yclientsClientId?: string | number | null;
  vehicle?: {
    model?: string | null;
    plate?: string | null;
    vin?: string | null;
    year?: string | null;
  } | null;
  comment?: string | null;
  internalComment?: string | null;
  services?: string[];
};

export type LinkDemandToAppointmentBody = {
  appointmentId?: string | number | null;
  recordDateTime?: string | null;
  recordSource?: string | null;
  sourceLabel?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  vehicle?: {
    model?: string | null;
    plate?: string | null;
    vin?: string | null;
    year?: string | null;
  } | null;
  linkSource?: "manual" | "auto_on_shipment_post" | "matched_by_client" | "matched_by_phone" | "matched_by_vehicle" | "matched_by_phone_and_vehicle";
  confidence?: "high" | "medium" | "low";
  comment?: string | null;
};

type ResolvedPosition = {
  id?: string;
  sourcePositionId?: string | null;
  productId: string | null;
  groupIdSnapshot: string | null;
  assortmentReference?: string | null;
  assortmentType: string;
  name: string;
  quantity: Prisma.Decimal;
  priceCentsPerUnit: number;
  discount: Prisma.Decimal;
  vat: number;
  vatEnabled: boolean;
  buyPriceCentsPerUnit: number | null;
  slotName: string | null;
  analyticsMetricCode: string | null;
  analyticsCategoryLabel: string | null;
  analyticsMatchMethod: string | null;
  analyticsMappingVersion: number | null;
  serviceAggregateType: string | null;
  serviceProcedure: string | null;
  serviceConfiguration: string | null;
  analyticsBaseQuantity: Prisma.Decimal | null;
  analyticsBaseUnit: string | null;
  raw: Prisma.InputJsonValue | typeof Prisma.JsonNull;
};

type StockMovementPosition = {
  productId: string | null;
  assortmentType: string;
  quantity: Prisma.Decimal | number;
  buyPriceCentsPerUnit?: number | null;
  name?: string;
};

type StockMovementContext = {
  branchId: string;
  sourceType: "SHIPMENT";
  sourceId: string;
  organizationId?: string | null;
  movementType: "SHIPMENT_POST" | "SHIPMENT_REOPEN_REVERSAL" | "SHIPMENT_REPOST" | "SHIPMENT_UPDATE";
  revision: number;
  createdById?: string | null;
  createdByName?: string | null;
  raw?: Record<string, unknown>;
};

export function isLocalInventoryWritesEnabled(): boolean {
  return true;
}

function invalidateDemandCostConsumers() {
  invalidateWarehouseReadCaches();
  invalidateSalesPerformanceAnalytics();
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function demandStatus(applicable: boolean): "DRAFT" | "POSTED" {
  return applicable ? "POSTED" : "DRAFT";
}

const REOPEN_REASON_LABELS: Record<string, string> = {
  product_error: "Ошибка в товаре",
  service_error: "Ошибка в услуге",
  quantity_error: "Неверное количество",
  price_error: "Неверная цена",
  client_error: "Неверный клиент",
  vehicle_error: "Неверный автомобиль",
  add_position: "Нужно добавить позицию",
  remove_position: "Нужно удалить позицию",
  discount_error: "Нужно изменить скидку",
  other: "Другое",
};

function normalizeReopenReason(body: ReopenDemandBody): { ok: true; reasonCode: string; reason: string } | { ok: false; error: string } {
  const reasonCode = (body.reasonCode ?? "").trim() || "other";
  const comment = (body.comment ?? "").trim();
  const label = REOPEN_REASON_LABELS[reasonCode] ?? reasonCode;
  if (reasonCode === "other" && !comment) {
    return { ok: false, error: "Укажите комментарий для причины «Другое»" };
  }
  return {
    ok: true,
    reasonCode,
    reason: comment ? `${label}: ${comment}` : label,
  };
}

function entityIdFromMeta(meta?: { href?: string } | null): string | null {
  return extractLocalEntityId(meta?.href);
}

function localMeta(type: string, id: string | null | undefined, href?: string | null): LocalEntityMeta {
  return {
    href: href || (id ? `local://${type}/${id}` : `local://${type}`),
    type,
    mediaType: "application/json",
  };
}

function entityMeta(type: string, _legacyId: string | null | undefined, _legacyHref: string | null | undefined, localId: string): LocalEntityMeta {
  return localMeta(type, localId);
}

function parseMoment(value?: string): { documentDate: string; momentAt: Date } {
  const raw = value?.trim() || undefined;
  const parsed = parseServiceDateTime(raw ?? new Date());
  const documentDate = toServiceDateInput(parsed ?? new Date());
  return {
    documentDate,
    momentAt: parsed ?? parseServiceDateTime(`${documentDate} 00:00:00`) ?? new Date(),
  };
}

const LOCAL_DEMAND_NUMBER_SCHEME = "compact-v1";

async function nextLocalDemandNameInTx(tx: Prisma.TransactionClient): Promise<{ name: string; sequence: number }> {
  const rows = await tx.localDemand.findMany({
    where: {
      raw: {
        path: ["documentNumberScheme"],
        equals: LOCAL_DEMAND_NUMBER_SCHEME,
      },
    },
    select: { name: true },
    take: 20_000,
  });
  const maxSequence = rows.reduce((max, row) => {
    const match = row.name.trim().match(/^\d+$/);
    const value = match ? Number(match[0]) : 0;
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  const sequence = maxSequence + 1;
  return {
    name: String(sequence).padStart(4, "0"),
    sequence,
  };
}

function decimalToNumber(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function formatStockQuantity(value: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 3,
    maximumFractionDigits: 3,
  });
}

function demandWriteErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

function lineTotalCents(position: Pick<ResolvedPosition, "quantity" | "priceCentsPerUnit" | "discount">): number {
  const quantity = decimalToNumber(position.quantity);
  const discount = decimalToNumber(position.discount);
  return Math.round(quantity * position.priceCentsPerUnit * (1 - discount / 100));
}

function sumPositionsCents(positions: Pick<ResolvedPosition, "quantity" | "priceCentsPerUnit" | "discount">[]): number {
  return positions.reduce((sum, position) => sum + lineTotalCents(position), 0);
}

function jsonValue(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, next] of Object.entries(value as Record<string, unknown>)) out[key] = jsonValue(next);
    return out;
  }
  return value;
}

function shipmentSnapshot(
  demand: {
    id: string;
    name: string;
    applicable: boolean;
    sumCents: number;
    description: string | null;
    momentAt: Date;
    documentDate: string;
    counterpartyId: string | null;
    agentNameSnapshot: string | null;
    storeId: string | null;
    storeNameSnapshot: string | null;
    organizationId: string | null;
    organizationName: string | null;
    attributes: unknown;
    raw: unknown;
    updatedAt?: Date;
  },
  positions: Array<{
    id?: string | null;
    productId: string | null;
    assortmentReference?: string | null;
    assortmentType: string;
    name: string;
    quantity: Prisma.Decimal | number;
    priceCentsPerUnit: number;
    discount: Prisma.Decimal | number;
    buyPriceCentsPerUnit?: number | null;
    slotName?: string | null;
    raw?: unknown;
  }>
) {
  return {
    id: demand.id,
    name: demand.name,
    status: demandStatus(demand.applicable),
    applicable: demand.applicable,
    sumCents: demand.sumCents,
    description: demand.description,
    momentAt: demand.momentAt.toISOString(),
    documentDate: demand.documentDate,
    counterpartyId: demand.counterpartyId,
    agentNameSnapshot: demand.agentNameSnapshot,
    storeId: demand.storeId,
    storeNameSnapshot: demand.storeNameSnapshot,
    organizationId: demand.organizationId,
    organizationName: demand.organizationName,
    attributes: jsonValue(demand.attributes),
    raw: jsonValue(demand.raw),
    updatedAt: demand.updatedAt?.toISOString() ?? null,
    positions: positions.map((position) => ({
      id: position.id ?? null,
      productId: position.productId,
      assortmentReference: position.assortmentReference,
      assortmentType: position.assortmentType,
      name: position.name,
      quantity: decimalToNumber(position.quantity),
      priceCentsPerUnit: position.priceCentsPerUnit,
      discount: decimalToNumber(position.discount),
      buyPriceCentsPerUnit: position.buyPriceCentsPerUnit ?? null,
      slotName: position.slotName ?? null,
      raw: jsonValue(position.raw),
    })),
  };
}

async function nextShipmentRevisionNumber(tx: Prisma.TransactionClient, shipmentId: string): Promise<number> {
  const latest = await tx.shipmentRevision.findFirst({
    where: { shipmentId },
    select: { revisionNumber: true },
    orderBy: { revisionNumber: "desc" },
  });
  return (latest?.revisionNumber ?? 0) + 1;
}

async function createShipmentRevision(
  tx: Prisma.TransactionClient,
  params: {
    shipmentId: string;
    revisionNumber: number;
    eventType: "CREATED" | "UPDATED" | "POSTED" | "REOPENED" | "REPOSTED" | "CANCELLED" | "APPOINTMENT_LINKED";
    statusBefore?: string | null;
    statusAfter?: string | null;
    snapshotBefore?: unknown;
    snapshotAfter?: unknown;
    reasonCode?: string | null;
    reason?: string | null;
    actor?: ShipmentActor | null;
  }
) {
  const shipment = await tx.localDemand.findUnique({ where: { id: params.shipmentId }, select: { branchId: true } });
  if (!shipment) throw new Error("Отгрузка для ревизии не найдена");
  await tx.shipmentRevision.create({
    data: {
      branchId: shipment.branchId,
      shipmentId: params.shipmentId,
      revisionNumber: params.revisionNumber,
      eventType: params.eventType,
      statusBefore: params.statusBefore ?? null,
      statusAfter: params.statusAfter ?? null,
      snapshotBeforeJson: toJson(params.snapshotBefore),
      snapshotAfterJson: toJson(params.snapshotAfter),
      reasonCode: params.reasonCode ?? null,
      reason: params.reason ?? null,
      createdById: params.actor?.login ?? null,
      createdByName: params.actor?.name ?? null,
    },
  });
}

function isStockTrackedType(type: string): boolean {
  return type === "product" || type === "variant" || type === "bundle";
}

function normalizeAttributeName(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

function cleanRecordText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeSearchText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "е")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildRecordCounterpartySearchText(parts: unknown[]): string {
  return normalizeSearchText(parts.filter(Boolean).join(" "));
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanRecordText(value);
    if (text) return text;
  }
  return null;
}

function mergeUniqueStrings(values: unknown[], nextValues: unknown[]): string[] {
  const out: string[] = [];
  for (const value of [...values, ...nextValues]) {
    const text = cleanRecordText(value);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

async function buildLocalDemandAttributes(
  input: CreateDemandBody["attributes"] | unknown[] | undefined,
  ecoUserName?: string
): Promise<Array<{ definitionId: string; name: string; value: unknown; source?: string }>> {
  const definitions = await prisma.demandAttributeDefinition.findMany();
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const byName = new Map(definitions.map((definition) => [normalizeAttributeName(definition.name), definition]));
  const out = new Map<string, { definitionId: string; name: string; value: unknown; source?: string }>();

  for (const attr of Array.isArray(input) ? input : []) {
    if (!attr || typeof attr !== "object") continue;
    const record = attr as { id?: unknown; name?: unknown; value?: unknown; source?: unknown };
    const value = record.value;
    if (value == null || value === "") continue;
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name : "";
    const definition = byId.get(id) ?? byName.get(normalizeAttributeName(name));
    if (!definition) continue;
    out.set(definition.id, { definitionId: definition.id, name: definition.name, value, source: typeof record.source === "string" ? record.source : undefined });
  }

  const ecoDefinition = byName.get(normalizeAttributeName("Эко пользователь"));
  if (ecoDefinition && ecoUserName?.trim()) {
    out.set(ecoDefinition.id, { definitionId: ecoDefinition.id, name: ecoDefinition.name, value: ecoUserName.trim() });
  }

  return [...out.values()];
}

type NonstockPositionInput = {
  id?: string;
  name?: string;
  comment?: string;
  quantity: number;
  price: number;
  discount?: number;
  vat?: number;
  vatEnabled?: boolean;
  assortment?: { meta: LocalEntityMeta };
  lineKind?: "catalog" | "one_off_service" | "nonstock_product";
  oneOffProduct?: NonstockProductInput;
  oneOffService?: OneOffServiceInput;
  copyMeta?: unknown;
};

function isNonstockPositionInput(position: NonstockPositionInput): boolean {
  return position.lineKind === NONSTOCK_PRODUCT_LINE_KIND
    || isNonstockProductType(position.assortment?.meta?.type)
    || Boolean(position.oneOffProduct);
}

function nonstockRawRecord(value: unknown): Record<string, unknown> {
  const root = jsonRecord(value);
  return jsonRecord(root.oneOffProduct);
}

async function resolveNonstockPurchaseSource(
  branchId: string,
  normalized: NormalizedNonstockProduct,
): Promise<NormalizedNonstockProduct> {
  if (!normalized.purchaseSourceId) return normalized;
  const supplier = await prisma.localCounterparty.findFirst({
    where: {
      id: normalized.purchaseSourceId,
      branchId,
      archived: false,
      AND: [supplierCounterpartyIdentityWhere()],
    },
    select: { id: true, name: true, displayName: true },
  });
  if (!supplier) throw new Error("Выберите активного поставщика текущего филиала или укажите магазин текстом");
  return {
    ...normalized,
    purchaseSourceId: supplier.id,
    purchaseSourceLabel: supplier.displayName.trim() || supplier.name.trim(),
  };
}

async function findExactNonstockCatalogMatch(branchId: string, normalized: NormalizedNonstockProduct) {
  if (!normalized.articleCanonical) return null;
  const candidates = await prisma.localProduct.findMany({
    where: { branchId, archived: false },
    select: { id: true, brand: true, article: true, code: true },
  });
  return candidates.find((candidate) => sameExactProductIdentity(
    { brand: normalized.brandCanonical, article: normalized.articleDisplay },
    { brand: candidate.brand, article: candidate.article || candidate.code },
  ))?.id ?? null;
}

async function buildNonstockResolvedPosition(
  position: NonstockPositionInput,
  options: {
    branchId: string;
    priceIsCents: boolean;
    actorId?: string | null;
    actorName?: string | null;
    existingRaw?: unknown;
  },
): Promise<ResolvedPosition> {
  if (!position.oneOffProduct) throw new Error("Передайте структурированные данные разового товара");
  const quantity = Number(position.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Количество разового товара должно быть больше нуля");
  const priceValue = Number(position.price);
  if (!Number.isFinite(priceValue) || priceValue < 0) throw new Error("Цена разового товара должна быть неотрицательным числом");
  const discount = typeof position.discount === "number" ? position.discount : 0;
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error("Скидка должна быть от 0 до 100%");

  const normalized = await resolveNonstockPurchaseSource(
    options.branchId,
    normalizeNonstockProductInput(position.oneOffProduct),
  );
  const catalogMatchProductId = await findExactNonstockCatalogMatch(options.branchId, normalized);
  const payrollGroupName = NONSTOCK_PRODUCT_PAYROLL_GROUP_NAMES[normalized.groupCode];
  const payrollGroup = payrollGroupName
    ? await prisma.localCatalogGroup.findFirst({
        where: {
          branchId: options.branchId,
          kind: "product",
          archived: false,
          normalizedName: payrollGroupName.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim(),
        },
        select: { id: true },
      })
    : null;
  const previousRaw = nonstockRawRecord(options.existingRaw);
  const now = new Date().toISOString();
  const structured = {
    groupCode: normalized.groupCode,
    groupLabel: normalized.groupLabel,
    brandRaw: normalized.brandRaw,
    brandCanonical: normalized.brandCanonical,
    brandIdentity: normalized.brandIdentity,
    articleRaw: normalized.articleRaw,
    articleDisplay: normalized.articleDisplay,
    articleCanonical: normalized.articleCanonical,
    uomCode: normalized.uomCode,
    uomLabel: normalized.uomLabel,
    purchasePriceCents: normalized.purchasePriceCents,
    purchaseSourceId: normalized.purchaseSourceId,
    purchaseSourceLabel: normalized.purchaseSourceLabel,
    clarification: normalized.clarification,
    catalogMatchProductId,
    analyticsKey: normalized.analyticsKey,
    costSource: NONSTOCK_PRODUCT_COST_SOURCE,
    explicitZeroCost: normalized.explicitZeroCost,
    createdById: cleanRecordText(previousRaw.createdById) || options.actorId || null,
    createdByName: cleanRecordText(previousRaw.createdByName) || options.actorName || null,
    createdAt: cleanRecordText(previousRaw.createdAt) || now,
    updatedAt: now,
  };

  return {
    id: position.id,
    sourcePositionId: position.id ?? null,
    productId: null,
    groupIdSnapshot: payrollGroup?.id ?? null,
    assortmentReference: null,
    assortmentType: NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
    name: normalized.name,
    quantity: new Prisma.Decimal(quantity),
    priceCentsPerUnit: options.priceIsCents ? Math.round(priceValue) : Math.round(priceValue * 100),
    discount: new Prisma.Decimal(discount),
    vat: position.vat ?? 0,
    vatEnabled: position.vatEnabled ?? false,
    buyPriceCentsPerUnit: normalized.purchasePriceCents,
    slotName: null,
    analyticsMetricCode: null,
    analyticsCategoryLabel: null,
    analyticsMatchMethod: null,
    analyticsMappingVersion: null,
    serviceAggregateType: null,
    serviceProcedure: null,
    serviceConfiguration: null,
    analyticsBaseQuantity: null,
    analyticsBaseUnit: null,
    raw: toJson({
      lineKind: NONSTOCK_PRODUCT_LINE_KIND,
      nonStock: true,
      comment: cleanRecordText(position.comment) || null,
      copyMeta: position.copyMeta ?? null,
      oneOffProduct: structured,
    }),
  };
}

async function resolveCreatePositions(
  positions: CreateDemandBody["positions"] | undefined,
  storeId: string | null | undefined,
  branchId: string,
  actor?: ShipmentActor | null,
): Promise<ResolvedPosition[]> {
  const input = positions ?? [];
  const assortmentIds = input
    .map((position) => entityIdFromMeta(position.assortment?.meta))
    .filter((id): id is string => Boolean(id));
  const products = assortmentIds.length
    ? await prisma.localProduct.findMany({
        where: { branchId, OR: [{ id: { in: [...new Set(assortmentIds)] } }, { id: { in: [...new Set(assortmentIds)] } }] },
      })
    : [];
  const productByExternalId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByExternalId.set(product.id, product);
    if (product.id) productByExternalId.set(product.id, product);
  }
  const balances = storeId
    ? await prisma.localStockBalance.findMany({
        where: {
          storeId,
          productId: { in: products.map((product) => product.id) },
        },
      })
    : [];
  const balanceByProductId = new Map(balances.map((balance) => [balance.productId, balance]));

  return Promise.all(input.map(async (position) => {
    if (isNonstockPositionInput(position)) {
      return buildNonstockResolvedPosition(position, {
        branchId,
        priceIsCents: false,
        actorId: actor?.login ?? null,
        actorName: actor?.name ?? null,
      });
    }
    const meta = position.assortment?.meta;
    const assortmentReference = entityIdFromMeta(meta);
    const product = assortmentReference ? productByExternalId.get(assortmentReference) : undefined;
    const balance = product ? balanceByProductId.get(product.id) : undefined;
    const quantity = Number(position.quantity) || 0;
    const priceCents = Math.round((Number(position.price) || 0) * 100);
    const discount = typeof position.discount === "number" ? position.discount : 0;
    if (position.lineKind === "one_off_service" && !position.oneOffService) {
      throw new Error("Передайте структурированную категорию разовой услуги");
    }
    const oneOffService = position.oneOffService ? normalizeOneOffServiceInput(position.oneOffService) : null;
    return {
      productId: product?.id ?? null,
      groupIdSnapshot: product?.groupId ?? null,
      assortmentReference,
      assortmentType: meta?.type ?? product?.entityType ?? "",
      name: (product?.name ?? cleanRecordText(position.name)) || assortmentReference || "Позиция",
      quantity: new Prisma.Decimal(quantity),
      priceCentsPerUnit: priceCents,
      discount: new Prisma.Decimal(discount),
      vat: position.vat ?? 0,
      vatEnabled: position.vatEnabled ?? false,
      buyPriceCentsPerUnit: resolveBalanceCost({
        assortmentType: meta?.type ?? product?.entityType ?? "",
        averageCostCents: balance?.buyPriceCents,
      }).unitCostCents,
      slotName: balance?.slotName ?? product?.cell ?? null,
      analyticsMetricCode: null,
      analyticsCategoryLabel: null,
      analyticsMatchMethod: null,
      analyticsMappingVersion: null,
      serviceAggregateType: null,
      serviceProcedure: null,
      serviceConfiguration: null,
      analyticsBaseQuantity: null,
      analyticsBaseUnit: null,
      raw: toJson(oneOffService ? { ...position, lineKind: "one_off_service", oneOffService } : position),
    };
  }));
}

async function resolveUpdatePositions(
  positions: NonNullable<UpdateDemandBody["positions"]>,
  existingById: Map<string, StockMovementPosition & {
    name: string;
    productId: string | null;
    groupIdSnapshot: string | null;
    buyPriceCentsPerUnit: number | null;
    analyticsMetricCode: string | null;
    analyticsCategoryLabel: string | null;
    analyticsMatchMethod: string | null;
    analyticsMappingVersion: number | null;
    serviceAggregateType: string | null;
    serviceProcedure: string | null;
    serviceConfiguration: string | null;
    analyticsBaseQuantity: Prisma.Decimal | null;
    analyticsBaseUnit: string | null;
    raw: unknown;
  }>,
  branchId: string,
  actor?: ShipmentActor | null,
): Promise<ResolvedPosition[]> {
  const assortmentIds = positions
    .map((position) => entityIdFromMeta(position.assortment?.meta))
    .filter((id): id is string => Boolean(id));
  const products = assortmentIds.length
    ? await prisma.localProduct.findMany({
        where: { branchId, OR: [{ id: { in: [...new Set(assortmentIds)] } }, { id: { in: [...new Set(assortmentIds)] } }] },
      })
    : [];
  const productByExternalId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByExternalId.set(product.id, product);
    if (product.id) productByExternalId.set(product.id, product);
  }

  return Promise.all(positions.map(async (position) => {
    const existing = position.id ? existingById.get(position.id) : undefined;
    if (isNonstockPositionInput(position)) {
      return buildNonstockResolvedPosition(position, {
        branchId,
        priceIsCents: true,
        actorId: actor?.login ?? null,
        actorName: actor?.name ?? null,
        existingRaw: existing?.raw,
      });
    }
    const meta = position.assortment?.meta;
    const assortmentReference = entityIdFromMeta(meta);
    const product = assortmentReference ? productByExternalId.get(assortmentReference) : undefined;
    const quantity = Number(position.quantity) || 0;
    const priceCents = Math.round(Number(position.price) || 0);
    const discount = typeof position.discount === "number" ? position.discount : 0;
    const productId = product?.id ?? existing?.productId ?? null;
    const assortmentType = meta?.type ?? existing?.assortmentType ?? product?.entityType ?? "";
    const keepsExistingProduct = Boolean(existing && existing.productId === productId);
    if (position.lineKind === "one_off_service" && !position.oneOffService) {
      throw new Error("Передайте структурированную категорию разовой услуги");
    }
    const oneOffService = position.oneOffService ? normalizeOneOffServiceInput(position.oneOffService) : null;
    return {
      id: position.id,
      sourcePositionId: keepsExistingProduct ? position.id ?? null : null,
      productId,
      groupIdSnapshot: product?.groupId ?? existing?.groupIdSnapshot ?? null,
      assortmentReference,
      assortmentType,
      name: product?.name ?? existing?.name ?? assortmentReference ?? "Позиция",
      quantity: new Prisma.Decimal(quantity),
      priceCentsPerUnit: priceCents,
      discount: new Prisma.Decimal(discount),
      vat: 0,
      vatEnabled: false,
      buyPriceCentsPerUnit: isServiceCostType(assortmentType)
        ? 0
        : keepsExistingProduct ? existing?.buyPriceCentsPerUnit ?? null : null,
      slotName: null,
      analyticsMetricCode: keepsExistingProduct ? existing?.analyticsMetricCode ?? null : null,
      analyticsCategoryLabel: keepsExistingProduct ? existing?.analyticsCategoryLabel ?? null : null,
      analyticsMatchMethod: keepsExistingProduct ? existing?.analyticsMatchMethod ?? null : null,
      analyticsMappingVersion: keepsExistingProduct ? existing?.analyticsMappingVersion ?? null : null,
      serviceAggregateType: keepsExistingProduct ? existing?.serviceAggregateType ?? null : null,
      serviceProcedure: keepsExistingProduct ? existing?.serviceProcedure ?? null : null,
      serviceConfiguration: keepsExistingProduct ? existing?.serviceConfiguration ?? null : null,
      analyticsBaseQuantity: keepsExistingProduct ? existing?.analyticsBaseQuantity ?? null : null,
      analyticsBaseUnit: keepsExistingProduct ? existing?.analyticsBaseUnit ?? null : null,
      raw: toJson(oneOffService ? { ...position, lineKind: "one_off_service", oneOffService } : position),
    };
  }));
}

async function freezePostingCostSnapshots(
  tx: Prisma.TransactionClient,
  branchId: string,
  storeId: string | null,
  positions: ResolvedPosition[],
  options: { preserveExistingSnapshots: boolean }
): Promise<ResolvedPosition[]> {
  if (!storeId && positions.some((position) => position.productId && isStockTrackedType(position.assortmentType))) {
    throw new Error("Для проведения товарной отгрузки выберите склад");
  }
  const productIds = [...new Set(
    positions
      .filter((position) => position.productId && isStockTrackedType(position.assortmentType))
      .map((position) => position.productId as string)
  )];
  if (storeId && productIds.length > 0) {
    await lockInventoryCostKeys(tx, { branchId, storeId, productIds });
  }
  const [balances, store] = await Promise.all([
    storeId && productIds.length > 0
      ? tx.localStockBalance.findMany({ where: { storeId, productId: { in: productIds } } })
      : Promise.resolve([]),
    storeId ? tx.localStore.findUnique({ where: { id: storeId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const balanceByProductId = new Map(balances.map((balance) => [balance.productId, balance]));

  return positions.map((position) => {
    if (isServiceCostType(position.assortmentType)) {
      return { ...position, buyPriceCentsPerUnit: 0 };
    }
    if (isNonstockProductType(position.assortmentType)) {
      const raw = nonstockRawRecord(position.raw);
      assertNonstockProductPostingCost({
        purchasePriceCents: position.buyPriceCentsPerUnit,
        explicitZeroCost: raw.explicitZeroCost === true,
      });
      return position;
    }
    if (!position.productId || !isStockTrackedType(position.assortmentType)) return position;
    if (
      options.preserveExistingSnapshots &&
      position.sourcePositionId &&
      position.buyPriceCentsPerUnit != null &&
      position.buyPriceCentsPerUnit > 0
    ) {
      return position;
    }
    const averageCost = requireBalanceAverageCost({
      productName: position.name,
      storeName: store?.name,
      averageCostCents: balanceByProductId.get(position.productId)?.buyPriceCents,
    });
    return { ...position, buyPriceCentsPerUnit: averageCost };
  });
}

function salesMetricType(value: string): "PRODUCT_CATEGORY" | "SERVICE_OPERATION" | null {
  return value === "PRODUCT_CATEGORY" || value === "SERVICE_OPERATION" ? value : null;
}

function salesMetricUnit(value: string): SalesAnalyticsUnit | null {
  return value === "PCS" || value === "LITER" || value === "OPERATION" ? value : null;
}

function salesMatchMethod(value: string): SalesAnalyticsMatchMethod {
  return ["SNAPSHOT", "SAVED_CODE", "ID", "GROUP", "STRUCTURED_RAW", "VERIFIED_LEGACY", "MANUAL"].includes(value)
    ? value as SalesAnalyticsMatchMethod
    : "MANUAL";
}

async function freezeSalesAnalyticsSnapshots(
  tx: Prisma.TransactionClient,
  branchId: string,
  positions: ResolvedPosition[],
  options: { preserveExistingSnapshots: boolean },
): Promise<ResolvedPosition[]> {
  const productIds = [...new Set(positions.map((position) => position.productId).filter((id): id is string => Boolean(id)))];
  const groupIds = [...new Set(positions.map((position) => position.groupIdSnapshot).filter((id): id is string => Boolean(id)))];
  const [metricRows, mappingRows, products, groups] = await Promise.all([
    tx.salesAnalyticsMetric.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }] }),
    tx.salesAnalyticsMapping.findMany({ where: { branchId, active: true }, orderBy: [{ version: "desc" }] }),
    productIds.length
      ? tx.localProduct.findMany({
          where: { branchId, id: { in: productIds } },
          select: { id: true, entityType: true, groupId: true, groupPath: true, uomName: true },
        })
      : Promise.resolve([]),
    groupIds.length
      ? tx.localCatalogGroup.findMany({
          where: { branchId, id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const metrics = new Map<string, SalesAnalyticsMetricDefinition>();
  for (const row of metricRows) {
    const type = salesMetricType(row.type);
    const unit = salesMetricUnit(row.unit);
    if (!type || !unit) continue;
    metrics.set(row.code, {
      code: row.code,
      type,
      title: row.title,
      unit,
      sortOrder: row.sortOrder,
      active: row.active,
      parentCode: row.parentCode,
    });
  }
  const mappings = new Map<string, SalesAnalyticsMappingValue>();
  for (const row of mappingRows) {
    mappings.set(salesAnalyticsMappingKey(row.sourceType as SalesAnalyticsSourceType, row.sourceId), {
      metricCode: row.metricCode,
      matchMethod: salesMatchMethod(row.matchMethod),
      version: row.version,
      aggregateType: row.aggregateType as SalesAnalyticsMappingValue["aggregateType"],
      procedure: row.procedure as SalesAnalyticsMappingValue["procedure"],
      configuration: row.configuration as SalesAnalyticsMappingValue["configuration"],
    });
  }
  const productById = new Map(products.map((product) => [product.id, product] as const));
  const groupNameById = new Map(groups.map((group) => [group.id, group.name] as const));

  return positions.map((position) => {
    const product = position.productId ? productById.get(position.productId) : null;
    const kind: "product" | "service" = isServiceCostType(position.assortmentType) || product?.entityType === "service"
      ? "service"
      : "product";
    const snapshot = options.preserveExistingSnapshots && position.analyticsMetricCode
      ? {
          metricCode: position.analyticsMetricCode,
          categoryLabel: position.analyticsCategoryLabel,
          matchMethod: position.analyticsMatchMethod,
          mappingVersion: position.analyticsMappingVersion,
          aggregateType: position.serviceAggregateType,
          procedure: position.serviceProcedure,
          configuration: position.serviceConfiguration,
          baseQuantity: position.analyticsBaseQuantity == null ? null : decimalToNumber(position.analyticsBaseQuantity),
          baseUnit: position.analyticsBaseUnit,
        }
      : null;
    const classification = classifySalesAnalyticsLine({
      kind,
      productId: position.productId,
      groupId: position.groupIdSnapshot ?? product?.groupId,
      groupName: (position.groupIdSnapshot ? groupNameById.get(position.groupIdSnapshot) : null) ?? product?.groupPath,
      positionName: position.name,
      quantity: decimalToNumber(position.quantity),
      uomName: product?.uomName,
      raw: position.raw,
      snapshot,
      mappings,
      metrics,
    });
    if (classification.status === "unclassified") {
      return {
        ...position,
        analyticsMetricCode: null,
        analyticsCategoryLabel: null,
        analyticsMatchMethod: null,
        analyticsMappingVersion: null,
        serviceAggregateType: null,
        serviceProcedure: null,
        serviceConfiguration: null,
        analyticsBaseQuantity: null,
        analyticsBaseUnit: null,
      };
    }
    return {
      ...position,
      analyticsMetricCode: classification.metricCode,
      analyticsCategoryLabel: classification.metricTitle,
      analyticsMatchMethod: classification.matchMethod,
      analyticsMappingVersion: classification.mappingVersion,
      serviceAggregateType: classification.aggregateType,
      serviceProcedure: classification.procedure,
      serviceConfiguration: classification.configuration,
      analyticsBaseQuantity: classification.baseQuantity == null ? null : new Prisma.Decimal(classification.baseQuantity),
      analyticsBaseUnit: classification.baseUnit,
    };
  });
}

function movementCostForProduct(positions: StockMovementPosition[], productId: string): {
  unitCostCents: number | null;
  totalCostCents: number | null;
} {
  const productPositions = positions.filter((position) => position.productId === productId);
  let totalQuantity = 0;
  let totalCost = 0;
  for (const position of productPositions) {
    const quantity = decimalToNumber(position.quantity);
    const unitCost = position.buyPriceCentsPerUnit;
    if (unitCost == null || unitCost <= 0) return { unitCostCents: null, totalCostCents: null };
    totalQuantity += quantity;
    totalCost += inventoryLineCostCents(quantity, unitCost) ?? 0;
  }
  if (totalQuantity <= 0.0001) return { unitCostCents: null, totalCostCents: null };
  return {
    unitCostCents: roundMoneyCents(totalCost / totalQuantity),
    totalCostCents: totalCost,
  };
}

function appliedQuantityByProduct(positions: StockMovementPosition[], applicable: boolean): Map<string, number> {
  const map = new Map<string, number>();
  if (!applicable) return map;
  for (const position of positions) {
    if (!position.productId || !isStockTrackedType(position.assortmentType)) continue;
    map.set(position.productId, (map.get(position.productId) ?? 0) + decimalToNumber(position.quantity));
  }
  return map;
}

async function applyStockMovements(
  tx: Prisma.TransactionClient,
  storeId: string | null,
  oldPositions: StockMovementPosition[],
  oldApplicable: boolean,
  newPositions: StockMovementPosition[],
  newApplicable: boolean,
  context?: StockMovementContext
) {
  if (!storeId) return;
  const oldByProduct = appliedQuantityByProduct(oldPositions, oldApplicable);
  const newByProduct = appliedQuantityByProduct(newPositions, newApplicable);
  const productIds = [...new Set([...oldByProduct.keys(), ...newByProduct.keys()])];
  const changedProductIds = productIds.filter((productId) => {
    const oldQty = oldByProduct.get(productId) ?? 0;
    const newQty = newByProduct.get(productId) ?? 0;
    return Math.abs(newQty - oldQty) >= 0.0001;
  });
  if (changedProductIds.length > 0) {
    await assertNoActiveInventoryLocks(tx, {
      organizationId: context?.organizationId,
      warehouseId: storeId,
      productIds: changedProductIds,
    });
    if (context) {
      await lockInventoryCostKeys(tx, { branchId: context.branchId, storeId, productIds: changedProductIds });
    }
  }

  for (const productId of productIds) {
    const oldQty = oldByProduct.get(productId) ?? 0;
    const newQty = newByProduct.get(productId) ?? 0;
    const deltaApplied = newQty - oldQty;
    if (Math.abs(deltaApplied) < 0.0001) continue;
    const sourcePosition =
      newPositions.find((position) => position.productId === productId) ??
      oldPositions.find((position) => position.productId === productId);
    const costPositions = deltaApplied > 0 ? newPositions : oldPositions;
    const movementCost = movementCostForProduct(costPositions, productId);
    if (context && (movementCost.unitCostCents == null || movementCost.unitCostCents <= 0)) {
      throw new Error(
        `У движения товара «${sourcePosition?.name?.trim() || productId}» отсутствует подтверждённый cost snapshot.`
      );
    }

    const current = await tx.localStockBalance.findUnique({
      where: { productId_storeId: { productId, storeId } },
    });
    const currentQuantity = current?.quantity.toNumber() ?? 0;
    const reserve = current?.reserve.toNumber() ?? 0;
    const currentAvailable = currentQuantity - reserve;
    if (deltaApplied > currentAvailable + 0.0001) {
      const store = await tx.localStore.findUnique({ where: { id: storeId }, select: { name: true } });
      const productName = sourcePosition?.name?.trim() || productId;
      throw new Error(
        [
          `Недостаточно остатков для проведения отгрузки: «${productName}».`,
          `Склад: ${store?.name ?? storeId}.`,
          `Нужно списать ${formatStockQuantity(deltaApplied)} шт., доступно ${formatStockQuantity(Math.max(0, currentAvailable))} шт.`,
          `Остаток: ${formatStockQuantity(currentQuantity)} шт., резерв: ${formatStockQuantity(reserve)} шт.`,
          "Уменьшите количество, выберите другой склад или пополните остаток.",
        ].join(" ")
      );
    }
    const nextQuantity = currentQuantity - deltaApplied;
    const nextAvailable = nextQuantity - reserve;
    let nextAverageCost = current?.buyPriceCents ?? null;
    if (context && deltaApplied < -0.0001) {
      nextAverageCost = calculateWeightedAverageCostCents({
        oldQuantity: currentQuantity,
        oldAverageCostCents: current?.buyPriceCents,
        receivedQuantity: Math.abs(deltaApplied),
        receiptUnitCostCents: movementCost.unitCostCents as number,
        productName: sourcePosition?.name,
      });
    } else if (context && deltaApplied > 0.0001) {
      const currentAverage = requireBalanceAverageCost({
        productName: sourcePosition?.name?.trim() || productId,
        averageCostCents: current?.buyPriceCents,
      });
      if (
        context.movementType === "SHIPMENT_REPOST" &&
        movementCost.unitCostCents != null &&
        movementCost.unitCostCents !== currentAverage
      ) {
        nextAverageCost = calculateAverageAfterValuedRemoval({
          oldQuantity: currentQuantity,
          oldAverageCostCents: currentAverage,
          removedQuantity: deltaApplied,
          removedUnitCostCents: movementCost.unitCostCents,
        });
        if (nextAverageCost == null) {
          throw new Error(`Повторное проведение «${sourcePosition?.name?.trim() || productId}» создаёт неопределённую стоимость остатка.`);
        }
      }
    }

    if (current) {
      await tx.localStockBalance.update({
        where: { id: current.id },
        data: {
          quantity: new Prisma.Decimal(nextQuantity),
          available: new Prisma.Decimal(nextAvailable),
          buyPriceCents: nextAverageCost,
          syncedAt: new Date(),
        },
      });
    } else {
      if (!context) throw new Error("Не удалось определить филиал для складского остатка");
      await tx.localStockBalance.create({
        data: {
          branchId: context.branchId,
          productId,
          storeId,
          quantity: new Prisma.Decimal(nextQuantity),
          reserve: new Prisma.Decimal(0),
          available: new Prisma.Decimal(nextAvailable),
          buyPriceCents: nextAverageCost,
          syncedAt: new Date(),
        },
      });
    }

    if (context) {
      await tx.inventoryLedgerEntry.create({
        data: {
          branchId: context.branchId,
          sourceType: context.sourceType,
          sourceId: context.sourceId,
          organizationId: context.organizationId ?? null,
          shipmentId: context.sourceType === "SHIPMENT" ? context.sourceId : null,
          productId,
          storeId,
          movementType: context.movementType,
          quantityDelta: new Prisma.Decimal(-deltaApplied),
          unitCostSnapshot: movementCost.unitCostCents,
          totalCostSnapshot: movementCost.unitCostCents == null
            ? null
            : roundMoneyCents(Math.abs(deltaApplied) * movementCost.unitCostCents),
          revision: context.revision,
          createdById: context.createdById ?? null,
          createdByName: context.createdByName ?? null,
          raw: toJson({
            ...context.raw,
            productName: sourcePosition?.name ?? null,
            oldAppliedQuantity: oldQty,
            newAppliedQuantity: newQty,
            balanceBefore: {
              quantity: currentQuantity,
              reserve,
              available: currentAvailable,
              averageCostCents: current?.buyPriceCents ?? null,
            },
            balanceAfter: {
              quantity: nextQuantity,
              reserve,
              available: nextAvailable,
              averageCostCents: nextAverageCost,
            },
          }),
        },
      });
    }
  }
}

async function findLocalDemand(id: string, branchId: string) {
  return prisma.localDemand.findFirst({
    where: { branchId, OR: [{ id }, { id: id }] },
    include: { positions: true, counterparty: true, store: true, organization: true },
  });
}

async function findDefaultRecordShipmentContext(tx: Prisma.TransactionClient) {
  const organization = await tx.localOrganization.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const store = await tx.localStore.findFirst({
    where: {
      archived: false,
      ...(organization ? { OR: [{ organizationId: organization.id }, { organizationId: null }] } : {}),
    },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
  });
  return { organization, store };
}

async function findRecordCounterparty(tx: Prisma.TransactionClient, input: CreateDemandFromRecordBody) {
  const mode = Prisma.QueryMode.insensitive;
  const phone = cleanRecordText(input.clientPhone);
  const normalizedPhone = normalizePhoneKey(phone);
  const phoneTail = normalizedPhone?.slice(-10) ?? "";
  const clientName = cleanRecordText(input.clientName);
  const externalKeys = [
    cleanRecordText(input.yclientsClientId),
    cleanRecordText(input.clientExternalId),
    cleanRecordText(input.recordId) ? `record:${cleanRecordText(input.recordId)}` : "",
  ].filter(Boolean);

  if (normalizedPhone) {
    const byPhone = await tx.localCounterparty.findFirst({
      where: {
        archived: false,
        OR: [
          { normalizedPhone },
          { phone: { contains: phoneTail || normalizedPhone, mode } },
          { searchText: { contains: normalizedPhone, mode } },
          ...(phoneTail ? [{ searchText: { contains: phoneTail, mode } }] : []),
        ],
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (byPhone) return byPhone;
  }

  for (const key of externalKeys) {
    const byExternal = await tx.localCounterparty.findFirst({
      where: {
        archived: false,
        searchText: { contains: key, mode },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (byExternal) return byExternal;
  }

  if (clientName && phone) {
    return tx.localCounterparty.findFirst({
      where: {
        archived: false,
        name: { equals: clientName, mode },
        OR: [
          { phone: { contains: phoneTail || phone, mode } },
          ...(normalizedPhone ? [{ normalizedPhone }, { searchText: { contains: normalizedPhone, mode } }] : []),
          { searchText: { contains: phone, mode } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  return null;
}

function recordCounterpartyRaw(input: CreateDemandFromRecordBody, existing?: LocalCounterparty | null) {
  const currentRaw = jsonRecord(existing?.raw);
  const currentVehicle = jsonRecord(currentRaw.vehicle);
  const vehicle = {
    ...currentVehicle,
    model: firstNonEmpty(currentVehicle.model, input.vehicle?.model),
    plate: firstNonEmpty(currentVehicle.plate, input.vehicle?.plate),
    vin: firstNonEmpty(currentVehicle.vin, input.vehicle?.vin),
    year: firstNonEmpty(currentVehicle.year, input.vehicle?.year),
  };
  const recordId = cleanRecordText(input.recordId);
  const records = mergeUniqueStrings(Array.isArray(currentRaw.recordIds) ? currentRaw.recordIds : [], [recordId]);
  const yclientsClientId = firstNonEmpty(currentRaw.yclientsClientId, input.yclientsClientId, input.clientExternalId);
  return {
    ...currentRaw,
    source: firstNonEmpty(currentRaw.source, "records"),
    origin: firstNonEmpty(currentRaw.origin, input.recordSource, input.sourceLabel, "Журнал записей"),
    yclientsClientId,
    recordIds: records,
    noPhone: !normalizePhoneKey(cleanRecordText(input.clientPhone)),
    vehicle,
    lastRecord: {
      id: recordId || null,
      datetime: cleanRecordText(input.recordDateTime) || null,
      source: cleanRecordText(input.recordSource) || cleanRecordText(input.sourceLabel) || null,
      services: (input.services ?? []).map(cleanRecordText).filter(Boolean),
    },
    lastLocalUpdate: new Date().toISOString(),
  };
}

function recordCounterpartySearchText(input: CreateDemandFromRecordBody, values: {
  name: string;
  phone: string | null;
  email: string | null;
  counterpartyTypeName: string | null;
  companyType: string | null;
  raw: Record<string, unknown>;
}) {
  const vehicle = jsonRecord(values.raw.vehicle);
  const recordId = cleanRecordText(input.recordId);
  const yclientsClientId = cleanRecordText(values.raw.yclientsClientId);
  return buildRecordCounterpartySearchText([
    values.name,
    values.phone,
    normalizePhoneKey(values.phone),
    values.email,
    values.counterpartyTypeName,
    values.companyType,
    cleanRecordText(input.clientExternalId),
    cleanRecordText(input.yclientsClientId),
    yclientsClientId,
    recordId ? `record:${recordId}` : "",
    cleanRecordText(input.recordSource),
    cleanRecordText(input.sourceLabel),
    vehicle.model,
    vehicle.plate,
    vehicle.vin,
    vehicle.year,
    values.raw.noPhone ? "без телефона" : "",
  ]);
}

async function resolveRecordCounterparty(tx: Prisma.TransactionClient, input: CreateDemandFromRecordBody) {
  const existing = await findRecordCounterparty(tx, input);
  const phone = cleanRecordText(input.clientPhone);
  const normalizedPhone = normalizePhoneKey(phone);
  const email = cleanRecordText(input.clientEmail);
  const fallbackName = normalizedPhone ? `Клиент ${normalizedPhone}` : "Клиент без телефона";
  const name = cleanRecordText(input.clientName) || existing?.name || fallbackName;

  if (!existing) {
    const raw = recordCounterpartyRaw(input);
    const companyType = "individual";
    const counterpartyTypeName = "Клиент из журнала записей";
    const created = await tx.localCounterparty.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        normalizedPhone,
        phonesRaw: phone ? [phone] : [],
        companyType,
        counterpartyTypeName,
        archived: false,
        searchText: recordCounterpartySearchText(input, {
          name,
          phone: phone || null,
          email: email || null,
          companyType,
          counterpartyTypeName,
          raw,
        }),
        raw: toJson(raw),
        syncedAt: new Date(),
      },
    });
    return { counterparty: created, created: true };
  }

  const currentPhones = Array.isArray(existing.phonesRaw) ? existing.phonesRaw : [];
  const nextPhone = existing.phone || phone || null;
  const nextEmail = existing.email || email || null;
  const nextRaw = recordCounterpartyRaw(input, existing);
  const companyType = existing.companyType || "individual";
  const counterpartyTypeName = existing.counterpartyTypeName || "Клиент из журнала записей";
  const updated = await tx.localCounterparty.update({
    where: { id: existing.id },
    data: {
      phone: nextPhone,
      email: nextEmail,
      normalizedPhone: existing.normalizedPhone || normalizePhoneKey(nextPhone),
      phonesRaw: mergeUniqueStrings(currentPhones, [nextPhone, phone]),
      companyType,
      counterpartyTypeName,
      archived: false,
      searchText: recordCounterpartySearchText(input, {
        name: existing.name,
        phone: nextPhone,
        email: nextEmail,
        companyType,
        counterpartyTypeName,
        raw: nextRaw,
      }),
      raw: toJson(nextRaw),
      syncedAt: new Date(),
    },
  });
  return { counterparty: updated, created: false };
}

function buildRecordDemandDescription(input: CreateDemandFromRecordBody) {
  const services = (input.services ?? []).map(cleanRecordText).filter(Boolean);
  const vehicle = input.vehicle ?? {};
  return [
    services.length ? `Услуги из записи: ${services.join(", ")}` : "",
    cleanRecordText(input.comment),
    cleanRecordText(input.internalComment) ? `Внутренний комментарий: ${cleanRecordText(input.internalComment)}` : "",
    cleanRecordText(vehicle.model) ? `Автомобиль: ${cleanRecordText(vehicle.model)}` : "",
    cleanRecordText(vehicle.plate) ? `Госномер: ${cleanRecordText(vehicle.plate)}` : "",
    cleanRecordText(vehicle.vin) ? `VIN: ${cleanRecordText(vehicle.vin)}` : "",
    cleanRecordText(input.recordDateTime) ? `Запись: ${cleanRecordText(input.recordDateTime)}` : "",
    cleanRecordText(input.sourceLabel) || cleanRecordText(input.recordSource) ? `Источник записи: ${cleanRecordText(input.sourceLabel) || cleanRecordText(input.recordSource)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function recordDemandAttributeInput(input: CreateDemandFromRecordBody) {
  const vehicle = input.vehicle ?? {};
  return [
    { name: "VIN", value: cleanRecordText(vehicle.vin) || null },
    { name: "Госномер", value: cleanRecordText(vehicle.plate) || null },
    { name: "Модель авто", value: cleanRecordText(vehicle.model) || null },
  ];
}

export async function createLocalDemandFromRecord(
  input: CreateDemandFromRecordBody,
  options?: { ecoUserName?: string }
): Promise<
  | { ok: true; id: string; name: string; href: string; counterpartyId: string; counterpartyCreated: boolean }
  | { ok: false; error: string }
> {
  const moment = parseMoment(cleanRecordText(input.recordDateTime) || undefined);
  const description = buildRecordDemandDescription(input);
  const localAttributes = await buildLocalDemandAttributes(recordDemandAttributeInput(input), options?.ecoUserName);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { organization, store } = await findDefaultRecordShipmentContext(tx);
      if (!organization) throw new Error("Организация не найдена в локальной БД. Запустите импорт или seed.");
      if (!store) throw new Error("Склад не найден в локальной БД. Запустите импорт складского зеркала.");

      const resolved = await resolveRecordCounterparty(tx, input);
      const generatedNumber = await nextLocalDemandNameInTx(tx);
      const name = generatedNumber.name;
      const raw = {
        source: "records",
        documentNumberScheme: LOCAL_DEMAND_NUMBER_SCHEME,
        documentNumberSequence: generatedNumber.sequence,
        sourceRecord: {
          id: cleanRecordText(input.recordId) || null,
          datetime: cleanRecordText(input.recordDateTime) || null,
          source: cleanRecordText(input.recordSource) || null,
          sourceLabel: cleanRecordText(input.sourceLabel) || null,
          services: (input.services ?? []).map(cleanRecordText).filter(Boolean),
        },
        counterpartyId: resolved.counterparty.id,
        ecoUserName: options?.ecoUserName ?? null,
      };

      const demand = await tx.localDemand.create({
        data: {
          name,
          momentAt: moment.momentAt,
          documentDate: moment.documentDate,
          applicable: false,
          sumCents: 0,
          description: description || null,
          counterpartyId: resolved.counterparty.id,
          agentNameSnapshot: resolved.counterparty.name,
          storeId: store.id,
          storeNameSnapshot: store.name,
          organizationId: organization.id,
          organizationName: organization.name,
          attributes: toJson(localAttributes),
          raw: toJson(raw),
          syncedAt: new Date(),
        },
      });
      await createShipmentRevision(tx, {
        shipmentId: demand.id,
        revisionNumber: 1,
        eventType: "CREATED",
        statusBefore: null,
        statusAfter: demandStatus(demand.applicable),
        snapshotAfter: shipmentSnapshot(demand, []),
        actor: options?.ecoUserName ? { login: options.ecoUserName, name: options.ecoUserName, role: "admin" } : null,
      });

      return {
        demand,
        counterpartyId: resolved.counterparty.id,
        counterpartyCreated: resolved.created,
      };
    });

    invalidateDemandCostConsumers();
    invalidateDemandListCache();
    invalidateCounterpartyRows();
    return {
      ok: true,
      id: result.demand.id,
      name: result.demand.name,
      href: `local://demand/${result.demand.id}`,
      counterpartyId: result.counterpartyId,
      counterpartyCreated: result.counterpartyCreated,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось создать отгрузку из записи" };
  }
}

export async function linkLocalDemandToAppointment(
  id: string,
  input: LinkDemandToAppointmentBody,
  actor: ShipmentActor
): Promise<{ ok: true; id: string; name: string; appointmentId: string } | { ok: false; error: string; notFound?: boolean }> {
  const appointmentId = cleanRecordText(input.appointmentId);
  if (!appointmentId) return { ok: false, error: "Укажите запись для связи" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.localDemand.findFirst({
        where: { OR: [{ id }, { id: id }] },
        include: { positions: true, counterparty: true, store: true, organization: true },
      });
      if (!current) throw new Error("NOT_FOUND");

      const currentRaw = jsonRecord(current.raw);
      const currentSourceRecord = jsonRecord(currentRaw.sourceRecord);
      const currentHistory = Array.isArray(currentRaw.appointmentShipmentLinkHistory)
        ? currentRaw.appointmentShipmentLinkHistory
        : [];
      const linkedAt = new Date().toISOString();
      const linkSource = input.linkSource ?? "manual";
      const confidence = input.confidence ?? "high";
      const vehicle = input.vehicle ?? {};
      const sourceRecord = {
        ...currentSourceRecord,
        id: appointmentId,
        datetime: cleanRecordText(input.recordDateTime) || currentSourceRecord.datetime || null,
        source: cleanRecordText(input.recordSource) || currentSourceRecord.source || null,
        sourceLabel: cleanRecordText(input.sourceLabel) || currentSourceRecord.sourceLabel || null,
        clientName: cleanRecordText(input.clientName) || currentSourceRecord.clientName || null,
        clientPhone: cleanRecordText(input.clientPhone) || currentSourceRecord.clientPhone || null,
        vehicle: {
          ...jsonRecord(currentSourceRecord.vehicle),
          model: cleanRecordText(vehicle.model) || jsonRecord(currentSourceRecord.vehicle).model || null,
          plate: cleanRecordText(vehicle.plate) || jsonRecord(currentSourceRecord.vehicle).plate || null,
          vin: cleanRecordText(vehicle.vin) || jsonRecord(currentSourceRecord.vehicle).vin || null,
          year: cleanRecordText(vehicle.year) || jsonRecord(currentSourceRecord.vehicle).year || null,
        },
      };
      const nextRaw = {
        ...currentRaw,
        sourceRecord,
        appointmentShipmentLink: {
          appointmentId,
          shipmentId: current.id,
          linkSource,
          confidence,
          linkedAt,
          linkedBy: actor.login,
          linkedByName: actor.name,
          comment: cleanRecordText(input.comment) || null,
        },
        appointmentShipmentLinkHistory: [
          ...currentHistory,
          {
            appointmentId,
            shipmentId: current.id,
            linkSource,
            confidence,
            linkedAt,
            linkedBy: actor.login,
            comment: cleanRecordText(input.comment) || null,
          },
        ],
        lastLocalUpdate: linkedAt,
      };
      const revisionNumber = await nextShipmentRevisionNumber(tx, current.id);
      const beforeSnapshot = shipmentSnapshot(current, current.positions);
      const updated = await tx.localDemand.update({
        where: { id: current.id },
        data: {
          raw: toJson(nextRaw),
          syncedAt: new Date(),
        },
        include: { positions: true, counterparty: true, store: true, organization: true },
      });
      await createShipmentRevision(tx, {
        shipmentId: current.id,
        revisionNumber,
        eventType: "APPOINTMENT_LINKED",
        statusBefore: demandStatus(current.applicable),
        statusAfter: demandStatus(updated.applicable),
        snapshotBefore: beforeSnapshot,
        snapshotAfter: shipmentSnapshot(updated, updated.positions),
        reasonCode: linkSource,
        reason:
          cleanRecordText(input.comment) ||
          `Запись ${appointmentId} связана с отгрузкой ${current.name}`,
        actor,
      });
      return updated;
    });

    invalidateDemandCostConsumers();
    invalidateDemandListCache();
    invalidateCounterpartyRows();
    return { ok: true, id: result.id, name: result.name, appointmentId };
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось связать запись с отгрузкой" };
  }
}

export async function createLocalDemand(
  body: CreateDemandBody,
  options: { ecoUserName?: string; actor?: ShipmentActor | null; branchId?: string; organizationId?: string } = {}
): Promise<{ ok: true; id: string; name: string; href: string } | { ok: false; error: string }> {
  let scope: { branchId: string; organizationId: string };
  try {
    scope = await resolveDemandBranchScope(options.branchId, options.organizationId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось определить филиал" };
  }
  const storeId = entityIdFromMeta(body.store?.meta);
  const counterpartyId = entityIdFromMeta(body.agent?.meta);
  const organizationLookupId = entityIdFromMeta(body.organization?.meta);
  const [store, explicitCounterparty, organization] = await Promise.all([
    storeId
      ? prisma.localStore.findFirst({ where: { branchId: scope.branchId, OR: [{ id: storeId }, { id: storeId }] } })
      : null,
    counterpartyId
      ? prisma.localCounterparty.findFirst({ where: { branchId: scope.branchId, OR: [{ id: counterpartyId }, { id: counterpartyId }] } })
      : null,
    organizationLookupId
      ? prisma.localOrganization.findFirst({ where: { id: scope.organizationId, isActive: true, OR: [{ id: organizationLookupId }, { id: organizationLookupId }] } })
      : null,
  ]);

  const counterparty = explicitCounterparty ?? (
    counterpartyId ? null : await ensureAnonymousRetailCounterparty(scope.branchId)
  );

  if (!organization) return { ok: false, error: "Организация не найдена в локальной БД. Запустите импорт или seed." };
  if (!store) return { ok: false, error: "Склад не найден в локальной БД. Запустите импорт складского зеркала." };
  if (store.organizationId && store.organizationId !== organization.id) return { ok: false, error: "Выбранный склад не относится к выбранной организации" };
  if (!counterparty) {
    return { ok: false, error: "Контрагент не найден в локальной БД. Запустите импорт или выберите импортированного контрагента." };
  }

  const { documentDate, momentAt } = parseMoment(body.moment);
  const actor = options.actor ?? (options.ecoUserName
    ? { login: options.ecoUserName, name: options.ecoUserName, role: "admin" as const }
    : null);
  const positions = await resolveCreatePositions(body.positions, store.id, scope.branchId, actor);
  const applicable = body.applicable ?? false;
  const localAttributes = await buildLocalDemandAttributes(body.attributes, options?.ecoUserName);

  let demand: Awaited<ReturnType<typeof prisma.localDemand.create>>;
  try {
    demand = await prisma.$transaction(async (tx) => {
      const costedPositions = applicable
        ? await freezePostingCostSnapshots(tx, scope.branchId, store.id, positions, { preserveExistingSnapshots: false })
        : positions;
      const effectivePositions = applicable
        ? await freezeSalesAnalyticsSnapshots(tx, scope.branchId, costedPositions, { preserveExistingSnapshots: false })
        : costedPositions;
      const generatedNumber = body.name?.trim() ? null : await nextLocalDemandNameInTx(tx);
      const name = body.name?.trim() || generatedNumber?.name || "0001";
      const raw = {
        ...body,
        agent: body.agent ?? { meta: localMeta("counterparty", counterparty.id) },
        customerMode: isAnonymousRetailCounterparty(counterparty) ? "anonymous_retail" : "identified",
        ecoUserName: options?.ecoUserName ?? null,
        ...(generatedNumber
          ? {
              documentNumberScheme: LOCAL_DEMAND_NUMBER_SCHEME,
              documentNumberSequence: generatedNumber.sequence,
            }
          : {}),
      };
      const created = await tx.localDemand.create({
        data: {
          branchId: scope.branchId,
          name,
          momentAt,
          documentDate,
          applicable,
          sumCents: sumPositionsCents(effectivePositions),
          description: body.description?.trim() || null,
          counterpartyId: counterparty.id,
          agentNameSnapshot: counterparty.name,
          storeId: store.id,
          storeNameSnapshot: store.name,
          organizationId: organization.id,
          organizationName: organization.name,
          attributes: toJson(localAttributes),
          raw: toJson(raw),
          syncedAt: new Date(),
        },
      });

      if (effectivePositions.length > 0) {
        await tx.localDemandPosition.createMany({
          data: effectivePositions.map((position) => ({
            branchId: scope.branchId,
            demandId: created.id,
            productId: position.productId,
            groupIdSnapshot: position.groupIdSnapshot,
            assortmentType: position.assortmentType,
            name: position.name,
            quantity: position.quantity,
            priceCentsPerUnit: position.priceCentsPerUnit,
            discount: position.discount,
            vat: position.vat,
            vatEnabled: position.vatEnabled,
            buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
            slotName: position.slotName,
            analyticsMetricCode: position.analyticsMetricCode,
            analyticsCategoryLabel: position.analyticsCategoryLabel,
            analyticsMatchMethod: position.analyticsMatchMethod,
            analyticsMappingVersion: position.analyticsMappingVersion,
            serviceAggregateType: position.serviceAggregateType,
            serviceProcedure: position.serviceProcedure,
            serviceConfiguration: position.serviceConfiguration,
            analyticsBaseQuantity: position.analyticsBaseQuantity,
            analyticsBaseUnit: position.analyticsBaseUnit,
            raw: position.raw,
          })),
        });
      }

      await applyStockMovements(
        tx,
        store.id,
        [],
        false,
        effectivePositions,
        applicable,
        applicable
          ? {
              branchId: created.branchId,
              sourceType: "SHIPMENT",
              sourceId: created.id,
              organizationId: organization.id,
              movementType: "SHIPMENT_POST",
              revision: 1,
              createdById: actor?.login ?? null,
              createdByName: actor?.name ?? null,
            }
          : undefined
      );
      await createShipmentRevision(tx, {
        shipmentId: created.id,
        revisionNumber: 1,
        eventType: "CREATED",
        statusBefore: null,
        statusAfter: demandStatus(created.applicable),
        snapshotAfter: shipmentSnapshot(created, effectivePositions),
        actor,
      });
      return created;
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось создать локальную отгрузку" };
  }

  invalidateDemandCostConsumers();
  invalidateDemandListCache();
  return { ok: true, id: demand.id, name: demand.name, href: `local://demand/${demand.id}` };
}

export async function updateLocalDemand(
  id: string,
  body: UpdateDemandBody,
  actor: ShipmentActor | null | undefined,
  branchId?: string,
  organizationId?: string
): Promise<{ ok: true; id: string; name: string; applicable: boolean; description: string } | { ok: false; error: string; notFound?: boolean }> {
  const scope = await resolveDemandBranchScope(branchId, organizationId);
  const current = await findLocalDemand(id, scope.branchId);
  if (!current) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };
  if (current.applicable) {
    return {
      ok: false,
      error: "Проведённую отгрузку нельзя редактировать напрямую. Сначала верните документ в черновик.",
    };
  }

  const storeLookupId = entityIdFromMeta(body.store?.meta);
  const agentLookupId = entityIdFromMeta(body.agent?.meta);
  const organizationLookupId = entityIdFromMeta(body.organization?.meta);
  const [nextStore, nextCounterparty, nextOrganization] = await Promise.all([
    storeLookupId
      ? prisma.localStore.findFirst({ where: { branchId: scope.branchId, OR: [{ id: storeLookupId }, { id: storeLookupId }] } })
      : current.store,
    agentLookupId
      ? prisma.localCounterparty.findFirst({ where: { branchId: scope.branchId, OR: [{ id: agentLookupId }, { id: agentLookupId }] } })
      : current.counterparty,
    organizationLookupId
      ? prisma.localOrganization.findFirst({ where: { id: scope.organizationId, isActive: true, OR: [{ id: organizationLookupId }, { id: organizationLookupId }] } })
      : current.organization,
  ]);

  if (body.store?.meta && !nextStore) return { ok: false, error: "Склад не найден в локальной БД" };
  if (body.agent?.meta && !nextCounterparty) return { ok: false, error: "Контрагент не найден в локальной БД" };
  if (body.organization?.meta && !nextOrganization) return { ok: false, error: "Организация не найдена в локальной БД" };
  if (nextStore?.organizationId && nextOrganization?.id && nextStore.organizationId !== nextOrganization.id) {
    return { ok: false, error: "Выбранный склад не относится к выбранной организации" };
  }

  const existingById = new Map(
    current.positions.map((position) => [
      position.id,
      {
        productId: position.productId,
        groupIdSnapshot: position.groupIdSnapshot,
        assortmentType: position.assortmentType,
        quantity: position.quantity,
        name: position.name,
        buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
        analyticsMetricCode: position.analyticsMetricCode,
        analyticsCategoryLabel: position.analyticsCategoryLabel,
        analyticsMatchMethod: position.analyticsMatchMethod,
        analyticsMappingVersion: position.analyticsMappingVersion,
        serviceAggregateType: position.serviceAggregateType,
        serviceProcedure: position.serviceProcedure,
        serviceConfiguration: position.serviceConfiguration,
        analyticsBaseQuantity: position.analyticsBaseQuantity,
        analyticsBaseUnit: position.analyticsBaseUnit,
        raw: position.raw,
      },
    ])
  );

  const nextPositions = Array.isArray(body.positions)
    ? await resolveUpdatePositions(body.positions, existingById, scope.branchId, actor)
    : current.positions.map((position) => ({
        id: position.id,
        sourcePositionId: position.id,
        productId: position.productId,
        groupIdSnapshot: position.groupIdSnapshot,
        assortmentReference: null,
        assortmentType: position.assortmentType,
        name: position.name,
        quantity: position.quantity,
        priceCentsPerUnit: position.priceCentsPerUnit,
        discount: position.discount,
        vat: position.vat,
        vatEnabled: position.vatEnabled,
        buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
        slotName: position.slotName,
        analyticsMetricCode: position.analyticsMetricCode,
        analyticsCategoryLabel: position.analyticsCategoryLabel,
        analyticsMatchMethod: position.analyticsMatchMethod,
        analyticsMappingVersion: position.analyticsMappingVersion,
        serviceAggregateType: position.serviceAggregateType,
        serviceProcedure: position.serviceProcedure,
        serviceConfiguration: position.serviceConfiguration,
        analyticsBaseQuantity: position.analyticsBaseQuantity,
        analyticsBaseUnit: position.analyticsBaseUnit,
        raw: toJson(position.raw),
      }));
  const nextApplicable = typeof body.applicable === "boolean" ? body.applicable : current.applicable;
  const nextDescription = typeof body.description === "string" ? body.description.trim() : current.description;
  const nextName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
  const nextMoment = body.moment ? parseMoment(body.moment) : { documentDate: current.documentDate, momentAt: current.momentAt };
  const nextStoreId = nextStore?.id ?? current.storeId;
  const storeChanged = Boolean(nextStoreId && nextStoreId !== current.storeId);
  const importedDraftBeingPosted = false;

  let updated: Awaited<ReturnType<typeof prisma.localDemand.update>>;
  try {
    updated = await prisma.$transaction(async (tx) => {
    const hasReopenHistory = nextApplicable
      ? Boolean(await tx.shipmentRevision.findFirst({
          where: { shipmentId: current.id, eventType: "REOPENED" },
          select: { id: true },
        }))
      : false;
    const eventType = nextApplicable ? hasReopenHistory ? "REPOSTED" : "POSTED" : "UPDATED";
    const postMovementType = eventType === "REPOSTED" ? "SHIPMENT_REPOST" : "SHIPMENT_POST";
    const costedPositions = nextApplicable
      ? await freezePostingCostSnapshots(tx, current.branchId, nextStoreId, nextPositions, {
          preserveExistingSnapshots: eventType === "REPOSTED",
        })
      : nextPositions;
    const effectivePositions = nextApplicable
      ? await freezeSalesAnalyticsSnapshots(tx, current.branchId, costedPositions, {
          preserveExistingSnapshots: eventType === "REPOSTED",
        })
      : costedPositions;
    const revisionNumber = await nextShipmentRevisionNumber(tx, current.id);
    const beforeSnapshot = shipmentSnapshot(current, current.positions);
    if (!importedDraftBeingPosted) {
      if (storeChanged) {
        await applyStockMovements(tx, current.storeId, current.positions, current.applicable, [], false, {
          branchId: current.branchId,
          sourceType: "SHIPMENT",
          sourceId: current.id,
          organizationId: current.organizationId,
          movementType: "SHIPMENT_UPDATE",
          revision: revisionNumber,
          createdById: actor?.login ?? null,
          createdByName: actor?.name ?? null,
        });
        await applyStockMovements(tx, nextStoreId, [], false, effectivePositions, nextApplicable, nextApplicable
          ? {
              branchId: current.branchId,
              sourceType: "SHIPMENT",
              sourceId: current.id,
              organizationId: current.organizationId,
              movementType: nextApplicable ? postMovementType : "SHIPMENT_UPDATE",
              revision: revisionNumber,
              createdById: actor?.login ?? null,
              createdByName: actor?.name ?? null,
            }
          : undefined);
      } else {
        await applyStockMovements(
          tx,
          current.storeId,
          current.positions,
          current.applicable,
          effectivePositions,
          nextApplicable,
          nextApplicable
            ? {
                branchId: current.branchId,
                sourceType: "SHIPMENT",
                sourceId: current.id,
                organizationId: current.organizationId,
                movementType: nextApplicable ? postMovementType : "SHIPMENT_UPDATE",
                revision: revisionNumber,
                createdById: actor?.login ?? null,
                createdByName: actor?.name ?? null,
              }
            : undefined
        );
      }
    }

    if (Array.isArray(body.positions)) {
      await tx.localDemandPosition.deleteMany({ where: { demandId: current.id } });
      if (effectivePositions.length > 0) {
        await tx.localDemandPosition.createMany({
          data: effectivePositions.map((position) => ({
            branchId: current.branchId,
            demandId: current.id,
            productId: position.productId,
            groupIdSnapshot: position.groupIdSnapshot,
            assortmentType: position.assortmentType,
            name: position.name,
            quantity: position.quantity,
            priceCentsPerUnit: position.priceCentsPerUnit,
            discount: position.discount,
            vat: position.vat,
            vatEnabled: position.vatEnabled,
            buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
            slotName: position.slotName,
            analyticsMetricCode: position.analyticsMetricCode,
            analyticsCategoryLabel: position.analyticsCategoryLabel,
            analyticsMatchMethod: position.analyticsMatchMethod,
            analyticsMappingVersion: position.analyticsMappingVersion,
            serviceAggregateType: position.serviceAggregateType,
            serviceProcedure: position.serviceProcedure,
            serviceConfiguration: position.serviceConfiguration,
            analyticsBaseQuantity: position.analyticsBaseQuantity,
            analyticsBaseUnit: position.analyticsBaseUnit,
            raw: position.raw,
          })),
        });
      }
    } else if (nextApplicable) {
      for (const position of effectivePositions) {
        if (!position.id) continue;
        await tx.localDemandPosition.update({
          where: { id: position.id },
          data: {
            buyPriceCentsPerUnit: position.buyPriceCentsPerUnit,
            analyticsMetricCode: position.analyticsMetricCode,
            analyticsCategoryLabel: position.analyticsCategoryLabel,
            analyticsMatchMethod: position.analyticsMatchMethod,
            analyticsMappingVersion: position.analyticsMappingVersion,
            serviceAggregateType: position.serviceAggregateType,
            serviceProcedure: position.serviceProcedure,
            serviceConfiguration: position.serviceConfiguration,
            analyticsBaseQuantity: position.analyticsBaseQuantity,
            analyticsBaseUnit: position.analyticsBaseUnit,
          },
        });
      }
    }

    const nextRawBase = typeof current.raw === "object" && current.raw ? current.raw : {};
    const updated = await tx.localDemand.update({
      where: { id: current.id },
      data: {
        name: nextName,
        momentAt: nextMoment.momentAt,
        documentDate: nextMoment.documentDate,
        applicable: nextApplicable,
        description: nextDescription || null,
        counterpartyId: nextCounterparty?.id ?? current.counterpartyId,
        agentNameSnapshot: nextCounterparty?.name ?? current.agentNameSnapshot,
        storeId: nextStore?.id ?? current.storeId,
        storeNameSnapshot: nextStore?.name ?? current.storeNameSnapshot,
        organizationId: nextOrganization?.id ?? current.organizationId,
        organizationName: nextOrganization?.name ?? current.organizationName,
        attributes: Array.isArray(body.attributes) ? toJson(body.attributes) : current.attributes ?? Prisma.JsonNull,
        sumCents: sumPositionsCents(effectivePositions),
        raw: toJson({
          ...nextRawBase,
          ...(nextCounterparty
            ? {
                agent: { meta: localMeta("counterparty", nextCounterparty.id) },
                customerMode: isAnonymousRetailCounterparty(nextCounterparty) ? "anonymous_retail" : "identified",
              }
            : {}),
          lastLocalUpdate: new Date().toISOString(),
          ...(nextApplicable ? { lastPostedAt: new Date().toISOString(), lastPostedBy: actor?.login ?? null } : {}),
        }),
        syncedAt: new Date(),
      },
    });
    await createShipmentRevision(tx, {
      shipmentId: current.id,
      revisionNumber,
      eventType,
      statusBefore: demandStatus(current.applicable),
      statusAfter: demandStatus(updated.applicable),
      snapshotBefore: beforeSnapshot,
      snapshotAfter: shipmentSnapshot(updated, effectivePositions),
      actor,
    });
    return updated;
    });
  } catch (error) {
    return { ok: false, error: demandWriteErrorMessage(error, "Не удалось сохранить отгрузку") };
  }

  invalidateDemandCostConsumers();
  invalidateDemandListCache();
  await syncActiveDiagnosticVehiclesForShipment(updated.id, {
    userLogin: actor?.login ?? "system",
    reason: "shipment-save",
  }).catch((error) => {
    console.warn("[shipment] diagnostic vehicle sync after save failed", {
      shipmentId: updated.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return {
    ok: true,
    id: updated.id,
    name: updated.name,
    applicable: updated.applicable,
    description: updated.description ?? "",
  };
}

function canReopenShipment(actor?: ShipmentActor | null): boolean {
  return actor?.role === "owner" || actor?.role === "admin";
}

async function loadReopenRelations(shipmentId: string, branchId: string) {
  const [closingDocuments, diagnostics] = await Promise.all([
    prisma.closingDocument.findMany({
      where: { branchId, shipmentId },
      select: { id: true, type: true, number: true, status: true, revision: true, issuedAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.diagnosticMapSession.findMany({
      where: { branchId, demandId: shipmentId },
      select: { id: true, status: true, totalCount: true, completedAt: true, publicToken: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { closingDocuments, diagnostics };
}

function isBlockingClosingStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return Boolean(normalized && !["draft", "cancelled", "canceled", "void", "annulled"].includes(normalized));
}

export async function getLocalDemandReopenCheck(
  id: string,
  actor?: ShipmentActor | null,
  branchId?: string
): Promise<
  | {
      ok: true;
      shipment: { id: string; name: string; status: "DRAFT" | "POSTED"; updatedAt: string; sumCents: number };
      canReopen: boolean;
      blockers: string[];
      warnings: string[];
      consequences: string[];
      related: {
        positionsCount: number;
        trackedPositionsCount: number;
        quantityToRestore: number;
        closingDocuments: { id: string; type: string; number: string; status: string; revision: number }[];
        diagnostics: { id: string; status: string; totalCount: number; completedAt: string | null }[];
      };
    }
  | { ok: false; error: string; notFound?: boolean }
> {
  const scope = await resolveDemandBranchScope(branchId);
  const current = await findLocalDemand(id, scope.branchId);
  if (!current) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!current.applicable) blockers.push("Отгрузка уже находится в черновике");
  if (!canReopenShipment(actor)) blockers.push("Недостаточно прав для возврата проведённой отгрузки в черновик");

  const { closingDocuments, diagnostics } = await loadReopenRelations(current.id, current.branchId);
  for (const doc of closingDocuments) {
    if (isBlockingClosingStatus(doc.status)) {
      blockers.push(`По отгрузке выпущен закрывающий документ ${doc.type.toUpperCase()}-${doc.number}. Сначала аннулируйте документ или создайте корректировку.`);
    }
  }
  if (diagnostics.length > 0) warnings.push("Связанная диагностика сохранится, но отчёт может потребовать пересчёта после изменений");

  const trackedPositions = current.positions.filter((position) => position.productId && isStockTrackedType(position.assortmentType));
  const quantityToRestore = trackedPositions.reduce((sum, position) => sum + decimalToNumber(position.quantity), 0);
  try {
    await assertNoActiveInventoryLocks(prisma, {
      organizationId: current.organizationId,
      warehouseId: current.storeId,
      productIds: trackedPositions.map((position) => position.productId),
    });
  } catch (error) {
    blockers.push(demandWriteErrorMessage(error, "Одна из позиций участвует в активной инвентаризации"));
  }

  return {
    ok: true,
    shipment: {
      id: current.id,
      name: current.name,
      status: demandStatus(current.applicable),
      updatedAt: current.updatedAt.toISOString(),
      sumCents: current.sumCents,
    },
    canReopen: blockers.length === 0,
    blockers,
    warnings,
    consequences: [
      `Будет возвращено на склад позиций: ${trackedPositions.length}`,
      "Документ временно исключится из выручки, себестоимости и прибыли",
      "Печатные формы и предчек нужно будет сформировать заново после повторного проведения",
      "Номер отгрузки сохранится",
    ],
    related: {
      positionsCount: current.positions.length,
      trackedPositionsCount: trackedPositions.length,
      quantityToRestore,
      closingDocuments: closingDocuments.map((doc) => ({
        id: doc.id,
        type: doc.type,
        number: doc.number,
        status: doc.status,
        revision: doc.revision,
      })),
      diagnostics: diagnostics.map((diagnostic) => ({
        id: diagnostic.id,
        status: diagnostic.status,
        totalCount: diagnostic.totalCount,
        completedAt: diagnostic.completedAt?.toISOString() ?? null,
      })),
    },
  };
}

export async function reopenLocalDemand(
  id: string,
  body: ReopenDemandBody,
  actor: ShipmentActor,
  branchId?: string,
  organizationId?: string
): Promise<{ ok: true; id: string; name: string; applicable: boolean; updatedAt: string } | { ok: false; error: string; notFound?: boolean; conflict?: boolean }> {
  if (!canReopenShipment(actor)) {
    return { ok: false, error: "Недостаточно прав для возврата проведённой отгрузки в черновик" };
  }
  const reason = normalizeReopenReason(body);
  if (!reason.ok) return { ok: false, error: reason.error };

  let scope: { branchId: string; organizationId: string };
  try {
    scope = await resolveDemandBranchScope(branchId, organizationId);
  } catch (error) {
    return { ok: false, error: demandWriteErrorMessage(error, "Не удалось определить филиал") };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.localDemand.findFirst({
        where: { branchId: scope.branchId, OR: [{ id }, { id: id }] },
        include: { positions: true, counterparty: true, store: true, organization: true },
      });
      if (!current) throw new Error("NOT_FOUND");

      const currentRaw = typeof current.raw === "object" && current.raw ? current.raw as Record<string, unknown> : {};
      if (!current.applicable) {
        if (body.idempotencyKey && currentRaw.lastReopenIdempotencyKey === body.idempotencyKey) return current;
        throw new Error("ALREADY_DRAFT");
      }
      if (body.expectedUpdatedAt && current.updatedAt.toISOString() !== body.expectedUpdatedAt) {
        throw new Error("CONFLICT");
      }

      const blockingClosing = await tx.closingDocument.findFirst({
        where: {
          branchId: scope.branchId,
          shipmentId: current.id,
          NOT: { status: { in: ["draft", "cancelled", "canceled", "void", "annulled"] } },
        },
        select: { type: true, number: true },
      });
      if (blockingClosing) {
        throw new Error(`CLOSING:${blockingClosing.type.toUpperCase()}-${blockingClosing.number}`);
      }

      const revisionNumber = await nextShipmentRevisionNumber(tx, current.id);
      const beforeSnapshot = shipmentSnapshot(current, current.positions);
      await applyStockMovements(
        tx,
        current.storeId,
        current.positions,
        true,
        [],
        false,
        {
          branchId: current.branchId,
          sourceType: "SHIPMENT",
          sourceId: current.id,
          organizationId: current.organizationId,
          movementType: "SHIPMENT_REOPEN_REVERSAL",
          revision: revisionNumber,
          createdById: actor.login,
          createdByName: actor.name,
          raw: {
            reasonCode: reason.reasonCode,
            reason: reason.reason,
          },
        }
      );

      const next = await tx.localDemand.update({
        where: { id: current.id },
        data: {
          applicable: false,
          raw: toJson({
            ...currentRaw,
            reopenState: "draft_after_reopen",
            lastReopenedAt: new Date().toISOString(),
            lastReopenedBy: actor.login,
            lastReopenedByName: actor.name,
            lastReopenReasonCode: reason.reasonCode,
            lastReopenReason: reason.reason,
            lastReopenIdempotencyKey: body.idempotencyKey ?? null,
          }),
          syncedAt: new Date(),
        },
      });
      await createShipmentRevision(tx, {
        shipmentId: current.id,
        revisionNumber,
        eventType: "REOPENED",
        statusBefore: "POSTED",
        statusAfter: "DRAFT",
        snapshotBefore: beforeSnapshot,
        snapshotAfter: shipmentSnapshot(next, current.positions),
        reasonCode: reason.reasonCode,
        reason: reason.reason,
        actor,
      });
      return next;
    });

    invalidateDemandCostConsumers();
    invalidateDemandListCache();
    return {
      ok: true,
      id: updated.id,
      name: updated.name,
      applicable: updated.applicable,
      updatedAt: updated.updatedAt.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NOT_FOUND") return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };
    if (message === "ALREADY_DRAFT") return { ok: false, error: "Отгрузка уже находится в черновике" };
    if (message === "CONFLICT") return { ok: false, error: "Отгрузка уже была изменена другим пользователем. Обновите страницу и повторите действие.", conflict: true };
    if (message.startsWith("CLOSING:")) {
      return { ok: false, error: `По отгрузке выпущен закрывающий документ ${message.slice("CLOSING:".length)}. Сначала аннулируйте документ или создайте корректировку.` };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось вернуть отгрузку в черновик" };
  }
}

export async function listLocalDemandRevisions(id: string, branchId?: string): Promise<
  | { ok: true; rows: { id: string; revisionNumber: number; eventType: string; statusBefore: string | null; statusAfter: string | null; reason: string | null; reasonCode: string | null; createdByName: string | null; createdAt: string }[] }
  | { ok: false; error: string; notFound?: boolean }
> {
  const scope = await resolveDemandBranchScope(branchId);
  const current = await findLocalDemand(id, scope.branchId);
  if (!current) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };
  const rows = await prisma.shipmentRevision.findMany({
    where: { shipmentId: current.id },
    orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      revisionNumber: true,
      eventType: true,
      statusBefore: true,
      statusAfter: true,
      reason: true,
      reasonCode: true,
      createdByName: true,
      createdAt: true,
    },
  });
  return {
    ok: true,
    rows: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function deleteLocalDemand(
  id: string,
  branchId?: string
): Promise<{ ok: true } | { ok: false; error: string; notFound?: boolean }> {
  const scope = await resolveDemandBranchScope(branchId);
  const current = await findLocalDemand(id, scope.branchId);
  if (!current) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };
  if (current.applicable) {
    return { ok: false, error: "Проведённую отгрузку нельзя удалить напрямую. Сначала верните документ в черновик или используйте сценарий отмены." };
  }

  await prisma.$transaction(async (tx) => {
    await applyStockMovements(tx, current.storeId, current.positions, current.applicable, [], false);
    await tx.localDemand.delete({ where: { id: current.id } });
  });

  invalidateDemandCostConsumers();
  invalidateDemandListCache();
  return { ok: true };
}

export async function loadLocalDemandDetailPayload(
  id: string,
  branchId?: string
): Promise<{ ok: true; data: DemandDetailPayload } | { ok: false; error: string; notFound?: boolean }> {
  const explicitBranch = branchId
    ? await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, legacyOrganizationId: true } })
    : null;
  const scope = explicitBranch?.legacyOrganizationId
    ? { branchId: explicitBranch.id, organizationId: explicitBranch.legacyOrganizationId }
    : await resolveDemandBranchScope(branchId);
  const demand = await prisma.localDemand.findFirst({
    where: { branchId: scope.branchId, OR: [{ id }, { id: id }] },
    include: {
      counterparty: true,
      store: true,
      organization: true,
      positions: { include: { product: true }, orderBy: { id: "asc" } },
    },
  });
  if (!demand) return { ok: false, error: "Локальная отгрузка не найдена", notFound: true };

  const positions: DemandDetailPosition[] = demand.positions.map((position) => {
    const positionRaw = jsonRecord(position.raw);
    const copyMeta = positionRaw.copyMeta;
    const oneOffServiceRaw = jsonRecord(positionRaw.oneOffService);
    const oneOffService = cleanRecordText(oneOffServiceRaw.analyticsMetricCode)
      ? {
          analyticsMetricCode: cleanRecordText(oneOffServiceRaw.analyticsMetricCode),
          aggregateType: cleanRecordText(oneOffServiceRaw.aggregateType) || null,
          procedure: cleanRecordText(oneOffServiceRaw.procedure) || null,
          configuration: cleanRecordText(oneOffServiceRaw.configuration) || null,
          classificationVersion: Number(oneOffServiceRaw.classificationVersion) || 1,
        }
      : null;
    const nonstock = isNonstockProductType(position.assortmentType)
      ? nonstockRawRecord(position.raw)
      : null;
    const assortmentMeta = position.product
      ? entityMeta(position.product.entityType, position.product.id, undefined, position.product.id)
      : nonstock
        ? localMeta(NONSTOCK_PRODUCT_ASSORTMENT_TYPE, position.id)
        : oneOffService
          ? localMeta("service", position.id)
          : undefined;
    const purchasePriceCents = typeof nonstock?.purchasePriceCents === "number"
      ? nonstock.purchasePriceCents
      : position.buyPriceCentsPerUnit;
    return {
      id: position.id,
      name: position.name,
      quantity: position.quantity.toNumber(),
      price: position.priceCentsPerUnit,
      slotName: position.slotName ?? "",
      discount: position.discount.toNumber(),
      stock: {
        cost: position.buyPriceCentsPerUnit ?? undefined,
      },
      assortmentMeta,
      lineKind: nonstock ? NONSTOCK_PRODUCT_LINE_KIND : oneOffService ? "one_off_service" : undefined,
      oneOffProduct: nonstock
        ? {
            groupCode: cleanRecordText(nonstock.groupCode),
            groupLabel: cleanRecordText(nonstock.groupLabel),
            brand: cleanRecordText(nonstock.brandRaw) || cleanRecordText(nonstock.brandCanonical),
            brandCanonical: cleanRecordText(nonstock.brandCanonical),
            article: cleanRecordText(nonstock.articleRaw) || cleanRecordText(nonstock.articleDisplay),
            articleDisplay: cleanRecordText(nonstock.articleDisplay),
            articleCanonical: cleanRecordText(nonstock.articleCanonical),
            uomCode: cleanRecordText(nonstock.uomCode),
            uomLabel: cleanRecordText(nonstock.uomLabel),
            purchasePrice: purchasePriceCents == null ? null : purchasePriceCents / 100,
            explicitZeroCost: nonstock.explicitZeroCost === true,
            purchaseSourceId: cleanRecordText(nonstock.purchaseSourceId) || null,
            purchaseSourceLabel: cleanRecordText(nonstock.purchaseSourceLabel) || null,
            clarification: cleanRecordText(nonstock.clarification) || null,
            analyticsKey: cleanRecordText(nonstock.analyticsKey),
            costSource: cleanRecordText(nonstock.costSource),
            catalogMatchProductId: cleanRecordText(nonstock.catalogMatchProductId) || null,
          }
        : undefined,
      oneOffService: oneOffService ?? undefined,
      comment: cleanRecordText(positionRaw.comment) || undefined,
      product: position.product
        ? {
            id: position.product.id,
            name: position.product.name,
            uomName: position.product.uomName,
            groupPath: position.product.groupPath,
            packageVolume: position.product.packageVolume,
            volume: position.product.volume == null ? null : String(position.product.volume),
            barcodeEan13: position.product.barcodeEan13,
            markingEnabled: position.product.markingEnabled,
            markingMode: position.product.markingMode,
            markingStatus: position.product.markingStatus,
            markingSettings: position.product.markingSettings,
          }
        : undefined,
      copyMeta,
    };
  });

  if (demand.storeId) {
    const balances = await prisma.localStockBalance.findMany({
      where: {
        storeId: demand.storeId,
        productId: { in: demand.positions.map((position) => position.productId).filter((value): value is string => Boolean(value)) },
      },
    });
    const balanceByProduct = new Map(balances.map((balance) => [balance.productId, balance]));
    positions.forEach((position, index) => {
      const source = demand.positions[index];
      const balance = source?.productId ? balanceByProduct.get(source.productId) : null;
      if (!balance) return;
      position.stock = {
        ...position.stock,
        quantity: balance.quantity.toNumber(),
        reserve: balance.reserve.toNumber(),
        available: balance.available.toNumber(),
      };
      if (!position.slotName && balance.slotName) position.slotName = balance.slotName;
    });
  }

  const currentAttributes = Array.isArray(demand.attributes)
    ? (demand.attributes as Array<{ definitionId?: string; id?: string; name?: string; type?: string; value?: unknown }>)
    : [];
  const currentById = new Map<string, (typeof currentAttributes)[number]>();
  const currentByName = new Map<string, (typeof currentAttributes)[number]>();
  for (const attr of currentAttributes) {
    const id = attr.definitionId ?? attr.id ?? "";
    if (id) currentById.set(id, attr);
    if (attr.name) currentByName.set(normalizeAttributeName(attr.name), attr);
  }

  const metaRes = await ensureDemandAttributeMetadata();
  const attributes: DemandDetailAttribute[] = metaRes.ok && metaRes.attributes.length > 0
    ? metaRes.attributes.map((definition) => {
        const current = currentById.get(definition.id) ?? currentByName.get(normalizeAttributeName(definition.name));
        return {
          id: definition.id,
          name: definition.name,
          type: definition.type,
          meta: definition.meta,
          value: current?.value ?? null,
        };
      })
    : currentAttributes.map((attr) => {
        const id = attr.definitionId ?? attr.id ?? attr.name ?? "";
        return {
          id,
          name: attr.name ?? id,
          type: attr.type ?? "string",
          meta: localMeta("demand-attribute", id),
          value: attr.value ?? null,
        };
      });
  const agentMeta = demand.counterparty
    ? entityMeta("counterparty", demand.counterparty.id, undefined, demand.counterparty.id)
    : demand.counterpartyId
      ? localMeta("counterparty", demand.counterpartyId, null)
      : undefined;
  const storeMeta = demand.store
    ? entityMeta("store", demand.store.id, undefined, demand.store.id)
    : demand.storeId
      ? localMeta("store", demand.storeId, null)
      : undefined;
  const organizationMeta = demand.organization
    ? entityMeta("organization", demand.organization.id, undefined, demand.organization.id)
    : undefined;

  const data: DemandDetailPayload = {
    branchId: demand.branchId,
    header: {
      id: demand.id,
      name: demand.name,
      moment: demand.momentAt.toISOString(),
      applicable: demand.applicable,
      description: demand.description ?? "",
      sum: demand.sumCents,
      href: `local://demand/${demand.id}`,
      agentName: demand.counterparty?.name ?? demand.agentNameSnapshot ?? "",
      organizationName: demand.organization?.name ?? demand.organizationName ?? "",
      storeName: demand.store?.name ?? demand.storeNameSnapshot ?? "",
      storeId: demand.store?.id ?? demand.storeId ?? "",
      ecoUserName: undefined,
    },
    attributes,
    positions,
    raw: {
      id: demand.id,
      meta: localMeta("demand", demand.id),
      agent: demand.counterparty
        ? {
            id: demand.counterparty.id ?? demand.counterparty.id,
            name: demand.counterparty.name,
            phone: demand.counterparty.phone ?? undefined,
            companyType: demand.counterparty.companyType ?? undefined,
            counterpartyTypeName: demand.counterparty.counterpartyTypeName ?? undefined,
            isSystem: isAnonymousRetailCounterparty(demand.counterparty),
            isAnonymousRetail: isAnonymousRetailCounterparty(demand.counterparty),
            subtitle: isAnonymousRetailCounterparty(demand.counterparty) ? "Без данных клиента" : undefined,
            legalTitle: demand.counterparty.legalTitle ?? undefined,
            inn: demand.counterparty.inn ?? undefined,
            kpp: demand.counterparty.kpp ?? undefined,
            phones: Array.isArray(demand.counterparty.phonesRaw)
              ? (demand.counterparty.phonesRaw as unknown[]).map((phone) => ({ phone: String(phone ?? "") }))
              : undefined,
            meta: agentMeta,
          }
        : undefined,
      store: demand.store ? { id: demand.store.id ?? demand.store.id, name: demand.store.name, meta: storeMeta } : undefined,
      organization: demand.organization?.name || demand.organizationName
        ? {
            id: demand.organization?.id ?? demand.organization?.id,
            name: demand.organization?.name ?? demand.organizationName ?? "",
            meta: organizationMeta,
          }
        : undefined,
    },
    rawPositions: positions.map((position) => ({
      id: position.id,
      quantity: position.quantity,
      price: position.price,
      discount: position.discount,
      assortment: { name: position.name, meta: position.assortmentMeta },
      product: position.product,
      lineKind: position.lineKind,
      oneOffProduct: position.oneOffProduct,
      oneOffService: position.oneOffService,
      comment: position.comment,
    })),
  };

  return { ok: true, data };
}
