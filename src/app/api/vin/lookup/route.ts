import { NextRequest, NextResponse } from "next/server";
import { buildClientVinLookup } from "@/lib/client-site-api";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { vin?: unknown } | null;
  return NextResponse.json(await buildClientVinLookup(body?.vin));
}
