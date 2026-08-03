import { NextResponse } from "next/server";
import { getClientSiteData } from "@/lib/client-site-api";

export async function GET() {
  const items = getClientSiteData().SERVICES ?? [];
  return NextResponse.json({ items, total: items.length });
}
