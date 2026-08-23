export const FLUID_CAPACITY_PARSER_VERSION = "capacity-parser-v2" as const;

export type FluidCapacityKind =
  | "SERVICE"
  | "TOTAL"
  | "PARTIAL"
  | "WITH_FILTER"
  | "WITHOUT_FILTER"
  | "DRY_FILL"
  | "REFILL"
  | "UNKNOWN";

export type FluidCapacityConfidence = "HIGH" | "MEDIUM" | "LOW";
export type FluidCapacityQualifier = "EXACT" | "RANGE" | "TOLERANCE" | "APPROXIMATE" | "UP_TO";

export type ParsedFluidCapacity = {
  kind: FluidCapacityKind;
  minLiters: number | null;
  maxLiters: number | null;
  nominalLiters: number | null;
  toleranceLiters: number | null;
  context: string;
  confidence: FluidCapacityConfidence;
  raw: string;
  qualifier: FluidCapacityQualifier;
  serviceContext: "SERVICE" | "TOTAL" | "PARTIAL" | "DRY_FILL" | "REFILL" | "UNKNOWN";
  filterContext: "WITH_FILTER" | "WITHOUT_FILTER" | "UNKNOWN";
  start: number;
  end: number;
};

export type CapacityParserDiagnostic = {
  code:
    | "HORSEPOWER_COLLISION"
    | "NON_POSITIVE_VOLUME"
    | "OUTSIDE_SYSTEM_PLAUSIBILITY"
    | "REVERSED_RANGE"
    | "TOLERANCE_EXCEEDS_NOMINAL"
    | "UNRESOLVED_CONDITIONAL_CAPACITY";
  message: string;
  raw: string;
  start: number;
  end: number;
};

export type FluidCapacityParseResult = {
  parserVersion: typeof FLUID_CAPACITY_PARSER_VERSION;
  capacities: ParsedFluidCapacity[];
  rejected: CapacityParserDiagnostic[];
  suspicious: CapacityParserDiagnostic[];
  needsReview: boolean;
};

type CapacityCandidate = {
  start: number;
  end: number;
  raw: string;
  first: number;
  second: number | null;
  tolerance: number | null;
  qualifier: FluidCapacityQualifier;
};

const NUMBER_SOURCE = String.raw`\d{1,4}(?:[.,]\d{1,3})?`;
const UNIT_SOURCE = String.raw`(?:л(?:итр(?:а|ов|ы)?|\.)?|литр(?:а|ов|ы)?|(?:liter|litre)s?\.?)(?![\p{L}\p{N}])`;
const APPROXIMATE_SOURCE = String.raw`(?:около|примерно|приблизительно|порядка|about|approx(?:imately)?\.?|~|≈)`;
const UP_TO_SOURCE = String.raw`(?:до|не\s+более|up\s+to|max\.?)`;
const PREFIX_SOURCE = String.raw`(?:(?<prefix>${APPROXIMATE_SOURCE}|${UP_TO_SOURCE})\s*)?`;

const TOLERANCE_PATTERN = new RegExp(
  String.raw`${PREFIX_SOURCE}(?<first>${NUMBER_SOURCE})\s*(?:±|\+\s*\/\s*-|\+\s*-)\s*(?<tolerance>${NUMBER_SOURCE})\s*${UNIT_SOURCE}`,
  "giu",
);
const RANGE_PATTERN = new RegExp(
  String.raw`${PREFIX_SOURCE}(?<first>${NUMBER_SOURCE})\s*(?:${UNIT_SOURCE}\s*)?(?:\.{3}|…|[-–—])\s*(?<second>${NUMBER_SOURCE})\s*${UNIT_SOURCE}`,
  "giu",
);
const EXACT_PATTERN = new RegExp(
  String.raw`${PREFIX_SOURCE}(?<first>${NUMBER_SOURCE})\s*${UNIT_SOURCE}`,
  "giu",
);
const HORSEPOWER_PATTERN = new RegExp(
  String.raw`(?<value>${NUMBER_SOURCE})\s*(?:лс\.?|л\.с\.?|л\.\s+с\.|л\s+с\.)`,
  "giu",
);

const KIND_MARKERS: Array<{ kind: FluidCapacityKind; pattern: RegExp; priority: number }> = [
  { kind: "WITHOUT_FILTER", pattern: /без\s+(?:маслян(?:ого|ый)\s+)?фильтр[а-я]*/giu, priority: 10 },
  { kind: "WITH_FILTER", pattern: /(?:(?<![a-zа-яё])(?:с|c)|вместе\s+с)\s+(?:маслян(?:ым|ый)\s+)?фильтр[а-я]*/giu, priority: 10 },
  { kind: "PARTIAL", pattern: /(?:частичн[а-я]*|слив[а-я]*)/giu, priority: 8 },
  { kind: "TOTAL", pattern: /(?:полн[а-яё]*|общ(?:ий|ая|ее)|основн[а-яё]*\s+объ[её]м|всего)/giu, priority: 2 },
  { kind: "DRY_FILL", pattern: /(?:сух(?:ая|ой|ое)\s+заправк[а-я]*|сух(?:ой|ого)\s+двигател[а-я]*|dry\s*fill)/giu, priority: 12 },
  { kind: "REFILL", pattern: /(?:перезаправк[а-я]*|повторн[а-я]*\s+заправк[а-я]*|прокачк[а-я]*|долив[а-я]*|аппаратн[а-я]*\s+замен[а-я]*|замен[а-я]*\s+на\s+аппарат[а-я]*|refill)/giu, priority: 12 },
  { kind: "SERVICE", pattern: /(?:сервисн[а-я]*|рабоч(?:ий|ая|ее)|объ[её]м\s+замен[а-я]*|для\s+замен[а-я]*)/giu, priority: 2 },
];

const SYSTEM_LIMITS: Record<string, { min: number; max: number }> = {
  ENGINE_OIL: { min: 0.5, max: 80 },
  AUTOMATIC_TRANSMISSION: { min: 0.1, max: 100 },
  MANUAL_TRANSMISSION: { min: 0.1, max: 100 },
  CVT_TRANSMISSION: { min: 0.1, max: 100 },
  ROBOT_TRANSMISSION: { min: 0.1, max: 100 },
  TRANSMISSION_GENERIC: { min: 0.1, max: 100 },
  TRANSFER_CASE: { min: 0.05, max: 50 },
  FRONT_DIFFERENTIAL: { min: 0.05, max: 50 },
  REAR_DIFFERENTIAL: { min: 0.05, max: 50 },
  DIFFERENTIAL_GENERIC: { min: 0.05, max: 50 },
  AWD_COUPLING: { min: 0.05, max: 50 },
  ENGINE_COOLANT: { min: 0.2, max: 500 },
  INVERTER_COOLANT: { min: 0.2, max: 500 },
  INTERCOOLER_COOLANT: { min: 0.2, max: 500 },
  FUEL_TANK: { min: 1, max: 2000 },
};
const DEFAULT_LIMITS = { min: 0.01, max: 5000 };

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundLiters(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normalizedPrefix(value: string | undefined): "APPROXIMATE" | "UP_TO" | null {
  if (!value) return null;
  return new RegExp(`^${UP_TO_SOURCE}$`, "iu").test(value.trim()) ? "UP_TO" : "APPROXIMATE";
}

function overlaps(left: CapacityCandidate, right: CapacityCandidate): boolean {
  return left.start < right.end && right.start < left.end;
}

function collectCandidates(text: string): CapacityCandidate[] {
  const candidates: CapacityCandidate[] = [];
  const collect = (pattern: RegExp, baseQualifier: FluidCapacityQualifier) => {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const first = parseNumber(match.groups?.first);
      if (first === null) continue;
      const prefix = normalizedPrefix(match.groups?.prefix);
      const candidate: CapacityCandidate = {
        start,
        end: start + match[0].length,
        raw: match[0].trim(),
        first,
        second: parseNumber(match.groups?.second),
        tolerance: parseNumber(match.groups?.tolerance),
        qualifier: prefix ?? baseQualifier,
      };
      if (!candidates.some((current) => overlaps(current, candidate))) candidates.push(candidate);
    }
  };

  collect(TOLERANCE_PATTERN, "TOLERANCE");
  collect(RANGE_PATTERN, "RANGE");
  collect(EXACT_PATTERN, "EXACT");
  return candidates.sort((left, right) => left.start - right.start);
}

function contextFor(text: string, start: number, end: number): { text: string; offset: number } {
  const previousBreak = Math.max(text.lastIndexOf("\n", start), text.lastIndexOf(";", start));
  const nextNewline = text.indexOf("\n", end);
  const nextSemicolon = text.indexOf(";", end);
  const nextBreaks = [nextNewline, nextSemicolon].filter((value) => value >= 0);
  const contextStart = previousBreak >= 0 ? previousBreak + 1 : Math.max(0, start - 80);
  const contextEnd = nextBreaks.length ? Math.min(...nextBreaks) : Math.min(text.length, end + 80);
  return { text: text.slice(contextStart, contextEnd).trim(), offset: contextStart };
}

function nearestKind(
  context: string,
  absoluteStart: number,
  matchStart: number,
  matchEnd: number,
  previousEnd: number,
  nextStart: number,
): FluidCapacityKind {
  const matchCenter = (matchStart + matchEnd) / 2;
  const suffixMarkers: Array<{ kind: FluidCapacityKind; distance: number }> = [];
  const prefixMarkers: Array<{ kind: FluidCapacityKind; distance: number }> = [];
  for (const marker of KIND_MARKERS) {
    marker.pattern.lastIndex = 0;
    for (const match of context.matchAll(marker.pattern)) {
      const markerStart = absoluteStart + (match.index ?? 0);
      const markerEnd = markerStart + match[0].length;
      const markerCenter = markerStart + match[0].length / 2;
      const distance = Math.max(0, Math.abs(markerCenter - matchCenter) - marker.priority);
      if (markerStart >= matchEnd && markerStart < nextStart) {
        suffixMarkers.push({ kind: marker.kind, distance });
      } else if (markerEnd <= matchStart && markerEnd > previousEnd) {
        prefixMarkers.push({ kind: marker.kind, distance });
      }
    }
  }
  const pool = suffixMarkers.length > 0 ? suffixMarkers : prefixMarkers;
  pool.sort((left, right) => left.distance - right.distance);
  return pool[0]?.kind ?? "UNKNOWN";
}

function serviceContext(kind: FluidCapacityKind): ParsedFluidCapacity["serviceContext"] {
  return ["SERVICE", "TOTAL", "PARTIAL", "DRY_FILL", "REFILL"].includes(kind)
    ? (kind as ParsedFluidCapacity["serviceContext"])
    : "UNKNOWN";
}

function filterContext(kind: FluidCapacityKind): ParsedFluidCapacity["filterContext"] {
  return kind === "WITH_FILTER" || kind === "WITHOUT_FILTER" ? kind : "UNKNOWN";
}

function horsepowerDiagnostics(text: string): CapacityParserDiagnostic[] {
  const diagnostics: CapacityParserDiagnostic[] = [];
  HORSEPOWER_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(HORSEPOWER_PATTERN)) {
    const start = match.index ?? 0;
    diagnostics.push({
      code: "HORSEPOWER_COLLISION",
      message: "Мощность в л.с. отклонена и не интерпретирована как объём.",
      raw: match[0].trim(),
      start,
      end: start + match[0].length,
    });
  }
  return diagnostics;
}

function candidateTouchesHorsepower(candidate: CapacityCandidate, rejected: CapacityParserDiagnostic[]): boolean {
  return rejected.some((diagnostic) => candidate.start < diagnostic.end && diagnostic.start < candidate.end + 4);
}

export function parseFluidCapacities(value: unknown, systemCode?: string | null): FluidCapacityParseResult {
  const text = String(value ?? "").replace(/\u00a0/g, " ").trim();
  const rejected = horsepowerDiagnostics(text);
  const suspicious: CapacityParserDiagnostic[] = [];
  const limits = (systemCode && SYSTEM_LIMITS[systemCode]) || DEFAULT_LIMITS;
  const capacities: ParsedFluidCapacity[] = [];

  const candidates = collectCandidates(text);
  for (const [candidateIndex, candidate] of candidates.entries()) {
    if (candidateTouchesHorsepower(candidate, rejected)) continue;

    let minLiters: number | null = candidate.first;
    let maxLiters: number | null = candidate.first;
    let nominalLiters: number | null = candidate.first;
    let toleranceLiters: number | null = null;

    if (candidate.qualifier === "RANGE" || (candidate.second !== null && candidate.tolerance === null)) {
      minLiters = candidate.second === null ? candidate.first : Math.min(candidate.first, candidate.second);
      maxLiters = candidate.second === null ? candidate.first : Math.max(candidate.first, candidate.second);
      nominalLiters = null;
      if (candidate.second !== null && candidate.second < candidate.first) {
        suspicious.push({
          code: "REVERSED_RANGE",
          message: "Границы диапазона в источнике указаны в обратном порядке.",
          raw: candidate.raw,
          start: candidate.start,
          end: candidate.end,
        });
      }
    } else if (candidate.tolerance !== null) {
      toleranceLiters = candidate.tolerance;
      minLiters = roundLiters(Math.max(0, candidate.first - candidate.tolerance));
      maxLiters = roundLiters(candidate.first + candidate.tolerance);
      if (candidate.tolerance >= candidate.first) {
        suspicious.push({
          code: "TOLERANCE_EXCEEDS_NOMINAL",
          message: "Допуск равен номиналу или превышает его.",
          raw: candidate.raw,
          start: candidate.start,
          end: candidate.end,
        });
      }
    } else if (candidate.qualifier === "APPROXIMATE") {
      minLiters = null;
      maxLiters = null;
    } else if (candidate.qualifier === "UP_TO") {
      minLiters = null;
      maxLiters = candidate.first;
      nominalLiters = null;
    }

    const checkValues = [minLiters, maxLiters, nominalLiters].filter((item): item is number => item !== null);
    if (checkValues.some((item) => item <= 0)) {
      rejected.push({
        code: "NON_POSITIVE_VOLUME",
        message: "Нулевой или отрицательный объём отклонён.",
        raw: candidate.raw,
        start: candidate.start,
        end: candidate.end,
      });
      continue;
    }

    const representative = nominalLiters ?? maxLiters ?? minLiters;
    const outsidePlausibility = representative !== null && (representative < limits.min || representative > limits.max);
    if (outsidePlausibility) {
      suspicious.push({
        code: "OUTSIDE_SYSTEM_PLAUSIBILITY",
        message: `Объём ${representative} л вне консервативного диапазона ${limits.min}–${limits.max} л для ${systemCode || "системы"}.`,
        raw: candidate.raw,
        start: candidate.start,
        end: candidate.end,
      });
    }

    const localContext = contextFor(text, candidate.start, candidate.end);
    const previousCandidate = candidates[candidateIndex - 1];
    const nextCandidate = candidates[candidateIndex + 1];
    const kind = nearestKind(
      localContext.text,
      localContext.offset,
      candidate.start,
      candidate.end,
      previousCandidate && previousCandidate.end >= localContext.offset ? previousCandidate.end : localContext.offset - 1,
      nextCandidate && nextCandidate.start <= localContext.offset + localContext.text.length
        ? nextCandidate.start
        : localContext.offset + localContext.text.length + 1,
    );
    capacities.push({
      kind,
      minLiters,
      maxLiters,
      nominalLiters,
      toleranceLiters,
      context: localContext.text,
      confidence: outsidePlausibility
        ? "LOW"
        : candidate.qualifier === "APPROXIMATE" || candidate.qualifier === "UP_TO"
          ? "MEDIUM"
          : "HIGH",
      raw: candidate.raw,
      qualifier: candidate.qualifier,
      serviceContext: serviceContext(kind),
      filterContext: filterContext(kind),
      start: candidate.start,
      end: candidate.end,
    });
  }

  const conditionalIndexes = new Set<number>();
  for (let leftIndex = 0; leftIndex < capacities.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < capacities.length; rightIndex += 1) {
      const left = capacities[leftIndex];
      const right = capacities[rightIndex];
      if (left.kind !== right.kind || left.kind === "UNKNOWN") continue;
      const leftMin = left.minLiters ?? left.nominalLiters ?? left.maxLiters;
      const leftMax = left.maxLiters ?? left.nominalLiters ?? left.minLiters;
      const rightMin = right.minLiters ?? right.nominalLiters ?? right.maxLiters;
      const rightMax = right.maxLiters ?? right.nominalLiters ?? right.minLiters;
      if (leftMin === null || leftMax === null || rightMin === null || rightMax === null) continue;
      const comparisonTolerance = Math.max(0.05, Math.min(leftMax, rightMax) * 0.03);
      if (leftMax + comparisonTolerance >= rightMin && rightMax + comparisonTolerance >= leftMin) continue;
      conditionalIndexes.add(leftIndex);
      conditionalIndexes.add(rightIndex);
    }
  }
  if (conditionalIndexes.size > 0) {
    for (const index of conditionalIndexes) {
      if (capacities[index].confidence === "HIGH") capacities[index].confidence = "MEDIUM";
    }
    const involved = [...conditionalIndexes].map((index) => capacities[index]);
    suspicious.push({
      code: "UNRESOLVED_CONDITIONAL_CAPACITY",
      message: "В одной строке есть взаимоисключающие объёмы одного kind; условие нужно структурировать до materialization.",
      raw: involved.map((capacity) => capacity.raw).join(" | "),
      start: Math.min(...involved.map((capacity) => capacity.start)),
      end: Math.max(...involved.map((capacity) => capacity.end)),
    });
  }

  return {
    parserVersion: FLUID_CAPACITY_PARSER_VERSION,
    capacities,
    rejected,
    suspicious,
    needsReview: suspicious.length > 0,
  };
}
