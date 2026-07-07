import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clientCaseStatusLabel, defaultNextActionForCaseStatus, isClientCaseClosedStatus, isClientCaseStatus, normalizeClientCaseStatus } from "@/lib/client-case-shared";
import { processClientCaseWorkflowTransitions, writeClientCaseEvent } from "@/lib/client-case-workflow";
import { ensureDefaultCrmStages, getCrmStageBySortOrder, getFirstCrmStage } from "@/lib/crm";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

const CASE_TYPES = new Set(["calculation", "followup", "parts", "message", "shipment", "diagnostic", "manual"]);

async function requireCrmSession() {
  const session = await getSession();
  if (!session) return { session: null, response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (!canAccessCrm(session.user.role)) return { session: null, response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { session, response: null };
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function date(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function amountCents(value: unknown) {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function priority(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 50;
}

function caseType(value: unknown) {
  const raw = text(value);
  return raw && CASE_TYPES.has(raw) ? raw : "manual";
}

function clientCaseWhere(searchParams: URLSearchParams) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const status = text(searchParams.get("status"));
  const responsibleUserId = text(searchParams.get("responsibleUserId"));
  const clientId = text(searchParams.get("clientId"));
  const conversationId = text(searchParams.get("conversationId"));
  const query = text(searchParams.get("q"));
  const closed = status === "closed" || searchParams.get("closed") === "1";
  const where: Record<string, unknown> = {};

  if (status && isClientCaseStatus(status)) where.caseStatus = status;
  if (!closed && !status) {
    where.status = "open";
    where.caseStatus = { notIn: ["closed", "cancelled", "duplicate"] };
    where.OR = [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }];
  }
  if (responsibleUserId) where.responsibleLogin = responsibleUserId;
  if (clientId) where.moyskladCounterpartyId = clientId;
  if (conversationId) where.conversationId = conversationId;
  if (searchParams.get("overdue") === "1") {
    where.status = "open";
    where.OR = [
      { nextActionAt: { lt: now } },
      { nextActionAt: null, nextContactAt: { lt: now } },
    ];
  }
  if (searchParams.get("today") === "1") {
    where.status = "open";
    where.OR = [
      { nextActionAt: { gte: todayStart, lt: tomorrowStart } },
      { nextActionAt: null, nextContactAt: { gte: todayStart, lt: tomorrowStart } },
    ];
  }
  if (query) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { customerName: { contains: query, mode: "insensitive" } },
          { phoneNormalized: { contains: query } },
          { vehicle: { contains: query, mode: "insensitive" } },
          { nextAction: { contains: query, mode: "insensitive" } },
          { notes: { contains: query, mode: "insensitive" } },
        ],
      },
    ];
  }
  return where;
}

export async function GET(request: NextRequest) {
  const access = await requireCrmSession();
  if (access.response) return access.response;

  try {
    await ensureDefaultCrmStages();
    await processClientCaseWorkflowTransitions();
    const cases = await prisma.crmDeal.findMany({
      where: clientCaseWhere(request.nextUrl.searchParams),
      include: { stage: true, events: { orderBy: { createdAt: "desc" }, take: 3 } },
      orderBy: [{ nextActionAt: "asc" }, { nextContactAt: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
      take: Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 100), 1), 300),
    });
    return NextResponse.json({
      cases: cases.map((item) => ({
        ...item,
        caseStatus: normalizeClientCaseStatus(item.caseStatus, item.stage?.name),
        statusLabel: clientCaseStatusLabel(item.caseStatus, item.stage?.name),
        active: item.status === "open" && !isClientCaseClosedStatus(item.caseStatus, item.stage?.name),
      })),
    });
  } catch (error) {
    console.error("[client-cases GET]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить дела клиентов" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireCrmSession();
  if (access.response) return access.response;
  const session = access.session!;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await ensureDefaultCrmStages();
    const requestedStatus = isClientCaseStatus(body.status) ? body.status : isClientCaseStatus(body.caseStatus) ? body.caseStatus : "calculation_needed";
    const stage = (await getCrmStageBySortOrder(requestedStatus === "calculation_sent" ? 20 : requestedStatus === "check_response" ? 30 : requestedStatus === "waiting_parts" ? 50 : 10)) ?? (await getFirstCrmStage());
    if (!stage) return NextResponse.json({ error: "Не найдены стадии CRM" }, { status: 500 });
    const caseKey = text(body.caseKey);
    if (caseKey) {
      const existing = await prisma.crmDeal.findFirst({ where: { caseKey, status: "open" }, orderBy: { updatedAt: "desc" } });
      if (existing) {
        const updated = await prisma.crmDeal.update({
          where: { id: existing.id },
          data: {
            title: text(body.title) ?? existing.title,
            nextAction: text(body.nextAction) ?? existing.nextAction,
            nextActionAt: date(body.nextActionAt) ?? existing.nextActionAt,
            nextContactAt: date(body.nextActionAt) ?? date(body.nextContactAt) ?? existing.nextContactAt,
            updatedAt: new Date(),
          },
        });
        await writeClientCaseEvent({ caseId: updated.id, actorLogin: session.user.login, eventType: "case_deduped", title: "Дело обновлено по ключу дедупликации" });
        return NextResponse.json({ case: updated, alreadyExists: true });
      }
    }

    const due = date(body.nextActionAt) ?? date(body.nextContactAt) ?? (requestedStatus === "calculation_sent" ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null);
    const created = await prisma.crmDeal.create({
      data: {
        organizationId: text(body.organizationId),
        title: text(body.title) ?? text(body.description) ?? "Новое дело клиента",
        customerName: text(body.customerName),
        phoneNormalized: normalizePhoneKey(text(body.phone) ?? text(body.phoneNormalized)),
        vehicle: text(body.vehicle),
        source: text(body.source) ?? "client-cases-api",
        amountCents: amountCents(body.amount),
        clientType: text(body.clientType) ?? "new_lead",
        nextAction: text(body.nextAction) ?? defaultNextActionForCaseStatus(requestedStatus),
        stageId: stage.id,
        responsibleLogin: text(body.responsibleUserId) ?? text(body.responsibleLogin) ?? session.user.login,
        moyskladCounterpartyId: text(body.clientId) ?? text(body.counterpartyId),
        moyskladCounterpartyName: text(body.customerName),
        yclientsRecordId: text(body.appointmentId),
        moyskladDemandId: text(body.shipmentId),
        conversationId: text(body.conversationId),
        appointmentId: text(body.appointmentId),
        shipmentId: text(body.shipmentId),
        precheckId: text(body.precheckId),
        diagnosticId: text(body.diagnosticId),
        procurementId: text(body.procurementId),
        caseStatus: requestedStatus,
        caseType: caseType(body.type ?? body.caseType),
        priority: priority(body.priority),
        caseKey,
        nextActionAt: due,
        nextContactAt: due,
        lastClientMessageAt: date(body.lastClientMessageAt),
        lastOutboundMessageAt: date(body.lastOutboundMessageAt) ?? (requestedStatus === "calculation_sent" ? new Date() : null),
        notes: text(body.description) ?? text(body.notes),
        createdByLogin: session.user.login,
      },
    });
    await writeClientCaseEvent({ caseId: created.id, actorLogin: session.user.login, eventType: "case_created", title: "Дело создано" });
    return NextResponse.json({ case: created }, { status: 201 });
  } catch (error) {
    console.error("[client-cases POST]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать дело клиента" }, { status: 500 });
  }
}
