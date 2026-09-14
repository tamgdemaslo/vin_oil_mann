import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity-client";
import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import { mergeVehicleMarketEvidence } from "@/lib/vehicle-market";

type Details = Pick<MannTechnicalVehicleContext, "transmissionModel" | "transmissionGearCount" | "productionMonth" | "confirmedEquipment">;

/** Build each request afresh from its selected vehicle; never reuse market state. */
export function mannTechnicalContextFromVehicle(vehicle: NormalizedVehicleIdentity, details: Details = {}): MannTechnicalVehicleContext {
  return {
    make: vehicle.makeRaw ?? vehicle.makeCanonical,
    model: vehicle.modelRaw ?? vehicle.modelCanonical,
    generation: vehicle.generationRaw ?? vehicle.generationCanonical,
    engineCode: vehicle.engineCode,
    year: vehicle.year,
    transmissionModel: details.transmissionModel,
    transmissionGearCount: details.transmissionGearCount,
    productionMonth: details.productionMonth,
    confirmedEquipment: details.confirmedEquipment,
    // Old cached/manual identities without complete market evidence stay unknown.
    // Recompute from labels; do not trust the cached derived confirmation flag.
    confirmedMarket: vehicle.marketEvidence?.values?.length
      ? mergeVehicleMarketEvidence(vehicle).confirmedMarket : undefined,
  };
}
