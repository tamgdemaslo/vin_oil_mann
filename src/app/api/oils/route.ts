import { NextRequest, NextResponse } from "next/server";
import { getClientOilPage } from "@/lib/client-site-api";

const CATALOG_CACHE_CONTROL = "public, max-age=0, s-maxage=15, stale-while-revalidate=60";

export async function GET(request: NextRequest) {
  try {
    const page = await getClientOilPage(request.nextUrl.searchParams);
    return NextResponse.json(page, { headers: { "Cache-Control": CATALOG_CACHE_CONTROL } });
  } catch (error) {
    console.error("[oils]", error);
    return NextResponse.json(
      { error: "Каталог масел временно недоступен.", items: [], total: 0, nextOffset: null },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
