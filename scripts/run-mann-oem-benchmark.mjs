#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const productsPath = argument("local-products");
const catalogPath = argument("mann-catalog");
const linksPath = argument("mann-links");
const datasetAuditPath = argument("dataset-audit");
const manifestPath = argument("manifest");
const reportPath = argument("report");
const buildManifest = process.argv.includes("--build-manifest");
if (!productsPath || !catalogPath || !linksPath || !datasetAuditPath || !manifestPath || !reportPath) {
  throw new Error("Usage: node scripts/run-mann-oem-benchmark.mjs --local-products=<dump.sql> --mann-catalog=<dump.sql> --mann-links=<dump.sql> --dataset-audit=<json> --manifest=<json> --report=<json> [--build-manifest]");
}

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { evaluateMannArticleProductMatch, normalizeMannArticle, normalizeMannProductBrand } = await jiti.import("../src/lib/mann-catalog.ts");
const { buildPartNumberCollisionIndex, listPartNumberCollisions, parseOemParts } = await jiti.import("../src/lib/part-number-cross-reference.ts");

function unescapeCopyValue(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([btnr\\])/g, (_, code) => ({ b: "\b", t: "\t", n: "\n", r: "\r", "\\": "\\" })[code]);
}

function readCopyRows(filePath, table) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith(`COPY public.${table} (`));
  if (headerIndex < 0) throw new Error(`COPY section for ${table} was not found`);
  const columns = lines[headerIndex].match(/\((.*)\) FROM stdin;/)?.[1]?.split(", ");
  if (!columns) throw new Error(`COPY columns for ${table} could not be parsed`);
  const rows = [];
  for (let index = headerIndex + 1; index < lines.length && lines[index] !== "\\."; index += 1) {
    const values = lines[index].split("\t").map(unescapeCopyValue);
    rows.push(Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]])));
  }
  return rows;
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function productHash(id) {
  return digest(id).slice(0, 20);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const products = readCopyRows(productsPath, "local_products")
  .filter((row) => row.archived !== "t" && row.entity_type !== "service")
  .map((row) => ({
    id: row.id,
    brand: row.brand,
    article: row.article,
    code: row.code,
    name: row.name,
    oemParts: row.oem_parts,
  }));
const productsById = new Map(products.map((product) => [product.id, product]));
const catalogArticles = [...new Set(readCopyRows(catalogPath, "mann_filter_applications").map((row) => row.mann_article).filter(Boolean))];
const authoritativeCollisionIndex = buildPartNumberCollisionIndex([
  ...catalogArticles,
  ...products.flatMap((product) => normalizeMannProductBrand(product.brand) ? [product.article, product.article ? null : product.code] : []),
]);
const observedCollisionIndex = buildPartNumberCollisionIndex([
  ...catalogArticles,
  ...products.flatMap((product) => normalizeMannProductBrand(product.brand) ? [product.article, product.article ? null : product.code] : []),
  ...products.flatMap((product) => parseOemParts(product.oemParts).map((entry) => entry.articleRaw)),
]);
const safeCompactKeys = new Set([...authoritativeCollisionIndex].filter(([, canonicals]) => canonicals.size === 1).map(([key]) => key));
const explicitLinks = new Map();
for (const row of readCopyRows(linksPath, "product_mann_links")) {
  const article = normalizeMannArticle(row.mann_article);
  if (!article || !productsById.has(row.product_id)) continue;
  explicitLinks.set(article, new Set([...(explicitLinks.get(article) ?? []), row.product_id]));
}

function actualProductIds(reference) {
  const ids = new Set();
  for (const product of products) {
    if (evaluateMannArticleProductMatch(product, reference, { safeCompactKeys })) ids.add(product.id);
  }
  for (const id of explicitLinks.get(normalizeMannArticle(reference)) ?? []) ids.add(id);
  return [...ids].sort();
}

if (buildManifest) {
  const audit = JSON.parse(fs.readFileSync(datasetAuditPath, "utf8"));
  const datasetReferences = (audit.datasetD?.references ?? []).map((item) => item.article).filter(Boolean);
  const requiredSafetyReferences = ["C27161", "C2716/1"];
  const selected = [...new Set([...datasetReferences, ...requiredSafetyReferences])];
  const remaining = catalogArticles
    .filter((article) => !selected.some((current) => normalizeMannArticle(current) === normalizeMannArticle(article)))
    .sort((left, right) => digest(left).localeCompare(digest(right)));
  while (selected.length < 100 && remaining.length) selected.push(remaining.shift());
  assert.equal(selected.length, 100, "benchmark must contain exactly 100 MANN references");
  writeJson(manifestPath, {
    schemaVersion: 1,
    benchmarkId: "mann-oem-cross-reference-v1",
    frozenAt: new Date().toISOString(),
    selection: "95 Dataset D references + C27161/C2716/1 safety pair + deterministic SHA-256 catalog fill",
    evidencePolicy: "exact product MANN identity, exact/safe OEM evidence, or explicit ProductMannLink; product IDs are SHA-256 pseudonyms",
    sourceHashes: {
      localProducts: digest(fs.readFileSync(productsPath)),
      mannCatalog: digest(fs.readFileSync(catalogPath)),
      mannLinks: digest(fs.readFileSync(linksPath)),
    },
    references: selected.map((reference) => ({
      reference,
      expectedProductIdHashes: actualProductIds(reference).map(productHash),
    })),
  });
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.ok((manifest.references?.length ?? 0) >= 100, "benchmark manifest must contain at least 100 references");
let truePositive = 0;
let falseAnalog = 0;
let missedAnalog = 0;
const failures = [];
const durations = [];
for (const item of manifest.references) {
  const started = performance.now();
  const actual = new Set(actualProductIds(item.reference).map(productHash));
  durations.push(performance.now() - started);
  const expected = new Set(item.expectedProductIdHashes ?? []);
  const falseIds = [...actual].filter((id) => !expected.has(id));
  const missedIds = [...expected].filter((id) => !actual.has(id));
  truePositive += [...actual].filter((id) => expected.has(id)).length;
  falseAnalog += falseIds.length;
  missedAnalog += missedIds.length;
  if (falseIds.length || missedIds.length) failures.push({ reference: item.reference, falseIds, missedIds });
}
const precision = truePositive + falseAnalog ? truePositive / (truePositive + falseAnalog) : 1;
const recall = truePositive + missedAnalog ? truePositive / (truePositive + missedAnalog) : 1;
const sortedDurations = durations.slice().sort((left, right) => left - right);
const report = {
  schemaVersion: 1,
  benchmarkId: manifest.benchmarkId,
  generatedAt: new Date().toISOString(),
  references: manifest.references.length,
  expectedLinks: truePositive + missedAnalog,
  actualLinks: truePositive + falseAnalog,
  precision,
  recall,
  falseAnalog,
  missedAnalog,
  failures,
  authoritativeCollisions: listPartNumberCollisions(authoritativeCollisionIndex),
  observedCrossNamespaceCollisions: listPartNumberCollisions(observedCollisionIndex),
  performance: {
    catalogProductsScannedPerReference: products.length,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    averageMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    p95Ms: sortedDurations[Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1)],
    note: "Offline worst-case full scan; production uses branch-scoped DB candidate retrieval before parsing.",
  },
};
writeJson(reportPath, report);
assert.equal(falseAnalog, 0, `false analog regression: ${falseAnalog}`);
assert.equal(missedAnalog, 0, `missed analog regression: ${missedAnalog}`);
console.log(JSON.stringify(report, null, 2));
