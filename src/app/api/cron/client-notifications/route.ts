import { NextResponse } from "next/server";
import { runClientNotificationsWorkerOnce } from "@/lib/client-notifications/worker";

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
  return NextResponse.json(await runClientNotificationsWorkerOnce(50));
}

export async function POST(request: Request) {
  return GET(request);
}
