import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureDefaultCrmStages, getFirstCrmStage } from "@/lib/crm";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";
import { moyskladFetch } from "@/lib/moysklad";
import { normalizePhoneKey } from "@/lib/phone-normalize";

type Meta = { href: string; type: string; mediaType: string };
type CounterpartyInput = { id?: unknown; name?: unknown; meta?: { href?: unknown; type?: unknown; mediaType?: unknown } };
type CounterpartyLink = { id: string; name: string; meta: Meta };

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

async function createMoyskladCounterparty(body: Record<string, unknown>): Promise<CounterpartyLink | { error: string }> {
  const name =
    parseOptionalString(body.moyskladCounterpartyName) ??
    parseOptionalString(body.customerName) ??
    parseOptionalString(body.title);
  if (!name) return { error: "Укажите имя клиента для создания контрагента в МойСклад" };

  const payload: Record<string, string> = {
    name,
    companyType: "individual",
  };
  const phone = parseOptionalString(body.phone);
  if (phone) payload.phone = phone;

  const result = await moyskladFetch<CounterpartyLink>("/entity/counterparty", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!result.ok) return { error: result.error };
  return {
    id: result.data.id,
    name: result.data.name,
    meta: result.data.meta,
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

export async function GET() {
  const access = await requireCrmSession();
  if (access.response) return access.response;

  try {
    await ensureDefaultCrmStages();
    const stages = await prisma.crmStage.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        deals: {
          where: { status: "open" },
          orderBy: [{ updatedAt: "desc" }],
        },
      },
    });

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
    const firstStage = await getFirstCrmStage();
    let counterparty = parseCounterparty(body.moyskladCounterparty);

    if (!counterparty && body.createMoyskladCounterparty === true) {
      const createdCounterparty = await createMoyskladCounterparty(body as Record<string, unknown>);
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

    const created = await prisma.crmDeal.create({
      data: {
        title: title ?? customerName ?? counterparty?.name ?? phoneNormalized ?? "Новая сделка",
        customerName: customerName ?? counterparty?.name ?? null,
        phoneNormalized,
        vehicle: parseOptionalString(body.vehicle),
        source: parseOptionalString(body.source),
        amountCents: parseAmountCents(body.amount),
        stageId: parseOptionalString(body.stageId) ?? firstStage.id,
        responsibleLogin: parseOptionalString(body.responsibleLogin) ?? session.user.login,
        moyskladCounterpartyId: counterparty?.id ?? null,
        moyskladCounterpartyName: counterparty?.name ?? null,
        moyskladCounterpartyHref: counterparty?.meta.href ?? null,
        yclientsRecordId: parseOptionalString(body.yclientsRecordId),
        moyskladDemandId: parseOptionalString(body.moyskladDemandId),
        nextContactAt: parseDate(body.nextContactAt),
        notes: parseOptionalString(body.notes),
        createdByLogin: session.user.login,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("[crm/deals POST]", error);
    return databaseHint(error);
  }
}
