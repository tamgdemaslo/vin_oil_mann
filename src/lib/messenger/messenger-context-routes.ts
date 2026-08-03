import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { MessengerContextError } from "./messenger-context";

export async function requireMessengerContextSession() {
  const session = await getSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }),
      actor: null,
    };
  }
  return {
    response: null,
    actor: {
      login: session.user.login,
      role: session.user.role,
    },
  };
}

export function messengerContextError(error: unknown) {
  if (error instanceof MessengerContextError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие Messenger";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  if (message.includes("communication_identities") || message.includes("conversation_entity_links")) {
    return NextResponse.json({ error: "Миграция контекста Messenger ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  return (await request.json().catch(() => ({}))) as T;
}

