import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { refreshTBankPaymentStatus } from "@/lib/tbank";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const { id, paymentId } = await params;
  return runWithBranchApiContext(access.context, async () => {
    const result = await refreshTBankPaymentStatus(id, paymentId, access.context.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  });
}
