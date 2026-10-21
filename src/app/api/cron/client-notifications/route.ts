import { NextResponse } from "next/server";
import { runClientNotificationsWorkerOnce } from "@/lib/client-notifications/worker";
import { processPendingCustomerReturnDeliveries } from "@/lib/customer-return-jobs";
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
  const branches = await runForActiveBranches(async () => {
    const notifications=await runClientNotificationsWorkerOnce(50);
    // Only accepted employee jobs; no selection, automatic campaigns or uncertain retries.
    const returns=process.env.CRON_SECRET?.trim()?await processPendingCustomerReturnDeliveries():undefined;
    return {...notifications,customerReturn:returns};
  });
  return NextResponse.json({ ok: branches.every((branch) => branch.ok), branches });
}

export async function POST(request: Request) {
  return GET(request);
}
