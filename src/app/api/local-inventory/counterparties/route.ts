import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createLocalAdminCounterparty,
  listLocalAdminCounterparties,
} from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const type = request.nextUrl.searchParams.get("type") ?? undefined;
  const phone = request.nextUrl.searchParams.get("phone") ?? undefined;
  const requisites = request.nextUrl.searchParams.get("requisites") ?? undefined;
  const shipments = request.nextUrl.searchParams.get("shipments") ?? undefined;
  const sort = request.nextUrl.searchParams.get("sort") ?? undefined;
  const direction = request.nextUrl.searchParams.get("direction") ?? undefined;

  return NextResponse.json(
    await listLocalAdminCounterparties({
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
    })
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await createLocalAdminCounterparty(body as Parameters<typeof createLocalAdminCounterparty>[0]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.counterparty);
}
