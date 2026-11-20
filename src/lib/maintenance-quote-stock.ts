import { engineOilSpecificationMatches } from "@/lib/ai-assistant/material-selection";
import { prisma } from "@/lib/db";
import { matchesQuoteOil, quoteLitresPerUnit, type QuoteStockProduct } from "@/lib/maintenance-quote";

export async function loadMaintenanceQuoteStock({ branchId, storeId, specification, viscosity, search = "", extras = false }: {
  branchId: string; storeId: string; specification: string; viscosity: string; search?: string; extras?: boolean;
}): Promise<QuoteStockProduct[]> {
  const rows = await prisma.localProduct.findMany({
    where: { branchId, archived: false, ...(extras ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { article: { contains: search, mode: "insensitive" } }] } : { stockBalances: { some: { branchId, storeId, available: { gt: 0 } } } }) },
    select: { id: true, name: true, article: true, brand: true, entityType: true, groupPath: true, sae: true, oem: true, acea: true, apiSpec: true, ilsac: true, uomName: true, packageVolume: true, markingMode: true, salePriceCents: true, stockBalances: { where: { branchId, storeId }, select: { available: true } } },
    orderBy: { name: "asc" }, ...(extras ? { take: 30 } : {}),
  });
  // The ordinary quote can contain cumulative technical requirements (for
  // example ACEA C3 AND API SP). The legacy single-family lookup remains the
  // discovery/type gate; the shared material matcher enforces every clause.
  // Blank viscosity remains an explicit manual-choice mode, not an invented SAE.
  // The existing quote accepts the manufacturer's optional Ford prefix and
  // separator variants for this exact code family. Preserve that spelling-only
  // behavior at the strict matcher boundary; do not infer new equivalences.
  const canonicalFord = (value: string) => value.replace(/\b(?:Ford\s+)?WSS[ -]*M2C[ -]*(\d{3})[ -]*([A-Z])\b/gi,
    (_raw, number: string, suffix: string) => `WSS-M2C${number}-${suffix.toUpperCase()}`);
  const requirements = [canonicalFord(specification.trim()), ...(viscosity.trim() ? [`SAE ${viscosity.trim().replace(/^SAE\s+/i, "")}`] : [])].filter(Boolean).join("; ");
  const products = rows.filter(row => extras ? row.entityType === "service" || row.stockBalances.some(stock => Number(stock.available) > 0) : matchesQuoteOil(row, specification, viscosity) && engineOilSpecificationMatches({ ...row, oem: canonicalFord(row.oem ?? "") }, requirements)).map(row => ({
    id: row.id, name: row.name, brand: row.brand, article: row.article ?? "", price: row.salePriceCents / 100,
    available: row.stockBalances.reduce((sum, stock) => sum + Number(stock.available), 0),
    unit: row.uomName ?? "шт.", litresPerUnit: quoteLitresPerUnit(row), sae: row.sae ?? "", oem: row.oem ?? "",
  }));
  return products;
}
