import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMessengerOrganizationIdForUser } from "@/lib/messenger/messenger-tenant";

/** The first release is deliberately employee-only. */
export async function requireAIAssistantAccess() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) } as const;
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "ИИ-помощник доступен владельцу и администраторам" }, { status: 403 }) } as const;
  }
  return {
    session,
    organizationId: getMessengerOrganizationIdForUser(session.user),
    actorId: session.user.login,
  } as const;
}

export function aiAssistantApiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /авторизац/i.test(message) ? 401 : /доступ|прав/i.test(message) ? 403 : /не найден/i.test(message) ? 404 : /отмен/i.test(message) ? 409 : 500;
  return NextResponse.json({ error: message }, { status });
}
