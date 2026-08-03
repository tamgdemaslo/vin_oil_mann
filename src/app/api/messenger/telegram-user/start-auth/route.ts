import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { startTelegramUserAuth } from "@/lib/messenger/channels/telegram-user-session";

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
    const result = await startTelegramUserAuth(typeof body.phone === "string" ? body.phone : "");
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
