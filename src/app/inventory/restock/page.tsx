import RestockClient from "@/app/operations/restock/RestockClient";
import ProductKitsWorkspace from "@/components/products/ProductKitsWorkspace";

export default async function InventoryRestockPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if ((await searchParams).tab === "kits") return <ProductKitsWorkspace mode="restock" />;
  return <RestockClient />;
}
