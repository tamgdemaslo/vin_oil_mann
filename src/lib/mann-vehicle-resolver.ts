import { prisma } from "@/lib/db";
import { listMannFilters, matchMannArticlesToLocalProducts, normalizeMannSearchText, normalizeMannText, type MannArticleMatchResult } from "@/lib/mann-catalog";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel, type NormalizedVehicleIdentity } from "@/lib/vehicle-identity";

export type DecodedVehicle = NormalizedVehicleIdentity;

export type NormalizedMannVehicle = {
  canonicalMake: string;
  baseModel: string;
  generation?: string;
  bodyCodes: string[];
  year?: number;
  exactEngineCode?: string;
  engineFamily?: string;
  engineVolumeCc?: number;
  powerKw?: number;
  powerHp?: number;
  fuelType?: string;
  transmissionType?: string;
  driveType?: string;
};

export type MannVehicleCandidate = {
  applicationId: string;
  variantId: string;
  make: string;
  model: string;
  vehicleText: string | null;
  effectiveVehicleText: string | null;
  engineCode: string | null;
  kw: string | null;
  hp: string | null;
  vehicleYears: string | null;
  condition: string | null;
  score: number;
  confidence: "high" | "medium" | "low";
  matchedFields: string[];
  mismatchedFields: string[];
  missingFields: string[];
  reasons: string[];
  warnings: string[];
};

export type MannSafePrefill = {
  makeId: string | null;
  makeLabel: string | null;
  modelQuery: string;
  selectedModelId: string | null;
  year: number | null;
  modificationQuery: string;
  selectedModificationId: string | null;
};

export type MannVehicleSelection = {
  mannApplicationId: string;
  make: string;
  model: string;
  vehicleText: string | null;
  engineCode: string | null;
  yearRange: string | null;
  power: string | null;
  condition: string | null;
  confidence: "high" | "medium" | "low";
  confirmedByUser: boolean;
};

export type MannResolutionTrace = {
  normalized: NormalizedMannVehicle;
  accepted: Array<{ applicationId: string; model: string; score: number }>;
  rejected: Array<{ applicationId: string; model: string; reasons: string[] }>;
};

export type MannVehicleResolution = {
  status: "resolved" | "candidates" | "unresolved";
  decodeConfidence: "high" | "medium" | "low";
  mannConfidence: "exact" | "probable" | "selection_required" | "not_found";
  safePrefill: MannSafePrefill;
  selectedApplication: MannVehicleCandidate | null;
  selection: MannVehicleSelection | null;
  candidates: MannVehicleCandidate[];
  filters: Awaited<ReturnType<typeof listMannFilters>>;
  localMatches: MannArticleMatchResult[];
  usedManualMapping: boolean;
  trace?: MannResolutionTrace;
};

type ResolveOptions = {
  organizationId: string;
  vehicle: DecodedVehicle;
  warehouseId?: string | null;
};

type MannRow = {
  vehicleVariantKey: string;
  make: string;
  makeNormalized: string;
  model: string;
  modelNormalized: string;
  vehicleText: string | null;
  effectiveVehicleText: string | null;
  engineCode: string | null;
  engineCodeNormalized: string | null;
  kw: string | null;
  hp: string | null;
  vehicleYears: string | null;
  vehicleYearFrom: number | null;
  vehicleYearTo: number | null;
  condition: string | null;
};

type Rejection = { applicationId: string; model: string; reasons: string[] };

export type MannResolverTestRow = MannRow;
export type MannCandidateEvaluation = { candidate?: MannVehicleCandidate; rejected?: Rejection };

const MANN_MAKE_FORMS: Record<string, string[]> = {
  MERCEDES: ["MERCEDES", "MERCEDES-BENZ", "MERCEDES BENZ"],
  VOLKSWAGEN: ["VOLKSWAGEN", "VW", "VW (VOLKSWAGEN)"],
  "LAND ROVER": ["LAND ROVER", "LANDROVER"],
  SSANGYONG: ["SSANGYONG", "SSANG YONG"],
  "GREAT WALL": ["GREAT WALL", "GREATWALL"],
};

const STATIC_MODEL_ALIASES: Record<string, Record<string, string>> = {
  BMW: {
    "1ER": "1",
    "2ER": "2",
    "3ER": "3",
    "4ER": "4",
    "5ER": "5",
    "6ER": "6",
    "7ER": "7",
    "8ER": "8",
  },
};

const ROMAN_GENERATION = /\b(?:VIII|VII|VI|IV|III|II|IX|V|I|X)\b/g;
const BODY_CODE = /\b(?:[A-Z]{1,3}\d{1,3}[A-Z]?|\d[A-Z]{1,3})\b/g;

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function safeYear(value: number | undefined): number | undefined {
  return value && Number.isInteger(value) && value >= 1886 && value <= new Date().getFullYear() + 1 ? value : undefined;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function generationFromText(value: unknown): string | undefined {
  const match = text(value).toUpperCase().match(ROMAN_GENERATION)?.at(-1);
  return match || undefined;
}

function bodyCodesFromText(value: unknown): string[] {
  return unique((text(value).toUpperCase().match(BODY_CODE) ?? []).filter((code) => !/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/.test(code)));
}

function canonicalBaseModel(value: unknown, make?: string): string | undefined {
  const model = normalizeVehicleModel(value, make).canonical;
  if (!model) return undefined;
  const compact = normalizeMannSearchText(model);
  return STATIC_MODEL_ALIASES[make ?? ""]?.[compact] ?? compact;
}

function engineFamily(value?: string | null): string | undefined {
  const normalized = normalizeEngineCode(value);
  if (!normalized) return undefined;
  const family = normalized
    .replace(/(?:[A-Z]?\d{0,2})$/i, "")
    .replace(/[-_]+$/g, "");
  return family || normalized;
}

function numberFromText(value?: string | null): number | null {
  if (!value) return null;
  const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match?.[0]) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function engineVolumeCcFromRow(row: MannRow): number | null {
  const value = `${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""} ${row.condition ?? ""}`;
  const liters = [...value.matchAll(/\b(\d(?:[.,]\d{1,3})?)\s*(?:l|л)\b/gi)]
    .map((match) => Number(match[1]?.replace(",", ".")))
    .find((volume) => Number.isFinite(volume) && volume >= 0.5 && volume <= 12);
  if (liters) return Math.round(liters * 1000);
  // MANN often writes a displacement directly next to an engine suffix: 2.0TDCi, 1.5EcoBoost, 2.7.
  const compactLiters = [...value.matchAll(/\b(\d{1,2}[.,]\d{1,3})(?=\s*(?:[A-ZА-Я]|\)|,|;|$))/gi)]
    .map((match) => Number(match[1]?.replace(",", ".")))
    .find((volume) => Number.isFinite(volume) && volume >= 0.5 && volume <= 12);
  if (compactLiters) return Math.round(compactLiters * 1000);
  const ccm = value.match(/\b(\d{3,5})\s*(?:CCM?|СМ(?:3|³))\b/i)?.[1];
  if (ccm) {
    const parsed = Number(ccm);
    if (Number.isFinite(parsed) && parsed >= 500 && parsed <= 12_000) return parsed;
  }
  return null;
}

function engineCodes(value?: string | null): string[] {
  return unique(String(value ?? "").split(/[;,/|]+/).map((part) => normalizeEngineCode(part)));
}

function normalizeFuel(value?: string | null): string | undefined {
  const normalized = text(value).toUpperCase();
  if (!normalized) return undefined;
  if (/\b(?:D|DIESEL|ДИЗЕЛ)/.test(normalized)) return "diesel";
  if (/\b(?:PO|PA|PETROL|GASOLINE|БЕНЗ)/.test(normalized)) return "gasoline";
  if (/\b(?:EL|ELECTRIC|ЭЛЕКТ)/.test(normalized)) return "electric";
  if (/\b(?:HYBRID|ГИБРИД)/.test(normalized)) return "hybrid";
  return undefined;
}

function fuelFromRow(row: MannRow): string | undefined {
  return normalizeFuel(`${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""} ${row.condition ?? ""}`);
}

function makeForms(make: string): string[] {
  const canonical = normalizeVehicleMake(make) ?? normalizeMannText(make);
  return unique([canonical, ...(MANN_MAKE_FORMS[canonical] ?? [])].map((item) => normalizeMannText(item)));
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === "string")) : [];
}

export async function normalizeDecodedVehicle(vehicle: DecodedVehicle): Promise<NormalizedMannVehicle | null> {
  const canonicalMake = normalizeVehicleMake(vehicle.makeCanonical ?? vehicle.makeRaw);
  const rawModel = vehicle.modelRaw ?? vehicle.modelCanonical ?? "";
  if (!canonicalMake || !rawModel) return null;
  const aliases = await prisma.vehicleModelAlias.findMany({ where: { normalizedMake: canonicalMake } });
  const sourceName = normalizeMannSearchText(rawModel);
  const alias = aliases.find((item) => normalizeMannSearchText(item.sourceName) === sourceName);
  const model = normalizeVehicleModel(rawModel, canonicalMake);
  const baseModel = alias?.canonicalBaseModel ?? canonicalBaseModel(model.canonical ?? rawModel, canonicalMake);
  if (!baseModel) return null;
  const aliasBodyCodes = alias ? jsonStrings(alias.bodyCodesJson) : [];
  return {
    canonicalMake,
    baseModel,
    generation: alias?.canonicalGeneration ?? generationFromText(vehicle.generationCanonical ?? vehicle.generationRaw ?? rawModel),
    bodyCodes: unique([
      ...aliasBodyCodes,
      ...bodyCodesFromText(vehicle.bodyCode),
      ...bodyCodesFromText(vehicle.bodyName),
      ...bodyCodesFromText(rawModel),
    ]),
    year: safeYear(vehicle.year),
    exactEngineCode: normalizeEngineCode(vehicle.engineCode ?? vehicle.engineSeries),
    engineFamily: engineFamily(vehicle.engineCode ?? vehicle.engineSeries),
    engineVolumeCc: vehicle.engineVolumeCc ?? (vehicle.engineVolumeLiters ? Math.round(vehicle.engineVolumeLiters * 1000) : undefined),
    powerKw: vehicle.powerKw ? Math.round(vehicle.powerKw) : undefined,
    powerHp: vehicle.powerHp ? Math.round(vehicle.powerHp) : vehicle.powerPs ? Math.round(vehicle.powerPs) : undefined,
    fuelType: normalizeFuel(vehicle.fuelType),
    transmissionType: text(vehicle.transmissionType || vehicle.transmissionName) || undefined,
    driveType: text(vehicle.driveType) || undefined,
  };
}

function rowGeneration(row: MannRow): string | undefined {
  return generationFromText(`${row.model} ${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""}`);
}

function rowBodyCodes(row: MannRow): string[] {
  return bodyCodesFromText(`${row.model} ${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""}`);
}

function candidateBaseModel(row: MannRow, make: string): string | undefined {
  return canonicalBaseModel(row.model, make);
}

const QUALIFIER_ONLY_VARIANT_MARKERS = [
  "EXPORTMODELL",
  "EXPORTMODELFOR",
  "KUNSTSTOFF OLFILTERMODUL",
  "PLASTIC OIL FILTER MODULE",
  "ALU OLFILTERMODUL",
  "ALUMINIUM OIL FILTER MODULE",
  "GEHAUSE HOUSING",
];

function isQualifierOnlyVariant(row: MannRow): boolean {
  const vehicleText = normalizeMannSearchText(row.effectiveVehicleText ?? row.vehicleText);
  if (!QUALIFIER_ONLY_VARIANT_MARKERS.some((marker) => vehicleText.includes(marker))) return false;
  const engineCode = normalizeEngineCode(row.engineCode);
  const hasEngineCode = Boolean(engineCode && /^[A-Z0-9/.-]{2,24}$/.test(engineCode));
  const hasPower = [numberFromText(row.kw), numberFromText(row.hp)].some((value) => value != null && value >= 20);
  const hasYear = row.vehicleYearFrom != null || row.vehicleYearTo != null;
  return !hasEngineCode && !hasPower && !hasYear;
}

function candidateFromRow(row: MannRow, score: number, matchedFields: string[], mismatchedFields: string[], missingFields: string[], reasons: string[], warnings: string[]): MannVehicleCandidate {
  return {
    applicationId: row.vehicleVariantKey,
    variantId: row.vehicleVariantKey,
    make: row.make,
    model: row.model,
    vehicleText: row.vehicleText,
    effectiveVehicleText: row.effectiveVehicleText,
    engineCode: row.engineCode,
    kw: row.kw,
    hp: row.hp,
    vehicleYears: row.vehicleYears,
    condition: row.condition,
    score,
    confidence: "low",
    matchedFields,
    mismatchedFields,
    missingFields,
    reasons,
    warnings,
  };
}

function scoreRow(vehicle: NormalizedMannVehicle, row: MannRow): MannCandidateEvaluation {
  const reject = (reason: string) => ({ rejected: { applicationId: row.vehicleVariantKey, model: row.model, reasons: [reason] } });
  if (isQualifierOnlyVariant(row)) return reject("служебное условие PDF, не модификация автомобиля");
  const rowMake = normalizeVehicleMake(row.make);
  if (!rowMake || rowMake !== vehicle.canonicalMake) return reject("марка не совпадает");
  const rowModel = candidateBaseModel(row, vehicle.canonicalMake);
  if (!rowModel || rowModel !== vehicle.baseModel) return reject("базовая модель не совпадает");

  const candidateGeneration = rowGeneration(row);
  if (vehicle.generation && candidateGeneration && vehicle.generation !== candidateGeneration) {
    return reject(`поколение: ${candidateGeneration}, ожидалось ${vehicle.generation}`);
  }
  const candidateCodes = engineCodes(row.engineCode);
  if (vehicle.exactEngineCode && candidateCodes.length > 0 && !candidateCodes.includes(vehicle.exactEngineCode)) {
    return reject(`код двигателя: ${candidateCodes.join(", ")} не совпадает с ${vehicle.exactEngineCode}`);
  }
  const exactEngineMatch = Boolean(vehicle.exactEngineCode && candidateCodes.includes(vehicle.exactEngineCode));
  const isYearOutsideRange = Boolean(
    vehicle.year && ((row.vehicleYearFrom != null && vehicle.year < row.vehicleYearFrom) || (row.vehicleYearTo != null && vehicle.year > row.vehicleYearTo))
  );
  // TRONK can return a model-year one year before the MANN applicability start.
  // Only retain that row as a confirmation-required candidate when the engine code is exact.
  const hasOneYearBoundaryMismatch = Boolean(
    isYearOutsideRange && exactEngineMatch && row.vehicleYearFrom != null && vehicle.year != null && row.vehicleYearFrom === vehicle.year + 1
  );
  if (isYearOutsideRange && !hasOneYearBoundaryMismatch) return reject(`год ${vehicle.year} вне диапазона MANN`);
  const candidateVolumeCc = engineVolumeCcFromRow(row);
  if (vehicle.engineVolumeCc && candidateVolumeCc && Math.abs(candidateVolumeCc - vehicle.engineVolumeCc) > 150) {
    return reject(`объём: ${candidateVolumeCc} см³ не совпадает с ${vehicle.engineVolumeCc} см³`);
  }
  const rowFuel = fuelFromRow(row);
  if (vehicle.fuelType && rowFuel && vehicle.fuelType !== rowFuel) return reject(`топливо: ${rowFuel}, ожидалось ${vehicle.fuelType}`);

  let score = 30;
  const matchedFields = ["марка", "базовая модель"];
  const mismatchedFields: string[] = [];
  const missingFields: string[] = [];
  const reasons = [row.make, row.model];
  const warnings: string[] = [];

  if (hasOneYearBoundaryMismatch) {
    mismatchedFields.push("год");
    warnings.push(`TRONK: ${vehicle.year}; MANN: ${row.vehicleYears ?? row.vehicleYearFrom}. Возможен переход модельного года — подтвердите модификацию.`);
  }

  if (vehicle.generation) {
    if (candidateGeneration) {
      score += 25;
      matchedFields.push("поколение");
    } else {
      missingFields.push("поколение MANN");
    }
  }

  const vehicleBodyCodes = vehicle.bodyCodes.filter((code) => normalizeMannSearchText(code) !== vehicle.baseModel);
  const rowCodes = rowBodyCodes(row).filter((code) => normalizeMannSearchText(code) !== vehicle.baseModel);
  if (vehicleBodyCodes.length > 0) {
    if (rowCodes.some((code) => vehicleBodyCodes.includes(code))) {
      score += 20;
      matchedFields.push("код кузова");
    } else if (rowCodes.length > 0) {
      return reject(`код кузова: ${rowCodes.join(", ")} не совпадает с ${vehicleBodyCodes.join(", ")}`);
    }
  }

  if (vehicle.year) {
    if (!hasOneYearBoundaryMismatch && (row.vehicleYearFrom != null || row.vehicleYearTo != null)) {
      score += 15;
      matchedFields.push("год");
    } else {
      missingFields.push("диапазон годов MANN");
    }
  }

  if (vehicle.exactEngineCode) {
    if (candidateCodes.includes(vehicle.exactEngineCode)) {
      score += 35;
      matchedFields.push("точный код двигателя");
    } else if (candidateCodes.length === 0) {
      missingFields.push("код двигателя MANN");
    }
  } else if (vehicle.engineFamily) {
    const families = candidateCodes.map(engineFamily);
    if (families.includes(vehicle.engineFamily)) {
      score += 25;
      matchedFields.push("семейство двигателя");
    }
  }

  if (vehicle.engineVolumeCc) {
    if (candidateVolumeCc) {
      score += 15;
      matchedFields.push("объём двигателя");
    } else {
      missingFields.push("объём двигателя MANN");
    }
  }

  const candidateKw = numberFromText(row.kw);
  const candidateHp = numberFromText(row.hp);
  const inputKw = vehicle.powerKw;
  const inputHp = vehicle.powerHp ?? (inputKw ? Math.round(inputKw * 1.35962) : undefined);
  if (inputKw || inputHp) {
    const kwMatch = inputKw != null && candidateKw != null && Math.abs(candidateKw - inputKw) <= 3;
    const hpMatch = inputHp != null && candidateHp != null && Math.abs(candidateHp - inputHp) <= 5;
    if (kwMatch || hpMatch) {
      score += 10;
      matchedFields.push("мощность");
    } else if (candidateKw != null || candidateHp != null) {
      mismatchedFields.push("мощность");
      warnings.push(`MANN: ${candidateKw != null ? `${candidateKw} кВт` : ""}${candidateKw != null && candidateHp != null ? " · " : ""}${candidateHp != null ? `${candidateHp} л.с.` : ""}; автомобиль: ${inputKw != null ? `${inputKw} кВт` : ""}${inputKw != null && inputHp != null ? " · " : ""}${inputHp != null ? `${inputHp} л.с.` : ""}`);
    } else {
      missingFields.push("мощность MANN");
    }
  }

  if (vehicle.fuelType) {
    if (rowFuel) {
      score += 7;
      matchedFields.push("топливо");
    } else {
      missingFields.push("топливо MANN");
    }
  }

  const textRow = `${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""} ${row.condition ?? ""}`.toUpperCase();
  if (vehicle.transmissionType && textRow.includes(vehicle.transmissionType.toUpperCase())) {
    score += 5;
    matchedFields.push("коробка");
  }
  if (vehicle.driveType && textRow.includes(vehicle.driveType.toUpperCase())) {
    score += 5;
    matchedFields.push("привод");
  }
  if (row.condition) score += 5;

  return { candidate: candidateFromRow(row, score, matchedFields, mismatchedFields, missingFields, reasons, warnings) };
}

/** Pure seam for regression cases; production resolution obtains rows from Prisma separately. */
export function evaluateMannCandidate(vehicle: NormalizedMannVehicle, row: MannResolverTestRow): MannCandidateEvaluation {
  return scoreRow(vehicle, row);
}

/** Normalization without persisted aliases, used by regression tests and diagnostics. */
export function normalizeDecodedVehicleForTest(vehicle: DecodedVehicle): NormalizedMannVehicle | null {
  const canonicalMake = normalizeVehicleMake(vehicle.makeCanonical ?? vehicle.makeRaw);
  const rawModel = vehicle.modelRaw ?? vehicle.modelCanonical ?? "";
  if (!canonicalMake || !rawModel) return null;
  const baseModel = canonicalBaseModel(rawModel, canonicalMake);
  if (!baseModel) return null;
  return {
    canonicalMake,
    baseModel,
    generation: generationFromText(vehicle.generationCanonical ?? vehicle.generationRaw ?? rawModel),
    bodyCodes: unique([
      ...bodyCodesFromText(vehicle.bodyCode),
      ...bodyCodesFromText(vehicle.bodyName),
      ...bodyCodesFromText(rawModel),
    ]),
    year: safeYear(vehicle.year),
    exactEngineCode: normalizeEngineCode(vehicle.engineCode ?? vehicle.engineSeries),
    engineFamily: engineFamily(vehicle.engineCode ?? vehicle.engineSeries),
    engineVolumeCc: vehicle.engineVolumeCc ?? (vehicle.engineVolumeLiters ? Math.round(vehicle.engineVolumeLiters * 1000) : undefined),
    powerKw: vehicle.powerKw ? Math.round(vehicle.powerKw) : undefined,
    powerHp: vehicle.powerHp ? Math.round(vehicle.powerHp) : vehicle.powerPs ? Math.round(vehicle.powerPs) : undefined,
    fuelType: normalizeFuel(vehicle.fuelType),
    transmissionType: text(vehicle.transmissionType || vehicle.transmissionName) || undefined,
    driveType: text(vehicle.driveType) || undefined,
  };
}

function confidenceFor(candidate: MannVehicleCandidate, runnerUp: MannVehicleCandidate | undefined): MannVehicleCandidate["confidence"] {
  const gap = candidate.score - (runnerUp?.score ?? -999);
  if (candidate.score >= 85 && gap >= 15 && candidate.mismatchedFields.length === 0) return "high";
  if (candidate.score >= 65) return "medium";
  return "low";
}

function selectionFor(candidate: MannVehicleCandidate, confirmedByUser: boolean): MannVehicleSelection {
  return {
    mannApplicationId: candidate.applicationId,
    make: candidate.make,
    model: candidate.model,
    vehicleText: candidate.effectiveVehicleText ?? candidate.vehicleText,
    engineCode: candidate.engineCode,
    yearRange: candidate.vehicleYears,
    power: [candidate.kw ? `${candidate.kw} кВт` : null, candidate.hp ? `${candidate.hp} л.с.` : null].filter(Boolean).join(" · ") || null,
    condition: candidate.condition,
    confidence: candidate.confidence,
    confirmedByUser,
  };
}

function safePrefillFor(vehicle: NormalizedMannVehicle, matchingMake: string | null, selected: MannVehicleCandidate | null): MannSafePrefill {
  return {
    makeId: matchingMake,
    makeLabel: matchingMake,
    modelQuery: vehicle.baseModel,
    selectedModelId: selected?.confidence === "high" ? selected.model : null,
    year: vehicle.year ?? null,
    modificationQuery: [vehicle.exactEngineCode, vehicle.engineVolumeCc ? `${Number((vehicle.engineVolumeCc / 1000).toFixed(3))} л` : null, vehicle.powerHp ? `${vehicle.powerHp} л.с.` : null].filter(Boolean).join(" · "),
    selectedModificationId: selected?.confidence === "high" ? selected.applicationId : null,
  };
}

async function filtersFor(candidate: MannVehicleCandidate | null, options: ResolveOptions) {
  if (!candidate) return { filters: [], localMatches: [] as MannArticleMatchResult[] };
  const filters = await listMannFilters({ make: candidate.make, model: candidate.model, variantId: candidate.variantId });
  const localMatches = await matchMannArticlesToLocalProducts({
    mannArticles: filters.map((filter) => ({ mannArticle: filter.mannArticle, filterType: filter.filterType, filterSubtype: filter.filterSubtype })),
    organizationId: options.organizationId,
    warehouseId: options.warehouseId,
  });
  return { filters, localMatches };
}

function mappingMatchesVehicle(mapping: { normalizedGeneration: string | null; bodyCodesJson: unknown; yearFrom: number | null; yearTo: number | null; engineCode: string | null; engineFamily: string | null; engineVolumeCc: number | null; powerKw: number | null; powerHp: number | null; fuelType: string | null; driveType: string | null }, vehicle: NormalizedMannVehicle): boolean {
  if (mapping.normalizedGeneration && vehicle.generation && mapping.normalizedGeneration !== vehicle.generation) return false;
  const mappingCodes = jsonStrings(mapping.bodyCodesJson);
  if (mappingCodes.length > 0 && vehicle.bodyCodes.length > 0 && !mappingCodes.some((code) => vehicle.bodyCodes.includes(code))) return false;
  if (vehicle.year && ((mapping.yearFrom != null && vehicle.year < mapping.yearFrom) || (mapping.yearTo != null && vehicle.year > mapping.yearTo))) return false;
  if (mapping.engineCode && vehicle.exactEngineCode && mapping.engineCode !== vehicle.exactEngineCode) return false;
  if (mapping.engineFamily && vehicle.engineFamily && mapping.engineFamily !== vehicle.engineFamily) return false;
  if (mapping.engineVolumeCc && vehicle.engineVolumeCc && Math.abs(mapping.engineVolumeCc - vehicle.engineVolumeCc) > 150) return false;
  if (mapping.powerKw && vehicle.powerKw && Math.abs(mapping.powerKw - vehicle.powerKw) > 3) return false;
  if (mapping.powerHp && vehicle.powerHp && Math.abs(mapping.powerHp - vehicle.powerHp) > 5) return false;
  if (mapping.fuelType && vehicle.fuelType && mapping.fuelType !== vehicle.fuelType) return false;
  if (mapping.driveType && vehicle.driveType && mapping.driveType !== vehicle.driveType) return false;
  return true;
}

export async function resolveMannVehicle(options: ResolveOptions): Promise<MannVehicleResolution> {
  const normalized = await normalizeDecodedVehicle(options.vehicle);
  const emptyPrefill: MannSafePrefill = { makeId: null, makeLabel: null, modelQuery: "", selectedModelId: null, year: null, modificationQuery: "", selectedModificationId: null };
  if (!normalized) {
    return { status: "unresolved", decodeConfidence: options.vehicle.confidence, mannConfidence: "not_found", safePrefill: emptyPrefill, selectedApplication: null, selection: null, candidates: [], filters: [], localMatches: [], usedManualMapping: false };
  }

  const forms = makeForms(normalized.canonicalMake);
  const rows = await prisma.mannFilterApplication.findMany({
    where: { makeNormalized: { in: forms } },
    select: { vehicleVariantKey: true, make: true, makeNormalized: true, model: true, modelNormalized: true, vehicleText: true, effectiveVehicleText: true, engineCode: true, engineCodeNormalized: true, kw: true, hp: true, vehicleYears: true, vehicleYearFrom: true, vehicleYearTo: true, condition: true },
    take: 25_000,
  }) as MannRow[];
  const matchingMake = rows[0]?.make ?? null;
  const byVariant = new Map<string, MannRow>();
  for (const row of rows) {
    const current = byVariant.get(row.vehicleVariantKey);
    if (!current || (row.engineCode && !current.engineCode)) byVariant.set(row.vehicleVariantKey, row);
  }

  const accepted: MannVehicleCandidate[] = [];
  const rejected: Rejection[] = [];
  for (const row of byVariant.values()) {
    const result = scoreRow(normalized, row);
    if (result.candidate) accepted.push(result.candidate);
    if (result.rejected) rejected.push(result.rejected);
  }
  accepted.sort((left, right) => right.score - left.score || left.model.localeCompare(right.model, "ru"));
  const rankedCandidates = accepted.map((candidate, index, all) => ({ ...candidate, confidence: confidenceFor(candidate, all[index + 1]) }));
  const candidates = rankedCandidates.slice(0, 3);

  const mappings = await prisma.vehicleMannMapping.findMany({
    where: { organizationId: options.organizationId, normalizedMake: normalized.canonicalMake, normalizedModel: normalized.baseModel },
    orderBy: { updatedAt: "desc" },
  });
  const mapping = mappings.find((item) => mappingMatchesVehicle(item, normalized));
  let selectedApplication = candidates[0]?.confidence === "high" ? candidates[0] : null;
  let usedManualMapping = false;
  if (mapping) {
    const mapped = rankedCandidates.find((candidate) => candidate.applicationId === mapping.mannApplicationId);
    if (mapped) {
      selectedApplication = { ...mapped, confidence: "high", reasons: [...mapped.reasons, "подтверждено вручную"] };
      usedManualMapping = true;
    }
  }

  const status = selectedApplication ? "resolved" : candidates.length > 0 ? "candidates" : "unresolved";
  const mannConfidence = selectedApplication ? "exact" : candidates.some((candidate) => candidate.confidence === "medium") ? "selection_required" : candidates.length > 0 ? "probable" : "not_found";
  const data = status === "resolved" ? await filtersFor(selectedApplication, options) : { filters: [], localMatches: [] as MannArticleMatchResult[] };
  const trace = process.env.NODE_ENV === "production"
    ? undefined
    : { normalized, accepted: accepted.slice(0, 10).map((candidate) => ({ applicationId: candidate.applicationId, model: candidate.model, score: candidate.score })), rejected: rejected.slice(0, 50) };

  if (trace) {
    console.info("[mann-resolver]", JSON.stringify(trace));
  }

  return {
    status,
    decodeConfidence: options.vehicle.confidence,
    mannConfidence,
    safePrefill: safePrefillFor(normalized, matchingMake, selectedApplication),
    selectedApplication,
    selection: selectedApplication ? selectionFor(selectedApplication, usedManualMapping) : null,
    candidates,
    filters: data.filters,
    localMatches: data.localMatches,
    usedManualMapping,
    trace,
  };
}
