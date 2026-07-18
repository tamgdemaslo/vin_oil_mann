import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMessengerOrganizationIdForUser } from "@/lib/messenger/messenger-tenant";

export async function requireAIAgentAccess(options: { manage?: boolean } = {}) {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (options.manage && session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "Недостаточно прав для ИИ-агента" }, { status: 403 }) };
  }
  return {
    session,
    organizationId: getMessengerOrganizationIdForUser(session.user),
    actorId: session.user.login,
  };
}

export function aiAgentApiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /необходима авторизация/i.test(message) ? 401 : /другой организации|недостаточно прав/i.test(message) ? 403 : /не найден|нет действия/i.test(message) ? 404 : /выключен|не задан|ожидает подтверждения|перехвачен|истекло|нет явного согласия/i.test(message) ? 409 : 500;
  return NextResponse.json({ error: message }, { status });
}
