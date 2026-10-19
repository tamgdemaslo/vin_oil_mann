import { Suspense } from "react";
import ProductsClient from "./ProductsClient";
import ProductKitsWorkspace from "@/components/products/ProductKitsWorkspace";

export default async function InventoryProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if ((await searchParams).tab === "kits") return <ProductKitsWorkspace />;
  return (
    <Suspense fallback={null}>
      <ProductsClient />
    </Suspense>
  );
}
