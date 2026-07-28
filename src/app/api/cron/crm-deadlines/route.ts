import { NextResponse } from "next/server";
import { processClientCaseDeadlineNotifications } from "@/lib/crm-deadline-notifications";
import { runForActiveBranches } from "@/lib/branch-workers";

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
  const branches = await runForActiveBranches(() => processClientCaseDeadlineNotifications());
  return NextResponse.json({ ok: branches.every((branch) => branch.ok), branches });
}

export async function POST(request: Request) {
  return GET(request);
}
