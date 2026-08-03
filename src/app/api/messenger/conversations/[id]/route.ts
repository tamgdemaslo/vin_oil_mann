import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConversation } from "@/lib/messenger/messenger-gateway";

function messengerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие Messenger";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;
  try {
    const conversation = await getConversation(id);
    if (!conversation) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });
    return NextResponse.json({ conversation });
  } catch (error) {
    return messengerError(error);
  }
}
