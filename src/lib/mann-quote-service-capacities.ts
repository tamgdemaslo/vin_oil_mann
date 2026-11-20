import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";

export type MannQuoteServiceCapacity = {
  key: string;
  context: string;
  label: string;
  litres: number;
};

const METHODS: Record<string, string> = {
  WITH_FILTER: "Замена с фильтром",
  SERVICE: "Сервисная замена",
  PARTIAL: "Частичная замена",
  FULL_REPLACEMENT: "Полная замена",
  REFILL: "Перезаправка",
};

/** Select a service operation, never a total/dry system capacity or a range endpoint. */
export function mannQuoteServiceCapacities(profile: MannUnifiedTechnicalProfile | null, systemCode: string): MannQuoteServiceCapacity[] {
  const methods = new Map<string, Map<number, MannQuoteServiceCapacity>>();
  for (const item of profile?.items ?? []) {
    if (item.systemCode !== systemCode || item.requiresReview || item.researchResult
      || item.sourceStatus !== "primary_source" || !item.automaticSelectionEligible) continue;
    for (const capacity of item.capacities) {
      const context = capacity.serviceContext ?? "";
      if (!METHODS[context] || (systemCode === "ENGINE_OIL" && !["SERVICE", "WITH_FILTER"].includes(context))) continue;
      const litres = capacity.nominalLiters;
      if (typeof litres !== "number" || !Number.isFinite(litres) || litres <= 0
        || (capacity.qualifier && capacity.qualifier !== "EXACT")
        || capacity.minLiters != null || capacity.maxLiters != null || capacity.toleranceLiters != null) continue;
      const values = methods.get(context) ?? new Map<number, MannQuoteServiceCapacity>();
      values.set(litres, { key: `${systemCode}:${context}:${litres}`, context, label: METHODS[context], litres });
      methods.set(context, values);
    }
  }
  // Multiple volumes for the same operation are conflicting/conditional facts,
  // not different service methods that a user can resolve by picking a number.
  return [...methods.values()].flatMap(values => values.size === 1 ? [...values.values()] : [])
    .sort((a, b) => a.key.localeCompare(b.key));
}
