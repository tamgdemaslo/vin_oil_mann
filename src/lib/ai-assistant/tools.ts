import { validateAssistantToolArguments, ToolArgumentsError } from "./tool-arguments";
import { normalizePartNumberForCrossMatch } from "@/lib/part-number-cross-reference";
import { parseAssistantRosskoOffers, sameSupplierArticle } from "./supplier-offers";
import { mannContext, mannResolutionDiagnostic, mergeAssistantVehicleSnapshot, assistantVehicle, verifiedLocalTechnicalInput, technicalSystems } from "./technical-context";
import { assistantTariffContext } from "./tariff-context";
import { assistantEvent, assistantMemo, assistantMap, assistantExecution, assistantSignal, withinAssistantDeadline } from "./execution";
import type { Prisma } from "@prisma/client";
import { anonymousRetailCounterpartyExclusion } from "@/lib/anonymous-retail-counterparty";
import { prisma } from "@/lib/db";
import { DEFAULT_ROSSKO_MARKUP_RULES, getAgentSettings as loadAgentSettings } from "@/lib/ai-agent/settings";
import type { AIRosskoMarkupRule } from "@/lib/ai-agent/types";
import { IntegrationNotConfiguredForBranch } from "@/lib/branch-integration-credentials";
import { lookupVehicle } from "@/lib/vehicle-identity";
import { RosskoError, rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { classifyRosskoRuntimeFailure, type RosskoRuntimeFailureCode } from "@/lib/rossko-error-classification";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { normalizeMannArticle } from "@/lib/mann-catalog";
import { resolveLaborPrice } from "./labor-pricing";
import { evaluatePreferredLocalFluid, engineOilSpecificationSearchTokenGroups, engineOilSpecificationMatches, fluidSpecificationMatches, quantityForLiters, fluidSpecificationExcerpt, fluidSpecificationSearchTokenGroups, shouldRequireOriginalFluid, type LocalFluidCandidateTrace, type LocalFluidSelection } from "./material-selection";
import { applyBillableQuantityToPrimaryFluid, buildQuoteAndTechCardBundleCustomerMessage, buildQuoteAndTechCardCustomerMessage, createQuoteAndTechCardPlan, customerMaterialDisplayName, customerProcedureDisplayName, ENGINE_OIL_FILTER_PRICE_PENDING_WARNING, normalizeQuoteAndTechCardServiceType, normalizeQuoteAndTechCardProcedure, parseQuoteAndTechCardArtifact, parseQuoteAndTechCardInput, parseQuoteAndTechCardResult, parseQuoteAndTechCardToolResult, QUOTE_AND_TECH_CARD_BUNDLE_TOOL_PARAMETERS, QUOTE_AND_TECH_CARD_TOOL_PARAMETERS, quoteAndTechCardMaterials, quoteAndTechCardSupplierRows, quoteStatus, quoteAndTechCardFilterPolicy, scenarioStatus, type QuoteAndTechCardArtifact, type QuoteAndTechCardInput, type QuoteAndTechCardMaterialSelectionTrace, type QuoteAndTechCardProcedure, type QuoteAndTechCardQuoteOption, type QuoteAndTechCardResult } from "./quote-and-tech-card";
import { jsonSafe } from "./json-safe";

function getAgentSettings(organizationId: string) {
  return assistantMemo("agent-settings", { organizationId, branchId: getScopedBranchId() }, () => loadAgentSettings(organizationId));
}

export type AssistantToolSource = {
  sourceType: "internal_catalog" | "mann" | "tronk" | "rossko" | "web";
  title: string;
  url?: string | null;
  excerpt?: string | null;
  metadata?: Record<string, unknown>;
};

export type AssistantToolResult = { result: Record<string, unknown>; sources?: AssistantToolSource[] };

/** A safe, user-facing failure passed into both trace and the model response. */
export type AssistantToolErrorCode = "ROSSKO_NOT_CONFIGURED" | "ROSSKO_NO_RESULTS" | "ROSSKO_PARSING_ERROR" | RosskoRuntimeFailureCode;

export class AssistantToolError extends Error {
  constructor(public readonly code: AssistantToolErrorCode, message: string, public readonly diagnosticMessage: string | null = null) {
    super(message);
    this.name = "AssistantToolError";
  }
}

const TECHNICAL_QUESTION_MAX_LENGTH = 500;

export const assistantFunctionTools = [
  { type: "function", name: "lookup_technical_data", description: "Сначала прочитать локальный технический профиль по каноническому resolver; затем точечно получить недостающие поля (допуск, тип объёма, процедура, температура, момент) с источниками. Для двух вариантов передай procedures. В missingFields используй specification, capacity, procedure, filterAccess, levelTemperature, torqueNotes либо конкретный вопрос до 500 символов. Результат web требует проверки применимости.", parameters: { type: "object", additionalProperties: false, required: ["vehicle", "missingFields"], properties: { serviceType: { type: "string", maxLength: 80 }, procedure: { type: "string", maxLength: 80 }, procedures: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", enum: ["partial", "filter_service", "machine", "machine_filter_service", "standard"] } }, vehicle: { type: "object" }, missingFields: { type: "array", maxItems: 8, items: { type: "string", maxLength: TECHNICAL_QUESTION_MAX_LENGTH } } } } },
  {
    type: "function",
    name: "get_workspace_context",
    description: "Получить текущую организацию и границы доступа сотрудника.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "search_clients",
    description: "Найти клиентов локальной базы по имени, телефону или части названия. Только чтение.",
    parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 2, maxLength: 120 } } },
  },
  {
    type: "function",
    name: "get_client_history",
    description: "Получить последние отгрузки выбранного клиента по локальному идентификатору клиента.",
    parameters: { type: "object", additionalProperties: false, required: ["clientId"], properties: { clientId: { type: "string", minLength: 1, maxLength: 160 }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
  },
  {
    type: "function",
    name: "get_vehicle_service_history",
    description: "Проверить историю диагностик и отгрузок по VIN во внутренней базе. Только чтение; отсутствие записей не отменяет техническое исследование.",
    parameters: { type: "object", additionalProperties: false, required: ["vin"], properties: { vin: { type: "string", minLength: 11, maxLength: 24 }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
  },
  {
    type: "function",
    name: "lookup_vehicle",
    description: "Определить автомобиль по VIN, госномеру или номеру кузова через подключённый провайдер. Ничего не изменяет в карточках автомобиля.",
    parameters: { type: "object", additionalProperties: false, required: ["input", "inputType"], properties: { input: { type: "string", minLength: 3, maxLength: 48 }, inputType: { type: "string", enum: ["vin", "plate", "frame"] } } },
  },
  {
    type: "function",
    name: "find_mann_filters",
    description: "Найти применяемость фильтров MANN. Передай все явно указанные признаки: модель/поколение/кузов, код двигателя и его серию отдельно, мощность, объём, год. Результат может быть неоднозначным.",
    parameters: { type: "object", additionalProperties: false, required: ["make", "model"], properties: { make: { type: "string", minLength: 1, maxLength: 80 }, model: { type: "string", minLength: 1, maxLength: 120 }, year: { type: ["integer", "null"], minimum: 1950, maximum: 2100 }, engineCode: { type: ["string", "null"], maxLength: 80 }, engineSeries: { type: ["string", "null"], maxLength: 80 }, generationRaw: { type: ["string", "null"], maxLength: 80 }, bodyCode: { type: ["string", "null"], maxLength: 40 }, powerKw: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 2000 }, powerHp: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 3000 }, engineVolumeCc: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 30000 }, fuelType: { type: ["string", "null"], maxLength: 40 }, filterType: { type: ["string", "null"], maxLength: 60 } } },
  },
  {
    type: "function",
    name: "search_local_catalog",
    description: "Найти товары или услуги локального каталога по названию, артикулу, OEM, MANN-артикулу или техническим характеристикам: ATF, допускам производителя, SAE, API, ACEA и ILSAC. Возвращает розничные цены и остатки, без себестоимости.",
    parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 2, maxLength: 160 }, entityType: { type: "string", enum: ["product", "service", "all"] }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
  },
  {
    type: "function",
    name: "get_stock",
    description: "Проверить остатки конкретных локальных товаров по внутренним идентификаторам каталога.",
    parameters: { type: "object", additionalProperties: false, required: ["productIds"], properties: { productIds: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 160 } } } },
  },
  {
    type: "function",
    name: "search_rossko",
    description: "Read-only поиск предложения в ROSSKO по OEM, номеру ZF/производителя агрегата или кросс-номеру. Возвращает закупочную и рассчитанную розничную цену, наличие и срок. Не создаёт заказ.",
    parameters: { type: "object", additionalProperties: false, required: ["article"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, maxDeliveryDays: { type: "number", minimum: 0, maximum: 365 }, article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 } } },
  },
  {
    type: "function",
    name: "find_service_options",
    description: "Найти стоимость работы в локальном каталоге, перебирая синонимы услуги. Используй для полноценного расчёта замены, а не только выставления уровня.",
    parameters: { type: "object", additionalProperties: false, required: ["request"], properties: { request: { type: "string", minLength: 2, maxLength: 160 }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
  },
  {
    type: "function",
    name: "calculate_quote_preview",
    description: "Детерминированно посчитать внутренний предварительный расчёт из локальных позиций и при необходимости свежих предложений ROSSKO. Не создаёт документы или заказ. Для готового технического расчёта обязательно передай vehicleDisplayName и serviceName: система сохранит точный снимок для последующего сообщения клиенту. Для диапазона передай maximumItems/maximumRosskoItems — сумму верхней границы посчитает инструмент, а не модель.",
    parameters: { type: "object", additionalProperties: false, required: ["items", "rosskoItems"], properties: { items: { type: "array", minItems: 0, maxItems: 30, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, requiredVolumeLiters: { type: "number", exclusiveMinimum: 0, maximum: 200 }, requiredFluidSpec: { type: "string", maxLength: 160 }, serviceFamily: { type: "string", maxLength: 60 }, productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, rosskoItems: { type: "array", minItems: 0, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["article", "brand", "quantity"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, maxDeliveryDays: { type: "number", minimum: 0, maximum: 365 }, article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 }, offerId: { type: ["string", "null"], maxLength: 100 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, maximumItems: { type: ["array", "null"], maxItems: 30, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, requiredVolumeLiters: { type: "number", exclusiveMinimum: 0, maximum: 200 }, requiredFluidSpec: { type: "string", maxLength: 160 }, serviceFamily: { type: "string", maxLength: 60 }, productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, maximumRosskoItems: { type: ["array", "null"], maxItems: 12, items: { type: "object", additionalProperties: false, required: ["article", "brand", "quantity"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, maxDeliveryDays: { type: "number", minimum: 0, maximum: 365 }, article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 }, offerId: { type: ["string", "null"], maxLength: 100 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, vehicleId: { type: ["string", "null"], maxLength: 160 }, vehicleDisplayName: { type: ["string", "null"], maxLength: 180 }, vehicleSnapshot: { type: ["object", "null"], additionalProperties: true }, serviceName: { type: ["string", "null"], maxLength: 180 }, selectedScenario: { type: ["string", "null"], maxLength: 180 }, maximumPriceSentence: { type: ["string", "null"], maxLength: 360 }, optionalItems: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } }, assumptions: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } }, internalWarnings: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } }, customerSafeWarnings: { type: ["array", "null"], maxItems: 6, items: { type: "string", maxLength: 360 } }, note: { type: ["string", "null"], maxLength: 400 } } },
  },
  {
    type: "function",
    name: "calculate_service_quote_v2",
    description: "Детерминированно рассчитать стоимость материалов и работы по тарифному правилу ИИ-помощника. Всегда используй для замены масла, АКПП/CVT и фильтров. Цена карточки услуги допускается только как явный fallback, когда специального правила нет. Итог складывает только backend; для смешанных материалов или неизвестной сложности инструмент возвращает обязательное подтверждение, а не случайную цену.",
    parameters: {
      type: "object", additionalProperties: false,
      required: ["serviceFamily", "procedureType", "materialsOwner", "selectedProducts", "consumables", "rosskoItems"],
      properties: {
        serviceFamily: { type: "string", enum: ["engine_oil", "transmission_fluid", "air_filter", "cabin_filter"] },
        procedureType: { type: "string", enum: ["oil_change", "partial", "machine", "replace"] },
        transmissionConfiguration: { type: ["string", "null"], enum: ["no_pan", "pan_and_filter", "two_coarse_filters", "not_applicable", null] },
        materialsOwner: { type: "string", enum: ["service", "customer", "mixed", "unknown"] },
        vehicleId: { type: ["string", "null"], maxLength: 160 },
        vehicleDisplayName: { type: ["string", "null"], maxLength: 180 },
        vehicleSnapshot: { type: ["object", "null"], additionalProperties: true },
        aggregateCode: { type: ["string", "null"], maxLength: 120 },
        requiredFluidSpec: { type: ["string", "null"], maxLength: 160 },
        requiredFluidVolumeLiters: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 200 },
        requiredFluidOemArticle: { type: ["string", "null"], maxLength: 80 },
        fluidPreference: { type: ["string", "null"], enum: ["prefer_local_compatible", "original_only", null] },
        locationId: { type: "string", minLength: 1, maxLength: 120 },
        selectedProducts: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, requiredVolumeLiters: { type: "number", exclusiveMinimum: 0, maximum: 200 }, requiredFluidSpec: { type: "string", maxLength: 160 }, serviceFamily: { type: "string", maxLength: 60 }, productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } },
        consumables: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, requiredVolumeLiters: { type: "number", exclusiveMinimum: 0, maximum: 200 }, requiredFluidSpec: { type: "string", maxLength: 160 }, serviceFamily: { type: "string", maxLength: 60 }, productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } },
        rosskoItems: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["article", "brand", "quantity"], properties: { role: { type: "string", enum: ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "unknown"] }, maxDeliveryDays: { type: "number", minimum: 0, maximum: 365 }, article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 }, offerId: { type: ["string", "null"], maxLength: 100 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } },
        manualLaborPriceCents: { type: ["integer", "null"], minimum: 0, maximum: 10000000 },
        fallbackServiceProductId: { type: ["string", "null"], maxLength: 160 },
        serviceName: { type: ["string", "null"], maxLength: 180 },
        selectedScenario: { type: ["string", "null"], maxLength: 180 },
        optionalItems: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } },
        assumptions: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } },
        internalWarnings: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } },
        customerSafeWarnings: { type: ["array", "null"], maxItems: 6, items: { type: "string", maxLength: 360 } },
      },
    },
  },
  {
    type: "function",
    name: "build_quote_and_tech_card",
    description: "Собрать единый предсказуемый результат «техкарта + смета» для внутреннего сотрудника. Используй после VIN/технической проверки и проверки локального каталога. Инструмент сам округляет объём, выбирает совместимую жидкость из локального остатка, применяет правило работы и формирует клиентский текст только из готовой сметы. Передавай не более двух процедур; для неуказанного способа АКПП используй [partial, filter_service], где filter_service — отдельный пакет с поддоном/фильтром. Внутренний фильтр АКПП/CVT/DSG, требующий разборки агрегата, помечай filterAccess=internal_requires_disassembly и не передавай в rosskoItems.",
    parameters: QUOTE_AND_TECH_CARD_TOOL_PARAMETERS,
  },
  {
    type: "function",
    name: "build_quote_and_tech_card_bundle",
    description: "Собрать комплекс одного визита из 2–6 независимых техкарт и смет. Используй, когда сотрудник явно запросил несколько разных агрегатов: например двигатель и АКПП, либо АКПП, раздатку, редукторы и муфту Haldex. Каждый input рассчитывается отдельно: не объединяй допуски, объёмы, позиции или тарифы между сервисами. Муфта Haldex — отдельный service.type=awd_clutch: ответы о снятии поддона и очистке сетки насоса фиксируй только по подтверждённому источнику в её собственной техкарте.",
    parameters: QUOTE_AND_TECH_CARD_BUNDLE_TOOL_PARAMETERS,
  },
  {
    type: "function",
    name: "audit_legacy_client_agent",
    description: "Проверить следы демонтированного клиентского агента: запуски, созданные им дела CRM и расчёты. Только аудит, ничего не изменяет.",
    parameters: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
  },
] as const;

export type ToolContext = {
  // Server-owned, current-run findings. Never accepted from tool arguments.
  technicalResearch?: Array<{ serviceType: string; aggregate: string | null; procedures: string[]; findings: string; missingFields: string[] }>;
  technicalLookup?: (request: Record<string, unknown>) => Promise<AssistantToolResult>;
  organizationId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  employeeRequestedOriginalFluidOnly?: boolean;
  requestMessage?: string;
  currentRequestMessage?: string;
  // VIN resolution is performed before the model tool loop. It is injected
  // server-side so a model cannot silently drop a detected manual/hybrid
  // powertrain on the way to the deterministic quote builder.
  verifiedVehicleSnapshot?: Record<string, unknown> | null;
  // Explicit catalogue attributes from the employee message, kept separate
  // from VIN-provider data and never treated as verified technical facts.
  requestedVehicleSnapshot?: Record<string, unknown>;
  // A generic "calculate the current request" follows an existing checked
  // technical card. Keep its confirmed service constraints server-side so a
  // fresh model pass cannot downgrade a pan/filter service into an unrelated
  // drain-and-fill quote.
  previousQuoteAndTechCard?: QuoteAndTechCardArtifact | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Keeps a customer-supplied date window through the deterministic quote path. */
export function requestedDateRangeFromText(value: unknown) {
  const source = text(value, 12_000).replace(/\s+/g, " ");
  const range = source.match(/(\d{1,2})\s*(?:[-–—]|и)\s*(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/iu);
  if (range) return `${range[1]}–${range[2]} ${range[3]}`;
  const single = source.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/iu);
  return single ? `${single[1]} ${single[2]}` : null;
}

function safeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function rosskoRetailPrice(purchaseCents: number | null, rules: AIRosskoMarkupRule[]) {
  if (purchaseCents == null) return null;
  const rule = rules.find((item) => purchaseCents >= item.fromCents && (item.toCents == null || purchaseCents < item.toCents)) ?? rules.at(-1);
  return rule ? { retailPriceCents: Math.round(purchaseCents * (1 + rule.marginPercent / 100)), appliedRule: rule } : null;
}

function catalogSearchFields(value: string): Prisma.LocalProductWhereInput[] {
  return [
    { name: { contains: value, mode: "insensitive" } },
    { article: { contains: value, mode: "insensitive" } },
    { code: { contains: value, mode: "insensitive" } },
    { externalCode: { contains: value, mode: "insensitive" } },
    { brand: { contains: value, mode: "insensitive" } },
    { oem: { contains: value, mode: "insensitive" } },
    { oemParts: { contains: value, mode: "insensitive" } },
    { atf: { contains: value, mode: "insensitive" } },
    { oemAtf: { contains: value, mode: "insensitive" } },
    { sae: { contains: value, mode: "insensitive" } },
    { apiSpec: { contains: value, mode: "insensitive" } },
    { acea: { contains: value, mode: "insensitive" } },
    { aceaExtra: { contains: value, mode: "insensitive" } },
    { ilsac: { contains: value, mode: "insensitive" } },
    { searchText: { contains: value, mode: "insensitive" } },
  ];
}

function normalizeCatalogSearch(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[ёЁ]/g, "е")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function catalogSearchTokens(query: string) {
  return [...new Set(normalizeCatalogSearch(query).split(" ").filter((token) => token.length >= 2))].slice(0, 10);
}

function catalogSearchWhere(query: string): Prisma.LocalProductWhereInput {
  const normalized = normalizeCatalogSearch(query);
  const tokens = catalogSearchTokens(query);
  const alternatives: Prisma.LocalProductWhereInput[] = [
    ...catalogSearchFields(query),
    ...(normalized && normalized !== query.toLocaleLowerCase("ru-RU") ? catalogSearchFields(normalized) : []),
  ];
  if (tokens.length > 1) {
    alternatives.push({ AND: tokens.map((token) => ({ OR: catalogSearchFields(token) })) });
  }
  return { OR: alternatives };
}

type CatalogRankRow = {
  name: string;
  article: string | null;
  code: string | null;
  brand: string | null;
  oem: string | null;
  oemParts: string | null;
  atf: string | null;
  oemAtf: string | null;
  sae: string | null;
  acea: string | null;
  aceaExtra: string | null;
  apiSpec: string | null;
  ilsac: string | null;
  searchText: string;
};

function catalogMatchScore(product: CatalogRankRow, query: string) {
  const tokens = catalogSearchTokens(query);
  const technical = normalizeCatalogSearch([product.atf, product.oemAtf, product.oem, product.sae, product.acea, product.aceaExtra, product.apiSpec, product.ilsac].filter(Boolean).join(" "));
  const identity = normalizeCatalogSearch([product.name, product.article, product.code, product.brand, product.oemParts].filter(Boolean).join(" "));
  const all = `${identity} ${normalizeCatalogSearch(product.searchText)}`;
  const normalizedQuery = normalizeCatalogSearch(query);
  const numericSpecification = tokens.filter((token) => /^\d+$/.test(token)).join("");
  const compactTechnical = technical.replace(/\s+/g, "");
  let score = 0;
  if (normalizedQuery && identity.includes(normalizedQuery)) score += 500;
  if (tokens.length && tokens.every((token) => technical.includes(token))) score += 1_000;
  if (numericSpecification.length >= 4 && compactTechnical.includes(numericSpecification)) score += 700;
  score += tokens.filter((token) => technical.includes(token)).length * 80;
  score += tokens.filter((token) => identity.includes(token)).length * 30;
  score += tokens.filter((token) => all.includes(token)).length * 5;
  return score;
}

function catalogFieldExcerpt(value: string | null, query: string, max = 700) {
  const source = String(value ?? "").trim();
  if (!source || source.length <= max) return source || null;
  const exactSpecification = fluidSpecificationExcerpt(source, query, max);
  if (exactSpecification) return exactSpecification;
  const candidates = [
    ...query.match(/\d+(?:[.\-/]\d+)+/g) ?? [],
    ...catalogSearchTokens(query).sort((left, right) => right.length - left.length),
  ];
  const lower = source.toLocaleLowerCase("ru-RU");
  const foundAt = candidates.map((candidate) => lower.indexOf(candidate.toLocaleLowerCase("ru-RU"))).find((index) => index >= 0) ?? 0;
  const start = Math.max(0, foundAt - Math.floor(max / 3));
  const end = Math.min(source.length, start + max);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

async function searchCatalog(args: Record<string, unknown>): Promise<AssistantToolResult> {
  const query = text(args.query, 160);
  const entityType = text(args.entityType, 20) || "all";
  const limit = Math.max(1, Math.min(20, Math.round(number(args.limit, 10))));
  const products = await prisma.localProduct.findMany({
    where: {
      archived: false,
      ...(entityType === "all" ? {} : { entityType }),
      ...catalogSearchWhere(query),
    },
    select: { id: true, entityType: true, name: true, article: true, code: true, brand: true, sae: true, oem: true, oemParts: true, atf: true, oemAtf: true, acea: true, aceaExtra: true, apiSpec: true, ilsac: true, packageVolume: true, salePriceCents: true, searchText: true, stockBalances: { select: { quantity: true, reserve: true, available: true, store: { select: { name: true } } } } },
    take: Math.min(100, Math.max(20, limit * 5)),
    orderBy: [{ name: "asc" }],
  });
  const compact = products
    .sort((left, right) => catalogMatchScore(right, query) - catalogMatchScore(left, query) || left.name.localeCompare(right.name, "ru"))
    .slice(0, limit)
    .map((product) => ({
    id: product.id,
    type: product.entityType,
    name: product.name,
    article: product.article,
    code: product.code,
    brand: product.brand,
    sae: product.sae,
    oem: product.oem,
    oemParts: product.oemParts,
    atf: catalogFieldExcerpt(product.atf, query),
    manufacturerApprovals: catalogFieldExcerpt(product.oemAtf, query),
    compatibilityEvidence: catalogFieldExcerpt([product.atf, product.oemAtf].filter(Boolean).join("\n"), query, 360),
    acea: product.acea,
    aceaExtra: product.aceaExtra,
    api: product.apiSpec,
    ilsac: product.ilsac,
    packageVolume: product.packageVolume,
    retailPriceCents: product.salePriceCents,
    retailPriceRub: product.salePriceCents / 100,
    stock: product.stockBalances.map((stock) => ({ store: stock.store.name, quantity: Number(stock.quantity), reserve: Number(stock.reserve), available: Number(stock.available) })),
  }));
  return { result: { query, count: compact.length, products: compact }, sources: [{ sourceType: "internal_catalog", title: "Локальный каталог и остатки", excerpt: `Поиск: ${query}` }] };
}

async function findMannFilters(args: Record<string, unknown>, context: ToolContext): Promise<AssistantToolResult> {
  const vehicle = assistantVehicle(mergeAssistantVehicleSnapshot(args, context.verifiedVehicleSnapshot, context.requestedVehicleSnapshot));
  const { resolution, profile } = await mannContext(context.organizationId, vehicle);
  const type = text(args.filterType, 60).toLowerCase();
  const filters = resolution.filters.filter(row => !type || row.filterType.toLowerCase() === type || (MANN_OIL_FILTER_TYPE.test(type) && MANN_OIL_FILTER_TYPE.test(row.filterType)));
  return {
    result: { found: filters.length > 0, ambiguous: resolution.decision === "AMBIGUOUS", decision: resolution.decision, diagnostic: mannResolutionDiagnostic(resolution), vehicleStatus: resolution.status, selectedApplication: resolution.selectedApplication, candidates: resolution.candidates, filters, localMatches: resolution.localMatches.map(row => ({ ...row, compatibleProducts: row.compatibleProducts.map(product => ({ id: product.id, name: product.name, article: product.article, brand: product.brand, price: product.price, available: product.available, matchType: product.matchType, matchReason: product.matchReason })) })), technicalProfile: profile },
    sources: [{ sourceType: "mann", title: "Канонический resolver MANN → OEM Parts → LocalProduct", metadata: { decision: resolution.decision, profileStatus: profile.status } }],
  };
}

type MannOilFilterCandidate = {
  article: string;
  detail: string | null;
  vehicleVariantKey: string;
  requiresVinConfirmation: boolean;
  localProductId: string | null;
  localProductName: string | null;
  localPriceCents: number | null;
  localAvailable: number;
};

type EngineOilMannFilterResolution = {
  candidates: MannOilFilterCandidate[];
  summary: string | null;
  selectedProductId: string | null;
  sources: AssistantToolSource[];
  evidence: Array<{ source: string; fact: string; status: "confirmed" | "needs_verification" }>;
};

const MANN_OIL_FILTER_TYPE = /(?:^oil$|\boil\s*filter\b|маслян\S*\s+фильтр|\blube\b)/iu;

export function uniqueMannFilterRows<T extends { mannArticle: string }>(rows: T[]) {
  return rows.filter((row, index) => rows.findIndex((other) => normalizeMannArticle(other.mannArticle) === normalizeMannArticle(row.mannArticle)) === index);
}

export function formatMannOilFilterCandidateSummary(candidates: MannOilFilterCandidate[]) {
  if (!candidates.length) return null;
  const entries = candidates.slice(0, 4).map((candidate) => {
    const local = candidate.localPriceCents != null
      ? " — " + (candidate.localPriceCents / 100).toLocaleString("ru-RU") + " ₽" + (candidate.localAvailable > 0 ? "" : " · нет в наличии")
      : " — цена уточняется";
    return "MANN " + candidate.article + local + (candidate.requiresVinConfirmation ? " · подтвердить по VIN" : "");
  });
  return "Варианты фильтра: " + entries.join("; ") + ".";
}

/**
 * The model may research MANN itself, but an engine-oil quote cannot depend on
 * whether it remembered that extra tool call. This resolver supplies a
 * read-only, local-first filter shortlist after the service has been
 * identified. It adds a price only for one exact, in-stock candidate; all
 * ambiguous rows remain visible and await VIN confirmation.
 */
async function resolveEngineOilMannFilter(input: QuoteAndTechCardInput, organizationId: string): Promise<EngineOilMannFilterResolution> {
  const empty: EngineOilMannFilterResolution = { candidates: [], summary: null, selectedProductId: null, sources: [], evidence: [] };
  if (input.service.type !== "engine_oil" || input.service.materialsOwner !== "service") return empty;
  const { resolution } = await mannContext(organizationId, assistantVehicle(input.vehicle.snapshot ?? {}));
  if (resolution.status !== "resolved") {
    const diagnostic = mannResolutionDiagnostic(resolution);
    return { ...empty, summary: diagnostic.message, sources: [{ sourceType: "mann", title: "Статус подбора фильтра MANN", excerpt: diagnostic.message, metadata: diagnostic }] };
  }
  const filters = resolution.filters.filter(row => MANN_OIL_FILTER_TYPE.test(row.filterType));
  const candidates = filters.flatMap(filter => {
    const products = resolution.localMatches.find(row => row.mannArticleNormalized === normalizeMannArticle(filter.mannArticle))?.compatibleProducts ?? [];
    return (products.length ? products : [null]).map(local => ({
      article: filter.mannArticle, detail: filter.filterNote, vehicleVariantKey: resolution.selectedApplication!.variantIds.join(","),
      requiresVinConfirmation: Boolean(filter.condition), localProductId: local?.id ?? null, localProductName: local?.name ?? null,
      localPriceCents: local ? Math.round(local.price * 100) : null, localAvailable: local?.available ?? 0,
    }));
  });
  const selected = candidates.filter(row => !row.requiresVinConfirmation && row.localProductId && (row.localPriceCents ?? 0) > 0 && row.localAvailable >= 1).sort((a, b) => a.localPriceCents! - b.localPriceCents!)[0];
  return { candidates, summary: formatMannOilFilterCandidateSummary(candidates), selectedProductId: selected?.localProductId ?? null, sources: [{ sourceType: "mann", title: "Подтверждённая модификация MANN и OEM Parts" }], evidence: [] };
}

async function lookupClientHistory(args: Record<string, unknown>) {
  const clientId = text(args.clientId, 160);
  const limit = Math.max(1, Math.min(20, Math.round(number(args.limit, 10))));
  const branchId = getScopedBranchId();
  const client = await prisma.localCounterparty.findFirst({ where: { branchId, ...anonymousRetailCounterpartyExclusion(branchId), OR: [{ id: clientId }, { id: clientId }] }, select: { id: true, name: true, phone: true, email: true } });
  if (!client) return { result: { found: false, clientId } } satisfies AssistantToolResult;
  const demands = await prisma.localDemand.findMany({
    where: { counterpartyId: client.id },
    select: { id: true, name: true, documentDate: true, momentAt: true, sumCents: true, applicable: true, description: true, positions: { select: { name: true, quantity: true, priceCentsPerUnit: true }, take: 30 } },
    orderBy: { momentAt: "desc" },
    take: limit,
  });
  return { result: { found: true, client: { id: client.id, name: client.name, phone: client.phone, email: client.email }, shipments: demands.map((demand) => ({ ...demand, positions: demand.positions.map((position) => ({ ...position, quantity: Number(position.quantity) })) })) }, sources: [{ sourceType: "internal_catalog", title: "История локальных отгрузок", excerpt: `Клиент: ${client.name}` }] } satisfies AssistantToolResult;
}

async function vehicleServiceHistory(args: Record<string, unknown>) {
  const vin = text(args.vin, 24).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const limit = Math.max(1, Math.min(20, Math.round(number(args.limit, 10))));
  if (vin.length < 11) throw new Error("Для истории автомобиля нужен VIN");
  const [diagnostics, diagnosticMaps, shipments] = await Promise.all([
    prisma.diagnostic.findMany({ where: { vin }, orderBy: { startedAt: "desc" }, take: limit, select: { id: true, brand: true, model: true, year: true, mileage: true, status: true, startedAt: true, completedAt: true, summaryGreen: true, summaryYellow: true, summaryRed: true } }),
    prisma.diagnosticMapSession.findMany({ where: { vin }, orderBy: { startedAt: "desc" }, take: limit, select: { id: true, brand: true, model: true, year: true, mileage: true, status: true, startedAt: true, completedAt: true, masterName: true } }),
    prisma.localDemand.findMany({ where: { OR: [{ name: { contains: vin, mode: "insensitive" } }, { description: { contains: vin, mode: "insensitive" } }] }, orderBy: { momentAt: "desc" }, take: limit, select: { id: true, name: true, documentDate: true, momentAt: true, sumCents: true, applicable: true, description: true, positions: { select: { name: true, quantity: true, priceCentsPerUnit: true }, take: 30 } } }),
  ]);
  return {
    result: {
      found: Boolean(diagnostics.length || diagnosticMaps.length || shipments.length),
      vin,
      diagnostics,
      diagnosticMaps,
      shipments: shipments.map((shipment) => ({ ...shipment, positions: shipment.positions.map((position) => ({ ...position, quantity: Number(position.quantity) })) })),
    },
    sources: [{ sourceType: "internal_catalog", title: "История автомобиля во внутренней базе", excerpt: `VIN: ${vin.slice(0, 4)}•••••••••${vin.slice(-4)}` }],
  } satisfies AssistantToolResult;
}

async function searchClients(args: Record<string, unknown>) {
  const query = text(args.query, 120);
  const digits = query.replace(/\D/g, "");
  const branchId = getScopedBranchId();
  const clients = await prisma.localCounterparty.findMany({
    where: { branchId, archived: false, ...anonymousRetailCounterpartyExclusion(branchId), OR: [{ name: { contains: query, mode: "insensitive" } }, { phone: { contains: query, mode: "insensitive" } }, ...(digits ? [{ normalizedPhone: { contains: digits, mode: "insensitive" as const } }] : []), { searchText: { contains: query.toLowerCase(), mode: "insensitive" } }] },
    select: { id: true, name: true, phone: true, email: true, inn: true },
    take: 20,
    orderBy: { name: "asc" },
  });
  return { result: { query, clients }, sources: [{ sourceType: "internal_catalog", title: "База клиентов", excerpt: `Поиск: ${query}` }] } satisfies AssistantToolResult;
}

async function stock(args: Record<string, unknown>) {
  const productIds = Array.isArray(args.productIds) ? args.productIds.map((item) => text(item, 160)).filter(Boolean).slice(0, 20) : [];
  const products = await prisma.localProduct.findMany({ where: { id: { in: productIds }, archived: false }, select: { id: true, name: true, article: true, stockBalances: { select: { quantity: true, reserve: true, available: true, store: { select: { name: true } } } } } });
  return { result: { products: products.map((product) => ({ ...product, stock: product.stockBalances.map((row) => ({ store: row.store.name, quantity: Number(row.quantity), reserve: Number(row.reserve), available: Number(row.available) })) })) }, sources: [{ sourceType: "internal_catalog", title: "Локальные остатки" }] } satisfies AssistantToolResult;
}

export function rosskoFailure(error: unknown) {
  if (error instanceof AssistantToolError) return error;
  if (error instanceof IntegrationNotConfiguredForBranch) {
    return new AssistantToolError("ROSSKO_NOT_CONFIGURED", "ROSSKO не подключён для этого филиала. Откройте Кабинет → Интеграции и добавьте ключи.");
  }
  const classified = classifyRosskoRuntimeFailure(error, { operation: "search", providerError: error instanceof RosskoError });
  return new AssistantToolError(classified.code, classified.publicMessage, classified.diagnosticMessage);
}

function scopedBranchIdForDiagnostic() {
  try {
    return getScopedBranchId();
  } catch {
    return null;
  }
}

async function rosskoUncached(args: Record<string, unknown>, context: ToolContext) {
  const article = text(args.article, 80);
  const brand = text(args.brand, 80);
  try {
    const settings = await getAgentSettings(context.organizationId);
    if (!settings.rosskoSearchEnabled) {
      throw new AssistantToolError("ROSSKO_NOT_CONFIGURED", "Поиск ROSSKO выключен для этого филиала.");
    }
    const config = await rosskoConfig();
    const deliveryId = config.deliveryId || "";
    const addressId = config.addressId || "";
    if (!deliveryId) throw new AssistantToolError("ROSSKO_NOT_CONFIGURED", "Для ROSSKO этого филиала не настроен способ доставки.");
    const raw = await rosskoSearch(config, { text: [brand, article].filter(Boolean).join(" "), deliveryId, addressId });
    let parsedOffers;
    try { parsedOffers = parseAssistantRosskoOffers(raw, getScopedBranchId()); }
    catch { throw new AssistantToolError("ROSSKO_PARSING_ERROR", "ROSSKO вернул непонятную структуру предложений"); }
    const offers = parsedOffers.map(offer => {
      const retail = rosskoRetailPrice(offer.purchasePriceCents, settings.rosskoMarkupRules || DEFAULT_ROSSKO_MARKUP_RULES);
      return { ...offer, retailPriceCents: retail?.retailPriceCents ?? null, appliedMarkupRule: retail?.appliedRule ?? null };
    });
    if (!offers.length) throw new AssistantToolError("ROSSKO_NO_RESULTS", "ROSSKO не вернул предложений по этому номеру для выбранного филиала.");
    return { result: { found: true, article, brand: brand || null, offers, validForHours: 24, mode: "read_only_search" }, sources: [{ sourceType: "rossko", title: "ROSSKO · read-only поиск", excerpt: `Артикул: ${article}` }] } satisfies AssistantToolResult;
  } catch (error) {
    const failure = rosskoFailure(error);
    if (!(error instanceof AssistantToolError)) {
      console.error("[ai-assistant.rossko] search failed", {
        branchId: scopedBranchIdForDiagnostic(),
        article: article || null,
        brand: brand || null,
        code: failure.code,
        diagnostic: failure.diagnosticMessage,
      });
    }
    throw failure;
  }
}

async function rossko(args: Record<string, unknown>, context: ToolContext) {
  return assistantMemo("rossko-search", { branchId: getScopedBranchId(), args }, () => rosskoUncached(args, context));
}

function serviceSearchQueries(request: string) {
  const normalized = request.toLowerCase();
  const common = [request];
  if (/(акпп|atf|автомат|трансмис)/.test(normalized)) common.push("замена масла АКПП", "частичная замена ATF", "замена масла с поддоном", "замена фильтра АКПП", "обслуживание АКПП", "выставление уровня");
  if (/(вариатор|cvt)/.test(normalized)) common.push("обслуживание вариатора", "замена масла CVT");
  if (/(dsg|робот)/.test(normalized)) common.push("обслуживание DSG", "замена масла DSG");
  if (/(двигател|мотор)/.test(normalized)) common.push("замена моторного масла", "замена масла двигателя");
  return [...new Set(common.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

async function findServiceOptions(args: Record<string, unknown>) {
  const request = text(args.request, 160);
  const limit = Math.max(1, Math.min(20, Math.round(number(args.limit, 12))));
  const queries = serviceSearchQueries(request);
  const rows = await assistantMap(queries, query => prisma.localProduct.findMany({
    where: { archived: false, entityType: "service", OR: [{ name: { contains: query, mode: "insensitive" } }, { article: { contains: query, mode: "insensitive" } }, { code: { contains: query, mode: "insensitive" } }, { searchText: { contains: query.toLowerCase(), mode: "insensitive" } }] },
    select: { id: true, name: true, article: true, code: true, salePriceCents: true },
    take: limit,
    orderBy: { name: "asc" },
  }), 3);
  const services = rows.flat().filter((service, index, all) => all.findIndex((other) => other.id === service.id) === index).slice(0, limit).map((service) => ({ ...service, retailPriceRub: service.salePriceCents / 100 }));
  return { result: { request, searchedSynonyms: queries, found: services.length > 0, services }, sources: [{ sourceType: "internal_catalog", title: "Локальный каталог услуг", excerpt: `Синонимы: ${queries.join(" · ")}` }] } satisfies AssistantToolResult;
}

function quoteInputRows(value: unknown, max: number) {
  return Array.isArray(value) ? value.map(object).slice(0, max) : [];
}

function normalizedArticle(value: unknown) {
  return normalizePartNumberForCrossMatch(text(value, 100)).canonical;
}

type LocalFluidResolution = {
  selection: LocalFluidSelection | null;
  candidates: LocalFluidCandidateTrace[];
  fallbackReason: string | null;
  originalOnlyOverride: boolean;
};

async function automaticLocalFluidResolutionUncached(args: Record<string, unknown>, context: ToolContext): Promise<LocalFluidResolution> {
  if (!["transmission_fluid", "engine_oil"].includes(text(args.serviceFamily, 60)) || text(args.materialsOwner, 30) !== "service") return { selection: null, candidates: [], fallbackReason: "Материалы не принадлежат сервису.", originalOnlyOverride: false };
  const originalOnlyOverride = shouldRequireOriginalFluid({
    fluidPreference: text(args.fluidPreference, 40) || null,
    employeeRequestedOriginalOnly: Boolean(context.employeeRequestedOriginalFluidOnly),
  });
  if (originalOnlyOverride) return { selection: null, candidates: [], fallbackReason: "Сотрудник явно запросил оригинальную жидкость.", originalOnlyOverride: true };
  const requiredSpec = text(args.requiredFluidSpec, 160);
  const requiredLiters = number(args.requiredFluidVolumeLiters);
  const alternativeTokens = args.serviceFamily === "engine_oil" ? engineOilSpecificationSearchTokenGroups(requiredSpec) : fluidSpecificationSearchTokenGroups(requiredSpec);
  if (!requiredSpec || requiredLiters <= 0 || !alternativeTokens.length) {
    throw new Error("Для расчёта жидкости укажите requiredFluidSpec и requiredFluidVolumeLiters, чтобы backend проверил локальное масло");
  }
  const rows = await localFluidCandidateRows(requiredSpec, text(args.serviceFamily, 60));
  const evaluation = evaluatePreferredLocalFluid(rows.map((row) => ({
    ...row,
    availableUnits: row.stockBalances.reduce((sum, stock) => sum + Number(stock.available), 0),
  })), requiredSpec, requiredLiters, text(args.serviceFamily, 60));
  return {
    selection: evaluation.selected,
    candidates: evaluation.candidates,
    fallbackReason: evaluation.selected ? null : evaluation.candidates.length ? "Подходящего локального товара с достаточным остатком нет." : "Локальный каталог не вернул совместимых кандидатов.",
    originalOnlyOverride: false,
  };
}

/** Candidate discovery does not require or invent a billable quantity. */
async function localFluidCandidateRows(requiredSpec: string, family: string) {
  const alternativeTokens = family === "engine_oil" ? engineOilSpecificationSearchTokenGroups(requiredSpec) : fluidSpecificationSearchTokenGroups(requiredSpec);
  if (!alternativeTokens.length) return [];
  const branchId = getScopedBranchId();
  const fields = (token: string): Prisma.LocalProductWhereInput[] => [
    { sae: { contains: token, mode: "insensitive" } },
    { oem: { contains: token, mode: "insensitive" } },
    { acea: { contains: token, mode: "insensitive" } },
    { apiSpec: { contains: token, mode: "insensitive" } },
    { ilsac: { contains: token, mode: "insensitive" } },
    { atf: { contains: token, mode: "insensitive" } },
    { oemAtf: { contains: token, mode: "insensitive" } },
    { searchText: { contains: token, mode: "insensitive" } },
  ];
  return assistantMemo("fluid-candidates", { branchId, requiredSpec, family }, () => prisma.localProduct.findMany({
    where: {
      branchId,
      archived: false,
      entityType: "product",
      // Keep zero-price and out-of-stock matches in the trace.  The shared
      // selector below rejects them deterministically, but the employee can
      // then see why each local candidate was not eligible.
      // Broad aliases retrieve candidates only. Structured compatibility below
      // preserves meaningful separators and requires the requested specification.
      OR: alternativeTokens.map((tokens) => ({ AND: tokens.map((token) => ({ OR: fields(token) })) })),
    },
    select: {
      id: true,
      name: true,
      salePriceCents: true,
      uomName: true,
      packageVolume: true,
      markingMode: true,
      atf: true,
      oemAtf: true,
      sae: true, oem: true, acea: true, apiSpec: true, ilsac: true,
      searchText: true,
      stockBalances: { where: { branchId }, select: { available: true } },
    },
    orderBy: [{ salePriceCents: "asc" }, { name: "asc" }],
    take: 100,
  }));
}

async function automaticLocalFluidResolution(args: Record<string, unknown>, context: ToolContext): Promise<LocalFluidResolution> {
  return assistantMemo("fluid-resolution", { branchId: getScopedBranchId(), family: args.serviceFamily, owner: args.materialsOwner, spec: args.requiredFluidSpec, liters: args.requiredFluidVolumeLiters, preference: args.fluidPreference, originalOnly: context.employeeRequestedOriginalFluidOnly }, () => automaticLocalFluidResolutionUncached(args, context));
}

async function automaticLocalFluidSelection(args: Record<string, unknown>, context: ToolContext): Promise<LocalFluidSelection | null> {
  return (await automaticLocalFluidResolution(args, context)).selection;
}

function catalogFluid(product: { atf?: unknown; oemAtf?: unknown; sae?: unknown; oem?: unknown; acea?: unknown; apiSpec?: unknown; ilsac?: unknown }) {
  return [product.atf, product.oemAtf, product.sae, product.oem, product.acea, product.apiSpec, product.ilsac].some(value => typeof value === "string" && value.trim().length > 0);
}

export async function quoteLines(itemValues: Array<Record<string, unknown>>, rosskoItems: Array<Record<string, unknown>>, context: ToolContext) {
  const branchId = getScopedBranchId();
  const ids = [...new Set(itemValues.map(item => text(item.productId, 160)).filter(Boolean))];
  const products = await prisma.localProduct.findMany({ where: { branchId, id: { in: ids }, archived: false }, select: { id: true, entityType: true, name: true, article: true, salePriceCents: true, uomName: true, packageVolume: true, markingMode: true, atf: true, oemAtf: true, searchText: true, sae: true, oem: true, acea: true, apiSpec: true, ilsac: true, stockBalances: { where: { branchId }, select: { available: true } } } });
  const byId = new Map(products.map(item => [item.id, item]));
  const unresolvedItems: Array<{ code: string; item: string }> = [];
  const warnings: string[] = [];
  const localLines = itemValues.flatMap(item => {
    const productId = text(item.productId, 160), product = byId.get(productId);
    const fail = (code: string) => { unresolvedItems.push({ code, item: product?.name ?? productId }); return []; };
    if (!product) return fail("LOCAL_PRODUCT_NOT_FOUND");
    if (product.salePriceCents <= 0) return fail("LOCAL_PRICE_UNKNOWN");
    const role = catalogFluid(product) ? "fluid" : text(item.role, 40) || "unknown";
    if (role === "fluid") {
      const required = text(item.requiredFluidSpec, 160);
      const compatible = text(item.serviceFamily, 60) === "engine_oil" ? engineOilSpecificationMatches(product, required) : fluidSpecificationMatches(product, required);
      if (!compatible) return fail("MATERIAL_COMPATIBILITY_UNVERIFIED");
    }
    const plannedConsumptionLiters = number(item.requiredVolumeLiters);
    const converted = role === "fluid" && plannedConsumptionLiters > 0 ? quantityForLiters(product, plannedConsumptionLiters) : null;
    if (role === "fluid" && !converted?.quantity) return fail("PACKAGE_OR_CONSUMPTION_UNKNOWN");
    const quantity = converted?.quantity ?? number(item.quantity);
    if (!(quantity > 0 && quantity <= 100)) return fail("INVALID_SALE_QUANTITY");
    const available = product.stockBalances.reduce((sum, row) => sum + Number(row.available), 0);
    if (available + 0.0001 < quantity) warnings.push(`${product.name}: локального остатка недостаточно; поставку нужно подтвердить.`);
    const saleQuantity = converted?.quantity && converted.litersPerUnit ? {
      technicalVolumeLiters: number(item.technicalVolumeLiters) || null, plannedConsumptionLiters,
      litersPerSaleUnit: converted.litersPerUnit, saleUnitQuantity: quantity, unitPriceCents: product.salePriceCents,
      purchasedVolumeLiters: converted.purchasedVolumeLiters!, packageRemainderLiters: converted.packageRemainderLiters!, saleUnit: product.uomName ?? "шт.",
    } : undefined;
    return [{ source: "local", productId, role, type: product.entityType, name: product.name, article: product.article, quantity, unitPriceCents: product.salePriceCents, totalCents: Math.round(product.salePriceCents * quantity), ...(saleQuantity ? { saleQuantity } : {}) }];
  });
  const supplierProofProducts = rosskoItems.length ? await prisma.localProduct.findMany({ where: { branchId, archived: false, entityType: "product", article: { in: rosskoItems.map(item => text(item.article, 80)) } }, select: { id: true, article: true, brand: true, atf: true, oemAtf: true, searchText: true, sae: true, oem: true, acea: true, apiSpec: true, ilsac: true, uomName: true, packageVolume: true, markingMode: true } }) : [];
  const supplierResults = await assistantMap(rosskoItems, async item => {
    try { return { item, search: await rossko({ article: text(item.article, 80), brand: text(item.brand, 80) }, context), error: null }; }
    catch (error) { return { item, search: { result: {}, sources: [] } as AssistantToolResult, error: error instanceof AssistantToolError ? error.code : "ROSSKO_SEARCH_FAILED" }; }
  });
  const rosskoLines = supplierResults.flatMap(({ item, search, error }) => {
    const fail = (code: string) => { unresolvedItems.push({ code, item: text(item.article, 80) }); return []; };
    if (error) return fail(error);
    const offers = Array.isArray(search.result.offers) ? search.result.offers as Array<Record<string, unknown>> : [];
    const requestedId = text(item.offerId, 100);
    // No fallback from a disappeared selected offer. The caller must choose again.
    const selected = requestedId ? offers.find(offer => offer.id === requestedId) : offers.find(offer => sameSupplierArticle(offer.article, item.article) && text(offer.brand).toUpperCase() === text(item.brand).toUpperCase() && number(offer.retailPriceCents) > 0);
    if (!selected || !selected.id) return fail(requestedId ? "ROSSKO_OFFER_NOT_FOUND" : "ROSSKO_OFFER_SELECTION_REQUIRED");
    if (!sameSupplierArticle(selected.article, item.article) || !text(item.brand) || text(selected.brand).toUpperCase() !== text(item.brand).toUpperCase()) return fail("ROSSKO_IDENTITY_MISMATCH");
    if (number(selected.retailPriceCents) <= 0) return fail("ROSSKO_PRICE_UNKNOWN");
    const proofProduct = supplierProofProducts.find(product => sameSupplierArticle(product.article, selected.article) && text(product.brand).toUpperCase() === text(selected.brand).toUpperCase());
    const role = proofProduct && catalogFluid(proofProduct) ? "fluid" : text(item.role, 40) || "unknown";
    const planned = number(item.requiredVolumeLiters);
    const converted = role === "fluid" ? quantityForLiters({ uomName: text(selected.uomName) || proofProduct?.uomName || null, packageVolume: text(selected.packageVolume) || proofProduct?.packageVolume || null, markingMode: null }, planned) : null;
    if (role === "fluid" && !converted?.quantity) return fail("ROSSKO_PACKAGE_UNKNOWN");
    // An OEM article alone does not establish a supplier product's technical declaration.
    if (role === "fluid" && (!proofProduct || !(item.serviceFamily === "engine_oil" ? engineOilSpecificationMatches(proofProduct, text(item.requiredFluidSpec)) : fluidSpecificationMatches(proofProduct, text(item.requiredFluidSpec))))) return fail("ROSSKO_FLUID_COMPATIBILITY_UNVERIFIED");
    const quantity = converted?.quantity ?? number(item.quantity);
    if (!(quantity > 0 && quantity <= 100)) return fail("INVALID_SALE_QUANTITY");
    if (selected.availableQuantity != null && number(selected.availableQuantity) < quantity) return fail("ROSSKO_INSUFFICIENT_QUANTITY");
    if (selected.quantityMultiple != null) {
      const multiple = number(selected.quantityMultiple), packs = quantity / multiple;
      if (multiple <= 0 || Math.abs(packs - Math.round(packs)) > 0.000001) return fail("ROSSKO_QUANTITY_MULTIPLE");
    }
    if (item.maxDeliveryDays != null && (selected.deliveryDays == null || number(selected.deliveryDays) > number(item.maxDeliveryDays))) return fail("ROSSKO_DELIVERY_NOT_AGREED");
    warnings.push(`${text(selected.brand)} ${text(selected.article)}: предложение условное, наличие, упаковку и срок подтвердить перед работой.`);
    const unitPriceCents = Math.round(number(selected.retailPriceCents));
    return [{ source: "rossko", offerId: text(selected.id), role, type: "product", name: text(selected.name, 180) || `Запчасть ${text(selected.brand)} ${text(selected.article)}`, article: text(selected.article), brand: text(selected.brand), quantity, unitPriceCents, totalCents: Math.round(unitPriceCents * quantity), supplierOffer: { ...selected, priceObservedAt: selected.fetchedAt, quantity, applicabilitySource: proofProduct?.id ?? null, conditional: true }, ...(converted?.quantity && converted.litersPerUnit ? { saleQuantity: { technicalVolumeLiters: number(item.technicalVolumeLiters) || null, plannedConsumptionLiters: planned, litersPerSaleUnit: converted.litersPerUnit, saleUnitQuantity: quantity, unitPriceCents, purchasedVolumeLiters: converted.purchasedVolumeLiters!, packageRemainderLiters: converted.packageRemainderLiters!, saleUnit: text(selected.uomName) || proofProduct?.uomName || "шт." } } : {}) }];
  });
  const lines = [...localLines, ...rosskoLines];
  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  return { lines, totalCents, totalRub: totalCents / 100, validUntil: null, localCount: localLines.length, supplierResults, unresolvedItems, warnings, priceComplete: unresolvedItems.length === 0 };
}

async function quotePreview(args: Record<string, unknown>, context: ToolContext) {
  const itemValues = quoteInputRows(args.items, 30);
  const rosskoItems = quoteInputRows(args.rosskoItems, 12);
  if (!itemValues.length && !rosskoItems.length) throw new Error("Для предварительного расчёта нужна хотя бы одна позиция");
  const base = await quoteLines(itemValues, rosskoItems, context);
  const maximumItems = quoteInputRows(args.maximumItems, 30);
  const maximumRosskoItems = quoteInputRows(args.maximumRosskoItems, 12);
  const hasMaximum = maximumItems.length > 0 || maximumRosskoItems.length > 0;
  const maximum = hasMaximum ? await quoteLines(maximumItems, maximumRosskoItems, context) : null;
  if (maximum && maximum.totalCents < base.totalCents) throw new Error("Верхняя граница расчёта не может быть ниже базовой суммы");
  return {
    result: {
      lines: base.lines,
      totalCents: base.totalCents,
      totalRub: base.totalRub,
      note: text(args.note, 400) || null,
      validUntil: base.validUntil,
      maximum: maximum ? { lines: maximum.lines, totalCents: maximum.totalCents, totalRub: maximum.totalRub, validUntil: maximum.validUntil } : null,
      mode: "preview",
      priceComplete: base.priceComplete,
      unresolvedItems: base.unresolvedItems,
      materialWarnings: base.warnings,
      finalQuote: base.priceComplete,
    },
    sources: [
      { sourceType: "internal_catalog", title: "Детерминированный расчёт по розничным ценам", excerpt: `${base.localCount} локальных поз.` },
      ...base.supplierResults.flatMap((item) => item.search.sources ?? []),
      ...(maximum ? maximum.supplierResults.flatMap((item) => item.search.sources ?? []) : []),
    ],
  } satisfies AssistantToolResult;
}

async function serviceQuoteV2(args: Record<string, unknown>, context: ToolContext) {
  const serviceFamily = text(args.serviceFamily, 60);
  const procedureType = text(args.procedureType, 60);
  const materialsOwner = text(args.materialsOwner, 30);
  const tariffContext = await assistantTariffContext(context.organizationId);
  const locationId = tariffContext.locationId ?? "";
  let selectedProducts = quoteInputRows(args.selectedProducts, 30);
  const consumables = quoteInputRows(args.consumables, 20);
  let rosskoItems = quoteInputRows(args.rosskoItems, 12);
  const automaticFluidResolution = await automaticLocalFluidResolution(args, context);
  const automaticFluid = automaticFluidResolution.selection;
  if (automaticFluid) {
    const fallbackArticle = normalizedArticle(args.requiredFluidOemArticle);
    selectedProducts = [
      { productId: automaticFluid.productId, quantity: automaticFluid.quantity, role: "fluid" },
      // A required OEM article is compatibility evidence only.  Once a local
      // compatible ATF is selected, no upstream fluid row may add a second,
      // more expensive product to the primary quote.
      ...selectedProducts.filter((item) => text(item.role, 40) !== "fluid" && text(item.productId, 160) !== automaticFluid.productId),
    ];
    rosskoItems = rosskoItems.filter(item => item.role !== "fluid" && (!fallbackArticle || normalizedArticle(item.article) !== fallbackArticle));
  }
  const preparedProducts = [...selectedProducts, ...consumables].map(item => ({ ...item, requiredVolumeLiters: args.requiredFluidVolumeLiters, technicalVolumeLiters: args.technicalVolumeLiters, requiredFluidSpec: args.requiredFluidSpec, serviceFamily }));
  const preparedSupplier = rosskoItems.map(item => ({ ...item, requiredVolumeLiters: args.requiredFluidVolumeLiters, technicalVolumeLiters: args.technicalVolumeLiters, serviceFamily, requiredFluidSpec: args.requiredFluidSpec }));
  const material = await quoteLines(preparedProducts, preparedSupplier, context);
  const appliedRule = await resolveLaborPrice({
    organizationId: context.organizationId,
    locationId,
    serviceFamily,
    procedureType,
    transmissionConfiguration: text(args.transmissionConfiguration, 60) || null,
    materialsOwner,
    vehicleId: text(args.vehicleId, 160) || null,
    aggregateCode: text(args.aggregateCode, 120) || null,
    vehicle: object(args.vehicleSnapshot),
    manualLaborPriceCents: null,
    fallbackServiceProductId: text(args.fallbackServiceProductId, 160) || null,
  });
  const laborLine = appliedRule.laborPriceCents == null ? null : {
    source: "labor_rule",
    role: "labor",
    type: "labor",
    name: `Работа: ${appliedRule.name}`,
    quantity: 1,
    unitPriceCents: appliedRule.laborPriceCents,
    totalCents: appliedRule.laborPriceCents,
  };
  const unroundedLines = laborLine ? [...material.lines, laborLine] : material.lines;
  const unroundedTotalCents = material.totalCents + (laborLine?.totalCents ?? 0);
  const calculationRules = (await getAgentSettings(context.organizationId)).calculationRules;
  const roundTotal = (value: number) => Math.ceil(value / calculationRules.totalRoundingCents) * calculationRules.totalRoundingCents;
  const totalCents = roundTotal(unroundedTotalCents);
  const roundingLine = totalCents > unroundedTotalCents ? {
    source: "calculation_rule",
    role: "rounding",
    type: "rounding",
    name: "Округление итога",
    quantity: 1,
    unitPriceCents: totalCents - unroundedTotalCents,
    totalCents: totalCents - unroundedTotalCents,
  } : null;
  const lines = roundingLine ? [...unroundedLines, roundingLine] : unroundedLines;
  const hasRange = appliedRule.priceFromCents != null && appliedRule.priceToCents != null && appliedRule.priceToCents > appliedRule.priceFromCents;
  const maximumLaborLine = hasRange ? { ...laborLine!, unitPriceCents: appliedRule.priceToCents!, totalCents: appliedRule.priceToCents! } : null;
  const maximum = maximumLaborLine ? (() => {
    const unroundedMaximumCents = material.totalCents + maximumLaborLine.totalCents;
    const maximumTotalCents = roundTotal(unroundedMaximumCents);
    const maximumRoundingLine = maximumTotalCents > unroundedMaximumCents ? { ...roundingLine, unitPriceCents: maximumTotalCents - unroundedMaximumCents, totalCents: maximumTotalCents - unroundedMaximumCents } : null;
    return {
      lines: maximumRoundingLine ? [...material.lines, maximumLaborLine, maximumRoundingLine] : [...material.lines, maximumLaborLine],
      totalCents: maximumTotalCents,
      totalRub: maximumTotalCents / 100,
      validUntil: material.validUntil,
    };
  })() : null;
  const finalQuote = laborLine !== null && !appliedRule.requiresHumanConfirmation && material.priceComplete;
  const selectedFluidLine = material.lines.find((line) => line.role === "fluid") ?? null;
  const fallbackSupplierUsed = !automaticFluid && material.lines.some((line) => line.source === "rossko" && line.role === "fluid");
  return {
    result: {
      lines,
      totalCents,
      totalRub: totalCents / 100,
      maximum,
      validUntil: material.validUntil,
      mode: "assistant_rule_v2",
      finalQuote,
      priceComplete: material.priceComplete,
      unresolvedItems: material.unresolvedItems,
      materialWarnings: material.warnings,
      requiresHumanConfirmation: appliedRule.requiresHumanConfirmation,
      appliedRule,
      tariffContext,
      scenario: { serviceFamily, procedureType, transmissionConfiguration: text(args.transmissionConfiguration, 60) || null, materialsOwner, locationId },
      automaticMaterialDecision: automaticFluid ? {
        source: "local_catalog",
        policy: "prefer_compatible_in_stock",
        requiredFluidSpec: text(args.requiredFluidSpec, 160),
        requiredFluidVolumeLiters: number(args.requiredFluidVolumeLiters),
        productId: automaticFluid.productId,
        productName: automaticFluid.productName,
        quantity: automaticFluid.quantity,
        availableUnits: automaticFluid.availableUnits,
        totalCents: automaticFluid.totalCents,
        compatibilityEvidence: automaticFluid.compatibilityEvidence,
        replacedRosskoArticle: text(args.requiredFluidOemArticle, 80) || null,
      } : null,
      materialSelectionTrace: {
        requiredSpecification: text(args.requiredFluidSpec, 160) || null,
        compatibilityEvidence: automaticFluid?.compatibilityEvidence ?? null,
        oemReference: { brand: "OEM", article: text(args.requiredFluidOemArticle, 80) || null },
        localCandidates: automaticFluidResolution.candidates,
        selectedLocalCandidate: automaticFluid ? automaticFluidResolution.candidates.find((candidate) => candidate.productId === automaticFluid.productId) ?? null : null,
        selectedProduct: selectedFluidLine ? { source: selectedFluidLine.source === "local" ? "local_catalog" : selectedFluidLine.source === "rossko" ? "supplier" : "customer_materials", productId: "productId" in selectedFluidLine ? text(selectedFluidLine.productId, 160) || null : null, catalogName: text(selectedFluidLine.name, 220) || null } : { source: "none", productId: null, catalogName: null },
        localAvailableQuantity: automaticFluid?.availableUnits ?? null,
        requiredQuantity: automaticFluid?.quantity ?? (number(args.requiredFluidVolumeLiters) || null),
        fallbackSupplierUsed,
        fallbackReason: fallbackSupplierUsed ? automaticFluidResolution.fallbackReason ?? "Для основной жидкости использован поставщик после проверки локального остатка." : automaticFluidResolution.fallbackReason,
        originalOnlyOverride: automaticFluidResolution.originalOnlyOverride,
      },
      message: finalQuote
        ? "Стоимость рассчитана backend-калькулятором по применённому правилу."
        : "Нужна проверка сотрудника: итоговая цена работы не зафиксирована автоматически.",
    },
    sources: [
      { sourceType: "internal_catalog" as const, title: "Детерминированный расчёт материалов и тарифа работы", excerpt: automaticFluid ? `${material.localCount} локальных поз.; масло ${automaticFluid.productName} выбрано backend по допуску и остатку; источник работы: ${appliedRule.source}` : `${material.localCount} локальных поз.; источник работы: ${appliedRule.source}` },
      ...material.supplierResults.flatMap((item) => item.search.sources ?? []),
    ],
  } satisfies AssistantToolResult;
}

function serviceFamilyForTechCard(type: string) {
  if (type === "engine_oil") return "engine_oil";
  if (["automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential", "awd_clutch"].includes(type)) return "transmission_fluid";
  // The pricing-rule resolver is deliberately allowed to return no rule for
  // these service families. That becomes an explicit hard blocker rather than
  // silently borrowing an unrelated engine or transmission tariff.
  return type;
}

function procedureForTechCard(code: QuoteAndTechCardProcedure, serviceType: string) {
  if (code === "partial" || code === "filter_service") return "partial";
  if (code === "machine" || code === "machine_filter_service") return "machine";
  return serviceType === "engine_oil" ? "oil_change" : "replace";
}

type FallbackServiceCard = { id: string; name: string; code: string | null; searchText: string | null };

/** Selects only an unambiguous service-card fallback; special AI tariffs keep priority in resolveLaborPrice. */
export function selectQuoteAndTechCardFallbackServiceCard(cards: FallbackServiceCard[], serviceType: string, procedure: QuoteAndTechCardProcedure) {
  const requiredPatterns = serviceType === "engine_oil" && procedure === "standard"
    ? [/(двигател|мотор)/iu, /(масл|oil|замен)/iu]
    : ["automatic_transmission", "cvt", "dsg", "manual_transmission"].includes(serviceType) && procedure === "partial"
      ? [/(акпп|atf|трансмис|автоматическ)/iu, /(частич|partial|слив)/iu]
      : ["automatic_transmission", "cvt", "dsg", "manual_transmission"].includes(serviceType) && procedure === "machine"
        ? [/(акпп|atf|трансмис|автоматическ)/iu, /(аппарат|machine|полн\S*\s+замен)/iu]
        : null;
  if (!requiredPatterns) return null;
  const matches = cards.filter((card) => {
    const searchable = `${card.name} ${card.code ?? ""} ${card.searchText ?? ""}`;
    return requiredPatterns.every((pattern) => pattern.test(searchable));
  });
  return matches.length === 1 ? matches[0] : null;
}

async function quoteAndTechCardFallbackServiceProductId(serviceType: string, procedure: QuoteAndTechCardProcedure) {
  const branchId = getScopedBranchId();
  const cards = await prisma.localProduct.findMany({
    where: { branchId, archived: false, entityType: "service", pricingMode: { not: "assistant_rule" }, salePriceCents: { gt: 0 } },
    select: { id: true, name: true, code: true, searchText: true },
    take: 100,
    orderBy: [{ name: "asc" }],
  });
  return selectQuoteAndTechCardFallbackServiceCard(cards, serviceType, procedure)?.id ?? null;
}

function uniqueWarnings(values: string[]) {
  return [...new Set(values.map((value) => text(value, 360)).filter(Boolean))].slice(0, 24);
}

export class QuoteAndTechCardIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "QuoteAndTechCardIntegrityError"; }
}

export class LocalFirstInvariantError extends Error {
  constructor(message: string) { super(message); this.name = "LocalFirstInvariantError"; }
}

export function classifyQuoteAndTechCardFailure(error: unknown) {
  const rawMessage = text(error instanceof Error ? error.message : String(error), 360) || "Не удалось получить цену материала или работы.";
  const filterPackageFailure = /снятием поддона|сервис[а-я\s]+фильтр|external_filter|integrated_pan|одноразовый креп[её]ж|уплотнен/iu.test(rawMessage);
  const message = filterPackageFailure
    ? "Для сервиса с фильтром не подтверждён комплект: фильтр или поддон, прокладка и крепёж должны быть подобраны и оценены вместе."
    : rawMessage;
  if (error instanceof AssistantToolError) {
    const requiredToContinue = error.code === "DATABASE_TEMPORARILY_UNAVAILABLE"
      ? "Повторить расчёт после восстановления доступа к базе данных."
      : error.code === "ROSSKO_AUTH_FAILED" || error.code === "ROSSKO_NOT_CONFIGURED"
        ? "Проверить настройки ROSSKO выбранного филиала."
        : error.code === "ROSSKO_NO_RESULTS"
          ? "Проверить OEM/кросс-номер или выбрать совместимый материал из локального каталога."
          : "Повторить поиск ROSSKO; при повторении открыть техническую причину в trace.";
    return { code: error.code, message, requiredToContinue };
  }
  const integrityFailure = error instanceof QuoteAndTechCardIntegrityError;
  const localFirstFailure = error instanceof LocalFirstInvariantError;
  const supplierFailure = /rossko|поставщик|предложен/i.test(message);
  const laborFailure = /тариф|правил[ао]\s+стоимости|цен[аы]\s+работ/i.test(message);
  const code = localFirstFailure ? "LOCAL_FIRST_POLICY_ERROR" : filterPackageFailure ? "FILTER_SERVICE_PACKAGE_NOT_CONFIRMED" : integrityFailure ? "QUOTE_INTEGRITY_ERROR" : supplierFailure ? "NO_MATERIAL_PRICE" : laborFailure ? "MISSING_LABOR_RULE" : "QUOTE_CALCULATION_ERROR";
  const requiredToContinue = localFirstFailure
    ? "Проверить выбор основной жидкости: при достаточном локальном остатке должна использоваться локальная позиция."
    : filterPackageFailure
      ? "Подтвердить применимость и цену фильтра, прокладки поддона и необходимого крепежа для этого VIN."
    : integrityFailure
      ? "Проверить количество, цену, состав пакета и итог в backend-калькуляторе."
      : supplierFailure
        ? "Найти совместимый материал с ценой в локальном каталоге или у поставщика."
        : laborFailure
          ? "Настроить правило стоимости работы или указать подтверждённую стоимость."
          : "Проверить доступность расчётчика и входные данные; причина сохранена в trace.";
  return { code, message, requiredToContinue };
}

function traceCandidates(value: unknown): QuoteAndTechCardMaterialSelectionTrace["localCandidates"] {
  if (!Array.isArray(value)) return [];
  return value.map(object).map((candidate) => ({
    productId: text(candidate.productId, 160),
    catalogName: text(candidate.catalogName, 220),
    compatible: candidate.compatible === true,
    availableQuantity: Math.max(0, number(candidate.availableQuantity)),
    requiredQuantity: candidate.requiredQuantity == null ? null : Math.max(0.001, number(candidate.requiredQuantity)),
    packageLiters: candidate.packageLiters == null ? null : Math.max(0.001, number(candidate.packageLiters)),
    unitPriceCents: Math.max(0, Math.round(number(candidate.unitPriceCents))),
    eligible: candidate.eligible === true,
    exclusionReason: ["incompatible_specification", "price_missing", "stock_insufficient", "package_unknown"].includes(text(candidate.exclusionReason, 80)) ? text(candidate.exclusionReason, 80) as "incompatible_specification" | "price_missing" | "stock_insufficient" | "package_unknown" : null,
  })).filter((candidate) => Boolean(candidate.productId) && Boolean(candidate.catalogName)).slice(0, 100);
}

function materialSelectionTrace(value: unknown, lines: QuoteAndTechCardQuoteOption["lines"]): QuoteAndTechCardMaterialSelectionTrace {
  const raw = object(value);
  const candidates = traceCandidates(raw.localCandidates);
  const selectedLocalId = text(object(raw.selectedLocalCandidate).productId, 160);
  const primaryFluid = lines.find((line) => line.role === "fluid") ?? null;
  const selectedSource = text(object(raw.selectedProduct).source, 40);
  const selectedProduct = primaryFluid ? {
    source: primaryFluid.source === "local_catalog" || selectedSource === "local_catalog" ? "local_catalog" as const : primaryFluid.source === "supplier" || selectedSource === "supplier" ? "supplier" as const : "customer_materials" as const,
    productId: primaryFluid.productId ?? null,
    catalogName: primaryFluid.catalogName,
    customerDisplayName: primaryFluid.customerDisplayName,
  } : { source: "none" as const, productId: null, catalogName: null, customerDisplayName: null };
  const selectedLocalCandidate = candidates.find((candidate) => candidate.productId === selectedLocalId) ?? null;
  return {
    requiredSpecification: text(raw.requiredSpecification, 160) || null,
    oemRequirement: {
      specification: text(raw.requiredSpecification, 160) || null,
      evidence: text(object(raw.oemRequirement).evidence, 700) || null,
    },
    oemReference: { brand: text(object(raw.oemReference).brand, 100) || null, article: text(object(raw.oemReference).article, 80) || null },
    localCandidates: candidates,
    selectedLocalCandidate,
    compatibleProduct: selectedLocalCandidate ? {
      productId: selectedLocalCandidate.productId,
      catalogName: selectedLocalCandidate.catalogName,
      compatibilityEvidence: text(object(raw.automaticMaterialDecision).compatibilityEvidence ?? raw.compatibilityEvidence, 700) || null,
    } : { productId: null, catalogName: null, compatibilityEvidence: null },
    selectedProduct,
    selectedSellableProduct: selectedProduct,
    localAvailableQuantity: number(raw.localAvailableQuantity) || null,
    requiredQuantity: number(raw.requiredQuantity) || primaryFluid?.quantity || null,
    fallbackSupplierUsed: raw.fallbackSupplierUsed === true,
    fallbackReason: text(raw.fallbackReason, 360) || null,
  };
}

/** A local compatible ATF with enough stock must remain the primary quoted product. */
export function assertLocalFirstInvariant(trace: QuoteAndTechCardMaterialSelectionTrace, originalOnlyOverride = false) {
  const local = trace.selectedLocalCandidate;
  const validLocalProductExists = Boolean(local?.compatible && local.eligible && local.unitPriceCents > 0);
  const localStockIsEnough = Boolean(local && trace.requiredQuantity != null && local.requiredQuantity != null && local.availableQuantity + 0.0001 >= local.requiredQuantity);
  if (validLocalProductExists && localStockIsEnough && !originalOnlyOverride && trace.selectedProduct.source !== "local_catalog") {
    throw new LocalFirstInvariantError("Найден совместимый локальный товар с достаточным остатком, но основная жидкость выбрана не из локального каталога. Расчёт не сохранён.");
  }
  if (validLocalProductExists && trace.fallbackSupplierUsed && !originalOnlyOverride) {
    throw new LocalFirstInvariantError("ROSSKO не должен использоваться для основной жидкости при наличии подходящего локального товара. Расчёт не сохранён.");
  }
}

/** Fails closed before the option or snapshot can expose contradictory quantities or totals. */
export function assertQuoteAndTechCardOptionIntegrity(option: Pick<QuoteAndTechCardQuoteOption, "billableQuantityLiters" | "lines" | "totalCents">, requirePrimaryFluid = true) {
  const lineTotal = option.lines.reduce((sum, line) => sum + line.totalCents, 0);
  if (option.totalCents == null || lineTotal !== option.totalCents) {
    throw new QuoteAndTechCardIntegrityError("Итог сметы не равен сумме строк. Расчёт не сохранён.");
  }
  for (const line of option.lines) {
    if (line.unitPriceCents != null && line.totalCents !== Math.round(line.unitPriceCents * line.quantity)) {
      throw new QuoteAndTechCardIntegrityError(`Строка «${line.customerDisplayName}» имеет противоречивую цену и количество. Расчёт не сохранён.`);
    }
  }
  if (option.billableQuantityLiters != null) {
    const primaryFluid = option.lines.filter((line) => line.role === "fluid");
    if (primaryFluid.length > 1 || (requirePrimaryFluid && primaryFluid.length !== 1) || (primaryFluid.length === 1 && primaryFluid[0].saleQuantity?.plannedConsumptionLiters !== option.billableQuantityLiters)) {
      throw new QuoteAndTechCardIntegrityError("Количество основной жидкости не совпадает с расчётным объёмом. Расчёт не сохранён.");
    }
  }
}

/** The customer-facing package may only promise parts that are actually quoted. */
export function assertServicePackageIntegrity(option: Pick<QuoteAndTechCardQuoteOption, "servicePackage" | "lines">, allowUnpricedExternalFilter = false, allowUnpricedRequiredHardware = false) {
  const requiredPart = option.servicePackage.requiredParts[0];
  if (requiredPart?.requiredForQuote) {
    const requiredRole = requiredPart.type === "integrated_pan" ? "pan" : "external_filter";
    const externalFilterAwaitingVin = allowUnpricedExternalFilter && requiredPart.type === "external_filter";
    if (!externalFilterAwaitingVin && !option.lines.some((line) => line.role === requiredRole && !line.internalOnly)) {
      throw new QuoteAndTechCardIntegrityError(`Для сервиса с фильтром не подтверждена обязательная позиция «${requiredPart.type}»: фильтр или поддон, прокладка и крепёж должны быть подобраны и оценены вместе.`);
    }
  }
  const requiredHardware = option.servicePackage.requiredHardware.filter((item) => item.requiredForQuote);
  const quotedHardware = option.lines.filter((line) => line.role === "hardware" && !line.internalOnly);
  const requiredHardwareQuantity = requiredHardware.reduce((sum, item) => sum + item.quantity, 0);
  const quotedHardwareQuantity = quotedHardware.reduce((sum, item) => sum + item.quantity, 0);
  if (!allowUnpricedRequiredHardware && quotedHardwareQuantity < requiredHardwareQuantity) {
    throw new QuoteAndTechCardIntegrityError("Обязательный одноразовый крепёж или уплотнения отсутствуют в смете.");
  }
}

/**
 * An engine-oil estimate may show the confirmed oil and labour before an
 * exact external filter is available without a VIN. The unpriced filter is
 * explicitly disclosed to the employee and customer; all transmission
 * packages remain fail-closed until their complete service kit is quoted.
 */
export function canUsePreliminaryEngineOilQuoteWithoutFilter(
  serviceType: QuoteAndTechCardInput["service"]["type"],
  servicePackage: QuoteAndTechCardQuoteOption["servicePackage"],
  lines: QuoteAndTechCardQuoteOption["lines"],
) {
  return serviceType === "engine_oil"
    && servicePackage.requiredParts.some((part) => part.type === "external_filter" && part.requiredForQuote)
    && !lines.some((line) => line.role === "external_filter" && !line.internalOnly);
}

export function canUsePreliminaryEngineOilQuoteWithoutHardware(
  serviceType: QuoteAndTechCardInput["service"]["type"],
  servicePackage: QuoteAndTechCardQuoteOption["servicePackage"],
  lines: QuoteAndTechCardQuoteOption["lines"],
) {
  if (serviceType !== "engine_oil") return false;
  const requiredQuantity = servicePackage.requiredHardware.filter((item) => item.requiredForQuote).reduce((sum, item) => sum + item.quantity, 0);
  const quotedQuantity = lines.filter((line) => line.role === "hardware" && !line.internalOnly).reduce((sum, line) => sum + line.quantity, 0);
  return requiredQuantity > quotedQuantity;
}

function engineOilHardwarePendingWarning(servicePackage: QuoteAndTechCardQuoteOption["servicePackage"]) {
  const missing = servicePackage.requiredHardware.filter((item) => item.requiredForQuote);
  if (!missing.length) return null;
  return `Предварительная сумма пока без обязательного крепежа: ${missing.map((item) => `${item.type} — ${item.quantity} шт.`).join("; ")}.`;
}

function previousQuoteResultForService(previous: QuoteAndTechCardArtifact | null | undefined, serviceType: QuoteAndTechCardInput["service"]["type"]) {
  const results = previous?.scenario === "quote_and_tech_card_bundle" ? previous.results : previous?.scenario === "quote_and_tech_card" ? [previous] : [];
  return results.find((result) => result.techCard.serviceType === serviceType) ?? null;
}

/**
 * A generic recalculation is a continuation, not a new technical diagnosis.
 * Retain only already confirmed service constraints when the fresh model input
 * has regressed them to `unknown`; new, explicit evidence can still replace
 * those values on a later non-continuation request.
 */
export function restoreQuoteAndTechCardContinuationInput(input: QuoteAndTechCardInput, previous: QuoteAndTechCardArtifact | null | undefined): QuoteAndTechCardInput {
  const prior = previousQuoteResultForService(previous, input.service.type);
  if (!prior) return input;
  const priorFilter = prior.techCard.filterPolicy;
  const filterWasConfirmed = prior.techCard.technicalStatus === "confirmed" && prior.techCard.verifiedFacts.some(fact => fact.field === "filterAccess" && fact.source) && priorFilter.presence === "present" && priorFilter.access !== "unknown";
  if (!filterWasConfirmed || input.service.filterAccess !== "unknown") return input;
  const priorProcedures = prior.quoteSet.requestedProcedures;
  return {
    ...input,
    vehicle: {
      ...input.vehicle,
      displayName: input.vehicle.displayName ?? prior.vehicle.displayName,
      aggregateCode: input.vehicle.aggregateCode ?? prior.vehicle.aggregate,
    },
    service: {
      ...input.service,
      filterAccess: priorFilter.access,
      filterEvidence: input.service.filterEvidence ?? priorFilter.evidence,
      transmissionConfiguration: input.service.transmissionConfiguration ?? (priorFilter.panServiceRequired ? "pan_and_filter" : null),
      serviceHardware: input.service.serviceHardware.length ? input.service.serviceHardware : prior.techCard.serviceHardware,
    },
    requestedProcedures: [...new Set([...priorProcedures, ...input.requestedProcedures])].slice(0, 2),
  };
}

function isAutomaticTransmissionService(type: QuoteAndTechCardInput["service"]["type"]) {
  return type === "automatic_transmission" || type === "cvt" || type === "dsg";
}

function withProcedures(input: QuoteAndTechCardInput, procedures: QuoteAndTechCardProcedure[]): QuoteAndTechCardInput {
  return { ...input, requestedProcedures: procedures, service: { ...input.service, procedures } };
}

/**
 * The employee's wording, rather than a model-selected default, decides
 * whether an АКПП method was specified. An unspecified request must retain a
 * separate filter-service branch so an unresolved filter cannot disappear
 * from an otherwise valid drain-and-fill calculation.
 */
export function applyAutomaticTransmissionScenarioDefaults(input: QuoteAndTechCardInput, requestMessage: unknown, preserveExisting = false): QuoteAndTechCardInput {
  if (!isAutomaticTransmissionService(input.service.type)) return input;
  // Earlier maintenance history is not the procedure being ordered now.
  const request = text(requestMessage, 4_000).toLocaleLowerCase("ru-RU").split(/хочу|клиент ответил\s*:/iu).at(-1) ?? "";
  if (!request) return input;
  const excludesFilter = /без\s+(?:замены\s+)?фильтр|фильтр\S*\s+не\s+меня|не\s+меня\S*\s+фильтр|без\s+(?:сняти[яе]\s+)?поддон|поддон\S*\s+не\s+сним|не\s+снима\S*\s+поддон/iu.test(request);
  const asksAnyFilterService = !excludesFilter && /фильтр|filter|поддон|pan\b/iu.test(request);
  // A multi-aggregate question may ask about a Haldex pump mesh or pan. That
  // wording belongs to the clutch service; it must not turn the АКПП input
  // into a filter-only scenario. Explicit gearbox + filter wording still
  // keeps the filter-service branch for the gearbox itself.
  const hasOtherFilterBearingAggregate = /haldex|халдекс|(?:муфт|насос|сетк)\S*\s*(?:haldex|халдекс|муфт)|(?:haldex|халдекс|муфт).*?(?:насос|сетк|поддон)/iu.test(request);
  const asksAutomaticFilterService = /(?:акпп|коробк\S*|автоматическ\S*|\batf\b|aisin|ga\d{1,2}[a-z0-9-]*)(?:[^.\n]{0,60})(?:фильтр|filter|поддон|pan\b)|(?:фильтр|filter|поддон|pan\b)(?:[^.\n]{0,60})(?:акпп|коробк\S*|автоматическ\S*|\batf\b|aisin|ga\d{1,2}[a-z0-9-]*)/iu.test(request);
  const asksFilterService = asksAnyFilterService && (!hasOtherFilterBearingAggregate || asksAutomaticFilterService);
  const asksMachine = !/не\s+(?:нужна\s+)?(?:аппаратн|полн)/iu.test(request) && /аппаратн|machine|полн\S*\s+замен|full\s+(?:exchange|replacement)/iu.test(request);
  const asksPartial = /частичн|partial|слив\S*\s+(?:и\s+)?залив|drain\S*\s+(?:and\s+)?fill/iu.test(request);
  const filterServicePossible = input.service.filterAccess !== "none" && input.service.filterAccess !== "internal_requires_disassembly";

  if (asksFilterService) {
    if (asksMachine && asksPartial) return withProcedures(input, ["filter_service", "machine_filter_service"]);
    if (asksMachine) return withProcedures(input, ["machine_filter_service"]);
    return withProcedures(input, ["filter_service"]);
  }
  if (asksMachine && asksPartial) return withProcedures(input, ["partial", "machine"]);
  if (asksMachine) return withProcedures(input, ["machine"]);
  if (asksPartial || excludesFilter) return withProcedures(input, ["partial"]);
  if (preserveExisting) return input;
  if (filterServicePossible) return withProcedures(input, ["partial", "filter_service"]);
  return withProcedures(input, ["partial"]);
}

async function blockedQuoteDiagnostics(input: QuoteAndTechCardInput, option: ReturnType<typeof createQuoteAndTechCardPlan>["options"][number], context: ToolContext) {
  const blockers: QuoteAndTechCardQuoteOption["blockers"] = [];
  const lines: QuoteAndTechCardQuoteOption["lines"] = [];
  const tariff = await assistantTariffContext(context.organizationId);
  const family = serviceFamilyForTechCard(input.service.type);
  const labour = await resolveLaborPrice({
    organizationId: context.organizationId, locationId: tariff.locationId ?? "",
    serviceFamily: family, procedureType: procedureForTechCard(option.code, input.service.type),
    transmissionConfiguration: option.servicePackage.panRemoval
      ? input.service.transmissionConfiguration === "two_coarse_filters" ? "two_coarse_filters" : "pan_and_filter"
      : isAutomaticTransmissionService(input.service.type) ? "no_pan" : "not_applicable",
    materialsOwner: input.service.materialsOwner, vehicleId: input.vehicle.id,
    aggregateCode: input.vehicle.aggregateCode ?? input.service.aggregate,
    vehicle: input.vehicle.snapshot ?? {},
    fallbackServiceProductId: await quoteAndTechCardFallbackServiceProductId(input.service.type, option.code),
  });
  if (!labour.requiresHumanConfirmation && labour.laborPriceCents != null && labour.priceFromCents == null && labour.priceToCents == null) {
    lines.push({ source: labour.source, type: "labor", role: "labor", name: "Работа", catalogName: "Работа", customerDisplayName: "Работа", quantity: 1, unitPriceCents: labour.laborPriceCents, totalCents: labour.laborPriceCents, internalOnly: false });
  } else blockers.push({ code: "MISSING_LABOR_RULE", message: "Точная стоимость работы для этого варианта не определена.", requiredToContinue: "Проверьте тариф выбранного филиала в правилах расчёта." });
  const spec = input.service.requiredFluidSpec;
  if (input.service.materialsOwner === "service" && spec && ["engine_oil", "transmission_fluid"].includes(family) && !context.employeeRequestedOriginalFluidOnly) {
    const rows = await localFluidCandidateRows(spec, family);
    const compatible = rows.filter(row => family === "engine_oil" ? engineOilSpecificationMatches(row, spec) : fluidSpecificationMatches(row, spec));
    if (!compatible.length) blockers.push({ code: "LOCAL_FLUID_NOT_FOUND", message: `В каталоге филиала не найдена жидкость с указанной спецификацией ${spec}.`.slice(0, 360), requiredToContinue: "Подберите материал у поставщика либо добавьте имеющийся товар, его спецификацию и цену в каталог. Применимость спецификации к автомобилю проверяется отдельно." });
    else if (!compatible.some(row => row.salePriceCents > 0)) blockers.push({ code: "NO_MATERIAL_PRICE", message: "У найденной жидкости не заполнена цена продажи.", requiredToContinue: "Укажите цену в карточке материала." });
    else if (!compatible.some(row => row.salePriceCents > 0 && row.stockBalances.some(stock => Number(stock.available) > 0))) blockers.push({ code: "LOCAL_FLUID_OUT_OF_STOCK", message: "У найденной жидкости нет положительного остатка в филиале.", requiredToContinue: "Проверьте поставку. Достаточное количество можно проверить после определения расхода." });
  }
  return { lines, blockers };
}

async function buildQuoteAndTechCard(args: Record<string, unknown>, context: ToolContext) {
  const rawInput = object(args.input);
  const rawVehicle = object(rawInput.vehicle);
  const verifiedVehicleSnapshot = object(context.verifiedVehicleSnapshot);
  const trustedMake = text(verifiedVehicleSnapshot.makeCanonical ?? verifiedVehicleSnapshot.makeRaw, 80);
  const trustedModel = text(verifiedVehicleSnapshot.modelCanonical ?? verifiedVehicleSnapshot.modelRaw, 120);
  const trustedDisplayName = trustedMake && trustedModel ? [trustedMake, trustedModel, verifiedVehicleSnapshot.year].filter(Boolean).join(" ") : null;
  const submittedSnapshot = object(rawVehicle.snapshot);
  for (const key of ["makeCanonical", "modelCanonical", "engineCode", "year", "vin", "transmissionType"]) {
    if (submittedSnapshot[key] && verifiedVehicleSnapshot[key] && String(submittedSnapshot[key]).toUpperCase() !== String(verifiedVehicleSnapshot[key]).toUpperCase()) throw new Error("VEHICLE_CONTEXT_CONFLICT: данные автомобиля противоречат подтверждённому контексту");
  }
  const submittedInput = parseQuoteAndTechCardInput({
    ...rawInput,
    vehicle: {
      ...rawVehicle,
      ...(trustedDisplayName ? { displayName: trustedDisplayName } : {}),
      snapshot: mergeAssistantVehicleSnapshot(submittedSnapshot, verifiedVehicleSnapshot, context.requestedVehicleSnapshot),
    },
    requestedDates: text(rawInput.requestedDates, 120) || requestedDateRangeFromText(context.requestMessage) || null,
  });
  const settings = await getAgentSettings(context.organizationId);
  const continuedInput = restoreQuoteAndTechCardContinuationInput(submittedInput, context.previousQuoteAndTechCard);
  const scenarioInput = applyAutomaticTransmissionScenarioDefaults(continuedInput, context.currentRequestMessage ?? context.requestMessage, Boolean(context.previousQuoteAndTechCard));
  const localTechnical = await verifiedLocalTechnicalInput(scenarioInput, context.organizationId);
  const plan = createQuoteAndTechCardPlan(localTechnical.input, {
    literRoundingStep: settings.calculationRules.literRoundingStep,
    transmissionMachineExchangeMultiplier: settings.calculationRules.transmissionMachineExchangeMultiplier,
    transmissionMinimumBillableLiters: settings.calculationRules.transmissionMinimumBillableLiters,
    maxTechnicalVerificationPasses: settings.calculationRules.maxTechnicalVerificationPasses,
  }, localTechnical.facts);
  const input = plan.input;
  const diagnosticsRequested = isAutomaticTransmissionService(input.service.type) && /диагност/iu.test(context.requestMessage ?? "") && !/без\s+диагност|диагност\S*\s+(?:не\s+нуж|убер|отмен)|убер\S*\s+диагност/iu.test(context.currentRequestMessage ?? "");
  if (diagnosticsRequested) plan.quoteWarnings.push("Запрошена диагностика перед заменой. Её отдельная стоимость пока не подтверждена.");
  const mannOilFilter = await resolveEngineOilMannFilter(input, context.organizationId).catch((): EngineOilMannFilterResolution => ({ candidates: [], summary: null, selectedProductId: null, sources: [], evidence: [] }));
  const baseBlockers = [...plan.hardBlockers];
  const quoteSnapshots: Array<{ argumentsValue: Record<string, unknown>; preview: Record<string, unknown> }> = [];
  const traceDiagnostics: Array<{ scope: "rossko"; code: AssistantToolErrorCode; message: string; diagnostic: string | null }> = [];
  let selectedMaterial: { name: string; catalogName: string; customerDisplayName: string; specification: string | null; quantity: number; compatibilityEvidence: string | null } | null = null;
  const options: QuoteAndTechCardQuoteOption[] = [];
  const fluidPreference = context.employeeRequestedOriginalFluidOnly ? "original_only" : "prefer_local_compatible";

  for (const option of plan.options) {
    const blockers = [...baseBlockers];
    if (option.blocker) blockers.push(option.blocker);
    if (blockers.length) {
      const diagnostics = await blockedQuoteDiagnostics(input, option, context);
      blockers.push(...diagnostics.blockers);
      options.push({ priceCompleteness: "subtotal", code: option.code, label: option.label, customerDisplayName: customerProcedureDisplayName(input.service.type, option.code), status: "blocked", technicalQuantityLiters: option.technicalQuantityLiters, billableQuantityLiters: option.billableQuantityLiters, quantityTrace: option.quantityTrace, servicePackage: option.servicePackage, materialSelectionTrace: { requiredSpecification: input.service.requiredFluidSpec ?? null, oemRequirement: { specification: input.service.requiredFluidSpec ?? null, evidence: null }, oemReference: { brand: "OEM", article: input.service.requiredFluidOemArticle ?? null }, localCandidates: [], selectedLocalCandidate: null, compatibleProduct: { productId: null, catalogName: null, compatibilityEvidence: null }, selectedProduct: { source: "none", productId: null, catalogName: null, customerDisplayName: null }, selectedSellableProduct: { source: "none", productId: null, catalogName: null, customerDisplayName: null }, localAvailableQuantity: null, requiredQuantity: option.billableQuantityLiters, fallbackSupplierUsed: false, fallbackReason: option.blocker?.message ?? null }, lines: diagnostics.lines, totalCents: null, maximumTotalCents: null, validUntil: null, blockers: blockers.slice(0, 6), warnings: [] });
      continue;
    }
    // Local-first is code, not an instruction: check the compatible local ATF
    // before passing any supplier ATF into quoteLines. Internal filters never
    // enter a standard TGM calculation at all.
    const localFluid = ["engine_oil", "automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential", "awd_clutch"].includes(input.service.type) && input.service.materialsOwner === "service"
      ? await automaticLocalFluidSelection({ serviceFamily: serviceFamilyForTechCard(input.service.type), materialsOwner: "service", requiredFluidSpec: input.service.requiredFluidSpec, requiredFluidVolumeLiters: option.billableQuantityLiters, fluidPreference }, context)
      : null;
    const materials = quoteAndTechCardMaterials(input, Boolean(localFluid));
    const supplierRows = quoteAndTechCardSupplierRows(input, Boolean(localFluid), option.billableQuantityLiters);
    const selectedProducts = applyBillableQuantityToPrimaryFluid([
      ...(localFluid ? [{ productId: localFluid.productId, quantity: localFluid.quantity, role: "fluid" }] : []),
      ...materials.selectedProducts,
      ...(mannOilFilter.selectedProductId && !materials.selectedProducts.some((item) => item.role === "external_filter") && !materials.consumables.some((item) => item.role === "external_filter")
        ? [{ productId: mannOilFilter.selectedProductId, quantity: 1, role: "external_filter" as const }]
        : []),
    ], option.billableQuantityLiters);
    const requiredFluidArticle = text(input.service.requiredFluidOemArticle, 80).toUpperCase();
    const scopedSupplierRows = supplierRows.map((row) => ({ ...row, role: requiredFluidArticle && row.article.toUpperCase() === requiredFluidArticle ? "fluid" : row.role }));
    const fallbackServiceProductId = await quoteAndTechCardFallbackServiceProductId(input.service.type, option.code);
    const quoteArgs: Record<string, unknown> = {
      serviceFamily: serviceFamilyForTechCard(input.service.type),
      procedureType: procedureForTechCard(option.code, input.service.type),
      // The labour rule must follow the actual quoted package.  A saved
      // pan/filter policy cannot accidentally receive the cheaper
      // drain-and-fill tariff merely because an upstream source omitted the
      // configuration field.
      transmissionConfiguration: option.servicePackage.panRemoval
        ? input.service.transmissionConfiguration === "two_coarse_filters" ? "two_coarse_filters" : "pan_and_filter"
        : ["automatic_transmission", "cvt", "dsg"].includes(input.service.type) ? "no_pan" : "not_applicable",
      materialsOwner: input.service.materialsOwner,
      vehicleId: input.vehicle.id ?? null,
      vehicleDisplayName: input.vehicle.displayName ?? null,
      vehicleSnapshot: input.vehicle.snapshot ?? {},
      aggregateCode: input.vehicle.aggregateCode ?? input.service.aggregate ?? null,
      requiredFluidSpec: input.service.requiredFluidSpec ?? null,
      requiredFluidVolumeLiters: option.billableQuantityLiters,
      technicalVolumeLiters: option.technicalQuantityLiters,
      requiredFluidOemArticle: input.service.requiredFluidOemArticle ?? null,
      fluidPreference,
      locationId: input.locationId,
      selectedProducts,
      consumables: materials.consumables,
      rosskoItems: scopedSupplierRows,
      manualLaborPriceCents: null,
      fallbackServiceProductId,
      serviceName: input.service.name,
      selectedScenario: option.label,
      optionalItems: [],
      assumptions: plan.quoteWarnings,
      internalWarnings: uniqueWarnings(plan.quoteWarnings),
      customerSafeWarnings: [],
    };
    try {
      const calculated = await serviceQuoteV2(quoteArgs, context);
      const quote = calculated.result;
      const lines = (Array.isArray(quote.lines) ? quote.lines as Array<Record<string, unknown>> : []).map((line) => {
        const role = ["fluid", "external_filter", "pan", "hardware", "consumable", "internal_filter", "labor", "rounding"].includes(text(line.role, 40)) ? text(line.role, 40) as "fluid" | "external_filter" | "pan" | "hardware" | "consumable" | "internal_filter" | "labor" | "rounding" : "unknown" as const;
        const catalogName = text(line.name, 220) || "Позиция";
        const supplierFallback = text(line.source, 80) === "rossko";
        const customerDisplayName = role === "labor" || text(line.type, 80) === "labor" ? "Работа" : role === "rounding" || text(line.type, 80) === "rounding" ? "Округление" : customerMaterialDisplayName(catalogName, input.service.requiredFluidSpec, supplierFallback, role);
        return {
          source: text(line.source, 80) === "local" ? "local_catalog" : text(line.source, 80) === "rossko" ? "supplier" : text(line.source, 80) || undefined,
          type: text(line.type, 80) || null,
          role,
          productId: text(line.productId, 160) || null,
          name: catalogName,
          catalogName,
          customerDisplayName,
          article: text(line.article, 120) || null,
          ...(line.supplierOffer ? { supplierOffer: object(line.supplierOffer) } : {}),
          ...(line.saleQuantity ? { saleQuantity: line.saleQuantity as QuoteAndTechCardQuoteOption["lines"][number]["saleQuantity"] } : {}),
          quantity: Math.max(0.001, number(line.quantity, 1)),
          unitPriceCents: Math.max(0, Math.round(number(line.unitPriceCents))),
          totalCents: Math.max(0, Math.round(number(line.totalCents))),
          internalOnly: role === "rounding" || text(line.type, 80) === "rounding",
        };
      });
      const hasPricedMaterial = input.service.materialsOwner === "customer" || lines.some((line) => text(line.type, 80) !== "labor" && number(line.totalCents) > 0);
      if (!hasPricedMaterial) blockers.push({ code: "NO_MATERIAL_PRICE", message: "Не найдена цена совместимого материала в локальном каталоге или у поставщика.", requiredToContinue: "Подтвердить совместимый материал и его цену либо выбрать вариант с материалами клиента." });
      const appliedRule = object(quote.appliedRule);
      if (quote.finalQuote !== true && (appliedRule.requiresHumanConfirmation === true || !lines.some((line) => line.role === "labor"))) blockers.push({ code: "MISSING_LABOR_RULE", message: "Для услуги нет применимого правила стоимости работ.", requiredToContinue: "Настроить тарифное правило или указать подтверждённую стоимость работы." });
      const automatic = object(quote.automaticMaterialDecision);
      const primaryFluid = lines.find((line) => line.role === "fluid");
      if (!selectedMaterial && primaryFluid) selectedMaterial = { name: primaryFluid.customerDisplayName, catalogName: primaryFluid.catalogName, customerDisplayName: primaryFluid.customerDisplayName, specification: text(input.service.requiredFluidSpec, 160) || null, quantity: primaryFluid.quantity, compatibilityEvidence: text(automatic.compatibilityEvidence, 700) || null };
      const supplierFluidWarning = lines.some((line) => line.role === "fluid" && line.source === "supplier")
        ? "Цена жидкости получена от поставщика: подтвердить наличие и срок поставки перед записью."
        : null;
      const preliminaryEngineOilFilter = canUsePreliminaryEngineOilQuoteWithoutFilter(input.service.type, option.servicePackage, lines)
        || (input.service.type === "engine_oil" && input.service.materialsOwner === "service" && input.service.filterAccess === "unknown" && !lines.some(line => line.role === "external_filter" && !line.internalOnly));
      const preliminaryEngineOilHardware = canUsePreliminaryEngineOilQuoteWithoutHardware(input.service.type, option.servicePackage, lines);
      const pendingPackageWarnings = [
        ...(preliminaryEngineOilFilter ? [ENGINE_OIL_FILTER_PRICE_PENDING_WARNING] : []),
        ...(preliminaryEngineOilHardware ? [engineOilHardwarePendingWarning(option.servicePackage) ?? ""] : []),
      ].filter(Boolean);
      if (pendingPackageWarnings.length) {
        quote.priceComplete = false;
        quoteArgs.customerSafeWarnings = [...(Array.isArray(quoteArgs.customerSafeWarnings) ? quoteArgs.customerSafeWarnings : []), ...pendingPackageWarnings];
      }
      const optionWarnings = uniqueWarnings([
        ...plan.quoteWarnings,
        ...(Array.isArray(quote.materialWarnings) ? quote.materialWarnings.map(item => text(item, 360)) : []),
        ...(Array.isArray(quote.unresolvedItems) ? quote.unresolvedItems.map(item => `В известную часть суммы не входит ${text(object(item).item, 160)}: требуется проверка товара, количества и цены.`) : []),
        ...(supplierFluidWarning ? [supplierFluidWarning] : []),
        ...pendingPackageWarnings,
      ]);
      const status = blockers.length ? "blocked" : optionWarnings.length ? "preliminary" : "ready";
      const maximum = object(quote.maximum);
      const selectionTrace = materialSelectionTrace(quote.materialSelectionTrace, lines);
      const quoteOption: QuoteAndTechCardQuoteOption = {
        priceCompleteness: quote.priceComplete === false || diagnosticsRequested ? "subtotal" : "complete",
        code: option.code,
        label: option.label,
        customerDisplayName: customerProcedureDisplayName(input.service.type, option.code),
        status,
        technicalQuantityLiters: option.technicalQuantityLiters,
        billableQuantityLiters: option.billableQuantityLiters,
        quantityTrace: option.quantityTrace,
        servicePackage: option.servicePackage,
        materialSelectionTrace: selectionTrace,
        lines,
        totalCents: status !== "blocked" ? Math.round(number(quote.totalCents)) : null,
        maximumTotalCents: status !== "blocked" && number(maximum.totalCents) > number(quote.totalCents) ? Math.round(number(maximum.totalCents)) : null,
        validUntil: text(quote.validUntil, 100) || null,
        blockers,
        warnings: optionWarnings,
      };
      assertLocalFirstInvariant(selectionTrace, object(quote.materialSelectionTrace).originalOnlyOverride === true);
      if (status !== "blocked") {
        assertQuoteAndTechCardOptionIntegrity(quoteOption, input.service.materialsOwner === "service" && quoteOption.priceCompleteness === "complete");
        if (quoteOption.priceCompleteness === "complete") assertServicePackageIntegrity(quoteOption, preliminaryEngineOilFilter, preliminaryEngineOilHardware);
      }
      options.push(quoteOption);
      if (status !== "blocked") quoteSnapshots.push({ argumentsValue: quoteArgs, preview: quote });
    } catch (error) {
      const failure = classifyQuoteAndTechCardFailure(error);
      if (error instanceof AssistantToolError) {
        traceDiagnostics.push({ scope: "rossko", code: error.code, message: error.message, diagnostic: error.diagnosticMessage });
      }
      options.push({
        priceCompleteness: "subtotal",
        code: option.code,
        label: option.label,
        customerDisplayName: customerProcedureDisplayName(input.service.type, option.code),
        status: "blocked",
        technicalQuantityLiters: option.technicalQuantityLiters,
        billableQuantityLiters: option.billableQuantityLiters,
        quantityTrace: option.quantityTrace,
        servicePackage: option.servicePackage,
        materialSelectionTrace: { requiredSpecification: input.service.requiredFluidSpec ?? null, oemRequirement: { specification: input.service.requiredFluidSpec ?? null, evidence: null }, oemReference: { brand: "OEM", article: input.service.requiredFluidOemArticle ?? null }, localCandidates: [], selectedLocalCandidate: null, compatibleProduct: { productId: null, catalogName: null, compatibilityEvidence: null }, selectedProduct: { source: "none", productId: null, catalogName: null, customerDisplayName: null }, selectedSellableProduct: { source: "none", productId: null, catalogName: null, customerDisplayName: null }, localAvailableQuantity: null, requiredQuantity: option.billableQuantityLiters, fallbackSupplierUsed: false, fallbackReason: failure.message },
        lines: [],
        totalCents: null,
        maximumTotalCents: null,
        validUntil: null,
        blockers: [failure],
        warnings: uniqueWarnings(plan.quoteWarnings),
      });
    }
  }
  const allOptionBlockers = options.flatMap((option) => Array.isArray(option.blockers) ? option.blockers : []) as Array<{ code: string; message: string; requiredToContinue: string }>;
  const hardBlockers = [...baseBlockers];
  for (const code of ["NO_MATERIAL_PRICE", "MISSING_LABOR_RULE", "FILTER_SERVICE_CONFIGURATION_NOT_CONFIRMED", "FILTER_SERVICE_NOT_APPLICABLE", "FILTER_SERVICE_PACKAGE_NOT_CONFIRMED", "QUOTE_INTEGRITY_ERROR", "LOCAL_FIRST_POLICY_ERROR", "QUOTE_CALCULATION_ERROR", "DATABASE_TEMPORARILY_UNAVAILABLE", "ROSSKO_NOT_CONFIGURED", "ROSSKO_AUTH_FAILED", "ROSSKO_TEMPORARILY_UNAVAILABLE", "ROSSKO_NO_RESULTS", "ROSSKO_SEARCH_FAILED"]) {
    const matching = allOptionBlockers.filter((blocker) => blocker.code === code);
    if (matching.length === options.length && matching[0]) hardBlockers.push(matching[0]);
  }
  const calculatedQuoteStatus = quoteStatus(options, hardBlockers);
  // Enrichment is intentionally isolated from quote calculation: missing
  // torque/evidence/visual material degrades only the tech card.
  const techCardStatus: "ready" | "partial" | "blocked" = calculatedQuoteStatus === "blocked" ? "blocked" : "partial";
  const draft = {
    scenario: "quote_and_tech_card" as const,
    status: "partial" as const,
    vehicle: { displayName: text(input.vehicle.displayName, 180) || "Автомобиль уточняется", aggregate: text(input.vehicle.aggregateCode ?? input.service.aggregate, 160) || null },
    quoteSet: {
      id: `quote-set:${input.vehicle.id ?? input.vehicle.displayName ?? "vehicle"}:${options.map((option) => option.code).join("+")}`.slice(0, 240),
      vehicleId: input.vehicle.id ?? null,
      serviceType: input.service.type,
      requestedProcedures: plan.requestedProcedures,
      requestedDates: input.requestedDates ?? null,
      status: calculatedQuoteStatus,
      confidence: calculatedQuoteStatus === "ready" && plan.quoteWarnings.length === 0 ? "confirmed" as const : "preliminary" as const,
      options,
      hardBlockers,
      warnings: uniqueWarnings(plan.quoteWarnings),
    },
    techCard: {
      technicalStatus: "needs_verification" as const,
      executionStatus: "verification_required" as const,
      verifiedFacts: localTechnical.facts,
      status: techCardStatus,
      serviceName: input.service.name,
      serviceType: input.service.type,
      requiredFluidSpec: text(input.service.requiredFluidSpec, 160) || null,
      filterPolicy: quoteAndTechCardFilterPolicy("unknown"),
      filterSummary: text(mannOilFilter.summary, 360) || "Конструкция и процедура обслуживания фильтра требуют проверки по применимому источнику.",
      filter: quoteAndTechCardFilterPolicy("unknown"),
      procedureVolumes: options.map(option => ({ code: option.code, customerDisplayName: option.customerDisplayName, technicalQuantityLiters: option.quantityTrace.sourceCapacityEvidence ? option.technicalQuantityLiters : null, billableQuantityLiters: option.billableQuantityLiters })),
      servicePackages: [],
      serviceHardware: [],
      levelTemperature: null,
      levelProcedure: null,
      servicePoints: [],
      torqueNotes: [],
      criticalChecks: ["До начала работ проверить применимость данных к автомобилю, агрегату и выбранной процедуре."],
      selectedMaterial,
      warnings: uniqueWarnings(["Техкарта требует проверки. Выполнение работ по неподтверждённым данным не разрешено.", ...plan.techCardWarnings]).slice(0, 20),
    },
    customerMessage: { status: "blocked" as const, text: "" },
    evidence: [...input.evidence, ...mannOilFilter.evidence].slice(0, 20),
  };
  const preliminaryMessage = buildQuoteAndTechCardCustomerMessage(draft);
  assistantEvent({ toolName: "quote_ready", status: "completed", serviceType: input.service.type, pricedOptions: options.filter(option => option.totalCents != null).length });
  assistantExecution()?.partialResults.push({ toolName: "preliminary_quote", result: { ...draft, customerMessage: preliminaryMessage } });
  const missingFields = ["procedure", "levelTemperature", "torqueNotes", "filterAccess"].filter(field => !localTechnical.facts.some(fact => fact.field === field));
  const aggregate = text(input.vehicle.aggregateCode ?? input.service.aggregate, 160).toUpperCase();
  const priorResearch = (context.technicalResearch ?? []).filter(item => item.serviceType === input.service.type && (!item.aggregate || item.aggregate.toUpperCase() === aggregate));
  const unresolvedResearchFields = missingFields.filter(field => !priorResearch.some(item => item.missingFields.includes(field) && plan.requestedProcedures.every(procedure => item.procedures.includes(procedure))));
  const research = context.technicalLookup && unresolvedResearchFields.length > 0 && options.some(option => option.totalCents != null)
    ? await assistantMemo("technical-enrichment", { vehicle: input.vehicle, service: input.service.type, missingFields }, async () => {
      try { return await context.technicalLookup!({ vehicle: input.vehicle, serviceType: input.service.type, aggregate: input.vehicle.aggregateCode ?? input.service.aggregate, procedures: plan.requestedProcedures, missingFields: unresolvedResearchFields }); }
      catch {
        assistantSignal()?.throwIfAborted();
        assistantEvent({ toolName: "technical_enrichment", status: "failed" });
        return { result: { status: "unavailable", missingFields, findings: "Источник недоступен. Технические данные требуют проверки; предварительная цена сохранена." }, sources: [] };
      }
    })
    : null;
  const customerMessage = preliminaryMessage;
  const researchEvidence = research?.result.findings ? [{ source: "Точечный поиск: сведения для проверки", fact: text(research.result.findings, 700), status: "needs_verification" as const, url: research.sources?.find(source => source.url)?.url ?? null }] : [];
  const retainedFindings = [...priorResearch.map(item => item.findings), text(research?.result.findings, 12_000)].filter(Boolean);
  const retainedResearch = priorResearch.length && retainedFindings.length ? { status: "needs_verification", findings: [...new Set(retainedFindings)].join("\n\n"), missingFields: [...new Set([...priorResearch.flatMap(item => item.missingFields), ...unresolvedResearchFields])], enrichmentStatus: research?.result.status ?? null } : null;
  const resultBase = { ...draft, evidence: [...draft.evidence.slice(0, 19), ...researchEvidence], techCard: { ...draft.techCard, research: retainedResearch ?? research?.result ?? null }, customerMessage, status: scenarioStatus(calculatedQuoteStatus, techCardStatus, customerMessage.status) };
  const result = parseQuoteAndTechCardResult(resultBase);
  if (!result) throw new Error("Не удалось сформировать проверенный контракт техкарты и сметы");
  return {
    result: { ...result, quoteSnapshots, traceDiagnostics, finalQuote: false },
    sources: [
      { sourceType: "internal_catalog" as const, title: "Техкарта и смета: детерминированный сценарий", excerpt: `Проверочных проходов: не более ${plan.rules.maxTechnicalVerificationPasses}; вариантов процедуры: ${options.length}.` },
      ...mannOilFilter.sources,
      ...(research?.sources ?? []),
      ...input.evidence.filter(item => item.url && /^https?:\/\//iu.test(item.url)).map((item) => ({ sourceType: "web" as const, title: item.source, url: item.url, excerpt: item.fact, metadata: { origin: "model_evidence", verification: "candidate", reportedStatus: item.status } })),
    ],
  } satisfies AssistantToolResult;
}

/**
 * The existing single-service builder remains the only calculator.  A complex
 * visit simply runs it once per aggregate and returns the independent results
 * together, so quantities and tariffs cannot leak from engine service into
 * the transmission (or any other aggregate).
 */
async function buildQuoteAndTechCardBundle(args: Record<string, unknown>, context: ToolContext) {
  const rawInputs = Array.isArray(args.inputs) ? args.inputs : [];
  if (rawInputs.length > 6) throw new Error("TOOL_SCHEMA_INVALID: bundle поддерживает 2–6 услуг");
  if (rawInputs.length < 2) throw new Error("Для комплексного расчёта укажите минимум две независимые услуги.");
  const vehicleKeys = rawInputs.map(value => {
    const vehicle = parseQuoteAndTechCardInput(value).vehicle;
    const snapshot = object(vehicle.snapshot);
    return JSON.stringify([vehicle.id, vehicle.displayName, snapshot.vin, snapshot.makeCanonical ?? snapshot.make, snapshot.modelCanonical ?? snapshot.model, snapshot.year]);
  });
  if (new Set(vehicleKeys).size !== 1) throw new ToolArgumentsError("VEHICLE_BUNDLE_CONFLICT", "Услуги комплекса должны относиться к одному автомобилю; данные автомобиля противоречивы");
  const results: QuoteAndTechCardResult[] = [];
  const quoteSnapshots: Array<{ argumentsValue: Record<string, unknown>; preview: Record<string, unknown> }> = [];
  const traceDiagnostics: Array<Record<string, unknown>> = [];
  const sources: AssistantToolSource[] = [];
  const builtResults = await assistantMap(rawInputs, rawInput => buildQuoteAndTechCard({ input: rawInput }, context), 2);
  for (const built of builtResults) {
    const parsed = parseQuoteAndTechCardToolResult(built.result);
    if (!parsed || parsed.scenario !== "quote_and_tech_card") throw new Error("Одна из услуг комплекса вернула непроверенный контракт техкарты и сметы.");
    results.push(parsed);
    const snapshots = Array.isArray(built.result.quoteSnapshots) ? built.result.quoteSnapshots : [];
    quoteSnapshots.push(...snapshots.map(object).filter((snapshot) => object(snapshot.argumentsValue) && object(snapshot.preview)) as Array<{ argumentsValue: Record<string, unknown>; preview: Record<string, unknown> }>);
    const diagnostics = Array.isArray(built.result.traceDiagnostics) ? built.result.traceDiagnostics : [];
    traceDiagnostics.push(...diagnostics.map(object));
    sources.push(...(built.sources ?? []));
  }
  const vehicle = results[0]?.vehicle ?? { displayName: "Автомобиль уточняется", aggregate: null };
  const quotedServiceCount = results.filter((result) => result.quoteSet.options.some((option) => option.status !== "blocked" && option.totalCents != null)).length;
  const bundleStatus = quotedServiceCount === 0 ? "blocked" as const : results.every((result) => result.status === "ready") ? "ready" as const : "partial" as const;
  const draft = {
    scenario: "quote_and_tech_card_bundle" as const,
    status: bundleStatus,
    vehicle,
    results,
    customerMessage: { status: "blocked" as const, text: "" },
    evidence: results.flatMap((result) => result.evidence).filter((item, index, list) => list.findIndex((other) => `${other.source}:${other.url ?? ""}:${other.fact}` === `${item.source}:${item.url ?? ""}:${item.fact}`) === index).slice(0, 60),
  };
  const customerMessage = buildQuoteAndTechCardBundleCustomerMessage(draft);
  const result = parseQuoteAndTechCardArtifact({ ...draft, customerMessage, status: bundleStatus });
  if (!result || result.scenario !== "quote_and_tech_card_bundle") throw new Error("Не удалось сформировать проверенный контракт комплексного расчёта.");
  return {
    result: { ...result, quoteSnapshots, traceDiagnostics, finalQuote: false },
    sources: [
      { sourceType: "internal_catalog" as const, title: "Комплексная техкарта и смета", excerpt: `Независимых услуг: ${results.length}; рассчитано: ${quotedServiceCount}.` },
      ...sources,
    ],
  } satisfies AssistantToolResult;
}

async function auditLegacyClientAgent(args: Record<string, unknown>, organizationId: string) {
  const limit = Math.max(1, Math.min(100, Math.round(number(args.limit, 30))));
  const [runs, quotes, cases] = await Promise.all([
    prisma.aIAgentRun.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, conversationId: true, status: true, triggerType: true, outboundMessageId: true, quoteId: true, startedAt: true, completedAt: true, errorMessage: true } }),
    prisma.aIServiceQuote.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, conversationId: true, status: true, serviceType: true, totalCents: true, sentAt: true, createdAt: true } }),
    prisma.crmDeal.findMany({ where: { organizationId, OR: [{ createdByLogin: "ai-agent" }, { source: "ai-agent" }] }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, title: true, caseStatus: true, status: true, conversationId: true, nextAction: true, createdAt: true, updatedAt: true } }),
  ]);
  return {
    result: {
      scope: "Аудит только. Данные не изменены и не удалены.",
      totals: { runsReviewed: runs.length, quotesReviewed: quotes.length, casesReviewed: cases.length, outboundMessagesLinked: runs.filter((run) => Boolean(run.outboundMessageId)).length },
      cases,
      recentRuns: runs,
      recentQuotes: quotes,
      recommendedNextStep: cases.some((item) => item.status === "open") ? "Проверьте открытые дела из списка и назначьте сотрудника или закройте их вручную." : "Открытых следов бывшего клиентского агента в выбранной выборке нет.",
    },
    sources: [{ sourceType: "internal_catalog", title: "Аудит демонтированного клиентского агента", excerpt: `Просмотрено: ${runs.length} запусков, ${quotes.length} расчётов, ${cases.length} дел.` }],
  } satisfies AssistantToolResult;
}

async function executeAssistantToolUncached(name: string, argumentsValue: unknown, context: ToolContext): Promise<AssistantToolResult> {
  const args = object(argumentsValue);
  const definition = assistantFunctionTools.find(tool => tool.name === name);
  if (!definition) throw new ToolArgumentsError("TOOL_UNKNOWN", "Инструмент недоступен");
  if (!name.startsWith("build_quote_and_tech_card")) validateAssistantToolArguments(argumentsValue, definition.parameters);
  if (name === "lookup_technical_data") {
    const requestedVehicle = object(args.vehicle);
    const vehicleSnapshot = mergeAssistantVehicleSnapshot({ ...requestedVehicle, ...object(requestedVehicle.snapshot) }, context.verifiedVehicleSnapshot, context.requestedVehicleSnapshot);
    const local = await mannContext(context.organizationId, assistantVehicle(vehicleSnapshot));
    const serviceType = normalizeQuoteAndTechCardServiceType(args.serviceType) ?? text(args.serviceType, 80);
    const procedures = [...new Set((Array.isArray(args.procedures) ? args.procedures : text(args.procedure, 80).split(/[,;]/u)).map(normalizeQuoteAndTechCardProcedure).filter((value): value is QuoteAndTechCardProcedure => value !== null))].sort();
    const trustedSnapshot = context.verifiedVehicleSnapshot ?? {};
    const verified = serviceType in technicalSystems ? await verifiedLocalTechnicalInput(parseQuoteAndTechCardInput({
      vehicle: { snapshot: vehicleSnapshot, aggregateCode: text(serviceType === "engine_oil" ? trustedSnapshot.engineCode : trustedSnapshot.transmissionCode, 120) || null },
      service: { type: serviceType, name: "Технический вопрос" },
    }), context.organizationId) : null;
    const requestedFields = Array.isArray(args.missingFields) ? [...new Set(args.missingFields.map(item => text(item, TECHNICAL_QUESTION_MAX_LENGTH)).filter(Boolean))].slice(0, 8) : [];
    const missingFields = requestedFields.filter(field => field === "capacity" && procedures.length
      ? !procedures.every(procedure => verified?.facts.some(fact => fact.field === "capacity" && fact.procedure === procedure))
      : !verified?.facts.some(fact => fact.field === field));
    const externalRequest = { vehicle: vehicleSnapshot, serviceType, procedure: procedures.length === 1 ? procedures[0] : null, procedures, missingFields: [...missingFields].sort(), localProfile: local.profile };
    const external = missingFields.length && context.technicalLookup
      ? await assistantMemo("technical-lookup-external", externalRequest, () => context.technicalLookup!(externalRequest))
      : null;
    return { result: { vehicleDecision: local.resolution.decision, vehicleResolution: mannResolutionDiagnostic(local.resolution), localProfile: local.profile, verifiedFacts: verified?.facts ?? [], requirements: verified?.facts.length ? verified.input.service : null, external: external?.result ?? null, requestedFields, missingFields, executionStatus: "verification_required" }, sources: [{ sourceType: "mann", title: "Локальный технический профиль", metadata: { status: local.profile.status, vehicleResolution: mannResolutionDiagnostic(local.resolution) } }, ...(external?.sources ?? [])] };
  }
  if (name === "get_workspace_context") return { result: { organizationId: context.organizationId, currentUser: { id: context.actorId, name: context.actorName, role: context.actorRole }, permissions: { readData: true, writeData: false, createQuoteDraft: false, createShipmentDraft: false, createAppointment: false, placeRosskoOrder: false } } };
  if (name === "search_clients") return searchClients(args);
  if (name === "get_client_history") return lookupClientHistory(args);
  if (name === "get_vehicle_service_history") return vehicleServiceHistory(args);
  if (name === "lookup_vehicle") {
    const result = await lookupVehicle({ organizationId: context.organizationId, input: text(args.input, 48), inputType: text(args.inputType, 12) as "vin" | "plate" | "frame", actorLogin: context.actorId });
    return { result: { ...result, note: "Провайдерский результат не изменял карточку автомобиля." }, sources: [{ sourceType: "tronk", title: "TRONK · определение автомобиля", excerpt: result.message ?? result.status, metadata: { fromCache: result.fromCache, sourceMethods: result.sourceMethods } }] };
  }
  if (name === "find_mann_filters") return findMannFilters(args, context);
  if (name === "search_local_catalog") return searchCatalog(args);
  if (name === "get_stock") return stock(args);
  if (name === "search_rossko") return rossko(args, context);
  if (name === "find_service_options") return findServiceOptions(args);
  if (name === "calculate_quote_preview") return quotePreview(args, context);
  if (name === "calculate_service_quote_v2") return serviceQuoteV2(args, context);
  if (name === "build_quote_and_tech_card") return buildQuoteAndTechCard(args, context);
  if (name === "build_quote_and_tech_card_bundle") return buildQuoteAndTechCardBundle(args, context);
  if (name === "audit_legacy_client_agent") return auditLegacyClientAgent(args, context.organizationId);
  throw new Error(`Недоступный инструмент: ${name}`);
}

export async function executeAssistantTool(name: string, argumentsValue: unknown, context: ToolContext): Promise<AssistantToolResult> {
  return assistantMemo("tool:" + name, { branchId: getScopedBranchId(), organizationId: context.organizationId, argumentsValue }, async () => {
    const result = await withinAssistantDeadline(() => executeAssistantToolUncached(name, argumentsValue, context));
    assistantExecution()?.partialResults.push({ toolName: name, result: result.result });
    return result;
  });
}

export function safeAssistantJson(value: unknown) {
  return safeJson(jsonSafe(value));
}
