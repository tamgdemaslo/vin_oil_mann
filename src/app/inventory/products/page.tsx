import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { getBranchContext } from "@/lib/branch-context";
import { inventoryPreviewScope } from "@/lib/inventory-catalog-preview";
import ProductsClient from "./ProductsClient";
import ProductKitsWorkspace from "@/components/products/ProductKitsWorkspace";

export default async function InventoryProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if ((await searchParams).tab === "kits") return <ProductKitsWorkspace />;
  const branch = await getBranchContext({ allowAll: false, requireActive: true }).catch(() => null);
  const user = branch?.user ?? (await getSession())?.user;
  return (
    <Suspense fallback={null}>
      <ProductsClient canSetAverageCost={user?.role === "owner"} catalogScope={inventoryPreviewScope(branch)} saveBranchId={branch?.branchId} />
    </Suspense>
  );
}
