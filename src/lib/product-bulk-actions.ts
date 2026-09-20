import { resolveCatalogProductSelection } from "@/lib/catalog-search";
import { prisma } from "@/lib/db";
import {
  invalidateWarehouseReadCaches,
  updateLocalAdminProduct,
  type ActingUser,
  type ProductInput,
} from "@/lib/local-inventory-admin";

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

export async function updateProductsFromSelection(input: {
  branchId: string;
  productIds?: unknown[];
  selection?: unknown;
  changes: Pick<ProductInput, "brand" | "groupPath" | "supplierCounterpartyId">;
  actor?: ActingUser | null;
}) {
  const changeEntries = Object.entries(input.changes).filter(([, value]) => value !== undefined);
  if (!changeEntries.length) throw new Error("Выберите хотя бы одно поле для изменения");

  const unsupportedField = changeEntries.find(([field]) => !["brand", "groupPath", "supplierCounterpartyId"].includes(field));
  if (unsupportedField) throw new Error("Передано поле, недоступное для массового редактирования");
  if (input.changes.groupPath !== undefined && !input.changes.groupPath.trim()) {
    throw new Error("Выберите группу товара");
  }

  const products = await resolveBulkProductIds(input);
  const normalizedChanges: Pick<ProductInput, "brand" | "groupPath" | "supplierCounterpartyId"> = {};
  if (input.changes.brand !== undefined) normalizedChanges.brand = input.changes.brand.trim();
  if (input.changes.groupPath !== undefined) normalizedChanges.groupPath = input.changes.groupPath.trim();
  if (input.changes.supplierCounterpartyId !== undefined) {
    normalizedChanges.supplierCounterpartyId = input.changes.supplierCounterpartyId?.trim() || null;
  }

  await prisma.$transaction(async (transaction) => {
    for (const product of products) {
      const result = await updateLocalAdminProduct(product.id, normalizedChanges, input.actor, input.branchId, { transaction });
      if (!result.ok) throw new Error(result.error);
    }
  }, { timeout: 30_000 });

  invalidateWarehouseReadCaches();
  return { productIds: products.map((product) => product.id), updatedCount: products.length };
}
