import { createHash } from "node:crypto";
import { MANN_MIN_PRESENTABLE_SCORE, diagnoseMannCandidatesForTest, evaluateMannCandidate, mannMakeFormsForTest, normalizeDecodedVehicleForTest, type MannResolverTestRow, type MannVehicleCandidate, type NormalizedMannVehicle } from "@/lib/mann-vehicle-resolver";
import { normalizeMannSearchText, normalizeMannText } from "@/lib/mann-catalog";

export const MANN_FLUID_MATCHER_VERSION = "mann-fluid-matcher-v2" as const;

export type MannFluidMatchStatus =
  | "CONFIRMED_SINGLE"
  | "CONFIRMED_MULTI_APPLICABILITY"
  | "REVIEW_REQUIRED"
  | "NO_MATCH"
  | "MANN_CATALOG_GAP"
  | "INSUFFICIENT_SOURCE_CONTEXT"
  | "CONFLICT";

export type MannFluidSystemFamily = "ENGINE" | "TRANSMISSION" | "DRIVETRAIN" | "GENERAL";
export type MannFluidFieldConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type MannFluidRequirementForMatch = {
  id: string;
  make: string;
  makeNormalized?: string | null;
  model: string;
  modelNormalized?: string | null;
  generation?: string | null;
  bodyCodesJson?: unknown;
  yearFrom?: number | null;
  yearTo?: number | null;
  engineCodeNormalized?: string | null;
  engineCodesJson?: unknown;
  engineVolumeCc?: number | null;
  powerKw?: number | null;
  powerHp?: number | null;
  fuelType?: string | null;
  driveType?: string | null;
  transmissionType?: string | null;
  componentModel?: string | null;
  systemCode: string;
  systemNameRaw?: string | null;
  fillVolumeText?: string | null;
  specificationText?: string | null;
  specificationsJson?: unknown;
  rawRequirementJson?: unknown;
};

export type MannFluidFieldConfidence = {
  level: MannFluidFieldConfidenceLevel;
  evidence: string[];
};

export type MannFluidTargetDecision = {
  vehicleVariantKey: string;
  independentlyValidated: boolean;
  score: number;
  hardConflicts: string[];
  reviewBlockers: string[];
  matchedFields: string[];
  missingFields: string[];
  condition: string | null;
};

export type MannFluidCandidateDiagnostic = {
  rank: number;
  variantIds: string[];
  make: string;
  model: string;
  vehicleText: string | null;
  engineCode: string | null;
  vehicleYears: string | null;
  score: number;
  confidence: MannVehicleCandidate["confidence"];
  eligible: boolean;
  independentlyValidatedTargets: number;
  hardConflicts: string[];
  reviewBlockers: string[];
  matchedFields: string[];
  mismatchedFields: string[];
  missingFields: string[];
  warnings: string[];
  featureContributions: MannVehicleCandidate["featureContributions"];
};

export type MannFluidMatchDecision = {
  matcherVersion: typeof MANN_FLUID_MATCHER_VERSION;
  requirementId: string;
  status: MannFluidMatchStatus;
  systemFamily: MannFluidSystemFamily;
  normalizedVehicle: NormalizedMannVehicle | null;
  targets: MannFluidTargetDecision[];
  topCandidates: MannFluidCandidateDiagnostic[];
  sourceRowCount: number;
  retrievedCount: number;
  top1Score: number | null;
  top1Top2Gap: number | null;
  conflictTypes: string[];
  reviewReasons: string[];
  fieldConfidence: {
    vehicleApplicability: MannFluidFieldConfidence;
    specification: MannFluidFieldConfidence;
    componentModel: MannFluidFieldConfidence;
  };
  decisionFingerprint: string;
};

type CandidateAssessment = {
  candidate: MannVehicleCandidate;
  targets: MannFluidTargetDecision[];
  hardConflicts: string[];
  reviewBlockers: string[];
  eligible: boolean;
  plausible: boolean;
};

const ENGINE_SYSTEMS = new Set([
  "ENGINE_OIL", "ENGINE_COOLANT", "INTERCOOLER_COOLANT", "INVERTER_COOLANT",
  "AIR_FILTER", "OIL_FILTER", "FUEL_FILTER", "SPARK_PLUG", "GENERATOR_OIL",
]);
const TRANSMISSION_SYSTEMS = new Set([
  "AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION", "CVT_TRANSMISSION",
  "ROBOT_TRANSMISSION", "TRANSMISSION_GENERIC", "CLUTCH_FLUID",
]);
const DRIVETRAIN_SYSTEMS = new Set([
  "TRANSFER_CASE", "FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL",
  "DIFFERENTIAL_GENERIC", "AWD_COUPLING", "PTO", "RETARDER",
]);

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === "string")) : [];
}

export function fluidSystemFamily(systemCode: string): MannFluidSystemFamily {
  if (ENGINE_SYSTEMS.has(systemCode)) return "ENGINE";
  if (TRANSMISSION_SYSTEMS.has(systemCode)) return "TRANSMISSION";
  if (DRIVETRAIN_SYSTEMS.has(systemCode)) return "DRIVETRAIN";
  return "GENERAL";
}

function representativeYear(requirement: MannFluidRequirementForMatch): number | undefined {
  const from = requirement.yearFrom ?? undefined;
  const to = requirement.yearTo ?? undefined;
  if (from && to) return Math.round((from + to) / 2);
  return from ?? to;
}

export function normalizeFluidRequirementVehicle(requirement: MannFluidRequirementForMatch): NormalizedMannVehicle | null {
  const engineCodes = unique([requirement.engineCodeNormalized, ...strings(requirement.engineCodesJson)]);
  const bodyCodes = strings(requirement.bodyCodesJson);
  return normalizeDecodedVehicleForTest({
    makeRaw: requirement.make,
    makeCanonical: requirement.makeNormalized ?? requirement.make,
    modelRaw: requirement.model,
    modelCanonical: requirement.modelNormalized ?? requirement.model,
    generationRaw: requirement.generation ?? undefined,
    generationCanonical: requirement.generation ?? undefined,
    bodyCode: bodyCodes.join(" ") || undefined,
    year: representativeYear(requirement),
    modelYearFrom: requirement.yearFrom ?? undefined,
    modelYearTo: requirement.yearTo ?? undefined,
    engineCode: engineCodes[0],
    engineSeries: engineCodes[1],
    engineVolumeCc: requirement.engineVolumeCc ?? undefined,
    powerKw: requirement.powerKw ?? undefined,
    powerHp: requirement.powerHp ?? undefined,
    fuelType: requirement.fuelType ?? undefined,
    transmissionType: requirement.transmissionType ?? undefined,
    driveType: requirement.driveType ?? undefined,
    sourceMethods: ["manual"],
    confidence: "medium",
    rawResultIds: [requirement.id],
    vinStatus: "unknown",
  });
}

function relevantRowsForMake(vehicle: NormalizedMannVehicle, rows: MannResolverTestRow[]): MannResolverTestRow[] {
  const forms = new Set(mannMakeFormsForTest(vehicle.canonicalMake));
  return rows.filter((row) => forms.has(normalizeMannText(row.makeNormalized || row.make)));
}

function rowCompleteness(row: MannResolverTestRow): number {
  return [row.engineCode, row.kw, row.hp, row.vehicleYearFrom, row.vehicleYearTo, row.condition]
    .filter((value) => value !== null && value !== "").length;
}

function representativeRowsByVariant(rows: MannResolverTestRow[]): Map<string, MannResolverTestRow> {
  const result = new Map<string, MannResolverTestRow>();
  for (const row of rows) {
    const current = result.get(row.vehicleVariantKey);
    const prefer = !current
      || (Boolean(current.condition) && !row.condition)
      || rowCompleteness(row) > rowCompleteness(current);
    if (prefer) result.set(row.vehicleVariantKey, row);
  }
  return result;
}

function sourceContextScore(requirement: MannFluidRequirementForMatch, family: MannFluidSystemFamily): number {
  const engineCodes = unique([requirement.engineCodeNormalized, ...strings(requirement.engineCodesJson)]);
  const hasEngineAnchor = engineCodes.length > 0 || Boolean(requirement.engineVolumeCc && (requirement.powerKw || requirement.powerHp));
  const hasChassisAnchor = Boolean(requirement.generation || strings(requirement.bodyCodesJson).length || requirement.yearFrom || requirement.yearTo);
  const hasSystemAnchor = family === "TRANSMISSION"
    ? Boolean(requirement.transmissionType || requirement.componentModel)
    : family === "DRIVETRAIN"
      ? Boolean(requirement.driveType || requirement.componentModel)
      : true;
  return Number(hasEngineAnchor) * 2 + Number(hasChassisAnchor) + Number(hasSystemAnchor);
}

function yearsOverlap(requirement: MannFluidRequirementForMatch, row: MannResolverTestRow): boolean | null {
  if ((requirement.yearFrom == null && requirement.yearTo == null) || (row.vehicleYearFrom == null && row.vehicleYearTo == null)) return null;
  const requirementFrom = requirement.yearFrom ?? requirement.yearTo ?? Number.NEGATIVE_INFINITY;
  const requirementTo = requirement.yearTo ?? requirement.yearFrom ?? Number.POSITIVE_INFINITY;
  const candidateFrom = row.vehicleYearFrom ?? Number.NEGATIVE_INFINITY;
  const candidateTo = row.vehicleYearTo ?? Number.POSITIVE_INFINITY;
  return Math.max(requirementFrom, candidateFrom) <= Math.min(requirementTo, candidateTo);
}

function conditionCovered(requirement: MannFluidRequirementForMatch, condition: string | null): boolean {
  if (!condition) return true;
  const source = normalizeMannSearchText([
    requirement.componentModel,
    requirement.systemNameRaw,
    requirement.fillVolumeText,
    requirement.specificationText,
    JSON.stringify(requirement.rawRequirementJson ?? {}),
  ].filter(Boolean).join(" "));
  const meaningful = normalizeMannSearchText(condition)
    .split(" ")
    .filter((token) => token.length >= 3 && !["AND", "FOR", "WITH", "WITHOUT", "UND", "MIT", "OHNE"].includes(token));
  return meaningful.length > 0 && meaningful.every((token) => source.includes(token));
}

function hardConflictsFor(
  requirement: MannFluidRequirementForMatch,
  family: MannFluidSystemFamily,
  candidate: MannVehicleCandidate,
  row: MannResolverTestRow,
): string[] {
  const conflicts = [...candidate.mismatchedFields];
  if (yearsOverlap(requirement, row) === false) conflicts.push("диапазон годов не пересекается");
  if (family === "TRANSMISSION" && candidate.mismatchedFields.includes("коробка")) conflicts.push("система трансмиссии противоречит кандидату");
  if (family === "DRIVETRAIN" && candidate.mismatchedFields.includes("привод")) conflicts.push("тип привода противоречит кандидату");
  return unique(conflicts);
}

function candidateEvidence(candidate: MannVehicleCandidate) {
  const matched = new Set(candidate.matchedFields);
  return {
    strongModel: candidate.featureContributions.some((item) => item.feature === "базовая модель" && item.weight >= 18),
    exactEngine: matched.has("точный код двигателя"),
    engineFamily: matched.has("семейство двигателя"),
    volume: matched.has("объём двигателя"),
    power: matched.has("мощность"),
    fuel: matched.has("топливо"),
    chassis: matched.has("поколение") || matched.has("код кузова") || matched.has("год"),
  };
}

function eligibleCandidate(
  requirement: MannFluidRequirementForMatch,
  family: MannFluidSystemFamily,
  candidate: MannVehicleCandidate,
  hardConflicts: string[],
): boolean {
  if (hardConflicts.length > 0) return false;
  const evidence = candidateEvidence(candidate);
  if (!evidence.strongModel) return false;
  const sourceEngineCodes = unique([requirement.engineCodeNormalized, ...strings(requirement.engineCodesJson)]);
  const engineAnchor = sourceEngineCodes.length > 0
    ? evidence.exactEngine || evidence.engineFamily
    : evidence.volume && (evidence.power || evidence.fuel || evidence.chassis);
  if (family === "ENGINE") return candidate.score >= 64 && engineAnchor && (evidence.chassis || evidence.power || evidence.fuel);
  if (family === "TRANSMISSION") return candidate.score >= 62 && engineAnchor && (evidence.chassis || Boolean(requirement.componentModel));
  if (family === "DRIVETRAIN") return candidate.score >= 60 && (engineAnchor || evidence.chassis) && (evidence.chassis || Boolean(requirement.driveType));
  if (sourceEngineCodes.length > 0) return candidate.score >= 60 && engineAnchor;
  return candidate.score >= 50 && evidence.chassis;
}

function assessCandidate(
  requirement: MannFluidRequirementForMatch,
  family: MannFluidSystemFamily,
  candidate: MannVehicleCandidate,
  rowsByVariant: Map<string, MannResolverTestRow>,
): CandidateAssessment {
  const targets: MannFluidTargetDecision[] = [];
  for (const variantId of candidate.variantIds) {
    const row = rowsByVariant.get(variantId);
    if (!row) {
      targets.push({
        vehicleVariantKey: variantId,
        independentlyValidated: false,
        score: candidate.score,
        hardConflicts: ["строка vehicleVariantKey отсутствует в read-only наборе"],
        reviewBlockers: [],
        matchedFields: candidate.matchedFields,
        missingFields: candidate.missingFields,
        condition: candidate.condition,
      });
      continue;
    }
    const independent = evaluateMannCandidate(normalizeFluidRequirementVehicle(requirement) as NormalizedMannVehicle, row).candidate;
    const hardConflicts = independent ? hardConflictsFor(requirement, family, independent, row) : ["production resolver отклонил цель"];
    const reviewBlockers = independent && !conditionCovered(requirement, row.condition)
      ? ["не подтверждено дополнительное условие применяемости MANN"]
      : [];
    targets.push({
      vehicleVariantKey: variantId,
      independentlyValidated: Boolean(independent) && hardConflicts.length === 0 && reviewBlockers.length === 0,
      score: independent?.score ?? 0,
      hardConflicts,
      reviewBlockers,
      matchedFields: independent?.matchedFields ?? [],
      missingFields: independent?.missingFields ?? [],
      condition: row.condition,
    });
  }
  const hardConflicts = unique(targets.flatMap((target) => target.hardConflicts));
  const reviewBlockers = unique(targets.flatMap((target) => target.reviewBlockers));
  const independentlyValidated = targets.length > 0 && targets.every((target) => target.independentlyValidated);
  return {
    candidate,
    targets,
    hardConflicts,
    reviewBlockers,
    eligible: independentlyValidated && eligibleCandidate(requirement, family, candidate, hardConflicts),
    plausible: hardConflicts.length === 0 && candidate.score >= MANN_MIN_PRESENTABLE_SCORE,
  };
}

function candidateSemanticSignature(candidate: MannVehicleCandidate, family: MannFluidSystemFamily): string {
  const text = normalizeMannSearchText(candidate.effectiveVehicleText ?? candidate.vehicleText);
  const transmission = family === "TRANSMISSION" ? text.match(/\b(?:AT|MT|CVT|DCT|DSG|AUTOMATIC|MANUAL)\b/g)?.sort().join(",") : "";
  const drive = family === "DRIVETRAIN" ? text.match(/\b(?:4WD|AWD|FWD|RWD|QUATTRO|4MATIC|XDRIVE)\b/g)?.sort().join(",") : "";
  return [
    normalizeMannSearchText(candidate.engineCode),
    normalizeMannSearchText(candidate.kw),
    normalizeMannSearchText(candidate.hp),
    normalizeMannSearchText(candidate.vehicleYears),
    transmission ?? "",
    drive ?? "",
  ].join("|");
}

function equivalentMultiApplicability(
  requirement: MannFluidRequirementForMatch,
  family: MannFluidSystemFamily,
  assessments: CandidateAssessment[],
): boolean {
  if (assessments.length <= 1) return true;
  if (!assessments.every((assessment) => assessment.eligible)) return false;
  const sourceEngineCodes = unique([requirement.engineCodeNormalized, ...strings(requirement.engineCodesJson)]);
  if (sourceEngineCodes.length > 0) {
    const allExact = assessments.every((assessment) => assessment.candidate.matchedFields.includes("точный код двигателя"));
    if (allExact) return true;
    const allFamily = assessments.every((assessment) => {
      const matched = new Set(assessment.candidate.matchedFields);
      return matched.has("семейство двигателя");
    });
    if (!allFamily) return false;
    const familySignatures = new Set(assessments.map((assessment) => candidateSemanticSignature(assessment.candidate, family)));
    return familySignatures.size === 1;
  }
  const signatures = new Set(assessments.map((assessment) => candidateSemanticSignature(assessment.candidate, family)));
  return signatures.size === 1;
}

function specificationConfidence(requirement: MannFluidRequirementForMatch): MannFluidFieldConfidence {
  const specifications = Array.isArray(requirement.specificationsJson) ? requirement.specificationsJson : [];
  const structured = specifications.filter((item) => Boolean(item) && typeof item === "object" && "type" in item && (item as { type?: unknown }).type !== "RAW");
  if (structured.length > 0) return { level: "HIGH", evidence: [`${structured.length} структурированных допусков/классов`] };
  if (requirement.specificationText?.trim()) return { level: "MEDIUM", evidence: ["сохранён только raw specificationText"] };
  return { level: "NONE", evidence: ["спецификация отсутствует в источнике"] };
}

function componentConfidence(requirement: MannFluidRequirementForMatch, family: MannFluidSystemFamily): MannFluidFieldConfidence {
  if (!requirement.componentModel?.trim()) return { level: "NONE", evidence: ["componentModel отсутствует"] };
  if (family === "TRANSMISSION" || family === "DRIVETRAIN") {
    return { level: "MEDIUM", evidence: ["componentModel сохранён как условная альтернатива источника, MANN его не подтверждает"] };
  }
  return { level: "LOW", evidence: ["componentModel есть в источнике, но не является ключом MANN"] };
}

function applicabilityConfidence(status: MannFluidMatchStatus, targets: MannFluidTargetDecision[]): MannFluidFieldConfidence {
  if (status === "CONFIRMED_SINGLE" || status === "CONFIRMED_MULTI_APPLICABILITY") {
    return { level: "HIGH", evidence: [`независимо валидировано целей: ${targets.length}`] };
  }
  if (status === "REVIEW_REQUIRED") return { level: "MEDIUM", evidence: ["есть правдоподобные, но неоднозначные кандидаты"] };
  if (status === "CONFLICT") return { level: "LOW", evidence: ["обнаружено противоречие применяемости"] };
  return { level: "NONE", evidence: [status] };
}

function fingerprint(requirement: MannFluidRequirementForMatch, status: MannFluidMatchStatus, targets: MannFluidTargetDecision[]): string {
  const payload = JSON.stringify({
    matcherVersion: MANN_FLUID_MATCHER_VERSION,
    requirementId: requirement.id,
    systemCode: requirement.systemCode,
    status,
    targets: targets.map((target) => target.vehicleVariantKey).sort(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function matchFluidRequirementToMann(
  requirement: MannFluidRequirementForMatch,
  allRows: MannResolverTestRow[],
): MannFluidMatchDecision {
  const family = fluidSystemFamily(requirement.systemCode);
  const normalizedVehicle = normalizeFluidRequirementVehicle(requirement);
  const emptyDecision = (status: MannFluidMatchStatus, reviewReasons: string[], sourceRowCount = 0): MannFluidMatchDecision => {
    const targets: MannFluidTargetDecision[] = [];
    return {
      matcherVersion: MANN_FLUID_MATCHER_VERSION,
      requirementId: requirement.id,
      status,
      systemFamily: family,
      normalizedVehicle,
      targets,
      topCandidates: [],
      sourceRowCount,
      retrievedCount: 0,
      top1Score: null,
      top1Top2Gap: null,
      conflictTypes: [],
      reviewReasons,
      fieldConfidence: {
        vehicleApplicability: applicabilityConfidence(status, targets),
        specification: specificationConfidence(requirement),
        componentModel: componentConfidence(requirement, family),
      },
      decisionFingerprint: fingerprint(requirement, status, targets),
    };
  };

  if (!normalizedVehicle) return emptyDecision("INSUFFICIENT_SOURCE_CONTEXT", ["make/model не нормализуются"]);
  if (sourceContextScore(requirement, family) < (family === "GENERAL" ? 2 : 3)) {
    return emptyDecision("INSUFFICIENT_SOURCE_CONTEXT", ["недостаточно независимых vehicle/system anchors"]);
  }

  const makeRows = relevantRowsForMake(normalizedVehicle, allRows);
  if (makeRows.length === 0) return emptyDecision("MANN_CATALOG_GAP", ["марка отсутствует в MANN snapshot"]);
  const diagnostic = diagnoseMannCandidatesForTest(normalizedVehicle, makeRows);
  const ranked = diagnostic.rankedCandidates.slice(0, 20);
  if (diagnostic.retrievedCount === 0 || ranked.length === 0) {
    return emptyDecision("MANN_CATALOG_GAP", ["для нормализованной модели MANN retrieval не вернул кандидатов"], makeRows.length);
  }

  const rowsByVariant = representativeRowsByVariant(makeRows);
  const assessments = ranked.map((candidate) => assessCandidate(requirement, family, candidate, rowsByVariant));
  const topEligible = assessments.find((assessment) => assessment.eligible);
  const topScore = ranked[0]?.score ?? null;
  const topGap = ranked[0] && ranked[1] ? ranked[0].score - ranked[1].score : ranked[0]?.score ?? null;
  let status: MannFluidMatchStatus;
  let targets: MannFluidTargetDecision[] = [];
  const reviewReasons: string[] = [];
  let conflictTypes: string[] = [];

  if (!topEligible) {
    const hasPlausible = assessments.some((assessment) => assessment.plausible);
    const topAssessment = assessments[0];
    const hasConflict = !hasPlausible
      && Boolean(topAssessment?.hardConflicts.length)
      && (topAssessment?.candidate.score ?? 0) >= MANN_MIN_PRESENTABLE_SCORE;
    status = hasConflict ? "CONFLICT" : hasPlausible ? "REVIEW_REQUIRED" : "NO_MATCH";
    if (hasConflict) conflictTypes = topAssessment.hardConflicts;
    reviewReasons.push(hasConflict ? "Top candidates противоречат source context" : hasPlausible ? "кандидаты не проходят строгую system-aware policy" : "при достаточном source context безопасный кандидат не найден");
  } else {
    const closePlausible = assessments.filter((assessment) => assessment.plausible && assessment.candidate.score >= topEligible.candidate.score - 11);
    const closeEligible = closePlausible.filter((assessment) => assessment.eligible);
    const closeConflicting = assessments.filter((assessment) => assessment.hardConflicts.length > 0 && assessment.candidate.score >= topEligible.candidate.score - 11);
    if (closeConflicting.length > 0 || closePlausible.length > closeEligible.length || !equivalentMultiApplicability(requirement, family, closeEligible)) {
      status = "REVIEW_REQUIRED";
      reviewReasons.push(closeConflicting.length > 0
        ? "рядом с допустимой целью есть более сильный/близкий противоречивый кандидат"
        : "несколько близких неэквивалентных MANN targets; auto multi запрещён");
    } else {
      targets = closeEligible.flatMap((assessment) => assessment.targets);
      const deduplicatedTargets = [...new Map(targets.map((target) => [target.vehicleVariantKey, target])).values()];
      targets = deduplicatedTargets;
      status = targets.length === 1 ? "CONFIRMED_SINGLE" : "CONFIRMED_MULTI_APPLICABILITY";
      if (targets.length > 1) reviewReasons.push("каждая цель независимо валидирована и признана эквивалентной применяемостью");
    }
  }

  const topCandidates: MannFluidCandidateDiagnostic[] = assessments.map((assessment, index) => ({
    rank: index + 1,
    variantIds: assessment.candidate.variantIds,
    make: assessment.candidate.make,
    model: assessment.candidate.model,
    vehicleText: assessment.candidate.effectiveVehicleText ?? assessment.candidate.vehicleText,
    engineCode: assessment.candidate.engineCode,
    vehicleYears: assessment.candidate.vehicleYears,
    score: assessment.candidate.score,
    confidence: assessment.candidate.confidence,
    eligible: assessment.eligible,
    independentlyValidatedTargets: assessment.targets.filter((target) => target.independentlyValidated).length,
    hardConflicts: assessment.hardConflicts,
    reviewBlockers: assessment.reviewBlockers,
    matchedFields: assessment.candidate.matchedFields,
    mismatchedFields: assessment.candidate.mismatchedFields,
    missingFields: assessment.candidate.missingFields,
    warnings: assessment.candidate.warnings,
    featureContributions: assessment.candidate.featureContributions,
  }));

  return {
    matcherVersion: MANN_FLUID_MATCHER_VERSION,
    requirementId: requirement.id,
    status,
    systemFamily: family,
    normalizedVehicle,
    targets,
    topCandidates,
    sourceRowCount: diagnostic.sourceRowCount,
    retrievedCount: diagnostic.retrievedCount,
    top1Score: topScore,
    top1Top2Gap: topGap,
    conflictTypes,
    reviewReasons,
    fieldConfidence: {
      vehicleApplicability: applicabilityConfidence(status, targets),
      specification: specificationConfidence(requirement),
      componentModel: componentConfidence(requirement, family),
    },
    decisionFingerprint: fingerprint(requirement, status, targets),
  };
}
