import { NextResponse } from "next/server";
import { getReadiness, getSystemRelease } from "@/lib/system-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getReadiness();
  return NextResponse.json(
    {
      status: readiness.ready ? "ready" : "not_ready",
      release: getSystemRelease(),
      checks: readiness.checks,
    },
    {
      status: readiness.ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
