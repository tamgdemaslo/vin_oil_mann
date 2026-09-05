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
  const body = [vehicle.bodyName, vehicle.bodyCode, vehicle.bodyType].filter(Boolean).join(" · ");
  return {
    "vin номер": vehicle.vin ? { value: vehicle.vin, source } : undefined,
    "гос. номер": vehicle.licensePlate ? { value: vehicle.licensePlate, source } : undefined,
    "модель авто": [vehicle.makeRaw, vehicle.modelRaw].filter(Boolean).join(" ") ? { value: [vehicle.makeRaw, vehicle.modelRaw].filter(Boolean).join(" "), source } : undefined,
    "марка": (vehicle.makeRaw ?? vehicle.makeCanonical) ? { value: vehicle.makeRaw ?? vehicle.makeCanonical!, source } : undefined,
    "модель": (vehicle.modelRaw ?? vehicle.modelCanonical) ? { value: vehicle.modelRaw ?? vehicle.modelCanonical!, source } : undefined,
    "год": vehicle.year ? { value: String(vehicle.year), source } : undefined,
    "поколение": (vehicle.generationRaw ?? vehicle.generationCanonical) ? { value: vehicle.generationRaw ?? vehicle.generationCanonical!, source } : undefined,
    "кузов": body ? { value: body, source } : undefined,
    "код кузова": vehicle.bodyCode ? { value: vehicle.bodyCode, source } : undefined,
    "тип кузова": vehicle.bodyType ? { value: vehicle.bodyType, source } : undefined,
    "номер кузова": vehicle.frameNumber ? { value: vehicle.frameNumber, source } : undefined,
    "двигатель": [vehicle.engineCode, vehicle.engineName].filter(Boolean).join(" · ") ? { value: [vehicle.engineCode, vehicle.engineName].filter(Boolean).join(" · "), source } : undefined,
    "код двигателя": vehicle.engineCode ? { value: vehicle.engineCode, source } : undefined,
    "объем двигателя": vehicle.engineVolumeLiters ? { value: `${vehicle.engineVolumeLiters} л`, source } : undefined,
    "мощность": vehicle.powerHp ? { value: `${vehicle.powerHp} л.с.`, source } : undefined,
    "мощность квт": vehicle.powerKw ? { value: `${vehicle.powerKw} кВт`, source } : undefined,
    "топливо": vehicle.fuelType ? { value: vehicle.fuelType, source } : undefined,
    "коробка": [vehicle.transmissionType, vehicle.transmissionName].filter(Boolean).join(" · ") ? { value: [vehicle.transmissionType, vehicle.transmissionName].filter(Boolean).join(" · "), source } : undefined,
    "привод": vehicle.driveType ? { value: vehicle.driveType, source } : undefined,
    "руль": vehicle.steeringPosition ? { value: vehicle.steeringPosition, source } : undefined,
    "рынок": vehicle.market ? { value: vehicle.market, source } : undefined,
    "страна сборки": vehicle.countryOfOrigin ? { value: vehicle.countryOfOrigin, source } : undefined,
    "пробег": vehicle.mileage != null ? { value: String(Math.round(vehicle.mileage)), source } : undefined,
    "владельцев": vehicle.ownersCount != null ? { value: String(Math.round(vehicle.ownersCount)), source } : undefined,
  };
}
