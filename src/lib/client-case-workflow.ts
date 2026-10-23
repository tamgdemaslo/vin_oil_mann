import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { defaultNextActionForCaseStatus, isClientCaseClosedStatus, normalizeClientCaseStatus, type ClientCaseAction, type ClientCaseStatus } from "@/lib/client-case-shared";
import { caseDayDeadline } from "@/lib/client-case-simple";
import { getCrmStageBySortOrder } from "@/lib/crm";
import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";
import { caseHistoryChanges } from "@/lib/client-case-history";

type EventInput = {
  caseId: string;
  actorLogin?: string | null;
  eventType: string;
  title: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function writeClientCaseEvent(input: EventInput) {
  try {
    await prisma.clientCaseEvent.create({
      data: {
        caseId: input.caseId,
        actorLogin: input.actorLogin ?? null,
        eventType: input.eventType,
        title: input.title,
        note: input.note ?? null,
        metadata: input.metadata == null ? undefined : (input.metadata as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("client_case_events")) throw error;
  }
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function parseActionDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function stageIdForStatus(status: ClientCaseStatus) {
  const sortOrderByStatus: Record<ClientCaseStatus, number> = {
    calculation_needed: 10,
    calculation_sent: 20,
    check_response: 30,
    client_replied: 40,
    waiting_parts: 50,
    parts_arrived: 60,
    postponed: 70,
    cancelled: 80,
    duplicate: 90,
    closed: 100,
  };
  return (await getCrmStageBySortOrder(sortOrderByStatus[status]))?.id ?? null;
}

async function acknowledgeActiveReminders(caseId: string) {
  const { branchId } = requireSingleBranchSqlContext();
  await prisma.$executeRaw`
    UPDATE client_case_notification_log
    SET acknowledged_at = COALESCE(acknowledged_at, now())
    WHERE case_id = ${caseId}
      AND branch_id = ${branchId}
      AND acknowledged_at IS NULL
  `;
}

function actionPatch(action: ClientCaseAction, body: Record<string, unknown>, now: Date) {
  let status: ClientCaseStatus;
  let nextActionAt: Date | null = caseDayDeadline(now);
  let nextAction = "";
  let closeReason: string | null = null;
  const patch: Record<string, unknown> = { snoozeUntil: null };

  if (action === "calculate") {
    status = "calculation_needed";
    nextAction = "Подготовить расчёт";
  } else if (action === "mark_calculation_sent") {
    status = "calculation_sent";
    nextActionAt = null;
    nextAction = "Ждать решения клиента";
    patch.lastOutboundMessageAt = now;
  } else if (action === "check_response") {
    status = "check_response";
    nextAction = "Написать клиенту";
  } else if (action === "client_replied") {
    status = "client_replied";
    nextAction = "Открыть диалог";
    patch.lastClientMessageAt = now;
  } else if (action === "client_agreed" || action === "waiting_parts") {
    status = "waiting_parts";
    nextAction = "Ждать поставку запчастей";
    nextActionAt = parseActionDate(body.nextActionAt) ?? parseActionDate(body.nextContactAt) ?? null;
  } else if (action === "parts_arrived") {
    status = "parts_arrived";
    nextAction = "Позвонить клиенту и записать на обслуживание";
  } else if (action === "postpone") {
    status = "postponed";
    nextActionAt = parseActionDate(body.nextActionAt) ?? parseActionDate(body.snoozeUntil) ?? addHours(now, 3);
    nextAction = "Вернуться к делу позже";
    patch.snoozeUntil = nextActionAt;
  } else if (action === "refused") {
    status = "cancelled";
    nextActionAt = null;
    nextAction = "Клиент отказался";
    closeReason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "клиент отказался";
  } else if (action === "duplicate") {
    status = "duplicate";
    nextActionAt = null;
    nextAction = "Дубль";
    closeReason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "дубль";
  } else if (action === "confirm_manual_booking") {
    status = "closed";
    nextActionAt = null;
    nextAction = "Закрыто";
    closeReason = "Клиент записан вручную";
  } else {
    status = "closed";
    nextActionAt = null;
    nextAction = "Закрыто";
    closeReason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "закрыто вручную";
  }

  patch.caseStatus = status;
  patch.nextAction = typeof body.nextAction === "string" && body.nextAction.trim() ? body.nextAction.trim() : nextAction;
  patch.nextActionAt = nextActionAt;
  patch.nextContactAt = nextActionAt;
  if (body.suppliesExpectedAt !== undefined) patch.suppliesExpectedAt = parseActionDate(body.suppliesExpectedAt);
  if (body.suppliesSupplier !== undefined) patch.suppliesSupplier = typeof body.suppliesSupplier === "string" && body.suppliesSupplier.trim() ? body.suppliesSupplier.trim().slice(0, 200) : null;
  if (body.suppliesNote !== undefined) patch.suppliesNote = typeof body.suppliesNote === "string" && body.suppliesNote.trim() ? body.suppliesNote.trim() : null;
  if (closeReason) {
    patch.status = status === "closed" ? "won" : "lost";
    patch.closeReason = closeReason;
    patch.closedAt = now;
    patch.snoozeUntil = null;
  } else {
    patch.status = "open";
    patch.closedAt = null;
    patch.closeReason = null;
  }
  return { status, patch };
}

export async function applyClientCaseAction(caseId: string, action: ClientCaseAction, body: Record<string, unknown> = {}, actorLogin?: string | null) {
  const expectedUpdatedAt = action === "confirm_manual_booking" ? parseActionDate(body.expectedUpdatedAt) : null;
  if (action === "confirm_manual_booking" && !expectedUpdatedAt) throw new Error("Manual booking confirmation requires the current case version");
  const now = new Date();
  const { status, patch } = actionPatch(action, body, now);
  const stageId = await stageIdForStatus(status);
  if (stageId) patch.stageId = stageId;

  const previous = await prisma.crmDeal.findUnique({ where: { id: caseId }, select: { updatedAt: true, status: true, caseStatus: true, nextAction: true, nextActionAt: true, nextContactAt: true, suppliesExpectedAt: true, stage: { select: { name: true } } } });

  const updated = await prisma.crmDeal.update({
    where: { id: caseId, updatedAt: action === "confirm_manual_booking" ? expectedUpdatedAt! : previous?.updatedAt, ...(action === "confirm_manual_booking" ? { status: "open" } : {}) },
    data: patch,
  });

  await acknowledgeActiveReminders(caseId);
  await writeClientCaseEvent({
    caseId,
    actorLogin,
    eventType: action,
    title: defaultNextActionForCaseStatus(status),
    note: typeof body.note === "string" ? body.note : null,
    metadata: { status, action, ...(previous ? { changes: caseHistoryChanges(previous, updated, patch) } : {}), ...(action === "confirm_manual_booking" ? { bookingConfirmation: "manual" } : {}) },
  });
  return updated;
}

// Compatibility entry point for existing callers. Sent calculations stay idle;
// messages are recorded below without inventing new workflow stages.
export async function processClientCaseWorkflowTransitions(_now = new Date()) {
  void _now;
  return { checkedResponses: 0, clientReplies: 0 };
}

export async function touchClientCaseMessageState(input: {
  conversationId: string;
  direction: "inbound" | "outbound";
  at?: Date | null;
  text?: string | null;
}) {
  const at = input.at ?? new Date();
  const rows = await prisma.crmDeal.findMany({
    where: {
      status: "open",
      OR: [
        { conversationId: input.conversationId },
        { notes: { contains: `conversation:${input.conversationId}` } },
      ],
    },
    include: { stage: true },
    orderBy: [{ updatedAt: "desc" }],
    take: 5,
  });

  for (const row of rows) {
    const currentStatus = normalizeClientCaseStatus(row.caseStatus, row.stage?.name);
    if (isClientCaseClosedStatus(currentStatus)) continue;
    await prisma.crmDeal.update({
      where: { id: row.id },
      data: input.direction === "outbound" ? { lastOutboundMessageAt: at } : { lastClientMessageAt: at },
    });
    if (input.direction === "inbound") {
      await writeClientCaseEvent({
        caseId: row.id,
        eventType: "client_message",
        title: "Клиент ответил",
        note: input.text ?? null,
        metadata: { conversationId: input.conversationId },
      });
    }
  }
}
