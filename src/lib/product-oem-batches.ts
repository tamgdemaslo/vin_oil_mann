import { prisma } from "@/lib/db";
import { fillProductOemFromRossko } from "@/lib/product-oem-rossko";

export const PRODUCT_OEM_BATCH_ACTIVE_STATUSES = ["QUEUED", "RUNNING"] as const;
export const PRODUCT_OEM_BATCH_RETRYABLE_ITEM_STATUSES = ["NO_RESULTS", "ERROR"] as const;
const PRODUCT_OEM_BATCH_TERMINAL_ITEM_STATUSES = ["COMPLETED", "NO_RESULTS", "ERROR", "SKIPPED_ALREADY_FILLED"] as const;
const MAX_BATCH_PRODUCTS = 500;

export type ProductOemBatchStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "CANCELLED" | "FAILED";
export type ProductOemBatchItemStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "NO_RESULTS" | "ERROR" | "SKIPPED_ALREADY_FILLED";

export type ProductOemBatchView = {
  id: string;
  source: string;
  status: string;
  totalItems: number;
  processedItems: number;
  completedItems: number;
  noResultsItems: number;
  errorItems: number;
  skippedItems: number;
  currentProductId: string | null;
  currentProductName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    article: string;
    status: string;
    attempts: number;
    foundCount: number;
    errorMessage: string | null;
  }>;
};

function uniqueProductIds(values: unknown[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, MAX_BATCH_PRODUCTS + 1);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Неизвестная ошибка");
  return message.replace(/\s+/g, " ").trim().slice(0, 800) || "Не удалось получить OEM из ROSSKO";
}

function view(batch: {
  id: string;
  source: string;
  status: string;
  totalItems: number;
  processedItems: number;
  completedItems: number;
  noResultsItems: number;
  errorItems: number;
  skippedItems: number;
  currentProductId: string | null;
  currentProductName: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  items: Array<{
    id: string;
    productId: string;
    status: string;
    attempts: number;
    foundCount: number;
    errorMessage: string | null;
    product: { name: string; article: string | null };
  }>;
}): ProductOemBatchView {
  return {
    id: batch.id,
    source: batch.source,
    status: batch.status,
    totalItems: batch.totalItems,
    processedItems: batch.processedItems,
    completedItems: batch.completedItems,
    noResultsItems: batch.noResultsItems,
    errorItems: batch.errorItems,
    skippedItems: batch.skippedItems,
    currentProductId: batch.currentProductId,
    currentProductName: batch.currentProductName,
    createdAt: batch.createdAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null,
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    items: batch.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      article: item.product.article ?? "",
      status: item.status,
      attempts: item.attempts,
      foundCount: item.foundCount,
      errorMessage: item.errorMessage,
    })),
  };
}

const batchInclude = {
  items: {
    include: { product: { select: { name: true, article: true } } },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
};

export async function createProductOemBatch(input: {
  branchId: string;
  createdById?: string | null;
  productIds: unknown[];
  source?: string;
}) {
  const productIds = uniqueProductIds(input.productIds);
  if (!productIds.length) throw new Error("Выберите хотя бы один товар");
  if (productIds.length > MAX_BATCH_PRODUCTS) throw new Error(`За один запуск можно обработать не более ${MAX_BATCH_PRODUCTS} товаров`);

  const products = await prisma.localProduct.findMany({
    where: { branchId: input.branchId, id: { in: productIds }, archived: false, entityType: "product" },
    select: { id: true },
  });
  const found = new Set(products.map((product) => product.id));
  const missing = productIds.filter((id) => !found.has(id));
  if (missing.length) throw new Error("Часть выбранных товаров не найдена в текущем филиале");

  const source = String(input.source ?? "CATALOG").trim().toUpperCase().slice(0, 40) || "CATALOG";
  const batch = await prisma.productOemBatch.create({
    data: {
      branchId: input.branchId,
      createdById: input.createdById || null,
      source,
      totalItems: productIds.length,
      items: {
        create: productIds.map((productId) => ({ branchId: input.branchId, productId })),
      },
    },
    include: batchInclude,
  });
  return view(batch);
}

export async function getProductOemBatch(branchId: string, batchId: string) {
  const batch = await prisma.productOemBatch.findFirst({
    where: { branchId, id: batchId },
    include: batchInclude,
  });
  return batch ? view(batch) : null;
}

export async function listProductOemBatches(branchId: string, options: { activeOnly?: boolean; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 30));
  const batches = await prisma.productOemBatch.findMany({
    where: {
      branchId,
      ...(options.activeOnly ? { status: { in: [...PRODUCT_OEM_BATCH_ACTIVE_STATUSES] } } : {}),
    },
    include: batchInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return batches.map(view);
}

export async function retryProductOemBatch(input: { branchId: string; batchId: string; createdById?: string | null }) {
  const retryable = await prisma.productOemBatchItem.findMany({
    where: {
      branchId: input.branchId,
      batchId: input.batchId,
      status: { in: [...PRODUCT_OEM_BATCH_RETRYABLE_ITEM_STATUSES] },
    },
    select: { productId: true },
  });
  if (!retryable.length) throw new Error("В этом запуске нет позиций для повторной попытки");
  return createProductOemBatch({
    branchId: input.branchId,
    createdById: input.createdById,
    productIds: retryable.map((item) => item.productId),
    source: "RETRY",
  });
}

async function refreshBatchCounters(branchId: string, batchId: string) {
  const items = await prisma.productOemBatchItem.findMany({
    where: { branchId, batchId },
    select: { status: true },
  });
  const count = (status: string) => items.filter((item) => item.status === status).length;
  const completedItems = count("COMPLETED");
  const noResultsItems = count("NO_RESULTS");
  const errorItems = count("ERROR");
  const skippedItems = count("SKIPPED_ALREADY_FILLED");
  const processedItems = items.filter((item) => PRODUCT_OEM_BATCH_TERMINAL_ITEM_STATUSES.includes(item.status as never)).length;
  const finished = processedItems === items.length;
  await prisma.productOemBatch.updateMany({
    where: { branchId, id: batchId },
    data: {
      processedItems,
      completedItems,
      noResultsItems,
      errorItems,
      skippedItems,
      status: finished ? (errorItems || noResultsItems ? "COMPLETED_WITH_ERRORS" : "COMPLETED") : "RUNNING",
      currentProductId: finished ? null : undefined,
      currentProductName: finished ? null : undefined,
      finishedAt: finished ? new Date() : null,
    },
  });
}

export async function processNextProductOemItem(branchId: string) {
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  await prisma.productOemBatchItem.updateMany({
    where: { branchId, status: "PROCESSING", startedAt: { lt: staleBefore } },
    data: { status: "PENDING", startedAt: null, errorMessage: "Предыдущая попытка была прервана и перезапущена" },
  });

  for (let claimAttempt = 0; claimAttempt < 5; claimAttempt += 1) {
    const candidate = await prisma.productOemBatchItem.findFirst({
      where: { branchId, status: "PENDING", batch: { status: { in: [...PRODUCT_OEM_BATCH_ACTIVE_STATUSES] } } },
      include: { product: { select: { name: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) return null;

    const claimed = await prisma.productOemBatchItem.updateMany({
      where: { branchId, id: candidate.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: new Date(), errorMessage: null },
    });
    if (!claimed.count) continue;

    await prisma.productOemBatch.updateMany({
      where: { branchId, id: candidate.batchId, status: { in: [...PRODUCT_OEM_BATCH_ACTIVE_STATUSES] } },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        finishedAt: null,
        currentProductId: candidate.productId,
        currentProductName: candidate.product.name,
      },
    });

    try {
      const result = await fillProductOemFromRossko({ branchId, productId: candidate.productId });
      await prisma.productOemBatchItem.updateMany({
        where: { branchId, id: candidate.id, status: "PROCESSING" },
        data: {
          status: result.status,
          foundCount: result.foundCount,
          errorMessage: result.status === "NO_RESULTS" ? "ROSSKO не вернул OEM для этого товара" : null,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      await prisma.productOemBatchItem.updateMany({
        where: { branchId, id: candidate.id, status: "PROCESSING" },
        data: { status: "ERROR", errorMessage: safeError(error), finishedAt: new Date() },
      });
    }

    await refreshBatchCounters(branchId, candidate.batchId);
    return candidate.id;
  }
  return null;
}

export async function processProductOemJobsForBranch(branchId: string, limit = 1) {
  const processed: string[] = [];
  for (let index = 0; index < Math.max(1, Math.min(limit, 10)); index += 1) {
    const itemId = await processNextProductOemItem(branchId);
    if (!itemId) break;
    processed.push(itemId);
  }
  return processed;
}
