import type { MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import { normalizeEngineCode } from "@/lib/vehicle-normalization";

/** Only confirmed configuration facts; never VIN, inferred market, or catalogue year bounds. */
export function mannResearchScope(context?: MannTechnicalVehicleContext) {
  const code = (value?: string) => value?.normalize("NFKC").trim().toUpperCase().replace(/[\s-]+/g, "") || null;
  const equipment = (context?.confirmedEquipment ?? []).map(item => ({
    circuit: item.circuit, drive: item.drive ?? null,
    componentModel: code(item.componentModel), attachedTransmissionType: item.attachedTransmissionType ?? null,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    actualYear: context?.year ?? null,
    productionMonth: context?.productionMonth ?? null,
    engineCode: normalizeEngineCode(context?.engineCode) || null,
    confirmedMarket: context?.confirmedMarket ?? null,
    confirmedDrive: context?.confirmedDrive ?? null,
    confirmedTransmissionType: context?.confirmedTransmissionType ?? null,
    transmissionModel: code(context?.transmissionModel),
    transmissionGearCount: context?.transmissionGearCount ?? null,
    rearAirConditioning: context?.rearAirConditioning ?? null,
    confirmedEquipment: equipment,
  };
}
export type MannResearchScope = ReturnType<typeof mannResearchScope>;
export function mannResearchHasSpecificConditions(scope: MannResearchScope) {
  return Object.entries(scope).some(([key, value]) => key !== "engineCode" && (Array.isArray(value) ? value.length > 0 : value !== null));
}
export function mannResearchScopeMatches(saved: unknown, context?: MannTechnicalVehicleContext) {
  // PostgreSQL jsonb does not preserve object-key insertion order.
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  return saved != null && JSON.stringify(stable(saved)) === JSON.stringify(stable(mannResearchScope(context)));
}
export const MANN_RESEARCH_SCOPE_NOTICE = "Сохранённые исследования другой или неизвестной комплектации не применены. Уточните условия автомобиля и применяемость источника.";
