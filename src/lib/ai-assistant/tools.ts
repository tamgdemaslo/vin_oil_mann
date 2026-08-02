import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_ROSSKO_MARKUP_RULES } from "@/lib/ai-agent/settings";
import { lookupVehicle, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-identity";
import { rosskoCheckoutDetails, rosskoConfig, rosskoSearch, suggestRosskoDefaults } from "@/lib/rossko";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { resolveLaborPrice } from "./labor-pricing";
import { fluidSpecificationExcerpt, fluidSpecificationTokens, selectPreferredLocalFluid, shouldRequireOriginalFluid, type LocalFluidSelection } from "./material-selection";

export type AssistantToolSource = {
  sourceType: "internal_catalog" | "mann" | "tronk" | "rossko";
  title: string;
  url?: string | null;
  excerpt?: string | null;
  metadata?: Record<string, unknown>;
};

export type AssistantToolResult = { result: Record<string, unknown>; sources?: AssistantToolSource[] };

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

function rosskoRetailPriceCents(purchaseCents: number | null) {
  if (purchaseCents == null) return null;
  const rule = DEFAULT_ROSSKO_MARKUP_RULES.find((item) => purchaseCents >= item.fromCents && (item.toCents == null || purchaseCents < item.toCents)) ?? DEFAULT_ROSSKO_MARKUP_RULES.at(-1);
  return rule ? Math.round(purchaseCents * (1 + rule.marginPercent / 100)) : null;
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
  const client = await prisma.localCounterparty.findFirst({ where: { OR: [{ id: clientId }, { moyskladId: clientId }] }, select: { id: true, name: true, phone: true, email: true } });
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
  const clients = await prisma.localCounterparty.findMany({
    where: { archived: false, OR: [{ name: { contains: query, mode: "insensitive" } }, { phone: { contains: query, mode: "insensitive" } }, ...(digits ? [{ normalizedPhone: { contains: digits, mode: "insensitive" as const } }] : []), { searchText: { contains: query.toLowerCase(), mode: "insensitive" } }] },
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

async function rossko(args: Record<string, unknown>) {
  const article = text(args.article, 80);
  const brand = text(args.brand, 80);
  const config = await rosskoConfig();
  let deliveryId = config.deliveryId || "";
  let addressId = config.addressId || "";
  if (!deliveryId || !addressId) {
    const defaults = suggestRosskoDefaults(await rosskoCheckoutDetails(config));
    deliveryId ||= defaults.delivery_id || "";
    addressId ||= defaults.address_id || "";
  }
  if (!deliveryId) throw new Error("Для ROSSKO не настроен способ доставки");
  const raw = await rosskoSearch(config, { text: [brand, article].filter(Boolean).join(" "), deliveryId, addressId });
  const offers = offerRows(raw).map((row, index) => {
    const purchasePriceCents = rubles(row.price ?? row.Price ?? row.cost ?? row.Cost);
    return {
      id: text(row.id ?? row.ID, 80) || `offer-${index + 1}`,
      brand: text(row.brand ?? row.Brand, 80) || brand || null,
      article: text(row.partnumber ?? row.partNumber ?? row.article, 80) || article,
      name: text(row.name ?? row.Name, 180) || null,
      purchasePriceCents,
      retailPriceCents: rosskoRetailPriceCents(purchasePriceCents),
      retailPriceRub: rosskoRetailPriceCents(purchasePriceCents) == null ? null : rosskoRetailPriceCents(purchasePriceCents)! / 100,
      stock: text(row.stock ?? row.Stock ?? row.count ?? row.quantity, 80) || "уточняется",
      delivery: text(row.delivery ?? row.delivery_time ?? row.period, 100) || "уточняется",
    };
  }).filter((offer, index, list) => list.findIndex((other) => `${other.brand}:${other.article}:${other.purchasePriceCents}:${other.delivery}` === `${offer.brand}:${offer.article}:${offer.purchasePriceCents}:${offer.delivery}`) === index).slice(0, 12);
  return { result: { found: offers.length > 0, article, brand: brand || null, offers, validForHours: 24, mode: "read_only_search" }, sources: [{ sourceType: "rossko", title: "ROSSKO · read-only поиск", excerpt: `Артикул: ${article}` }] } satisfies AssistantToolResult;
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

async function quoteLines(itemValues: Array<Record<string, unknown>>, rosskoItems: Array<Record<string, unknown>>) {
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
    return { source: "local", productId, type: product.entityType, name: product.name, article: product.article, quantity, unitPriceCents: product.salePriceCents, totalCents };
  });
  const supplierResults = await Promise.all(rosskoItems.map(async (item) => ({ item, search: await rossko({ article: text(item.article, 80), brand: text(item.brand, 80) }) })));
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
    return { source: "rossko", offerId: text(selected.id, 100), type: "product", name: text(selected.name, 180) || fallbackName || "Запчасть по каталогу", article, brand, quantity, unitPriceCents, totalCents: Math.round(unitPriceCents * quantity), availability: text(selected.stock, 80) || "уточняется", delivery: text(selected.delivery, 100) || "уточняется" };
  });
  const lines = [...localLines, ...rosskoLines];
  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const validUntil = rosskoLines.length ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
  return { lines, totalCents, totalRub: totalCents / 100, validUntil, localCount: localLines.length, supplierResults };
}

async function quotePreview(args: Record<string, unknown>) {
  const itemValues = quoteInputRows(args.items, 30);
  const rosskoItems = quoteInputRows(args.rosskoItems, 12);
  if (!itemValues.length && !rosskoItems.length) throw new Error("Для предварительного расчёта нужна хотя бы одна позиция");
  const base = await quoteLines(itemValues, rosskoItems);
  const maximumItems = quoteInputRows(args.maximumItems, 30);
  const maximumRosskoItems = quoteInputRows(args.maximumRosskoItems, 12);
  const hasMaximum = maximumItems.length > 0 || maximumRosskoItems.length > 0;
  const maximum = hasMaximum ? await quoteLines(maximumItems, maximumRosskoItems) : null;
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
      { productId: automaticFluid.productId, quantity: automaticFluid.quantity },
      ...selectedProducts.filter((item) => text(item.productId, 160) !== automaticFluid.productId),
    ];
    if (fallbackArticle) rosskoItems = rosskoItems.filter((item) => normalizedArticle(item.article) !== fallbackArticle);
  }
  const material = await quoteLines([...selectedProducts, ...consumables], rosskoItems);
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
    type: "labor",
    name: `Работа: ${appliedRule.name}`,
    quantity: 1,
    unitPriceCents: appliedRule.laborPriceCents,
    totalCents: appliedRule.laborPriceCents,
  };
  const lines = laborLine ? [...material.lines, laborLine] : material.lines;
  const totalCents = material.totalCents + (laborLine?.totalCents ?? 0);
  const hasRange = appliedRule.priceFromCents != null && appliedRule.priceToCents != null && appliedRule.priceToCents > appliedRule.priceFromCents;
  const maximumLaborLine = hasRange ? { ...laborLine!, unitPriceCents: appliedRule.priceToCents!, totalCents: appliedRule.priceToCents! } : null;
  const maximum = maximumLaborLine ? {
    lines: [...material.lines, maximumLaborLine],
    totalCents: material.totalCents + maximumLaborLine.totalCents,
    totalRub: (material.totalCents + maximumLaborLine.totalCents) / 100,
    validUntil: material.validUntil,
  } : null;
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
  if (name === "search_rossko") return rossko(args);
  if (name === "find_service_options") return findServiceOptions(args);
  if (name === "calculate_quote_preview") return quotePreview(args);
  if (name === "calculate_service_quote_v2") return serviceQuoteV2(args, context);
  if (name === "audit_legacy_client_agent") return auditLegacyClientAgent(args, context.organizationId);
  throw new Error(`Недоступный инструмент: ${name}`);
}

export function safeAssistantJson(value: unknown) {
  return safeJson(value);
}
