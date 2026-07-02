import { Suspense } from "react";
import ProductsClient from "./ProductsClient";

export default function InventoryProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsClient />
    </Suspense>
  );
}
