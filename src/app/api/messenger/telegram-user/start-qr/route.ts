import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { startTelegramUserQrAuth } from "@/lib/messenger/channels/telegram-user-session";

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
  const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
  try {
    const result = await startTelegramUserQrAuth(typeof body.phone === "string" ? body.phone : "");
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
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось создать QR Telegram" }, { status: 400 });
  }
}
