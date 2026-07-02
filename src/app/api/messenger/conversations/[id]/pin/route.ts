import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setConversationPinned } from "@/lib/messenger/messenger-gateway";

function messengerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие Messenger";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { pinned?: unknown } | null;
  const { id } = await params;
  try {
    const conversation = await setConversationPinned(id, typeof body?.pinned === "boolean" ? body.pinned : undefined);
    if (!conversation) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });
    return NextResponse.json({ conversation });
  } catch (error) {
    return messengerError(error);
  }
}
