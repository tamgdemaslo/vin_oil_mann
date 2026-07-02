import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const MANN_EXPECTED_COUNTS = {
  applicationRows: 24502,
  filterRows: 37772,
  uniqueMakes: 133,
  uniqueModels: 1618,
  uniqueMannArticles: 2050,
};

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
  expected?: Partial<typeof MANN_EXPECTED_COUNTS>;
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
  article?: string | null;
  code?: string | null;
  brand?: string | null;
  price: number;
  currency: string;
  stock: number;
  available: number;
  cell?: string | null;
  matchConfidence: number;
  matchReason: string;
};

export type MannArticleMatchResult = {
  mannArticle: string;
  mannArticleNormalized: string;
  filterType?: string;
  filterSubtype?: string | null;
  localMatches: MannLocalProductMatch[];
  bestMatch: MannLocalProductMatch | null;
  matchConfidence: number;
  matchReason: string;
  stock: number;
  available: number;
  price: number | null;
  cell?: string | null;
  status: "found" | "multiple_matches" | "not_found" | "needs_review";
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

export function normalizeMannArticle(value: unknown): string {
  return normalizeMannText(value)
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\\/g, "/")
    .replace(/-/g, "")
    .replace(/\s+/g, "")
    .replace(/[^A-ZА-Я0-9/]/g, "");
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

function warningFromExpected(stats: MannImportStats, summary: Prisma.InputJsonValue | typeof Prisma.JsonNull): string[] {
  const warnings: string[] = [];
  const expected =
    summary && summary !== Prisma.JsonNull && typeof summary === "object" && "counts" in summary
      ? (summary as { counts?: Record<string, unknown> }).counts
      : null;
  const filterCounts =
    summary && summary !== Prisma.JsonNull && typeof summary === "object" && "filter_type_counts" in summary
      ? (summary as { filter_type_counts?: Record<string, unknown> }).filter_type_counts
      : null;
  const expectedFilterRows = Number(expected?.filter_rows ?? MANN_EXPECTED_COUNTS.filterRows);
  const expectedApplicationRows = Number(expected?.application_rows ?? MANN_EXPECTED_COUNTS.applicationRows);
  const expectedMakes = Number(expected?.unique_makes ?? MANN_EXPECTED_COUNTS.uniqueMakes);
  const expectedModels = Number(expected?.unique_models ?? MANN_EXPECTED_COUNTS.uniqueModels);
  const expectedArticles = Number(expected?.unique_mann_articles ?? MANN_EXPECTED_COUNTS.uniqueMannArticles);

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
    expected: MANN_EXPECTED_COUNTS,
    warnings: [],
  };
  stats.warnings = warningFromExpected(stats, summary);

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
          status: prepared.stats.warnings.length > 0 ? "imported_with_warnings" : "imported",
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
    return {
      ok: true,
      expected: MANN_EXPECTED_COUNTS,
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
      expected: MANN_EXPECTED_COUNTS,
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

export async function listMannVariants(params: { make: string; model: string; year?: number | null }) {
  const makeNormalized = normalizeMannText(params.make);
  const modelNormalized = normalizeMannSearchText(params.model);
  const yearSql = params.year
    ? Prisma.sql`AND (vehicle_year_from IS NULL OR vehicle_year_from <= ${params.year}) AND (vehicle_year_to IS NULL OR vehicle_year_to >= ${params.year})`
    : Prisma.empty;
  return prisma.$queryRaw<Array<{
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
      ${yearSql}
    GROUP BY vehicle_variant_key
    ORDER BY MIN(effective_vehicle_text) NULLS LAST, MIN(vehicle_years) NULLS LAST
    LIMIT 500
  `);
}

export async function listMannFilters(params: { make?: string | null; model?: string | null; variantId: string }) {
  const makeSql = params.make ? Prisma.sql`AND make_normalized = ${normalizeMannText(params.make)}` : Prisma.empty;
  const modelSql = params.model ? Prisma.sql`AND model_normalized = ${normalizeMannSearchText(params.model)}` : Prisma.empty;
  return prisma.$queryRaw<Array<{
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
  }>>(Prisma.sql`
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
  `);
}

function normalizeOemPartsToken(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizedOemPartsTokens(value?: string | null): Set<string> {
  const tokens = new Set<string>();
  const add = (candidate: unknown) => {
    const normalized = normalizeOemPartsToken(candidate);
    if (normalized.length >= 3) tokens.add(normalized);
  };

  for (const segment of String(value ?? "").split(/[\n\r,;|]+/)) {
    const cleanSegment = segment.trim();
    if (!cleanSegment) continue;
    add(cleanSegment);

    const parts = cleanSegment.split(/\s+/).filter(Boolean);
    for (const part of parts) add(part);

    for (let start = 0; start < parts.length; start += 1) {
      const first = normalizeOemPartsToken(parts[start]);
      if (!/^[A-Z]{1,4}$/.test(first)) continue;
      let grouped = parts[start];
      let hasDigit = false;
      for (let index = start + 1; index < parts.length; index += 1) {
        const next = normalizeOemPartsToken(parts[index]);
        if (!next) break;
        if (/\d/.test(next)) {
          grouped += parts[index];
          hasDigit = true;
          continue;
        }
        if (hasDigit && (next === "X" || next === "Z")) {
          grouped += parts[index];
          continue;
        }
        break;
      }
      if (hasDigit) add(grouped);
    }
  }

  return tokens;
}

function productHasOemPartsArticle(
  product: { oemParts?: string | null },
  articleOemNormalized: string
): { confidence: number; reason: string } | null {
  if (!articleOemNormalized) return null;
  return normalizedOemPartsTokens(product.oemParts).has(articleOemNormalized)
    ? { confidence: 95, reason: "OEM Parts normalized" }
    : null;
}

function localMatchFromProduct(
  product: Prisma.LocalProductGetPayload<{ include: { stockBalances: true } }>,
  match: { confidence: number; reason: string }
): MannLocalProductMatch {
  const stock = product.stockBalances[0];
  return {
    id: product.id,
    name: product.name,
    article: product.article,
    code: product.code,
    brand: product.brand,
    price: product.salePriceCents / 100,
    currency: product.currencyName ?? "руб.",
    stock: stock?.quantity.toNumber() ?? 0,
    available: stock?.available.toNumber() ?? 0,
    cell: stock?.slotName ?? product.cell,
    matchConfidence: match.confidence,
    matchReason: match.reason,
  };
}

export async function matchMannArticlesToLocalProducts(params: {
  mannArticles: Array<string | MatchInputArticle>;
  organizationId?: string | null;
  warehouseId?: string | null;
}): Promise<MannArticleMatchResult[]> {
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
    ? await prisma.localStore.findFirst({ where: { OR: [{ id: params.warehouseId }, { moyskladId: params.warehouseId }] }, select: { id: true } })
    : null;
  const stockInclude = { where: store?.id ? { storeId: store.id } : undefined, take: store?.id ? 1 : 5 };

  const results: MannArticleMatchResult[] = [];
  for (const articleNormalized of normalizedArticles) {
    const item = articleByNormalized.get(articleNormalized)!;
    const articleOemNormalized = normalizeOemPartsToken(item.mannArticle);
    const candidateIds = articleOemNormalized
      ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM local_products
          WHERE archived = false
            AND entity_type <> 'service'
            AND oem_parts IS NOT NULL
            AND regexp_replace(upper(oem_parts), '[^A-Z0-9]', '', 'g') LIKE ${`%${articleOemNormalized}%`}
          LIMIT 200
        `)
      : [];
    const candidates = await prisma.localProduct.findMany({
      where: {
        id: { in: candidateIds.map((candidate) => candidate.id) },
      },
      include: { stockBalances: stockInclude },
    });
    const byProduct = new Map<string, MannLocalProductMatch>();
    for (const product of candidates) {
      const match = productHasOemPartsArticle(product, articleOemNormalized);
      if (!match) continue;
      const current = byProduct.get(product.id);
      const next = localMatchFromProduct(product, match);
      if (!current || next.matchConfidence > current.matchConfidence) byProduct.set(product.id, next);
    }
    const localMatches = [...byProduct.values()].sort((a, b) => {
      if (b.matchConfidence !== a.matchConfidence) return b.matchConfidence - a.matchConfidence;
      if (b.available !== a.available) return b.available - a.available;
      return a.name.localeCompare(b.name, "ru");
    });
    const strongMatches = localMatches.filter((match) => match.matchConfidence >= 80);
    const status =
      strongMatches.length === 1
        ? "found"
        : strongMatches.length > 1
          ? "multiple_matches"
          : localMatches.length > 0
            ? "needs_review"
            : "not_found";
    const bestMatch = status === "found" ? strongMatches[0] : localMatches[0] ?? null;
    results.push({
      mannArticle: item.mannArticle,
      mannArticleNormalized: articleNormalized,
      filterType: item.filterType,
      filterSubtype: item.filterSubtype,
      localMatches,
      bestMatch,
      matchConfidence: bestMatch?.matchConfidence ?? 0,
      matchReason: bestMatch?.matchReason ?? "not_found",
      stock: bestMatch?.stock ?? 0,
      available: bestMatch?.available ?? 0,
      price: bestMatch?.price ?? null,
      cell: bestMatch?.cell,
      status,
    });
  }
  return results;
}
