import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyClientCaseAction } from "@/lib/client-case-workflow";
import { canAccessCrm } from "@/lib/crm-access";
import type { ClientCaseAction } from "@/lib/client-case-shared";

const ACTIONS = new Set<ClientCaseAction>([
  "calculate",
  "mark_calculation_sent",
  "check_response",
  "client_replied",
  "client_agreed",
  "waiting_parts",
  "parts_arrived",
  "create_appointment",
  "create_shipment",
  "postpone",
  "close",
  "refused",
  "duplicate",
]);

async function requireCrmSession() {
  const session = await getSession();
  if (!session) return { session: null, response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (!canAccessCrm(session.user.role)) return { session: null, response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { session, response: null };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCrmSession();
  if (access.response) return access.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rawAction = body.action;
  const action = typeof rawAction === "string" && ACTIONS.has(rawAction as ClientCaseAction) ? (rawAction as ClientCaseAction) : null;
  if (!action) return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  if (action === "create_appointment" || action === "create_shipment") {
    return NextResponse.json({ error: "Создайте запись или отгрузку через соответствующий раздел, затем обновите дело" }, { status: 400 });
  }
  const updated = await applyClientCaseAction(id, action, body, access.session!.user.login);
  return NextResponse.json({ case: updated });
}
