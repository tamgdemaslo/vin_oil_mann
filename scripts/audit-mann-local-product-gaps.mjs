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
const linksPath = argument("mann-links");
const outputPath = argument("output");
if (!reportPath || !labelsPath || !productsPath || !linksPath || !outputPath) {
  throw new Error("Usage: node scripts/audit-mann-local-product-gaps.mjs --report=<private.json> --labels=<private.json> --local-products=<dump.sql> --mann-links=<dump.sql> --output=<private.json>");
}

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": new URL("../src", import.meta.url).pathname } });
const {
  evaluateMannArticleProductMatch,
  normalizeMannArticle,
  normalizeMannProductBrand,
  normalizePartArticle,
} = await jiti.import("../src/lib/mann-catalog.ts");

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

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const labelsDocument = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
const labels = new Map((labelsDocument.labels ?? []).map((label) => [label.sampleId, label]));
const products = readCopyRows(productsPath, "local_products").filter((row) => row.entity_type !== "service").map((row) => ({
  id: row.id,
  name: row.name,
  article: row.article,
  code: row.code,
  brand: row.brand,
  oemParts: row.oem_parts,
  archived: row.archived === "t",
}));
const productsById = new Map(products.map((product) => [product.id, product]));
const linksByArticle = new Map();
for (const row of readCopyRows(linksPath, "product_mann_links")) {
  const article = normalizeMannArticle(row.mann_article);
  const links = linksByArticle.get(article) ?? [];
  links.push({ productId: row.product_id, linkType: row.link_type, confidence: Number(row.confidence) || 100 });
  linksByArticle.set(article, links);
}

function expectedOccurrences() {
  const occurrences = [];
  for (const result of report.results ?? []) {
    const label = labels.get(result.sampleId);
    if (!label || label.outcome !== "match") continue;
    const expectedVariants = new Set(label.expectedVariantKeys ?? []);
    const top = result.candidates?.[0];
    if (!(top?.variantIds ?? [top?.variantId]).some((variant) => expectedVariants.has(variant))) continue;
    const expectedArticles = new Set((label.expectedFilterArticles ?? []).map(normalizeMannArticle));
    for (const filter of top.filters ?? []) {
      const article = normalizeMannArticle(filter.mannArticleNormalized ?? filter.mannArticle);
      if (expectedArticles.has(article)) occurrences.push({ sampleId: result.sampleId, article, rawArticle: filter.mannArticle });
    }
  }
  return occurrences;
}

function productEvidence(product, rawArticle) {
  const expected = normalizePartArticle(rawArticle);
  const article = normalizePartArticle(product.article);
  const code = normalizePartArticle(product.code);
  const mannBrand = normalizeMannProductBrand(product.brand);
  const structural = article.structural === expected.structural || code.structural === expected.structural;
  const compact = article.compact === expected.compact || code.compact === expected.compact;
  const match = evaluateMannArticleProductMatch(product, rawArticle);
  if (mannBrand && structural) return "MANN_BRAND_EXACT";
  if (mannBrand && compact) return "MANN_BRAND_FORMATTING_VARIANT";
  if (match?.reason.includes("OEM cross-reference")) return "ANALOG_OEM_CROSS_REFERENCE";
  if (structural || compact) return "OTHER_BRAND_ARTICLE_COLLISION";
  if (match?.reason.includes("Name")) return "NAME_REFERENCE_ONLY";
  return null;
}

function classifyOccurrence(occurrence) {
  const links = linksByArticle.get(occurrence.article) ?? [];
  const activeLinks = links.filter((link) => !productsById.get(link.productId)?.archived);
  const activeEvidence = products.filter((product) => !product.archived).map((product) => ({ product, evidence: productEvidence(product, occurrence.rawArticle) })).filter((item) => item.evidence);
  const archivedEvidence = products.filter((product) => product.archived).map((product) => ({ product, evidence: productEvidence(product, occurrence.rawArticle) })).filter((item) => item.evidence);
  let gapClass = "TRULY_ABSENT";
  if (activeLinks.length) gapClass = "ACTIVE_EXPLICIT_LINK";
  else if (activeEvidence.some((item) => item.evidence === "MANN_BRAND_EXACT")) gapClass = "ACTIVE_MANN_EXACT";
  else if (activeEvidence.some((item) => item.evidence === "MANN_BRAND_FORMATTING_VARIANT")) gapClass = "ACTIVE_MANN_FORMATTING_VARIANT";
  else if (activeEvidence.some((item) => item.evidence === "ANALOG_OEM_CROSS_REFERENCE")) gapClass = "ACTIVE_ANALOG_OEM_REFERENCE";
  else if (activeEvidence.some((item) => item.evidence === "OTHER_BRAND_ARTICLE_COLLISION")) gapClass = "ACTIVE_OTHER_BRAND_ARTICLE_ONLY";
  else if (activeEvidence.length) gapClass = "ACTIVE_NAME_REFERENCE_ONLY";
  else if (archivedEvidence.length || links.some((link) => productsById.get(link.productId)?.archived)) gapClass = "ARCHIVED_MATCH";

  const strong = activeEvidence.filter((item) => (evaluateMannArticleProductMatch(item.product, occurrence.rawArticle)?.confidence ?? 0) >= 80);
  let ambiguityClass = null;
  if (strong.length > 1) {
    const exactMann = strong.filter((item) => item.evidence === "MANN_BRAND_EXACT").length;
    const analogs = strong.filter((item) => item.evidence === "ANALOG_OEM_CROSS_REFERENCE").length;
    ambiguityClass = exactMann > 1
      ? "DUPLICATE_MANN_CARDS"
      : exactMann === 1 && analogs > 0
        ? "MANN_EXACT_PLUS_ANALOGS"
        : analogs > 1
          ? "MULTIPLE_ANALOG_CROSS_REFERENCES"
          : "MULTIPLE_STRONG_PRODUCTS";
  }
  return {
    ...occurrence,
    gapClass,
    ambiguityClass,
    activeEvidenceCounts: Object.fromEntries([...new Set(activeEvidence.map((item) => item.evidence))].map((evidence) => [evidence, activeEvidence.filter((item) => item.evidence === evidence).length])),
    archivedEvidenceCount: archivedEvidence.length,
    explicitLinkCount: links.length,
  };
}

const occurrences = expectedOccurrences();
const classified = occurrences.map(classifyOccurrence);
const countBy = (field) => Object.fromEntries([...new Set(classified.map((item) => item[field]).filter(Boolean))].sort().map((value) => [value, classified.filter((item) => item[field] === value).length]));
const output = {
  schemaVersion: 1,
  datasetId: report.datasetId,
  generatedAt: new Date().toISOString(),
  inputHashes: Object.fromEntries([["report", reportPath], ["labels", labelsPath], ["localProducts", productsPath], ["mannLinks", linksPath]].map(([name, filePath]) => [name, crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")])),
  limitations: ["The supplied local product dump contains one branch scope; OTHER_BRANCH cannot be proven from this offline evidence."],
  summary: {
    articleOccurrences: classified.length,
    uniqueArticles: new Set(classified.map((item) => item.article)).size,
    gapClasses: countBy("gapClass"),
    ambiguityClasses: countBy("ambiguityClass"),
  },
  occurrences: classified,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, ...output.summary, limitations: output.limitations }, null, 2));
