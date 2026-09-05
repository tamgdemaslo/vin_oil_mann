import type { NormalizedVehicleIdentity, VehicleSourceMethod } from "@/lib/vehicle-identity";

export const CLIENT_VEHICLE_VERIFICATION_STATUSES = ["LEGACY", "AUTO_FILLED", "CONFIRMED", "NEEDS_REVIEW"] as const;
export type ClientVehicleVerificationStatus = typeof CLIENT_VEHICLE_VERIFICATION_STATUSES[number];
export type ClientVehicleWriteMode = "auto" | "confirmed";

export const CLIENT_VEHICLE_PASSPORT_FIELDS = [
  "make",
  "makeCanonical",
  "model",
  "modelCanonical",
  "generation",
  "generationCanonical",
  "year",
  "modelYearFrom",
  "modelYearTo",
  "plate",
  "vin",
  "frameNumber",
  "bodyName",
  "bodyCode",
  "bodyType",
  "engineName",
  "engineCode",
  "engineSeries",
  "engineVolumeCc",
  "powerHp",
  "powerKw",
  "fuelType",
  "transmissionType",
  "transmissionName",
  "driveType",
  "steeringPosition",
  "market",
  "countryOfOrigin",
  "mileage",
  "ownersCount",
] as const;

export type ClientVehiclePassportField = typeof CLIENT_VEHICLE_PASSPORT_FIELDS[number];
export type ClientVehiclePassportValues = Partial<Record<ClientVehiclePassportField, string | number | null>>;

export type ClientVehicleFieldSource = {
  source: VehicleSourceMethod | "vehicle_card" | string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  verificationStatus: ClientVehicleVerificationStatus;
  updatedAt: string;
  updatedBy?: string;
};

export type ClientVehicleProfile = ClientVehiclePassportValues & {
  id: string;
  branchId: string;
  counterpartyId: string;
  mannVariantIds: string[];
  fieldSources: Partial<Record<ClientVehiclePassportField, ClientVehicleFieldSource>>;
  sourceSnapshot?: Record<string, unknown> | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  verificationStatus: ClientVehicleVerificationStatus;
  lastVerifiedAt?: string | null;
  lastVerifiedBy?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientVehicleProfileWrite = {
  values: ClientVehiclePassportValues;
  source: VehicleSourceMethod | "vehicle_card" | string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  sourceSnapshot?: Record<string, unknown> | null;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result || null;
}

function positiveInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = Number(String(value).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(result) && result > 0 ? Math.round(result) : null;
}

function nonNegativeInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = Number(String(value).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(result) && result >= 0 ? Math.round(result) : null;
}

function validYear(value: unknown): number | null {
  const year = positiveInteger(value);
  return year != null && year >= 1886 && year <= 2200 ? year : null;
}

function volumeCc(vehicle: Partial<NormalizedVehicleIdentity>): number | null {
  const cc = positiveInteger(vehicle.engineVolumeCc);
  if (cc) return cc;
  const liters = Number(vehicle.engineVolumeLiters);
  return Number.isFinite(liters) && liters > 0 ? Math.round(liters * 1000) : null;
}

export function vehicleIdentityToProfileWrite(vehicle: Partial<NormalizedVehicleIdentity>): ClientVehicleProfileWrite {
  const source = vehicle.sourceMethods?.[0] ?? "manual";
  const confidence = vehicle.confidence === "high" ? "HIGH" : vehicle.confidence === "medium" ? "MEDIUM" : "LOW";
  return {
    source,
    confidence,
    sourceSnapshot: vehicle as Record<string, unknown>,
    values: {
      make: text(vehicle.makeRaw ?? vehicle.makeCanonical),
      makeCanonical: text(vehicle.makeCanonical),
      model: text(vehicle.modelRaw ?? vehicle.modelCanonical),
      modelCanonical: text(vehicle.modelCanonical),
      generation: text(vehicle.generationRaw ?? vehicle.generationCanonical),
      generationCanonical: text(vehicle.generationCanonical),
      year: validYear(vehicle.year),
      modelYearFrom: validYear(vehicle.modelYearFrom),
      modelYearTo: validYear(vehicle.modelYearTo),
      plate: text(vehicle.licensePlate)?.toUpperCase() ?? null,
      vin: text(vehicle.vin)?.replace(/\s+/g, "").toUpperCase() ?? null,
      frameNumber: text(vehicle.frameNumber)?.replace(/\s+/g, "").toUpperCase() ?? null,
      bodyName: text(vehicle.bodyName),
      bodyCode: text(vehicle.bodyCode)?.toUpperCase() ?? null,
      bodyType: text(vehicle.bodyType),
      engineName: text(vehicle.engineName),
      engineCode: text(vehicle.engineCode)?.toUpperCase() ?? null,
      engineSeries: text(vehicle.engineSeries)?.toUpperCase() ?? null,
      engineVolumeCc: volumeCc(vehicle),
      powerHp: positiveInteger(vehicle.powerHp ?? vehicle.powerPs),
      powerKw: positiveInteger(vehicle.powerKw),
      fuelType: text(vehicle.fuelType),
      transmissionType: text(vehicle.transmissionType),
      transmissionName: text(vehicle.transmissionName),
      driveType: text(vehicle.driveType),
      steeringPosition: text(vehicle.steeringPosition),
      market: text(vehicle.market),
      countryOfOrigin: text(vehicle.countryOfOrigin),
      mileage: nonNegativeInteger(vehicle.mileage),
      ownersCount: nonNegativeInteger(vehicle.ownersCount),
    },
  };
}

export function normalizeManualVehicleProfile(values: ClientVehiclePassportValues): ClientVehicleProfileWrite {
  const result: ClientVehiclePassportValues = {};
  for (const field of CLIENT_VEHICLE_PASSPORT_FIELDS) {
    if (!(field in values)) continue;
    const value = values[field];
    if (["year", "modelYearFrom", "modelYearTo"].includes(field)) result[field] = validYear(value);
    else if (["engineVolumeCc", "powerHp", "powerKw"].includes(field)) result[field] = positiveInteger(value);
    else if (["mileage", "ownersCount"].includes(field)) result[field] = nonNegativeInteger(value);
    else if (["vin", "frameNumber"].includes(field)) result[field] = text(value)?.replace(/\s+/g, "").toUpperCase() ?? null;
    else if (["plate", "bodyCode", "engineCode", "engineSeries"].includes(field)) result[field] = text(value)?.toUpperCase() ?? null;
    else result[field] = text(value);
  }
  return { values: result, source: "vehicle_card", confidence: "HIGH", sourceSnapshot: null };
}

function isBlank(value: unknown): boolean {
  return value == null || value === "";
}

export function mergeClientVehiclePassport(input: {
  existing: ClientVehiclePassportValues;
  fieldSources?: Partial<Record<ClientVehiclePassportField, ClientVehicleFieldSource>>;
  incoming: ClientVehicleProfileWrite;
  mode: ClientVehicleWriteMode;
  now: string;
  actorLogin?: string;
}) {
  const values: ClientVehiclePassportValues = { ...input.existing };
  const fieldSources = { ...(input.fieldSources ?? {}) };
  const changedFields: ClientVehiclePassportField[] = [];
  const verificationStatus: ClientVehicleVerificationStatus = input.mode === "confirmed" ? "CONFIRMED" : "AUTO_FILLED";

  for (const field of CLIENT_VEHICLE_PASSPORT_FIELDS) {
    if (!(field in input.incoming.values)) continue;
    const nextValue = input.incoming.values[field];
    const currentValue = input.existing[field];
    if (input.mode === "auto" && (isBlank(nextValue) || !isBlank(currentValue))) continue;
    if (Object.is(currentValue ?? null, nextValue ?? null)) continue;
    values[field] = nextValue ?? null;
    fieldSources[field] = {
      source: input.incoming.source,
      confidence: input.incoming.confidence,
      verificationStatus,
      updatedAt: input.now,
      ...(input.actorLogin ? { updatedBy: input.actorLogin } : {}),
    };
    changedFields.push(field);
  }

  return { values, fieldSources, changedFields, verificationStatus };
}

export function clientVehicleCompleteness(values: ClientVehiclePassportValues) {
  const required = ["make", "model", "year", "vin", "engineVolumeCc", "powerHp", "fuelType", "transmissionType", "driveType", "mileage"] as const;
  const completed = required.filter((field) => field === "vin"
    ? !isBlank(values.vin) || !isBlank(values.frameNumber)
    : !isBlank(values[field]));
  return {
    completed: completed.length,
    total: required.length,
    percent: Math.round((completed.length / required.length) * 100),
    missing: required.filter((field) => !completed.includes(field)),
  };
}
