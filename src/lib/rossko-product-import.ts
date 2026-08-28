import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { User } from "@/lib/auth";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { createLocalAdminProduct, supplierCounterpartyIdentityWhere } from "@/lib/local-inventory-admin";
import { normalizePartNumberForCrossMatch } from "@/lib/part-number-cross-reference";
import { rosskoConfig, rosskoOrders } from "@/lib/rossko";

const MAX_IMPORT_ROWS = 240;
const ROSSKO_IMPORT_CONCURRENCY = 1;

export type RosskoImportStatus = "EXISTS" | "NEW" | "REVIEW" | "POSSIBLE_DUPLICATE" | "ERROR";
export type RosskoFilterType = "oil" | "air" | "cabin" | "fuel" | "other";

export type RosskoOrderLine = {
  rowId: string;
  orderId: string;
  brand: string;
  article: string;
  sourceName: string;
  categoryText: string;
  quantity: number;
  purchasePriceCents: number | null;
  delivery: string;
  stock: string;
};

export type RosskoImportPreviewRow = RosskoOrderLine & {
  status: RosskoImportStatus;
  statusReason: string;
  selected: boolean;
  name: string;
  category: string;
  filterType: RosskoFilterType;
  supplierCounterpartyId: string;
  supplierName: string;
  supplierInn: string;
  recommendedRetailCents: number | null;
  retailPriceCents: number | null;
  existingProductId: string | null;
  existingProductName: string | null;
  warnings: string[];
};

export type RosskoImportPreview = {
  order: {
    id: string;
    positions: number;
    totalCents: number;
  };
  categories: string[];
  rows: RosskoImportPreviewRow[];
  summary: RosskoImportSummary;
};

export type RosskoImportSummary = {
  total: number;
  exists: number;
  new: number;
  review: number;
  possibleDuplicate: number;
  error: number;
  selected: number;
};

export type RosskoImportExecuteRow = {
  rowId?: string;
  selected?: boolean;
  brand?: string;
  article?: string;
  name?: string;
  category?: string;
  supplierCounterpartyId?: string;
  retailPriceCents?: number;
};

export type RosskoImportCreatedProduct = {
  id: string;
  name: string;
  article: string;
  brand: string;
  groupPath: string;
  salePrice: number;
  buyPrice: number | null;
  supplierName: string;
  oemParts: string;
  totalQuantity: number;
  totalAvailable: number;
  stock: unknown[];
  origin: string;
};

export type RosskoImportExecuteResult = {
  orderId: string;
  selected: number;
  created: number;
  skipped: number;
  failed: number;
  createdProducts: RosskoImportCreatedProduct[];
  rows: Array<{
    rowId: string;
    status: "CREATED" | "SKIPPED_DUPLICATE" | "FAILED";
    productId: string | null;
    message: string;
  }>;
};

export class RosskoProductImportError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "rossko_product_import_invalid",
  ) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function readText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const exact = text(row[key]);
    if (exact) return exact;
    const entry = Object.entries(row).find(([candidate]) => candidate.toLocaleLowerCase("ru-RU") === key.toLocaleLowerCase("ru-RU"));
    const value = entry ? text(entry[1]) : "";
    if (value) return value;
  }
  return "";
}

function numberValue(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const exact = numberValue(row[key]);
    if (exact != null) return exact;
    const entry = Object.entries(row).find(([candidate]) => candidate.toLocaleLowerCase("ru-RU") === key.toLocaleLowerCase("ru-RU"));
    const value = entry ? numberValue(entry[1]) : null;
    if (value != null) return value;
  }
  return null;
}

function collectRecords(root: unknown, limit = 1600): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  while (queue.length && rows.length < limit) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const item = record(current);
    if (!item) continue;
    rows.push(item);
    for (const value of Object.values(item)) if (value && typeof value === "object") queue.push(value);
  }
  return rows;
}

export function normalizeRosskoBrand(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[ёЁ]/g, "Е")
    .toLocaleUpperCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizeRosskoArticle(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[–—−]/g, "-")
    .toLocaleUpperCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Product identity keeps meaningful `/`; provider lookup normalization stays compact. */
export function normalizeRosskoProductIdentityArticle(value: unknown): string {
  return normalizePartNumberForCrossMatch(value).canonical;
}

export function recommendedRosskoRetailCents(purchasePriceCents: number | null): number | null {
  if (purchasePriceCents == null || !Number.isFinite(purchasePriceCents) || purchasePriceCents < 0) return null;
  return purchasePriceCents <= 100_000
    ? Math.round(purchasePriceCents + 40_000)
    : Math.round(purchasePriceCents * 1.5);
}

function rowId(orderId: string, brand: string, article: string, occurrence: number): string {
  return createHash("sha256")
    .update(`${orderId}\u0000${normalizeRosskoBrand(brand)}\u0000${normalizeRosskoArticle(article)}\u0000${occurrence}`)
    .digest("base64url")
    .slice(0, 22);
}

export function extractRosskoOrderLines(data: unknown, orderId: string): RosskoOrderLine[] {
  const rows = collectRecords(data);
  const occurrences = new Map<string, number>();
  const result: RosskoOrderLine[] = [];

  for (const row of rows) {
    const article = readText(row, ["partnumber", "partNumber", "article", "supplierArticle", "code"]);
    const brand = readText(row, ["brand", "brandName", "producer", "manufacturer"]);
    const quantity = readNumber(row, ["count", "quantity", "qty", "orderedQty", "amount"]);
    if (!article || !brand || quantity == null || quantity <= 0) continue;

    const purchaseRub = readNumber(row, ["price", "cost", "buyPrice", "purchasePrice", "unitPrice"]);
    const sourceName = readText(row, ["name", "partName", "title", "caption", "description"]) || `${brand} ${article}`;
    const categoryText = readText(row, ["category", "categoryName", "parttype", "partType", "group", "groupName"]);
    const identity = `${normalizeRosskoBrand(brand)}:${normalizeRosskoProductIdentityArticle(article)}`;
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    result.push({
      rowId: rowId(orderId, brand, article, occurrence),
      orderId,
      brand: brand.trim(),
      article: article.trim().replace(/[–—−]/g, "-"),
      sourceName,
      categoryText,
      quantity: Math.max(1, Math.floor(quantity)),
      purchasePriceCents: purchaseRub == null || purchaseRub < 0 ? null : Math.round(purchaseRub * 100),
      delivery: readText(row, ["delivery", "deliveryLabel", "deliveryDate", "dateDelivery"]),
      stock: readText(row, ["stock", "stockId", "warehouse"]),
    });
    if (result.length >= MAX_IMPORT_ROWS) break;
  }

  const exactSeen = new Set<string>();
  return result.filter((line) => {
    const key = [normalizeRosskoBrand(line.brand), normalizeRosskoProductIdentityArticle(line.article), line.quantity, line.purchasePriceCents ?? ""].join(":");
    if (exactSeen.has(key)) return false;
    exactSeen.add(key);
    return true;
  }).map((line, index, all) => {
    const occurrence = all.slice(0, index + 1).filter((candidate) =>
      normalizeRosskoBrand(candidate.brand) === normalizeRosskoBrand(line.brand) &&
      normalizeRosskoProductIdentityArticle(candidate.article) === normalizeRosskoProductIdentityArticle(line.article)
    ).length;
    return { ...line, rowId: rowId(orderId, line.brand, line.article, occurrence) };
  });
}

export function inferRosskoFilterType(value: unknown): { type: RosskoFilterType; confidence: "high" | "low" } {
  const source = String(value ?? "").normalize("NFKC").replace(/[ёЁ]/g, "е").toLocaleLowerCase("ru-RU");
  if (/(салон|cabin|pollen|interior)/i.test(source)) return { type: "cabin", confidence: "high" };
  if (/(топлив|fuel|diesel)/i.test(source)) return { type: "fuel", confidence: "high" };
  if (/(воздуш|air\s*filter|filter\s*air)/i.test(source)) return { type: "air", confidence: "high" };
  if (/(маслян|масляный|моторн.{0,12}фильтр|oil\s*filter|filter\s*oil)/i.test(source)) return { type: "oil", confidence: "high" };
  return { type: "other", confidence: "low" };
}

const FILTER_TYPE_LABELS: Record<Exclude<RosskoFilterType, "other">, string> = {
  oil: "Масляный фильтр",
  air: "Воздушный фильтр",
  cabin: "Салонный фильтр",
  fuel: "Топливный фильтр",
};

function summary(rows: RosskoImportPreviewRow[]): RosskoImportSummary {
  return {
    total: rows.length,
    exists: rows.filter((row) => row.status === "EXISTS").length,
    new: rows.filter((row) => row.status === "NEW").length,
    review: rows.filter((row) => row.status === "REVIEW").length,
    possibleDuplicate: rows.filter((row) => row.status === "POSSIBLE_DUPLICATE").length,
    error: rows.filter((row) => row.status === "ERROR").length,
    selected: rows.filter((row) => row.selected).length,
  };
}

type CatalogIdentityRow = {
  id: string;
  name: string;
  brand: string | null;
  article: string | null;
  groupPath: string | null;
};

function mostFrequentDisplays(rows: CatalogIdentityRow[], keyOf: (row: CatalogIdentityRow) => string, valueOf: (row: CatalogIdentityRow) => string) {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = keyOf(row);
    const value = valueOf(row).trim();
    if (!key || !value) continue;
    const byValue = counts.get(key) ?? new Map<string, number>();
    byValue.set(value, (byValue.get(value) ?? 0) + 1);
    counts.set(key, byValue);
  }
  return new Map([...counts].map(([key, values]) => [
    key,
    [...values].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"))[0]?.[0] ?? "",
  ]));
}

function categoryByType(products: CatalogIdentityRow[]) {
  const counts = new Map<RosskoFilterType, Map<string, number>>();
  for (const product of products) {
    const group = product.groupPath?.trim() ?? "";
    if (!group) continue;
    const inferred = inferRosskoFilterType(`${group} ${product.name}`);
    if (inferred.type === "other") continue;
    const byGroup = counts.get(inferred.type) ?? new Map<string, number>();
    byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
    counts.set(inferred.type, byGroup);
  }
  return new Map([...counts].map(([type, groups]) => [
    type,
    [...groups].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"))[0]?.[0] ?? "",
  ]));
}

export function fallbackRosskoProductGroup(value: unknown): string {
  return inferRosskoFilterType(value).type === "other" ? "Прочее" : "Фильтры";
}

async function resolveRosskoProductGroup(
  tx: Prisma.TransactionClient,
  branchId: string,
  requestedCategory: string,
  productName: string,
) {
  if (requestedCategory) return requestedCategory;
  const products = await tx.localProduct.findMany({
    where: { branchId, archived: false, entityType: "product", groupPath: { not: null } },
    select: { id: true, name: true, brand: true, article: true, groupPath: true },
    take: 20_000,
  });
  const inferred = inferRosskoFilterType(productName);
  const inferredGroup = categoryByType(products).get(inferred.type)?.trim();
  if (inferredGroup) return inferredGroup;
  const existingGroups = [...new Set(products.map((product) => product.groupPath?.trim()).filter((group): group is string => Boolean(group)))];
  const genericGroup = existingGroups.find((group) => /(?:^|[\s>/])(?:проч(?:ее|ие)?|запчаст|детал|товар)(?:$|[\s>/])/i.test(group));
  return genericGroup ?? fallbackRosskoProductGroup(productName);
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await operation(values[index], index);
    }
  }));
  return result;
}

export async function previewRosskoProductImport(input: { branchId: string; orderId: string }): Promise<RosskoImportPreview> {
  const orderId = input.orderId.trim();
  if (!/^\d+$/.test(orderId)) throw new RosskoProductImportError("Укажите номер заказа ROSSKO");

  const [cfg, products] = await Promise.all([
    rosskoConfig(),
    prisma.localProduct.findMany({
      where: { branchId: input.branchId, archived: false, entityType: "product", article: { not: null } },
      select: { id: true, name: true, brand: true, article: true, groupPath: true },
      take: 20_000,
    }),
  ]);
  const orderData = await rosskoOrders(cfg, [Number(orderId)]);
  const lines = extractRosskoOrderLines(orderData, orderId);
  if (!lines.length) throw new RosskoProductImportError("В ответе ROSSKO не удалось найти позиции выбранного заказа", 422, "rossko_order_positions_missing");

  const brandDisplays = mostFrequentDisplays(products, (row) => normalizeRosskoBrand(row.brand), (row) => row.brand ?? "");
  const groupByType = categoryByType(products);
  const categories = [...new Set(products.map((row) => row.groupPath?.trim()).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right, "ru", { numeric: true, sensitivity: "base" }));
  const exact = new Map<string, CatalogIdentityRow>();
  const byArticle = new Map<string, CatalogIdentityRow[]>();
  for (const product of products) {
    const articleKey = normalizeRosskoProductIdentityArticle(product.article);
    const brandKey = normalizeRosskoBrand(product.brand);
    if (!articleKey) continue;
    if (brandKey && !exact.has(`${brandKey}:${articleKey}`)) exact.set(`${brandKey}:${articleKey}`, product);
    byArticle.set(articleKey, [...(byArticle.get(articleKey) ?? []), product]);
  }

  const rows = lines.map<RosskoImportPreviewRow>((source) => {
    const article = source.article;
    const brandKey = normalizeRosskoBrand(source.brand);
    const articleKey = normalizeRosskoProductIdentityArticle(article);
    const brand = brandDisplays.get(brandKey) || source.brand.trim();
    const duplicate = exact.get(`${brandKey}:${articleKey}`) ?? null;
    const possible = !duplicate ? (byArticle.get(articleKey) ?? [])[0] ?? null : null;
    const inferred = inferRosskoFilterType(`${source.categoryText} ${source.sourceName}`);
    const category = inferred.type === "other" ? "" : groupByType.get(inferred.type) ?? "";
    const name = inferred.type === "other"
      ? `${brand} ${article}`.trim()
      : `${FILTER_TYPE_LABELS[inferred.type]} ${brand} ${article}`.replace(/\s+/g, " ").trim();
    const recommendedRetailCents = recommendedRosskoRetailCents(source.purchasePriceCents);
    const missing: string[] = [];
    if (!brandKey) missing.push("бренд");
    if (!articleKey) missing.push("артикул");
    if (!source.sourceName.trim()) missing.push("название");
    if (source.purchasePriceCents == null) missing.push("закупочная цена");

    let status: RosskoImportStatus = "NEW";
    let statusReason = "Данные готовы к созданию";
    if (missing.length) {
      status = "ERROR";
      statusReason = `Недостаточно данных: ${missing.join(", ")}`;
    } else if (duplicate) {
      status = "EXISTS";
      statusReason = "Бренд и нормализованный артикул уже есть в текущем филиале";
    } else if (possible) {
      status = "POSSIBLE_DUPLICATE";
      statusReason = `Похожий артикул найден у карточки «${possible.name}»`;
    } else if (!category || inferred.confidence === "low") {
      status = "REVIEW";
      statusReason = "Не удалось уверенно определить категорию фильтра";
    }

    return {
      ...source,
      brand,
      article,
      status,
      statusReason,
      selected: status === "NEW",
      name,
      category,
      filterType: inferred.type,
      supplierCounterpartyId: "",
      supplierName: "",
      supplierInn: "",
      recommendedRetailCents,
      retailPriceCents: recommendedRetailCents,
      existingProductId: duplicate?.id ?? possible?.id ?? null,
      existingProductName: duplicate?.name ?? possible?.name ?? null,
      warnings: [],
    };
  });

  return {
    order: {
      id: orderId,
      positions: rows.length,
      totalCents: rows.reduce((total, row) => total + (row.purchasePriceCents ?? 0) * row.quantity, 0),
    },
    categories,
    rows,
    summary: summary(rows),
  };
}

function cleanEditedText(value: unknown, max: number): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max);
}

type DuplicateProductRow = { id: string; name: string };

async function duplicateByBrandArticle(
  client: Prisma.TransactionClient,
  branchId: string,
  brand: string,
  article: string,
) {
  const brandKey = normalizeRosskoBrand(brand).toLocaleLowerCase("ru-RU");
  const articleKey = normalizeRosskoProductIdentityArticle(article).toLocaleLowerCase("ru-RU");
  if (!brandKey || !articleKey) return null;
  const rows = await client.$queryRaw<DuplicateProductRow[]>(Prisma.sql`
    SELECT id, name
    FROM local_products
    WHERE branch_id = ${branchId}
      AND archived = false
      AND regexp_replace(replace(lower(COALESCE(brand, '')), 'ё', 'е'), '[^0-9a-zа-я]', '', 'g') = ${brandKey}
      AND regexp_replace(
        regexp_replace(replace(replace(replace(replace(lower(COALESCE(article, '')), 'ё', 'е'), '–', '-'), '—', '-'), '−', '-'), '[.[:space:]-]+', '', 'g'),
        '[^0-9a-zа-я/]',
        '',
        'g'
      ) = ${articleKey}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function lockRosskoProductIdentity(
  tx: Prisma.TransactionClient,
  branchId: string,
  brand: string,
  article: string,
) {
  const lockKey = `rossko-product:${branchId}:${normalizeRosskoBrand(brand)}:${normalizeRosskoProductIdentityArticle(article)}`;
  await tx.$queryRaw<Array<{ locked: string }>>(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
  `);
}

function asCreatedProduct(value: unknown): RosskoImportCreatedProduct {
  const product = value as RosskoImportCreatedProduct;
  return { ...product, origin: "IMPORT" };
}

export type ResolveOrCreateRosskoLocalProductInput = {
  context: BranchContext;
  actor: User;
  orderId: string;
  sourceLineKey: string;
  partGuid?: string | null;
  brand: string;
  article: string;
  name: string;
  category?: string | null;
  purchasePriceCents: number;
  retailPriceCents?: number | null;
  supplierCounterpartyId?: string | null;
  transaction?: Prisma.TransactionClient;
};

export async function resolveOrCreateRosskoLocalProduct(input: ResolveOrCreateRosskoLocalProductInput) {
  const branchId = input.context.branchId;
  if (!branchId) throw new RosskoProductImportError("Выберите филиал, в каталог которого нужно импортировать товары.", 409, "concrete_branch_required");
  const brand = cleanEditedText(input.brand, 100);
  const article = cleanEditedText(input.article, 120).replace(/[–—−]/g, "-");
  const name = cleanEditedText(input.name, 240) || `${brand} ${article}`.trim();
  const requestedCategory = cleanEditedText(input.category, 300);
  const purchasePriceCents = Math.max(0, Math.round(Number(input.purchasePriceCents) || 0));
  const retailPriceCents = Number.isInteger(input.retailPriceCents)
    ? Math.max(0, Number(input.retailPriceCents))
    : recommendedRosskoRetailCents(purchasePriceCents) ?? purchasePriceCents;
  if (!normalizeRosskoBrand(brand) || !normalizeRosskoArticle(article) || !name) {
    throw new RosskoProductImportError("Для создания товара ROSSKO нужны бренд, артикул и наименование", 422, "rossko_product_source_invalid");
  }

  const operation = async (tx: Prisma.TransactionClient) => {
    await lockRosskoProductIdentity(tx, branchId, brand, article);
    const duplicate = await duplicateByBrandArticle(tx, branchId, brand, article);
    if (duplicate) {
      await tx.branchAuditLog.create({
        data: {
          businessGroupId: input.context.businessGroupId,
          branchId,
          userId: input.context.userId,
          action: "ROSSKO_PRODUCT_MATCHED",
          entityType: "local_product",
          entityId: duplicate.id,
          metadata: { orderId: input.orderId, sourceLineKey: input.sourceLineKey, matchType: "normalized_brand_article" },
        },
      });
      return { created: false as const, product: { id: duplicate.id, name: duplicate.name } };
    }

    const groupPath = await resolveRosskoProductGroup(tx, branchId, requestedCategory, name);
    const payload: Parameters<typeof createLocalAdminProduct>[0] = {
      name,
      entityType: "product",
      article,
      groupPath,
      uomName: "шт",
      salePrice: retailPriceCents / 100,
      buyPrice: purchasePriceCents / 100,
      currencyName: "руб.",
      minimumBalance: 0,
      supplierCounterpartyId: input.supplierCounterpartyId || undefined,
      brand,
      rosskoPartNumber: article,
      rosskoBrand: brand,
      markingEnabled: false,
      markingMode: "NOT_MARKED",
    };
    const created = await createLocalAdminProduct(payload, input.actor, branchId, { transaction: tx });
    if (!created.ok) throw new RosskoProductImportError(created.error);
    await tx.localProduct.update({
      where: { id: created.product.id },
      data: {
        origin: "IMPORT",
        createdById: input.context.userId,
        raw: {
          source: "ROSSKO_ORDER_IMPORT",
          sourceProvider: "rossko",
          rosskoOrderId: input.orderId,
          rosskoPartGuid: input.partGuid ?? null,
          rosskoSourceLineKey: input.sourceLineKey,
          importedAt: new Date().toISOString(),
        },
      },
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: input.context.businessGroupId,
        branchId,
        userId: input.context.userId,
        action: "ROSSKO_PRODUCT_CREATED",
        entityType: "local_product",
        entityId: created.product.id,
        metadata: { orderId: input.orderId, sourceLineKey: input.sourceLineKey },
      },
    });
    return { created: true as const, product: asCreatedProduct(created.product) };
  };

  return input.transaction
    ? operation(input.transaction)
    : prisma.$transaction(operation, { maxWait: 10_000, timeout: 30_000 });
}

export async function executeRosskoProductImport(input: {
  context: BranchContext;
  actor: User;
  orderId: string;
  rows: RosskoImportExecuteRow[];
}): Promise<RosskoImportExecuteResult> {
  const branchId = input.context.branchId;
  if (!branchId) throw new RosskoProductImportError("Выберите филиал, в каталог которого нужно импортировать товары.", 409, "concrete_branch_required");
  const orderId = input.orderId.trim();
  if (!/^\d+$/.test(orderId)) throw new RosskoProductImportError("Укажите номер заказа ROSSKO");
  const selected = input.rows.filter((row) => row?.selected !== false && cleanEditedText(row?.rowId, 40)).slice(0, MAX_IMPORT_ROWS);
  if (!selected.length) throw new RosskoProductImportError("Выберите хотя бы одну готовую позицию");

  const supplierIds = [...new Set(selected.map((row) => cleanEditedText(row.supplierCounterpartyId, 80)).filter(Boolean))];
  const [cfg, suppliers, categories] = await Promise.all([
    rosskoConfig(),
    supplierIds.length
      ? prisma.localCounterparty.findMany({
          where: {
            branchId,
            id: { in: supplierIds },
            archived: false,
            AND: [supplierCounterpartyIdentityWhere()],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    prisma.localProduct.findMany({
      where: { branchId, archived: false, groupPath: { not: null } },
      distinct: ["groupPath"],
      select: { groupPath: true },
      take: 2000,
    }),
  ]);
  const orderLines = extractRosskoOrderLines(await rosskoOrders(cfg, [Number(orderId)]), orderId);
  const sourceById = new Map(orderLines.map((line) => [line.rowId, line]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const allowedCategories = new Set(categories.map((row) => row.groupPath?.trim()).filter((value): value is string => Boolean(value)));
  const results: RosskoImportExecuteResult["rows"] = [];
  const createdProducts: RosskoImportCreatedProduct[] = [];

  await mapWithConcurrency(selected, ROSSKO_IMPORT_CONCURRENCY, async (edited) => {
    const id = cleanEditedText(edited.rowId, 40);
    const source = sourceById.get(id);
    if (!source) {
      results.push({ rowId: id, status: "FAILED", productId: null, message: "Позиция больше не найдена в заказе ROSSKO" });
      return;
    }

    const brand = cleanEditedText(edited.brand || source.brand, 100);
    const article = cleanEditedText(edited.article || source.article, 120).replace(/[–—−]/g, "-");
    const name = cleanEditedText(edited.name, 240);
    const category = cleanEditedText(edited.category, 300);
    const supplierId = cleanEditedText(edited.supplierCounterpartyId, 80);
    const supplier = supplierId ? supplierById.get(supplierId) ?? null : null;
    const retailPriceCents = Number(edited.retailPriceCents);
    const validation: string[] = [];
    if (!normalizeRosskoBrand(brand)) validation.push("бренд");
    if (!normalizeRosskoArticle(article)) validation.push("артикул");
    if (!name) validation.push("наименование");
    if (!category || !allowedCategories.has(category)) validation.push("категория из каталога филиала");
    if (!Number.isInteger(retailPriceCents) || retailPriceCents < 0) validation.push("розничная цена");
    if (source.purchasePriceCents == null) validation.push("закупочная цена заказа");
    if (supplierId && !supplier) validation.push("действующий поставщик из текущего филиала");
    if (validation.length) {
      results.push({ rowId: id, status: "FAILED", productId: null, message: `Проверьте поля: ${validation.join(", ")}` });
      return;
    }

    try {
      const outcome = await resolveOrCreateRosskoLocalProduct({
        context: input.context,
        actor: input.actor,
        orderId,
        sourceLineKey: id,
        brand,
        article,
        name,
        category,
        purchasePriceCents: source.purchasePriceCents!,
        retailPriceCents,
        supplierCounterpartyId: supplier?.id,
      });

      if (!outcome.created) {
        results.push({ rowId: id, status: "SKIPPED_DUPLICATE", productId: outcome.product.id, message: `Уже существует: ${outcome.product.name}` });
      } else {
        createdProducts.push(outcome.product);
        results.push({ rowId: id, status: "CREATED", productId: outcome.product.id, message: "Товар создан, остаток 0" });
      }
    } catch (error) {
      console.error("ROSSKO product row import failed", { orderId, rowId: id, error });
      results.push({
        rowId: id,
        status: "FAILED",
        productId: null,
        message: error instanceof RosskoProductImportError ? error.message : "Не удалось создать карточку товара",
      });
    }
  });

  const created = results.filter((row) => row.status === "CREATED").length;
  const skipped = results.filter((row) => row.status === "SKIPPED_DUPLICATE").length;
  const failed = results.filter((row) => row.status === "FAILED").length;
  await prisma.branchAuditLog.create({
    data: {
      businessGroupId: input.context.businessGroupId,
      branchId,
      userId: input.context.userId,
      action: "PRODUCTS_IMPORTED_FROM_ROSSKO_ORDER",
      entityType: "product_import",
      entityId: orderId,
      metadata: {
        rosskoOrderReference: orderId,
        selectedPositionCount: selected.length,
        createdCount: created,
        skippedCount: skipped,
        failedCount: failed,
        supplierCounterpartyIds: supplierIds,
      },
    },
  });

  return { orderId, selected: selected.length, created, skipped, failed, createdProducts, rows: results };
}
