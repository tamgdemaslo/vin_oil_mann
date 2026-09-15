import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity-client";
import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import { mergeVehicleMarketEvidence } from "@/lib/vehicle-market";
import { consistentVehicleProductionMonth } from "@/lib/vehicle-production-month";

type Details = Pick<MannTechnicalVehicleContext, "transmissionModel" | "transmissionGearCount" | "productionMonth" | "confirmedEquipment" | "rearAirConditioning">;

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
    productionMonth: details.productionMonth ?? consistentVehicleProductionMonth([vehicle.productionMonth], vehicle.year),
    confirmedEquipment: details.confirmedEquipment,
    rearAirConditioning: details.rearAirConditioning,
    // Old cached/manual identities without complete market evidence stay unknown.
    // Recompute from labels; do not trust the cached derived confirmation flag.
    confirmedMarket: vehicle.marketEvidence?.values?.length
      ? mergeVehicleMarketEvidence(vehicle).confirmedMarket : undefined,
  };
}
