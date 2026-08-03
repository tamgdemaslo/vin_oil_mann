import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { backfillTelegramMedia } from "@/lib/messenger/messenger-media";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { limit?: unknown } | null;
  const limit = typeof body?.limit === "number" ? Math.min(200, Math.max(1, Math.trunc(body.limit))) : 50;
  return NextResponse.json(await backfillTelegramMedia(limit), { status: 202 });
}
