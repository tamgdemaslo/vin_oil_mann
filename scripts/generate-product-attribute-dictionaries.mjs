import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowMissing = process.argv.includes("--allow-missing");
const checkOnly = process.argv.includes("--check");
const optionValue = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const sourceDirectoryOption = optionValue("source-dir");

const sources = [
  { field: "brand", fileName: "brands.xml", rootTag: "BrandValues", itemTag: "Brand" },
  { field: "engineSae", fileName: "engine-sae.xml", rootTag: "SAEValues", itemTag: "SAE", legacyPath: "data/values-xml-4.xml" },
  { field: "packageVolume", fileName: "package-volumes.xml", rootTag: "VolumeValues", itemTag: "Volume" },
  { field: "acea", fileName: "acea.xml", rootTag: "ACEAValues", itemTag: "ACEA", legacyPath: "data/values-xml.xml" },
  { field: "engineApi", fileName: "engine-api.xml", rootTag: "APIValues", itemTag: "API", legacyPath: "data/values-xml-2.xml" },
  { field: "engineOem", fileName: "engine-oem.xml", rootTag: "OEMOilValues", itemTag: "OEMOil", legacyPath: "data/values-xml-3.xml" },
  { field: "transmissionSae", fileName: "transmission-sae.xml", rootTag: "SAEValues", itemTag: "SAE" },
  { field: "atf", fileName: "atf.xml", rootTag: "ATFValues", itemTag: "ATF" },
  { field: "transmissionApi", fileName: "transmission-api.xml", rootTag: "APIValues", itemTag: "API" },
  { field: "transmissionOem", fileName: "transmission-oem.xml", rootTag: "OEMOilValues", itemTag: "OEMOil" },
];

const sourceDir = sourceDirectoryOption ? path.resolve(sourceDirectoryOption) : path.join(root, "data/product-attributes/source");
const outputPath = path.resolve(optionValue("output") ?? path.join(root, "src/generated/product-attribute-dictionaries.json"));
const reportJsonPath = path.resolve(optionValue("report-json") ?? path.join(root, "docs/product-attribute-data-quality-report.json"));
const reportMarkdownPath = path.resolve(optionValue("report-md") ?? path.join(root, "docs/product-attribute-data-quality-report.md"));

const confusableMap = {
  "А": "A", "В": "B", "С": "C", "Е": "E", "М": "M", "Н": "H", "О": "O", "Р": "P", "Т": "T", "У": "Y", "Х": "X", "З": "3",
  "а": "A", "в": "B", "с": "C", "е": "E", "м": "M", "н": "H", "о": "O", "р": "P", "т": "T", "у": "Y", "х": "X", "з": "3",
};

const emptyDictionaries = () => ({
  brand: [],
  engineSae: [],
  transmissionSae: [],
  packageVolume: [],
  acea: [],
  engineApi: [],
  transmissionApi: [],
  ilsac: [],
  atf: [],
  engineOem: [],
  transmissionOem: [],
});

function decodeXmlEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, body) => {
    const normalized = body.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    const codePoint = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      throw new Error(`Invalid XML entity: &${body};`);
    }
    return String.fromCodePoint(codePoint);
  });
}

function normalizeDashes(value) {
  return value.replace(/[‐‑‒–—―−]/g, "-");
}

function baseDisplay(value) {
  return normalizeDashes(decodeXmlEntities(value).normalize("NFKC"))
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceConfusables(value) {
  return value.replace(/[АВСЕМНОРТУХЗавсемнортухз]/g, (character) => confusableMap[character] ?? character);
}

function canonicalDisplay(field, raw) {
  const value = baseDisplay(raw);
  if (field === "acea") return replaceConfusables(value).toUpperCase();
  if (field === "engineSae" || field === "transmissionSae") {
    const compact = value.toUpperCase().replace(/\s+/g, "");
    const match = compact.match(/^(\d+(?:[.,]\d+)?)W-?(\d+(?:[.,]\d+)?)$/);
    return match ? `${match[1].replace(",", ".")}W-${match[2].replace(",", ".")}` : value;
  }
  if (field === "packageVolume") {
    const liters = value.match(/^(\d+(?:[.,]\d+)?)\s*(?:л(?:итр(?:а|ов)?)?|l|liters?|litres?)$/i);
    if (liters) return `${liters[1].replace(".", ",")} л`;
  }
  if (field === "ilsac") {
    const match = value.match(/^(?:ILSAC\s*)?GF[\s-]*(\d+)[\s-]*([A-Z]?)$/i);
    if (match) return `GF-${match[1]}${match[2].toUpperCase()}`;
  }
  return value;
}

function identityKey(field, raw) {
  let value = canonicalDisplay(field, raw).toLocaleUpperCase("en-US");
  if (field === "brand") return value;
  if (field === "engineSae" || field === "transmissionSae" || field === "acea" || field === "ilsac") {
    return value.replace(/\s+/g, "");
  }
  if (field === "engineOem" || field === "transmissionOem") return value.replace(/\s+/g, "");
  return value;
}

function lookupKey(field, raw) {
  let value = canonicalDisplay(field, raw).toLocaleUpperCase("en-US");
  if (field === "acea") value = replaceConfusables(value);
  if (field === "engineSae" || field === "transmissionSae") return identityKey(field, value);
  if (field === "ilsac") return identityKey(field, value);
  if (field === "packageVolume") return value.replace(/\s+/g, "");
  if (field === "brand") return value.replace(/\s+/g, " ");
  if (["engineOem", "transmissionOem", "engineApi", "transmissionApi", "atf"].includes(field)) {
    return replaceConfusables(value).replace(/[^A-ZА-Я0-9+]+/g, "");
  }
  return value.replace(/\s+/g, "");
}

function parseXml(xml, expectedRoot, itemTag, displayName) {
  const document = xml.replace(/^\uFEFF/, "");
  const rootMatch = document.match(/^\s*(?:<\?xml[^>]*\?>\s*)?<([A-Za-z_][\w:.-]*)\b[^>]*>([\s\S]*)<\/\1>\s*$/);
  if (!rootMatch) throw new Error(`${displayName}: XML root is missing or malformed`);
  if (rootMatch[1] !== expectedRoot) {
    throw new Error(`${displayName}: expected root <${expectedRoot}>, received <${rootMatch[1]}>`);
  }
  const childPattern = new RegExp(`<${itemTag}\\b[^>]*(?:>([\\s\\S]*?)<\\/${itemTag}>|\\s*\\/>)`, "g");
  const values = [];
  let match;
  while ((match = childPattern.exec(rootMatch[2])) !== null) {
    const content = match[1] ?? "";
    if (/<[A-Za-z_/]/.test(content)) throw new Error(`${displayName}: nested markup inside <${itemTag}> is not supported`);
    values.push(baseDisplay(content));
  }
  const remainder = rootMatch[2]
    .replace(childPattern, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (remainder) throw new Error(`${displayName}: unexpected child tag; expected only <${itemTag}>`);
  return values;
}

function qualityCategory(raw, canonical) {
  if (raw === canonical) return "NO_ISSUE";
  if (raw.toLocaleUpperCase("en-US") === canonical.toLocaleUpperCase("en-US")) return "CASE_VARIANT";
  if (raw.replace(/\s+/g, "") === canonical.replace(/\s+/g, "")) return "WHITESPACE_VARIANT";
  if (replaceConfusables(raw).toLocaleUpperCase("en-US") === canonical.toLocaleUpperCase("en-US")) return "UNICODE_CONFUSABLE";
  return "PUNCTUATION_VARIANT";
}

function addUnique(values, field, raw, issues, context = {}) {
  const canonical = canonicalDisplay(field, raw);
  if (!canonical) return;
  const key = identityKey(field, canonical);
  const existing = values.find((value) => identityKey(field, value) === key);
  if (existing) {
    issues.push({
      category: existing === canonical ? "EXACT_DUPLICATE" : qualityCategory(canonical, existing),
      field,
      raw: canonical,
      canonical: existing,
      resolution: "DEDUPLICATED_TO_FIRST_CANONICAL",
      ...context,
    });
    return;
  }
  values.push(canonical);
  const category = qualityCategory(baseDisplay(raw), canonical);
  if (category !== "NO_ISSUE") {
    issues.push({ category, field, raw: baseDisplay(raw), canonical, resolution: "SAFE_FIELD_SPECIFIC_CANONICALIZATION", ...context });
  }
}

function isSuspicious(field, value) {
  if (/^(?:-|—|нет|не указано|прочее|other|n\/?a)$/i.test(value)) return true;
  if (/не подлежит классификации/i.test(value)) return true;
  if (field === "brand" && (/\b(?:SAE|API|ACEA|ILSAC|ATF|OEM)\b/i.test(value) || /^\d+(?:[.,]\d+)?\s*(?:л|l)$/i.test(value))) return true;
  return false;
}

function sourcePathFor(source) {
  const semanticPath = path.join(sourceDir, source.fileName);
  if (fs.existsSync(semanticPath)) return { absolutePath: semanticPath, repositoryPath: path.relative(root, semanticPath), legacyFallback: false };
  if (!sourceDirectoryOption && source.legacyPath) {
    const legacyPath = path.join(root, source.legacyPath);
    if (fs.existsSync(legacyPath)) return { absolutePath: legacyPath, repositoryPath: source.legacyPath, legacyFallback: true };
  }
  return null;
}

const dictionaries = emptyDictionaries();
const qualityIssues = [];
const sourceFiles = [];
const missingSourceFiles = [];
const rawByField = new Map();

for (const source of sources) {
  const located = sourcePathFor(source);
  if (!located) {
    missingSourceFiles.push(`data/product-attributes/source/${source.fileName}`);
    continue;
  }
  const xml = fs.readFileSync(located.absolutePath, "utf8");
  const rawValues = parseXml(xml, source.rootTag, source.itemTag, located.repositoryPath).filter(Boolean);
  rawByField.set(source.field, rawValues);
  const ownCanonical = [];
  for (const raw of rawValues) addUnique(ownCanonical, source.field, raw, qualityIssues, { sourceFile: located.repositoryPath });
  dictionaries[source.field].push(...ownCanonical);
  for (const value of ownCanonical) {
    if (isSuspicious(source.field, value)) {
      qualityIssues.push({ category: "SUSPICIOUS_VALUE", field: source.field, raw: value, canonical: value, resolution: "KEPT_FOR_REVIEW", sourceFile: located.repositoryPath });
    }
  }
  const legacyAbsolutePath = source.legacyPath ? path.join(root, source.legacyPath) : null;
  const legacySha256 = legacyAbsolutePath && fs.existsSync(legacyAbsolutePath)
    ? crypto.createHash("sha256").update(fs.readFileSync(legacyAbsolutePath)).digest("hex")
    : null;
  const sha256 = crypto.createHash("sha256").update(xml).digest("hex");
  sourceFiles.push({
    fileName: source.fileName,
    repositoryPath: located.repositoryPath,
    legacyFallback: located.legacyFallback,
    sha256,
    rootTag: source.rootTag,
    itemTag: source.itemTag,
    sourceCount: rawValues.length,
    canonicalCount: ownCanonical.length,
    legacyComparison: source.legacyPath ? {
      legacyPath: source.legacyPath,
      legacySha256,
      status: located.legacyFallback ? "SEMANTIC_SOURCE_MISSING_USING_LEGACY" : legacySha256 === sha256 ? "MATCH" : "DIFFERENT",
    } : null,
  });
}

function moveValues(fromField, toField, predicate, transform, reason) {
  const kept = [];
  for (const value of dictionaries[fromField]) {
    if (!predicate(value)) {
      kept.push(value);
      continue;
    }
    const target = transform(value);
    addUnique(dictionaries[toField], toField, target, qualityIssues, { sourceField: fromField, reason });
    qualityIssues.push({
      category: "CROSS_DICTIONARY_VALUE",
      field: fromField,
      raw: value,
      canonical: canonicalDisplay(toField, target),
      targetField: toField,
      resolution: "RECLASSIFIED",
      reason,
    });
  }
  dictionaries[fromField] = kept;
}

moveValues("engineApi", "ilsac", (value) => /^GF-/i.test(value), (value) => value, "GF is an ILSAC family");
moveValues("engineApi", "transmissionApi", (value) => /^(?:GL-|MT-)/i.test(value), (value) => value, "GL/MT is a transmission API family");
moveValues("engineOem", "ilsac", (value) => /^ILSAC\s+/i.test(value), (value) => value.replace(/^ILSAC\s+/i, ""), "ILSAC extracted from engine OEM source");
moveValues("engineOem", "acea", (value) => /^ACEA\s+/i.test(value), (value) => value.replace(/^ACEA\s+/i, ""), "ACEA removed from OEM dropdown");
moveValues("engineOem", "engineApi", (value) => /^API\s+/i.test(value) || dictionaries.engineApi.some((candidate) => identityKey("engineApi", candidate) === identityKey("engineApi", value)), (value) => value.replace(/^API\s+/i, ""), "API removed from OEM dropdown");

for (const field of Object.keys(dictionaries)) {
  dictionaries[field].sort((left, right) => left.localeCompare(right, "ru", { numeric: true, sensitivity: "base" }));
}

const configuredAliases = [
  { field: "engineOem", alias: "BMW LL-04", canonical: "BMW Longlife-04", reason: "verified common abbreviation" },
  { field: "engineOem", alias: "GM dexos2", canonical: "GM Dexos 2", reason: "verified spelling variant" },
  { field: "engineOem", alias: "VW 505 00", canonical: "VW 505.00", reason: "verified punctuation variant" },
  { field: "engineOem", alias: "VW 505 01", canonical: "VW 505.01", reason: "verified punctuation variant" },
];
const verifiedAliases = configuredAliases.filter((alias) => dictionaries[alias.field].includes(alias.canonical));
for (const alias of verifiedAliases) {
  qualityIssues.push({ category: "SEMANTIC_ALIAS_CANDIDATE", ...alias, resolution: "VERIFIED_ALIAS" });
}

const collisions = {};
for (const [field, values] of Object.entries(dictionaries)) {
  const groups = new Map();
  for (const value of values) {
    const key = lookupKey(field, value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  collisions[field] = [...groups]
    .filter(([, values]) => new Set(values).size > 1)
    .map(([normalizedKey, values]) => ({ normalizedKey, values: [...new Set(values)] }));
}

const sourceSignature = sourceFiles.map((source) => `${source.fileName}:${source.sha256}`).sort().join("\n");
const version = crypto.createHash("sha256").update(sourceSignature).digest("hex").slice(0, 16);
let generatedAt = new Date().toISOString();
if (fs.existsSync(outputPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (previous?.metadata?.version === version && previous?.metadata?.generatedAt) generatedAt = previous.metadata.generatedAt;
  } catch {
    // Invalid prior output is replaced after source validation.
  }
}

const summary = Object.fromEntries([
  "EXACT_DUPLICATE", "CASE_VARIANT", "WHITESPACE_VARIANT", "PUNCTUATION_VARIANT", "UNICODE_CONFUSABLE",
  "SEMANTIC_ALIAS_CANDIDATE", "CROSS_DICTIONARY_VALUE", "SUSPICIOUS_VALUE",
].map((category) => [category, qualityIssues.filter((issue) => issue.category === category).length]));
summary.COLLISION = Object.values(collisions).reduce((total, fieldCollisions) => total + fieldCollisions.length, 0);
summary.NO_ISSUE = Math.max(0, sourceFiles.reduce((total, source) => total + source.sourceCount, 0) - qualityIssues.length);

const document = {
  metadata: {
    version,
    generatedAt,
    complete: missingSourceFiles.length === 0,
    sourceFiles,
    missingSourceFiles,
  },
  dictionaries,
  verifiedAliases,
  collisions,
  derivedProvenance: qualityIssues
    .filter((issue) => issue.category === "CROSS_DICTIONARY_VALUE")
    .map((issue) => ({
      value: issue.canonical,
      sourceField: issue.field,
      targetField: issue.targetField,
      sourceFile: sourceFiles.find((source) => sources.find((item) => item.fileName === source.fileName)?.field === issue.field)?.repositoryPath ?? null,
      reason: issue.reason,
    })),
};

const report = {
  metadata: document.metadata,
  summary,
  qualityIssues,
  collisions,
  notes: [
    "A slash is always preserved as part of an atomic technical value.",
    "Disputed and suspicious values are kept and reported; they are not silently deleted.",
    "A lookup-key collision disables automatic canonical selection for that key.",
  ],
};

const markdown = `# Data-quality report: product fluid attributes

- Version: \`${version}\`
- Generated at: ${generatedAt}
- Complete source set: ${document.metadata.complete ? "yes" : "no"}
- Available XML: ${sourceFiles.length}/10
- Missing: ${missingSourceFiles.length ? missingSourceFiles.map((value) => `\`${value}\``).join(", ") : "none"}

## Source files

| Field | File | SHA-256 | Root/item | Source | Canonical | Legacy comparison |
| --- | --- | --- | --- | ---: | ---: | --- |
${sourceFiles.map((source) => `| ${sources.find((item) => item.fileName === source.fileName)?.field ?? ""} | \`${source.repositoryPath}\` | \`${source.sha256}\` | ${source.rootTag}/${source.itemTag} | ${source.sourceCount} | ${source.canonicalCount} | ${source.legacyComparison?.status ?? "n/a"} |`).join("\n")}

## Summary

${Object.entries(summary).map(([category, count]) => `- ${category}: ${count}`).join("\n")}

## Reclassifications and anomalies

${qualityIssues.length ? qualityIssues.map((issue) => `- **${issue.category}** [${issue.field}] \`${issue.raw ?? issue.alias ?? ""}\`${issue.canonical && issue.canonical !== issue.raw ? ` → \`${issue.canonical}\`` : ""}${issue.targetField ? ` → ${issue.targetField}` : ""}${issue.reason ? ` — ${issue.reason}` : ""}`).join("\n") : "No issues."}

## Collisions

${Object.entries(collisions).flatMap(([field, groups]) => groups.map((group) => `- **${field}** \`${group.normalizedKey}\`: ${group.values.map((value) => `\`${value}\``).join(", ")}`)).join("\n") || "No lookup-key collisions."}
`;

if (missingSourceFiles.length && !allowMissing) {
  throw new Error(`Missing ${missingSourceFiles.length} required XML source files:\n${missingSourceFiles.map((value) => `- ${value}`).join("\n")}\nUse --allow-missing only for an explicitly partial bootstrap.`);
}

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const reportJson = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== serialized) throw new Error(`${path.relative(root, outputPath)} is stale; regenerate dictionaries`);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  fs.writeFileSync(reportJsonPath, reportJson);
  fs.writeFileSync(reportMarkdownPath, markdown);
}

console.log(`[product-attributes] version=${version} sources=${sourceFiles.length}/10 complete=${document.metadata.complete}`);
for (const [field, values] of Object.entries(dictionaries)) console.log(`[product-attributes] ${field}=${values.length}`);
if (missingSourceFiles.length) console.warn(`[product-attributes] missing=${missingSourceFiles.join(",")}`);
