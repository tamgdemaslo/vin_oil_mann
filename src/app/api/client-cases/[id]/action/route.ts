import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { applyClientCaseAction } from "@/lib/client-case-workflow";
import { canAccessCrm } from "@/lib/crm-access";
import type { ClientCaseAction } from "@/lib/client-case-shared";

import { validCaseRosskoOrder, withCaseRosskoOrder } from "@/lib/client-case-parts";
import { parseServiceDateTime } from "@/lib/date-time";
import { simpleCaseStatus } from "@/lib/client-case-simple";

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
  "confirm_manual_booking",
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
  if (body.rosskoOrderNumber !== undefined && (action !== "waiting_parts" || !validCaseRosskoOrder(body.rosskoOrderNumber))) {
    return NextResponse.json({ error: "Укажите номер заказа РОССКО цифрами, до 20 символов" }, { status: 400 });
  }
  if (typeof body.suppliesExpectedAt === "string" && !body.suppliesExpectedAt.trim()) body.suppliesExpectedAt = null;
  if (body.suppliesExpectedAt !== undefined && body.suppliesExpectedAt !== null) {
    const expected = typeof body.suppliesExpectedAt === "string" ? parseServiceDateTime(body.suppliesExpectedAt) : null;
    if (!expected) return NextResponse.json({ error: "Проверьте дату и время поставки" }, { status: 400 });
    body.suppliesExpectedAt = expected.toISOString();
  }
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;
  return runWithBranchApiContext(branchAccess.context, async () => {
    const existing = await prisma.crmDeal.findUnique({ where: { id }, select: { id: true, appointmentId: true, yclientsRecordId: true, suppliesNote: true, status: true, caseStatus: true, nextAction: true, updatedAt: true, stage: { select: { name: true } } } });
    if (!existing) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    if (action === "confirm_manual_booking" && (existing.status !== "open" || simpleCaseStatus(existing) !== "parts_arrived")) {
      return NextResponse.json({ error: "Этап заявки изменился. Обновите доску перед закрытием." }, { status: 409 });
    }
    if (action === "close" && !existing.appointmentId && !existing.yclientsRecordId) {
      return NextResponse.json({ error: "Сначала запишите клиента на обслуживание" }, { status: 400 });
    }
    if (typeof body.rosskoOrderNumber === "string") {
      const order = body.rosskoOrderNumber.trim();
      body.suppliesNote = withCaseRosskoOrder(existing.suppliesNote, order);
      if (order) body.suppliesSupplier = "РОССКО";
    }
    try {
      const actionBody = action === "confirm_manual_booking" ? {
        expectedUpdatedAt: existing.updatedAt.toISOString(),
        note: "Сотрудник подтвердил, что клиент уже записан вне этой заявки.",
      } : body;
      const updated = await applyClientCaseAction(id, action, actionBody, access.session!.user.login);
      return NextResponse.json({ case: updated });
    } catch (error) {
      if (action === "confirm_manual_booking" && error && typeof error === "object" && "code" in error && error.code === "P2025") {
        return NextResponse.json({ error: "Заявка изменилась. Обновите доску перед закрытием." }, { status: 409 });
      }
      console.error("[client-cases/action]", error);
      return NextResponse.json({ error: "Не удалось обновить заявку. Попробуйте ещё раз." }, { status: 500 });
    }
  });
}
