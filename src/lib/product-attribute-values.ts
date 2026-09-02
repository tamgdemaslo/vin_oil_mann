import generatedDocument from "@/generated/product-attribute-dictionaries.json";
import {
  resolveProductFluidAttributeProfile,
  type ProductFluidAttributeProfile,
  type ProductFluidProfileInput,
} from "@/lib/product-fluid-profile";

export const PRODUCT_ATTRIBUTE_FIELDS = [
  "brand",
  "engineSae",
  "transmissionSae",
  "packageVolume",
  "acea",
  "engineApi",
  "transmissionApi",
  "ilsac",
  "atf",
  "engineOem",
  "transmissionOem",
] as const;

export type ProductAttributeField = (typeof PRODUCT_ATTRIBUTE_FIELDS)[number];
export type ProductAttributeCardinality = "single" | "multi";
export type ProductAttributeMatchStatus = "CANONICAL" | "SAFE_NORMALIZED" | "VERIFIED_ALIAS" | "CUSTOM" | "AMBIGUOUS";

export type ProductAttributeMatch = {
  input: string;
  value: string;
  status: ProductAttributeMatchStatus;
  method: "EXACT_RAW" | "EXACT_NORMALIZED" | "VERIFIED_ALIAS" | "UNIQUE_CANONICAL_KEY" | "CUSTOM" | "AMBIGUOUS";
  confidence: "HIGH" | "MEDIUM" | "NONE";
  candidates: string[];
  warnings: string[];
};

export type ProductAttributeOption = {
  value: string;
  matchKind: "exact" | "normalized" | "prefix" | "token" | "contains" | "alias" | "default";
};

type GeneratedDocument = {
  metadata: {
    version: string;
    generatedAt: string;
    complete: boolean;
    missingSourceFiles: string[];
    sourceFiles: Array<Record<string, unknown>>;
  };
  dictionaries: Record<ProductAttributeField, string[]>;
  verifiedAliases: Array<{ field: ProductAttributeField; alias: string; canonical: string; reason: string }>;
  collisions: Record<ProductAttributeField, Array<{ normalizedKey: string; values: string[] }>>;
};

const generated = generatedDocument as unknown as GeneratedDocument;

export const productAttributeDictionaryMetadata = generated.metadata;
export const productAttributeFieldCardinality: Record<ProductAttributeField, ProductAttributeCardinality> = {
  brand: "single",
  engineSae: "single",
  transmissionSae: "single",
  packageVolume: "single",
  acea: "multi",
  engineApi: "multi",
  transmissionApi: "multi",
  ilsac: "multi",
  atf: "multi",
  engineOem: "multi",
  transmissionOem: "multi",
};

const confusableMap: Record<string, string> = {
  "А": "A", "В": "B", "С": "C", "Е": "E", "М": "M", "Н": "H", "О": "O", "Р": "P", "Т": "T", "У": "Y", "Х": "X", "З": "3",
  "а": "A", "в": "B", "с": "C", "е": "E", "м": "M", "н": "H", "о": "O", "р": "P", "т": "T", "у": "Y", "х": "X", "з": "3",
};

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function normalizeDashes(value: string) {
  return value.replace(/[‐‑‒–—―−]/g, "-");
}

function baseDisplay(value: unknown) {
  return normalizeDashes(decodeXmlEntities(String(value ?? "")).normalize("NFKC"))
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceConfusables(value: string) {
  return value.replace(/[АВСЕМНОРТУХЗавсемнортухз]/g, (character) => confusableMap[character] ?? character);
}

function canonicalDisplay(field: ProductAttributeField, raw: unknown) {
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

function identityKey(field: ProductAttributeField, raw: unknown) {
  const value = canonicalDisplay(field, raw).toLocaleUpperCase("en-US");
  if (field === "brand") return value;
  if (field === "engineSae" || field === "transmissionSae" || field === "acea" || field === "ilsac") return value.replace(/\s+/g, "");
  if (field === "engineOem" || field === "transmissionOem") return value.replace(/\s+/g, "");
  return value;
}

export function productAttributeLookupKey(field: ProductAttributeField, raw: unknown) {
  let value = canonicalDisplay(field, raw).toLocaleUpperCase("en-US");
  if (field === "acea") value = replaceConfusables(value);
  if (field === "engineSae" || field === "transmissionSae" || field === "ilsac") return identityKey(field, value);
  if (field === "packageVolume") return value.replace(/\s+/g, "");
  if (field === "brand") return value.replace(/\s+/g, " ");
  if (["engineOem", "transmissionOem", "engineApi", "transmissionApi", "atf"].includes(field)) {
    return replaceConfusables(value).replace(/[^A-ZА-Я0-9+]+/g, "");
  }
  return value.replace(/\s+/g, "");
}

export function getProductAttributeDictionary(field: ProductAttributeField): readonly string[] {
  return generated.dictionaries[field] ?? [];
}

function uniqueMatches(field: ProductAttributeField, input: unknown, keyFactory: (field: ProductAttributeField, value: unknown) => string) {
  const key = keyFactory(field, input);
  if (!key) return [];
  return getProductAttributeDictionary(field).filter((candidate) => keyFactory(field, candidate) === key);
}

export function normalizeAttributeValue(field: ProductAttributeField, input: unknown): ProductAttributeMatch {
  const raw = baseDisplay(input);
  if (!raw) return { input: raw, value: "", status: "CUSTOM", method: "CUSTOM", confidence: "NONE", candidates: [], warnings: [] };
  const dictionary = getProductAttributeDictionary(field);

  const exact = dictionary.find((candidate) => candidate === raw);
  if (exact) return { input: raw, value: exact, status: "CANONICAL", method: "EXACT_RAW", confidence: "HIGH", candidates: [exact], warnings: [] };

  const normalizedMatches = uniqueMatches(field, raw, identityKey);
  if (normalizedMatches.length === 1) {
    return { input: raw, value: normalizedMatches[0], status: "SAFE_NORMALIZED", method: "EXACT_NORMALIZED", confidence: "HIGH", candidates: normalizedMatches, warnings: [] };
  }
  if (normalizedMatches.length > 1) {
    return { input: raw, value: raw, status: "AMBIGUOUS", method: "AMBIGUOUS", confidence: "NONE", candidates: normalizedMatches, warnings: ["Несколько канонических значений имеют одинаковую нормализованную форму"] };
  }

  const alias = generated.verifiedAliases.find((candidate) => candidate.field === field && identityKey(field, candidate.alias) === identityKey(field, raw));
  if (alias) {
    return { input: raw, value: alias.canonical, status: "VERIFIED_ALIAS", method: "VERIFIED_ALIAS", confidence: "HIGH", candidates: [alias.canonical], warnings: [] };
  }

  const lookupMatches = uniqueMatches(field, raw, productAttributeLookupKey);
  if (lookupMatches.length === 1) {
    return { input: raw, value: lookupMatches[0], status: "SAFE_NORMALIZED", method: "UNIQUE_CANONICAL_KEY", confidence: "HIGH", candidates: lookupMatches, warnings: [] };
  }
  if (lookupMatches.length > 1) {
    return { input: raw, value: raw, status: "AMBIGUOUS", method: "AMBIGUOUS", confidence: "NONE", candidates: lookupMatches, warnings: ["Похожая запись неоднозначна и сохранена без автоматической замены"] };
  }

  return { input: raw, value: raw, status: "CUSTOM", method: "CUSTOM", confidence: "NONE", candidates: [], warnings: [] };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexibleTechnicalPattern(value: string) {
  let pattern = "";
  for (const character of value) {
    if (/\s/u.test(character)) pattern += "\\s*";
    else if (/[.\-‐‑‒–—―−]/u.test(character)) pattern += "[\\s.\\-‐‑‒–—―−]*";
    else pattern += escapeRegex(character);
  }
  return pattern;
}

type Occurrence = { start: number; end: number; canonical: string };

function canonicalOccurrences(field: ProductAttributeField, input: string) {
  const sources = [
    ...getProductAttributeDictionary(field).map((canonical) => ({ phrase: canonical, canonical })),
    ...generated.verifiedAliases.filter((alias) => alias.field === field).map((alias) => ({ phrase: alias.alias, canonical: alias.canonical })),
  ].sort((left, right) => right.phrase.length - left.phrase.length);
  const candidates: Occurrence[] = [];
  for (const source of sources) {
    const pattern = flexibleTechnicalPattern(source.phrase);
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}+])(${pattern})(?=$|[^\\p{L}\\p{N}+])`, "giu");
    let match: RegExpExecArray | null;
    while ((match = expression.exec(input)) !== null) {
      const start = match.index + match[1].length;
      candidates.push({ start, end: start + match[2].length, canonical: source.canonical });
      if (match[0].length === 0) expression.lastIndex += 1;
    }
  }
  candidates.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const selected: Occurrence[] = [];
  for (const candidate of candidates) {
    if (selected.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    selected.push(candidate);
  }
  return selected.sort((left, right) => left.start - right.start);
}

function cleanCustomRemainder(value: string) {
  return value.replace(/^[\s,|]+|[\s,|]+$/g, "").replace(/\s+/g, " ").trim();
}

function parseLegacySegment(segment: string, field: ProductAttributeField) {
  const whole = normalizeAttributeValue(field, segment);
  if (whole.status !== "CUSTOM" && whole.status !== "AMBIGUOUS") return [whole.value];
  const occurrences = canonicalOccurrences(field, segment);
  if (!occurrences.length) return [baseDisplay(segment)].filter(Boolean);
  const values: string[] = [];
  let cursor = 0;
  for (const occurrence of occurrences) {
    const remainder = cleanCustomRemainder(segment.slice(cursor, occurrence.start));
    if (remainder) values.push(remainder);
    values.push(occurrence.canonical);
    cursor = occurrence.end;
  }
  const tail = cleanCustomRemainder(segment.slice(cursor));
  if (tail) values.push(tail);
  return values;
}

/** Semicolon and line break are the only unconditional multi-value delimiters. Slash is always atomic. */
export function parseStoredAttributeValues(value: unknown, field?: ProductAttributeField): string[] {
  const raw = String(value ?? "").normalize("NFKC");
  if (!raw.trim()) return [];
  const primarySegments = raw.split(/[;\r\n]+/).map(baseDisplay).filter(Boolean);
  const parsed = field ? primarySegments.flatMap((segment) => parseLegacySegment(segment, field)) : primarySegments;
  return deduplicateAttributeValues(parsed, field);
}

export function deduplicateAttributeValues(values: readonly string[], field?: ProductAttributeField): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = baseDisplay(raw);
    if (!value) continue;
    const match = field ? normalizeAttributeValue(field, value) : null;
    const finalValue = match && match.status !== "AMBIGUOUS" ? match.value : value;
    const key = field ? identityKey(field, finalValue) : finalValue.toLocaleUpperCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(finalValue);
  }
  return output;
}

export function normalizeAttributeValues(field: ProductAttributeField, input: unknown) {
  return deduplicateAttributeValues(parseStoredAttributeValues(input, field), field).map((value) => normalizeAttributeValue(field, value));
}

export function serializeAttributeValues(values: readonly string[], field?: ProductAttributeField) {
  return deduplicateAttributeValues(values, field).join("; ");
}

export function mergeAttributeValues(existing: unknown, additions: readonly string[], field?: ProductAttributeField) {
  return serializeAttributeValues([...parseStoredAttributeValues(existing, field), ...additions], field);
}

function genericSearchText(value: unknown) {
  return replaceConfusables(baseDisplay(value))
    .toLocaleUpperCase("ru-RU")
    .replace(/[.\-‐‑‒–—―−_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchProductAttributeOptions(field: ProductAttributeField, query: unknown, limit = 40): ProductAttributeOption[] {
  const rawQuery = baseDisplay(query);
  const queryText = genericSearchText(rawQuery);
  const queryLookup = productAttributeLookupKey(field, rawQuery);
  const aliases = generated.verifiedAliases.filter((alias) => alias.field === field);
  const dictionary = getProductAttributeDictionary(field);
  type RankedOption = ProductAttributeOption & { rank: number };
  const ranked: RankedOption[] = dictionary.flatMap((value): RankedOption[] => {
    if (!rawQuery) return [{ value, rank: 6, matchKind: "default" as const }];
    const valueText = genericSearchText(value);
    const valueLookup = productAttributeLookupKey(field, value);
    if (value === rawQuery) return [{ value, rank: 0, matchKind: "exact" as const }];
    if (valueLookup === queryLookup) return [{ value, rank: 1, matchKind: "normalized" as const }];
    if (valueText.startsWith(queryText) || valueLookup.startsWith(queryLookup)) return [{ value, rank: 2, matchKind: "prefix" as const }];
    const queryTokens = queryText.split(" ").filter(Boolean);
    const valueTokens = valueText.split(" ").filter(Boolean);
    if (queryTokens.length && queryTokens.every((token) => valueTokens.some((candidate) => candidate.startsWith(token)))) {
      return [{ value, rank: 3, matchKind: "token" as const }];
    }
    if ((queryText.length >= 2 && valueText.includes(queryText)) || (queryLookup.length >= 3 && valueLookup.includes(queryLookup))) {
      return [{ value, rank: 4, matchKind: "contains" as const }];
    }
    const aliasMatch = aliases.some((alias) => alias.canonical === value && genericSearchText(alias.alias).includes(queryText));
    return aliasMatch ? [{ value, rank: 5, matchKind: "alias" as const }] : [];
  });
  return ranked
    .sort((left, right) => left.rank - right.rank || left.value.localeCompare(right.value, "ru", { numeric: true, sensitivity: "base" }))
    .slice(0, Math.max(1, Math.min(dictionary.length, Number.isFinite(limit) ? Math.floor(limit) : dictionary.length)))
    .map(({ value, matchKind }) => ({ value, matchKind }));
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function findSimilarAttributeSuggestion(field: ProductAttributeField, input: unknown) {
  const normalized = normalizeAttributeValue(field, input);
  if (normalized.status !== "CUSTOM") return normalized.value || null;
  const key = productAttributeLookupKey(field, input);
  if (key.length < 4) return null;
  const ranked = getProductAttributeDictionary(field)
    .map((value) => ({ value, distance: levenshteinDistance(key, productAttributeLookupKey(field, value)) }))
    .sort((left, right) => left.distance - right.distance || left.value.length - right.value.length);
  const best = ranked[0];
  if (!best || best.distance > Math.max(2, Math.floor(key.length * 0.18))) return null;
  return best.value;
}

export function normalizeBrand(value: unknown) { return normalizeAttributeValue("brand", value); }
export function normalizeEngineSae(value: unknown) { return normalizeAttributeValue("engineSae", value); }
export function normalizeTransmissionSae(value: unknown) { return normalizeAttributeValue("transmissionSae", value); }
export function normalizePackageVolume(value: unknown) { return normalizeAttributeValue("packageVolume", value); }
export function normalizeAcea(value: unknown) { return normalizeAttributeValues("acea", value); }
export function normalizeEngineApi(value: unknown) { return normalizeAttributeValues("engineApi", value); }
export function normalizeTransmissionApi(value: unknown) { return normalizeAttributeValues("transmissionApi", value); }
export function normalizeIlsac(value: unknown) { return normalizeAttributeValues("ilsac", value); }
export function normalizeAtf(value: unknown) { return normalizeAttributeValues("atf", value); }
export function normalizeEngineOemApproval(value: unknown) { return normalizeAttributeValues("engineOem", value); }
export function normalizeTransmissionOemApproval(value: unknown) { return normalizeAttributeValues("transmissionOem", value); }

type ProductAttributePayload = ProductFluidProfileInput & Partial<Record<"brand" | "sae" | "packageVolume" | "acea" | "apiSpec" | "ilsac" | "atf" | "oem" | "oemAtf" | "aceaExtra", unknown>>;

export function normalizeProductAttributePayload(input: ProductAttributePayload, forcedProfile?: ProductFluidAttributeProfile) {
  const profile = forcedProfile ?? resolveProductFluidAttributeProfile(input);
  const values: Partial<Record<keyof ProductAttributePayload, string | null>> = {};
  const matches: Partial<Record<keyof ProductAttributePayload, ProductAttributeMatch[]>> = {};
  const setSingle = (key: keyof ProductAttributePayload, field: ProductAttributeField) => {
    if (!(key in input)) return;
    const result = normalizeAttributeValue(field, input[key]);
    values[key] = result.value || null;
    matches[key] = [result];
  };
  const setMulti = (key: keyof ProductAttributePayload, field: ProductAttributeField) => {
    if (!(key in input)) return;
    const result = normalizeAttributeValues(field, input[key]);
    values[key] = serializeAttributeValues(result.map((item) => item.value), field) || null;
    matches[key] = result;
  };
  const setUnchangedText = (key: keyof ProductAttributePayload) => {
    if (!(key in input)) return;
    const preserved = String(input[key] ?? "").normalize("NFKC").trim();
    values[key] = preserved || null;
  };

  setSingle("brand", "brand");
  setSingle("packageVolume", "packageVolume");
  setMulti("acea", "acea");
  setMulti("aceaExtra", "acea");
  setMulti("ilsac", "ilsac");
  setMulti("atf", "atf");

  if (profile === "TRANSMISSION_FLUID") {
    setSingle("sae", "transmissionSae");
    setMulti("apiSpec", "transmissionApi");
    setMulti("oemAtf", "transmissionOem");
    setUnchangedText("oem");
  } else if (profile === "ENGINE_OIL") {
    setSingle("sae", "engineSae");
    setMulti("apiSpec", "engineApi");
    setMulti("oem", "engineOem");
    setUnchangedText("oemAtf");
  } else {
    setUnchangedText("sae");
    setUnchangedText("apiSpec");
    setUnchangedText("oem");
    setUnchangedText("oemAtf");
  }

  return { profile, values, matches };
}
