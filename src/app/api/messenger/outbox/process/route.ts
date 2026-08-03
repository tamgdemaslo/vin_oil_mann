import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processPendingOutbox } from "@/lib/messenger/messenger-outbox";

async function requireOwner() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner") return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { session };
}

function processError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось обработать outbox";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if ("response" in auth) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
  const limit = typeof body.limit === "number" ? body.limit : 20;
  try {
    const processed = await processPendingOutbox(limit);
    return NextResponse.json({ ok: true, processed, count: processed.length });
  } catch (error) {
    return processError(error);
  }
}
