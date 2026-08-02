import { NextResponse } from "next/server";
import { getSystemRelease } from "@/lib/system-release";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSystemRelease(), {
    headers: { "Cache-Control": "no-store" },
  });
}
