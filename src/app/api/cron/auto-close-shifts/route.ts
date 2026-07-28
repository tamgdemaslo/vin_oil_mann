import { NextRequest, NextResponse } from "next/server";
import { autoCloseShifts } from "@/lib/shifts";
import { runForActiveBranches } from "@/lib/branch-workers";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = request.nextUrl.searchParams.get("secret");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}` && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const branches = await runForActiveBranches(() => autoCloseShifts());
  const closed = branches.reduce((sum, branch) => sum + (branch.result?.closed ?? 0), 0);
  return NextResponse.json({ ok: branches.every((branch) => branch.ok), closed, branches });
}
