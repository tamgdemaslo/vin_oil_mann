import { resolveCatalogProductSelection } from "@/lib/catalog-search";
import { prisma } from "@/lib/db";
import { invalidateWarehouseReadCaches } from "@/lib/local-inventory-admin";

const MAX_BULK_PRODUCTS = 500;

function uniqueProductIds(values: unknown[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

async function resolveBulkProductIds(input: {
  branchId: string;
  productIds?: unknown[];
  selection?: unknown;
}) {
  let productIds: string[];
  if (Array.isArray(input.productIds) && input.productIds.length) {
    productIds = uniqueProductIds(input.productIds);
    if (productIds.length > MAX_BULK_PRODUCTS) {
      throw new Error(`За один раз можно обработать не более ${MAX_BULK_PRODUCTS} товаров`);
    }
  } else if (input.selection) {
    productIds = (await resolveCatalogProductSelection(input.selection, MAX_BULK_PRODUCTS)).productIds;
  } else {
    throw new Error("Выберите хотя бы один товар");
  }

  if (!productIds.length) throw new Error("В выбранной группе больше нет доступных товаров");
  const products = await prisma.localProduct.findMany({
    where: { branchId: input.branchId, id: { in: productIds } },
    select: { id: true, archived: true },
  });
  if (products.length !== productIds.length) {
    throw new Error("Часть выбранных товаров не найдена в текущем филиале");
  }
  return products;
}

export async function setProductsArchivedFromSelection(input: {
  branchId: string;
  productIds?: unknown[];
  selection?: unknown;
  archived: boolean;
}) {
  const products = await resolveBulkProductIds(input);
  const changedProductIds = products
    .filter((product) => product.archived !== input.archived)
    .map((product) => product.id);

  if (changedProductIds.length) {
    await prisma.localProduct.updateMany({
      where: { branchId: input.branchId, id: { in: changedProductIds } },
      data: { archived: input.archived, syncedAt: new Date() },
    });
    invalidateWarehouseReadCaches();
  }

  return {
    productIds: changedProductIds,
    updatedCount: changedProductIds.length,
    unchangedCount: products.length - changedProductIds.length,
  };
}
