import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseFluidCapacities, type ParsedFluidCapacity } from "@/lib/fluid-capacity-parser";

const SOURCE_NAME = "podbormasla.ru";
const SOURCE_URL = "https://podbormasla.ru";
const CURRENT_YEAR = new Date().getFullYear();

type JsonRecord = Record<string, unknown>;
type CsvRow = Record<string, string>;

export type PodbormaslaRow = {
  row_id: string;
  source_url: string;
  page_path?: string;
  brand_slug?: string;
  model_slug?: string;
  generation_slug?: string;
  page_title?: string;
  table_index: number;
  row_index: number;
  table_kind?: string;
  application?: string;
  system_name?: string;
  model?: string;
  fuel_type?: string;
  engine_displacement?: string;
  power?: string;
  production_years?: string;
  fill_volume?: string;
  specification?: string;
  recommendation?: string;
  replacement_interval?: string;
  control_interval?: string;
  analog?: string;
  sae_json?: string;
  headers_json?: string;
  extra_columns_json?: string;
  raw_cells_json?: string;
  row_text?: string;
  fetched_at?: string;
  page_sha256?: string;
};

export type FluidSystemCode =
  | "ENGINE_OIL"
  | "AUTOMATIC_TRANSMISSION"
  | "MANUAL_TRANSMISSION"
  | "CVT_TRANSMISSION"
  | "ROBOT_TRANSMISSION"
  | "TRANSMISSION_GENERIC"
  | "TRANSFER_CASE"
  | "FRONT_DIFFERENTIAL"
  | "REAR_DIFFERENTIAL"
  | "DIFFERENTIAL_GENERIC"
  | "AWD_COUPLING"
  | "POWER_STEERING"
  | "BRAKE_FLUID"
  | "CLUTCH_FLUID"
  | "ENGINE_COOLANT"
  | "INVERTER_COOLANT"
  | "INTERCOOLER_COOLANT"
  | "AC_REFRIGERANT"
  | "ADBLUE"
  | "GREASE"
  | "HYDRAULIC_SYSTEM"
  | "SUSPENSION_HYDRAULIC"
  | "PTO"
  | "RETARDER"
  | "GENERATOR_OIL"
  | "FUEL"
  | "BATTERY"
  | "AIR_FILTER"
  | "OIL_FILTER"
  | "FUEL_FILTER"
  | "CABIN_FILTER"
  | "SPARK_PLUG"
  | "TIRES_WHEELS"
  | "FUEL_TANK"
  | "OTHER";

type Capacity = Pick<ParsedFluidCapacity, "minLiters" | "maxLiters" | "nominalLiters" | "toleranceLiters" | "context" | "confidence" | "raw" | "qualifier"> & {
  kind: "service" | "total" | "partial" | "with_filter" | "without_filter" | "unspecified";
};

type Specification = { type: string; value: string };

type VehicleContext = {
  engineCodes: string[];
  engineVolumeCc: number | null;
  powerKw: number | null;
  powerHp: number | null;
  fuelType: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  driveType: string | null;
  transmissionType: string | null;
  confidence: "row_engine" | "table_engine" | "page" | "matrix_row";
};

type RequirementPart = {
  partKey: string;
  systemName: string;
  systemCode: FluidSystemCode;
  componentModel: string | null;
  fillVolumeText: string | null;
  specificationText: string | null;
  recommendationText: string | null;
  raw: JsonRecord;
};

export type PreparedFluidSourceRow = {
  id: string;
  sourceUrl: string;
  pagePath: string | null;
  pageTitle: string | null;
  makeRaw: string | null;
  makeNormalized: string | null;
  modelRaw: string | null;
  modelNormalized: string | null;
  generationRaw: string | null;
  tableIndex: number;
  rowIndex: number;
  tableKind: string | null;
  applicationRaw: string | null;
  systemNameRaw: string | null;
  rawCellsJson: Prisma.InputJsonValue;
  parsedRowJson: Prisma.InputJsonValue;
  sourceFetchedAt: Date | null;
  sourcePageHash: string | null;
};

export type PreparedFluidRequirement = {
  id: string;
  sourceRowId: string;
  sourceTableKey: string;
  sourceUrl: string;
  make: string;
  makeNormalized: string;
  model: string;
  modelNormalized: string;
  generation: string | null;
  generationNumber: number | null;
  bodyCodesJson: Prisma.InputJsonValue;
  yearFrom: number | null;
  yearTo: number | null;
  engineCodeNormalized: string | null;
  engineCodesJson: Prisma.InputJsonValue;
  engineVolumeCc: number | null;
  powerKw: number | null;
  powerHp: number | null;
  fuelType: string | null;
  driveType: string | null;
  transmissionType: string | null;
  componentModel: string | null;
  systemCode: FluidSystemCode;
  systemNameRaw: string;
  fillVolumeText: string | null;
  fillVolumeMinLiters: number | null;
  fillVolumeMaxLiters: number | null;
  serviceVolumeLiters: number | null;
  totalVolumeLiters: number | null;
  capacitiesJson: Prisma.InputJsonValue;
  specificationText: string | null;
  specificationsJson: Prisma.InputJsonValue;
  viscosityGradesJson: Prisma.InputJsonValue;
  recommendationText: string | null;
  replacementIntervalText: string | null;
  replacementKmMin: number | null;
  replacementKmMax: number | null;
  replacementMonths: number | null;
  controlIntervalText: string | null;
  analogText: string | null;
  contextConfidence: VehicleContext["confidence"];
  rawRequirementJson: Prisma.InputJsonValue;
};

export type MannVariant = {
  variantKey: string;
  make: string;
  makeNormalized: string;
  model: string;
  modelNormalized: string;
  baseModelNormalized: string;
  generationNumber: number | null;
  bodyCodes: string[];
  vehicleText: string | null;
  effectiveVehicleText: string | null;
  engineCode: string | null;
  engineCodes: string[];
  engineVolumeCc: number | null;
  kw: number | null;
  hp: number | null;
  fuelType: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  condition: string | null;
};

export type PreparedMannFluidLink = {
  id: string;
  requirementId: string;
  mannVariantKey: string;
  mannMake: string;
  mannModel: string;
  mannVehicleText: string | null;
  mannEngineCode: string | null;
  matchScore: number;
  confidence: "high" | "medium" | "low";
  status: "auto_matched" | "review_required";
  matchMethod: string;
  evidenceJson: Prisma.InputJsonValue;
};

export type FluidImportStats = {
  sourceRows: number;
  requirements: number;
  requirementsWithCapacity: number;
  requirementsWithSpecification: number;
  requirementsWithEngineContext: number;
  sourceTables: number;
  systemCounts: Record<string, number>;
  mannVariants: number;
  links: number;
  autoMatchedLinks: number;
  reviewLinks: number;
  autoMatchedRequirements: number;
  reviewRequirements: number;
  unmatchedRequirements: number;
  distinctLinkedMannVariants: number;
  sourceHash: string;
  mannSourceHash: string;
  warnings: string[];
};

export type FluidReviewRow = {
  requirementId: string;
  sourceUrl: string;
  make: string;
  model: string;
  generation: string;
  engineCodes: string;
  years: string;
  systemCode: string;
  systemName: string;
  status: "auto_matched" | "review_required" | "unmatched";
  candidateCount: number;
  bestScore: number | null;
  bestMannModel: string;
  bestMannVehicle: string;
  bestMannEngine: string;
  evidence: string;
};

export type PreparedFluidCatalog = {
  sourceRows: PreparedFluidSourceRow[];
  requirements: PreparedFluidRequirement[];
  links: PreparedMannFluidLink[];
  reviewRows: FluidReviewRow[];
  stats: FluidImportStats;
};

export type PrepareFluidCatalogInput = {
  rowsNdjson: string;
  mannFiltersCsv: string;
  summaryJson?: string | null;
};

export type ImportFluidCatalogInput = PrepareFluidCatalogInput & {
  rowsFileName: string;
  importedById?: string | null;
  replaceExisting?: boolean;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function nullable(value: unknown): string | null {
  const result = clean(value);
  return result || null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function normalizeSearch(value: unknown): string {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompact(value: unknown): string {
  return normalizeSearch(value).replace(/\s+/g, "");
}

const MAKE_ALIASES: Record<string, string> = {
  "MERCEDES BENZ": "MERCEDES",
  MERCEDES: "MERCEDES",
  VW: "VOLKSWAGEN",
  LANDROVER: "LAND ROVER",
  "LAND ROVER": "LAND ROVER",
  GREATWALL: "GREAT WALL",
  "GREAT WALL": "GREAT WALL",
  SSANGYONG: "SSANGYONG",
  "SSANG YONG": "SSANGYONG",
  "VOLVO CVO": "VOLVO",
  "RENAULT CVO": "RENAULT",
  "HYUNDAI CE": "HYUNDAI",
};

function normalizeMake(value: unknown): string {
  const normalized = normalizeSearch(String(value ?? "").replace(/[_-]+/g, " "));
  return MAKE_ALIASES[normalized] ?? normalized;
}

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};

function generationNumber(value: unknown): number | null {
  const text = normalizeSearch(value);
  const numeric = text.match(/(?:^|\s)(\d{1,2})(?:\s*(?:GEN|ПОКОЛЕН))/)?.[1];
  if (numeric) return Number(numeric);
  const roman = text.match(/(?:^|\s)(VIII|VII|VI|IV|III|II|IX|V|I|X)(?:\s|$)/)?.[1];
  return roman ? ROMAN_VALUES[roman] ?? null : null;
}

function generationFromSlug(value: unknown): number | null {
  const match = clean(value).match(/(\d{1,2})\s*gen/i);
  return match?.[1] ? Number(match[1]) : generationNumber(value);
}

function romanGeneration(value: number | null): string | null {
  if (!value) return null;
  return Object.entries(ROMAN_VALUES).find(([, number]) => number === value)?.[0] ?? String(value);
}

function baseModel(value: unknown, make?: string): string {
  const withoutBodyCode = String(value ?? "").replace(/\([^)]*\)/g, " ");
  let normalized = normalizeSearch(withoutBodyCode.replace(/[_-]+/g, " "));
  normalized = normalized.replace(/\b(?:VIII|VII|VI|IV|III|II|IX|V|I|X)\b/g, " ");
  normalized = normalized.replace(/\s+/g, " ").trim().replace(/KLASSE/g, "CLASS");
  if (make === "BMW") {
    normalized = normalized.replace(/^(\d)ER$/, "$1");
  }
  return normalizeCompact(normalized);
}

function normalizeEngineCode(value: unknown): string {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[;,]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function engineCodeParts(value: unknown): string[] {
  const parts = unique(
    String(value ?? "")
      .split(/[;,|]+/)
      .flatMap((part) => part.includes("/") && !/\d\s*\/\s*\d/.test(part) ? part.split("/") : [part])
      .map(normalizeEngineCode)
      .filter((part) => part.length >= 2 && /\p{L}/u.test(part)),
  );
  return unique(parts.flatMap((part) => [part, part.replace(/\([^)]*\)/g, "").trim()]));
}

const ENGINE_CODE_STOPWORDS = new Set([
  "БЕНЗИН",
  "ДИЗЕЛЬ",
  "ГИБРИД",
  "HYBRID",
  "TURBO",
  "DOHC",
  "VVT",
  "VVT-I",
  "BLUEHDI",
  "PURETECH",
  "ECOBOOST",
  "TDCI",
  "DCI",
  "DIESEL",
  "PETROL",
  "GASOLINE",
  "ENGINE",
  "MOTOR",
  "ALL",
  "MODELS",
  "VTEC",
  "SOHC",
  "GDI",
  "TFSI",
  "TDI",
]);

function extractEngineCodes(value: unknown, includePureLetters = false): string[] {
  const raw = clean(value).toUpperCase();
  const candidates: string[] = [];
  for (const match of raw.matchAll(/(?:^|\s-\s|^\-\s*)([A-ZА-Я0-9][A-ZА-Я0-9._-]{1,30})(?=\s*\/)/g)) {
    if (match[1]) candidates.push(match[1]);
  }
  for (const match of raw.matchAll(/\b(?=[A-ZА-Я0-9._-]{3,20}\b)(?=[A-ZА-Я0-9._-]*\d)(?=[A-ZА-Я0-9._-]*[A-ZА-Я])[A-ZА-Я0-9]+(?:[._-][A-ZА-Я0-9]+)*\b/g)) {
    if (match[0]) candidates.push(match[0]);
  }
  if (includePureLetters) {
    for (const match of raw.matchAll(/\b[A-Z]{3,5}\b/g)) {
      if (match[0]) candidates.push(match[0]);
    }
  }
  return unique(candidates.map(normalizeEngineCode)).filter((candidate) => {
    if (ENGINE_CODE_STOPWORDS.has(candidate)) return false;
    if (/^(?:19|20)\d{2}$/.test(candidate)) return false;
    if (/^\d+(?:\.\d+)?(?:L|Л)?$/.test(candidate)) return false;
    if (/^(?:V\d+|\d+V)$/.test(candidate)) return false;
    return candidate.length >= 3;
  });
}

function parseNumber(value: unknown): number | null {
  const match = clean(value).replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!match?.[0]) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function parseEngineVolumeCc(value: unknown): number | null {
  const text = clean(value).replace(/,/g, ".");
  const liters = text.match(/(\d{1,2}(?:\.\d{1,3})?)\s*(?:л|l)(?=\s|\.|,|;|\)|$)/i)?.[1];
  if (liters) {
    const number = Number(liters);
    if (number >= 0.3 && number <= 20) return Math.round(number * 1000);
  }
  const cc = text.match(/(\d{3,5})\s*(?:см[³3]|ccm?|cm[³3])(?=\s|\.|,|;|\/|\)|$)/i)?.[1];
  if (cc) {
    const number = Number(cc);
    if (number >= 300 && number <= 30_000) return number;
  }
  return null;
}

function parseCatalogVehicleVolumeCc(...values: unknown[]): number | null {
  const explicit = values.map(parseEngineVolumeCc).find((value) => value != null);
  if (explicit != null) return explicit;
  const liters = unique(values.flatMap((value) => {
    const text = clean(value).replace(/,/g, ".");
    return [...text.matchAll(/(?:^|[^\d])(\d{1,2}\.\d)(?=(?:\d{1,2}V\b)|[^\d]|$)/gi)]
      .map((match) => match[1])
      .filter((item): item is string => Boolean(item));
  })).map(Number).filter((value) => value >= 0.3 && value <= 20);
  return liters.length === 1 && liters[0] != null ? Math.round(liters[0] * 1000) : null;
}

function parsePowerHp(...values: unknown[]): number | null {
  const numbers = unique(values.flatMap((value) => [...clean(value).matchAll(/(\d{2,4})\s*(?:л\.?\s*с\.?|hp|ps)(?=\s|\.|,|;|\/|\)|$)/gi)].map((match) => match[1]))).map(Number);
  return numbers.length === 1 && numbers[0] && numbers[0] <= 3000 ? numbers[0] : null;
}

function parsePowerKw(...values: unknown[]): number | null {
  const numbers = unique(values.flatMap((value) => [...clean(value).matchAll(/(\d{2,4})\s*(?:квт|kw)(?=\s|\.|,|;|\/|\)|$)/gi)].map((match) => match[1]))).map(Number);
  return numbers.length === 1 && numbers[0] && numbers[0] <= 2500 ? numbers[0] : null;
}

function normalizeFuel(value: unknown): string | null {
  const text = normalizeSearch(value);
  if (!text) return null;
  if (/ДИЗЕЛ|DIESEL/.test(text)) return "diesel";
  if (/БЕНЗ|PETROL|GASOLINE/.test(text)) return "gasoline";
  if (/ГИБРИД|HYBRID|HEV|PHEV/.test(text)) return "hybrid";
  if (/ЭЛЕКТР|ELECTRIC|EV/.test(text)) return "electric";
  if (/ГАЗ|CNG|LPG/.test(text)) return "gas";
  return null;
}

function normalizeCatalogFuel(...values: unknown[]): string | null {
  const text = normalizeSearch(values.join(" "));
  if (/TDI|TDCI|DCI|CRD|CDI|BLUEHDI|HDI|ECOBLUE|D-?4D|\d(?:\.\d+)?D(?:\b|\()/.test(text)) return "diesel";
  if (/PHEV|\bHEV\b|HYBRID/.test(text)) return "hybrid";
  if (/TFSI|TSI|FSI|GDI|MPI|ECOBOOST|\d(?:\.\d+)?I(?:\b|\()/.test(text)) return "gasoline";
  return normalizeFuel(text);
}

function parseYearRange(value: unknown): { from: number | null; to: number | null } {
  const text = clean(value);
  const years = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) => Number(match[1]));
  if (years.length === 0) return { from: null, to: null };
  const from = Math.min(...years);
  const openEnded = /н\.?\s*в\.?|present|current/i.test(text);
  return { from, to: openEnded ? null : Math.max(...years) };
}

function compactYear(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  if (digits.length <= 2) return parsed <= 35 ? 2000 + parsed : 1900 + parsed;
  return digits.length === 4 ? parsed : null;
}

function parseMannYears(value: unknown): { from: number | null; to: number | null } {
  const normalized = clean(value).replace(/[–—]/g, "-");
  const range = normalized.match(/(?:(\d{1,2})\/)?(\d{2,4})\s*-\s*(?:(\d{1,2})\/)?(\d{2,4})?/);
  if (range) return { from: compactYear(range[2] ?? ""), to: compactYear(range[4] ?? "") };
  const single = normalized.match(/\b(\d{2,4})\b/)?.[1];
  const year = single ? compactYear(single) : null;
  return { from: year, to: year };
}

function intersectRange(
  ranges: Array<{ from: number | null; to: number | null }>,
): { from: number | null; to: number | null } {
  const fromValues = ranges.map((range) => range.from).filter((value): value is number => value != null);
  const toValues = ranges.map((range) => range.to).filter((value): value is number => value != null);
  return {
    from: fromValues.length ? Math.min(...fromValues) : null,
    to: toValues.length ? Math.max(...toValues) : null,
  };
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseDate(value: unknown): Date | null {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function classifyFluidSystem(value: unknown): FluidSystemCode {
  const text = normalizeSearch(value);
  if (/АНТИФРИЗ|ОХЛАЖДАЮЩ|СИСТЕМА ОХЛАЖДЕНИЯ/.test(text)) {
    if (/ИНВЕРТ/.test(text)) return "INVERTER_COOLANT";
    if (/ИНТЕРКУЛ|ПРОМЕЖУТОЧН.*ОХЛАД/.test(text)) return "INTERCOOLER_COOLANT";
    return "ENGINE_COOLANT";
  }
  if (/ТОРМОЗН/.test(text)) return "BRAKE_FLUID";
  if (/СЦЕПЛЕН/.test(text)) return "CLUTCH_FLUID";
  if (/ВАРИАТОР|\bCVT\b|\bECVT\b|\bHVT\b/.test(text)) return "CVT_TRANSMISSION";
  if (/РОБОТ|\bDSG\b|\bDCT\b|РКПП|\bAMT\b|АМКПП|OPTICRUISE|OPTIDRIVER|I SHIFT|S TRONIC/.test(text)) return "ROBOT_TRANSMISSION";
  if (/АКПП|АВТОМАТИЧЕСК.*КПП|ALLISON/.test(text)) return "AUTOMATIC_TRANSMISSION";
  if (/МКПП|МЕХАНИЧЕСК.*КПП/.test(text)) return "MANUAL_TRANSMISSION";
  if (/РАЗДАТ|TRANSFER/.test(text)) return "TRANSFER_CASE";
  if (/ПЕРЕДН.*(?:РЕДУКТОР|ДИФФЕРЕНЦИАЛ|МОСТ)/.test(text)) return "FRONT_DIFFERENTIAL";
  if (/ЗАДН.*(?:РЕДУКТОР|ДИФФЕРЕНЦИАЛ|МОСТ)/.test(text)) return "REAR_DIFFERENTIAL";
  if (/ДИФФЕРЕНЦИАЛ|РЕДУКТОР|ГЛАВН.*ПЕРЕДАЧ|ВЕДУЩ.*МОСТ/.test(text)) return "DIFFERENTIAL_GENERIC";
  if (/HALDEX|МУФТ.*ПОЛН.*ПРИВОД/.test(text)) return "AWD_COUPLING";
  if (/ГУР|УСИЛИТЕЛ.*РУЛ|ПРИВОД РУЛЯ|POWER STEERING/.test(text)) return "POWER_STEERING";
  if (/ХЛАДАГЕНТ|КОНДИЦИОНЕР/.test(text)) return "AC_REFRIGERANT";
  if (/МОЧЕВИН|ADBLUE|КАРБАМИД/.test(text)) return "ADBLUE";
  if (/ПОДВЕСК|ВЫРАВНИВАН/.test(text) && /ЖИДКОСТ|МАСЛ|ГИДРАВЛ/.test(text)) return "SUSPENSION_HYDRAULIC";
  if (/ГИДРАВЛ|ГИДРОПРИВОД|ЛЕБЕДК|СИСТЕМ.*AWS/.test(text)) return "HYDRAULIC_SYSTEM";
  if (/ОТБОР.*МОЩНОСТИ|\bPTO\b/.test(text)) return "PTO";
  if (/ЗАМЕДЛИТЕЛ|RETARDER|VOITH/.test(text)) return "RETARDER";
  if (/ГЕНЕРАТОР/.test(text)) return "GENERATOR_OIL";
  if (/СМАЗК|ПОДШИПНИК|КАТОК|КАТКИ ГУСЕНИЦ/.test(text)) return "GREASE";
  if (/АККУМУЛЯТОР|БАТАРЕЯ/.test(text)) return "BATTERY";
  if (/ВОЗДУШН.*ФИЛЬТР/.test(text)) return "AIR_FILTER";
  if (/МАСЛЯН.*ФИЛЬТР/.test(text)) return "OIL_FILTER";
  if (/ТОПЛИВН.*ФИЛЬТР/.test(text)) return "FUEL_FILTER";
  if (/САЛОНН.*ФИЛЬТР/.test(text)) return "CABIN_FILTER";
  if (/СВЕЧ/.test(text)) return "SPARK_PLUG";
  if (/ШИН|КОЛЕС|КОЛЁС|ДИСК/.test(text)) return "TIRES_WHEELS";
  if (/БЕНЗОБАК|ТОПЛИВН.*БАК/.test(text)) return "FUEL_TANK";
  if (/^(?:БЕНЗИН|ДИЗЕЛЬНОЕ ТОПЛИВО|ТОПЛИВО)$/.test(text)) return "FUEL";
  if (/ДВИГАТЕЛ|МОТОРН.*МАСЛ/.test(text)) return "ENGINE_OIL";
  if (/ТРАНСМИСС|КПП/.test(text)) return "TRANSMISSION_GENERIC";
  return "OTHER";
}

function transmissionType(systemCode: FluidSystemCode): string | null {
  if (systemCode === "AUTOMATIC_TRANSMISSION") return "automatic";
  if (systemCode === "MANUAL_TRANSMISSION") return "manual";
  if (systemCode === "CVT_TRANSMISSION") return "cvt";
  if (systemCode === "ROBOT_TRANSMISSION") return "robot";
  return null;
}

export function parseCapacities(value: unknown): Capacity[] {
  const kindMap: Record<ParsedFluidCapacity["kind"], Capacity["kind"]> = {
    SERVICE: "service",
    TOTAL: "total",
    PARTIAL: "partial",
    WITH_FILTER: "with_filter",
    WITHOUT_FILTER: "without_filter",
    DRY_FILL: "total",
    REFILL: "service",
    UNKNOWN: "unspecified",
  };
  return parseFluidCapacities(value).capacities.map((capacity) => ({
    ...capacity,
    kind: kindMap[capacity.kind],
  }));
}

function capacitySummary(capacities: Capacity[]) {
  const mins = capacities.flatMap((capacity) => (capacity.minLiters === null ? [] : [capacity.minLiters]));
  const maxs = capacities.flatMap((capacity) => (capacity.maxLiters === null ? [] : [capacity.maxLiters]));
  const service = capacities.find((capacity) => ["service", "partial", "with_filter", "unspecified"].includes(capacity.kind));
  const total = capacities.find((capacity) => capacity.kind === "total");
  return {
    min: mins.length ? Math.min(...mins) : null,
    max: maxs.length ? Math.max(...maxs) : null,
    service: service?.nominalLiters ?? service?.maxLiters ?? null,
    total: total?.nominalLiters ?? total?.maxLiters ?? null,
  };
}

function viscosityGrades(...values: unknown[]): string[] {
  return unique(values.flatMap((value) => [...clean(value).matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map((match) => match[0]?.toUpperCase())));
}

export function parseSpecifications(value: unknown, grades: string[] = []): Specification[] {
  const text = clean(value);
  if (!text) return grades.map((grade) => ({ type: "SAE", value: grade }));
  const specs: Specification[] = [{ type: "RAW", value: text }];
  const patterns: Array<[string, RegExp]> = [
    ["API", /\bAPI\s+(?:GL-?[1-6]|[SFC][A-P](?:\/[SFC][A-P])?)(?:\s+и\s+выше)?\b/gi],
    ["ACEA", /\bACEA\s+[A-E]\d(?:\/[A-E]\d)?\b/gi],
    ["ILSAC", /\bILSAC\s+GF-?\d+[A-Z]?\b/gi],
    ["JASO", /\bJASO\s+[A-Z]{1,3}\d?\b/gi],
    ["DOT", /\bDOT\s*-?\s*[345](?:\+|\.1)?(?:\s+CLASS\s*\d)?\b/gi],
    ["VW", /\bVW\s+(?:TL\s*)?\d{3}(?:[ .-]\d{2,3})?(?:-[A-Z])?\b/gi],
    ["MB", /\bMB(?:-APPROVAL)?\s+\d{3}(?:\.\d+)?\b/gi],
    ["RENAULT", /\bRN\s*0?\d{3}\b/gi],
    ["FORD", /\bFORD\s+WSS-[A-Z0-9-]+\b/gi],
    ["BMW", /\bBMW\s+(?:LONG[- ]?LIFE|LL)[- ]?[A-Z0-9]+\b/gi],
    ["PSA", /\bPSA\s+[A-Z]\d{2}\s*\d{4}\b/gi],
    ["DEXRON", /\b(?:ATF\s+)?DEXRON\s*[D]?\s*(?:II|III|VI)\b/gi],
    ["OEM", /\b(?:NISSAN|TOYOTA|HONDA|MITSUBISHI|SUBARU|MAZDA|HYUNDAI|KIA)\s+(?:ATF|CVTF|MTF|PSF)[A-Z0-9 -]*\b/gi],
  ];
  for (const [type, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[0]) specs.push({ type, value: clean(match[0]) });
    }
  }
  for (const grade of grades) specs.push({ type: "SAE", value: grade });
  return [...new Map(specs.map((spec) => [`${spec.type}|${normalizeSearch(spec.value)}`, spec])).values()];
}

function parseInterval(value: unknown): { kmMin: number | null; kmMax: number | null; months: number | null } {
  const text = clean(value).replace(/,/g, ".");
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*тыс[^\d]{0,12}(?:км)?/i);
  const singleThousands = text.match(/(\d+(?:\.\d+)?)\s*тыс[^\d]{0,12}(?:км)?/i);
  const singleKm = text.match(/\b(\d{3,7})\s*км\b/i);
  let kmMin: number | null = null;
  let kmMax: number | null = null;
  if (range?.[1] && range[2]) {
    kmMin = Math.round(Number(range[1]) * 1000);
    kmMax = Math.round(Number(range[2]) * 1000);
  } else if (singleThousands?.[1]) {
    kmMin = kmMax = Math.round(Number(singleThousands[1]) * 1000);
  } else if (singleKm?.[1]) {
    kmMin = kmMax = Number(singleKm[1]);
  }
  const month = text.match(/\b(\d{1,3})\s*мес/i)?.[1];
  const year = text.match(/\b(\d{1,2})\s*(?:год|лет|года)/i)?.[1];
  const months = month ? Number(month) : year ? Number(year) * 12 : null;
  return { kmMin, kmMax, months };
}

function labelValue(text: string, label: RegExp, next: RegExp): string | null {
  const match = text.match(new RegExp(`${label.source}\\s*:\\s*(.*?)${next.source}`, "is"));
  return nullable(match?.[1]);
}

function matrixPart(label: string, text: string, index: number): RequirementPart {
  const systemName = clean(label.replace(/^column_\d+_?/i, "").replace(/_/g, " ")) || `Колонка ${index + 1}`;
  const fillVolume = labelValue(text, /Объ[её]м\s+заливки/i, /(?=Рекомендац|Требовани|$)/i);
  const specification = labelValue(text, /Требовани[яе]\s+(?:OEM|ОЕМ)/i, /(?=Объ[её]м\s+заливки|Рекомендац|$)/i);
  const recommendation = labelValue(text, /Рекомендац(?:ия|ии)/i, /(?=$)/i);
  return {
    partKey: `matrix:${index}:${normalizeCompact(label)}`,
    systemName,
    systemCode: classifyFluidSystem(systemName),
    componentModel: labelValue(text, /(?:Тип|Модель)/i, /(?=Требовани|Объ[её]м|Рекомендац|$)/i),
    fillVolumeText: fillVolume,
    specificationText: specification,
    recommendationText: recommendation,
    raw: { label, text },
  };
}

function requirementParts(row: PodbormaslaRow): RequirementPart[] {
  if (row.table_kind === "vehicle_fluid_matrix") {
    const columns = safeJson<Record<string, string>>(row.extra_columns_json, {});
    return Object.entries(columns)
      .filter(([, value]) => clean(value))
      .map(([label, text], index) => matrixPart(label, text, index));
  }
  const systemName = clean(row.system_name || row.application || "Неизвестный узел");
  const systemCode = classifyFluidSystem(systemName);
  return [{
    partKey: "row",
    systemName,
    systemCode,
    componentModel: systemCode === "ENGINE_OIL" ? null : nullable(row.model),
    fillVolumeText: nullable(row.fill_volume),
    specificationText: nullable(row.specification),
    recommendationText: nullable(row.recommendation),
    raw: { rowText: row.row_text ?? null },
  }];
}

function isEngineRow(row: PodbormaslaRow): boolean {
  return classifyFluidSystem(row.system_name || row.application) === "ENGINE_OIL";
}

function driveFromText(value: unknown): string | null {
  const text = normalizeSearch(value);
  if (/\b4WD\b|\bAWD\b|ПОЛН.*ПРИВОД/.test(text)) return "awd";
  if (/ЗАДН.*ПРИВОД/.test(text)) return "rwd";
  if (/ПЕРЕДН.*ПРИВОД/.test(text)) return "fwd";
  return null;
}

function contextFromRows(rows: PodbormaslaRow[], fallback: PodbormaslaRow, confidence: VehicleContext["confidence"]): VehicleContext {
  const candidates = rows.length ? rows : [fallback];
  const engineCodes = unique(candidates.flatMap((row) => [
    ...extractEngineCodes(row.model, true),
    ...extractEngineCodes(row.application),
  ]));
  const volumes = unique(candidates.map((row) => String(parseEngineVolumeCc(row.engine_displacement || row.application) ?? ""))).filter(Boolean).map(Number);
  const powersHp = unique(candidates.map((row) => String(parsePowerHp(row.power, row.model, row.application) ?? ""))).filter(Boolean).map(Number);
  const powersKw = unique(candidates.map((row) => String(parsePowerKw(row.power, row.model, row.application) ?? ""))).filter(Boolean).map(Number);
  const fuels = unique(candidates.map((row) => normalizeFuel(row.fuel_type || row.application)));
  const range = intersectRange(candidates.map((row) => parseYearRange(row.production_years || row.application || row.page_title)));
  const drives = unique(candidates.map((row) => driveFromText(row.application)));
  return {
    engineCodes,
    engineVolumeCc: volumes.length === 1 ? volumes[0] ?? null : null,
    powerKw: powersKw.length === 1 ? powersKw[0] ?? null : null,
    powerHp: powersHp.length === 1 ? powersHp[0] ?? null : null,
    fuelType: fuels.length === 1 ? fuels[0] ?? null : null,
    yearFrom: range.from,
    yearTo: range.to,
    driveType: drives.length === 1 ? drives[0] ?? null : null,
    transmissionType: null,
    confidence,
  };
}

function matrixContext(row: PodbormaslaRow): VehicleContext {
  const columns = safeJson<Record<string, string>>(row.extra_columns_json, {});
  const engineText = Object.entries(columns).find(([key]) => /моторн.*масл/i.test(key.replace(/_/g, " ")))?.[1] ?? "";
  const range = parseYearRange(row.application || row.page_title);
  return {
    engineCodes: extractEngineCodes(engineText, true),
    engineVolumeCc: parseEngineVolumeCc(engineText),
    powerKw: parsePowerKw(engineText),
    powerHp: parsePowerHp(engineText),
    fuelType: normalizeFuel(engineText),
    yearFrom: range.from,
    yearTo: range.to,
    driveType: driveFromText(row.application),
    transmissionType: nullable(row.application?.match(/КПП\s*:\s*([^\n]+)/i)?.[1]),
    confidence: "matrix_row",
  };
}

const CYRILLIC_LOOKALIKES: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X" };

function latinLookalikes(value: unknown): string {
  return clean(value).toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, (char) => CYRILLIC_LOOKALIKES[char] ?? char);
}

function bodyCodeTokens(value: unknown): string[] {
  const text = clean(value).toUpperCase();
  return unique([...text.matchAll(/\(([^)]+)\)/g)].flatMap((match) => String(match[1] ?? "").split(/[,;/]+/))
    .filter((value) => !/[БГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯ]/.test(value))
    .map(latinLookalikes)
    .map((value) => value.replace(/[^A-Z0-9]/g, ""))
    .filter((value) => /[A-Z]/.test(value) && (/\d/.test(value) || /^[A-Z]{2,3}$/.test(value))));
}

function bodyCodes(row: PodbormaslaRow): string[] {
  const modelToken = normalizeCompact(latinLookalikes(row.model_slug));
  const title = latinLookalikes(row.page_title);
  const inlineCodes = [...title.matchAll(/\b(?:[A-Z]{1,3}\d{1,3}[A-Z]?|\d[A-Z]{1,3})\b/g)].map((match) => match[0]);
  return unique([...bodyCodeTokens(row.page_title), ...inlineCodes])
    .filter((code) => !/^(?:19|20)\d{2}$/.test(code) && normalizeCompact(code) !== modelToken);
}

function parseSourceRows(rowsNdjson: string): PodbormaslaRow[] {
  const rows = rowsNdjson.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line) as PodbormaslaRow;
    } catch (error) {
      throw new Error(`Некорректный NDJSON, строка ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.row_id || !row.source_url || !Number.isInteger(row.table_index) || !Number.isInteger(row.row_index)) {
      throw new Error("В выгрузке podbormasla отсутствуют обязательные поля row_id/source_url/table_index/row_index.");
    }
    if (ids.has(row.row_id)) throw new Error(`Повтор row_id: ${row.row_id}`);
    ids.add(row.row_id);
  }
  return rows;
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...body] = rows;
  if (!headers) return [];
  return body.filter((cells) => cells.some((cell) => cell.trim())).map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index]?.trim() ?? ""])));
}

function mannVariantKey(row: CsvRow): string {
  const normalizeText = (value: unknown) => clean(value).toUpperCase();
  return sha256([
    normalizeText(row.make),
    normalizeSearch(row.model),
    normalizeSearch(row.effective_vehicle_text || row.vehicle_text),
    normalizeEngineCode(row.engine_code),
    normalizeText(row.kw),
    normalizeText(row.hp),
    normalizeText(row.vehicle_years),
    normalizeSearch(row.condition),
  ].join("|"));
}

function mannVolume(row: CsvRow): number | null {
  return parseCatalogVehicleVolumeCc(row.effective_vehicle_text, row.vehicle_text, row.condition);
}

function parseMannVariants(csvText: string): MannVariant[] {
  const variants = new Map<string, MannVariant>();
  for (const row of parseCsv(csvText)) {
    if (!row.make || !row.model) continue;
    const variantKey = mannVariantKey(row);
    if (variants.has(variantKey)) continue;
    const years = parseMannYears(row.vehicle_years || row.model_years);
    const makeNormalized = normalizeMake(row.make);
    variants.set(variantKey, {
      variantKey,
      make: row.make,
      makeNormalized,
      model: row.model,
      modelNormalized: normalizeSearch(row.model),
      baseModelNormalized: baseModel(row.model, makeNormalized),
      generationNumber: generationNumber(row.model),
      bodyCodes: bodyCodeTokens(row.model),
      vehicleText: nullable(row.vehicle_text),
      effectiveVehicleText: nullable(row.effective_vehicle_text),
      engineCode: nullable(row.engine_code),
      engineCodes: engineCodeParts(row.engine_code),
      engineVolumeCc: mannVolume(row),
      kw: parseNumber(row.kw),
      hp: parseNumber(row.hp),
      fuelType: normalizeCatalogFuel(row.effective_vehicle_text, row.vehicle_text, row.condition),
      yearFrom: years.from,
      yearTo: years.to,
      condition: nullable(row.condition),
    });
  }
  return [...variants.values()];
}

function sourceRowData(row: PodbormaslaRow): PreparedFluidSourceRow {
  const make = nullable(row.brand_slug);
  const model = nullable(row.model_slug);
  return {
    id: row.row_id,
    sourceUrl: row.source_url,
    pagePath: nullable(row.page_path),
    pageTitle: nullable(row.page_title),
    makeRaw: make,
    makeNormalized: make ? normalizeMake(make) : null,
    modelRaw: model,
    modelNormalized: model ? baseModel(model, make ? normalizeMake(make) : undefined) : null,
    generationRaw: nullable(row.generation_slug),
    tableIndex: row.table_index,
    rowIndex: row.row_index,
    tableKind: nullable(row.table_kind),
    applicationRaw: nullable(row.application),
    systemNameRaw: nullable(row.system_name),
    rawCellsJson: safeJson<Prisma.InputJsonValue>(row.raw_cells_json, []),
    parsedRowJson: row as unknown as Prisma.InputJsonValue,
    sourceFetchedAt: parseDate(row.fetched_at),
    sourcePageHash: nullable(row.page_sha256),
  };
}

function buildRequirement(
  row: PodbormaslaRow,
  part: RequirementPart,
  context: VehicleContext,
): PreparedFluidRequirement {
  const make = clean(row.brand_slug).replace(/[_-]+/g, " ") || "UNKNOWN";
  const model = clean(row.model_slug).replace(/[_-]+/g, " ") || "UNKNOWN";
  const makeNormalized = normalizeMake(make);
  const modelNormalized = baseModel(model, makeNormalized);
  const generation = generationFromSlug(row.generation_slug) ?? generationNumber(row.page_title);
  const capacities = parseCapacities(part.fillVolumeText);
  const capacity = capacitySummary(capacities);
  const grades = unique([
    ...safeJson<string[]>(row.sae_json, []),
    ...viscosityGrades(part.specificationText, part.recommendationText),
  ]);
  const specifications = parseSpecifications(part.specificationText, grades);
  const replacementText = nullable(row.replacement_interval);
  const interval = parseInterval(replacementText);
  const sourceTableKey = sha256(`${row.source_url}|${row.table_index}`);
  const id = sha256(`${row.row_id}|${part.partKey}`);
  return {
    id,
    sourceRowId: row.row_id,
    sourceTableKey,
    sourceUrl: row.source_url,
    make,
    makeNormalized,
    model,
    modelNormalized,
    generation: romanGeneration(generation),
    generationNumber: generation,
    bodyCodesJson: bodyCodes(row),
    yearFrom: context.yearFrom,
    yearTo: context.yearTo,
    engineCodeNormalized: context.engineCodes[0] ?? null,
    engineCodesJson: context.engineCodes,
    engineVolumeCc: context.engineVolumeCc,
    powerKw: context.powerKw,
    powerHp: context.powerHp,
    fuelType: context.fuelType,
    driveType: context.driveType,
    transmissionType: context.transmissionType ?? transmissionType(part.systemCode),
    componentModel: part.componentModel,
    systemCode: part.systemCode,
    systemNameRaw: part.systemName,
    fillVolumeText: part.fillVolumeText,
    fillVolumeMinLiters: capacity.min,
    fillVolumeMaxLiters: capacity.max,
    serviceVolumeLiters: capacity.service,
    totalVolumeLiters: capacity.total,
    capacitiesJson: capacities,
    specificationText: part.specificationText,
    specificationsJson: specifications,
    viscosityGradesJson: grades,
    recommendationText: part.recommendationText,
    replacementIntervalText: replacementText,
    replacementKmMin: interval.kmMin,
    replacementKmMax: interval.kmMax,
    replacementMonths: interval.months,
    controlIntervalText: nullable(row.control_interval),
    analogText: nullable(row.analog),
    contextConfidence: context.confidence,
    rawRequirementJson: { sourceRowId: row.row_id, part: part.raw } as Prisma.InputJsonValue,
  };
}

function buildRequirements(rows: PodbormaslaRow[]): PreparedFluidRequirement[] {
  const byTable = new Map<string, PodbormaslaRow[]>();
  for (const row of rows) {
    const key = `${row.source_url}|${row.table_index}`;
    const current = byTable.get(key) ?? [];
    current.push(row);
    byTable.set(key, current);
  }
  const requirements: PreparedFluidRequirement[] = [];
  for (const tableRows of byTable.values()) {
    const engineRows = tableRows.filter(isEngineRow);
    const tableContext = contextFromRows(engineRows, tableRows[0]!, engineRows.length ? "table_engine" : "page");
    for (const row of tableRows) {
      const context = row.table_kind === "vehicle_fluid_matrix"
        ? matrixContext(row)
        : isEngineRow(row)
          ? contextFromRows([row], row, "row_engine")
          : tableContext;
      for (const part of requirementParts(row)) requirements.push(buildRequirement(row, part, context));
    }
  }
  return requirements;
}

function rangesOverlap(requirement: PreparedFluidRequirement, variant: MannVariant): boolean {
  const requirementFrom = requirement.yearFrom ?? 1886;
  const requirementTo = requirement.yearTo ?? CURRENT_YEAR + 1;
  const variantFrom = variant.yearFrom ?? 1886;
  const variantTo = variant.yearTo ?? CURRENT_YEAR + 1;
  return requirementFrom <= variantTo && variantFrom <= requirementTo;
}

type CandidateEvaluation = {
  variant: MannVariant;
  score: number;
  matched: string[];
  missing: string[];
  mismatched: string[];
  exactEngine: boolean;
  familyEngine: boolean;
  specializedFamilyEngine: boolean;
  bodyCodeMatch: boolean;
};

function stringArray(value: Prisma.InputJsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function engineFamilyMatches(source: string, candidate: string): boolean {
  const left = normalizeCompact(source);
  const right = normalizeCompact(candidate);
  return Math.min(left.length, right.length) >= 4 && (left.startsWith(right) || right.startsWith(left));
}

function matchesKnownEngineVariantCue(requirement: PreparedFluidRequirement, variant: MannVariant, sourceCodes: string[]): boolean {
  const isForesterEj255 = requirement.makeNormalized === "SUBARU"
    && requirement.modelNormalized === "FORESTER"
    && sourceCodes.some((code) => normalizeCompact(code) === "EJ255");
  if (!isForesterEj255) return true;
  return normalizeCompact(variant.effectiveVehicleText ?? variant.vehicleText).includes("XT");
}

function evaluateCandidate(requirement: PreparedFluidRequirement, variant: MannVariant): CandidateEvaluation | null {
  if (variant.makeNormalized !== requirement.makeNormalized) return null;
  if (variant.baseModelNormalized !== requirement.modelNormalized) return null;
  if (requirement.generationNumber && variant.generationNumber && requirement.generationNumber !== variant.generationNumber) return null;
  if (!rangesOverlap(requirement, variant)) return null;

  const sourceBodyCodes = stringArray(requirement.bodyCodesJson);
  const bodyCodeMatch = sourceBodyCodes.length > 0 && variant.bodyCodes.some((code) => sourceBodyCodes.includes(code));
  if (sourceBodyCodes.length > 0 && variant.bodyCodes.length > 0 && !bodyCodeMatch) return null;
  const sourceCodes = stringArray(requirement.engineCodesJson);
  if (!matchesKnownEngineVariantCue(requirement, variant, sourceCodes)) return null;
  const matchedKnownEngineVariantCue = requirement.makeNormalized === "SUBARU"
    && requirement.modelNormalized === "FORESTER"
    && sourceCodes.some((code) => normalizeCompact(code) === "EJ255");
  const exactEngine = sourceCodes.length > 0 && variant.engineCodes.some((code) => sourceCodes.some((source) => normalizeCompact(source) === normalizeCompact(code)));
  const familyEngine = !exactEngine && sourceCodes.length > 0 && variant.engineCodes.some((candidate) => sourceCodes.some((source) => engineFamilyMatches(source, candidate)));
  const specializedFamilyEngine = familyEngine && variant.engineCodes.some((candidate) => sourceCodes.some((source) => {
    const sourceCompact = normalizeCompact(source);
    const candidateCompact = normalizeCompact(candidate);
    return sourceCompact.length >= 4 && candidateCompact.length > sourceCompact.length && candidateCompact.startsWith(sourceCompact);
  }));
  const engineMismatch = sourceCodes.length > 0 && variant.engineCodes.length > 0 && !exactEngine && !familyEngine;
  if (requirement.engineVolumeCc && variant.engineVolumeCc && Math.abs(requirement.engineVolumeCc - variant.engineVolumeCc) > 75) return null;
  if (requirement.fuelType && variant.fuelType && requirement.fuelType !== variant.fuelType) return null;

  let score = 30;
  const matched = ["make", "base_model"];
  const missing: string[] = [];
  const mismatched: string[] = [];
  if (bodyCodeMatch) {
    score += 20;
    matched.push("body_code");
  }
  if (requirement.generationNumber) {
    if (variant.generationNumber) {
      score += 25;
      matched.push("generation");
    } else missing.push("mann_generation");
  }
  if (requirement.yearFrom || requirement.yearTo) {
    if (variant.yearFrom || variant.yearTo) {
      score += 15;
      matched.push("years");
    } else missing.push("mann_years");
  }
  if (sourceCodes.length > 0) {
    if (exactEngine) {
      score += 35;
      matched.push("exact_engine_code");
    } else if (familyEngine) {
      score += specializedFamilyEngine ? 30 : 25;
      matched.push(specializedFamilyEngine ? "engine_alias" : "engine_family");
    } else if (engineMismatch) {
      mismatched.push("engine_code");
    } else missing.push("mann_engine_code");
  }
  if (matchedKnownEngineVariantCue) {
    score += 15;
    matched.push("engine_variant_xt");
  }
  if (requirement.engineVolumeCc) {
    if (variant.engineVolumeCc) {
      score += 15;
      matched.push("engine_volume");
    } else missing.push("mann_engine_volume");
  }
  if (requirement.powerHp || requirement.powerKw) {
    const hpMatches = requirement.powerHp != null && variant.hp != null && Math.abs(requirement.powerHp - variant.hp) <= 5;
    const kwMatches = requirement.powerKw != null && variant.kw != null && Math.abs(requirement.powerKw - variant.kw) <= 3;
    if (hpMatches || kwMatches) {
      score += 10;
      matched.push("power");
    } else if (variant.hp != null || variant.kw != null) mismatched.push("power");
    else missing.push("mann_power");
  }
  if (requirement.fuelType) {
    if (variant.fuelType) {
      score += 7;
      matched.push("fuel");
    } else missing.push("mann_fuel");
  }
  return { variant, score, matched, missing, mismatched, exactEngine, familyEngine, specializedFamilyEngine, bodyCodeMatch };
}

function linkFor(requirement: PreparedFluidRequirement, evaluation: CandidateEvaluation, status: PreparedMannFluidLink["status"]): PreparedMannFluidLink {
  const confidence: PreparedMannFluidLink["confidence"] = status === "auto_matched" ? "high" : evaluation.score >= 65 ? "medium" : "low";
  return {
    id: sha256(`${requirement.id}|${evaluation.variant.variantKey}`),
    requirementId: requirement.id,
    mannVariantKey: evaluation.variant.variantKey,
    mannMake: evaluation.variant.make,
    mannModel: evaluation.variant.model,
    mannVehicleText: evaluation.variant.effectiveVehicleText ?? evaluation.variant.vehicleText,
    mannEngineCode: evaluation.variant.engineCode,
    matchScore: evaluation.score,
    confidence,
    status,
    matchMethod: evaluation.exactEngine
      ? "make_model_exact_engine"
      : evaluation.specializedFamilyEngine
        ? "make_model_engine_alias"
        : evaluation.familyEngine
          ? "make_model_engine_family"
          : "make_model_generation_year",
    evidenceJson: {
      matched: evaluation.matched,
      missing: evaluation.missing,
      mismatched: evaluation.mismatched,
      sourceEngineCodes: stringArray(requirement.engineCodesJson),
      sourceBodyCodes: stringArray(requirement.bodyCodesJson),
      mannBodyCodes: evaluation.variant.bodyCodes,
      sourceYears: [requirement.yearFrom, requirement.yearTo],
      mannYears: [evaluation.variant.yearFrom, evaluation.variant.yearTo],
    },
  };
}

function candidateIdentityKey(requirement: PreparedFluidRequirement, candidate: CandidateEvaluation): string {
  const variant = candidate.variant;
  const sourceHasPower = requirement.powerHp != null || requirement.powerKw != null;
  return [
    variant.modelNormalized,
    normalizeSearch(variant.effectiveVehicleText ?? variant.vehicleText),
    normalizeEngineCode(variant.engineCode),
    sourceHasPower ? variant.kw ?? "" : "",
    sourceHasPower ? variant.hp ?? "" : "",
  ].join("|");
}

function isGenericMannVariant(candidate: CandidateEvaluation): boolean {
  return /^(?:ALL MODELS|ВСЕ МОДЕЛИ)$/.test(normalizeSearch(candidate.variant.effectiveVehicleText ?? candidate.variant.vehicleText));
}

function isActionableReviewCandidate(candidate: CandidateEvaluation): boolean {
  if (candidate.score < 70 || candidate.mismatched.length > 0 || isGenericMannVariant(candidate)) return false;
  const matched = new Set(candidate.matched);
  if (candidate.exactEngine) return true;
  if (candidate.familyEngine) {
    return matched.has("years") && ["body_code", "generation", "engine_volume", "power", "fuel"].some((key) => matched.has(key));
  }
  const structuredVehicle = matched.has("body_code") || matched.has("generation");
  const engineIdentity = matched.has("engine_volume") && (matched.has("power") || matched.has("fuel"));
  return matched.has("years") && engineIdentity && (structuredVehicle || (matched.has("power") && matched.has("fuel")));
}

function broadContextAutoCandidates(requirement: PreparedFluidRequirement, candidates: CandidateEvaluation[]): CandidateEvaluation[] {
  if (stringArray(requirement.engineCodesJson).length > 0) return [];
  const viable = candidates.filter((candidate) => {
    if (candidate.mismatched.length > 0 || isGenericMannVariant(candidate)) return false;
    const matched = new Set(candidate.matched);
    const structuredVehicle = matched.has("body_code") || matched.has("generation");
    if (!structuredVehicle || !matched.has("years") || !matched.has("engine_volume") || !matched.has("fuel")) return false;
    if ((requirement.powerHp != null || requirement.powerKw != null) && !matched.has("power")) return false;
    return true;
  });
  return viable.length > 0 ? viable : [];
}

function strongIdentityAutoCandidates(requirement: PreparedFluidRequirement, candidates: CandidateEvaluation[]): CandidateEvaluation[] {
  const viable = candidates.filter((candidate) => isActionableReviewCandidate(candidate));
  const groups = new Map<string, CandidateEvaluation[]>();
  for (const candidate of viable) {
    const key = candidateIdentityKey(requirement, candidate);
    const current = groups.get(key) ?? [];
    current.push(candidate);
    groups.set(key, current);
  }
  const ranked = [...groups.values()].sort((left, right) => (right[0]?.score ?? 0) - (left[0]?.score ?? 0));
  const best = ranked[0];
  const minimumScore = best?.[0]?.familyEngine ? 85 : 92;
  if (!best?.[0] || best[0].score < minimumScore) return [];
  const secondScore = ranked[1]?.[0]?.score ?? -Infinity;
  if (ranked.length > 1 && best[0].score - secondScore < 15) return [];
  const matched = new Set(best[0].matched);
  const hasEngineIdentity = best[0].familyEngine
    || (matched.has("engine_volume") && (matched.has("power") || matched.has("fuel")) && (matched.has("body_code") || matched.has("generation")));
  return matched.has("years") && hasEngineIdentity ? best : [];
}

function matchRequirements(requirements: PreparedFluidRequirement[], variants: MannVariant[]) {
  const variantsByVehicle = new Map<string, MannVariant[]>();
  for (const variant of variants) {
    const key = `${variant.makeNormalized}|${variant.baseModelNormalized}`;
    const current = variantsByVehicle.get(key) ?? [];
    current.push(variant);
    variantsByVehicle.set(key, current);
  }
  const links: PreparedMannFluidLink[] = [];
  const reviewRows: FluidReviewRow[] = [];
  for (const requirement of requirements) {
    const candidates = (variantsByVehicle.get(`${requirement.makeNormalized}|${requirement.modelNormalized}`) ?? [])
      .map((variant) => evaluateCandidate(requirement, variant))
      .filter((candidate): candidate is CandidateEvaluation => Boolean(candidate))
      .sort((left, right) => right.score - left.score || left.variant.variantKey.localeCompare(right.variant.variantKey));
    const exactCandidates = candidates.filter((candidate) => (candidate.exactEngine || candidate.specializedFamilyEngine) && candidate.score >= 80 && candidate.mismatched.length === 0);
    const broadCandidates = broadContextAutoCandidates(requirement, candidates);
    const autoCandidates = exactCandidates.length > 0
      ? exactCandidates
      : broadCandidates.length > 0
        ? broadCandidates
        : strongIdentityAutoCandidates(requirement, candidates);
    const selected = autoCandidates.length > 0
      ? autoCandidates
      : candidates.filter(isActionableReviewCandidate).slice(0, 3);
    const status: FluidReviewRow["status"] = autoCandidates.length > 0 ? "auto_matched" : selected.length > 0 ? "review_required" : "unmatched";
    for (const candidate of selected) links.push(linkFor(requirement, candidate, status === "auto_matched" ? "auto_matched" : "review_required"));
    const best = candidates[0];
    reviewRows.push({
      requirementId: requirement.id,
      sourceUrl: requirement.sourceUrl,
      make: requirement.make,
      model: requirement.model,
      generation: requirement.generation ?? "",
      engineCodes: stringArray(requirement.engineCodesJson).join("; "),
      years: [requirement.yearFrom, requirement.yearTo].filter((value) => value != null).join("-") ,
      systemCode: requirement.systemCode,
      systemName: requirement.systemNameRaw,
      status,
      candidateCount: candidates.length,
      bestScore: best?.score ?? null,
      bestMannModel: best?.variant.model ?? "",
      bestMannVehicle: best?.variant.effectiveVehicleText ?? best?.variant.vehicleText ?? "",
      bestMannEngine: best?.variant.engineCode ?? "",
      evidence: best ? [...best.matched, ...best.missing.map((item) => `missing:${item}`), ...best.mismatched.map((item) => `mismatch:${item}`)].join("; ") : "",
    });
  }
  return { links, reviewRows };
}

function summaryCount(summaryJson: string | null | undefined): number | null {
  if (!summaryJson?.trim()) return null;
  try {
    const parsed = JSON.parse(summaryJson) as { counts?: { rows?: unknown } };
    const count = Number(parsed.counts?.rows);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

export function prepareFluidCatalog(input: PrepareFluidCatalogInput): PreparedFluidCatalog {
  const parsedRows = parseSourceRows(input.rowsNdjson);
  const sourceRows = parsedRows.map(sourceRowData);
  const requirements = buildRequirements(parsedRows);
  const variants = parseMannVariants(input.mannFiltersCsv);
  const { links, reviewRows } = matchRequirements(requirements, variants);
  const systemCounts: Record<string, number> = {};
  for (const requirement of requirements) systemCounts[requirement.systemCode] = (systemCounts[requirement.systemCode] ?? 0) + 1;
  const statusByRequirement = new Map<string, Set<string>>();
  for (const link of links) {
    const statuses = statusByRequirement.get(link.requirementId) ?? new Set<string>();
    statuses.add(link.status);
    statusByRequirement.set(link.requirementId, statuses);
  }
  const expectedRows = summaryCount(input.summaryJson);
  const warnings: string[] = [];
  if (expectedRows != null && expectedRows !== sourceRows.length) warnings.push(`В summary указано ${expectedRows} строк, прочитано ${sourceRows.length}.`);
  const stats: FluidImportStats = {
    sourceRows: sourceRows.length,
    requirements: requirements.length,
    requirementsWithCapacity: requirements.filter((requirement) => requirement.fillVolumeMinLiters != null).length,
    requirementsWithSpecification: requirements.filter((requirement) => Boolean(requirement.specificationText)).length,
    requirementsWithEngineContext: requirements.filter((requirement) => stringArray(requirement.engineCodesJson).length > 0).length,
    sourceTables: new Set(requirements.map((requirement) => requirement.sourceTableKey)).size,
    systemCounts: Object.fromEntries(Object.entries(systemCounts).sort((left, right) => right[1] - left[1])),
    mannVariants: variants.length,
    links: links.length,
    autoMatchedLinks: links.filter((link) => link.status === "auto_matched").length,
    reviewLinks: links.filter((link) => link.status === "review_required").length,
    autoMatchedRequirements: [...statusByRequirement.values()].filter((statuses) => statuses.has("auto_matched")).length,
    reviewRequirements: [...statusByRequirement.values()].filter((statuses) => statuses.has("review_required") && !statuses.has("auto_matched")).length,
    unmatchedRequirements: requirements.length - statusByRequirement.size,
    distinctLinkedMannVariants: new Set(links.map((link) => link.mannVariantKey)).size,
    sourceHash: sha256(input.rowsNdjson),
    mannSourceHash: sha256(input.mannFiltersCsv),
    warnings,
  };
  return { sourceRows, requirements, links, reviewRows, stats };
}

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<{ count: number }>): Promise<number> {
  let count = 0;
  for (let index = 0; index < rows.length; index += 750) count += (await insert(rows.slice(index, index + 750))).count;
  return count;
}

function summaryInput(value?: string | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!value?.trim()) return Prisma.JsonNull;
  try {
    return JSON.parse(value) as Prisma.InputJsonValue;
  } catch {
    return Prisma.JsonNull;
  }
}

export async function importFluidCatalog(input: ImportFluidCatalogInput): Promise<FluidImportStats & { batchId: string }> {
  const prepared = prepareFluidCatalog(input);
  if (prepared.stats.warnings.length > 0) throw new Error(`Импорт остановлен: ${prepared.stats.warnings.join(" ")}`);

  const existingVariantRows = await prisma.mannFilterApplication.findMany({ select: { vehicleVariantKey: true }, distinct: ["vehicleVariantKey"] });
  const existingVariants = new Set(existingVariantRows.map((row) => row.vehicleVariantKey));
  const missingVariantKeys = unique(prepared.links.map((link) => link.mannVariantKey).filter((key) => !existingVariants.has(key)));
  if (missingVariantKeys.length > 0) {
    throw new Error(`MANN-каталог в БД отличается от CSV: отсутствует ${missingVariantKeys.length} vehicleVariantKey.`);
  }

  const batch = await prisma.fluidCatalogImportBatch.create({
    data: {
      status: "importing",
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      sourceFile: input.rowsFileName,
      sourceHash: prepared.stats.sourceHash,
      summaryJson: summaryInput(input.summaryJson),
      statsJson: prepared.stats as unknown as Prisma.InputJsonValue,
      importedById: input.importedById ?? null,
    },
  });
  try {
    await prisma.$transaction(async (tx) => {
      if (input.replaceExisting ?? true) {
        const oldBatches = await tx.fluidCatalogImportBatch.findMany({
          where: { sourceName: SOURCE_NAME, id: { not: batch.id } },
          select: { id: true },
        });
        await tx.fluidSourceRow.deleteMany({ where: { importBatchId: { in: oldBatches.map((item) => item.id) } } });
      }
      await insertChunks(prepared.sourceRows, (chunk) => tx.fluidSourceRow.createMany({
        data: chunk.map((row) => ({ ...row, importBatchId: batch.id })) as Prisma.FluidSourceRowCreateManyInput[],
      }));
      await insertChunks(prepared.requirements, (chunk) => tx.vehicleFluidRequirement.createMany({
        data: chunk.map((row) => ({ ...row, importBatchId: batch.id })) as Prisma.VehicleFluidRequirementCreateManyInput[],
      }));
      await insertChunks(prepared.links, (chunk) => tx.mannFluidRequirementLink.createMany({
        data: chunk as Prisma.MannFluidRequirementLinkCreateManyInput[],
      }));
      await tx.fluidCatalogImportBatch.update({
        where: { id: batch.id },
        data: { status: "imported", statsJson: prepared.stats as unknown as Prisma.InputJsonValue, completedAt: new Date() },
      });
    }, { timeout: 600_000 });
  } catch (error) {
    await prisma.fluidCatalogImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "error",
        errorsJson: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date(),
      },
    }).catch(() => undefined);
    throw error;
  }
  return { ...prepared.stats, batchId: batch.id };
}

export async function listFluidRequirementsForMannVariant(
  mannVariantKey: string,
  options: { includeReview?: boolean } = {},
) {
  const statuses = options.includeReview ? ["auto_matched", "confirmed", "review_required"] : ["auto_matched", "confirmed"];
  return prisma.mannFluidRequirementLink.findMany({
    where: { mannVariantKey, status: { in: statuses } },
    include: { requirement: { include: { sourceRow: true } } },
    orderBy: [{ requirement: { systemCode: "asc" } }, { matchScore: "desc" }],
  });
}
