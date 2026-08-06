import { NextRequest, NextResponse } from "next/server";
import { startTelegramUserAuth } from "@/lib/messenger/channels/telegram-user-session";
import { requireTelegramOwnerBranchApi } from "@/lib/telegram-user-route-access";
import { runWithBranchApiContext } from "@/lib/branch-api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireTelegramOwnerBranchApi();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
  try {
    const result = await runWithBranchApiContext(auth.context, () => startTelegramUserAuth(typeof body.phone === "string" ? body.phone : ""));
    console.info("[messenger.telegram_user.route]", {
      action: "start_auth_success",
      durationMs: Date.now() - startedAt,
      accountId: result.account?.id ?? null,
      deliveryType: result.codeDelivery?.type ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.warn("[messenger.telegram_user.route]", {
      action: "start_auth_failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Не удалось отправить код Telegram",
    });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось отправить код Telegram" }, { status: 400 });
  }
}
