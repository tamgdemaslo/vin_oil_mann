import type { Prisma } from "@prisma/client";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getConversationContext } from "@/lib/messenger/messenger-context";
import { createLocalDemand } from "@/lib/local-demand-write";
import { getFirstCrmStage } from "@/lib/crm";
import { searchCatalog } from "@/lib/catalog-search";
import { partsCatalogsRequest } from "@/lib/parts-catalogs";
import { getVinLookupCache } from "@/lib/vin-lookup-cache";
import { parsePackVolumeLitersFromOilName } from "@/lib/oil-pack-volume";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { createYclientsAppointment, getYclientsAvailableSlots, parseYclientsSlotId } from "./yclients";
import { safeToolOutputGuardrail, sanitizeForModel, tenantToolInputGuardrail } from "./security";
import { getFreshTechnicalEvidence, queryTechnicalProvider, saveTechnicalEvidence, technicalVehicleKey, technicalWebSearchAvailability, type TechnicalVehicle } from "./technical-evidence";
import { AI_SERVICE_TYPES, TRANSMISSION_SERVICE_TYPES, type AIAgentRunContext, type AIServiceType } from "./types";
import { estimateConversationDurationMinutes, getConversationAgentState, withConversationAgentState } from "./conversation-state";
import { stageForTool, updateAgentRunProgress } from "./run-progress";
import {
  groupCatalogApplications,
  resolveVehicleVariants,
  type CatalogApplicationRow,
  type ConfidenceLevel,
  type VehicleRequestGoal,
} from "./vehicle-resolution";

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

function confidenceNumber(level: ConfidenceLevel) {
  return level === "HIGH" ? 0.9 : level === "MEDIUM" ? 0.65 : 0.35;
}

function timeoutForTool(ctx: AIAgentRunContext, toolName: string) {
  if (toolName === "get_client_profile") return ctx.settings.timeoutRules.clientProfileSeconds;
  if (["resolve_vehicle_by_vin", "resolve_vehicle_by_parameters", "save_vehicle", "trusted_vehicle_web_search"].includes(toolName)) return ctx.settings.timeoutRules.vehicleResolutionSeconds;
  if (["trusted_technical_web_search", "get_engine_oil_requirements", "get_transmission_requirements", "find_required_parts"].includes(toolName)) return ctx.settings.timeoutRules.technicalSearchSeconds;
  if (["search_local_catalog", "search_compatible_oil"].includes(toolName)) return ctx.settings.timeoutRules.catalogSearchSeconds;
  if (toolName === "rossko_search") return ctx.settings.timeoutRules.rosskoSearchSeconds;
  if (toolName === "calculate_service_quote") return ctx.settings.timeoutRules.quoteCalculationSeconds;
  return Math.max(ctx.settings.timeoutRules.catalogSearchSeconds, 30);
}

async function withToolTimeout<T>(task: Promise<T>, timeoutSeconds: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Превышен таймаут инструмента ${toolName}`)), timeoutSeconds * 1_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mergeSessionCollectedData(ctx: AIAgentRunContext, patch: JsonRecord, confidence?: number) {
  const session = await prisma.aIAgentSession.findFirst({
    where: { id: ctx.sessionId, organizationId: ctx.organizationId },
    select: { collectedDataJson: true },
  });
  await prisma.aIAgentSession.updateMany({
    where: { id: ctx.sessionId, organizationId: ctx.organizationId },
    data: {
      ...(confidence == null ? {} : { confidence }),
      collectedDataJson: json({ ...record(session?.collectedDataJson), ...patch }),
      lastActivityAt: new Date(),
    },
  });
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
  const stage = stageForTool(toolName);
  await updateAgentRunProgress({
    organizationId: ctx.organizationId,
    runId: ctx.runId,
    stage,
    status: stage === "waiting_for_human" ? "waiting_for_human" : "running",
    eventType: "tool_started",
    toolName,
    toolStatus: "running",
    payload: args,
  });
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
    const result = await withToolTimeout(fn(), timeoutForTool(ctx, toolName), toolName);
    await prisma.aIAgentToolCall.update({
      where: { id: row.id },
      data: {
        status: "completed",
        resultSummary: json(sanitizeForModel(result)),
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      },
    });
    await updateAgentRunProgress({
      organizationId: ctx.organizationId,
      runId: ctx.runId,
      stage,
      status: stage === "waiting_for_human" ? "waiting_for_human" : "running",
      eventType: "tool_completed",
      toolName,
      toolStatus: "completed",
      durationMs: Date.now() - startedAt,
      payload: result,
    });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const timedOut = /Превышен таймаут инструмента/.test(errorMessage);
    await prisma.aIAgentToolCall.update({
      where: { id: row.id },
      data: {
        status: "failed",
        errorMessage,
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      },
    });
    await updateAgentRunProgress({
      organizationId: ctx.organizationId,
      runId: ctx.runId,
      stage,
      status: "running",
      eventType: "tool_failed",
      toolName,
      toolStatus: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: timedOut ? "tool_timeout" : "tool_failed",
      internalLabel: errorMessage,
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
      const componentConfidence = {
        vehicleConfidence: (exact ? "HIGH" : "MEDIUM") as ConfidenceLevel,
        oilSpecificationConfidence: "MEDIUM" as ConfidenceLevel,
        oilVolumeConfidence: "MEDIUM" as ConfidenceLevel,
        oilFilterConfidence: (exact ? "HIGH" : "MEDIUM") as ConfidenceLevel,
        partsFitmentConfidence: (exact ? "HIGH" : "MEDIUM") as ConfidenceLevel,
      };
      await mergeSessionCollectedData(ctx, { vin, vehicleCandidates: unique, componentConfidence }, exact ? 0.9 : 0.55);
      return {
        valid: true,
        resolved: exact,
        ambiguous: !exact,
        confidence: exact ? 0.9 : 0.55,
        vehicle: exact ? unique[0] : null,
        candidates: unique.slice(0, 8),
        componentConfidence,
        sources: [{ source: "Parts Catalogs", retrievedAt: new Date().toISOString(), appliesToVin: vin }],
        needsClarification: exact ? [] : ["код двигателя", "мощность", "объём двигателя"],
      };
    }),
});

export const saveVehicleTool = tool({
  name: "save_vehicle",
  description: "Сохранить подтверждённые данные автомобиля текущего клиента. Перед обновлением сверяет VIN и госномер, не создаёт дубли.",
  parameters: z.object({
    vin: z.string().max(24).nullable(),
    plate: z.string().max(32).nullable(),
    make: z.string().max(80).nullable(),
    model: z.string().max(120).nullable(),
    generation: z.string().max(100).nullable(),
    year: z.number().int().min(1950).max(2100).nullable(),
    engine: z.string().max(100).nullable(),
    engineCode: z.string().max(80).nullable(),
    power: z.string().max(40).nullable(),
    transmission: z.string().max(100).nullable(),
    drive: z.string().max(60).nullable(),
    confirmed: z.boolean(),
  }),
  ...commonToolGuardrails,
  execute: async (vehicle, context) =>
    withToolAudit(context, "save_vehicle", vehicle, async () => {
      const ctx = requireContext(context);
      if (!vehicle.confirmed) return { saved: false, reason: "Сохраняются только подтверждённые клиентом или VIN-каталогом данные" };
      const conversation = await getConversationContext(ctx.conversationId);
      if (conversation.organizationId !== ctx.organizationId) throw new Error("Диалог другой организации");
      if (!conversation.client?.id) return { saved: false, reason: "Сначала нужно привязать клиента к диалогу" };
      const vin = vehicle.vin ? normalizeVin(vehicle.vin) : "";
      if (vin && !validVin(vin)) throw new Error("Некорректный VIN");
      const plate = clean(vehicle.plate).toUpperCase().replace(/\s+/g, "");
      const client = await prisma.localCounterparty.findFirst({ where: { id: conversation.client.id } });
      if (!client) return { saved: false, reason: "Карточка клиента не найдена" };
      const raw = record(client.raw);
      const existingVehicle = record(raw.vehicle);
      const existingVin = clean(existingVehicle.vin).toUpperCase();
      const existingPlate = clean(existingVehicle.plate || existingVehicle.licensePlate).toUpperCase().replace(/\s+/g, "");
      const duplicate = Boolean((vin && existingVin === vin) || (plate && existingPlate === plate));
      const nextVehicle = {
        ...existingVehicle,
        id: clean(existingVehicle.id) || `vehicle:${vin || plate || client.id}`,
        vin: vin || existingVin || null,
        plate: plate || existingPlate || null,
        brand: vehicle.make || clean(existingVehicle.brand) || null,
        make: vehicle.make || clean(existingVehicle.make) || null,
        model: vehicle.model || clean(existingVehicle.model) || null,
        generation: vehicle.generation || clean(existingVehicle.generation) || null,
        year: vehicle.year ?? existingVehicle.year ?? null,
        engine: vehicle.engine || clean(existingVehicle.engine) || null,
        engineCode: vehicle.engineCode || clean(existingVehicle.engineCode) || null,
        power: vehicle.power || clean(existingVehicle.power) || null,
        transmission: vehicle.transmission || clean(existingVehicle.transmission) || null,
        drive: vehicle.drive || clean(existingVehicle.drive) || null,
      };
      const label = [clean(nextVehicle.make), clean(nextVehicle.model)].filter(Boolean).join(" ");
      await prisma.localCounterparty.update({
        where: { id: client.id },
        data: { raw: json({ ...raw, vehicle: { ...nextVehicle, label: label || clean(existingVehicle.label) || "Автомобиль клиента" } }) },
      });
      await mergeSessionCollectedData(ctx, { vehicle: nextVehicle, vehicleSavedAt: new Date().toISOString() });
      return { saved: true, updatedExistingVehicle: duplicate || Boolean(Object.keys(existingVehicle).length), vehicle: { label: label || "Автомобиль клиента", vin: nextVehicle.vin, plate: nextVehicle.plate } };
    }),
});

export const resolveVehicleByParametersTool = tool({
  name: "resolve_vehicle_by_parameters",
  description: "Первый обязательный поиск автомобиля по марке, модели, году и двигателю. Группирует строки каталога по реальным модификациям, сравнивает фильтры и возвращает конкретный уточняющий вопрос без требования VIN.",
  parameters: z.object({
    make: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    year: z.number().int().min(1950).max(2100).nullable(),
    engine: z.string().max(80).nullable(),
    power: z.string().max(40).nullable(),
    transmission: z.string().max(80).nullable(),
    drive: z.string().max(40).nullable(),
    requestGoal: z.enum(["rough_quote", "service_booking", "oil_selection", "filter_selection", "general"]),
  }),
  ...commonToolGuardrails,
  execute: async ({ make, model, year, engine, power, transmission, drive, requestGoal }, context) =>
    withToolAudit(context, "resolve_vehicle_by_parameters", { make, model, year, engine, power, transmission, drive, requestGoal }, async () => {
      const ctx = requireContext(context);
      const normalizedEngine = engine?.replace(/(\d),(\d)/g, "$1.$2").trim() || null;
      const findRows = (useEngine: boolean) => prisma.mannFilterApplication.findMany({
        where: {
          make: { contains: make.trim(), mode: "insensitive" },
          AND: [
            {
              OR: [
                { model: { contains: model.trim(), mode: "insensitive" } },
                { vehicleText: { contains: model.trim(), mode: "insensitive" } },
                { effectiveVehicleText: { contains: model.trim(), mode: "insensitive" } },
              ],
            },
            ...(year ? [{ OR: [{ vehicleYearFrom: null }, { vehicleYearFrom: { lte: year } }] }, { OR: [{ vehicleYearTo: null }, { vehicleYearTo: { gte: year } }] }] : []),
            ...(useEngine && normalizedEngine
              ? [{
                  OR: [
                    { engineCode: { contains: normalizedEngine, mode: "insensitive" as const } },
                    { detail: { contains: normalizedEngine, mode: "insensitive" as const } },
                    { vehicleText: { contains: normalizedEngine, mode: "insensitive" as const } },
                    { effectiveVehicleText: { contains: normalizedEngine, mode: "insensitive" as const } },
                  ],
                }]
              : []),
          ],
        },
        select: {
          vehicleVariantKey: true,
          make: true,
          model: true,
          detail: true,
          vehicleText: true,
          effectiveVehicleText: true,
          engineCode: true,
          kw: true,
          hp: true,
          vehicleYears: true,
          vehicleYearFrom: true,
          vehicleYearTo: true,
          condition: true,
          filterType: true,
          filterSubtype: true,
          mannArticle: true,
          filterNote: true,
          sourceFile: true,
          catalogPage: true,
        },
      });
      let rows = await findRows(Boolean(normalizedEngine));
      if (!rows.length && normalizedEngine) rows = await findRows(false);
      const applications: CatalogApplicationRow[] = rows.map((row) => ({ ...row, variantId: row.vehicleVariantKey }));
      const resolution = resolveVehicleVariants(
        { make, model, year, engine: normalizedEngine, power, transmission, drive, requestGoal: requestGoal as VehicleRequestGoal },
        groupCatalogApplications(applications)
      );
      const confidence = confidenceNumber(resolution.componentConfidence.vehicleConfidence);
      await mergeSessionCollectedData(
        ctx,
        {
          vehicleParameters: { make, model, year, engine: normalizedEngine, power, transmission, drive },
          vehicleResolution: resolution,
          componentConfidence: resolution.componentConfidence,
        },
        confidence
      );
      return {
        ...resolution,
        confidence,
        source: { name: "Локальная база применяемости MANN", retrievedAt: new Date().toISOString() },
      };
    }),
});

const technicalVehicleSchema = z.object({
  vin: z.string().max(24).nullable(),
  make: z.string().max(80).nullable(),
  model: z.string().max(120).nullable(),
  year: z.number().int().min(1950).max(2100).nullable(),
  engine: z.string().max(80).nullable(),
  engineCode: z.string().max(80).nullable(),
  transmission: z.string().max(100).nullable(),
  drive: z.string().max(60).nullable(),
  modification: z.string().max(220).nullable(),
});

export const trustedTechnicalWebSearchTool = tool({
  name: "trusted_technical_web_search",
  description: "Запросить технические факты через серверный поиск только в белом списке источников. Сохраняет URL, дату проверки и выдержку. Нельзя заменять этим инструментом догадки.",
  parameters: z.object({
    vehicle: technicalVehicleSchema,
    aggregate: z.enum(["engine", "automatic_transmission", "cvt", "dsg", "manual_transmission", "front_differential", "rear_differential", "transfer_case", "haldex", "brake_system"]),
    factTypes: z.array(z.enum(["oil_approval", "oil_capacity", "oil_viscosity", "oil_filter", "air_filter", "cabin_filter", "fuel_filter", "fluid_specification", "fluid_capacity", "level_procedure", "service_parts"])).min(1).max(8),
  }),
  ...commonToolGuardrails,
  execute: async ({ vehicle: rawVehicle, aggregate, factTypes }, context) =>
    withToolAudit(context, "trusted_technical_web_search", { vehicle: rawVehicle, aggregate, factTypes }, async () => {
      const ctx = requireContext(context);
      const vehicle: TechnicalVehicle = {
        ...rawVehicle,
        vin: rawVehicle.vin ? normalizeVin(rawVehicle.vin) : null,
      };
      if (vehicle.vin && !validVin(vehicle.vin)) throw new Error("Некорректный VIN");
      if (!vehicle.vin && (!vehicle.make || !vehicle.model || !vehicle.year || !vehicle.engine)) {
        return { found: false, needsClarification: ["марка, модель, год и двигатель"], facts: {}, sources: [] };
      }
      const cached = await getFreshTechnicalEvidence({ organizationId: ctx.organizationId, vehicle, aggregate, factTypes });
      if (!cached.missingFactTypes.length) {
        return { found: true, cached: true, facts: cached.facts, sources: cached.sources, conflicts: [], vehicleKey: cached.vehicleKey, checkedAt: new Date().toISOString() };
      }
      const webSearch = technicalWebSearchAvailability();
      if (!ctx.settings.internetSearchEnabled) {
        return {
          found: Boolean(cached.sources.length),
          cached: Boolean(cached.sources.length),
          facts: cached.facts,
          sources: cached.sources,
          missingFactTypes: cached.missingFactTypes,
          needsHumanReview: true,
          reason: "Интернет-поиск отключён в настройках организации; недостающие технические данные нельзя придумывать.",
          vehicleKey: cached.vehicleKey,
        };
      }
      if (!webSearch.responsesApi && !webSearch.internalProvider) {
        return {
          found: Boolean(cached.sources.length),
          cached: Boolean(cached.sources.length),
          facts: cached.facts,
          sources: cached.sources,
          missingFactTypes: cached.missingFactTypes,
          needsHumanReview: true,
          reason: "Интернет-поиск не подключён или завершился ошибкой: нет доступного провайдера поиска.",
          vehicleKey: cached.vehicleKey,
        };
      }
      const result = await queryTechnicalProvider({ vehicle, aggregate, factTypes: cached.missingFactTypes, trustedDomains: ctx.settings.trustedDomains });
      if (!result) {
        return {
          found: Boolean(cached.sources.length),
          facts: cached.facts,
          sources: cached.sources,
          missingFactTypes: cached.missingFactTypes,
          needsHumanReview: true,
          reason: "Интернет-поиск был вызван, но не вернул подтверждённых источников для этого автомобиля.",
          vehicleKey: cached.vehicleKey,
        };
      }
      await saveTechnicalEvidence({ organizationId: ctx.organizationId, vehicle, aggregate, factTypes: cached.missingFactTypes, result });
      if (result.conflicts?.length) {
        return {
          found: false,
          facts: { ...cached.facts, ...result.facts },
          sources: [...cached.sources, ...result.sources],
          conflicts: result.conflicts,
          needsHumanReview: true,
          reason: "Технические источники расходятся; расчёт передан на проверку сотруднику.",
          vehicleKey: cached.vehicleKey,
        };
      }
      return {
        found: true,
        cached: false,
        facts: { ...cached.facts, ...result.facts },
        sources: [...cached.sources, ...result.sources],
        conflicts: [],
        vehicleKey: technicalVehicleKey(vehicle),
        checkedAt: new Date().toISOString(),
      };
    }),
});

export const getTransmissionRequirementsTool = tool({
  name: "get_transmission_requirements",
  description: "Получить подтверждённые требования к АКПП, CVT, DSG, МКПП, редуктору, раздатке или Haldex из технического кеша. Возвращает спецификацию, объёмы, детали и процедуру уровня, но не придумывает отсутствующие данные.",
  parameters: z.object({
    vehicle: technicalVehicleSchema,
    aggregate: z.enum(["automatic_transmission", "cvt", "dsg", "manual_transmission", "front_differential", "rear_differential", "transfer_case", "haldex"]),
  }),
  ...commonToolGuardrails,
  execute: async ({ vehicle: rawVehicle, aggregate }, context) =>
    withToolAudit(context, "get_transmission_requirements", { vehicle: rawVehicle, aggregate }, async () => {
      const ctx = requireContext(context);
      const vehicle: TechnicalVehicle = { ...rawVehicle, vin: rawVehicle.vin ? normalizeVin(rawVehicle.vin) : null };
      const evidence = await getFreshTechnicalEvidence({
        organizationId: ctx.organizationId,
        vehicle,
        aggregate,
        factTypes: ["fluid_specification", "fluid_capacity", "level_procedure", "service_parts"],
      });
      const facts = record(evidence.facts);
      const hasSpec = Boolean(clean(facts.specification) || clean(facts.approval));
      const hasVolume = Number.isFinite(Number(facts.partialChangeLiters ?? facts.volumeWithFilter ?? facts.fillVolumeLiters)) && Number(facts.partialChangeLiters ?? facts.volumeWithFilter ?? facts.fillVolumeLiters) > 0;
      const confidence = evidence.sources.length ? Math.min(...evidence.sources.map((source) => Number(source.confidence ?? 0))) : 0;
      return {
        found: hasSpec && hasVolume,
        aggregate,
        requirements: facts,
        sources: evidence.sources.map((source) => ({ source: source.name, url: source.url, retrievedAt: new Date().toISOString() })),
        confidence,
        needsHumanReview: true,
        missingFactTypes: evidence.missingFactTypes,
        reason: evidence.missingFactTypes.length ? "Для трансмиссионного обслуживания нужна дополнительная техническая проверка." : "Стоимость работы по трансмиссии всегда подтверждает сотрудник.",
      };
    }),
});

export const getEngineOilRequirementsTool = tool({
  name: "get_engine_oil_requirements",
  description: "Получить только подтверждённые требования моторного масла из проверенного технического кеша. Не предполагает допуски или объём по памяти.",
  parameters: z.object({
    vin: z.string().max(24).nullable(),
    make: z.string().max(80).nullable(),
    model: z.string().max(120).nullable(),
    year: z.number().int().min(1950).max(2100).nullable(),
    engine: z.string().max(80).nullable(),
    engineCode: z.string().max(40).nullable(),
    modification: z.string().max(200).nullable(),
  }),
  ...commonToolGuardrails,
  execute: async ({ vin: rawVin, make, model, year, engine, engineCode, modification }, context) =>
    withToolAudit(context, "get_engine_oil_requirements", { vin: rawVin, make, model, year, engine, engineCode, modification }, async () => {
      const ctx = requireContext(context);
      const vin = rawVin ? normalizeVin(rawVin) : null;
      if (vin && !validVin(vin)) throw new Error("Некорректный VIN");
      const vehicle: TechnicalVehicle = { vin, make, model, year, engine, engineCode, modification };
      if (!vin && (!make || !model || !year || !engine)) {
        return {
          found: false,
          confidence: 0,
          componentConfidence: { oilSpecificationConfidence: "LOW", oilVolumeConfidence: "LOW" },
          needsHumanReview: true,
          usableForPreliminaryQuote: false,
          reason: "Для технической проверки нужны VIN либо марка, модель, год и двигатель",
        };
      }
      const evidence = await getFreshTechnicalEvidence({
        organizationId: ctx.organizationId,
        vehicle,
        aggregate: "engine",
        factTypes: ["oil_approval", "oil_capacity", "oil_viscosity"],
      });
      const facts = record(evidence.facts);
      const approvals = Array.isArray(facts.requiredApproval) ? facts.requiredApproval.map(clean).filter(Boolean) : [clean(facts.requiredApproval)].filter(Boolean);
      const viscosities = Array.isArray(facts.allowedViscosities) ? facts.allowedViscosities.map(clean).filter(Boolean) : [];
      const acea = Array.isArray(facts.acea) ? facts.acea.map(clean).filter(Boolean) : [];
      const api = Array.isArray(facts.api) ? facts.api.map(clean).filter(Boolean) : [];
      const ilsac = Array.isArray(facts.ilsac) ? facts.ilsac.map(clean).filter(Boolean) : [];
      const volume = Number(facts.volumeWithFilter);
      const hasSpecification = Boolean(approvals.length || acea.length || api.length || ilsac.length);
      const hasVolume = Number.isFinite(volume) && volume > 0;
      const confidence = evidence.sources.length ? Math.min(...evidence.sources.map((source) => Number(source.confidence ?? 0))) : 0;
      return {
        found: hasSpecification && hasVolume,
        requiredApproval: approvals[0] ?? null,
        allowedViscosities: viscosities,
        volumeWithFilter: hasVolume ? volume : null,
        volumeNote: clean(facts.volumeNote) || null,
        acea,
        api,
        ilsac,
        engineCode: clean(facts.engineCode) || engineCode || null,
        confidence,
        componentConfidence: {
          oilSpecificationConfidence: hasSpecification && confidence >= 0.8 ? "HIGH" : hasSpecification ? "MEDIUM" : "LOW",
          oilVolumeConfidence: hasVolume && confidence >= 0.8 ? "HIGH" : hasVolume ? "MEDIUM" : "LOW",
        },
        preliminary: !vin,
        usableForPreliminaryQuote: hasSpecification && hasVolume,
        needsHumanReview: !hasSpecification || !hasVolume || confidence < 0.8 || evidence.missingFactTypes.length > 0,
        note: evidence.missingFactTypes.length ? `Нужна дополнительная проверка: ${evidence.missingFactTypes.join(", ")}.` : null,
        sources: evidence.sources.map((source) => ({ source: source.name, url: source.url, retrievedAt: new Date().toISOString(), appliesToVin: vin })),
        vehicleKey: evidence.vehicleKey,
      };
    }),
});

export const findRequiredPartsTool = tool({
  name: "find_required_parts",
  description: "Сравнить фильтры MANN для модификаций, уже найденных через resolve_vehicle_by_parameters. Возвращает общие детали и реальные различия; не требует VIN автоматически.",
  parameters: z.object({
    make: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    year: z.number().int().min(1950).max(2100).nullable(),
    engineCode: z.string().max(40).nullable(),
    variantIds: z.array(z.string().min(1).max(100)).max(12),
  }),
  ...commonToolGuardrails,
  execute: async ({ make, model, year, engineCode, variantIds }, context) =>
    withToolAudit(context, "find_required_parts", { make, model, year, engineCode, variantIds }, async () => {
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
            ...(variantIds.length ? [{ vehicleVariantKey: { in: variantIds } }] : []),
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
          vehicleVariantKey: true,
          filterType: true,
          filterSubtype: true,
          mannArticle: true,
          filterNote: true,
          make: true,
          model: true,
          detail: true,
          vehicleText: true,
          effectiveVehicleText: true,
          engineCode: true,
          kw: true,
          hp: true,
          vehicleYears: true,
          vehicleYearFrom: true,
          vehicleYearTo: true,
          condition: true,
          sourceFile: true,
          catalogPage: true,
        },
      });
      const applications: CatalogApplicationRow[] = rows.map((row) => ({ ...row, variantId: row.vehicleVariantKey }));
      const resolution = resolveVehicleVariants(
        {
          make,
          model,
          year,
          engine: engineCode,
          power: null,
          transmission: null,
          drive: null,
          requestGoal: "filter_selection",
        },
        groupCatalogApplications(applications)
      );
      return {
        found: resolution.found,
        ambiguous: resolution.ambiguous,
        confidence: confidenceNumber(resolution.componentConfidence.partsFitmentConfidence),
        componentConfidence: resolution.componentConfidence,
        commonParts: resolution.commonParts,
        differences: resolution.differences,
        variants: resolution.variants.map((variant) => ({
          variantId: variant.variantId,
          description: variant.description,
          engineCode: variant.engineCode,
          hp: variant.hp,
          parts: variant.parts,
          source: variant.source,
        })),
        recommendedAction: resolution.recommendedAction,
        clarifyingQuestion: resolution.clarifyingQuestion,
        vinPolicy: resolution.vinPolicy,
        needsHumanReview: resolution.needsHumanReview,
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

function productTier(name: string, brand: string | null) {
  const label = `${brand || ""} ${name}`.toLowerCase();
  if (label.includes("lukoil") || label.includes("лукойл")) return "economy";
  if (label.includes("eurol")) return "standard";
  if (label.includes("bardahl")) return "premium";
  return "other";
}

export const searchCompatibleOilTool = tool({
  name: "search_compatible_oil",
  description: "Детерминированно найти совместимые моторные масла в локальном каталоге по нормализованному допуску и вязкости. Чётко отличает официальный approval от заявления о соответствии, если это указано в товарной карточке.",
  parameters: z.object({
    requiredApproval: z.string().max(160).nullable(),
    allowedViscosities: z.array(z.string().min(2).max(40)).min(1).max(12),
    acea: z.array(z.string().max(40)).max(12),
    api: z.array(z.string().max(40)).max(12),
    ilsac: z.array(z.string().max(40)).max(12),
    limit: z.number().int().min(1).max(12),
  }),
  ...commonToolGuardrails,
  execute: async ({ requiredApproval, allowedViscosities, acea, api, ilsac, limit }, context) =>
    withToolAudit(context, "search_compatible_oil", { requiredApproval, allowedViscosities, acea, api, ilsac, limit }, async () => {
      const ctx = requireContext(context);
      const products = await prisma.localProduct.findMany({
        where: {
          archived: false,
          entityType: { not: "service" },
          OR: [
            { groupPath: { contains: "масл", mode: "insensitive" } },
            { groupPath: { contains: "oil", mode: "insensitive" } },
            { name: { contains: "oil", mode: "insensitive" } },
            { name: { contains: "масл", mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, article: true, brand: true, sae: true, oem: true, oemParts: true, acea: true, apiSpec: true, ilsac: true, packageVolume: true, salePriceCents: true, attributes: true, stockBalances: { select: { available: true, store: { select: { organizationId: true, archived: true } } } } },
        take: 1000,
      });
      const { normalizeSAE, normalizeOEM, normalizeACEA, normalizeAPI, normalizeILSAC } = await import("@/lib/oil-normalizer");
      const needApproval = requiredApproval ? normalizeOEM(requiredApproval) : [];
      const needViscosity = allowedViscosities.flatMap((value) => normalizeSAE(value));
      const needAcea = acea.flatMap((value) => normalizeACEA(value));
      const needApi = api.flatMap((value) => normalizeAPI(value));
      const needIlsac = ilsac.flatMap((value) => normalizeILSAC(value));
      const matches = products.flatMap((product) => {
        const attributes = JSON.stringify(product.attributes ?? "");
        const productApprovals = normalizeOEM([product.oem, product.oemParts, product.name, attributes].filter(Boolean).join(" "));
        const productViscosity = normalizeSAE([product.sae, product.name, attributes].filter(Boolean).join(" "));
        const productAcea = normalizeACEA([product.acea, product.name, attributes].filter(Boolean).join(" "));
        const productApi = normalizeAPI([product.apiSpec, product.name, attributes].filter(Boolean).join(" "));
        const productIlsac = normalizeILSAC([product.ilsac, product.name, attributes].filter(Boolean).join(" "));
        const has = (actual: string[], expected: string[]) => !expected.length || expected.some((value) => actual.some((item) => item.toUpperCase() === value.toUpperCase()));
        if (!has(productApprovals, needApproval) || !has(productViscosity, needViscosity) || (!needApproval.length && (!has(productAcea, needAcea) || !has(productApi, needApi) || !has(productIlsac, needIlsac)))) return [];
        const available = product.stockBalances
          .filter((row) => !row.store.archived && (!row.store.organizationId || row.store.organizationId === ctx.organizationId))
          .reduce((sum, row) => sum + Number(row.available), 0);
        const approvalText = `${product.oem || ""} ${product.oemParts || ""} ${attributes}`;
        const officialApproval = /official|одобрени|approval/i.test(approvalText);
        const score = (needApproval.length ? 100 : 0) + (needViscosity.length ? 20 : 0) + (available > 0 ? 10 : 0);
        return [{
          id: product.id,
          name: product.name,
          article: product.article,
          brand: product.brand,
          tier: productTier(product.name, product.brand),
          retailPriceCents: product.salePriceCents,
          packageVolume: product.packageVolume,
          available,
          availability: available > 0 ? "in_stock" : "order_only",
          matchedApproval: productApprovals.filter((item) => needApproval.some((value) => value.toUpperCase() === item.toUpperCase())),
          matchedViscosity: productViscosity.filter((item) => needViscosity.some((value) => value.toUpperCase() === item.toUpperCase())),
          approvalClaim: needApproval.length ? (officialApproval ? "official_approval" : "manufacturer_claim") : "not_required",
          score,
        }];
      });
      matches.sort((a, b) => b.score - a.score || (b.available > 0 ? 1 : 0) - (a.available > 0 ? 1 : 0) || a.retailPriceCents - b.retailPriceCents);
      const byTier = ["economy", "standard", "premium"].flatMap((tier) => matches.filter((item) => item.tier === tier).slice(0, 1));
      const selected = (byTier.length ? byTier : matches).slice(0, limit);
      return { found: selected.length > 0, products: selected, totalCompatible: matches.length, normalizedRequirements: { approval: needApproval, viscosity: needViscosity, acea: needAcea, api: needApi, ilsac: needIlsac }, checkedAt: new Date().toISOString() };
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

function rosskoRetailPriceCents(purchaseCents: number | null, rules: Array<{ fromCents: number; toCents: number | null; marginPercent: number }>) {
  if (purchaseCents == null) return null;
  const rule = rules.find((item) => purchaseCents >= item.fromCents && (item.toCents == null || purchaseCents < item.toCents)) ?? rules[rules.length - 1];
  if (!rule) return null;
  return Math.round(purchaseCents * (1 + rule.marginPercent / 100));
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
      const cfg = await rosskoConfig();
      const deliveryId = cfg.deliveryId || "";
      const addressId = cfg.addressId || "";
      if (!deliveryId) throw new Error("Для ROSSKO не настроен способ доставки");
      const raw = await rosskoSearch(cfg, { text: [brand, article].filter(Boolean).join(" "), deliveryId, addressId });
      const offers = collectRosskoOffers(raw)
        .map((row, index) => ({
          offerId: clean(row.id) || clean(row.ID) || `rossko-${index + 1}`,
          brand: clean(row.brand) || clean(row.Brand) || brand || "",
          article: clean(row.partnumber) || clean(row.partNumber) || clean(row.article) || article,
          name: clean(row.name) || clean(row.Name) || partType || "Деталь",
          retailPriceCents: rosskoRetailPriceCents(offerPriceCents(row), ctx.settings.rosskoMarkupRules),
          availability: clean(row.stock) || clean(row.Stock) || clean(row.count) || clean(row.quantity) || "уточняется",
          delivery: clean(row.delivery) || clean(row.delivery_time) || clean(row.period) || "уточняется",
        }))
        .filter((offer, index, list) => list.findIndex((other) => `${other.brand}:${other.article}:${other.retailPriceCents}` === `${offer.brand}:${offer.article}:${offer.retailPriceCents}`) === index)
        .slice(0, 10);
      return { found: offers.length > 0, ordered: false, offers, validForHours: 24, priceNote: "Стоимость и наличие фиксируются в расчёте на 24 часа; заказ подтверждает сотрудник." };
    }),
});

const quoteOptionSchema = z.object({
  scenario: z.enum(["service_oil_service_filter", "client_oil_service_filter", "client_oil_client_filter", "service_oil_client_filter"]),
  oilProductId: z.string().nullable(),
  filterProductId: z.string().nullable(),
  serviceProductId: z.string().nullable(),
  consumableProductIds: z.array(z.string()).max(8),
  optionalProductIds: z.array(z.string()).max(8),
  protectionRemoval: z.boolean(),
  protectionInstall: z.boolean(),
  complexFilter: z.boolean(),
  cartridgeFilter: z.boolean(),
  discountCents: z.number().int().min(0),
});

const quoteRequirementSourceSchema = z.object({
  source: z.string().min(1).max(240),
  url: z.string().url().max(1200).nullable().optional(),
  retrievedAt: z.string().min(1).max(64),
  appliesToVin: z.string().max(24).nullable(),
});

const additionalServiceSchema = z.object({
  serviceType: z.enum(AI_SERVICE_TYPES),
  title: z.string().min(3).max(180),
  serviceProductId: z.string().nullable(),
  materialProductIds: z.array(z.string()).max(12),
  durationMinutes: z.number().int().min(10).max(480),
  needsHumanReview: z.boolean(),
  sources: z.array(quoteRequirementSourceSchema).min(1).max(10),
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
  conflictingSources: z.boolean().optional(),
  note: z.string().max(600).nullable(),
  sources: z.array(quoteRequirementSourceSchema).max(10),
});

export const calculateServiceQuoteTool = tool({
  name: "calculate_service_quote",
  description: "Детерминированно рассчитать 1–3 варианта обслуживания по актуальным розничным ценам каталога. Не создаёт скидки и не отправляет расчёт клиенту.",
  parameters: z.object({
    requiredVolumeLiters: z.number().positive().max(30),
    serviceType: z.enum(AI_SERVICE_TYPES),
    options: z.array(quoteOptionSchema).min(1).max(3),
    requirements: quoteRequirementsSchema,
    additionalServices: z.array(additionalServiceSchema).max(8).default([]),
    rosskoOffers: z.array(z.object({ offerId: z.string(), brand: z.string(), article: z.string(), name: z.string(), retailPriceCents: z.number().int().nonnegative(), delivery: z.string() })).max(20).default([]),
  }),
  ...commonToolGuardrails,
  execute: async ({ requiredVolumeLiters, serviceType, options, requirements, additionalServices, rosskoOffers }, context) =>
    withToolAudit(context, "calculate_service_quote", { requiredVolumeLiters, serviceType, options, requirements, additionalServices, rosskoOffers }, async () => {
      const ctx = requireContext(context);
      const rules = ctx.settings.calculationRules;
      const contextData = await getConversationContext(ctx.conversationId);
      if (contextData.organizationId !== ctx.organizationId) throw new Error("Диалог другой организации");
      if (!requirements.found || !requirements.sources.length) throw new Error("Расчёт нельзя создать без подтверждённых технических требований и источников");
      if (requirements.conflictingSources) throw new Error("Источники технических данных расходятся; расчёт нужно передать сотруднику");
      const productIds = [...new Set([
        ...options.flatMap((option) => [option.oilProductId, option.filterProductId, option.serviceProductId, ...option.consumableProductIds, ...option.optionalProductIds]),
        ...additionalServices.flatMap((service) => [service.serviceProductId, ...service.materialProductIds]),
      ].filter((id): id is string => Boolean(id)))];
      const products = await prisma.localProduct.findMany({
        where: { id: { in: productIds }, archived: false },
        select: { id: true, name: true, article: true, brand: true, entityType: true, salePriceCents: true, packageVolume: true },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      const roundedLiters = Math.ceil(requiredVolumeLiters / rules.literRoundingStep) * rules.literRoundingStep;
      for (const service of additionalServices) {
        if (TRANSMISSION_SERVICE_TYPES.has(service.serviceType as AIServiceType) && !service.serviceProductId) {
          throw new Error("Для добавленной трансмиссионной работы выберите услугу из каталога: её стоимость подтверждает сотрудник");
        }
      }
      const quoteOptions = options.map((option) => {
        const lines: Array<{ type: string; productId?: string; name: string; quantity: number; unitPriceCents: number; totalCents: number }> = [];
        const usesServiceOil = option.scenario.startsWith("service_oil");
        const usesServiceFilter = option.scenario.endsWith("service_filter");
        if (usesServiceOil) {
          const oil = option.oilProductId ? byId.get(option.oilProductId) : null;
          if (!oil) throw new Error("Для варианта с маслом сервиса выберите товар масла из каталога");
          const packLiters = parsePackVolumeLitersFromOilName(oil.packageVolume || oil.name) || 1;
          const count = Math.ceil(roundedLiters / packLiters);
          lines.push({ type: "oil", productId: oil.id, name: oil.name, quantity: count, unitPriceCents: oil.salePriceCents, totalCents: count * oil.salePriceCents });
        }
        if (usesServiceFilter) {
          const filter = option.filterProductId ? byId.get(option.filterProductId) : null;
          if (!filter) throw new Error("Для варианта с фильтром сервиса выберите товар фильтра из каталога");
          lines.push({ type: "filter", productId: filter.id, name: filter.name, quantity: 1, unitPriceCents: filter.salePriceCents, totalCents: filter.salePriceCents });
        }
        for (const productId of option.consumableProductIds) {
          const product = byId.get(productId);
          if (!product) throw new Error(`Расходник ${productId} не найден в каталоге`);
          lines.push({ type: "consumable", productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.salePriceCents, totalCents: product.salePriceCents });
        }
        const service = option.serviceProductId ? byId.get(option.serviceProductId) : null;
        if (service) {
          if (service.entityType !== "service") throw new Error("Работа должна быть выбрана из каталога услуг");
          lines.push({ type: "work", productId: service.id, name: service.name, quantity: 1, unitPriceCents: service.salePriceCents, totalCents: service.salePriceCents });
        } else {
          if (TRANSMISSION_SERVICE_TYPES.has(serviceType as AIServiceType)) throw new Error("Стоимость трансмиссионной работы должна быть выбрана из каталога и подтверждена сотрудником");
          let workCents = usesServiceOil ? (rules.freeWorkWithServiceOil ? 0 : rules.serviceOilWorkCents) : rules.clientOilWorkCents;
          if (!usesServiceFilter) workCents += rules.clientFilterSurchargeCents;
          if (option.protectionRemoval) workCents += rules.protectionRemovalCents;
          if (option.protectionInstall) workCents += rules.protectionInstallCents;
          if (option.complexFilter) workCents += rules.complexFilterSurchargeCents;
          if (option.cartridgeFilter) workCents += rules.cartridgeSurchargeCents;
          if (requiredVolumeLiters > rules.excessVolumeThresholdLiters) workCents += rules.excessVolumeSurchargeCents;
          if (workCents > 0) lines.push({ type: "work", name: "Работа по обслуживанию", quantity: 1, unitPriceCents: workCents, totalCents: workCents });
        }
        for (const additionalService of additionalServices) {
          const additionalWork = additionalService.serviceProductId ? byId.get(additionalService.serviceProductId) : null;
          if (additionalService.serviceProductId && !additionalWork) throw new Error(`Услуга ${additionalService.title} не найдена в каталоге`);
          if (additionalWork) {
            if (additionalWork.entityType !== "service") throw new Error(`Позиция ${additionalService.title} должна быть услугой каталога`);
            lines.push({ type: "work", productId: additionalWork.id, name: additionalWork.name, quantity: 1, unitPriceCents: additionalWork.salePriceCents, totalCents: additionalWork.salePriceCents });
          }
          for (const materialId of additionalService.materialProductIds) {
            const material = byId.get(materialId);
            if (!material) throw new Error(`Материал для ${additionalService.title} не найден в каталоге`);
            lines.push({ type: "material", productId: material.id, name: material.name, quantity: 1, unitPriceCents: material.salePriceCents, totalCents: material.salePriceCents });
          }
        }
        if (rules.washerCents > 0) lines.push({ type: "consumable", name: "Уплотнительная шайба", quantity: 1, unitPriceCents: rules.washerCents, totalCents: rules.washerCents });
        if (rules.environmentalFeeCents > 0) lines.push({ type: "fee", name: "Экологический сбор", quantity: 1, unitPriceCents: rules.environmentalFeeCents, totalCents: rules.environmentalFeeCents });
        const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
        const discountCents = Math.min(option.discountCents, rules.maxAutomaticDiscountCents, subtotalCents);
        const beforeRounding = Math.max(rules.minimumOrderCents, subtotalCents - discountCents);
        const totalCents = Math.ceil(beforeRounding / rules.totalRoundingCents) * rules.totalRoundingCents;
        const optionalItems = option.optionalProductIds.map((productId) => {
          const product = byId.get(productId);
          if (!product) throw new Error(`Дополнительная позиция ${productId} не найдена в каталоге`);
          return { productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.salePriceCents, totalCents: product.salePriceCents };
        });
        return {
          scenario: option.scenario,
          roundedLiters,
          lines,
          optionalItems,
          subtotalCents,
          discountCents,
          totalCents,
          durationMinutes: rules.serviceDurationMinutes + additionalServices.reduce((sum, service) => sum + service.durationMinutes, 0),
          services: [{ serviceType, title: "Основное обслуживание" }, ...additionalServices.map((service) => ({ serviceType: service.serviceType, title: service.title }))],
        };
      });
      const validUntil = new Date(Date.now() + rules.quoteValidityHours * 3_600_000);
      const hasTransmissionService = TRANSMISSION_SERVICE_TYPES.has(serviceType as AIServiceType) || additionalServices.some((service) => TRANSMISSION_SERVICE_TYPES.has(service.serviceType as AIServiceType));
      const needsHumanReview = requirements.needsHumanReview || hasTransmissionService || additionalServices.some((service) => service.needsHumanReview) || quoteOptions.some((option) => option.totalCents > ctx.settings.handoffRules.highAmountCents);
      const localProductsSnapshot = products.map((product) => ({ id: product.id, name: product.name, article: product.article, brand: product.brand, entityType: product.entityType, retailPriceCents: product.salePriceCents, packageVolume: product.packageVolume }));
      const sourceEvidence = [...requirements.sources, ...additionalServices.flatMap((service) => service.sources)];
      const preQuoteSession = await prisma.aIAgentSession.findFirst({ where: { id: ctx.sessionId, organizationId: ctx.organizationId }, select: { collectedDataJson: true } });
      const preQuoteState = getConversationAgentState(preQuoteSession?.collectedDataJson);
      const preliminaryWithoutVin = ["unavailable_now", "refused"].includes(preQuoteState.vinAvailability);
      const quote = await prisma.aIServiceQuote.create({
        data: {
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          clientId: contextData.client?.id,
          vehicleId: contextData.selectedVehicle?.id,
          status: preliminaryWithoutVin ? "draft_preliminary" : needsHumanReview ? "needs_human_review" : "draft",
          serviceType: additionalServices.length ? "complex_service" : serviceType,
          vehicleSnapshot: json(contextData.selectedVehicle ?? {}),
          requirementsSnapshot: json({ ...requirements, additionalServices }),
          sourceEvidence: json(sourceEvidence),
          localProductsSnapshot: json(localProductsSnapshot),
          rosskoOffersSnapshot: json(rosskoOffers),
          quoteOptions: json(quoteOptions),
          optionalItems: json(quoteOptions.flatMap((option) => option.optionalItems)),
          totalCents: quoteOptions.length === 1 ? quoteOptions[0].totalCents : null,
          validUntil,
          requiresHumanApproval: true,
          humanReviewReason: preliminaryWithoutVin
            ? "preliminary_without_vin"
            : needsHumanReview ? (hasTransmissionService ? "transmission_labor_requires_human_review" : "technical_confidence_or_amount") : null,
        },
      });
      const agentSession = preQuoteSession;
      const currentState = getConversationAgentState(agentSession?.collectedDataJson);
      const root = agentSession?.collectedDataJson && typeof agentSession.collectedDataJson === "object" && !Array.isArray(agentSession.collectedDataJson)
        ? agentSession.collectedDataJson as Record<string, unknown>
        : {};
      await prisma.aIAgentSession.updateMany({
        where: { id: ctx.sessionId, organizationId: ctx.organizationId },
        data: {
          quoteId: quote.id,
          status: "needs_approval",
          collectedDataJson: json(withConversationAgentState(root, {
            ...currentState,
            quoteId: quote.id,
            awaitingTechnicalResearch: false,
            awaitingHumanApproval: true,
            pendingToolAction: "none",
            pendingQuestion: "quote",
            updatedAt: new Date().toISOString(),
          })),
          lastActivityAt: new Date(),
        },
      });
      return { quoteId: quote.id, status: quote.status, requiredVolumeLiters, roundedLiters, options: quoteOptions, services: [serviceType, ...additionalServices.map((service) => service.serviceType)], optionalItems: quoteOptions.flatMap((option) => option.optionalItems), validUntil: validUntil.toISOString(), requiresHumanApproval: true, needsHumanReview };
    }),
});

export const requestQuoteApprovalTool = tool({
  name: "request_quote_approval",
  description: "Передать готовый расчёт сотруднику на подтверждение. Вызывай строго после calculate_service_quote. После подтверждения верни клиенту ровно сохранённый customerText без добавлений и изменений.",
  parameters: z.object({
    quoteId: z.string().min(1),
    customerText: z.string().min(20).max(6000),
    internalSummary: z.string().min(20).max(6000),
  }),
  needsApproval: async () => true,
  ...commonToolGuardrails,
  execute: async ({ quoteId, customerText, internalSummary }, context) =>
    withToolAudit(context, "request_quote_approval", { quoteId, customerText, internalSummary }, async () => {
      const ctx = requireContext(context);
      const quote = await prisma.aIServiceQuote.findFirst({ where: { id: quoteId, organizationId: ctx.organizationId, conversationId: ctx.conversationId } });
      if (!quote) throw new Error("Расчёт не найден в текущем диалоге");
      if (quote.validUntil && quote.validUntil <= new Date()) {
        await prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { status: "expired" } });
        throw new Error("Срок действия расчёта истёк — цену и наличие нужно проверить снова");
      }
      if (quote.status === "rejected") throw new Error("Расчёт отклонён сотрудником");
      await prisma.aIServiceQuote.update({
        where: { id: quote.id },
        data: { status: "approved", approvedById: ctx.actorId, approvedAt: new Date(), customerText, internalSummary },
      });
      await prisma.aIAgentSession.updateMany({
        where: { id: ctx.sessionId, organizationId: ctx.organizationId },
        data: { quoteId: quote.id, status: "waiting_client", lastDraftText: customerText, lastActivityAt: new Date() },
      });
      return { approved: true, quoteId: quote.id, customerText, nextStep: "Отправь клиенту сохранённый текст дословно." };
    }, true),
});

export const selectQuoteOptionTool = tool({
  name: "select_quote_option",
  description: "Зафиксировать выбранный клиентом вариант ранее отправленного и ещё действующего расчёта. Не создаёт запись и не резервирует товар.",
  parameters: z.object({ quoteId: z.string().min(1), optionIndex: z.number().int().min(0).max(2) }),
  ...commonToolGuardrails,
  execute: async ({ quoteId, optionIndex }, context) =>
    withToolAudit(context, "select_quote_option", { quoteId, optionIndex }, async () => {
      const ctx = requireContext(context);
      const quote = await prisma.aIServiceQuote.findFirst({ where: { id: quoteId, organizationId: ctx.organizationId, conversationId: ctx.conversationId } });
      if (!quote) throw new Error("Расчёт не найден в текущем диалоге");
      if (quote.status !== "sent" && quote.status !== "approved") throw new Error("Клиент может выбрать вариант только из подтверждённого расчёта");
      if (quote.validUntil && quote.validUntil <= new Date()) {
        await prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { status: "expired" } });
        throw new Error("Срок действия расчёта истёк — нужно обновить цену и наличие");
      }
      const options = Array.isArray(quote.quoteOptions) ? quote.quoteOptions : [];
      const selected = options[optionIndex];
      if (!selected || typeof selected !== "object") throw new Error("Выбранный вариант не найден в расчёте");
      const selectedRecord = record(selected);
      await prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { selectedOption: json(selected), totalCents: Number(selectedRecord.totalCents) || quote.totalCents, status: "accepted" } });
      return { selected: true, quoteId: quote.id, optionIndex, totalCents: Number(selectedRecord.totalCents) || null, needsPartsOrder: Array.isArray(quote.rosskoOffersSnapshot) && quote.rosskoOffersSnapshot.length > 0 };
    }),
});

export const createClientCaseTool = tool({
  name: "create_client_case",
  description: "Создать или обновить единственное дело клиента «Ожидает запчасти» для выбранного расчёта. Не оформляет заказ у поставщика.",
  parameters: z.object({ quoteId: z.string().min(1), expectedAt: z.string().datetime().nullable(), note: z.string().max(1000).nullable() }),
  ...commonToolGuardrails,
  execute: async ({ quoteId, expectedAt, note }, context) =>
    withToolAudit(context, "create_client_case", { quoteId, expectedAt, note }, async () => {
      const ctx = requireContext(context);
      const conversation = await getConversationContext(ctx.conversationId);
      const quote = await prisma.aIServiceQuote.findFirst({ where: { id: quoteId, organizationId: ctx.organizationId, conversationId: ctx.conversationId } });
      if (!quote) throw new Error("Расчёт не найден в текущем диалоге");
      const existing = await prisma.crmDeal.findFirst({ where: { conversationId: ctx.conversationId, caseStatus: "waiting_parts", status: "open" }, orderBy: { updatedAt: "desc" } });
      const dueAt = expectedAt ? new Date(expectedAt) : null;
      if (dueAt && Number.isNaN(dueAt.getTime())) throw new Error("Некорректный срок поставки");
      if (existing) {
        await prisma.crmDeal.update({ where: { id: existing.id }, data: { suppliesExpectedAt: dueAt, suppliesNote: note || existing.suppliesNote, nextAction: "Ждать поставку запчастей", nextActionAt: dueAt, nextContactAt: dueAt } });
        await prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { status: "waiting_parts" } });
        return { created: false, caseId: existing.id, status: "waiting_parts" };
      }
      const stage = await getFirstCrmStage();
      if (!stage) throw new Error("Не найдены стадии CRM для дела клиента");
      const deal = await prisma.crmDeal.create({
        data: {
          title: `Ожидает запчасти: ${conversation.client?.name || "клиент"}`,
          customerName: conversation.client?.name || null,
          phoneNormalized: conversation.client?.phone || null,
          vehicle: conversation.selectedVehicle?.label || null,
          source: "ai-agent",
          clientType: "regular",
          nextAction: "Ждать поставку запчастей",
          stageId: stage.id,
          responsibleLogin: ctx.actorId,
          conversationId: ctx.conversationId,
          caseStatus: "waiting_parts",
          caseType: "message",
          caseKey: `ai_waiting_parts:${ctx.conversationId}:${quote.id}`,
          suppliesExpectedAt: dueAt,
          suppliesNote: note || `Расчёт ${quote.id}; товары под заказ.`,
          nextActionAt: dueAt,
          nextContactAt: dueAt,
          notes: `Создано агентом. Расчёт: ${quote.id}.`,
          createdByLogin: "ai-agent",
        },
      });
      await prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { status: "waiting_parts" } });
      return { created: true, caseId: deal.id, status: "waiting_parts" };
    }),
});

export const getAvailableSlotsTool = tool({
  name: "get_available_slots",
  description: "Получить не более настроенного количества реальных свободных окон из YCLIENTS. Для комплексной услуги обязательно передай полную длительность; если запрошенный день занят, инструмент вернёт ближайшие следующие даты.",
  parameters: z.object({
    quoteId: z.string().nullable(),
    requestedDate: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).nullable().optional(),
    durationMinutes: z.number().int().min(10).max(480).nullable().optional(),
  }),
  ...commonToolGuardrails,
  execute: async ({ quoteId, requestedDate, durationMinutes }, context) =>
    withToolAudit(context, "get_available_slots", { quoteId, requestedDate, durationMinutes }, async () => {
      const ctx = requireContext(context);
      if (quoteId) {
        const quote = await prisma.aIServiceQuote.findFirst({ where: { id: quoteId, organizationId: ctx.organizationId, conversationId: ctx.conversationId } });
        if (!quote) throw new Error("Расчёт не найден в текущем диалоге");
        if (quote.status !== "accepted" && quote.status !== "approved" && quote.status !== "sent") throw new Error("Сначала нужен подтверждённый и выбранный клиентом расчёт");
        if (quote.validUntil && quote.validUntil <= new Date()) {
          await prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { status: "expired" } });
          throw new Error("Срок действия расчёта истёк — проверьте цену и наличие снова");
        }
      }
      const session = await prisma.aIAgentSession.findFirst({ where: { id: ctx.sessionId, organizationId: ctx.organizationId }, select: { collectedDataJson: true } });
      const conversationState = getConversationAgentState(session?.collectedDataJson);
      const fullDurationMinutes = durationMinutes ?? estimateConversationDurationMinutes(conversationState, ctx.settings.calculationRules.serviceDurationMinutes);
      const date = requestedDate ?? conversationState.requestedDate;
      const slots = await getYclientsAvailableSlots({
        limit: ctx.settings.slotSuggestionCount,
        minLeadMinutes: ctx.settings.minBookingLeadMinutes,
        horizonDays: ctx.settings.maxBookingHorizonDays,
        durationMinutes: fullDurationMinutes,
        baseServiceDurationMinutes: ctx.settings.calculationRules.serviceDurationMinutes,
        requestedDate: date,
      });
      const nextState = {
        ...conversationState,
        pendingQuestion: slots.length ? "slot_selection" as const : "slots" as const,
        pendingToolAction: "none" as const,
        requestedDate: date,
        slotSuggestions: slots.map(({ id, date: slotDate, time, address, durationMinutes: slotDuration }) => ({ id, date: slotDate, time, address, durationMinutes: slotDuration })),
        updatedAt: new Date().toISOString(),
      };
      const root = session?.collectedDataJson && typeof session.collectedDataJson === "object" && !Array.isArray(session.collectedDataJson)
        ? session.collectedDataJson as Record<string, unknown>
        : {};
      await prisma.aIAgentSession.update({ where: { id: ctx.sessionId }, data: { collectedDataJson: json(withConversationAgentState(root, nextState)), lastActivityAt: new Date() } });
      return { slots, source: "yclients", requestedDate: date, durationMinutes: fullDurationMinutes, checkedAt: new Date().toISOString() };
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
      const session = await prisma.aIAgentSession.findFirst({
        where: { id: ctx.sessionId, organizationId: ctx.organizationId },
        select: { collectedDataJson: true },
      });
      const conversationState = getConversationAgentState(session?.collectedDataJson);
      const requiredDurationMinutes = estimateConversationDurationMinutes(
        conversationState,
        ctx.settings.calculationRules.serviceDurationMinutes
      );
      const suggestedSlot = conversationState.slotSuggestions.find((item) => item.id === slotId);
      if (conversationState.activeServiceRequests.length > 1 && (!suggestedSlot || suggestedSlot.durationMinutes < requiredDurationMinutes)) {
        throw new Error("После добавления услуги нужно заново выбрать окно, проверенное по полной длительности комплекса");
      }
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
        data: {
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          quoteId,
          slotId,
          slotSnapshot: json({ ...slot, durationMinutes: suggestedSlot?.durationMinutes ?? requiredDurationMinutes }),
          expiresAt,
        },
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
    return !ctx || !ctx.settings.autoBookingEnabled || (ctx.mode !== "auto_booking_approval" && ctx.mode !== "autonomous");
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
      if (quote.status !== "accepted") throw new Error("Запись возможна только после подтверждённого сотрудником и выбранного клиентом расчёта");
      if (quote.validUntil && quote.validUntil <= new Date()) {
        await prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { status: "expired" } });
        throw new Error("Срок действия расчёта истёк — сначала обновите расчёт");
      }
      const consent = latestInbound?.text.trim().toLowerCase() || "";
      if (!/(^|\s)(да|подходит|записывайте|запишите|согласен|согласна)(\s|[!.?]|$)/i.test(consent) || /не\s+(надо|записывайте|подходит)/i.test(consent)) {
        throw new Error("В последнем сообщении клиента нет явного согласия на запись");
      }
      if (!conversation.client?.name || !conversation.client.phone) throw new Error("Для записи нужны имя и телефон привязанного клиента");
      const vehicle = conversation.selectedVehicle;
      if (!vehicle?.vin || !validVin(normalizeVin(vehicle.vin))) throw new Error("Перед окончательной записью нужен VIN автомобиля");
      const selected = record(quote.selectedOption);
      const selectedLines = Array.isArray(selected.lines) ? selected.lines.map(record) : [];
      const session = await prisma.aIAgentSession.findFirst({ where: { id: ctx.sessionId, organizationId: ctx.organizationId }, select: { collectedDataJson: true } });
      const appointmentDurationMinutes = Math.max(
        10,
        Number(selected.durationMinutes) || estimateConversationDurationMinutes(getConversationAgentState(session?.collectedDataJson), ctx.settings.calculationRules.serviceDurationMinutes)
      );
      const heldDurationMinutes = Number(record(hold.slotSnapshot).durationMinutes) || 0;
      if (heldDurationMinutes < appointmentDurationMinutes) {
        throw new Error("Выбранное окно рассчитано на меньшую длительность. Получите свободное время заново.");
      }
      const client = await prisma.localCounterparty.findFirst({ where: { id: conversation.client.id } });
      const organization = await prisma.localOrganization.findFirst({ where: { isActive: true, OR: [{ id: ctx.organizationId }, { isDefault: true }] }, orderBy: { isDefault: "desc" } });
      const store = organization
        ? await prisma.localStore.findFirst({ where: { archived: false, OR: [{ organizationId: organization.id }, { organizationId: null }] }, orderBy: { isMain: "desc" } })
        : null;
      if (!client || !organization || !store) throw new Error("Для записи не настроены клиент, организация или склад для черновика отгрузки");
      const appointment = await createYclientsAppointment({
        slotId,
        clientName: conversation.client.name,
        clientPhone: conversation.client.phone,
        durationMinutes: appointmentDurationMinutes,
        comment: [comment, vehicle ? `${vehicle.label}; VIN ${vehicle.vin || "не указан"}; госномер ${vehicle.plate || "не указан"}` : "", `Расчёт ИИ: ${quote.id}`, `Диалог: ${ctx.conversationId}`].filter(Boolean).join("\n"),
      });
      const commentText = [
        "Запись создана ИИ-агентом.",
        `Расчёт ${quote.id} подтверждён сотрудником ${quote.approvedById || "сотрудником"}.`,
        "Остаток масла после замены отдать клиенту, если используется фасовка.",
        comment,
      ].filter(Boolean).join(" ");
      let draftShipmentId: string | null = null;
      {
        const shipment = await createLocalDemand({
          organization: { meta: { href: `local://organization/${organization.id}`, type: "organization", mediaType: "application/json" } },
          agent: { meta: { href: `local://counterparty/${client.id}`, type: "agent", mediaType: "application/json" } },
          store: { meta: { href: `local://store/${store.id}`, type: "store", mediaType: "application/json" } },
          moment: appointment.datetime,
          applicable: false,
          description: `${commentText}\nЗапись: ${appointment.id}; диалог: ${ctx.conversationId}; VIN: ${normalizeVin(vehicle.vin)}`,
          positions: selectedLines
            .filter((line) => clean(line.productId))
            .map((line) => ({
              assortment: { meta: { href: `local://product/${clean(line.productId)}`, type: line.type === "work" ? "service" : "product", mediaType: "application/json" } },
              name: clean(line.name),
              quantity: Number(line.quantity) || 1,
              price: (Number(line.unitPriceCents) || 0) / 100,
            })),
        }, { ecoUserName: "ai-agent" });
        if (!shipment.ok) throw new Error(`Не удалось создать черновик отгрузки: ${shipment.error}`);
        draftShipmentId = shipment.id;
      }
      await prisma.$transaction([
        prisma.aIAgentSlotHold.update({ where: { id: hold.id }, data: { status: "converted", releasedAt: new Date() } }),
        prisma.aIServiceQuote.update({ where: { id: quote.id }, data: { appointmentId: appointment.id, draftShipmentId, status: draftShipmentId ? "converted_to_shipment" : "converted_to_appointment" } }),
        prisma.aIAgentSession.update({ where: { id: ctx.sessionId }, data: { appointmentId: appointment.id, quoteId: quote.id, shipmentId: draftShipmentId, status: "waiting_client", lastActivityAt: new Date() } }),
        prisma.messengerConversation.update({ where: { id: ctx.conversationId }, data: { relatedAppointmentId: appointment.id } }),
      ]);
      return { created: true, appointmentId: appointment.id, datetime: appointment.datetime, address: appointment.address, vehicle: vehicle?.label || null, quoteId: quote.id, draftShipmentId, internalComment: commentText };
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
      const requiresResearch = ["vehicle_ambiguous", "technical_conflict", "low_confidence", "nonstandard", "rossko_ambiguous"].includes(reasonCode);
      const agentSession = await prisma.aIAgentSession.findFirst({ where: { id: ctx.sessionId }, select: { collectedDataJson: true } });
      const currentState = getConversationAgentState(agentSession?.collectedDataJson);
      const mustCompleteComplexResearch = currentState.complexFluidRequest && !["complaint", "customer_request"].includes(reasonCode);
      if (requiresResearch || mustCompleteComplexResearch) {
        const attemptedResearch = await prisma.aIAgentToolCall.count({
          where: {
            organizationId: ctx.organizationId,
            runId: ctx.runId,
            status: { in: ["completed", "failed"] },
            toolName: { in: ["get_client_profile", "resolve_vehicle_by_vin", "resolve_vehicle_by_parameters", "get_transmission_requirements", "trusted_technical_web_search", "search_local_catalog", "rossko_search"] },
          },
        });
        if (!attemptedResearch) throw new Error("Перед технической передачей сотруднику нужно выполнить доступную проверку автомобиля или технических данных");
      }
      if (mustCompleteComplexResearch) {
        // A complex technical handoff is meaningful only after the agent has
        // both confirmed something and identified the exact unresolved item.
        // This prevents an ordinary "VIN is unavailable" reply from creating
        // a CRM case before the parameter flow and research have run.
        if (!currentState.confirmedItems.length || !currentState.unresolvedItems.length) {
          throw new Error("Передача сотруднику возможна после подтверждённых результатов поиска и фиксации конкретного спорного параметра");
        }
        const calls = await prisma.aIAgentToolCall.findMany({
          where: { organizationId: ctx.organizationId, runId: ctx.runId, status: { in: ["completed", "failed"] } },
          select: { toolName: true, argumentsMasked: true, resultSummary: true },
        });
        const names = new Set(calls.map((call) => call.toolName));
        const active = new Set(currentState.activeServiceRequests);
        const expectedAggregates = [
          ...(active.has("engine_oil_change") ? ["engine"] : []),
          ...(active.has("automatic_transmission_partial") || active.has("automatic_transmission_machine") ? ["automatic_transmission"] : []),
          ...(active.has("transfer_case_oil_change") ? ["transfer_case"] : []),
          ...(active.has("front_differential_oil_change") ? ["front_differential"] : []),
          ...(active.has("rear_differential_oil_change") ? ["rear_differential"] : []),
        ];
        const technicalCalls = calls.filter((call) => call.toolName === "trusted_technical_web_search");
        const searchedAggregates = new Set(technicalCalls.map((call) => clean(record(call.argumentsMasked).aggregate)));
        const missingWebChecks = expectedAggregates.filter((aggregate) => !searchedAggregates.has(aggregate));
        if (missingWebChecks.length) {
          throw new Error(`Для передачи сложного подбора сначала выполните web-проверку: ${missingWebChecks.join(", ")}`);
        }
        const technicalSourcesUnavailable = technicalCalls.some((call) => {
          const result = record(call.resultSummary);
          return /интернет-поиск|подтвержд[её]нных источников|недостающ[иея] технические данные/i.test(clean(result.reason));
        });
        if (!technicalSourcesUnavailable) {
          const requirements = new Set(calls
            .filter((call) => call.toolName === "get_transmission_requirements")
            .map((call) => clean(record(call.argumentsMasked).aggregate)));
          const requiredTransmission = expectedAggregates.filter((aggregate) => aggregate !== "engine");
          const missing = [
            ...(!names.has("get_client_profile") ? ["карточка клиента"] : []),
            ...(!names.has("get_engine_oil_requirements") && expectedAggregates.includes("engine") ? ["требования двигателя"] : []),
            ...requiredTransmission.filter((aggregate) => !requirements.has(aggregate)).map((aggregate) => `требования ${aggregate}`),
            ...(!names.has("find_required_parts") ? ["подбор фильтров"] : []),
            ...(!names.has("search_local_catalog") ? ["локальный каталог"] : []),
          ];
          if (missing.length) throw new Error(`Для передачи сложного подбора сначала выполните: ${missing.join(", ")}`);
        }
      }
      const conversation = await getConversationContext(ctx.conversationId);
      const branch = await prisma.branch.findFirst({
        where: {
          status: "active",
          OR: [{ id: ctx.organizationId }, { legacyOrganizationId: ctx.organizationId }],
        },
        select: { id: true },
      });
      if (!branch) throw new Error("Для организации AI-агента не настроен филиал");
      const products = productIds.length
        ? await prisma.localProduct.findMany({ where: { branchId: branch.id, id: { in: productIds } }, select: { id: true, name: true, article: true, salePriceCents: true } })
        : [];
      const handoff = await prisma.aIAgentHandoff.create({
        data: { organizationId: ctx.organizationId, runId: ctx.runId, conversationId: ctx.conversationId, reasonCode, reason, summary, collectedDataJson: json(collectedData), productsJson: json(products), quoteId },
      });
      const stage = await getFirstCrmStage(branch.id);
      if (!stage) throw new Error("Не найдена стадия CRM для передачи сотруднику");
      const unresolvedItemType = currentState.unresolvedItems[0] || reasonCode;
      const caseKey = `ai-review:${ctx.conversationId}:${ctx.runId}:${unresolvedItemType}`;
      const caseTitle = `Проверка агента: ${reason.slice(0, 120)}`;
      const caseRecord = await prisma.crmDeal.upsert({
        where: { branchId_caseKey: { branchId: branch.id, caseKey } },
        update: { notes: summary, nextAction: reason, nextActionAt: new Date(), nextContactAt: new Date(), status: "open" },
        create: {
          branchId: branch.id,
          organizationId: ctx.organizationId,
          title: caseTitle,
          customerName: conversation.client?.name || null,
          phoneNormalized: conversation.client?.phone || null,
          vehicle: conversation.selectedVehicle?.label || collectedData.vehicle || null,
          source: "ai-agent",
          clientType: "regular",
          nextAction: reason,
          stageId: stage.id,
          responsibleLogin: ctx.actorId.startsWith("system:") ? null : ctx.actorId,
          conversationId: ctx.conversationId,
          caseStatus: "calculation_needed",
          caseType: "message",
          caseKey,
          priority: 80,
          notes: summary,
          nextActionAt: new Date(),
          nextContactAt: new Date(),
          createdByLogin: "ai-agent",
        },
      });
      await prisma.clientCaseEvent.create({
        data: { caseId: caseRecord.id, actorLogin: "ai-agent", eventType: "ai_handoff", title: "Требуется проверка сотрудником", note: summary, metadata: json({ handoffId: handoff.id, reasonCode, collectedData, quoteId }) },
      });
      const root = agentSession?.collectedDataJson && typeof agentSession.collectedDataJson === "object" && !Array.isArray(agentSession.collectedDataJson)
        ? agentSession.collectedDataJson as Record<string, unknown>
        : {};
      await prisma.aIAgentSession.update({
        where: { id: ctx.sessionId },
        data: {
          status: "handoff",
          collectedDataJson: json(withConversationAgentState({ ...root, handoffCollectedData: collectedData }, { ...currentState, quoteId: quoteId || currentState.quoteId, awaitingHumanApproval: true, awaitingTechnicalResearch: false, pendingToolAction: "none", updatedAt: new Date().toISOString() })),
          quoteId,
          lastActivityAt: new Date(),
        },
      });
      return { handedOff: true, handoffId: handoff.id, caseId: caseRecord.id, status: "queued", customerMessage: "Передал ваш вопрос сотруднику — он проверит данные и ответит в этом чате." };
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
      if (!ctx.settings.internetSearchEnabled) {
        return { enabled: false, facts: [], needsHumanReview: true, reason: "Интернет-поиск отключён в настройках организации." };
      }
      const availability = technicalWebSearchAvailability();
      return { enabled: availability.responsesApi || availability.internalProvider, facts: [], needsHumanReview: true, reason: availability.responsesApi || availability.internalProvider ? "Для этого факта не найден подтверждённый источник после попытки web search." : "Интернет-поиск не подключён или завершился ошибкой.", trustedDomains: ctx.settings.trustedDomains };
    }),
});

export const tgmClientAgentTools = [
  getClientProfileTool,
  resolveVehicleByVinTool,
  saveVehicleTool,
  resolveVehicleByParametersTool,
  trustedTechnicalWebSearchTool,
  getEngineOilRequirementsTool,
  getTransmissionRequirementsTool,
  findRequiredPartsTool,
  searchLocalCatalogTool,
  searchCompatibleOilTool,
  rosskoSearchTool,
  calculateServiceQuoteTool,
  requestQuoteApprovalTool,
  selectQuoteOptionTool,
  createClientCaseTool,
  getAvailableSlotsTool,
  holdAppointmentSlotTool,
  createAppointmentTool,
  handoffToHumanTool,
  trustedVehicleWebSearchTool,
];
