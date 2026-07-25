import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aiAssistantApiError, requireAIAssistantAccess } from "@/lib/ai-assistant/access";

const MAX_COMMENT = 1_000;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max = 160) {
  const result = text(value, max);
  return result || null;
}

function integer(value: unknown): number;
function integer(value: unknown, nullable: true): number | null;
function integer(value: unknown, nullable = false): number | null {
  if (value == null || value === "") return nullable ? null : 0;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 10_000_000) throw new Error("Укажите корректную стоимость в копейках");
  return result;
}

function date(value: unknown): Date;
function date(value: unknown, nullable: true): Date | null;
function date(value: unknown, nullable = false): Date | null {
  if (value == null || value === "") return nullable ? null : new Date();
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new Error("Укажите корректную дату действия правила");
  return result;
}

function payload(value: unknown) {
  const body = object(value);
  const serviceFamily = text(body.serviceFamily, 60);
  const procedureType = text(body.procedureType, 60);
  const name = text(body.name, 220);
  if (!serviceFamily || !procedureType || !name) throw new Error("Заполните название, семейство услуги и тип процедуры");
  const priceFromCents = integer(body.priceFromCents, true);
  const priceToCents = integer(body.priceToCents, true);
  if (priceFromCents != null && priceToCents != null && priceToCents < priceFromCents) throw new Error("Верхняя граница не может быть ниже нижней");
  return {
    locationId: text(body.locationId, 120) || "dachnaya",
    serviceFamily,
    procedureType,
    transmissionConfiguration: nullableText(body.transmissionConfiguration, 60),
    materialsOwner: nullableText(body.materialsOwner, 30),
    vehicleId: nullableText(body.vehicleId, 160),
    aggregateCode: nullableText(body.aggregateCode, 120),
    name,
    laborPriceCents: integer(body.laborPriceCents),
    priceFromCents,
    priceToCents,
    requiresHumanConfirmation: Boolean(body.requiresHumanConfirmation),
    active: body.active !== false,
    effectiveFrom: date(body.effectiveFrom),
    effectiveTo: date(body.effectiveTo, true),
    comment: nullableText(body.comment, MAX_COMMENT),
  };
}

export async function GET() {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const rules = await prisma.aIAssistantLaborPricingRule.findMany({
      where: { organizationId: access.organizationId },
      orderBy: [{ locationId: "asc" }, { serviceFamily: "asc" }, { procedureType: "asc" }, { materialsOwner: "asc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json({ rules });
  } catch (error) { return aiAssistantApiError(error); }
}

export async function POST(request: Request) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const rule = await prisma.aIAssistantLaborPricingRule.create({ data: { organizationId: access.organizationId, createdById: access.actorId, updatedById: access.actorId, ...payload(await request.json()) } });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) { return aiAssistantApiError(error); }
}

export async function PATCH(request: Request) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const body = object(await request.json());
    const id = text(body.id, 160);
    if (!id) throw new Error("Не найдено правило для изменения");
    const existing = await prisma.aIAssistantLaborPricingRule.findFirst({ where: { id, organizationId: access.organizationId }, select: { id: true } });
    if (!existing) throw new Error("Правило не найдено");
    const rule = await prisma.aIAssistantLaborPricingRule.update({ where: { id }, data: { ...payload(body), updatedById: access.actorId } });
    return NextResponse.json({ rule });
  } catch (error) { return aiAssistantApiError(error); }
}

export async function DELETE(request: Request) {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  try {
    const id = text(new URL(request.url).searchParams.get("id"), 160);
    if (!id) throw new Error("Не найдено правило для удаления");
    const result = await prisma.aIAssistantLaborPricingRule.updateMany({ where: { id, organizationId: access.organizationId }, data: { active: false, updatedById: access.actorId } });
    if (!result.count) throw new Error("Правило не найдено");
    return NextResponse.json({ ok: true });
  } catch (error) { return aiAssistantApiError(error); }
}
