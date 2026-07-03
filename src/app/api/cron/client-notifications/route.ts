import { NextResponse } from "next/server";
import { processDueClientNotificationJobs } from "@/lib/client-notifications/client-notifications";

export const dynamic = "force-dynamic";

function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 401 });
  }
  const processed = await processDueClientNotificationJobs(50);
  return NextResponse.json({ ok: true, processed, count: processed.length });
}

export async function POST(request: Request) {
  return GET(request);
}
