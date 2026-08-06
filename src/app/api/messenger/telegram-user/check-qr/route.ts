import { NextRequest, NextResponse } from "next/server";
import { checkTelegramUserQrAuth } from "@/lib/messenger/channels/telegram-user-session";
import { requireTelegramOwnerBranchApi } from "@/lib/telegram-user-route-access";
import { runWithBranchApiContext } from "@/lib/branch-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireTelegramOwnerBranchApi();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown };
  try {
    const result = await runWithBranchApiContext(auth.context, () => checkTelegramUserQrAuth(typeof body.accountId === "string" ? body.accountId : ""));
    console.info("[messenger.telegram_user.route]", {
      action: "check_qr_success",
      durationMs: Date.now() - startedAt,
      accountId: typeof body.accountId === "string" ? body.accountId : null,
      connected: "connected" in result ? result.connected : false,
      needsPassword: "needsPassword" in result ? result.needsPassword ?? false : false,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.warn("[messenger.telegram_user.route]", {
      action: "check_qr_failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "QR Telegram не подтверждён",
    });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "QR Telegram не подтверждён" }, { status: 400 });
  }
}
