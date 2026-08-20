import { z } from "zod";

const text = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export const QUOTE_AND_TECH_CARD_SERVICE_TYPES = [
  "engine_oil",
  "automatic_transmission",
  "cvt",
  "dsg",
  "manual_transmission",
  "transfer_case",
  "differential",
  "coolant",
  "brake_fluid",
] as const;

export type QuoteAndTechCardServiceType = (typeof QUOTE_AND_TECH_CARD_SERVICE_TYPES)[number];

const ProductRowSchema = z.object({ productId: z.string().trim().min(1).max(160), quantity: z.number().positive().max(100) }).strict();
const RosskoRowSchema = z.object({ article: z.string().trim().min(2).max(80), brand: z.string().trim().max(80).nullable().optional(), offerId: z.string().trim().max(100).nullable().optional(), quantity: z.number().positive().max(100), role: z.enum(["fluid", "external_filter", "consumable", "internal_filter"]).default("consumable") }).strict();

export const QuoteAndTechCardInputSchema = z.object({
  locationId: z.string().trim().min(1).max(120).default("dachnaya"),
  vehicle: z.object({
    id: z.string().trim().max(160).nullable().optional(),
    displayName: z.string().trim().max(180).nullable().optional(),
    aggregateCode: z.string().trim().max(120).nullable().optional(),
    snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  }).strict(),
  service: z.object({
    type: z.enum(QUOTE_AND_TECH_CARD_SERVICE_TYPES),
    name: z.string().trim().min(2).max(180),
    aggregate: z.string().trim().max(160).nullable().optional(),
    requiredFluidSpec: z.string().trim().max(160).nullable().optional(),
    requiredFluidOemArticle: z.string().trim().max(80).nullable().optional(),
    partialVolumeLiters: z.number().positive().max(200).nullable().optional(),
    totalCapacityLiters: z.number().positive().max(200).nullable().optional(),
    standardVolumeLiters: z.number().positive().max(200).nullable().optional(),
    procedures: z.array(z.enum(["partial", "machine", "standard"])).min(1).max(2).optional(),
    transmissionConfiguration: z.enum(["no_pan", "pan_and_filter", "two_coarse_filters", "not_applicable"]).nullable().optional(),
    filterAccess: z.enum(["none", "external_replaceable", "pan_service", "internal_requires_disassembly", "unknown"]).default("unknown"),
    materialsOwner: z.enum(["service", "customer"]).default("service"),
    torqueNotes: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
    levelProcedure: z.string().trim().max(500).nullable().optional(),
    servicePoints: z.array(z.string().trim().min(1).max(300)).max(16).default([]),
    criticalChecks: z.array(z.string().trim().min(1).max(300)).max(16).default([]),
    technicalWarnings: z.array(z.string().trim().min(1).max(300)).max(16).default([]),
  }).strict(),
  selectedProducts: z.array(ProductRowSchema).max(30).default([]),
  consumables: z.array(ProductRowSchema).max(20).default([]),
  // Supplier rows are passed only when the caller has established that the
  // particular required item is absent locally. The backend never needs them
  // for the internally inaccessible transmission filter policy.
  rosskoItems: z.array(RosskoRowSchema).max(12).default([]),
  localCatalogChecked: z.boolean().default(false),
  fluidMissingLocally: z.boolean().default(false),
  softWarnings: z.array(z.string().trim().min(1).max(360)).max(16).default([]),
  evidence: z.array(z.object({ title: z.string().trim().min(1).max(180), url: z.string().trim().max(1_200).nullable().optional(), excerpt: z.string().trim().max(700).nullable().optional() }).strict()).max(20).default([]),
}).strict();

export type QuoteAndTechCardInput = z.infer<typeof QuoteAndTechCardInputSchema>;

export type QuoteAndTechCardRules = {
  literRoundingStep: number;
  transmissionMachineExchangeMultiplier: number;
  transmissionMinimumBillableLiters: number;
  maxTechnicalVerificationPasses: number;
};

export const DEFAULT_QUOTE_AND_TECH_CARD_RULES: QuoteAndTechCardRules = {
  literRoundingStep: 1,
  transmissionMachineExchangeMultiplier: 1.7,
  transmissionMinimumBillableLiters: 0,
  maxTechnicalVerificationPasses: 2,
};

export type QuoteAndTechCardPlanOption = {
  code: "partial" | "machine" | "standard";
  label: string;
  rawLiters: number | null;
  billableLiters: number | null;
  blockedReason: string | null;
};

export type QuoteAndTechCardPlan = {
  input: QuoteAndTechCardInput;
  rules: QuoteAndTechCardRules;
  isTransmission: boolean;
  hardBlockers: Array<{ code: string; message: string; requiredToContinue: string }>;
  softWarnings: string[];
  options: QuoteAndTechCardPlanOption[];
};

function transmission(type: QuoteAndTechCardServiceType) {
  return ["automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential"].includes(type);
}

function roundedUp(value: number, step: number) {
  const normalizedStep = Math.max(0.1, Math.min(10, step || 1));
  return Math.ceil((value - 1e-8) / normalizedStep) * normalizedStep;
}

export function createQuoteAndTechCardPlan(rawInput: unknown, rawRules: Partial<QuoteAndTechCardRules> = {}): QuoteAndTechCardPlan {
  const input = QuoteAndTechCardInputSchema.parse(rawInput);
  const rules: QuoteAndTechCardRules = {
    literRoundingStep: Number.isFinite(rawRules.literRoundingStep) ? Math.max(0.1, Math.min(10, Number(rawRules.literRoundingStep))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.literRoundingStep,
    transmissionMachineExchangeMultiplier: Number.isFinite(rawRules.transmissionMachineExchangeMultiplier) ? Math.max(1, Math.min(3, Number(rawRules.transmissionMachineExchangeMultiplier))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.transmissionMachineExchangeMultiplier,
    transmissionMinimumBillableLiters: Number.isFinite(rawRules.transmissionMinimumBillableLiters) ? Math.max(0, Math.min(200, Number(rawRules.transmissionMinimumBillableLiters))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.transmissionMinimumBillableLiters,
    maxTechnicalVerificationPasses: Number.isFinite(rawRules.maxTechnicalVerificationPasses) ? Math.round(Math.max(0, Math.min(2, Number(rawRules.maxTechnicalVerificationPasses)))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.maxTechnicalVerificationPasses,
  };
  const isTransmission = transmission(input.service.type);
  const hardBlockers: QuoteAndTechCardPlan["hardBlockers"] = [];
  const softWarnings = [...input.softWarnings];
  if (!text(input.vehicle.displayName, 180)) hardBlockers.push({ code: "VEHICLE_NOT_IDENTIFIED", message: "Автомобиль или агрегат не определён достаточно для проверки совместимости.", requiredToContinue: "Укажите VIN либо марку, модель, год и агрегат." });
  if (!text(input.service.requiredFluidSpec, 160)) hardBlockers.push({ code: "SPECIFICATION_NOT_CONFIRMED", message: "Не подтверждена обязательная спецификация жидкости.", requiredToContinue: "Нужен допуск OEM или документированный аналог по спецификации." });
  if (isTransmission && input.service.filterAccess === "internal_requires_disassembly") softWarnings.push("Внутренний фильтр требует разборки агрегата и не включён в услугу ТГМ.");
  if (!input.localCatalogChecked) softWarnings.push("Локальный каталог ещё не отмечен как проверенный: предложение будет предварительным до проверки наличия.");
  if (!input.service.torqueNotes.length) softWarnings.push("Моменты затяжки не подтверждены: сверить по OEM-документации перед работой.");
  const configured = input.service.procedures?.length
    ? input.service.procedures
    : isTransmission ? ["partial"] as const : ["standard"] as const;
  const options = configured.slice(0, 2).map((code): QuoteAndTechCardPlanOption => {
    const rawLiters = code === "machine"
      ? (finite(input.service.totalCapacityLiters) ? input.service.totalCapacityLiters! * rules.transmissionMachineExchangeMultiplier : null)
      : code === "partial"
        ? (finite(input.service.partialVolumeLiters) ? input.service.partialVolumeLiters! : finite(input.service.standardVolumeLiters))
        : (finite(input.service.standardVolumeLiters) ? input.service.standardVolumeLiters! : finite(input.service.partialVolumeLiters));
    const billableLiters = rawLiters == null ? null : roundedUp(Math.max(rawLiters, isTransmission ? rules.transmissionMinimumBillableLiters : 0), rules.literRoundingStep);
    const label = code === "machine" ? "Аппаратная замена" : code === "partial" ? "Частичная замена" : input.service.name;
    return { code, label, rawLiters, billableLiters, blockedReason: billableLiters == null ? "Не определён необходимый объём жидкости для этого варианта." : null };
  });
  return { input, rules, isTransmission, hardBlockers, softWarnings: [...new Set(softWarnings)], options };
}

const QuoteLineSchema = z.object({ source: z.string().trim().max(80).optional(), type: z.string().trim().max(80).nullable().optional(), name: z.string().trim().min(1).max(220), article: z.string().trim().max(120).nullable().optional(), quantity: z.number().positive(), unitPriceCents: z.number().int().nonnegative().optional(), totalCents: z.number().int().nonnegative() }).strict();
const QuoteOptionSchema = z.object({
  code: z.enum(["partial", "machine", "standard"]),
  label: z.string().min(1).max(180),
  status: z.enum(["ready", "blocked"]),
  confidence: z.enum(["final", "preliminary"]),
  requiredLiters: z.number().positive().nullable(),
  lines: z.array(QuoteLineSchema).max(40),
  totalCents: z.number().int().nonnegative().nullable(),
  maximumTotalCents: z.number().int().nonnegative().nullable(),
  validUntil: z.string().max(100).nullable(),
  blockers: z.array(z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(360), requiredToContinue: z.string().min(1).max(360) }).strict()).max(6),
  warnings: z.array(z.string().min(1).max(360)).max(20),
}).strict();

export const QuoteAndTechCardResultSchema = z.object({
  scenario: z.literal("quote_and_tech_card"),
  status: z.enum(["ready", "partial", "blocked"]),
  vehicle: z.object({ displayName: z.string().min(1).max(180), aggregate: z.string().max(160).nullable() }).strict(),
  techCard: z.object({
    serviceName: z.string().min(1).max(180),
    serviceType: z.enum(QUOTE_AND_TECH_CARD_SERVICE_TYPES),
    requiredFluidSpec: z.string().max(160).nullable(),
    filterPolicy: z.string().min(1).max(360),
    levelProcedure: z.string().max(500).nullable(),
    servicePoints: z.array(z.string().min(1).max(300)).max(16),
    torqueNotes: z.array(z.string().min(1).max(300)).max(12),
    criticalChecks: z.array(z.string().min(1).max(300)).max(16),
    selectedMaterial: z.object({ name: z.string().max(220), quantity: z.number().positive(), compatibilityEvidence: z.string().max(700).nullable() }).nullable(),
  }).strict(),
  options: z.array(QuoteOptionSchema).min(1).max(2),
  hardBlockers: z.array(z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(360), requiredToContinue: z.string().min(1).max(360) }).strict()).max(8),
  softWarnings: z.array(z.string().min(1).max(360)).max(24),
  evidence: z.array(z.object({ title: z.string().min(1).max(180), url: z.string().max(1_200).nullable(), excerpt: z.string().max(700).nullable() }).strict()).max(20),
  customerMessage: z.string().max(4_000),
}).strict();

export type QuoteAndTechCardResult = z.infer<typeof QuoteAndTechCardResultSchema>;

export function parseQuoteAndTechCardResult(value: unknown): QuoteAndTechCardResult | null {
  const parsed = QuoteAndTechCardResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function buildQuoteAndTechCardCustomerMessage(input: Pick<QuoteAndTechCardResult, "vehicle" | "techCard" | "options" | "status" | "hardBlockers">) {
  const ready = input.options.filter((option) => option.status === "ready" && option.totalCents != null);
  if (!ready.length) {
    const blocker = input.hardBlockers[0] ?? input.options.flatMap((option) => option.blockers)[0];
    return blocker ? `Чтобы подготовить расчёт для ${input.vehicle.displayName}, нужно уточнить: ${blocker.requiredToContinue}` : `Для ${input.vehicle.displayName} пока нельзя подготовить расчёт.`;
  }
  const options = ready.map((option) => {
    const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format((option.totalCents ?? 0) / 100);
    return `${option.label.toLowerCase()} — ${amount} ₽`;
  });
  const specification = input.techCard.requiredFluidSpec ? ` по спецификации ${input.techCard.requiredFluidSpec}` : "";
  const material = input.techCard.selectedMaterial ? ` Материал: ${input.techCard.selectedMaterial.name}.` : "";
  const preliminary = ready.some((option) => option.confidence === "preliminary") ? " Перед работой окончательно сверим комплект и наличие." : "";
  return `Для ${input.vehicle.displayName} подготовили ${input.techCard.serviceName}${specification}: ${options.join("; ")}.${material}${preliminary}`;
}

export function resultStatus(options: Array<{ status: "ready" | "blocked" }>, hardBlockers: unknown[]) {
  if (hardBlockers.length || !options.some((option) => option.status === "ready")) return "blocked" as const;
  return options.some((option) => option.status === "blocked") ? "partial" as const : "ready" as const;
}
