import type { Prisma } from "@prisma/client";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getConversationContext } from "@/lib/messenger/messenger-context";
import { searchCatalog } from "@/lib/catalog-search";
import { partsCatalogsRequest } from "@/lib/parts-catalogs";
import { getVinLookupCache } from "@/lib/vin-lookup-cache";
import { parsePackVolumeLitersFromOilName } from "@/lib/oil-pack-volume";
import { rosskoCheckoutDetails, rosskoConfig, rosskoSearch, suggestRosskoDefaults } from "@/lib/rossko";
import { createYclientsAppointment, getYclientsAvailableSlots, parseYclientsSlotId } from "./yclients";
import { safeToolOutputGuardrail, sanitizeForModel, tenantToolInputGuardrail } from "./security";
import type { AIAgentRunContext } from "./types";

type AgentContext = RunContext<AIAgentRunContext>;
type JsonRecord = Record<string, unknown>;

const commonToolGuardrails = {
  inputGuardrails: [tenantToolInputGuardrail],
  outputGuardrails: [safeToolOutputGuardrail],
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function clean(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function requireContext(context?: AgentContext) {
  if (!context?.context) throw new Error("Контекст запуска ИИ-агента отсутствует");
  return context.context;
}

async function withToolAudit<T>(
  context: AgentContext | undefined,
  toolName: string,
  args: unknown,
  fn: () => Promise<T>,
  requiresApproval = false
): Promise<T> {
  const ctx = requireContext(context);
  const startedAt = Date.now();
  const row = await prisma.aIAgentToolCall.create({
    data: {
      organizationId: ctx.organizationId,
      runId: ctx.runId,
      conversationId: ctx.conversationId,
      toolName,
      argumentsMasked: json(sanitizeForModel(args)),
      requiresApproval,
    },
  });
  try {
    const result = await fn();
    await prisma.aIAgentToolCall.update({
      where: { id: row.id },
      data: {
        status: "completed",
        resultSummary: json(sanitizeForModel(result)),
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    await prisma.aIAgentToolCall.update({
      where: { id: row.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

function normalizeVin(value: string) {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

function validVin(vin: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

function carInfoItems(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => !!item && typeof item === "object" && !Array.isArray(item));
  const root = record(value);
  for (const key of ["items", "rows", "data", "cars", "results"]) {
    if (Array.isArray(root[key])) return carInfoItems(root[key]);
  }
  return Object.keys(root).length ? [root] : [];
}

function vehicleCandidate(row: JsonRecord, vin: string) {
  const params = new Map<string, string>();
  const parameters = Array.isArray(row.parameters) ? row.parameters : [];
  for (const item of parameters) {
    const value = record(item);
    const name = clean(value.name).toLowerCase();
    const key = clean(value.key).toLowerCase();
    const content = clean(value.value);
    if (name && content) params.set(name, content);
    if (key && content) params.set(key, content);
  }
  const title = clean(row.title);
  const make = clean(row.brand) || clean(row.make) || clean(row.manufacturer) || title.split(/\s+/)[0] || "";
  const model = clean(row.modelName) || clean(row.model) || title.split(/\s+/).slice(1).join(" ");
  const engineCode = params.get("engine code") || params.get("engine_code") || params.get("engine") || params.get("spec_engine") || "";
  return {
    vin,
    make,
    model,
    generation: params.get("spec_series") || params.get("series") || "",
    year: clean(row.modelYear) || clean(row.year) || params.get("year") || "",
    engine: engineCode,
    engineCode,
    displacement: params.get("engine_cc") || params.get("engine size") || "",
    power: params.get("power") || params.get("horsepower") || "",
    fuel: params.get("fuel_type") || params.get("fuel type") || "",
    transmission: params.get("trans_type") || params.get("transmission") || "",
    drive: params.get("drive") || "",
    region: params.get("sales_region") || params.get("region") || "",
    modification: params.get("car_name") || title,
    source: "parts-catalogs.com/car-info",
    retrievedAt: new Date().toISOString(),
  };
}

export const getClientProfileTool = tool({
  name: "get_client_profile",
  description: "Получить безопасный профиль клиента, связанного с текущим диалогом, его автомобили, ближайшую запись и открытое дело.",
  parameters: z.object({}),
  ...commonToolGuardrails,
  execute: async (_input, context) =>
    withToolAudit(context, "get_client_profile", {}, async () => {
      const ctx = requireContext(context);
      const conversation = await getConversationContext(ctx.conversationId);
      if (conversation.organizationId !== ctx.organizationId) throw new Error("Диалог другой организации");
      return {
        state: conversation.state,
        client: conversation.client
          ? {
              id: conversation.client.id,
              name: conversation.client.name,
              phone: conversation.client.phone,
              type: conversation.client.type,
            }
          : null,
        vehicles: conversation.vehicles,
        selectedVehicle: conversation.selectedVehicle,
        upcomingAppointment: conversation.client?.appointment ?? null,
        openCase: conversation.client?.activeCase ?? null,
      };
    }),
});

export const resolveVehicleByVinTool = tool({
  name: "resolve_vehicle_by_vin",
  description: "Определить автомобиль по VIN через серверный VIN-каталог. Не выбирает молча первую модификацию при нескольких вариантах.",
  parameters: z.object({ vin: z.string().min(17).max(24) }),
  ...commonToolGuardrails,
  execute: async ({ vin: rawVin }, context) =>
    withToolAudit(context, "resolve_vehicle_by_vin", { vin: rawVin }, async () => {
      const ctx = requireContext(context);
      const vin = normalizeVin(rawVin);
      if (!validVin(vin)) return { valid: false, vin, reason: "VIN должен состоять из 17 допустимых символов" };
      const { status, data } = await partsCatalogsRequest("/car/info", { q: vin });
      if (status !== 200) return { valid: true, resolved: false, vin, reason: "VIN-каталог временно недоступен", needsHumanReview: true };
      const candidates = carInfoItems(data).map((item) => vehicleCandidate(item, vin));
      if (!candidates.length) return { valid: true, resolved: false, vin, reason: "Модификация не найдена", needsHumanReview: true };
      const unique = candidates.filter((item, index, list) => list.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index);
      const exact = unique.length === 1;
      await prisma.aIAgentSession.updateMany({
        where: { id: ctx.sessionId, organizationId: ctx.organizationId },
        data: {
          confidence: exact ? 0.9 : 0.55,
          collectedDataJson: json({ vin, vehicleCandidates: unique }),
          lastActivityAt: new Date(),
        },
      });
      return {
        valid: true,
        resolved: exact,
        ambiguous: !exact,
        confidence: exact ? 0.9 : 0.55,
        vehicle: exact ? unique[0] : null,
        candidates: unique.slice(0, 8),
        sources: [{ source: "Parts Catalogs", retrievedAt: new Date().toISOString(), appliesToVin: vin }],
        needsClarification: exact ? [] : ["код двигателя", "мощность", "объём двигателя или VIN-проверка мастером"],
      };
    }),
});

export const resolveVehicleByParametersTool = tool({
  name: "resolve_vehicle_by_parameters",
  description: "Найти возможные модификации автомобиля по марке, модели, году и двигателю без молчаливого выбора первого результата.",
  parameters: z.object({
    make: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    year: z.number().int().min(1950).max(2100).nullable(),
    engine: z.string().max(80).nullable(),
    power: z.string().max(40).nullable(),
    transmission: z.string().max(80).nullable(),
    drive: z.string().max(40).nullable(),
  }),
  ...commonToolGuardrails,
  execute: async ({ make, model, year, engine, power, transmission, drive }, context) =>
    withToolAudit(context, "resolve_vehicle_by_parameters", { make, model, year, engine, power, transmission, drive }, async () => {
      const rows = await prisma.mannFilterApplication.findMany({
        where: {
          make: { contains: make.trim(), mode: "insensitive" },
          AND: [
            { OR: [{ model: { contains: model.trim(), mode: "insensitive" } }, { vehicleText: { contains: model.trim(), mode: "insensitive" } }] },
            ...(year ? [{ OR: [{ vehicleYearFrom: null }, { vehicleYearFrom: { lte: year } }] }, { OR: [{ vehicleYearTo: null }, { vehicleYearTo: { gte: year } }] }] : []),
            ...(engine ? [{ OR: [{ engineCode: { contains: engine, mode: "insensitive" as const } }, { detail: { contains: engine, mode: "insensitive" as const } }, { vehicleText: { contains: engine, mode: "insensitive" as const } }] }] : []),
          ],
        },
        select: { make: true, model: true, detail: true, engineCode: true, vehicleYearFrom: true, vehicleYearTo: true, vehicleText: true, sourceFile: true, catalogPage: true },
        distinct: ["make", "model", "detail", "engineCode", "vehicleYearFrom", "vehicleYearTo"],
        take: 25,
      });
      const candidates = rows.map((row) => ({
        make: row.make,
        model: row.model,
        modification: row.detail || row.vehicleText,
        engineCode: row.engineCode,
        yearFrom: row.vehicleYearFrom,
        yearTo: row.vehicleYearTo,
        source: { name: "Локальная база применяемости MANN", file: row.sourceFile, catalogPage: row.catalogPage, retrievedAt: new Date().toISOString() },
      }));
      const exact = candidates.length === 1 && Boolean(engine);
      return {
        found: candidates.length > 0,
        exact,
        ambiguous: candidates.length > 1,
        confidence: exact ? 0.82 : candidates.length ? 0.55 : 0,
        candidates,
        suppliedContext: { power: power || null, transmission: transmission || null, drive: drive || null },
        needsClarification: exact ? [] : ["VIN", "код двигателя", "объём или мощность двигателя"],
        needsHumanReview: !exact,
      };
    }),
});

export const getEngineOilRequirementsTool = tool({
  name: "get_engine_oil_requirements",
  description: "Получить сохранённые требования моторного масла. Возвращает источник и требует проверки, если доказательность недостаточна.",
  parameters: z.object({ vin: z.string().min(17).max(24), engineCode: z.string().max(40).nullable() }),
  ...commonToolGuardrails,
  execute: async ({ vin: rawVin, engineCode }, context) =>
    withToolAudit(context, "get_engine_oil_requirements", { vin: rawVin, engineCode }, async () => {
      const vin = normalizeVin(rawVin);
      if (!validVin(vin)) throw new Error("Некорректный VIN");
      const cached = await getVinLookupCache(vin);
      const oil = cached?.oilInfo;
      if (!oil) {
        return {
          found: false,
          confidence: 0,
          needsHumanReview: true,
          reason: "В проверенном кеше Эко-платформы нет требований для этого VIN",
        };
      }
      const facts = {
        requiredApproval: oil.approval || null,
        allowedViscosities: oil.sae ?? [],
        volumeWithFilter: oil.fillVolumeLiters || null,
        acea: oil.acea ?? [],
        api: oil.api ?? [],
        ilsac: oil.ilsac ?? [],
        engineCode: engineCode || cached.decoded?.engineSeries || null,
      };
      const hasApproval = Boolean(oil.approval || oil.acea?.length || oil.api?.length);
      const hasVolume = Boolean(oil.fillVolumeLiters);
      return {
        found: true,
        ...facts,
        confidence: hasApproval && hasVolume ? 0.65 : 0.45,
        needsHumanReview: true,
        note: "Исторический результат подбора требует проверки источника перед автономной отправкой клиенту.",
        sources: [{ source: "Эко-платформа: сохранённый VIN-подбор", retrievedAt: new Date().toISOString(), appliesToVin: vin }],
      };
    }),
});

export const findRequiredPartsTool = tool({
  name: "find_required_parts",
  description: "Найти фильтры MANN в локальной базе применяемости по точной модификации автомобиля.",
  parameters: z.object({
    make: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    year: z.number().int().min(1950).max(2100).nullable(),
    engineCode: z.string().max(40).nullable(),
  }),
  ...commonToolGuardrails,
  execute: async ({ make, model, year, engineCode }, context) =>
    withToolAudit(context, "find_required_parts", { make, model, year, engineCode }, async () => {
      const rows = await prisma.mannFilterApplication.findMany({
        where: {
          make: { contains: make.trim(), mode: "insensitive" },
          AND: [
            {
              OR: [
                { model: { contains: model.trim(), mode: "insensitive" } },
                { vehicleText: { contains: model.trim(), mode: "insensitive" } },
              ],
            },
            ...(year
              ? [
                  { OR: [{ vehicleYearFrom: null }, { vehicleYearFrom: { lte: year } }] },
                  { OR: [{ vehicleYearTo: null }, { vehicleYearTo: { gte: year } }] },
                ]
              : []),
            ...(engineCode
              ? [
                  {
                    OR: [
                      { engineCode: { contains: engineCode, mode: "insensitive" as const } },
                      { detail: { contains: engineCode, mode: "insensitive" as const } },
                    ],
                  },
                ]
              : []),
          ],
        },
        select: {
          filterType: true,
          filterSubtype: true,
          mannArticle: true,
          filterNote: true,
          model: true,
          detail: true,
          engineCode: true,
          vehicleYearFrom: true,
          vehicleYearTo: true,
          sourceFile: true,
          catalogPage: true,
        },
        take: 40,
      });
      const variants = [...new Set(rows.map((row) => [row.model, row.detail, row.engineCode].filter(Boolean).join(" · ")))];
      return {
        found: rows.length > 0,
        ambiguous: variants.length > 1 && !engineCode,
        confidence: rows.length === 0 ? 0 : variants.length === 1 || engineCode ? 0.9 : 0.58,
        needsHumanReview: rows.length === 0 || (variants.length > 1 && !engineCode),
        parts: rows.map((row) => ({
          type: row.filterType,
          subtype: row.filterSubtype,
          mannArticle: row.mannArticle,
          note: row.filterNote,
          appliesTo: { model: row.model, detail: row.detail, engineCode: row.engineCode, yearFrom: row.vehicleYearFrom, yearTo: row.vehicleYearTo },
          source: { file: row.sourceFile, catalogPage: row.catalogPage },
        })),
      };
    }),
});

export const searchLocalCatalogTool = tool({
  name: "search_local_catalog",
  description: "Найти товары или услуги в локальном каталоге с розничной ценой и доступным остатком. Закупочные данные не возвращаются.",
  parameters: z.object({
    query: z.string().min(2).max(160),
    type: z.enum(["product", "service", "all"]),
    inStockOnly: z.boolean(),
    limit: z.number().int().min(1).max(20),
  }),
  ...commonToolGuardrails,
  execute: async ({ query, type, inStockOnly, limit }, context) =>
    withToolAudit(context, "search_local_catalog", { query, type, inStockOnly, limit }, async () => {
      const ctx = requireContext(context);
      const stores = await prisma.localStore.findMany({
        where: {
          archived: false,
          OR: [{ organizationId: ctx.organizationId }, { organizationId: null }],
          ...(ctx.settings.allowedStoreIds.length ? { id: { in: ctx.settings.allowedStoreIds } } : {}),
        },
        select: { id: true, name: true },
      });
      const allowedStores = new Set(stores.map((store) => store.id));
      const result = await searchCatalog({ q: query, type, inStock: inStockOnly, limit: Math.min(50, limit * 3) });
      const products = result.items
        .map((item) => {
          const stock = item.stock.filter((row) => allowedStores.has(row.storeId));
          const available = stock.reduce((sum, row) => sum + row.available, 0);
          return {
            id: item.id,
            name: item.name,
            article: item.article,
            code: item.code,
            brand: item.brand,
            category: item.groupPath,
            matchedCode: item.matchedFields[0]?.value || item.article || item.code,
            matchType: item.matchedFields[0]?.match || "contains",
            retailPriceCents: Math.round(item.salePrice * 100),
            available,
            reserve: stock.reduce((sum, row) => sum + row.reserve, 0),
            stock: stock.map((row) => ({ warehouseId: row.storeId, warehouse: row.storeName, available: row.available, cell: row.slotName })),
            confidence: Math.min(1, Math.max(0, item.relevance / 100)),
          };
        })
        .filter((item) => !inStockOnly || item.available > 0)
        .slice(0, limit);
      return { query, products, total: products.length, source: "local_catalog", checkedAt: new Date().toISOString() };
    }),
});

function collectRosskoOffers(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 7) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRosskoOffers(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const row = record(value);
  const keyText = Object.keys(row).join(" ");
  const looksLikeOffer = /(part|article|number|brand|price|stock|delivery)/i.test(keyText) && /(price|cost|stock|count|quantity)/i.test(keyText);
  return [...(looksLikeOffer ? [row] : []), ...Object.values(row).flatMap((item) => collectRosskoOffers(item, depth + 1))];
}

function offerPriceCents(row: JsonRecord) {
  const raw = row.price ?? row.Price ?? row.cost ?? row.Cost;
  const value = Number(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export const rosskoSearchTool = tool({
  name: "rossko_search",
  description: "Выполнить только read-only поиск отсутствующей детали в ROSSKO. Это ещё не заказ.",
  parameters: z.object({ article: z.string().min(2).max(80), brand: z.string().max(80).nullable(), partType: z.string().max(80).nullable() }),
  ...commonToolGuardrails,
  execute: async ({ article, brand, partType }, context) =>
    withToolAudit(context, "rossko_search", { article, brand, partType }, async () => {
      const ctx = requireContext(context);
      if (!ctx.settings.rosskoSearchEnabled) return { enabled: false, offers: [], reason: "Поиск ROSSKO отключён в настройках" };
      const cfg = rosskoConfig();
      let deliveryId = cfg.deliveryId || "";
      let addressId = cfg.addressId || "";
      if (!deliveryId || !addressId) {
        const defaults = suggestRosskoDefaults(await rosskoCheckoutDetails(cfg));
        deliveryId ||= defaults.delivery_id || "";
        addressId ||= defaults.address_id || "";
      }
      if (!deliveryId) throw new Error("Для ROSSKO не настроен способ доставки");
      const raw = await rosskoSearch(cfg, { text: [brand, article].filter(Boolean).join(" "), deliveryId, addressId });
      const offers = collectRosskoOffers(raw)
        .map((row, index) => ({
          offerId: clean(row.id) || clean(row.ID) || `rossko-${index + 1}`,
          brand: clean(row.brand) || clean(row.Brand) || brand || "",
          article: clean(row.partnumber) || clean(row.partNumber) || clean(row.article) || article,
          name: clean(row.name) || clean(row.Name) || partType || "Деталь",
          preliminaryPriceCents: offerPriceCents(row),
          availability: clean(row.stock) || clean(row.Stock) || clean(row.count) || clean(row.quantity) || "уточняется",
          delivery: clean(row.delivery) || clean(row.delivery_time) || clean(row.period) || "уточняется",
        }))
        .filter((offer, index, list) => list.findIndex((other) => `${other.brand}:${other.article}:${other.preliminaryPriceCents}` === `${offer.brand}:${offer.article}:${offer.preliminaryPriceCents}`) === index)
        .slice(0, 10);
      return { found: offers.length > 0, ordered: false, offers, priceNote: "Стоимость предварительная и фиксируется после подтверждения заказа." };
    }),
});

const quoteOptionSchema = z.object({
  scenario: z.enum(["service_oil_service_filter", "client_oil_service_filter", "client_oil_client_filter", "service_oil_client_filter"]),
  oilProductId: z.string().nullable(),
  filterProductId: z.string().nullable(),
  consumableProductIds: z.array(z.string()).max(8),
  protectionRemoval: z.boolean(),
  protectionInstall: z.boolean(),
  complexFilter: z.boolean(),
  cartridgeFilter: z.boolean(),
  discountCents: z.number().int().min(0),
});

const quoteRequirementSourceSchema = z.object({
  source: z.string().min(1).max(240),
  retrievedAt: z.string().min(1).max(64),
  appliesToVin: z.string().max(24).nullable(),
});

const quoteRequirementsSchema = z.object({
  found: z.boolean(),
  requiredApproval: z.string().max(160).nullable(),
  allowedViscosities: z.array(z.string().max(40)).max(12),
  volumeWithFilter: z.number().positive().max(30).nullable(),
  acea: z.array(z.string().max(40)).max(12),
  api: z.array(z.string().max(40)).max(12),
  ilsac: z.array(z.string().max(40)).max(12),
  engineCode: z.string().max(80).nullable(),
  confidence: z.number().min(0).max(1),
  needsHumanReview: z.boolean(),
  note: z.string().max(600).nullable(),
  sources: z.array(quoteRequirementSourceSchema).max(10),
});

export const calculateServiceQuoteTool = tool({
  name: "calculate_service_quote",
  description: "Детерминированно рассчитать 1–3 варианта замены масла по настроенным правилам и актуальным розничным ценам каталога.",
  parameters: z.object({
    requiredVolumeLiters: z.number().positive().max(30),
    serviceType: z.enum(["engine_oil_change"]),
    options: z.array(quoteOptionSchema).min(1).max(3),
    requirements: quoteRequirementsSchema,
  }),
  ...commonToolGuardrails,
  execute: async ({ requiredVolumeLiters, serviceType, options, requirements }, context) =>
    withToolAudit(context, "calculate_service_quote", { requiredVolumeLiters, serviceType, options, requirements }, async () => {
      const ctx = requireContext(context);
      const rules = ctx.settings.calculationRules;
      const contextData = await getConversationContext(ctx.conversationId);
      if (contextData.organizationId !== ctx.organizationId) throw new Error("Диалог другой организации");
      const productIds = [...new Set(options.flatMap((option) => [option.oilProductId, option.filterProductId, ...option.consumableProductIds]).filter((id): id is string => Boolean(id)))];
      const products = await prisma.localProduct.findMany({
        where: { id: { in: productIds }, archived: false },
        select: { id: true, name: true, article: true, salePriceCents: true, packageVolume: true },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      const roundedLiters = Math.ceil(requiredVolumeLiters / rules.literRoundingStep) * rules.literRoundingStep;
      const quoteOptions = options.map((option) => {
        const lines: Array<{ type: string; name: string; quantity: number; unitPriceCents: number; totalCents: number }> = [];
        const usesServiceOil = option.scenario.startsWith("service_oil");
        const usesServiceFilter = option.scenario.endsWith("service_filter");
        if (usesServiceOil) {
          const oil = option.oilProductId ? byId.get(option.oilProductId) : null;
          if (!oil) throw new Error("Для варианта с маслом сервиса выберите товар масла из каталога");
          const packLiters = parsePackVolumeLitersFromOilName(oil.packageVolume || oil.name) || 1;
          const count = Math.ceil(roundedLiters / packLiters);
          lines.push({ type: "oil", name: oil.name, quantity: count, unitPriceCents: oil.salePriceCents, totalCents: count * oil.salePriceCents });
        }
        if (usesServiceFilter) {
          const filter = option.filterProductId ? byId.get(option.filterProductId) : null;
          if (!filter) throw new Error("Для варианта с фильтром сервиса выберите товар фильтра из каталога");
          lines.push({ type: "filter", name: filter.name, quantity: 1, unitPriceCents: filter.salePriceCents, totalCents: filter.salePriceCents });
        }
        for (const productId of option.consumableProductIds) {
          const product = byId.get(productId);
          if (!product) throw new Error(`Расходник ${productId} не найден в каталоге`);
          lines.push({ type: "consumable", name: product.name, quantity: 1, unitPriceCents: product.salePriceCents, totalCents: product.salePriceCents });
        }
        let workCents = usesServiceOil
          ? rules.freeWorkWithServiceOil
            ? 0
            : rules.serviceOilWorkCents
          : rules.clientOilWorkCents;
        if (!usesServiceFilter) workCents += rules.clientFilterSurchargeCents;
        if (option.protectionRemoval) workCents += rules.protectionRemovalCents;
        if (option.protectionInstall) workCents += rules.protectionInstallCents;
        if (option.complexFilter) workCents += rules.complexFilterSurchargeCents;
        if (option.cartridgeFilter) workCents += rules.cartridgeSurchargeCents;
        if (requiredVolumeLiters > rules.excessVolumeThresholdLiters) workCents += rules.excessVolumeSurchargeCents;
        if (workCents > 0) lines.push({ type: "work", name: "Работа по замене масла", quantity: 1, unitPriceCents: workCents, totalCents: workCents });
        if (rules.washerCents > 0) lines.push({ type: "consumable", name: "Уплотнительная шайба", quantity: 1, unitPriceCents: rules.washerCents, totalCents: rules.washerCents });
        if (rules.environmentalFeeCents > 0) lines.push({ type: "fee", name: "Экологический сбор", quantity: 1, unitPriceCents: rules.environmentalFeeCents, totalCents: rules.environmentalFeeCents });
        const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
        const discountCents = Math.min(option.discountCents, rules.maxAutomaticDiscountCents, subtotalCents);
        const beforeRounding = Math.max(rules.minimumOrderCents, subtotalCents - discountCents);
        const totalCents = Math.ceil(beforeRounding / rules.totalRoundingCents) * rules.totalRoundingCents;
        return { scenario: option.scenario, roundedLiters, lines, subtotalCents, discountCents, totalCents, durationMinutes: rules.serviceDurationMinutes };
      });
      const validUntil = new Date(Date.now() + rules.quoteValidityHours * 3_600_000);
      const needsHumanReview = quoteOptions.some((option) => option.totalCents > ctx.settings.handoffRules.highAmountCents);
      const quote = await prisma.aIServiceQuote.create({
        data: {
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          clientId: contextData.client?.id,
          vehicleId: contextData.selectedVehicle?.id,
          status: needsHumanReview ? "needs_human_review" : "draft",
          serviceType,
          vehicleSnapshot: json(contextData.selectedVehicle ?? {}),
          requirementsSnapshot: json(requirements),
          sourceEvidence: json(record(requirements).sources ?? []),
          quoteOptions: json(quoteOptions),
          totalCents: quoteOptions.length === 1 ? quoteOptions[0].totalCents : null,
          validUntil,
        },
      });
      await prisma.aIAgentSession.updateMany({
        where: { id: ctx.sessionId, organizationId: ctx.organizationId },
        data: { quoteId: quote.id, status: needsHumanReview ? "handoff" : "waiting_client", lastActivityAt: new Date() },
      });
      return { quoteId: quote.id, status: quote.status, requiredVolumeLiters, roundedLiters, options: quoteOptions, validUntil: validUntil.toISOString(), needsHumanReview };
    }),
});

export const getAvailableSlotsTool = tool({
  name: "get_available_slots",
  description: "Получить не более настроенного количества реальных свободных окон из YCLIENTS.",
  parameters: z.object({ quoteId: z.string().nullable() }),
  ...commonToolGuardrails,
  execute: async ({ quoteId }, context) =>
    withToolAudit(context, "get_available_slots", { quoteId }, async () => {
      const ctx = requireContext(context);
      if (quoteId) {
        const quote = await prisma.aIServiceQuote.findFirst({ where: { id: quoteId, organizationId: ctx.organizationId, conversationId: ctx.conversationId } });
        if (!quote) throw new Error("Расчёт не найден в текущем диалоге");
      }
      const slots = await getYclientsAvailableSlots({
        limit: ctx.settings.slotSuggestionCount,
        minLeadMinutes: ctx.settings.minBookingLeadMinutes,
        horizonDays: ctx.settings.maxBookingHorizonDays,
        durationMinutes: ctx.settings.calculationRules.serviceDurationMinutes,
      });
      return { slots, source: "yclients", checkedAt: new Date().toISOString() };
    }),
});

export const holdAppointmentSlotTool = tool({
  name: "hold_appointment_slot",
  description: "Временно удержать выбранное клиентом окно в Эко-платформе перед окончательным подтверждением.",
  parameters: z.object({ slotId: z.string().min(10), quoteId: z.string().nullable() }),
  ...commonToolGuardrails,
  execute: async ({ slotId, quoteId }, context) =>
    withToolAudit(context, "hold_appointment_slot", { slotId, quoteId }, async () => {
      const ctx = requireContext(context);
      const slot = parseYclientsSlotId(slotId);
      const active = await prisma.aIAgentSlotHold.findFirst({
        where: { organizationId: ctx.organizationId, slotId, status: "held", expiresAt: { gt: new Date() }, conversationId: { not: ctx.conversationId } },
      });
      if (active) return { held: false, reason: "Окно уже временно удерживается другим клиентом" };
      await prisma.aIAgentSlotHold.updateMany({
        where: { organizationId: ctx.organizationId, conversationId: ctx.conversationId, status: "held" },
        data: { status: "released", releasedAt: new Date() },
      });
      const expiresAt = new Date(Date.now() + ctx.settings.slotHoldMinutes * 60_000);
      const hold = await prisma.aIAgentSlotHold.create({
        data: { organizationId: ctx.organizationId, conversationId: ctx.conversationId, quoteId, slotId, slotSnapshot: json(slot), expiresAt },
      });
      return { held: true, holdId: hold.id, slotId, expiresAt: expiresAt.toISOString() };
    }),
});

export const createAppointmentTool = tool({
  name: "create_appointment",
  description: "Создать запись только после явного согласия клиента и успешного удержания окна.",
  parameters: z.object({ slotId: z.string().min(10), quoteId: z.string(), comment: z.string().max(600) }),
  needsApproval: async (runContext) => {
    const ctx = runContext.context as AIAgentRunContext | undefined;
    return !ctx || ctx.mode !== "autonomous" || !ctx.settings.autoBookingEnabled || ctx.settings.bookingApprovalRequired;
  },
  ...commonToolGuardrails,
  execute: async ({ slotId, quoteId, comment }, context) =>
    withToolAudit(context, "create_appointment", { slotId, quoteId, comment }, async () => {
      const ctx = requireContext(context);
      const [hold, quote, conversation, latestInbound] = await Promise.all([
        prisma.aIAgentSlotHold.findFirst({ where: { organizationId: ctx.organizationId, conversationId: ctx.conversationId, slotId, status: "held", expiresAt: { gt: new Date() } } }),
        prisma.aIServiceQuote.findFirst({ where: { id: quoteId, organizationId: ctx.organizationId, conversationId: ctx.conversationId } }),
        getConversationContext(ctx.conversationId),
        prisma.messengerMessage.findFirst({ where: { organizationId: ctx.organizationId, conversationId: ctx.conversationId, direction: "inbound" }, orderBy: { createdAt: "desc" }, select: { text: true } }),
      ]);
      if (!hold) throw new Error("Удержание окна истекло. Сначала получите и удержите свободное время снова.");
      if (!quote) throw new Error("Расчёт не найден в текущем диалоге");
      const consent = latestInbound?.text.trim().toLowerCase() || "";
      if (!/(^|\s)(да|подходит|записывайте|запишите|согласен|согласна)(\s|[!.?]|$)/i.test(consent) || /не\s+(надо|записывайте|подходит)/i.test(consent)) {
        throw new Error("В последнем сообщении клиента нет явного согласия на запись");
      }
      if (!conversation.client?.name || !conversation.client.phone) throw new Error("Для записи нужны имя и телефон привязанного клиента");
      const vehicle = conversation.selectedVehicle;
      const appointment = await createYclientsAppointment({
        slotId,
        clientName: conversation.client.name,
        clientPhone: conversation.client.phone,
        durationMinutes: ctx.settings.calculationRules.serviceDurationMinutes,
        comment: [comment, vehicle ? `${vehicle.label}; VIN ${vehicle.vin || "не указан"}; госномер ${vehicle.plate || "не указан"}` : "", `Расчёт ИИ: ${quote.id}`, `Диалог: ${ctx.conversationId}`].filter(Boolean).join("\n"),
      });
      await prisma.$transaction([
        prisma.aIAgentSlotHold.update({ where: { id: hold.id }, data: { status: "converted", releasedAt: new Date() } }),
        prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { appointmentId: appointment.id, status: "converted_to_appointment" } }),
        prisma.aIAgentSession.update({ where: { id: ctx.sessionId }, data: { appointmentId: appointment.id, quoteId: quote.id, status: "waiting_client", lastActivityAt: new Date() } }),
        prisma.messengerConversation.update({ where: { id: ctx.conversationId }, data: { relatedAppointmentId: appointment.id } }),
      ]);
      return { created: true, appointmentId: appointment.id, datetime: appointment.datetime, address: appointment.address, vehicle: vehicle?.label || null, quoteId: quote.id };
    }, true),
});

export const handoffToHumanTool = tool({
  name: "handoff_to_human",
  description: "Передать разговор сотруднику с кратким резюме, причиной и уже собранными данными.",
  parameters: z.object({
    reasonCode: z.enum(["vehicle_ambiguous", "technical_conflict", "low_confidence", "complaint", "customer_request", "high_amount", "nonstandard", "rossko_ambiguous", "other"]),
    reason: z.string().min(3).max(500),
    summary: z.string().min(10).max(1600),
    collectedData: z.object({
      clientRequest: z.string().max(1000).nullable(),
      vin: z.string().max(24).nullable(),
      vehicle: z.string().max(300).nullable(),
      engine: z.string().max(120).nullable(),
      requirements: z.string().max(1000).nullable(),
      products: z.array(z.string().max(300)).max(20),
      quote: z.string().max(1000).nullable(),
      proposedSlot: z.string().max(160).nullable(),
      unresolvedQuestions: z.array(z.string().max(300)).max(10),
    }),
    productIds: z.array(z.string()).max(20),
    quoteId: z.string().nullable(),
  }),
  ...commonToolGuardrails,
  execute: async ({ reasonCode, reason, summary, collectedData, productIds, quoteId }, context) =>
    withToolAudit(context, "handoff_to_human", { reasonCode, reason, summary, collectedData, productIds, quoteId }, async () => {
      const ctx = requireContext(context);
      const products = productIds.length
        ? await prisma.localProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, article: true, salePriceCents: true } })
        : [];
      const handoff = await prisma.aIAgentHandoff.create({
        data: { organizationId: ctx.organizationId, runId: ctx.runId, conversationId: ctx.conversationId, reasonCode, reason, summary, collectedDataJson: json(collectedData), productsJson: json(products), quoteId },
      });
      await prisma.aIAgentSession.update({ where: { id: ctx.sessionId }, data: { status: "handoff", collectedDataJson: json(collectedData), quoteId, lastActivityAt: new Date() } });
      return { handedOff: true, handoffId: handoff.id, status: "queued", customerMessage: "Передал ваш вопрос сотруднику — он проверит данные и ответит в этом чате." };
    }),
});

export const trustedVehicleWebSearchTool = tool({
  name: "trusted_vehicle_web_search",
  description: "Запросить технический факт только из настроенных доверенных источников. В MVP свободный браузер агенту не предоставляется.",
  parameters: z.object({ factType: z.enum(["oil_approval", "oil_capacity", "viscosity", "filter_oem", "service_interval", "transmission_type"]), vehicleQuery: z.string().min(3).max(200) }),
  ...commonToolGuardrails,
  execute: async ({ factType, vehicleQuery }, context) =>
    withToolAudit(context, "trusted_vehicle_web_search", { factType, vehicleQuery }, async () => {
      const ctx = requireContext(context);
      if (!ctx.settings.internetSearchEnabled || !ctx.settings.trustedDomains.length) {
        return { enabled: false, facts: [], needsHumanReview: true, reason: "Доверенный интернет-поиск не настроен. Свободный браузер заблокирован." };
      }
      return { enabled: true, facts: [], needsHumanReview: true, reason: "Для этого факта не найден подтверждённый источник из белого списка.", trustedDomains: ctx.settings.trustedDomains };
    }),
});

export const tgmClientAgentTools = [
  getClientProfileTool,
  resolveVehicleByVinTool,
  resolveVehicleByParametersTool,
  getEngineOilRequirementsTool,
  findRequiredPartsTool,
  searchLocalCatalogTool,
  rosskoSearchTool,
  calculateServiceQuoteTool,
  getAvailableSlotsTool,
  holdAppointmentSlotTool,
  createAppointmentTool,
  handoffToHumanTool,
  trustedVehicleWebSearchTool,
];
