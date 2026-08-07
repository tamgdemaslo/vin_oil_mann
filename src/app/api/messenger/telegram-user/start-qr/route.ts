import { NextRequest, NextResponse } from "next/server";
import { startTelegramUserQrAuth } from "@/lib/messenger/channels/telegram-user-session";
import { requireTelegramOwnerBranchApi } from "@/lib/telegram-user-route-access";
import { runWithBranchApiContext } from "@/lib/branch-api";
import {
  INTEGRATION_STORAGE_NOT_CONFIGURED_CODE,
  INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE,
  isIntegrationEncryptionConfigurationError,
} from "@/lib/messenger/messenger-crypto";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireTelegramOwnerBranchApi();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
  try {
    const result = await runWithBranchApiContext(auth.context, () => startTelegramUserQrAuth(typeof body.phone === "string" ? body.phone : ""));
    console.info("[messenger.telegram_user.route]", {
      action: "start_qr_success",
      durationMs: Date.now() - startedAt,
      accountId: "accountId" in result ? result.accountId ?? null : result.account?.id ?? null,
      connected: "connected" in result ? result.connected : false,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.warn("[messenger.telegram_user.route]", {
      action: "start_qr_failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Не удалось создать QR Telegram",
    });
    if (isIntegrationEncryptionConfigurationError(error)) {
      return NextResponse.json(
        { ok: false, error: INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE, code: INTEGRATION_STORAGE_NOT_CONFIGURED_CODE },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось создать QR Telegram" }, { status: 400 });
  }
}
