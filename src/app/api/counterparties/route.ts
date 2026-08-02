import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { createLocalAdminCounterparty, listLocalAdminCounterparties } from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;
  const category = request.nextUrl.searchParams.get("category");
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const type = category === "SUPPLIER" ? "supplier" : category === "INDIVIDUAL" ? "individual" : undefined;
  return NextResponse.json(await listLocalAdminCounterparties({
    branchId: branchAccess.context.branchId!,
    search: request.nextUrl.searchParams.get("search") ?? "",
    status,
    type,
    limit: Number(request.nextUrl.searchParams.get("limit") ?? "30"),
    offset: Number(request.nextUrl.searchParams.get("offset") ?? "0"),
  }));
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
  return NextResponse.json(result.counterparty, { status: 201 });
}
