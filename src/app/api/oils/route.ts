import { NextRequest, NextResponse } from "next/server";
import { getClientOils } from "@/lib/client-site-api";

export async function GET(request: NextRequest) {
  try {
    const items = await getClientOils(request.nextUrl.searchParams);
    return NextResponse.json({ items, total: items.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[oils]", error);
    return NextResponse.json(
      { error: "Каталог масел временно недоступен.", items: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
