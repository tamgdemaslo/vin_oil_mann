import { searchCatalog } from "@/lib/catalog-search";
import { normalizeACEA, normalizeOEM } from "@/lib/oil-normalizer";
import { quantityForLiters } from "./material-selection";

export async function searchQuickCatalog(input: { query: string; approval: string; viscosity: string; liters: number | null }) {
  const acea = normalizeACEA(input.approval);
  const approval = input.approval.replace(/\bBMW\s+LL[\s-]*(?=\d)/giu, "BMW Longlife-");
  const engineOem = normalizeOEM(approval);
  const result = await searchCatalog({
    q: [input.query, acea.length || engineOem.length ? "" : approval].filter(Boolean).join(" "),
    type: "product",
    acea,
    engineOem,
    sae: input.viscosity || undefined,
    inStock: true,
    limit: 20,
  });
  const products = result.items.map(product => {
    const needed = input.liters == null ? null : quantityForLiters(product, input.liters);
    const quantity = needed?.quantity ?? null;
    const canSupply = quantity != null && product.stock.some(row => row.available >= quantity);
    return {
      id: product.id,
      name: product.name,
      article: product.article,
      sae: product.sae,
      acea: [product.acea, product.aceaExtra].filter(Boolean).join(", "),
      oem: product.oem,
      pack: product.packageVolume,
      unit: product.uomName,
      pricePerUnit: product.salePrice,
      neededUnits: needed?.quantity ?? null,
      purchasedLiters: needed?.purchasedVolumeLiters ?? null,
      subtotalRubles: canSupply && quantity != null && product.salePrice > 0
        ? Math.round(product.salePrice * quantity * 100) / 100 : null,
      warehouses: product.stock.filter(row => row.available > 0).map(row => ({
        name: row.storeName,
        available: row.available,
        enough: needed?.quantity == null ? null : row.available >= needed.quantity,
      })),
    };
  });
  products.sort((a, b) => Number(b.warehouses.some(row => row.enough)) - Number(a.warehouses.some(row => row.enough)));
  return { total: result.total, products };
}
