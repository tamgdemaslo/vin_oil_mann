import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", uptimeSeconds: Math.floor(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
