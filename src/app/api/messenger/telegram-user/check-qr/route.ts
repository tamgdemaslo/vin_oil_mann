import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkTelegramUserQrAuth } from "@/lib/messenger/channels/telegram-user-session";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner") return { response: NextResponse.json({ error: "Только владелец может подключать Telegram" }, { status: 403 }) };
  return { session };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireOwner();
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown };
  try {
    const result = await checkTelegramUserQrAuth(typeof body.accountId === "string" ? body.accountId : "");
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
