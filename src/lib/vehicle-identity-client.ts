export type VehicleLookupInputType = "vin" | "plate" | "frame";
export type VehicleSourceMethod = "tronk_vindecode" | "tronk_vindecode2" | "tronk_plate" | "tronk_frame" | "tronk_convertb2b" | "tronk_convertgate" | "manual" | "mann_manual";
export type VinStatus = "valid" | "check_digit_absent" | "format_warning" | "invalid" | "frame_number" | "unknown";
export type VehicleDecodeQualityStatus = "complete" | "partial" | "insufficient";
export type VehicleDecodeFailureCode = "INVALID_INPUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_NO_DATA" | "VIN_NOT_RESOLVED" | "VIN_DECODE_FAILED" | "DECODE_MISSING_MAKE" | "DECODE_MISSING_MODEL" | "DECODE_INSUFFICIENT_CHARACTERISTICS" | "UNSUPPORTED_VEHICLE" | "FRAME_NUMBER" | "UNKNOWN";

export type NormalizedVehicleIdentity = {
  vin?: string;
  frameNumber?: string;
  licensePlate?: string;
  makeRaw?: string;
  makeCanonical?: string;
  modelRaw?: string;
  modelCanonical?: string;
  generationRaw?: string;
  generationCanonical?: string;
  bodyName?: string;
  bodyCode?: string;
  bodyType?: string;
  year?: number;
  modelYearFrom?: number;
  modelYearTo?: number;
  engineName?: string;
  engineCode?: string;
  engineSeries?: string;
  engineVolumeLiters?: number;
  engineVolumeCc?: number;
  powerHp?: number;
  powerPs?: number;
  powerKw?: number;
  fuelType?: string;
  transmissionType?: string;
  transmissionName?: string;
  driveType?: string;
  steeringPosition?: string;
  market?: string;
  countryOfOrigin?: string;
  mileage?: number;
  ownersCount?: number;
  sourceMethods: VehicleSourceMethod[];
  confidence: "high" | "medium" | "low";
  rawResultIds: string[];
  vinStatus: VinStatus;
};

export type VehicleLookupCandidate = {
  key: string;
  vehicle: NormalizedVehicleIdentity;
  differences: string[];
};

export type VehicleLookupResult = {
  status: "found" | "not_found" | "frame_number" | "unavailable";
  vehicle: NormalizedVehicleIdentity | null;
  candidates: VehicleLookupCandidate[];
  message?: string;
  fromCache: boolean;
  cacheIds: string[];
  sourceMethods: VehicleSourceMethod[];
  diagnostics: {
    decision: "PRIMARY_COMPLETE" | "PRIMARY_PARTIAL" | "FALLBACK_COMPLETE" | "FALLBACK_PARTIAL" | "FAILED";
    quality: { status: VehicleDecodeQualityStatus; score: number; present: string[]; missing: string[] };
    failureCode?: VehicleDecodeFailureCode;
    fallbackUsed: boolean;
    attempts: Array<{ method: "vindecode" | "vindecode2" | "number2vin" | "frameapi" | "convertb2b" | "convertgate"; ok: boolean; fromCache: boolean; durationMs: number; failureCode?: VehicleDecodeFailureCode }>;
  };
};

export function vehicleFieldValues(vehicle: NormalizedVehicleIdentity): Partial<Record<string, { value: string; source: VehicleSourceMethod }>> {
  const source = vehicle.sourceMethods[0] ?? "manual";
  return {
    "vin номер": vehicle.vin ? { value: vehicle.vin, source } : undefined,
    "гос. номер": vehicle.licensePlate ? { value: vehicle.licensePlate, source } : undefined,
    "модель авто": [vehicle.makeRaw, vehicle.modelRaw].filter(Boolean).join(" ") ? { value: [vehicle.makeRaw, vehicle.modelRaw].filter(Boolean).join(" "), source } : undefined,
    "год": vehicle.year ? { value: String(vehicle.year), source } : undefined,
    "двигатель": [vehicle.engineCode, vehicle.engineName].filter(Boolean).join(" · ") ? { value: [vehicle.engineCode, vehicle.engineName].filter(Boolean).join(" · "), source } : undefined,
    "объем двигателя": vehicle.engineVolumeLiters ? { value: `${vehicle.engineVolumeLiters} л`, source } : undefined,
    "мощность": vehicle.powerHp ? { value: `${vehicle.powerHp} л.с.`, source } : undefined,
    "коробка": [vehicle.transmissionType, vehicle.transmissionName].filter(Boolean).join(" · ") ? { value: [vehicle.transmissionType, vehicle.transmissionName].filter(Boolean).join(" · "), source } : undefined,
    "привод": vehicle.driveType ? { value: vehicle.driveType, source } : undefined,
  };
}
