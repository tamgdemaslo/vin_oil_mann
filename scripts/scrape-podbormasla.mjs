#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DomUtils, parseDocument } from "htmlparser2";

const SCRIPT_VERSION = "2026-07-23.2";
const DEFAULT_SITEMAP_URL = "https://podbormasla.ru/sitemap.xml";
const DEFAULT_ROBOTS_URL = "https://podbormasla.ru/robots.txt";
const USER_AGENT = "TGM-Podbormasla-Snapshot/1.0 (+catalog research; sequential crawler)";
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "p",
  "section",
  "td",
  "th",
  "tr",
]);

const CSV_COLUMNS = [
  "row_id",
  "source_url",
  "page_path",
  "brand_slug",
  "model_slug",
  "generation_slug",
  "page_title",
  "table_index",
  "row_index",
  "table_kind",
  "application",
  "system_name",
  "model",
  "fuel_type",
  "engine_displacement",
  "power",
  "production_years",
  "fill_volume",
  "specification",
  "recommendation",
  "replacement_interval",
  "control_interval",
  "analog",
  "sae_json",
  "headers_json",
  "extra_columns_json",
  "raw_cells_json",
  "row_text",
  "fetched_at",
  "page_sha256",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function cleanLine(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\f\v ]+/g, " ")
    .trim();
}

function cleanMultiline(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function singleLine(value) {
  return cleanMultiline(value).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function textWithBreaks(node) {
  if (!node) return "";
  if (node.type === "text") return node.data ?? "";
  if (node.type !== "tag" && node.type !== "root") return "";
  if (node.name === "br") return "\n";
  const inner = (node.children ?? []).map(textWithBreaks).join("");
  return BLOCK_TAGS.has(node.name) ? `${inner}\n` : inner;
}

function tags(root, name) {
  return DomUtils.findAll((node) => node.name === name, root.children ?? []);
}

function directCells(row) {
  return (row.children ?? []).filter(
    (node) => node.type === "tag" && (node.name === "th" || node.name === "td"),
  );
}

function cellRecord(cell) {
  return {
    tag: cell.name,
    text: cleanMultiline(textWithBreaks(cell)),
    colspan: Number.parseInt(cell.attribs?.colspan ?? "1", 10) || 1,
    rowspan: Number.parseInt(cell.attribs?.rowspan ?? "1", 10) || 1,
  };
}

function headerKey(value, index) {
  const header = singleLine(value).toLocaleLowerCase("ru-RU");
  if (!header && index === 0) return "application";
  if (/^автомобил|^транспортн.{0,12}средств/.test(header)) return "application";
  if (/применен|назначен|агрегат|система|узел/.test(header)) return "application";
  if (/^модел/.test(header)) return "model";
  if (/объ[её]м(?:\s+заливки)?/.test(header)) return "fill_volume";
  if (/спецификац|требовани.{0,4}(?:оем|oem)|допуск/.test(header)) return "specification";
  if (/рекомендац|рекомендуем/.test(header)) return "recommendation";
  const slug = header
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `column_${index + 1}${slug ? `_${slug}` : ""}`;
}

function uniqueHeaderKeys(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = headerKey(header, index);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function isDataHeader(cells) {
  if (cells.length < 3) return false;
  const values = cells.map((cell) => singleLine(textWithBreaks(cell)).toLocaleLowerCase("ru-RU"));
  const joined = values.join(" | ");
  const hasVolume = /объ[её]м/.test(joined);
  const hasSpecification = /спецификац|требовани.{0,4}(?:оем|oem)|допуск/.test(joined);
  const hasApplication = /применен|назначен|агрегат|система|узел/.test(joined);
  const hasModel = /модел/.test(joined);
  const hasRecommendation = /рекомендац|рекомендуем/.test(joined);
  const hasVehicle = /автомобил|транспортн.{0,12}средств/.test(joined);
  const fluidColumnCount = values.filter((value) => /масл|жидкост/.test(value)).length;
  return (
    (hasVolume && hasSpecification) ||
    (hasApplication && hasSpecification && (hasModel || hasRecommendation)) ||
    (hasVehicle && fluidColumnCount >= 2)
  );
}

function tableKind(headers) {
  const value = headers.map(singleLine).join(" | ").toLocaleLowerCase("ru-RU");
  if (/автомобил|транспортн.{0,12}средств/.test(value) && /моторн.{0,8}масл/.test(value)) {
    return "vehicle_fluid_matrix";
  }
  if (/применен/.test(value) && /требовани.{0,4}(?:оем|oem)/.test(value)) return "equipment_fluids";
  if (/объ[её]м/.test(value) && /спецификац/.test(value)) return "vehicle_fluids";
  return "fluid_table";
}

function extractBetweenLabels(value, label, nextLabels) {
  const text = singleLine(value);
  const next = nextLabels.length ? `(?=${nextLabels.map((item) => `(?:${item})\\s*:`).join("|")}|$)` : "$";
  return cleanLine(text.match(new RegExp(`(?:${label})\\s*:\\s*(.*?)${next}`, "i"))?.[1] ?? "");
}

function extractSystemName(application) {
  return cleanLine(
    singleLine(application).split(
      /\s+(?=(?:Модель|Тип топлива|Объ[её]м двигателя|Мощность|Годы выпуска|Объ[её]м заливки)\s*:)/i,
    )[0],
  );
}

function extractIntervals(specification, recommendation) {
  const text = singleLine(`${specification ?? ""} ${recommendation ?? ""}`);
  const replacement = cleanLine(
    text.match(/(?:Периодичность\s+замены|Замена)\s*:\s*(.*?)(?=(?:Контроль|Аналог)\s*:|$)/i)?.[1] ?? "",
  );
  const control = cleanLine(
    text.match(/Контроль\s*:\s*(.*?)(?=(?:Периодичность\s+замены|Замена|Аналог)\s*:|$)/i)?.[1] ?? "",
  );
  const analog = cleanLine(
    text.match(/Аналог\s*:\s*(.*?)(?=(?:Периодичность\s+замены|Замена|Контроль)\s*:|$)/i)?.[1] ?? "",
  );
  const sae = [...text.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map((match) => match[0].toUpperCase());
  return { replacement, control, analog, sae: [...new Set(sae)] };
}

function extractApplicationFields(application, modelColumn) {
  const nextLabels = ["Тип\\s+топлива", "Объ[её]м\\s+двигателя", "Мощность", "Годы\\s+выпуска", "Объ[её]м\\s+заливки"];
  return {
    systemName: extractSystemName(application),
    model: cleanLine(modelColumn) || extractBetweenLabels(application, "Модель", nextLabels),
    fuelType: extractBetweenLabels(application, "Тип\\s+топлива", ["Объ[её]м\\s+двигателя", "Мощность", "Годы\\s+выпуска", "Объ[её]м\\s+заливки"]),
    engineDisplacement: extractBetweenLabels(application, "Объ[её]м\\s+двигателя", ["Мощность", "Годы\\s+выпуска", "Объ[её]м\\s+заливки"]),
    power: extractBetweenLabels(application, "Мощность", ["Годы\\s+выпуска", "Объ[её]м\\s+заливки"]),
    productionYears: extractBetweenLabels(application, "Годы\\s+выпуска", ["Объ[её]м\\s+заливки"]),
  };
}

function volumeFromApplication(application) {
  return cleanLine(singleLine(application).match(/Объ[её]м\s+заливки\s*:\s*(.*)$/i)?.[1] ?? "");
}

function extractTitle(document) {
  const title = tags(document, "title")[0];
  return title ? singleLine(textWithBreaks(title)) : "";
}

function extractCanonical(document, fallback) {
  const links = tags(document, "link");
  const canonical = links.find((link) => String(link.attribs?.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  return canonical?.attribs?.href || fallback;
}

function parseJsonLd(document) {
  const documents = [];
  const errors = [];
  for (const script of tags(document, "script")) {
    if (String(script.attribs?.type ?? "").toLowerCase() !== "application/ld+json") continue;
    const raw = (script.children ?? []).map((child) => child.data ?? "").join("").trim();
    if (!raw) continue;
    try {
      documents.push(JSON.parse(raw));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { documents, errors };
}

function pageSlugs(sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  return {
    pagePath: url.pathname,
    brandSlug: parts[0] ?? "",
    modelSlug: parts[1] ?? "",
    generationSlug: parts[2] ?? "",
    pathDepth: parts.length,
  };
}

export function parsePodbormaslaPage({ html, sourceUrl, fetchedAt = new Date().toISOString() }) {
  const pageSha256 = sha256(html);
  const document = parseDocument(html, { decodeEntities: true });
  const title = extractTitle(document);
  const canonicalUrl = extractCanonical(document, sourceUrl);
  const slugs = pageSlugs(sourceUrl);
  const jsonLd = parseJsonLd(document);
  const allTables = tags(document, "table");
  const selectedTables = [];
  const rowsOut = [];

  allTables.forEach((table, tableIndex) => {
    const rows = DomUtils.findAll((node) => node.type === "tag" && node.name === "tr", table.children ?? []);
    const headerRowIndex = rows.findIndex((row, index) => index <= 2 && isDataHeader(directCells(row)));
    if (headerRowIndex < 0) return;

    const headerCells = directCells(rows[headerRowIndex]);
    const headers = headerCells.map((cell) => cleanMultiline(textWithBreaks(cell)));
    const headerKeys = uniqueHeaderKeys(headers);
    const kind = tableKind(headers);
    let parsedRows = 0;

    rows.slice(headerRowIndex + 1).forEach((row, offset) => {
      const cells = directCells(row).map(cellRecord);
      if (cells.length === 0 || cells.every((cell) => !cell.text)) return;
      if (cells.every((cell) => cell.tag === "th") && isDataHeader(directCells(row))) return;

      const mapped = {};
      const extraColumns = {};
      cells.forEach((cell, cellIndex) => {
        const key = headerKeys[cellIndex] ?? `column_${cellIndex + 1}`;
        if (["application", "model", "fill_volume", "specification", "recommendation"].includes(key)) {
          mapped[key] = cell.text;
        } else {
          extraColumns[key] = cell.text;
        }
      });

      const application = cleanMultiline(mapped.application ?? cells[0]?.text ?? "");
      const applicationFields = extractApplicationFields(application, mapped.model);
      const fillVolume = cleanMultiline(mapped.fill_volume ?? volumeFromApplication(application));
      const specification = cleanMultiline(mapped.specification ?? "");
      const recommendation = cleanMultiline(mapped.recommendation ?? "");
      const intervals = extractIntervals(specification, recommendation);
      const sourceRowIndex = headerRowIndex + 1 + offset;
      const rawCellsJson = JSON.stringify(cells);
      const rowText = cells.map((cell) => singleLine(cell.text)).filter(Boolean).join(" | ");
      const rowId = sha256(`${sourceUrl}|${tableIndex}|${sourceRowIndex}|${rawCellsJson}`);

      rowsOut.push({
        row_id: rowId,
        source_url: sourceUrl,
        page_path: slugs.pagePath,
        brand_slug: slugs.brandSlug,
        model_slug: slugs.modelSlug,
        generation_slug: slugs.generationSlug,
        page_title: title,
        table_index: tableIndex,
        row_index: sourceRowIndex,
        table_kind: kind,
        application,
        system_name: applicationFields.systemName,
        model: applicationFields.model,
        fuel_type: applicationFields.fuelType,
        engine_displacement: applicationFields.engineDisplacement,
        power: applicationFields.power,
        production_years: applicationFields.productionYears,
        fill_volume: fillVolume,
        specification,
        recommendation,
        replacement_interval: intervals.replacement,
        control_interval: intervals.control,
        analog: intervals.analog,
        sae_json: JSON.stringify(intervals.sae),
        headers_json: JSON.stringify(headers),
        extra_columns_json: JSON.stringify(extraColumns),
        raw_cells_json: rawCellsJson,
        row_text: rowText,
        fetched_at: fetchedAt,
        page_sha256: pageSha256,
      });
      parsedRows += 1;
    });

    selectedTables.push({
      source_url: sourceUrl,
      table_index: tableIndex,
      table_kind: kind,
      header_row_index: headerRowIndex,
      headers,
      header_keys: headerKeys,
      row_count: parsedRows,
    });
  });

  return {
    page: {
      source_url: sourceUrl,
      canonical_url: canonicalUrl,
      page_path: slugs.pagePath,
      path_depth: slugs.pathDepth,
      brand_slug: slugs.brandSlug,
      model_slug: slugs.modelSlug,
      generation_slug: slugs.generationSlug,
      title,
      page_sha256: pageSha256,
      fetched_at: fetchedAt,
      html_bytes: Buffer.byteLength(html),
      all_table_count: allTables.length,
      selected_table_count: selectedTables.length,
      row_count: rowsOut.length,
      jsonld_document_count: jsonLd.documents.length,
      jsonld_error_count: jsonLd.errors.length,
    },
    tables: selectedTables,
    rows: rowsOut,
    json_ld: jsonLd.documents,
    json_ld_errors: jsonLd.errors,
  };
}

function csvEscape(value) {
  const string = value == null ? "" : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map((column) => csvEscape(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

function parseSitemap(xml, sitemapUrl) {
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].trim());
  const origin = new URL(sitemapUrl).origin;
  return [...new Set(urls)].filter((value) => {
    try {
      return new URL(value).origin === origin;
    } catch {
      return false;
    }
  });
}

function retryDelay(response, attempt) {
  const retryAfter = Number.parseInt(response?.headers?.get("retry-after") ?? "", 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1_000;
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

async function fetchText(url, options) {
  let lastError;
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
          "Accept-Language": "ru,en;q=0.7",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (response.ok) {
        return {
          body: await response.text(),
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          lastModified: response.headers.get("last-modified") ?? "",
          finalUrl: response.url,
        };
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < options.attempts) await sleep(retryDelay(response, attempt));
  }
  throw lastError ?? new Error("Unknown fetch error");
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, content);
  await rename(tempPath, path);
}

async function readArtifact(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function artifactPath(outputDir, url) {
  return resolve(outputDir, "page-results", `${sha256(url).slice(0, 24)}.json`);
}

function parsePositiveInteger(value, name, minimum = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${name} must be >= ${minimum}`);
  return parsed;
}

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const options = {
    outputDir: resolve(workspaceRoot, `outputs/podbormasla-${today}`),
    sitemapUrl: DEFAULT_SITEMAP_URL,
    robotsUrl: DEFAULT_ROBOTS_URL,
    delayMs: 250,
    timeoutMs: 30_000,
    attempts: 4,
    maxPages: null,
    refresh: false,
    refreshUrls: new Set(),
  };
  for (const arg of argv) {
    if (arg === "--refresh") options.refresh = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--output-dir=")) options.outputDir = resolve(workspaceRoot, arg.slice("--output-dir=".length));
    else if (arg.startsWith("--sitemap-url=")) options.sitemapUrl = arg.slice("--sitemap-url=".length);
    else if (arg.startsWith("--robots-url=")) options.robotsUrl = arg.slice("--robots-url=".length);
    else if (arg.startsWith("--delay-ms=")) options.delayMs = parsePositiveInteger(arg.slice("--delay-ms=".length), "delay-ms", 0);
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = parsePositiveInteger(arg.slice("--timeout-ms=".length), "timeout-ms");
    else if (arg.startsWith("--attempts=")) options.attempts = parsePositiveInteger(arg.slice("--attempts=".length), "attempts");
    else if (arg.startsWith("--max-pages=")) options.maxPages = parsePositiveInteger(arg.slice("--max-pages=".length), "max-pages");
    else if (arg.startsWith("--refresh-url=")) options.refreshUrls.add(new URL(arg.slice("--refresh-url=".length)).href);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function helpText() {
  return `Usage: node scripts/scrape-podbormasla.mjs [options]\n\n` +
    `Options:\n` +
    `  --output-dir=PATH   Snapshot directory (default outputs/podbormasla-YYYYMMDD)\n` +
    `  --delay-ms=N        Delay after each request (default 250)\n` +
    `  --timeout-ms=N      Per-request timeout (default 30000)\n` +
    `  --attempts=N        Fetch attempts per URL (default 4)\n` +
    `  --max-pages=N       Limit sitemap URLs for a parser test\n` +
    `  --refresh           Fetch successful page artifacts again\n` +
    `  --refresh-url=URL   Fetch and reparse one URL while resuming the rest\n`;
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

async function buildAggregates({
  outputDir,
  urls,
  sitemapUrl,
  sitemapSha256,
  robotsUrl,
  robotsSha256,
  startedAt,
}) {
  const pages = [];
  const tables = [];
  const rows = [];
  const jsonLd = [];
  const errors = [];

  for (const url of urls) {
    const artifact = await readArtifact(artifactPath(outputDir, url));
    if (!artifact) {
      errors.push({ source_url: url, error: "missing artifact" });
      continue;
    }
    if (artifact.status !== "ok") {
      errors.push({ source_url: url, error: artifact.error ?? "fetch failed", fetched_at: artifact.fetched_at });
      continue;
    }
    pages.push({ ...artifact.page, http_status: artifact.http_status, content_type: artifact.content_type, final_url: artifact.final_url });
    tables.push(...artifact.tables);
    rows.push(...artifact.rows);
    if (artifact.json_ld?.length || artifact.json_ld_errors?.length) {
      jsonLd.push({
        source_url: url,
        page_sha256: artifact.page.page_sha256,
        documents: artifact.json_ld ?? [],
        errors: artifact.json_ld_errors ?? [],
      });
    }
  }

  const rowsByKind = {};
  const rowsBySystem = {};
  const rowsByBrand = {};
  for (const row of rows) {
    increment(rowsByKind, row.table_kind || "unknown");
    increment(rowsBySystem, row.system_name || "(empty)");
    increment(rowsByBrand, row.brand_slug || "(empty)");
  }
  const uniqueRowContent = new Set(rows.map((row) => sha256(`${row.application}|${row.model}|${row.fill_volume}|${row.specification}|${row.recommendation}`)));
  const completedAt = new Date().toISOString();
  const summary = {
    schema_version: 1,
    scraper: { name: "scrape-podbormasla.mjs", version: SCRIPT_VERSION },
    source: {
      sitemap_url: sitemapUrl,
      sitemap_sha256: sitemapSha256,
      robots_url: robotsUrl,
      robots_sha256: robotsSha256,
    },
    crawl: {
      started_at: startedAt,
      completed_at: completedAt,
      sitemap_urls: urls.length,
      pages_ok: pages.length,
      pages_error: errors.length,
      pages_with_rows: pages.filter((page) => page.row_count > 0).length,
      pages_without_rows: pages.filter((page) => page.row_count === 0).length,
    },
    counts: {
      selected_tables: tables.length,
      rows: rows.length,
      unique_row_content: uniqueRowContent.size,
      jsonld_pages: jsonLd.length,
      jsonld_documents: jsonLd.reduce((sum, item) => sum + item.documents.length, 0),
      jsonld_errors: jsonLd.reduce((sum, item) => sum + item.errors.length, 0),
    },
    rows_by_table_kind: Object.fromEntries(Object.entries(rowsByKind).sort((left, right) => right[1] - left[1])),
    rows_by_system: Object.fromEntries(Object.entries(rowsBySystem).sort((left, right) => right[1] - left[1])),
    rows_by_brand: Object.fromEntries(Object.entries(rowsByBrand).sort((left, right) => right[1] - left[1])),
    files: {
      rows_csv: "podbormasla_rows.csv",
      rows_ndjson: "podbormasla_rows.ndjson",
      pages_ndjson: "podbormasla_pages.ndjson",
      tables_ndjson: "podbormasla_tables.ndjson",
      jsonld_ndjson: "podbormasla_jsonld.ndjson",
      errors_json: "podbormasla_errors.json",
    },
  };

  await Promise.all([
    atomicWrite(resolve(outputDir, "podbormasla_rows.csv"), toCsv(rows)),
    atomicWrite(resolve(outputDir, "podbormasla_rows.ndjson"), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")),
    atomicWrite(resolve(outputDir, "podbormasla_pages.ndjson"), pages.map((page) => JSON.stringify(page)).join("\n") + (pages.length ? "\n" : "")),
    atomicWrite(resolve(outputDir, "podbormasla_tables.ndjson"), tables.map((table) => JSON.stringify(table)).join("\n") + (tables.length ? "\n" : "")),
    atomicWrite(resolve(outputDir, "podbormasla_jsonld.ndjson"), jsonLd.map((item) => JSON.stringify(item)).join("\n") + (jsonLd.length ? "\n" : "")),
    atomicWrite(resolve(outputDir, "podbormasla_errors.json"), `${JSON.stringify(errors, null, 2)}\n`),
    atomicWrite(resolve(outputDir, "podbormasla_summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
  ]);
  return { summary, errors };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  const startedAt = new Date().toISOString();
  await mkdir(resolve(options.outputDir, "page-results"), { recursive: true });
  console.log(`[podbormasla] output: ${options.outputDir}`);
  console.log(`[podbormasla] fetching robots.txt and sitemap...`);

  const [robotsResult, sitemapResult] = await Promise.all([
    fetchText(options.robotsUrl, options),
    fetchText(options.sitemapUrl, options),
  ]);
  const robotsSha256 = sha256(robotsResult.body);
  const sitemapSha256 = sha256(sitemapResult.body);
  await Promise.all([
    atomicWrite(resolve(options.outputDir, "robots.txt"), robotsResult.body),
    atomicWrite(resolve(options.outputDir, "sitemap.xml"), sitemapResult.body),
  ]);

  const allUrls = parseSitemap(sitemapResult.body, options.sitemapUrl);
  const urls = options.maxPages ? allUrls.slice(0, options.maxPages) : allUrls;
  console.log(`[podbormasla] sitemap URLs: ${allUrls.length}; selected: ${urls.length}`);

  let fetched = 0;
  let resumed = 0;
  let failed = 0;
  let parsedRows = 0;
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const path = artifactPath(options.outputDir, url);
    const existing = options.refresh || options.refreshUrls.has(url) ? null : await readArtifact(path);
    if (existing?.status === "ok") {
      resumed += 1;
      parsedRows += existing.page?.row_count ?? 0;
      if ((index + 1) % 50 === 0 || index + 1 === urls.length) {
        console.log(`[podbormasla] ${index + 1}/${urls.length} fetched=${fetched} resumed=${resumed} failed=${failed} rows=${parsedRows}`);
      }
      continue;
    }

    const fetchedAt = new Date().toISOString();
    try {
      const response = await fetchText(url, options);
      const parsed = parsePodbormaslaPage({ html: response.body, sourceUrl: url, fetchedAt });
      const artifact = {
        schema_version: 1,
        scraper_version: SCRIPT_VERSION,
        status: "ok",
        http_status: response.status,
        content_type: response.contentType,
        last_modified: response.lastModified,
        final_url: response.finalUrl,
        ...parsed,
      };
      await atomicWrite(path, `${JSON.stringify(artifact)}\n`);
      fetched += 1;
      parsedRows += parsed.rows.length;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await atomicWrite(path, `${JSON.stringify({
        schema_version: 1,
        scraper_version: SCRIPT_VERSION,
        status: "error",
        source_url: url,
        fetched_at: fetchedAt,
        error: message,
      })}\n`);
      console.error(`[podbormasla] ERROR ${url}: ${message}`);
    }

    if ((index + 1) % 10 === 0 || index + 1 === urls.length) {
      console.log(`[podbormasla] ${index + 1}/${urls.length} fetched=${fetched} resumed=${resumed} failed=${failed} rows=${parsedRows}`);
    }
    if (index + 1 < urls.length && options.delayMs > 0) await sleep(options.delayMs);
  }

  console.log(`[podbormasla] building aggregate files...`);
  const { summary, errors } = await buildAggregates({
    outputDir: options.outputDir,
    urls,
    sitemapUrl: options.sitemapUrl,
    sitemapSha256,
    robotsUrl: options.robotsUrl,
    robotsSha256,
    startedAt,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length > 0) process.exitCode = 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
