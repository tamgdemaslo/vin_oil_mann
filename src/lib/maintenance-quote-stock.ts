import { prisma } from "@/lib/db";
import { matchesQuoteOil, quoteLitresPerUnit, type QuoteStockProduct } from "@/lib/maintenance-quote";

export async function loadMaintenanceQuoteStock({ branchId, storeId, specification, viscosity, search = "", extras = false }: {
  branchId: string; storeId: string; specification: string; viscosity: string; search?: string; extras?: boolean;
}): Promise<QuoteStockProduct[]> {
  const rows = await prisma.localProduct.findMany({
    where: { branchId, archived: false, ...(extras ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { article: { contains: search, mode: "insensitive" } }] } : { stockBalances: { some: { branchId, storeId, available: { gt: 0 } } } }) },
    select: { id: true, name: true, article: true, brand: true, entityType: true, groupPath: true, sae: true, oem: true, acea: true, apiSpec: true, ilsac: true, uomName: true, packageVolume: true, salePriceCents: true, stockBalances: { where: { branchId, storeId }, select: { available: true } } },
    orderBy: { name: "asc" }, ...(extras ? { take: 30 } : {}),
  });
  const products = rows.filter(row => extras ? row.entityType === "service" || row.stockBalances.some(stock => Number(stock.available) > 0) : matchesQuoteOil(row, specification, viscosity)).map(row => ({
    id: row.id, name: row.name, brand: row.brand, article: row.article ?? "", price: row.salePriceCents / 100,
    available: row.stockBalances.reduce((sum, stock) => sum + Number(stock.available), 0),
    unit: row.uomName ?? "шт.", litresPerUnit: quoteLitresPerUnit(row), sae: row.sae ?? "", oem: row.oem ?? "",
  }));
  return products;
}
