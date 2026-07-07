import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { defaultNextActionForCaseStatus, isClientCaseClosedStatus, normalizeClientCaseStatus, type ClientCaseAction, type ClientCaseStatus } from "@/lib/client-case-shared";
import { getCrmStageBySortOrder } from "@/lib/crm";

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
  await prisma.$executeRaw`
    UPDATE client_case_notification_log
    SET acknowledged_at = COALESCE(acknowledged_at, now())
    WHERE case_id = ${caseId}
      AND acknowledged_at IS NULL
  `;
}

function actionPatch(action: ClientCaseAction, body: Record<string, unknown>, now: Date) {
  let status: ClientCaseStatus;
  let nextActionAt: Date | null = now;
  let nextAction = "";
  let closeReason: string | null = null;
  const patch: Record<string, unknown> = { snoozeUntil: null };

  if (action === "calculate") {
    status = "calculation_needed";
    nextAction = "Подготовить расчёт";
  } else if (action === "mark_calculation_sent") {
    status = "calculation_sent";
    nextActionAt = addHours(now, 24);
    nextAction = "Проверить ответ клиента";
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
    nextAction = "Сообщить клиенту, запчасти пришли";
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
  if (body.suppliesNote !== undefined) patch.suppliesNote = typeof body.suppliesNote === "string" && body.suppliesNote.trim() ? body.suppliesNote.trim() : null;
  if (closeReason) {
    patch.status = status === "closed" ? "won" : "lost";
    patch.closeReason = closeReason;
    patch.closedAt = now;
    patch.snoozeUntil = null;
  } else {
    patch.status = "open";
  }
  return { status, patch };
}

export async function applyClientCaseAction(caseId: string, action: ClientCaseAction, body: Record<string, unknown> = {}, actorLogin?: string | null) {
  const now = new Date();
  const { status, patch } = actionPatch(action, body, now);
  const stageId = await stageIdForStatus(status);
  if (stageId) patch.stageId = stageId;

  const updated = await prisma.crmDeal.update({
    where: { id: caseId },
    data: patch,
  });

  await acknowledgeActiveReminders(caseId);
  await writeClientCaseEvent({
    caseId,
    actorLogin,
    eventType: action,
    title: defaultNextActionForCaseStatus(status),
    note: typeof body.note === "string" ? body.note : null,
    metadata: { status, action },
  });
  return updated;
}

export async function processClientCaseWorkflowTransitions(now = new Date()) {
  const checkStageId = await stageIdForStatus("check_response");
  const replyStageId = await stageIdForStatus("client_replied");
  const rows = await prisma.crmDeal.findMany({
    where: { status: "open" },
    include: { stage: true },
    orderBy: [{ nextActionAt: "asc" }, { nextContactAt: "asc" }],
    take: 500,
  });
  let checkedResponses = 0;
  let clientReplies = 0;

  for (const row of rows) {
    const currentStatus = normalizeClientCaseStatus(row.caseStatus, row.stage?.name);
    if (isClientCaseClosedStatus(currentStatus)) continue;
    if (row.snoozeUntil && row.snoozeUntil > now) continue;

    if (
      (currentStatus === "calculation_sent" || currentStatus === "check_response") &&
      row.lastClientMessageAt &&
      row.lastOutboundMessageAt &&
      row.lastClientMessageAt > row.lastOutboundMessageAt
    ) {
      await prisma.crmDeal.update({
        where: { id: row.id },
        data: {
          caseStatus: "client_replied",
          stageId: replyStageId ?? row.stageId,
          nextAction: "Открыть диалог",
          nextActionAt: row.lastClientMessageAt,
          nextContactAt: row.lastClientMessageAt,
          snoozeUntil: null,
        },
      });
      await acknowledgeActiveReminders(row.id);
      await writeClientCaseEvent({
        caseId: row.id,
        eventType: "client_replied",
        title: "Клиент ответил",
        metadata: { automatic: true },
      });
      clientReplies += 1;
      continue;
    }

    if (currentStatus !== "calculation_sent") continue;
    const sentAt = row.lastOutboundMessageAt ?? row.nextActionAt ?? row.nextContactAt;
    const dueAt = row.nextActionAt ?? row.nextContactAt ?? (sentAt ? addHours(sentAt, 24) : null);
    if (!sentAt || !dueAt || dueAt > now) continue;
    if (row.lastClientMessageAt && row.lastClientMessageAt > sentAt) continue;

    await prisma.crmDeal.update({
      where: { id: row.id },
      data: {
        caseStatus: "check_response",
        stageId: checkStageId ?? row.stageId,
        nextAction: "Написать клиенту",
        nextActionAt: now,
        nextContactAt: now,
        snoozeUntil: null,
      },
    });
    await acknowledgeActiveReminders(row.id);
    await writeClientCaseEvent({
      caseId: row.id,
      eventType: "auto_check_response",
      title: "Автоматически переведено в «Проверить ответ»",
      metadata: { automatic: true, sentAt: sentAt.toISOString() },
    });
    checkedResponses += 1;
  }

  return { checkedResponses, clientReplies };
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
    if (input.direction === "outbound") {
      await prisma.crmDeal.update({
        where: { id: row.id },
        data: {
          lastOutboundMessageAt: at,
          caseStatus: currentStatus === "calculation_needed" ? "calculation_sent" : currentStatus,
          nextAction: currentStatus === "calculation_needed" ? "Проверить ответ клиента" : row.nextAction,
          nextActionAt: currentStatus === "calculation_needed" ? addHours(at, 24) : row.nextActionAt,
          nextContactAt: currentStatus === "calculation_needed" ? addHours(at, 24) : row.nextContactAt,
        },
      });
      continue;
    }

    await prisma.crmDeal.update({
      where: { id: row.id },
      data: {
        lastClientMessageAt: at,
        caseStatus: currentStatus === "calculation_sent" || currentStatus === "check_response" ? "client_replied" : currentStatus,
        nextAction: currentStatus === "calculation_sent" || currentStatus === "check_response" ? "Открыть диалог" : row.nextAction,
        nextActionAt: currentStatus === "calculation_sent" || currentStatus === "check_response" ? at : row.nextActionAt,
        nextContactAt: currentStatus === "calculation_sent" || currentStatus === "check_response" ? at : row.nextContactAt,
        snoozeUntil: null,
      },
    });
    await acknowledgeActiveReminders(row.id);
    await writeClientCaseEvent({
      caseId: row.id,
      eventType: "client_message",
      title: "Клиент ответил",
      note: input.text ?? null,
      metadata: { conversationId: input.conversationId },
    });
  }
}
