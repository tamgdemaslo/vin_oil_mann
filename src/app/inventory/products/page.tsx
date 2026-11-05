import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import ProductsClient from "./ProductsClient";
import ProductKitsWorkspace from "@/components/products/ProductKitsWorkspace";

export default async function InventoryProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if ((await searchParams).tab === "kits") return <ProductKitsWorkspace />;
  const session = await getSession();
  return (
    <Suspense fallback={null}>
      <ProductsClient canSetAverageCost={session?.user.role === "owner"} />
    </Suspense>
  );
}
