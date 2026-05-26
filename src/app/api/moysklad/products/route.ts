import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchLocalProducts } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const oem = request.nextUrl.searchParams.get("oem") ?? "";
  const mannName = request.nextUrl.searchParams.get("mannName") ?? "";
  const params = request.nextUrl.searchParams.get("params") ?? "";
  const storeName = request.nextUrl.searchParams.get("storeName") ?? "";
  const storeId = request.nextUrl.searchParams.get("storeId") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "15", 10) || 15);

  return NextResponse.json(await searchLocalProducts({ search, oem, mannName, params, storeName, storeId, limit }));
}
