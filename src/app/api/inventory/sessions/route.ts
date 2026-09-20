import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  createInventorySession,
  listInventorySessions,
  type InventorySessionFilters,
} from "@/lib/warehouse-inventory";

function readBool(value: string | null) {
  return value === "1" || value === "true";
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false });
  if (!access.ok) return access.response;

  const sp = request.nextUrl.searchParams;
  const filters: InventorySessionFilters = {
    organizationId: sp.get("organizationId") ?? undefined,
    warehouseId: sp.get("warehouseId") ?? undefined,
    status: sp.get("status") ?? undefined,
    category: sp.get("category") ?? undefined,
    discrepancy: sp.get("discrepancy") ?? undefined,
    onlyWithDiscrepancies: readBool(sp.get("onlyWithDiscrepancies")),
    dateFrom: sp.get("dateFrom") ?? undefined,
    dateTo: sp.get("dateTo") ?? undefined,
    limit: Number(sp.get("limit") ?? 40),
    offset: Number(sp.get("offset") ?? 0),
  };
  return runWithBranchApiContext(access.context, async () => {
    return NextResponse.json(await listInventorySessions(filters));
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  return runWithBranchApiContext(access.context, async () => {
    const result = await createInventorySession(body as Parameters<typeof createInventorySession>[0], session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result.data);
  });
}
