import { searchCatalog } from "@/lib/catalog-search";
import { normalizeACEA, normalizeOEM } from "@/lib/oil-normalizer";
import { quantityForLiters } from "./material-selection";

export async function searchQuickCatalog(input: {
  query: string;
  approval: string;
  viscosity: string;
  liters: number | null;
  article?: string;
  packageVolume?: string;
  maxRubles?: number | null;
  warehouse?: string;
}) {
  const acea = normalizeACEA(input.approval);
  const approval = input.approval.replace(/\bBMW\s+LL[\s-]*(?=\d)/giu, "BMW Longlife-");
  const engineOem = normalizeOEM(approval);
  const result = await searchCatalog({
    q: [input.article || input.query, acea.length || engineOem.length ? "" : approval].filter(Boolean).join(" "),
    type: "product",
    acea,
    engineOem,
    sae: input.viscosity || undefined,
    inStock: true,
    packageVolume: input.packageVolume || undefined,
    storeName: input.warehouse || undefined,
    internalLimit: 501,
  });
  const article = input.article?.trim().toLocaleLowerCase();
  const warehouse = input.warehouse?.trim().toLocaleLowerCase();
  const products = result.items.filter(product => !article || product.article?.trim().toLocaleLowerCase() === article).map(product => {
    const needed = input.liters == null ? null : quantityForLiters(product, input.liters);
    const quantity = needed?.quantity ?? null;
    const stock = warehouse ? product.stock.filter(row =>
      row.storeName.toLocaleLowerCase() === warehouse) : product.stock;
    const canSupply = quantity != null && stock.some(row => row.available >= quantity);
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
      warehouses: stock.filter(row => row.available > 0).sort((a, b) => b.available - a.available).slice(0, 5).map(row => ({
        name: row.storeName,
        available: row.available,
        enough: needed?.quantity == null ? null : row.available >= needed.quantity,
      })),
    };
  });
  const eligible = products.filter(product => input.maxRubles == null || (
    (input.liters == null ? product.pricePerUnit : product.subtotalRubles) != null
    && product.pricePerUnit > 0
    && (input.liters == null ? product.pricePerUnit : product.subtotalRubles!) <= input.maxRubles
  ));
  eligible.sort((a, b) => Number(b.warehouses.some(row => row.enough)) - Number(a.warehouses.some(row => row.enough)));
  return { total: eligible.length, complete: result.total <= result.items.length, products: eligible.slice(0, 8) };
}

export async function findQuickCatalogProducts(queries: string[]) {
  const results = await Promise.all(queries.map(q => searchCatalog({ q, type: "product", limit: 8 })));
  return [...new Map(results.flatMap(result => result.items.map(product => [product.id, {
    id: product.id,
    name: product.name,
    article: product.article,
    viscosity: product.sae,
  }] as const))).values()].slice(0, 16);
}
