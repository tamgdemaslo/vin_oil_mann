import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { disconnectTelegramUserAccount } from "@/lib/messenger/channels/telegram-user-session";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner") return { response: NextResponse.json({ error: "Только владелец может отключать Telegram" }, { status: 403 }) };
  return { session };
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown };
  try {
    return NextResponse.json(await disconnectTelegramUserAccount(typeof body.accountId === "string" ? body.accountId : ""));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось отключить Telegram" }, { status: 400 });
  }
}
