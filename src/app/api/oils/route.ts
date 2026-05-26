import { NextRequest, NextResponse } from "next/server";
import { getClientOils } from "@/lib/client-site-api";

export async function GET(request: NextRequest) {
  const items = await getClientOils(request.nextUrl.searchParams);
  return NextResponse.json({
    items,
    total: items.length,
    available: items.length,
  });
}
