import { NextRequest, NextResponse } from "next/server";
import { runForBranch } from "@/lib/branch-workers";
import { processTBankPaymentWebhook } from "@/lib/tbank";
import { assertExternalSideEffectAllowed } from "@/lib/external-side-effects";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ branchId: string }> }
) {
  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Неверное тело webhook" }, { status: 400 });
  const sourceIp = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "";
  try {
    assertExternalSideEffectAllowed("webhook_processing");
    const { branchId } = await context.params;
    const result = await runForBranch(branchId, () =>
      processTBankPaymentWebhook({ payload, headers: request.headers, sourceIp })
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "T-Bank webhook failed" },
      { status: 400 }
    );
  }
}
