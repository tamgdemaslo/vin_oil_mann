import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { matchesQuoteOil, quoteLitresPerUnit } from "@/lib/maintenance-quote";

export async function GET(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  const branchId = access.context.branchId!;
  const params = request.nextUrl.searchParams;
  const storeId = params.get("storeId")?.trim();
  if (!storeId) return NextResponse.json({ error: "Выберите склад для расчёта" }, { status: 400 });
  const store = await prisma.localStore.findFirst({ where: { id: storeId, branchId }, select: { id: true } });
  if (!store) return NextResponse.json({ error: "Склад недоступен" }, { status: 404 });
  const specification = (params.get("specification") ?? "").slice(0, 2000);
  const viscosity = (params.get("viscosity") ?? "").slice(0, 200);
  const search = (params.get("search") ?? "").trim().slice(0, 200);
  const extras = params.get("kind") === "extra";
  if (extras && search.length < 2) return NextResponse.json({ products: [] });
  try {
    const rows = await prisma.localProduct.findMany({
      where: { branchId, archived: false, ...(extras ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { article: { contains: search, mode: "insensitive" } }] } : { stockBalances: { some: { branchId, storeId, available: { gt: 0 } } } }) },
      select: { id: true, name: true, article: true, entityType: true, groupPath: true, sae: true, oem: true, acea: true, apiSpec: true, ilsac: true, uomName: true, packageVolume: true, salePriceCents: true, stockBalances: { where: { branchId, storeId }, select: { available: true } } },
      orderBy: { name: "asc" }, ...(extras ? { take: 30 } : {}),
    });
    const products = rows.filter(row => extras ? row.entityType === "service" || row.stockBalances.some(stock => Number(stock.available) > 0) : matchesQuoteOil(row, specification, viscosity)).map(row => ({
      id: row.id, entityType: row.entityType, name: row.name, article: row.article ?? "", price: row.salePriceCents / 100,
      available: row.stockBalances.reduce((sum, stock) => sum + Number(stock.available), 0),
      unit: row.uomName ?? "шт.", litresPerUnit: quoteLitresPerUnit(row), sae: row.sae ?? "", oem: row.oem ?? "",
    }));
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить наличие. Повторите поиск." }, { status: 500 });
  }
}
