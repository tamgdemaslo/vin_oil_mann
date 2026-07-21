import { prisma } from "@/lib/db";
import { listMannFilters, matchMannArticlesToLocalProducts, normalizeMannSearchText, normalizeMannText, type MannArticleMatchResult } from "@/lib/mann-catalog";
import { normalizeEngineCode, normalizeVehicleMake, normalizeVehicleModel, type NormalizedVehicleIdentity } from "@/lib/vehicle-identity";

export type MannVehicleCandidate = {
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

export type MannVehicleResolution = {
  status: "matched" | "needs_confirmation" | "manual_required";
  selected: MannVehicleCandidate | null;
  candidates: MannVehicleCandidate[];
  filters: Awaited<ReturnType<typeof listMannFilters>>;
  localMatches: MannArticleMatchResult[];
  usedManualMapping: boolean;
};

type ResolveOptions = {
  organizationId: string;
  vehicle: NormalizedVehicleIdentity;
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

const MANN_MAKE_FORMS: Record<string, string[]> = {
  MERCEDES: ["MERCEDES", "MERCEDES-BENZ", "MERCEDES BENZ"],
  VOLKSWAGEN: ["VOLKSWAGEN", "VW", "VW (VOLKSWAGEN)"],
  "LAND ROVER": ["LAND ROVER", "LANDROVER"],
  SSANGYONG: ["SSANGYONG", "SSANG YONG"],
  "GREAT WALL": ["GREAT WALL", "GREATWALL"],
};

function numberFromText(value?: string | null): number | null {
  if (!value) return null;
  const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match?.[0]) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function engineCodes(value?: string | null): string[] {
  return String(value ?? "")
    .split(/[;,/|]+/)
    .map((part) => normalizeEngineCode(part))
    .filter((part): part is string => Boolean(part));
}

function engineFamily(value?: string | null): string | null {
  const normalized = normalizeEngineCode(value);
  if (!normalized) return null;
  return normalized.replace(/[A-Z]?\d{0,2}$/i, "") || normalized;
}

function makeForms(make: string): string[] {
  const canonical = normalizeVehicleMake(make) ?? normalizeMannText(make);
  return [...new Set([canonical, ...(MANN_MAKE_FORMS[canonical] ?? [])].map((item) => normalizeMannText(item)))];
}

function modelMatch(vehicle: NormalizedVehicleIdentity, row: MannRow): { points: number; label?: string } {
  const input = normalizeVehicleModel(vehicle.modelRaw ?? vehicle.modelCanonical ?? "", vehicle.makeCanonical).canonical;
  const candidate = normalizeMannSearchText(row.model);
  const normalizedInput = normalizeMannSearchText(input);
  if (!normalizedInput || !candidate) return { points: 0 };
  if (candidate === normalizedInput) return { points: 30, label: "модель" };
  const inputTokens = new Set(normalizedInput.split(" ").filter(Boolean));
  const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
  const shared = [...inputTokens].filter((token) => candidateTokens.has(token));
  if (shared.length > 0 && shared.length === Math.min(inputTokens.size, candidateTokens.size)) return { points: 24, label: "модель (алиас)" };
  const significant = shared.filter((token) => /\d/.test(token) || token.length >= 4);
  if (significant.length > 0) return { points: 12, label: "часть модели" };
  return { points: 0 };
}

function scoreRow(vehicle: NormalizedVehicleIdentity, row: MannRow): MannVehicleCandidate {
  let score = 0;
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];
  const missingFields: string[] = [];
  const reasons: string[] = [];
  const warnings: string[] = [];
  const canonicalMake = normalizeVehicleMake(vehicle.makeCanonical ?? vehicle.makeRaw);
  const rowMake = normalizeVehicleMake(row.make);
  if (!canonicalMake || canonicalMake !== rowMake) {
    return { variantId: row.vehicleVariantKey, make: row.make, model: row.model, vehicleText: row.vehicleText, effectiveVehicleText: row.effectiveVehicleText, engineCode: row.engineCode, kw: row.kw, hp: row.hp, vehicleYears: row.vehicleYears, condition: row.condition, score: -999, confidence: "low", matchedFields, mismatchedFields: ["марка"], missingFields, reasons, warnings };
  }
  matchedFields.push("марка");
  reasons.push(row.make);

  const model = modelMatch(vehicle, row);
  score += model.points;
  if (model.label) {
    matchedFields.push(model.label);
    reasons.push(row.model);
  } else {
    mismatchedFields.push("модель");
  }

  const inputGeneration = vehicle.generationCanonical?.toUpperCase();
  const candidateGeneration = `${row.model} ${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""}`.toUpperCase();
  if (inputGeneration) {
    if (candidateGeneration.includes(inputGeneration)) {
      score += 15;
      matchedFields.push("поколение / кузов");
    } else {
      missingFields.push("поколение / кузов");
    }
  }

  if (vehicle.year) {
    if ((row.vehicleYearFrom == null || vehicle.year >= row.vehicleYearFrom) && (row.vehicleYearTo == null || vehicle.year <= row.vehicleYearTo)) {
      score += 10;
      matchedFields.push("год");
    } else if (row.vehicleYearFrom != null || row.vehicleYearTo != null) {
      return { variantId: row.vehicleVariantKey, make: row.make, model: row.model, vehicleText: row.vehicleText, effectiveVehicleText: row.effectiveVehicleText, engineCode: row.engineCode, kw: row.kw, hp: row.hp, vehicleYears: row.vehicleYears, condition: row.condition, score: -999, confidence: "low", matchedFields, mismatchedFields: ["год"], missingFields, reasons, warnings: ["Год автомобиля вне диапазона MANN"] };
    }
  } else {
    missingFields.push("год");
  }

  const inputEngine = normalizeEngineCode(vehicle.engineCode);
  const candidateCodes = engineCodes(row.engineCode);
  if (inputEngine) {
    if (candidateCodes.includes(inputEngine)) {
      score += 30;
      matchedFields.push("код двигателя");
    } else if (candidateCodes.some((candidate) => engineFamily(candidate) === engineFamily(inputEngine))) {
      score += 22;
      matchedFields.push("семейство двигателя");
    } else if (candidateCodes.length > 0) {
      mismatchedFields.push("код двигателя");
    }
  } else {
    missingFields.push("код двигателя");
  }

  const text = `${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""} ${row.condition ?? ""}`;
  const candidateVolume = numberFromText(text);
  if (vehicle.engineVolumeLiters) {
    if (candidateVolume != null && Math.abs(candidateVolume - vehicle.engineVolumeLiters) <= 0.16) {
      score += 12;
      matchedFields.push("объём двигателя");
    } else if (candidateVolume != null && Math.abs(candidateVolume - vehicle.engineVolumeLiters) > 0.3) {
      mismatchedFields.push("объём двигателя");
    }
  } else {
    missingFields.push("объём двигателя");
  }

  const candidateHp = numberFromText(row.hp);
  const candidateKw = numberFromText(row.kw);
  const inputHp = vehicle.powerHp ?? (vehicle.powerKw ? Math.round(vehicle.powerKw * 1.35962) : undefined);
  if (inputHp) {
    const comparableHp = candidateHp ?? (candidateKw ? Math.round(candidateKw * 1.35962) : null);
    if (comparableHp != null && Math.abs(comparableHp - inputHp) <= 5) {
      score += 8;
      matchedFields.push("мощность");
    } else if (comparableHp != null && Math.abs(comparableHp - inputHp) > 12) {
      mismatchedFields.push("мощность");
      warnings.push(`MANN: ${comparableHp} л.с.; автомобиль: ${inputHp} л.с.`);
    }
  } else {
    missingFields.push("мощность");
  }

  const lowerText = text.toLowerCase();
  if (vehicle.fuelType) {
    if (lowerText.includes(vehicle.fuelType.toLowerCase())) {
      score += 5;
      matchedFields.push("топливо");
    }
  }
  if (vehicle.transmissionType && lowerText.includes(vehicle.transmissionType.toLowerCase())) score += 4;
  if (vehicle.driveType && lowerText.includes(vehicle.driveType.toLowerCase())) score += 4;
  if (row.condition) score += 1;

  return {
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

function confidenceFor(candidate: MannVehicleCandidate, runnerUp: MannVehicleCandidate | undefined): MannVehicleCandidate["confidence"] {
  const gap = candidate.score - (runnerUp?.score ?? -999);
  if (candidate.score >= 85 && gap >= 15) return "high";
  if (candidate.score >= 65) return "medium";
  return "low";
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

export async function resolveMannVehicle(options: ResolveOptions): Promise<MannVehicleResolution> {
  const make = normalizeVehicleMake(options.vehicle.makeCanonical ?? options.vehicle.makeRaw);
  const model = normalizeVehicleModel(options.vehicle.modelRaw ?? options.vehicle.modelCanonical ?? "", make).canonical;
  if (!make || !model) return { status: "manual_required", selected: null, candidates: [], filters: [], localMatches: [], usedManualMapping: false };

  const mapping = await prisma.vehicleMannMapping.findFirst({
    where: { organizationId: options.organizationId, normalizedMake: make, normalizedModel: normalizeMannSearchText(model) },
    orderBy: { updatedAt: "desc" },
  });
  const forms = makeForms(make);
  const rows = await prisma.mannFilterApplication.findMany({
    where: { makeNormalized: { in: forms } },
    select: { vehicleVariantKey: true, make: true, makeNormalized: true, model: true, modelNormalized: true, vehicleText: true, effectiveVehicleText: true, engineCode: true, engineCodeNormalized: true, kw: true, hp: true, vehicleYears: true, vehicleYearFrom: true, vehicleYearTo: true, condition: true },
    take: 25_000,
  }) as MannRow[];
  const byVariant = new Map<string, MannRow>();
  for (const row of rows) {
    const current = byVariant.get(row.vehicleVariantKey);
    if (!current || (row.engineCode && !current.engineCode)) byVariant.set(row.vehicleVariantKey, row);
  }
  let candidates = [...byVariant.values()].map((row) => scoreRow(options.vehicle, row)).filter((candidate) => candidate.score > -999);
  candidates.sort((left, right) => right.score - left.score || left.model.localeCompare(right.model, "ru"));
  candidates = candidates.slice(0, 3).map((candidate, index, all) => ({ ...candidate, confidence: confidenceFor(candidate, all[index + 1]) }));
  let selected = candidates[0] ?? null;
  let usedManualMapping = false;
  if (mapping) {
    const mapped = candidates.find((candidate) => candidate.variantId === mapping.mannApplicationId);
    if (mapped) {
      selected = { ...mapped, confidence: "high", reasons: [...mapped.reasons, "подтверждено вручную"] };
      usedManualMapping = true;
    }
  }
  const status = selected?.confidence === "high" ? "matched" : selected?.confidence === "medium" ? "needs_confirmation" : "manual_required";
  const data = status === "matched" ? await filtersFor(selected, options) : { filters: [], localMatches: [] as MannArticleMatchResult[] };
  return { status, selected: status === "manual_required" ? null : selected, candidates, filters: data.filters, localMatches: data.localMatches, usedManualMapping };
}
