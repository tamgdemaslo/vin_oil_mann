import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listTelegramUserAccounts } from "@/lib/messenger/channels/telegram-user-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const telegram = await listTelegramUserAccounts();
  return NextResponse.json({ accounts: telegram });
}
