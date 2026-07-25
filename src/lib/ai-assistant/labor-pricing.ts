import { prisma } from "@/lib/db";

export type LaborPricingRequest = {
  organizationId: string;
  locationId: string;
  serviceFamily: string;
  procedureType: string;
  transmissionConfiguration?: string | null;
  materialsOwner: string;
  vehicleId?: string | null;
  aggregateCode?: string | null;
  vehicle?: Record<string, unknown>;
  manualLaborPriceCents?: number | null;
  fallbackServiceProductId?: string | null;
};

export type AppliedLaborRule = {
  id: string | null;
  name: string;
  source: "vehicle_complexity" | "assistant_rule" | "manual" | "service_card_fallback" | "confirmation_required";
  laborPriceCents: number | null;
  priceFromCents: number | null;
  priceToCents: number | null;
  requiresHumanConfirmation: boolean;
  selectionReason: string;
  comment: string | null;
};

function string(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function vehicleText(vehicle: Record<string, unknown> | undefined, key: string) {
  return string(vehicle?.[key], 120);
}

function currentRule(rule: { effectiveFrom: Date; effectiveTo: Date | null }, now: Date) {
  return rule.effectiveFrom <= now && (!rule.effectiveTo || rule.effectiveTo >= now);
}

function genericScore(rule: { vehicleId: string | null; aggregateCode: string | null; transmissionConfiguration: string | null; materialsOwner: string | null }, input: LaborPricingRequest) {
  if (rule.vehicleId && rule.vehicleId !== input.vehicleId) return -1;
  if (rule.aggregateCode && rule.aggregateCode !== input.aggregateCode) return -1;
  if (rule.transmissionConfiguration && rule.transmissionConfiguration !== input.transmissionConfiguration) return -1;
  if (rule.materialsOwner && rule.materialsOwner !== input.materialsOwner) return -1;
  return (rule.vehicleId ? 100 : 0) + (rule.aggregateCode ? 50 : 0) + (rule.transmissionConfiguration ? 20 : 0) + (rule.materialsOwner ? 10 : 0);
}

async function complexityRule(input: LaborPricingRequest): Promise<AppliedLaborRule | null> {
  if (!input.serviceFamily.endsWith("_filter")) return null;
  const make = vehicleText(input.vehicle, "make");
  const model = vehicleText(input.vehicle, "model");
  if (!make || !model) return null;
  const year = integer(input.vehicle?.year);
  const engineCode = vehicleText(input.vehicle, "engineCode");
  const generation = vehicleText(input.vehicle, "generation");
  const serviceType = input.serviceFamily === "air_filter" ? "air_filter" : "cabin_filter";
  const rows = await prisma.vehicleServiceComplexityRule.findMany({
    where: { organizationId: input.organizationId, active: true, serviceType, make: { equals: make, mode: "insensitive" }, model: { equals: model, mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  const matched = rows.find((rule) =>
    (!year || (!rule.yearFrom || rule.yearFrom <= year) && (!rule.yearTo || rule.yearTo >= year))
    && (!rule.engineCode || rule.engineCode.toLowerCase() === engineCode.toLowerCase())
    && (!rule.generation || rule.generation.toLowerCase() === generation.toLowerCase()),
  );
  if (!matched) return null;
  return {
    id: matched.id,
    name: `${input.serviceFamily === "air_filter" ? "Воздушный" : "Салонный"} фильтр — ${matched.complexity}`,
    source: "vehicle_complexity",
    laborPriceCents: matched.laborPriceCents,
    priceFromCents: null,
    priceToCents: null,
    requiresHumanConfirmation: false,
    selectionReason: "Использовано подтверждённое правило сложности для автомобиля.",
    comment: matched.source ?? null,
  };
}

function mapRule(rule: { id: string; name: string; laborPriceCents: number; priceFromCents: number | null; priceToCents: number | null; requiresHumanConfirmation: boolean; comment: string | null }, selectionReason: string): AppliedLaborRule {
  return { id: rule.id, name: rule.name, source: "assistant_rule", laborPriceCents: rule.laborPriceCents, priceFromCents: rule.priceFromCents, priceToCents: rule.priceToCents, requiresHumanConfirmation: rule.requiresHumanConfirmation, selectionReason, comment: rule.comment };
}

export async function resolveLaborPrice(input: LaborPricingRequest): Promise<AppliedLaborRule> {
  if (input.materialsOwner === "mixed" || input.materialsOwner === "unknown") {
    return {
      id: null,
      name: "Материалы сервиса или клиента не подтверждены",
      source: "confirmation_required",
      laborPriceCents: null,
      priceFromCents: null,
      priceToCents: null,
      requiresHumanConfirmation: true,
      selectionReason: "При смешанных или неуточнённых материалах тариф автоматически не выбирается.",
      comment: "Выберите: материалы сервиса или материалы клиента.",
    };
  }

  const complexity = await complexityRule(input);
  if (complexity) return complexity;

  const now = new Date();
  const candidates = await prisma.aIAssistantLaborPricingRule.findMany({
    where: { organizationId: input.organizationId, locationId: input.locationId, serviceFamily: input.serviceFamily, procedureType: input.procedureType, active: true },
    orderBy: [{ effectiveFrom: "desc" }, { updatedAt: "desc" }],
  });
  const matched = candidates
    .map((rule) => ({ rule, score: currentRule(rule, now) ? genericScore(rule, input) : -1 }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.rule;
  if (matched) {
    const individual = Boolean(matched.vehicleId || matched.aggregateCode);
    return mapRule(matched, individual ? "Использовано индивидуальное правило для автомобиля или агрегата." : "Использовано специальное правило ИИ-помощника для выбранного сценария.");
  }

  const manual = input.manualLaborPriceCents;
  if (typeof manual === "number" && Number.isInteger(manual) && manual >= 0) {
    return { id: null, name: "Ручная стоимость работы", source: "manual", laborPriceCents: manual, priceFromCents: null, priceToCents: null, requiresHumanConfirmation: false, selectionReason: "Специальное правило не найдено; использовано ручное значение сотрудника.", comment: null };
  }

  if (input.fallbackServiceProductId) {
    const service = await prisma.localProduct.findFirst({ where: { id: input.fallbackServiceProductId, archived: false, entityType: "service" }, select: { name: true, salePriceCents: true, pricingMode: true } });
    if (service && service.pricingMode !== "assistant_rule") {
      return { id: null, name: service.name, source: "service_card_fallback", laborPriceCents: service.salePriceCents, priceFromCents: null, priceToCents: null, requiresHumanConfirmation: false, selectionReason: "Специальное правило и ручная цена не найдены; использована цена карточки услуги как fallback.", comment: null };
    }
  }

  return { id: null, name: "Тариф работы не настроен", source: "confirmation_required", laborPriceCents: null, priceFromCents: null, priceToCents: null, requiresHumanConfirmation: true, selectionReason: "Для сценария нет действующего правила, ручной цены или допустимой fallback-карточки.", comment: "Добавьте правило или укажите ручную стоимость." };
}
