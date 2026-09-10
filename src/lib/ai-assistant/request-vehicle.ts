import { normalizeVehicleMake, normalizeVehicleModel, splitCombinedVehicleDescription } from "@/lib/vehicle-normalization";

/** Read the catalogue's explicit display format, not free-form vehicle prose.
 * These are employee-supplied attributes; the canonical resolver still chooses
 * the application and the VIN decoder keeps its separate provenance. */
export function catalogueVehicleFromRequest(message: string, expectedVin?: string | null): Record<string, unknown> {
  const descriptors = [...message.matchAll(/([^\n·]{1,200})\s*·\s*([^·\n]{1,60})\s*·\s*([^·\n]{1,60})\s*·\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:kW|кВт)\s*·\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:hp|л\.\s*с\.?)\s*·\s*\d{2}\/\d{2,4}\s*(?:->|→)(?:\s*\d{2}\/\d{2,4})?/giu)];
  const candidates: Record<string, unknown>[] = [];
  for (const match of descriptors) {
    const trailing = message.slice((match.index ?? 0) + match[0].length);
    const vin = trailing.match(/^\s*(?:VIN\s*:?\s*)?([A-HJ-NPR-Z0-9]{17})\b/iu)?.[1]?.toUpperCase();
    if (expectedVin && vin !== expectedVin.toUpperCase()) continue;
    // A pasted chat timestamp may precede the make. Reuse the common make and
    // model normalisers on word-aligned suffixes, not a second vehicle matcher.
    const words = match[1].trim().split(/\s+/u);
    const label = words.map((_, index) => splitCombinedVehicleDescription(words.slice(index).join(" "))).find(item => item.makeCanonical && item.modelRaw);
    if (!label?.modelRaw || !label.makeCanonical) continue;
    const model = normalizeVehicleModel(label.modelRaw, label.makeCanonical);
    const powerKw = Number(match[4].replace(",", ".")), powerHp = Number(match[5].replace(",", "."));
    const engineVolumeLiters = Number(match[2].trim().match(/^(\d{1,2}(?:[.,]\d{1,3})?)(?=[A-Z\s]|$)/iu)?.[1]?.replace(",", "."));
    const engineSeries = match[3].trim();
    if (!model.canonical || powerKw <= 0 || powerKw > 2000 || powerHp <= 0 || powerHp > 3000 || !/^[\p{L}\p{N} ._()-]{1,40}$/u.test(engineSeries)) continue;
    candidates.push({ makeCanonical: label.makeCanonical, modelCanonical: model.canonical, modelRaw: label.modelRaw,
      ...(model.generation ? { generationRaw: model.generation } : {}),
      ...(model.bodyCode ? { bodyCode: model.bodyCode } : {}),
      ...(vin ? { vin } : {}), engineSeries, powerKw, powerHp,
      ...(engineVolumeLiters > 0 && engineVolumeLiters <= 30 ? { engineVolumeLiters } : {}) });
  }
  const unique = candidates.filter((row, index) => candidates.findIndex(other => JSON.stringify(other) === JSON.stringify(row)) === index);
  return unique.length === 1 ? unique[0] : {};
}

export function assertRequestedVehicleConsistent(requested: Record<string, unknown>, verified: Record<string, unknown>) {
  const requestedMake = normalizeVehicleMake(requested.makeCanonical);
  const verifiedMake = normalizeVehicleMake(verified.makeCanonical ?? verified.makeRaw);
  const requestedModel = normalizeVehicleModel(requested.modelCanonical, requestedMake).canonical;
  const verifiedModel = normalizeVehicleModel(verified.modelCanonical ?? verified.modelRaw, verifiedMake).canonical;
  const requestedLiters = Number(requested.engineVolumeLiters);
  const verifiedLiters = Number(verified.engineVolumeLiters ?? (typeof verified.engineVolumeCc === "number" ? verified.engineVolumeCc / 1000 : undefined));
  const conflict = (requestedMake && verifiedMake && requestedMake !== verifiedMake)
    || (requestedModel && verifiedModel && requestedModel !== verifiedModel)
    || ["vin", "generationRaw", "bodyCode"].some(key => requested[key] && verified[key] && String(requested[key]).toUpperCase() !== String(verified[key]).toUpperCase())
    || ["powerKw", "powerHp"].some(key => typeof requested[key] === "number" && typeof verified[key] === "number" && Math.abs(Number(requested[key]) - Number(verified[key])) > Math.max(2, Number(verified[key]) * 0.02))
    || (requestedLiters > 0 && verifiedLiters > 0 && Math.abs(requestedLiters - verifiedLiters) > 0.1);
  if (conflict) throw new Error("VEHICLE_CONTEXT_CONFLICT: характеристики в сообщении противоречат данным VIN. Уточните автомобиль перед подбором.");
}
