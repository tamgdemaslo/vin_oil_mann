import { prisma } from "@/lib/db";
import { isMannNonVehicleVariantText, listMannFilters, matchMannArticlesToLocalProducts, normalizeMannSearchText, normalizeMannText, type MannArticleMatchResult } from "@/lib/mann-catalog";
import type { NormalizedVehicleIdentity } from "@/lib/vehicle-identity";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel } from "@/lib/vehicle-normalization";

export type DecodedVehicle = NormalizedVehicleIdentity;

/** Scores below this level are contradictory/underspecified retrieval hits, not usable MANN candidates. */
export const MANN_MIN_PRESENTABLE_SCORE = 30;

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
  fuelType?: MannFuelKind;
  transmissionType?: string;
  driveType?: string;
};

export type MannFuelKind = "gasoline" | "diesel" | "bifuel" | "lpg" | "cng" | "hev" | "phev" | "mhev" | "electric";
export type MannFuelCompatibility = "exact" | "compatible" | "conditional" | "conflict" | "unknown";

export type MannVehicleCandidate = {
  applicationId: string;
  variantId: string;
  variantIds: string[];
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
  featureContributions: Array<{ feature: string; evidence: string; weight: number }>;
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
  sourceRowCount: number;
  retrievedCount: number;
  accepted: Array<{ applicationId: string; model: string; score: number; confidence: "high" | "medium" | "low"; featureContributions: MannVehicleCandidate["featureContributions"] }>;
  rejected: Array<{ applicationId: string; model: string; reasons: string[] }>;
  timingsMs?: { query: number; rank: number; filters: number; total: number };
};

export type MannVehicleResolution = {
  status: "resolved" | "candidates" | "unresolved";
  decision: "MATCH" | "AMBIGUOUS" | "NO_MATCH";
  decodeConfidence: "high" | "medium" | "low";
  mannConfidence: "high" | "medium" | "low" | "none";
  safePrefill: MannSafePrefill;
  selectedApplication: MannVehicleCandidate | null;
  selection: MannVehicleSelection | null;
  candidates: MannVehicleCandidate[];
  filters: Awaited<ReturnType<typeof listMannFilters>>;
  localMatches: MannArticleMatchResult[];
  usedManualMapping: boolean;
  endToEndStatus: "VEHICLE_NO_MATCH" | "VEHICLE_AMBIGUOUS" | "VEHICLE_MATCHED_FILTERS_FOUND" | "FILTERS_FOUND_LOCAL_PRODUCTS_PARTIAL" | "FILTERS_FOUND_LOCAL_PRODUCTS_COMPLETE";
  failureCode?: "MANN_NORMALIZATION_FAILED" | "MANN_NO_CANDIDATE" | "MANN_AMBIGUOUS" | "LOCAL_PRODUCTS_PARTIAL" | "LOCAL_PRODUCTS_MISSING";
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
  KIA: ["KIA", "KIA MOTORS"],
  MINI: ["MINI", "MINI (BMW GROUP)"],
  "DS AUTOMOBILES": ["DS AUTOMOBILES", "DS"],
  CHEVROLET: ["CHEVROLET", "CHEVROLET EUROPE / DAEWOO (GM)"],
  "LAND ROVER": ["LAND ROVER", "LANDROVER"],
  SSANGYONG: ["SSANGYONG", "SSANG YONG"],
  "GREAT WALL": ["GREAT WALL", "GREATWALL"],
  VOLVO: ["VOLVO", "VOLVO CARS"],
  LADA: ["LADA", "LADA (SHIGULI)", "VAZ"],
};

const ROMAN_GENERATION = /(?:^|[\s(/,])(XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?=$|[\s(),/])/g;
const BODY_CODE = /\b(?:[A-Z]{1,3}\d{1,3}[A-Z]{0,3}|\d[A-Z]{1,3})\b/g;

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
  const matches = [...text(value).toUpperCase().matchAll(ROMAN_GENERATION)];
  return matches.at(-1)?.[1] || undefined;
}

function vehicleGeneration(value: unknown): string | undefined {
  return generationFromText(value);
}

function bodyCodesFromText(value: unknown): string[] {
  const normalized = text(value).toUpperCase();
  const exactAlphabeticCode = /^[A-Z]{2,3}$/.test(normalized) ? normalized : undefined;
  return unique([exactAlphabeticCode, ...(normalized.match(BODY_CODE) ?? []).filter((code) => (
    !/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/.test(code)
    && !/^V(?:6|8|10|12)$/.test(code)
    && !/^(?:GLK|GL|GLE|GLS|ML)\d{2,3}$/.test(code)
    && !/^\d{3}[DIE]$/.test(code)
    && !/^\d+(?:V|XDI|TDI|TFSI|TSI|FSI|DCI|CDI|HDI|CRDI|GDI|MPI|VVT|CVVT|D|I)/.test(code)
  ))]);
}

function bodyCodesCompatible(left: string, right: string): boolean {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return (shorter.length >= 2 && longer.startsWith(shorter))
    || (shorter.length >= 3 && longer.includes(shorter));
}

function canonicalBaseModel(value: unknown, make?: string): string | undefined {
  const model = normalizeVehicleModel(value, make).canonical;
  if (!model) return undefined;
  let compact = normalizeMannSearchText(model);
  if (make === "MERCEDES") {
    compact = compact
      .replace(/^MERCEDES(?: BENZ)?\s+/, "")
      .replace(/(?:^|\s)(?:CLASS|KLASS|KLASSE|КЛАСС)(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    compact = compact.replace(/^(GLK|GL|GLE|GLS|ML|E|C|S)\s*\d{2,3}(?:\s+.*)?$/, "$1");
  }
  if (make === "BMW") {
    compact = compact.replace(/^([1-8])ER$/, "$1").replace(/^([1-8])\d{2}[DIE]$/, "$1").replace(/^([1-8])\s+GT$/, "$1GT");
  }
  return compact.replace(/^NEW\s+/, "");
}

function modelComparisonKey(value?: string): string {
  return normalizeMannSearchText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function phoneticModelKey(value?: string): string {
  return modelComparisonKey(value).replace(/Q/g, "K").replace(/C(?=[A-Z])/g, "K").replace(/OO/g, "U");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function modelSimilarity(left?: string, right?: string): number {
  const leftKey = modelComparisonKey(left);
  const rightKey = modelComparisonKey(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 1;
  if (phoneticModelKey(left) === phoneticModelKey(right)) return 0.96;
  const shorter = leftKey.length <= rightKey.length ? leftKey : rightKey;
  const longer = leftKey.length <= rightKey.length ? rightKey : leftKey;
  if (shorter.length >= 2 && longer.startsWith(shorter)) return 0.9;
  if (shorter.length >= 4 && longer.endsWith(shorter)) return 0.9;
  if (shorter.length >= 5 && editDistance(phoneticModelKey(left), phoneticModelKey(right)) <= 1) return 0.84;
  return 0;
}

function candidateBaseModels(row: MannRow, make: string): string[] {
  const withoutDetails = row.model.replace(/\([^)]*\)/g, " ");
  const parentheticalAliases = [...row.model.matchAll(/\(([^)]*)\)/g)]
    .flatMap((match) => String(match[1] ?? "").split(/[+/;,]+/))
    .filter((part) => /^[A-ZА-Я0-9 -]{2,12}$/i.test(part.trim()));
  return unique([
    canonicalBaseModel(row.model, make),
    ...withoutDetails.split(/[+/;,]+/).map((part) => canonicalBaseModel(part, make)),
    ...parentheticalAliases.map((part) => canonicalBaseModel(part, make)),
  ]);
}

function engineFamily(value?: string | null): string | undefined {
  const normalized = normalizeEngineCode(value);
  if (!normalized) return undefined;
  const compact = normalized.replace(/\([^)]*\)/g, "").replace(/[^A-Z0-9]/g, "");
  const familyPatterns = [
    /^(?:VAZ|BAZ)(\d{4})/, // ВАЗ-21120 and MANN's shortened numeric family 2112
    /^([A-Z]{2}\d{3})/, // Mercedes OM642, Toyota 1GD...
    /^([A-Z]\d{2}[A-Z]\d{2})/, // BMW B57D30, M57D30
    /^([A-Z]\d{2}[A-Z])/, // Honda D17A5 -> D17A
    /^([A-Z]\d[A-Z]{2})/, // Hyundai/Kia G4NA, D4HB
    /^([A-Z]\d[A-Z])/, // Renault K7M, H4M
    /^(\d[A-Z]{2})/, // Toyota 2GR-FKS, 1AR-FE
    /^([A-Z]{2,3}\d)/, // Mazda SHY6 and similar short families
    /^([A-Z]\d)/, // Mazda Z6, Z601 and similar short engine families
  ];
  return familyPatterns.map((pattern) => compact.match(pattern)?.[1]).find(Boolean) ?? compact;
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
  const compactLiters = [...value.matchAll(/\b(\d{1,2}[.,]\d{1,3})(?=\s*(?:[A-ZА-Я]|\(|\)|\+|,|;|$))/gi)]
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
  return unique(String(value ?? "").split(/[;,/|]+/).map((part) => normalizeEngineCode(
    part.replace(/\b(?:AND ALWAYS|UND IMMER|FOR OUR COMPLETE).*$/i, "").trim()
  )));
}

export function normalizeMannFuel(value?: string | null): MannFuelKind | undefined {
  const normalized = text(value).toUpperCase();
  if (!normalized) return undefined;
  // Order matters: plug-in/mild/bi-fuel markers are more specific than their
  // component words. Markers are often glued to displacement ("2.0LPG").
  if (/(?:PHEV|PLUG[ -]?IN\s+HYBRID)/.test(normalized)) return "phev";
  if (/(?:MHEV|MILD[ -]?HYBRID)/.test(normalized)) return "mhev";
  if (/(?:BI[ -]?FUEL|BIVALENT|DUAL[ -]?FUEL)/.test(normalized)) return "bifuel";
  if (/(?:LPG|AUTOGAS|PROPANE|ПРОПАН)/.test(normalized)) return "lpg";
  if (/(?:CNG|METHANE|МЕТАН)/.test(normalized)) return "cng";
  if (/\b(?:HEV|FULL[ -]?HYBRID|HYBRID|ГИБРИД)\b/.test(normalized)) return "hev";
  if (/\b(?:BEV|EV|EL|ELECTRIC|ЭЛЕКТР)\b/.test(normalized)) return "electric";
  if (normalized === "D" || /(?:DIESEL|ДИЗЕЛ|TDI|TDCI|DCI|DDIS|CRDI|CDI|D-?4D|DI-?D|HDI|JTD|MULTIJET|BLUEHDI|BLUETEC)/.test(normalized)) return "diesel";
  if (/^(?:PO|PA)$/.test(normalized) || /(?:PETROL|GASOLINE|БЕНЗ|GDI|MPI|TSI|TFSI|FSI|VVT|CVVT|ECOBOOST)/.test(normalized)) return "gasoline";
  return undefined;
}

export function mannFuelCompatibility(input?: MannFuelKind, candidate?: MannFuelKind): MannFuelCompatibility {
  if (!input || !candidate) return "unknown";
  if (input === candidate) return "exact";
  if ((input === "bifuel" && ["lpg", "cng"].includes(candidate)) || (candidate === "bifuel" && ["lpg", "cng"].includes(input))) return "compatible";
  if ([input, candidate].includes("electric")) return "conflict";
  if (["hev", "phev", "mhev"].includes(input) || ["hev", "phev", "mhev"].includes(candidate)) return "conditional";
  // A dedicated LPG/CNG/BiFuel MANN row describes a different powertrain
  // variant. A plain gasoline decode must not be treated as an exact match.
  if (["bifuel", "lpg", "cng"].includes(input) || ["bifuel", "lpg", "cng"].includes(candidate)) return "conflict";
  return "conflict";
}

function fuelFromRow(row: MannRow): MannFuelKind | undefined {
  return normalizeMannFuel(`${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""} ${row.condition ?? ""}`);
}

function makeForms(make: string): string[] {
  const canonical = normalizeVehicleMake(make) ?? normalizeMannText(make);
  return unique([canonical, ...(MANN_MAKE_FORMS[canonical] ?? [])].map((item) => normalizeMannText(item)));
}

export function mannMakeFormsForTest(make: string): string[] {
  return makeForms(make);
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === "string")) : [];
}

export async function normalizeDecodedVehicle(vehicle: DecodedVehicle): Promise<NormalizedMannVehicle | null> {
  const canonicalMake = normalizeVehicleMake(vehicle.makeCanonical ?? vehicle.makeRaw);
  const rawModel = vehicle.modelRaw ?? vehicle.modelCanonical ?? "";
  if (!canonicalMake || !rawModel) return null;
  const aliases = await prisma.vehicleModelAlias.findMany({ where: { normalizedMake: canonicalMake, source: { not: "manual" } } });
  const sourceName = normalizeMannSearchText(rawModel);
  const alias = aliases.find((item) => normalizeMannSearchText(item.sourceName) === sourceName);
  const model = normalizeVehicleModel(rawModel, canonicalMake);
  const baseModel = alias?.canonicalBaseModel ?? canonicalBaseModel(model.canonical ?? rawModel, canonicalMake);
  if (!baseModel) return null;
  const aliasBodyCodes = alias ? jsonStrings(alias.bodyCodesJson) : [];
  const generation = alias?.canonicalGeneration ?? vehicleGeneration(
    `${vehicle.generationCanonical ?? ""} ${vehicle.generationRaw ?? ""} ${rawModel}`,
  );
  return {
    canonicalMake,
    baseModel,
    generation,
    bodyCodes: unique([
      ...aliasBodyCodes,
      ...bodyCodesFromText(vehicle.bodyCode),
      ...bodyCodesFromText(vehicle.bodyName),
      ...bodyCodesFromText(vehicle.generationCanonical),
      ...bodyCodesFromText(vehicle.generationRaw),
      ...bodyCodesFromText(rawModel),
    ]).filter((code) => code !== generation && code !== generation?.split(".")[0]),
    year: safeYear(vehicle.year),
    exactEngineCode: normalizeEngineCode(vehicle.engineCode ?? vehicle.engineSeries),
    engineFamily: engineFamily(vehicle.engineCode ?? vehicle.engineSeries),
    engineVolumeCc: vehicle.engineVolumeCc ?? (vehicle.engineVolumeLiters ? Math.round(vehicle.engineVolumeLiters * 1000) : undefined),
    powerKw: vehicle.powerKw ? Math.round(vehicle.powerKw) : undefined,
    powerHp: vehicle.powerHp ? Math.round(vehicle.powerHp) : vehicle.powerPs ? Math.round(vehicle.powerPs) : undefined,
    fuelType: normalizeMannFuel(vehicle.fuelType),
    transmissionType: text(vehicle.transmissionType || vehicle.transmissionName) || undefined,
    driveType: text(vehicle.driveType) || undefined,
  };
}

function rowGeneration(row: MannRow): string | undefined {
  return vehicleGeneration(`${row.model} ${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""}`);
}

function rowBodyCodes(row: MannRow): string[] {
  const generation = rowGeneration(row);
  const alphabeticPlatformCodes = [...row.model.matchAll(/\(([A-Z]{2,3})\)/gi)].map((match) => match[1]?.toUpperCase());
  return unique([
    ...bodyCodesFromText(`${row.model} ${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""}`),
    ...alphabeticPlatformCodes,
  ])
    .filter((code) => code !== generation && code !== generation?.split(".")[0]);
}

function engineVolumeMatches(left?: number | null, right?: number | null): boolean {
  if (!left || !right) return false;
  return Math.round(left / 100) === Math.round(right / 100)
    && Math.abs(left - right) <= Math.max(60, Math.round(Math.max(left, right) * 0.025));
}

function isGenericMannVariant(row: MannRow): boolean {
  return /^(?:ALL MODELS|ВСЕ МОДЕЛИ)$/.test(
    normalizeMannSearchText(row.effectiveVehicleText ?? row.vehicleText)
  );
}

function isQualifierOnlyVariant(row: MannRow): boolean {
  return !isGenericMannVariant(row) && isMannNonVehicleVariantText(row.effectiveVehicleText ?? row.vehicleText);
}

function cleanCandidateText(value: string | null): string | null {
  if (!value) return value;
  const contaminated = value.match(/^\d{2,3}\s+(\d(?:[.,]\d{1,3}))\s+\+{3}/);
  return contaminated?.[1]?.replace(",", ".") ?? value;
}

function cleanCandidateEngineCode(value: string | null): string | null {
  if (!value || !/(?:AND ALWAYS|UND IMMER|FOR OUR COMPLETE)/i.test(value)) return value;
  return engineCodes(value).join(", ") || null;
}

function candidateFromRow(row: MannRow, score: number, matchedFields: string[], mismatchedFields: string[], missingFields: string[], reasons: string[], warnings: string[], featureContributions: MannVehicleCandidate["featureContributions"]): MannVehicleCandidate {
  return {
    applicationId: row.vehicleVariantKey,
    variantId: row.vehicleVariantKey,
    variantIds: [row.vehicleVariantKey],
    make: row.make,
    model: row.model,
    vehicleText: cleanCandidateText(row.vehicleText),
    effectiveVehicleText: cleanCandidateText(row.effectiveVehicleText),
    engineCode: cleanCandidateEngineCode(row.engineCode),
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
    featureContributions,
  };
}

function normalizedTransmission(value?: string | null): "automatic" | "manual" | undefined {
  const normalized = text(value).toUpperCase();
  if (/\b(?:AUT|AT|AUTOMATIC|AUTOMATIK|CVT|DCT|DSG)\b/.test(normalized)) return "automatic";
  if (/\b(?:MAN|MT|MANUAL|SCHALTGETRIEBE)\b/.test(normalized)) return "manual";
  return undefined;
}

function normalizedDrive(value?: string | null): "awd" | "fwd" | "rwd" | undefined {
  const normalized = text(value).toUpperCase();
  if (/(?:\b4WD\b|\bAWD\b|ALL[ _-]?WHEEL|QUATTRO|4MATIC|XDRIVE)/.test(normalized)) return "awd";
  if (/(?:\bFWD\b|FRONT[ _-]?WHEEL)/.test(normalized)) return "fwd";
  if (/(?:\bRWD\b|REAR[ _-]?WHEEL)/.test(normalized)) return "rwd";
  return undefined;
}

function yearMatchesRow(year: number | undefined, row: MannRow): boolean {
  if (!year || (row.vehicleYearFrom == null && row.vehicleYearTo == null)) return false;
  return (row.vehicleYearFrom == null || year >= row.vehicleYearFrom) && (row.vehicleYearTo == null || year <= row.vehicleYearTo);
}

function powerMatchesRow(vehicle: NormalizedMannVehicle, row: MannRow): boolean {
  const candidateKw = numberFromText(row.kw);
  const candidateHp = numberFromText(row.hp);
  if (vehicle.powerKw && candidateKw != null) return Math.abs(vehicle.powerKw - candidateKw) <= Math.max(3, vehicle.powerKw * 0.035);
  if (vehicle.powerHp && candidateHp != null) return Math.abs(vehicle.powerHp - candidateHp) <= Math.max(5, vehicle.powerHp * 0.035);
  return false;
}

function rowAnchorStrength(vehicle: NormalizedMannVehicle, row: MannRow): number {
  let strength = 0;
  const codes = engineCodes(row.engineCode);
  const families = unique(codes.map(engineFamily));
  if (vehicle.exactEngineCode && codes.includes(vehicle.exactEngineCode)) strength += 4;
  else if (vehicle.engineFamily && families.includes(vehicle.engineFamily)) strength += 3;
  const vehicleCodes = vehicle.bodyCodes.filter((code) => normalizeMannSearchText(code) !== vehicle.baseModel);
  const candidateCodes = rowBodyCodes(row).filter((code) => normalizeMannSearchText(code) !== vehicle.baseModel);
  if (vehicleCodes.some((vehicleCode) => candidateCodes.some((candidateCode) => bodyCodesCompatible(vehicleCode, candidateCode)))) strength += 3;
  if (yearMatchesRow(vehicle.year, row)) strength += 1;
  if (engineVolumeMatches(vehicle.engineVolumeCc, engineVolumeCcFromRow(row))) strength += 2;
  if (powerMatchesRow(vehicle, row)) strength += 2;
  return strength;
}

function scoreRow(vehicle: NormalizedMannVehicle, row: MannRow): MannCandidateEvaluation {
  const reject = (reason: string) => ({ rejected: { applicationId: row.vehicleVariantKey, model: row.model, reasons: [reason] } });
  if (isGenericMannVariant(row)) return reject("общая применяемость MANN, не модификация автомобиля");
  if (isQualifierOnlyVariant(row)) return reject("служебное условие PDF, не модификация автомобиля");
  const rowMake = normalizeVehicleMake(row.make);
  if (!rowMake || rowMake !== vehicle.canonicalMake) return reject("марка не совпадает");
  const rowModels = candidateBaseModels(row, vehicle.canonicalMake);
  const baseModelSimilarity = Math.max(0, ...rowModels.map((rowModel) => modelSimilarity(rowModel, vehicle.baseModel)));
  const anchorStrength = rowAnchorStrength(vehicle, row);
  if (baseModelSimilarity < 0.8 && anchorStrength < 3) return reject("базовая модель не совпадает");

  let rawScore = 0;
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];
  const missingFields: string[] = [];
  const reasons: string[] = [];
  const warnings: string[] = [];
  const featureContributions: MannVehicleCandidate["featureContributions"] = [];
  const contribute = (feature: string, evidence: string, weight: number, state: "match" | "mismatch" | "missing") => {
    rawScore += weight;
    featureContributions.push({ feature, evidence, weight });
    if (state === "match") matchedFields.push(feature);
    if (state === "mismatch") mismatchedFields.push(feature);
    if (state === "missing") missingFields.push(feature);
  };

  contribute("марка", `${vehicle.canonicalMake} = ${row.make}`, 8, "match");
  contribute("базовая модель", `${vehicle.baseModel} ↔ ${rowModels.join(" / ")}`, baseModelSimilarity >= 0.8 ? Math.round(22 * baseModelSimilarity) : -12, baseModelSimilarity >= 0.8 ? "match" : "mismatch");
  reasons.push(`model similarity ${baseModelSimilarity.toFixed(2)}`);
  if (baseModelSimilarity < 0.8) {
    contribute("структурированные признаки", `anchor strength ${anchorStrength}`, Math.min(14, anchorStrength * 4), "match");
    reasons.push(`retrieved by structured anchors ${anchorStrength}`);
  }

  const candidateGeneration = rowGeneration(row);
  if (vehicle.generation && candidateGeneration) {
    if (vehicle.generation === candidateGeneration) contribute("поколение", `${vehicle.generation}`, 12, "match");
    else contribute("поколение", `${vehicle.generation} ≠ ${candidateGeneration}`, -15, "mismatch");
  } else if (vehicle.generation) {
    contribute("поколение MANN", "нет структурированного поколения", 0, "missing");
  }

  const vehicleBodyCodes = vehicle.bodyCodes.filter((code) => normalizeMannSearchText(code) !== vehicle.baseModel);
  const rowCodes = rowBodyCodes(row).filter((code) => normalizeMannSearchText(code) !== vehicle.baseModel);
  if (vehicleBodyCodes.length > 0 && rowCodes.length > 0) {
    const compatible = rowCodes.some((rowCode) => vehicleBodyCodes.some((vehicleCode) => bodyCodesCompatible(rowCode, vehicleCode)));
    contribute("код кузова", `${vehicleBodyCodes.join(",")} ${compatible ? "≈" : "≠"} ${rowCodes.join(",")}`, compatible ? 14 : -18, compatible ? "match" : "mismatch");
  } else if (vehicleBodyCodes.length > 0) {
    contribute("код кузова MANN", "код отсутствует", 0, "missing");
  }

  if (vehicle.year) {
    if (row.vehicleYearFrom != null || row.vehicleYearTo != null) {
      const before = row.vehicleYearFrom != null ? row.vehicleYearFrom - vehicle.year : 0;
      const after = row.vehicleYearTo != null ? vehicle.year - row.vehicleYearTo : 0;
      const distance = Math.max(before, after, 0);
      if (distance === 0) contribute("год", `${vehicle.year} ∈ ${row.vehicleYears ?? `${row.vehicleYearFrom ?? "…"}-${row.vehicleYearTo ?? "…"}`}`, 10, "match");
      else {
        contribute("год", `${vehicle.year} вне ${row.vehicleYears ?? `${row.vehicleYearFrom ?? "…"}-${row.vehicleYearTo ?? "…"}`}`, distance === 1 ? -4 : -12, "mismatch");
        if (distance === 1) warnings.push("Граница модельного года отличается на один год.");
      }
    } else {
      contribute("диапазон годов MANN", "диапазон отсутствует", 0, "missing");
    }
  }

  const candidateCodes = engineCodes(row.engineCode);
  const candidateFamilies = unique(candidateCodes.map(engineFamily));
  const hasSpecificCandidateEngineCode = candidateCodes.some((code) => code.replace(/[^A-Z0-9]/g, "").length >= 4);
  const exactEngineMatch = Boolean(vehicle.exactEngineCode && candidateCodes.includes(vehicle.exactEngineCode));
  const familyEngineMatch = Boolean(vehicle.engineFamily && candidateFamilies.includes(vehicle.engineFamily));
  if (vehicle.exactEngineCode) {
    if (exactEngineMatch) contribute("точный код двигателя", `${vehicle.exactEngineCode}`, 24, "match");
    else if (familyEngineMatch) contribute("семейство двигателя", `${vehicle.engineFamily}`, 17, "match");
    else if (candidateCodes.length > 0 && hasSpecificCandidateEngineCode) contribute("код двигателя", `${vehicle.exactEngineCode} ≠ ${candidateCodes.join(",")}`, -24, "mismatch");
    else if (candidateCodes.length > 0) contribute("код двигателя MANN", `${candidateCodes.join(",")} — общее обозначение семейства`, 0, "missing");
    else contribute("код двигателя MANN", "код отсутствует", 0, "missing");
  } else if (vehicle.engineFamily) {
    if (familyEngineMatch) contribute("семейство двигателя", `${vehicle.engineFamily}`, 17, "match");
    else if (candidateFamilies.length > 0 && hasSpecificCandidateEngineCode) contribute("семейство двигателя", `${vehicle.engineFamily} ≠ ${candidateFamilies.join(",")}`, -18, "mismatch");
  }

  const candidateVolumeCc = engineVolumeCcFromRow(row);
  if (vehicle.engineVolumeCc) {
    if (candidateVolumeCc) {
      const compatible = engineVolumeMatches(vehicle.engineVolumeCc, candidateVolumeCc);
      contribute("объём двигателя", `${vehicle.engineVolumeCc} ${compatible ? "≈" : "≠"} ${candidateVolumeCc} см³`, compatible ? 10 : -15, compatible ? "match" : "mismatch");
    } else {
      contribute("объём двигателя MANN", "объём отсутствует", 0, "missing");
    }
  }

  const candidateKw = numberFromText(row.kw);
  const candidateHp = numberFromText(row.hp);
  const inputKw = vehicle.powerKw;
  const inputHp = vehicle.powerHp ?? (inputKw ? Math.round(inputKw * 1.35962) : undefined);
  if (inputKw || inputHp) {
    if (candidateKw != null || candidateHp != null) {
      const relativeDelta = inputKw != null && candidateKw != null
        ? Math.abs(candidateKw - inputKw) / Math.max(inputKw, candidateKw)
        : inputHp != null && candidateHp != null
          ? Math.abs(candidateHp - inputHp) / Math.max(inputHp, candidateHp)
          : 1;
      const exact = (inputKw != null && candidateKw != null && Math.abs(candidateKw - inputKw) <= 0.75)
        || (inputHp != null && candidateHp != null && Math.abs(candidateHp - inputHp) <= 0.75);
      const close = exact
        || (inputKw != null && candidateKw != null && Math.abs(candidateKw - inputKw) <= 3)
        || (inputHp != null && candidateHp != null && Math.abs(candidateHp - inputHp) <= 5)
        || relativeDelta <= 0.035;
      const weight = exact ? 8 : close ? 6 : relativeDelta <= 0.12 ? -5 : -14;
      contribute("мощность", `${inputKw ?? "?"} кВт/${inputHp ?? "?"} л.с. ${close ? "≈" : "≠"} ${candidateKw ?? "?"} кВт/${candidateHp ?? "?"} л.с.`, weight, close ? "match" : "mismatch");
    } else {
      contribute("мощность MANN", "мощность отсутствует", 0, "missing");
    }
  }

  const rowFuel = fuelFromRow(row);
  if (vehicle.fuelType) {
    if (rowFuel) {
      const compatibility = mannFuelCompatibility(vehicle.fuelType, rowFuel);
      const weight = compatibility === "exact" ? 7 : compatibility === "compatible" ? 3 : compatibility === "conditional" ? -4 : -18;
      const isMatch = compatibility === "exact" || compatibility === "compatible";
      contribute("топливо", `${vehicle.fuelType} ${compatibility} ${rowFuel}`, weight, isMatch ? "match" : "mismatch");
      if (compatibility === "conditional") warnings.push("Тип гибридной силовой установки нужно подтвердить.");
    } else {
      contribute("топливо MANN", "тип топлива не извлечён", 0, "missing");
    }
  }

  const rowText = `${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""} ${row.condition ?? ""}`;
  const inputTransmission = normalizedTransmission(vehicle.transmissionType);
  const candidateTransmission = normalizedTransmission(rowText);
  if (inputTransmission && candidateTransmission) {
    const compatible = inputTransmission === candidateTransmission;
    contribute("коробка", `${inputTransmission} ${compatible ? "=" : "≠"} ${candidateTransmission}`, compatible ? 3 : -5, compatible ? "match" : "mismatch");
  }
  const inputDrive = normalizedDrive(vehicle.driveType);
  const candidateDrive = normalizedDrive(rowText);
  if (inputDrive && candidateDrive) {
    const compatible = inputDrive === candidateDrive;
    contribute("привод", `${inputDrive} ${compatible ? "=" : "≠"} ${candidateDrive}`, compatible ? 3 : -5, compatible ? "match" : "mismatch");
  }
  if (row.condition) warnings.push("У строки MANN есть дополнительное условие применяемости; оно не повышает score без подтверждения.");

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  return { candidate: candidateFromRow(row, score, matchedFields, mismatchedFields, missingFields, reasons, warnings, featureContributions) };
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
  const generation = vehicleGeneration(`${vehicle.generationCanonical ?? ""} ${vehicle.generationRaw ?? ""} ${rawModel}`);
  return {
    canonicalMake,
    baseModel,
    generation,
    bodyCodes: unique([
      ...bodyCodesFromText(vehicle.bodyCode),
      ...bodyCodesFromText(vehicle.bodyName),
      ...bodyCodesFromText(vehicle.generationCanonical),
      ...bodyCodesFromText(vehicle.generationRaw),
      ...bodyCodesFromText(rawModel),
    ]).filter((code) => code !== generation && code !== generation?.split(".")[0]),
    year: safeYear(vehicle.year),
    exactEngineCode: normalizeEngineCode(vehicle.engineCode ?? vehicle.engineSeries),
    engineFamily: engineFamily(vehicle.engineCode ?? vehicle.engineSeries),
    engineVolumeCc: vehicle.engineVolumeCc ?? (vehicle.engineVolumeLiters ? Math.round(vehicle.engineVolumeLiters * 1000) : undefined),
    powerKw: vehicle.powerKw ? Math.round(vehicle.powerKw) : undefined,
    powerHp: vehicle.powerHp ? Math.round(vehicle.powerHp) : vehicle.powerPs ? Math.round(vehicle.powerPs) : undefined,
    fuelType: normalizeMannFuel(vehicle.fuelType),
    transmissionType: text(vehicle.transmissionType || vehicle.transmissionName) || undefined,
    driveType: text(vehicle.driveType) || undefined,
  };
}

function confidenceFor(candidate: MannVehicleCandidate, runnerUp: MannVehicleCandidate | undefined, isTop: boolean): MannVehicleCandidate["confidence"] {
  if (!isTop) return candidate.score >= 50 ? "medium" : "low";
  const gap = candidate.score - (runnerUp?.score ?? 0);
  const matched = new Set(candidate.matchedFields);
  const hasPowertrainAnchor = matched.has("точный код двигателя")
    || matched.has("семейство двигателя")
    || (matched.has("объём двигателя") && matched.has("мощность"));
  const hasChassisAnchor = matched.has("поколение") || matched.has("код кузова") || matched.has("год");
  const evidenceCount = candidate.matchedFields.filter((field) => !["марка", "базовая модель"].includes(field)).length;
  const completenessDenominator = evidenceCount + candidate.mismatchedFields.length + candidate.missingFields.length;
  const completeness = completenessDenominator > 0 ? evidenceCount / completenessDenominator : 0;
  const separated = gap >= 12;
  const hasStrongModel = candidate.featureContributions.some((item) => item.feature === "базовая модель" && item.weight >= 20);
  const strongGroups = [hasStrongModel, hasPowertrainAnchor, hasChassisAnchor].filter(Boolean).length;
  if (
    candidate.score >= 78
    && separated
    && candidate.mismatchedFields.length === 0
    && hasPowertrainAnchor
    && hasStrongModel
    && strongGroups >= 2
    && (hasChassisAnchor || evidenceCount >= 4)
    && completeness >= 0.5
  ) return "high";
  if (candidate.score >= 50 && (hasPowertrainAnchor || hasChassisAnchor)) return "medium";
  return "low";
}

function rowEvidenceCompleteness(row: MannRow): number {
  return [row.engineCode, row.kw, row.hp, row.vehicleYearFrom, row.vehicleYearTo, row.condition]
    .filter((value) => value != null && value !== "").length;
}

function retrieveMannRows(vehicle: NormalizedMannVehicle, rows: MannRow[], limit = 100): MannRow[] {
  const byVariant = new Map<string, MannRow>();
  for (const row of rows) {
    const current = byVariant.get(row.vehicleVariantKey);
    if (!current || rowEvidenceCompleteness(row) > rowEvidenceCompleteness(current)) byVariant.set(row.vehicleVariantKey, row);
  }

  const evaluated = [...byVariant.values()]
    .filter((row) => !isGenericMannVariant(row) && !isQualifierOnlyVariant(row))
    .map((row) => ({
      row,
      similarity: Math.max(0, ...candidateBaseModels(row, vehicle.canonicalMake).map((model) => modelSimilarity(model, vehicle.baseModel))),
      anchorStrength: rowAnchorStrength(vehicle, row),
    }));
  const hasModelCandidates = evaluated.some((candidate) => candidate.similarity >= 0.72);
  return evaluated
    .filter((candidate) => candidate.similarity >= 0.72 || (!hasModelCandidates && candidate.anchorStrength >= 3))
    .sort((left, right) => Number(right.anchorStrength >= 3) - Number(left.anchorStrength >= 3) || right.similarity - left.similarity || right.anchorStrength - left.anchorStrength || rowEvidenceCompleteness(right.row) - rowEvidenceCompleteness(left.row) || left.row.vehicleVariantKey.localeCompare(right.row.vehicleVariantKey))
    .slice(0, limit)
    .map((candidate) => candidate.row);
}

function rankMannRows(vehicle: NormalizedMannVehicle, rows: MannRow[]) {
  const retrievalStartedAt = performance.now();
  const retrievedRows = retrieveMannRows(vehicle, rows);
  const retrievalMs = performance.now() - retrievalStartedAt;

  const scoringStartedAt = performance.now();
  const accepted: MannVehicleCandidate[] = [];
  const rejected: Rejection[] = [];
  for (const row of retrievedRows) {
    const result = scoreRow(vehicle, row);
    if (result.candidate) accepted.push(result.candidate);
    if (result.rejected) rejected.push(result.rejected);
  }
  const groupedCandidates = new Map<string, MannVehicleCandidate>();
  for (const candidate of accepted) {
    const key = [candidate.make, candidate.model, candidate.effectiveVehicleText ?? candidate.vehicleText, candidate.engineCode, candidate.kw, candidate.hp, candidate.vehicleYears]
      .map((value) => normalizeMannSearchText(value))
      .join("|");
    const current = groupedCandidates.get(key);
    if (!current) {
      groupedCandidates.set(key, candidate);
      continue;
    }
    const preferred = candidate.score > current.score || (candidate.score === current.score && current.condition && !candidate.condition) ? candidate : current;
    groupedCandidates.set(key, {
      ...preferred,
      variantIds: unique([...current.variantIds, ...candidate.variantIds]),
      warnings: unique([...current.warnings, ...candidate.warnings]),
    });
  }
  const consolidated = [...groupedCandidates.values()];
  consolidated.sort((left, right) => right.score - left.score || left.model.localeCompare(right.model, "ru") || left.applicationId.localeCompare(right.applicationId));
  const scoringMs = performance.now() - scoringStartedAt;
  return {
    rankedCandidates: consolidated.map((candidate, index, all) => ({
      ...candidate,
      confidence: confidenceFor(candidate, all[index + 1], index === 0),
    })),
    rejected,
    sourceRowCount: rows.length,
    retrievedCount: retrievedRows.length,
    timings: { retrievalMs, scoringMs },
  };
}

/** Uses the production ranker in catalogue-wide audits without opening a database connection. */
export function rankMannCandidatesForTest(vehicle: NormalizedMannVehicle, rows: MannResolverTestRow[]): MannVehicleCandidate[] {
  return rankMannRows(vehicle, rows).rankedCandidates;
}

/** Returns sanitized ranking diagnostics for catalogue audits and regression analysis. */
export function diagnoseMannCandidatesForTest(vehicle: NormalizedMannVehicle, rows: MannResolverTestRow[]) {
  return rankMannRows(vehicle, rows);
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
  const filterGroups = await Promise.all(candidate.variantIds.map((variantId) => listMannFilters({ make: candidate.make, model: candidate.model, variantId, year: options.vehicle.year })));
  const filters = [...new Map(filterGroups.flat().map((filter) => [
    `${filter.filterType}:${filter.filterSubtype ?? ""}:${filter.mannArticleNormalized}`,
    filter,
  ])).values()];
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
  if (mapping.engineVolumeCc && vehicle.engineVolumeCc && !engineVolumeMatches(mapping.engineVolumeCc, vehicle.engineVolumeCc)) return false;
  if (mapping.powerKw && vehicle.powerKw && Math.abs(mapping.powerKw - vehicle.powerKw) > 3) return false;
  if (mapping.powerHp && vehicle.powerHp && Math.abs(mapping.powerHp - vehicle.powerHp) > 5) return false;
  if (mapping.fuelType && vehicle.fuelType && mapping.fuelType !== vehicle.fuelType) return false;
  if (mapping.driveType && vehicle.driveType && mapping.driveType !== vehicle.driveType) return false;
  return true;
}

export async function resolveMannVehicle(options: ResolveOptions): Promise<MannVehicleResolution> {
  const startedAt = Date.now();
  const normalized = await normalizeDecodedVehicle(options.vehicle);
  const emptyPrefill: MannSafePrefill = { makeId: null, makeLabel: null, modelQuery: "", selectedModelId: null, year: null, modificationQuery: "", selectedModificationId: null };
  if (!normalized) {
    return { status: "unresolved", decision: "NO_MATCH", decodeConfidence: options.vehicle.confidence, mannConfidence: "none", safePrefill: emptyPrefill, selectedApplication: null, selection: null, candidates: [], filters: [], localMatches: [], usedManualMapping: false, endToEndStatus: "VEHICLE_NO_MATCH", failureCode: "MANN_NORMALIZATION_FAILED" };
  }

  const forms = makeForms(normalized.canonicalMake);
  const queryStartedAt = Date.now();
  const rows = await prisma.mannFilterApplication.findMany({
    where: { makeNormalized: { in: forms } },
    select: { vehicleVariantKey: true, make: true, makeNormalized: true, model: true, modelNormalized: true, vehicleText: true, effectiveVehicleText: true, engineCode: true, engineCodeNormalized: true, kw: true, hp: true, vehicleYears: true, vehicleYearFrom: true, vehicleYearTo: true, condition: true },
    take: 25_000,
  }) as MannRow[];
  const queryMs = Date.now() - queryStartedAt;
  const matchingMake = rows[0]?.make ?? null;
  const rankStartedAt = Date.now();
  const { rankedCandidates, rejected, sourceRowCount, retrievedCount } = rankMannRows(normalized, rows);
  const rankMs = Date.now() - rankStartedAt;
  const candidates = rankedCandidates
    .filter((candidate) => candidate.score >= MANN_MIN_PRESENTABLE_SCORE)
    .slice(0, 5);

  const mappings = await prisma.vehicleMannMapping.findMany({
    where: { organizationId: options.organizationId, normalizedMake: normalized.canonicalMake, normalizedModel: normalized.baseModel },
    orderBy: { updatedAt: "desc" },
  });
  const mapping = mappings.find((item) => mappingMatchesVehicle(item, normalized));
  // Until the new blind holdout is complete, HIGH means "safe proposal", not
  // an unconditional selection. Only a persisted human confirmation resolves
  // the vehicle and triggers filter/product lookup.
  let selectedApplication: MannVehicleCandidate | null = null;
  let usedManualMapping = false;
  if (mapping) {
    const mapped = rankedCandidates.find((candidate) => candidate.variantIds.includes(mapping.mannApplicationId));
    if (mapped) {
      selectedApplication = { ...mapped, confidence: "high", reasons: [...mapped.reasons, "подтверждено вручную"] };
      usedManualMapping = true;
    }
  }

  const status = selectedApplication ? "resolved" : candidates.length > 0 ? "candidates" : "unresolved";
  const decision = selectedApplication ? "MATCH" : candidates.length > 0 ? "AMBIGUOUS" : "NO_MATCH";
  const mannConfidence: MannVehicleResolution["mannConfidence"] = selectedApplication ? "high" : candidates[0]?.confidence ?? "none";
  const filtersStartedAt = Date.now();
  const data = status === "resolved" ? await filtersFor(selectedApplication, options) : { filters: [], localMatches: [] as MannArticleMatchResult[] };
  const filtersMs = Date.now() - filtersStartedAt;
  const timingsMs = { query: queryMs, rank: rankMs, filters: filtersMs, total: Date.now() - startedAt };
  const trace = process.env.NODE_ENV === "production"
    ? undefined
    : {
        normalized,
        sourceRowCount,
        retrievedCount,
        accepted: rankedCandidates.slice(0, 10).map((candidate) => ({ applicationId: candidate.applicationId, model: candidate.model, score: candidate.score, confidence: candidate.confidence, featureContributions: candidate.featureContributions })),
        rejected: rejected.slice(0, 50),
        timingsMs,
      };

  if (process.env.MANN_RESOLVER_TRACE === "true") {
    console.info("[mann-resolver]", JSON.stringify({ decision, mannConfidence, sourceRowCount, retrievedCount, topScore: candidates[0]?.score ?? null, topGap: candidates[0] ? candidates[0].score - (candidates[1]?.score ?? 0) : null, timingsMs }));
  }

  const uniqueLocalProducts = data.localMatches.filter((match) => match.status === "found").length;
  const endToEndStatus: MannVehicleResolution["endToEndStatus"] = status === "unresolved"
    ? "VEHICLE_NO_MATCH"
    : status === "candidates"
      ? "VEHICLE_AMBIGUOUS"
      : data.filters.length > 0 && uniqueLocalProducts === data.filters.length
        ? "FILTERS_FOUND_LOCAL_PRODUCTS_COMPLETE"
        : uniqueLocalProducts > 0
          ? "FILTERS_FOUND_LOCAL_PRODUCTS_PARTIAL"
          : "VEHICLE_MATCHED_FILTERS_FOUND";
  const failureCode: MannVehicleResolution["failureCode"] = status === "unresolved"
    ? "MANN_NO_CANDIDATE"
    : status === "candidates"
      ? "MANN_AMBIGUOUS"
      : data.filters.length > 0 && uniqueLocalProducts === 0
        ? "LOCAL_PRODUCTS_MISSING"
        : data.filters.length > uniqueLocalProducts
          ? "LOCAL_PRODUCTS_PARTIAL"
          : undefined;

  return {
    status,
    decision,
    decodeConfidence: options.vehicle.confidence,
    mannConfidence,
    safePrefill: safePrefillFor(normalized, matchingMake, selectedApplication),
    selectedApplication,
    selection: selectedApplication ? selectionFor(selectedApplication, usedManualMapping) : null,
    candidates,
    filters: data.filters,
    localMatches: data.localMatches,
    usedManualMapping,
    endToEndStatus,
    failureCode,
    trace,
  };
}
