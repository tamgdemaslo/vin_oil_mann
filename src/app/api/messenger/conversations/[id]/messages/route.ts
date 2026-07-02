import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listMessages, sendMessage } from "@/lib/messenger/messenger-gateway";

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
    return NextResponse.json({ messages: await listMessages(id) });
  } catch (error) {
    return messengerError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { text?: unknown; replyToId?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Введите текст сообщения" }, { status: 400 });
  try {
    const result = await sendMessage({
      conversationId: id,
      text,
      replyToId: typeof body?.replyToId === "string" ? body.replyToId : undefined,
      createdByLogin: session.user.login,
    });
    if (!result) return NextResponse.json({ error: "Диалог не найден" }, { status: 404 });
    return NextResponse.json(result, { status: result.ok ? 201 : 202 });
  } catch (error) {
    return messengerError(error);
  }
}
