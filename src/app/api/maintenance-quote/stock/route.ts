import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { loadMaintenanceQuoteStock } from "@/lib/maintenance-quote-stock";

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
    const products = await loadMaintenanceQuoteStock({ branchId, storeId, specification, viscosity, search, extras });
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить наличие. Повторите поиск." }, { status: 500 });
  }
}
