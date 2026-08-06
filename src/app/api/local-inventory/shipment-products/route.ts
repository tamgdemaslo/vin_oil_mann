import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchCatalog } from "@/lib/catalog-search";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const entityType = request.nextUrl.searchParams.get("entityType") ?? "";
  return NextResponse.json(await searchCatalog({ q: request.nextUrl.searchParams.get("search") ?? "", context: "shipment", oem: request.nextUrl.searchParams.get("oem") ?? "", mannName: request.nextUrl.searchParams.get("mannName") ?? "", params: request.nextUrl.searchParams.get("params") ?? "", type: entityType === "product" || entityType === "service" ? entityType : "all", storeName: request.nextUrl.searchParams.get("storeName") ?? "", storeId: request.nextUrl.searchParams.get("storeId") ?? "", limit: Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "15", 10) || 15) }));
}
