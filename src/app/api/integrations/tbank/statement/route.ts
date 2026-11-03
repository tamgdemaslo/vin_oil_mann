import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getTBankStatement } from "@/lib/tbank";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    const query = request.nextUrl.searchParams;
    const result = await getTBankStatement({ dateFrom: query.get("dateFrom") ?? "", dateTo: query.get("dateTo") ?? "", connectionId: query.get("connectionId") ?? undefined, accountId: query.get("accountId") ?? undefined }, access.context.user);
    return NextResponse.json(result.ok ? result.statement : { error: result.error }, { status: result.ok ? 200 : result.status, headers: { "Cache-Control": "private, no-store" } });
  });
}
