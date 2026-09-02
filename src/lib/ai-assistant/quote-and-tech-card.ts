import { z } from "zod";

const text = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringList = (value: unknown, max = 12, itemMax = 300) => Array.isArray(value) ? value.map((item) => text(item, itemMax)).filter(Boolean).slice(0, max) : [];

export const QUOTE_AND_TECH_CARD_SERVICE_TYPES = ["engine_oil", "automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential", "awd_clutch", "coolant", "brake_fluid"] as const;
// `filter_service` is deliberately separate from a drain-and-fill.  A
// filter/pan package has different mandatory parts and labour, so it may not
// silently be represented by the same `partial` option.
export const QUOTE_AND_TECH_CARD_PROCEDURES = ["partial", "filter_service", "machine", "machine_filter_service", "standard"] as const;
export type QuoteAndTechCardServiceType = (typeof QUOTE_AND_TECH_CARD_SERVICE_TYPES)[number];
export type QuoteAndTechCardProcedure = (typeof QUOTE_AND_TECH_CARD_PROCEDURES)[number];

export const QuoteAndTechCardEvidenceSchema = z.object({
  source: z.string().trim().min(1).max(180),
  fact: z.string().trim().min(1).max(700),
  status: z.enum(["confirmed", "assumption", "needs_verification", "unavailable"]),
  url: z.string().trim().max(1_200).nullable(),
}).strict();
export type QuoteAndTechCardEvidence = z.infer<typeof QuoteAndTechCardEvidenceSchema>;

export const QUOTE_AND_TECH_CARD_FILTER_ACCESS = ["none", "external_replaceable", "pan_service", "integrated_with_pan", "internal_requires_disassembly", "unknown"] as const;
export const QuoteAndTechCardFilterPolicySchema = z.object({
  presence: z.enum(["present", "not_present", "unknown"]),
  access: z.enum(QUOTE_AND_TECH_CARD_FILTER_ACCESS),
  tgmAction: z.enum(["replace", "replace_with_pan", "do_not_replace", "verify_before_quote"]),
  filterPartRequiredForQuote: z.boolean(),
  panServiceRequired: z.boolean(),
  reason: z.string().min(1).max(360),
  evidence: z.string().max(700).nullable(),
  // Compatibility aliases for attachments written before the structured
  // policy existed. New code uses the fields above as source of truth.
  replaceFilter: z.boolean(),
  requiredForQuote: z.boolean(),
  searchPart: z.boolean(),
  rosskoSearch: z.boolean(),
  customerText: z.string().min(1).max(360),
}).strict();
export type QuoteAndTechCardFilterPolicy = z.infer<typeof QuoteAndTechCardFilterPolicySchema>;

const SERVICE_HARDWARE_REQUIREMENTS = ["mandatory", "recommended", "optional"] as const;
const QuoteAndTechCardServiceHardwareSchema = z.object({
  type: z.string().trim().min(1).max(100),
  requirement: z.enum(SERVICE_HARDWARE_REQUIREMENTS),
  quantity: z.number().positive().max(100),
  evidence: z.string().trim().max(700).nullable().optional(),
  requiredForQuote: z.boolean(),
}).strict();
export type QuoteAndTechCardServiceHardware = z.infer<typeof QuoteAndTechCardServiceHardwareSchema>;

const MATERIAL_ROLES = ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter"] as const;
const ProductRowSchema = z.object({ productId: z.string().trim().min(1).max(160), quantity: z.number().positive().max(100), role: z.enum(MATERIAL_ROLES).default("consumable") }).strict();
const RosskoRowSchema = z.object({ article: z.string().trim().min(2).max(80), brand: z.string().trim().max(80).nullable().optional(), offerId: z.string().trim().max(100).nullable().optional(), quantity: z.number().positive().max(100), role: z.enum(MATERIAL_ROLES).default("consumable") }).strict();

export const QuoteAndTechCardInputSchema = z.object({
  locationId: z.string().trim().min(1).max(120).default("dachnaya"),
  vehicle: z.object({ id: z.string().trim().max(160).nullable().optional(), displayName: z.string().trim().max(180).nullable().optional(), aggregateCode: z.string().trim().max(120).nullable().optional(), snapshot: z.record(z.string(), z.unknown()).nullable().optional() }).strict(),
  service: z.object({
    type: z.enum(QUOTE_AND_TECH_CARD_SERVICE_TYPES), name: z.string().trim().min(2).max(180), aggregate: z.string().trim().max(160).nullable().optional(), requiredFluidSpec: z.string().trim().max(160).nullable().optional(), requiredFluidOemArticle: z.string().trim().max(80).nullable().optional(),
    partialTechnicalQuantityLiters: z.number().positive().max(200).nullable().optional(), totalTechnicalQuantityLiters: z.number().positive().max(200).nullable().optional(), standardTechnicalQuantityLiters: z.number().positive().max(200).nullable().optional(), procedures: z.array(z.enum(QUOTE_AND_TECH_CARD_PROCEDURES)).min(1).max(2).optional(),
    transmissionConfiguration: z.enum(["no_pan", "pan_and_filter", "two_coarse_filters", "not_applicable"]).nullable().optional(), filterAccess: z.enum(QUOTE_AND_TECH_CARD_FILTER_ACCESS).default("unknown"), filterEvidence: z.string().trim().max(700).nullable().optional(), serviceHardware: z.array(QuoteAndTechCardServiceHardwareSchema).max(20).default([]), materialsOwner: z.enum(["service", "customer"]).default("service"), levelTemperature: z.string().trim().max(180).nullable().optional(), visualReference: z.string().trim().max(1_200).nullable().optional(), torqueNotes: z.array(z.string().trim().min(1).max(300)).max(12).default([]), levelProcedure: z.string().trim().max(500).nullable().optional(), servicePoints: z.array(z.string().trim().min(1).max(300)).max(16).default([]), criticalChecks: z.array(z.string().trim().min(1).max(300)).max(16).default([]), technicalWarnings: z.array(z.string().trim().min(1).max(300)).max(16).default([]),
  }).strict(),
  requestedProcedures: z.array(z.enum(QUOTE_AND_TECH_CARD_PROCEDURES)).max(2).default([]), requestedDates: z.string().trim().max(120).nullable().optional(), selectedProducts: z.array(ProductRowSchema).max(30).default([]), consumables: z.array(ProductRowSchema).max(20).default([]), rosskoItems: z.array(RosskoRowSchema).max(12).default([]), localCatalogChecked: z.boolean().default(false), fluidMissingLocally: z.boolean().default(false), softWarnings: z.array(z.string().trim().min(1).max(360)).max(16).default([]), evidence: z.array(QuoteAndTechCardEvidenceSchema).max(20).default([]),
}).strict();
export type QuoteAndTechCardInput = z.infer<typeof QuoteAndTechCardInputSchema>;

const SERVICE_ALIASES: Record<string, QuoteAndTechCardServiceType> = {
  engine_oil: "engine_oil", engine: "engine_oil", motor_oil: "engine_oil", oil_change: "engine_oil",
  automatic_transmission: "automatic_transmission", transmission_fluid: "automatic_transmission", atf: "automatic_transmission", automatic_gearbox: "automatic_transmission", automatic: "automatic_transmission", akpp: "automatic_transmission",
  cvt: "cvt", variator: "cvt", dsg: "dsg", dct: "dsg", robot: "dsg",
  manual_transmission: "manual_transmission", manual_gearbox: "manual_transmission", mt: "manual_transmission",
  transfer_case: "transfer_case", transfer: "transfer_case", differential: "differential", front_differential: "differential", rear_differential: "differential",
  awd_clutch: "awd_clutch", haldex: "awd_clutch", haldex_clutch: "awd_clutch", awd_coupling: "awd_clutch", four_wheel_drive_clutch: "awd_clutch",
  coolant: "coolant", antifreeze: "coolant", brake_fluid: "brake_fluid", brake: "brake_fluid",
};
const PROCEDURE_ALIASES: Record<string, QuoteAndTechCardProcedure> = {
  partial: "partial", partial_change: "partial", drain_and_fill: "partial", partial_replacement: "partial",
  filter_service: "filter_service", pan_filter: "filter_service", pan_and_filter: "filter_service", partial_with_filter: "filter_service", service_with_filter: "filter_service",
  machine_filter_service: "machine_filter_service", machine_with_filter: "machine_filter_service", machine_pan_filter: "machine_filter_service", apparatus_with_filter: "machine_filter_service",
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
export const QUOTE_AND_TECH_CARD_BUNDLE_TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["inputs"],
  properties: {
    inputs: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      description: "Независимые сервисы одного визита. Не объединяй объёмы или материалы между ними.",
      items: generatedInput,
    },
  },
};
function normalizeToken(value: unknown) { return text(value, 120).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-zа-я0-9_]/g, ""); }

export function normalizeQuoteAndTechCardServiceType(value: unknown, context: Record<string, unknown> = {}): QuoteAndTechCardServiceType | null {
  const candidates = [value, context.type, context.serviceType, context.serviceFamily, context.category, context.aggregateType].map(normalizeToken).filter(Boolean);
  for (const candidate of candidates) if (SERVICE_ALIASES[candidate]) return SERVICE_ALIASES[candidate];
  const joined = candidates.join("_");
  if (/cvt|вариатор/.test(joined)) return "cvt";
  if (/dsg|dct|робот/.test(joined)) return "dsg";
  if (/haldex|халдекс|awd.*(?:clutch|coupl)|(?:clutch|coupl).*awd|муфт/.test(joined)) return "awd_clutch";
  if (/atf|акпп|automatic|transmission/.test(joined)) return "automatic_transmission";
  return null;
}
export function normalizeQuoteAndTechCardProcedure(value: unknown): QuoteAndTechCardProcedure | null {
  const token = normalizeToken(value);
  if (PROCEDURE_ALIASES[token]) return PROCEDURE_ALIASES[token];
  if (/(?:machine|apparat|full).*(?:filter|фильтр|поддон)|(?:filter|фильтр|поддон).*(?:machine|apparat|full)/.test(token)) return "machine_filter_service";
  if (/filter|фильтр|поддон/.test(token)) return "filter_service";
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
  return MATERIAL_ROLES.includes(role as typeof MATERIAL_ROLES[number]) ? role : "consumable";
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
function normalizeServiceHardware(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = object(raw);
    const requirement = text(row.requirement, 30);
    return {
      type: text(row.type ?? row.name, 100),
      requirement: SERVICE_HARDWARE_REQUIREMENTS.includes(requirement as typeof SERVICE_HARDWARE_REQUIREMENTS[number]) ? requirement : "recommended",
      quantity: numberOrNull(row.quantity) ?? 1,
      evidence: text(row.evidence, 700) || null,
      requiredForQuote: row.requiredForQuote === true,
    };
  }).filter((item) => Boolean(item.type)).slice(0, 20);
}

/** Converts actual upstream spellings to canonical enums before Zod sees them. */
export function normalizeQuoteAndTechCardInput(value: unknown): Record<string, unknown> {
  const row = object(value);
  const sourceService = object(row.service);
  const serviceType = normalizeQuoteAndTechCardServiceType(sourceService.type ?? sourceService.serviceType ?? sourceService.serviceFamily ?? row.serviceType, sourceService) ?? "automatic_transmission";
  const procedureLists = [row.requestedProcedures, sourceService.requestedProcedures, sourceService.procedures].filter(Array.isArray) as unknown[][];
  const rawProcedures = [...procedureLists.flat(), sourceService.procedure, sourceService.procedureType, row.procedure].filter(Boolean);
  const procedures = [...new Set(rawProcedures.map(normalizeQuoteAndTechCardProcedure).filter((item): item is QuoteAndTechCardProcedure => Boolean(item)))].slice(0, 2);
  const vehicle = object(row.vehicle);
  const transmissionConfiguration = ["no_pan", "pan_and_filter", "two_coarse_filters", "not_applicable"].includes(text(sourceService.transmissionConfiguration, 60)) ? text(sourceService.transmissionConfiguration, 60) : null;
  const filterAccess = QUOTE_AND_TECH_CARD_FILTER_ACCESS.includes(text(sourceService.filterAccess ?? object(sourceService.filterPolicy).access, 60) as typeof QUOTE_AND_TECH_CARD_FILTER_ACCESS[number]) ? text(sourceService.filterAccess ?? object(sourceService.filterPolicy).access, 60) : "unknown";
  const materialsOwner = sourceService.materialsOwner === "customer" ? "customer" : "service";
  return {
    locationId: text(row.locationId ?? row.branchId, 120) || "dachnaya",
    vehicle: { id: text(vehicle.id ?? row.vehicleId, 160) || null, displayName: text(vehicle.displayName ?? vehicle.name ?? row.vehicleDisplayName, 180) || null, aggregateCode: text(vehicle.aggregateCode ?? row.aggregateCode, 120) || null, snapshot: object(vehicle.snapshot ?? row.vehicleSnapshot) },
    service: {
      type: serviceType, name: text(sourceService.name ?? sourceService.serviceName ?? row.serviceName, 180) || (serviceType === "automatic_transmission" ? "Замена жидкости АКПП" : "Техническое обслуживание"), aggregate: text(sourceService.aggregate ?? row.aggregate, 160) || null, requiredFluidSpec: text(sourceService.requiredFluidSpec ?? sourceService.fluidSpec ?? sourceService.specification ?? row.requiredFluidSpec, 160) || null, requiredFluidOemArticle: text(sourceService.requiredFluidOemArticle ?? sourceService.fluidOemArticle ?? row.requiredFluidOemArticle, 80) || null,
      partialTechnicalQuantityLiters: numberOrNull(sourceService.partialTechnicalQuantityLiters ?? sourceService.partialVolumeLiters ?? sourceService.partialQuantityLiters), totalTechnicalQuantityLiters: numberOrNull(sourceService.totalTechnicalQuantityLiters ?? sourceService.totalCapacityLiters ?? sourceService.totalQuantityLiters), standardTechnicalQuantityLiters: numberOrNull(sourceService.standardTechnicalQuantityLiters ?? sourceService.standardVolumeLiters ?? sourceService.quantityLiters), procedures: procedures.length ? procedures : undefined, transmissionConfiguration, filterAccess, filterEvidence: text(sourceService.filterEvidence ?? object(sourceService.filterPolicy).evidence, 700) || null, serviceHardware: normalizeServiceHardware(sourceService.serviceHardware ?? sourceService.hardware), materialsOwner, levelTemperature: text(sourceService.levelTemperature ?? sourceService.levelTemperatureRange, 180) || null, visualReference: text(sourceService.visualReference ?? sourceService.visualReferenceUrl, 1_200) || null, torqueNotes: stringList(sourceService.torqueNotes, 12), levelProcedure: text(sourceService.levelProcedure, 500) || null, servicePoints: stringList(sourceService.servicePoints, 16), criticalChecks: stringList(sourceService.criticalChecks, 16), technicalWarnings: stringList(sourceService.technicalWarnings, 16),
    },
    requestedProcedures: procedures, requestedDates: text(row.requestedDates ?? row.requestedDateRange ?? sourceService.requestedDates, 120) || null, selectedProducts: normalizeProductRows(row.selectedProducts), consumables: normalizeProductRows(row.consumables), rosskoItems: normalizeRosskoRows(row.rosskoItems), localCatalogChecked: row.localCatalogChecked === true, fluidMissingLocally: row.fluidMissingLocally === true, softWarnings: stringList(row.softWarnings, 16, 360), evidence: normalizeEvidence(row.evidence),
  };
}
export function parseQuoteAndTechCardInput(value: unknown): QuoteAndTechCardInput { return QuoteAndTechCardInputSchema.parse(normalizeQuoteAndTechCardInput(value)); }

/** Enforces local-first and the TGM internal-filter policy before pricing. */
export function quoteAndTechCardMaterials(input: QuoteAndTechCardInput, localFluidFound: boolean) {
  const suppressInternalFilterPartSearch = input.service.filterAccess === "internal_requires_disassembly";
  const isAllowedLocalItem = (item: { role: string }) => item.role !== "internal_filter";
  const allowedLocal = input.selectedProducts.filter(isAllowedLocalItem);
  const allowedConsumables = input.consumables.filter(isAllowedLocalItem);
  const requiredFluidArticle = text(input.service.requiredFluidOemArticle, 80);
  const allowedRossko = input.rosskoItems
    // An inaccessible internal filter closes the part-search branch entirely:
    // the sole exception is a verified ATF fallback when local fluid is absent.
    .filter((item) => !suppressInternalFilterPartSearch || item.role === "fluid" || item.role === "hardware")
    .filter(isAllowedLocalItem)
    .filter((item) => item.role !== "fluid" || (!localFluidFound && Boolean(requiredFluidArticle) && text(item.article, 80).toUpperCase() === requiredFluidArticle.toUpperCase()));
  return { selectedProducts: allowedLocal, consumables: allowedConsumables, rosskoItems: allowedRossko };
}

export function quoteAndTechCardFilterPolicy(filterAccess: QuoteAndTechCardInput["service"]["filterAccess"]): QuoteAndTechCardFilterPolicy {
  const base = {
    replaceFilter: false,
    requiredForQuote: false,
    searchPart: false,
    rosskoSearch: false,
  };
  if (filterAccess === "internal_requires_disassembly") {
    return {
      presence: "present",
      access: filterAccess,
      tgmAction: "do_not_replace",
      filterPartRequiredForQuote: false,
      panServiceRequired: false,
      reason: "Фильтр находится внутри агрегата; его замена требует разборки коробки и не входит в стандартную замену жидкости.",
      evidence: null,
      ...base,
      customerText: "Фильтр на этой АКПП находится внутри агрегата и для его замены требуется разборка коробки, поэтому при стандартной замене масла мы его не меняем.",
    };
  }
  if (filterAccess === "external_replaceable") return {
    presence: "present", access: filterAccess, tgmAction: "replace", filterPartRequiredForQuote: true, panServiceRequired: false,
    reason: "Внешний фильтр доступен без разборки агрегата и должен быть включён в подтверждённый сервис.", evidence: null,
    replaceFilter: true, requiredForQuote: true, searchPart: true, rosskoSearch: true,
    customerText: "Внешний фильтр входит в сервис только после подтверждения его применимости и цены.",
  };
  if (filterAccess === "pan_service") return {
    presence: "present", access: filterAccess, tgmAction: "replace_with_pan", filterPartRequiredForQuote: true, panServiceRequired: true,
    reason: "Фильтр доступен при снятии сервисного поддона и должен входить в сервис с поддоном.", evidence: null,
    replaceFilter: true, requiredForQuote: true, searchPart: true, rosskoSearch: true,
    customerText: "Фильтр доступен при снятии сервисного поддона: в сервис с поддоном его включаем только вместе с подтверждёнными прокладкой и крепежом.",
  };
  if (filterAccess === "integrated_with_pan") return {
    presence: "present", access: filterAccess, tgmAction: "replace_with_pan", filterPartRequiredForQuote: true, panServiceRequired: true,
    reason: "Фильтрующий элемент интегрирован с поддоном и заменяется единым сервисным узлом.", evidence: null,
    replaceFilter: true, requiredForQuote: true, searchPart: true, rosskoSearch: true,
    customerText: "Фильтрующий элемент интегрирован с поддоном: в расчёт включается подтверждённый сервисный узел в сборе.",
  };
  if (filterAccess === "none") return {
    presence: "not_present", access: filterAccess, tgmAction: "do_not_replace", filterPartRequiredForQuote: false, panServiceRequired: false,
    reason: "Для штатной процедуры отдельный обслуживаемый фильтр не предусмотрен.", evidence: null,
    ...base,
    customerText: "В штатной процедуре отдельный фильтр не предусмотрен.",
  };
  return {
    presence: "unknown", access: "unknown", tgmAction: "verify_before_quote", filterPartRequiredForQuote: false, panServiceRequired: false,
    reason: "Конструкция фильтра не подтверждена доступными данными; операция с фильтром не включается до верификации.", evidence: null,
    ...base,
    customerText: "Конструкция фильтра пока не подтверждена: в расчёт не включаем неподтверждённую операцию или деталь.",
  };
}

export function withFilterEvidence(policy: QuoteAndTechCardFilterPolicy, evidence: string | null | undefined): QuoteAndTechCardFilterPolicy {
  return { ...policy, evidence: text(evidence, 700) || null };
}

export const QuoteAndTechCardServicePackageSchema = z.object({
  procedure: z.enum(QUOTE_AND_TECH_CARD_PROCEDURES),
  diagnosticsRequired: z.boolean(),
  machineExchange: z.boolean(),
  chemicalFlush: z.boolean(),
  panRemoval: z.boolean(),
  filterReplacement: z.boolean(),
  levelAdjustment: z.boolean(),
  requiredParts: z.array(z.object({ type: z.enum(["external_filter", "integrated_pan"]), requiredForQuote: z.boolean(), evidence: z.string().max(700).nullable() }).strict()).max(4),
  requiredHardware: z.array(QuoteAndTechCardServiceHardwareSchema).max(20),
  includedOperations: z.array(z.string().min(1).max(200)).min(1).max(12),
}).strict();
export type QuoteAndTechCardServicePackage = z.infer<typeof QuoteAndTechCardServicePackageSchema>;

export function servicePackageForOption(input: { service: Pick<QuoteAndTechCardInput["service"], "serviceHardware"> }, policy: QuoteAndTechCardFilterPolicy, procedure: QuoteAndTechCardProcedure, separateFilterService = false): QuoteAndTechCardServicePackage {
  const machineExchange = procedure === "machine" || procedure === "machine_filter_service";
  const isFilterService = procedure === "filter_service" || procedure === "machine_filter_service";
  // When a generic request produces two scenarios, the base partial option is
  // explicitly a drain-and-fill.  It must not inherit the other option's
  // pan/filter package merely because that package is technically available.
  const useFilterPackage = isFilterService || (procedure !== "partial" && !separateFilterService);
  const filterReplacement = useFilterPackage && (policy.tgmAction === "replace" || policy.tgmAction === "replace_with_pan");
  const panRemoval = useFilterPackage && policy.panServiceRequired;
  const unresolvedFilterService = isFilterService && policy.access === "unknown";
  const requiredParts = useFilterPackage && policy.filterPartRequiredForQuote
    ? [{
      type: policy.access === "integrated_with_pan" ? "integrated_pan" as const : "external_filter" as const,
      requiredForQuote: true,
      evidence: policy.evidence,
    }]
    : unresolvedFilterService
      ? [{
        type: "external_filter" as const,
        requiredForQuote: true,
        evidence: null,
      }]
      : [];
  const includedOperations = [
    ...(machineExchange ? ["Диагностика АКПП до аппаратной замены", "Аппаратная замена жидкости"] : ["Слив и замена жидкости"]),
    ...(panRemoval ? ["Снятие сервисного поддона"] : unresolvedFilterService ? ["Проверка конструкции фильтра и сервисного комплекта"] : []),
    ...(filterReplacement ? [policy.access === "integrated_with_pan" ? "Замена поддона с интегрированным фильтром" : "Замена доступного фильтра"] : unresolvedFilterService ? ["Замена фильтра после VIN-подтверждения"] : []),
    "Контроль и корректировка уровня жидкости",
  ];
  return {
    procedure,
    diagnosticsRequired: machineExchange,
    machineExchange,
    chemicalFlush: false,
    panRemoval: panRemoval || unresolvedFilterService,
    filterReplacement: filterReplacement || unresolvedFilterService,
    levelAdjustment: true,
    requiredParts,
    requiredHardware: input.service.serviceHardware,
    includedOperations,
  };
}

export function customerMaterialDisplayName(catalogName: string, requiredSpecification?: string | null, supplierFallback = false) {
  const source = text(catalogName, 220);
  // ROSSKO may return an otherwise valid priced offer without the supplier's
  // product name. Do not expose the synthetic "Запчасть <article>" fallback
  // to a customer as if it were a material name. The verified specification
  // remains the honest, useful description; the raw article stays in the
  // internal quote line for audit and ordering.
  if (supplierFallback && /^(?:запчасть|деталь|товар)(?:\s|$)/iu.test(source)) {
    const specification = text(requiredSpecification, 160);
    return specification ? `Жидкость ${specification} (поставщик)` : "Жидкость по допуску (поставщик)";
  }
  if (/\bvalvoline\b/iu.test(source)) return "Valvoline ATF";
  const cleaned = source
    .replace(/масло\s+трансмиссионное/iu, "")
    .replace(/\batf\s*\/\s*cvt\b/iu, "ATF")
    .replace(/[,;]?\s*\d+(?:[.,]\d+)?\s*л\.?/iu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || "Жидкость по допуску";
}

export function customerProcedureDisplayName(serviceType: QuoteAndTechCardServiceType, procedure: QuoteAndTechCardProcedure) {
  if (isTransmission(serviceType)) {
    if (procedure === "machine") return "Аппаратная замена масла в АКПП";
    if (procedure === "machine_filter_service") return "Аппаратная замена масла в АКПП с фильтром";
    if (procedure === "filter_service") return "Сервис АКПП с фильтром";
    if (procedure === "partial") return "Частичная замена масла в АКПП без снятия поддона";
  }
  return procedure === "standard" ? "Замена масла" : procedure === "machine" ? "Аппаратная замена масла" : "Частичная замена масла";
}

/** One billable volume is used by the quote line, reservation and snapshot. */
export function applyBillableQuantityToPrimaryFluid<T extends { productId: string; quantity: number; role?: string }>(rows: T[], billableQuantityLiters: number | null, transmission: boolean) {
  if (!transmission || billableQuantityLiters == null) return rows;
  const primaryIndex = rows.findIndex((row) => row.role === "fluid");
  const resolvedPrimaryIndex = primaryIndex >= 0 ? primaryIndex : rows.length === 1 ? 0 : -1;
  if (resolvedPrimaryIndex < 0) return rows;
  // An OEM reference is never a second primary fluid. Keep one sellable fluid
  // line and carry exactly the canonical billable amount into the calculator.
  return rows
    .filter((row, index) => index === resolvedPrimaryIndex || row.role !== "fluid")
    .map((row, index) => index === resolvedPrimaryIndex ? { ...row, quantity: billableQuantityLiters, role: "fluid" } : row);
}

/**
 * The builder owns the supplier fallback. It only appears after a failed local
 * compatibility-and-stock check and is limited to the verified OEM article,
 * never a model-suggested alternative ATF.
 */
export function quoteAndTechCardSupplierRows(input: QuoteAndTechCardInput, localFluidFound: boolean, quantity: number | null) {
  const materialRows = quoteAndTechCardMaterials(input, localFluidFound);
  const rows = materialRows.rosskoItems.map(({ article, brand, offerId, quantity: itemQuantity, role }) => ({ article, brand: brand ?? null, offerId: offerId ?? null, quantity: itemQuantity, role }));
  const requiredFluidArticle = text(input.service.requiredFluidOemArticle, 80);
  const canAddFallback = input.service.materialsOwner === "service"
    && !localFluidFound
    && Boolean(requiredFluidArticle)
    && typeof quantity === "number"
    && Number.isFinite(quantity)
    && quantity > 0;
  const hasRequiredFluid = rows.some((row) => row.article.toUpperCase() === requiredFluidArticle.toUpperCase());
  if (canAddFallback && !hasRequiredFluid) rows.unshift({ article: requiredFluidArticle, brand: null, offerId: null, quantity, role: "fluid" });
  return rows;
}

export type QuoteAndTechCardRules = { literRoundingStep: number; transmissionMachineExchangeMultiplier: number; transmissionMinimumBillableLiters: number; maxTechnicalVerificationPasses: number };
export const DEFAULT_QUOTE_AND_TECH_CARD_RULES: QuoteAndTechCardRules = { literRoundingStep: 1, transmissionMachineExchangeMultiplier: 1.7, transmissionMinimumBillableLiters: 0, maxTechnicalVerificationPasses: 2 };
export const QuoteAndTechCardQuantityTraceSchema = z.object({
  sourceCapacity: z.number().positive().nullable(),
  sourceCapacityEvidence: z.string().max(700).nullable(),
  configuredMultiplier: z.number().positive(),
  configuredAdditionalVolume: z.number().nonnegative(),
  calculationMode: z.string().min(1).max(100),
  rawCalculatedQuantity: z.number().positive().nullable(),
  packageStep: z.number().positive(),
  roundingRule: z.string().min(1).max(180),
  technicalQuantity: z.number().positive().nullable(),
  billableQuantity: z.number().positive().nullable(),
}).strict();
export type QuoteAndTechCardQuantityTrace = z.infer<typeof QuoteAndTechCardQuantityTraceSchema>;
export type QuoteAndTechCardPlanOption = {
  code: QuoteAndTechCardProcedure;
  label: string;
  technicalQuantityLiters: number | null;
  billableQuantityLiters: number | null;
  quantityTrace: QuoteAndTechCardQuantityTrace;
  servicePackage: QuoteAndTechCardServicePackage;
  blocker: { code: string; message: string; requiredToContinue: string } | null;
};
export type QuoteAndTechCardPlan = { input: QuoteAndTechCardInput; rules: QuoteAndTechCardRules; isTransmission: boolean; requestedProcedures: QuoteAndTechCardProcedure[]; filterPolicy: QuoteAndTechCardFilterPolicy; hardBlockers: Array<{ code: string; message: string; requiredToContinue: string }>; quoteWarnings: string[]; techCardWarnings: string[]; options: QuoteAndTechCardPlanOption[] };
function isTransmission(type: QuoteAndTechCardServiceType) { return ["automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential", "awd_clutch"].includes(type); }
function roundUp(value: number, step: number) { const normalizedStep = Math.max(0.1, Math.min(10, step || 1)); return Math.ceil((value - 1e-8) / normalizedStep) * normalizedStep; }

function quantitySource(input: QuoteAndTechCardInput, code: QuoteAndTechCardProcedure) {
  if (code === "machine" || code === "machine_filter_service") return { capacity: input.service.totalTechnicalQuantityLiters, mode: "total_capacity_x_machine_multiplier" } as const;
  if (code === "partial" || code === "filter_service") return { capacity: input.service.partialTechnicalQuantityLiters ?? input.service.standardTechnicalQuantityLiters, mode: "partial_capacity" } as const;
  return { capacity: input.service.standardTechnicalQuantityLiters ?? input.service.partialTechnicalQuantityLiters, mode: "standard_capacity" } as const;
}

function sourceCapacityEvidence(input: QuoteAndTechCardInput, capacity: number | null | undefined) {
  if (capacity == null) return null;
  const matching = input.evidence.find((item) => /(?:объ[её]м|capacity|литр|\bл\b)/iu.test(item.fact) && item.status !== "unavailable");
  return matching ? `${matching.source}: ${matching.fact}`.slice(0, 700) : "Подтверждённый технический объём из service context.";
}

function technicalIdentityText(input: QuoteAndTechCardInput) {
  return [input.vehicle.displayName, input.vehicle.aggregateCode, input.service.aggregate, JSON.stringify(input.vehicle.snapshot ?? {})].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
}

function hasConfirmedHybridBranchEvidence(input: QuoteAndTechCardInput) {
  const aggregate = text(input.vehicle.aggregateCode ?? input.service.aggregate, 120).toLocaleLowerCase("ru-RU");
  const spec = text(input.service.requiredFluidSpec, 160).toLocaleLowerCase("ru-RU");
  return input.evidence.some((item) => item.status === "confirmed" && Boolean(item.url) && /hybrid|гибрид|phev|plug[ -]?in/iu.test(item.fact) && (!aggregate || item.fact.toLocaleLowerCase("ru-RU").includes(aggregate)) && (!spec || item.fact.toLocaleLowerCase("ru-RU").includes(spec)));
}

const SAFETY_CRITICAL_POWERTRAIN_PROFILES = [
  {
    matches: (identity: string) => /audi\s+q5.*(?:hybrid|гибрид)|(?:hybrid|гибрид).*audi\s+q5/iu.test(identity),
    aggregate: "0BW",
    fluidCode: "G060162A2",
    source: "Audi Q5 Hybrid 0BW / G 060 162 A2 (OEM service information)",
  },
] as const;

function compactTechnicalCode(value: string) {
  return value.toLocaleUpperCase("ru-RU").replace(/[^A-ZА-Я0-9]/g, "");
}

export function createQuoteAndTechCardPlan(rawInput: unknown, rawRules: Partial<QuoteAndTechCardRules> = {}): QuoteAndTechCardPlan {
  const input = parseQuoteAndTechCardInput(rawInput);
  const rules: QuoteAndTechCardRules = { literRoundingStep: Number.isFinite(rawRules.literRoundingStep) ? Math.max(0.1, Math.min(10, Number(rawRules.literRoundingStep))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.literRoundingStep, transmissionMachineExchangeMultiplier: Number.isFinite(rawRules.transmissionMachineExchangeMultiplier) ? Math.max(1, Math.min(3, Number(rawRules.transmissionMachineExchangeMultiplier))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.transmissionMachineExchangeMultiplier, transmissionMinimumBillableLiters: Number.isFinite(rawRules.transmissionMinimumBillableLiters) ? Math.max(0, Math.min(200, Number(rawRules.transmissionMinimumBillableLiters))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.transmissionMinimumBillableLiters, maxTechnicalVerificationPasses: Number.isFinite(rawRules.maxTechnicalVerificationPasses) ? Math.round(Math.max(0, Math.min(2, Number(rawRules.maxTechnicalVerificationPasses)))) : DEFAULT_QUOTE_AND_TECH_CARD_RULES.maxTechnicalVerificationPasses };
  const transmission = isTransmission(input.service.type);
  const hardBlockers: QuoteAndTechCardPlan["hardBlockers"] = [];
  if (!text(input.vehicle.displayName, 180)) hardBlockers.push({ code: "VEHICLE_NOT_IDENTIFIED", message: "Автомобиль или агрегат не определён достаточно для проверки совместимости.", requiredToContinue: "Укажите VIN либо марку, модель, год и агрегат." });
  if (!text(input.service.requiredFluidSpec, 160)) hardBlockers.push({ code: "SPECIFICATION_NOT_CONFIRMED", message: "Не подтверждена обязательная спецификация жидкости.", requiredToContinue: "Нужен допуск OEM или документированный аналог по спецификации." });
  const identityText = technicalIdentityText(input);
  const isAutomaticService = ["automatic_transmission", "cvt", "dsg"].includes(input.service.type);
  if (isAutomaticService && /(?:\bmanual\b|\bmechanical\b|мкпп|механическ)/iu.test(identityText)) {
    hardBlockers.push({ code: "TRANSMISSION_SERVICE_MISMATCH", message: "VIN/карточка автомобиля указывает механическую трансмиссию, поэтому ATF-сценарий не создаётся.", requiredToContinue: "Подтвердить тип агрегата по маркировке или выбрать обслуживание МКПП." });
  }
  const hybridVehicle = /hybrid|гибрид|phev|plug[ -]?in/iu.test(identityText);
  if (isAutomaticService && hybridVehicle && !hasConfirmedHybridBranchEvidence(input)) {
    hardBlockers.push({ code: "HYBRID_TRANSMISSION_NOT_VERIFIED", message: "Для гибридной трансмиссии не подтверждена связка агрегат + допуск жидкости по источнику OEM.", requiredToContinue: "Проверить код гибридного агрегата и допуск жидкости по VIN/OEM-документации; до этого смету не формировать." });
  }
  for (const profile of SAFETY_CRITICAL_POWERTRAIN_PROFILES) {
    if (!profile.matches(identityText)) continue;
    const aggregate = compactTechnicalCode(text(input.vehicle.aggregateCode ?? input.service.aggregate, 160));
    const specification = compactTechnicalCode(text(input.service.requiredFluidSpec, 160));
    if (aggregate !== profile.aggregate || !specification.includes(profile.fluidCode)) {
      hardBlockers.push({ code: "SAFETY_CRITICAL_POWERTRAIN_PROFILE_MISMATCH", message: `Выбранная ветка агрегата или жидкости противоречит обязательному профилю ${profile.source}.`, requiredToContinue: `Использовать подтверждённую ветку ${profile.aggregate} и жидкость ${profile.fluidCode}; не применять универсальную ветку АКПП.` });
    }
  }
  const quoteWarnings = [
    ...(input.localCatalogChecked ? [] : ["Локальный каталог ещё не подтверждён: смета будет предварительной."]),
    ...(isAutomaticService && input.service.filterAccess === "unknown" ? ["Конструкция фильтра не подтверждена: частичная замена выполняется без снятия поддона, а сервис с фильтром вынесен в отдельный вариант до VIN-подтверждения."] : []),
  ];
  const filterPolicy = withFilterEvidence(quoteAndTechCardFilterPolicy(input.service.filterAccess), input.service.filterEvidence);
  const suppressInternalFilterSearch = input.service.filterAccess === "internal_requires_disassembly";
  const excludesInternalFilterSearch = (value: string) => suppressInternalFilterSearch && /(фильтр|filter|epc|oe[\s-]?номер|заказ)/iu.test(value);
  const techCardWarnings = [...input.softWarnings, ...input.service.technicalWarnings].filter((item) => !excludesInternalFilterSearch(item));
  if (!input.service.torqueNotes.length) techCardWarnings.push("Моменты затяжки не найдены: сверить по OEM перед работой.");
  if (!input.service.visualReference) techCardWarnings.push("Визуальная ссылка для техкарты не найдена.");
  const requestedProcedures: readonly QuoteAndTechCardProcedure[] = input.requestedProcedures.length ? input.requestedProcedures : input.service.procedures?.length ? input.service.procedures : transmission ? ["partial"] : ["standard"];
  const configured = (QUOTE_AND_TECH_CARD_PROCEDURES.filter((procedure) => requestedProcedures.includes(procedure)) as QuoteAndTechCardProcedure[]).slice(0, 2);
  const hasSeparateFilterService = configured.includes("filter_service") || configured.includes("machine_filter_service");
  const options = configured.slice(0, 2).map((code): QuoteAndTechCardPlanOption => {
    const source = quantitySource(input, code);
    const multiplier = code === "machine" || code === "machine_filter_service" ? rules.transmissionMachineExchangeMultiplier : 1;
    const rawCalculatedQuantity = source.capacity == null ? null : source.capacity * multiplier;
    const technicalQuantityLiters = rawCalculatedQuantity == null ? null : Math.round(rawCalculatedQuantity * 1_000) / 1_000;
    const billableQuantityLiters = technicalQuantityLiters == null ? null : roundUp(Math.max(technicalQuantityLiters, transmission ? rules.transmissionMinimumBillableLiters : 0), rules.literRoundingStep);
    const quantityTrace: QuoteAndTechCardQuantityTrace = {
      sourceCapacity: source.capacity ?? null,
      sourceCapacityEvidence: sourceCapacityEvidence(input, source.capacity),
      configuredMultiplier: multiplier,
      configuredAdditionalVolume: 0,
      calculationMode: source.mode,
      rawCalculatedQuantity,
      packageStep: rules.literRoundingStep,
      roundingRule: `Округление вверх до шага ${rules.literRoundingStep} л; минимум ${transmission ? rules.transmissionMinimumBillableLiters : 0} л.`,
      technicalQuantity: technicalQuantityLiters,
      billableQuantity: billableQuantityLiters,
    };
    const isFilterService = code === "filter_service" || code === "machine_filter_service";
    const filterServiceNotConfirmed = isFilterService && filterPolicy.access === "unknown";
    const filterServiceNotApplicable = isFilterService && (filterPolicy.access === "none" || filterPolicy.access === "internal_requires_disassembly");
    const blocker = billableQuantityLiters == null
      ? { code: "NO_MATERIAL_PRICE", message: "Не определён рабочий объём жидкости для этого варианта.", requiredToContinue: "Подтвердить рабочий объём жидкости для выбранной процедуры." }
      : filterServiceNotConfirmed
        ? { code: "FILTER_SERVICE_CONFIGURATION_NOT_CONFIRMED", message: "Для сервиса с поддоном и фильтром не подтверждена конструкция фильтра и состав сервисного комплекта.", requiredToContinue: "Подтвердить по VIN конструкцию фильтра, номер фильтра или поддона, прокладку и необходимый крепёж." }
        : filterServiceNotApplicable
          ? { code: "FILTER_SERVICE_NOT_APPLICABLE", message: filterPolicy.reason, requiredToContinue: "Выбрать частичную замену без снятия поддона либо подтвердить иной применимый пакет обслуживания." }
          : null;
    return {
      code,
      label: code === "machine" ? "Аппаратная замена" : code === "machine_filter_service" ? "Аппаратная замена с фильтром" : code === "filter_service" ? "Сервис с фильтром" : code === "partial" ? "Частичная замена без поддона" : input.service.name,
      technicalQuantityLiters,
      billableQuantityLiters,
      quantityTrace,
      servicePackage: servicePackageForOption(input, filterPolicy, code, hasSeparateFilterService),
      blocker,
    };
  });
  return { input, rules, isTransmission: transmission, requestedProcedures: [...requestedProcedures], filterPolicy, hardBlockers, quoteWarnings, techCardWarnings: [...new Set(techCardWarnings)], options };
}

const QuoteLineSchema = z.object({ source: z.string().trim().max(80).optional(), type: z.string().trim().max(80).nullable().optional(), role: z.enum(["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "labor", "rounding", "unknown"]).optional(), productId: z.string().trim().max(160).nullable().optional(), name: z.string().trim().min(1).max(220), catalogName: z.string().trim().min(1).max(220), customerDisplayName: z.string().trim().min(1).max(160), article: z.string().trim().max(120).nullable().optional(), quantity: z.number().positive(), unitPriceCents: z.number().int().nonnegative().optional(), totalCents: z.number().int().nonnegative(), internalOnly: z.boolean().default(false) }).strict();
const QuoteAndTechCardMaterialCandidateSchema = z.object({ productId: z.string().max(160), catalogName: z.string().max(220), compatible: z.boolean(), availableQuantity: z.number().nonnegative(), requiredQuantity: z.number().positive(), packageLiters: z.number().positive(), unitPriceCents: z.number().int().nonnegative(), eligible: z.boolean(), exclusionReason: z.enum(["incompatible_specification", "price_missing", "stock_insufficient"]).nullable() }).strict();
export const QuoteAndTechCardMaterialSelectionTraceSchema = z.object({
  requiredSpecification: z.string().max(160).nullable(),
  oemRequirement: z.object({ specification: z.string().max(160).nullable(), evidence: z.string().max(700).nullable() }).strict(),
  oemReference: z.object({ brand: z.string().max(100).nullable(), article: z.string().max(80).nullable() }).strict(),
  localCandidates: z.array(QuoteAndTechCardMaterialCandidateSchema).max(100),
  selectedLocalCandidate: QuoteAndTechCardMaterialCandidateSchema.nullable(),
  compatibleProduct: z.object({ productId: z.string().max(160).nullable(), catalogName: z.string().max(220).nullable(), compatibilityEvidence: z.string().max(700).nullable() }).strict(),
  selectedProduct: z.object({ source: z.enum(["local_catalog", "supplier", "customer_materials", "none"]), productId: z.string().max(160).nullable(), catalogName: z.string().max(220).nullable(), customerDisplayName: z.string().max(160).nullable() }).strict(),
  selectedSellableProduct: z.object({ source: z.enum(["local_catalog", "supplier", "customer_materials", "none"]), productId: z.string().max(160).nullable(), catalogName: z.string().max(220).nullable(), customerDisplayName: z.string().max(160).nullable() }).strict(),
  localAvailableQuantity: z.number().nonnegative().nullable(),
  requiredQuantity: z.number().positive().nullable(),
  fallbackSupplierUsed: z.boolean(),
  fallbackReason: z.string().max(360).nullable(),
}).strict();
export type QuoteAndTechCardMaterialSelectionTrace = z.infer<typeof QuoteAndTechCardMaterialSelectionTraceSchema>;
export const QuoteAndTechCardQuoteOptionSchema = z.object({ code: z.enum(QUOTE_AND_TECH_CARD_PROCEDURES), label: z.string().min(1).max(180), customerDisplayName: z.string().min(1).max(180), status: z.enum(["ready", "preliminary", "blocked"]), technicalQuantityLiters: z.number().positive().nullable(), billableQuantityLiters: z.number().positive().nullable(), quantityTrace: QuoteAndTechCardQuantityTraceSchema, servicePackage: QuoteAndTechCardServicePackageSchema, materialSelectionTrace: QuoteAndTechCardMaterialSelectionTraceSchema, lines: z.array(QuoteLineSchema).max(40), totalCents: z.number().int().nonnegative().nullable(), maximumTotalCents: z.number().int().nonnegative().nullable(), validUntil: z.string().max(100).nullable(), blockers: z.array(z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(360), requiredToContinue: z.string().min(1).max(360) }).strict()).max(6), warnings: z.array(z.string().min(1).max(360)).max(20) }).strict();
export type QuoteAndTechCardQuoteOption = z.infer<typeof QuoteAndTechCardQuoteOptionSchema>;
export const QuoteAndTechCardQuoteSetSchema = z.object({ id: z.string().min(1).max(240), vehicleId: z.string().max(160).nullable(), serviceType: z.enum(QUOTE_AND_TECH_CARD_SERVICE_TYPES), requestedProcedures: z.array(z.enum(QUOTE_AND_TECH_CARD_PROCEDURES)).min(1).max(2), requestedDates: z.string().max(120).nullable(), status: z.enum(["ready", "preliminary", "blocked"]), confidence: z.enum(["confirmed", "preliminary"]), options: z.array(QuoteAndTechCardQuoteOptionSchema).min(1).max(2), hardBlockers: z.array(z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(360), requiredToContinue: z.string().min(1).max(360) }).strict()).max(8), warnings: z.array(z.string().min(1).max(360)).max(20) }).strict();
export type QuoteAndTechCardQuoteSet = z.infer<typeof QuoteAndTechCardQuoteSetSchema>;
export const QuoteAndTechCardResultSchema = z.object({
  scenario: z.literal("quote_and_tech_card"), status: z.enum(["ready", "partial", "blocked"]), vehicle: z.object({ displayName: z.string().min(1).max(180), aggregate: z.string().max(160).nullable() }).strict(),
  quoteSet: QuoteAndTechCardQuoteSetSchema,
  techCard: z.object({ status: z.enum(["ready", "partial", "blocked"]), serviceName: z.string().min(1).max(180), serviceType: z.enum(QUOTE_AND_TECH_CARD_SERVICE_TYPES), requiredFluidSpec: z.string().max(160).nullable(), filterPolicy: QuoteAndTechCardFilterPolicySchema, filterSummary: z.string().min(1).max(360), filter: QuoteAndTechCardFilterPolicySchema, procedureVolumes: z.array(z.object({ code: z.enum(QUOTE_AND_TECH_CARD_PROCEDURES), customerDisplayName: z.string().max(180), technicalQuantityLiters: z.number().positive().nullable(), billableQuantityLiters: z.number().positive().nullable() }).strict()).max(2), servicePackages: z.array(QuoteAndTechCardServicePackageSchema).max(2), serviceHardware: z.array(QuoteAndTechCardServiceHardwareSchema).max(20), levelTemperature: z.string().max(180).nullable(), levelProcedure: z.string().max(500).nullable(), servicePoints: z.array(z.string().min(1).max(300)).max(16), torqueNotes: z.array(z.string().min(1).max(300)).max(12), criticalChecks: z.array(z.string().min(1).max(300)).max(16), selectedMaterial: z.object({ name: z.string().max(160), catalogName: z.string().max(220), customerDisplayName: z.string().max(160), specification: z.string().max(160).nullable(), quantity: z.number().positive(), compatibilityEvidence: z.string().max(700).nullable() }).nullable(), warnings: z.array(z.string().min(1).max(360)).max(20) }).strict(),
  customerMessage: z.object({ status: z.enum(["ready", "blocked"]), text: z.string().max(4_000) }).strict(), evidence: z.array(QuoteAndTechCardEvidenceSchema).max(20),
}).strict();
export type QuoteAndTechCardResult = z.infer<typeof QuoteAndTechCardResultSchema>;

/**
 * A complex visit keeps every requested service in its own established
 * QuoteSet.  The bundle is only a presentation and customer-message wrapper:
 * it never combines quantities, prices or technical assumptions across
 * aggregates.
 */
export const QuoteAndTechCardBundleSchema = z.object({
  scenario: z.literal("quote_and_tech_card_bundle"),
  status: z.enum(["ready", "partial", "blocked"]),
  vehicle: z.object({ displayName: z.string().min(1).max(180), aggregate: z.string().max(160).nullable() }).strict(),
  results: z.array(QuoteAndTechCardResultSchema).min(2).max(6),
  customerMessage: z.object({ status: z.enum(["ready", "blocked"]), text: z.string().max(12_000) }).strict(),
  evidence: z.array(QuoteAndTechCardEvidenceSchema).max(60),
}).strict();
export type QuoteAndTechCardBundle = z.infer<typeof QuoteAndTechCardBundleSchema>;
export type QuoteAndTechCardArtifact = QuoteAndTechCardResult | QuoteAndTechCardBundle;

/**
 * Result attachments are durable chat records.  Keep the previous public
 * `quote` shape readable while new runs use QuoteSet, so opening an older
 * thread or clicking its client-message action cannot make its tech card
 * disappear during this contract migration.
 */
function upgradeLegacyQuoteAndTechCard(row: Record<string, unknown>) {
  if (QuoteAndTechCardResultSchema.safeParse(row).success) return row;
  const { quote: legacyQuoteValue, quoteSet: existingQuoteSetValue, ...publicResult } = row;
  const legacyQuote = object(existingQuoteSetValue ?? legacyQuoteValue);
  const legacyOptions = Array.isArray(legacyQuote.options) ? legacyQuote.options.map(object) : [];
  const serviceType = text(object(row.techCard).serviceType, 80);
  const canonicalServiceType = QUOTE_AND_TECH_CARD_SERVICE_TYPES.includes(serviceType as QuoteAndTechCardServiceType) ? serviceType as QuoteAndTechCardServiceType : "automatic_transmission";
  const legacyFilter = object(object(row.techCard).filter);
  const legacyFilterText = text(object(row.techCard).filterPolicy, 360);
  const legacyFilterAccess: QuoteAndTechCardInput["service"]["filterAccess"] = legacyFilter.replaceFilter === true
    ? "external_replaceable"
    : /разборк|внутр/iu.test(legacyFilterText) ? "internal_requires_disassembly"
    : "unknown";
  const normalizedLegacyFilter = withFilterEvidence(quoteAndTechCardFilterPolicy(legacyFilterAccess), null);
  const options: Array<Record<string, unknown>> = legacyOptions.map((legacyOption) => {
    const code = QUOTE_AND_TECH_CARD_PROCEDURES.includes(text(legacyOption.code, 40) as QuoteAndTechCardProcedure) ? text(legacyOption.code, 40) as QuoteAndTechCardProcedure : "standard";
    const technicalQuantity = numberOrNull(legacyOption.technicalQuantityLiters);
    const billableQuantity = numberOrNull(legacyOption.billableQuantityLiters);
    const primaryFluid = (Array.isArray(legacyOption.lines) ? legacyOption.lines.map(object) : []).find((line) => text(line.role, 40) === "fluid");
    const source = text(primaryFluid?.source, 80);
    return {
      ...legacyOption,
      quantityTrace: {
        sourceCapacity: technicalQuantity,
        sourceCapacityEvidence: null,
        configuredMultiplier: 1,
        configuredAdditionalVolume: 0,
        calculationMode: "legacy_snapshot",
        rawCalculatedQuantity: technicalQuantity,
        packageStep: 1,
        roundingRule: "Сохранённый расчёт: правило округления не было записано.",
        technicalQuantity,
        billableQuantity,
      },
      servicePackage: servicePackageForOption({ service: { serviceHardware: [] } }, normalizedLegacyFilter, code),
      materialSelectionTrace: {
        requiredSpecification: text(object(row.techCard).requiredFluidSpec, 160) || null,
        oemRequirement: { specification: text(object(row.techCard).requiredFluidSpec, 160) || null, evidence: null },
        oemReference: { brand: null, article: null },
        localCandidates: [],
        selectedLocalCandidate: null,
        compatibleProduct: { productId: text(primaryFluid?.productId, 160) || null, catalogName: text(primaryFluid?.catalogName ?? primaryFluid?.name, 220) || null, compatibilityEvidence: null },
        selectedProduct: primaryFluid ? {
          source: source === "local" || source === "local_catalog" ? "local_catalog" : source === "rossko" || source === "supplier" ? "supplier" : "customer_materials",
          productId: text(primaryFluid.productId, 160) || null,
          catalogName: text(primaryFluid.catalogName ?? primaryFluid.name, 220) || null,
          customerDisplayName: text(primaryFluid.customerDisplayName ?? primaryFluid.name, 160) || null,
        } : { source: "none", productId: null, catalogName: null, customerDisplayName: null },
        selectedSellableProduct: primaryFluid ? {
          source: source === "local" || source === "local_catalog" ? "local_catalog" : source === "rossko" || source === "supplier" ? "supplier" : "customer_materials",
          productId: text(primaryFluid.productId, 160) || null,
          catalogName: text(primaryFluid.catalogName ?? primaryFluid.name, 220) || null,
          customerDisplayName: text(primaryFluid.customerDisplayName ?? primaryFluid.name, 160) || null,
        } : { source: "none", productId: null, catalogName: null, customerDisplayName: null },
        localAvailableQuantity: null,
        requiredQuantity: billableQuantity,
        fallbackSupplierUsed: source === "rossko" || source === "supplier",
        fallbackReason: null,
      },
    };
  });
  const techCard = object(row.techCard);
  return {
    ...publicResult,
    quoteSet: {
      id: `legacy:${text(object(row.vehicle).displayName, 160) || "quote"}:${options.map((option) => text(option.code, 40)).join("+")}`.slice(0, 240),
      vehicleId: null,
      serviceType: canonicalServiceType,
      requestedProcedures: options.map((option) => text(option.code, 40)).filter((code): code is QuoteAndTechCardProcedure => QUOTE_AND_TECH_CARD_PROCEDURES.includes(code as QuoteAndTechCardProcedure)).slice(0, 2),
      requestedDates: null,
      status: text(legacyQuote.status, 40) || "blocked",
      confidence: text(legacyQuote.confidence, 40) || "preliminary",
      options,
      hardBlockers: legacyQuote.hardBlockers ?? [],
      warnings: legacyQuote.warnings ?? [],
    },
    techCard: {
      ...techCard,
      serviceType: canonicalServiceType,
      filterPolicy: normalizedLegacyFilter,
      filterSummary: legacyFilterText || normalizedLegacyFilter.customerText,
      filter: normalizedLegacyFilter,
      procedureVolumes: options.map((option) => ({
        code: option.code,
        customerDisplayName: text(option.customerDisplayName, 180),
        technicalQuantityLiters: numberOrNull(option.technicalQuantityLiters),
        billableQuantityLiters: numberOrNull(option.billableQuantityLiters),
      })),
      servicePackages: options.map((option) => option.servicePackage),
      serviceHardware: [],
    },
  };
}

export function parseQuoteAndTechCardResult(value: unknown): QuoteAndTechCardResult | null {
  const row = object(value);
  const publicKeys = new Set(["scenario", "status", "vehicle", "quote", "quoteSet", "techCard", "customerMessage", "evidence"]);
  if (Object.keys(row).some((key) => !publicKeys.has(key))) return null;
  const candidate = upgradeLegacyQuoteAndTechCard(row);
  const parsed = QuoteAndTechCardResultSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function parseQuoteAndTechCardArtifact(value: unknown): QuoteAndTechCardArtifact | null {
  const row = object(value);
  if (row.scenario === "quote_and_tech_card_bundle") {
    const parsed = QuoteAndTechCardBundleSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }
  return parseQuoteAndTechCardResult(row);
}
/**
 * The tool envelope contains operational metadata (for example a quote
 * snapshot to persist) in addition to the customer-facing contract.  Keep
 * the public schema strict, but validate only its declared fields here.
 */
export function parseQuoteAndTechCardToolResult(value: unknown): QuoteAndTechCardArtifact | null {
  const row = object(value);
  if (row.scenario === "quote_and_tech_card_bundle") {
    return parseQuoteAndTechCardArtifact({
      scenario: row.scenario,
      status: row.status,
      vehicle: row.vehicle,
      results: row.results,
      customerMessage: row.customerMessage,
      evidence: row.evidence,
    });
  }
  return parseQuoteAndTechCardResult({
    scenario: row.scenario,
    status: row.status,
    vehicle: row.vehicle,
    quoteSet: row.quoteSet ?? row.quote,
    techCard: row.techCard,
    customerMessage: row.customerMessage,
    evidence: row.evidence,
  });
}
export function quoteStatus(options: Array<{ status: "ready" | "preliminary" | "blocked" }>, hardBlockers: unknown[]) { if (hardBlockers.length || !options.some((option) => option.status !== "blocked")) return "blocked" as const; return options.every((option) => option.status === "ready") ? "ready" as const : "preliminary" as const; }
export function scenarioStatus(quote: "ready" | "preliminary" | "blocked", techCard: "ready" | "partial" | "blocked", customerMessage: "ready" | "blocked") { if (quote === "blocked") return "blocked" as const; return quote === "ready" && techCard === "ready" && customerMessage === "ready" ? "ready" as const : "partial" as const; }

export type QuoteAndTechCardCustomerMessageMode = "short_with_price" | "short_without_price" | "detailed_with_price" | "only_final_price" | "recommendation";

/** Formatting only: quote values arrive already calculated and are never re-rounded here. */
export function customerMoneyFromCents(cents: number) {
  const integerCents = Math.trunc(cents);
  const rubles = Math.trunc(integerCents / 100);
  const kopecks = Math.abs(integerCents % 100);
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(rubles)}${kopecks ? `,${String(kopecks).padStart(2, "0")}` : ""} ₽`;
}

function customerVehicleDisplayName(value: string) {
  return value
    .replace(/(?:\s*[·,;—-]\s*)?(?:vin\s*[:№#-]?\s*)?[A-HJ-NPR-Z0-9]{17}\b/giu, "")
    .replace(/(?:[·,;—-]\s*)?vin\s*[:№#-]?\s*$/iu, "")
    .replace(/\s{2,}/g, " ")
    .trim() || value;
}

function customerQuantity(value: number | null) { return value == null ? "—" : String(value); }

export function buildQuoteAndTechCardCustomerMessage(input: Pick<QuoteAndTechCardResult, "vehicle" | "quoteSet" | "techCard">, mode: QuoteAndTechCardCustomerMessageMode = "detailed_with_price", recommendation: string | null = null): QuoteAndTechCardResult["customerMessage"] {
  const ready = input.quoteSet.options.filter((option) => option.status !== "blocked" && option.totalCents != null);
  if (!ready.length) { const blocker = input.quoteSet.hardBlockers[0] ?? input.quoteSet.options.flatMap((option) => option.blockers)[0]; return { status: "blocked", text: blocker ? `Чтобы подготовить расчёт для ${customerVehicleDisplayName(input.vehicle.displayName)}, нужно уточнить: ${blocker.requiredToContinue}` : `Для ${customerVehicleDisplayName(input.vehicle.displayName)} пока нельзя подготовить расчёт.` }; }
  const showPrice = mode !== "short_without_price" && mode !== "recommendation";
  const detailed = mode === "detailed_with_price" || mode === "recommendation";
  const optionText = ready.map((option) => {
    const material = option.lines.find((line) => line.role === "fluid") ?? option.lines.find((line) => line.type !== "labor" && line.type !== "rounding" && !line.internalOnly);
    const labor = option.lines.find((line) => line.role === "labor" || line.type === "labor");
    const materialName = material?.customerDisplayName ?? input.techCard.selectedMaterial?.customerDisplayName ?? "жидкость по допуску";
    if (mode === "only_final_price") return `${option.customerDisplayName} — ${customerMoneyFromCents(option.totalCents!)}`;
    if (!detailed) return `${option.customerDisplayName}: ${materialName} — ${customerQuantity(option.billableQuantityLiters)} л${showPrice ? `, ${customerMoneyFromCents(option.totalCents!)}` : ""}.`;
    return [
      option.customerDisplayName,
      `${materialName}${input.techCard.requiredFluidSpec ? ` с допуском ${input.techCard.requiredFluidSpec}` : ""} — ${customerQuantity(option.billableQuantityLiters)} л`,
      option.code === "partial" ? "Без снятия поддона и замены фильтра." : "",
      showPrice && labor ? `Работа — ${customerMoneyFromCents(labor.totalCents)}` : "",
      showPrice ? `Итого: ${customerMoneyFromCents(option.totalCents!)}` : "",
    ].filter(Boolean).join("\n");
  });
  const vehicle = customerVehicleDisplayName(input.vehicle.displayName);
  const intro = mode === "only_final_price"
    ? `Стоимость обслуживания ${vehicle}:`
    : `Добрый день! Для вашего ${vehicle}${input.techCard.requiredFluidSpec ? ` требуется ATF спецификации ${input.techCard.requiredFluidSpec}` : " подготовлен расчёт"}.`;
  const preliminary = input.quoteSet.confidence === "preliminary" ? " Предварительная стоимость указана по текущим данным." : "";
  const filter = input.techCard.filterPolicy.tgmAction === "do_not_replace" && input.techCard.filterPolicy.presence === "present" ? input.techCard.filterPolicy.customerText : "";
  const machineCondition = ready.some((option) => option.servicePackage.diagnosticsRequired) ? "Перед аппаратной заменой сначала проведём диагностику коробки; при отсутствии противопоказаний сможем выполнить замену сразу." : "";
  const dates = input.quoteSet.requestedDates ? `Вы писали про ${input.quoteSet.requestedDates} — можем проверить свободное время.` : "Подберём удобное время и подтвердим запись.";
  // The recommendation action may not invent an upsell.  With no explicit
  // employee wording, it can only repeat the already-grounded diagnostic
  // condition for an аппаратная replacement.
  const safeRecommendation = recommendation ?? (mode === "recommendation" && ready.some((option) => option.code === "machine" || option.code === "machine_filter_service") ? "Рекомендуем начать с диагностики АКПП перед аппаратной заменой." : null);
  const recommendationText = mode === "recommendation" && safeRecommendation ? `Дополнительно: ${safeRecommendation}` : "";
  return { status: "ready", text: [intro + preliminary, ...optionText, filter, machineCondition, recommendationText, dates].filter(Boolean).join("\n\n") };
}

/** A single customer message for several independently calculated services. */
export function buildQuoteAndTechCardBundleCustomerMessage(input: Pick<QuoteAndTechCardBundle, "vehicle" | "results">, mode: QuoteAndTechCardCustomerMessageMode = "detailed_with_price", recommendation: string | null = null): QuoteAndTechCardBundle["customerMessage"] {
  const readyCards = input.results.map((card) => ({ card, options: card.quoteSet.options.filter((option) => option.status !== "blocked" && option.totalCents != null) })).filter((entry) => entry.options.length > 0);
  if (!readyCards.length) {
    const firstBlocked = input.results.flatMap((card) => [card.quoteSet.hardBlockers[0], ...card.quoteSet.options.flatMap((option) => option.blockers)]).find(Boolean);
    return { status: "blocked", text: firstBlocked ? `Чтобы подготовить расчёт для ${customerVehicleDisplayName(input.vehicle.displayName)}, нужно уточнить: ${firstBlocked.requiredToContinue}` : `Для ${customerVehicleDisplayName(input.vehicle.displayName)} пока нельзя подготовить расчёт.` };
  }
  const showPrice = mode !== "short_without_price" && mode !== "recommendation";
  const detailed = mode === "detailed_with_price" || mode === "recommendation";
  const sections = readyCards.flatMap(({ card, options }) => options.map((option) => {
    const material = option.lines.find((line) => line.role === "fluid") ?? option.lines.find((line) => line.type !== "labor" && line.type !== "rounding" && !line.internalOnly);
    const labor = option.lines.find((line) => line.role === "labor" || line.type === "labor");
    const materialName = material?.customerDisplayName ?? card.techCard.selectedMaterial?.customerDisplayName ?? "жидкость по допуску";
    const title = input.results.length > 1 ? `${card.techCard.serviceName}\n${option.customerDisplayName}` : option.customerDisplayName;
    if (mode === "only_final_price") return `${title} — ${customerMoneyFromCents(option.totalCents!)}`;
    if (!detailed) return `${title}: ${materialName} — ${customerQuantity(option.billableQuantityLiters)} л${showPrice ? `, ${customerMoneyFromCents(option.totalCents!)}` : ""}.`;
    return [
      title,
      `${materialName}${card.techCard.requiredFluidSpec ? ` с допуском ${card.techCard.requiredFluidSpec}` : ""} — ${customerQuantity(option.billableQuantityLiters)} л`,
      showPrice && labor ? `Работа — ${customerMoneyFromCents(labor.totalCents)}` : "",
      showPrice ? `Итого: ${customerMoneyFromCents(option.totalCents!)}` : "",
    ].filter(Boolean).join("\n");
  }));
  const preliminary = readyCards.some(({ card }) => card.quoteSet.confidence === "preliminary") ? " Предварительная стоимость указана по текущим данным." : "";
  const filter = readyCards.map(({ card }) => card.techCard.filterPolicy.tgmAction === "do_not_replace" && card.techCard.filterPolicy.presence === "present" ? card.techCard.filterPolicy.customerText : "").filter(Boolean);
  const machineCondition = readyCards.some(({ options }) => options.some((option) => option.servicePackage.diagnosticsRequired)) ? "Перед аппаратной заменой сначала проведём диагностику коробки; при отсутствии противопоказаний сможем выполнить замену сразу." : "";
  const unresolvedServices = input.results
    .filter((card) => !readyCards.some((entry) => entry.card === card))
    .map((card) => {
      const blocker = card.quoteSet.hardBlockers[0] ?? card.quoteSet.options.flatMap((option) => option.blockers)[0];
      return blocker ? `По услуге «${card.techCard.serviceName}»: ${blocker.requiredToContinue}` : `По услуге «${card.techCard.serviceName}» требуется уточнение перед расчётом.`;
    });
  const requestedDates = input.results.map((card) => card.quoteSet.requestedDates).find((value): value is string => Boolean(value));
  const dates = requestedDates ? `Вы писали про ${requestedDates} — можем проверить свободное время.` : "Подберём удобное время и подтвердим запись.";
  const recommendationText = mode === "recommendation" && recommendation ? `Дополнительно: ${recommendation}` : "";
  const vehicle = customerVehicleDisplayName(input.vehicle.displayName);
  const intro = mode === "only_final_price" ? `Стоимость обслуживания ${vehicle}:` : `Добрый день! Для вашего ${vehicle} подготовили расчёт по нескольким работам.`;
  return { status: "ready", text: [intro + preliminary, ...sections, ...filter, machineCondition, ...unresolvedServices, recommendationText, dates].filter(Boolean).join("\n\n") };
}

export function buildQuoteAndTechCardArtifactCustomerMessage(input: QuoteAndTechCardArtifact, mode: QuoteAndTechCardCustomerMessageMode = "detailed_with_price", recommendation: string | null = null) {
  return input.scenario === "quote_and_tech_card_bundle"
    ? buildQuoteAndTechCardBundleCustomerMessage(input, mode, recommendation)
    : buildQuoteAndTechCardCustomerMessage(input, mode, recommendation);
}
