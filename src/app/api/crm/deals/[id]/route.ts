import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessCrm } from "@/lib/crm-access";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

type CounterpartyInput = { id?: unknown; name?: unknown; meta?: { href?: unknown } };

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

    if (body.title !== undefined) data.title = parseOptionalString(body.title) ?? "Новая сделка";
    if (body.customerName !== undefined) data.customerName = parseOptionalString(body.customerName);
    if (body.phone !== undefined) data.phoneNormalized = normalizePhoneKey(parseOptionalString(body.phone));
    if (body.vehicle !== undefined) data.vehicle = parseOptionalString(body.vehicle);
    if (body.source !== undefined) data.source = parseOptionalString(body.source);
    if (body.amount !== undefined) data.amountCents = parseAmountCents(body.amount);
    if (body.responsibleLogin !== undefined) data.responsibleLogin = parseOptionalString(body.responsibleLogin);
    if (body.moyskladCounterparty !== undefined) {
      const counterparty = parseCounterparty(body.moyskladCounterparty);
      data.moyskladCounterpartyId = counterparty?.id ?? null;
      data.moyskladCounterpartyName = counterparty?.name ?? null;
      data.moyskladCounterpartyHref = counterparty?.href ?? null;
    }
    if (body.yclientsRecordId !== undefined) data.yclientsRecordId = parseOptionalString(body.yclientsRecordId);
    if (body.moyskladDemandId !== undefined) data.moyskladDemandId = parseOptionalString(body.moyskladDemandId);
    if (body.nextContactAt !== undefined) data.nextContactAt = parseDate(body.nextContactAt);
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
    }

    const updated = await prisma.crmDeal.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[crm/deals PATCH]", error);
    return databaseHint(error);
  }
}
