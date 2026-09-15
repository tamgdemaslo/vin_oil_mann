import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-normalization";
import { mannEquipmentScopeMatches, type MannEquipmentConfirmation } from "@/lib/mann-equipment-scope";
import { isVehicleDestinationMarket, type VehicleDestinationMarket } from "@/lib/vehicle-market";

export type MannTechnicalVehicleContext = {
  /** Explicit equipment confirmation; absence of an answer is not false. */
  rearAirConditioning?: boolean;
  make?: string;
  model?: string;
  generation?: string;
  engineCode?: string;
  /** Confirmed vehicle destination market, never inferred from language or location. */
  confirmedMarket?: VehicleDestinationMarket;
  transmissionModel?: string;
  transmissionGearCount?: number;
  confirmedTransmissionType?: "automatic" | "manual" | "cvt" | "robot";
  productionMonth?: string;
  year?: number;
  confirmedEquipment?: MannEquipmentConfirmation[];
};

function modelKey(value: unknown, make: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return normalizeVehicleModel(value, make).canonical?.replace(/[^\p{L}\p{N}]+/gu, "");
}

function generationKey(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalizeVehicleModel(value);
  return normalized.generation ?? normalized.canonical?.replace(/[^\p{L}\p{N}]+/gu, "");
}

function month(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return undefined;
  const [year, m] = value.split("-").map(Number);
  return year >= 1886 && year <= 2100 ? year * 12 + m - 1 : undefined;
}

/** New scoped associations require actual vehicle context, not just a MANN key. */
export function mannTechnicalScopeMatches(value: unknown, context?: MannTechnicalVehicleContext): boolean {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  // Match exact supported destination markets; never infer country/region membership.
  // Unknown or malformed requirements must not become unrestricted records.
  if ("requiredMarket" in data) {
    if (!isVehicleDestinationMarket(data.requiredMarket) || context?.confirmedMarket !== data.requiredMarket) return false;
  }
  // A vehicle gearbox condition may restrict engine oil/coolant as well as
  // gearbox fluids. Keep it separate from the fluid's destination system.
  if ("requiredTransmission" in data) {
    const required = data.requiredTransmission;
    if (!required || typeof required !== "object" || Array.isArray(required)) return false;
    const condition = required as Record<string, unknown>;
    if (Object.keys(condition).some(key => !["type", "gearCount"].includes(key))) return false;
    if (typeof condition.type !== "string" || !["automatic", "manual", "cvt", "robot"].includes(condition.type)) return false;
    if (context?.confirmedTransmissionType !== condition.type) return false;
    if ("gearCount" in condition) {
      const count = condition.gearCount;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 3 || count > 18) return false;
      if (context?.transmissionGearCount !== count) return false;
    }
  }
  if ("requiredEquipment" in data && !mannEquipmentScopeMatches(data.requiredEquipment, context?.confirmedEquipment)) return false;
  if ("transmissionGearCount" in data) {
    const count = data.transmissionGearCount;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 3 || count > 18) return false;
    if (context?.transmissionGearCount !== count) return false;
  }
  if ("sourceVehicleScope" in data) {
    const scope = data.sourceVehicleScope;
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) return false;
    const identity = scope as Record<string, unknown>;
    if (typeof identity.make !== "string" || typeof identity.model !== "string") return false;
    const make = normalizeVehicleMake(identity.make);
    if (!make || normalizeVehicleMake(context?.make) !== make) return false;
    const expectedModel = modelKey(identity.model, make);
    if (!expectedModel || modelKey(context?.model, make) !== expectedModel) return false;
    if (identity.generation != null) {
      const expectedGeneration = generationKey(identity.generation);
      const actualGeneration = generationKey(context?.generation) ?? normalizeVehicleModel(context?.model, make).generation;
      const modelGeneration = normalizeVehicleModel(context?.model, make).generation;
      if (modelGeneration && actualGeneration !== modelGeneration) return false;
      if (!expectedGeneration || expectedGeneration !== actualGeneration) return false;
    }
  }
  if (data.matchedEngineScope != null) {
    if (!Array.isArray(data.matchedEngineScope) || !data.matchedEngineScope.length) return false;
    if (data.matchedEngineScope.some(code => typeof code !== "string")) return false;
    const codes = data.matchedEngineScope.map(normalizeEngineCode);
    if (codes.some(code => !code || /^(?:2WD|4WD|AWD|FWD|RWD|4X4|4X2)$/.test(code))) return false;
    if (!context?.engineCode || !codes.includes(normalizeEngineCode(context.engineCode))) return false;
  }
  if (!("window" in data)) return true; // Existing non-scoped revisions retain their publication gates.
  const window = data.window as { intersection?: { from?: unknown; to?: unknown } } | null;
  const bounds = window?.intersection;
  if (!bounds || typeof bounds !== "object" || !("from" in bounds) || !("to" in bounds)) return false;
  const from = bounds.from === null ? -Infinity : month(bounds.from);
  const to = bounds.to === null ? Infinity : month(bounds.to);
  if (from === undefined || to === undefined || from > to) return false;
  if (context?.productionMonth !== undefined) {
    const actual = month(context.productionMonth);
    if (actual === undefined) return false;
    if (context.year !== undefined && Math.floor(actual / 12) !== context.year) return false;
    return actual >= from && actual <= to;
  }
  // A year suffices only when every month in it falls within the source scope.
  const year = context?.year;
  if (year === undefined || !Number.isInteger(year) || year < 1886 || year > 2100) return false;
  return year * 12 >= from && year * 12 + 11 <= to;
}
