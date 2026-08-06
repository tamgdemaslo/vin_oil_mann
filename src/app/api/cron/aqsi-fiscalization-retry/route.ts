import { NextRequest, NextResponse } from "next/server";
import { retryDueAqsiFiscalizations } from "@/lib/aqsi-fiscalization";
import { runForActiveBranches } from "@/lib/branch-workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${expected}` || request.nextUrl.searchParams.get("secret") === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 401 });
  const branches = await runForActiveBranches(async () => {
    const results = await retryDueAqsiFiscalizations(10);
    return { processed: results.length, pending: results.filter((row) => row.pending).length };
  });
  return NextResponse.json({
    ok: branches.every((branch) => branch.ok),
    branches: branches.map((branch) => ({ branchId: branch.branchId, ok: branch.ok, processed: branch.result?.processed ?? 0, pending: branch.result?.pending ?? 0 })),
  });
}
