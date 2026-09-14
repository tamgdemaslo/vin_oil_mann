import type { MannTechnicalCapacity } from "@/lib/mann-unified-technical-profile";

const liters = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);

/** Display precision is evidence: approximate and upper-bound values aren't exact fills. */
export function mannCapacityLabel(capacity: MannTechnicalCapacity): string {
  let value = "";
  if (capacity.qualifier === "UP_TO" && (capacity.maxLiters ?? capacity.nominalLiters) != null) {
    value = `до ${liters((capacity.maxLiters ?? capacity.nominalLiters)!)} л`;
  } else if (capacity.qualifier === "RANGE" && capacity.minLiters != null && capacity.maxLiters != null) {
    value = `${liters(capacity.minLiters)}–${liters(capacity.maxLiters)} л`;
  } else if (capacity.nominalLiters != null) {
    value = `${liters(capacity.nominalLiters)} л`;
    if (capacity.toleranceLiters != null && capacity.toleranceLiters > 0) value += ` ± ${liters(capacity.toleranceLiters)} л`;
  } else if (capacity.minLiters != null && capacity.maxLiters != null) {
    value = `${liters(capacity.minLiters)}–${liters(capacity.maxLiters)} л`;
  } else if (capacity.maxLiters != null) value = `до ${liters(capacity.maxLiters)} л`;
  else if (capacity.minLiters != null) value = `от ${liters(capacity.minLiters)} л`;
  if (capacity.qualifier === "APPROXIMATE" && value) value = `примерно ${value}`;
  return [value, capacity.serviceContextLabel].filter(Boolean).join(" · ");
}
