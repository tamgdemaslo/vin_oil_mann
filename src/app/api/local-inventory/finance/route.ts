import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLocalInventoryFinance } from "@/lib/local-inventory-finance";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? undefined;
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? undefined;
  return NextResponse.json(await getLocalInventoryFinance({ dateFrom, dateTo }));
}
