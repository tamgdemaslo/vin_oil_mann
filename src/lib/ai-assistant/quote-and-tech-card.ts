import { z } from "zod";

const text = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringList = (value: unknown, max = 12, itemMax = 300) => Array.isArray(value) ? value.map((item) => text(item, itemMax)).filter(Boolean).slice(0, max) : [];

export const QUOTE_AND_TECH_CARD_SERVICE_TYPES = ["engine_oil", "automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential", "coolant", "brake_fluid"] as const;
export const QUOTE_AND_TECH_CARD_PROCEDURES = ["partial", "machine", "standard"] as const;
export type QuoteAndTechCardServiceType = (typeof QUOTE_AND_TECH_CARD_SERVICE_TYPES)[number];
export type QuoteAndTechCardProcedure = (typeof QUOTE_AND_TECH_CARD_PROCEDURES)[number];

export const QuoteAndTechCardEvidenceSchema = z.object({
  source: z.string().trim().min(1).max(180),
  fact: z.string().trim().min(1).max(700),
  status: z.enum(["confirmed", "assumption", "needs_verification", "unavailable"]),
  url: z.string().trim().max(1_200).nullable(),
}).strict();
export type QuoteAndTechCardEvidence = z.infer<typeof QuoteAndTechCardEvidenceSchema>;

const ProductRowSchema = z.object({ productId: z.string().trim().min(1).max(160), quantity: z.number().positive().max(100), role: z.enum(["fluid", "external_filter", "consumable", "internal_filter"]).default("consumable") }).strict();
const RosskoRowSchema = z.object({ article: z.string().trim().min(2).max(80), brand: z.string().trim().max(80).nullable().optional(), offerId: z.string().trim().max(100).nullable().optional(), quantity: z.number().positive().max(100), role: z.enum(["fluid", "external_filter", "consumable", "internal_filter"]).default("consumable") }).strict();

export const QuoteAndTechCardInputSchema = z.object({
  locationId: z.string().trim().min(1).max(120).default("dachnaya"),
  vehicle: z.object({ id: z.string().trim().max(160).nullable().optional(), displayName: z.string().trim().max(180).nullable().optional(), aggregateCode: z.string().trim().max(120).nullable().optional(), snapshot: z.record(z.string(), z.unknown()).nullable().optional() }).strict(),
  service: z.object({
    type: z.enum(QUOTE_AND_TECH_CARD_SERVICE_TYPES), name: z.string().trim().min(2).max(180), aggregate: z.string().trim().max(160).nullable().optional(), requiredFluidSpec: z.string().trim().max(160).nullable().optional(), requiredFluidOemArticle: z.string().trim().max(80).nullable().optional(),
    partialTechnicalQuantityLiters: z.number().positive().max(200).nullable().optional(), totalTechnicalQuantityLiters: z.number().positive().max(200).nullable().optional(), standardTechnicalQuantityLiters: z.number().positive().max(200).nullable().optional(), procedures: z.array(z.enum(QUOTE_AND_TECH_CARD_PROCEDURES)).min(1).max(2).optional(),
    transmissionConfiguration: z.enum(["no_pan", "pan_and_filter", "two_coarse_filters", "not_applicable"]).nullable().optional(), filterAccess: z.enum(["none", "external_replaceable", "pan_service", "internal_requires_disassembly", "unknown"]).default("unknown"), materialsOwner: z.enum(["service", "customer"]).default("service"), levelTemperature: z.string().trim().max(180).nullable().optional(), visualReference: z.string().trim().max(1_200).nullable().optional(), torqueNotes: z.array(z.string().trim().min(1).max(300)).max(12).default([]), levelProcedure: z.string().trim().max(500).nullable().optional(), servicePoints: z.array(z.string().trim().min(1).max(300)).max(16).default([]), criticalChecks: z.array(z.string().trim().min(1).max(300)).max(16).default([]), technicalWarnings: z.array(z.string().trim().min(1).max(300)).max(16).default([]),
  }).strict(),
  selectedProducts: z.array(ProductRowSchema).max(30).default([]), consumables: z.array(ProductRowSchema).max(20).default([]), rosskoItems: z.array(RosskoRowSchema).max(12).default([]), localCatalogChecked: z.boolean().default(false), fluidMissingLocally: z.boolean().default(false), softWarnings: z.array(z.string().trim().min(1).max(360)).max(16).default([]), evidence: z.array(QuoteAndTechCardEvidenceSchema).max(20).default([]),
}).strict();
export type QuoteAndTechCardInput = z.infer<typeof QuoteAndTechCardInputSchema>;

const SERVICE_ALIASES: Record<string, QuoteAndTechCardServiceType> = {
  engine_oil: "engine_oil", engine: "engine_oil", motor_oil: "engine_oil", oil_change: "engine_oil",
  automatic_transmission: "automatic_transmission", transmission_fluid: "automatic_transmission", atf: "automatic_transmission", automatic_gearbox: "automatic_transmission", automatic: "automatic_transmission", akpp: "automatic_transmission",
  cvt: "cvt", variator: "cvt", dsg: "dsg", dct: "dsg", robot: "dsg",
  manual_transmission: "manual_transmission", manual_gearbox: "manual_transmission", mt: "manual_transmission",
  transfer_case: "transfer_case", transfer: "transfer_case", differential: "differential", front_differential: "differential", rear_differential: "differential", coolant: "coolant", antifreeze: "coolant", brake_fluid: "brake_fluid", brake: "brake_fluid",
};
const PROCEDURE_ALIASES: Record<string, QuoteAndTechCardProcedure> = {
  partial: "partial", partial_change: "partial", drain_and_fill: "partial", partial_replacement: "partial",
  machine: "machine", machine_exchange: "machine", apparatus: "machine", full_exchange: "machine", full_replacement: "machine",
  standard: "standard", replace: "standard", replacement: "standard",
};
/**
 * The tool accepts observed upstream aliases, then normalizes them through the
 * same shared contract before any calculation. Canonical values remain the
 * only values used after parseQuoteAndTechCardInput().
 */
export const QuoteAndTechCardToolArgumentsSchema = z.object({ input: QuoteAndTechCardInputSchema }).strict();
const generatedToolParameters = z.toJSONSchema(QuoteAndTechCardToolArgumentsSchema) as Record<string, unknown>;
delete generatedToolParameters.$schema;
const generatedInput = object(object(generatedToolParameters.properties).input);
const generatedService = object(object(generatedInput.properties).service);
const generatedServiceProperties = object(generatedService.properties);
generatedServiceProperties.type = { type: "string", description: `Canonical or upstream service type; normalized server-side. Supported aliases include ${Object.keys(SERVICE_ALIASES).join(", ")}.` };
generatedServiceProperties.procedures = { type: "array", minItems: 1, maxItems: 2, items: { type: "string", description: `Canonical or upstream procedure; normalized server-side. Aliases include ${Object.keys(PROCEDURE_ALIASES).join(", ")}.` } };
generatedService.properties = generatedServiceProperties;
generatedInput.properties = { ...object(generatedInput.properties), service: generatedService };
const generatedEvidence = object(object(generatedInput.properties).evidence);
const generatedEvidenceItems = object(generatedEvidence.items);
const generatedEvidenceProperties = object(generatedEvidenceItems.properties);
generatedEvidenceProperties.status = { type: "string", description: "Observed evidence status; normalized server-side to confirmed, assumption, needs_verification or unavailable." };
generatedEvidenceItems.properties = generatedEvidenceProperties;
generatedEvidence.items = generatedEvidenceItems;
generatedInput.properties = { ...object(generatedInput.properties), evidence: generatedEvidence };
generatedToolParameters.properties = { ...object(generatedToolParameters.properties), input: generatedInput };
export const QUOTE_AND_TECH_CARD_TOOL_PARAMETERS = generatedToolParameters;
function normalizeToken(value: unknown) { return text(value, 120).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-zа-я0-9_]/g, ""); }

export function normalizeQuoteAndTechCardServiceType(value: unknown, context: Record<string, unknown> = {}): QuoteAndTechCardServiceType | null {
  const candidates = [value, context.type, context.serviceType, context.serviceFamily, context.category, context.aggregateType].map(normalizeToken).filter(Boolean);
  for (const candidate of candidates) if (SERVICE_ALIASES[candidate]) return SERVICE_ALIASES[candidate];
  const joined = candidates.join("_");
  if (/cvt|вариатор/.test(joined)) return "cvt";
  if (/dsg|dct|робот/.test(joined)) return "dsg";
  if (/atf|акпп|automatic|transmission/.test(joined)) return "automatic_transmission";
  return null;
}
export function normalizeQuoteAndTechCardProcedure(value: unknown): QuoteAndTechCardProcedure | null {
  const token = normalizeToken(value);
  if (PROCEDURE_ALIASES[token]) return PROCEDURE_ALIASES[token];
  if (/machine|apparat|full/.test(token)) return "machine";
  if (/partial|drain/.test(token)) return "partial";
  return null;
}
function normalizeEvidenceStatus(value: unknown): QuoteAndTechCardEvidence["status"] {
  const token = normalizeToken(value);
  if (/confirm|verified|ready|found/.test(token)) return "confirmed";
  if (/assum|likely|probable/.test(token)) return "assumption";
  if (/unavailable|missing|not_found/.test(token)) return "unavailable";
  return "needs_verification";
}
function normalizeEvidence(value: unknown): QuoteAndTechCardEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = object(raw);
    return { source: text(row.source ?? row.provider ?? row.title, 180) || "Источник", fact: text(row.fact ?? row.excerpt ?? row.description ?? row.title, 700) || "Дополнительная техническая проверка", status: normalizeEvidenceStatus(row.status), url: text(row.url, 1_200) || null };
  }).filter((item) => item.fact !== "Дополнительная техническая проверка" || item.source !== "Источник");
}
function normalizeMaterialRole(value: unknown) {
  const role = text(value, 40);
  return ["fluid", "external_filter", "consumable", "internal_filter"].includes(role) ? role : "consumable";
}
function normalizeProductRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = object(raw);
    return { productId: text(row.productId ?? row.id, 160), quantity: numberOrNull(row.quantity) ?? 0, role: normalizeMaterialRole(row.role) };
  }).filter((item) => Boolean(item.productId) && item.quantity > 0).slice(0, 30);
}
function normalizeRosskoRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = object(raw);
    return { article: text(row.article ?? row.partNumber ?? row.partnumber, 80), brand: text(row.brand, 80) || null, offerId: text(row.offerId ?? row.id, 100) || null, quantity: numberOrNull(row.quantity) ?? 0, role: normalizeMaterialRole(row.role) };
  }).filter((item) => Boolean(item.article) && item.quantity > 0).slice(0, 12);
}

/** Converts actual upstream spellings to canonical enums before Zod sees them. */
export function normalizeQuoteAndTechCardInput(value: unknown): Record<string, unknown> {
  const row = object(value);
  const sourceService = object(row.service);
  const serviceType = normalizeQuoteAndTechCardServiceType(sourceService.type ?? sourceService.serviceType ?? sourceService.serviceFamily ?? row.serviceType, sourceService) ?? "automatic_transmission";
  const rawProcedures = Array.isArray(sourceService.procedures) ? sourceService.procedures : [sourceService.procedure ?? sourceService.procedureType ?? row.procedure].filter(Boolean);
  const procedures = [...new Set(rawProcedures.map(normalizeQuoteAndTechCardProcedure).filter((item): item is QuoteAndTechCardProcedure => Boolean(item)))].slice(0, 2);
  const vehicle = object(row.vehicle);
  const transmissionConfiguration = ["no_pan", "pan_and_filter", "two_coarse_filters", "not_applicable"].includes(text(sourceService.transmissionConfiguration, 60)) ? text(sourceService.transmissionConfiguration, 60) : null;
  const filterAccess = ["none", "external_replaceable", "pan_service", "internal_requires_disassembly", "unknown"].includes(text(sourceService.filterAccess, 60)) ? text(sourceService.filterAccess, 60) : "unknown";
  const materialsOwner = sourceService.materialsOwner === "customer" ? "customer" : "service";
  return {
    locationId: text(row.locationId ?? row.branchId, 120) || "dachnaya",
    vehicle: { id: text(vehicle.id ?? row.vehicleId, 160) || null, displayName: text(vehicle.displayName ?? vehicle.name ?? row.vehicleDisplayName, 180) || null, aggregateCode: text(vehicle.aggregateCode ?? row.aggregateCode, 120) || null, snapshot: object(vehicle.snapshot ?? row.vehicleSnapshot) },
    service: {
      type: serviceType, name: text(sourceService.name ?? sourceService.serviceName ?? row.serviceName, 180) || (serviceType === "automatic_transmission" ? "Замена жидкости АКПП" : "Техническое обслуживание"), aggregate: text(sourceService.aggregate ?? row.aggregate, 160) || null, requiredFluidSpec: text(sourceService.requiredFluidSpec ?? sourceService.fluidSpec ?? sourceService.specification ?? row.requiredFluidSpec, 160) || null, requiredFluidOemArticle: text(sourceService.requiredFluidOemArticle ?? sourceService.fluidOemArticle ?? row.requiredFluidOemArticle, 80) || null,
      partialTechnicalQuantityLiters: numberOrNull(sourceService.partialTechnicalQuantityLiters ?? sourceService.partialVolumeLiters ?? sourceService.partialQuantityLiters), totalTechnicalQuantityLiters: numberOrNull(sourceService.totalTechnicalQuantityLiters ?? sourceService.totalCapacityLiters ?? sourceService.totalQuantityLiters), standardTechnicalQuantityLiters: numberOrNull(sourceService.standardTechnicalQuantityLiters ?? sourceService.standardVolumeLiters ?? sourceService.quantityLiters), procedures: procedures.length ? procedures : undefined, transmissionConfiguration, filterAccess, materialsOwner, levelTemperature: text(sourceService.levelTemperature ?? sourceService.levelTemperatureRange, 180) || null, visualReference: text(sourceService.visualReference ?? sourceService.visualReferenceUrl, 1_200) || null, torqueNotes: stringList(sourceService.torqueNotes, 12), levelProcedure: text(sourceService.levelProcedure, 500) || null, servicePoints: stringList(sourceService.servicePoints, 16), criticalChecks: stringList(sourceService.criticalChecks, 16), technicalWarnings: stringList(sourceService.technicalWarnings, 16),
    },
    selectedProducts: normalizeProductRows(row.selectedProducts), consumables: normalizeProductRows(row.consumables), rosskoItems: normalizeRosskoRows(row.rosskoItems), localCatalogChecked: row.localCatalogChecked === true, fluidMissingLocally: row.fluidMissingLocally === true, softWarnings: stringList(row.softWarnings, 16, 360), evidence: normalizeEvidence(row.evidence),
  };
}
export function parseQuoteAndTechCardInput(value: unknown): QuoteAndTechCardInput { return QuoteAndTechCardInputSchema.parse(normalizeQuoteAndTechCardInput(value)); }

/** Enforces local-first and the TGM internal-filter policy before pricing. */
export function quoteAndTechCardMaterials(input: QuoteAndTechCardInput, localFluidFound: boolean) {
  const allowedLocal = input.selectedProducts.filter((item) => item.role !== "internal_filter");
  const allowedConsumables = input.consumables.filter((item) => item.role !== "internal_filter");
  const allowedRossko = input.rosskoItems
    .filter((item) => item.role !== "internal_filter")
    .filter((item) => item.role !== "fluid" || (!localFluidFound && input.fluidMissingLocally && Boolean(input.service.requiredFluidOemArticle)));
  return { selectedProducts: allowedLocal, consumables: allowedConsumables, rosskoItems: allowedRossko };
}

export type QuoteAndTechCardRules = { literRoundingStep: number; transmissionMachineExchangeMultiplier: number; transmissionMinimumBillableLiters: number; maxTechnicalVerificationPasses: number };
export const DEFAULT_QUOTE_AND_TECH_CARD_RULES: QuoteAndTechCardRules = { literRoundingStep: 1, transmissionMachineExchangeMultiplier: 1.7, transmissionMinimumBillableLiters: 0, maxTechnicalVerificationPasses: 2 };
export type QuoteAndTechCardPlanOption = { code: QuoteAndTechCardProcedure; label: string; technicalQuantityLiters: number | null; billableQuantityLiters: number | null; blockedReason: string | null };
export type QuoteAndTechCardPlan = { input: QuoteAndTechCardInput; rules: QuoteAndTechCardRules; isTransmission: boolean; hardBlockers: Array<{ code: string; message: string; requiredToContinue: string }>; quoteWarnings: string[]; techCardWarnings: string[]; options: QuoteAndTechCardPlanOption[] };
function isTransmission(type: QuoteAndTechCardServiceType) { return ["automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential"].includes(type); }
function roundUp(value: number, step: number) { const normalizedStep = Math.max(0.1, Math.min(10, step || 1)); return Math.ceil((value - 1e-8) / normalizedStep) * normalizedStep; }

export function createQuoteAndTechCardPlan(rawInput: unknown, rawRules: Partial<QuoteAndTechCardRules> = {}): QuoteAndTechCardPlan {
  const input = parseQuoteAndTechCardInput(rawInput);
  const rules: QuoteAndTechCardRules = { literRoundingStep: Number.isFinite(rawRules.literRoundingStep) ? Math.max(0.1, Math.min(10, Number(rawRules.literRoundingStep))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.literRoundingStep, transmissionMachineExchangeMultiplier: Number.isFinite(rawRules.transmissionMachineExchangeMultiplier) ? Math.max(1, Math.min(3, Number(rawRules.transmissionMachineExchangeMultiplier))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.transmissionMachineExchangeMultiplier, transmissionMinimumBillableLiters: Number.isFinite(rawRules.transmissionMinimumBillableLiters) ? Math.max(0, Math.min(200, Number(rawRules.transmissionMinimumBillableLiters))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.transmissionMinimumBillableLiters, maxTechnicalVerificationPasses: Number.isFinite(rawRules.maxTechnicalVerificationPasses) ? Math.round(Math.max(0, Math.min(2, Number(rawRules.maxTechnicalVerificationPasses)))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.maxTechnicalVerificationPasses };
  const transmission = isTransmission(input.service.type);
  const hardBlockers: QuoteAndTechCardPlan["hardBlockers"] = [];
  if (!text(input.vehicle.displayName, 180)) hardBlockers.push({ code: "VEHICLE_NOT_IDENTIFIED", message: "Автомобиль или агрегат не определён достаточно для проверки совместимости.", requiredToContinue: "Укажите VIN либо марку, модель, год и агрегат." });
  if (!text(input.service.requiredFluidSpec, 160)) hardBlockers.push({ code: "SPECIFICATION_NOT_CONFIRMED", message: "Не подтверждена обязательная спецификация жидкости.", requiredToContinue: "Нужен допуск OEM или документированный аналог по спецификации." });
  const quoteWarnings = input.localCatalogChecked ? [] : ["Локальный каталог ещё не подтверждён: смета будет предварительной."];
  const techCardWarnings = [...input.softWarnings, ...input.service.technicalWarnings];
  if (transmission && input.service.filterAccess === "internal_requires_disassembly") techCardWarnings.push("Фильтр внутренний; в рамках стандартной замены ТГМ не меняет.");
  if (!input.service.torqueNotes.length) techCardWarnings.push("Моменты затяжки не найдены: сверить по OEM перед работой.");
  if (!input.service.visualReference) techCardWarnings.push("Визуальная ссылка для техкарты не найдена.");
  const configured = input.service.procedures?.length ? input.service.procedures : transmission ? ["partial"] as const : ["standard"] as const;
  const options = configured.slice(0, 2).map((code): QuoteAndTechCardPlanOption => {
    const technicalQuantityLiters = code === "machine" ? input.service.totalTechnicalQuantityLiters == null ? null : Math.round(input.service.totalTechnicalQuantityLiters * rules.transmissionMachineExchangeMultiplier * 1_000) / 1_000 : code === "partial" ? input.service.partialTechnicalQuantityLiters ?? input.service.standardTechnicalQuantityLiters ?? null : input.service.standardTechnicalQuantityLiters ?? input.service.partialTechnicalQuantityLiters ?? null;
    const billableQuantityLiters = technicalQuantityLiters == null ? null : roundUp(Math.max(technicalQuantityLiters, transmission ? rules.transmissionMinimumBillableLiters : 0), rules.literRoundingStep);
    return { code, label: code === "machine" ? "Аппаратная замена" : code === "partial" ? "Частичная замена" : input.service.name, technicalQuantityLiters, billableQuantityLiters, blockedReason: billableQuantityLiters == null ? "Не определён рабочий объём жидкости для этого варианта." : null };
  });
  return { input, rules, isTransmission: transmission, hardBlockers, quoteWarnings, techCardWarnings: [...new Set(techCardWarnings)], options };
}

const QuoteLineSchema = z.object({ source: z.string().trim().max(80).optional(), type: z.string().trim().max(80).nullable().optional(), name: z.string().trim().min(1).max(220), article: z.string().trim().max(120).nullable().optional(), quantity: z.number().positive(), unitPriceCents: z.number().int().nonnegative().optional(), totalCents: z.number().int().nonnegative() }).strict();
export const QuoteAndTechCardQuoteOptionSchema = z.object({ code: z.enum(QUOTE_AND_TECH_CARD_PROCEDURES), label: z.string().min(1).max(180), status: z.enum(["ready", "preliminary", "blocked"]), technicalQuantityLiters: z.number().positive().nullable(), billableQuantityLiters: z.number().positive().nullable(), lines: z.array(QuoteLineSchema).max(40), totalCents: z.number().int().nonnegative().nullable(), maximumTotalCents: z.number().int().nonnegative().nullable(), validUntil: z.string().max(100).nullable(), blockers: z.array(z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(360), requiredToContinue: z.string().min(1).max(360) }).strict()).max(6), warnings: z.array(z.string().min(1).max(360)).max(20) }).strict();
export type QuoteAndTechCardQuoteOption = z.infer<typeof QuoteAndTechCardQuoteOptionSchema>;
export const QuoteAndTechCardResultSchema = z.object({
  scenario: z.literal("quote_and_tech_card"), status: z.enum(["ready", "partial", "blocked"]), vehicle: z.object({ displayName: z.string().min(1).max(180), aggregate: z.string().max(160).nullable() }).strict(),
  quote: z.object({ status: z.enum(["ready", "preliminary", "blocked"]), options: z.array(QuoteAndTechCardQuoteOptionSchema).min(1).max(2), hardBlockers: z.array(z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(360), requiredToContinue: z.string().min(1).max(360) }).strict()).max(8), warnings: z.array(z.string().min(1).max(360)).max(20) }).strict(),
  techCard: z.object({ status: z.enum(["ready", "partial", "blocked"]), serviceName: z.string().min(1).max(180), serviceType: z.enum(QUOTE_AND_TECH_CARD_SERVICE_TYPES), requiredFluidSpec: z.string().max(160).nullable(), filterPolicy: z.string().min(1).max(360), levelTemperature: z.string().max(180).nullable(), levelProcedure: z.string().max(500).nullable(), servicePoints: z.array(z.string().min(1).max(300)).max(16), torqueNotes: z.array(z.string().min(1).max(300)).max(12), criticalChecks: z.array(z.string().min(1).max(300)).max(16), selectedMaterial: z.object({ name: z.string().max(220), quantity: z.number().positive(), compatibilityEvidence: z.string().max(700).nullable() }).nullable(), warnings: z.array(z.string().min(1).max(360)).max(20) }).strict(),
  customerMessage: z.object({ status: z.enum(["ready", "blocked"]), text: z.string().max(4_000) }).strict(), evidence: z.array(QuoteAndTechCardEvidenceSchema).max(20),
}).strict();
export type QuoteAndTechCardResult = z.infer<typeof QuoteAndTechCardResultSchema>;
export function parseQuoteAndTechCardResult(value: unknown): QuoteAndTechCardResult | null { const parsed = QuoteAndTechCardResultSchema.safeParse(value); return parsed.success ? parsed.data : null; }
/**
 * The tool envelope contains operational metadata (for example a quote
 * snapshot to persist) in addition to the customer-facing contract.  Keep
 * the public schema strict, but validate only its declared fields here.
 */
export function parseQuoteAndTechCardToolResult(value: unknown): QuoteAndTechCardResult | null {
  const row = object(value);
  return parseQuoteAndTechCardResult({
    scenario: row.scenario,
    status: row.status,
    vehicle: row.vehicle,
    quote: row.quote,
    techCard: row.techCard,
    customerMessage: row.customerMessage,
    evidence: row.evidence,
  });
}
export function quoteStatus(options: Array<{ status: "ready" | "preliminary" | "blocked" }>, hardBlockers: unknown[]) { if (hardBlockers.length || !options.some((option) => option.status !== "blocked")) return "blocked" as const; return options.every((option) => option.status === "ready") ? "ready" as const : "preliminary" as const; }
export function scenarioStatus(quote: "ready" | "preliminary" | "blocked", techCard: "ready" | "partial" | "blocked", customerMessage: "ready" | "blocked") { if (quote === "blocked") return "blocked" as const; return quote === "ready" && techCard === "ready" && customerMessage === "ready" ? "ready" as const : "partial" as const; }

export function buildQuoteAndTechCardCustomerMessage(input: Pick<QuoteAndTechCardResult, "vehicle" | "quote" | "techCard">): QuoteAndTechCardResult["customerMessage"] {
  const ready = input.quote.options.filter((option) => option.status !== "blocked" && option.totalCents != null);
  if (!ready.length) { const blocker = input.quote.hardBlockers[0] ?? input.quote.options.flatMap((option) => option.blockers)[0]; return { status: "blocked", text: blocker ? `Чтобы подготовить расчёт для ${input.vehicle.displayName}, нужно уточнить: ${blocker.requiredToContinue}` : `Для ${input.vehicle.displayName} пока нельзя подготовить расчёт.` }; }
  const optionText = ready.map((option) => { const material = option.lines.find((line) => line.type !== "labor" && line.type !== "rounding"); const labor = option.lines.find((line) => line.type === "labor"); const amount = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format((option.totalCents ?? 0) / 100); return `${option.label}: ${material?.name ?? input.techCard.selectedMaterial?.name ?? "жидкость по допуску"}, ${option.billableQuantityLiters ?? "—"} л${labor ? `, ${labor.name.toLowerCase()}` : ""} — ${amount} ₽`; });
  const technical = input.techCard.requiredFluidSpec ? `Подтвердили допуск ${input.techCard.requiredFluidSpec}. ` : "";
  const condition = input.techCard.filterPolicy.includes("не меняет") ? "Внутренний фильтр в стандартную замену не входит. " : "Перед работой окончательно сверим комплект. ";
  return { status: "ready", text: `Для ${input.vehicle.displayName}. ${technical}${optionText.join("; ")}. ${condition}Можем согласовать вариант и записать на диагностику.` };
}
