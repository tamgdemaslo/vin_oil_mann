import type { Prisma } from "@prisma/client";
import { anonymousRetailCounterpartyExclusion } from "@/lib/anonymous-retail-counterparty";
import { prisma } from "@/lib/db";
import { DEFAULT_ROSSKO_MARKUP_RULES, getAgentSettings } from "@/lib/ai-agent/settings";
import type { AIRosskoMarkupRule } from "@/lib/ai-agent/types";
import { IntegrationNotConfiguredForBranch } from "@/lib/branch-integration-credentials";
import { lookupVehicle, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-identity";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { resolveLaborPrice } from "./labor-pricing";
import { fluidSpecificationExcerpt, fluidSpecificationTokens, selectPreferredLocalFluid, shouldRequireOriginalFluid, type LocalFluidSelection } from "./material-selection";
import { applyBillableQuantityToPrimaryFluid, buildQuoteAndTechCardCustomerMessage, createQuoteAndTechCardPlan, customerMaterialDisplayName, customerProcedureDisplayName, parseQuoteAndTechCardResult, QUOTE_AND_TECH_CARD_TOOL_PARAMETERS, quoteAndTechCardMaterials, quoteAndTechCardSupplierRows, quoteStatus, scenarioStatus, type QuoteAndTechCardQuoteOption } from "./quote-and-tech-card";
import { jsonSafe } from "./json-safe";

export type AssistantToolSource = {
  sourceType: "internal_catalog" | "mann" | "tronk" | "rossko";
  title: string;
  url?: string | null;
  excerpt?: string | null;
  metadata?: Record<string, unknown>;
};

export type AssistantToolResult = { result: Record<string, unknown>; sources?: AssistantToolSource[] };

/** A safe, user-facing failure passed into both trace and the model response. */
export class AssistantToolError extends Error {
  constructor(public readonly code: "ROSSKO_NOT_CONFIGURED" | "ROSSKO_AUTH_FAILED" | "ROSSKO_TEMPORARILY_UNAVAILABLE" | "ROSSKO_NO_RESULTS", message: string) {
    super(message);
    this.name = "AssistantToolError";
  }
}

export const assistantFunctionTools = [
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
    description: "Найти применяемость фильтров MANN по марке, модели, году и при необходимости коду двигателя. Результат может быть неоднозначным.",
    parameters: { type: "object", additionalProperties: false, required: ["make", "model"], properties: { make: { type: "string", minLength: 1, maxLength: 80 }, model: { type: "string", minLength: 1, maxLength: 120 }, year: { type: ["integer", "null"], minimum: 1950, maximum: 2100 }, engineCode: { type: ["string", "null"], maxLength: 80 }, filterType: { type: ["string", "null"], maxLength: 60 } } },
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
    parameters: { type: "object", additionalProperties: false, required: ["article"], properties: { article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 } } },
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
    parameters: { type: "object", additionalProperties: false, required: ["items", "rosskoItems"], properties: { items: { type: "array", minItems: 0, maxItems: 30, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, rosskoItems: { type: "array", minItems: 0, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["article", "brand", "quantity"], properties: { article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 }, offerId: { type: ["string", "null"], maxLength: 100 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, maximumItems: { type: ["array", "null"], maxItems: 30, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, maximumRosskoItems: { type: ["array", "null"], maxItems: 12, items: { type: "object", additionalProperties: false, required: ["article", "brand", "quantity"], properties: { article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 }, offerId: { type: ["string", "null"], maxLength: 100 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } }, vehicleId: { type: ["string", "null"], maxLength: 160 }, vehicleDisplayName: { type: ["string", "null"], maxLength: 180 }, vehicleSnapshot: { type: ["object", "null"], additionalProperties: true }, serviceName: { type: ["string", "null"], maxLength: 180 }, selectedScenario: { type: ["string", "null"], maxLength: 180 }, maximumPriceSentence: { type: ["string", "null"], maxLength: 360 }, optionalItems: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } }, assumptions: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } }, internalWarnings: { type: ["array", "null"], maxItems: 12, items: { type: "string", maxLength: 360 } }, customerSafeWarnings: { type: ["array", "null"], maxItems: 6, items: { type: "string", maxLength: 360 } }, note: { type: ["string", "null"], maxLength: 400 } } },
  },
  {
    type: "function",
    name: "calculate_service_quote_v2",
    description: "Детерминированно рассчитать стоимость материалов и работы по тарифному правилу ИИ-помощника. Всегда используй для замены масла, АКПП/CVT и фильтров. Цена карточки услуги допускается только как явный fallback, когда специального правила нет. Итог складывает только backend; для смешанных материалов или неизвестной сложности инструмент возвращает обязательное подтверждение, а не случайную цену.",
    parameters: {
      type: "object", additionalProperties: false,
      required: ["serviceFamily", "procedureType", "materialsOwner", "locationId", "selectedProducts", "consumables", "rosskoItems"],
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
        selectedProducts: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } },
        consumables: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { productId: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } },
        rosskoItems: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["article", "brand", "quantity"], properties: { article: { type: "string", minLength: 2, maxLength: 80 }, brand: { type: ["string", "null"], maxLength: 80 }, offerId: { type: ["string", "null"], maxLength: 100 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100 } } } },
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
    description: "Собрать единый предсказуемый результат «техкарта + смета» для внутреннего сотрудника. Используй после VIN/технической проверки и проверки локального каталога. Инструмент сам округляет объём, выбирает совместимую жидкость из локального остатка, применяет правило работы и формирует клиентский текст только из готовой сметы. Передавай не более двух процедур. Внутренний фильтр АКПП/CVT/DSG, требующий разборки агрегата, помечай filterAccess=internal_requires_disassembly и не передавай в rosskoItems.",
    parameters: QUOTE_AND_TECH_CARD_TOOL_PARAMETERS,
  },
  {
    type: "function",
    name: "audit_legacy_client_agent",
    description: "Проверить следы демонтированного клиентского агента: запуски, созданные им дела CRM и расчёты. Только аудит, ничего не изменяет.",
    parameters: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
  },
] as const;

type ToolContext = {
  organizationId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  employeeRequestedOriginalFluidOnly?: boolean;
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

function safeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function offerRows(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => offerRows(item, depth + 1));
  if (typeof value !== "object") return [];
  const row = object(value);
  const keys = Object.keys(row).join(" ");
  const looksLikeOffer = /(part|article|number|brand|price|cost|stock|delivery)/i.test(keys) && /(price|cost|stock|count|quantity)/i.test(keys);
  return [...(looksLikeOffer ? [row] : []), ...Object.values(row).flatMap((item) => offerRows(item, depth + 1))];
}

function rubles(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
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

async function findMannFilters(args: Record<string, unknown>): Promise<AssistantToolResult> {
  const make = text(args.make, 80);
  const model = text(args.model, 120);
  const yearValue = args.year == null ? null : Math.round(number(args.year));
  const engineCode = text(args.engineCode, 80);
  const filterType = text(args.filterType, 60);
  const makeNormalized = normalizeVehicleMake(make) || make.toUpperCase();
  const modelNormalized = normalizeVehicleModel(model, makeNormalized).canonical || model.toUpperCase();
  const rows = await prisma.mannFilterApplication.findMany({
    where: {
      makeNormalized: { contains: makeNormalized, mode: "insensitive" },
      modelNormalized: { contains: modelNormalized, mode: "insensitive" },
      ...(filterType ? { filterType: { contains: filterType, mode: "insensitive" } } : {}),
      ...(yearValue ? { AND: [{ OR: [{ vehicleYearFrom: null }, { vehicleYearFrom: { lte: yearValue } }] }, { OR: [{ vehicleYearTo: null }, { vehicleYearTo: { gte: yearValue } }] }] } : {}),
      ...(engineCode ? { OR: [{ engineCode: { contains: engineCode, mode: "insensitive" } }, { detail: { contains: engineCode, mode: "insensitive" } }] } : {}),
    },
    select: { filterType: true, filterSubtype: true, mannArticle: true, filterNote: true, vehicleVariantKey: true, detail: true, vehicleText: true, effectiveVehicleText: true, engineCode: true, hp: true, vehicleYears: true, sourceFile: true, catalogPage: true },
    orderBy: [{ filterType: "asc" }, { mannArticle: "asc" }],
    take: 60,
  });
  const unique = rows.filter((row, index) => rows.findIndex((other) => `${other.vehicleVariantKey}:${other.filterType}:${other.mannArticle}` === `${row.vehicleVariantKey}:${row.filterType}:${row.mannArticle}`) === index);
  return {
    result: { found: unique.length > 0, ambiguous: new Set(unique.map((row) => row.vehicleVariantKey)).size > 1, criteria: { make, model, year: yearValue, engineCode: engineCode || null, filterType: filterType || null }, filters: unique },
    sources: unique.slice(0, 5).map((row) => ({ sourceType: "mann" as const, title: "Внутренняя база применяемости MANN", excerpt: `${row.filterType}: ${row.mannArticle}${row.sourceFile ? ` · ${row.sourceFile}` : ""}`, metadata: { catalogPage: row.catalogPage, vehicleVariantKey: row.vehicleVariantKey } })),
  };
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

function rosskoFailure(error: unknown) {
  if (error instanceof AssistantToolError) return error;
  if (error instanceof IntegrationNotConfiguredForBranch) {
    return new AssistantToolError("ROSSKO_NOT_CONFIGURED", "ROSSKO не подключён для этого филиала. Откройте Кабинет → Интеграции и добавьте ключи.");
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/(auth|authoriz|ключ|key1|key2|access denied|forbidden|401|403)/i.test(message)) {
    return new AssistantToolError("ROSSKO_AUTH_FAILED", "ROSSKO не принял ключи этого филиала. Проверьте подключение в Кабинете → Интеграции.");
  }
  return new AssistantToolError("ROSSKO_TEMPORARILY_UNAVAILABLE", "ROSSKO временно недоступен. Повторите поиск позже или используйте локальный каталог.");
}

async function rossko(args: Record<string, unknown>, context: ToolContext) {
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
    const offers = offerRows(raw).map((row, index) => {
      const purchasePriceCents = rubles(row.price ?? row.Price ?? row.cost ?? row.Cost);
      const retail = rosskoRetailPrice(purchasePriceCents, settings.rosskoMarkupRules || DEFAULT_ROSSKO_MARKUP_RULES);
      return {
        id: text(row.id ?? row.ID, 80) || `offer-${index + 1}`,
        brand: text(row.brand ?? row.Brand, 80) || brand || null,
        article: text(row.partnumber ?? row.partNumber ?? row.article, 80) || article,
        name: text(row.name ?? row.Name, 180) || null,
        purchasePriceCents,
        retailPriceCents: retail?.retailPriceCents ?? null,
        retailPriceRub: retail ? retail.retailPriceCents / 100 : null,
        appliedMarkupRule: retail?.appliedRule ?? null,
        stock: text(row.stock ?? row.Stock ?? row.count ?? row.quantity, 80) || "уточняется",
        delivery: text(row.delivery ?? row.delivery_time ?? row.period, 100) || "уточняется",
      };
    }).filter((offer, index, list) => list.findIndex((other) => `${other.brand}:${other.article}:${other.purchasePriceCents}:${other.delivery}` === `${offer.brand}:${offer.article}:${offer.purchasePriceCents}:${offer.delivery}`) === index).slice(0, 12);
    if (!offers.length) throw new AssistantToolError("ROSSKO_NO_RESULTS", "ROSSKO не вернул предложений по этому номеру для выбранного филиала.");
    return { result: { found: true, article, brand: brand || null, offers, validForHours: 24, mode: "read_only_search" }, sources: [{ sourceType: "rossko", title: "ROSSKO · read-only поиск", excerpt: `Артикул: ${article}` }] } satisfies AssistantToolResult;
  } catch (error) {
    throw rosskoFailure(error);
  }
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
  const rows = await Promise.all(queries.map((query) => prisma.localProduct.findMany({
    where: { archived: false, entityType: "service", OR: [{ name: { contains: query, mode: "insensitive" } }, { article: { contains: query, mode: "insensitive" } }, { code: { contains: query, mode: "insensitive" } }, { searchText: { contains: query.toLowerCase(), mode: "insensitive" } }] },
    select: { id: true, name: true, article: true, code: true, salePriceCents: true },
    take: limit,
    orderBy: { name: "asc" },
  })));
  const services = rows.flat().filter((service, index, all) => all.findIndex((other) => other.id === service.id) === index).slice(0, limit).map((service) => ({ ...service, retailPriceRub: service.salePriceCents / 100 }));
  return { result: { request, searchedSynonyms: queries, found: services.length > 0, services }, sources: [{ sourceType: "internal_catalog", title: "Локальный каталог услуг", excerpt: `Синонимы: ${queries.join(" · ")}` }] } satisfies AssistantToolResult;
}

function quoteInputRows(value: unknown, max: number) {
  return Array.isArray(value) ? value.map(object).slice(0, max) : [];
}

function normalizedArticle(value: unknown) {
  return text(value, 100).toLocaleUpperCase("ru-RU").replace(/[^A-ZА-Я0-9]/g, "");
}

async function automaticLocalFluidSelection(args: Record<string, unknown>, context: ToolContext): Promise<LocalFluidSelection | null> {
  if (text(args.serviceFamily, 60) !== "transmission_fluid" || text(args.materialsOwner, 30) !== "service") return null;
  if (shouldRequireOriginalFluid({
    fluidPreference: text(args.fluidPreference, 40) || null,
    employeeRequestedOriginalOnly: Boolean(context.employeeRequestedOriginalFluidOnly),
  })) return null;
  const requiredSpec = text(args.requiredFluidSpec, 160);
  const requiredLiters = number(args.requiredFluidVolumeLiters);
  const tokens = fluidSpecificationTokens(requiredSpec).filter((token) => token.length >= 2).slice(0, 8);
  if (!requiredSpec || requiredLiters <= 0 || tokens.length < 2) {
    throw new Error("Для трансмиссионного расчёта укажите requiredFluidSpec и requiredFluidVolumeLiters, чтобы backend проверил локальное масло");
  }
  const branchId = getScopedBranchId();
  const fields = (token: string): Prisma.LocalProductWhereInput[] => [
    { atf: { contains: token, mode: "insensitive" } },
    { oemAtf: { contains: token, mode: "insensitive" } },
    { searchText: { contains: token, mode: "insensitive" } },
  ];
  const rows = await prisma.localProduct.findMany({
    where: {
      branchId,
      archived: false,
      entityType: "product",
      salePriceCents: { gt: 0 },
      stockBalances: { some: { branchId, available: { gt: 0 } } },
      AND: tokens.map((token) => ({ OR: fields(token) })),
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
      searchText: true,
      stockBalances: { where: { branchId }, select: { available: true } },
    },
    orderBy: [{ salePriceCents: "asc" }, { name: "asc" }],
    take: 100,
  });
  return selectPreferredLocalFluid(rows.map((row) => ({
    ...row,
    availableUnits: row.stockBalances.reduce((sum, stock) => sum + Number(stock.available), 0),
  })), requiredSpec, requiredLiters);
}

async function quoteLines(itemValues: Array<Record<string, unknown>>, rosskoItems: Array<Record<string, unknown>>, context: ToolContext) {
  const ids = [...new Set(itemValues.map((item) => text(item.productId, 160)).filter(Boolean))];
  const products = await prisma.localProduct.findMany({ where: { id: { in: ids }, archived: false }, select: { id: true, entityType: true, name: true, article: true, salePriceCents: true } });
  const byId = new Map(products.map((item) => [item.id, item]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`Не найдены позиции локального каталога: ${missing.join(", ")}`);
  const localLines = itemValues.map((item) => {
    const productId = text(item.productId, 160);
    const product = byId.get(productId)!;
    const quantity = Math.round(Math.max(0.001, Math.min(100, number(item.quantity, 1))) * 1000) / 1000;
    const totalCents = Math.round(product.salePriceCents * quantity);
    return { source: "local", productId, role: text(item.role, 40) || "unknown", type: product.entityType, name: product.name, article: product.article, quantity, unitPriceCents: product.salePriceCents, totalCents };
  });
  const supplierResults = await Promise.all(rosskoItems.map(async (item) => ({ item, search: await rossko({ article: text(item.article, 80), brand: text(item.brand, 80) }, context) })));
  const rosskoLines = supplierResults.map(({ item, search }) => {
    const offers = Array.isArray(search.result.offers) ? search.result.offers as Array<Record<string, unknown>> : [];
    const selectedOfferId = text(item.offerId, 100);
    const selected = (selectedOfferId ? offers.find((offer) => text(offer.id, 100) === selectedOfferId) : undefined) ?? offers.find((offer) => number(offer.retailPriceCents) > 0);
    if (!selected || number(selected.retailPriceCents) <= 0) throw new Error(`ROSSKO не вернуло пригодное предложение для ${text(item.article, 80)}`);
    const quantity = Math.round(Math.max(0.001, Math.min(100, number(item.quantity, 1))) * 1000) / 1000;
    const unitPriceCents = Math.round(number(selected.retailPriceCents));
    const article = text(selected.article, 80) || text(item.article, 80);
    const brand = text(selected.brand, 80) || text(item.brand, 80) || null;
    const fallbackName = ["Запчасть", brand, article].filter(Boolean).join(" ");
    return { source: "rossko", offerId: text(selected.id, 100), role: text(item.role, 40) || "unknown", type: "product", name: text(selected.name, 180) || fallbackName || "Запчасть по каталогу", article, brand, quantity, unitPriceCents, totalCents: Math.round(unitPriceCents * quantity), availability: text(selected.stock, 80) || "уточняется", delivery: text(selected.delivery, 100) || "уточняется" };
  });
  const lines = [...localLines, ...rosskoLines];
  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const validUntil = rosskoLines.length ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
  return { lines, totalCents, totalRub: totalCents / 100, validUntil, localCount: localLines.length, supplierResults };
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
  const locationId = text(args.locationId, 120) || "dachnaya";
  let selectedProducts = quoteInputRows(args.selectedProducts, 30);
  const consumables = quoteInputRows(args.consumables, 20);
  let rosskoItems = quoteInputRows(args.rosskoItems, 12);
  const automaticFluid = await automaticLocalFluidSelection(args, context);
  if (automaticFluid) {
    const fallbackArticle = normalizedArticle(args.requiredFluidOemArticle);
    if (!fallbackArticle && rosskoItems.length) {
      throw new Error("Локальное совместимое масло найдено; укажите requiredFluidOemArticle, чтобы backend безопасно исключил его ROSSKO-аналог");
    }
    selectedProducts = [
      { productId: automaticFluid.productId, quantity: automaticFluid.quantity, role: "fluid" },
      ...selectedProducts.filter((item) => text(item.productId, 160) !== automaticFluid.productId),
    ];
    if (fallbackArticle) rosskoItems = rosskoItems.filter((item) => normalizedArticle(item.article) !== fallbackArticle);
  }
  const material = await quoteLines([...selectedProducts, ...consumables], rosskoItems, context);
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
    manualLaborPriceCents: args.manualLaborPriceCents == null ? null : Math.round(number(args.manualLaborPriceCents)),
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
  const finalQuote = laborLine !== null && !appliedRule.requiresHumanConfirmation;
  return {
    result: {
      lines,
      totalCents,
      totalRub: totalCents / 100,
      maximum,
      validUntil: material.validUntil,
      mode: "assistant_rule_v2",
      finalQuote,
      requiresHumanConfirmation: appliedRule.requiresHumanConfirmation,
      appliedRule,
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
  if (["automatic_transmission", "cvt", "dsg", "manual_transmission", "transfer_case", "differential"].includes(type)) return "transmission_fluid";
  // The pricing-rule resolver is deliberately allowed to return no rule for
  // these service families. That becomes an explicit hard blocker rather than
  // silently borrowing an unrelated engine or transmission tariff.
  return type;
}

function procedureForTechCard(code: "partial" | "machine" | "standard", serviceType: string) {
  if (code === "partial" || code === "machine") return code;
  return serviceType === "engine_oil" ? "oil_change" : "replace";
}

type FallbackServiceCard = { id: string; name: string; code: string | null; searchText: string | null };

/** Selects only an unambiguous service-card fallback; special AI tariffs keep priority in resolveLaborPrice. */
export function selectQuoteAndTechCardFallbackServiceCard(cards: FallbackServiceCard[], serviceType: string, procedure: "partial" | "machine" | "standard") {
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

async function quoteAndTechCardFallbackServiceProductId(serviceType: string, procedure: "partial" | "machine" | "standard") {
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

/** Fails closed before the option or snapshot can expose contradictory quantities or totals. */
export function assertQuoteAndTechCardOptionIntegrity(option: Pick<QuoteAndTechCardQuoteOption, "billableQuantityLiters" | "lines" | "totalCents">) {
  const lineTotal = option.lines.reduce((sum, line) => sum + line.totalCents, 0);
  if (option.totalCents == null || lineTotal !== option.totalCents) {
    throw new QuoteAndTechCardIntegrityError("Итог сметы не равен сумме строк. Расчёт не сохранён.");
  }
  for (const line of option.lines) {
    if (line.unitPriceCents != null && line.totalCents !== line.unitPriceCents * line.quantity) {
      throw new QuoteAndTechCardIntegrityError(`Строка «${line.customerDisplayName}» имеет противоречивую цену и количество. Расчёт не сохранён.`);
    }
  }
  if (option.billableQuantityLiters != null) {
    const primaryFluid = option.lines.filter((line) => line.role === "fluid");
    if (primaryFluid.length !== 1 || primaryFluid[0].quantity !== option.billableQuantityLiters) {
      throw new QuoteAndTechCardIntegrityError("Количество основной жидкости не совпадает с расчётным объёмом. Расчёт не сохранён.");
    }
  }
}

async function buildQuoteAndTechCard(args: Record<string, unknown>, context: ToolContext) {
  const settings = await getAgentSettings(context.organizationId);
  const plan = createQuoteAndTechCardPlan(args.input, {
    literRoundingStep: settings.calculationRules.literRoundingStep,
    transmissionMachineExchangeMultiplier: settings.calculationRules.transmissionMachineExchangeMultiplier,
    transmissionMinimumBillableLiters: settings.calculationRules.transmissionMinimumBillableLiters,
    maxTechnicalVerificationPasses: settings.calculationRules.maxTechnicalVerificationPasses,
  });
  const input = plan.input;
  const baseBlockers = [...plan.hardBlockers];
  const quoteSnapshots: Array<{ argumentsValue: Record<string, unknown>; preview: Record<string, unknown> }> = [];
  let selectedMaterial: { name: string; catalogName: string; customerDisplayName: string; specification: string | null; quantity: number; compatibilityEvidence: string | null } | null = null;
  const options: QuoteAndTechCardQuoteOption[] = [];

  for (const option of plan.options) {
    const blockers = [...baseBlockers];
    if (option.blockedReason) blockers.push({ code: "NO_MATERIAL_PRICE", message: option.blockedReason, requiredToContinue: "Подтвердить рабочий объём жидкости для выбранной процедуры." });
    if (blockers.length) {
      options.push({ code: option.code, label: option.label, customerDisplayName: customerProcedureDisplayName(input.service.type, option.code), status: "blocked", technicalQuantityLiters: option.technicalQuantityLiters, billableQuantityLiters: option.billableQuantityLiters, lines: [], totalCents: null, maximumTotalCents: null, validUntil: null, blockers, warnings: [] });
      continue;
    }
    // Local-first is code, not an instruction: check the compatible local ATF
    // before passing any supplier ATF into quoteLines. Internal filters never
    // enter a standard TGM calculation at all.
    const localFluid = plan.isTransmission && input.service.materialsOwner === "service"
      ? await automaticLocalFluidSelection({ serviceFamily: "transmission_fluid", materialsOwner: "service", requiredFluidSpec: input.service.requiredFluidSpec, requiredFluidVolumeLiters: option.billableQuantityLiters, fluidPreference: "prefer_local_compatible" }, context)
      : null;
    const materials = quoteAndTechCardMaterials(input, Boolean(localFluid));
    const supplierRows = quoteAndTechCardSupplierRows(input, Boolean(localFluid), option.billableQuantityLiters);
    const selectedProducts = applyBillableQuantityToPrimaryFluid([
      ...(localFluid ? [{ productId: localFluid.productId, quantity: localFluid.quantity, role: "fluid" }] : []),
      ...materials.selectedProducts,
    ], option.billableQuantityLiters, plan.isTransmission);
    const requiredFluidArticle = text(input.service.requiredFluidOemArticle, 80).toUpperCase();
    const scopedSupplierRows = supplierRows.map((row) => ({ ...row, role: requiredFluidArticle && row.article.toUpperCase() === requiredFluidArticle ? "fluid" : "consumable" }));
    const fallbackServiceProductId = await quoteAndTechCardFallbackServiceProductId(input.service.type, option.code);
    const quoteArgs: Record<string, unknown> = {
      serviceFamily: serviceFamilyForTechCard(input.service.type),
      procedureType: procedureForTechCard(option.code, input.service.type),
      transmissionConfiguration: input.service.transmissionConfiguration ?? "not_applicable",
      materialsOwner: input.service.materialsOwner,
      vehicleId: input.vehicle.id ?? null,
      vehicleDisplayName: input.vehicle.displayName ?? null,
      vehicleSnapshot: input.vehicle.snapshot ?? {},
      aggregateCode: input.vehicle.aggregateCode ?? input.service.aggregate ?? null,
      requiredFluidSpec: input.service.requiredFluidSpec ?? null,
      requiredFluidVolumeLiters: option.billableQuantityLiters,
      requiredFluidOemArticle: input.service.requiredFluidOemArticle ?? null,
      fluidPreference: "prefer_local_compatible",
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
        const role = ["fluid", "external_filter", "consumable", "internal_filter", "labor", "rounding"].includes(text(line.role, 40)) ? text(line.role, 40) as "fluid" | "external_filter" | "consumable" | "internal_filter" | "labor" | "rounding" : "unknown" as const;
        const catalogName = text(line.name, 220) || "Позиция";
        const customerDisplayName = role === "labor" || text(line.type, 80) === "labor" ? "Работа" : role === "rounding" || text(line.type, 80) === "rounding" ? "Округление" : customerMaterialDisplayName(catalogName);
        return {
          source: text(line.source, 80) || undefined,
          type: text(line.type, 80) || null,
          role,
          productId: text(line.productId, 160) || null,
          name: catalogName,
          catalogName,
          customerDisplayName,
          article: text(line.article, 120) || null,
          quantity: Math.max(0.001, number(line.quantity, 1)),
          unitPriceCents: Math.max(0, Math.round(number(line.unitPriceCents))),
          totalCents: Math.max(0, Math.round(number(line.totalCents))),
        };
      });
      const hasPricedMaterial = input.service.materialsOwner === "customer" || lines.some((line) => text(line.type, 80) !== "labor" && number(line.totalCents) > 0);
      if (!hasPricedMaterial) blockers.push({ code: "NO_MATERIAL_PRICE", message: "Не найдена цена совместимого материала в локальном каталоге или у поставщика.", requiredToContinue: "Подтвердить совместимый материал и его цену либо выбрать вариант с материалами клиента." });
      if (quote.finalQuote !== true) blockers.push({ code: "MISSING_LABOR_RULE", message: "Для услуги нет применимого правила стоимости работ.", requiredToContinue: "Настроить тарифное правило или указать подтверждённую стоимость работы." });
      const automatic = object(quote.automaticMaterialDecision);
      const primaryFluid = lines.find((line) => line.role === "fluid");
      if (!selectedMaterial && primaryFluid) selectedMaterial = { name: primaryFluid.customerDisplayName, catalogName: primaryFluid.catalogName, customerDisplayName: primaryFluid.customerDisplayName, specification: text(input.service.requiredFluidSpec, 160) || null, quantity: primaryFluid.quantity, compatibilityEvidence: text(automatic.compatibilityEvidence, 700) || null };
      const status = blockers.length ? "blocked" : plan.quoteWarnings.length ? "preliminary" : "ready";
      const maximum = object(quote.maximum);
      const quoteOption: QuoteAndTechCardQuoteOption = {
        code: option.code,
        label: option.label,
        customerDisplayName: customerProcedureDisplayName(input.service.type, option.code),
        status,
        technicalQuantityLiters: option.technicalQuantityLiters,
        billableQuantityLiters: option.billableQuantityLiters,
        lines,
        totalCents: status !== "blocked" ? Math.round(number(quote.totalCents)) : null,
        maximumTotalCents: status !== "blocked" && number(maximum.totalCents) > number(quote.totalCents) ? Math.round(number(maximum.totalCents)) : null,
        validUntil: text(quote.validUntil, 100) || null,
        blockers,
        warnings: uniqueWarnings(plan.quoteWarnings),
      };
      if (status !== "blocked") assertQuoteAndTechCardOptionIntegrity(quoteOption);
      options.push(quoteOption);
      if (status !== "blocked") quoteSnapshots.push({ argumentsValue: quoteArgs, preview: quote });
    } catch (error) {
      const message = text(error instanceof Error ? error.message : String(error), 360) || "Не удалось получить цену материала или работы.";
      const integrityFailure = error instanceof QuoteAndTechCardIntegrityError;
      const supplierFailure = /rossko|поставщик|предложен/i.test(message);
      options.push({
        code: option.code,
        label: option.label,
        customerDisplayName: customerProcedureDisplayName(input.service.type, option.code),
        status: "blocked",
        technicalQuantityLiters: option.technicalQuantityLiters,
        billableQuantityLiters: option.billableQuantityLiters,
        lines: [],
        totalCents: null,
        maximumTotalCents: null,
        validUntil: null,
        blockers: [{ code: integrityFailure ? "QUOTE_INTEGRITY_ERROR" : supplierFailure ? "NO_MATERIAL_PRICE" : "MISSING_LABOR_RULE", message, requiredToContinue: integrityFailure ? "Проверить количество, цену и итог в backend-калькуляторе." : supplierFailure ? "Найти совместимый материал с ценой в локальном каталоге или у поставщика." : "Подтвердить правило стоимости работ." }],
        warnings: uniqueWarnings(plan.quoteWarnings),
      });
    }
  }
  const allOptionBlockers = options.flatMap((option) => Array.isArray(option.blockers) ? option.blockers : []) as Array<{ code: string; message: string; requiredToContinue: string }>;
  const hardBlockers = [...baseBlockers];
  for (const code of ["NO_MATERIAL_PRICE", "MISSING_LABOR_RULE", "QUOTE_INTEGRITY_ERROR"]) {
    const matching = allOptionBlockers.filter((blocker) => blocker.code === code);
    if (matching.length === options.length && matching[0]) hardBlockers.push(matching[0]);
  }
  const calculatedQuoteStatus = quoteStatus(options, hardBlockers);
  // Enrichment is intentionally isolated from quote calculation: missing
  // torque/evidence/visual material degrades only the tech card.
  const techCardStatus: "ready" | "partial" | "blocked" = calculatedQuoteStatus === "blocked" ? "blocked" : plan.techCardWarnings.length || !selectedMaterial ? "partial" : "ready";
  const draft = {
    scenario: "quote_and_tech_card" as const,
    status: "partial" as const,
    vehicle: { displayName: text(input.vehicle.displayName, 180) || "Автомобиль уточняется", aggregate: text(input.vehicle.aggregateCode ?? input.service.aggregate, 160) || null },
    quote: { status: calculatedQuoteStatus, confidence: calculatedQuoteStatus === "ready" ? "confirmed" as const : "preliminary" as const, options, hardBlockers, warnings: uniqueWarnings(plan.quoteWarnings) },
    techCard: {
      status: techCardStatus,
      serviceName: input.service.name,
      serviceType: input.service.type,
      requiredFluidSpec: text(input.service.requiredFluidSpec, 160) || null,
      filterPolicy: plan.filterPolicy.customerText,
      filter: plan.filterPolicy,
      levelTemperature: text(input.service.levelTemperature, 180) || null,
      levelProcedure: text(input.service.levelProcedure, 500) || null,
      servicePoints: input.service.servicePoints.map((item) => text(item, 300)).filter(Boolean).slice(0, 16),
      torqueNotes: input.service.torqueNotes.map((item) => text(item, 300)).filter(Boolean).slice(0, 12),
      criticalChecks: input.service.criticalChecks.map((item) => text(item, 300)).filter((item) => Boolean(item) && !(input.service.filterAccess === "internal_requires_disassembly" && /(фильтр|filter|epc|oe[\s-]?номер|заказ)/iu.test(item))).slice(0, 3),
      selectedMaterial,
      warnings: uniqueWarnings(plan.techCardWarnings).slice(0, 3),
    },
    customerMessage: { status: "blocked" as const, text: "" },
    evidence: input.evidence,
  };
  const customerMessage = buildQuoteAndTechCardCustomerMessage(draft);
  const resultBase = { ...draft, customerMessage, status: scenarioStatus(calculatedQuoteStatus, techCardStatus, customerMessage.status) };
  const result = parseQuoteAndTechCardResult(resultBase);
  if (!result) throw new Error("Не удалось сформировать проверенный контракт техкарты и сметы");
  return {
    result: { ...result, quoteSnapshots, finalQuote: false },
    sources: [
      { sourceType: "internal_catalog" as const, title: "Техкарта и смета: детерминированный сценарий", excerpt: `Проверочных проходов: не более ${plan.rules.maxTechnicalVerificationPasses}; вариантов процедуры: ${options.length}.` },
      ...input.evidence.map((item) => ({ sourceType: "internal_catalog" as const, title: item.source, url: item.url ?? null, excerpt: item.fact })),
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

export async function executeAssistantTool(name: string, argumentsValue: unknown, context: ToolContext): Promise<AssistantToolResult> {
  const args = object(argumentsValue);
  if (name === "get_workspace_context") return { result: { organizationId: context.organizationId, currentUser: { id: context.actorId, name: context.actorName, role: context.actorRole }, permissions: { readData: true, writeData: false, createQuoteDraft: false, createShipmentDraft: false, createAppointment: false, placeRosskoOrder: false } } };
  if (name === "search_clients") return searchClients(args);
  if (name === "get_client_history") return lookupClientHistory(args);
  if (name === "get_vehicle_service_history") return vehicleServiceHistory(args);
  if (name === "lookup_vehicle") {
    const result = await lookupVehicle({ organizationId: context.organizationId, input: text(args.input, 48), inputType: text(args.inputType, 12) as "vin" | "plate" | "frame", actorLogin: context.actorId });
    return { result: { ...result, note: "Провайдерский результат не изменял карточку автомобиля." }, sources: [{ sourceType: "tronk", title: "TRONK · определение автомобиля", excerpt: result.message ?? result.status, metadata: { fromCache: result.fromCache, sourceMethods: result.sourceMethods } }] };
  }
  if (name === "find_mann_filters") return findMannFilters(args);
  if (name === "search_local_catalog") return searchCatalog(args);
  if (name === "get_stock") return stock(args);
  if (name === "search_rossko") return rossko(args, context);
  if (name === "find_service_options") return findServiceOptions(args);
  if (name === "calculate_quote_preview") return quotePreview(args, context);
  if (name === "calculate_service_quote_v2") return serviceQuoteV2(args, context);
  if (name === "build_quote_and_tech_card") return buildQuoteAndTechCard(args, context);
  if (name === "audit_legacy_client_agent") return auditLegacyClientAgent(args, context.organizationId);
  throw new Error(`Недоступный инструмент: ${name}`);
}

export function safeAssistantJson(value: unknown) {
  return safeJson(jsonSafe(value));
}
