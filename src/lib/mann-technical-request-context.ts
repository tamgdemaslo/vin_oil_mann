import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity-client";
import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import { isVehicleDestinationMarket, mergeVehicleMarketEvidence, resolveVehicleMarket } from "@/lib/vehicle-market";
import { consistentVehicleProductionMonth } from "@/lib/vehicle-production-month";
import type { MannVehicleCandidate } from "@/lib/mann-vehicle-resolver";

export type MannTechnicalContextDetails = Pick<MannTechnicalVehicleContext, "transmissionModel" | "transmissionGearCount" | "productionMonth" | "confirmedEquipment" | "rearAirConditioning" | "confirmedDrive" | "confirmedMarket"> & { confirmedEngineCode?: string; marketClarification?: { sourceLabels: string[]; evidenceReference: string } };

export function unsupportedVehicleMarketLabels(vehicle: NormalizedVehicleIdentity): string[] {
  const labels = mergeVehicleMarketEvidence(vehicle).values;
  // A known label mixed with another value is a conflict, not an unknown market.
  return labels.length && labels.every(label => !resolveVehicleMarket([label]).confirmedMarket) ? labels : [];
}

function clarifiedMarket(vehicle: NormalizedVehicleIdentity, details: MannTechnicalContextDetails) {
  const labels = unsupportedVehicleMarketLabels(vehicle), proof = details.marketClarification;
  if (!labels.length || !proof || !isVehicleDestinationMarket(details.confirmedMarket)) return undefined;
  if (proof.evidenceReference.trim().length < 8 || proof.evidenceReference.length > 500) return undefined;
  if (JSON.stringify([...labels].sort()) !== JSON.stringify([...proof.sourceLabels].sort())) return undefined;
  return details.confirmedMarket;
}

/** A manual destination fills missing evidence; it cannot override conflicting labels. */
export function canConfirmVehicleDestinationMarket(vehicle: NormalizedVehicleIdentity): boolean {
  return !vehicle.market?.trim() && !vehicle.marketEvidence?.values?.some(value => value.trim());
}

/** Build each request afresh from its selected vehicle; never reuse market state. */
export function mannTechnicalContextFromVehicle(vehicle: NormalizedVehicleIdentity, details: MannTechnicalContextDetails = {}, confirmedCandidate?: MannVehicleCandidate): MannTechnicalVehicleContext {
  // Fill absent identity only from a confirmed, non-conflicting candidate.
  // Keep the decoded vehicle and its provenance unchanged outside this request.
  const selected = confirmedCandidate?.mismatchedFields?.length === 0 ? confirmedCandidate.technicalIdentity : undefined;
  const confirmedEngine = details.confirmedEngineCode && selected?.engineOptions?.includes(details.confirmedEngineCode)
    ? details.confirmedEngineCode : undefined;
  return {
    make: vehicle.makeRaw ?? vehicle.makeCanonical,
    model: vehicle.modelRaw ?? vehicle.modelCanonical,
    generation: vehicle.generationRaw ?? vehicle.generationCanonical ?? selected?.generation,
    engineCode: vehicle.engineCode ?? selected?.engineCode ?? confirmedEngine,
    year: vehicle.year,
    transmissionModel: details.transmissionModel,
    transmissionGearCount: details.transmissionGearCount,
    productionMonth: details.productionMonth ?? consistentVehicleProductionMonth([vehicle.productionMonth], vehicle.year),
    confirmedEquipment: details.confirmedEquipment,
    rearAirConditioning: details.rearAirConditioning,
    confirmedDrive: details.confirmedDrive,
    // Recompute from labels; never trust a cached derived confirmation flag.
    // Explicit user input fills absence only, not an existing or disputed market.
    confirmedMarket: vehicle.marketEvidence?.values?.length
      ? mergeVehicleMarketEvidence(vehicle).confirmedMarket ?? clarifiedMarket(vehicle, details)
      : canConfirmVehicleDestinationMarket(vehicle) && isVehicleDestinationMarket(details.confirmedMarket)
        ? details.confirmedMarket : clarifiedMarket(vehicle, details),
  };
}
