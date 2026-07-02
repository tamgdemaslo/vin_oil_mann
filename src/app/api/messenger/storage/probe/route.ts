import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { probeMessengerStorageConnection } from "@/lib/messenger/messenger-storage";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const result = await probeMessengerStorageConnection();
  return NextResponse.json(result, { status: result.ok ? 200 : result.configured ? 502 : 503 });
}
