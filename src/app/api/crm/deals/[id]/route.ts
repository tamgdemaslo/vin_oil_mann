import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCrmStageBySortOrder } from "@/lib/crm";
import { canAccessCrm } from "@/lib/crm-access";
import { notifyClientCaseTaskAssigned } from "@/lib/crm-deadline-notifications";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

type CounterpartyInput = { id?: unknown; name?: unknown; meta?: { href?: unknown } };
const CLIENT_TYPES = new Set(["new_lead", "regular", "repeat", "unlinked"]);
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
  moyskladCounterpartyId: true,
  moyskladCounterpartyName: true,
  moyskladCounterpartyHref: true,
  yclientsRecordId: true,
  moyskladDemandId: true,
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const accessError = await requireCrmAccess();
  if (accessError) return accessError;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    const current = await prisma.crmDeal.findUnique({
      where: { id },
      select: { id: true, responsibleLogin: true },
    });

    if (body.title !== undefined) data.title = parseOptionalString(body.title) ?? "Новое дело клиента";
    if (body.customerName !== undefined) data.customerName = parseOptionalString(body.customerName);
    if (body.phone !== undefined) data.phoneNormalized = normalizePhoneKey(parseOptionalString(body.phone));
    if (body.vehicle !== undefined) data.vehicle = parseOptionalString(body.vehicle);
    if (body.source !== undefined) data.source = parseOptionalString(body.source);
    if (body.amount !== undefined) data.amountCents = parseAmountCents(body.amount);
    if (body.clientType !== undefined) data.clientType = parseClientType(body.clientType);
    if (body.nextAction !== undefined) data.nextAction = parseOptionalString(body.nextAction);
    if (body.responsibleLogin !== undefined) data.responsibleLogin = parseOptionalString(body.responsibleLogin);
    if (body.moyskladCounterparty !== undefined) {
      const counterparty = parseCounterparty(body.moyskladCounterparty);
      data.moyskladCounterpartyId = counterparty?.id ?? null;
      data.moyskladCounterpartyName = counterparty?.name ?? null;
      data.moyskladCounterpartyHref = counterparty?.href ?? null;
    }
    const nextYclientsRecordId = body.yclientsRecordId !== undefined ? parseOptionalString(body.yclientsRecordId) : undefined;
    const nextMoyskladDemandId = body.moyskladDemandId !== undefined ? parseOptionalString(body.moyskladDemandId) : undefined;
    if (body.yclientsRecordId !== undefined) data.yclientsRecordId = nextYclientsRecordId;
    if (body.moyskladDemandId !== undefined) data.moyskladDemandId = nextMoyskladDemandId;
    if (body.suppliesNote !== undefined) data.suppliesNote = parseOptionalString(body.suppliesNote);
    if (body.suppliesSupplier !== undefined) data.suppliesSupplier = parseOptionalString(body.suppliesSupplier);
    if (body.suppliesExpectedAt !== undefined) data.suppliesExpectedAt = parseDate(body.suppliesExpectedAt);
    if (body.nextContactAt !== undefined) data.nextContactAt = parseDate(body.nextContactAt);
    if (body.snoozeUntil !== undefined) data.snoozeUntil = parseDate(body.snoozeUntil);
    if (body.closeReason !== undefined) data.closeReason = parseOptionalString(body.closeReason);
    if (body.notes !== undefined) data.notes = parseOptionalString(body.notes);
    if (body.status !== undefined) {
      const status = parseOptionalString(body.status);
      if (status && ["open", "won", "lost"].includes(status)) data.status = status;
    }
    if (body.stageId !== undefined) {
      const stageId = parseOptionalString(body.stageId);
      if (!stageId) return NextResponse.json({ error: "stageId не задан" }, { status: 400 });
      const stage = await prisma.crmStage.findUnique({ where: { id: stageId } });
      if (!stage) return NextResponse.json({ error: "Стадия не найдена" }, { status: 404 });
      data.stageId = stageId;
      if (body.status === undefined) data.status = isClosedStageName(stage.name) ? "won" : "open";
    }
    if (body.stageId === undefined && nextMoyskladDemandId) {
      const visitStage = await getCrmStageBySortOrder(80);
      if (visitStage) data.stageId = visitStage.id;
    } else if (body.stageId === undefined && nextYclientsRecordId) {
      const recordStage = await getCrmStageBySortOrder(70);
      if (recordStage) data.stageId = recordStage.id;
    }

    if (data.stageId) {
      const stage = await prisma.crmStage.findUnique({ where: { id: String(data.stageId) } });
      const stageName = stage?.name.toLowerCase() ?? "";
      if (stageName.includes("расчёт отправлен") && data.nextContactAt == null) data.nextContactAt = defaultDeadline(1);
      if (stageName.includes("ждём расходники") && data.suppliesExpectedAt == null) {
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

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[crm/deals PATCH]", error);
    return databaseHint(error);
  }
}
