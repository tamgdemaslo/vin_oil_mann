import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDefaultCrmStages, getCrmStageBySortOrder, getFirstCrmStage } from "@/lib/crm";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

type Meta = { href: string; type: string; mediaType: string };
type CounterpartyInput = { id?: unknown; name?: unknown; meta?: { href?: unknown; type?: unknown; mediaType?: unknown } };
type CounterpartyLink = { id: string; name: string; meta: Meta };
const CLIENT_TYPES = new Set(["new_lead", "regular", "repeat", "unlinked"]);
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
  delete legacyData.snoozeUntil;
  delete legacyData.suppliesNote;
  delete legacyData.suppliesSupplier;
  delete legacyData.suppliesExpectedAt;
  delete legacyData.closeReason;
  return legacyData as CrmDealCreateData;
}

async function loadStagesWithDeals() {
  return prisma.crmStage.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      deals: {
        orderBy: [{ nextContactAt: "asc" }, { updatedAt: "desc" }],
      },
    },
  });
}

async function loadStagesWithLegacyDeals(): Promise<CrmStageWithDeals> {
  const stages = await prisma.crmStage.findMany({ orderBy: { sortOrder: "asc" } });
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

  try {
    await ensureDefaultCrmStages();
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
}

export async function POST(request: NextRequest) {
  const access = await requireCrmSession();
  if (access.response) return access.response;
  const session = access.session!;

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
    const linkedStage =
      moyskladDemandId
        ? await getCrmStageBySortOrder(80)
        : yclientsRecordId
          ? await getCrmStageBySortOrder(70)
          : null;
    const stageId = requestedStageId ?? linkedStage?.id ?? firstStage.id;
    const stage = await prisma.crmStage.findUnique({ where: { id: stageId } });
    const stageName = stage?.name.toLowerCase() ?? "";
    const parsedNextContactAt = parseDate(body.nextContactAt);
    const nextContactAt = stageName.includes("расчёт отправлен") && !parsedNextContactAt ? defaultDeadline(1) : parsedNextContactAt;
    const parsedSuppliesExpectedAt = parseDate(body.suppliesExpectedAt);
    const suppliesExpectedAt = stageName.includes("ждём расходники") && !parsedSuppliesExpectedAt ? defaultDeadline(24) : parsedSuppliesExpectedAt;

    const createData: CrmDealCreateData = {
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
      suppliesNote: parseOptionalString(body.suppliesNote),
      suppliesSupplier: parseOptionalString(body.suppliesSupplier),
      suppliesExpectedAt,
      nextContactAt,
      notes: parseOptionalString(body.notes),
      createdByLogin: session.user.login,
    };

    let created;
    try {
      created = await prisma.crmDeal.create({ data: createData });
    } catch (error) {
      if (!isMissingCrmCaseColumns(error)) throw error;
      created = await prisma.crmDeal.create({ data: stripCaseFields(createData), select: LEGACY_DEAL_SELECT });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("[crm/deals POST]", error);
    return databaseHint(error);
  }
}
