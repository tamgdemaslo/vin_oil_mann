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

const inventoryCardSelect = {
  id: true, name: true, groupPath: true, brand: true, salePriceCents: true,
  entityType: true, sae: true, apiSpec: true, acea: true, aceaExtra: true, ilsac: true,
  oem: true, atf: true, oemAtf: true, packageVolume: true, legacySupplierName: true,
  supplierCounterparty: { select: { name: true, displayName: true } },
} satisfies Prisma.LocalProductSelect;

const inventorySearchSelect = {
  ...inventoryCardSelect,
  article: true, code: true, externalCode: true, barcodeEan13: true, barcodeEan8: true,
  barcodeCode128: true, oemParts: true, rosskoPartNumber: true, rosskoBrand: true,
  description: true, searchText: true, tnvedCode: true, rosskoMin: true, supplierAttribute: true,
  cell: true, mannCharacteristicName: true, currencyName: true, uomName: true, attributes: true,
} satisfies Prisma.LocalProductSelect;

type InventoryCard = Prisma.LocalProductGetPayload<{ select: typeof inventoryCardSelect }>;
export type InventorySearchCard = Prisma.LocalProductGetPayload<{ select: typeof inventorySearchSelect }> & { supplierName: string };

function inventoryCardReader<Card extends InventoryCard>(query: (branchId: string) => Promise<Card[]>) {
  type Cards = Array<Card & { supplierName: string }>;
  const pendingReads = new Map<string, Promise<Cards>>();
  const previews = new Map<string, { expiresAt: number; value: Promise<Cards> }>();

  function read(branchId: string) {
    const pending = pendingReads.get(branchId);
    if (pending) return pending;
    const value = query(branchId).then((products) => products.map((product) => ({
      ...product,
      supplierName: product.supplierCounterparty?.displayName ?? product.supplierCounterparty?.name ?? product.legacySupplierName ?? "",
    })).sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)))
      .finally(() => pendingReads.delete(branchId));
    pendingReads.set(branchId, value);
    return value;
  }

  function cached(branchId: string) {
    const now = Date.now();
    const current = previews.get(branchId);
    if (current && now < current.expiresAt) return current.value;

    const value = read(branchId);
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
  return { read, cached };
}

// Browsing and filtering the catalog does not need cross-references or search text.
export const inventoryCatalogCards = inventoryCardReader((branchId) => prisma.localProduct.findMany({
  where: { branchId, archived: false },
  select: inventoryCardSelect,
}));

export const inventorySearchCards = inventoryCardReader((branchId) => prisma.localProduct.findMany({
  where: { branchId, archived: false },
  select: inventorySearchSelect,
}));

export function inventoryPreviewScope(context: BranchContext | null) {
  return context?.branchId ? JSON.stringify([context.businessGroupId, context.userId, context.branchId]) : null;
}
