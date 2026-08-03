import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { confirmTelegramUserCode } from "@/lib/messenger/channels/telegram-user-session";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner") return { response: NextResponse.json({ error: "Только владелец может подключать Telegram" }, { status: 403 }) };
  return { session };
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown; code?: unknown };
  try {
    const result = await confirmTelegramUserCode(
      typeof body.accountId === "string" ? body.accountId : "",
      typeof body.code === "string" ? body.code : ""
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Код Telegram не принят" }, { status: 400 });
  }
}
