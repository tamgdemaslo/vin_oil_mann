import { normalizeVehicleModel } from "@/lib/vehicle-normalization";
import { resolveMannVehicle, type MannVehicleResolution } from "@/lib/mann-vehicle-resolver";
import { getMannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { assistantMemo } from "./execution";
import type { QuoteAndTechCardInput, VerifiedTechnicalFact } from "./quote-and-tech-card";

export function mannContext(organizationId: string, vehicle: NormalizedVehicleIdentity) {
  return assistantMemo("mann-context", { organizationId, branchId: getScopedBranchId(), vehicle }, async () => {
    const resolution = await resolveMannVehicle({ organizationId, vehicle });
    const keys = resolution.status === "resolved" ? resolution.selectedApplication?.variantIds ?? [] : [];
    const profile = await getMannUnifiedTechnicalProfile(keys);
    return { resolution, profile };
  });
}

export function mannResolutionDiagnostic(resolution: MannVehicleResolution) {
  const candidates = resolution.candidates.slice(0, 3).map(candidate => ({
    model: candidate.model, vehicleText: candidate.effectiveVehicleText ?? candidate.vehicleText,
    confidence: candidate.confidence, matchedFields: candidate.matchedFields,
    mismatchedFields: candidate.mismatchedFields, missingFields: candidate.missingFields,
  }));
  const confirmationRequired = resolution.status !== "resolved" && candidates.some(candidate => candidate.confidence === "high" && candidate.mismatchedFields.length === 0);
  const code = resolution.status === "resolved" ? "MANN_VARIANT_CONFIRMED" : confirmationRequired ? "MANN_CONFIRMATION_REQUIRED" : candidates.length ? "MANN_VARIANT_AMBIGUOUS" : "MANN_NO_VARIANT";
  const message = resolution.status === "resolved" ? "Модификация MANN подтверждена."
    : confirmationRequired ? "В MANN найден подходящий кандидат, но связь с автомобилем ещё не подтверждена в каталоге. Подбор фильтра не завершён."
    : candidates.length ? "В MANN есть кандидаты с неоднозначными характеристиками. Модификация для подбора фильтра не подтверждена."
    : "В локальном MANN не найдена модификация по переданным характеристикам. Подбор фильтра не завершён.";
  return { code, message, status: resolution.status, decision: resolution.decision, candidates };
}
/** A decoder's missing fields must not erase supplied catalogue attributes. */
export function mergeAssistantVehicleSnapshot(submitted: Record<string, unknown>, verified?: Record<string, unknown> | null, requested: Record<string, unknown> = {}) {
  return { ...submitted, ...requested, ...Object.fromEntries(Object.entries(verified ?? {}).filter(([, value]) => value != null && (typeof value !== "string" || value.trim() !== ""))),
    // The request was checked against the decoder before the model loop. Its
    // full catalogue label keeps generation/platform details a bare VIN model
    // label would erase; this does not confirm technical service facts.
    ...(requested.modelRaw ? { modelRaw: requested.modelRaw } : {}) };
}
export function assistantVehicle(snapshot: Record<string, unknown>): NormalizedVehicleIdentity {
  // A richer model label can carry the generation, but cannot replace a
  // conflicting decoder model. Use the existing canonical normaliser.
  const make = String(snapshot.makeCanonical ?? snapshot.make ?? snapshot.makeRaw ?? "");
  const canonicalModel = String(snapshot.modelCanonical ?? snapshot.model ?? snapshot.modelRaw ?? "");
  const rawModel = String(snapshot.modelRaw ?? snapshot.model ?? canonicalModel);
  const sameModel = normalizeVehicleModel(rawModel, make).canonical === normalizeVehicleModel(canonicalModel, make).canonical;
  // Reuse resolver normalisation; a model-supplied variant key is never selection.
  return {
    ...Object.fromEntries(Object.entries(snapshot).filter(([key]) => ["vin", "makeCanonical", "modelCanonical", "generationCanonical", "generationRaw", "bodyCode", "bodyName", "engineCode", "engineSeries", "engineVolumeLiters", "engineVolumeCc", "powerHp", "powerKw", "powerPs", "fuelType", "transmissionType", "transmissionName", "driveType", "market"].includes(key))),
    makeRaw: make,
    modelRaw: sameModel ? rawModel : canonicalModel,
    year: typeof snapshot.year === "number" ? snapshot.year : undefined,
    sourceMethods: [], rawResultIds: [], vinStatus: "unknown", confidence: "medium",
  } as NormalizedVehicleIdentity;
}
export const technicalSystems: Record<string, string> = { engine_oil: "ENGINE_OIL", automatic_transmission: "AUTOMATIC_TRANSMISSION", cvt: "CVT_TRANSMISSION", dsg: "ROBOT_TRANSMISSION", manual_transmission: "MANUAL_TRANSMISSION", transfer_case: "TRANSFER_CASE", awd_clutch: "AWD_COUPLING", coolant: "ENGINE_COOLANT", brake_fluid: "BRAKE_FLUID" };
export async function verifiedLocalTechnicalInput(input: QuoteAndTechCardInput, organizationId: string) {
  const result = await mannContext(organizationId, assistantVehicle(input.vehicle.snapshot ?? {}));
  const facts: VerifiedTechnicalFact[] = [];
  const service = { ...input.service };
  // Preview, staged, mixed or unreviewed data is available to an employee but
  // cannot confirm an operational fact. Never guess front versus rear axle.
  if (result.profile.status !== "active" || result.resolution.status !== "resolved") return { input, facts, ...result };
  const matches = result.profile.items.filter(item => item.systemCode === technicalSystems[service.type] && item.sourceStatus === "primary_source" && !item.requiresReview);
  if (matches.length !== 1) return { input, facts, ...result };
  const item = matches[0];
  const aggregate = input.vehicle.aggregateCode || service.aggregate || (service.type === "engine_oil" ? String(input.vehicle.snapshot?.engineCode ?? "") : null) || item.componentModel || null;
  if (item.componentModel && (!aggregate || aggregate.toUpperCase() !== item.componentModel.toUpperCase())) return { input, facts, ...result };
  const source = item.evidence[0];
  if (!source) return { input, facts, ...result };
  const base = { source: `${source.publisher ?? source.title ?? "MANN technical profile"} · ${item.revisionId}`, url: source.url ?? null, vehicleVariantKey: result.resolution.selectedApplication!.variantIds.join(","), aggregate: aggregate ?? null };
  const spec = [...item.specifications, ...item.viscosityGrades].join("; ");
  // The applicable reviewed profile supplies the requirement. A model's
  // explanatory suffix must not prevent that requirement reaching pricing.
  if (spec) {
    if (service.requiredFluidSpec && service.requiredFluidSpec !== spec) service.technicalWarnings = [...(service.technicalWarnings ?? []), `Спецификация уточнена по применимому техническому профилю: ${spec}.`].slice(0, 16);
    service.requiredFluidSpec = spec;
    facts.push({ ...base, field: "specification", value: spec });
  }
  type CapacityKey = "totalTechnicalQuantityLiters" | "partialTechnicalQuantityLiters" | "standardTechnicalQuantityLiters" | "filterServiceTechnicalQuantityLiters";
  const capacities = new Map<CapacityKey, Set<number>>();
  const automatic = ["automatic_transmission", "cvt", "dsg"].includes(service.type);
  for (const capacity of item.capacities) {
    if (!capacity.nominalLiters || !capacity.serviceContext) continue;
    const key: CapacityKey | null = capacity.serviceContext === "TOTAL" ? "totalTechnicalQuantityLiters"
      : capacity.serviceContext === "PARTIAL" || (automatic && capacity.serviceContext === "WITHOUT_FILTER") ? "partialTechnicalQuantityLiters"
      : automatic && capacity.serviceContext === "WITH_FILTER" ? "filterServiceTechnicalQuantityLiters"
      : ["SERVICE", "WITH_FILTER"].includes(capacity.serviceContext) && service.type === "engine_oil" ? "standardTechnicalQuantityLiters" : null;
    if (!key) continue;
    const values = capacities.get(key) ?? new Set<number>();
    values.add(capacity.nominalLiters);
    capacities.set(key, values);
  }
  for (const [key, values] of capacities) {
    // Conflicting rows cannot silently become a first-row-wins assignment.
    if (values.size !== 1) continue;
    const value = [...values][0];
    service[key] = value;
    const procedures = key === "totalTechnicalQuantityLiters" ? ["machine", "machine_filter_service"] : key === "partialTechnicalQuantityLiters" ? ["partial"] : key === "filterServiceTechnicalQuantityLiters" ? ["filter_service"] : ["standard"];
    for (const procedure of procedures) facts.push({ ...base, field: "capacity", value, procedure });
  }
  return { input: { ...input, vehicle: { ...input.vehicle, aggregateCode: aggregate }, service: { ...service, aggregate } }, facts, ...result };
}
