import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { testTBankIntegration } from "@/lib/tbank";

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    const result = await testTBankIntegration(access.context.user, request.nextUrl.searchParams.get("connectionId") ?? undefined);
    if (!result.ok) return NextResponse.json({ error: result.error, integration: result.integration }, { status: result.status });
    return NextResponse.json(result);
  });
}
