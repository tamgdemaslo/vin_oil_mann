import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity";
import { normalizeEngineCode } from "@/lib/vehicle-normalization";

// Manufacturer type codes, not VIN serial numbers. Keep this crosswalk scoped
// to published evidence; an unsupported type leaves the provider result alone.
// Hengst: C 200 Kompressor (203.045), M 111.955, 2.0 l, 120 kW.
// https://catalog.hengst.com/en/online-catalog/product/7835310000-01/de/
const TYPES: Record<string, { engine: string; modification: string; cc: number; kw: number }> = {
  "203045": { engine: "M111.955", modification: "C 200 Kompressor (203.045)", cc: 1998, kw: 120 },
};

export function selectMercedesVinType(vin: string, vehicles: NormalizedVehicleIdentity[]): NormalizedVehicleIdentity[] {
  if (!/^WDB[A-HJ-NPR-Z0-9]{14}$/.test(vin)) return vehicles;
  const type = TYPES[vin.slice(3, 9)];
  if (!type) return vehicles;
  const matches = vehicles.filter(v => v.makeCanonical === "MERCEDES"
    && /W203/i.test(v.bodyName ?? v.bodyCode ?? "")
    && normalizeEngineCode(v.engineCode ?? v.engineSeries) === type.engine
    && (v.engineVolumeCc == null || Math.abs(v.engineVolumeCc - type.cc) < 10)
    && (v.powerKw == null || Math.abs(v.powerKw - type.kw) < 1));
  // Never manufacture a vehicle from the crosswalk or choose between
  // contradictory reports. The provider must return one matching engine.
  if (matches.length !== 1) return vehicles;
  return [{ ...matches[0], engineCode: type.engine, modificationName: type.modification,
    identificationNote: "Модификация уточнена по коду типа 203.045 в VIN и двигателю в ответе TRONK (каталог Hengst)." }];
}
