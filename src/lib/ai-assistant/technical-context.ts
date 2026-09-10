import { resolveMannVehicle } from "@/lib/mann-vehicle-resolver";
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
export function assistantVehicle(snapshot: Record<string, unknown>): NormalizedVehicleIdentity {
  // Reuse resolver normalisation; a model-supplied variant key is never selection.
  return {
    ...Object.fromEntries(Object.entries(snapshot).filter(([key]) => ["vin", "makeCanonical", "modelCanonical", "generationCanonical", "bodyCode", "engineCode", "engineSeries", "engineVolumeLiters", "engineVolumeCc", "powerHp", "powerKw", "fuelType", "transmissionType", "transmissionName", "driveType", "market"].includes(key))),
    makeRaw: String(snapshot.makeCanonical ?? snapshot.make ?? snapshot.makeRaw ?? ""),
    modelRaw: String(snapshot.modelCanonical ?? snapshot.model ?? snapshot.modelRaw ?? ""),
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
  const aggregate = input.vehicle.aggregateCode ?? service.aggregate ?? (service.type === "engine_oil" ? String(input.vehicle.snapshot?.engineCode ?? "") : null);
  if (item.componentModel && (!aggregate || aggregate.toUpperCase() !== item.componentModel.toUpperCase())) return { input, facts, ...result };
  const source = item.evidence[0];
  if (!source) return { input, facts, ...result };
  const base = { source: `${source.publisher ?? source.title ?? "MANN technical profile"} · ${item.revisionId}`, url: source.url ?? null, vehicleVariantKey: result.resolution.selectedApplication!.variantIds.join(","), aggregate: aggregate ?? null };
  const spec = [...item.specifications, ...item.viscosityGrades].join("; ");
  if (spec && (!service.requiredFluidSpec || service.requiredFluidSpec === spec)) { service.requiredFluidSpec = spec; facts.push({ ...base, field: "specification", value: spec }); }
  for (const capacity of item.capacities) {
    if (!capacity.nominalLiters || !capacity.serviceContext) continue;
    const key = capacity.serviceContext === "TOTAL" ? "totalTechnicalQuantityLiters" : capacity.serviceContext === "PARTIAL" ? "partialTechnicalQuantityLiters" : ["SERVICE", "WITH_FILTER"].includes(capacity.serviceContext) && service.type === "engine_oil" ? "standardTechnicalQuantityLiters" : null;
    if (!key || (service[key] != null && service[key] !== capacity.nominalLiters)) continue;
    service[key] = capacity.nominalLiters;
    const procedure = key === "totalTechnicalQuantityLiters" ? "machine" : key === "partialTechnicalQuantityLiters" ? "partial" : "standard";
    facts.push({ ...base, field: "capacity", value: capacity.nominalLiters, procedure });
  }
  return { input: { ...input, service }, facts, ...result };
}
