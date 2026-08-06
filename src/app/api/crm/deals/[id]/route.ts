import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { caseStatusFromStageName, defaultNextActionForCaseStatus, isClientCaseStatus } from "@/lib/client-case-shared";
import { writeClientCaseEvent } from "@/lib/client-case-workflow";
import { getCrmStageBySortOrder } from "@/lib/crm";
import { canAccessCrm } from "@/lib/crm-access";
import { notifyClientCaseTaskAssigned } from "@/lib/crm-deadline-notifications";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

type CounterpartyInput = { id?: unknown; name?: unknown; meta?: { href?: unknown } };
const CLIENT_TYPES = new Set(["new_lead", "regular", "repeat", "unlinked"]);
const CASE_TYPES = new Set(["calculation", "followup", "parts", "message", "shipment", "diagnostic", "manual"]);
const LEGACY_DEAL_SELECT = {
  id: true,
  title: true,
  customerName: true,
  phoneNormalized: true,
  vehicle: true,
  source: true,
  amountCents: true,
  stageId: true,
  responsibleLogin: true,
  counterpartyId: true,
  counterpartyHref: true,
  yclientsRecordId: true,
  shipmentId: true,
  nextContactAt: true,
  snoozeUntil: true,
  status: true,
  notes: true,
  createdByLogin: true,
  createdAt: true,
  updatedAt: true,
} as const;

function parseOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseAmountCents(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  const raw = parseOptionalString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultDeadline(hours = 1) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function parseClientType(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const raw = parseOptionalString(value);
  return raw && CLIENT_TYPES.has(raw) ? raw : null;
}

function parseCaseStatus(value: unknown, stageName?: string | null) {
  if (value === undefined) return undefined;
  return isClientCaseStatus(value) ? value : caseStatusFromStageName(stageName);
}

function parseCaseType(value: unknown) {
  if (value === undefined) return undefined;
  const raw = parseOptionalString(value);
  return raw && CASE_TYPES.has(raw) ? raw : null;
}

function parsePriority(value: unknown) {
  if (value === undefined) return undefined;
  const priority = typeof value === "number" ? value : Number(value);
  return Number.isFinite(priority) ? Math.max(0, Math.min(100, Math.round(priority))) : undefined;
}

function isClosedStageName(value: string) {
  const name = value.toLowerCase();
  return name.includes("закры") || name.includes("оплач") || name.includes("выиг") || name.includes("lost");
}

function parseCounterparty(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as CounterpartyInput;
  const id = parseOptionalString(input.id);
  const name = parseOptionalString(input.name);
  const href = parseOptionalString(input.meta?.href);
  if (!id || !name || !href) return null;
  return { id, name, href };
}

async function requireCrmAccess() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  if (!canAccessCrm(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return null;
}

function databaseHint(error: unknown) {
  const message = error instanceof Error ? error.message : "Внутренняя ошибка CRM";
  return NextResponse.json(
    {
      error: message,
      hint: "Проверьте DATABASE_URL и примените схему: `npm run db:push`, затем `npm run db:generate`.",
    },
    { status: 500 }
  );
}

function isMissingCrmCaseColumns(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("crm_deals.client_type") ||
    message.includes("crm_deals.next_action") ||
    message.includes("crm_deals.organization_id") ||
    message.includes("crm_deals.conversation_id") ||
    message.includes("crm_deals.appointment_id") ||
    message.includes("crm_deals.shipment_id") ||
    message.includes("crm_deals.precheck_id") ||
    message.includes("crm_deals.diagnostic_id") ||
    message.includes("crm_deals.procurement_id") ||
    message.includes("crm_deals.case_status") ||
    message.includes("crm_deals.case_type") ||
    message.includes("crm_deals.priority") ||
    message.includes("crm_deals.case_key") ||
    message.includes("crm_deals.next_action_at") ||
    message.includes("crm_deals.last_client_message_at") ||
    message.includes("crm_deals.last_outbound_message_at") ||
    message.includes("crm_deals.closed_at") ||
    message.includes("crm_deals.snooze_until") ||
    message.includes("crm_deals.supplies_note") ||
    message.includes("crm_deals.close_reason") ||
    (message.includes("column") && message.includes("does not exist") && message.includes("crm_deals"))
  );
}

function stripCaseUpdateFields(data: Record<string, unknown>) {
  const next = { ...data };
  delete next.clientType;
  delete next.nextAction;
  delete next.organizationId;
  delete next.conversationId;
  delete next.appointmentId;
  delete next.shipmentId;
  delete next.precheckId;
  delete next.diagnosticId;
  delete next.procurementId;
  delete next.caseStatus;
  delete next.caseType;
  delete next.priority;
  delete next.caseKey;
  delete next.nextActionAt;
  delete next.lastClientMessageAt;
  delete next.lastOutboundMessageAt;
  delete next.closedAt;
  delete next.snoozeUntil;
  delete next.suppliesNote;
  delete next.suppliesSupplier;
  delete next.suppliesExpectedAt;
  delete next.closeReason;
  return next;
}

function dealTaskTitle(deal: { title: string } & Record<string, unknown>) {
  return typeof deal.nextAction === "string" && deal.nextAction.trim() ? deal.nextAction : deal.title;
}

function caseStatusSortOrder(status: string) {
  if (status === "calculation_needed") return 10;
  if (status === "calculation_sent") return 20;
  if (status === "check_response") return 30;
  if (status === "client_replied") return 40;
  if (status === "waiting_parts") return 50;
  if (status === "parts_arrived") return 60;
  if (status === "postponed") return 70;
  if (status === "cancelled") return 80;
  if (status === "duplicate") return 90;
  if (status === "closed") return 100;
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const accessError = await requireCrmAccess();
  if (accessError) return accessError;
  const session = await getSession();

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    const current = await prisma.crmDeal.findUnique({
      where: { id },
      select: { id: true, responsibleLogin: true, stageId: true },
    });

    if (body.organizationId !== undefined) data.organizationId = parseOptionalString(body.organizationId);
    if (body.title !== undefined) data.title = parseOptionalString(body.title) ?? "Новое дело клиента";
    if (body.customerName !== undefined) data.customerName = parseOptionalString(body.customerName);
    if (body.phone !== undefined) data.phoneNormalized = normalizePhoneKey(parseOptionalString(body.phone));
    if (body.vehicle !== undefined) data.vehicle = parseOptionalString(body.vehicle);
    if (body.source !== undefined) data.source = parseOptionalString(body.source);
    if (body.amount !== undefined) data.amountCents = parseAmountCents(body.amount);
    if (body.clientType !== undefined) data.clientType = parseClientType(body.clientType);
    if (body.caseType !== undefined || body.type !== undefined) {
      const caseType = parseCaseType(body.caseType ?? body.type);
      if (caseType) data.caseType = caseType;
    }
    if (body.priority !== undefined) {
      const priority = parsePriority(body.priority);
      if (priority !== undefined) data.priority = priority;
    }
    if (body.caseKey !== undefined) data.caseKey = parseOptionalString(body.caseKey);
    if (body.conversationId !== undefined) data.conversationId = parseOptionalString(body.conversationId);
    if (body.appointmentId !== undefined) data.appointmentId = parseOptionalString(body.appointmentId);
    if (body.shipmentId !== undefined) data.shipmentId = parseOptionalString(body.shipmentId);
    if (body.precheckId !== undefined) data.precheckId = parseOptionalString(body.precheckId);
    if (body.diagnosticId !== undefined) data.diagnosticId = parseOptionalString(body.diagnosticId);
    if (body.procurementId !== undefined) data.procurementId = parseOptionalString(body.procurementId);
    if (body.nextAction !== undefined) data.nextAction = parseOptionalString(body.nextAction);
    if (body.responsibleLogin !== undefined) data.responsibleLogin = parseOptionalString(body.responsibleLogin);
    if (body.legacyCounterparty !== undefined) {
      const counterparty = parseCounterparty(body.legacyCounterparty);
      data.counterpartyId = counterparty?.id ?? null;
      data.customerName = counterparty?.name ?? null;
      data.counterpartyHref = counterparty?.href ?? null;
    }
    const nextYclientsRecordId = body.yclientsRecordId !== undefined ? parseOptionalString(body.yclientsRecordId) : undefined;
    const nextLegacyDemandId = body.shipmentId !== undefined ? parseOptionalString(body.shipmentId) : undefined;
    if (body.yclientsRecordId !== undefined) data.yclientsRecordId = nextYclientsRecordId;
    if (body.shipmentId !== undefined) data.shipmentId = nextLegacyDemandId;
    if (body.yclientsRecordId !== undefined) data.appointmentId = nextYclientsRecordId;
    if (body.shipmentId !== undefined) data.shipmentId = nextLegacyDemandId;
    if (body.suppliesNote !== undefined) data.suppliesNote = parseOptionalString(body.suppliesNote);
    if (body.suppliesSupplier !== undefined) data.suppliesSupplier = parseOptionalString(body.suppliesSupplier);
    if (body.suppliesExpectedAt !== undefined) data.suppliesExpectedAt = parseDate(body.suppliesExpectedAt);
    if (body.nextActionAt !== undefined) data.nextActionAt = parseDate(body.nextActionAt);
    if (body.nextContactAt !== undefined) data.nextContactAt = parseDate(body.nextContactAt);
    if (body.nextActionAt === undefined && body.nextContactAt !== undefined) data.nextActionAt = data.nextContactAt;
    if (body.nextContactAt === undefined && body.nextActionAt !== undefined) data.nextContactAt = data.nextActionAt;
    if (body.snoozeUntil !== undefined) data.snoozeUntil = parseDate(body.snoozeUntil);
    if (body.lastClientMessageAt !== undefined) data.lastClientMessageAt = parseDate(body.lastClientMessageAt);
    if (body.lastOutboundMessageAt !== undefined) data.lastOutboundMessageAt = parseDate(body.lastOutboundMessageAt);
    if (body.closeReason !== undefined) data.closeReason = parseOptionalString(body.closeReason);
    if (body.notes !== undefined) data.notes = parseOptionalString(body.notes);
    if (body.status !== undefined) {
      const status = parseOptionalString(body.status);
      if (status && ["open", "won", "lost"].includes(status)) {
        data.status = status;
        if (status !== "open") data.closedAt = new Date();
      }
    }
    if (body.stageId !== undefined) {
      const stageId = parseOptionalString(body.stageId);
      if (!stageId) return NextResponse.json({ error: "stageId не задан" }, { status: 400 });
      const stage = await prisma.crmStage.findUnique({ where: { id: stageId } });
      if (!stage) return NextResponse.json({ error: "Стадия не найдена" }, { status: 404 });
      data.stageId = stageId;
      if (body.caseStatus === undefined) data.caseStatus = caseStatusFromStageName(stage.name);
      if (body.status === undefined) data.status = isClosedStageName(stage.name) ? "won" : "open";
    }
    const explicitCaseStatus = parseCaseStatus(body.caseStatus, null);
    if (explicitCaseStatus) {
      data.caseStatus = explicitCaseStatus;
      const sortOrder = caseStatusSortOrder(explicitCaseStatus);
      if (body.stageId === undefined && sortOrder) {
        const stage = await getCrmStageBySortOrder(sortOrder);
        if (stage) data.stageId = stage.id;
      }
      if (data.nextAction === undefined) data.nextAction = defaultNextActionForCaseStatus(explicitCaseStatus);
      if (explicitCaseStatus === "closed" || explicitCaseStatus === "cancelled" || explicitCaseStatus === "duplicate") {
        data.status = explicitCaseStatus === "closed" ? "won" : "lost";
        data.closedAt = new Date();
        data.snoozeUntil = null;
      } else if (body.status === undefined) {
        data.status = "open";
      }
    }

    if (data.stageId || data.caseStatus) {
      const stage = data.stageId ? await prisma.crmStage.findUnique({ where: { id: String(data.stageId) } }) : null;
      const caseStatus = typeof data.caseStatus === "string" ? data.caseStatus : caseStatusFromStageName(stage?.name);
      if (caseStatus === "calculation_sent" && data.nextContactAt == null) {
        const due = defaultDeadline(24);
        data.nextContactAt = due;
        data.nextActionAt = due;
        if (data.lastOutboundMessageAt === undefined) data.lastOutboundMessageAt = new Date();
      }
      if (caseStatus === "waiting_parts" && data.suppliesExpectedAt == null) {
        data.suppliesExpectedAt = defaultDeadline(24);
      }
    }

    let updated;
    try {
      updated = await prisma.crmDeal.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (!isMissingCrmCaseColumns(error)) throw error;
      const legacyData = stripCaseUpdateFields(data);
      updated =
        Object.keys(legacyData).length > 0
          ? await prisma.crmDeal.update({
              where: { id },
              data: legacyData,
              select: LEGACY_DEAL_SELECT,
            })
          : await prisma.crmDeal.findUnique({
              where: { id },
              select: LEGACY_DEAL_SELECT,
            });
    }

    const nextResponsible = typeof updated?.responsibleLogin === "string" ? updated.responsibleLogin : null;
    if (updated && body.responsibleLogin !== undefined && nextResponsible && nextResponsible !== current?.responsibleLogin) {
      try {
        await notifyClientCaseTaskAssigned({
          caseId: updated.id,
          employeeId: nextResponsible,
          taskTitle: dealTaskTitle(updated),
          dueAt: updated.nextContactAt,
        });
      } catch (error) {
        console.warn("[crm/deals PATCH] telegram task notification failed", error);
      }
    }

    if (updated) {
      await writeClientCaseEvent({
        caseId: updated.id,
        actorLogin: session?.user.login ?? null,
        eventType: "case_updated",
        title: "Дело обновлено",
        metadata: {
          stageChanged: Boolean(data.stageId && data.stageId !== current?.stageId),
          status: typeof data.caseStatus === "string" ? data.caseStatus : null,
        },
      }).catch((error) => console.warn("[crm/deals PATCH] client case event failed", error));
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[crm/deals PATCH]", error);
    return databaseHint(error);
  }
}
