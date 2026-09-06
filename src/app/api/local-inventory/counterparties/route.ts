import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import {
  createLocalAdminCounterparty,
  listLocalAdminCounterparties,
} from "@/lib/local-inventory-admin";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const category = request.nextUrl.searchParams.get("category") ?? undefined;
  const type = category === "SUPPLIER" ? "supplier" : category === "INDIVIDUAL" ? "individual" : request.nextUrl.searchParams.get("type") ?? undefined;
  const phone = request.nextUrl.searchParams.get("phone") ?? undefined;
  const requisites = request.nextUrl.searchParams.get("requisites") ?? undefined;
  const shipments = request.nextUrl.searchParams.get("shipments") ?? undefined;
  const sort = request.nextUrl.searchParams.get("sort") ?? undefined;
  const direction = request.nextUrl.searchParams.get("direction") ?? undefined;

  const result = await listLocalAdminCounterparties({
      branchId: branchAccess.context.branchId!,
      search,
      limit,
      offset,
      includeArchived,
      status,
      type,
      phone,
      requisites,
      shipments,
      sort,
      direction,
    });
  if (request.nextUrl.searchParams.get("includeVehicles") !== "1") {
    return NextResponse.json(result);
  }
  const ids = result.counterparties.map((item) => item.id);
  const vehicles = ids.length ? await prisma.clientVehicle.findMany({
    where: { branchId: branchAccess.context.branchId!, counterpartyId: { in: ids }, status: "ACTIVE" },
    select: { id: true, counterpartyId: true, make: true, model: true, generation: true, year: true, plate: true, vin: true },
    orderBy: { updatedAt: "desc" },
  }) : [];
  const byClient = new Map<string, typeof vehicles>();
  for (const vehicle of vehicles) {
    const rows = byClient.get(vehicle.counterpartyId) ?? [];
    rows.push(vehicle);
    byClient.set(vehicle.counterpartyId, rows);
  }
  return NextResponse.json({
    ...result,
    counterparties: result.counterparties.map((item) => ({ ...item, vehicles: byClient.get(item.id) ?? [] })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await createLocalAdminCounterparty(body as Parameters<typeof createLocalAdminCounterparty>[0], branchAccess.context.branchId!);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.counterparty);
}
