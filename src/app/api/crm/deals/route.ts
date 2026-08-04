import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { caseStatusFromStageName, defaultNextActionForCaseStatus, isClientCaseStatus } from "@/lib/client-case-shared";
import { processClientCaseWorkflowTransitions, writeClientCaseEvent } from "@/lib/client-case-workflow";
import { ensureDefaultCrmStages, getFirstCrmStage } from "@/lib/crm";
import { canAccessCrm } from "@/lib/crm-access";
import { notifyClientCaseTaskAssigned } from "@/lib/crm-deadline-notifications";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";

type Meta = { href: string; type: string; mediaType: string };
type CounterpartyInput = { id?: unknown; name?: unknown; meta?: { href?: unknown; type?: unknown; mediaType?: unknown } };
type CounterpartyLink = { id: string; name: string; meta: Meta };
const CLIENT_TYPES = new Set(["new_lead", "regular", "repeat", "unlinked"]);
const CASE_TYPES = new Set(["calculation", "followup", "parts", "message", "shipment", "diagnostic", "manual"]);
type CrmDealCreateData = Parameters<typeof prisma.crmDeal.create>[0]["data"];
type CrmStageWithDeals = Awaited<ReturnType<typeof loadStagesWithDeals>>;
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

async function requireCrmSession() {
  const session = await getSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  }
  if (!canAccessCrm(session.user.role)) {
    return { session: null, response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  }
  return { session, response: null };
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseAmountCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function parseDate(value: unknown): Date | null {
  const raw = parseOptionalString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultDeadline(hours = 1) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function parseClientType(value: unknown): string | null {
  const raw = parseOptionalString(value);
  return raw && CLIENT_TYPES.has(raw) ? raw : null;
}

function parseCaseStatus(value: unknown, stageName?: string | null) {
  return isClientCaseStatus(value) ? value : caseStatusFromStageName(stageName);
}

function parseCaseType(value: unknown) {
  const raw = parseOptionalString(value);
  return raw && CASE_TYPES.has(raw) ? raw : "manual";
}

function parsePriority(value: unknown) {
  const priority = typeof value === "number" ? value : Number(value);
  return Number.isFinite(priority) ? Math.max(0, Math.min(100, Math.round(priority))) : 50;
}

function parseCounterparty(value: unknown): CounterpartyLink | null {
  if (!value || typeof value !== "object") return null;
  const input = value as CounterpartyInput;
  const id = parseOptionalString(input.id);
  const name = parseOptionalString(input.name);
  const href = parseOptionalString(input.meta?.href);
  const type = parseOptionalString(input.meta?.type) ?? "counterparty";
  const mediaType = parseOptionalString(input.meta?.mediaType) ?? "application/json";
  if (!id || !name || !href) return null;
  return { id, name, meta: { href, type, mediaType } };
}

async function createLocalCounterpartyForDeal(body: Record<string, unknown>): Promise<CounterpartyLink | { error: string }> {
  const name =
    parseOptionalString(body.moyskladCounterpartyName) ??
    parseOptionalString(body.customerName) ??
    parseOptionalString(body.title);
  if (!name) return { error: "Укажите имя клиента для сохранения в локальной CRM" };
  const phone = parseOptionalString(body.phone);
  const normalizedPhone = normalizePhoneKey(phone);

  if (normalizedPhone) {
    const existing = await prisma.localCounterparty.findFirst({
      where: { archived: false, normalizedPhone },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (existing) {
      const updateData: Record<string, unknown> = {};
      if (!existing.phone && phone) updateData.phone = phone;
      if (!existing.normalizedPhone) updateData.normalizedPhone = normalizedPhone;
      if (!existing.phonesRaw && phone) updateData.phonesRaw = [phone];
      if (!existing.searchText.includes(normalizedPhone)) {
        updateData.searchText = [existing.searchText, phone, normalizedPhone].filter(Boolean).join(" ").toLowerCase();
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.localCounterparty.update({ where: { id: existing.id }, data: updateData });
      }
      return {
        id: existing.id,
        name: existing.name,
        meta: { href: `local://counterparty/${existing.id}`, type: "counterparty", mediaType: "application/json" },
      };
    }
  }

  const created = await prisma.localCounterparty.create({
    data: {
      name,
      companyType: "individual",
      phone: phone ?? null,
      normalizedPhone,
      phonesRaw: phone ? [phone] : undefined,
      searchText: [name, phone].filter(Boolean).join(" ").toLowerCase(),
      raw: { source: "crm-local", withoutPhone: !phone },
    },
  });
  return {
    id: created.id,
    name: created.name,
    meta: { href: `local://counterparty/${created.id}`, type: "counterparty", mediaType: "application/json" },
  };
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

function stripCaseFields(data: CrmDealCreateData): CrmDealCreateData {
  const legacyData = { ...(data as CrmDealCreateData & Record<string, unknown>) };
  delete legacyData.clientType;
  delete legacyData.nextAction;
  delete legacyData.organizationId;
  delete legacyData.conversationId;
  delete legacyData.appointmentId;
  delete legacyData.shipmentId;
  delete legacyData.precheckId;
  delete legacyData.diagnosticId;
  delete legacyData.procurementId;
  delete legacyData.caseStatus;
  delete legacyData.caseType;
  delete legacyData.priority;
  delete legacyData.caseKey;
  delete legacyData.nextActionAt;
  delete legacyData.lastClientMessageAt;
  delete legacyData.lastOutboundMessageAt;
  delete legacyData.closedAt;
  delete legacyData.snoozeUntil;
  delete legacyData.suppliesNote;
  delete legacyData.suppliesSupplier;
  delete legacyData.suppliesExpectedAt;
  delete legacyData.closeReason;
  return legacyData as CrmDealCreateData;
}

function dealTaskTitle(deal: { title: string } & Record<string, unknown>) {
  return typeof deal.nextAction === "string" && deal.nextAction.trim() ? deal.nextAction : deal.title;
}

async function loadStagesWithDeals() {
  const { branchId } = requireSingleBranchSqlContext();
  return prisma.crmStage.findMany({
    where: { branchId },
    orderBy: { sortOrder: "asc" },
    include: {
      deals: {
        orderBy: [{ nextActionAt: "asc" }, { nextContactAt: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
      },
    },
  });
}

async function loadStagesWithLegacyDeals(): Promise<CrmStageWithDeals> {
  const { branchId } = requireSingleBranchSqlContext();
  const stages = await prisma.crmStage.findMany({ where: { branchId }, orderBy: { sortOrder: "asc" } });
  const deals = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      id,
      title,
      customer_name AS "customerName",
      phone_normalized AS "phoneNormalized",
      vehicle,
      source,
      amount_cents AS "amountCents",
      NULL::text AS "clientType",
      NULL::text AS "nextAction",
      stage_id AS "stageId",
      responsible_login AS "responsibleLogin",
      moysklad_counterparty_id AS "moyskladCounterpartyId",
      moysklad_counterparty_name AS "moyskladCounterpartyName",
      moysklad_counterparty_href AS "moyskladCounterpartyHref",
      yclients_record_id AS "yclientsRecordId",
      moysklad_demand_id AS "moyskladDemandId",
      NULL::text AS "suppliesNote",
      NULL::text AS "suppliesSupplier",
      NULL::timestamp AS "suppliesExpectedAt",
      next_contact_at AS "nextContactAt",
      NULL::timestamp AS "snoozeUntil",
      status,
      NULL::text AS "closeReason",
      notes,
      created_by_login AS "createdByLogin",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM crm_deals
    WHERE branch_id = ${branchId}
    ORDER BY next_contact_at ASC NULLS LAST, updated_at DESC
  `;
  const dealsByStage = new Map<string, Array<Record<string, unknown>>>();
  for (const deal of deals) {
    const stageId = typeof deal.stageId === "string" ? deal.stageId : "";
    dealsByStage.set(stageId, [...(dealsByStage.get(stageId) ?? []), deal]);
  }
  return stages.map((stage) => ({ ...stage, deals: (dealsByStage.get(stage.id) ?? []) as never[] })) as CrmStageWithDeals;
}

export async function GET() {
  const access = await requireCrmSession();
  if (access.response) return access.response;
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    try {
      await ensureDefaultCrmStages();
      try {
        await processClientCaseWorkflowTransitions();
      } catch (error) {
        if (!isMissingCrmCaseColumns(error)) throw error;
      }
      let stages: CrmStageWithDeals;
      try {
        stages = await loadStagesWithDeals();
      } catch (error) {
        if (!isMissingCrmCaseColumns(error)) throw error;
        stages = await loadStagesWithLegacyDeals();
      }

      return NextResponse.json({ stages });
    } catch (error) {
      console.error("[crm/deals GET]", error);
      return databaseHint(error);
    }
  });
}

export async function POST(request: NextRequest) {
  const access = await requireCrmSession();
  if (access.response) return access.response;
  const session = access.session!;
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    try {
    const body = await request.json().catch(() => ({}));
    const title = parseOptionalString(body.title);
    const customerName = parseOptionalString(body.customerName);
    const phoneNormalized = normalizePhoneKey(parseOptionalString(body.phone));
    const clientType = parseClientType(body.clientType);
    const firstStage = await getFirstCrmStage();
    let counterparty = parseCounterparty(body.moyskladCounterparty);
    const yclientsRecordId = parseOptionalString(body.yclientsRecordId);
    const moyskladDemandId = parseOptionalString(body.moyskladDemandId);

    if (yclientsRecordId && body.forceNew !== true) {
      const existing = await prisma.crmDeal.findFirst({
        where: { yclientsRecordId, status: "open" },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (existing) {
        return NextResponse.json({ ...existing, alreadyExists: true });
      }
    }

    if (!counterparty && (body.createMoyskladCounterparty === true || body.createLocalClient === true)) {
      const createdCounterparty = await createLocalCounterpartyForDeal(body as Record<string, unknown>);
      if ("error" in createdCounterparty) {
        return NextResponse.json({ error: createdCounterparty.error }, { status: 502 });
      }
      counterparty = createdCounterparty;
    }

    if (!firstStage) {
      return NextResponse.json({ error: "Не найдены стадии CRM" }, { status: 500 });
    }
    if (!title && !customerName && !phoneNormalized) {
      return NextResponse.json({ error: "Укажите название, клиента или телефон сделки" }, { status: 400 });
    }

    const requestedStageId = parseOptionalString(body.stageId);
    const stageId = requestedStageId ?? firstStage.id;
    const stage = await prisma.crmStage.findUnique({ where: { id: stageId } });
    const caseStatus = parseCaseStatus(body.caseStatus, stage?.name);
    const parsedNextActionAt = parseDate(body.nextActionAt);
    const parsedNextContactAt = parseDate(body.nextContactAt);
    const defaultActionAt = caseStatus === "calculation_sent" ? defaultDeadline(24) : null;
    const nextActionAt = parsedNextActionAt ?? parsedNextContactAt ?? defaultActionAt;
    const nextContactAt = parsedNextContactAt ?? nextActionAt;
    const parsedSuppliesExpectedAt = parseDate(body.suppliesExpectedAt);
    const suppliesExpectedAt = caseStatus === "waiting_parts" && !parsedSuppliesExpectedAt ? defaultDeadline(24) : parsedSuppliesExpectedAt;
    const caseType = parseCaseType(body.type ?? body.caseType ?? (body.conversationId ? "message" : moyskladDemandId ? "shipment" : "manual"));
    const lastOutboundMessageAt = parseDate(body.lastOutboundMessageAt) ?? (caseStatus === "calculation_sent" ? new Date() : null);
    const lastClientMessageAt = parseDate(body.lastClientMessageAt) ?? null;

    const createData: CrmDealCreateData = {
      organizationId: parseOptionalString(body.organizationId),
      title: title ?? customerName ?? counterparty?.name ?? phoneNormalized ?? "Новое дело клиента",
      customerName: customerName ?? counterparty?.name ?? null,
      phoneNormalized,
      vehicle: parseOptionalString(body.vehicle),
      source: parseOptionalString(body.source),
      amountCents: parseAmountCents(body.amount),
      clientType: clientType ?? (counterparty ? "regular" : phoneNormalized || customerName ? "new_lead" : "unlinked"),
      nextAction: parseOptionalString(body.nextAction),
      stageId,
      responsibleLogin: parseOptionalString(body.responsibleLogin) ?? session.user.login,
      moyskladCounterpartyId: counterparty?.id ?? null,
      moyskladCounterpartyName: counterparty?.name ?? null,
      moyskladCounterpartyHref: counterparty?.meta.href ?? null,
      yclientsRecordId,
      moyskladDemandId,
      conversationId: parseOptionalString(body.conversationId),
      appointmentId: parseOptionalString(body.appointmentId) ?? yclientsRecordId,
      shipmentId: parseOptionalString(body.shipmentId) ?? moyskladDemandId,
      precheckId: parseOptionalString(body.precheckId),
      diagnosticId: parseOptionalString(body.diagnosticId),
      procurementId: parseOptionalString(body.procurementId),
      caseStatus,
      caseType,
      priority: parsePriority(body.priority),
      caseKey: parseOptionalString(body.caseKey),
      suppliesNote: parseOptionalString(body.suppliesNote),
      suppliesSupplier: parseOptionalString(body.suppliesSupplier),
      suppliesExpectedAt,
      nextActionAt,
      nextContactAt,
      lastClientMessageAt,
      lastOutboundMessageAt,
      notes: parseOptionalString(body.notes),
      createdByLogin: session.user.login,
    };
    if (!createData.nextAction) {
      createData.nextAction = defaultNextActionForCaseStatus(caseStatus);
    }

    let created;
    try {
      created = await prisma.crmDeal.create({ data: createData });
    } catch (error) {
      if (!isMissingCrmCaseColumns(error)) throw error;
      created = await prisma.crmDeal.create({ data: stripCaseFields(createData), select: LEGACY_DEAL_SELECT });
    }

    if (created.responsibleLogin) {
      try {
        await notifyClientCaseTaskAssigned({
          caseId: created.id,
          employeeId: created.responsibleLogin,
          taskTitle: dealTaskTitle(created),
          dueAt: created.nextContactAt,
        });
      } catch (error) {
        console.warn("[crm/deals POST] telegram task notification failed", error);
      }
    }

    await writeClientCaseEvent({
      caseId: created.id,
      actorLogin: session.user.login,
      eventType: "case_created",
      title: "Дело создано",
      metadata: { status: caseStatus, source: createData.source ?? null },
    }).catch((error) => console.warn("[crm/deals POST] client case event failed", error));

    return NextResponse.json(created, { status: 201 });
    } catch (error) {
      console.error("[crm/deals POST]", error);
      return databaseHint(error);
    }
  });
}
