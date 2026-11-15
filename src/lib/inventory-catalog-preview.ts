import { prisma } from "@/lib/db";
import type { BranchContext } from "@/lib/branch-context";

export type InventoryCatalogPreview = {
  scope: string;
  total: number;
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
  value: Promise<Omit<InventoryCatalogPreview, "scope">>;
}>();

export function inventoryPreviewScope(context: BranchContext | null) {
  return context?.branchId ? JSON.stringify([context.businessGroupId, context.userId, context.branchId]) : null;
}

export function loadInventoryCatalogPreview(branchId: string) {
  const now = Date.now();
  const current = previews.get(branchId);
  if (current && now < current.expiresAt) return current.value;

  // Only the default order and first page are needed to open the table.
  // Read light product fields independently of warehouse data and relations.
  const value = prisma.localProduct.findMany({
    where: { branchId, archived: false },
    select: { id: true, name: true, groupPath: true, brand: true, salePriceCents: true },
  }).then((products) => {
    products.sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
    return { total: products.length, products: products.slice(0, 50) };
  });
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
