import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { syncTelegramUserConversations } from "@/lib/messenger/messenger-gateway";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown; limit?: unknown; force?: unknown };
  try {
    const result = await syncTelegramUserConversations({
      accountId: typeof body.accountId === "string" ? body.accountId : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      force: body.force === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не удалось синхронизировать Telegram" }, { status: 400 });
  }
}
