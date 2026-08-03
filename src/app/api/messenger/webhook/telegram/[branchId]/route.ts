import { NextRequest, NextResponse } from "next/server";
import { runForBranch } from "@/lib/branch-workers";
import { ingestTelegramWebhook } from "@/lib/messenger/messenger-gateway";
import { assertExternalSideEffectAllowed } from "@/lib/external-side-effects";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ branchId: string }> }
) {
  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload) {
    return NextResponse.json({ ok: false, accepted: false, error: "empty webhook payload" }, { status: 400 });
  }
  try {
    assertExternalSideEffectAllowed("webhook_processing");
    const { branchId } = await context.params;
    const result = await runForBranch(branchId, () => ingestTelegramWebhook(payload, request.headers));
    return NextResponse.json(result, { status: result.accepted || result.ok ? 200 : 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "telegram webhook failed";
    const status = message === "Invalid Telegram webhook secret" ? 403 : 400;
    return NextResponse.json({ ok: false, accepted: false, error: message }, { status });
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ branchId: string }> }
) {
  const { branchId } = await context.params;
  return NextResponse.json({
    ok: true,
    branchId,
    channel: "telegram",
    webhook: "ready",
    endpoint: `/api/messenger/webhook/telegram/${encodeURIComponent(branchId)}`,
  });
}
