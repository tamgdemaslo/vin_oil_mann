import evidence from "../../data/mann-partner-tepee-model-evidence-v1.json";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-normalization";
import type { MannFluidRequirementForMatch } from "@/lib/mann-fluid-matcher-v2";
import type { MannResolverTestRow } from "@/lib/mann-vehicle-resolver";

/** Configuration evidence only: never a global Tepee/van synonym or fluid approval. */
export function hasReviewedMannModelScope(source: MannFluidRequirementForMatch, row: MannResolverTestRow): boolean {
  if (source.id !== evidence.sourceRequirementId || row.vehicleVariantKey !== evidence.vehicleVariantKey) return false;
  if (source.systemCode !== "ENGINE_OIL" || normalizeVehicleMake(source.make) !== "PEUGEOT" || normalizeVehicleMake(row.make) !== "PEUGEOT") return false;
  if (normalizeVehicleModel(source.model, "PEUGEOT").canonical !== "PARTNER TEPEE" || source.generation !== "II" || row.model !== "Partner II") return false;
  // Require the explicitly narrowed source branch; the original multi-engine
  // row is not itself eligible, even though its source id is known.
  if (!Array.isArray(source.engineCodesJson) || source.engineCodesJson.length !== 1 || normalizeEngineCode(source.engineCodesJson[0]) !== "TU5JP4B") return false;
  if (normalizeEngineCode(source.engineCodeNormalized) !== "TU5JP4B" || row.engineCode !== "TU5JP4B") return false;
  if (source.powerHp !== 90 || (source.powerKw != null && source.powerKw !== 66) || Number(row.hp) !== 90 || Number(row.kw) !== 66) return false;
  if (source.fuelType !== "gasoline" || source.engineVolumeCc !== 1600) return false;
  if (row.vehicleYears !== "04/08 ->" || (row.effectiveVehicleText ?? row.vehicleText) !== "1.6") return false;
  if (!Number.isInteger(source.yearFrom) || !Number.isInteger(source.yearTo)) return false;
  return source.yearFrom! >= 2012 && source.yearTo! <= 2014 && source.yearFrom! <= source.yearTo!;
}
