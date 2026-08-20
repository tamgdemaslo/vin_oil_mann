import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const reportPath = argument("report");
const labelsPath = argument("labels");
const productsPath = argument("local-products");
const stockPath = argument("local-stock");
const linksPath = argument("mann-links");
const mannCatalogPath = argument("mann-catalog");
const outputPath = argument("output");

if (!reportPath || !labelsPath || !productsPath || !stockPath || !linksPath || !mannCatalogPath || !outputPath) {
  throw new Error("Usage: node scripts/audit-mann-oem-local-layer.mjs --report=<dataset-d.json> --labels=<labels.json> --local-products=<dump.sql> --local-stock=<dump.sql> --mann-links=<dump.sql> --mann-catalog=<dump.sql> --output=<private.json>");
}

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const {
  evaluateMannArticleProductMatch,
  normalizeMannArticle,
  normalizeMannProductBrand,
  normalizePartArticle,
} = await jiti.import("../src/lib/mann-catalog.ts");
const { splitProductCrossReferences } = await jiti.import("../src/lib/product-cross-references.ts");
const {
  buildPartNumberCollisionIndex,
  normalizePartNumberForCrossMatch,
  parseOemParts,
} = await jiti.import("../src/lib/part-number-cross-reference.ts");
const { normalizeRosskoArticle, normalizeRosskoBrand } = await jiti.import("../src/lib/rossko-product-import.ts");

function unescapeCopyValue(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([btnr\\])/g, (_, code) => ({ b: "\b", t: "\t", n: "\n", r: "\r", "\\": "\\" })[code]);
}

function readCopyRows(filePath, table) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith(`COPY public.${table} (`));
  if (headerIndex < 0) throw new Error(`COPY section for ${table} was not found in ${filePath}`);
  const columns = lines[headerIndex].match(/\((.*)\) FROM stdin;/)?.[1]?.split(", ");
  if (!columns) throw new Error(`COPY columns for ${table} could not be parsed`);
  const rows = [];
  for (let index = headerIndex + 1; index < lines.length && lines[index] !== "\\."; index += 1) {
    const values = lines[index].split("\t").map(unescapeCopyValue);
    rows.push(Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]])));
  }
  return rows;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function anonymousId(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))));
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function normalizedCurrentOemTokens(value) {
  const tokens = new Map();
  const add = (candidate, segment, route) => {
    const normalized = normalizePartArticle(candidate).compact;
    if (normalized.length < 3) return;
    const evidence = tokens.get(normalized) ?? [];
    evidence.push({ candidate: String(candidate), segment, route });
    tokens.set(normalized, evidence);
  };

  for (const segment of String(value ?? "").split(/[\n\r,;|]+/)) {
    const cleanSegment = segment.trim();
    if (!cleanSegment) continue;
    add(cleanSegment, cleanSegment, "whole_segment");

    const parts = cleanSegment.split(/\s+/).filter(Boolean);
    for (const part of parts) add(part, cleanSegment, "whitespace_part");

    for (let start = 0; start < parts.length; start += 1) {
      const first = normalizePartArticle(parts[start]).compact;
      if (!/^[A-Z]{1,4}$/.test(first)) continue;
      let grouped = parts[start];
      let hasDigit = false;
      for (let index = start + 1; index < parts.length; index += 1) {
        const next = normalizePartArticle(parts[index]).compact;
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
      if (hasDigit) add(grouped, cleanSegment, "letter_digit_group");
    }
  }
  return tokens;
}

function segmentFormat(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  const digitWords = words.filter((word) => /\d/.test(word));
  if (!/\d/.test(segment)) return "free_text_without_digits";
  if (words.length === 1) return "single_article_or_compact_value";
  if (digitWords.length > 1) return "multiple_digit_chunks_or_articles";
  if (/^[\p{L}]{2,}[\s:-]+/u.test(segment)) return "alpha_prefix_plus_article";
  if (/^[\p{L}]$/u.test(words[0] ?? "") && words.slice(1).every((word) => /^[\d./-]+$/u.test(word))) return "spaced_article";
  return "mixed_spaced_value";
}

function canonicalAttribute(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleUpperCase("ru-RU").replace(/\s+/g, " ");
}

function parseRawSource(raw) {
  try {
    const value = JSON.parse(raw);
    const text = JSON.stringify(value).toLocaleLowerCase("ru-RU");
    if (text.includes("rossko")) return "rossko";
    if (text.includes("moysklad") || text.includes("мойсклад")) return "moysklad";
    return "other_raw";
  } catch {
    return raw ? "unparseable_raw" : "missing_raw";
  }
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const labelDocument = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
const labels = new Map((labelDocument.labels ?? []).map((label) => [label.sampleId, label]));
const productRows = readCopyRows(productsPath, "local_products");
const products = productRows
  .filter((row) => row.entity_type !== "service")
  .map((row) => ({
    ...row,
    archived: row.archived === "t",
    oemParts: row.oem_parts,
    oemTokens: normalizedCurrentOemTokens(row.oem_parts),
    parsedOemParts: parseOemParts(row.oem_parts),
  }));
const activeProducts = products.filter((product) => !product.archived);
const productsById = new Map(products.map((product) => [product.id, product]));

const stockByProduct = new Map();
for (const row of readCopyRows(stockPath, "local_stock_balances")) {
  const current = stockByProduct.get(row.product_id) ?? { stock: 0, reserve: 0, available: 0 };
  current.stock += Number(row.quantity) || 0;
  current.reserve += Number(row.reserve) || 0;
  current.available += Number(row.available) || 0;
  stockByProduct.set(row.product_id, current);
}

const linksByArticle = new Map();
for (const row of readCopyRows(linksPath, "product_mann_links")) {
  const article = normalizeMannArticle(row.mann_article);
  if (!article) continue;
  const links = linksByArticle.get(article) ?? [];
  links.push({ productId: row.product_id, confidence: Number(row.confidence) || 100, linkType: row.link_type || "manual" });
  linksByArticle.set(article, links);
}

const oemFormat = {
  productsWithOemParts: activeProducts.filter((product) => String(product.oem_parts ?? "").trim()).length,
  rawValuesEndingWithSemicolon: activeProducts.filter((product) => /;\s*$/.test(product.oem_parts ?? "")).length,
  delimiters: {
    semicolon: activeProducts.filter((product) => /;/.test(product.oem_parts ?? "")).length,
    comma: activeProducts.filter((product) => /,/.test(product.oem_parts ?? "")).length,
    newline: activeProducts.filter((product) => /[\r\n]/.test(product.oem_parts ?? "")).length,
    pipe: activeProducts.filter((product) => /\|/.test(product.oem_parts ?? "")).length,
  },
};
const oemSegments = activeProducts.flatMap((product) => String(product.oem_parts ?? "")
  .split(/[\n\r,;|]+/)
  .map((segment) => segment.trim())
  .filter(Boolean));
oemFormat.segments = oemSegments.length;
oemFormat.segmentFormats = countBy(oemSegments.map(segmentFormat));
oemFormat.characters = {
  slash: oemSegments.filter((value) => /\//.test(value)).length,
  hyphen: oemSegments.filter((value) => /[-‐‑‒–—―]/.test(value)).length,
  dot: oemSegments.filter((value) => /\./.test(value)).length,
  whitespace: oemSegments.filter((value) => /\s/.test(value)).length,
};
oemFormat.currentParserTokenRoutes = countBy(activeProducts.flatMap((product) => [...product.oemTokens.values()].flat().map((item) => item.route)));
oemFormat.sharedCrossReferenceParser = {
  totalTokens: activeProducts.reduce((sum, product) => sum + splitProductCrossReferences(product.oem_parts).length, 0),
  valuesWithDifferentTokenCountFromCurrentParser: activeProducts.filter((product) => (
    splitProductCrossReferences(product.oem_parts).length !== product.oemTokens.size
  )).length,
};

function collisionSummary(entries, structuralOf, compactOf) {
  const byCompact = new Map();
  for (const entry of entries) {
    const compact = compactOf(entry);
    const structural = structuralOf(entry);
    if (!compact || !structural) continue;
    const current = byCompact.get(compact) ?? { structural: new Set(), raw: new Set(), entries: [] };
    current.structural.add(structural);
    current.raw.add(String(entry.raw ?? ""));
    current.entries.push(entry);
    byCompact.set(compact, current);
  }
  const structuralCollisions = [...byCompact].filter(([, value]) => value.structural.size > 1);
  const formattingVariants = [...byCompact].filter(([, value]) => value.raw.size > 1 && value.structural.size === 1);
  return {
    normalizedKeys: byCompact.size,
    compactKeysWithMultipleStructuralForms: structuralCollisions.length,
    compactKeysWithFormattingOnlyVariants: formattingVariants.length,
    structuralCollisionExamples: structuralCollisions.slice(0, 20).map(([compact, value]) => ({ compact, structural: [...value.structural], raw: [...value.raw].slice(0, 8) })),
  };
}

const mannCatalogArticles = [...new Set(readCopyRows(mannCatalogPath, "mann_filter_applications").map((row) => row.mann_article).filter(Boolean))]
  .map((raw) => ({ raw }));
const ownArticleEntries = activeProducts.flatMap((product) => [product.article, product.code]
  .filter(Boolean)
  .map((raw) => ({ raw, brand: product.brand, productId: product.id })));
const oemTokenEntries = activeProducts.flatMap((product) => oemSegments.length && String(product.oem_parts ?? "")
  .split(/[\n\r,;|]+/)
  .map((raw) => raw.trim())
  .filter(Boolean)
  .map((raw) => ({ raw, brand: product.brand, productId: product.id })));
const collisions = {
  mannCatalog: collisionSummary(mannCatalogArticles, (entry) => normalizePartArticle(entry.raw).structural, (entry) => normalizePartArticle(entry.raw).compact),
  localOwnArticlesAndCodes: collisionSummary(ownArticleEntries, (entry) => normalizePartArticle(entry.raw).structural, (entry) => normalizePartArticle(entry.raw).compact),
  oemRawSegments: collisionSummary(oemTokenEntries, (entry) => normalizePartArticle(entry.raw).structural, (entry) => normalizePartArticle(entry.raw).compact),
};
const authoritativeCollisionIndex = buildPartNumberCollisionIndex([
  ...mannCatalogArticles.map((entry) => entry.raw),
  ...activeProducts.flatMap((product) => normalizeMannProductBrand(product.brand)
    ? [product.article, product.article ? null : product.code]
    : []),
]);
const safeCompactKeys = new Set([...authoritativeCollisionIndex]
  .filter(([, canonicals]) => canonicals.size === 1)
  .map(([compact]) => compact));

const duplicateGroups = new Map();
for (const product of activeProducts) {
  const brand = normalizeRosskoBrand(product.brand);
  const article = normalizeRosskoArticle(product.article);
  if (!brand || !article) continue;
  const skuAttributes = [product.uom_name, product.package_volume, product.volume, product.weight].map(canonicalAttribute);
  const key = [brand, article, ...skuAttributes].join("\u0000");
  duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), product]);
}
const possibleDuplicates = [...duplicateGroups.entries()].filter(([, rows]) => rows.length > 1);
function nameSkuSignals(value) {
  const name = canonicalAttribute(value);
  return {
    viscosity: name.match(/\b\d{1,2}\s*W\s*[- ]?\s*\d{2}\b/)?.[0]?.replace(/\s+/g, "") ?? null,
    packageLitres: name.match(/\b\d+(?:[.,]\d+)?\s*Л\.?(?=[\s,;]|$)/)?.[0]?.replace(/\s+/g, "") ?? null,
  };
}
const duplicateAudit = {
  definition: "same snapshot branch + canonical brand + canonical own article + UOM + package volume + volume + weight",
  candidateGroups: possibleDuplicates.length,
  cardsInCandidateGroups: possibleDuplicates.reduce((sum, [, rows]) => sum + rows.length, 0),
  excessCards: possibleDuplicates.reduce((sum, [, rows]) => sum + rows.length - 1, 0),
  groupsWithAvailableStockOnMultipleCards: possibleDuplicates.filter(([, rows]) => rows.filter((row) => (stockByProduct.get(row.id)?.available ?? 0) > 0).length > 1).length,
  groupsWithMultipleSupplierNames: possibleDuplicates.filter(([, rows]) => new Set(rows.map((row) => canonicalAttribute(row.supplier_name)).filter(Boolean)).size > 1).length,
  groupsWithConflictingSkuSignalsInName: possibleDuplicates.filter(([, rows]) => {
    const signals = rows.map((row) => nameSkuSignals(row.name));
    return new Set(signals.map((item) => item.viscosity).filter(Boolean)).size > 1
      || new Set(signals.map((item) => item.packageLitres).filter(Boolean)).size > 1;
  }).length,
  sourceBreakdown: countBy(possibleDuplicates.flatMap(([, rows]) => rows.map((row) => parseRawSource(row.raw)))),
  examples: possibleDuplicates.slice(0, 50).map(([key, rows]) => ({
    identityHash: anonymousId(key),
    brand: rows[0].brand,
    article: rows[0].article,
    cards: rows.map((row) => ({
      idHash: anonymousId(row.id),
      name: row.name,
      article: row.article,
      code: row.code,
      supplierName: row.supplier_name,
      moyskladIdentityPresent: Boolean(row.moysklad_id),
      available: stockByProduct.get(row.id)?.available ?? 0,
      source: parseRawSource(row.raw),
      nameSkuSignals: nameSkuSignals(row.name),
    })),
  })),
};

function top1IsCorrect(result, label) {
  if (!label || label.outcome !== "match") return false;
  const expected = new Set(label.expectedVariantKeys ?? []);
  const topKeys = result.candidates?.[0]?.variantIds ?? [result.candidates?.[0]?.variantId].filter(Boolean);
  return topKeys.some((key) => expected.has(key));
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function productEvidence(product, rawArticle) {
  const expected = normalizePartNumberForCrossMatch(rawArticle);
  const ownArticle = normalizePartNumberForCrossMatch(product.article);
  const ownCode = normalizePartNumberForCrossMatch(product.code);
  const exactMannOwn = Boolean(normalizeMannProductBrand(product.brand)) && (
    ownArticle.canonical === expected.canonical
    || (!ownArticle.canonical && ownCode.canonical === expected.canonical)
  );
  const oemEvidence = product.parsedOemParts.filter((entry) => (
    (entry.brand == null || entry.brand === "MANN")
    && (
      entry.canonical === expected.canonical
      || (safeCompactKeys.has(expected.compactCandidate) && entry.compactCandidate === expected.compactCandidate)
    )
  ));
  return { exactMannOwn, oemEvidence };
}

const articlesNeeded = new Map();
const correctTop1Results = [];
for (const result of report.results ?? []) {
  const label = labels.get(result.sampleId);
  if (!top1IsCorrect(result, label)) continue;
  correctTop1Results.push({ result, label });
  for (const rawArticle of label.expectedFilterArticles ?? []) {
    const article = normalizeMannArticle(rawArticle);
    if (!articlesNeeded.has(article)) articlesNeeded.set(article, rawArticle);
  }
}

const articleAudit = new Map();
for (const [article, rawArticle] of articlesNeeded) {
  const matches = [];
  for (const product of activeProducts) {
    const evaluated = evaluateMannArticleProductMatch(product, rawArticle, { safeCompactKeys });
    const evidence = productEvidence(product, rawArticle);
    if (!evaluated && !evidence.exactMannOwn && evidence.oemEvidence.length === 0) continue;
    matches.push({ product, evaluated, evidence });
  }
  for (const link of linksByArticle.get(article) ?? []) {
    const product = productsById.get(link.productId);
    if (!product || product.archived) continue;
    const current = matches.find((item) => item.product.id === product.id);
    if (current) current.explicitLink = link;
    else matches.push({ product, evaluated: null, evidence: productEvidence(product, rawArticle), explicitLink: link });
  }
  const validMatches = matches.filter((item) => item.evidence.exactMannOwn || item.evidence.oemEvidence.length > 0 || item.explicitLink);
  const oemMatches = matches.filter((item) => item.evidence.oemEvidence.length > 0);
  const currentStrong = matches.filter((item) => Math.max(item.evaluated?.confidence ?? 0, item.explicitLink?.confidence ?? 0) >= 80);
  const policyInvalidStrong = currentStrong.filter((item) => !validMatches.includes(item));
  articleAudit.set(article, {
    article,
    rawArticle,
    validMatches,
    oemMatches,
    currentStrong,
    policyInvalidStrong,
    reviewOnly: validMatches.length === 0 && matches.some((item) => (item.evaluated?.confidence ?? 0) > 0),
  });
}

const occurrences = [];
for (const { result, label } of correctTop1Results) {
  for (const rawArticle of label.expectedFilterArticles ?? []) {
    const article = normalizeMannArticle(rawArticle);
    occurrences.push({ sampleId: result.sampleId, ...articleAudit.get(article) });
  }
}
const uniqueAudits = [...articleAudit.values()];

function summarizeReferenceScope(items) {
  return {
    references: items.length,
    coveredByAnyValidEvidence: items.filter((item) => item.validMatches.length > 0).length,
    coveredViaOemParts: items.filter((item) => item.oemMatches.length > 0).length,
    coveredByExactMannOwnCard: items.filter((item) => item.validMatches.some((match) => match.evidence.exactMannOwn)).length,
    coveredByExplicitProductMannLink: items.filter((item) => item.validMatches.some((match) => match.explicitLink)).length,
    multipleValidLocalProducts: items.filter((item) => item.validMatches.length > 1).length,
    multipleOemAnalogs: items.filter((item) => item.oemMatches.length > 1).length,
    uncovered: items.filter((item) => item.validMatches.length === 0).length,
    reviewOnly: items.filter((item) => item.reviewOnly).length,
    policyInvalidStrongMatches: items.reduce((sum, item) => sum + item.policyInvalidStrong.length, 0),
    validAlternatives: {
      total: items.reduce((sum, item) => sum + item.validMatches.length, 0),
      average: items.length ? items.reduce((sum, item) => sum + item.validMatches.length, 0) / items.length : 0,
      median: percentile(items.map((item) => item.validMatches.length), 0.5),
      p95: percentile(items.map((item) => item.validMatches.length), 0.95),
      maximum: Math.max(0, ...items.map((item) => item.validMatches.length)),
    },
    withAtLeastOneAvailableProduct: items.filter((item) => item.validMatches.some((match) => (stockByProduct.get(match.product.id)?.available ?? 0) > 0)).length,
  };
}

let exactFilterSet = 0;
let correctedEndToEnd = 0;
const e2eFailures = [];
for (const result of report.results ?? []) {
  const label = labels.get(result.sampleId);
  if (!top1IsCorrect(result, label)) continue;
  const expected = new Set((label.expectedFilterArticles ?? []).map(normalizeMannArticle));
  const actual = new Set((result.candidates?.[0]?.filters ?? []).map((filter) => normalizeMannArticle(filter.mannArticleNormalized ?? filter.mannArticle)));
  const filtersExact = setEquals(expected, actual);
  if (filtersExact) exactFilterSet += 1;
  const uncovered = [...expected].filter((article) => (articleAudit.get(article)?.validMatches.length ?? 0) === 0);
  if (filtersExact && uncovered.length === 0) correctedEndToEnd += 1;
  else e2eFailures.push({ sampleId: result.sampleId, filtersExact, uncovered });
}

const falseMatchDetails = uniqueAudits.flatMap((item) => item.policyInvalidStrong.map((match) => ({
  article: item.article,
  productIdHash: anonymousId(match.product.id),
  productName: match.product.name,
  brand: match.product.brand,
  currentConfidence: match.evaluated?.confidence ?? match.explicitLink?.confidence ?? 0,
  currentReason: match.evaluated?.reason ?? `ProductMannLink:${match.explicitLink?.linkType}`,
})));

const output = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  datasetId: report.datasetId,
  sourceHashes: Object.fromEntries([
    ["report", reportPath],
    ["labels", labelsPath],
    ["localProducts", productsPath],
    ["localStock", stockPath],
    ["mannLinks", linksPath],
    ["mannCatalog", mannCatalogPath],
  ].map(([name, filePath]) => [name, sha256File(filePath)])),
  limitations: [
    "The local product dump is an offline single-branch snapshot; cross-branch duplicate counts cannot be derived.",
    "The snapshot has no document-position dump, so document usage is not used to auto-classify or merge duplicate candidates.",
    "Duplicate groups are candidates for review only; no card is automatically merged or deleted.",
  ],
  inventory: {
    productRows: products.length,
    activeProductRows: activeProducts.length,
    archivedProductRows: products.filter((product) => product.archived).length,
    activeWithOwnArticle: activeProducts.filter((product) => normalizeRosskoArticle(product.article)).length,
    activeWithBrandAndOwnArticle: activeProducts.filter((product) => normalizeRosskoBrand(product.brand) && normalizeRosskoArticle(product.article)).length,
  },
  oemFormat,
  collisions,
  duplicateAudit,
  datasetD: {
    labels: labelDocument.counts,
    samples: report.results?.length ?? 0,
    correctTop1Samples: correctTop1Results.length,
    exactFilterSetSamples: exactFilterSet,
    expectedFilterOccurrences: summarizeReferenceScope(occurrences),
    uniqueExpectedMannReferences: summarizeReferenceScope(uniqueAudits),
    correctedEndToEnd: {
      successes: correctedEndToEnd,
      denominatorAllSamples: report.results?.length ?? 0,
      rateAllSamples: (report.results?.length ?? 0) ? correctedEndToEnd / report.results.length : 0,
      denominatorCorrectTop1: correctTop1Results.length,
      rateWithinCorrectTop1: correctTop1Results.length ? correctedEndToEnd / correctTop1Results.length : 0,
    },
    falseMatchesUnderStrictEvidencePolicy: {
      count: falseMatchDetails.length,
      details: falseMatchDetails,
    },
    e2eFailures,
    references: uniqueAudits.map((item) => ({
      article: item.article,
      validMatches: item.validMatches.length,
      oemMatches: item.oemMatches.length,
      availableMatches: item.validMatches.filter((match) => (stockByProduct.get(match.product.id)?.available ?? 0) > 0).length,
      exactMannOwnMatches: item.validMatches.filter((match) => match.evidence.exactMannOwn).length,
      explicitLinks: item.validMatches.filter((match) => match.explicitLink).length,
      currentStrong: item.currentStrong.length,
      policyInvalidStrong: item.policyInvalidStrong.length,
      reviewOnly: item.reviewOnly,
    })),
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  outputPath,
  inventory: output.inventory,
  oemFormat: output.oemFormat,
  collisions: output.collisions,
  duplicateAudit: { ...output.duplicateAudit, examples: undefined },
  datasetD: {
    correctTop1Samples: output.datasetD.correctTop1Samples,
    exactFilterSetSamples: output.datasetD.exactFilterSetSamples,
    expectedFilterOccurrences: output.datasetD.expectedFilterOccurrences,
    uniqueExpectedMannReferences: output.datasetD.uniqueExpectedMannReferences,
    correctedEndToEnd: output.datasetD.correctedEndToEnd,
    falseMatchesUnderStrictEvidencePolicy: { count: falseMatchDetails.length },
  },
  limitations: output.limitations,
}, null, 2));
