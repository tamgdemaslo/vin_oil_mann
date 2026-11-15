import { prisma } from "@/lib/db";
import type { BranchContext } from "@/lib/branch-context";
import type { CatalogSearchResult } from "@/lib/catalog-search";
import type { Prisma } from "@prisma/client";

export type InventoryCatalogPreview = {
  scope: string;
  total: number;
  facets: Omit<CatalogSearchResult["meta"]["facets"], "stock">;
  products: Array<{
    id: string;
    name: string;
    groupPath: string | null;
    brand: string | null;
    salePriceCents: number;
  }>;
};

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const previews = new Map<string, {
  expiresAt: number;
  value: Promise<InventoryCatalogCard[]>;
}>();

const inventoryCardSelect = {
  id: true, name: true, groupPath: true, brand: true, salePriceCents: true,
  entityType: true, sae: true, apiSpec: true, acea: true, aceaExtra: true, ilsac: true,
  oem: true, atf: true, oemAtf: true, packageVolume: true, legacySupplierName: true,
  supplierCounterparty: { select: { name: true, displayName: true } },
} satisfies Prisma.LocalProductSelect;

type InventoryCatalogCard = Prisma.LocalProductGetPayload<{ select: typeof inventoryCardSelect }> & { supplierName: string };

export async function readInventoryCatalogCards(branchId: string): Promise<InventoryCatalogCard[]> {
  const products = await prisma.localProduct.findMany({
    where: { branchId, archived: false },
    select: inventoryCardSelect,
  });
  return products.map((product) => ({
    ...product,
    supplierName: product.supplierCounterparty?.displayName ?? product.supplierCounterparty?.name ?? product.legacySupplierName ?? "",
  })).sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

export function inventoryPreviewScope(context: BranchContext | null) {
  return context?.branchId ? JSON.stringify([context.businessGroupId, context.userId, context.branchId]) : null;
}

export function loadInventoryCatalogCards(branchId: string) {
  const now = Date.now();
  const current = previews.get(branchId);
  if (current && now < current.expiresAt) return current.value;

  // Read product fields independently of warehouse balances and card details.
  const value = readInventoryCatalogCards(branchId);
  previews.delete(branchId);
  if (previews.size >= 4) {
    const oldestBranch = previews.keys().next().value;
    if (oldestBranch) previews.delete(oldestBranch);
  }
  const entry = { expiresAt: now + 20_000, value };
  previews.set(branchId, entry);
  void value.catch(() => {
    if (previews.get(branchId) === entry) previews.delete(branchId);
  });
  return value;
}
