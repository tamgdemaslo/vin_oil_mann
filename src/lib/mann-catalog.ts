import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";
import {
  buildPartNumberCollisionIndex,
  isSafeCompactKey,
  listPartNumberCollisions,
  normalizeCrossReferenceBrand,
  normalizePartNumberForCrossMatch,
  parseOemParts,
} from "@/lib/part-number-cross-reference";

const LEGACY_MANN_EXPECTED_COUNTS = {
  applicationRows: 24502,
  filterRows: 37772,
  uniqueMakes: 133,
  uniqueModels: 1618,
  uniqueMannArticles: 2050,
};

type MannExpectedCounts = typeof LEGACY_MANN_EXPECTED_COUNTS;

type CsvRow = Record<string, string>;

export type MannImportInput = {
  applicationsCsv: string;
  applicationsFileName: string;
  filtersCsv: string;
  filtersFileName: string;
  summaryJson?: string | null;
  importedById?: string | null;
  dryRun?: boolean;
  replaceExisting?: boolean;
};

export type MannImportStats = {
  applicationRows: number;
  filterRows: number;
  uniqueMakes: number;
  uniqueModels: number;
  uniqueMannArticles: number;
  filterTypeCounts: Record<string, number>;
  applicationsSourceHash: string;
  filtersSourceHash: string;
  expected?: Partial<MannExpectedCounts>;
  warnings: string[];
};

type ImportPrepared = {
  stats: MannImportStats;
  summary: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  rawRows: Prisma.MannPdfApplicationRawCreateManyInput[];
  filterRows: Prisma.MannFilterApplicationCreateManyInput[];
};

type MatchInputArticle = {
  mannArticle: string;
  filterType?: string;
  filterSubtype?: string | null;
};

export type MannLocalProductMatch = {
  id: string;
  name: string;
  meta: { href: string; type: string; mediaType: string };
  article?: string | null;
  code?: string | null;
  brand?: string | null;
  price: number;
  currency: string;
  stock: number;
  reserve: number;
  available: number;
  cell?: string | null;
  buyPriceCents?: number | null;
  cost?: number;
  orderable: boolean;
  matchType: MannLocalProductMatchType;
  matchConfidence: number;
  matchReason: string;
};

export type MannLocalProductMatchType =
  | "EXACT_PRODUCT_BRAND_ARTICLE"
  | "OEM_EXACT_BRAND_ARTICLE"
  | "OEM_EXACT_ARTICLE"
  | "OEM_SAFE_COMPACT"
  | "PRODUCT_MANN_LINK";

export type MannArticleMatchResult = {
  mannArticle: string;
  mannArticleNormalized: string;
  filterType?: string;
  filterSubtype?: string | null;
  compatibleProducts: MannLocalProductMatch[];
  localMatches: MannLocalProductMatch[];
  /** @deprecated Compatibility alias for the first commercially ranked product. */
  bestMatch: MannLocalProductMatch | null;
  matchConfidence: number;
  matchReason: string;
  stock: number;
  available: number;
  price: number | null;
  cell?: string | null;
  status: "found" | "not_found";
  coverageStatus: "OEM_COVERED" | "OEM_NOT_COVERED";
  diagnostics: {
    candidateCount: number;
    compatibleCount: number;
    canonicalArticle: string;
    compactCandidate: string;
    compactCollisionBlocked: boolean;
    collisionCanonicalArticles: string[];
    localProductScanMs: number;
    parsingMs: number;
    totalMs: number;
  };
};

export function normalizeMannText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function normalizeMannSearchText(value: unknown): string {
  return normalizeMannText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const MANN_NON_VEHICLE_VARIANT_MARKERS = [
  "ALLMODELS",
  "EXPORTMODELL",
  "EXPORTMODELFOR",
  "KUNSTSTOFFOLFILTERMODUL",
  "PLASTICOILFILTERMODULE",
  "ALUOLFILTERMODUL",
  "ALUMINIUMOILFILTERMODULE",
  "GEHAUSEHOUSING",
  "FURKALTEKLIMAZONEN",
  "FORCOLDCLIMATES",
  "EINBAURECHTS",
  "RIGHTSIDE",
  "STAUBREICHEEINSATZBEDINGUNGEN",
  "USEINDUSTYENVIRONMENTS",
  "LINKSLENKER",
  "LEFTHANDDRIVE",
  "RECHTSLENKER",
  "RIGHTHANDDRIVE",
  "EINBAULINKS",
  "LEFTSIDE",
  "EINSPRITZSYSTEM",
  "INJECTIONSYSTEM",
  "ANZAHL",
  "QUANTITY",
  "WAHLWEISE",
  "OPTIONALLY",
  "FILTERELEMENT",
  "ANSCHRAUBFILTER",
  "SPINONFILTER",
  "FLACHLUFTFILTERELEMENT",
  "PANELAIRFILTER",
  "KRAFTSTOFFFILTERAUSSERHALB",
  "FUELFILTERFITTED",
  "PARTIKELFILTER",
  "PARTICULATEFILTER",
  "AKTIVKOHLEFILTER",
  "ACTIVATEDCARBONFILTER",
  "VORFILTER",
  "PREFILTER",
  "BIOFUNKTIONALERINNENRAUMFILTER",
  "BIOFUNCTIONALCABINAIRFILTER",
  "EINBAUORT",
  "MOUNTINGPOSITION",
  "AUTOMATIKGETRIEBE",
  "AUTOMATICGEARBOX",
  "GETRIEBECODE",
  "GEARBOXCODE",
  "FILTRATIONSSYSTEM",
  "FILTRATIONSYSTEM",
];

/** True when a PDF context/qualifier row was imported as if it were a vehicle modification. */
export function isMannNonVehicleVariantText(value: unknown): boolean {
  const compact = normalizeMannSearchText(value).replace(/\s+/g, "");
  if (!compact) return false;
  return compact === "ВСЕМОДЕЛИ" || MANN_NON_VEHICLE_VARIANT_MARKERS.some((marker) => compact.includes(marker));
}

/** Final in-memory guard shared by every UI path that displays MANN variants. */
export function filterMannVehicleVariants<Variant extends { vehicleText?: string | null; effectiveVehicleText?: string | null }>(variants: Variant[]): Variant[] {
  return variants.filter((variant) => !isMannNonVehicleVariantText(variant.effectiveVehicleText ?? variant.vehicleText));
}

export function normalizeMannArticle(value: unknown): string {
  return normalizePartArticle(value).structural;
}

export type NormalizedPartArticle = {
  structural: string;
  compact: string;
};

/**
 * Central article normalization. `structural` preserves meaningful slashes;
 * `compact` is only a retrieval/fallback key and must be combined with brand
 * evidence before it can become a strong match.
 */
export function normalizePartArticle(value: unknown): NormalizedPartArticle {
  const normalized = normalizePartNumberForCrossMatch(value);
  return { structural: normalized.canonical, compact: normalized.compactCandidate };
}

export function normalizeMannProductBrand(value: unknown): "MANN" | undefined {
  return normalizeCrossReferenceBrand(value) === "MANN" ? "MANN" : undefined;
}

function normalizeEngineCode(value: unknown): string | null {
  const text = normalizeMannText(value)
    .replace(/[;,]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headersRaw, ...body] = rows;
  if (!headersRaw) return [];
  const headers = headersRaw.map((header) => header.trim());
  return body
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) => {
      const out: CsvRow = {};
      headers.forEach((header, index) => {
        out[header] = cells[index]?.trim() ?? "";
      });
      return out;
    });
}

function cell(row: CsvRow, key: string): string | null {
  const value = row[key]?.trim();
  return value ? value : null;
}

function intCell(row: CsvRow, key: string): number | null {
  const value = cell(row, key);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonCell(row: CsvRow, key: string): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const value = cell(row, key);
  if (!value) return Prisma.JsonNull;
  try {
    return JSON.parse(value) as Prisma.InputJsonValue;
  } catch {
    return value;
  }
}

function summaryJson(value?: string | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!value?.trim()) return Prisma.JsonNull;
  try {
    return JSON.parse(value) as Prisma.InputJsonValue;
  } catch {
    return Prisma.JsonNull;
  }
}

function compactYear(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed)) return null;
  if (digits.length <= 2) return parsed <= 35 ? 2000 + parsed : 1900 + parsed;
  if (digits.length === 4) return parsed;
  return null;
}

function parseVehicleYears(value: string | null): { from: number | null; to: number | null } {
  if (!value) return { from: null, to: null };
  const normalized = value.replace(/[–—]/g, "-");
  const range = normalized.match(/(?:(\d{1,2})\/)?(\d{2,4})\s*-\s*(?:(\d{1,2})\/)?(\d{2,4})?/);
  if (range) {
    return {
      from: compactYear(range[2] ?? ""),
      to: compactYear(range[4] ?? ""),
    };
  }
  const standalone = normalized.match(/\b(\d{4})\b/);
  const year = standalone ? compactYear(standalone[1]) : null;
  return { from: year, to: year };
}

function variantKey(row: CsvRow): string {
  return sha256([
    normalizeMannText(row.make),
    normalizeMannSearchText(row.model),
    normalizeMannSearchText(row.effective_vehicle_text || row.vehicle_text),
    normalizeEngineCode(row.engine_code) ?? "",
    normalizeMannText(row.kw),
    normalizeMannText(row.hp),
    normalizeMannText(row.vehicle_years),
    normalizeMannSearchText(row.condition),
  ].join("|"));
}

function requiredColumns(rows: CsvRow[], required: string[]): string[] {
  const first = rows[0];
  if (!first) return required;
  return required.filter((key) => !(key in first));
}

function summaryObject(value: Prisma.InputJsonValue | typeof Prisma.JsonNull): Record<string, unknown> | null {
  return value && value !== Prisma.JsonNull && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function expectedCountsFromSummary(summary: Prisma.InputJsonValue | typeof Prisma.JsonNull): MannExpectedCounts | null {
  const counts = summaryObject(summary)?.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
  const raw = counts as Record<string, unknown>;
  const read = (snake: string, camel: keyof MannExpectedCounts): number | null => {
    const value = Number(raw[snake] ?? raw[camel]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const applicationRows = read("application_rows", "applicationRows");
  const filterRows = read("filter_rows", "filterRows");
  const uniqueMakes = read("unique_makes", "uniqueMakes");
  const uniqueModels = read("unique_models", "uniqueModels");
  const uniqueMannArticles = read("unique_mann_articles", "uniqueMannArticles");
  if ([applicationRows, filterRows, uniqueMakes, uniqueModels, uniqueMannArticles].some((value) => value == null)) return null;
  return { applicationRows: applicationRows!, filterRows: filterRows!, uniqueMakes: uniqueMakes!, uniqueModels: uniqueModels!, uniqueMannArticles: uniqueMannArticles! };
}

function summaryWarnings(summary: Prisma.InputJsonValue | typeof Prisma.JsonNull): string[] {
  const warnings = summaryObject(summary)?.warnings;
  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is string => typeof warning === "string" && Boolean(warning.trim())).map((warning) => warning.trim())
    : [];
}

function warningFromExpected(stats: MannImportStats, summary: Prisma.InputJsonValue | typeof Prisma.JsonNull): string[] {
  const warnings: string[] = [];
  const expected = expectedCountsFromSummary(summary) ?? LEGACY_MANN_EXPECTED_COUNTS;
  const filterCounts =
    summary && summary !== Prisma.JsonNull && typeof summary === "object" && "filter_type_counts" in summary
      ? (summary as { filter_type_counts?: Record<string, unknown> }).filter_type_counts
      : null;
  const expectedFilterRows = expected.filterRows;
  const expectedApplicationRows = expected.applicationRows;
  const expectedMakes = expected.uniqueMakes;
  const expectedModels = expected.uniqueModels;
  const expectedArticles = expected.uniqueMannArticles;

  if (stats.filterRows !== expectedFilterRows) warnings.push(`Ожидалось ${expectedFilterRows} строк фильтров, подготовлено ${stats.filterRows}.`);
  if (stats.applicationRows !== expectedApplicationRows) warnings.push(`Ожидалось ${expectedApplicationRows} строк применяемости, подготовлено ${stats.applicationRows}.`);
  if (stats.uniqueMakes !== expectedMakes) warnings.push(`Ожидалось ${expectedMakes} марок, подготовлено ${stats.uniqueMakes}.`);
  if (stats.uniqueModels !== expectedModels) warnings.push(`Ожидалось ${expectedModels} моделей, подготовлено ${stats.uniqueModels}.`);
  if (stats.uniqueMannArticles !== expectedArticles) warnings.push(`Ожидалось ${expectedArticles} MANN-артикулов, подготовлено ${stats.uniqueMannArticles}.`);

  if (filterCounts) {
    for (const [type, expectedCount] of Object.entries(filterCounts)) {
      const actual = stats.filterTypeCounts[type] ?? 0;
      const expectedNumber = Number(expectedCount);
      if (Number.isFinite(expectedNumber) && actual !== expectedNumber) {
        warnings.push(`Тип ${type}: ожидалось ${expectedNumber}, подготовлено ${actual}.`);
      }
    }
  }
  return warnings;
}

function prepareMannImport(input: MannImportInput): ImportPrepared {
  const appRows = parseCsv(input.applicationsCsv);
  const filterCsvRows = parseCsv(input.filtersCsv);
  const missingApplications = requiredColumns(appRows, ["make", "model", "vehicle_text", "effective_vehicle_text", "raw_cells_json"]);
  const missingFilters = requiredColumns(filterCsvRows, ["make", "model", "filter_type", "mann_article"]);
  if (missingApplications.length > 0) throw new Error(`В applications CSV нет колонок: ${missingApplications.join(", ")}`);
  if (missingFilters.length > 0) throw new Error(`В filters_long CSV нет колонок: ${missingFilters.join(", ")}`);

  const applicationsSourceHash = sha256(input.applicationsCsv);
  const filtersSourceHash = sha256(input.filtersCsv);
  const summary = summaryJson(input.summaryJson);

  const rawRows = appRows.map((row, index): Prisma.MannPdfApplicationRawCreateManyInput => ({
    sourcePdf: cell(row, "source_pdf"),
    sourceFile: input.applicationsFileName,
    sourceHash: applicationsSourceHash,
    sourceRowHash: sha256(`${applicationsSourceHash}:applications:${index}:${JSON.stringify(row)}`),
    rowType: cell(row, "row_type"),
    make: cell(row, "make"),
    model: cell(row, "model"),
    modelYears: cell(row, "model_years"),
    vehicleText: cell(row, "vehicle_text"),
    effectiveVehicleText: cell(row, "effective_vehicle_text"),
    detail: cell(row, "detail"),
    engineCode: cell(row, "engine_code"),
    kw: cell(row, "kw"),
    hp: cell(row, "hp"),
    vehicleYears: cell(row, "vehicle_years"),
    condition: cell(row, "condition"),
    airFilter: cell(row, "air_filter"),
    airFilterNote: cell(row, "air_filter_note"),
    oilFilter: cell(row, "oil_filter"),
    oilFilterNote: cell(row, "oil_filter_note"),
    fuelFilter: cell(row, "fuel_filter"),
    fuelFilterNote: cell(row, "fuel_filter_note"),
    cabinOrOtherFilter: cell(row, "cabin_or_other_filter"),
    cabinOrOtherType: cell(row, "cabin_or_other_type"),
    cabinFilter: cell(row, "cabin_filter"),
    otherFilter: cell(row, "other_filter"),
    otherFilterType: cell(row, "other_filter_type"),
    pdfPage: intCell(row, "pdf_page"),
    catalogPage: intCell(row, "catalog_page"),
    rawCellsJson: jsonCell(row, "raw_cells_json"),
  }));

  const filterRows = filterCsvRows.flatMap((row, index): Prisma.MannFilterApplicationCreateManyInput[] => {
    const make = cell(row, "make");
    const model = cell(row, "model");
    const filterType = cell(row, "filter_type");
    const mannArticle = cell(row, "mann_article");
    if (!make || !model || !filterType || !mannArticle) return [];
    const years = parseVehicleYears(cell(row, "vehicle_years"));
    return [{
      make,
      makeNormalized: normalizeMannText(make),
      model,
      modelNormalized: normalizeMannSearchText(model),
      modelYears: cell(row, "model_years"),
      vehicleText: cell(row, "vehicle_text"),
      effectiveVehicleText: cell(row, "effective_vehicle_text"),
      vehicleVariantKey: variantKey(row),
      detail: cell(row, "detail"),
      engineCode: cell(row, "engine_code"),
      engineCodeNormalized: normalizeEngineCode(row.engine_code),
      kw: cell(row, "kw"),
      hp: cell(row, "hp"),
      vehicleYears: cell(row, "vehicle_years"),
      vehicleYearFrom: years.from,
      vehicleYearTo: years.to,
      condition: cell(row, "condition"),
      filterType,
      filterSubtype: cell(row, "filter_subtype"),
      mannArticle,
      mannArticleNormalized: normalizeMannArticle(mannArticle),
      filterNote: cell(row, "filter_note"),
      pdfPage: intCell(row, "pdf_page"),
      catalogPage: intCell(row, "catalog_page"),
      sourceFile: input.filtersFileName,
      sourceHash: filtersSourceHash,
      sourceRowHash: sha256(`${filtersSourceHash}:filters:${index}:${JSON.stringify(row)}`),
    }];
  });

  const makeSet = new Set(filterRows.map((row) => row.makeNormalized));
  const modelSet = new Set(filterRows.map((row) => `${row.makeNormalized}|${row.modelNormalized}`));
  const articleSet = new Set(filterRows.map((row) => row.mannArticleNormalized));
  const filterTypeCounts: Record<string, number> = {};
  for (const row of filterRows) {
    filterTypeCounts[row.filterType] = (filterTypeCounts[row.filterType] ?? 0) + 1;
  }
  const stats: MannImportStats = {
    applicationRows: rawRows.length,
    filterRows: filterRows.length,
    uniqueMakes: makeSet.size,
    uniqueModels: modelSet.size,
    uniqueMannArticles: articleSet.size,
    filterTypeCounts,
    applicationsSourceHash,
    filtersSourceHash,
    expected: expectedCountsFromSummary(summary) ?? LEGACY_MANN_EXPECTED_COUNTS,
    warnings: [],
  };
  stats.warnings = [...summaryWarnings(summary), ...warningFromExpected(stats, summary)];

  return { stats, summary, rawRows, filterRows };
}

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<{ count: number }>): Promise<number> {
  let count = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    count += (await insert(rows.slice(i, i + 1000))).count;
  }
  return count;
}

export async function dryRunMannImport(input: MannImportInput): Promise<MannImportStats> {
  return prepareMannImport({ ...input, dryRun: true }).stats;
}

export async function importMannCatalog(input: MannImportInput): Promise<MannImportStats & { batchId: string }> {
  const prepared = prepareMannImport(input);
  if (input.dryRun) return { ...prepared.stats, batchId: "" };
  if (prepared.stats.warnings.length > 0) {
    throw new Error(`Каталог не заменён: контрольная проверка не пройдена. ${prepared.stats.warnings.join(" ")}`);
  }
  const batch = await prisma.mannPdfImportBatch.create({
    data: {
      status: "importing",
      sourceFile: [input.applicationsFileName, input.filtersFileName].filter(Boolean).join(" + "),
      applicationsSourceFile: input.applicationsFileName,
      filtersSourceFile: input.filtersFileName,
      applicationsSourceHash: prepared.stats.applicationsSourceHash,
      filtersSourceHash: prepared.stats.filtersSourceHash,
      summaryJson: prepared.summary,
      statsJson: prepared.stats as unknown as Prisma.InputJsonValue,
      importedById: input.importedById ?? null,
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      if (input.replaceExisting ?? true) {
        await tx.mannFilterApplication.deleteMany({});
        await tx.mannPdfApplicationRaw.deleteMany({});
      }
      const rawRows = prepared.rawRows.map((row) => ({ ...row, importBatchId: batch.id }));
      const filterRows = prepared.filterRows.map((row) => ({ ...row, importBatchId: batch.id }));
      await insertChunks(rawRows, (chunk) => tx.mannPdfApplicationRaw.createMany({ data: chunk, skipDuplicates: true }));
      await insertChunks(filterRows, (chunk) => tx.mannFilterApplication.createMany({ data: chunk, skipDuplicates: true }));
      await tx.mannPdfImportBatch.update({
        where: { id: batch.id },
        data: {
          status: "imported",
          statsJson: prepared.stats as unknown as Prisma.InputJsonValue,
          errorsJson: prepared.stats.warnings as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
    }, { timeout: 600_000 });
  } catch (error) {
    await prisma.mannPdfImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "error",
        errorsJson: [error instanceof Error ? error.message : "Не удалось импортировать MANN CSV"] as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    }).catch(() => undefined);
    throw error;
  }

  return { ...prepared.stats, batchId: batch.id };
}

function asCount(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

export async function getMannCatalogStats() {
  try {
    const [counts, latestBatch] = await Promise.all([
      prisma.$queryRaw<Array<{
        filter_rows: bigint;
        application_rows: bigint;
        unique_makes: bigint;
        unique_models: bigint;
        unique_mann_articles: bigint;
      }>>(Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM mann_filter_applications) AS filter_rows,
          (SELECT COUNT(*) FROM mann_pdf_application_raw) AS application_rows,
          (SELECT COUNT(DISTINCT make_normalized) FROM mann_filter_applications) AS unique_makes,
          (SELECT COUNT(DISTINCT make_normalized || '|' || model_normalized) FROM mann_filter_applications) AS unique_models,
          (SELECT COUNT(DISTINCT mann_article_normalized) FROM mann_filter_applications) AS unique_mann_articles
      `),
      prisma.mannPdfImportBatch.findFirst({ orderBy: { importedAt: "desc" } }),
    ]);
    const row = counts[0];
    const expected = expectedCountsFromSummary(latestBatch?.summaryJson ?? Prisma.JsonNull) ?? LEGACY_MANN_EXPECTED_COUNTS;
    return {
      ok: true,
      expected,
      counts: {
        filterRows: asCount(row?.filter_rows),
        applicationRows: asCount(row?.application_rows),
        uniqueMakes: asCount(row?.unique_makes),
        uniqueModels: asCount(row?.unique_models),
        uniqueMannArticles: asCount(row?.unique_mann_articles),
      },
      latestBatch,
    };
  } catch (error) {
    return {
      ok: false,
      expected: LEGACY_MANN_EXPECTED_COUNTS,
      counts: { filterRows: 0, applicationRows: 0, uniqueMakes: 0, uniqueModels: 0, uniqueMannArticles: 0 },
      latestBatch: null,
      error: error instanceof Error ? error.message : "MANN-таблицы пока недоступны",
    };
  }
}

export async function listMannMakes() {
  return prisma.$queryRaw<Array<{ make: string; countModels: number; countApplications: number }>>(Prisma.sql`
    SELECT
      MIN(make) AS make,
      COUNT(DISTINCT model_normalized)::int AS "countModels",
      COUNT(*)::int AS "countApplications"
    FROM mann_filter_applications
    GROUP BY make_normalized
    ORDER BY MIN(make) ASC
  `);
}

export async function listMannModels(make: string) {
  const makeNormalized = normalizeMannText(make);
  return prisma.$queryRaw<Array<{ model: string; modelYears: string | null; countVariants: number; countFilters: number }>>(Prisma.sql`
    SELECT
      MIN(model) AS model,
      NULLIF(string_agg(DISTINCT COALESCE(model_years, ''), ', ' ORDER BY COALESCE(model_years, '')), '') AS "modelYears",
      COUNT(DISTINCT vehicle_variant_key)::int AS "countVariants",
      COUNT(*)::int AS "countFilters"
    FROM mann_filter_applications
    WHERE make_normalized = ${makeNormalized}
    GROUP BY model_normalized
    ORDER BY MIN(model) ASC
  `);
}

export async function listMannVariants(params: { make: string; model: string; year?: number | null; includeVariantId?: string | null }) {
  const makeNormalized = normalizeMannText(params.make);
  const modelNormalized = normalizeMannSearchText(params.model);
  // A VIN decoder can safely resolve a variant by engine code/volume/power even when
  // a catalogue has an adjacent model-year boundary. Keep that already resolved
  // variant visible so the client can fetch its filters instead of losing it to the
  // presentation-only year filter.
  const yearSql = params.year && params.includeVariantId
    ? Prisma.sql`AND (
        ((vehicle_year_from IS NULL OR vehicle_year_from <= ${params.year}) AND (vehicle_year_to IS NULL OR vehicle_year_to >= ${params.year}))
        OR vehicle_variant_key = ${params.includeVariantId}
      )`
    : params.year
    ? Prisma.sql`AND (vehicle_year_from IS NULL OR vehicle_year_from <= ${params.year}) AND (vehicle_year_to IS NULL OR vehicle_year_to >= ${params.year})`
    : Prisma.empty;
  const variants = await prisma.$queryRaw<Array<{
    variantId: string;
    vehicleText: string | null;
    effectiveVehicleText: string | null;
    engineCode: string | null;
    kw: string | null;
    hp: string | null;
    vehicleYears: string | null;
    condition: string | null;
    countFilters: number;
  }>>(Prisma.sql`
    SELECT
      vehicle_variant_key AS "variantId",
      MIN(vehicle_text) AS "vehicleText",
      MIN(effective_vehicle_text) AS "effectiveVehicleText",
      MIN(engine_code) AS "engineCode",
      MIN(kw) AS kw,
      MIN(hp) AS hp,
      MIN(vehicle_years) AS "vehicleYears",
      MIN(condition) AS condition,
      COUNT(DISTINCT filter_type || ':' || COALESCE(filter_subtype, '') || ':' || mann_article_normalized)::int AS "countFilters"
    FROM mann_filter_applications
    WHERE make_normalized = ${makeNormalized}
      AND model_normalized = ${modelNormalized}
      AND UPPER(BTRIM(COALESCE(effective_vehicle_text, vehicle_text, ''))) NOT IN ('ALL MODELS', 'ВСЕ МОДЕЛИ')
      AND regexp_replace(UPPER(COALESCE(effective_vehicle_text, vehicle_text, '')), '[^A-Z0-9]', '', 'g') !~
        '(ALLMODELS|EXPORTMODELL|EXPORTMODELFOR|KUNSTSTOFFOLFILTERMODUL|PLASTICOILFILTERMODULE|ALUOLFILTERMODUL|ALUMINIUMOILFILTERMODULE|GEHAUSEHOUSING|FURKALTEKLIMAZONEN|FORCOLDCLIMATES|EINBAURECHTS|RIGHTSIDE|STAUBREICHEEINSATZBEDINGUNGEN|USEINDUSTYENVIRONMENTS|LINKSLENKER|LEFTHANDDRIVE|RECHTSLENKER|RIGHTHANDDRIVE|EINBAULINKS|LEFTSIDE|EINSPRITZSYSTEM|INJECTIONSYSTEM|ANZAHL|QUANTITY|WAHLWEISE|OPTIONALLY|FILTERELEMENT|ANSCHRAUBFILTER|SPINONFILTER|FLACHLUFTFILTERELEMENT|PANELAIRFILTER|KRAFTSTOFFFILTERAUSSERHALB|FUELFILTERFITTED|PARTIKELFILTER|PARTICULATEFILTER|AKTIVKOHLEFILTER|ACTIVATEDCARBONFILTER|VORFILTER|PREFILTER|BIOFUNKTIONALERINNENRAUMFILTER|BIOFUNCTIONALCABINAIRFILTER|EINBAUORT|MOUNTINGPOSITION|AUTOMATIKGETRIEBE|AUTOMATICGEARBOX|GETRIEBECODE|GEARBOXCODE|FILTRATIONSSYSTEM|FILTRATIONSYSTEM)'
      ${yearSql}
    GROUP BY vehicle_variant_key
    ORDER BY MIN(effective_vehicle_text) NULLS LAST, MIN(vehicle_years) NULLS LAST
    LIMIT 500
  `);
  return filterMannVehicleVariants(variants);
}

export type MannCatalogFilter = {
  filterType: string;
  filterSubtype: string | null;
  mannArticle: string;
  mannArticleNormalized: string;
  filterNote: string | null;
  condition: string | null;
  vehicleText: string | null;
  effectiveVehicleText: string | null;
  engineCode: string | null;
  kw: string | null;
  hp: string | null;
  vehicleYears: string | null;
  pdfPage: number | null;
  catalogPage: number | null;
};

type MannRawContextRow = {
  rowType: string | null;
  vehicleText: string | null;
  effectiveVehicleText: string | null;
  detail: string | null;
  engineCode: string | null;
  kw: string | null;
  hp: string | null;
  vehicleYears: string | null;
  airFilter: string | null;
  oilFilter: string | null;
  fuelFilter: string | null;
  cabinOrOtherFilter: string | null;
  cabinOrOtherType: string | null;
  cabinFilter: string | null;
  otherFilter: string | null;
  otherFilterType: string | null;
  pdfPage: number | null;
  catalogPage: number | null;
  rawCellsJson: Prisma.JsonValue | null;
};

type MannSelectedVariantContext = {
  make: string;
  model: string;
  vehicleText: string | null;
  effectiveVehicleText: string | null;
  engineCode: string | null;
  kw: string | null;
  hp: string | null;
  vehicleYears: string | null;
  pdfPage: number | null;
  catalogPage: number | null;
};

function rawRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rawFilterText(row: MannRawContextRow, key: "oil" | "cabin"): string {
  const filters = rawRecord(rawRecord(row.rawCellsJson).filters as Prisma.JsonValue | null);
  return String(filters[key] ?? "").trim();
}

function rawRowTop(row: MannRawContextRow): number {
  const value = Number(rawRecord(row.rawCellsJson).row_top);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function mannConditionFromText(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  const range = normalized.match(/(\d{1,2}\/\d{2})\s*(?:→|->)\s*(\d{1,2}\/\d{2})/);
  if (range) return `${range[1]}–${range[2]}`;
  const date = normalized.match(/\d{1,2}\/\d{2}/)?.[0];
  if (!date) return null;
  if (/^\s*(?:→|->)/.test(normalized)) return `до ${date}`;
  if (new RegExp(`${date.replace("/", "\\/")}\\s*(?:→|->)`).test(normalized)) return `с ${date}`;
  return null;
}

function monthKey(value: string): number | null {
  const match = value.match(/(\d{1,2})\/(\d{2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12 || !Number.isFinite(year)) return null;
  return (year <= 35 ? 2000 + year : 1900 + year) * 100 + month;
}

function conditionMatchesYear(conditionText: string, year?: number | null): boolean {
  if (!year) return true;
  const keys = [...conditionText.matchAll(/\d{1,2}\/\d{2}/g)].map((match) => monthKey(match[0])).filter((value): value is number => value != null);
  if (keys.length === 0) return true;
  const yearStart = year * 100 + 1;
  const yearEnd = year * 100 + 12;
  const startsWithEnd = /^\s*(?:→|->)/.test(conditionText);
  if (keys.length >= 2) return yearEnd >= keys[0] && yearStart <= keys[1];
  const hasStartBoundary = new RegExp(`${conditionText.match(/\d{1,2}\/\d{2}/)?.[0]?.replace("/", "\\/")}\\s*(?:→|->)`).test(conditionText);
  if (startsWithEnd) return yearStart <= keys[0];
  if (hasStartBoundary) return yearEnd >= keys[0];
  return true;
}

function sameMannVehicleRow(row: MannRawContextRow, selected: MannSelectedVariantContext): boolean {
  const rowEngine = normalizeEngineCode(row.engineCode);
  const selectedEngine = normalizeEngineCode(selected.engineCode);
  if (rowEngine && selectedEngine) return rowEngine === selectedEngine;
  const rowText = normalizeMannSearchText(row.effectiveVehicleText || row.vehicleText);
  const selectedText = normalizeMannSearchText(selected.effectiveVehicleText || selected.vehicleText);
  return Boolean(rowText && selectedText && rowText === selectedText);
}

function isConcreteRawVehicleRow(row: MannRawContextRow): boolean {
  return Boolean(normalizeEngineCode(row.engineCode) || row.vehicleYears || row.kw || row.hp);
}

function asContextFilter(params: {
  filterType: "oil" | "cabin";
  article: string;
  conditionText: string;
  filterSubtype?: string | null;
  selected: MannSelectedVariantContext;
  source: MannRawContextRow;
}): MannCatalogFilter | null {
  const mannArticle = params.article.trim();
  if (!mannArticle) return null;
  const condition = mannConditionFromText(params.conditionText);
  return {
    filterType: params.filterType,
    filterSubtype: params.filterSubtype ?? null,
    mannArticle,
    mannArticleNormalized: normalizeMannArticle(mannArticle),
    filterNote: params.source.detail ?? null,
    condition,
    vehicleText: params.selected.vehicleText,
    effectiveVehicleText: params.selected.effectiveVehicleText,
    engineCode: params.selected.engineCode,
    kw: params.selected.kw,
    hp: params.selected.hp,
    vehicleYears: params.selected.vehicleYears,
    pdfPage: params.source.pdfPage,
    catalogPage: params.source.catalogPage,
  };
}

function cabinFilterSubtype(text: string, article: string): string | null {
  if (/AKTIVKOHLE|ACTIVATED\s+CARBON/i.test(text) || /^CUK/i.test(article)) return "с активированным углём";
  if (/^FP/i.test(article)) return "FreciousPlus";
  if (/PARTIKEL|PARTICULATE/i.test(text)) return "противоаллергенный";
  return null;
}

function cabinAlternativeKey(filter: MannCatalogFilter): string | null {
  if (filter.filterType !== "cabin") return null;
  const article = filter.mannArticleNormalized;
  const suffix = article.replace(/^(?:CUK|CU|FP)/, "");
  return suffix && suffix !== article ? `${suffix}:${filter.condition ?? ""}:${filter.vehicleYears ?? ""}` : null;
}

function cabinAlternativeRank(filter: MannCatalogFilter): number {
  if (/^CUK/i.test(filter.mannArticle)) return 0;
  if (/^CU/i.test(filter.mannArticle)) return 1;
  if (/^FP/i.test(filter.mannArticle)) return 2;
  return 3;
}

function preferOneCabinAlternative(filters: MannCatalogFilter[]): MannCatalogFilter[] {
  const groups = new Map<string, MannCatalogFilter[]>();
  for (const filter of filters) {
    const key = cabinAlternativeKey(filter);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), filter]);
  }
  const selected = new Set<string>();
  const notes = new Map<string, string>();
  for (const alternatives of groups.values()) {
    if (alternatives.length < 2) continue;
    const preferred = alternatives.slice().sort((left, right) => cabinAlternativeRank(left) - cabinAlternativeRank(right))[0];
    selected.add(preferred.mannArticleNormalized);
    notes.set(preferred.mannArticleNormalized, `Альтернативы MANN: ${alternatives.map((item) => item.mannArticle).join(", ")}. По умолчанию — ${preferred.mannArticle} (с активированным углём).`);
  }
  return filters
    .filter((filter) => {
      const key = cabinAlternativeKey(filter);
      return !key || !groups.has(key) || selected.has(filter.mannArticleNormalized);
    })
    .map((filter) => {
      const note = notes.get(filter.mannArticleNormalized);
      return note ? { ...filter, filterNote: [filter.filterNote, note].filter(Boolean).join(" ") } : filter;
    });
}

async function contextualMannFilters(params: { selected: MannSelectedVariantContext; year?: number | null }): Promise<MannCatalogFilter[]> {
  const selected = params.selected;
  const pageScopes = [{ pdfPage: selected.pdfPage, catalogPage: selected.catalogPage }];
  const rows = await prisma.mannPdfApplicationRaw.findMany({
    where: {
      make: selected.make,
      model: selected.model,
      OR: pageScopes,
    },
    select: {
      rowType: true,
      vehicleText: true,
      effectiveVehicleText: true,
      detail: true,
      engineCode: true,
      kw: true,
      hp: true,
      vehicleYears: true,
      airFilter: true,
      oilFilter: true,
      fuelFilter: true,
      cabinOrOtherFilter: true,
      cabinOrOtherType: true,
      cabinFilter: true,
      otherFilter: true,
      otherFilterType: true,
      pdfPage: true,
      catalogPage: true,
      rawCellsJson: true,
    },
  }) as MannRawContextRow[];
  const ordered = rows.slice().sort((left, right) => rawRowTop(left) - rawRowTop(right));
  const output: MannCatalogFilter[] = [];
  let activeSelectedVehicle = false;

  for (const row of ordered) {
    if (isConcreteRawVehicleRow(row)) activeSelectedVehicle = sameMannVehicleRow(row, selected);

    const isAllModels = normalizeMannSearchText(row.effectiveVehicleText || row.vehicleText) === "ALL MODELS";
    const cabinCondition = rawFilterText(row, "cabin");
    const cabinArticle = row.cabinFilter || row.cabinOrOtherFilter;
    if (isAllModels && cabinArticle && conditionMatchesYear(cabinCondition, params.year)) {
      const filter = asContextFilter({
        filterType: "cabin",
        article: cabinArticle,
        conditionText: cabinCondition,
        filterSubtype: cabinFilterSubtype(cabinCondition, cabinArticle),
        selected,
        source: row,
      });
      if (filter) output.push(filter);
    }

    const housing = /(?:GEHÄUSE|HOUSING)/i.test(`${row.vehicleText ?? ""} ${row.effectiveVehicleText ?? ""}`);
    const oilCondition = rawFilterText(row, "oil");
    if (activeSelectedVehicle && housing && row.oilFilter && conditionMatchesYear(oilCondition, params.year)) {
      const filter = asContextFilter({ filterType: "oil", article: row.oilFilter, conditionText: oilCondition, selected, source: row });
      if (filter) output.push(filter);
    }
  }
  return preferOneCabinAlternative(output);
}

function dedupeMannFilters(filters: MannCatalogFilter[]): MannCatalogFilter[] {
  const unique = new Map<string, MannCatalogFilter>();
  for (const filter of filters) {
    const key = `${filter.filterType}:${filter.filterSubtype ?? ""}:${filter.mannArticleNormalized}`;
    if (!unique.has(key)) unique.set(key, filter);
  }
  return [...unique.values()];
}

export async function listMannFilters(params: { make?: string | null; model?: string | null; variantId: string; year?: number | null }) {
  const makeSql = params.make ? Prisma.sql`AND make_normalized = ${normalizeMannText(params.make)}` : Prisma.empty;
  const modelSql = params.model ? Prisma.sql`AND model_normalized = ${normalizeMannSearchText(params.model)}` : Prisma.empty;
  const [filters, selected] = await Promise.all([
    prisma.$queryRaw<MannCatalogFilter[]>(Prisma.sql`
    SELECT
      filter_type AS "filterType",
      filter_subtype AS "filterSubtype",
      MIN(mann_article) AS "mannArticle",
      mann_article_normalized AS "mannArticleNormalized",
      NULLIF(string_agg(DISTINCT COALESCE(filter_note, ''), E'\n'), '') AS "filterNote",
      NULLIF(string_agg(DISTINCT COALESCE(condition, ''), E'\n'), '') AS condition,
      MIN(vehicle_text) AS "vehicleText",
      MIN(effective_vehicle_text) AS "effectiveVehicleText",
      MIN(engine_code) AS "engineCode",
      MIN(kw) AS kw,
      MIN(hp) AS hp,
      MIN(vehicle_years) AS "vehicleYears",
      MIN(pdf_page) AS "pdfPage",
      MIN(catalog_page) AS "catalogPage"
    FROM mann_filter_applications
    WHERE vehicle_variant_key = ${params.variantId}
      ${makeSql}
      ${modelSql}
    GROUP BY filter_type, filter_subtype, mann_article_normalized
    ORDER BY
      CASE filter_type
        WHEN 'oil' THEN 1
        WHEN 'air' THEN 2
        WHEN 'fuel' THEN 3
        WHEN 'cabin' THEN 4
        ELSE 5
      END,
      MIN(mann_article)
    `),
    prisma.mannFilterApplication.findFirst({
      where: { vehicleVariantKey: params.variantId },
      select: {
        make: true,
        model: true,
        vehicleText: true,
        effectiveVehicleText: true,
        engineCode: true,
        kw: true,
        hp: true,
        vehicleYears: true,
        pdfPage: true,
        catalogPage: true,
      },
    }),
  ]);
  if (!selected) return filters;
  const contextual = await contextualMannFilters({ selected, year: params.year });
  return dedupeMannFilters([...filters, ...contextual]);
}

function productHasMannArticle(
  product: { name?: string | null; oemParts?: string | null; article?: string | null; code?: string | null; brand?: string | null },
  mannArticle: string,
  options: { safeCompactKeys?: ReadonlySet<string> } = {},
): { confidence: number; reason: string; matchType: MannLocalProductMatchType } | null {
  const expected = normalizePartNumberForCrossMatch(mannArticle);
  if (expected.canonical.length < 3) return null;
  const article = normalizePartNumberForCrossMatch(product.article);
  const code = normalizePartNumberForCrossMatch(product.code);
  const mannBrand = normalizeMannProductBrand(product.brand);
  if (mannBrand && article.canonical === expected.canonical) {
    return { confidence: 100, reason: "Exact MANN product brand + article", matchType: "EXACT_PRODUCT_BRAND_ARTICLE" };
  }
  if (mannBrand && !article.canonical && code.canonical === expected.canonical) {
    return { confidence: 99, reason: "Exact MANN product brand + legacy code", matchType: "EXACT_PRODUCT_BRAND_ARTICLE" };
  }

  const entries = parseOemParts(product.oemParts);
  const exactBranded = entries.find((entry) => entry.brand === "MANN" && entry.canonical === expected.canonical);
  if (exactBranded) {
    return { confidence: 98, reason: "Exact MANN brand + article in OEM Parts", matchType: "OEM_EXACT_BRAND_ARTICLE" };
  }
  const exactArticleOnly = entries.find((entry) => entry.brand == null && entry.canonical === expected.canonical);
  if (exactArticleOnly) {
    return { confidence: 96, reason: "Exact article-only reference in OEM Parts", matchType: "OEM_EXACT_ARTICLE" };
  }

  if (options.safeCompactKeys?.has(expected.compactCandidate)) {
    if (
      mannBrand
      && article.canonical
      && article.compactCandidate === expected.compactCandidate
    ) {
      return { confidence: 92, reason: "Collision-free compact MANN product article", matchType: "OEM_SAFE_COMPACT" };
    }
    const safeCompact = entries.find((entry) => (
      (entry.brand == null || entry.brand === "MANN")
      && entry.compactCandidate === expected.compactCandidate
    ));
    if (safeCompact) {
      return { confidence: 90, reason: "Collision-free compact OEM candidate", matchType: "OEM_SAFE_COMPACT" };
    }
    if (mannBrand && !article.canonical && code.compactCandidate === expected.compactCandidate) {
      return { confidence: 90, reason: "Collision-free compact MANN legacy code", matchType: "OEM_SAFE_COMPACT" };
    }
  }
  return null;
}

/** Pure seam used by catalogue audits; production uses the same matcher below. */
export function evaluateMannArticleProductMatch(
  product: { name?: string | null; oemParts?: string | null; article?: string | null; code?: string | null; brand?: string | null },
  mannArticle: string,
  options: { safeCompactKeys?: ReadonlySet<string> } = {},
): { confidence: number; reason: string; matchType: MannLocalProductMatchType } | null {
  return productHasMannArticle(product, mannArticle, options);
}

function localProductMeta(product: { id: string; entityType?: string | null; localHref?: string | null }) {
  const type = product.entityType || "product";
  return {
    href: `local://${type}/${product.id}`,
    type,
    mediaType: "application/json",
  };
}

function localMatchFromProduct(
  product: Prisma.LocalProductGetPayload<{ include: { stockBalances: true } }>,
  match: { confidence: number; reason: string; matchType: MannLocalProductMatchType }
): MannLocalProductMatch {
  const stock = product.stockBalances[0];
  const buyPriceCents = stock?.buyPriceCents ?? product.buyPriceCents ?? null;
  return {
    id: product.id,
    name: product.name,
    meta: localProductMeta(product),
    article: product.article,
    code: product.code,
    brand: product.brand,
    price: product.salePriceCents / 100,
    currency: product.currencyName ?? "руб.",
    stock: stock?.quantity.toNumber() ?? 0,
    reserve: stock?.reserve.toNumber() ?? 0,
    available: stock?.available.toNumber() ?? 0,
    cell: stock?.slotName ?? product.cell,
    buyPriceCents,
    cost: buyPriceCents != null ? buyPriceCents / 100 : undefined,
    orderable: Boolean(product.supplierCounterpartyId || product.legacySupplierName),
    matchType: match.matchType,
    matchConfidence: match.confidence,
    matchReason: match.reason,
  };
}

export async function matchMannArticlesToLocalProducts(params: {
  mannArticles: Array<string | MatchInputArticle>;
  organizationId?: string | null;
  warehouseId?: string | null;
}): Promise<MannArticleMatchResult[]> {
  const { branchId } = requireSingleBranchSqlContext();
  const inputArticles = params.mannArticles
    .map((item): MatchInputArticle => typeof item === "string" ? { mannArticle: item } : item)
    .filter((item) => item.mannArticle?.trim());
  const articleByNormalized = new Map<string, MatchInputArticle>();
  for (const item of inputArticles) {
    const normalized = normalizeMannArticle(item.mannArticle);
    if (normalized && !articleByNormalized.has(normalized)) articleByNormalized.set(normalized, item);
  }
  const normalizedArticles = [...articleByNormalized.keys()];
  if (normalizedArticles.length === 0) return [];

  const store = params.warehouseId
    ? await prisma.localStore.findFirst({ where: { branchId, OR: [{ id: params.warehouseId }, { id: params.warehouseId }] }, select: { id: true } })
    : null;
  const stockInclude = { where: store?.id ? { storeId: store.id } : undefined, take: store?.id ? 1 : 5 };
  const organizationId = params.organizationId?.trim() || "default";
  const explicitLinks = await prisma.productMannLink.findMany({
    where: {
      branchId,
      organizationId,
      mannArticleNormalized: { in: normalizedArticles },
    },
    select: {
      productId: true,
      mannArticleNormalized: true,
      confidence: true,
      linkType: true,
    },
  });
  const linksByArticle = new Map<string, typeof explicitLinks>();
  for (const link of explicitLinks) {
    const links = linksByArticle.get(link.mannArticleNormalized) ?? [];
    links.push(link);
    linksByArticle.set(link.mannArticleNormalized, links);
  }

  const results: MannArticleMatchResult[] = [];
  for (const articleNormalized of normalizedArticles) {
    const lookupStartedAt = performance.now();
    const item = articleByNormalized.get(articleNormalized)!;
    const reference = normalizePartNumberForCrossMatch(item.mannArticle);
    const articleOemNormalized = reference.compactCandidate;
    const candidateIds = articleOemNormalized.length >= 3
      ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM local_products
          WHERE branch_id = ${branchId}
            AND archived = false
            AND entity_type <> 'service'
            AND (
              regexp_replace(upper(COALESCE(oem_parts, '')), '[^A-Z0-9]', '', 'g') LIKE ${`%${articleOemNormalized}%`}
              OR regexp_replace(upper(COALESCE(article, '')), '[^A-Z0-9]', '', 'g') = ${articleOemNormalized}
              OR regexp_replace(upper(COALESCE(code, '')), '[^A-Z0-9]', '', 'g') = ${articleOemNormalized}
            )
        `)
      : [];
    const links = linksByArticle.get(articleNormalized) ?? [];
    const candidateProductIds = [...new Set([
      ...candidateIds.map((candidate) => candidate.id),
      ...links.map((link) => link.productId),
    ])];
    const candidates = await prisma.localProduct.findMany({
      where: {
        branchId,
        archived: false,
        entityType: { not: "service" },
        id: { in: candidateProductIds },
      },
      include: { stockBalances: stockInclude },
    });
    const localProductScanMs = performance.now() - lookupStartedAt;
    const parsingStartedAt = performance.now();
    const collisionRows = await prisma.$queryRaw<Array<{ mannArticleNormalized: string }>>(Prisma.sql`
      SELECT DISTINCT mann_article_normalized AS "mannArticleNormalized"
      FROM mann_filter_applications
      WHERE replace(mann_article_normalized, '/', '') = ${articleOemNormalized}
    `);
    const authoritativeValues = [
      item.mannArticle,
      ...collisionRows.map((row) => row.mannArticleNormalized),
      ...candidates.flatMap((product) => normalizeMannProductBrand(product.brand) ? [product.article, product.article ? null : product.code] : []).filter(Boolean),
    ];
    const authoritativeCollisionIndex = buildPartNumberCollisionIndex(authoritativeValues);
    const observedCollisionIndex = buildPartNumberCollisionIndex([
      ...authoritativeValues,
      ...candidates.flatMap((product) => parseOemParts(product.oemParts).map((entry) => entry.articleRaw)),
    ]);
    const safeCompactKeys = new Set<string>();
    // Safety is decided inside the authoritative MANN/product-identity namespace.
    // OEM representations are observed for diagnostics, but a formatting-only
    // slash difference across namespaces is not itself a second MANN SKU.
    if (isSafeCompactKey(authoritativeCollisionIndex, articleOemNormalized)) safeCompactKeys.add(articleOemNormalized);
    const observedCollision = listPartNumberCollisions(observedCollisionIndex).find((collision) => collision.compactKey === articleOemNormalized);
    const parsingMs = performance.now() - parsingStartedAt;
    const byProduct = new Map<string, MannLocalProductMatch>();
    for (const product of candidates) {
      const link = links.find((candidate) => candidate.productId === product.id);
      const match = link
        ? { confidence: link.confidence, reason: `ProductMannLink:${link.linkType}`, matchType: "PRODUCT_MANN_LINK" as const }
        : evaluateMannArticleProductMatch(product, item.mannArticle, { safeCompactKeys });
      if (!match) continue;
      const current = byProduct.get(product.id);
      const next = localMatchFromProduct(product, match);
      if (!current || next.matchConfidence > current.matchConfidence) byProduct.set(product.id, next);
    }
    const localMatches = [...byProduct.values()].sort((a, b) => {
      if (b.available !== a.available) return b.available - a.available;
      const exactRank = (match: MannLocalProductMatch) => match.matchType === "EXACT_PRODUCT_BRAND_ARTICLE" ? 1 : 0;
      if (exactRank(b) !== exactRank(a)) return exactRank(b) - exactRank(a);
      if (Number(b.orderable) !== Number(a.orderable)) return Number(b.orderable) - Number(a.orderable);
      if (b.matchConfidence !== a.matchConfidence) return b.matchConfidence - a.matchConfidence;
      if (a.price !== b.price) return a.price - b.price;
      return a.name.localeCompare(b.name, "ru");
    });
    const status = localMatches.length > 0 ? "found" : "not_found";
    const bestMatch = localMatches[0] ?? null;
    results.push({
      mannArticle: item.mannArticle,
      mannArticleNormalized: articleNormalized,
      filterType: item.filterType,
      filterSubtype: item.filterSubtype,
      compatibleProducts: localMatches,
      localMatches,
      bestMatch,
      matchConfidence: bestMatch?.matchConfidence ?? 0,
      matchReason: bestMatch?.matchReason ?? "not_found",
      stock: bestMatch?.stock ?? 0,
      available: bestMatch?.available ?? 0,
      price: bestMatch?.price ?? null,
      cell: bestMatch?.cell,
      status,
      coverageStatus: localMatches.length > 0 ? "OEM_COVERED" : "OEM_NOT_COVERED",
      diagnostics: {
        candidateCount: candidates.length,
        compatibleCount: localMatches.length,
        canonicalArticle: reference.canonical,
        compactCandidate: reference.compactCandidate,
        compactCollisionBlocked: !safeCompactKeys.has(articleOemNormalized),
        collisionCanonicalArticles: observedCollision?.canonicalArticles ?? [],
        localProductScanMs,
        parsingMs,
        totalMs: performance.now() - lookupStartedAt,
      },
    });
  }
  return results;
}
